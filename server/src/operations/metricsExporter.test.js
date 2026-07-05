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
  })

  assert.match(body, /# TYPE newchat_security_events_window_total gauge/)
  assert.match(body, /newchat_security_events_by_type_total\{type="rate_limit.exceeded"\} 1/)
  assert.match(body, /newchat_security_events_by_source_total\{source="rate_limit"\} 1/)
  assert.match(body, /newchat_security_events_by_source_total\{source="other"\} 1/)
  assert.match(body, /newchat_rate_limit_exceeded_by_bucket_total\{bucket="auth"\} 1/)
  assert.match(body, /newchat_operation_lease_skipped_runs_by_key_total\{key="task-stale-submission-sweep"\} 1/)
  assert.match(body, /newchat_operation_lease_renew_failures_by_key_total\{key="other"\} 1/)
  assert.equal(body.includes('user@example.com'), false)
  assert.equal(body.includes('secret-token'), false)
})
