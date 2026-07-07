import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildOperationsHandoff,
  buildOperationsMetricSamples,
  buildOperationsMetrics,
} from './metrics.js'

test('buildOperationsMetrics summarizes operation lease contention and renew failures', () => {
  const generatedAt = new Date('2026-07-06T12:00:00.000Z')
  const auditEvents = [
    {
      id: 'audit-1',
      action: 'operations.lease.skipped',
      resourceType: 'operation_lease',
      resourceId: 'media-scan-sweep',
      metadata: { heldBy: 'worker-a' },
      createdAt: '2026-07-06T11:59:00.000Z',
    },
    {
      id: 'audit-2',
      action: 'operations.lease.renew_failed',
      resourceType: 'operation_lease',
      resourceId: 'task-stale-submission-sweep',
      metadata: {},
      createdAt: '2026-07-06T11:58:00.000Z',
    },
  ]

  const metrics = buildOperationsMetrics({
    windowMinutes: 15,
    generatedAt,
    auditEvents,
  })

  assert.equal(metrics.operations.leases.skippedRuns.total, 1)
  assert.deepEqual(metrics.operations.leases.skippedRuns.byKey, [{ key: 'media-scan-sweep', count: 1 }])
  assert.equal(metrics.operations.leases.renewFailures.total, 1)
  assert.deepEqual(metrics.operations.leases.renewFailures.byKey, [{ key: 'task-stale-submission-sweep', count: 1 }])
})

test('buildOperationsMetrics summarizes creative provider budget audit events', () => {
  const generatedAt = new Date('2026-07-07T12:00:00.000Z')
  const auditEvents = [
    {
      id: 'audit-provider-threshold-80',
      action: 'creative.provider_budget.threshold_crossed',
      resourceType: 'creative_provider_budget',
      resourceId: 'staging:replicate:image',
      metadata: {
        providerId: 'replicate',
        workspace: 'image',
        budgetScope: 'staging:replicate:image',
        severity: 'warning',
        crossedThresholdPercent: 80,
        currency: 'USD',
        estimateAmount: 0.75,
        actualAmount: 1.25,
        projectedSpendAmount: 4.25,
      },
      createdAt: '2026-07-07T11:55:00.000Z',
    },
    {
      id: 'audit-provider-threshold-100',
      action: 'creative.provider_budget.threshold_crossed',
      resourceType: 'creative_provider_budget',
      resourceId: 'staging:replicate:image',
      metadata: {
        providerId: 'replicate',
        workspace: 'image',
        budgetScope: 'staging:replicate:image',
        severity: 'critical',
        crossedThresholdPercent: 100,
        currency: 'USD',
        estimateAmount: 0.5,
        actualAmount: 1,
        projectedSpendAmount: 5,
      },
      createdAt: '2026-07-07T11:56:00.000Z',
    },
    {
      id: 'audit-provider-dispatch-blocked',
      action: 'creative.provider_budget.dispatch_blocked',
      resourceType: 'creative_provider_budget',
      resourceId: 'staging:replicate:image',
      metadata: {
        providerId: 'replicate',
        workspace: 'image',
        budgetScope: 'staging:replicate:image',
        severity: 'critical',
        reasonCode: 'over_budget',
        currency: 'USD',
        estimateAmount: 0.5,
        projectedSpendAmount: 5.25,
      },
      createdAt: '2026-07-07T11:57:00.000Z',
    },
    {
      id: 'audit-provider-currency-mismatch',
      action: 'creative.provider_cost.anomaly_detected',
      resourceType: 'creative_provider_budget',
      resourceId: 'staging:replicate:image',
      metadata: {
        providerId: 'replicate',
        workspace: 'image',
        budgetScope: 'staging:replicate:image',
        severity: 'critical',
        reasonCode: 'currency_mismatch',
        currency: 'EUR',
        actualAmount: 1.5,
      },
      createdAt: '2026-07-07T11:58:00.000Z',
    },
    {
      id: 'audit-provider-alert-dispatch-webhook',
      action: 'creative.provider_alert.dispatch',
      resourceType: 'creative_provider_budget_alert',
      resourceId: 'creative-provider-alert:webhook:creative-provider-budget:audit',
      metadata: {
        sourceKey: 'creative-provider-alert:webhook:creative-provider-budget:audit',
        auditEventSourceKey: 'creative-provider-budget:audit',
        channel: 'webhook',
        status: 'succeeded',
        statusCode: 202,
        providerId: 'replicate',
        workspace: 'image',
        severity: 'warning',
        reasonCode: 'budget_threshold_crossed',
        budgetScope: 'staging:replicate:image',
        webhookUrl: 'https://ops.example.com/provider-alerts',
        recipientEmail: 'creative-ops@example.com',
        providerJobId: 'pred_should_not_be_metric_label',
      },
      createdAt: '2026-07-07T11:58:30.000Z',
    },
    {
      id: 'audit-provider-alert-dispatch-slack',
      action: 'creative.provider_alert.dispatch',
      resourceType: 'creative_provider_budget_alert',
      resourceId: 'creative-provider-alert:slack:creative-provider-budget:audit',
      metadata: {
        sourceKey: 'creative-provider-alert:slack:creative-provider-budget:audit',
        auditEventSourceKey: 'creative-provider-budget:audit',
        channel: 'slack',
        status: 'failed',
        statusCode: 503,
        providerId: 'replicate',
        workspace: 'image',
        severity: 'warning',
        reasonCode: 'missing_provider_alert_client',
        errorPreview: 'missing mocked client',
        budgetScope: 'staging:replicate:image',
      },
      createdAt: '2026-07-07T11:59:00.000Z',
    },
    {
      id: 'audit-provider-alert-dispatch-fixture-dry-run',
      action: 'creative.provider_alert.dispatch',
      resourceType: 'creative_provider_budget_alert',
      resourceId: 'creative-provider-alert:email:creative-provider-budget:audit',
      metadata: {
        sourceKey: 'creative-provider-alert:email:creative-provider-budget:audit',
        auditEventSourceKey: 'creative-provider-budget:audit',
        channel: 'email',
        status: 'failed',
        statusCode: 503,
        providerId: 'openai-image',
        workspace: 'image',
        severity: 'warning',
        reasonCode: 'fixture_client_failed',
        errorPreview: 'fixture failed with <redacted>',
        budgetScope: 'staging:openai-image:image',
        dispatchMode: 'fixture_dry_run',
        fixtureDryRun: true,
        webhookUrl: 'https://ops.example.com/provider-alerts',
        recipientEmail: 'creative-ops@example.com',
        providerJobId: 'pred_fixture_should_not_be_metric_label',
      },
      createdAt: '2026-07-07T11:59:30.000Z',
    },
    {
      id: 'audit-provider-old',
      action: 'creative.provider_budget.dispatch_blocked',
      resourceType: 'creative_provider_budget',
      resourceId: 'old-scope',
      metadata: {
        providerId: 'replicate',
        workspace: 'image',
        budgetScope: 'old-scope',
        severity: 'critical',
        reasonCode: 'over_budget',
      },
      createdAt: '2026-07-07T10:00:00.000Z',
    },
  ]

  const metrics = buildOperationsMetrics({
    windowMinutes: 15,
    generatedAt,
    auditEvents,
  })

  assert.equal(metrics.creativeProviderBudget.thresholdAlerts.total, 2)
  assert.deepEqual(metrics.creativeProviderBudget.thresholdAlerts.bySeverity, [
    { key: 'critical', count: 1 },
    { key: 'warning', count: 1 },
  ])
  assert.deepEqual(metrics.creativeProviderBudget.thresholdAlerts.byThreshold, [
    { key: '100', count: 1 },
    { key: '80', count: 1 },
  ])
  assert.equal(metrics.creativeProviderBudget.dispatchBlocked.total, 1)
  assert.deepEqual(metrics.creativeProviderBudget.dispatchBlocked.byReason, [{ key: 'over_budget', count: 1 }])
  assert.equal(metrics.creativeProviderBudget.costAnomalies.total, 1)
  assert.deepEqual(metrics.creativeProviderBudget.costAnomalies.byReason, [{ key: 'currency_mismatch', count: 1 }])
  assert.equal(metrics.creativeProviderBudget.providerAlertDispatches.total, 3)
  assert.equal(metrics.creativeProviderBudget.providerAlertDispatches.succeeded, 1)
  assert.equal(metrics.creativeProviderBudget.providerAlertDispatches.failed, 2)
  assert.equal(metrics.creativeProviderBudget.providerAlertDispatches.failureSpike.active, false)
  assert.equal(metrics.creativeProviderBudget.providerAlertDispatches.failureSpike.threshold, 2)
  assert.equal(metrics.creativeProviderBudget.providerAlertDispatches.failureSpike.failures, 1)
  assert.deepEqual(metrics.creativeProviderBudget.providerAlertDispatches.byChannel, [
    { key: 'email', count: 1 },
    { key: 'slack', count: 1 },
    { key: 'webhook', count: 1 },
  ])
  assert.deepEqual(metrics.creativeProviderBudget.providerAlertDispatches.byStatus, [
    { key: 'failed', count: 2 },
    { key: 'succeeded', count: 1 },
  ])
  assert.deepEqual(metrics.creativeProviderBudget.providerAlertDispatches.byReason, [
    { key: 'budget_threshold_crossed', count: 1 },
    { key: 'fixture_client_failed', count: 1 },
    { key: 'missing_provider_alert_client', count: 1 },
  ])
  assert.equal(metrics.creativeProviderBudget.providerAlertDispatches.fixtureDryRuns.total, 1)
  assert.equal(metrics.creativeProviderBudget.providerAlertDispatches.fixtureDryRuns.failed, 1)
  assert.deepEqual(metrics.creativeProviderBudget.providerAlertDispatches.fixtureDryRuns.byChannel, [
    { key: 'email', count: 1 },
  ])
  assert.deepEqual(metrics.creativeProviderBudget.providerAlertDispatches.fixtureDryRuns.byReason, [
    { key: 'fixture_client_failed', count: 1 },
  ])
  assert.deepEqual(metrics.creativeProviderBudget.providerAlertDispatches.fixtureDryRuns.byProvider, [
    { key: 'openai-image', count: 1 },
  ])
  assert.equal(metrics.creativeProviderBudget.providerAlertDispatches.fixtureDryRuns.latestAt, '2026-07-07T11:59:30.000Z')
  assert.equal(JSON.stringify(metrics.creativeProviderBudget.providerAlertDispatches).includes('ops.example.com'), false)
  assert.equal(JSON.stringify(metrics.creativeProviderBudget.providerAlertDispatches).includes('creative-ops@example.com'), false)
  assert.equal(JSON.stringify(metrics.creativeProviderBudget.providerAlertDispatches).includes('pred_should_not_be_metric_label'), false)
  assert.equal(JSON.stringify(metrics.creativeProviderBudget.providerAlertDispatches.fixtureDryRuns).includes('pred_fixture_should_not_be_metric_label'), false)
  assert.equal(metrics.creativeProviderBudget.spend.estimatedAmount, 1.75)
  assert.equal(metrics.creativeProviderBudget.spend.actualAmount, 3.75)
  assert.equal(metrics.creativeProviderBudget.spend.projectedSpendAmount, 14.5)
  assert.deepEqual(metrics.creativeProviderBudget.spend.byCurrency, [
    { key: 'USD', count: 3 },
    { key: 'EUR', count: 1 },
  ])

  const handoff = buildOperationsHandoff(metrics)
  assert.ok(handoff.remediationHints.some((hint) => hint.id === 'provider-budget-critical-dispatch-blocks'))
  assert.equal(handoff.remediationHints.some((hint) => hint.id === 'provider-alert-dispatch-failures'), false)
  assert.ok(handoff.remediationHints.some((hint) => hint.id === 'provider-budget-threshold-100'))
  assert.ok(handoff.remediationHints.some((hint) => hint.id === 'provider-cost-currency-mismatch'))
})

test('buildOperationsMetrics activates provider alert dispatch failure spike at threshold', () => {
  const generatedAt = new Date('2026-07-07T12:00:00.000Z')
  const auditEvents = [
    {
      id: 'audit-provider-alert-dispatch-slack',
      action: 'creative.provider_alert.dispatch',
      resourceType: 'creative_provider_budget_alert',
      resourceId: 'creative-provider-alert:slack:creative-provider-budget:audit',
      metadata: {
        sourceKey: 'creative-provider-alert:slack:creative-provider-budget:audit',
        channel: 'slack',
        status: 'failed',
        statusCode: 503,
        providerId: 'replicate',
        workspace: 'image',
        reasonCode: 'missing_provider_alert_client',
        errorPreview: 'missing mocked client',
        webhookUrl: 'https://ops.example.com/provider-alerts',
        recipientEmail: 'creative-ops@example.com',
        providerJobId: 'pred_should_not_be_metric_label',
      },
      createdAt: '2026-07-07T11:58:00.000Z',
    },
    {
      id: 'audit-provider-alert-dispatch-email',
      action: 'creative.provider_alert.dispatch',
      resourceType: 'creative_provider_budget_alert',
      resourceId: 'creative-provider-alert:email:creative-provider-budget:audit',
      metadata: {
        sourceKey: 'creative-provider-alert:email:creative-provider-budget:audit',
        channel: 'email',
        status: 'failed',
        statusCode: 502,
        providerId: 'replicate',
        workspace: 'image',
        reasonCode: 'relay_failed',
        errorPreview: 'relay failed',
      },
      createdAt: '2026-07-07T11:59:00.000Z',
    },
    {
      id: 'audit-provider-alert-dispatch-old',
      action: 'creative.provider_alert.dispatch',
      resourceType: 'creative_provider_budget_alert',
      resourceId: 'creative-provider-alert:webhook:old',
      metadata: {
        channel: 'webhook',
        status: 'failed',
        reasonCode: 'relay_failed',
      },
      createdAt: '2026-07-07T10:00:00.000Z',
    },
  ]

  const metrics = buildOperationsMetrics({
    windowMinutes: 15,
    generatedAt,
    auditEvents,
    providerAlertDispatchFailureThreshold: 2,
  })

  assert.equal(metrics.creativeProviderBudget.providerAlertDispatches.failed, 2)
  assert.equal(metrics.creativeProviderBudget.providerAlertDispatches.failureSpike.active, true)
  assert.equal(metrics.creativeProviderBudget.providerAlertDispatches.failureSpike.threshold, 2)
  assert.equal(metrics.creativeProviderBudget.providerAlertDispatches.failureSpike.failures, 2)
  assert.deepEqual(metrics.creativeProviderBudget.providerAlertDispatches.failureSpike.byChannel, [
    { key: 'email', count: 1 },
    { key: 'slack', count: 1 },
  ])
  assert.deepEqual(metrics.creativeProviderBudget.providerAlertDispatches.failureSpike.byReason, [
    { key: 'missing_provider_alert_client', count: 1 },
    { key: 'relay_failed', count: 1 },
  ])
  assert.equal(metrics.creativeProviderBudget.providerAlertDispatches.failureSpike.latestAt, '2026-07-07T11:59:00.000Z')
  assert.equal(JSON.stringify(metrics.creativeProviderBudget.providerAlertDispatches.failureSpike).includes('ops.example.com'), false)
  assert.equal(JSON.stringify(metrics.creativeProviderBudget.providerAlertDispatches.failureSpike).includes('creative-ops@example.com'), false)
  assert.equal(JSON.stringify(metrics.creativeProviderBudget.providerAlertDispatches.failureSpike).includes('pred_should_not_be_metric_label'), false)

  const handoff = buildOperationsHandoff(metrics)
  const hint = handoff.remediationHints.find((item) => item.id === 'provider-alert-dispatch-failures')
  assert.ok(hint)
  assert.match(hint.reason, /configured threshold of 2/)
  assert.deepEqual(hint.auditFilter, {
    action: 'creative.provider_alert.dispatch',
    resourceType: 'creative_provider_budget_alert',
  })
})

test('buildOperationsMetricSamples includes creative provider budget sample buckets', () => {
  const samples = buildOperationsMetricSamples({
    creativeProviderBudgetDispatchBlocks: [{
      id: 'audit-provider-dispatch-blocked',
      action: 'creative.provider_budget.dispatch_blocked',
      resourceType: 'creative_provider_budget',
      resourceId: 'staging:replicate:image',
      metadata: {
        sourceKey: 'creative-provider-budget:sample:audit',
        providerId: 'replicate',
        budgetScope: 'staging:replicate:image',
      },
      createdAt: '2026-07-07T11:57:00.000Z',
    }],
    creativeProviderAlertDispatches: [{
      id: 'audit-provider-alert-dispatch',
      action: 'creative.provider_alert.dispatch',
      resourceType: 'creative_provider_budget_alert',
      resourceId: 'creative-provider-alert:webhook:sample',
      metadata: {
        sourceKey: 'creative-provider-alert:webhook:sample',
        channel: 'webhook',
        status: 'failed',
        reasonCode: 'missing_provider_alert_client',
        providerId: 'replicate',
        workspace: 'image',
      },
      createdAt: '2026-07-07T11:58:00.000Z',
    }],
  })

  assert.equal(samples.creativeProviderBudgetDispatchBlocks.count, 1)
  assert.equal(samples.creativeProviderBudgetDispatchBlocks.query.action, 'creative.provider_budget.dispatch_blocked')
  assert.equal(samples.creativeProviderBudgetDispatchBlocks.query.resourceType, 'creative_provider_budget')
  assert.equal(JSON.stringify(samples.creativeProviderBudgetDispatchBlocks.events).includes('pred_should_not_be_metric_label'), false)
  assert.equal(JSON.stringify(samples.creativeProviderBudgetDispatchBlocks.events).includes('token='), false)
  assert.equal(samples.creativeProviderAlertDispatches.count, 1)
  assert.equal(samples.creativeProviderAlertDispatches.query.action, 'creative.provider_alert.dispatch')
  assert.equal(samples.creativeProviderAlertDispatches.query.resourceType, 'creative_provider_budget_alert')
})
