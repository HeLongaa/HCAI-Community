import assert from 'node:assert/strict'
import test from 'node:test'

import { createCreativeStorageInputReader } from './creativeInputReader.js'

const storageSource = Object.freeze({
  STORAGE_DRIVER: 's3',
  STORAGE_ENDPOINT: 'https://storage.example.com',
  STORAGE_REGION: 'us-east-1',
  STORAGE_BUCKET: 'private-media',
  STORAGE_ACCESS_KEY_ID: 'input-reader-access',
  STORAGE_SECRET_ACCESS_KEY: 'input-reader-secret-value',
  STORAGE_SCANNER_READ_TTL_SECONDS: '60',
})

const asset = Object.freeze({
  id: 'asset-input-1',
  storageKey: 'private/creator/source.png',
  sizeBytes: 5,
  contentType: 'image/png',
})

test('creative storage input reader signs an S3 scanner GET and returns exact bytes', async () => {
  let request = null
  const reader = createCreativeStorageInputReader({
    source: storageSource,
    fetchImpl: async (url, options) => {
      request = { url, options }
      return new Response(Buffer.from('bytes'), {
        status: 200,
        headers: { 'content-length': '5', 'content-type': 'image/png' },
      })
    },
  })

  const result = await reader(asset)

  assert.equal(result.body.toString(), 'bytes')
  assert.equal(result.contentType, 'image/png')
  assert.equal(request.options.method, 'GET')
  assert.equal(request.options.redirect, 'error')
  assert.equal(new URL(request.url).protocol, 'https:')
  assert.equal(JSON.stringify(request).includes(storageSource.STORAGE_SECRET_ACCESS_KEY), false)
  assert.equal(JSON.stringify(result).includes(asset.storageKey), false)
})

test('creative storage input reader rejects missing storage keys', async () => {
  const reader = createCreativeStorageInputReader({ source: storageSource, fetchImpl: async () => assert.fail('fetch must not run') })
  await assert.rejects(
    reader({ ...asset, storageKey: null }),
    (error) => error.code === 'CREATIVE_INPUT_ASSET_BYTES_UNAVAILABLE' && error.details.reasonCode === 'storage_key_missing',
  )
})

test('creative storage input reader rejects mismatched content length', async () => {
  const reader = createCreativeStorageInputReader({
    source: storageSource,
    fetchImpl: async () => new Response(Buffer.from('bytes'), { headers: { 'content-length': '4' } }),
  })
  await assert.rejects(reader(asset), (error) => error.details.reasonCode === 'content_length_mismatch')
})

test('creative storage input reader stops streams beyond the declared size', async () => {
  const reader = createCreativeStorageInputReader({
    source: storageSource,
    fetchImpl: async () => new Response(Buffer.from('excess'), { headers: { 'content-length': '5' } }),
  })
  await assert.rejects(reader(asset), (error) => error.details.reasonCode === 'stream_limit_exceeded')
})
