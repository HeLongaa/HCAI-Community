import assert from 'node:assert/strict'
import test from 'node:test'

import { deleteDataRightsExportObject } from './exportArtifactRetention.js'

const artifact = {
  id: 'artifact-1',
  requestId: 'request-1',
  storageKey: 'exports/data-rights/subject_0123456789abcdef01234567/request-1.json',
  checksumSha256: 'a'.repeat(64),
  expiresAt: new Date('2026-07-27T00:00:00.000Z'),
}

test('data export deletion is namespace constrained and returns hashed evidence', async () => {
  const calls = []
  const result = await deleteDataRightsExportObject(artifact, {
    now: new Date('2026-07-28T00:00:00.000Z'),
    source: { STORAGE_DRIVER: 'mock' },
    deleteObject: async (asset, options) => {
      calls.push({ asset, options })
      return { provider: 'mock', statusCode: null, deletedAt: options.now.toISOString() }
    },
  })

  assert.deepEqual(calls[0].asset, { storageKey: artifact.storageKey })
  assert.equal(result.provider, 'mock')
  assert.equal(result.receiptHash.length, 64)
  assert.equal(JSON.stringify(result).includes(artifact.storageKey), false)
})

test('data export deletion rejects keys outside the dedicated namespace before storage access', async () => {
  let called = false
  await assert.rejects(deleteDataRightsExportObject({
    ...artifact,
    storageKey: 'uploads/private-user-object.json',
  }, {
    deleteObject: async () => { called = true },
  }), { code: 'DATA_EXPORT_STORAGE_KEY_INVALID' })
  assert.equal(called, false)
})
