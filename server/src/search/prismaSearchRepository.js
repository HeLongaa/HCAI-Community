import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { HttpError } from '../common/errors/httpError.js'
import { decodeSearchCursor, encodeSearchCursor, searchDocumentId, searchRankingControlDto, searchResultDto } from './searchContract.js'

const unique = (values) => [...new Set(values.filter(Boolean).map(String))]
const grant = (subjectType, subjectId) => ({ subjectType, subjectId: String(subjectId) })
const userGrant = (id) => id ? grant('user', id) : null
const permissionGrant = (id) => grant('permission', id)
const authenticatedGrant = () => grant('authenticated', 'personal_account')
const cleanSummary = (value, maximum = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum)
const metadataObject = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {}

const taskDocument = async (db, sourceId) => {
  const row = await db.task.findUnique({
    where: { id: sourceId },
    include: {
      publisher: { include: { profile: true } },
      assignee: { include: { profile: true } },
      proposals: { select: { proposerId: true } },
      submissions: { select: { submitterId: true } },
    },
  })
  if (!row) return null
  const active = !row.archivedAt && row.status !== 'draft'
  const grants = [
    userGrant(row.publisherId), userGrant(row.assigneeId), permissionGrant('admin:tasks:read'),
    ...row.proposals.map((item) => userGrant(item.proposerId)),
    ...row.submissions.map((item) => userGrant(item.submitterId)),
    ...(active && row.visibility === 'community' ? [authenticatedGrant()] : []),
  ].filter(Boolean)
  return {
    resourceType: 'task', sourceId: row.id, ownerId: row.publisherId,
    isPublic: active && row.visibility === 'public', title: row.title,
    summary: cleanSummary(row.description),
    keywords: unique([row.category, row.acceptanceRules, row.publisher?.profile?.handle, row.assignee?.profile?.handle]),
    lifecycle: row.archivedAt ? 'archived' : row.status,
    target: { page: 'tasks', taskId: row.id },
    sourceVersion: row.version, sourceUpdatedAt: row.updatedAt, grants,
  }
}

const communityDocument = async (db, sourceId) => {
  const row = await db.post.findUnique({ where: { id: sourceId }, include: { author: { include: { profile: true } } } })
  if (!row) return null
  return {
    resourceType: 'community', sourceId: row.id, ownerId: row.authorId,
    isPublic: row.status === 'published' && row.moderationState === 'visible',
    title: row.title, summary: cleanSummary(row.body),
    keywords: unique([row.category, row.tag, row.author?.profile?.handle]),
    lifecycle: row.moderationState === 'hidden' ? 'hidden' : row.status,
    target: { page: 'community', postId: row.id },
    sourceVersion: row.version, sourceUpdatedAt: row.updatedAt,
    grants: [userGrant(row.authorId), permissionGrant('admin:community:read')],
  }
}

const userDocument = async (db, sourceId) => {
  const row = await db.profile.findUnique({ where: { userId: sourceId }, include: { user: true } })
  if (!row) return null
  const active = row.user.status === 'active' && !row.user.deletionRequestedAt
  return {
    resourceType: 'user', sourceId: row.userId, ownerId: row.userId,
    isPublic: active && row.visibility === 'public' && row.discoverable,
    title: row.user.displayName, summary: cleanSummary(row.bio),
    keywords: unique([row.handle, row.lane, ...row.skills, ...row.languages]),
    lifecycle: active ? row.visibility : row.user.status,
    target: { page: 'profile', handle: row.handle },
    sourceVersion: row.version, sourceUpdatedAt: row.updatedAt,
    grants: [userGrant(row.userId), permissionGrant('admin:users:read')],
  }
}

const assetDocument = async (db, sourceId) => {
  const row = await db.mediaAsset.findUnique({
    where: { id: sourceId },
    include: {
      owner: { include: { profile: true } },
      portfolioAssets: { include: { profile: { include: { user: true } } }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }] },
    },
  })
  if (!row) return null
  const security = metadataObject(metadataObject(row.metadata).security)
  const published = row.portfolioAssets.find((item) => item.status === 'published') ?? null
  const publicProfile = published?.profile
  const active = row.status === 'uploaded' && security.scanStatus === 'clean' && !row.archivedAt && !row.deletedAt
  const publiclyVisible = active && publicProfile?.visibility === 'public' && publicProfile.discoverable && publicProfile.showPortfolio && publicProfile.user.status === 'active' && !publicProfile.user.deletionRequestedAt
  return {
    resourceType: 'asset', sourceId: row.id, ownerId: row.ownerId,
    isPublic: Boolean(publiclyVisible), title: published?.title || row.fileName,
    summary: cleanSummary(published?.caption || ''),
    keywords: unique([row.fileName, row.contentType, row.purpose, row.owner?.profile?.handle]),
    lifecycle: row.deletedAt ? 'deleted' : row.archivedAt ? 'archived' : row.status,
    target: publiclyVisible
      ? { page: 'profile', handle: publicProfile.handle, assetId: row.id }
      : { page: 'profile', section: 'assets', assetId: row.id },
    sourceVersion: 1, sourceUpdatedAt: row.updatedAt,
    grants: [userGrant(row.ownerId), permissionGrant('admin:media:read')],
  }
}

const projectors = { task: taskDocument, community: communityDocument, user: userDocument, asset: assetDocument }

const writeDocument = async (db, document) => {
  const id = searchDocumentId(document.resourceType, document.sourceId)
  const { grants, ...data } = document
  await db.searchDocument.upsert({
    where: { id },
    create: { id, ...data },
    update: { ...data, indexedAt: new Date() },
  })
  await db.searchDocumentGrant.deleteMany({ where: { documentId: id } })
  const normalizedGrants = unique(grants.map((item) => `${item.subjectType}:${item.subjectId}`)).map((value) => {
    const separator = value.indexOf(':')
    return { documentId: id, subjectType: value.slice(0, separator), subjectId: value.slice(separator + 1) }
  })
  if (normalizedGrants.length) await db.searchDocumentGrant.createMany({ data: normalizedGrants, skipDuplicates: true })
  return id
}

const syncOne = async (client, resourceType, sourceId, options = {}) => client.$transaction(async (db) => {
  const projector = projectors[resourceType]
  if (!projector) throw Object.assign(new Error('SEARCH_RESOURCE_TYPE_UNSUPPORTED'), { code: 'SEARCH_RESOURCE_TYPE_UNSUPPORTED' })
  const document = await projector(db, String(sourceId))
  if (!document) {
    await db.searchDocument.deleteMany({ where: { resourceType, sourceId: String(sourceId) } })
    return { resourceType, sourceId: String(sourceId), action: 'deleted' }
  }
  await writeDocument(db, { ...document, syncLatencyMs: Math.max(0, Math.round(Number(options.syncLatencyMs ?? 0))) })
  return { resourceType, sourceId: String(sourceId), action: 'upserted', isPublic: document.isPublic }
})

const rebuildSources = {
  task: 'SELECT \'task\' AS "resource_type", "id" AS "source_id", "updated_at" AS "source_updated_at" FROM "tasks"',
  community: 'SELECT \'community\' AS "resource_type", "id" AS "source_id", "updated_at" AS "source_updated_at" FROM "posts"',
  user: 'SELECT \'user\' AS "resource_type", "user_id" AS "source_id", "updated_at" AS "source_updated_at" FROM "profiles"',
  asset: 'SELECT \'asset\' AS "resource_type", "id" AS "source_id", "updated_at" AS "source_updated_at" FROM "media_assets"',
}

export const createPrismaSearchRepository = (client, { recordAudit = async () => {} } = {}) => ({
  async search(actor, options) {
    const ranking = await client.searchRankingControl.findUnique({ where: { id: 'default' } })
    const sort = options.sort ?? 'relevance'
    const normalizedOptions = { ...options, sort }
    const offset = decodeSearchCursor(options.cursor, normalizedOptions)
    const permissionIds = Array.isArray(actor?.permissions) ? actor.permissions : []
    const actorId = actor?.principalType === 'service_account' ? null : actor?.id ?? null
    const authenticated = Boolean(actorId)
    const queryPattern = `%${options.query.replace(/[\\%_]/g, '\\$&')}%`
    const relevanceWeight = ranking?.relevanceWeight ?? 100
    const recencyWeight = ranking?.recencyWeight ?? 15
    const popularityWeight = ranking?.popularityWeight ?? 20
    const rows = await client.$queryRaw(Prisma.sql`
      WITH authorized_matches AS (
        SELECT d.*,
          (ts_rank_cd(d."search_vector", websearch_to_tsquery('simple', ${options.query}))
            + CASE WHEN lower(d."title") = lower(${options.query}) THEN 3 ELSE 0 END
            + CASE WHEN d."title" ILIKE ${queryPattern} THEN 1 ELSE 0 END) AS relevance,
          LEAST(1, GREATEST(0, 1 - EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - d."source_updated_at")) / 7776000.0)) AS recency,
          COALESCE((SELECT COUNT(*) FROM "search_click_events" c WHERE c."document_id" = d."id" AND c."created_at" >= CURRENT_TIMESTAMP - INTERVAL '30 days'), 0)::double precision AS popularity
        FROM "search_documents" d
        WHERE d."resource_type" = ANY(${options.types}::text[])
          AND (d."search_vector" @@ websearch_to_tsquery('simple', ${options.query})
            OR d."title" ILIKE ${queryPattern} OR d."summary" ILIKE ${queryPattern}
            OR array_to_string(d."keywords", ' ') ILIKE ${queryPattern})
          AND (
            d."is_public" = true
            OR (${authenticated} AND EXISTS (
              SELECT 1 FROM "search_document_grants" g
              WHERE g."document_id" = d."id" AND (
                (g."subject_type" = 'authenticated' AND g."subject_id" = 'personal_account')
                OR (g."subject_type" = 'user' AND g."subject_id" = ${actorId ?? ''})
                OR (g."subject_type" = 'permission' AND g."subject_id" = ANY(${permissionIds}::text[]))
              )
            ))
          )
      )
      SELECT d."resource_type" AS "resourceType", d."source_id" AS "sourceId", d."title", d."summary",
             d."lifecycle", d."target", d."source_updated_at" AS "sourceUpdatedAt", d."indexed_at" AS "indexedAt",
             (${relevanceWeight} * d.relevance + ${recencyWeight} * d.recency + ${popularityWeight} * LN(1 + d.popularity)) AS "score"
      FROM authorized_matches d
      ORDER BY
        CASE WHEN ${sort} = 'recent' THEN d."source_updated_at" END DESC,
        CASE WHEN ${sort} = 'popular' THEN d.popularity END DESC,
        "score" DESC, d."source_updated_at" DESC, d."id" ASC
      LIMIT ${options.limit + 1} OFFSET ${offset}
    `)
    const pageRows = rows.slice(0, options.limit)
    return {
      items: pageRows.map(searchResultDto),
      limit: options.limit,
      nextCursor: rows.length > options.limit ? encodeSearchCursor({ ...normalizedOptions, offset: offset + options.limit }) : null,
    }
  },
  async recordQuery(actor, options, page, durationMs) {
    const row = await client.searchQueryEvent.create({
      data: {
        id: randomUUID(),
        queryFingerprint: options.queryFingerprint,
        queryLength: options.query.length,
        resourceTypes: options.types,
        sort: options.sort,
        actorClass: actor ? 'authenticated' : 'anonymous',
        resultCount: page.items.length,
        hasNextPage: Boolean(page.nextCursor),
        durationMs: Math.min(60_000, Math.max(0, Math.round(durationMs))),
        resultDocumentIds: page.items.map((item) => searchDocumentId(item.type, item.id)),
      },
    })
    return row.id
  },
  async recordClick(queryEventId, payload) {
    const documentId = searchDocumentId(payload.resourceType, payload.sourceId)
    const query = await client.searchQueryEvent.findFirst({
      where: { id: queryEventId, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, resultDocumentIds: { has: documentId } },
      select: { id: true, resultDocumentIds: true },
    })
    if (!query || query.resultDocumentIds[payload.position - 1] !== documentId) throw new HttpError(404, 'SEARCH_EVENT_NOT_FOUND', 'Search event or returned result was not found')
    const row = await client.searchClickEvent.upsert({
      where: { queryEventId_documentId: { queryEventId, documentId } },
      create: { id: randomUUID(), queryEventId, documentId, resourceType: payload.resourceType, position: payload.position },
      update: {},
    })
    return { recorded: true, id: row.id }
  },
  async diagnostics(windowHours = 24) {
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000)
    const [summaryRows, popularRows, latencyRows, ranking, indexStatus] = await Promise.all([
      client.$queryRaw(Prisma.sql`
        SELECT COUNT(*)::int AS queries,
          COUNT(*) FILTER (WHERE "result_count" = 0)::int AS "zeroResults",
          COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "search_click_events" c WHERE c."query_event_id" = q."id"))::int AS "clickedQueries"
        FROM "search_query_events" q
        WHERE q."created_at" >= ${since}
      `),
      client.$queryRaw(Prisma.sql`
        SELECT c."document_id" AS "documentId", c."resource_type" AS "resourceType", COUNT(*)::int AS clicks
        FROM "search_click_events" c JOIN "search_query_events" q ON q."id" = c."query_event_id"
        WHERE q."created_at" >= ${since}
        GROUP BY c."document_id", c."resource_type" ORDER BY clicks DESC, c."document_id" ASC LIMIT 10
      `),
      client.$queryRaw(Prisma.sql`
        SELECT COALESCE(AVG("duration_ms"), 0)::float AS average,
          COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "duration_ms"), 0)::float AS p95,
          COALESCE(MAX("duration_ms"), 0)::int AS maximum
        FROM "search_query_events" WHERE "created_at" >= ${since}
      `),
      client.searchRankingControl.findUnique({ where: { id: 'default' } }),
      this.status(),
    ])
    const summary = summaryRows[0] ?? { queries: 0, zeroResults: 0, clickedQueries: 0 }
    const queries = Number(summary.queries ?? 0)
    const zeroResults = Number(summary.zeroResults ?? 0)
    const clickedQueries = Number(summary.clickedQueries ?? 0)
    return {
      generatedAt: new Date().toISOString(), windowHours, queries, zeroResults, clickedQueries,
      zeroResultRateBps: queries ? Math.round((zeroResults * 10_000) / queries) : 0,
      clickThroughRateBps: queries ? Math.round((clickedQueries * 10_000) / queries) : 0,
      zeroResultAlerting: queries > 0 && Math.round((zeroResults * 10_000) / queries) >= (ranking?.zeroResultAlertRateBps ?? 2500),
      latencyMs: { average: Math.round(Number(latencyRows[0]?.average ?? 0)), p95: Math.round(Number(latencyRows[0]?.p95 ?? 0)), maximum: Number(latencyRows[0]?.maximum ?? 0) },
      popularResults: popularRows.map((row) => ({ documentId: row.documentId, resourceType: row.resourceType, clicks: Number(row.clicks) })),
      ranking: searchRankingControlDto(ranking),
      index: indexStatus,
    }
  },
  async rankingControl() {
    return searchRankingControlDto(await client.searchRankingControl.findUniqueOrThrow({ where: { id: 'default' } }))
  },
  async updateRankingControl(actor, payload) {
    return client.$transaction(async (db) => {
      const changed = await db.searchRankingControl.updateMany({
        where: { id: 'default', version: payload.expectedVersion },
        data: {
          relevanceWeight: payload.relevanceWeight, recencyWeight: payload.recencyWeight,
          popularityWeight: payload.popularityWeight, zeroResultAlertRateBps: payload.zeroResultAlertRateBps,
          reasonCode: payload.reasonCode, updatedByRef: actor.id, version: { increment: 1 },
        },
      })
      if (changed.count !== 1) throw new HttpError(409, 'VERSION_CONFLICT', 'Search ranking control version is stale')
      const row = await db.searchRankingControl.findUniqueOrThrow({ where: { id: 'default' } })
      await recordAudit({ actor, action: 'search.ranking_control.updated', resourceType: 'search_ranking_control', resourceId: 'default', metadata: { reasonCode: payload.reasonCode, version: row.version, relevanceWeight: row.relevanceWeight, recencyWeight: row.recencyWeight, popularityWeight: row.popularityWeight, zeroResultAlertRateBps: row.zeroResultAlertRateBps } }, db)
      return searchRankingControlDto(row)
    })
  },
  async processQueue({ limit = 100, workerId = 'search-index-worker', types = null } = {}) {
    const boundedLimit = Math.min(Math.max(Number(limit), 1), 500)
    await client.searchSyncQueue.updateMany({
      where: { status: 'processing', claimedAt: { lt: new Date(Date.now() - 5 * 60 * 1000) } },
      data: { status: 'failed', availableAt: new Date(), claimedAt: null, claimedBy: null, lastErrorCode: 'SEARCH_SYNC_LEASE_EXPIRED' },
    })
    const results = []
    for (let index = 0; index < boundedLimit; index += 1) {
      const candidate = await client.searchSyncQueue.findFirst({
        where: {
          status: { in: ['pending', 'failed'] }, availableAt: { lte: new Date() },
          ...(types?.length ? { resourceType: { in: types } } : {}),
        },
        orderBy: [{ sourceUpdatedAt: 'asc' }, { id: 'asc' }],
      })
      if (!candidate) break
      const claimed = await client.searchSyncQueue.updateMany({
        where: { id: candidate.id, status: candidate.status, sourceUpdatedAt: candidate.sourceUpdatedAt },
        data: { status: 'processing', attempts: { increment: 1 }, claimedAt: new Date(), claimedBy: workerId, lastErrorCode: null },
      })
      if (!claimed.count) continue
      try {
        const result = await syncOne(client, candidate.resourceType, candidate.sourceId, { syncLatencyMs: Date.now() - candidate.updatedAt.getTime() })
        await client.searchSyncQueue.deleteMany({ where: { id: candidate.id, status: 'processing', sourceUpdatedAt: candidate.sourceUpdatedAt } })
        results.push({ ...result, status: 'succeeded' })
      } catch (error) {
        const errorCode = String(error?.code ?? 'SEARCH_SYNC_FAILED').slice(0, 120)
        await client.searchSyncQueue.updateMany({
          where: { id: candidate.id, status: 'processing', sourceUpdatedAt: candidate.sourceUpdatedAt },
          data: { status: 'failed', availableAt: new Date(Date.now() + 5_000), claimedAt: null, claimedBy: null, lastErrorCode: errorCode },
        })
        results.push({ resourceType: candidate.resourceType, sourceId: candidate.sourceId, status: 'failed', errorCode })
      }
    }
    return {
      requested: boundedLimit,
      processed: results.length,
      succeeded: results.filter((item) => item.status === 'succeeded').length,
      failed: results.filter((item) => item.status === 'failed').length,
      items: results,
    }
  },
  async enqueueRebuild(types, actor = null, reasonCode = 'admin_search_rebuild') {
    return client.$transaction(async (db) => {
      let enqueued = 0
      for (const type of types) {
        const source = rebuildSources[type]
        if (!source) continue
        enqueued += await db.$executeRawUnsafe(`
          INSERT INTO "search_sync_queue" ("id", "resource_type", "source_id", "status", "attempts", "available_at", "source_updated_at", "created_at", "updated_at")
          SELECT 'search-sync:' || source."resource_type" || ':' || source."source_id", source."resource_type", source."source_id", 'pending', 0, CURRENT_TIMESTAMP, source."source_updated_at", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          FROM (${source}) source
          ON CONFLICT ("resource_type", "source_id") DO UPDATE SET
            "status" = 'pending', "available_at" = CURRENT_TIMESTAMP, "claimed_at" = NULL, "claimed_by" = NULL,
            "last_error_code" = NULL, "source_updated_at" = GREATEST("search_sync_queue"."source_updated_at", EXCLUDED."source_updated_at"), "updated_at" = CURRENT_TIMESTAMP
        `)
        enqueued += await db.$executeRaw`
          INSERT INTO "search_sync_queue" ("id", "resource_type", "source_id", "status", "attempts", "available_at", "source_updated_at", "created_at", "updated_at")
          SELECT 'search-sync:' || d."resource_type" || ':' || d."source_id", d."resource_type", d."source_id", 'pending', 0, CURRENT_TIMESTAMP, d."source_updated_at", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          FROM "search_documents" d WHERE d."resource_type" = ${type}
          ON CONFLICT ("resource_type", "source_id") DO NOTHING
        `
      }
      await recordAudit({ actor, action: 'search.index.rebuild_enqueued', resourceType: 'search_index', resourceId: null, metadata: { types, enqueued, reasonCode } }, db)
      return { types, enqueued, reasonCode }
    })
  },
  async status() {
    const [documents, queue, oldest] = await Promise.all([
      client.searchDocument.groupBy({ by: ['resourceType'], _count: { _all: true }, _max: { indexedAt: true, syncLatencyMs: true }, _avg: { syncLatencyMs: true } }),
      client.searchSyncQueue.groupBy({ by: ['status'], _count: { _all: true }, _min: { sourceUpdatedAt: true } }),
      client.searchSyncQueue.findFirst({ where: { status: { in: ['pending', 'failed', 'processing'] } }, orderBy: { sourceUpdatedAt: 'asc' }, select: { sourceUpdatedAt: true } }),
    ])
    return {
      generatedAt: new Date().toISOString(),
      documents: Object.fromEntries(documents.map((item) => [item.resourceType, {
        count: item._count._all,
        lastIndexedAt: item._max.indexedAt?.toISOString?.() ?? null,
        averageSyncLatencyMs: Math.round(item._avg.syncLatencyMs ?? 0),
        maximumSyncLatencyMs: item._max.syncLatencyMs ?? 0,
        withinTarget: (item._max.syncLatencyMs ?? 0) <= 30_000,
      }])),
      queue: Object.fromEntries(queue.map((item) => [item.status, { count: item._count._all, oldestSourceUpdatedAt: item._min.sourceUpdatedAt?.toISOString?.() ?? null }])),
      lagSeconds: oldest ? Math.max(0, Math.floor((Date.now() - oldest.sourceUpdatedAt.getTime()) / 1000)) : 0,
    }
  },
  syncOne: (resourceType, sourceId) => syncOne(client, resourceType, sourceId),
})
