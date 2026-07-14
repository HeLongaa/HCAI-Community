import { randomUUID } from 'node:crypto'
import { buildJobRun, jobDefinitionDto, jobRunDto, sanitizeJobData } from './jobRecords.js'

export const createSeedJobRepository = ({ recordAudit = async () => {} } = {}) => {
  const definitions = new Map()
  const runs = new Map()
  const attempts = new Map()
  const hydrate = (run) => run ? { ...run, definition: definitions.get(run.definitionId), attempts: [...attempts.values()].filter((attempt) => attempt.runId === run.id).sort((a, b) => a.attemptNumber - b.attemptNumber) } : null
  const repository = {
    async ensureDefinition(definition) {
      const now = new Date()
      const current = definitions.get(String(definition.id))
      const row = { id: String(definition.id), type: String(definition.type ?? definition.id), version: Number(definition.version ?? 1), enabled: definition.enabled !== false, defaultTimeoutSeconds: Math.min(Math.max(Number(definition.defaultTimeoutSeconds ?? 300), 1), 86400), maxAttempts: Math.min(Math.max(Number(definition.maxAttempts ?? 3), 1), 20), retryBackoffSeconds: Math.min(Math.max(Number(definition.retryBackoffSeconds ?? 60), 0), 86400), cronSchedule: definition.cronSchedule ?? null, pausedAt: current?.pausedAt ?? null, description: definition.description ?? null, createdAt: current?.createdAt ?? now, updatedAt: now }
      definitions.set(row.id, row)
      return jobDefinitionDto(row)
    },
    async listDefinitions(options = {}) { return [...definitions.values()].filter((item) => options.enabled == null || item.enabled === Boolean(options.enabled)).filter((item) => !options.type || item.type === options.type).sort((a, b) => a.type.localeCompare(b.type) || b.version - a.version).map(jobDefinitionDto) },
    async enqueue(payload) {
      const data = buildJobRun(payload)
      const definition = definitions.get(data.definitionId)
      if (!definition?.enabled || definition.pausedAt) return null
      const existing = [...runs.values()].find((item) => item.idempotencyKey === data.idempotencyKey)
      if (existing) return jobRunDto(hydrate(existing))
      const now = new Date()
      const row = { ...data, status: 'queued', inputSchemaVersion: 1, result: null, resultSchemaVersion: 1, errorCode: null, startedAt: null, heartbeatAt: null, timeoutAt: null, cancelRequestedAt: null, completedAt: null, createdAt: now, updatedAt: now }
      runs.set(row.id, row)
      return jobRunDto(hydrate(row))
    },
    async find(id) { return jobRunDto(hydrate(runs.get(String(id)) ?? null)) },
    async list(options = {}) {
      const limit = Math.min(Math.max(Number(options.limit ?? 20), 1), 100)
      let values = [...runs.values()].filter((item) => !options.status || item.status === options.status).filter((item) => !options.definitionId || item.definitionId === options.definitionId).filter((item) => !options.ownerId || item.ownerId === options.ownerId).sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
      if (options.cursor) values = values.slice(Math.max(values.findIndex((item) => item.id === String(options.cursor)) + 1, 0))
      const page = values.slice(0, limit)
      return { items: page.map((item) => jobRunDto(hydrate(item))), limit, nextCursor: values.length > limit ? page.at(-1)?.id ?? null : null }
    },
    async claim({ workerId, definitionId = null } = {}) {
      const now = new Date()
      const run = [...runs.values()].filter((item) => ['queued', 'retry_scheduled'].includes(item.status) && item.scheduledAt <= now && !item.cancelRequestedAt && (!definitionId || item.definitionId === definitionId) && definitions.get(item.definitionId)?.enabled && !definitions.get(item.definitionId)?.pausedAt).sort((a, b) => b.priority - a.priority || a.scheduledAt - b.scheduledAt)[0]
      if (!run) return null
      const definition = definitions.get(run.definitionId)
      const leaseToken = randomUUID()
      Object.assign(run, { status: 'running', startedAt: now, heartbeatAt: now, timeoutAt: new Date(now.getTime() + definition.defaultTimeoutSeconds * 1000), updatedAt: now })
      const attemptNumber = [...attempts.values()].filter((item) => item.runId === run.id).length + 1
      attempts.set(leaseToken, { id: `attempt-${randomUUID()}`, runId: run.id, attemptNumber, status: 'running', workerId: String(workerId), leaseToken, heartbeatAt: now, timeoutAt: run.timeoutAt, result: null, resultSchemaVersion: 1, errorCode: null, startedAt: now, completedAt: null, createdAt: now, updatedAt: now })
      return { ...jobRunDto(hydrate(run)), leaseToken }
    },
    async heartbeat(id, leaseToken, timeoutSeconds = 300) {
      const run = runs.get(String(id)); const attempt = attempts.get(String(leaseToken)); const now = new Date()
      if (!run || !attempt || attempt.runId !== run.id || attempt.status !== 'running' || attempt.timeoutAt <= now) return false
      const timeoutAt = new Date(now.getTime() + Math.max(1, Number(timeoutSeconds)) * 1000)
      Object.assign(attempt, { heartbeatAt: now, timeoutAt, updatedAt: now }); Object.assign(run, { heartbeatAt: now, timeoutAt, updatedAt: now }); return true
    },
    async complete(id, leaseToken, result = null) { return finish(id, leaseToken, 'succeeded', null, result) },
    async fail(id, leaseToken, errorCode) {
      const run = runs.get(String(id)); const attempt = attempts.get(String(leaseToken)); const now = new Date()
      if (!run || !attempt || attempt.runId !== run.id || attempt.status !== 'running') return null
      const definition = definitions.get(run.definitionId)
      const code = String(errorCode ?? 'JOB_FAILED').slice(0, 120)
      Object.assign(attempt, { status: 'failed', errorCode: code, completedAt: now, updatedAt: now })
      if (attempt.attemptNumber < Number(definition?.maxAttempts ?? 1)) Object.assign(run, { status: 'retry_scheduled', errorCode: code, scheduledAt: new Date(now.getTime() + Number(definition?.retryBackoffSeconds ?? 60) * 1000), updatedAt: now })
      else Object.assign(run, { status: 'dead_lettered', errorCode: code, completedAt: now, updatedAt: now })
      return jobRunDto(hydrate(run))
    },
    async retryDeadLetter(id, actor, options = {}) {
      const run = runs.get(String(id)); if (!run) return null
      if (run.status !== 'dead_lettered') return repository.find(id)
      const now = new Date(); Object.assign(run, { status: 'retry_scheduled', scheduledAt: now, completedAt: null, cancelRequestedAt: null, updatedAt: now })
      await recordAudit({ actor, action: 'job.retry_requested', resourceType: 'job_run', resourceId: run.id, metadata: { reasonCode: options.reasonCode ?? 'job_retry' } })
      return repository.find(id)
    },
    async rerun(id, actor, options = {}) {
      const run = runs.get(String(id)); if (!run) return null
      const idempotencyKey = String(options.idempotencyKey ?? `rerun:${run.id}:${options.reasonCode ?? 'manual'}`)
      const copy = await repository.enqueue({ definitionId: run.definitionId, idempotencyKey, correlationId: `rerun:${run.correlationId}`, input: run.input, ownerId: run.ownerId, requestedById: actor?.id, priority: run.priority })
      if (copy) await recordAudit({ actor, action: 'job.rerun_requested', resourceType: 'job_run', resourceId: run.id, metadata: { newRunId: copy.id, reasonCode: options.reasonCode ?? 'manual_rerun' } })
      return copy
    },
    async pauseDefinition(id, actor, options = {}) {
      const definition = definitions.get(String(id)); if (!definition) return null
      const now = new Date(); definition.pausedAt = definition.pausedAt ?? now; definition.updatedAt = now
      await recordAudit({ actor, action: 'job.definition_paused', resourceType: 'job_definition', resourceId: definition.id, metadata: { reasonCode: options.reasonCode ?? 'admin_pause' } })
      return jobDefinitionDto(definition)
    },
    async resumeDefinition(id, actor, options = {}) {
      const definition = definitions.get(String(id)); if (!definition) return null
      const now = new Date(); definition.pausedAt = null; definition.updatedAt = now
      await recordAudit({ actor, action: 'job.definition_resumed', resourceType: 'job_definition', resourceId: definition.id, metadata: { reasonCode: options.reasonCode ?? 'admin_resume' } })
      return jobDefinitionDto(definition)
    },
    async enqueueDueCron(now = new Date()) {
      const created = []
      for (const definition of [...definitions.values()].filter((item) => item.enabled && !item.pausedAt && item.cronSchedule)) {
        const slot = new Date(now); slot.setSeconds(0, 0)
        const run = await repository.enqueue({ definitionId: definition.id, idempotencyKey: `cron:${definition.id}:${slot.toISOString()}`, correlationId: `cron:${definition.id}:${slot.toISOString()}`, input: { trigger: 'cron', schedule: definition.cronSchedule, slot: slot.toISOString() } })
        if (run) created.push(run)
      }
      return created
    },
    async requestCancel(id, actor, options = {}) {
      const run = runs.get(String(id)); if (!run) return null
      if (['succeeded', 'failed', 'timed_out', 'cancelled'].includes(run.status)) return repository.find(id)
      const previousStatus = run.status
      const now = new Date(); run.cancelRequestedAt = now; run.updatedAt = now
      if (run.status === 'queued') Object.assign(run, { status: 'cancelled', completedAt: now })
      await recordAudit({ actor, action: 'job.cancel_requested', resourceType: 'job_run', resourceId: run.id, metadata: { previousStatus, reasonCode: options.reasonCode ?? 'admin_cancel' } })
      return repository.find(id)
    },
    async cancelRunning(id, leaseToken) { return finish(id, leaseToken, 'cancelled', null, null, true) },
    async sweepTimeouts(limit = 100) {
      const now = new Date(); const timedOut = []
      for (const run of [...runs.values()].filter((item) => item.status === 'running' && item.timeoutAt <= now).slice(0, limit)) {
        const attempt = [...attempts.values()].find((item) => item.runId === run.id && item.status === 'running')
        if (attempt) Object.assign(attempt, { status: 'timed_out', errorCode: 'JOB_TIMEOUT', completedAt: now, updatedAt: now })
        Object.assign(run, { status: 'timed_out', errorCode: 'JOB_TIMEOUT', completedAt: now, updatedAt: now }); timedOut.push(run.id)
      }
      return timedOut
    },
  }
  const finish = async (id, leaseToken, status, errorCode, result, requireCancel = false) => {
    const run = runs.get(String(id)); const attempt = attempts.get(String(leaseToken)); const now = new Date()
    if (!run || !attempt || attempt.runId !== run.id || attempt.status !== 'running' || (requireCancel && !run.cancelRequestedAt)) return null
    const safeResult = sanitizeJobData(result)
    Object.assign(attempt, { status, errorCode, result: safeResult, completedAt: now, updatedAt: now })
    Object.assign(run, { status, errorCode, result: safeResult, completedAt: now, heartbeatAt: now, updatedAt: now })
    return jobRunDto(hydrate(run))
  }
  return repository
}
