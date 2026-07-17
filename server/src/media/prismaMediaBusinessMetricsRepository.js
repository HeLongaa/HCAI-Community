import prismaClientPkg from '@prisma/client'

const { Prisma } = prismaClientPkg
const number = (value) => Number(value ?? 0)
const decimal = (value) => value == null ? null : Number(Number(value).toFixed(2))

const mediaTypeCondition = (alias, mediaType) => {
  if (!mediaType) return Prisma.sql`TRUE`
  if (mediaType === 'image') return Prisma.sql`${Prisma.raw(alias)}."content_type" LIKE 'image/%'`
  if (mediaType === 'video') return Prisma.sql`${Prisma.raw(alias)}."content_type" LIKE 'video/%'`
  if (mediaType === 'audio') return Prisma.sql`${Prisma.raw(alias)}."content_type" LIKE 'audio/%'`
  return Prisma.sql`${Prisma.raw(alias)}."content_type" NOT LIKE 'image/%' AND ${Prisma.raw(alias)}."content_type" NOT LIKE 'video/%' AND ${Prisma.raw(alias)}."content_type" NOT LIKE 'audio/%'`
}

const mediaTypeSql = Prisma.sql`CASE WHEN ma."content_type" LIKE 'image/%' THEN 'image' WHEN ma."content_type" LIKE 'video/%' THEN 'video' WHEN ma."content_type" LIKE 'audio/%' THEN 'audio' ELSE 'document' END`

export const createPrismaMediaBusinessMetricsRepository = (client) => ({
  businessMetrics: async (options = {}) => {
    const assetConditions = [Prisma.sql`TRUE`, mediaTypeCondition('ma', options.mediaType)]
    if (options.dateFrom) assetConditions.push(Prisma.sql`ma."created_at" >= ${new Date(options.dateFrom)}`)
    if (options.dateTo) assetConditions.push(Prisma.sql`ma."created_at" <= ${new Date(options.dateTo)}`)
    if (options.purpose) assetConditions.push(Prisma.sql`ma."purpose"::text = ${options.purpose}`)
    const assetWhere = Prisma.join(assetConditions, ' AND ')

    const jobConditions = [Prisma.sql`TRUE`, mediaTypeCondition('ma', options.mediaType)]
    if (options.dateFrom) jobConditions.push(Prisma.sql`msj."created_at" >= ${new Date(options.dateFrom)}`)
    if (options.dateTo) jobConditions.push(Prisma.sql`msj."created_at" <= ${new Date(options.dateTo)}`)
    if (options.purpose) jobConditions.push(Prisma.sql`ma."purpose"::text = ${options.purpose}`)
    const jobWhere = Prisma.join(jobConditions, ' AND ')

    const [capacityRows, mediaTypeRows, purposeRows, storageRows, scanRows] = await Promise.all([
      client.$queryRaw(Prisma.sql`
        SELECT COUNT(*)::int AS assets, COALESCE(SUM(ma."size_bytes"), 0)::bigint AS bytes,
          COUNT(*) FILTER (WHERE ma."deleted_at" IS NULL AND ma."archived_at" IS NULL)::int AS active_assets,
          COALESCE(SUM(ma."size_bytes") FILTER (WHERE ma."deleted_at" IS NULL AND ma."archived_at" IS NULL), 0)::bigint AS active_bytes,
          COUNT(*) FILTER (WHERE ma."deleted_at" IS NULL AND ma."archived_at" IS NOT NULL)::int AS archived_assets,
          COUNT(*) FILTER (WHERE ma."deleted_at" IS NOT NULL)::int AS deleted_assets,
          COALESCE(SUM(ma."size_bytes") FILTER (WHERE mso."state" = 'available'), 0)::bigint AS available_bytes,
          COALESCE(SUM(ma."size_bytes") FILTER (WHERE mso."state" = 'cleanup_pending'), 0)::bigint AS cleanup_pending_bytes
        FROM "media_assets" ma LEFT JOIN "media_storage_objects" mso ON mso."asset_id" = ma."id" WHERE ${assetWhere}`),
      client.$queryRaw(Prisma.sql`SELECT ${mediaTypeSql} AS key, COUNT(*)::int AS assets, COALESCE(SUM(ma."size_bytes"), 0)::bigint AS bytes FROM "media_assets" ma WHERE ${assetWhere} GROUP BY 1 ORDER BY bytes DESC, assets DESC, key ASC`),
      client.$queryRaw(Prisma.sql`SELECT ma."purpose"::text AS key, COUNT(*)::int AS assets, COALESCE(SUM(ma."size_bytes"), 0)::bigint AS bytes FROM "media_assets" ma WHERE ${assetWhere} GROUP BY 1 ORDER BY bytes DESC, assets DESC, key ASC`),
      client.$queryRaw(Prisma.sql`SELECT COALESCE(mso."state"::text, 'legacy') AS key, COUNT(*)::int AS assets, COALESCE(SUM(ma."size_bytes"), 0)::bigint AS bytes FROM "media_assets" ma LEFT JOIN "media_storage_objects" mso ON mso."asset_id" = ma."id" WHERE ${assetWhere} GROUP BY 1 ORDER BY bytes DESC, assets DESC, key ASC`),
      client.$queryRaw(Prisma.sql`
        WITH jobs AS (
          SELECT msj.*,
            CASE WHEN msj."status" IN ('queued', 'retrying') AND msj."timeout_at" <= CURRENT_TIMESTAMP THEN 'timed_out' ELSE msj."status"::text END AS effective_status,
            EXTRACT(EPOCH FROM (COALESCE(msj."callback_at", msj."reviewed_at", msj."failed_at", msj."updated_at") - COALESCE(msj."requested_at", msj."created_at"))) AS latency_seconds
          FROM "media_scan_jobs" msj JOIN "media_assets" ma ON ma."id" = msj."asset_id" WHERE ${jobWhere}
        )
        SELECT COUNT(*)::int AS jobs,
          COUNT(*) FILTER (WHERE effective_status = 'completed')::int AS completed,
          COUNT(*) FILTER (WHERE effective_status = 'failed')::int AS failed,
          COUNT(*) FILTER (WHERE effective_status = 'queued')::int AS queued,
          COUNT(*) FILTER (WHERE effective_status = 'retrying')::int AS retrying,
          COUNT(*) FILTER (WHERE effective_status = 'timed_out')::int AS timed_out,
          AVG(latency_seconds) FILTER (WHERE effective_status IN ('completed', 'failed') AND latency_seconds >= 0) AS average_latency_seconds,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_seconds) FILTER (WHERE effective_status IN ('completed', 'failed') AND latency_seconds >= 0) AS p95_latency_seconds,
          MIN(COALESCE("requested_at", "created_at")) FILTER (WHERE effective_status IN ('queued', 'retrying', 'timed_out')) AS oldest_backlog_at
        FROM jobs`),
    ])
    const capacity = capacityRows[0] ?? {}
    const scan = scanRows[0] ?? {}
    const completed = number(scan.completed)
    const failed = number(scan.failed)
    const queued = number(scan.queued)
    const retrying = number(scan.retrying)
    const timedOut = number(scan.timed_out)
    const oldestBacklogAt = scan.oldest_backlog_at ? new Date(scan.oldest_backlog_at) : null
    const grouped = (rows) => rows.map((row) => ({ key: String(row.key), assets: number(row.assets), bytes: number(row.bytes) }))
    return {
      schemaVersion: 1,
      window: { dateFrom: options.dateFrom ?? null, dateTo: options.dateTo ?? null, purpose: options.purpose ?? null, mediaType: options.mediaType ?? null, generatedAt: new Date().toISOString() },
      capacity: { assets: number(capacity.assets), bytes: number(capacity.bytes), activeAssets: number(capacity.active_assets), activeBytes: number(capacity.active_bytes), archivedAssets: number(capacity.archived_assets), deletedAssets: number(capacity.deleted_assets), availableBytes: number(capacity.available_bytes), cleanupPendingBytes: number(capacity.cleanup_pending_bytes) },
      byMediaType: grouped(mediaTypeRows),
      byPurpose: grouped(purposeRows),
      storage: { byState: grouped(storageRows) },
      scan: { jobs: number(scan.jobs), completed, failed, queued, retrying, timedOut, failurePercent: completed + failed > 0 ? Number((failed / (completed + failed) * 100).toFixed(2)) : 0, averageLatencySeconds: decimal(scan.average_latency_seconds), p95LatencySeconds: decimal(scan.p95_latency_seconds) },
      backlog: { total: queued + retrying + timedOut, queued, retrying, timedOut, oldestAgeHours: oldestBacklogAt ? decimal(Math.max(0, Date.now() - oldestBacklogAt.getTime()) / 3_600_000) : null },
    }
  },
})
