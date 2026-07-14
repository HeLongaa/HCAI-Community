import assert from 'node:assert/strict'
import test from 'node:test'

const databaseUrl = process.env.ACCOUNTING_DATABASE_URL

test('Prisma quota accounting is concurrent, idempotent, and reconcilable', {
  skip: !databaseUrl,
}, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  assert.ok(repository)

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const actor = { id: `accounting-user-${suffix}`, handle: `acct${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-12)}` }
  const reviewer = { id: `accounting-reviewer-${suffix}`, handle: `review${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-10)}` }
  const generationId = `accounting-generation-${suffix}`
  const payload = {
    generationId,
    actorId: actor.id,
    actorHandle: actor.handle,
    workspace: 'image',
    windowType: 'daily',
    windowStart: '2026-07-14T00:00:00.000Z',
    windowEnd: '2026-07-14T23:59:59.999Z',
    limit: 5,
    costUnits: 1,
    policyVersion: 'creative-policy-v1',
  }

  try {
    await repository.client.user.create({
      data: {
        id: actor.id,
        email: `${actor.handle}@example.test`,
        displayName: 'Accounting Integration User',
        role: 'creator',
        profile: {
          create: {
            handle: actor.handle,
            lane: 'maker',
            skills: [],
            languages: [],
          },
        },
      },
    })
    await repository.client.user.create({
      data: {
        id: reviewer.id,
        email: `${reviewer.handle}@example.test`,
        displayName: 'Accounting Integration Reviewer',
        role: 'admin',
        profile: {
          create: {
            handle: reviewer.handle,
            lane: 'both',
            skills: [],
            languages: [],
          },
        },
      },
    })

    const reservations = await Promise.all(Array.from(
      { length: 8 },
      () => repository.creativeQuota.reserve(payload, actor),
    ))
    assert.equal(new Set(reservations.map((result) => result.reservationId)).size, 1)
    assert.equal(reservations.every((result) => result.reserved), true)

    await assert.rejects(
      repository.creativeQuota.reserve({ ...payload, costUnits: 2 }, actor),
      (error) => error?.statusCode === 409 && error?.code === 'ACCOUNTING_OPERATION_CONFLICT',
    )

    const reservationId = reservations[0].reservationId
    const [committed, released] = await Promise.all([
      repository.creativeQuota.commit(reservationId, actor),
      repository.creativeQuota.release(reservationId, 'provider_failed', actor),
    ])
    assert.deepEqual(committed, released)

    const reservation = await repository.client.creativeQuotaReservation.findUnique({
      where: { id: reservationId },
      include: { quotaWindow: true },
    })
    assert.ok(['committed', 'released'].includes(reservation.status))
    assert.equal(reservation.quotaWindow.reservedUnits, 0)
    assert.equal(reservation.quotaWindow.usedUnits + reservation.quotaWindow.releasedUnits, 1)

    const operations = await repository.client.internalAccountingOperation.findMany({
      where: { sourceType: 'generation', sourceId: generationId },
      include: { movements: true },
    })
    assert.equal(operations.filter((operation) => operation.kind === 'quota_reserve').length, 1)
    assert.equal(operations.filter((operation) => ['quota_commit', 'quota_release'].includes(operation.kind)).length, 1)
    assert.equal(operations.every((operation) => operation.movements.length === 2), true)
    assert.equal(operations.every((operation) => operation.movements.reduce((sum, movement) => sum + movement.amount, 0) === 0), true)

    const clean = await repository.accountingReconciliation.scan(actor)
    assert.equal(clean.summary.open, 0)

    await repository.client.creativeQuotaWindow.update({
      where: { id: reservation.quotaWindowId },
      data: { reservedUnits: { increment: 1 } },
    })
    const drifted = await repository.accountingReconciliation.scan(actor)
    const issue = drifted.issues.items.find((item) => item.issueKey === `quota_state_mismatch:${reservation.quotaWindowId}`)
    assert.ok(issue)
    assert.equal(issue.status, 'open')

    await repository.client.creativeQuotaWindow.update({
      where: { id: reservation.quotaWindowId },
      data: { reservedUnits: { decrement: 1 } },
    })
    const repaired = await repository.accountingReconciliation.scan(actor)
    assert.equal(repaired.summary.open, 0)
    assert.equal(repaired.summary.resolved >= 1, true)
    const listed = await repository.accountingReconciliation.list({ status: 'resolved' })
    assert.equal(listed.items.some((item) => item.id === issue.id), true)
    assert.equal((await repository.accountingReconciliation.find(issue.id))?.status, 'resolved')

    await repository.client.pointLedger.create({
      data: {
        id: `accounting-ledger-${suffix}`,
        userId: actor.id,
        sourceType: 'integration_opening',
        sourceId: suffix,
        delta: 10,
        balanceAfter: 10,
        status: 'settled',
      },
    })
    await repository.client.internalPointAccount.create({
      data: {
        id: `point-account-integration-${suffix}`,
        userId: actor.id,
        openingBalance: 10,
        balance: 15,
        version: 0,
      },
    })
    const pointDrift = await repository.accountingReconciliation.scan(actor)
    const pointIssue = pointDrift.issues.items.find((item) => item.issueKey === `point_balance_drift:${actor.id}:account`)
    assert.ok(pointIssue)
    const requested = await repository.accountingReconciliation.requestRepair(pointIssue.id, {
      repairKind: 'compensation',
      reasonCode: 'repair_balance_drift',
      reason: 'Restore the PointAccount snapshot to the compatible ledger balance.',
    }, actor)
    assert.equal(requested.issue.status, 'repair_pending')
    const reviewed = await repository.accountingReconciliation.reviewRepair(requested.review.id, {
      decision: 'approve',
      note: 'Approved from the integration test.',
    }, reviewer)
    assert.equal(reviewed.review.decision, 'approve')
    assert.equal(reviewed.issue.status, 'resolved')
    assert.equal(reviewed.compensation.kind, 'compensation')
    assert.equal((await repository.client.internalPointAccount.findUnique({ where: { userId: actor.id } })).balance, 10)
    const compensation = await repository.client.internalAccountingOperation.findUnique({
      where: {
        operationKey_unit: {
          operationKey: reviewed.compensation.operationKey,
          unit: 'points',
        },
      },
      include: { movements: true },
    })
    assert.equal(compensation.movements.reduce((sum, movement) => sum + movement.amount, 0), 0)
    assert.equal(compensation.reconciliationIssueId, pointIssue.id)
    const afterCompensation = await repository.accountingReconciliation.scan(reviewer)
    assert.equal(afterCompensation.summary.open, 0)
    assert.equal((await repository.accountingReconciliation.find(pointIssue.id)).status, 'resolved')
  } finally {
    await repository.client.$disconnect()
  }
})
