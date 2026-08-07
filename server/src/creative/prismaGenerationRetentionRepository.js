import { generationRetentionContract, generationRetentionCutoffs, generationRetentionSweepLimit, retainGenerationSummary } from './generationRetention.js'

const lock = (db, key) => db.$queryRawUnsafe('SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))', key)

const eligibilitySql = (idFilter = '') => `
  SELECT generation_row.id
  FROM creative_generations generation_row
  WHERE generation_row.status IN ('completed', 'failed', 'cancelled')
    AND generation_row.retention_redacted_at IS NULL
    ${idFilter}
    AND COALESCE(generation_row.completed_at, generation_row.failed_at, generation_row.updated_at) <= $1
    AND COALESCE(generation_row.safety->>'reviewRequired', 'false') = 'false'
    AND NOT EXISTS (
      SELECT 1 FROM moderation_cases case_row
      WHERE case_row.id = generation_row.safety->>'moderationCaseId'
        AND (
          NOT EXISTS (SELECT 1 FROM moderation_decisions decision_row WHERE decision_row.case_id = case_row.id AND decision_row.stage = 'original')
          OR EXISTS (
            SELECT 1 FROM moderation_appeals appeal_row
            WHERE appeal_row.case_id = case_row.id
              AND NOT EXISTS (SELECT 1 FROM moderation_decisions decision_row WHERE decision_row.case_id = case_row.id AND decision_row.stage = 'appeal')
          )
          OR (
            NOT EXISTS (SELECT 1 FROM moderation_appeals appeal_row WHERE appeal_row.case_id = case_row.id)
            AND EXISTS (SELECT 1 FROM moderation_decisions decision_row WHERE decision_row.case_id = case_row.id AND decision_row.stage = 'original' AND decision_row.created_at + INTERVAL '30 days' > $2)
          )
        )
    )
    AND NOT EXISTS (SELECT 1 FROM creative_provider_operations row WHERE row.generation_id = generation_row.id AND (row.status NOT IN ('completed', 'failed', 'cancelled', 'timed_out') OR row.side_effects_complete = false))
    AND NOT EXISTS (SELECT 1 FROM creative_provider_retry_states row WHERE row.generation_id = generation_row.id AND row.status = 'scheduled')
    AND NOT EXISTS (SELECT 1 FROM creative_output_ingestions row WHERE row.generation_id = generation_row.id AND row.status IN ('pending', 'claimed', 'stored', 'scanning'))
    AND NOT EXISTS (SELECT 1 FROM creative_generation_mutations row WHERE row.generation_id = generation_row.id AND row.status IN ('requested', 'pending_review', 'approved', 'processing'))
    AND NOT EXISTS (SELECT 1 FROM creative_provider_cost_ledgers row WHERE row.generation_id = generation_row.id AND row.status IN ('reserved', 'reconciliation_required'))
    AND NOT EXISTS (SELECT 1 FROM creative_credit_ledger row WHERE row.generation_id = generation_row.id AND row.status = 'reserved')
    AND NOT EXISTS (SELECT 1 FROM creative_quota_reservations row WHERE row.generation_id = generation_row.id AND row.status = 'reserved')
    AND NOT EXISTS (
      SELECT 1 FROM data_rights_legal_holds hold_row
      WHERE hold_row.scope_domain IN ('audit', 'safety') AND hold_row.released_at IS NULL AND hold_row.expires_at > $2
        AND (hold_row.subject_ref = generation_row.subject_ref OR generation_row.subject_ref IS NULL)
    )`

export const createPrismaGenerationRetentionRepository = (client, { recordAudit }) => ({
  sweepRetention: async ({ now = new Date(), limit } = {}) => {
    const cutoffs = generationRetentionCutoffs(now)
    const take = generationRetentionSweepLimit(limit)
    const discovered = await client.$queryRawUnsafe(`${eligibilitySql()} AND (generation_row.retention_preview_redacted_at IS NULL OR COALESCE(generation_row.completed_at, generation_row.failed_at, generation_row.updated_at) <= $3) ORDER BY generation_row.updated_at, generation_row.id LIMIT $4`, cutoffs.preview, now, cutoffs.full, take)
    if (!discovered.length) return { policyId: generationRetentionContract.policyId, inspected: 0, previewsRedacted: 0, recordsRedacted: 0, blocked: 0 }

    return client.$transaction(async (db) => {
      await lock(db, 'security-retention-legal-holds')
      for (const row of discovered) await lock(db, `creative-generation:${row.id}`)
      await db.$executeRawUnsafe("SET LOCAL app.generation_retention_maintenance = 'on'")
      let previewsRedacted = 0
      let recordsRedacted = 0
      for (const discoveredRow of discovered) {
        const rows = await db.$queryRawUnsafe(`${eligibilitySql('AND generation_row.id = $3')} LIMIT 1`, cutoffs.preview, now, discoveredRow.id)
        if (!rows.length) continue
        const current = await db.creativeGeneration.findUnique({ where: { id: discoveredRow.id } })
        const terminalAt = current.completedAt ?? current.failedAt ?? current.updatedAt
        if (!current.retentionPreviewRedactedAt && terminalAt <= cutoffs.preview) {
          await db.creativeGeneration.update({ where: { id: current.id }, data: { promptPreview: null, errorMessagePreview: null, retentionPreviewRedactedAt: now } })
          previewsRedacted += 1
        }
        if (terminalAt <= cutoffs.full) {
          await db.creativeGeneration.update({ where: { id: current.id }, data: {
            actorId: null, actorHandle: null, subjectRef: null,
            inputAssetIds: [], outputAssetIds: [], providerRequestId: null, providerJobId: null,
            usage: retainGenerationSummary(current.usage), credit: retainGenerationSummary(current.credit), quota: retainGenerationSummary(current.quota),
            safety: retainGenerationSummary(current.safety), policy: retainGenerationSummary(current.policy),
            retentionRedactedAt: now,
          } })
          recordsRedacted += 1
        }
      }
      const blocked = discovered.length - Math.max(previewsRedacted, recordsRedacted)
      await recordAudit({ actor: null, action: 'system.creative.generations.retention_redacted', resourceType: 'generation_retention', resourceId: generationRetentionContract.policyId, metadata: { inspected: discovered.length, previewsRedacted, recordsRedacted, blocked } }, db)
      return { policyId: generationRetentionContract.policyId, inspected: discovered.length, previewsRedacted, recordsRedacted, blocked }
    }, { isolationLevel: 'ReadCommitted' })
  },
})
