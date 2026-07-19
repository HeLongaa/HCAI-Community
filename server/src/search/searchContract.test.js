import assert from 'node:assert/strict'
import test from 'node:test'

import { decodeSearchCursor, encodeSearchCursor, parseSearchClickRequest, parseSearchDiagnosticsQuery, parseSearchQuery, parseSearchRankingControlRequest, parseSearchSyncRequest, searchQueryFingerprint } from './searchContract.js'

test('search query parsing bounds types, pagination, and query-bound cursors', () => {
  const query = parseSearchQuery({ q: 'permission aware', types: 'task,user,task', limit: '12' })
  assert.deepEqual(query.types, ['task', 'user'])
  assert.equal(query.limit, 12)
  assert.equal(query.sort, 'relevance')
  const cursor = encodeSearchCursor({ ...query, offset: 12 })
  assert.equal(decodeSearchCursor(cursor, query), 12)
  assert.throws(() => decodeSearchCursor(cursor, { ...query, query: 'different' }), /cursor is invalid/)
  assert.throws(() => decodeSearchCursor(cursor, { ...query, sort: 'popular' }), /cursor is invalid/)
  assert.throws(() => parseSearchQuery({ q: 'x' }), /q must be between/)
  assert.throws(() => parseSearchQuery({ q: 'valid', types: 'tenant' }), /types must only include/)
  assert.throws(() => parseSearchQuery({ q: 'valid', sort: 'random' }), /sort must be one of/)
})

test('search synchronization requests require bounded batches and stable reason codes', () => {
  assert.deepEqual(parseSearchSyncRequest({ types: ['task', 'asset'], limit: 200, reasonCode: 'rebuild_after_release' }), {
    types: ['task', 'asset'], limit: 200, reasonCode: 'rebuild_after_release',
  })
  assert.throws(() => parseSearchSyncRequest({ limit: 501 }), /limit must be/)
  assert.throws(() => parseSearchSyncRequest({ reasonCode: 'Not Stable' }), /stable lowercase/)
})

test('search diagnostics contracts require returned-result click evidence and bounded controls', () => {
  assert.deepEqual(parseSearchClickRequest({ resourceType: 'user', sourceId: 'user-1', position: 1 }), { resourceType: 'user', sourceId: 'user-1', position: 1 })
  assert.throws(() => parseSearchClickRequest({ resourceType: 'user', sourceId: 'user-1' }), /position is required/)
  assert.throws(() => parseSearchClickRequest({ resourceType: 'tenant', sourceId: 'tenant-1', position: 1 }), /resourceType must be/)
  assert.deepEqual(parseSearchDiagnosticsQuery({ windowHours: '72' }), { windowHours: 72 })
  assert.throws(() => parseSearchDiagnosticsQuery({ windowHours: 169 }), /windowHours must be/)
  const control = parseSearchRankingControlRequest({ relevanceWeight: 100, recencyWeight: 15, popularityWeight: 20, zeroResultAlertRateBps: 2500, expectedVersion: 0, reasonCode: 'quality_tuning' })
  assert.equal(control.reasonCode, 'quality_tuning')
  assert.throws(() => parseSearchRankingControlRequest({ ...control, relevanceWeight: 101 }), /relevanceWeight must be/)
  const fingerprint = searchQueryFingerprint('private raw query')
  assert.match(fingerprint, /^[a-f0-9]{64}$/)
  assert.equal(fingerprint.includes('private'), false)
})
