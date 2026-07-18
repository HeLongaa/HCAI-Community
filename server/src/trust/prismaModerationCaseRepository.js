import { createHash, randomUUID } from 'node:crypto'
import { HttpError } from '../common/errors/httpError.js'
import { moderationAppealWindowMs, moderationCaseVersion, moderationSourceKey, serializeModerationCase } from './moderationCases.js'

const includeCase = {
  affectedUser: { include: { profile: true } },
  report: { include: { reporter: { include: { profile: true } } } },
  evidence: { include: { submittedBy: { include: { profile: true } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  decisions: { include: { reviewer: { include: { profile: true } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  appeals: { include: { appellant: { include: { profile: true } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
}

const targetModel = {
  user: 'user',
  post: 'post',
  comment: 'comment',
  media_asset: 'mediaAsset',
  creative_generation: 'creativeGeneration',
}

export const createPrismaModerationCaseRepository = (client, { recordAudit }) => {
  const resolveActor = (db, actor) => db.user.findFirst({ where: actor.id ? { id: actor.id } : { profile: { handle: actor.handle } }, include: { profile: true } })

  const resolveTarget = async (db, targetType, targetId) => {
    if (targetType === 'user') {
      const user = await db.user.findFirst({ where: { OR: [{ id: targetId }, { profile: { handle: targetId } }] }, include: { profile: true } })
      return user ? { affectedUserId: user.id, contentHash: createHash('sha256').update(`user:${user.id}:${user.accountVersion}`).digest('hex') } : null
    }
    const model = targetModel[targetType]
    if (!model) return null
    const row = await db[model].findUnique({ where: { id: targetId } })
    if (!row) return null
    const ownerId = row.authorId ?? row.userId ?? row.ownerId ?? null
    return { affectedUserId: ownerId, contentHash: createHash('sha256').update(`${targetType}:${targetId}:${row.updatedAt?.toISOString?.() ?? row.createdAt?.toISOString?.() ?? ''}`).digest('hex') }
  }

  const load = (db, id) => db.moderationCase.findUnique({ where: { id: String(id) }, include: includeCase })
  const assertVersion = (record, expectedVersion) => {
    if (moderationCaseVersion(record) !== expectedVersion) throw new HttpError(409, 'STATE_CONFLICT', 'Moderation case was modified concurrently')
  }

  return {
    createReport: async (payload, actor) => client.$transaction(async (transaction) => {
      const reporter = await resolveActor(transaction, actor)
      if (!reporter) throw new HttpError(404, 'USER_NOT_FOUND', 'Reporter not found')
      const target = await resolveTarget(transaction, payload.targetType, payload.targetId)
      if (!target) throw new HttpError(404, 'MODERATION_TARGET_NOT_FOUND', 'Moderation target not found')
      const sourceKey = moderationSourceKey({ actorId: reporter.id, ...payload })
      const duplicate = await transaction.report.findUnique({ where: { sourceKey }, include: { moderationCase: { include: includeCase } } })
      if (duplicate) {
        const record = duplicate.moderationCase
        if (record.targetType !== payload.targetType || record.targetId !== payload.targetId || duplicate.category !== payload.category) throw new HttpError(409, 'REPORT_SOURCE_CONFLICT', 'sourceKey already identifies another report')
        return { duplicate: true, item: serializeModerationCase(record, { includeStatement: true }) }
      }
      const caseId = `moderation-case-${randomUUID()}`
      const reportId = `report-${randomUUID()}`
      const row = await transaction.moderationCase.create({
        data: {
          id: caseId, targetType: payload.targetType, targetId: payload.targetId, affectedUserId: target.affectedUserId, priority: payload.priority,
          report: { create: { id: reportId, reporterId: reporter.id, category: payload.category, subject: payload.subject, statement: payload.statement, locale: payload.locale, sourceKey } },
          evidence: { create: { id: `evidence-${randomUUID()}`, submittedById: reporter.id, evidenceType: 'target_snapshot', referenceType: payload.targetType, referenceId: payload.targetId, contentHash: target.contentHash, reasonCode: 'report_submitted' } },
        },
        include: includeCase,
      })
      await recordAudit({ actor: reporter, action: 'trust.report.created', resourceType: 'moderation_case', resourceId: row.id, metadata: { reportId, targetType: payload.targetType, category: payload.category, priority: payload.priority } }, transaction)
      return { duplicate: false, item: serializeModerationCase(row, { includeStatement: true }) }
    }, { isolationLevel: 'Serializable' }),
    findForUser: async (id, actor) => {
      const user = await resolveActor(client, actor)
      if (!user) return null
      const row = await client.moderationCase.findFirst({ where: { id: String(id), OR: [{ affectedUserId: user.id }, { report: { reporterId: user.id } }] }, include: includeCase })
      return row ? serializeModerationCase(row, { includeStatement: true }) : null
    },
    listForUser: async (actor, query) => {
      const user = await resolveActor(client, actor)
      if (!user) return { items: [], nextCursor: null, limit: query.limit }
      const rows = await client.moderationCase.findMany({ where: { OR: [{ affectedUserId: user.id }, { report: { reporterId: user.id } }], ...(query.targetType ? { targetType: query.targetType } : {}), ...(query.category ? { report: { category: query.category } } : {}), ...(query.priority ? { priority: query.priority } : {}) }, include: includeCase, orderBy: query.sort === 'priority' ? [{ priority: query.order }, { createdAt: 'desc' }, { id: 'desc' }] : [{ createdAt: query.order }, { id: query.order }], take: 201 })
      const filtered = rows.filter((row) => !query.status || serializeModerationCase(row).status === query.status)
      const start = query.cursor ? Math.max(0, filtered.findIndex((row) => row.id === query.cursor) + 1) : 0
      const page = filtered.slice(start, start + query.limit)
      return { items: page.map((row) => serializeModerationCase(row)), nextCursor: filtered.length > start + query.limit ? page.at(-1)?.id ?? null : null, limit: query.limit }
    },
    appeal: async (id, payload, actor) => client.$transaction(async (transaction) => {
      const appellant = await resolveActor(transaction, actor)
      const record = await load(transaction, id)
      if (!record) return null
      if (record.affectedUserId !== appellant?.id) throw new HttpError(403, 'MODERATION_APPEAL_FORBIDDEN', 'Only the affected account may appeal this decision')
      assertVersion(record, payload.expectedVersion)
      const original = record.decisions.find((item) => item.stage === 'original')
      if (!original) throw new HttpError(409, 'MODERATION_DECISION_REQUIRED', 'An original decision is required before appeal')
      if (record.appeals.length) throw new HttpError(409, 'MODERATION_APPEAL_EXISTS', 'This decision already has an appeal')
      if (Date.now() > new Date(original.createdAt).getTime() + moderationAppealWindowMs) throw new HttpError(409, 'MODERATION_APPEAL_WINDOW_CLOSED', 'The appeal window has closed')
      const appeal = await transaction.moderationAppeal.create({ data: { id: `appeal-${randomUUID()}`, caseId: record.id, decisionId: original.id, appellantId: appellant.id, reasonCode: payload.reasonCode, statement: payload.statement } })
      await recordAudit({ actor: appellant, action: 'trust.appeal.created', resourceType: 'moderation_appeal', resourceId: appeal.id, metadata: { caseId: record.id, decisionId: original.id, reasonCode: appeal.reasonCode } }, transaction)
      return serializeModerationCase(await load(transaction, id), { includeStatement: true })
    }, { isolationLevel: 'Serializable' }),
    addEvidence: async (id, payload, actor) => client.$transaction(async (transaction) => {
      const submitter = await resolveActor(transaction, actor)
      if (!await transaction.moderationCase.findUnique({ where: { id: String(id) }, select: { id: true } })) return null
      const existing = await transaction.moderationEvidence.findFirst({ where: { caseId: String(id), evidenceType: payload.evidenceType, referenceType: payload.referenceType, referenceId: payload.referenceId, contentHash: payload.contentHash } })
      if (!existing) {
        await transaction.moderationEvidence.create({ data: { id: `evidence-${randomUUID()}`, caseId: String(id), submittedById: submitter?.id ?? null, ...payload } })
        await recordAudit({ actor: submitter, action: 'trust.evidence.created', resourceType: 'moderation_case', resourceId: String(id), metadata: { evidenceType: payload.evidenceType, referenceType: payload.referenceType, reasonCode: payload.reasonCode } }, transaction)
      }
      return { duplicate: Boolean(existing), item: serializeModerationCase(await load(transaction, id), { includeStatement: true }) }
    }, { isolationLevel: 'Serializable' }),
    decide: async (id, payload, actor) => client.$transaction(async (transaction) => {
      const reviewer = await resolveActor(transaction, actor)
      const record = await load(transaction, id)
      if (!record || !reviewer) return null
      assertVersion(record, payload.expectedVersion)
      const original = record.decisions.find((item) => item.stage === 'original')
      const appeal = record.appeals[0] ?? null
      if (payload.stage === 'original' && original) throw new HttpError(409, 'MODERATION_DECISION_EXISTS', 'Original decision already exists')
      if (payload.stage === 'appeal') {
        if (!appeal) throw new HttpError(409, 'MODERATION_APPEAL_REQUIRED', 'An appeal is required for appeal review')
        if (record.decisions.some((item) => item.stage === 'appeal')) throw new HttpError(409, 'MODERATION_DECISION_EXISTS', 'Appeal decision already exists')
        if (original.reviewerId === reviewer.id) throw new HttpError(409, 'INDEPENDENT_REVIEW_REQUIRED', 'Appeal reviewer must differ from the original reviewer')
      }
      const decision = await transaction.moderationDecision.create({ data: { id: `decision-${randomUUID()}`, caseId: record.id, appealId: payload.stage === 'appeal' ? appeal.id : null, reviewerId: reviewer.id, stage: payload.stage, outcome: payload.outcome, reasonCode: payload.reasonCode, note: payload.note } })
      await recordAudit({ actor: reviewer, action: 'trust.decision.created', resourceType: 'moderation_decision', resourceId: decision.id, metadata: { caseId: record.id, stage: decision.stage, outcome: decision.outcome, reasonCode: decision.reasonCode } }, transaction)
      return serializeModerationCase(await load(transaction, id), { includeStatement: true })
    }, { isolationLevel: 'Serializable' }),
    findAdmin: async (id) => {
      const row = await load(client, id)
      return row ? serializeModerationCase(row, { includeStatement: true }) : null
    },
    listAdmin: async (query) => {
      const rows = await client.moderationCase.findMany({ where: { ...(query.targetType ? { targetType: query.targetType } : {}), ...(query.priority ? { priority: query.priority } : {}), ...(query.category ? { report: { category: query.category } } : {}), ...(query.search ? { OR: [{ id: { contains: query.search, mode: 'insensitive' } }, { targetId: { contains: query.search, mode: 'insensitive' } }, { report: { subject: { contains: query.search, mode: 'insensitive' } } }] } : {}) }, include: includeCase, orderBy: query.sort === 'priority' ? [{ priority: query.order }, { createdAt: 'desc' }, { id: 'desc' }] : [{ createdAt: query.order }, { id: query.order }], take: 501 })
      const filtered = rows.filter((row) => !query.status || serializeModerationCase(row).status === query.status)
      const start = query.cursor ? Math.max(0, filtered.findIndex((row) => row.id === query.cursor) + 1) : 0
      const page = filtered.slice(start, start + query.limit)
      return { items: page.map((row) => serializeModerationCase(row)), nextCursor: filtered.length > start + query.limit ? page.at(-1)?.id ?? null : null, limit: query.limit }
    },
    metrics: async () => {
      const rows = await client.moderationCase.findMany({ include: includeCase, take: 1001 })
      const dto = rows.map((row) => serializeModerationCase(row))
      const count = (value) => dto.filter((row) => row.status === value).length
      return { total: dto.length, open: count('open'), resolved: count('resolved'), appealed: count('appealed'), closed: count('closed'), critical: dto.filter((row) => row.priority === 'critical').length }
    },
    export: async (query) => ({
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      items: (await client.moderationCase.findMany({
        where: { ...(query.targetType ? { targetType: query.targetType } : {}), ...(query.priority ? { priority: query.priority } : {}), ...(query.category ? { report: { category: query.category } } : {}), ...(query.search ? { OR: [{ id: { contains: query.search, mode: 'insensitive' } }, { targetId: { contains: query.search, mode: 'insensitive' } }, { report: { subject: { contains: query.search, mode: 'insensitive' } } }] } : {}) },
        include: includeCase,
        orderBy: query.sort === 'priority' ? [{ priority: query.order }, { createdAt: 'desc' }, { id: 'desc' }] : [{ createdAt: query.order }, { id: query.order }],
        take: 1000,
      })).map((row) => serializeModerationCase(row)).filter((row) => !query.status || row.status === query.status),
    }),
  }
}
