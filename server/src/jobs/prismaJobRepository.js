import { randomUUID } from 'node:crypto'
import { buildJobRun, jobDefinitionDto, jobRunDto, sanitizeJobData } from './jobRecords.js'

const runInclude = { definition: true, attempts: { orderBy: { attemptNumber: 'asc' } } }
const plusSeconds = (date, seconds) => new Date(date.getTime() + Math.max(1, Number(seconds ?? 300)) * 1000)

export const createPrismaJobRepository = (client, { recordAudit = async () => {} } = {}) => ({
  async ensureDefinition(definition) {
    const data = {
      id: String(definition.id),
      type: String(definition.type ?? definition.id),
      version: Number(definition.version ?? 1),
      enabled: definition.enabled !== false,
      defaultTimeoutSeconds: Math.min(Math.max(Number(definition.defaultTimeoutSeconds ?? 300), 1), 86400),
      description: definition.description ? String(definition.description).slice(0, 500) : null,
    }
    return jobDefinitionDto(await client.jobDefinition.upsert({ where: { id: data.id }, create: data, update: data }))
  },
  async listDefinitions(options = {}) {
    const rows = await client.jobDefinition.findMany({
      where: { ...(options.enabled == null ? {} : { enabled: Boolean(options.enabled) }), ...(options.type ? { type: String(options.type) } : {}) },
      orderBy: [{ type: 'asc' }, { version: 'desc' }],
    })
    return rows.map(jobDefinitionDto)
  },
  async enqueue(payload) {
    const data = buildJobRun(payload)
    const definition = await client.jobDefinition.findUnique({ where: { id: data.definitionId } })
    if (!definition?.enabled) return null
    return jobRunDto(await client.jobRun.upsert({ where: { idempotencyKey: data.idempotencyKey }, create: data, update: {}, include: runInclude }))
  },
  async find(id) {
    return jobRunDto(await client.jobRun.findUnique({ where: { id: String(id) }, include: runInclude }))
  },
  async list(options = {}) {
    const limit = Math.min(Math.max(Number(options.limit ?? 20), 1), 100)
    const rows = await client.jobRun.findMany({
      where: {
        ...(options.status ? { status: options.status } : {}),
        ...(options.definitionId ? { definitionId: String(options.definitionId) } : {}),
        ...(options.ownerId ? { ownerId: String(options.ownerId) } : {}),
        ...(options.correlationId ? { correlationId: String(options.correlationId) } : {}),
      },
      include: runInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(options.cursor ? { cursor: { id: String(options.cursor) }, skip: 1 } : {}),
    })
    const page = rows.slice(0, limit)
    return { items: page.map(jobRunDto), limit, nextCursor: rows.length > limit ? page.at(-1)?.id ?? null : null }
  },
  async claim({ workerId, definitionId = null } = {}) {
    const now = new Date()
    return client.$transaction(async (transaction) => {
      const candidate = await transaction.jobRun.findFirst({
        where: { status: 'queued', scheduledAt: { lte: now }, cancelRequestedAt: null, definition: { enabled: true }, ...(definitionId ? { definitionId: String(definitionId) } : {}) },
        include: { definition: true },
        orderBy: [{ priority: 'desc' }, { scheduledAt: 'asc' }, { id: 'asc' }],
      })
      if (!candidate) return null
      const timeoutAt = plusSeconds(now, candidate.definition.defaultTimeoutSeconds)
      const claimed = await transaction.jobRun.updateMany({
        where: { id: candidate.id, status: 'queued', cancelRequestedAt: null },
        data: { status: 'running', startedAt: now, heartbeatAt: now, timeoutAt },
      })
      if (!claimed.count) return null
      const leaseToken = randomUUID()
      await transaction.jobAttempt.create({
        data: { id: `attempt-${randomUUID()}`, runId: candidate.id, attemptNumber: 1, workerId: String(workerId), leaseToken, heartbeatAt: now, timeoutAt },
      })
      const row = await transaction.jobRun.findUnique({ where: { id: candidate.id }, include: runInclude })
      return { ...jobRunDto(row), leaseToken }
    })
  },
  async heartbeat(id, leaseToken, timeoutSeconds = 300) {
    const now = new Date()
    const timeoutAt = plusSeconds(now, timeoutSeconds)
    return client.$transaction(async (transaction) => {
      const attempt = await transaction.jobAttempt.updateMany({ where: { runId: String(id), leaseToken: String(leaseToken), status: 'running', timeoutAt: { gt: now } }, data: { heartbeatAt: now, timeoutAt } })
      if (!attempt.count) return false
      await transaction.jobRun.update({ where: { id: String(id) }, data: { heartbeatAt: now, timeoutAt } })
      return true
    })
  },
  async complete(id, leaseToken, result = null) {
    const now = new Date()
    return client.$transaction(async (transaction) => {
      const safeResult = sanitizeJobData(result)
      const attempt = await transaction.jobAttempt.updateMany({ where: { runId: String(id), leaseToken: String(leaseToken), status: 'running' }, data: { status: 'succeeded', result: safeResult, completedAt: now } })
      if (!attempt.count) return null
      const updated = await transaction.jobRun.updateMany({ where: { id: String(id), status: 'running' }, data: { status: 'succeeded', result: safeResult, completedAt: now, heartbeatAt: now } })
      if (!updated.count) return null
      return jobRunDto(await transaction.jobRun.findUnique({ where: { id: String(id) }, include: runInclude }))
    })
  },
  async fail(id, leaseToken, errorCode) {
    const now = new Date()
    return client.$transaction(async (transaction) => {
      const code = String(errorCode ?? 'JOB_FAILED').slice(0, 120)
      const attempt = await transaction.jobAttempt.updateMany({ where: { runId: String(id), leaseToken: String(leaseToken), status: 'running' }, data: { status: 'failed', errorCode: code, completedAt: now } })
      if (!attempt.count) return null
      await transaction.jobRun.updateMany({ where: { id: String(id), status: 'running' }, data: { status: 'failed', errorCode: code, completedAt: now } })
      return jobRunDto(await transaction.jobRun.findUnique({ where: { id: String(id) }, include: runInclude }))
    })
  },
  async requestCancel(id, actor, options = {}) {
    const now = new Date()
    const row = await client.jobRun.findUnique({ where: { id: String(id) } })
    if (!row) return null
    if (['succeeded', 'failed', 'timed_out', 'cancelled'].includes(row.status)) return this.find(id)
    const updated = await client.jobRun.updateMany({
      where: { id: row.id, status: row.status, cancelRequestedAt: null },
      data: row.status === 'queued' ? { status: 'cancelled', cancelRequestedAt: now, completedAt: now } : { cancelRequestedAt: now },
    })
    if (!updated.count) return this.find(id)
    await recordAudit({ actor, action: 'job.cancel_requested', resourceType: 'job_run', resourceId: row.id, metadata: { previousStatus: row.status, reasonCode: options.reasonCode ?? 'admin_cancel' } })
    return this.find(id)
  },
  async cancelRunning(id, leaseToken) {
    const now = new Date()
    return client.$transaction(async (transaction) => {
      const activeAttempt = await transaction.jobAttempt.findFirst({
        where: { runId: String(id), leaseToken: String(leaseToken), status: 'running' },
        select: { id: true },
      })
      if (!activeAttempt) return null
      const run = await transaction.jobRun.updateMany({ where: { id: String(id), status: 'running', cancelRequestedAt: { not: null } }, data: { status: 'cancelled', completedAt: now } })
      if (!run.count) return null
      const attempt = await transaction.jobAttempt.updateMany({ where: { id: activeAttempt.id, status: 'running' }, data: { status: 'cancelled', completedAt: now } })
      if (!attempt.count) throw new Error('JOB_CANCEL_LEASE_REJECTED')
      return jobRunDto(await transaction.jobRun.findUnique({ where: { id: String(id) }, include: runInclude }))
    })
  },
  async sweepTimeouts(limit = 100) {
    const now = new Date()
    const rows = await client.jobRun.findMany({ where: { status: 'running', timeoutAt: { lte: now } }, take: Math.min(Math.max(Number(limit), 1), 500), orderBy: { timeoutAt: 'asc' } })
    const timedOut = []
    for (const row of rows) {
      await client.$transaction([
        client.jobAttempt.updateMany({ where: { runId: row.id, status: 'running' }, data: { status: 'timed_out', errorCode: 'JOB_TIMEOUT', completedAt: now } }),
        client.jobRun.updateMany({ where: { id: row.id, status: 'running' }, data: { status: 'timed_out', errorCode: 'JOB_TIMEOUT', completedAt: now } }),
      ])
      timedOut.push(row.id)
    }
    return timedOut
  },
})
