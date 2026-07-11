import assert from 'node:assert/strict'
import test from 'node:test'

import { buildPrometheusMetrics, safeMetricLabel } from './metricsExporter.js'

test('safeMetricLabel keeps stable labels and folds unsafe values', () => {
  assert.equal(safeMetricLabel('rate_limit'), 'rate_limit')
  assert.equal(safeMetricLabel('media-scan-sweep'), 'media-scan-sweep')
  assert.equal(safeMetricLabel('user@example.com'), 'other')
  assert.equal(safeMetricLabel('Bearer secret-token'), 'other')
  assert.equal(safeMetricLabel('', ['known']), 'other')
  assert.equal(safeMetricLabel('unknown'), 'unknown')
})

test('buildPrometheusMetrics renders safe Prometheus text without unsafe labels', () => {
  const body = buildPrometheusMetrics({
    window: { minutes: 60 },
    security: {
      eventsTotal: 2,
      eventsByType: [{ key: 'rate_limit.exceeded', count: 1 }],
      eventsBySource: [{ key: 'rate_limit', count: 1 }, { key: 'user@example.com', count: 1 }],
      eventsBySeverity: [{ key: 'warning', count: 2 }],
      rateLimit: {
        exceeded: {
          total: 1,
          byBucket: [{ key: 'auth', count: 1 }],
        },
      },
      alerts: {
        total: 1,
        byType: [{ key: 'security.event.rate_limit.spike', count: 1 }],
        byState: [{ key: 'active', count: 1 }],
      },
      dispositions: {
        acknowledgementLatency: { averageMs: 1200 },
      },
      deliveryFailures: {
        total: 1,
        byChannel: [{ key: 'slack', count: 1 }],
        byStatus: [{ key: 'failed', count: 1 }],
      },
    },
    mediaScan: {
      archiveCandidates: { total: 3, sampled: 1 },
      archiveWrites: { total: 1 },
      historyPruned: { jobs: 2 },
      alertDeliveryFailures: {
        total: 0,
        byChannel: [],
        byStatus: [],
      },
    },
    operations: {
      leases: {
        skippedRuns: {
          total: 1,
          byKey: [{ key: 'task-stale-submission-sweep', count: 1 }],
        },
        renewFailures: {
          total: 1,
          byKey: [{ key: 'not a safe/custom key', count: 1 }],
        },
      },
    },
    creativeProviderBudget: {
      thresholdAlerts: {
        total: 2,
        bySeverity: [{ key: 'critical', count: 1 }, { key: 'warning', count: 1 }],
        byProvider: [{ key: 'replicate', count: 1 }, { key: 'user@example.com', count: 1 }],
        byWorkspace: [{ key: 'image', count: 1 }, { key: 'prompt-hash-123', count: 1 }],
        byThreshold: [{ key: '100', count: 1 }, { key: '80', count: 1 }],
      },
      dispatchBlocked: {
        total: 1,
        bySeverity: [{ key: 'critical', count: 1 }],
        byProvider: [{ key: 'replicate', count: 1 }],
        byWorkspace: [{ key: 'image', count: 1 }],
        byReason: [{ key: 'over_budget', count: 1 }],
      },
      costAnomalies: {
        total: 2,
        bySeverity: [{ key: 'critical', count: 1 }, { key: 'warning', count: 1 }],
        byProvider: [{ key: 'replicate', count: 2 }],
        byWorkspace: [{ key: 'image', count: 2 }],
        byReason: [{ key: 'currency_mismatch', count: 1 }, { key: 'provider_job_mismatch', count: 1 }],
      },
      spend: {
        estimatedAmount: 1.75,
        actualAmount: 3.75,
        projectedSpendAmount: 14.5,
        byCurrency: [{ key: 'USD', count: 3 }, { key: 'EUR', count: 1 }],
      },
      providerAlertDispatches: {
        total: 3,
        succeeded: 1,
        failed: 1,
        skipped: 1,
        byChannel: [{ key: 'webhook', count: 1 }, { key: 'slack', count: 1 }, { key: 'sms', count: 1 }],
        byStatus: [{ key: 'succeeded', count: 1 }, { key: 'failed', count: 1 }, { key: 'skipped', count: 1 }],
        byReason: [{ key: 'missing_provider_alert_client', count: 1 }, { key: 'provider_job_mismatch', count: 1 }],
        byProvider: [{ key: 'replicate', count: 2 }, { key: 'user@example.com', count: 1 }],
        byWorkspace: [{ key: 'image', count: 2 }, { key: 'prompt-hash-123', count: 1 }],
        fixtureDryRuns: {
          total: 2,
          succeeded: 1,
          failed: 1,
          skipped: 0,
          byChannel: [{ key: 'email', count: 1 }, { key: 'sms', count: 1 }],
          byStatus: [{ key: 'failed', count: 1 }, { key: 'succeeded', count: 1 }],
          byReason: [{ key: 'missing_provider_alert_client', count: 1 }, { key: 'provider_job_mismatch', count: 1 }],
          byProvider: [{ key: 'replicate', count: 1 }, { key: 'user@example.com', count: 1 }],
          byWorkspace: [{ key: 'image', count: 1 }, { key: 'prompt-hash-123', count: 1 }],
        },
        failureSpike: {
          active: true,
          threshold: 2,
          failures: 2,
          byChannel: [{ key: 'slack', count: 1 }, { key: 'sms', count: 1 }],
          byReason: [{ key: 'missing_provider_alert_client', count: 1 }, { key: 'provider_job_mismatch', count: 1 }],
        },
      },
      costLedger: {
        total: 4,
        reserved: 1,
        settled: 1,
        released: 1,
        reconciliationRequired: 1,
        byProvider: [{ key: 'replicate', count: 4 }, { key: 'user@example.com', count: 1 }],
        byWorkspace: [{ key: 'image', count: 4 }, { key: 'prompt-hash-123', count: 1 }],
        byCurrency: [{ key: 'USD', count: 4 }],
        byReason: [{ key: 'actual_cost_missing', count: 1 }, { key: 'token=secret-token', count: 1 }],
      },
    },
    creativeProviderControl: {
      total: 6,
      dispatchBlocked: 1,
      circuitOpened: 1,
      recoveryApproved: 1,
      recoveryRejected: 1,
      capEvidenceRecorded: 2,
      capEvidenceExpired: 1,
      byProvider: [{ key: 'replicate', count: 5 }, { key: 'user@example.com', count: 1 }],
      byWorkspace: [{ key: 'image', count: 5 }, { key: 'prompt-hash-123', count: 1 }],
      byStatus: [{ key: 'open', count: 1 }, { key: 'secret-status', count: 1 }],
      byReason: [{ key: 'provider_circuit_open', count: 1 }, { key: 'token=secret-token', count: 1 }],
    },
    creativeProviderRetry: {
      total: 3,
      scheduled: 1,
      exhausted: 1,
      cleared: 1,
      byProvider: [{ key: 'replicate', count: 3 }],
      byWorkspace: [{ key: 'image', count: 3 }],
      byOperation: [{ key: 'status_read', count: 3 }],
      byCategory: [{ key: 'rate_limit', count: 2 }, { key: 'secret-category', count: 1 }],
      byDelaySource: [{ key: 'retry_after', count: 1 }, { key: 'exponential', count: 1 }],
    },
  })

  assert.match(body, /# TYPE newchat_security_events_window_total gauge/)
  assert.match(body, /newchat_security_events_by_type_total\{type="rate_limit.exceeded"\} 1/)
  assert.match(body, /newchat_security_events_by_source_total\{source="rate_limit"\} 1/)
  assert.match(body, /newchat_security_events_by_source_total\{source="other"\} 1/)
  assert.match(body, /newchat_rate_limit_exceeded_by_bucket_total\{bucket="auth"\} 1/)
  assert.match(body, /newchat_operation_lease_skipped_runs_by_key_total\{key="task-stale-submission-sweep"\} 1/)
  assert.match(body, /newchat_operation_lease_renew_failures_by_key_total\{key="other"\} 1/)
  assert.match(body, /newchat_creative_provider_budget_alerts_total 2/)
  assert.match(body, /newchat_creative_provider_budget_alerts_by_severity_total\{severity="critical"\} 1/)
  assert.match(body, /newchat_creative_provider_budget_alerts_by_provider_total\{provider="replicate"\} 1/)
  assert.match(body, /newchat_creative_provider_budget_alerts_by_provider_total\{provider="other"\} 1/)
  assert.match(body, /newchat_creative_provider_budget_alerts_by_workspace_total\{workspace="image"\} 1/)
  assert.match(body, /newchat_creative_provider_budget_alerts_by_workspace_total\{workspace="other"\} 1/)
  assert.match(body, /newchat_creative_provider_budget_alerts_by_threshold_total\{threshold="pct_100"\} 1/)
  assert.match(body, /newchat_creative_provider_budget_dispatch_blocked_by_reason_total\{reason="over_budget"\} 1/)
  assert.match(body, /newchat_creative_provider_cost_anomalies_by_reason_total\{reason="currency_mismatch"\} 1/)
  assert.match(body, /newchat_creative_provider_cost_anomalies_by_reason_total\{reason="other"\} 1/)
  assert.match(body, /newchat_creative_provider_cost_estimated_total\{currency="mixed",confidence="observed"\} 1.75/)
  assert.match(body, /newchat_creative_provider_cost_actual_total\{currency="mixed",confidence="observed"\} 3.75/)
  assert.match(body, /newchat_creative_provider_cost_projected_total\{currency="mixed",confidence="observed"\} 14.5/)
  assert.match(body, /newchat_creative_provider_cost_observations_by_currency_total\{currency="usd"\} 3/)
  assert.match(body, /newchat_creative_provider_alert_dispatches_total 3/)
  assert.match(body, /newchat_creative_provider_alert_dispatches_succeeded_total 1/)
  assert.match(body, /newchat_creative_provider_alert_dispatches_failed_total 1/)
  assert.match(body, /newchat_creative_provider_alert_dispatches_skipped_total 1/)
  assert.match(body, /newchat_creative_provider_alert_dispatches_by_channel_total\{channel="webhook"\} 1/)
  assert.match(body, /newchat_creative_provider_alert_dispatches_by_channel_total\{channel="other"\} 1/)
  assert.match(body, /newchat_creative_provider_alert_dispatches_by_status_total\{status="succeeded"\} 1/)
  assert.match(body, /newchat_creative_provider_alert_dispatches_by_reason_total\{reason="missing_provider_alert_client"\} 1/)
  assert.match(body, /newchat_creative_provider_alert_dispatches_by_reason_total\{reason="other"\} 1/)
  assert.match(body, /newchat_creative_provider_alert_dispatches_by_provider_total\{provider="replicate"\} 2/)
  assert.match(body, /newchat_creative_provider_alert_dispatches_by_provider_total\{provider="other"\} 1/)
  assert.match(body, /newchat_creative_provider_alert_dispatches_by_workspace_total\{workspace="image"\} 2/)
  assert.match(body, /newchat_creative_provider_alert_dispatches_by_workspace_total\{workspace="other"\} 1/)
  assert.match(body, /newchat_creative_provider_alert_fixture_dry_run_dispatches_total 2/)
  assert.match(body, /newchat_creative_provider_alert_fixture_dry_run_dispatches_succeeded_total 1/)
  assert.match(body, /newchat_creative_provider_alert_fixture_dry_run_dispatches_failed_total 1/)
  assert.match(body, /newchat_creative_provider_alert_fixture_dry_run_dispatches_skipped_total 0/)
  assert.match(body, /newchat_creative_provider_alert_fixture_dry_run_dispatches_by_channel_total\{channel="email"\} 1/)
  assert.match(body, /newchat_creative_provider_alert_fixture_dry_run_dispatches_by_channel_total\{channel="other"\} 1/)
  assert.match(body, /newchat_creative_provider_alert_fixture_dry_run_dispatches_by_status_total\{status="failed"\} 1/)
  assert.match(body, /newchat_creative_provider_alert_fixture_dry_run_dispatches_by_reason_total\{reason="missing_provider_alert_client"\} 1/)
  assert.match(body, /newchat_creative_provider_alert_fixture_dry_run_dispatches_by_reason_total\{reason="other"\} 1/)
  assert.match(body, /newchat_creative_provider_alert_fixture_dry_run_dispatches_by_provider_total\{provider="replicate"\} 1/)
  assert.match(body, /newchat_creative_provider_alert_fixture_dry_run_dispatches_by_provider_total\{provider="other"\} 1/)
  assert.match(body, /newchat_creative_provider_alert_fixture_dry_run_dispatches_by_workspace_total\{workspace="image"\} 1/)
  assert.match(body, /newchat_creative_provider_alert_fixture_dry_run_dispatches_by_workspace_total\{workspace="other"\} 1/)
  assert.match(body, /newchat_creative_provider_alert_dispatch_failure_spike_active 1/)
  assert.match(body, /newchat_creative_provider_alert_dispatch_failure_spike_threshold 2/)
  assert.match(body, /newchat_creative_provider_alert_dispatch_failure_spike_failures_total 2/)
  assert.match(body, /newchat_creative_provider_alert_dispatch_failure_spike_by_channel_total\{channel="slack"\} 1/)
  assert.match(body, /newchat_creative_provider_alert_dispatch_failure_spike_by_channel_total\{channel="other"\} 1/)
  assert.match(body, /newchat_creative_provider_alert_dispatch_failure_spike_by_reason_total\{reason="missing_provider_alert_client"\} 1/)
  assert.match(body, /newchat_creative_provider_alert_dispatch_failure_spike_by_reason_total\{reason="other"\} 1/)
  assert.match(body, /newchat_creative_provider_cost_ledger_events_total 4/)
  assert.match(body, /newchat_creative_provider_cost_reservations_total 1/)
  assert.match(body, /newchat_creative_provider_cost_settlements_total 1/)
  assert.match(body, /newchat_creative_provider_cost_releases_total 1/)
  assert.match(body, /newchat_creative_provider_cost_reconciliation_required_total 1/)
  assert.match(body, /newchat_creative_provider_cost_ledger_by_provider_total\{provider="replicate"\} 4/)
  assert.match(body, /newchat_creative_provider_cost_ledger_by_provider_total\{provider="other"\} 1/)
  assert.match(body, /newchat_creative_provider_cost_ledger_by_workspace_total\{workspace="image"\} 4/)
  assert.match(body, /newchat_creative_provider_cost_ledger_by_reason_total\{reason="actual_cost_missing"\} 1/)
  assert.match(body, /newchat_creative_provider_control_events_total 6/)
  assert.match(body, /newchat_creative_provider_control_dispatch_blocked_total 1/)
  assert.match(body, /newchat_creative_provider_circuit_opened_total 1/)
  assert.match(body, /newchat_creative_provider_control_recovery_approved_total 1/)
  assert.match(body, /newchat_creative_provider_control_recovery_rejected_total 1/)
  assert.match(body, /newchat_creative_provider_cap_evidence_recorded_total 2/)
  assert.match(body, /newchat_creative_provider_cap_evidence_expired_total 1/)
  assert.match(body, /newchat_creative_provider_control_events_by_provider_total\{provider="replicate"\} 5/)
  assert.match(body, /newchat_creative_provider_control_events_by_provider_total\{provider="other"\} 1/)
  assert.match(body, /newchat_creative_provider_control_events_by_workspace_total\{workspace="image"\} 5/)
  assert.match(body, /newchat_creative_provider_control_events_by_status_total\{status="open"\} 1/)
  assert.match(body, /newchat_creative_provider_control_events_by_status_total\{status="other"\} 1/)
  assert.match(body, /newchat_creative_provider_control_events_by_reason_total\{reason="provider_circuit_open"\} 1/)
  assert.match(body, /newchat_creative_provider_control_events_by_reason_total\{reason="other"\} 1/)
  assert.match(body, /newchat_creative_provider_retry_events_total 3/)
  assert.match(body, /newchat_creative_provider_retry_exhausted_total 1/)
  assert.match(body, /newchat_creative_provider_retry_by_operation_total\{operation="status_read"\} 3/)
  assert.match(body, /newchat_creative_provider_retry_by_category_total\{category="other"\} 1/)
  assert.equal(body.includes('user@example.com'), false)
  assert.equal(body.includes('prompt-hash-123'), false)
  assert.equal(body.includes('provider_job_mismatch'), false)
  assert.equal(body.includes('secret-token'), false)
})
