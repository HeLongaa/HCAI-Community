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
  assert.equal(metrics.creativeProviderBudget.spend.estimatedAmount, 1.75)
  assert.equal(metrics.creativeProviderBudget.spend.actualAmount, 3.75)
  assert.equal(metrics.creativeProviderBudget.spend.projectedSpendAmount, 14.5)
  assert.deepEqual(metrics.creativeProviderBudget.spend.byCurrency, [
    { key: 'USD', count: 3 },
    { key: 'EUR', count: 1 },
  ])

  const handoff = buildOperationsHandoff(metrics)
  assert.ok(handoff.remediationHints.some((hint) => hint.id === 'provider-budget-critical-dispatch-blocks'))
  assert.ok(handoff.remediationHints.some((hint) => hint.id === 'provider-budget-threshold-100'))
  assert.ok(handoff.remediationHints.some((hint) => hint.id === 'provider-cost-currency-mismatch'))
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
  })

  assert.equal(samples.creativeProviderBudgetDispatchBlocks.count, 1)
  assert.equal(samples.creativeProviderBudgetDispatchBlocks.query.action, 'creative.provider_budget.dispatch_blocked')
  assert.equal(samples.creativeProviderBudgetDispatchBlocks.query.resourceType, 'creative_provider_budget')
  assert.equal(JSON.stringify(samples.creativeProviderBudgetDispatchBlocks.events).includes('pred_should_not_be_metric_label'), false)
  assert.equal(JSON.stringify(samples.creativeProviderBudgetDispatchBlocks.events).includes('token='), false)
})
