import {
  providerLifecycleRetentionContract,
  providerLifecycleRetentionCutoff,
  providerLifecycleRetentionSweepLimit,
  retainedProviderKey,
  retainProviderJsonEvidence,
} from './providerLifecycleRetention.js'

const lock = (db, key) => db.$queryRawUnsafe('SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))', key)

const eligibilitySql = (idFilter = '') => `
  SELECT generation_row.id
  FROM creative_generations generation_row
  WHERE generation_row.status IN ('completed', 'failed', 'cancelled')
    ${idFilter}
    AND COALESCE(generation_row.completed_at, generation_row.failed_at, generation_row.updated_at) <= $1
    AND EXISTS (
      SELECT 1 FROM creative_provider_operations row WHERE row.generation_id = generation_row.id AND row.retention_redacted_at IS NULL
      UNION ALL SELECT 1 FROM creative_generation_mutations row WHERE row.generation_id = generation_row.id AND row.retention_redacted_at IS NULL
      UNION ALL SELECT 1 FROM creative_provider_replay_ledger row WHERE row.generation_id = generation_row.id AND row.retention_redacted_at IS NULL
      UNION ALL SELECT 1 FROM creative_output_ingestions row WHERE row.generation_id = generation_row.id AND row.retention_redacted_at IS NULL
      UNION ALL SELECT 1 FROM creative_provider_retry_states row WHERE row.generation_id = generation_row.id AND row.retention_redacted_at IS NULL
    )
    AND NOT EXISTS (SELECT 1 FROM creative_provider_operations row WHERE row.generation_id = generation_row.id AND (row.status NOT IN ('completed', 'failed', 'cancelled', 'timed_out') OR row.side_effects_complete = false OR row.updated_at > $1))
    AND NOT EXISTS (SELECT 1 FROM creative_generation_mutations row WHERE row.generation_id = generation_row.id AND (row.status NOT IN ('succeeded', 'failed', 'rejected') OR row.updated_at > $1))
    AND NOT EXISTS (SELECT 1 FROM creative_output_ingestions row WHERE row.generation_id = generation_row.id AND (row.status NOT IN ('completed', 'failed') OR row.updated_at > $1))
    AND NOT EXISTS (SELECT 1 FROM creative_provider_retry_states row WHERE row.generation_id = generation_row.id AND (row.status NOT IN ('exhausted', 'cleared') OR row.updated_at > $1))
    AND NOT EXISTS (SELECT 1 FROM creative_provider_replay_ledger row WHERE row.generation_id = generation_row.id AND row.updated_at > $1)
    AND NOT EXISTS (SELECT 1 FROM creative_provider_cost_ledgers row WHERE row.generation_id = generation_row.id AND row.status IN ('reserved', 'reconciliation_required'))
    AND NOT EXISTS (SELECT 1 FROM creative_credit_ledger row WHERE row.generation_id = generation_row.id AND row.status = 'reserved')
    AND NOT EXISTS (SELECT 1 FROM creative_quota_reservations row WHERE row.generation_id = generation_row.id AND row.status = 'reserved')
    AND NOT EXISTS (SELECT 1 FROM accounting_reconciliation_issues row WHERE row.source_id = generation_row.id AND row.status IN ('open', 'repair_pending'))
    AND COALESCE(generation_row.safety->>'reviewRequired', 'false') = 'false'
    AND NOT EXISTS (
      SELECT 1 FROM moderation_cases case_row
      WHERE case_row.id = generation_row.safety->>'moderationCaseId'
        AND (NOT EXISTS (SELECT 1 FROM moderation_decisions row WHERE row.case_id = case_row.id AND row.stage = 'original')
          OR EXISTS (SELECT 1 FROM moderation_appeals appeal_row WHERE appeal_row.case_id = case_row.id AND NOT EXISTS (SELECT 1 FROM moderation_decisions row WHERE row.case_id = case_row.id AND row.stage = 'appeal')))
    )
    AND NOT EXISTS (
      SELECT 1 FROM data_rights_legal_holds hold_row
      WHERE hold_row.scope_domain IN ('audit', 'safety') AND hold_row.released_at IS NULL AND hold_row.expires_at > $2
        AND (hold_row.subject_ref = generation_row.subject_ref OR generation_row.subject_ref IS NULL)
    )`

const minimizeOperation = (row, now) => ({
  providerJobId: null,
  nextPollAt: null,
  safeMetadata: retainProviderJsonEvidence(row.safeMetadata),
  retentionRedactedAt: now,
})

const minimizeMutation = (row, now) => ({
  idempotencyKey: retainedProviderKey('mutation', row.idempotencyKey),
  requestedById: null,
  requestedByHandle: null,
  notePreview: null,
  reviewId: null,
  targetGenerationId: null,
  safeMetadata: retainProviderJsonEvidence(row.safeMetadata),
  result: retainProviderJsonEvidence(row.result),
  retentionRedactedAt: now,
})

const minimizeReplay = (row, now) => ({
  providerJobId: null,
  providerEventId: null,
  idempotencyKey: retainedProviderKey('replay', row.idempotencyKey),
  sideEffectPlan: retainProviderJsonEvidence(row.sideEffectPlan),
  sideEffectResult: retainProviderJsonEvidence(row.sideEffectResult),
  errorPreview: null,
  retentionRedactedAt: now,
})

const minimizeIngestion = (row, now) => ({
  sourceKey: retainedProviderKey('ingestion', row.sourceKey),
  providerJobId: null,
  mediaAssetId: null,
  storageKey: null,
  claimToken: null,
  claimedAt: null,
  leaseExpiresAt: null,
  retentionRedactedAt: now,
})

const minimizeRetry = (row, now) => ({
  sourceKey: retainedProviderKey('retry', row.sourceKey),
  nextAttemptAt: null,
  delaySource: null,
  retentionRedactedAt: now,
})

export const createPrismaProviderLifecycleRetentionRepository = (client, { recordAudit }) => ({
  sweepRetention: async ({ now = new Date(), limit } = {}) => {
    const cutoff = providerLifecycleRetentionCutoff(now)
    const take = providerLifecycleRetentionSweepLimit(limit)
    const discovered = await client.$queryRawUnsafe(`${eligibilitySql()} ORDER BY generation_row.updated_at, generation_row.id LIMIT $3`, cutoff, now, take)
    if (!discovered.length) return { policyId: providerLifecycleRetentionContract.policyId, inspected: 0, generationsMinimized: 0, recordsMinimized: 0, blocked: 0 }

    return client.$transaction(async (db) => {
      await lock(db, 'security-retention-legal-holds')
      for (const row of discovered) await lock(db, `creative-generation:${row.id}`)
      await db.$executeRawUnsafe("SET LOCAL app.provider_lifecycle_retention_maintenance = 'on'")
      let generationsMinimized = 0
      let recordsMinimized = 0
      for (const item of discovered) {
        const eligible = await db.$queryRawUnsafe(`${eligibilitySql('AND generation_row.id = $3')} LIMIT 1`, cutoff, now, item.id)
        if (!eligible.length) continue
        const operations = await db.creativeProviderOperation.findMany({ where: { generationId: item.id, retentionRedactedAt: null } })
        const mutations = await db.creativeGenerationMutation.findMany({ where: { generationId: item.id, retentionRedactedAt: null } })
        const replays = await db.creativeProviderReplayLedger.findMany({ where: { generationId: item.id, retentionRedactedAt: null } })
        const ingestions = await db.creativeOutputIngestion.findMany({ where: { generationId: item.id, retentionRedactedAt: null } })
        const retries = await db.creativeProviderRetryState.findMany({ where: { generationId: item.id, retentionRedactedAt: null } })
        for (const row of operations) await db.creativeProviderOperation.update({ where: { id: row.id }, data: minimizeOperation(row, now) })
        for (const row of mutations) await db.creativeGenerationMutation.update({ where: { id: row.id }, data: minimizeMutation(row, now) })
        for (const row of replays) await db.creativeProviderReplayLedger.update({ where: { id: row.id }, data: minimizeReplay(row, now) })
        for (const row of ingestions) await db.creativeOutputIngestion.update({ where: { id: row.id }, data: minimizeIngestion(row, now) })
        for (const row of retries) await db.creativeProviderRetryState.update({ where: { id: row.id }, data: minimizeRetry(row, now) })
        const count = operations.length + mutations.length + replays.length + ingestions.length + retries.length
        if (count) generationsMinimized += 1
        recordsMinimized += count
      }
      const blocked = discovered.length - generationsMinimized
      await recordAudit({ actor: null, action: 'system.creative.provider_lifecycle.retention_redacted', resourceType: 'provider_lifecycle_retention', resourceId: providerLifecycleRetentionContract.policyId, metadata: { inspected: discovered.length, generationsMinimized, recordsMinimized, blocked } }, db)
      return { policyId: providerLifecycleRetentionContract.policyId, inspected: discovered.length, generationsMinimized, recordsMinimized, blocked }
    }, { isolationLevel: 'ReadCommitted' })
  },
})
