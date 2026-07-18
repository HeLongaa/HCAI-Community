import { HttpError } from '../common/errors/httpError.js'
import { buildCommunityBulkPreview, communityConfirmationText, hashCommunityTargets, isCommunityBulkEligible } from './communityAdminContract.js'

const handleOf = (value) => typeof value === 'string' ? value : value?.handle ?? null
const iso = (value) => value ?? null
const postDto = (row) => ({
  id: String(row.id), targetType: 'post', title: row.title, body: row.body, category: row.category, tag: row.tag ?? '', solved: Boolean(row.solved),
  status: row.status ?? 'published', moderationState: row.moderationState ?? 'visible', authorHandle: handleOf(row.author),
  commentCount: Number(row.replies) || 0, likesCount: Number(row.likes) || 0, viewsCount: Number(row.views) || 0,
  version: Number(row.version) || 1, deletedAt: iso(row.deletedAt), deletionReasonCode: row.deletionReasonCode ?? null,
  createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt ?? row.createdAt),
})
const commentDto = (row, postId) => ({
  id: String(row.id), targetType: 'comment', postId: String(postId), parentId: row.parentId ?? null, body: row.body,
  moderationState: row.moderationState ?? 'visible', authorHandle: handleOf(row.author), version: Number(row.version) || 1,
  deletedAt: iso(row.deletedAt), deletionReasonCode: row.deletionReasonCode ?? null, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt ?? row.createdAt),
})
const matches = (row, query) => {
  if (query.deletionState === 'active' && (query.targetType === 'post' ? row.status === 'deleted' : row.deletedAt)) return false
  if (query.deletionState === 'deleted' && (query.targetType === 'post' ? row.status !== 'deleted' : !row.deletedAt)) return false
  if (query.status && row.status !== query.status) return false
  if (query.moderationState && (row.moderationState ?? 'visible') !== query.moderationState) return false
  if (query.category && row.category !== query.category) return false
  if (query.authorHandle && handleOf(row.author) !== query.authorHandle) return false
  if (query.postId && String(row.postId) !== query.postId) return false
  const created = Date.parse(row.createdAt ?? '')
  if (query.dateFrom && (!Number.isFinite(created) || created < Date.parse(query.dateFrom))) return false
  if (query.dateTo && (!Number.isFinite(created) || created > Date.parse(query.dateTo))) return false
  if (query.search && !`${row.id} ${row.title ?? ''} ${row.body ?? ''} ${row.category ?? ''}`.toLowerCase().includes(query.search.toLowerCase())) return false
  return true
}

export const createSeedCommunityAdminRepository = ({ posts, commentsByPostId, setPost, recordAudit }) => {
  const bulkByKey = new Map()
  const allComments = () => [...commentsByPostId.entries()].flatMap(([postId, comments]) => comments.map((comment) => ({ ...comment, postId: String(postId) })))
  const rowsFor = (targetType) => targetType === 'post' ? posts : allComments()
  const serialize = (targetType, row) => targetType === 'post' ? postDto(row) : commentDto(row, row.postId)
  const findRaw = (targetType, id) => rowsFor(targetType).find((row) => String(row.id) === String(id)) ?? null
  const replaceComment = (row) => {
    const comments = commentsByPostId.get(Number(row.postId)) ?? []
    const index = comments.findIndex((item) => String(item.id) === String(row.id))
    if (index >= 0) comments[index] = row
  }
  const mutate = (targetType, id, expectedVersion, change, actor, action, evidence) => {
    const row = findRaw(targetType, id)
    if (!row) return null
    if ((Number(row.version) || 1) !== expectedVersion) throw new HttpError(409, 'COMMUNITY_VERSION_CONFLICT', 'Community content changed since it was loaded')
    const next = { ...row, ...change(row), version: expectedVersion + 1, updatedAt: new Date().toISOString() }
    if (targetType === 'post') setPost(next); else replaceComment(next)
    recordAudit(actor, action, targetType, String(id), { ...evidence, expectedVersion })
    return serialize(targetType, next)
  }
  return {
    list: (query) => {
      const direction = query.direction === 'asc' ? 1 : -1
      const sorted = rowsFor(query.targetType).filter((row) => matches(row, query)).sort((a, b) => {
        const field = query.sort ?? 'updatedAt'
        const compared = String(a[field] ?? '').localeCompare(String(b[field] ?? ''))
        return compared === 0 ? String(a.id).localeCompare(String(b.id)) * direction : compared * direction
      })
      const start = query.cursor ? Math.max(0, sorted.findIndex((row) => String(row.id) === query.cursor) + 1) : 0
      const page = sorted.slice(start, start + query.limit)
      return { items: page.map((row) => serialize(query.targetType, row)), limit: query.limit, nextCursor: sorted.length > start + page.length ? String(page.at(-1)?.id) : null }
    },
    find: (targetType, id) => { const row = findRaw(targetType, id); return row ? serialize(targetType, row) : null },
    update: (targetType, id, payload, actor) => mutate(targetType, id, payload.expectedVersion, () => payload.patch, actor, `community.admin.${targetType}.updated`, { reasonCode: payload.reasonCode, note: payload.note, changedFields: Object.keys(payload.patch) }),
    delete: (targetType, id, payload, actor) => mutate(targetType, id, payload.expectedVersion, (row) => targetType === 'post' ? { status: 'deleted', deletedAt: new Date().toISOString(), deletionReasonCode: payload.reasonCode } : { deletedAt: new Date().toISOString(), deletionReasonCode: payload.reasonCode }, actor, `community.admin.${targetType}.deleted`, { reasonCode: payload.reasonCode, note: payload.note }),
    restore: (targetType, id, payload, actor) => mutate(targetType, id, payload.expectedVersion, () => targetType === 'post' ? { status: 'published', deletedAt: null, deletionReasonCode: null } : { deletedAt: null, deletionReasonCode: null }, actor, `community.admin.${targetType}.restored`, { reasonCode: payload.reasonCode, note: payload.note }),
    metrics: (query) => {
      const scopedPosts = posts.filter((row) => matches(row, { ...query, targetType: 'post', deletionState: 'all', moderationState: null }))
      const scopedPostIds = new Set(scopedPosts.map((row) => String(row.id)))
      const scopedComments = allComments().filter((row) => scopedPostIds.has(String(row.postId)) && matches(row, { ...query, targetType: 'comment', deletionState: 'all', moderationState: null, category: null }))
      const byCategory = {}
      for (const row of scopedPosts) byCategory[row.category] = (byCategory[row.category] ?? 0) + 1
      const activePosts = scopedPosts.filter((row) => row.status !== 'deleted')
      const activeComments = scopedComments.filter((row) => !row.deletedAt)
      const repliedPostIds = new Set(activeComments.map((row) => String(row.postId)))
      return { window: query, posts: { total: scopedPosts.length, active: activePosts.length, deleted: scopedPosts.length - activePosts.length, hidden: scopedPosts.filter((row) => row.moderationState === 'hidden').length }, comments: { total: scopedComments.length, active: activeComments.length, deleted: scopedComments.length - activeComments.length, hidden: scopedComments.filter((row) => row.moderationState === 'hidden').length }, engagement: { likes: scopedPosts.reduce((n, row) => n + (Number(row.likes) || 0), 0), views: scopedPosts.reduce((n, row) => n + (Number(row.views) || 0), 0), commentsPerActivePost: activePosts.length ? Number((activeComments.length / activePosts.length).toFixed(2)) : 0 }, health: { solved: scopedPosts.filter((row) => row.solved).length, unanswered: activePosts.filter((row) => !repliedPostIds.has(String(row.id))).length }, categories: byCategory }
    },
    previewBulk: ({ targetType, action, targetIds }) => buildCommunityBulkPreview({ rows: rowsFor(targetType), targetType, action, targetIds }),
    executeBulk: (payload, actor) => {
      const existing = bulkByKey.get(payload.idempotencyKey)
      if (existing) {
        if (existing.targetHash !== payload.targetHash || existing.action !== payload.action || existing.targetType !== payload.targetType) throw new HttpError(409, 'COMMUNITY_BULK_IDEMPOTENCY_CONFLICT', 'Idempotency key was already used')
        return existing
      }
      const preview = buildCommunityBulkPreview({ rows: rowsFor(payload.targetType), ...payload })
      if (preview.targetHash !== payload.targetHash || hashCommunityTargets(payload.targetType, payload.targetIds) !== payload.targetHash) throw new HttpError(409, 'COMMUNITY_BULK_TARGETS_CHANGED', 'Bulk target hash does not match preview')
      if (payload.confirmationText !== communityConfirmationText(payload.targetType, payload.action)) throw new HttpError(400, 'VALIDATION_FAILED', 'confirmationText does not match required phrase')
      const items = preview.items.map((item) => {
        const row = findRaw(payload.targetType, item.id)
        if (!row || !isCommunityBulkEligible(row, payload.targetType, payload.action)) return { id: item.id, status: 'skipped', reason: row ? 'state_not_eligible' : 'not_found' }
        mutate(payload.targetType, item.id, Number(row.version) || 1, () => payload.targetType === 'post' ? (payload.action === 'delete' ? { status: 'deleted', deletedAt: new Date().toISOString(), deletionReasonCode: payload.reasonCode } : { status: 'published', deletedAt: null, deletionReasonCode: null }) : (payload.action === 'delete' ? { deletedAt: new Date().toISOString(), deletionReasonCode: payload.reasonCode } : { deletedAt: null, deletionReasonCode: null }), actor, `community.admin.${payload.targetType}.${payload.action === 'delete' ? 'deleted' : 'restored'}`, { reasonCode: payload.reasonCode, bulk: true })
        return { id: item.id, status: 'succeeded', reason: null }
      })
      const result = { ...preview, status: 'completed', succeededCount: items.filter((item) => item.status === 'succeeded').length, skippedCount: items.filter((item) => item.status === 'skipped').length, items }
      bulkByKey.set(payload.idempotencyKey, result)
      recordAudit(actor, 'community.admin.bulk.completed', 'community_admin_bulk_operation', payload.idempotencyKey, { targetType: payload.targetType, action: payload.action, targetHash: payload.targetHash, succeededCount: result.succeededCount, skippedCount: result.skippedCount, reasonCode: payload.reasonCode })
      return result
    },
  }
}
