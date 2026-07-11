import assert from 'node:assert/strict'
import test from 'node:test'

import { buildProviderCostReservation } from '../creative/providerCostContract.js'
import { createSeedRepository } from './seedRepository.js'

const actor = { id: 'demo-user-admin', handle: 'legalpixel' }

const reservationFor = ({ generationId, scope, estimate = 0.25, cap = 1, spent = 0 }) =>
  buildProviderCostReservation({
    generationId,
    workspace: 'image',
    mode: 'text_to_image',
    now: new Date('2026-07-12T08:00:00.000Z'),
    providerCost: {
      providerId: 'replicate',
      providerAccountRef: 'staging',
      model: {
        providerModelId: 'black-forest-labs/flux-1.1-pro',
        pricingSource: 'fixture_config',
        pricingSnapshotAt: '2026-07-12T00:00:00.000Z',
      },
      estimate: { currency: 'USD', amount: estimate },
      budget: {
        budgetScope: scope,
        dailyCapCurrency: 'USD',
        dailyCapAmount: cap,
        spentAmount: spent,
      },
    },
  })

test('seed Provider cost ledger reserves atomically and dedupes by source key', async () => {
  const repository = createSeedRepository()
  const scope = `staging:replicate:image:reserve-${Date.now()}`
  const payload = reservationFor({ generationId: `gen-cost-reserve-${Date.now()}`, scope, estimate: 0.25, cap: 0.4 })

  const first = await repository.creativeProviderCosts.reserve(payload, actor)
  const duplicate = await repository.creativeProviderCosts.reserve(payload, actor)
  const blocked = await repository.creativeProviderCosts.reserve(
    reservationFor({ generationId: `gen-cost-blocked-${Date.now()}`, scope, estimate: 0.25, cap: 0.4 }),
    actor,
  )

  assert.equal(first.reserved, true)
  assert.equal(first.duplicate, false)
  assert.equal(duplicate.reserved, true)
  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.ledger.id, first.ledger.id)
  assert.equal(blocked.reserved, false)
  assert.equal(blocked.reasonCode, 'budget_cap_exceeded')
  assert.equal(first.ledger.pricingSnapshotHash.length, 64)
  assert.equal(JSON.stringify(first).includes('secret'), false)
})

test('seed Provider cost ledger settles actual cost idempotently and records overruns', async () => {
  const repository = createSeedRepository()
  const scope = `staging:replicate:image:settle-${Date.now()}`
  const payload = reservationFor({ generationId: `gen-cost-settle-${Date.now()}`, scope, estimate: 0.25, cap: 1 })
  const reserved = await repository.creativeProviderCosts.reserve(payload, actor)

  const settled = await repository.creativeProviderCosts.settle(payload.sourceKey, {
    actualMicros: '300000',
    actualCurrency: 'USD',
    providerJobId: 'pred-cost-settle',
    usage: { unit: 'prediction_seconds', quantity: 3 },
  }, actor)
  const duplicate = await repository.creativeProviderCosts.settle(payload.sourceKey, {
    actualMicros: '300000',
    actualCurrency: 'USD',
  }, actor)

  assert.equal(reserved.ledger.status, 'reserved')
  assert.equal(settled.status, 'settled')
  assert.equal(settled.actualMicros, '300000')
  assert.equal(duplicate.id, settled.id)
  assert.equal(settled.budgetWindow.reservedMicros, '0')
  assert.equal(settled.budgetWindow.spentMicros, '300000')
  const settlementAudits = await repository.audit.list({
    action: 'creative.provider_cost.settled',
    resourceType: 'creative_provider_cost_ledger',
  })
  assert.equal(settlementAudits.items.filter((item) => item.resourceId === settled.id).length, 1)
  assert.throws(
    () => repository.creativeProviderCosts.settle(payload.sourceKey, {
      actualMicros: '200000',
      actualCurrency: 'USD',
    }, actor),
    { code: 'CREATIVE_PROVIDER_COST_LEDGER_CONFLICT' },
  )
})

test('seed Provider cost ledger keeps uncertain cost reserved until explicit reconciliation release', async () => {
  const repository = createSeedRepository()
  const scope = `staging:replicate:image:reconcile-${Date.now()}`
  const payload = reservationFor({ generationId: `gen-cost-reconcile-${Date.now()}`, scope, estimate: 0.2, cap: 1 })
  await repository.creativeProviderCosts.reserve(payload, actor)

  const reconciliation = await repository.creativeProviderCosts.reconcile(payload.sourceKey, {
    reasonCode: 'actual_cost_missing',
    providerJobId: 'pred-cost-reconcile',
  }, actor)
  assert.equal(reconciliation.status, 'reconciliation_required')
  assert.equal(reconciliation.budgetWindow.reservedMicros, '200000')
  const duplicateReconciliation = await repository.creativeProviderCosts.reconcile(payload.sourceKey, {
    reasonCode: 'actual_cost_missing',
    providerJobId: 'pred-cost-reconcile',
  }, actor)
  assert.equal(duplicateReconciliation.id, reconciliation.id)
  const reconciliationAudits = await repository.audit.list({
    action: 'creative.provider_cost.reconciliation_required',
    resourceType: 'creative_provider_cost_ledger',
  })
  assert.equal(reconciliationAudits.items.filter((item) => item.resourceId === reconciliation.id).length, 1)

  const released = await repository.creativeProviderCosts.release(payload.sourceKey, 'operator_confirmed_not_billed', actor)
  const duplicate = await repository.creativeProviderCosts.release(payload.sourceKey, 'operator_confirmed_not_billed', actor)
  assert.equal(released.status, 'released')
  assert.equal(released.budgetWindow.reservedMicros, '0')
  assert.equal(released.budgetWindow.releasedMicros, '200000')
  assert.equal(duplicate.id, released.id)
  const releaseAudits = await repository.audit.list({
    action: 'creative.provider_cost.released',
    resourceType: 'creative_provider_cost_ledger',
  })
  assert.equal(releaseAudits.items.filter((item) => item.resourceId === released.id).length, 1)
})

test('seed Provider cost ledger blocks concurrent reservations beyond one budget cap', async () => {
  const repository = createSeedRepository()
  const scope = `staging:replicate:image:concurrent-${Date.now()}`
  const attempts = await Promise.all(Array.from({ length: 10 }, (_, index) =>
    repository.creativeProviderCosts.reserve(reservationFor({
      generationId: `gen-cost-concurrent-${Date.now()}-${index}`,
      scope,
      estimate: 0.2,
      cap: 1,
    }), actor)))

  assert.equal(attempts.filter((attempt) => attempt.reserved).length, 5)
  assert.equal(attempts.filter((attempt) => !attempt.reserved && attempt.reasonCode === 'budget_cap_exceeded').length, 5)
  const window = await repository.creativeProviderCosts.getBudgetWindow(reservationFor({
    generationId: 'gen-cost-concurrent-window-read',
    scope,
    estimate: 0.2,
    cap: 1,
  }))
  assert.equal(window.reservedMicros, '1000000')
  assert.equal(window.spentMicros, '0')
})
