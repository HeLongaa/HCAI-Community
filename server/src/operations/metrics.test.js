import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOperationsMetrics } from './metrics.js'

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
