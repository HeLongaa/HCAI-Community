import assert from 'node:assert/strict'
import test from 'node:test'

import { buildProviderCostReservation } from '../creative/providerCostContract.js'

const databaseUrl = process.env.MUSIC_DATABASE_URL ?? (
  String(process.env.MUSIC_DATABASE_INTEGRATION_ENABLED ?? '').trim().toLowerCase() === 'true'
    ? process.env.DATABASE_URL
    : null
)

test('Prisma preserves Router Music request pricing and settles one USD 0.15 charge idempotently', {
  skip: !databaseUrl,
}, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repositories = await createPrismaRepository()
  assert.ok(repositories)
  const client = repositories.client
  const suffix = Date.now()
  const generationId = `router-music-cost-integration-${suffix}`
  let costLedgerId = null
  let budgetWindowId = null
  try {
    await client.creativeGeneration.create({
      data: {
        id: generationId,
        workspace: 'music',
        mode: 'instrumental',
        providerId: 'hcai-router-minimax-music-3',
        providerMode: 'router_music',
        status: 'completed',
        promptHash: 'c'.repeat(64),
        inputAssetIds: [],
        parameterKeys: ['durationSeconds'],
        outputAssetIds: [],
        providerRequestId: `trace-music-${suffix}`,
        providerJobId: `trace-music-${suffix}`,
      },
    })
    const reservationPayload = buildProviderCostReservation({
      generationId,
      providerCost: {
        providerId: 'hcai-router-minimax-music-3',
        providerAccountRef: `music-integration-${suffix}`,
        model: {
          providerModelId: 'music-3.0',
          pricingSource: 'model_control_pricing_version',
          pricingSourceRef: `price-music-${suffix}`,
          pricingEffectiveAt: '2026-07-22T00:00:00.000Z',
          pricingSnapshotAt: '2026-07-22T01:00:00.000Z',
        },
        estimate: { currency: 'USD', amount: 0.15, billingUnit: 'request', quantity: 1, unitPrice: 0.15 },
        budget: { budgetScope: `staging:router-music:${suffix}`, dailyCapCurrency: 'USD', dailyCapAmount: 10, spentAmount: 0 },
      },
      workspace: 'music',
      mode: 'instrumental',
      now: new Date('2026-07-22T01:00:00.000Z'),
    })
    const reserved = await repositories.creativeProviderCosts.reserve(reservationPayload, null)
    costLedgerId = reserved.ledger.id
    budgetWindowId = reserved.ledger.budgetWindowId
    assert.equal(reserved.ledger.pricingSnapshot.billingUnit, 'request')
    assert.equal(reserved.ledger.pricingSnapshot.unitPriceMicros, '150000')
    assert.equal(reserved.ledger.pricingSnapshot.sourceRef, `price-music-${suffix}`)

    const settled = await repositories.creativeProviderCosts.settle(reservationPayload.sourceKey, {
      actualMicros: '150000',
      actualCurrency: 'USD',
      providerJobId: `trace-music-${suffix}`,
      usage: { unit: 'request', quantity: 1 },
      risk: { reconciliationRequired: false, reasonCodes: [] },
      reasonCode: 'router_music_request_price_settled',
      settledAt: '2026-07-22T01:01:00.000Z',
    }, null)
    assert.equal(settled.status, 'settled')
    assert.equal(settled.actualMicros, '150000')

    const duplicate = await repositories.creativeProviderCosts.settle(reservationPayload.sourceKey, {
      actualMicros: '150000', actualCurrency: 'USD', providerJobId: `trace-music-${suffix}`,
    }, null)
    assert.equal(duplicate.id, settled.id)
    assert.equal(duplicate.actualMicros, '150000')
    const budgetWindow = await client.creativeProviderBudgetWindow.findUnique({ where: { id: budgetWindowId } })
    assert.equal(String(budgetWindow.reservedMicros), '0')
    assert.equal(String(budgetWindow.spentMicros), '150000')
  } finally {
    await client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      if (costLedgerId) await transaction.creativeProviderCostLedger.deleteMany({ where: { id: costLedgerId } })
      if (budgetWindowId) await transaction.creativeProviderBudgetWindow.deleteMany({ where: { id: budgetWindowId } })
      await transaction.creativeGeneration.deleteMany({ where: { id: generationId } })
      await transaction.auditEvent.deleteMany({ where: { resourceId: { in: [costLedgerId].filter(Boolean) } } })
    })
    await client.$disconnect()
  }
})
