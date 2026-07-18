import assert from 'node:assert/strict'
import test from 'node:test'
import { parseVersionedApiPath } from './apiVersion.js'

test('versioned API path parsing is generic and segment-bound', () => {
  assert.equal(parseVersionedApiPath('/api/v1'), 'v1')
  assert.equal(parseVersionedApiPath('/api/v12/widgets'), 'v12')
  assert.equal(parseVersionedApiPath('/api/v1beta/widgets'), null)
  assert.equal(parseVersionedApiPath('/api/admin/v1'), null)
  assert.equal(parseVersionedApiPath('/api/v0'), null)
})
