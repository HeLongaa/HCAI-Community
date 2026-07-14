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

const creditAuditEvents = async (repository, ledgerId) => {
  const audit = await repository.audit.list({
    resourceType: 'creative_credit_ledger',
    limit: 50,
  })
  return audit.items.filter((event) => event.resourceId === ledgerId)
}

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

  const auditEvents = await creditAuditEvents(repository, reserved.credit.ledgerId)
  assert.equal(auditEvents.filter((event) => event.action === 'creative.credit.reserved').length, 1)
  assert.equal(auditEvents.filter((event) => event.action === 'creative.credit.settled').length, 1)
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

  const auditEvents = await creditAuditEvents(repository, reserved.credit.ledgerId)
  assert.equal(auditEvents.filter((event) => event.action === 'creative.credit.reserved').length, 1)
  assert.equal(auditEvents.filter((event) => event.action === 'creative.credit.refunded').length, 1)
})

test('seed creative credit repository reuses quota reservation id as idempotency key', async () => {
  const repository = createSeedRepository()
  const payload = creditPayload({ quotaReservationId: 'quota-idempotent-credit' })

  const reserved = await repository.creativeCredits.reserve(payload, actor)
  const replayed = await repository.creativeCredits.reserve(payload, actor)

  assert.equal(replayed.reserved, true)
  assert.equal(replayed.credit.ledgerId, reserved.credit.ledgerId)
  assert.equal(replayed.credit.reserved, 2)
  assert.throws(
    () => repository.creativeCredits.reserve({ ...payload, amount: 99 }, actor),
    (error) => error?.statusCode === 409 && error?.code === 'ACCOUNTING_OPERATION_CONFLICT',
  )
})

test('seed creative credit repository stores only safe metadata and audit evidence', async () => {
  const repository = createSeedRepository()
  const reserved = await repository.creativeCredits.reserve(creditPayload({
    generationId: 'gen-credit-audit-safe',
    quotaReservationId: 'quota-credit-audit-safe',
    reasonCode: 'generation_reserved token=credit-secret https://replicate.example/reserve',
    metadata: {
      providerId: 'mock token=provider-secret',
      providerMode: 'fixture https://replicate.example/mode',
      costModel: 'fixture',
      metered: true,
      prompt: 'raw prompt should not be stored',
      providerPayload: { token: 'payload-secret' },
      outputUrl: 'https://replicate.example/raw-output.png',
    },
  }), actor)

  assert.equal(reserved.credit.reasonCode.includes('credit-secret'), false)
  assert.equal(reserved.credit.reasonCode.includes('https://replicate.example'), false)
  assert.equal(reserved.credit.metadata.providerId.includes('provider-secret'), false)
  assert.equal(reserved.credit.metadata.providerMode.includes('https://replicate.example'), false)
  assert.equal(reserved.credit.metadata.costModel, 'fixture')
  assert.equal(reserved.credit.metadata.metered, true)
  assert.equal(Object.hasOwn(reserved.credit.metadata, 'prompt'), false)
  assert.equal(Object.hasOwn(reserved.credit.metadata, 'providerPayload'), false)
  assert.equal(Object.hasOwn(reserved.credit.metadata, 'outputUrl'), false)

  const refunded = await repository.creativeCredits.refund(reserved.credit.ledgerId, {
    refundedAmount: 2,
    reasonCode: 'provider_failed token=refund-secret https://replicate.example/refund',
    metadata: {
      outputAssetIds: ['media-safe-1', 'https://replicate.example/raw-output.png'],
      reviewRequired: false,
      token: 'refund-metadata-secret',
    },
  }, actor)

  const serializedCredit = JSON.stringify(refunded)
  assert.equal(serializedCredit.includes('refund-secret'), false)
  assert.equal(serializedCredit.includes('refund-metadata-secret'), false)
  assert.equal(serializedCredit.includes('raw-output.png'), false)
  assert.deepEqual(refunded.metadata.outputAssetIds, ['media-safe-1', '<redacted-url>'])

  const auditEvents = await creditAuditEvents(repository, reserved.credit.ledgerId)
  const serializedAudit = JSON.stringify(auditEvents)
  assert.equal(serializedAudit.includes('gen-credit-audit-safe'), true)
  assert.equal(serializedAudit.includes('credit-secret'), false)
  assert.equal(serializedAudit.includes('provider-secret'), false)
  assert.equal(serializedAudit.includes('refund-secret'), false)
  assert.equal(serializedAudit.includes('refund-metadata-secret'), false)
  assert.equal(serializedAudit.includes('raw prompt'), false)
  assert.equal(serializedAudit.includes('https://replicate.example'), false)
  assert.equal(auditEvents.filter((event) => event.action === 'creative.credit.refunded').length, 1)
  const reservedEvent = auditEvents.find((event) => event.action === 'creative.credit.reserved')
  const refundedEvent = auditEvents.find((event) => event.action === 'creative.credit.refunded')
  assert.equal(reservedEvent.metadata.generationId, 'gen-credit-audit-safe')
  assert.equal(reservedEvent.metadata.quotaReservationId, 'quota-credit-audit-safe')
  assert.equal(reservedEvent.metadata.workspace, 'image')
  assert.equal(reservedEvent.metadata.mode, 'text_to_image')
  assert.equal(reservedEvent.metadata.amount, 2)
  assert.equal(refundedEvent.metadata.refundedAmount, 2)
  assert.equal(refundedEvent.metadata.reasonCode.includes('provider_failed'), true)
})
