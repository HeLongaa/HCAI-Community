import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDomainEvent } from '../events/domainEvents.js'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma Outbox and JobRun lifecycle preserve transaction and lease invariants', {
  skip: !databaseUrl,
}, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  assert.ok(repository)

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const actor = {
    id: `foundation-user-${suffix}`,
    handle: `foundation${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-10)}`,
  }
  const createdIds = { events: [], jobs: [], task: null, definitions: [] }

  try {
    await repository.client.user.create({
      data: {
        id: actor.id,
        email: `${actor.handle}@example.test`,
        displayName: 'Foundation Integration User',
        role: 'admin',
        profile: { create: { handle: actor.handle, lane: 'both', skills: [], languages: [] } },
      },
    })

    const task = await repository.tasks.create({
      title: `Atomic Outbox ${suffix}`,
      category: 'integration',
      pointsReward: 0,
      description: 'Verify Task and Outbox persistence in one transaction.',
      acceptanceRules: 'Task and event must commit together.',
      attachmentIds: [],
    }, actor)
    createdIds.task = task.id
    const taskEvent = await repository.client.domainEventOutbox.findUnique({
      where: { idempotencyKey: `task.created.v1:${task.id}` },
      include: { publication: true },
    })
    assert.equal(taskEvent.aggregateId, task.id)
    assert.equal(taskEvent.ownerId, actor.id)
    assert.equal(taskEvent.publication.status, 'pending')
    createdIds.events.push(taskEvent.id)

    const fixedNow = 1_800_000_000_000
    const fixedRandom = 0.123456789
    const conflictingTaskId = `task-${fixedNow}-${fixedRandom.toString(16).slice(2, 8)}`
    const conflictEvent = await repository.domainEvents.enqueue(buildDomainEvent({
      type: 'task.created',
      aggregateId: `conflict-${suffix}`,
      ownerId: actor.id,
      correlationId: `conflict-${suffix}`,
      idempotencyKey: `task.created.v1:${conflictingTaskId}`,
      payload: { taskId: `conflict-${suffix}`, publisherId: actor.id, status: 'open', category: 'integration' },
    }))
    createdIds.events.push(conflictEvent.id)
    const originalDateNow = Date.now
    const originalRandom = Math.random
    Date.now = () => fixedNow
    Math.random = () => fixedRandom
    try {
      await assert.rejects(repository.tasks.create({
        title: `Rolled Back Task ${suffix}`,
        category: 'integration',
        pointsReward: 0,
        description: 'This Task must roll back when Outbox persistence conflicts.',
        acceptanceRules: 'No Task row remains.',
        attachmentIds: [],
      }, actor))
    } finally {
      Date.now = originalDateNow
      Math.random = originalRandom
    }
    assert.equal(await repository.client.task.findUnique({ where: { id: conflictingTaskId } }), null)
    await repository.client.domainEventPublication.delete({ where: { eventId: conflictEvent.id } })
    await repository.client.domainEventOutbox.delete({ where: { id: conflictEvent.id } })
    createdIds.events = createdIds.events.filter((id) => id !== conflictEvent.id)

    const factBeforeReplay = await repository.client.domainEventOutbox.findUnique({ where: { id: taskEvent.id } })
    const competingEventClaims = await Promise.all([
      repository.domainEvents.claimBatch({ workerId: 'event-worker-a', limit: 1 }),
      repository.domainEvents.claimBatch({ workerId: 'event-worker-b', limit: 1 }),
    ])
    const eventClaims = competingEventClaims.flat().filter((event) => event.id === taskEvent.id)
    assert.equal(eventClaims.length, 1)
    assert.equal(await repository.domainEvents.markPublished(taskEvent.id, 'foreign-token'), false)
    assert.equal(await repository.domainEvents.markPublished(taskEvent.id, eventClaims[0].claimToken), true)
    assert.equal(await repository.domainEvents.markFailed(taskEvent.id, eventClaims[0].claimToken, 'LATE'), false)
    const replayed = await repository.domainEvents.replay(taskEvent.id, actor, { reasonCode: 'integration_replay' })
    assert.equal(replayed.publication.status, 'pending')
    const factAfterReplay = await repository.client.domainEventOutbox.findUnique({ where: { id: taskEvent.id } })
    assert.deepEqual(factAfterReplay, factBeforeReplay)

    const definitionId = `foundation-job-${suffix}`
    createdIds.definitions.push(definitionId)
    await repository.jobs.ensureDefinition({ id: definitionId, type: definitionId, defaultTimeoutSeconds: 60 })
    const claimedRun = await repository.jobs.enqueue({
      id: `job-claim-${suffix}`,
      definitionId,
      idempotencyKey: `job-claim:${suffix}`,
      correlationId: `job-claim:${suffix}`,
      input: { safe: true, apiToken: 'must-not-persist', outputUrl: 'https://private.example.test' },
    })
    createdIds.jobs.push(claimedRun.id)
    assert.deepEqual(claimedRun.input, { safe: true })
    const competingJobClaims = await Promise.all([
      repository.jobs.claim({ workerId: 'job-worker-a', definitionId }),
      repository.jobs.claim({ workerId: 'job-worker-b', definitionId }),
    ])
    const jobClaims = competingJobClaims.filter(Boolean)
    assert.equal(jobClaims.length, 1)
    assert.equal(await repository.jobs.complete(claimedRun.id, 'foreign-token', { count: 1 }), null)
    const completed = await repository.jobs.complete(claimedRun.id, jobClaims[0].leaseToken, {
      count: 1,
      token: 'must-not-persist',
      outputUrl: 'https://private.example.test',
    })
    assert.equal(completed.status, 'succeeded')
    assert.deepEqual(completed.result, { count: 1 })
    assert.equal(await repository.jobs.fail(claimedRun.id, jobClaims[0].leaseToken, 'LATE'), null)

    const cancelledRun = await repository.jobs.enqueue({
      id: `job-cancel-${suffix}`,
      definitionId,
      idempotencyKey: `job-cancel:${suffix}`,
      correlationId: `job-cancel:${suffix}`,
    })
    createdIds.jobs.push(cancelledRun.id)
    const cancelClaim = await repository.jobs.claim({ workerId: 'job-worker-cancel', definitionId })
    assert.equal(await repository.jobs.cancelRunning(cancelledRun.id, cancelClaim.leaseToken), null)
    assert.equal((await repository.jobs.find(cancelledRun.id)).attempts[0].status, 'running')
    await repository.jobs.requestCancel(cancelledRun.id, actor, { reasonCode: 'integration_cancel' })
    assert.equal(await repository.jobs.cancelRunning(cancelledRun.id, 'foreign-token'), null)
    assert.equal((await repository.jobs.cancelRunning(cancelledRun.id, cancelClaim.leaseToken)).status, 'cancelled')

    const timedRun = await repository.jobs.enqueue({
      id: `job-timeout-${suffix}`,
      definitionId,
      idempotencyKey: `job-timeout:${suffix}`,
      correlationId: `job-timeout:${suffix}`,
    })
    createdIds.jobs.push(timedRun.id)
    const timeoutClaim = await repository.jobs.claim({ workerId: 'job-worker-timeout', definitionId })
    const expiredAt = new Date(Date.now() - 1_000)
    await repository.client.$transaction([
      repository.client.jobRun.update({ where: { id: timedRun.id }, data: { timeoutAt: expiredAt } }),
      repository.client.jobAttempt.update({ where: { leaseToken: timeoutClaim.leaseToken }, data: { timeoutAt: expiredAt } }),
    ])
    assert.deepEqual(await repository.jobs.sweepTimeouts(), [timedRun.id])
    const timedOut = await repository.jobs.find(timedRun.id)
    assert.equal(timedOut.status, 'timed_out')
    assert.equal(timedOut.attempts[0].status, 'timed_out')
    assert.equal(await repository.jobs.complete(timedRun.id, timeoutClaim.leaseToken, { late: true }), null)
  } finally {
    await repository.client.jobAttempt.deleteMany({ where: { runId: { in: createdIds.jobs } } })
    await repository.client.jobRun.deleteMany({ where: { id: { in: createdIds.jobs } } })
    await repository.client.jobDefinition.deleteMany({ where: { id: { in: createdIds.definitions } } })
    await repository.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await transaction.auditEvent.deleteMany({ where: { actorId: actor.id } })
    })
    await repository.client.domainEventPublication.deleteMany({ where: { eventId: { in: createdIds.events } } })
    await repository.client.domainEventOutbox.deleteMany({ where: { id: { in: createdIds.events } } })
    if (createdIds.task) await repository.client.task.deleteMany({ where: { publisherId: actor.id } })
    await repository.client.user.deleteMany({ where: { id: actor.id } })
    await repository.client.$disconnect()
  }
})
