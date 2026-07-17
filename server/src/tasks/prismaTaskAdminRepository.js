import { HttpError } from '../common/errors/httpError.js'
import prismaClientPkg from '@prisma/client'
import {
  buildTaskAdminBulkPreview,
  hashTaskAdminTargets,
  isTaskAdminBulkEligible,
  normalizeTaskAdminStatus,
  taskAdminArchiveEligibleStatuses,
  taskAdminConfirmationText,
  taskAdminEditableStatuses,
  taskAdminTransitionTarget,
} from './taskAdminContract.js'

const { Prisma } = prismaClientPkg

const includeTaskAdminRelations = {
  publisher: { include: { profile: true } },
  assignee: { include: { profile: true } },
  archivedBy: { include: { profile: true } },
  _count: { select: { proposals: true, submissions: true } },
}

const handleOf = (user) => user?.profile?.handle ?? user?.id ?? null
const iso = (value) => value?.toISOString?.() ?? null
const asObject = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {}

const serialize = (row) => ({
  id: String(row.id),
  title: row.title,
  category: row.category,
  description: row.description,
  acceptanceRules: row.acceptanceRules,
  rewardAmount: row.rewardAmount == null ? null : String(row.rewardAmount),
  rewardCurrency: row.rewardCurrency,
  pointsReward: row.pointsReward,
  status: normalizeTaskAdminStatus(row.status),
  visibility: row.visibility,
  deadlineAt: iso(row.deadlineAt),
  publisherHandle: handleOf(row.publisher),
  assigneeHandle: handleOf(row.assignee),
  proposalCount: row._count?.proposals ?? 0,
  submissionCount: row._count?.submissions ?? 0,
  version: row.version,
  archivedAt: iso(row.archivedAt),
  archivedByHandle: handleOf(row.archivedBy),
  archiveReasonCode: row.archiveReasonCode,
  archiveNote: row.archiveNote,
  cancelledAt: iso(row.cancelledAt),
  expiredAt: iso(row.expiredAt),
  terminalReasonCode: row.terminalReasonCode,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
})

const buildWhere = (options = {}) => ({
  ...(options.archiveState === 'archived' ? { archivedAt: { not: null } } : options.archiveState === 'all' ? {} : { archivedAt: null }),
  ...(options.status ? { status: options.status } : {}),
  ...(options.category ? { category: options.category } : {}),
  ...(options.publisherHandle ? { publisher: { profile: { handle: options.publisherHandle } } } : {}),
  ...(options.assigneeHandle ? { assignee: { profile: { handle: options.assigneeHandle } } } : {}),
  ...(options.search ? {
    OR: [
      { id: { contains: options.search, mode: 'insensitive' } },
      { title: { contains: options.search, mode: 'insensitive' } },
      { description: { contains: options.search, mode: 'insensitive' } },
      { category: { contains: options.search, mode: 'insensitive' } },
    ],
  } : {}),
})

const orderByFor = (options = {}) => {
  const direction = options.direction ?? 'desc'
  const field = options.sort ?? 'updatedAt'
  return [{ [field]: direction }, { id: direction }]
}

const assertVersion = (row, expectedVersion) => {
  if (row.version !== expectedVersion) {
    throw new HttpError(409, 'TASK_VERSION_CONFLICT', 'Task changed since it was loaded')
  }
}

const publicMetadataPatch = (row, patch) => ({
  ...asObject(row.metadata),
  ...(patch.title !== undefined ? { title: patch.title } : {}),
  ...(patch.category !== undefined ? { category: patch.category } : {}),
  ...(patch.description !== undefined ? { description: patch.description } : {}),
  ...(patch.acceptanceRules !== undefined ? { requirements: [patch.acceptanceRules] } : {}),
  ...(patch.deadlineAt !== undefined ? { deadline: patch.deadlineAt } : {}),
})

export const createPrismaTaskAdminRepository = (client, {
  runSerializableTransaction,
  recordAudit,
  createTaskEscrow,
  finalizeTaskEscrow,
}) => ({
  list: async (options = {}) => {
    const cursor = options.cursor
      ? await client.task.findUnique({ where: { id: String(options.cursor) }, select: { id: true } })
      : null
    const rows = await client.task.findMany({
      where: buildWhere(options),
      include: includeTaskAdminRelations,
      orderBy: orderByFor(options),
      take: (options.limit ?? 20) + 1,
      ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
    })
    const page = rows.slice(0, options.limit ?? 20)
    return {
      items: page.map(serialize),
      limit: options.limit ?? 20,
      nextCursor: rows.length > (options.limit ?? 20) ? page.at(-1)?.id ?? null : null,
    }
  },

  summary: async (options = {}) => {
    const baseWhere = buildWhere({ ...options, archiveState: 'all' })
    const [total, active, archived, statusGroups] = await Promise.all([
      client.task.count({ where: baseWhere }),
      client.task.count({ where: { ...baseWhere, archivedAt: null } }),
      client.task.count({ where: { ...baseWhere, archivedAt: { not: null } } }),
      client.task.groupBy({ by: ['status'], where: baseWhere, _count: { _all: true } }),
    ])
    const byStatus = {}
    for (const group of statusGroups) {
      byStatus[normalizeTaskAdminStatus(group.status)] = group._count._all
    }
    return { total, active, archived, byStatus }
  },

  businessMetrics: async (options = {}) => {
    const conditions = [Prisma.sql`TRUE`]
    if (options.dateFrom) conditions.push(Prisma.sql`t."created_at" >= ${new Date(options.dateFrom)}`)
    if (options.dateTo) conditions.push(Prisma.sql`t."created_at" <= ${new Date(options.dateTo)}`)
    if (options.category) conditions.push(Prisma.sql`LOWER(t."category") = LOWER(${options.category})`)
    const where = Prisma.join(conditions, ' AND ')
    const [row = {}] = await client.$queryRaw(Prisma.sql`
      WITH scoped_tasks AS (
        SELECT t.* FROM "tasks" t WHERE ${where}
      ), dispute_times AS (
        SELECT st."id",
          MIN(opened."created_at") AS "opened_at",
          MIN(resolved."created_at") AS "resolved_at"
        FROM scoped_tasks st
        LEFT JOIN "audit_events" opened ON opened."resource_type" = 'task' AND opened."resource_id" = st."id" AND opened."action" = 'task.dispute.opened'
        LEFT JOIN "audit_events" resolved ON resolved."resource_type" = 'task' AND resolved."resource_id" = st."id" AND resolved."action" = 'task.dispute.resolved'
        GROUP BY st."id"
      )
      SELECT
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "task_proposals" p WHERE p."task_id" = st."id"))::int AS "with_proposals",
        COUNT(*) FILTER (WHERE st."assignee_id" IS NOT NULL)::int AS "assigned",
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "task_submissions" s WHERE s."task_id" = st."id"))::int AS "with_submissions",
        COUNT(*) FILTER (WHERE st."status" = 'completed')::int AS "completed",
        COUNT(*) FILTER (WHERE st."status" = 'expired')::int AS "expired",
        COUNT(*) FILTER (WHERE st."status" = 'cancelled')::int AS "cancelled",
        COUNT(*) FILTER (WHERE st."deadline_at" IS NOT NULL)::int AS "deadline_configured",
        COUNT(*) FILTER (WHERE st."deadline_at" < CURRENT_TIMESTAMP AND st."status" IN ('open', 'assigned', 'in_progress', 'rejected'))::int AS "overdue_active",
        COUNT(*) FILTER (WHERE dt."opened_at" IS NOT NULL)::int AS "disputes_opened",
        COUNT(*) FILTER (WHERE dt."resolved_at" IS NOT NULL)::int AS "disputes_resolved",
        AVG(EXTRACT(EPOCH FROM (dt."resolved_at" - dt."opened_at")) / 3600.0) FILTER (WHERE dt."opened_at" IS NOT NULL AND dt."resolved_at" IS NOT NULL) AS "average_dispute_resolution_hours"
      FROM scoped_tasks st
      LEFT JOIN dispute_times dt ON dt."id" = st."id"
    `)
    const total = Number(row.total ?? 0)
    const percentage = (value, denominator = total) => denominator > 0 ? Number((Number(value ?? 0) / denominator * 100).toFixed(2)) : 0
    return {
      window: { dateFrom: options.dateFrom ?? null, dateTo: options.dateTo ?? null, category: options.category ?? null },
      funnel: {
        published: total,
        withProposals: Number(row.with_proposals ?? 0),
        assigned: Number(row.assigned ?? 0),
        withSubmissions: Number(row.with_submissions ?? 0),
        completed: Number(row.completed ?? 0),
        proposalConversionPercent: percentage(row.with_proposals),
        assignmentConversionPercent: percentage(row.assigned),
        completionConversionPercent: percentage(row.completed),
      },
      deadlines: {
        configured: Number(row.deadline_configured ?? 0), overdueActive: Number(row.overdue_active ?? 0),
        expired: Number(row.expired ?? 0), cancelled: Number(row.cancelled ?? 0),
        overduePercent: percentage(row.overdue_active, Number(row.deadline_configured ?? 0)),
      },
      disputes: {
        opened: Number(row.disputes_opened ?? 0), resolved: Number(row.disputes_resolved ?? 0),
        resolutionPercent: percentage(row.disputes_resolved, Number(row.disputes_opened ?? 0)),
        averageResolutionHours: row.average_dispute_resolution_hours == null ? null : Number(Number(row.average_dispute_resolution_hours).toFixed(2)),
      },
    }
  },

  find: async (id) => {
    const row = await client.task.findUnique({ where: { id: String(id) }, include: includeTaskAdminRelations })
    return row ? serialize(row) : null
  },

  update: async (id, payload, actor) => runSerializableTransaction(async (db) => {
    const row = await db.task.findUnique({ where: { id: String(id) }, include: includeTaskAdminRelations })
    if (!row) return null
    assertVersion(row, payload.expectedVersion)
    if (row.archivedAt) throw new HttpError(409, 'TASK_ARCHIVED', 'Archived tasks must be restored before editing')
    if (!taskAdminEditableStatuses.includes(normalizeTaskAdminStatus(row.status))) {
      throw new HttpError(409, 'TASK_EDIT_NOT_ALLOWED', 'Task fields cannot be edited after fulfillment starts')
    }
    const data = {
      ...payload.patch,
      ...(payload.patch.deadlineAt !== undefined ? { deadlineAt: payload.patch.deadlineAt ? new Date(payload.patch.deadlineAt) : null } : {}),
      metadata: publicMetadataPatch(row, payload.patch),
      version: { increment: 1 },
    }
    const updated = await db.task.updateMany({ where: { id: row.id, version: payload.expectedVersion, archivedAt: null }, data })
    if (updated.count !== 1) throw new HttpError(409, 'TASK_VERSION_CONFLICT', 'Task changed concurrently')
    await recordAudit({ actor, action: 'task.admin.updated', resourceType: 'task', resourceId: row.id, metadata: { reasonCode: payload.reasonCode, note: payload.note, expectedVersion: payload.expectedVersion, changedFields: Object.keys(payload.patch) } }, db)
    const result = await db.task.findUnique({ where: { id: row.id }, include: includeTaskAdminRelations })
    return serialize(result)
  }),

  archive: async (id, payload, actor) => runSerializableTransaction(async (db) => {
    const row = await db.task.findUnique({ where: { id: String(id) }, include: includeTaskAdminRelations })
    if (!row) return null
    assertVersion(row, payload.expectedVersion)
    if (row.archivedAt) return serialize(row)
    if (!taskAdminArchiveEligibleStatuses.includes(normalizeTaskAdminStatus(row.status))) {
      throw new HttpError(409, 'TASK_ARCHIVE_NOT_ALLOWED', 'Active fulfillment tasks cannot be archived')
    }
    const updated = await db.task.updateMany({
      where: { id: row.id, version: payload.expectedVersion, archivedAt: null },
      data: { archivedAt: new Date(), archivedById: actor.id, archiveReasonCode: payload.reasonCode, archiveNote: payload.note, version: { increment: 1 } },
    })
    if (updated.count !== 1) throw new HttpError(409, 'TASK_VERSION_CONFLICT', 'Task changed concurrently')
    await recordAudit({ actor, action: 'task.admin.archived', resourceType: 'task', resourceId: row.id, metadata: { reasonCode: payload.reasonCode, note: payload.note, previousStatus: normalizeTaskAdminStatus(row.status), expectedVersion: payload.expectedVersion } }, db)
    return serialize(await db.task.findUnique({ where: { id: row.id }, include: includeTaskAdminRelations }))
  }),

  restore: async (id, payload, actor) => runSerializableTransaction(async (db) => {
    const row = await db.task.findUnique({ where: { id: String(id) }, include: includeTaskAdminRelations })
    if (!row) return null
    assertVersion(row, payload.expectedVersion)
    if (!row.archivedAt) return serialize(row)
    const updated = await db.task.updateMany({
      where: { id: row.id, version: payload.expectedVersion, archivedAt: { not: null } },
      data: { archivedAt: null, archivedById: null, archiveReasonCode: null, archiveNote: null, version: { increment: 1 } },
    })
    if (updated.count !== 1) throw new HttpError(409, 'TASK_VERSION_CONFLICT', 'Task changed concurrently')
    await recordAudit({ actor, action: 'task.admin.restored', resourceType: 'task', resourceId: row.id, metadata: { reasonCode: payload.reasonCode, note: payload.note, expectedVersion: payload.expectedVersion } }, db)
    return serialize(await db.task.findUnique({ where: { id: row.id }, include: includeTaskAdminRelations }))
  }),

  transition: async (id, payload, actor) => runSerializableTransaction(async (db) => {
    const row = await db.task.findUnique({ where: { id: String(id) }, include: includeTaskAdminRelations })
    if (!row) return null
    assertVersion(row, payload.expectedVersion)
    if (row.archivedAt) throw new HttpError(409, 'TASK_ARCHIVED', 'Archived tasks cannot change status')
    const target = taskAdminTransitionTarget(row.status, payload.action)
    if (!target) throw new HttpError(409, 'TASK_ADMIN_TRANSITION_INVALID', `Cannot ${payload.action} a ${normalizeTaskAdminStatus(row.status)} task`)
    const updated = await db.task.updateMany({
      where: { id: row.id, version: payload.expectedVersion, archivedAt: null, status: row.status },
      data: { status: target, metadata: { ...asObject(row.metadata), status: target === 'open' ? 'Open' : 'Cancelled' }, ...(target === 'cancelled' ? { cancelledAt: new Date(), terminalReasonCode: payload.reasonCode } : {}), version: { increment: 1 } },
    })
    if (updated.count !== 1) throw new HttpError(409, 'TASK_VERSION_CONFLICT', 'Task changed concurrently')
    if (payload.action === 'cancel') await finalizeTaskEscrow(db, row, row.publisherId, 'reject', actor, 'task_admin_cancelled')
    if (payload.action === 'publish') await createTaskEscrow(db, row, row.publisherId, actor)
    await recordAudit({ actor, action: `task.admin.${payload.action}`, resourceType: 'task', resourceId: row.id, metadata: { reasonCode: payload.reasonCode, note: payload.note, previousStatus: normalizeTaskAdminStatus(row.status), nextStatus: target, expectedVersion: payload.expectedVersion } }, db)
    return serialize(await db.task.findUnique({ where: { id: row.id }, include: includeTaskAdminRelations }))
  }),

  previewBulk: async ({ action, targetIds }) => {
    const rows = await client.task.findMany({ where: { id: { in: targetIds } }, select: { id: true, status: true, archivedAt: true, version: true } })
    return buildTaskAdminBulkPreview({ rows, action, targetIds })
  },

  executeBulk: async (payload, actor) => {
    const execute = async () => runSerializableTransaction(async (db) => {
      const existing = await db.taskAdminBulkAction.findUnique({ where: { idempotencyKey: payload.idempotencyKey } })
      if (existing) {
        if (existing.action !== payload.action || existing.targetHash !== payload.targetHash || existing.reasonCode !== payload.reasonCode || (existing.note ?? '') !== (payload.note ?? '')) {
          throw new HttpError(409, 'TASK_BULK_IDEMPOTENCY_CONFLICT', 'Idempotency key was already used for another request')
        }
        return existing.result
      }
      const rows = await db.task.findMany({ where: { id: { in: payload.targetIds } }, include: includeTaskAdminRelations })
      const preview = buildTaskAdminBulkPreview({ rows, action: payload.action, targetIds: payload.targetIds })
      if (preview.targetHash !== payload.targetHash || hashTaskAdminTargets(payload.targetIds) !== payload.targetHash) throw new HttpError(409, 'TASK_BULK_TARGETS_CHANGED', 'Bulk target hash does not match the preview')
      if (payload.confirmationText !== taskAdminConfirmationText(payload.action)) throw new HttpError(400, 'VALIDATION_FAILED', 'confirmationText does not match the required phrase')
      const byId = new Map(rows.map((row) => [String(row.id), row]))
      const items = []
      for (const previewItem of preview.items) {
        const row = byId.get(previewItem.id)
        if (!row || !isTaskAdminBulkEligible(row, payload.action)) {
          items.push({ id: previewItem.id, status: 'skipped', reason: row ? 'state_not_eligible' : 'not_found' })
          continue
        }
        const data = payload.action === 'archive'
          ? { archivedAt: new Date(), archivedById: actor.id, archiveReasonCode: payload.reasonCode, archiveNote: payload.note, version: { increment: 1 } }
          : { status: 'cancelled', cancelledAt: new Date(), terminalReasonCode: payload.reasonCode, metadata: { ...asObject(row.metadata), status: 'Cancelled' }, version: { increment: 1 } }
        const changed = await db.task.updateMany({ where: { id: row.id, version: row.version, archivedAt: null, status: row.status }, data })
        if (changed.count !== 1) {
          items.push({ id: row.id, status: 'skipped', reason: 'state_changed' })
          continue
        }
        if (payload.action === 'cancel') await finalizeTaskEscrow(db, row, row.publisherId, 'reject', actor, 'task_admin_cancelled')
        await recordAudit({ actor, action: payload.action === 'archive' ? 'task.admin.archived' : 'task.admin.cancel', resourceType: 'task', resourceId: row.id, metadata: { reasonCode: payload.reasonCode, note: payload.note, bulk: true, idempotencyKey: payload.idempotencyKey, previousStatus: normalizeTaskAdminStatus(row.status) } }, db)
        items.push({ id: row.id, status: 'succeeded', reason: null })
      }
      const result = { ...preview, status: 'completed', succeededCount: items.filter((item) => item.status === 'succeeded').length, skippedCount: items.filter((item) => item.status === 'skipped').length, items }
      await db.taskAdminBulkAction.create({ data: { idempotencyKey: payload.idempotencyKey, action: payload.action, targetHash: payload.targetHash, targetCount: preview.targetCount, eligibleCount: preview.eligibleCount, skippedCount: result.skippedCount, status: 'completed', reasonCode: payload.reasonCode, note: payload.note, requestedById: actor.id, result, completedAt: new Date() } })
      await recordAudit({ actor, action: 'task.admin.bulk.completed', resourceType: 'task_admin_bulk_action', resourceId: payload.idempotencyKey, metadata: { action: payload.action, targetHash: payload.targetHash, targetCount: preview.targetCount, succeededCount: result.succeededCount, skippedCount: result.skippedCount, reasonCode: payload.reasonCode } }, db)
      return result
    })
    try {
      return await execute()
    } catch (error) {
      if (error?.code !== 'P2002') throw error
      const existing = await client.taskAdminBulkAction.findUnique({ where: { idempotencyKey: payload.idempotencyKey } })
      if (!existing || existing.action !== payload.action || existing.targetHash !== payload.targetHash || existing.reasonCode !== payload.reasonCode || (existing.note ?? '') !== (payload.note ?? '')) throw new HttpError(409, 'TASK_BULK_IDEMPOTENCY_CONFLICT', 'Idempotency key was already used for another request')
      return existing.result
    }
  },
})
