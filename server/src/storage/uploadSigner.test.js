import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildStorageConfig,
  normalizeStorageChecksumSha256,
  signMediaDownload,
  signMediaObjectDelete,
  signMediaObjectHead,
  signMediaScannerDownload,
  signMediaUpload,
} from './uploadSigner.js'

const asset = {
  storageKey: 'taskops/task_attachment/media-1-brief.pdf',
  contentType: 'application/pdf',
  sizeBytes: 2048,
  checksumSha256: 'a'.repeat(64),
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
  assert.equal(upload.headers['content-length'], '2048')
  assert.equal(upload.headers['x-amz-checksum-sha256'], Buffer.from('a'.repeat(64), 'hex').toString('base64'))
  assert.equal(url.origin, 'https://storage.example.com')
  assert.equal(url.pathname, '/hcai-media/taskops/task_attachment/media-1-brief.pdf')
  assert.equal(url.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256')
  assert.equal(url.searchParams.get('X-Amz-Credential'), 'access-key/20260630/us-east-1/s3/aws4_request')
  assert.equal(url.searchParams.get('X-Amz-Date'), '20260630T000000Z')
  assert.equal(url.searchParams.get('X-Amz-Expires'), '600')
  assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'content-length;content-type;host;x-amz-checksum-sha256')
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

test('storage operation contracts use bounded purpose-specific TTLs', () => {
  const source = {
    STORAGE_DRIVER: 's3',
    STORAGE_ENDPOINT: 'https://storage.example.com',
    STORAGE_REGION: 'us-east-1',
    STORAGE_BUCKET: 'hcai-media',
    STORAGE_ACCESS_KEY_ID: 'access-key',
    STORAGE_SECRET_ACCESS_KEY: 'secret-key',
    STORAGE_DOWNLOAD_TTL_SECONDS: '120',
    STORAGE_SCANNER_READ_TTL_SECONDS: '240',
  }
  const now = new Date('2026-06-30T00:00:00.000Z')
  const download = signMediaDownload(asset, { now, source })
  const scanner = signMediaScannerDownload(asset, { now, source })
  const head = signMediaObjectHead(asset, { now, source })
  const deletion = signMediaObjectDelete(asset, { now, source })

  assert.equal(new URL(download.url).searchParams.get('X-Amz-Expires'), '120')
  assert.equal(new URL(scanner.url).searchParams.get('X-Amz-Expires'), '240')
  assert.equal(head.method, 'HEAD')
  assert.equal(head.headers['x-amz-checksum-mode'], 'ENABLED')
  assert.equal(new URL(head.url).searchParams.get('X-Amz-SignedHeaders'), 'host;x-amz-checksum-mode')
  assert.equal(deletion.method, 'DELETE')
})

test('storage checksums normalize hex and base64 digests', () => {
  const hex = 'b'.repeat(64)
  assert.equal(normalizeStorageChecksumSha256(hex.toUpperCase()), hex)
  assert.equal(normalizeStorageChecksumSha256(Buffer.from(hex, 'hex').toString('base64')), hex)
  assert.throws(() => normalizeStorageChecksumSha256('invalid'), /checksumSha256/)
})

test('signMediaDownload emits a short-lived private CDN contract when configured', () => {
  const download = signMediaDownload(asset, {
    now: new Date('2026-06-30T00:00:00.000Z'),
    source: {
      STORAGE_PRIVATE_DOWNLOAD_BASE_URL: 'https://cdn.example.com/private',
      STORAGE_PRIVATE_DOWNLOAD_SIGNING_SECRET: 'cdn-secret',
      STORAGE_PRIVATE_DOWNLOAD_KEY_ID: 'rotation-2',
      STORAGE_DOWNLOAD_TTL_SECONDS: '90',
    },
  })
  const url = new URL(download.url)
  assert.equal(download.provider, 'private-cdn')
  assert.equal(url.origin, 'https://cdn.example.com')
  assert.equal(url.pathname, '/private/taskops/task_attachment/media-1-brief.pdf')
  assert.equal(url.searchParams.get('expires'), String(Date.parse('2026-06-30T00:01:30.000Z') / 1000))
  assert.equal(url.searchParams.get('keyId'), 'rotation-2')
  assert.match(url.searchParams.get('signature'), /^[A-Za-z0-9_-]{43}$/)
  assert.equal(download.expiresAt, '2026-06-30T00:01:30.000Z')
})
