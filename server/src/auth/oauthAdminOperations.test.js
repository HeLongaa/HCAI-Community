import assert from 'node:assert/strict'
import test from 'node:test'

import {
  decodeOAuthAdminCursor,
  encodeOAuthAdminCursor,
  oauthAuthorizationRequestStatus,
  parseOAuthAccountAdminListQuery,
  parseOAuthAuthorizationAdminListQuery,
  parseOAuthProviderStatusRequest,
  serializeOAuthAuthorizationRequest,
  serializeOAuthProviderControl,
} from './oauthAdminOperations.js'

test('OAuth Admin parsers bound filters, ordering, versions, and stable reason codes', () => {
  assert.deepEqual(parseOAuthAccountAdminListQuery({ provider: 'Google', search: 'maker', limit: '25', order: 'asc' }), {
    provider: 'google', search: 'maker', cursor: null, limit: 25, order: 'asc', sort: 'createdAt',
  })
  assert.deepEqual(parseOAuthAuthorizationAdminListQuery({ status: 'pending', sort: 'expiresAt' }), {
    provider: null, status: 'pending', cursor: null, limit: 20, order: 'desc', sort: 'expiresAt',
  })
  assert.deepEqual(parseOAuthProviderStatusRequest({ enabled: false, expectedVersion: 0, reasonCode: 'incident_containment' }), {
    enabled: false, expectedVersion: 0, reasonCode: 'incident_containment',
  })
  assert.throws(() => parseOAuthAccountAdminListQuery({ limit: 101 }), /limit/)
  assert.throws(() => parseOAuthAuthorizationAdminListQuery({ status: 'unknown' }), /status/)
  assert.throws(() => parseOAuthProviderStatusRequest({ enabled: true, expectedVersion: 1, reasonCode: 'Human words' }), /reasonCode/)
})

test('OAuth Admin cursors are query-bound and reject tampering', () => {
  const query = { sort: 'createdAt', order: 'desc' }
  const cursor = encodeOAuthAdminCursor({ ...query, value: '2026-07-17T00:00:00.000Z', id: 'account-1' })
  assert.deepEqual(decodeOAuthAdminCursor(cursor, query), {
    v: 1, ...query, value: '2026-07-17T00:00:00.000Z', id: 'account-1',
  })
  assert.throws(() => decodeOAuthAdminCursor(cursor, { sort: 'createdAt', order: 'asc' }), /cursor/)
  assert.throws(() => decodeOAuthAdminCursor(`${cursor}x`, query), /cursor/)
  assert.throws(() => decodeOAuthAdminCursor(encodeOAuthAdminCursor({ ...query, value: 'not-a-date', id: 'account-1' }), query), /cursor/)
})

test('OAuth Admin projections expose lifecycle evidence without internal OAuth context', () => {
  const now = new Date('2026-07-17T00:00:00.000Z')
  const request = {
    id: 'request-1', provider: 'google', stateHash: 'secret-state-hash', redirectTo: '/private', linkUserId: 'user-1',
    createdAt: now, expiresAt: new Date(now.getTime() + 60_000), consumedAt: null, revokedAt: null, revokeReasonCode: null,
  }
  assert.equal(oauthAuthorizationRequestStatus(request, now), 'pending')
  const projected = serializeOAuthAuthorizationRequest(request, now)
  assert.deepEqual(Object.keys(projected), ['id', 'provider', 'status', 'createdAt', 'expiresAt', 'consumedAt', 'revokedAt', 'revokeReasonCode'])
  assert.equal(JSON.stringify(projected).includes('secret-state-hash'), false)

  const provider = serializeOAuthProviderControl('google', {
    label: 'Google', configured: true, mode: 'external', authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth', scope: 'openid email profile',
    clientId: 'must-not-leak', clientSecret: 'must-not-leak',
  }, null)
  assert.equal(provider.enabled, true)
  assert.equal(provider.version, 0)
  assert.equal(JSON.stringify(provider).includes('must-not-leak'), false)
})
