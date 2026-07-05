import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

import { writeJsonArchive } from './archiveWriter.js'

test('writeJsonArchive returns a mock storage result by default', async () => {
  const result = await writeJsonArchive({ ok: true }, {
    now: new Date('2026-07-02T00:00:00.000Z'),
    source: {},
  })

  assert.equal(result.provider, 'mock')
  assert.ok(result.storageKey.startsWith('archives/media-scan-jobs/2026-07-02/manifest-'))
  assert.ok(result.url.startsWith('mock://media/'))
  assert.equal(result.bytes, 16)
  assert.equal(result.writtenAt, '2026-07-02T00:00:00.000Z')
})

test('writeJsonArchive uploads JSON through an S3-compatible presigned PUT URL', async () => {
  const requests = []
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      requests.push({ method: request.method, url: request.url, headers: request.headers, body })
      response.writeHead(200)
      response.end('ok')
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    const result = await writeJsonArchive({ ok: true }, {
      now: new Date('2026-07-02T00:00:00.000Z'),
      storageKey: 'archives/test.json',
      source: {
        STORAGE_DRIVER: 's3',
        STORAGE_ENDPOINT: `http://127.0.0.1:${port}`,
        STORAGE_REGION: 'us-east-1',
        STORAGE_BUCKET: 'media',
        STORAGE_ACCESS_KEY_ID: 'access-key',
        STORAGE_SECRET_ACCESS_KEY: 'secret-key',
      },
    })

    assert.equal(result.provider, 's3')
    assert.equal(result.storageKey, 'archives/test.json')
    assert.equal(result.statusCode, 200)
    assert.equal(requests.length, 1)
    assert.equal(requests[0].method, 'PUT')
    assert.equal(requests[0].url?.startsWith('/media/archives/test.json?X-Amz-Algorithm=AWS4-HMAC-SHA256'), true)
    assert.equal(requests[0].headers['content-type'], 'application/json')
    assert.equal(requests[0].body, '{\n  "ok": true\n}')
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
})
