import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeedRepository } from '../repositories/seedRepository.js'
import { buildProviderBudgetNotificationPayload } from '../repositories/providerBudgetNotificationWiring.js'
import { buildProviderBudgetEventPlan } from './providerBudgetEvents.js'
import { persistProviderBudgetAuditEvents } from './providerBudgetAuditPersistence.js'

const actor = { id: 'demo-user-admin', handle: 'opsplus' }

const providerCost = {
  providerId: 'replicate',
  providerAccountRef: 'staging',
  model: {
    providerModelId: 'replicate:image:staging',
    family: 'image',
  },
  job: {
    providerJobId: 'pred_notification_should_not_leak',
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
    budgetScope: 'staging:replicate:image:notification-routing',
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

test('buildProviderBudgetNotificationPayload derives safe notification payloads from audit events', () => {
  const auditEvent = {
    id: 'audit-provider-budget-1',
    action: 'creative.provider_budget.threshold_crossed',
    resourceType: 'creative_provider_budget',
    resourceId: 'staging:replicate:image:notification-routing',
    metadata: {
      sourceKey: 'creative-provider-budget:threshold-safe:audit',
      alertType: 'creative.provider_budget.threshold_80',
      providerId: 'replicate',
      budgetScope: 'staging:replicate:image:notification-routing',
      workspace: 'image',
      mode: 'text_to_image',
      severity: 'warning',
      crossedThresholdPercent: 80,
      usageRatioPercent: 85,
      providerJobId: 'pred_should_not_copy',
      rawProviderPayload: 'token=secret',
    },
  }

  const payload = buildProviderBudgetNotificationPayload(auditEvent)

  assert.equal(payload.type, 'creative.provider_budget.threshold_80')
  assert.equal(payload.resourceType, 'creative_provider_budget')
  assert.equal(payload.resourceId, 'staging:replicate:image:notification-routing')
  assert.equal(payload.metadata.sourceKey, 'creative-provider-budget:threshold-safe:audit')
  assert.equal(payload.metadata.auditEventId, 'audit-provider-budget-1')
  assert.equal(payload.metadata.providerId, 'replicate')
  assert.equal(payload.metadata.target.admin.tab, 'Audit log')
  assert.equal(JSON.stringify(payload).includes('pred_should_not_copy'), false)
  assert.equal(JSON.stringify(payload).includes('token=secret'), false)
})

test('buildProviderBudgetNotificationPayload folds unsafe summary metadata from non-standard audit events', () => {
  const payload = buildProviderBudgetNotificationPayload({
    id: 'audit-provider-budget-unsafe-summary',
    action: 'creative.provider_budget.threshold_crossed',
    resourceType: 'creative_provider_budget',
    resourceId: 'https://ops.example.com/budget/resource?token=resource-secret',
    metadata: {
      sourceKey: 'creative-provider-budget:unsafe-summary:audit',
      alertType: 'creative.provider_budget.threshold_80?token=alert-secret',
      providerId: 'replicate?token=provider-secret',
      budgetScope: 'https://ops.example.com/budget/summary?token=budget-secret',
      workspace: 'image?token=workspace-secret',
      mode: 'text_to_image?token=mode-secret',
      severity: 'critical?token=severity-secret',
      reasonCode: 'over_budget?token=reason-secret',
      crossedThresholdPercent: 80,
      usageRatioPercent: 101,
    },
  })

  assert.equal(payload.type, 'creative.provider_budget.threshold_crossed')
  assert.match(payload.resourceId, /^redacted_[a-f0-9]{16}$/)
  assert.match(payload.body, /^redacted_[a-f0-9]{16} projected spend crossed 80% of the daily cap\.$/)
  assert.match(payload.metadata.providerId, /^redacted_[a-f0-9]{16}$/)
  assert.match(payload.metadata.budgetScope, /^redacted_[a-f0-9]{16}$/)
  assert.match(payload.metadata.workspace, /^redacted_[a-f0-9]{16}$/)
  assert.match(payload.metadata.mode, /^redacted_[a-f0-9]{16}$/)
  assert.match(payload.metadata.severity, /^redacted_[a-f0-9]{16}$/)
  assert.match(payload.metadata.reasonCode, /^redacted_[a-f0-9]{16}$/)
  assert.match(payload.metadata.alertType, /^redacted_[a-f0-9]{16}$/)
  assert.equal(payload.metadata.target.admin.resourceId, payload.resourceId)

  const serialized = JSON.stringify(payload)
  assert.equal(serialized.includes('resource-secret'), false)
  assert.equal(serialized.includes('alert-secret'), false)
  assert.equal(serialized.includes('provider-secret'), false)
  assert.equal(serialized.includes('budget-secret'), false)
  assert.equal(serialized.includes('workspace-secret'), false)
  assert.equal(serialized.includes('mode-secret'), false)
  assert.equal(serialized.includes('severity-secret'), false)
  assert.equal(serialized.includes('reason-secret'), false)
  assert.equal(serialized.includes('ops.example.com'), false)
})

test('providerBudgetNotifications creates audit-reader notifications and dedupes by recipient source key', async () => {
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

  const first = repository.providerBudgetNotifications.createFromAuditEvents(auditEvents, actor)
  const second = repository.providerBudgetNotifications.createFromAuditEvents(auditEvents, actor)

  assert.equal(auditEvents.length, 5)
  assert.equal(first.length, 10)
  assert.equal(second.length, 0)

  const finopsInbox = repository.notifications.list({ handle: 'finops' }, {
    readState: 'all',
    resourceType: 'creative_provider_budget',
    limit: 20,
  })
  const moderatorInbox = repository.notifications.list({ handle: 'legalpixel' }, {
    readState: 'all',
    resourceType: 'creative_provider_budget',
    limit: 20,
  })
  const actorInbox = repository.notifications.list(actor, {
    readState: 'all',
    resourceType: 'creative_provider_budget',
    limit: 20,
  })
  const memberInbox = repository.notifications.list({ handle: 'taskops' }, {
    readState: 'all',
    resourceType: 'creative_provider_budget',
    limit: 20,
  })

  assert.equal(finopsInbox.items.length, 5)
  assert.equal(moderatorInbox.items.length, 5)
  assert.equal(actorInbox.items.length, 0)
  assert.equal(memberInbox.items.length, 0)
  assert.ok(finopsInbox.items.some((notification) => notification.type === 'creative.provider_budget.dispatch_blocked'))
  assert.ok(finopsInbox.items.some((notification) => notification.type === 'creative.provider_cost.anomaly_detected'))
  assert.ok(finopsInbox.items.some((notification) => notification.metadata.reasonCode === 'missing_usage'))
  assert.equal(finopsInbox.items.every((notification) => notification.metadata.auditEventId), true)
  assert.equal(finopsInbox.items.every((notification) => notification.metadata.sourceKey.endsWith(':audit')), true)
  assert.equal(JSON.stringify(finopsInbox.items).includes('pred_notification_should_not_leak'), false)
  assert.equal(JSON.stringify(finopsInbox.items).includes('token'), false)
})

test('buildProviderBudgetNotificationPayload ignores unsupported audit events', () => {
  const payload = buildProviderBudgetNotificationPayload({
    id: 'audit-unsupported',
    action: 'creative.provider_budget.external_alert_sent',
    metadata: {
      sourceKey: 'creative-provider-budget:unsupported:audit',
    },
  })

  assert.equal(payload, null)

  const unsafeSourceKeyPayload = buildProviderBudgetNotificationPayload({
    id: 'audit-unsafe-source-key',
    action: 'creative.provider_budget.dispatch_blocked',
    metadata: {
      sourceKey: 'https://replicate.example/predictions/pred_notification?token=provider-secret',
      providerId: 'replicate',
      budgetScope: 'staging:replicate:image:notification-routing',
      providerJobId: 'pred_notification_unsafe_source_key',
    },
  })

  assert.equal(unsafeSourceKeyPayload, null)
})
