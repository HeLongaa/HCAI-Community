import assert from 'node:assert/strict'
import test from 'node:test'

import { decodeSearchCursor, encodeSearchCursor, parseSearchQuery, parseSearchSyncRequest } from './searchContract.js'

test('search query parsing bounds types, pagination, and query-bound cursors', () => {
  const query = parseSearchQuery({ q: 'permission aware', types: 'task,user,task', limit: '12' })
  assert.deepEqual(query.types, ['task', 'user'])
  assert.equal(query.limit, 12)
  const cursor = encodeSearchCursor({ ...query, offset: 12 })
  assert.equal(decodeSearchCursor(cursor, query), 12)
  assert.throws(() => decodeSearchCursor(cursor, { ...query, query: 'different' }), /cursor is invalid/)
  assert.throws(() => parseSearchQuery({ q: 'x' }), /q must be between/)
  assert.throws(() => parseSearchQuery({ q: 'valid', types: 'tenant' }), /types must only include/)
})

test('search synchronization requests require bounded batches and stable reason codes', () => {
  assert.deepEqual(parseSearchSyncRequest({ types: ['task', 'asset'], limit: 200, reasonCode: 'rebuild_after_release' }), {
    types: ['task', 'asset'], limit: 200, reasonCode: 'rebuild_after_release',
  })
  assert.throws(() => parseSearchSyncRequest({ limit: 501 }), /limit must be/)
  assert.throws(() => parseSearchSyncRequest({ reasonCode: 'Not Stable' }), /stable lowercase/)
})
