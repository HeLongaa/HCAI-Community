import assert from 'node:assert/strict'
import test from 'node:test'

import { createMemoryAuthFailureMonitor, recordAuthFailure } from './loginMonitor.js'

const requestFor = (url, forwardedFor) => ({
  method: 'POST',
  url,
  headers: {
    host: 'api.example.test',
    ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}),
  },
  socket: { remoteAddress: '127.0.0.1' },
})

test('auth failure monitor detects one IP failing against many identities', async () => {
  const monitor = createMemoryAuthFailureMonitor()
  const anomalies = []
  for (const identity of ['alpha@example.com', 'beta@example.com', 'gamma@example.com']) {
    anomalies.push(...await recordAuthFailure(requestFor('/api/auth/login', '198.51.100.1'), {
      identity,
      reason: 'invalid_email_or_password',
    }, {
      monitor,
      source: {
        AUTH_FAILURE_IP_ACCOUNT_THRESHOLD: '3',
        AUTH_FAILURE_ACCOUNT_IP_THRESHOLD: '99',
        AUTH_FAILURE_WINDOW_MS: '60000',
      },
      now: 1_000,
    }))
  }

  const anomaly = anomalies.find((item) => item.type === 'auth.failed_login.ip_accounts')
  assert.ok(anomaly)
  assert.equal(anomaly.clientKey, '198.51.100.1')
  assert.equal(anomaly.identity, 'gamma@example.com')
  assert.equal(anomaly.distinctIdentityCount, 3)
  assert.equal(anomaly.threshold, 3)
  assert.equal(anomaly.pathname, '/api/auth/login')
})

test('auth failure monitor detects one identity failing from many IPs', async () => {
  const monitor = createMemoryAuthFailureMonitor()
  const anomalies = []
  for (const clientKey of ['198.51.100.11', '198.51.100.12', '198.51.100.13']) {
    anomalies.push(...await recordAuthFailure(requestFor('/api/auth/login', clientKey), {
      identity: 'target@example.com',
      reason: 'invalid_email_or_password',
    }, {
      monitor,
      source: {
        AUTH_FAILURE_IP_ACCOUNT_THRESHOLD: '99',
        AUTH_FAILURE_ACCOUNT_IP_THRESHOLD: '3',
        AUTH_FAILURE_WINDOW_MS: '60000',
      },
      now: 2_000,
    }))
  }

  const anomaly = anomalies.find((item) => item.type === 'auth.failed_login.account_ips')
  assert.ok(anomaly)
  assert.equal(anomaly.identity, 'target@example.com')
  assert.equal(anomaly.clientKey, '198.51.100.13')
  assert.equal(anomaly.distinctClientCount, 3)
  assert.equal(anomaly.threshold, 3)
})

test('auth failure monitor can be disabled for trusted internal deployments', async () => {
  const monitor = createMemoryAuthFailureMonitor()
  const anomalies = await recordAuthFailure(requestFor('/api/auth/login', '198.51.100.20'), {
    identity: 'disabled@example.com',
    reason: 'invalid_email_or_password',
  }, {
    monitor,
    source: { AUTH_FAILURE_MONITOR_ENABLED: 'false', AUTH_FAILURE_IP_ACCOUNT_THRESHOLD: '1' },
  })

  assert.deepEqual(anomalies, [])
})

test('auth failure anomaly observer failures remain non-fatal', async () => {
  const monitor = createMemoryAuthFailureMonitor()
  const anomalies = await recordAuthFailure(requestFor('/api/auth/login', '198.51.100.30'), {
    identity: 'observer@example.com',
    reason: 'invalid_email_or_password',
  }, {
    monitor,
    source: { AUTH_FAILURE_IP_ACCOUNT_THRESHOLD: '1' },
    onAnomaly: () => {
      throw new Error('metrics sink unavailable')
    },
  })

  assert.equal(anomalies.length, 1)
  assert.equal(anomalies[0].type, 'auth.failed_login.ip_accounts')
})
