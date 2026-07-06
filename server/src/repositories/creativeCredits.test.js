import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeedRepository } from './seedRepository.js'

const actor = {
  id: 'demo-user-creator',
  handle: 'promptlin',
}

const creditPayload = (overrides = {}) => ({
  generationId: `gen-credit-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  quotaReservationId: `quota-credit-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  actorId: actor.id,
  actorHandle: actor.handle,
  workspace: 'image',
  mode: 'text_to_image',
  amount: 2,
  reasonCode: 'generation_reserved',
  metadata: { providerId: 'mock' },
  ...overrides,
})

test('seed creative credit repository reserves and settles idempotently', async () => {
  const repository = createSeedRepository()

  const reserved = await repository.creativeCredits.reserve(creditPayload(), actor)
  assert.equal(reserved.reserved, true)
  assert.equal(reserved.credit.status, 'reserved')
  assert.equal(reserved.credit.reserved, 2)
  assert.equal(reserved.credit.settled, 0)
  assert.equal(reserved.credit.refunded, 0)
  assert.ok(reserved.credit.ledgerId)

  const settled = await repository.creativeCredits.settle(reserved.credit.ledgerId, {
    settledAmount: 2,
    reasonCode: 'generation_completed',
  }, actor)
  assert.equal(settled.status, 'settled')
  assert.equal(settled.settled, 2)
  assert.equal(settled.refunded, 0)

  const replayed = await repository.creativeCredits.settle(reserved.credit.ledgerId, {
    settledAmount: 2,
  }, actor)
  assert.deepEqual(replayed, settled)
})

test('seed creative credit repository refunds reserved credits once', async () => {
  const repository = createSeedRepository()

  const reserved = await repository.creativeCredits.reserve(creditPayload({
    actorId: 'demo-user-publisher',
    actorHandle: 'launchteam',
    amount: 1,
  }), { id: 'demo-user-publisher', handle: 'launchteam' })

  const refunded = await repository.creativeCredits.refund(reserved.credit.ledgerId, {
    refundedAmount: 1,
    reasonCode: 'provider_failed',
  }, { id: 'demo-user-publisher', handle: 'launchteam' })
  assert.equal(refunded.status, 'refunded')
  assert.equal(refunded.settled, 0)
  assert.equal(refunded.refunded, 1)
  assert.equal(refunded.reasonCode, 'provider_failed')

  const replayed = await repository.creativeCredits.refund(reserved.credit.ledgerId, {
    refundedAmount: 1,
  }, { id: 'demo-user-publisher', handle: 'launchteam' })
  assert.deepEqual(replayed, refunded)
})

test('seed creative credit repository reuses quota reservation id as idempotency key', async () => {
  const repository = createSeedRepository()
  const payload = creditPayload({ quotaReservationId: 'quota-idempotent-credit' })

  const reserved = await repository.creativeCredits.reserve(payload, actor)
  const replayed = await repository.creativeCredits.reserve({
    ...payload,
    amount: 99,
  }, actor)

  assert.equal(replayed.reserved, true)
  assert.equal(replayed.credit.ledgerId, reserved.credit.ledgerId)
  assert.equal(replayed.credit.reserved, 2)
})
