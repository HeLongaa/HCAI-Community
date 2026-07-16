import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

import { deleteStorageObject, inspectStorageObject, StorageObjectError } from './objectStore.js'

const sourceFor = (port) => ({
  STORAGE_DRIVER: 's3',
  STORAGE_ENDPOINT: `http://127.0.0.1:${port}`,
  STORAGE_REGION: 'us-east-1',
  STORAGE_BUCKET: 'media',
  STORAGE_ACCESS_KEY_ID: 'access-key',
  STORAGE_SECRET_ACCESS_KEY: 'secret-key',
})

const asset = {
  storageKey: 'owner/library_asset/media-file.png',
  contentType: 'image/png',
  sizeBytes: 12,
  checksumSha256: 'c'.repeat(64),
}

const withServer = async (handler, run) => {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    return await run(server.address().port)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
}

test('inspectStorageObject verifies S3 HEAD size, type, checksum, and ETag', async () => {
  await withServer((request, response) => {
    assert.equal(request.method, 'HEAD')
    response.writeHead(200, {
      'content-length': String(asset.sizeBytes),
      'content-type': asset.contentType,
      'x-amz-checksum-sha256': Buffer.from(asset.checksumSha256, 'hex').toString('base64'),
      etag: '"etag-1"',
    })
    response.end()
  }, async (port) => {
    const result = await inspectStorageObject(asset, { source: sourceFor(port) })
    assert.deepEqual(result, {
      provider: 's3',
      etag: 'etag-1',
      checksumSha256: asset.checksumSha256,
      sizeBytes: asset.sizeBytes,
      contentType: asset.contentType,
      verifiedAt: result.verifiedAt,
    })
  })
})

test('inspectStorageObject fails closed on missing and mismatched objects', async () => {
  await withServer((_request, response) => {
    response.writeHead(404)
    response.end()
  }, async (port) => {
    await assert.rejects(
      inspectStorageObject(asset, { source: sourceFor(port) }),
      (error) => error instanceof StorageObjectError && error.code === 'STORAGE_OBJECT_NOT_FOUND',
    )
  })

  await withServer((_request, response) => {
    response.writeHead(200, {
      'content-length': String(asset.sizeBytes + 1),
      'content-type': asset.contentType,
      'x-amz-checksum-sha256': Buffer.from(asset.checksumSha256, 'hex').toString('base64'),
    })
    response.end()
  }, async (port) => {
    await assert.rejects(
      inspectStorageObject(asset, { source: sourceFor(port) }),
      (error) => error instanceof StorageObjectError && error.code === 'STORAGE_SIZE_MISMATCH',
    )
  })
})

test('deleteStorageObject treats S3 404 as an idempotent success', async () => {
  await withServer((request, response) => {
    assert.equal(request.method, 'DELETE')
    response.writeHead(404)
    response.end()
  }, async (port) => {
    const result = await deleteStorageObject(asset, { source: sourceFor(port) })
    assert.equal(result.provider, 's3')
    assert.equal(result.statusCode, 404)
  })
})
