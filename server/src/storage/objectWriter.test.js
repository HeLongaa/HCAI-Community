import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

import { writeStorageObject } from './objectWriter.js'

test('writeStorageObject returns mock storage metadata without external IO', async () => {
  const result = await writeStorageObject({
    body: '<svg />',
    contentType: 'image/svg+xml',
    storageKey: 'generated/image/test.svg',
  }, {
    now: new Date('2026-07-06T00:00:00.000Z'),
    source: {},
  })

  assert.equal(result.provider, 'mock')
  assert.equal(result.storageKey, 'generated/image/test.svg')
  assert.ok(result.url.startsWith('mock://media/'))
  assert.equal(result.bytes, 7)
  assert.equal(result.writtenAt, '2026-07-06T00:00:00.000Z')
})

test('writeStorageObject uploads through an S3-compatible signed PUT URL', async () => {
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
    const result = await writeStorageObject({
      body: '<svg />',
      contentType: 'image/svg+xml',
      storageKey: 'generated/image/test.svg',
    }, {
      now: new Date('2026-07-06T00:00:00.000Z'),
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
    assert.equal(result.storageKey, 'generated/image/test.svg')
    assert.equal(result.statusCode, 200)
    assert.equal(requests.length, 1)
    assert.equal(requests[0].method, 'PUT')
    assert.equal(requests[0].headers['content-type'], 'image/svg+xml')
    assert.equal(requests[0].body, '<svg />')
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
})
