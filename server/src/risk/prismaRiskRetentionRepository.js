import {
  isRiskCaseRetentionEligible,
  riskRetentionContract,
  riskRetentionCutoff,
  riskRetentionSweepLimit,
} from './riskOperations.js'

const lock = (db, key) => db.$queryRawUnsafe(
  'SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))',
  key,
)

const candidateWhere = (cutoff, ids = null) => ({
  ...(ids ? { id: { in: ids } } : {}),
  retentionRedactedAt: null,
  userId: { not: null },
  subjectRef: { not: null },
  OR: [
    { status: 'recovered', recoveredAt: { lte: cutoff } },
    { status: 'closed', closedAt: { lte: cutoff } },
  ],
})

const loadCandidates = (db, cutoff, take, ids = null) => db.riskCase.findMany({
  where: candidateWhere(cutoff, ids),
  select: {
    id: true,
    userId: true,
    subjectRef: true,
    status: true,
    version: true,
    recoveredAt: true,
    closedAt: true,
    retentionRedactedAt: true,
    signals: { select: { signalId: true } },
  },
  orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
  take,
})

const discoverEligibleCandidates = async (db, cutoff, now, take) => {
  const rows = await db.$queryRawUnsafe(`
    SELECT rc.id
    FROM risk_cases rc
    WHERE rc.retention_redacted_at IS NULL
      AND rc.user_id IS NOT NULL
      AND rc.subject_ref IS NOT NULL
      AND (
        (rc.status = 'recovered' AND rc.recovered_at <= $1)
        OR (rc.status = 'closed' AND rc.closed_at <= $1)
      )
      AND NOT EXISTS (
        SELECT 1 FROM data_rights_legal_holds hold_row
        WHERE hold_row.subject_ref = rc.subject_ref
          AND hold_row.scope_domain IN ('audit', 'safety')
          AND hold_row.released_at IS NULL
          AND hold_row.expires_at > $2
      )
    ORDER BY COALESCE(rc.closed_at, rc.recovered_at) ASC, rc.id ASC
    LIMIT $3
  `, cutoff, now, take)
  return loadCandidates(db, cutoff, take, rows.map((row) => row.id))
}

export const createPrismaRiskRetentionRepository = (client, { recordAudit }) => ({
  sweepRetention: async ({ now = new Date(), limit } = {}) => {
    const cutoff = riskRetentionCutoff(now)
    const take = riskRetentionSweepLimit(limit)
    const discovered = await discoverEligibleCandidates(client, cutoff, now, take)
    if (discovered.length === 0) return { policyId: riskRetentionContract.policyId, inspected: 0, redacted: 0, blocked: 0 }

    return client.$transaction(async (db) => {
      await lock(db, 'security-retention-legal-holds')
      for (const riskCase of discovered) await lock(db, `risk-case:${riskCase.id}`)
      const subjectRefs = [...new Set(discovered.map((riskCase) => riskCase.subjectRef).filter(Boolean))].sort()
      for (const subjectRef of subjectRefs) await lock(db, `data-rights-subject-ref:${subjectRef}`)

      const candidates = await loadCandidates(db, cutoff, take, discovered.map((riskCase) => riskCase.id))
      const matchingHolds = subjectRefs.length === 0 ? [] : await db.dataRightsLegalHold.findMany({
        where: {
          subjectRef: { in: subjectRefs },
          scopeDomain: { in: riskRetentionContract.legalHoldScopeDomains },
          releasedAt: null,
          expiresAt: { gt: now },
        },
        select: { subjectRef: true },
      })
      const heldSubjectRefs = new Set(matchingHolds.map((hold) => hold.subjectRef))
      let redacted = 0

      for (const riskCase of candidates) {
        if (!isRiskCaseRetentionEligible(riskCase, cutoff) || heldSubjectRefs.has(riskCase.subjectRef)) continue
        const changed = await db.riskCase.updateMany({
          where: {
            id: riskCase.id,
            version: riskCase.version,
            ...candidateWhere(cutoff),
          },
          data: {
            userId: null,
            subjectRef: null,
            retentionRedactedAt: now,
            version: { increment: 1 },
          },
        })
        if (changed.count !== 1) continue

        await db.riskAppeal.updateMany({
          where: { caseId: riskCase.id },
          data: { appellantId: null, decidedById: null, statementPreview: null },
        })
        await db.riskDispositionEvent.updateMany({
          where: { caseId: riskCase.id },
          data: { actorId: null },
        })
        const signalIds = riskCase.signals.map((link) => link.signalId)
        if (signalIds.length > 0) {
          await db.$executeRawUnsafe(`
            UPDATE risk_signals signal_row
            SET user_id = NULL,
                dedupe_key = 'retained:' || signal_row.id
            WHERE signal_row.id = ANY($1::text[])
              AND NOT EXISTS (
                SELECT 1
                FROM risk_case_signals link_row
                JOIN risk_cases linked_case ON linked_case.id = link_row.case_id
                WHERE link_row.signal_id = signal_row.id
                  AND linked_case.retention_redacted_at IS NULL
              )
          `, signalIds)
        }
        redacted += 1
      }

      await recordAudit({
        actor: null,
        action: 'system.risk.records.retention_redacted',
        resourceType: 'risk_record_retention',
        resourceId: riskRetentionContract.policyId,
        metadata: { inspected: candidates.length, redacted, blocked: candidates.length - redacted },
      }, db)
      return { policyId: riskRetentionContract.policyId, inspected: candidates.length, redacted, blocked: candidates.length - redacted }
    }, { isolationLevel: 'ReadCommitted' })
  },
})
