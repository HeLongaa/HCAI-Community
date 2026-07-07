import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeedRepository } from '../repositories/seedRepository.js'
import {
  buildProviderBudgetExternalAlertPayload,
  buildProviderBudgetExternalAlertPayloads,
} from './providerBudgetExternalAlerts.js'
import { persistProviderBudgetAuditEvents } from './providerBudgetAuditPersistence.js'
import { buildProviderBudgetEventPlan } from './providerBudgetEvents.js'

const actor = { id: 'demo-user-admin', handle: 'opsplus' }

const providerCost = {
  providerId: 'replicate',
  providerAccountRef: 'staging',
  model: {
    providerModelId: 'replicate:image:staging',
    family: 'image',
  },
  job: {
    providerJobId: 'pred_external_alert_should_not_leak',
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
    budgetScope: 'staging:replicate:image:external-alert',
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
    providerUsageMissing: true,
  },
}

test('buildProviderBudgetExternalAlertPayload derives a channel-neutral safe payload', () => {
  const payload = buildProviderBudgetExternalAlertPayload({
    id: 'audit-provider-budget-alert-1',
    action: 'creative.provider_budget.threshold_crossed',
    resourceType: 'creative_provider_budget',
    resourceId: 'staging:replicate:image:external-alert',
    createdAt: '2026-07-07T02:00:00.000Z',
    metadata: {
      sourceKey: 'creative-provider-budget:threshold-safe:audit',
      alertType: 'creative.provider_budget.threshold_80',
      providerId: 'replicate',
      budgetScope: 'staging:replicate:image:external-alert',
      workspace: 'image',
      severity: 'warning',
      reasonCode: 'budget_threshold_crossed',
      crossedThresholdPercent: 80,
      usageRatioPercent: 85,
      estimateAmount: 0.25,
      actualAmount: 1.5,
      spentAmount: 3.25,
      dailyCapAmount: 5,
      projectedSpendAmount: 4.25,
      currency: 'USD',
      providerJobId: 'pred_should_not_copy',
      generationId: 'gen_should_not_copy',
      rawPrompt: 'raw prompt should not copy',
      rawProviderPayload: 'token=secret',
      outputUrl: 'https://cdn.example.com/private-output.png',
      webhookUrl: 'https://ops.example.com/provider-alerts',
      slackWebhookUrl: 'https://hooks.slack.com/services/T000/B000/SECRET',
      recipientEmail: 'creative-ops@example.com',
    },
  })

  assert.equal(payload.type, 'creative_provider_budget_alert')
  assert.equal(payload.action, 'creative.provider_budget.threshold_crossed')
  assert.equal(payload.alertAction, 'creative.provider_budget.threshold_80')
  assert.equal(payload.severity, 'warning')
  assert.equal(payload.reasonCode, 'budget_threshold_crossed')
  assert.equal(payload.providerId, 'replicate')
  assert.equal(payload.budgetScope, 'staging:replicate:image:external-alert')
  assert.equal(payload.crossedThresholdPercent, 80)
  assert.equal(payload.usageRatioPercent, 85)
  assert.equal(payload.auditEventId, 'audit-provider-budget-alert-1')
  assert.equal(payload.sourceKey, 'creative-provider-budget:threshold-safe:audit')
  assert.equal(payload.idempotencyKey, 'creative-provider-alert:creative-provider-budget:threshold-safe:audit')
  assert.equal(payload.target.admin.tab, 'Audit log')

  const serialized = JSON.stringify(payload)
  assert.equal(serialized.includes('pred_should_not_copy'), false)
  assert.equal(serialized.includes('gen_should_not_copy'), false)
  assert.equal(serialized.includes('raw prompt should not copy'), false)
  assert.equal(serialized.includes('token=secret'), false)
  assert.equal(serialized.includes('private-output.png'), false)
  assert.equal(serialized.includes('hooks.slack.com'), false)
  assert.equal(serialized.includes('creative-ops@example.com'), false)
})

test('buildProviderBudgetExternalAlertPayloads covers persisted threshold block and anomaly events', async () => {
  const repository = createSeedRepository()
  const plan = buildProviderBudgetEventPlan({
    providerCost,
    workspace: 'image',
    mode: 'text_to_image',
    block: { reasonCode: 'over_budget', statusCode: 429 },
    now: new Date('2026-07-07T02:00:00.000Z'),
  })
  const persisted = await persistProviderBudgetAuditEvents({
    plan,
    repositories: repository,
    actor,
  })
  const auditEvents = persisted.records.map((record) => record.event)

  const payloads = buildProviderBudgetExternalAlertPayloads(auditEvents)

  assert.equal(payloads.length, 5)
  assert.ok(payloads.some((payload) => payload.action === 'creative.provider_budget.threshold_crossed'))
  assert.ok(payloads.some((payload) => payload.action === 'creative.provider_budget.dispatch_blocked'))
  assert.ok(payloads.some((payload) => payload.action === 'creative.provider_cost.anomaly_detected'))
  assert.equal(payloads.every((payload) => payload.type === 'creative_provider_budget_alert'), true)
  assert.equal(payloads.every((payload) => payload.sourceKey.endsWith(':audit')), true)
  assert.equal(payloads.every((payload) => payload.idempotencyKey.startsWith('creative-provider-alert:')), true)
  assert.equal(JSON.stringify(payloads).includes('pred_external_alert_should_not_leak'), false)
  assert.equal(JSON.stringify(payloads).includes('token'), false)
})

test('buildProviderBudgetExternalAlertPayload ignores unsupported or unsafe audit events', () => {
  assert.equal(buildProviderBudgetExternalAlertPayload({
    id: 'audit-unsupported',
    action: 'creative.provider_alert.dispatch',
    resourceType: 'creative_provider_budget_alert',
    metadata: {
      sourceKey: 'creative-provider-budget:unsupported:audit',
    },
  }), null)

  assert.equal(buildProviderBudgetExternalAlertPayload({
    id: 'audit-missing-source-key',
    action: 'creative.provider_budget.dispatch_blocked',
    resourceType: 'creative_provider_budget',
    metadata: {},
  }), null)

  assert.equal(buildProviderBudgetExternalAlertPayload({
    id: 'audit-wrong-resource-type',
    action: 'creative.provider_budget.dispatch_blocked',
    resourceType: 'creative_generation',
    metadata: {
      sourceKey: 'creative-provider-budget:wrong-resource:audit',
    },
  }), null)

  assert.deepEqual(buildProviderBudgetExternalAlertPayloads(null), [])
})
