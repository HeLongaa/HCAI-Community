import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { dataRightsSafeSubjectRef } from '../dataRights/dataRightsLifecycle.js'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma moderation retention redacts closed case subjects, preserves decision evidence, and honors legal-hold races', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const register = (label) => repository.auth.registerEmailAccount({
    email: `moderation-retention-${label}-${suffix}@example.test`,
    password: 'moderation-retention-password',
    displayName: `Moderation ${label}`,
    handle: `mr${label}${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-14)}`.slice(0, 30),
  })
  const sessions = await Promise.all(['affected', 'reporter', 'reviewer', 'held', 'racing'].map(register))
  const [affected, reporter, reviewer, held, racing] = sessions.map((session) => session.user)
  const now = new Date('2028-07-28T00:00:00.000Z')
  const old = new Date('2025-01-01T00:00:00.000Z')
  const ids = {
    eligible: `moderation-retention-eligible-${suffix}`,
    held: `moderation-retention-held-${suffix}`,
    appealed: `moderation-retention-appealed-${suffix}`,
    racing: `moderation-retention-racing-${suffix}`,
    hold: `moderation-retention-hold-${suffix}`,
    racingHold: `moderation-retention-racing-hold-${suffix}`,
  }
  const caseIds = [ids.eligible, ids.held, ids.appealed, ids.racing]
  const subjectRef = (user) => dataRightsSafeSubjectRef(user.id)
  const createClosedCase = async ({ id, subject, reportedBy, decisionAt = old, withEvidence = false }) => {
    const decisionId = `${id}-decision`
    await repository.client.moderationCase.create({ data: {
      id,
      targetType: 'user',
      targetId: subject.id,
      affectedUserId: subject.id,
      affectedSubjectRef: subjectRef(subject),
      reporterSubjectRef: subjectRef(reportedBy),
      priority: 'high',
      createdAt: decisionAt,
      report: { create: { id: `${id}-report`, reporterId: reportedBy.id, category: 'privacy', subject: 'Sensitive report subject', statement: 'Sensitive report statement that must be removed.', locale: 'en', sourceKey: `${id}-source`, createdAt: decisionAt } },
      evidence: withEvidence ? { create: { id: `${id}-evidence`, submittedById: reportedBy.id, evidenceType: 'target_snapshot', referenceType: 'user', referenceId: subject.id, contentHash: 'a'.repeat(64), reasonCode: 'retention_fixture', createdAt: decisionAt } } : undefined,
      decisions: { create: { id: decisionId, reviewerId: reviewer.id, stage: 'original', outcome: 'restrict_content', reasonCode: 'retention_fixture', note: 'Sensitive reviewer note that must be removed.', createdAt: decisionAt } },
    } })
    return decisionId
  }

  try {
    const eligibleDecisionId = await createClosedCase({ id: ids.eligible, subject: affected, reportedBy: reporter, withEvidence: true })
    await repository.client.communityModerationAction.create({ data: { id: `${ids.eligible}-action`, caseId: ids.eligible, decisionId: eligibleDecisionId, targetType: 'post', targetId: `${ids.eligible}-post`, action: 'hide', fromState: 'visible', toState: 'hidden', reasonCode: 'retention_fixture', actorId: reviewer.id, createdAt: old } })
    await repository.client.safetySignal.create({ data: { id: `${ids.eligible}-signal`, sourceKey: `${ids.eligible}-signal-source`, caseId: ids.eligible, signalType: 'privacy_signal', severity: 'high', score: 90, contentHash: 'b'.repeat(64), observedAt: old, createdById: reviewer.id, createdAt: old } })
    await repository.client.moderationQueueEvent.create({ data: { id: `${ids.eligible}-queue`, caseId: ids.eligible, action: 'assign', assigneeId: reviewer.id, priority: 'high', dueAt: old, reasonCode: 'retention_fixture', actorId: reviewer.id, createdAt: old } })

    await createClosedCase({ id: ids.held, subject: held, reportedBy: reporter, decisionAt: new Date(old.getTime() - 1000) })
    const appealedDecisionId = await createClosedCase({ id: ids.appealed, subject: affected, reportedBy: reporter })
    await repository.client.moderationAppeal.create({ data: { id: `${ids.appealed}-appeal`, caseId: ids.appealed, decisionId: appealedDecisionId, appellantId: affected.id, reasonCode: 'retention_fixture', statement: 'Pending appeal statement must remain while active.', createdAt: old } })
    await repository.client.dataRightsLegalHold.create({ data: { id: ids.hold, subjectId: held.id, subjectRef: subjectRef(held), scopeDomain: 'safety', reasonCode: 'retention_fixture', authorityRole: 'legal_hold_admin', authorityReferenceHash: 'c'.repeat(64), ownerRef: `actor_${'d'.repeat(24)}`, reviewAt: new Date(now.getTime() + 86_400_000), expiresAt: new Date(now.getTime() + 7 * 86_400_000) } })

    await assert.rejects(repository.client.report.update({ where: { caseId: ids.eligible }, data: { subject: 'Illegal mutation' } }), /moderation facts are append-only/)
    const first = await repository.moderationRetention.sweepRetention({ now, limit: 1 })
    assert.deepEqual(first, { policyId: 'moderation_close_plus_730d', inspected: 1, redacted: 1, blocked: 0 })
    assert.equal((await repository.client.moderationCase.findUnique({ where: { id: ids.held } })).affectedUserId, held.id)
    assert.equal((await repository.client.moderationCase.findUnique({ where: { id: ids.appealed } })).affectedUserId, affected.id)

    const eligible = await repository.client.moderationCase.findUnique({ where: { id: ids.eligible }, include: { report: true, evidence: true, decisions: true, communityActions: true, safetySignals: true, queueEvents: true } })
    assert.equal(eligible.affectedUserId, null)
    assert.equal(eligible.affectedSubjectRef, null)
    assert.equal(eligible.reporterSubjectRef, null)
    assert.equal(eligible.retentionRedactedAt.toISOString(), now.toISOString())
    assert.equal(eligible.report.reporterId, null)
    assert.equal(eligible.report.statement, '[redacted after retention]')
    assert.match(eligible.report.sourceKey, /^retained:moderation:/)
    assert.equal(eligible.evidence[0].submittedById, null)
    assert.equal(eligible.evidence[0].referenceId, `retained:${eligible.evidence[0].id}`)
    assert.equal(eligible.evidence[0].contentHash, 'a'.repeat(64))
    assert.equal(eligible.decisions[0].reviewerId, null)
    assert.equal(eligible.decisions[0].note, '[redacted after retention]')
    assert.equal(eligible.decisions[0].outcome, 'restrict_content')
    assert.equal(eligible.communityActions[0].actorId, null)
    assert.equal(eligible.safetySignals[0].createdById, null)
    assert.equal(eligible.queueEvents[0].actorId, null)

    await repository.client.dataRightsLegalHold.update({ where: { id: ids.hold }, data: { releasedAt: now, releaseReasonCode: 'retention_fixture', releasedByRef: `actor_${'e'.repeat(24)}`, version: { increment: 1 } } })
    assert.equal((await repository.moderationRetention.sweepRetention({ now, limit: 1 })).redacted, 1)

    await createClosedCase({ id: ids.racing, subject: racing, reportedBy: reporter })
    let lockedResolve
    const locked = new Promise((resolve) => { lockedResolve = resolve })
    const holdTransaction = repository.client.$transaction(async (db) => {
      await db.$queryRawUnsafe('SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))', 'security-retention-legal-holds')
      await db.$queryRawUnsafe('SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))', `data-rights-subject-ref:${subjectRef(racing)}`)
      lockedResolve()
      await new Promise((resolve) => setTimeout(resolve, 100))
      await db.dataRightsLegalHold.create({ data: { id: ids.racingHold, subjectId: racing.id, subjectRef: subjectRef(racing), scopeDomain: 'safety', reasonCode: 'retention_race', authorityRole: 'security_legal_incident_owner', authorityReferenceHash: 'f'.repeat(64), ownerRef: `actor_${'a'.repeat(24)}`, reviewAt: new Date(now.getTime() + 86_400_000), expiresAt: new Date(now.getTime() + 7 * 86_400_000) } })
    })
    await locked
    const racingSweep = repository.moderationRetention.sweepRetention({ now, limit: 10 })
    await holdTransaction
    assert.deepEqual(await racingSweep, { policyId: 'moderation_close_plus_730d', inspected: 1, redacted: 0, blocked: 1 })
    assert.equal((await repository.client.moderationCase.findUnique({ where: { id: ids.racing } })).affectedUserId, racing.id)
  } finally {
    await repository.client.$transaction(async (db) => {
      await db.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await db.$executeRawUnsafe("SET LOCAL app.data_rights_maintenance = 'on'")
      await db.communityModerationAction.deleteMany({ where: { caseId: { in: caseIds } } })
      await db.moderationQueueEvent.deleteMany({ where: { caseId: { in: caseIds } } })
      await db.safetySignal.deleteMany({ where: { caseId: { in: caseIds } } })
      await db.moderationAppeal.deleteMany({ where: { caseId: { in: caseIds } } })
      await db.moderationDecision.deleteMany({ where: { caseId: { in: caseIds } } })
      await db.moderationEvidence.deleteMany({ where: { caseId: { in: caseIds } } })
      await db.report.deleteMany({ where: { caseId: { in: caseIds } } })
      await db.moderationCase.deleteMany({ where: { id: { in: caseIds } } })
      await db.dataRightsLegalHoldEvent.deleteMany({ where: { legalHoldId: { in: [ids.hold, ids.racingHold] } } })
      await db.dataRightsLegalHold.deleteMany({ where: { id: { in: [ids.hold, ids.racingHold] } } })
      const userIds = sessions.map((session) => session.user.id)
      await db.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { resourceType: 'moderation_case_retention' }] } })
      await db.refreshToken.deleteMany({ where: { userId: { in: userIds } } })
      await db.authSession.deleteMany({ where: { userId: { in: userIds } } })
      await db.authAccount.deleteMany({ where: { userId: { in: userIds } } })
      await db.profile.deleteMany({ where: { userId: { in: userIds } } })
      await db.user.deleteMany({ where: { id: { in: userIds } } })
    })
    await repository.client.$disconnect()
  }
})
