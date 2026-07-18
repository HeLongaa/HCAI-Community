import { HttpError } from '../common/errors/httpError.js'
import { buildCommunityBulkPreview, communityConfirmationText, hashCommunityTargets, isCommunityBulkEligible } from './communityAdminContract.js'

const iso = (value) => value?.toISOString?.() ?? null
const handleOf = (row) => row?.author?.profile?.handle ?? row?.authorId ?? null
const postInclude = { author: { include: { profile: true } }, _count: { select: { comments: { where: { deletedAt: null } } } } }
const commentInclude = { author: { include: { profile: true } } }
const serializePost = (row) => ({ id: row.id, targetType: 'post', title: row.title, body: row.body, category: row.category, tag: row.tag, solved: row.solved, status: row.status, moderationState: row.moderationState, authorHandle: handleOf(row), commentCount: row._count?.comments ?? 0, likesCount: row.likesCount, viewsCount: row.viewsCount, version: row.version, deletedAt: iso(row.deletedAt), deletionReasonCode: row.deletionReasonCode, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) })
const serializeComment = (row) => ({ id: row.id, targetType: 'comment', postId: row.postId, parentId: row.parentId, body: row.body, moderationState: row.moderationState, authorHandle: handleOf(row), version: row.version, deletedAt: iso(row.deletedAt), deletionReasonCode: row.deletionReasonCode, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) })
const serialize = (type, row) => type === 'post' ? serializePost(row) : serializeComment(row)
const modelFor = (db, type) => type === 'post' ? db.post : db.comment
const includeFor = (type) => type === 'post' ? postInclude : commentInclude
const whereFor = (query) => ({
  ...(query.targetType === 'post' ? { ...(query.status ? { status: query.status } : {}), ...(query.category ? { category: query.category } : {}) } : { ...(query.postId ? { postId: query.postId } : {}) }),
  ...(query.deletionState === 'active' ? (query.targetType === 'post' ? { status: { not: 'deleted' } } : { deletedAt: null }) : query.deletionState === 'deleted' ? (query.targetType === 'post' ? { status: 'deleted' } : { deletedAt: { not: null } }) : {}),
  ...(query.moderationState ? { moderationState: query.moderationState } : {}),
  ...(query.authorHandle ? { author: { profile: { handle: query.authorHandle } } } : {}),
  ...(query.dateFrom || query.dateTo ? { createdAt: { ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}), ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}) } } : {}),
  ...(query.search ? { OR: query.targetType === 'post' ? [{ id: { contains: query.search, mode: 'insensitive' } }, { title: { contains: query.search, mode: 'insensitive' } }, { body: { contains: query.search, mode: 'insensitive' } }] : [{ id: { contains: query.search, mode: 'insensitive' } }, { body: { contains: query.search, mode: 'insensitive' } }] } : {}),
})

export const createPrismaCommunityAdminRepository = (client, { runSerializableTransaction, recordAudit }) => {
  const mutate = (targetType, id, payload, actor, kind) => runSerializableTransaction(async (db) => {
    const model = modelFor(db, targetType)
    const row = await model.findUnique({ where: { id: String(id) }, include: includeFor(targetType) })
    if (!row) return null
    if (row.version !== payload.expectedVersion) throw new HttpError(409, 'COMMUNITY_VERSION_CONFLICT', 'Community content changed since it was loaded')
    const data = kind === 'update' ? { ...payload.patch, version: { increment: 1 } }
      : targetType === 'post' ? (kind === 'delete' ? { status: 'deleted', deletedAt: new Date(), deletionReasonCode: payload.reasonCode, version: { increment: 1 } } : { status: 'published', deletedAt: null, deletionReasonCode: null, version: { increment: 1 } })
        : (kind === 'delete' ? { deletedAt: new Date(), deletionReasonCode: payload.reasonCode, version: { increment: 1 } } : { deletedAt: null, deletionReasonCode: null, version: { increment: 1 } })
    const changed = await model.updateMany({ where: { id: row.id, version: payload.expectedVersion }, data })
    if (changed.count !== 1) throw new HttpError(409, 'COMMUNITY_VERSION_CONFLICT', 'Community content changed concurrently')
    await recordAudit({ actor, action: `community.admin.${targetType}.${kind === 'update' ? 'updated' : kind === 'delete' ? 'deleted' : 'restored'}`, resourceType: targetType, resourceId: row.id, metadata: { reasonCode: payload.reasonCode, note: payload.note, expectedVersion: payload.expectedVersion, ...(kind === 'update' ? { changedFields: Object.keys(payload.patch) } : {}) } }, db)
    return serialize(targetType, await model.findUnique({ where: { id: row.id }, include: includeFor(targetType) }))
  })
  return {
    list: async (query) => {
      const model = modelFor(client, query.targetType)
      const rows = await model.findMany({ where: whereFor(query), include: includeFor(query.targetType), orderBy: [{ [query.sort]: query.direction }, { id: query.direction }], take: query.limit + 1, ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}) })
      const page = rows.slice(0, query.limit)
      return { items: page.map((row) => serialize(query.targetType, row)), limit: query.limit, nextCursor: rows.length > query.limit ? page.at(-1)?.id ?? null : null }
    },
    find: async (targetType, id) => { const row = await modelFor(client, targetType).findUnique({ where: { id: String(id) }, include: includeFor(targetType) }); return row ? serialize(targetType, row) : null },
    update: (type, id, payload, actor) => mutate(type, id, payload, actor, 'update'),
    delete: (type, id, payload, actor) => mutate(type, id, payload, actor, 'delete'),
    restore: (type, id, payload, actor) => mutate(type, id, payload, actor, 'restore'),
    metrics: async (query) => {
      const postWhere = whereFor({ ...query, targetType: 'post', deletionState: 'all', moderationState: null, search: null, authorHandle: null })
      const commentWhere = { ...whereFor({ ...query, targetType: 'comment', deletionState: 'all', moderationState: null, search: null, authorHandle: null, category: null }), ...(query.category ? { post: { category: query.category } } : {}) }
      const [posts, comments, categories] = await Promise.all([client.post.findMany({ where: postWhere, select: { status: true, moderationState: true, solved: true, likesCount: true, viewsCount: true, _count: { select: { comments: { where: { deletedAt: null } } } } } }), client.comment.findMany({ where: commentWhere, select: { deletedAt: true, moderationState: true } }), client.post.groupBy({ by: ['category'], where: postWhere, _count: { _all: true } })])
      const activePosts = posts.filter((row) => row.status !== 'deleted')
      const activeComments = comments.filter((row) => !row.deletedAt)
      return { window: query, posts: { total: posts.length, active: activePosts.length, deleted: posts.length - activePosts.length, hidden: posts.filter((row) => row.moderationState === 'hidden').length }, comments: { total: comments.length, active: activeComments.length, deleted: comments.length - activeComments.length, hidden: comments.filter((row) => row.moderationState === 'hidden').length }, engagement: { likes: posts.reduce((n, row) => n + row.likesCount, 0), views: posts.reduce((n, row) => n + row.viewsCount, 0), commentsPerActivePost: activePosts.length ? Number((activeComments.length / activePosts.length).toFixed(2)) : 0 }, health: { solved: posts.filter((row) => row.solved).length, unanswered: activePosts.filter((row) => row._count.comments === 0).length }, categories: Object.fromEntries(categories.map((row) => [row.category, row._count._all])) }
    },
    previewBulk: async ({ targetType, action, targetIds }) => buildCommunityBulkPreview({ rows: await modelFor(client, targetType).findMany({ where: { id: { in: targetIds } }, select: targetType === 'post' ? { id: true, status: true, version: true } : { id: true, deletedAt: true, version: true } }), targetType, action, targetIds }),
    executeBulk: async (payload, actor) => {
      const run = () => runSerializableTransaction(async (db) => {
        const existing = await db.communityAdminBulkOperation.findUnique({ where: { idempotencyKey: payload.idempotencyKey } })
        if (existing) {
          if (existing.targetType !== payload.targetType || existing.action !== payload.action || existing.targetHash !== payload.targetHash) throw new HttpError(409, 'COMMUNITY_BULK_IDEMPOTENCY_CONFLICT', 'Idempotency key was already used')
          return existing.result
        }
        const model = modelFor(db, payload.targetType)
        const rows = await model.findMany({ where: { id: { in: payload.targetIds } }, select: payload.targetType === 'post' ? { id: true, status: true, version: true } : { id: true, deletedAt: true, version: true } })
        const preview = buildCommunityBulkPreview({ rows, ...payload })
        if (preview.targetHash !== payload.targetHash || hashCommunityTargets(payload.targetType, payload.targetIds) !== payload.targetHash) throw new HttpError(409, 'COMMUNITY_BULK_TARGETS_CHANGED', 'Bulk target hash does not match preview')
        if (payload.confirmationText !== communityConfirmationText(payload.targetType, payload.action)) throw new HttpError(400, 'VALIDATION_FAILED', 'confirmationText does not match required phrase')
        const byId = new Map(rows.map((row) => [row.id, row]))
        const items = []
        for (const item of preview.items) {
          const row = byId.get(item.id)
          if (!row || !isCommunityBulkEligible(row, payload.targetType, payload.action)) { items.push({ id: item.id, status: 'skipped', reason: row ? 'state_not_eligible' : 'not_found' }); continue }
          const data = payload.targetType === 'post' ? (payload.action === 'delete' ? { status: 'deleted', deletedAt: new Date(), deletionReasonCode: payload.reasonCode, version: { increment: 1 } } : { status: 'published', deletedAt: null, deletionReasonCode: null, version: { increment: 1 } }) : (payload.action === 'delete' ? { deletedAt: new Date(), deletionReasonCode: payload.reasonCode, version: { increment: 1 } } : { deletedAt: null, deletionReasonCode: null, version: { increment: 1 } })
          const changed = await model.updateMany({ where: { id: row.id, version: row.version }, data })
          if (changed.count !== 1) { items.push({ id: row.id, status: 'skipped', reason: 'state_changed' }); continue }
          await recordAudit({ actor, action: `community.admin.${payload.targetType}.${payload.action === 'delete' ? 'deleted' : 'restored'}`, resourceType: payload.targetType, resourceId: row.id, metadata: { reasonCode: payload.reasonCode, bulk: true, idempotencyKey: payload.idempotencyKey } }, db)
          items.push({ id: row.id, status: 'succeeded', reason: null })
        }
        const result = { ...preview, status: 'completed', succeededCount: items.filter((item) => item.status === 'succeeded').length, skippedCount: items.filter((item) => item.status === 'skipped').length, items }
        await db.communityAdminBulkOperation.create({ data: { idempotencyKey: payload.idempotencyKey, targetType: payload.targetType, action: payload.action, targetHash: payload.targetHash, targetCount: preview.targetCount, eligibleCount: preview.eligibleCount, skippedCount: result.skippedCount, status: 'completed', reasonCode: payload.reasonCode, note: payload.note, requestedById: actor.id, result, completedAt: new Date() } })
        await recordAudit({ actor, action: 'community.admin.bulk.completed', resourceType: 'community_admin_bulk_operation', resourceId: payload.idempotencyKey, metadata: { targetType: payload.targetType, action: payload.action, targetHash: payload.targetHash, succeededCount: result.succeededCount, skippedCount: result.skippedCount, reasonCode: payload.reasonCode } }, db)
        return result
      })
      try { return await run() } catch (error) {
        if (error?.code !== 'P2002') throw error
        const existing = await client.communityAdminBulkOperation.findUnique({ where: { idempotencyKey: payload.idempotencyKey } })
        if (!existing || existing.targetType !== payload.targetType || existing.action !== payload.action || existing.targetHash !== payload.targetHash) throw new HttpError(409, 'COMMUNITY_BULK_IDEMPOTENCY_CONFLICT', 'Idempotency key was already used')
        return existing.result
      }
    },
  }
}
