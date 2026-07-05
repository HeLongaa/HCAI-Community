import assert from 'node:assert/strict'
import test from 'node:test'

import { buildStorageConfig, signMediaDownload, signMediaUpload } from './uploadSigner.js'

const asset = {
  storageKey: 'taskops/task_attachment/media-1-brief.pdf',
  contentType: 'application/pdf',
}

test('signMediaUpload returns mock upload contracts by default', () => {
  const upload = signMediaUpload(asset, { now: new Date('2026-06-30T00:00:00.000Z'), source: {} })

  assert.equal(upload.provider, 'mock')
  assert.equal(upload.method, 'PUT')
  assert.equal(upload.headers['content-type'], 'application/pdf')
  assert.ok(upload.url.startsWith('mock://media/'))
  assert.equal(upload.expiresAt, '2026-06-30T00:15:00.000Z')
})

test('signMediaUpload builds S3-compatible presigned PUT URLs', () => {
  const upload = signMediaUpload(asset, {
    now: new Date('2026-06-30T00:00:00.000Z'),
    source: {
      STORAGE_DRIVER: 's3',
      STORAGE_ENDPOINT: 'https://storage.example.com',
      STORAGE_REGION: 'us-east-1',
      STORAGE_BUCKET: 'hcai-media',
      STORAGE_ACCESS_KEY_ID: 'access-key',
      STORAGE_SECRET_ACCESS_KEY: 'secret-key',
      STORAGE_UPLOAD_TTL_SECONDS: '600',
    },
  })
  const url = new URL(upload.url)

  assert.equal(upload.provider, 's3')
  assert.equal(upload.method, 'PUT')
  assert.equal(upload.headers['content-type'], 'application/pdf')
  assert.equal(url.origin, 'https://storage.example.com')
  assert.equal(url.pathname, '/hcai-media/taskops/task_attachment/media-1-brief.pdf')
  assert.equal(url.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256')
  assert.equal(url.searchParams.get('X-Amz-Credential'), 'access-key/20260630/us-east-1/s3/aws4_request')
  assert.equal(url.searchParams.get('X-Amz-Date'), '20260630T000000Z')
  assert.equal(url.searchParams.get('X-Amz-Expires'), '600')
  assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'content-type;host')
  assert.match(url.searchParams.get('X-Amz-Signature'), /^[a-f0-9]{64}$/)
  assert.equal(upload.expiresAt, '2026-06-30T00:10:00.000Z')
})

test('signMediaDownload builds private download contracts', () => {
  const mock = signMediaDownload(asset, { now: new Date('2026-06-30T00:00:00.000Z'), source: {} })
  assert.equal(mock.provider, 'mock')
  assert.equal(mock.method, 'GET')
  assert.ok(mock.url.includes('download=1'))
  assert.deepEqual(mock.headers, {})

  const s3 = signMediaDownload(asset, {
    now: new Date('2026-06-30T00:00:00.000Z'),
    source: {
      STORAGE_DRIVER: 's3',
      STORAGE_ENDPOINT: 'https://storage.example.com',
      STORAGE_REGION: 'us-east-1',
      STORAGE_BUCKET: 'hcai-media',
      STORAGE_ACCESS_KEY_ID: 'access-key',
      STORAGE_SECRET_ACCESS_KEY: 'secret-key',
    },
  })
  const url = new URL(s3.url)
  assert.equal(s3.provider, 's3')
  assert.equal(s3.method, 'GET')
  assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'host')
  assert.match(url.searchParams.get('X-Amz-Signature'), /^[a-f0-9]{64}$/)
})

test('buildStorageConfig requires S3 settings when explicitly enabled', () => {
  assert.throws(
    () => buildStorageConfig({ STORAGE_DRIVER: 's3', STORAGE_BUCKET: 'bucket' }),
    /STORAGE_ENDPOINT is required/,
  )
})
