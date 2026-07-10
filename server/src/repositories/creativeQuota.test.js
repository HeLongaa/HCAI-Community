import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeedRepository } from './seedRepository.js'

const actor = {
  id: 'demo-user-creator',
  handle: 'promptlin',
}

const quotaPayload = (overrides = {}) => ({
  generationId: `gen-quota-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  actorId: actor.id,
  actorHandle: actor.handle,
  workspace: 'image',
  windowType: 'daily',
  windowStart: '2026-07-06T00:00:00.000Z',
  windowEnd: '2026-07-06T23:59:59.999Z',
  limit: 2,
  costUnits: 1,
  policyVersion: 'creative-policy-v1',
  ...overrides,
})

test('seed creative quota repository reserves, commits, and blocks over-limit units', async () => {
  const repository = createSeedRepository()

  const first = await repository.creativeQuota.reserve(quotaPayload(), actor)
  assert.equal(first.reserved, true)
  assert.equal(first.quota.reserved, 1)
  assert.equal(first.quota.used, 0)
  assert.equal(first.quota.remaining, 1)
  assert.ok(first.reservationId)

  const committed = await repository.creativeQuota.commit(first.reservationId, actor)
  assert.equal(committed.reserved, 0)
  assert.equal(committed.used, 1)
  assert.equal(committed.remaining, 1)

  const second = await repository.creativeQuota.reserve(quotaPayload({ costUnits: 1 }), actor)
  assert.equal(second.reserved, true)

  const denied = await repository.creativeQuota.reserve(quotaPayload({ costUnits: 1 }), actor)
  assert.equal(denied.reserved, false)
  assert.equal(denied.quota.remaining, 0)
})

test('seed creative quota repository releases reserved units without charging usage', async () => {
  const repository = createSeedRepository()
  const reserved = await repository.creativeQuota.reserve(quotaPayload({
    actorHandle: 'launchteam',
    actorId: 'demo-user-publisher',
  }), { id: 'demo-user-publisher', handle: 'launchteam' })

  assert.equal(reserved.quota.reserved, 1)

  const released = await repository.creativeQuota.release(
    reserved.reservationId,
    'provider_failed',
    { id: 'demo-user-publisher', handle: 'launchteam' },
  )
  assert.equal(released.reserved, 0)
  assert.equal(released.used, 0)
  assert.equal(released.released, 1)
  assert.equal(released.remaining, 2)
})

test('seed creative quota repository keeps commit and release idempotent', async () => {
  const repository = createSeedRepository()
  const idempotentActor = { id: 'demo-user-quota-idempotent', handle: 'quotaidempotent' }
  const reserved = await repository.creativeQuota.reserve(quotaPayload({
    actorId: idempotentActor.id,
    actorHandle: idempotentActor.handle,
    windowStart: '2026-07-07T00:00:00.000Z',
    windowEnd: '2026-07-07T23:59:59.999Z',
    costUnits: 2,
    limit: 3,
  }), idempotentActor)

  assert.equal(reserved.reserved, true)
  assert.equal(reserved.quota.reserved, 2)

  const firstCommit = await repository.creativeQuota.commit(reserved.reservationId, idempotentActor)
  const secondCommit = await repository.creativeQuota.commit(reserved.reservationId, idempotentActor)
  const releaseAfterCommit = await repository.creativeQuota.release(reserved.reservationId, 'provider_failed', idempotentActor)

  assert.equal(firstCommit.reserved, 0)
  assert.equal(firstCommit.used, 2)
  assert.equal(firstCommit.released, 0)
  assert.deepEqual(secondCommit, firstCommit)
  assert.deepEqual(releaseAfterCommit, firstCommit)

  const secondReserved = await repository.creativeQuota.reserve(quotaPayload({
    generationId: 'gen-quota-release-idempotent',
    actorHandle: 'quotarelease',
    actorId: 'demo-user-quota-release',
    windowStart: '2026-07-08T00:00:00.000Z',
    windowEnd: '2026-07-08T23:59:59.999Z',
    limit: 3,
    costUnits: 2,
  }), { id: 'demo-user-quota-release', handle: 'quotarelease' })
  const firstRelease = await repository.creativeQuota.release(
    secondReserved.reservationId,
    'provider_failed',
    { id: 'demo-user-quota-release', handle: 'quotarelease' },
  )
  const secondRelease = await repository.creativeQuota.release(
    secondReserved.reservationId,
    'provider_failed',
    { id: 'demo-user-quota-release', handle: 'quotarelease' },
  )
  const commitAfterRelease = await repository.creativeQuota.commit(
    secondReserved.reservationId,
    { id: 'demo-user-quota-release', handle: 'quotarelease' },
  )

  assert.equal(firstRelease.reserved, 0)
  assert.equal(firstRelease.used, 0)
  assert.equal(firstRelease.released, 2)
  assert.equal(firstRelease.remaining, 3)
  assert.deepEqual(secondRelease, firstRelease)
  assert.deepEqual(commitAfterRelease, firstRelease)
})

test('seed creative quota repository records only safe audit metadata', async () => {
  const repository = createSeedRepository()
  const auditActor = { id: 'demo-user-quota-audit', handle: 'quotaaudit' }
  const reserved = await repository.creativeQuota.reserve(quotaPayload({
    generationId: 'gen-quota-audit-safe',
    actorId: auditActor.id,
    actorHandle: auditActor.handle,
    windowStart: '2026-07-09T00:00:00.000Z',
    windowEnd: '2026-07-09T23:59:59.999Z',
    costUnits: 1,
  }), auditActor)
  await repository.creativeQuota.release(reserved.reservationId, 'provider_failed token=secret https://replicate.example/output.png', auditActor)

  const audit = await repository.audit.list({
    resourceType: 'creative_quota_reservation',
    limit: 10,
  })
  const quotaEvents = audit.items.filter((event) => event.resourceId === reserved.reservationId)
  const serialized = JSON.stringify(quotaEvents)

  assert.equal(quotaEvents.some((event) => event.action === 'creative.quota.reserved'), true)
  assert.equal(quotaEvents.some((event) => event.action === 'creative.quota.released'), true)
  assert.equal(serialized.includes('gen-quota-audit-safe'), true)
  assert.equal(serialized.includes('provider_failed'), true)
  assert.equal(serialized.includes('token=secret'), false)
  assert.equal(serialized.includes('https://replicate.example'), false)
  assert.equal(serialized.includes('prompt'), false)
  const reservedEvent = quotaEvents.find((event) => event.action === 'creative.quota.reserved')
  const releasedEvent = quotaEvents.find((event) => event.action === 'creative.quota.released')
  assert.equal(reservedEvent.metadata.generationId, 'gen-quota-audit-safe')
  assert.equal(reservedEvent.metadata.workspace, 'image')
  assert.equal(reservedEvent.metadata.units, 1)
  assert.equal(typeof reservedEvent.metadata.quotaWindowId, 'string')
  assert.equal(releasedEvent.metadata.reason.includes('provider_failed'), true)
})
