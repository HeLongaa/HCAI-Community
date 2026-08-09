import assert from 'node:assert/strict'
import test from 'node:test'

import { buildProviderCostReservation } from '../creative/providerCostContract.js'

const databaseUrl = process.env.VIDEO_DATABASE_URL ?? (
  String(process.env.VIDEO_DATABASE_INTEGRATION_ENABLED ?? '').trim().toLowerCase() === 'true'
    ? process.env.DATABASE_URL
    : null
)

test('Prisma preserves a pollable HCAI Router Seedance operation resource without accepting arbitrary Provider URLs', {
  skip: !databaseUrl,
}, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repositories = await createPrismaRepository()
  assert.ok(repositories)
  const client = repositories.client
  const suffix = Date.now()
  const generationId = `video-operation-integration-${suffix}`
  const operationName = `task_router_video_${suffix}`
  let costLedgerId = null
  let budgetWindowId = null
  try {
    await client.creativeGeneration.create({
      data: {
        id: generationId,
        workspace: 'video',
        mode: 'text_to_video',
        providerId: 'hcai-router-seedance-2-fast',
        providerMode: 'router_video',
        status: 'queued',
        promptHash: 'a'.repeat(64),
        inputAssetIds: [],
        parameterKeys: ['durationSeconds'],
        outputAssetIds: [],
        providerRequestId: operationName,
        providerJobId: operationName,
      },
    })
    const recorded = await repositories.creativeProviderOperations.record({
      id: `provider-operation-${generationId}`,
      generationId,
      providerId: 'hcai-router-seedance-2-fast',
      providerMode: 'router_video',
      providerJobId: operationName,
      status: 'queued',
      pollAttempts: 0,
      nextPollAt: new Date().toISOString(),
      timeoutAt: new Date(Date.now() + 900_000).toISOString(),
      sideEffectsComplete: false,
      safeMetadata: { schemaVersion: 'video-provider-operation-v1', modelId: 'seedance-2.0-fast', workspace: 'video', mode: 'text_to_video' },
    }, null)
    assert.equal(recorded.operation.providerJobId, operationName)
    const updated = await repositories.creativeProviderOperations.update(generationId, {
      status: 'running',
      pollAttempts: 1,
      providerJobId: operationName,
    }, null, { expectedVersion: recorded.operation.version })
    assert.equal(updated.status, 'running')
    assert.equal(updated.providerJobId, operationName)

    const reservationPayload = buildProviderCostReservation({
      generationId,
      providerCost: {
        providerId: 'hcai-router-seedance-2-fast',
        providerAccountRef: `video-integration-${suffix}`,
        model: {
          providerModelId: 'seedance-2.0-fast',
          pricingSource: 'model_control_pricing_version',
          pricingSourceRef: `price-video-${suffix}`,
          pricingEffectiveAt: '2026-07-01T00:00:00.000Z',
          pricingSnapshotAt: '2026-07-21T00:00:00.000Z',
        },
        estimate: { currency: 'USD', amount: 0.484, billingUnit: 'generated_seconds', quantity: 4, unitPrice: 0.121 },
        budget: { budgetScope: `staging:router-video:${suffix}`, dailyCapCurrency: 'USD', dailyCapAmount: 20, spentAmount: 0 },
      },
      workspace: 'video',
      mode: 'text_to_video',
      now: new Date('2026-07-21T00:00:00.000Z'),
    })
    const reserved = await repositories.creativeProviderCosts.reserve(reservationPayload, null)
    costLedgerId = reserved.ledger.id
    budgetWindowId = reserved.ledger.budgetWindowId
    assert.equal(reserved.ledger.pricingSnapshot.sourceRef, `price-video-${suffix}`)
    const awaitingReconciliation = await repositories.creativeProviderCosts.reconcile(reservationPayload.sourceKey, {
      reasonCode: 'actual_cost_missing',
      reconciliationAt: '2026-07-21T00:02:09.000Z',
    }, null)
    assert.equal(awaitingReconciliation.status, 'reconciliation_required')
    const settled = await repositories.creativeProviderCosts.settle(reservationPayload.sourceKey, {
      actualMicros: '484000',
      actualCurrency: 'USD',
      providerJobId: operationName,
      usage: { unit: 'generated_seconds', quantity: 4 },
      risk: { reconciliationRequired: false, reasonCodes: [] },
      reasonCode: 'pricing_snapshot_settled',
      settledAt: '2026-07-21T00:02:09.000Z',
    }, null)
    assert.equal(settled.status, 'settled')
    assert.equal(settled.actualMicros, '484000')
    const duplicateSettlement = await repositories.creativeProviderCosts.settle(reservationPayload.sourceKey, {
      actualMicros: '484000', actualCurrency: 'USD', providerJobId: operationName,
    }, null)
    assert.equal(duplicateSettlement.actualMicros, '484000')
    const budgetWindow = await client.creativeProviderBudgetWindow.findUnique({ where: { id: budgetWindowId } })
    assert.equal(String(budgetWindow.reservedMicros), '0')
    assert.equal(String(budgetWindow.spentMicros), '484000')

    const unsafeGenerationId = `${generationId}-unsafe`
    await client.creativeGeneration.create({
      data: {
        id: unsafeGenerationId,
        workspace: 'video',
        mode: 'text_to_video',
        providerId: 'hcai-router-seedance-2-fast',
        status: 'queued',
        promptHash: 'b'.repeat(64),
        inputAssetIds: [],
        parameterKeys: [],
        outputAssetIds: [],
      },
    })
    const unsafe = await repositories.creativeProviderOperations.record({
      id: `provider-operation-${unsafeGenerationId}`,
      generationId: unsafeGenerationId,
      providerId: 'hcai-router-seedance-2-fast',
      providerMode: 'router_video',
      providerJobId: 'https://provider.example/operation?token=secret',
      status: 'queued',
      timeoutAt: new Date(Date.now() + 900_000).toISOString(),
    }, null)
    assert.match(unsafe.operation.providerJobId, /^redacted_[a-f0-9]{16}$/)
  } finally {
    await client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await transaction.creativeProviderOperation.deleteMany({ where: { generationId: { startsWith: generationId } } })
      if (costLedgerId) await transaction.creativeProviderCostLedger.deleteMany({ where: { id: costLedgerId } })
      if (budgetWindowId) await transaction.creativeProviderBudgetWindow.deleteMany({ where: { id: budgetWindowId } })
      await transaction.creativeGeneration.deleteMany({ where: { id: { startsWith: generationId } } })
      await transaction.auditEvent.deleteMany({ where: { resourceId: { in: [`provider-operation-${generationId}`, `provider-operation-${generationId}-unsafe`, costLedgerId].filter(Boolean) } } })
    })
    await client.$disconnect()
  }
})
