import assert from 'node:assert/strict'
import test from 'node:test'

import { buildSecurityAlertPolicy, buildSecurityEventAlerts } from './alertPolicy.js'

test('security alert policy builds threshold alerts from recent event groups', () => {
  const policy = buildSecurityAlertPolicy({
    SECURITY_ALERT_WINDOW_MINUTES: '30',
    SECURITY_ALERT_RATE_LIMIT_THRESHOLD: '2',
    SECURITY_ALERT_BODY_REJECTED_THRESHOLD: '3',
    SECURITY_ALERT_AUTH_FAILURE_THRESHOLD: '1',
    SECURITY_ALERT_DELIVERY_FAILURE_THRESHOLD: '2',
  })

  const alerts = buildSecurityEventAlerts({
    policy,
    rateLimitEvents: [
      { id: 'security-1', clientKey: '198.51.100.1', pathname: '/api/auth/login' },
      { id: 'security-2', clientKey: '198.51.100.2', pathname: '/api/auth/login' },
    ],
    bodyRejectedEvents: [
      { id: 'security-3', clientKey: '198.51.100.3', pathname: '/api/tasks' },
    ],
    authFailureEvents: [
      { id: 'security-4', clientKey: '198.51.100.4', identity: 'target@example.com' },
    ],
    alertDeliveryFailureEvents: [
      { id: 'audit-1', metadata: { channel: 'webhook', status: 'failed', alertType: 'security.event.rate_limit.spike', error: 'HTTP 500' } },
      { id: 'audit-2', metadata: { channel: 'slack', status: 'failed', alertType: 'security.event.auth_failure_anomaly.spike', error: 'fetch failed' } },
    ],
    now: new Date('2026-01-01T00:00:00.000Z'),
  })

  assert.deepEqual(alerts.map((alert) => alert.type), [
    'security.event.rate_limit.spike',
    'security.event.auth_failure_anomaly.spike',
    'security.alert.delivery_failed.spike',
  ])
  assert.equal(alerts[0].threshold, 2)
  assert.equal(alerts[0].windowMinutes, 30)
  assert.deepEqual(alerts[0].metadata.recentClientKeys, ['198.51.100.1', '198.51.100.2'])
  assert.equal(alerts[1].severity, 'critical')
  assert.deepEqual(alerts[1].metadata.recentIdentities, ['target@example.com'])
  assert.equal(alerts[2].resourceType, 'security_alert_dispatch')
  assert.equal(alerts[2].threshold, 2)
  assert.deepEqual(alerts[2].metadata.recentChannels, ['webhook', 'slack'])
  assert.deepEqual(alerts[2].metadata.recentErrors, ['HTTP 500', 'fetch failed'])
})
