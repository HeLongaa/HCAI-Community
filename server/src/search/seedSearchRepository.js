import { decodeSearchCursor, encodeSearchCursor, searchResultDto } from './searchContract.js'

const value = (input) => String(input ?? '').trim()
const lower = (input) => value(input).toLowerCase()
const textName = (input) => typeof input === 'string' ? input : input?.en ?? input?.zh ?? ''
const actorCan = (actor, permission) => Boolean(actor?.permissions?.includes(permission))
const accountIdForHandle = (seedStore, handle) => seedStore.demoAccountByHandle.get(handle)?.id ?? null

const buildDocuments = ({ seedStore, mediaAssetsById, portfolioAssetsById, getProfilePrivacy, getAccountLifecycle }) => {
  const taskDocuments = seedStore.tasks.map((task) => {
    const publisherHandle = task.publisher?.handle ?? task.publisher
    const assigneeHandle = task.assignee?.handle ?? task.assignee
    const visibility = task.visibility ?? 'public'
    const active = !task.archivedAt && !['draft'].includes(lower(task.status))
    return {
      resourceType: 'task', sourceId: String(task.id), ownerId: accountIdForHandle(seedStore, publisherHandle),
      ownerHandle: publisherHandle, allowedUserIds: [accountIdForHandle(seedStore, publisherHandle), accountIdForHandle(seedStore, assigneeHandle)].filter(Boolean),
      authenticated: active && visibility === 'community', permission: 'admin:tasks:read',
      isPublic: active && visibility === 'public', title: value(task.title), summary: value(task.description).slice(0, 500),
      keywords: [task.category, publisherHandle, assigneeHandle, ...(task.requirements ?? [])].map(value),
      lifecycle: task.archivedAt ? 'archived' : lower(task.status), target: { page: 'tasks', taskId: String(task.id) },
      sourceUpdatedAt: task.updatedAt ?? task.createdAt ?? new Date(0).toISOString(), indexedAt: new Date().toISOString(),
    }
  })
  const communityDocuments = seedStore.posts.map((post) => {
    const authorHandle = post.author?.handle ?? post.author
    const status = post.status ?? 'published'
    const moderationState = post.moderationState ?? 'visible'
    return {
      resourceType: 'community', sourceId: String(post.id), ownerId: accountIdForHandle(seedStore, authorHandle),
      ownerHandle: authorHandle, allowedUserIds: [accountIdForHandle(seedStore, authorHandle)].filter(Boolean), permission: 'admin:community:read',
      isPublic: status === 'published' && moderationState === 'visible', title: value(post.title),
      summary: value(post.body ?? post.excerpt).slice(0, 500), keywords: [post.category, post.tag, authorHandle].map(value),
      lifecycle: moderationState === 'hidden' ? 'hidden' : status, target: { page: 'community', postId: String(post.id) },
      sourceUpdatedAt: post.updatedAt ?? post.createdAt ?? new Date(0).toISOString(), indexedAt: new Date().toISOString(),
    }
  })
  const userDocuments = seedStore.profiles.map((profile) => {
    const account = seedStore.demoAccountByHandle.get(profile.handle) ?? null
    const privacy = getProfilePrivacy(profile.handle)
    const lifecycle = account ? getAccountLifecycle(account) : { status: 'active', deletionRequestedAt: null }
    const active = lifecycle.status === 'active' && !lifecycle.deletionRequestedAt
    return {
      resourceType: 'user', sourceId: account?.id ?? profile.handle, ownerId: account?.id ?? null, ownerHandle: profile.handle,
      allowedUserIds: account ? [account.id] : [], permission: 'admin:users:read',
      isPublic: active && privacy.visibility === 'public' && privacy.discoverable,
      title: value(account?.displayName ?? textName(profile.name) ?? profile.handle), summary: value(textName(profile.bio)).slice(0, 500),
      keywords: [profile.handle, profile.lane, ...(profile.tags ?? []), ...(profile.zhTags ?? []), ...(profile.languages ?? [])].map(value),
      lifecycle: active ? privacy.visibility : lifecycle.status, target: { page: 'profile', handle: profile.handle },
      sourceUpdatedAt: privacy.updatedAt ?? new Date(0).toISOString(), indexedAt: new Date().toISOString(),
    }
  })
  const assetDocuments = [...mediaAssetsById.values()].map((asset) => {
    const ownerHandle = asset.ownerHandle
    const owner = seedStore.demoAccountByHandle.get(ownerHandle) ?? null
    const privacy = getProfilePrivacy(ownerHandle)
    const lifecycle = owner ? getAccountLifecycle(owner) : { status: 'active', deletionRequestedAt: null }
    const published = [...portfolioAssetsById.values()].find((item) => item.assetId === asset.id && item.status === 'published') ?? null
    const security = asset.metadata?.security ?? {}
    const active = asset.status === 'uploaded' && security.scanStatus === 'clean' && !asset.archivedAt && !asset.deletedAt
    const publiclyVisible = Boolean(published && active && privacy.visibility === 'public' && privacy.discoverable && privacy.showPortfolio && lifecycle.status === 'active' && !lifecycle.deletionRequestedAt)
    return {
      resourceType: 'asset', sourceId: String(asset.id), ownerId: owner?.id ?? asset.ownerId ?? null, ownerHandle,
      allowedUserIds: [owner?.id ?? asset.ownerId].filter(Boolean), permission: 'admin:media:read', isPublic: publiclyVisible,
      title: value(published?.title || asset.fileName), summary: value(published?.caption).slice(0, 500),
      keywords: [asset.fileName, asset.contentType, asset.purpose, ownerHandle].map(value),
      lifecycle: asset.deletedAt ? 'deleted' : asset.archivedAt ? 'archived' : asset.status,
      target: publiclyVisible ? { page: 'profile', handle: ownerHandle, assetId: String(asset.id) } : { page: 'profile', section: 'assets', assetId: String(asset.id) },
      sourceUpdatedAt: asset.updatedAt ?? asset.createdAt ?? new Date(0).toISOString(), indexedAt: new Date().toISOString(),
    }
  })
  return [...taskDocuments, ...communityDocuments, ...userDocuments, ...assetDocuments]
}

const accessible = (document, actor) => document.isPublic || Boolean(actor && (
  document.authenticated || document.allowedUserIds.includes(actor.id) || actorCan(actor, document.permission)
))

const scoreDocument = (document, query) => {
  const normalized = lower(query)
  const title = lower(document.title)
  const haystack = lower([document.title, document.summary, ...document.keywords].join(' '))
  if (!haystack.includes(normalized)) return 0
  return title === normalized ? 5 : title.includes(normalized) ? 3 : 1
}

export const createSeedSearchRepository = (dependencies) => ({
  async search(actor, options) {
    const offset = decodeSearchCursor(options.cursor, options)
    const documents = buildDocuments(dependencies)
      .filter((document) => options.types.includes(document.resourceType) && accessible(document, actor))
      .map((document) => ({ ...document, score: scoreDocument(document, options.query) }))
      .filter((document) => document.score > 0)
      .sort((left, right) => right.score - left.score || String(right.sourceUpdatedAt).localeCompare(String(left.sourceUpdatedAt)) || left.sourceId.localeCompare(right.sourceId))
    const rows = documents.slice(offset, offset + options.limit + 1)
    return {
      items: rows.slice(0, options.limit).map(searchResultDto),
      limit: options.limit,
      nextCursor: rows.length > options.limit ? encodeSearchCursor({ ...options, offset: offset + options.limit }) : null,
    }
  },
  async processQueue({ limit = 100 } = {}) {
    return { requested: limit, processed: 0, succeeded: 0, failed: 0, items: [] }
  },
  async enqueueRebuild(types, actor = null, reasonCode = 'admin_search_rebuild') {
    const documents = buildDocuments(dependencies).filter((document) => types.includes(document.resourceType))
    return { types, enqueued: documents.length, reasonCode, requestedBy: actor?.id ?? null }
  },
  async status() {
    const documents = buildDocuments(dependencies)
    const counts = Object.fromEntries(dependencies.searchResourceTypes.map((type) => [type, {
      count: documents.filter((document) => document.resourceType === type).length,
      lastIndexedAt: new Date().toISOString(),
      averageSyncLatencyMs: 0,
      maximumSyncLatencyMs: 0,
      withinTarget: true,
    }]))
    return { generatedAt: new Date().toISOString(), documents: counts, queue: {}, lagSeconds: 0 }
  },
})
