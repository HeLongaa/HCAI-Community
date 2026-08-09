import {
  isModerationBulkRetentionEligible,
  isModerationRuleRetentionEligible,
  moderationOperationalRetentionContract,
} from './moderationOperationalRetention.js'
import { moderationRetentionCutoff, moderationRetentionSweepLimit } from './moderationRetention.js'

const lock = (db, key) => db.$queryRawUnsafe(
  'SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))',
  key,
)

const discoverCandidates = (db, cutoff, now, take) => db.$queryRawUnsafe(`
  WITH latest_rule_transition AS (
    SELECT DISTINCT ON (transition_row.rule_version_id)
      transition_row.rule_version_id,
      transition_row.to_state,
      transition_row.created_at
    FROM safety_rule_transitions transition_row
    ORDER BY transition_row.rule_version_id, transition_row.created_at DESC, transition_row.id DESC
  ), candidates AS (
    SELECT 'rule'::text AS kind, rule_row.id, latest.created_at AS terminal_at
    FROM safety_rule_versions rule_row
    JOIN latest_rule_transition latest ON latest.rule_version_id = rule_row.id
    WHERE rule_row.retention_redacted_at IS NULL
      AND latest.to_state = 'retired'
      AND latest.created_at <= $1
      AND NOT EXISTS (
        SELECT 1 FROM data_rights_legal_holds hold_row
        WHERE hold_row.scope_domain IN ('audit', 'safety')
          AND hold_row.released_at IS NULL
          AND hold_row.expires_at > $2
          AND (
            hold_row.subject_ref = rule_row.created_by_subject_ref
            OR hold_row.subject_ref IN (
              SELECT transition_row.actor_subject_ref
              FROM safety_rule_transitions transition_row
              WHERE transition_row.rule_version_id = rule_row.id
                AND transition_row.actor_subject_ref IS NOT NULL
            )
          )
      )
      AND (
        rule_row.created_by_subject_ref IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM safety_rule_transitions transition_row
          WHERE transition_row.rule_version_id = rule_row.id
            AND transition_row.actor_subject_ref IS NOT NULL
        )
        OR NOT EXISTS (
          SELECT 1 FROM data_rights_legal_holds hold_row
          WHERE hold_row.scope_domain IN ('audit', 'safety')
            AND hold_row.released_at IS NULL
            AND hold_row.expires_at > $2
        )
      )
    UNION ALL
    SELECT 'bulk'::text AS kind, bulk_row.id, bulk_row.created_at AS terminal_at
    FROM moderation_bulk_operations bulk_row
    WHERE bulk_row.retention_redacted_at IS NULL
      AND bulk_row.created_at <= $1
      AND NOT EXISTS (
        SELECT 1 FROM data_rights_legal_holds hold_row
        WHERE hold_row.scope_domain IN ('audit', 'safety')
          AND hold_row.released_at IS NULL
          AND hold_row.expires_at > $2
          AND hold_row.subject_ref = bulk_row.actor_subject_ref
      )
      AND (
        bulk_row.actor_subject_ref IS NOT NULL
        OR NOT EXISTS (
          SELECT 1 FROM data_rights_legal_holds hold_row
          WHERE hold_row.scope_domain IN ('audit', 'safety')
            AND hold_row.released_at IS NULL
            AND hold_row.expires_at > $2
        )
      )
  )
  SELECT kind, id
  FROM candidates
  ORDER BY terminal_at ASC, kind ASC, id ASC
  LIMIT $3
`, cutoff, now, take)

const loadCandidates = async (db, discovered) => {
  const ruleIds = discovered.filter((item) => item.kind === 'rule').map((item) => item.id)
  const bulkIds = discovered.filter((item) => item.kind === 'bulk').map((item) => item.id)
  const [rules, bulkOperations] = await Promise.all([
    ruleIds.length ? db.safetyRuleVersion.findMany({
      where: { id: { in: ruleIds }, retentionRedactedAt: null },
      select: {
        id: true,
        ruleKey: true,
        createdBySubjectRef: true,
        retentionRedactedAt: true,
        transitions: { select: { actorSubjectRef: true, toState: true, createdAt: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      },
    }) : [],
    bulkIds.length ? db.moderationBulkOperation.findMany({
      where: { id: { in: bulkIds }, retentionRedactedAt: null },
      select: { id: true, idempotencyHash: true, actorSubjectRef: true, action: true, targetHash: true, targetCount: true, result: true, createdAt: true, retentionRedactedAt: true },
    }) : [],
  ])
  const order = new Map(discovered.map((item, index) => [`${item.kind}:${item.id}`, index]))
  return [
    ...rules.map((item) => ({ kind: 'rule', item })),
    ...bulkOperations.map((item) => ({ kind: 'bulk', item })),
  ].sort((left, right) => order.get(`${left.kind}:${left.item.id}`) - order.get(`${right.kind}:${right.item.id}`))
}

const subjectRefsFor = (candidate) => candidate.kind === 'rule'
  ? [candidate.item.createdBySubjectRef, ...candidate.item.transitions.map((transition) => transition.actorSubjectRef)].filter(Boolean)
  : [candidate.item.actorSubjectRef].filter(Boolean)

export const createPrismaModerationOperationalRetentionRepository = (client, { recordAudit }) => ({
  sweepRetention: async ({ now = new Date(), limit } = {}) => {
    const cutoff = moderationRetentionCutoff(now)
    const take = moderationRetentionSweepLimit(limit)
    const discovered = await discoverCandidates(client, cutoff, now, take)
    if (discovered.length === 0) return { policyId: moderationOperationalRetentionContract.policyId, inspected: 0, redacted: 0, blocked: 0, rulesRedacted: 0, bulkOperationsRedacted: 0 }

    return client.$transaction(async (db) => {
      await lock(db, 'security-retention-legal-holds')
      const initial = await loadCandidates(db, discovered)
      for (const ruleKey of [...new Set(initial.filter((candidate) => candidate.kind === 'rule').map((candidate) => candidate.item.ruleKey))].sort()) {
        await lock(db, `safety-rule-key:${ruleKey}`)
      }
      for (const hash of [...new Set(initial.filter((candidate) => candidate.kind === 'bulk').map((candidate) => candidate.item.idempotencyHash))].sort()) {
        await lock(db, `moderation-bulk-idempotency:${hash}`)
      }
      const subjectRefs = [...new Set(initial.flatMap(subjectRefsFor))].sort()
      for (const subjectRef of subjectRefs) await lock(db, `data-rights-subject-ref:${subjectRef}`)

      const candidates = await loadCandidates(db, discovered)
      const matchingHolds = subjectRefs.length ? await db.dataRightsLegalHold.findMany({
        where: { subjectRef: { in: subjectRefs }, scopeDomain: { in: moderationOperationalRetentionContract.legalHoldScopeDomains }, releasedAt: null, expiresAt: { gt: now } },
        select: { subjectRef: true },
      }) : []
      const activeHoldCount = candidates.some((candidate) => subjectRefsFor(candidate).length === 0) ? await db.dataRightsLegalHold.count({
        where: { scopeDomain: { in: moderationOperationalRetentionContract.legalHoldScopeDomains }, releasedAt: null, expiresAt: { gt: now } },
      }) : 0
      const heldSubjectRefs = new Set(matchingHolds.map((hold) => hold.subjectRef))
      await db.$executeRawUnsafe("SET LOCAL app.moderation_retention_maintenance = 'on'")
      let rulesRedacted = 0
      let bulkOperationsRedacted = 0

      for (const candidate of candidates) {
        const refs = subjectRefsFor(candidate)
        if (refs.some((subjectRef) => heldSubjectRefs.has(subjectRef)) || (refs.length === 0 && activeHoldCount > 0)) continue
        if (candidate.kind === 'rule') {
          if (!isModerationRuleRetentionEligible(candidate.item, cutoff)) continue
          const changed = await db.safetyRuleVersion.updateMany({
            where: { id: candidate.item.id, retentionRedactedAt: null },
            data: { createdById: null, createdBySubjectRef: null, retentionRedactedAt: now },
          })
          if (changed.count !== 1) continue
          await db.safetyRuleTransition.updateMany({ where: { ruleVersionId: candidate.item.id }, data: { actorId: null, actorSubjectRef: null } })
          rulesRedacted += 1
          continue
        }
        if (!isModerationBulkRetentionEligible(candidate.item, cutoff)) continue
        const result = candidate.item.result && typeof candidate.item.result === 'object' && !Array.isArray(candidate.item.result) ? candidate.item.result : {}
        const changed = await db.moderationBulkOperation.updateMany({
          where: { id: candidate.item.id, retentionRedactedAt: null },
          data: {
            idempotencyKey: `retained:${candidate.item.id}`,
            actorId: null,
            actorSubjectRef: null,
            result: {
              action: candidate.item.action,
              targetHash: candidate.item.targetHash,
              targetCount: candidate.item.targetCount,
              succeededCount: Number.isInteger(result.succeededCount) ? result.succeededCount : 0,
              skippedCount: Number.isInteger(result.skippedCount) ? result.skippedCount : 0,
              retained: true,
            },
            retentionRedactedAt: now,
          },
        })
        if (changed.count === 1) bulkOperationsRedacted += 1
      }

      const redacted = rulesRedacted + bulkOperationsRedacted
      await recordAudit({
        actor: null,
        action: 'system.moderation.operations.retention_redacted',
        resourceType: 'moderation_operational_retention',
        resourceId: moderationOperationalRetentionContract.policyId,
        metadata: { inspected: candidates.length, redacted, blocked: candidates.length - redacted, rulesRedacted, bulkOperationsRedacted },
      }, db)
      return { policyId: moderationOperationalRetentionContract.policyId, inspected: candidates.length, redacted, blocked: candidates.length - redacted, rulesRedacted, bulkOperationsRedacted }
    }, { isolationLevel: 'ReadCommitted' })
  },
})
