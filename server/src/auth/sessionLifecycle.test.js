import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildSessionClientContext,
  decodeAuthSessionCursor,
  encodeAuthSessionCursor,
  parseAuthSessionDispositionRequest,
  parseAuthSessionListQuery,
  parseAuthSessionRevokeRequest,
} from './sessionLifecycle.js'

test('session client context keeps a coarse label and hashes network evidence', () => {
  const context = buildSessionClientContext({
    headers: {
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
      'x-forwarded-for': '203.0.113.25, 10.0.0.2',
    },
    socket: { remoteAddress: '127.0.0.1' },
  })
  assert.equal(context.clientLabel, 'Chrome on macOS')
  assert.match(context.networkHash, /^[a-f0-9]{64}$/)
  assert.equal(JSON.stringify(context).includes('203.0.113.25'), false)
})

test('session parsers enforce bounded filters, CAS versions, and stable reasons', () => {
  const query = parseAuthSessionListQuery({ status: 'active', riskStatus: 'suspicious', limit: '25', sort: 'expiresAt', order: 'asc' })
  assert.deepEqual(query, {
    status: 'active', riskStatus: 'suspicious', search: null, cursor: null, limit: 25, sort: 'expiresAt', order: 'asc',
  })
  assert.deepEqual(parseAuthSessionDispositionRequest({ riskStatus: 'compromised', expectedVersion: 2, reasonCode: 'credential_reuse' }), {
    riskStatus: 'compromised', expectedVersion: 2, reasonCode: 'credential_reuse',
  })
  assert.deepEqual(parseAuthSessionRevokeRequest({ expectedVersion: 3, reasonCode: 'operator_revoked' }), {
    expectedVersion: 3, reasonCode: 'operator_revoked',
  })
  assert.throws(() => parseAuthSessionListQuery({ status: 'unknown' }), /status is invalid/)
  assert.throws(() => parseAuthSessionDispositionRequest({ riskStatus: 'normal', expectedVersion: 0, reasonCode: 'x' }), /positive integer/)
  assert.throws(() => parseAuthSessionRevokeRequest({ expectedVersion: 1, reasonCode: 'Not Stable' }), /stable lowercase/)
})

test('session cursors are query-bound', () => {
  const query = parseAuthSessionListQuery({ sort: 'lastSeenAt', order: 'desc' })
  const cursor = encodeAuthSessionCursor({ sort: query.sort, order: query.order, value: new Date().toISOString(), id: 'session-1' })
  assert.equal(decodeAuthSessionCursor(cursor, query).id, 'session-1')
  assert.throws(() => decodeAuthSessionCursor(cursor, { ...query, order: 'asc' }), /cursor is invalid/)
})
