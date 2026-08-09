import {
  buildConfigurationRetentionSummary,
  configurationRetentionContract,
  configurationRetentionCutoff,
  configurationRetentionSweepLimit,
} from './configurationRetention.js'

const lock = (db, key) => db.$queryRawUnsafe('SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))', key)

const candidatesSql = `
  SELECT kind, id, scope_key, eligible_at
  FROM (
    SELECT 'system_revision'::text AS kind, revision.id, revision.setting_key AS scope_key,
      (SELECT MIN(next_revision.created_at) FROM system_setting_revisions next_revision WHERE next_revision.previous_revision_id = revision.id) AS eligible_at
    FROM system_setting_revisions revision
    WHERE revision.retention_redacted_at IS NULL
      AND EXISTS (SELECT 1 FROM system_setting_revisions next_revision WHERE next_revision.previous_revision_id = revision.id AND next_revision.created_at <= $1)
      AND NOT EXISTS (SELECT 1 FROM system_settings setting_row WHERE setting_row.current_revision_id = revision.id)
      AND NOT EXISTS (SELECT 1 FROM system_setting_changes change_row WHERE change_row.target_revision_id = revision.id AND change_row.status IN ('pending_approval', 'approved'))
    UNION ALL
    SELECT 'resource_revision'::text AS kind, revision.id, revision.resource_id AS scope_key,
      (SELECT MIN(next_revision.created_at) FROM config_resource_revisions next_revision WHERE next_revision.previous_revision_id = revision.id) AS eligible_at
    FROM config_resource_revisions revision
    WHERE revision.retention_redacted_at IS NULL
      AND EXISTS (SELECT 1 FROM config_resource_revisions next_revision WHERE next_revision.previous_revision_id = revision.id AND next_revision.created_at <= $1)
      AND NOT EXISTS (SELECT 1 FROM config_resources resource WHERE resource.current_revision_id = revision.id)
    UNION ALL
    SELECT 'system_change'::text AS kind, change_row.id, change_row.setting_key AS scope_key,
      COALESCE(change_row.published_at, change_row.rejected_at) AS eligible_at
    FROM system_setting_changes change_row
    WHERE change_row.retention_redacted_at IS NULL
      AND change_row.status IN ('published', 'rejected')
      AND COALESCE(change_row.published_at, change_row.rejected_at) <= $1
  ) candidates
  ORDER BY eligible_at, kind, id
  LIMIT $2`

const settingRevisionEligible = async (db, id, cutoff) => (await db.$queryRawUnsafe(`
  SELECT revision.id
  FROM system_setting_revisions revision
  WHERE revision.id = $1 AND revision.retention_redacted_at IS NULL
    AND EXISTS (SELECT 1 FROM system_setting_revisions next_revision WHERE next_revision.previous_revision_id = revision.id AND next_revision.created_at <= $2)
    AND NOT EXISTS (SELECT 1 FROM system_settings setting_row WHERE setting_row.current_revision_id = revision.id)
    AND NOT EXISTS (SELECT 1 FROM system_setting_changes change_row WHERE change_row.target_revision_id = revision.id AND change_row.status IN ('pending_approval', 'approved'))
`, id, cutoff)).length === 1

const resourceRevisionEligible = async (db, id, cutoff) => (await db.$queryRawUnsafe(`
  SELECT revision.id
  FROM config_resource_revisions revision
  WHERE revision.id = $1 AND revision.retention_redacted_at IS NULL
    AND EXISTS (SELECT 1 FROM config_resource_revisions next_revision WHERE next_revision.previous_revision_id = revision.id AND next_revision.created_at <= $2)
    AND NOT EXISTS (SELECT 1 FROM config_resources resource WHERE resource.current_revision_id = revision.id)
`, id, cutoff)).length === 1

export const createPrismaConfigurationRetentionRepository = (client, { recordAudit }) => ({
  sweepRetention: async ({ now = new Date(), limit } = {}) => {
    const cutoff = configurationRetentionCutoff(now)
    const take = configurationRetentionSweepLimit(limit)
    const discovered = await client.$queryRawUnsafe(candidatesSql, cutoff, take)
    if (!discovered.length) return { policyId: configurationRetentionContract.policyId, inspected: 0, revisionsMinimized: 0, changesMinimized: 0, blocked: 0 }

    return client.$transaction(async (db) => {
      for (const scopeKey of [...new Set(discovered.map((row) => `${row.kind === 'resource_revision' ? 'configuration-resource' : 'configuration-system-setting'}:${row.scope_key}`))].sort()) {
        await lock(db, scopeKey)
      }
      let revisionsMinimized = 0
      let changesMinimized = 0
      for (const candidate of discovered) {
        if (candidate.kind === 'system_revision') {
          if (!await settingRevisionEligible(db, candidate.id, cutoff)) continue
          const row = await db.systemSettingRevision.findUnique({ where: { id: candidate.id } })
          if (!row || row.value == null) continue
          const previous = row.previousRevisionId ? await db.systemSettingRevision.findUnique({ where: { id: row.previousRevisionId }, select: { value: true } }) : null
          const retentionSummary = buildConfigurationRetentionSummary({ value: row.value, previousValue: previous?.value, contentHash: row.contentHash })
          await db.$executeRawUnsafe(`
            WITH maintenance AS MATERIALIZED (
              SELECT set_config('app.configuration_retention_maintenance', 'on', true)
            )
            UPDATE system_setting_revisions revision
            SET value = NULL, actor_ref = NULL, retention_summary = $2::jsonb,
              retention_summary_schema_version = 1, retention_redacted_at = $3
            FROM maintenance
            WHERE revision.id = $1
          `, row.id, JSON.stringify(retentionSummary), now)
          revisionsMinimized += 1
        } else if (candidate.kind === 'resource_revision') {
          if (!await resourceRevisionEligible(db, candidate.id, cutoff)) continue
          const row = await db.configResourceRevision.findUnique({ where: { id: candidate.id } })
          if (!row || row.value == null) continue
          const previous = row.previousRevisionId ? await db.configResourceRevision.findUnique({
            where: { id: row.previousRevisionId },
            select: { title: true, description: true, value: true },
          }) : null
          const retentionSummary = buildConfigurationRetentionSummary({
            value: { title: row.title, description: row.description, value: row.value },
            previousValue: previous?.value == null ? undefined : { title: previous.title, description: previous.description, value: previous.value },
            contentHash: row.contentHash,
          })
          await db.$executeRawUnsafe(`
            WITH maintenance AS MATERIALIZED (
              SELECT set_config('app.configuration_retention_maintenance', 'on', true)
            )
            UPDATE config_resource_revisions revision
            SET title = NULL, description = NULL, value = NULL, actor_ref = NULL,
              retention_summary = $2::jsonb, retention_summary_schema_version = 1, retention_redacted_at = $3
            FROM maintenance
            WHERE revision.id = $1
          `, row.id, JSON.stringify(retentionSummary), now)
          revisionsMinimized += 1
        } else {
          const row = await db.systemSettingChange.findUnique({ where: { id: candidate.id } })
          const terminalAt = row?.publishedAt ?? row?.rejectedAt
          if (!row || row.retentionRedactedAt || !configurationRetentionContract.terminalChangeStatuses.includes(row.status) || !terminalAt || terminalAt > cutoff || row.candidateValue == null) continue
          const retentionSummary = buildConfigurationRetentionSummary({ value: row.candidateValue })
          await db.$executeRawUnsafe(`
            WITH maintenance AS MATERIALIZED (
              SELECT set_config('app.configuration_retention_maintenance', 'on', true)
            )
            UPDATE system_setting_changes change_row
            SET candidate_value = NULL, diff = NULL, requested_by_ref = NULL, approved_by_ref = NULL,
              rejected_by_ref = NULL, published_by_ref = NULL, note = NULL, retention_summary = $2::jsonb,
              retention_summary_schema_version = 1, retention_redacted_at = $3, updated_at = $3
            FROM maintenance
            WHERE change_row.id = $1
          `, row.id, JSON.stringify(retentionSummary), now)
          changesMinimized += 1
        }
      }
      const minimized = revisionsMinimized + changesMinimized
      const blocked = discovered.length - minimized
      await recordAudit({ actor: null, action: 'system.configuration.retention_minimized', resourceType: 'configuration_retention', resourceId: configurationRetentionContract.policyId, metadata: { inspected: discovered.length, revisionsMinimized, changesMinimized, blocked } }, db)
      return { policyId: configurationRetentionContract.policyId, inspected: discovered.length, revisionsMinimized, changesMinimized, blocked }
    }, { isolationLevel: 'ReadCommitted' })
  },
})
