import { marketplaceRetentionContract, marketplaceRetentionCutoffs, marketplaceRetentionSweepLimit, retainMarketplaceSummary } from './marketplaceRetention.js'

const lock = (db, key) => db.$queryRawUnsafe('SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))', key)

const candidateSql = `
  SELECT task_row.id
  FROM tasks task_row
  WHERE task_row.retention_redacted_at IS NULL
    AND (
      (task_row.status = 'draft' AND task_row.updated_at <= $1)
      OR (task_row.status IN ('completed', 'rejected', 'cancelled', 'expired')
        AND COALESCE(task_row.cancelled_at, task_row.expired_at, task_row.updated_at) <= $2)
    )
  ORDER BY task_row.updated_at, task_row.id
  LIMIT $3`

const activeAccounting = async (db, taskId) => {
  const rows = await db.$queryRawUnsafe(`
    SELECT EXISTS (
      SELECT 1 FROM internal_accounting_operations
      WHERE source_type = 'task' AND source_id = $1 AND status IN ('pending', 'failed')
    ) OR EXISTS (
      SELECT 1 FROM accounting_reconciliation_issues
      WHERE source_type = 'task' AND source_id = $1 AND status IN ('open', 'repair_pending')
    ) OR EXISTS (
      SELECT 1 FROM point_ledger
      WHERE source_id = $1 AND source_type = 'task_escrow' AND status = 'pending'
    ) AS blocked`, taskId)
  return Boolean(rows[0]?.blocked)
}

const openDispute = async (db, taskId) => {
  const rows = await db.$queryRawUnsafe(`
    SELECT EXISTS (
      SELECT 1 FROM admin_reviews
      WHERE metadata->>'kind' = 'task_dispute' AND metadata->>'taskId' = $1 AND decision IS NULL
    ) AS blocked`, taskId)
  return Boolean(rows[0]?.blocked)
}

const activeLegalHold = async (db, subjectRefs, now) => {
  if (subjectRefs.length === 0) return true
  return Boolean(await db.dataRightsLegalHold.findFirst({
    where: {
      subjectRef: { in: subjectRefs },
      scopeDomain: marketplaceRetentionContract.legalHoldScopeDomain,
      releasedAt: null,
      expiresAt: { gt: now },
    },
    select: { id: true },
  }))
}

const deleteSecondaryCopies = async (db, taskId) => {
  await db.notification.deleteMany({ where: { resourceType: 'task', resourceId: taskId } })
  await db.searchDocument.deleteMany({ where: { resourceType: 'task', sourceId: taskId } })
  await db.searchSyncQueue.deleteMany({ where: { resourceType: 'task', sourceId: taskId } })
}

const redactTerminalTask = async (db, task, now) => {
  await deleteSecondaryCopies(db, task.id)
  await db.profilePortfolioAsset.updateMany({ where: { sourceSubmissionId: { in: task.submissions.map((row) => row.id) } }, data: { sourceSubmissionId: null } })
  for (const proposal of task.proposals) {
    await db.taskProposal.update({ where: { id: proposal.id }, data: {
      proposerId: null, proposerSubjectRef: null, coverLetter: marketplaceRetentionContract.retainedText,
      estimate: null, metadata: null, retentionRedactedAt: now,
    } })
  }
  for (const submission of task.submissions) {
    await db.taskSubmission.update({ where: { id: submission.id }, data: {
      submitterId: null, submitterSubjectRef: null, reviewedById: null,
      content: marketplaceRetentionContract.retainedText, assetIds: [], rightsNote: '', reviewNote: null,
      metadata: retainMarketplaceSummary(submission.metadata), retentionRedactedAt: now,
    } })
  }
  const reviews = await db.adminReview.findMany({ where: { queue: 'task_disputes', metadata: { path: ['taskId'], equals: task.id } } })
  for (const review of reviews) {
    const summary = retainMarketplaceSummary(review.metadata)
    await db.adminReview.update({ where: { id: review.id }, data: {
      title: `Retained task dispute: ${task.id}`, owner: 'retained', note: '', reviewedById: null,
      metadata: { ...summary, kind: 'task_dispute', taskId: task.id },
    } })
  }
  await db.task.update({ where: { id: task.id }, data: {
    title: marketplaceRetentionContract.retainedText,
    description: marketplaceRetentionContract.retainedText,
    acceptanceRules: marketplaceRetentionContract.retainedText,
    publisherId: null, assigneeId: null, archivedById: null,
    publisherSubjectRef: null, assigneeSubjectRef: null,
    archiveNote: null,
    metadata: { status: task.status, reasonCode: task.terminalReasonCode ?? null },
    retentionRedactedAt: now,
    version: { increment: 1 },
  } })
}

export const createPrismaMarketplaceRetentionRepository = (client, { recordAudit }) => ({
  sweepRetention: async ({ now = new Date(), limit } = {}) => {
    const cutoffs = marketplaceRetentionCutoffs(now)
    const take = marketplaceRetentionSweepLimit(limit)
    const discovered = await client.$queryRawUnsafe(candidateSql, cutoffs.draft, cutoffs.terminal, take)
    if (discovered.length === 0) return { policyId: marketplaceRetentionContract.policyId, inspected: 0, draftsDeleted: 0, tasksRedacted: 0, blocked: 0 }

    return client.$transaction(async (db) => {
      await lock(db, 'security-retention-legal-holds')
      for (const row of discovered) await lock(db, `task:${row.id}`)
      await db.$executeRawUnsafe("SET LOCAL app.marketplace_retention_maintenance = 'on'")
      let draftsDeleted = 0
      let tasksRedacted = 0
      let blocked = 0
      for (const row of discovered) {
        const task = await db.task.findUnique({
          where: { id: row.id },
          include: { proposals: true, submissions: true, lifecycleMutations: true },
        })
        if (!task || task.retentionRedactedAt) continue
        const subjectRefs = [...new Set([
          task.publisherSubjectRef, task.assigneeSubjectRef,
          ...task.proposals.map((item) => item.proposerSubjectRef),
          ...task.submissions.map((item) => item.submitterSubjectRef),
        ].filter(Boolean))]
        const held = await activeLegalHold(db, subjectRefs, now)
        if (task.status === 'draft' && task.updatedAt <= cutoffs.draft && task.proposals.length === 0 && task.submissions.length === 0 && !held) {
          await deleteSecondaryCopies(db, task.id)
          await db.task.delete({ where: { id: task.id } })
          draftsDeleted += 1
          continue
        }
        const terminalAt = task.cancelledAt ?? task.expiredAt ?? task.updatedAt
        const activeSubmission = task.submissions.some((item) => marketplaceRetentionContract.activeSubmissionStatuses.includes(item.status))
        const blockedByDispute = await openDispute(db, task.id)
        const blockedByAccounting = await activeAccounting(db, task.id)
        if (!marketplaceRetentionContract.terminalStatuses.includes(task.status) || terminalAt > cutoffs.terminal || activeSubmission || blockedByDispute || blockedByAccounting || held) {
          blocked += 1
          continue
        }
        await redactTerminalTask(db, task, now)
        tasksRedacted += 1
        await recordAudit({ actor: null, action: 'system.marketplace.task.retention_redacted', resourceType: 'task', resourceId: task.id, metadata: { policyId: marketplaceRetentionContract.policyId, terminalAt: terminalAt.toISOString() } }, db)
      }
      return { policyId: marketplaceRetentionContract.policyId, inspected: discovered.length, draftsDeleted, tasksRedacted, blocked }
    }, { isolationLevel: 'ReadCommitted' })
  },
})
