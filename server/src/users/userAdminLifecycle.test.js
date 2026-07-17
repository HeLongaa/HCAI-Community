import assert from 'node:assert/strict'
import test from 'node:test'

import {
  decodeUserAdminCursor,
  encodeUserAdminCursor,
  parseUserAdminListQuery,
  parseUserAdminStatusRequest,
  serializeAdminUser,
} from './userAdminLifecycle.js'

test('user Admin query and status parsers are bounded and closed', () => {
  assert.deepEqual(parseUserAdminListQuery({ status: 'suspended', role: 'member', limit: '10', sort: 'displayName', order: 'asc', search: 'alex' }), {
    status: 'suspended', role: 'member', limit: 10, sort: 'displayName', order: 'asc', search: 'alex', cursor: null,
  })
  assert.deepEqual(parseUserAdminStatusRequest({ expectedVersion: 2, reasonCode: 'policy_violation' }), { expectedVersion: 2, reasonCode: 'policy_violation' })
  assert.throws(() => parseUserAdminListQuery({ tenantId: 'forbidden' }), /unsupported fields/)
  assert.throws(() => parseUserAdminStatusRequest({ expectedVersion: 1, reasonCode: 'free form reason' }), /stable lowercase/)
})

test('user Admin cursors are canonical and query-bound', () => {
  const query = parseUserAdminListQuery({ sort: 'updatedAt', order: 'desc' })
  const cursor = encodeUserAdminCursor({ sort: query.sort, order: query.order, value: '2026-07-18T00:00:00.000Z', id: 'user-1' })
  assert.equal(decodeUserAdminCursor(cursor, query).id, 'user-1')
  assert.throws(() => decodeUserAdminCursor(cursor, { ...query, order: 'asc' }), /cursor is invalid/)
})

test('user Admin projection exposes lifecycle summaries without credential material', () => {
  const projected = serializeAdminUser({
    id: 'user-1', email: 'owner@example.com', displayName: 'Owner', role: 'member', status: 'suspended', accountVersion: 3,
    profile: { handle: 'owner', visibility: 'private', discoverable: false, lane: 'maker' },
    authAccounts: [{ provider: 'password', passwordHash: 'secret' }, { provider: 'github', providerUserId: 'raw-provider-id' }],
    suspendedAt: new Date('2026-07-18T00:00:00Z'), suspensionReasonCode: 'policy_violation', createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-07-18T00:00:00Z'),
  }, { activeSessionCount: 0 })
  assert.deepEqual(projected.authMethods, ['github', 'password'])
  assert.equal(JSON.stringify(projected).includes('secret'), false)
  assert.equal(JSON.stringify(projected).includes('raw-provider-id'), false)
})
