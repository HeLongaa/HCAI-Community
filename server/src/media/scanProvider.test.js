import assert from 'node:assert/strict'
import test from 'node:test'

import { scanMediaAsset } from './scanProvider.js'

test('trusted Provider scan mode allows generated outputs but not user uploads', async () => {
  const previous = process.env.MEDIA_SCAN_PROVIDER
  process.env.MEDIA_SCAN_PROVIDER = 'trusted-provider'
  try {
    const generated = await scanMediaAsset({ metadata: { creative: { schemaVersion: 1 } } })
    assert.equal(generated.provider, 'trusted-provider')
    assert.equal(generated.status, 'clean')

    const upload = await scanMediaAsset({ metadata: {} })
    assert.equal(upload.provider, 'manual')
    assert.equal(upload.status, 'pending')
  } finally {
    if (previous == null) delete process.env.MEDIA_SCAN_PROVIDER
    else process.env.MEDIA_SCAN_PROVIDER = previous
  }
})
