import { createHash } from 'node:crypto'
import { mediaAssetRetentionContract, mediaAssetRetentionCutoffs, mediaAssetRetentionSweepLimit } from './mediaAssetRetention.js'

const lock = (db, key) => db.$queryRawUnsafe('SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))', key)

const eligibilitySql = (idFilter = '') => `
  SELECT asset_row.id, asset_row.subject_ref AS "subjectRef", storage_row.state AS "storageState"
  FROM media_assets asset_row
  LEFT JOIN media_storage_objects storage_row ON storage_row.asset_id = asset_row.id
  WHERE asset_row.retention_redacted_at IS NULL
    AND asset_row.subject_ref IS NOT NULL
    ${idFilter}
    AND (
      (asset_row.deleted_at IS NOT NULL AND asset_row.deleted_at <= $1)
      OR (asset_row.status = 'rejected' AND asset_row.updated_at <= $2)
      OR (asset_row.status = 'pending' AND asset_row.updated_at <= $3)
    )
    AND (storage_row.state = 'deleted' OR (asset_row.status = 'pending' AND storage_row.asset_id IS NULL))
    AND NOT EXISTS (
      SELECT 1 FROM media_scan_jobs scan_row
      WHERE scan_row.asset_id = asset_row.id AND scan_row.status IN ('queued', 'retrying')
    )
    AND NOT EXISTS (
      SELECT 1 FROM data_rights_legal_holds hold_row
      WHERE hold_row.subject_ref = asset_row.subject_ref
        AND hold_row.scope_domain IN ('media', 'audit', 'safety')
        AND hold_row.released_at IS NULL
        AND hold_row.expires_at > $4
    )`

const tombstoneStorageKey = (assetId) => `retained/${createHash('sha256').update(`media-asset:${assetId}`).digest('hex')}`

export const createPrismaMediaAssetRetentionRepository = (client, { recordAudit }) => ({
  sweepRetention: async ({ now = new Date(), limit } = {}) => {
    const cutoffs = mediaAssetRetentionCutoffs(now)
    const take = mediaAssetRetentionSweepLimit(limit)
    const discovered = await client.$queryRawUnsafe(
      `${eligibilitySql()} ORDER BY COALESCE(asset_row.deleted_at, asset_row.updated_at), asset_row.id LIMIT $5`,
      cutoffs.deleted, cutoffs.rejected, cutoffs.abandonedPending, now, take,
    )
    if (!discovered.length) return { policyId: mediaAssetRetentionContract.policyId, inspected: 0, recordsRedacted: 0, blocked: 0, relatedRecordsMinimized: 0 }

    return client.$transaction(async (db) => {
      await lock(db, 'security-retention-legal-holds')
      for (const subjectRef of [...new Set(discovered.map((row) => row.subjectRef))].sort()) await lock(db, `data-rights-subject-ref:${subjectRef}`)
      for (const row of discovered) await lock(db, `media-asset:${row.id}`)

      let recordsRedacted = 0
      let relatedRecordsMinimized = 0
      for (const row of discovered) {
        const eligible = await db.$queryRawUnsafe(
          `${eligibilitySql('AND asset_row.id = $5')} LIMIT 1`,
          cutoffs.deleted, cutoffs.rejected, cutoffs.abandonedPending, now, row.id,
        )
        if (!eligible.length) continue

        const minimized = []
        minimized.push(await db.profilePortfolioAsset.updateMany({ where: { assetId: row.id }, data: {
          ownerId: null, sourceGenerationId: null, sourceSubmissionId: null, title: '[deleted]', caption: '',
          status: 'archived', publishedAt: null, withdrawnAt: null, archivedAt: now,
        } }))
        minimized.push(await db.taskSubmissionAsset.updateMany({ where: { assetId: row.id }, data: { ownerId: null } }))
        minimized.push(await db.creativeGenerationAsset.updateMany({ where: { assetId: row.id }, data: { ownerId: null } }))
        minimized.push(await db.chatTurnInputAsset.updateMany({ where: { assetId: row.id }, data: { ownerId: null } }))
        minimized.push(await db.mediaAssetRelation.updateMany({ where: { OR: [{ sourceAssetId: row.id }, { targetAssetId: row.id }] }, data: {
          ownerId: null, sourceGenerationId: null, targetWorkspace: null, role: null,
        } }))
        minimized.push(await db.libraryItem.deleteMany({ where: { sourceType: 'asset', sourceId: row.id } }))
        minimized.push(await db.mediaScanJob.updateMany({ where: { assetId: row.id }, data: {
          externalScanId: null, reviewedById: null, note: null, rejectionReason: null, metadata: null,
        } }))
        const minimizedCount = minimized.reduce((total, result) => total + result.count, 0)
        relatedRecordsMinimized += minimizedCount

        await db.$executeRawUnsafe(`
          UPDATE creative_generations
          SET input_asset_ids = array_remove(input_asset_ids, $1),
              output_asset_ids = array_remove(output_asset_ids, $1)
          WHERE retention_redacted_at IS NULL
            AND ($1 = ANY(input_asset_ids) OR $1 = ANY(output_asset_ids))`, row.id)
        await db.$executeRawUnsafe('UPDATE task_submissions SET asset_ids = array_remove(asset_ids, $1) WHERE retention_redacted_at IS NULL AND $1 = ANY(asset_ids)', row.id)
        await db.$executeRawUnsafe('UPDATE chat_turns SET input_asset_ids = array_remove(input_asset_ids, $1) WHERE $1 = ANY(input_asset_ids)', row.id)

        await db.mediaStorageObject.updateMany({ where: { assetId: row.id }, data: {
          etag: null, checksumSha256: null, verifiedSizeBytes: null, verifiedContentType: null,
          verifiedAt: null, quarantinedAt: null, cleanupAfter: null, lastErrorCode: null,
        } })

        const summary = {
          policyId: mediaAssetRetentionContract.policyId,
          schemaVersion: 1,
          objectDeletionVerified: eligible[0].storageState === 'deleted',
          objectNeverPersisted: eligible[0].storageState == null,
          relatedRecordsMinimized: minimizedCount,
        }
        await db.$executeRawUnsafe(`
          WITH maintenance AS (
            SELECT set_config('app.media_asset_retention_maintenance', 'on', true)
          )
          UPDATE media_assets
          SET owner_id = NULL,
              subject_ref = NULL,
              file_name = '[deleted]',
              storage_key = $2,
              content_type = 'application/octet-stream',
              size_bytes = 0,
              status = 'rejected',
              metadata = NULL,
              metadata_schema_version = 1,
              archived_at = NULL,
              deleted_by_handle = NULL,
              deletion_reason = 'retention_expired',
              retention_summary = $3::jsonb,
              retention_summary_schema_version = 1,
              retention_redacted_at = $4,
              updated_at = $4
          FROM maintenance
          WHERE id = $1 AND retention_redacted_at IS NULL`,
        row.id, tombstoneStorageKey(row.id), JSON.stringify(summary), now)
        recordsRedacted += 1
      }

      const blocked = discovered.length - recordsRedacted
      await recordAudit({
        actor: null,
        action: 'system.media.assets.retention_redacted',
        resourceType: 'media_asset_retention',
        resourceId: mediaAssetRetentionContract.policyId,
        metadata: { inspected: discovered.length, recordsRedacted, blocked, relatedRecordsMinimized },
      }, db)
      return { policyId: mediaAssetRetentionContract.policyId, inspected: discovered.length, recordsRedacted, blocked, relatedRecordsMinimized }
    }, { isolationLevel: 'ReadCommitted' })
  },
})
