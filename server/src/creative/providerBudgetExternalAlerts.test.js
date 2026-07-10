import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeedRepository } from '../repositories/seedRepository.js'
import {
  buildProviderBudgetExternalAlertPayload,
  buildProviderBudgetExternalAlertClientAdapters,
  buildProviderBudgetExternalAlertDeliveryWiring,
  buildProviderBudgetExternalAlertDispatchPlan,
  buildProviderBudgetExternalAlertPayloads,
  buildProviderBudgetExternalAlertDispatchAuditRecords,
  dispatchProviderBudgetExternalAlerts,
  persistProviderBudgetExternalAlertDispatchAuditEvents,
  runProviderBudgetExternalAlertFixtureDryRun,
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

test('buildProviderBudgetExternalAlertPayload folds unsafe summary metadata from non-standard audit events', () => {
  const payload = buildProviderBudgetExternalAlertPayload({
    id: 'audit-provider-budget-alert-unsafe-summary',
    action: 'creative.provider_budget.threshold_crossed',
    resourceType: 'creative_provider_budget',
    resourceId: 'https://ops.example.com/budget/resource?token=resource-secret',
    createdAt: '2026-07-07T02:05:00.000Z',
    metadata: {
      sourceKey: 'creative-provider-budget:unsafe-summary:audit',
      alertType: 'creative.provider_budget.threshold_80?token=alert-secret',
      providerId: 'replicate?token=provider-secret',
      budgetScope: 'https://ops.example.com/budget/summary?token=budget-secret',
      workspace: 'image?token=workspace-secret',
      severity: 'critical?token=severity-secret',
      reasonCode: 'over_budget?token=reason-secret',
      crossedThresholdPercent: 80,
      usageRatioPercent: 101,
      estimateAmount: 0.25,
      actualAmount: 1.5,
      spentAmount: 3.25,
      dailyCapAmount: 5,
      projectedSpendAmount: 5.25,
      currency: 'USD',
    },
  })

  assert.equal(payload.alertAction, 'creative.provider_budget.threshold_crossed')
  assert.match(payload.summary, /^redacted_[a-f0-9]{16} projected spend crossed 80% of the daily cap\.$/)
  assert.match(payload.budgetScope, /^redacted_[a-f0-9]{16}$/)
  assert.match(payload.providerId, /^redacted_[a-f0-9]{16}$/)
  assert.match(payload.workspace, /^redacted_[a-f0-9]{16}$/)
  assert.match(payload.severity, /^redacted_[a-f0-9]{16}$/)
  assert.match(payload.reasonCode, /^redacted_[a-f0-9]{16}$/)
  assert.match(payload.target.admin.resourceId, /^redacted_[a-f0-9]{16}$/)

  const serialized = JSON.stringify(payload)
  assert.equal(serialized.includes('resource-secret'), false)
  assert.equal(serialized.includes('alert-secret'), false)
  assert.equal(serialized.includes('provider-secret'), false)
  assert.equal(serialized.includes('budget-secret'), false)
  assert.equal(serialized.includes('workspace-secret'), false)
  assert.equal(serialized.includes('severity-secret'), false)
  assert.equal(serialized.includes('reason-secret'), false)
  assert.equal(serialized.includes('ops.example.com'), false)
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
    id: 'audit-unsafe-source-key',
    action: 'creative.provider_budget.dispatch_blocked',
    resourceType: 'creative_provider_budget',
    metadata: {
      sourceKey: 'https://replicate.example/predictions/pred_alert?token=provider-secret',
      providerId: 'replicate',
      budgetScope: 'staging:replicate:image:external-alert',
      providerJobId: 'pred_alert_unsafe_source_key',
    },
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

test('buildProviderBudgetExternalAlertClientAdapters creates disabled approved channel shells', async () => {
  const clients = buildProviderBudgetExternalAlertClientAdapters()

  assert.deepEqual(Object.keys(clients), ['webhook', 'slack', 'email'])
  assert.equal(clients.webhook.enabled, false)
  assert.equal(clients.slack.channel, 'slack')
  assert.equal(clients.email.reasonCode, 'provider_alert_client_disabled')
  await assert.rejects(
    () => clients.webhook.send({ url: 'https://ops.example.com/provider-alerts', token: 'secret' }),
    {
      code: 'PROVIDER_ALERT_CLIENT_DISABLED',
      reasonCode: 'provider_alert_client_disabled',
      statusCode: 503,
    },
  )

  const serialized = JSON.stringify(clients)
  assert.equal(serialized.includes('ops.example.com'), false)
  assert.equal(serialized.includes('secret'), false)
})

test('buildProviderBudgetExternalAlertClientAdapters preserves explicit injected clients only', async () => {
  const sent = []
  const clients = buildProviderBudgetExternalAlertClientAdapters({
    channels: ['webhook', 'slack', 'sms', 'email', 'webhook'],
    clients: {
      webhook: {
        enabled: true,
        send: async (envelope) => {
          sent.push(envelope)
          return { statusCode: 202, reasonCode: 'accepted' }
        },
      },
    },
  })

  assert.deepEqual(Object.keys(clients), ['webhook', 'slack', 'email'])
  assert.equal(clients.webhook.enabled, true)
  assert.equal(clients.slack.enabled, false)
  assert.equal(clients.email.enabled, false)

  const result = await clients.webhook.send({ channel: 'webhook', idempotencyKey: 'safe-key' })
  assert.equal(result.statusCode, 202)
  assert.deepEqual(sent, [{ channel: 'webhook', idempotencyKey: 'safe-key' }])
})

test('buildProviderBudgetExternalAlertDeliveryWiring keeps configured channels disabled without approval', async () => {
  const wiring = buildProviderBudgetExternalAlertDeliveryWiring({
    config: {
      creativeProviderAlertsEnabled: true,
      creativeProviderAlertChannels: ['webhook', 'slack', 'email'],
      hasCreativeProviderAlertWebhookUrl: true,
      hasCreativeProviderAlertWebhookSecret: true,
      creativeProviderAlertWebhookTimeoutSeconds: 6,
      hasCreativeProviderAlertSlackWebhookUrl: true,
      creativeProviderAlertSlackTimeoutSeconds: 7,
      hasCreativeProviderAlertEmailWebhookUrl: true,
      hasCreativeProviderAlertEmailWebhookSecret: true,
      creativeProviderAlertEmailRecipientCount: 2,
      creativeProviderAlertEmailTimeoutSeconds: 8,
      rawWebhookUrl: 'https://ops.example.com/provider-alerts',
      recipientEmail: 'creative-ops@example.com',
      secret: 'provider-secret',
    },
  })

  assert.equal(wiring.enabled, true)
  assert.equal(wiring.mode, 'disabled')
  assert.equal(wiring.reasonCode, 'provider_alert_delivery_approval_required')
  assert.deepEqual(wiring.channels, ['webhook', 'slack', 'email'])
  assert.deepEqual(Object.keys(wiring.clients), ['webhook', 'slack', 'email'])
  assert.equal(wiring.clients.webhook.enabled, false)
  assert.equal(wiring.safeSummary.deliveryApproved, false)
  assert.equal(wiring.safeSummary.configuredChannelCount, 3)
  assert.equal(wiring.safeSummary.realDeliveryAvailable, false)
  assert.deepEqual(wiring.safeSummary.missingConfig, [])

  const serialized = JSON.stringify(wiring)
  assert.equal(serialized.includes('ops.example.com'), false)
  assert.equal(serialized.includes('creative-ops@example.com'), false)
  assert.equal(serialized.includes('provider-secret'), false)
})

test('buildProviderBudgetExternalAlertDeliveryWiring reports missing channel config safely', () => {
  const wiring = buildProviderBudgetExternalAlertDeliveryWiring({
    config: {
      creativeProviderAlertsEnabled: true,
      creativeProviderAlertChannels: ['webhook', 'email'],
      hasCreativeProviderAlertWebhookUrl: true,
      hasCreativeProviderAlertEmailWebhookUrl: true,
      creativeProviderAlertEmailRecipientCount: 0,
    },
    approval: {
      deliveryApproved: true,
      fixtureOnly: true,
    },
  })

  assert.equal(wiring.mode, 'disabled')
  assert.equal(wiring.reasonCode, 'provider_alert_channel_config_missing')
  assert.deepEqual(wiring.safeSummary.missingConfig, ['email'])
  assert.deepEqual(
    wiring.safeSummary.channelReadiness.map((item) => ({
      channel: item.channel,
      configured: item.configured,
      reasonCode: item.reasonCode,
    })),
    [
      { channel: 'webhook', configured: true, reasonCode: undefined },
      { channel: 'email', configured: false, reasonCode: 'provider_alert_channel_config_missing' },
    ],
  )
})

test('buildProviderBudgetExternalAlertDeliveryWiring only uses injected fixture clients when approved', async () => {
  const payload = buildProviderBudgetExternalAlertPayload({
    id: 'audit-provider-budget-alert-fixture-wiring',
    action: 'creative.provider_budget.threshold_crossed',
    resourceType: 'creative_provider_budget',
    resourceId: 'staging:replicate:image:fixture-wiring',
    createdAt: '2026-07-08T03:00:00.000Z',
    metadata: {
      sourceKey: 'creative-provider-budget:fixture-wiring-safe:audit',
      alertType: 'creative.provider_budget.threshold_80',
      providerId: 'replicate',
      budgetScope: 'staging:replicate:image:fixture-wiring',
      workspace: 'image',
      severity: 'warning',
      reasonCode: 'budget_threshold_crossed',
      webhookUrl: 'https://ops.example.com/provider-alerts',
      slackWebhookUrl: 'https://hooks.slack.com/services/T000/B000/SECRET',
      recipientEmail: 'creative-ops@example.com',
    },
  })
  const sent = []
  const originalFetch = globalThis.fetch
  let fetchCalls = 0
  globalThis.fetch = async () => {
    fetchCalls += 1
    throw new Error('fetch should not be used by fixture-only provider alert wiring')
  }

  try {
    const wiring = buildProviderBudgetExternalAlertDeliveryWiring({
      config: {
        creativeProviderAlertsEnabled: true,
        creativeProviderAlertChannels: ['webhook', 'slack', 'email'],
        hasCreativeProviderAlertWebhookUrl: true,
        hasCreativeProviderAlertSlackWebhookUrl: true,
        hasCreativeProviderAlertEmailWebhookUrl: true,
        creativeProviderAlertEmailRecipientCount: 1,
      },
      approval: {
        deliveryApproved: true,
        fixtureOnly: true,
      },
      fixtureClients: {
        webhook: {
          enabled: true,
          send: async (envelope) => {
            sent.push(envelope)
            return { statusCode: 202, reasonCode: 'fixture_accepted' }
          },
        },
      },
    })

    assert.equal(wiring.mode, 'fixture')
    assert.equal(wiring.reasonCode, 'provider_alert_fixture_delivery_ready')
    assert.equal(wiring.safeSummary.realDeliveryAvailable, false)

    const dispatch = await dispatchProviderBudgetExternalAlerts({
      payloads: [payload],
      channels: wiring.channels,
      clients: wiring.clients,
    })

    assert.equal(fetchCalls, 0)
    assert.equal(sent.length, 1)
    assert.equal(dispatch.safeSummary.total, 3)
    assert.equal(dispatch.safeSummary.succeeded, 1)
    assert.equal(dispatch.safeSummary.failed, 2)
    assert.equal(dispatch.results.find((item) => item.channel === 'webhook').reasonCode, 'fixture_accepted')
    assert.equal(dispatch.results.find((item) => item.channel === 'slack').reasonCode, 'provider_alert_client_disabled')
    assert.equal(dispatch.results.find((item) => item.channel === 'email').reasonCode, 'provider_alert_client_disabled')

    const serialized = JSON.stringify({ wiring, sent, dispatch })
    assert.equal(serialized.includes('ops.example.com'), false)
    assert.equal(serialized.includes('hooks.slack.com'), false)
    assert.equal(serialized.includes('creative-ops@example.com'), false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('runProviderBudgetExternalAlertFixtureDryRun short-circuits safely without fixture approval', async () => {
  const repository = createSeedRepository()
  const plan = buildProviderBudgetEventPlan({
    providerCost,
    workspace: 'image',
    mode: 'text_to_image',
    block: { reasonCode: 'over_budget', statusCode: 429 },
    now: new Date('2026-07-08T04:00:00.000Z'),
  })
  const persisted = await persistProviderBudgetAuditEvents({
    plan,
    repositories: repository,
    actor,
  })
  const writes = []
  const result = await runProviderBudgetExternalAlertFixtureDryRun({
    auditEvents: persisted.records.map((record) => record.event),
    config: {
      creativeProviderAlertsEnabled: true,
      creativeProviderAlertChannels: ['webhook'],
      hasCreativeProviderAlertWebhookUrl: true,
      rawWebhookUrl: 'https://ops.example.com/provider-alerts',
      secret: 'provider-secret',
    },
    repositories: {
      providerBudgetAudit: {
        recordMany: async (records) => {
          writes.push(...records)
          return []
        },
      },
    },
    actor,
  })

  assert.equal(result.completed, false)
  assert.equal(result.reasonCode, 'provider_alert_delivery_approval_required')
  assert.equal(result.dispatch, null)
  assert.equal(result.persistence, null)
  assert.equal(result.safeSummary.payloadCount, 5)
  assert.equal(result.safeSummary.operationCount, 5)
  assert.equal(result.safeSummary.dispatchTotal, 0)
  assert.equal(writes.length, 0)

  const serialized = JSON.stringify(result)
  assert.equal(serialized.includes('ops.example.com'), false)
  assert.equal(serialized.includes('provider-secret'), false)
  assert.equal(serialized.includes('pred_external_alert_should_not_leak'), false)
})

test('runProviderBudgetExternalAlertFixtureDryRun dispatches fixture clients and persists safe audit records', async () => {
  const repository = createSeedRepository()
  const plan = buildProviderBudgetEventPlan({
    providerCost,
    workspace: 'image',
    mode: 'text_to_image',
    block: { reasonCode: 'over_budget', statusCode: 429 },
    now: new Date('2026-07-08T05:00:00.000Z'),
  })
  const persisted = await persistProviderBudgetAuditEvents({
    plan,
    repositories: repository,
    actor,
  })
  const sent = []
  const originalFetch = globalThis.fetch
  let fetchCalls = 0
  globalThis.fetch = async () => {
    fetchCalls += 1
    throw new Error('fetch should not be used by provider alert dry-run harness')
  }

  try {
    const first = await runProviderBudgetExternalAlertFixtureDryRun({
      auditEvents: persisted.records.map((record) => record.event),
      config: {
        creativeProviderAlertsEnabled: true,
        creativeProviderAlertChannels: ['webhook', 'slack', 'email'],
        hasCreativeProviderAlertWebhookUrl: true,
        hasCreativeProviderAlertWebhookSecret: true,
        hasCreativeProviderAlertSlackWebhookUrl: true,
        hasCreativeProviderAlertEmailWebhookUrl: true,
        hasCreativeProviderAlertEmailWebhookSecret: true,
        creativeProviderAlertEmailRecipientCount: 1,
        rawWebhookUrl: 'https://ops.example.com/provider-alerts',
        recipientEmail: 'creative-ops@example.com',
      },
      approval: {
        deliveryApproved: true,
        fixtureOnly: true,
      },
      fixtureClients: {
        webhook: {
          enabled: true,
          send: async (envelope) => {
            sent.push(envelope)
            return { statusCode: 202, reasonCode: 'fixture_accepted' }
          },
        },
      },
      repositories: repository,
      actor,
      now: new Date('2026-07-08T05:01:00.000Z'),
    })
    const second = await runProviderBudgetExternalAlertFixtureDryRun({
      auditEvents: persisted.records.map((record) => record.event),
      config: {
        creativeProviderAlertsEnabled: true,
        creativeProviderAlertChannels: ['webhook', 'slack', 'email'],
        hasCreativeProviderAlertWebhookUrl: true,
        hasCreativeProviderAlertSlackWebhookUrl: true,
        hasCreativeProviderAlertEmailWebhookUrl: true,
        creativeProviderAlertEmailRecipientCount: 1,
      },
      approval: {
        deliveryApproved: true,
        fixtureOnly: true,
      },
      fixtureClients: {
        webhook: {
          enabled: true,
          send: async () => ({ statusCode: 202, reasonCode: 'fixture_accepted' }),
        },
      },
      repositories: repository,
      actor,
      now: new Date('2026-07-08T05:01:00.000Z'),
    })

    assert.equal(fetchCalls, 0)
    assert.equal(first.completed, true)
    assert.equal(first.reasonCode, 'provider_alert_fixture_delivery_ready')
    assert.equal(first.safeSummary.payloadCount, 5)
    assert.equal(first.safeSummary.channelCount, 3)
    assert.equal(first.safeSummary.operationCount, 15)
    assert.equal(first.safeSummary.dispatchTotal, 15)
    assert.equal(first.safeSummary.dispatchSucceeded, 5)
    assert.equal(first.safeSummary.dispatchFailed, 10)
    assert.deepEqual(first.safeSummary.dispatchReasons, [
      { key: 'fixture_accepted', count: 5 },
      { key: 'provider_alert_client_disabled', count: 10 },
    ])
    assert.equal(first.safeSummary.auditCreatedCount, 15)
    assert.equal(first.safeSummary.auditDuplicateCount, 0)
    assert.equal(second.safeSummary.auditCreatedCount, 0)
    assert.equal(second.safeSummary.auditDuplicateCount, 15)
    assert.equal(sent.length, 5)
    assert.equal(sent.every((envelope) => envelope.channel === 'webhook'), true)

    const audit = repository.audit.list({
      action: 'creative.provider_alert.dispatch',
      resourceType: 'creative_provider_budget_alert',
    })
    const persistedIds = new Set(first.persistence.records.map((record) => record.event.id))
    const dryRunAudit = audit.items.filter((event) => persistedIds.has(event.id))
    assert.equal(dryRunAudit.length, 15)
    assert.equal(dryRunAudit.filter((event) => event.metadata.channel === 'webhook').length, 5)
    assert.equal(dryRunAudit.filter((event) => event.metadata.reasonCode === 'provider_alert_client_disabled').length, 10)
    assert.equal(dryRunAudit.every((event) => event.metadata.dispatchMode === 'fixture_dry_run'), true)
    assert.equal(dryRunAudit.every((event) => event.metadata.fixtureDryRun === true), true)
    assert.equal(dryRunAudit.every((event) => event.metadata.persistedFrom === 'provider_budget_external_alert_dispatch'), true)

    const serialized = JSON.stringify({ first, second, sent, audit: dryRunAudit })
    assert.equal(serialized.includes('pred_external_alert_should_not_leak'), false)
    assert.equal(serialized.includes('ops.example.com'), false)
    assert.equal(serialized.includes('hooks.slack.com'), false)
    assert.equal(serialized.includes('creative-ops@example.com'), false)
    assert.equal(serialized.includes('provider-secret'), false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('provider budget read-side chain keeps failed provider closeout evidence sanitized', async () => {
  const repository = createSeedRepository()
  const unsafeProviderCost = {
    ...providerCost,
    providerAccountRef: 'staging-secret-account-ref',
    model: {
      ...providerCost.model,
      providerModelId: 'replicate:image:staging-private-model-token',
    },
    job: {
      providerJobId: 'pred_failed_closeout_should_not_leak',
      rawProviderPayload: {
        token: 'provider-secret-token',
        output: 'https://replicate.delivery/private-output.png?token=provider-secret-token',
      },
      rawProviderResponse: 'provider error body api_key=provider-secret-token',
    },
    usage: {
      unit: 'prediction_seconds',
      quantity: 12.5,
      rawUsagePayload: 'usage bearer provider-secret-token',
    },
    estimate: {
      currency: 'USD',
      amount: 0.25,
      confidence: 'estimated',
      rawPrompt: 'raw prompt should never leave provider cost internals',
    },
    actual: {
      currency: 'USD',
      amount: 2.25,
      confidence: 'provider_reported',
      rawErrorBody: 'replicate failure token=provider-secret-token',
    },
    budget: {
      ...providerCost.budget,
      budgetScope: 'staging:replicate:image:failed-closeout-readside',
      spentAmount: 4.75,
      projectedSpendAmount: 7,
      remainingAfterEstimateAmount: -2,
      status: 'over_budget',
      unsafeBudgetDebug: 'https://ops.example.com/private-budget?token=provider-secret-token',
    },
    risk: {
      costKnown: true,
      costExceededEstimate: true,
      providerUsageMissing: true,
    },
  }

  const plan = buildProviderBudgetEventPlan({
    providerCost: unsafeProviderCost,
    workspace: 'image',
    mode: 'text_to_image',
    block: { reasonCode: 'over_budget', statusCode: 429 },
    now: new Date('2026-07-08T06:00:00.000Z'),
  })
  const persisted = await persistProviderBudgetAuditEvents({
    plan,
    repositories: repository,
    actor,
  })
  const auditEvents = persisted.records.map((record) => record.event)
  const notifications = repository.providerBudgetNotifications.createFromAuditEvents(auditEvents, actor)
  const sent = []
  const dryRun = await runProviderBudgetExternalAlertFixtureDryRun({
    auditEvents,
    config: {
      creativeProviderAlertsEnabled: true,
      creativeProviderAlertChannels: ['webhook', 'slack'],
      hasCreativeProviderAlertWebhookUrl: true,
      hasCreativeProviderAlertWebhookSecret: true,
      hasCreativeProviderAlertSlackWebhookUrl: true,
      rawWebhookUrl: 'https://ops.example.com/provider-alerts?token=provider-secret-token',
      slackWebhookUrl: 'https://hooks.slack.com/services/T000/B000/SECRET',
    },
    approval: {
      deliveryApproved: true,
      fixtureOnly: true,
    },
    fixtureClients: {
      webhook: {
        enabled: true,
        send: async (envelope) => {
          sent.push(envelope)
          return { statusCode: 202, reasonCode: 'fixture_accepted' }
        },
      },
    },
    repositories: repository,
    actor,
    now: new Date('2026-07-08T06:01:00.000Z'),
  })
  const dispatchAudit = repository.audit.list({
    action: 'creative.provider_alert.dispatch',
    resourceType: 'creative_provider_budget_alert',
  })
  const dryRunAuditIds = new Set(dryRun.persistence.records.map((record) => record.event.id))
  const dryRunAudit = dispatchAudit.items.filter((event) => dryRunAuditIds.has(event.id))

  assert.equal(persisted.completed, true)
  assert.equal(auditEvents.length, 7)
  assert.equal(notifications.length, 14)
  assert.equal(dryRun.completed, true)
  assert.equal(dryRun.safeSummary.payloadCount, 7)
  assert.equal(dryRun.safeSummary.operationCount, 14)
  assert.equal(dryRun.safeSummary.dispatchSucceeded, 7)
  assert.equal(dryRun.safeSummary.dispatchFailed, 7)
  assert.equal(sent.length, 7)
  assert.equal(dryRunAudit.length, 14)
  assert.ok(auditEvents.some((event) => event.metadata.reasonCode === 'over_budget'))
  assert.ok(auditEvents.some((event) => event.metadata.reasonCode === 'missing_usage'))
  assert.ok(auditEvents.some((event) => event.metadata.reasonCode === 'estimate_exceeded_critical'))
  assert.equal(auditEvents.every((event) => event.metadata.providerId === 'replicate'), true)
  assert.equal(auditEvents.every((event) => event.metadata.budgetScope === 'staging:replicate:image:failed-closeout-readside'), true)
  assert.equal(sent.every((envelope) => envelope.target.admin.tab === 'Audit log'), true)
  assert.equal(dryRunAudit.every((event) => event.metadata.dispatchMode === 'fixture_dry_run'), true)

  const serialized = JSON.stringify({
    plan,
    persisted,
    notifications,
    dryRun,
    sent,
    dryRunAudit,
  })
  assert.equal(serialized.includes('pred_failed_closeout_should_not_leak'), false)
  assert.equal(serialized.includes('provider-secret-token'), false)
  assert.equal(serialized.includes('private-output.png'), false)
  assert.equal(serialized.includes('raw prompt should never leave'), false)
  assert.equal(serialized.includes('provider error body'), false)
  assert.equal(serialized.includes('replicate failure token'), false)
  assert.equal(serialized.includes('ops.example.com'), false)
  assert.equal(serialized.includes('hooks.slack.com'), false)
})

test('dispatchProviderBudgetExternalAlerts fails closed through disabled channel shells without default network', async () => {
  const payload = buildProviderBudgetExternalAlertPayload({
    id: 'audit-provider-budget-alert-shell',
    action: 'creative.provider_budget.dispatch_blocked',
    resourceType: 'creative_provider_budget',
    resourceId: 'staging:replicate:image:external-alert-shell',
    createdAt: '2026-07-07T04:30:00.000Z',
    metadata: {
      sourceKey: 'creative-provider-budget:disabled-shell-safe:audit',
      providerId: 'replicate',
      budgetScope: 'staging:replicate:image:external-alert-shell',
      workspace: 'image',
      severity: 'critical',
      reasonCode: 'over_budget',
      webhookUrl: 'https://ops.example.com/provider-alerts',
      slackWebhookUrl: 'https://hooks.slack.com/services/T000/B000/SECRET',
      recipientEmail: 'creative-ops@example.com',
    },
  })
  const originalFetch = globalThis.fetch
  let fetchCalls = 0
  globalThis.fetch = async () => {
    fetchCalls += 1
    throw new Error('fetch should not be used by provider alert client shells')
  }

  try {
    const dispatch = await dispatchProviderBudgetExternalAlerts({
      payloads: [payload],
      channels: ['webhook', 'slack', 'email'],
      clients: buildProviderBudgetExternalAlertClientAdapters(),
    })

    assert.equal(fetchCalls, 0)
    assert.equal(dispatch.safeSummary.total, 3)
    assert.equal(dispatch.safeSummary.succeeded, 0)
    assert.equal(dispatch.safeSummary.failed, 3)
    assert.deepEqual(dispatch.results.map((result) => result.reasonCode), [
      'provider_alert_client_disabled',
      'provider_alert_client_disabled',
      'provider_alert_client_disabled',
    ])
    assert.deepEqual(dispatch.results.map((result) => result.statusCode), [503, 503, 503])
    assert.equal(dispatch.results.every((result) => result.errorPreview.includes('disabled')), true)

    const serialized = JSON.stringify(dispatch)
    assert.equal(serialized.includes('ops.example.com'), false)
    assert.equal(serialized.includes('hooks.slack.com'), false)
    assert.equal(serialized.includes('creative-ops@example.com'), false)
  } finally {
    globalThis.fetch = originalFetch
  }
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

test('persistProviderBudgetExternalAlertDispatchAuditEvents records per-channel dispatch audit events and dedupes', async () => {
  const repository = createSeedRepository()
  const payload = buildProviderBudgetExternalAlertPayload({
    id: 'audit-provider-budget-alert-5',
    action: 'creative.provider_budget.threshold_crossed',
    resourceType: 'creative_provider_budget',
    resourceId: 'staging:replicate:image:external-alert-persist',
    createdAt: '2026-07-07T06:00:00.000Z',
    metadata: {
      sourceKey: 'creative-provider-budget:audit-persist-safe:audit',
      alertType: 'creative.provider_budget.threshold_80',
      providerId: 'replicate',
      budgetScope: 'staging:replicate:image:external-alert-persist',
      workspace: 'image',
      severity: 'warning',
      reasonCode: 'budget_threshold_crossed',
      crossedThresholdPercent: 80,
      providerJobId: 'pred_audit_persist_should_not_copy',
      rawPrompt: 'raw prompt should not copy',
      rawProviderPayload: 'token=provider-secret',
      outputUrl: 'https://cdn.example.com/private-output.png',
      slackWebhookUrl: 'https://hooks.slack.com/services/T000/B000/SECRET',
      recipientEmail: 'creative-ops@example.com',
    },
  })
  const dispatch = await dispatchProviderBudgetExternalAlerts({
    payloads: [payload],
    channels: ['webhook', 'slack'],
    clients: {
      webhook: {
        send: async () => ({ statusCode: 202 }),
      },
    },
  })

  const first = await persistProviderBudgetExternalAlertDispatchAuditEvents({
    dispatch,
    repositories: repository,
    actor,
    now: new Date('2026-07-07T06:01:00.000Z'),
  })
  const second = await persistProviderBudgetExternalAlertDispatchAuditEvents({
    dispatch,
    repositories: repository,
    actor,
    now: new Date('2026-07-07T06:01:00.000Z'),
  })

  assert.equal(first.completed, true)
  assert.equal(first.total, 2)
  assert.equal(first.createdCount, 2)
  assert.equal(first.duplicateCount, 0)
  assert.equal(second.completed, true)
  assert.equal(second.createdCount, 0)
  assert.equal(second.duplicateCount, 2)
  assert.deepEqual(
    second.records.map((record) => record.event.id),
    first.records.map((record) => record.event.id),
  )

  const audit = repository.audit.list({
    action: 'creative.provider_alert.dispatch',
    resourceType: 'creative_provider_budget_alert',
  })
  const currentAudit = audit.items.filter((event) => (
    event.metadata.auditEventSourceKey === 'creative-provider-budget:audit-persist-safe:audit'
  ))
  assert.equal(currentAudit.length, 2)
  const webhookAudit = currentAudit.find((event) => event.metadata.channel === 'webhook')
  const slackAudit = currentAudit.find((event) => event.metadata.channel === 'slack')
  assert.ok(webhookAudit)
  assert.ok(slackAudit)
  assert.equal(webhookAudit.metadata.status, 'succeeded')
  assert.equal(slackAudit.metadata.status, 'failed')
  assert.equal(webhookAudit.metadata.statusCode, 202)
  assert.equal(webhookAudit.metadata.persistedFrom, 'provider_budget_external_alert_dispatch')
  assert.equal(webhookAudit.metadata.attemptedAt, '2026-07-07T06:01:00.000Z')
  assert.equal(slackAudit.metadata.reasonCode, 'missing_provider_alert_client')

  const serialized = JSON.stringify(currentAudit)
  assert.equal(serialized.includes('pred_audit_persist_should_not_copy'), false)
  assert.equal(serialized.includes('raw prompt should not copy'), false)
  assert.equal(serialized.includes('token=provider-secret'), false)
  assert.equal(serialized.includes('private-output.png'), false)
  assert.equal(serialized.includes('hooks.slack.com'), false)
  assert.equal(serialized.includes('creative-ops@example.com'), false)
})

test('persistProviderBudgetExternalAlertDispatchAuditEvents rejects unsafe candidates before writing', async () => {
  const writes = []
  const result = await persistProviderBudgetExternalAlertDispatchAuditEvents({
    records: [{
      action: 'creative.provider_alert.dispatch',
      resourceType: 'creative_provider_budget_alert',
      resourceId: 'creative-provider-alert:webhook:bad',
      metadata: {
        sourceKey: 'creative-provider-alert:email:bad',
        channel: 'sms',
        status: 'succeeded',
      },
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
  assert.equal(result.failed.reasonCode, 'invalid_provider_alert_dispatch_audit_event')
  assert.match(result.failed.errorPreview, /unsupported channel/)
  assert.equal(writes.length, 0)
})

test('persistProviderBudgetExternalAlertDispatchAuditEvents returns explicit failure for repository errors', async () => {
  const result = await persistProviderBudgetExternalAlertDispatchAuditEvents({
    results: [{
      channel: 'webhook',
      key: 'creative-provider-alert:webhook:repo-error',
      status: 'failed',
      reasonCode: 'relay_failed',
      metadata: {
        sourceKey: 'creative-provider-budget:repo-error:audit',
        budgetScope: 'staging:replicate:image:external-alert-error',
      },
    }],
    repositories: {
      providerBudgetAudit: {
        recordMany: async () => {
          throw new Error('audit dispatch store unavailable')
        },
      },
    },
    now: new Date('2026-07-07T06:02:00.000Z'),
  })

  assert.equal(result.completed, false)
  assert.equal(result.total, 1)
  assert.equal(result.failed.reasonCode, 'provider_alert_dispatch_audit_persistence_failed')
  assert.match(result.failed.errorPreview, /audit dispatch store unavailable/)
})
