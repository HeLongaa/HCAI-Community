import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildProviderCostReservation,
  calculateProviderEstimate,
  createProviderPricingSnapshot,
  providerBillingUnits,
  providerCostCloseout,
  toProviderMoneyMicros,
} from './providerCostContract.js'

const snapshotFor = (workspace, billingUnit, unitPrice = '0.025') => createProviderPricingSnapshot({
  providerId: `fixture-${workspace}`,
  providerAccountRef: 'staging',
  providerModelId: `fixture/${workspace}-model`,
  workspace,
  currency: 'USD',
  billingUnit,
  unitPrice,
  sourceType: 'fixture_config',
  sourceRef: `fixture:${workspace}:v1`,
  effectiveAt: '2026-07-12T00:00:00.000Z',
})

test('provider pricing snapshots cover all four workspace billing contracts', () => {
  const scenarios = [
    ['image', 'image', '2', 0.05],
    ['chat', 'input_tokens', '1000', 25],
    ['video', 'generated_seconds', '8', 0.2],
    ['music', 'generated_minutes', '1.5', 0.0375],
  ]

  for (const [workspace, unit, quantity, expected] of scenarios) {
    assert.ok(providerBillingUnits[workspace].includes(unit))
    const snapshot = snapshotFor(workspace, unit)
    assert.equal(snapshot.snapshotHash.length, 64)
    assert.equal(calculateProviderEstimate({ snapshot, quantity }).amount, expected)
  }
})

test('provider money conversion preserves six decimal places without float accumulation', () => {
  assert.equal(toProviderMoneyMicros('0.000001'), 1n)
  assert.equal(toProviderMoneyMicros('12.345678'), 12_345_678n)
  assert.equal(toProviderMoneyMicros('12.3456789'), null)
  assert.equal(toProviderMoneyMicros('-1'), null)
})

test('provider pricing snapshots reject unsafe identifiers, unsupported units, and tampering', () => {
  assert.throws(
    () => snapshotFor('image', 'input_tokens'),
    { code: 'CREATIVE_PROVIDER_COST_CONTRACT_INVALID' },
  )
  assert.throws(
    () => createProviderPricingSnapshot({
      ...snapshotFor('image', 'image'),
      providerAccountRef: 'token=provider-secret',
    }),
    { code: 'CREATIVE_PROVIDER_COST_CONTRACT_INVALID' },
  )
  const snapshot = snapshotFor('video', 'generated_seconds')
  assert.throws(
    () => calculateProviderEstimate({ snapshot: { ...snapshot, unitPriceMicros: '1' }, quantity: 1 }),
    { code: 'CREATIVE_PROVIDER_PRICING_SNAPSHOT_INVALID' },
  )
})

test('provider pricing estimates reject expired snapshots', () => {
  const snapshot = createProviderPricingSnapshot({
    providerId: 'fixture-image',
    providerAccountRef: 'staging',
    providerModelId: 'fixture/image-model',
    workspace: 'image',
    currency: 'USD',
    billingUnit: 'image',
    unitPrice: '0.025',
    sourceType: 'fixture_config',
    sourceRef: 'fixture:image:expiring-v1',
    effectiveAt: '2026-07-12T00:00:00.000Z',
    expiresAt: '2026-07-13T00:00:00.000Z',
  })

  assert.equal(calculateProviderEstimate({
    snapshot,
    quantity: '1',
    now: '2026-07-12T23:59:59.999Z',
  }).estimateMicros, '25000')
  assert.throws(
    () => calculateProviderEstimate({ snapshot, quantity: '1', now: '2026-07-13T00:00:00.000Z' }),
    { code: 'CREATIVE_PROVIDER_PRICING_SNAPSHOT_EXPIRED' },
  )
})

test('provider cost reservation requires estimate currency cap scope and immutable snapshot', () => {
  const providerCost = {
    providerId: 'replicate',
    providerAccountRef: 'staging',
    model: {
      providerModelId: 'black-forest-labs/flux-1.1-pro',
      pricingSource: 'fixture_config',
      pricingSnapshotAt: '2026-07-12T00:00:00.000Z',
    },
    estimate: { currency: 'USD', amount: 0.25 },
    budget: {
      budgetScope: 'staging:replicate:image',
      dailyCapCurrency: 'USD',
      dailyCapAmount: 5,
      spentAmount: 1,
    },
  }
  const reservation = buildProviderCostReservation({
    generationId: 'gen-provider-cost-fixture',
    providerCost,
    workspace: 'image',
    mode: 'text_to_image',
    now: new Date('2026-07-12T08:00:00.000Z'),
  })
  assert.equal(reservation.estimateMicros, '250000')
  assert.equal(reservation.capMicros, '5000000')
  assert.equal(reservation.openingSpentMicros, '1000000')
  assert.equal(reservation.pricingSnapshot.snapshotHash, reservation.pricingSnapshotHash)
  assert.equal(JSON.stringify(reservation).includes('secret'), false)

  assert.throws(
    () => buildProviderCostReservation({
      generationId: 'gen-provider-cost-currency-mismatch',
      providerCost: {
        ...providerCost,
        budget: { ...providerCost.budget, dailyCapCurrency: 'EUR' },
      },
      workspace: 'image',
      mode: 'text_to_image',
    }),
    { code: 'CREATIVE_PROVIDER_BUDGET_BLOCKED' },
  )
})

test('provider cost reservation verifies generated-second estimates against their pricing snapshot', () => {
  const reservation = buildProviderCostReservation({
    generationId: 'gen-provider-cost-video',
    providerCost: {
      providerId: 'google-veo-3-1-fast',
      providerAccountRef: 'staging',
      model: {
        providerModelId: 'veo-3.1-fast',
        pricingSource: 'v1_public_list_price',
        pricingSnapshotAt: '2026-07-13T00:00:00.000Z',
      },
      estimate: {
        currency: 'USD',
        amount: 0.8,
        billingUnit: 'generated_seconds',
        quantity: 8,
        unitPrice: 0.1,
      },
      budget: {
        budgetScope: 'staging:google:video',
        dailyCapCurrency: 'USD',
        dailyCapAmount: 20,
        spentAmount: 0,
      },
    },
    workspace: 'video',
    mode: 'text_to_video',
    now: new Date('2026-07-13T00:00:00.000Z'),
  })
  assert.equal(reservation.estimateMicros, '800000')
  assert.equal(reservation.pricingSnapshot.billingUnit, 'generated_seconds')
  assert.equal(reservation.pricingSnapshot.unitPriceMicros, '100000')

  assert.throws(() => buildProviderCostReservation({
    generationId: 'gen-provider-cost-video-mismatch',
    providerCost: {
      providerId: 'google-veo-3-1-fast',
      providerAccountRef: 'staging',
      model: { providerModelId: 'veo-3.1-fast' },
      estimate: { currency: 'USD', amount: 0.9, billingUnit: 'generated_seconds', quantity: 8, unitPrice: 0.1 },
      budget: { budgetScope: 'staging:google:video', dailyCapCurrency: 'USD', dailyCapAmount: 20, spentAmount: 0 },
    },
    workspace: 'video',
    mode: 'text_to_video',
  }), (error) => error.code === 'CREATIVE_PROVIDER_COST_CONTRACT_INVALID' && error.details.reasonCode === 'estimate_calculation_mismatch')
})

test('provider closeout settles known actuals and reconciles missing or mismatched actuals', () => {
  const generation = {
    status: 'completed',
    usage: {
      providerCost: {
        estimate: { currency: 'USD', amount: 0.25 },
        actual: { currency: 'USD', amount: 0.2 },
        usage: { unit: 'prediction_seconds', quantity: 2 },
        risk: { costKnown: true },
      },
    },
  }
  assert.deepEqual(providerCostCloseout(generation), {
    action: 'settle',
    actualMicros: '200000',
    actualCurrency: 'USD',
    usage: generation.usage.providerCost.usage,
    risk: generation.usage.providerCost.risk,
  })
  assert.equal(providerCostCloseout({
    ...generation,
    usage: { providerCost: { ...generation.usage.providerCost, actual: { currency: 'USD', amount: null } } },
  }).action, 'reconcile')
  assert.equal(providerCostCloseout({
    ...generation,
    usage: { providerCost: { ...generation.usage.providerCost, actual: { currency: 'EUR', amount: 0.2 } } },
  }).reasonCode, 'actual_currency_mismatch')
})
