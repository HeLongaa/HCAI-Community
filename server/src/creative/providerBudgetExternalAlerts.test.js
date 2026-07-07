import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeedRepository } from '../repositories/seedRepository.js'
import {
  buildProviderBudgetExternalAlertPayload,
  buildProviderBudgetExternalAlertDispatchPlan,
  buildProviderBudgetExternalAlertPayloads,
  buildProviderBudgetExternalAlertDispatchAuditRecords,
  dispatchProviderBudgetExternalAlerts,
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

test('buildProviderBudgetExternalAlertDispatchPlan creates per-channel safe envelopes', () => {
  const payload = buildProviderBudgetExternalAlertPayload({
    id: 'audit-provider-budget-alert-2',
    action: 'creative.provider_budget.dispatch_blocked',
    resourceType: 'creative_provider_budget',
    resourceId: 'staging:replicate:image:external-alert',
    createdAt: '2026-07-07T03:00:00.000Z',
    metadata: {
      sourceKey: 'creative-provider-budget:blocked-safe:audit',
      providerId: 'replicate',
      budgetScope: 'staging:replicate:image:external-alert',
      workspace: 'image',
      severity: 'critical',
      reasonCode: 'over_budget',
      usageRatioPercent: 101,
      providerJobId: 'pred_dispatch_plan_should_not_copy',
      rawProviderPayload: 'Bearer secret.value',
      webhookUrl: 'https://ops.example.com/provider-alerts',
      recipientEmail: 'creative-ops@example.com',
    },
  })

  const plan = buildProviderBudgetExternalAlertDispatchPlan({
    payloads: [payload],
    channels: ['webhook', 'slack', 'webhook', 'pager'],
  })

  assert.deepEqual(plan.channels, ['webhook', 'slack'])
  assert.equal(plan.operations.length, 2)
  assert.equal(plan.operations[0].key, 'creative-provider-alert:webhook:creative-provider-budget:blocked-safe:audit')
  assert.equal(plan.operations[0].payload.channel, 'webhook')
  assert.equal(plan.operations[0].payload.reasonCode, 'over_budget')
  assert.equal(plan.operations[0].payload.idempotencyKey, plan.operations[0].key)
  assert.equal(plan.operations[0].metadata.sourceKey, 'creative-provider-budget:blocked-safe:audit')

  const serialized = JSON.stringify(plan)
  assert.equal(serialized.includes('pred_dispatch_plan_should_not_copy'), false)
  assert.equal(serialized.includes('Bearer secret.value'), false)
  assert.equal(serialized.includes('ops.example.com'), false)
  assert.equal(serialized.includes('creative-ops@example.com'), false)
})

test('dispatchProviderBudgetExternalAlerts requires injected clients and redacts failures', async () => {
  const payload = buildProviderBudgetExternalAlertPayload({
    id: 'audit-provider-budget-alert-3',
    action: 'creative.provider_cost.anomaly_detected',
    resourceType: 'creative_provider_budget',
    resourceId: 'staging:replicate:image:external-alert',
    createdAt: '2026-07-07T04:00:00.000Z',
    metadata: {
      sourceKey: 'creative-provider-budget:anomaly-safe:audit',
      providerId: 'replicate',
      budgetScope: 'staging:replicate:image:external-alert',
      workspace: 'image',
      severity: 'warning',
      reasonCode: 'missing_usage',
      estimateAmount: 0.25,
      actualAmount: 1.5,
      currency: 'USD',
      providerJobId: 'pred_dispatch_should_not_copy',
      rawPrompt: 'raw prompt should not copy',
      rawProviderPayload: 'api_key=provider-secret',
      outputUrl: 'https://cdn.example.com/private-output.png',
      slackWebhookUrl: 'https://hooks.slack.com/services/T000/B000/SECRET',
    },
  })
  const sent = []

  const result = await dispatchProviderBudgetExternalAlerts({
    payloads: [payload],
    channels: ['webhook', 'slack', 'email'],
    clients: {
      webhook: {
        send: async (envelope) => {
          sent.push(envelope)
          return { statusCode: 202 }
        },
      },
      email: {
        send: async () => {
          throw Object.assign(new Error('relay failed with token=provider-secret'), { statusCode: 503 })
        },
      },
    },
  })

  assert.equal(sent.length, 1)
  assert.equal(sent[0].channel, 'webhook')
  assert.equal(sent[0].sourceKey, 'creative-provider-budget:anomaly-safe:audit')
  assert.equal(result.safeSummary.total, 3)
  assert.equal(result.safeSummary.succeeded, 1)
  assert.equal(result.safeSummary.failed, 2)

  const webhook = result.results.find((item) => item.channel === 'webhook')
  const slack = result.results.find((item) => item.channel === 'slack')
  const email = result.results.find((item) => item.channel === 'email')

  assert.equal(webhook.status, 'succeeded')
  assert.equal(webhook.statusCode, 202)
  assert.equal(slack.status, 'failed')
  assert.equal(slack.reasonCode, 'missing_provider_alert_client')
  assert.equal(email.status, 'failed')
  assert.equal(email.statusCode, 503)
  assert.equal(email.errorPreview.includes('provider-secret'), false)
  assert.equal(email.errorPreview.includes('<redacted>'), true)

  const serialized = JSON.stringify({ sent, result })
  assert.equal(serialized.includes('pred_dispatch_should_not_copy'), false)
  assert.equal(serialized.includes('raw prompt should not copy'), false)
  assert.equal(serialized.includes('api_key=provider-secret'), false)
  assert.equal(serialized.includes('private-output.png'), false)
  assert.equal(serialized.includes('hooks.slack.com'), false)
})

test('buildProviderBudgetExternalAlertDispatchAuditRecords maps dispatch results to safe audit candidates', async () => {
  const payload = buildProviderBudgetExternalAlertPayload({
    id: 'audit-provider-budget-alert-4',
    action: 'creative.provider_budget.dispatch_blocked',
    resourceType: 'creative_provider_budget',
    resourceId: 'staging:replicate:image:external-alert',
    createdAt: '2026-07-07T05:00:00.000Z',
    metadata: {
      sourceKey: 'creative-provider-budget:audit-plan-safe:audit',
      providerId: 'replicate',
      budgetScope: 'staging:replicate:image:external-alert',
      workspace: 'image',
      severity: 'critical',
      reasonCode: 'over_budget',
      providerJobId: 'pred_audit_plan_should_not_copy',
      rawProviderPayload: 'token=provider-secret',
      webhookUrl: 'https://ops.example.com/provider-alerts',
      recipientEmail: 'creative-ops@example.com',
    },
  })
  const dispatch = await dispatchProviderBudgetExternalAlerts({
    payloads: [payload],
    channels: ['webhook', 'slack', 'email'],
    clients: {
      webhook: {
        send: async () => ({ statusCode: 202 }),
      },
      email: {
        send: async () => {
          throw Object.assign(new Error('relay failed with api_key=provider-secret'), { statusCode: 502 })
        },
      },
    },
  })

  const records = buildProviderBudgetExternalAlertDispatchAuditRecords({
    results: dispatch.results,
    now: new Date('2026-07-07T05:01:00.000Z'),
  })

  assert.equal(records.length, 3)
  assert.equal(records.every((record) => record.action === 'creative.provider_alert.dispatch'), true)
  assert.equal(records.every((record) => record.resourceType === 'creative_provider_budget_alert'), true)
  assert.equal(records.every((record) => record.metadata.sourceKey.startsWith('creative-provider-alert:')), true)
  assert.equal(records.every((record) => record.metadata.auditEventSourceKey === 'creative-provider-budget:audit-plan-safe:audit'), true)
  assert.deepEqual(records.map((record) => record.metadata.channel), ['webhook', 'slack', 'email'])
  assert.deepEqual(records.map((record) => record.metadata.status), ['succeeded', 'failed', 'failed'])
  assert.equal(records[0].metadata.statusCode, 202)
  assert.equal(records[1].metadata.reasonCode, 'missing_provider_alert_client')
  assert.equal(records[2].metadata.statusCode, 502)
  assert.equal(records[2].metadata.errorPreview.includes('provider-secret'), false)
  assert.equal(records[2].metadata.errorPreview.includes('<redacted>'), true)
  assert.equal(records[2].metadata.attemptedAt, '2026-07-07T05:01:00.000Z')

  const serialized = JSON.stringify(records)
  assert.equal(serialized.includes('pred_audit_plan_should_not_copy'), false)
  assert.equal(serialized.includes('token=provider-secret'), false)
  assert.equal(serialized.includes('api_key=provider-secret'), false)
  assert.equal(serialized.includes('ops.example.com'), false)
  assert.equal(serialized.includes('creative-ops@example.com'), false)
})
