import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { dataRightsSafeSubjectRef } from '../dataRights/dataRightsLifecycle.js'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma marketplace retention deletes abandoned drafts, redacts closed tasks, and preserves blockers', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const now = new Date('2029-07-28T00:00:00.000Z')
  const old = new Date('2027-01-01T00:00:00.000Z')
  const userIds = [`market-publisher-${suffix}`, `market-creator-${suffix}`, `market-held-publisher-${suffix}`]
  const ids = {
    eligible: `market-eligible-${suffix}`,
    held: `market-held-${suffix}`,
    disputed: `market-disputed-${suffix}`,
    draft: `market-draft-${suffix}`,
    proposal: `market-proposal-${suffix}`,
    submission: `market-submission-${suffix}`,
    disputedSubmission: `market-disputed-submission-${suffix}`,
    hold: `market-hold-${suffix}`,
    event: `market-event-${suffix}`,
    ledger: `market-ledger-${suffix}`,
    mutationA: `market-mutation-a-${suffix}`,
    mutationB: `market-mutation-b-${suffix}`,
  }
  const createTask = (id, status, publisherId = userIds[0]) => repository.client.task.create({ data: {
    id, title: `Private title ${id}`, category: 'design', description: 'Private description', acceptanceRules: 'Private acceptance rules',
    pointsReward: 0, status, publisherId, assigneeId: status === 'draft' ? null : userIds[1], visibility: 'community',
    createdAt: old, updatedAt: old, metadata: { status, privateNote: 'remove me' },
  } })

  try {
    await repository.client.user.createMany({ data: [
      { id: userIds[0], displayName: 'Retention Publisher', role: 'publisher' },
      { id: userIds[1], displayName: 'Retention Creator', role: 'creator' },
      { id: userIds[2], displayName: 'Held Retention Publisher', role: 'publisher' },
    ] })
    await Promise.all([
      createTask(ids.eligible, 'completed'), createTask(ids.held, 'completed', userIds[2]),
      createTask(ids.disputed, 'rejected'), createTask(ids.draft, 'draft'),
    ])
    await repository.client.taskProposal.create({ data: { id: ids.proposal, taskId: ids.eligible, proposerId: userIds[1], coverLetter: 'Private proposal', estimate: 'Private estimate', status: 'accepted', metadata: { private: true }, createdAt: old, updatedAt: old } })
    await repository.client.taskSubmission.create({ data: { id: ids.submission, taskId: ids.eligible, submitterId: userIds[1], content: 'Private delivery', assetIds: ['private-asset'], rightsNote: 'Private rights', status: 'approved', reviewNote: 'Private review', reviewedById: userIds[0], metadata: { outcome: 'accepted', private: true }, createdAt: old, updatedAt: old } })
    await repository.client.taskSubmission.create({ data: { id: ids.disputedSubmission, taskId: ids.disputed, submitterId: userIds[1], content: 'Open dispute delivery', assetIds: [], status: 'disputed', createdAt: old, updatedAt: old } })
    await repository.client.taskLifecycleMutation.createMany({ data: [ids.mutationA, ids.mutationB].map((id, index) => ({
      id, taskId: ids.eligible, idempotencyKey: `private-idempotency-${index}-${suffix}`, requestHash: 'c'.repeat(64),
      action: 'user_cancel', source: 'user', previousStatus: 'completed', reasonCode: 'retention_fixture',
      note: 'Private lifecycle note', requestedById: userIds[0], result: { status: 'completed', private: 'remove me' },
      completedAt: old, createdAt: old,
    })) })
    await repository.client.domainEventOutbox.create({ data: {
      id: ids.event, eventType: 'task.created', eventVersion: 1, aggregateType: 'task', aggregateId: ids.eligible,
      aggregateSequence: 1, ownerId: userIds[0], correlationId: `market-correlation-${suffix}`,
      idempotencyKey: `market-event-idempotency-${suffix}`, payload: { taskId: ids.eligible, publisherId: userIds[0], status: 'open', category: 'design' },
      occurredAt: old, createdAt: old,
    } })
    await repository.client.pointLedger.create({ data: {
      id: ids.ledger, userId: userIds[1], sourceType: 'task_completion', sourceId: ids.eligible,
      delta: 0, balanceAfter: 0, status: 'settled', description: 'Immutable private ledger description', createdAt: old,
    } })
    await repository.client.dataRightsLegalHold.create({ data: {
      id: ids.hold, subjectId: userIds[2], subjectRef: dataRightsSafeSubjectRef(userIds[2]), scopeDomain: 'tasks', reasonCode: 'retention_fixture',
      authorityRole: 'legal_hold_admin', authorityReferenceHash: 'a'.repeat(64), ownerRef: `actor_${'b'.repeat(24)}`,
      reviewAt: new Date(now.getTime() + 86_400_000), expiresAt: new Date(now.getTime() + 7 * 86_400_000),
    } })

    const result = await repository.marketplaceRetention.sweepRetention({ now, limit: 10 })
    assert.deepEqual(result, { policyId: 'marketplace_close_plus_730d', inspected: 4, draftsDeleted: 1, tasksRedacted: 1, blocked: 2 })
    assert.equal(await repository.client.task.findUnique({ where: { id: ids.draft } }), null)
    const eligible = await repository.client.task.findUnique({ where: { id: ids.eligible }, include: { proposals: true, submissions: true } })
    assert.equal(eligible.publisherId, null)
    assert.equal(eligible.retentionRedactedAt.toISOString(), now.toISOString())
    assert.equal(eligible.proposals[0].proposerId, null)
    assert.equal(eligible.submissions[0].submitterId, null)
    assert.deepEqual(eligible.submissions[0].assetIds, [])
    const mutations = await repository.client.taskLifecycleMutation.findMany({ where: { taskId: ids.eligible }, orderBy: { id: 'asc' } })
    assert.equal(new Set(mutations.map((row) => row.idempotencyKey)).size, 2)
    assert.equal(mutations.every((row) => row.requestedById === userIds[0] && row.note === 'Private lifecycle note'), true)
    assert.equal((await repository.client.domainEventOutbox.findUnique({ where: { id: ids.event } })).ownerId, userIds[0])
    assert.equal((await repository.client.pointLedger.findUnique({ where: { id: ids.ledger } })).description, 'Immutable private ledger description')
    await assert.rejects(repository.client.task.update({ where: { id: ids.eligible }, data: { title: 'Restored private title' } }), /MARKETPLACE_RETENTION_REDACTED/)
    assert.equal((await repository.client.task.findUnique({ where: { id: ids.held } })).retentionRedactedAt, null)
    assert.equal((await repository.client.task.findUnique({ where: { id: ids.disputed } })).retentionRedactedAt, null)
  } finally {
    await repository.client.$transaction(async (db) => {
      await db.$executeRawUnsafe("SET LOCAL app.marketplace_retention_maintenance = 'on'")
      await db.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await db.$executeRawUnsafe("SET LOCAL app.data_rights_maintenance = 'on'")
      await db.taskSubmissionAsset.deleteMany({ where: { submission: { taskId: { in: Object.values(ids) } } } })
      await db.taskSubmission.deleteMany({ where: { taskId: { in: Object.values(ids) } } })
      await db.taskProposal.deleteMany({ where: { taskId: { in: Object.values(ids) } } })
      await db.taskLifecycleMutation.deleteMany({ where: { taskId: { in: Object.values(ids) } } })
      await db.domainEventOutbox.deleteMany({ where: { id: ids.event } })
      await db.pointLedger.deleteMany({ where: { id: ids.ledger } })
      await db.task.deleteMany({ where: { id: { in: Object.values(ids) } } })
      await db.dataRightsLegalHoldEvent.deleteMany({ where: { legalHoldId: ids.hold } })
      await db.dataRightsLegalHold.deleteMany({ where: { id: ids.hold } })
      await db.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { resourceType: 'task', resourceId: { in: Object.values(ids) } }] } })
      await db.user.deleteMany({ where: { id: { in: userIds } } })
    })
    await repository.client.$disconnect()
  }
})
