import {
  isModerationCaseRetentionEligible,
  moderationRetentionContract,
  moderationRetentionCutoff,
  moderationRetentionSweepLimit,
} from './moderationRetention.js'

const lock = (db, key) => db.$queryRawUnsafe(
  'SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))',
  key,
)

const candidateWhere = (ids = null) => ({
  ...(ids ? { id: { in: ids } } : {}),
  retentionRedactedAt: null,
})

const loadCandidates = (db, take, ids) => db.moderationCase.findMany({
  where: candidateWhere(ids),
  select: {
    id: true,
    affectedSubjectRef: true,
    reporterSubjectRef: true,
    retentionRedactedAt: true,
    decisions: { select: { stage: true, createdAt: true } },
    appeals: { select: { id: true, createdAt: true } },
  },
  orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  take,
})

const discoverEligibleCandidates = async (db, cutoff, now, take) => {
  const rows = await db.$queryRawUnsafe(`
    SELECT case_row.id
    FROM moderation_cases case_row
    LEFT JOIN moderation_decisions original_decision
      ON original_decision.case_id = case_row.id AND original_decision.stage = 'original'
    LEFT JOIN moderation_appeals appeal_row ON appeal_row.case_id = case_row.id
    LEFT JOIN moderation_decisions appeal_decision
      ON appeal_decision.case_id = case_row.id AND appeal_decision.stage = 'appeal'
    WHERE case_row.retention_redacted_at IS NULL
      AND (
        (appeal_decision.id IS NOT NULL AND appeal_decision.created_at <= $1)
        OR
        (appeal_row.id IS NULL AND original_decision.id IS NOT NULL AND original_decision.created_at + INTERVAL '30 days' <= $1)
      )
      AND NOT EXISTS (
        SELECT 1 FROM data_rights_legal_holds hold_row
        WHERE hold_row.subject_ref IN (case_row.affected_subject_ref, case_row.reporter_subject_ref)
          AND hold_row.scope_domain IN ('audit', 'safety')
          AND hold_row.released_at IS NULL
          AND hold_row.expires_at > $2
      )
      AND (
        case_row.affected_subject_ref IS NOT NULL
        OR case_row.reporter_subject_ref IS NOT NULL
        OR NOT EXISTS (
          SELECT 1 FROM data_rights_legal_holds hold_row
          WHERE hold_row.scope_domain IN ('audit', 'safety')
            AND hold_row.released_at IS NULL
            AND hold_row.expires_at > $2
        )
      )
    ORDER BY COALESCE(appeal_decision.created_at, original_decision.created_at + INTERVAL '30 days') ASC, case_row.id ASC
    LIMIT $3
  `, cutoff, now, take)
  return loadCandidates(db, take, rows.map((row) => row.id))
}

export const createPrismaModerationRetentionRepository = (client, { recordAudit }) => ({
  sweepRetention: async ({ now = new Date(), limit } = {}) => {
    const cutoff = moderationRetentionCutoff(now)
    const take = moderationRetentionSweepLimit(limit)
    const discovered = await discoverEligibleCandidates(client, cutoff, now, take)
    if (discovered.length === 0) return { policyId: moderationRetentionContract.policyId, inspected: 0, redacted: 0, blocked: 0 }

    return client.$transaction(async (db) => {
      await lock(db, 'security-retention-legal-holds')
      for (const item of discovered) await lock(db, `moderation-case:${item.id}`)
      const subjectRefs = [...new Set(discovered.flatMap((item) => [item.affectedSubjectRef, item.reporterSubjectRef]).filter(Boolean))].sort()
      for (const subjectRef of subjectRefs) await lock(db, `data-rights-subject-ref:${subjectRef}`)

      const candidates = await loadCandidates(db, take, discovered.map((item) => item.id))
      const matchingHolds = subjectRefs.length === 0 ? [] : await db.dataRightsLegalHold.findMany({
          where: { subjectRef: { in: subjectRefs }, scopeDomain: { in: moderationRetentionContract.legalHoldScopeDomains }, releasedAt: null, expiresAt: { gt: now } },
          select: { subjectRef: true },
        })
      const activeHoldCount = candidates.some((item) => !item.affectedSubjectRef && !item.reporterSubjectRef) ? await db.dataRightsLegalHold.count({
          where: { scopeDomain: { in: moderationRetentionContract.legalHoldScopeDomains }, releasedAt: null, expiresAt: { gt: now } },
        }) : 0
      const heldSubjectRefs = new Set(matchingHolds.map((hold) => hold.subjectRef))
      await db.$executeRawUnsafe("SET LOCAL app.moderation_retention_maintenance = 'on'")
      let redacted = 0

      for (const item of candidates) {
        const held = [item.affectedSubjectRef, item.reporterSubjectRef].filter(Boolean).some((subjectRef) => heldSubjectRefs.has(subjectRef))
        const unattributedBlocked = !item.affectedSubjectRef && !item.reporterSubjectRef && activeHoldCount > 0
        if (!isModerationCaseRetentionEligible(item, cutoff) || held || unattributedBlocked) continue

        const changed = await db.moderationCase.updateMany({
          where: { id: item.id, retentionRedactedAt: null },
          data: {
            targetId: `retained:${item.id}`,
            affectedUserId: null,
            affectedSubjectRef: null,
            reporterSubjectRef: null,
            retentionRedactedAt: now,
          },
        })
        if (changed.count !== 1) continue

        await db.report.updateMany({ where: { caseId: item.id }, data: { reporterId: null, subject: '[retained report]', statement: '[redacted after retention]', sourceKey: `retained:moderation:${item.id}` } })
        await db.$executeRawUnsafe(`
          UPDATE moderation_evidence
          SET submitted_by_id = NULL,
              reference_id = 'retained:' || id
          WHERE case_id = $1
        `, item.id)
        await db.moderationDecision.updateMany({ where: { caseId: item.id }, data: { reviewerId: null, note: '[redacted after retention]' } })
        await db.moderationAppeal.updateMany({ where: { caseId: item.id }, data: { appellantId: null, statement: '[redacted after retention]' } })
        await db.communityModerationAction.updateMany({ where: { caseId: item.id }, data: { actorId: null, targetId: `retained:${item.id}` } })
        await db.safetySignal.updateMany({ where: { caseId: item.id }, data: { createdById: null } })
        await db.moderationQueueEvent.updateMany({ where: { caseId: item.id }, data: { assigneeId: null, actorId: null } })
        redacted += 1
      }

      await recordAudit({
        actor: null,
        action: 'system.moderation.cases.retention_redacted',
        resourceType: 'moderation_case_retention',
        resourceId: moderationRetentionContract.policyId,
        metadata: { inspected: candidates.length, redacted, blocked: candidates.length - redacted },
      }, db)
      return { policyId: moderationRetentionContract.policyId, inspected: candidates.length, redacted, blocked: candidates.length - redacted }
    }, { isolationLevel: 'ReadCommitted' })
  },
})
