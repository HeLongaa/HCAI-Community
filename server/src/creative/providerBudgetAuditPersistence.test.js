import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeedRepository } from '../repositories/seedRepository.js'
import { buildProviderBudgetEventPlan } from './providerBudgetEvents.js'
import {
  buildProviderBudgetAuditRecords,
  persistProviderBudgetAuditEvents,
  providerBudgetAuditSourceKey,
} from './providerBudgetAuditPersistence.js'

const actor = { id: 'demo-user-admin', handle: 'opsplus' }

const providerCost = {
  providerId: 'replicate',
  providerAccountRef: 'staging',
  model: {
    providerModelId: 'replicate:image:staging',
    family: 'image',
  },
  job: {
    providerJobId: 'pred_should_not_be_serialized',
  },
  usage: {
    unit: 'prediction_seconds',
    quantity: 2.5,
  },
  estimate: {
    currency: 'USD',
    amount: 0.25,
    confidence: 'estimated',
  },
  actual: {
    currency: 'USD',
    amount: 1.5,
    confidence: 'provider_reported',
  },
  budget: {
    budgetScope: 'staging:replicate:image:audit-persistence',
    dailyCapCurrency: 'USD',
    dailyCapAmount: 5,
    spentAmount: 3.25,
    projectedSpendAmount: 4.25,
    remainingAfterEstimateAmount: 0.75,
    thresholdPercent: 80,
    status: 'threshold_exceeded',
  },
  risk: {
    costKnown: true,
    costExceededEstimate: true,
    providerUsageMissing: false,
  },
}

test('buildProviderBudgetAuditRecords creates stable audit records with source keys', () => {
  const plan = buildProviderBudgetEventPlan({
    providerCost,
    workspace: 'image',
    mode: 'text_to_image',
    now: new Date('2026-07-07T01:00:00.000Z'),
  })

  const records = buildProviderBudgetAuditRecords(plan.auditEvents)

  assert.equal(records.length, 3)
  assert.deepEqual(records.map((record) => record.action), [
    'creative.provider_budget.threshold_crossed',
    'creative.provider_budget.threshold_crossed',
    'creative.provider_cost.anomaly_detected',
  ])
  assert.equal(records[0].resourceType, 'creative_provider_budget')
  assert.equal(records[0].resourceId, 'staging:replicate:image:audit-persistence')
  assert.equal(records[0].metadata.sourceKey, providerBudgetAuditSourceKey(plan.auditEvents[0]))
  assert.equal(records[0].metadata.persistedFrom, 'provider_budget_event_plan')
  assert.equal(JSON.stringify(records).includes('pred_should_not_be_serialized'), false)
})

test('persistProviderBudgetAuditEvents records seed audit events and dedupes by source key', async () => {
  const repository = createSeedRepository()
  const plan = buildProviderBudgetEventPlan({
    providerCost: {
      ...providerCost,
      budget: {
        ...providerCost.budget,
        budgetScope: 'staging:replicate:image:audit-persistence-dedupe',
      },
    },
    workspace: 'image',
    mode: 'text_to_image',
    block: { reasonCode: 'over_budget', statusCode: 429 },
    now: new Date('2026-07-07T01:05:00.000Z'),
  })

  const first = await persistProviderBudgetAuditEvents({
    plan,
    repositories: repository,
    actor,
  })
  const second = await persistProviderBudgetAuditEvents({
    plan,
    repositories: repository,
    actor,
  })

  assert.equal(first.completed, true)
  assert.equal(first.total, 4)
  assert.equal(first.createdCount, 4)
  assert.equal(first.duplicateCount, 0)
  assert.equal(second.completed, true)
  assert.equal(second.createdCount, 0)
  assert.equal(second.duplicateCount, 4)
  assert.deepEqual(
    second.records.map((record) => record.event.id),
    first.records.map((record) => record.event.id),
  )

  const audit = repository.audit.list({
    action: 'creative.provider_budget.dispatch_blocked',
    resourceType: 'creative_provider_budget',
  })
  const blocked = audit.items.find((event) =>
    event.metadata.budgetScope === 'staging:replicate:image:audit-persistence-dedupe')
  assert.ok(blocked)
  assert.equal(blocked.metadata.sourceKey.endsWith(':audit'), true)
  assert.equal(blocked.metadata.reasonCode, 'over_budget')
  assert.equal(JSON.stringify(blocked.metadata).includes('token'), false)
})

test('persistProviderBudgetAuditEvents returns explicit failure for repository errors', async () => {
  const plan = buildProviderBudgetEventPlan({
    providerCost,
    now: new Date('2026-07-07T01:10:00.000Z'),
  })

  const result = await persistProviderBudgetAuditEvents({
    plan,
    repositories: {
      providerBudgetAudit: {
        recordMany: async () => {
          throw new Error('audit store unavailable')
        },
      },
    },
  })

  assert.equal(result.completed, false)
  assert.equal(result.failed.reasonCode, 'budget_audit_persistence_failed')
  assert.match(result.failed.errorPreview, /audit store unavailable/)
})

test('persistProviderBudgetAuditEvents rejects unsupported or non-idempotent audit events before writing', async () => {
  const writes = []
  const result = await persistProviderBudgetAuditEvents({
    auditEvents: [{
      action: 'creative.provider_budget.unknown',
      resourceType: 'creative_provider_budget',
      metadata: { idempotencyKey: 'bad-event' },
    }],
    repositories: {
      providerBudgetAudit: {
        recordMany: async (records) => {
          writes.push(...records)
          return []
        },
      },
    },
  })

  assert.equal(result.completed, false)
  assert.equal(result.failed.reasonCode, 'invalid_budget_audit_event')
  assert.match(result.failed.errorPreview, /unsupported action/)
  assert.equal(writes.length, 0)
})
