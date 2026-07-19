import { randomUUID } from 'node:crypto'
import { HttpError } from '../common/errors/httpError.js'
import { decodeSearchCursor, encodeSearchCursor, searchDocumentId, searchRankingControlDto, searchResultDto } from './searchContract.js'

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

export const createSeedSearchRepository = (dependencies) => {
  const queryEvents = []
  const clickEvents = []
  let ranking = {
    id: 'default', relevanceWeight: 100, recencyWeight: 15, popularityWeight: 20,
    zeroResultAlertRateBps: 2500, version: 0, reasonCode: 'search_02_default',
    updatedByRef: null, updatedAt: new Date(),
  }
  const popularity = (document) => clickEvents.filter((event) => event.documentId === searchDocumentId(document.resourceType, document.sourceId)).length
  const recency = (document) => Math.max(0, 1 - (Date.now() - new Date(document.sourceUpdatedAt).getTime()) / (90 * 24 * 60 * 60 * 1000))
  const weightedScore = (document) => ranking.relevanceWeight * document.score + ranking.recencyWeight * recency(document) + ranking.popularityWeight * Math.log1p(popularity(document))
  const status = () => {
    const documents = buildDocuments(dependencies)
    const counts = Object.fromEntries(dependencies.searchResourceTypes.map((type) => [type, {
      count: documents.filter((document) => document.resourceType === type).length,
      lastIndexedAt: new Date().toISOString(), averageSyncLatencyMs: 0, maximumSyncLatencyMs: 0, withinTarget: true,
    }]))
    return { generatedAt: new Date().toISOString(), documents: counts, queue: {}, lagSeconds: 0 }
  }
  return {
  async search(actor, options) {
    const normalizedOptions = { ...options, sort: options.sort ?? 'relevance' }
    const offset = decodeSearchCursor(options.cursor, normalizedOptions)
    const documents = buildDocuments(dependencies)
      .filter((document) => options.types.includes(document.resourceType) && accessible(document, actor))
      .map((document) => ({ ...document, score: scoreDocument(document, options.query) }))
      .filter((document) => document.score > 0)
      .map((document) => ({ ...document, weightedScore: weightedScore(document), popularity: popularity(document) }))
      .sort((left, right) => normalizedOptions.sort === 'recent'
        ? String(right.sourceUpdatedAt).localeCompare(String(left.sourceUpdatedAt)) || right.weightedScore - left.weightedScore || left.sourceId.localeCompare(right.sourceId)
        : normalizedOptions.sort === 'popular'
          ? right.popularity - left.popularity || right.weightedScore - left.weightedScore || left.sourceId.localeCompare(right.sourceId)
          : right.weightedScore - left.weightedScore || String(right.sourceUpdatedAt).localeCompare(String(left.sourceUpdatedAt)) || left.sourceId.localeCompare(right.sourceId))
    const rows = documents.slice(offset, offset + options.limit + 1)
    return {
      items: rows.slice(0, options.limit).map(searchResultDto),
      limit: options.limit,
      nextCursor: rows.length > options.limit ? encodeSearchCursor({ ...normalizedOptions, offset: offset + options.limit }) : null,
    }
  },
  async recordQuery(actor, options, page, durationMs) {
    const row = {
      id: randomUUID(), queryFingerprint: options.queryFingerprint, queryLength: options.query.length,
      resourceTypes: options.types, sort: options.sort, actorClass: actor ? 'authenticated' : 'anonymous',
      resultCount: page.items.length, hasNextPage: Boolean(page.nextCursor), durationMs: Math.max(0, Math.round(durationMs)),
      resultDocumentIds: page.items.map((item) => searchDocumentId(item.type, item.id)), createdAt: new Date(),
    }
    queryEvents.push(row)
    return row.id
  },
  async recordClick(queryEventId, payload) {
    const documentId = searchDocumentId(payload.resourceType, payload.sourceId)
    const query = queryEvents.find((event) => event.id === queryEventId && Date.now() - event.createdAt.getTime() <= 24 * 60 * 60 * 1000 && event.resultDocumentIds.includes(documentId))
    if (!query || query.resultDocumentIds[payload.position - 1] !== documentId) throw new HttpError(404, 'SEARCH_EVENT_NOT_FOUND', 'Search event or returned result was not found')
    const existing = clickEvents.find((event) => event.queryEventId === queryEventId && event.documentId === documentId)
    if (existing) return { recorded: true, id: existing.id }
    const row = { id: randomUUID(), queryEventId, documentId, resourceType: payload.resourceType, position: payload.position, createdAt: new Date() }
    clickEvents.push(row)
    return { recorded: true, id: row.id }
  },
  async diagnostics(windowHours = 24) {
    const since = Date.now() - windowHours * 60 * 60 * 1000
    const queries = queryEvents.filter((event) => event.createdAt.getTime() >= since)
    const clicks = clickEvents.filter((event) => event.createdAt.getTime() >= since)
    const clickedQueries = new Set(clicks.map((event) => event.queryEventId)).size
    const zeroResults = queries.filter((event) => event.resultCount === 0).length
    const durations = queries.map((event) => event.durationMs).sort((a, b) => a - b)
    const popular = new Map()
    for (const event of clicks) popular.set(`${event.documentId}:${event.resourceType}`, (popular.get(`${event.documentId}:${event.resourceType}`) ?? 0) + 1)
    const popularResults = [...popular.entries()].map(([key, count]) => {
      const split = key.lastIndexOf(':')
      return { documentId: key.slice(0, split), resourceType: key.slice(split + 1), clicks: count }
    }).sort((a, b) => b.clicks - a.clicks || a.documentId.localeCompare(b.documentId)).slice(0, 10)
    const zeroResultRateBps = queries.length ? Math.round((zeroResults * 10_000) / queries.length) : 0
    return {
      generatedAt: new Date().toISOString(), windowHours, queries: queries.length, zeroResults, clickedQueries,
      zeroResultRateBps, clickThroughRateBps: queries.length ? Math.round((clickedQueries * 10_000) / queries.length) : 0,
      zeroResultAlerting: queries.length > 0 && zeroResultRateBps >= ranking.zeroResultAlertRateBps,
      latencyMs: { average: durations.length ? Math.round(durations.reduce((sum, item) => sum + item, 0) / durations.length) : 0, p95: durations.length ? durations[Math.ceil(durations.length * 0.95) - 1] : 0, maximum: durations.at(-1) ?? 0 },
      popularResults, ranking: searchRankingControlDto(ranking), index: status(),
    }
  },
  async rankingControl() {
    return searchRankingControlDto(ranking)
  },
  async updateRankingControl(actor, payload) {
    if (ranking.version !== payload.expectedVersion) throw new HttpError(409, 'VERSION_CONFLICT', 'Search ranking control version is stale')
    ranking = { ...ranking, ...payload, version: ranking.version + 1, updatedByRef: actor.id, updatedAt: new Date() }
    return searchRankingControlDto(ranking)
  },
  async processQueue({ limit = 100 } = {}) {
    return { requested: limit, processed: 0, succeeded: 0, failed: 0, items: [] }
  },
  async enqueueRebuild(types, actor = null, reasonCode = 'admin_search_rebuild') {
    const documents = buildDocuments(dependencies).filter((document) => types.includes(document.resourceType))
    return { types, enqueued: documents.length, reasonCode, requestedBy: actor?.id ?? null }
  },
  async status() {
    return status()
  },
  }
}
