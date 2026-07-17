import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildUserLifecycleMetrics,
  decodeUserAdminCursor,
  encodeUserAdminCursor,
  parseCreateUserTagRequest,
  parseUserAdminListQuery,
  parseUserAdminStatusRequest,
  parseUserLifecycleMetricsQuery,
  parseUserTagAssignmentRequest,
  parseUserTagListQuery,
  serializeAdminUser,
} from './userAdminLifecycle.js'

test('user Admin query and status parsers are bounded and closed', () => {
  assert.deepEqual(parseUserAdminListQuery({ status: 'suspended', role: 'member', limit: '10', sort: 'displayName', order: 'asc', search: 'alex' }), {
    status: 'suspended', role: 'member', tag: null, limit: 10, sort: 'displayName', order: 'asc', search: 'alex', cursor: null,
  })
  assert.deepEqual(parseUserAdminStatusRequest({ expectedVersion: 2, reasonCode: 'policy_violation' }), { expectedVersion: 2, reasonCode: 'policy_violation' })
  assert.throws(() => parseUserAdminListQuery({ tenantId: 'forbidden' }), /unsupported fields/)
  assert.throws(() => parseUserAdminStatusRequest({ expectedVersion: 1, reasonCode: 'free form reason' }), /stable lowercase/)
})

test('user lifecycle metric and tag parsers are bounded and closed', () => {
  assert.deepEqual(parseUserLifecycleMetricsQuery({ dateFrom: '2026-06-01T00:00:00Z', dateTo: '2026-07-01T00:00:00Z' }), {
    dateFrom: '2026-06-01T00:00:00.000Z', dateTo: '2026-07-01T00:00:00.000Z',
  })
  assert.deepEqual(parseUserTagListQuery({ status: 'archived', search: 'risk' }), { status: 'archived', search: 'risk' })
  assert.deepEqual(parseCreateUserTagRequest({ key: 'vip.user', label: 'VIP', description: '', color: 'purple', reasonCode: 'initial_setup' }), {
    key: 'vip.user', label: 'VIP', description: null, color: 'purple', reasonCode: 'initial_setup',
  })
  assert.deepEqual(parseUserTagAssignmentRequest({ expectedUserVersion: 2, reasonCode: 'operator_requested' }), { expectedUserVersion: 2, reasonCode: 'operator_requested' })
  assert.throws(() => parseUserLifecycleMetricsQuery({ dateFrom: '2025-01-01T00:00:00Z', dateTo: '2026-07-01T00:00:00Z' }), /366 days/)
  assert.throws(() => parseCreateUserTagRequest({ key: 'Bad Key', label: 'Bad', color: 'blue', reasonCode: 'test' }), /lowercase identifier/)
})

test('user lifecycle metrics calculate current mix activity tags and retention', () => {
  const tag = { id: 'tag-vip', key: 'vip', label: 'VIP', color: 'purple', archivedAt: null }
  const users = [
    { id: 'u1', role: 'member', status: 'active', createdAt: '2026-06-01T00:00:00Z', tagAssignments: [{ tag, removedAt: null }] },
    { id: 'u2', role: 'creator', status: 'suspended', createdAt: '2026-06-20T00:00:00Z', tagAssignments: [] },
    { id: 'u3', role: 'member', status: 'deleted', createdAt: '2026-05-01T00:00:00Z', tagAssignments: [] },
  ]
  const sessions = [
    { userId: 'u1', lastSeenAt: '2026-06-10T00:00:00Z', revokedAt: null, riskStatus: 'normal' },
    { userId: 'u2', lastSeenAt: '2026-06-25T00:00:00Z', revokedAt: null, riskStatus: 'normal' },
  ]
  const metrics = buildUserLifecycleMetrics({ users, sessions, query: { dateFrom: '2026-06-01T00:00:00.000Z', dateTo: '2026-07-15T00:00:00.000Z' } })
  assert.deepEqual(metrics.totals, { accounts: 3, currentAccounts: 2, newUsers: 2, activeUsers: 2, taggedUsers: 1 })
  assert.equal(metrics.roles.member, 1)
  assert.equal(metrics.statuses.deleted, 1)
  assert.deepEqual(metrics.tags[0], { id: 'tag-vip', key: 'vip', label: 'VIP', color: 'purple', users: 1 })
  assert.deepEqual(metrics.retention.d7, { eligible: 2, retained: 1, ratePercent: 50 })
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
    tagAssignments: [{ removedAt: null, tag: { id: 'tag-1', key: 'vip', label: 'VIP', color: 'purple', version: 1, archivedAt: null, createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z') } }],
    suspendedAt: new Date('2026-07-18T00:00:00Z'), suspensionReasonCode: 'policy_violation', createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-07-18T00:00:00Z'),
  }, { activeSessionCount: 0 })
  assert.deepEqual(projected.authMethods, ['github', 'password'])
  assert.equal(projected.tags[0].key, 'vip')
  assert.equal(JSON.stringify(projected).includes('secret'), false)
  assert.equal(JSON.stringify(projected).includes('raw-provider-id'), false)
})
