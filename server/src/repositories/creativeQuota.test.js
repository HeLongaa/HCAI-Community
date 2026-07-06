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
