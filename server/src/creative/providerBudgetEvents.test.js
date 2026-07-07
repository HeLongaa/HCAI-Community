import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildProviderBudgetDispatchBlockedEvent,
  buildProviderBudgetEventPlan,
  buildProviderBudgetThresholdEvents,
  buildProviderCostAnomalyEvents,
} from './providerBudgetEvents.js'

const providerCost = {
  schemaVersion: 'provider-cost-v1',
  providerId: 'replicate',
  providerAccountRef: 'staging',
  model: {
    providerModelId: 'replicate:image:staging',
    family: 'image',
  },
  job: {
    providerJobId: 'pred_safe_1',
  },
  usage: {
    unit: 'prediction_seconds',
    quantity: 2.5,
  },
  estimate: {
    currency: 'USD',
    amount: 1,
    confidence: 'estimated',
  },
  actual: {
    currency: 'USD',
    amount: 2.25,
    confidence: 'provider_reported',
  },
  budget: {
    budgetScope: 'staging:replicate:image',
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

test('buildProviderBudgetThresholdEvents emits safe threshold alert and audit plans', () => {
  const events = buildProviderBudgetThresholdEvents({
    providerCost,
    workspace: 'image',
    mode: 'text_to_image',
    now: new Date('2026-07-07T00:00:00.000Z'),
  })

  assert.deepEqual(events.map((event) => event.alert.type), [
    'creative.provider_budget.threshold_50',
    'creative.provider_budget.threshold_80',
  ])
  assert.equal(events[1].alert.severity, 'warning')
  assert.equal(events[1].alert.metadata.usageRatioPercent, 85)
  assert.equal(events[1].auditEvent.action, 'creative.provider_budget.threshold_crossed')
  assert.equal(events[1].auditEvent.metadata.idempotencyKey, 'provider-budget-threshold:staging:replicate:image:2026-07-07:80')
  assert.equal(JSON.stringify(events).includes('pred_safe_1'), false)
})

test('buildProviderBudgetDispatchBlockedEvent records safe block metadata', () => {
  const event = buildProviderBudgetDispatchBlockedEvent({
    providerCost: {
      ...providerCost,
      budget: {
        ...providerCost.budget,
        status: 'over_budget',
        projectedSpendAmount: 5.25,
      },
    },
    workspace: 'image',
    mode: 'text_to_image',
    reasonCode: 'over_budget',
    statusCode: 429,
    now: new Date('2026-07-07T00:01:00.000Z'),
  })

  assert.equal(event.action, 'creative.provider_budget.dispatch_blocked')
  assert.equal(event.metadata.reasonCode, 'over_budget')
  assert.equal(event.metadata.severity, 'critical')
  assert.equal(event.metadata.statusCode, 429)
  assert.equal(event.metadata.budgetScope, 'staging:replicate:image')
  assert.equal(event.metadata.idempotencyKey.startsWith('provider-budget-dispatch-blocked:'), true)
  assert.equal(JSON.stringify(event).includes('token='), false)
})

test('buildProviderCostAnomalyEvents emits safe anomaly events', () => {
  const events = buildProviderCostAnomalyEvents({
    providerCost: {
      ...providerCost,
      estimate: { ...providerCost.estimate, amount: 0.25 },
      actual: { ...providerCost.actual, amount: 1.5 },
      risk: {
        costExceededEstimate: true,
        providerUsageMissing: true,
      },
    },
    workspace: 'image',
    mode: 'text_to_image',
    now: new Date('2026-07-07T00:02:00.000Z'),
  })

  assert.deepEqual(events.map((event) => event.metadata.reasonCode), [
    'missing_usage',
    'estimate_exceeded_critical',
  ])
  assert.equal(events[1].metadata.severity, 'critical')
  assert.equal(events[1].metadata.actualToEstimateRatio, 6)
  assert.equal(events[0].action, 'creative.provider_cost.anomaly_detected')
  assert.equal(JSON.stringify(events).includes('raw'), false)
})

test('buildProviderCostAnomalyEvents detects currency mismatch and zero-cost anomalies', () => {
  const events = buildProviderCostAnomalyEvents({
    providerCost: {
      ...providerCost,
      estimate: { ...providerCost.estimate, currency: 'USD' },
      actual: { ...providerCost.actual, currency: 'EUR', amount: 0 },
      risk: {
        costExceededEstimate: false,
        providerUsageMissing: false,
      },
    },
    now: new Date('2026-07-07T00:03:00.000Z'),
  })

  assert.deepEqual(events.map((event) => event.metadata.reasonCode), [
    'currency_mismatch',
    'zero_cost_anomaly',
  ])
  assert.equal(events[0].metadata.severity, 'critical')
  assert.equal(events[1].metadata.severity, 'warning')
})

test('buildProviderBudgetEventPlan combines alerts and audit events', () => {
  const plan = buildProviderBudgetEventPlan({
    providerCost: {
      ...providerCost,
      risk: {
        costExceededEstimate: true,
        providerUsageMissing: true,
      },
    },
    workspace: 'image',
    mode: 'text_to_image',
    block: { reasonCode: 'missing_budget_cap', statusCode: 503 },
    now: new Date('2026-07-07T00:04:00.000Z'),
  })

  assert.equal(plan.alerts.length, 2)
  assert.deepEqual(plan.auditEvents.map((event) => event.action), [
    'creative.provider_budget.threshold_crossed',
    'creative.provider_budget.threshold_crossed',
    'creative.provider_budget.dispatch_blocked',
    'creative.provider_cost.anomaly_detected',
    'creative.provider_cost.anomaly_detected',
  ])
  assert.equal(plan.auditEvents[2].metadata.reasonCode, 'missing_budget_cap')
  assert.equal(JSON.stringify(plan).includes('https://replicate.example'), false)
})
