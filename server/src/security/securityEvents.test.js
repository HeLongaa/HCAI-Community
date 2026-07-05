import assert from 'node:assert/strict'
import test from 'node:test'

import {
  configureSecurityEventStore,
  flushSecurityEvents,
  listSecurityEvents,
  recordSecurityEvent,
  resetSecurityEvents,
} from './securityEvents.js'

test('security event collector records recent events with filters and pagination', () => {
  resetSecurityEvents()
  try {
    const first = recordSecurityEvent({
      type: 'rate_limit.exceeded',
      severity: 'warning',
      source: 'rate_limit',
      clientKey: '198.51.100.10',
      method: 'POST',
      pathname: '/api/auth/login',
      bucket: 'auth',
    })
    recordSecurityEvent({
      type: 'request.body_rejected',
      severity: 'warning',
      source: 'body_size',
      clientKey: '198.51.100.11',
      method: 'POST',
      pathname: '/api/tasks',
    })
    const third = recordSecurityEvent({
      type: 'auth.failed_login.ip_accounts',
      severity: 'warning',
      source: 'auth_failure',
      clientKey: '198.51.100.12',
      identity: 'target@example.com',
      method: 'POST',
      pathname: '/api/auth/login',
    })

    const firstPage = listSecurityEvents({ limit: 1, severity: 'warning' })
    assert.equal(firstPage.items.length, 1)
    assert.equal(firstPage.items[0].id, third.id)
    assert.equal(firstPage.nextCursor, third.id)

    const secondPage = listSecurityEvents({ limit: 2, severity: 'warning', cursor: firstPage.nextCursor })
    assert.equal(secondPage.items.length, 2)
    assert.equal(secondPage.items[1].id, first.id)

    const authEvents = listSecurityEvents({ limit: 20, source: 'auth_failure' })
    assert.equal(authEvents.items.length, 1)
    assert.equal(authEvents.items[0].type, 'auth.failed_login.ip_accounts')
    assert.equal(authEvents.items[0].identity, 'target@example.com')
  } finally {
    resetSecurityEvents()
  }
})

test('security event collector keeps the configured maximum number of events', () => {
  resetSecurityEvents()
  try {
    recordSecurityEvent({ type: 'one', source: 'test' }, { SECURITY_EVENT_MAX_ITEMS: '2' })
    recordSecurityEvent({ type: 'two', source: 'test' }, { SECURITY_EVENT_MAX_ITEMS: '2' })
    recordSecurityEvent({ type: 'three', source: 'test' }, { SECURITY_EVENT_MAX_ITEMS: '2' })

    const page = listSecurityEvents({ limit: 10 })
    assert.deepEqual(page.items.map((event) => event.type), ['three', 'two'])
  } finally {
    resetSecurityEvents()
  }
})

test('security event collector mirrors records to a configured persistent store', async () => {
  resetSecurityEvents()
  const stored = []
  configureSecurityEventStore({
    record: async (event) => {
      stored.push(event)
    },
  })
  try {
    const event = recordSecurityEvent({
      type: 'rate_limit.exceeded',
      severity: 'warning',
      source: 'rate_limit',
      clientKey: '198.51.100.20',
    })
    await flushSecurityEvents()

    assert.equal(stored.length, 1)
    assert.equal(stored[0].id, event.id)
    assert.equal(stored[0].clientKey, '198.51.100.20')
  } finally {
    configureSecurityEventStore(null)
    resetSecurityEvents()
  }
})

test('security event collector keeps local records when persistent writes fail', async () => {
  resetSecurityEvents()
  configureSecurityEventStore({
    record: async () => {
      throw new Error('store unavailable')
    },
  })
  try {
    recordSecurityEvent({ type: 'request.body_rejected', severity: 'warning', source: 'body_size' })
    await flushSecurityEvents()

    const page = listSecurityEvents({ limit: 10 })
    assert.equal(page.items.length, 1)
    assert.equal(page.items[0].type, 'request.body_rejected')
  } finally {
    configureSecurityEventStore(null)
    resetSecurityEvents()
  }
})
