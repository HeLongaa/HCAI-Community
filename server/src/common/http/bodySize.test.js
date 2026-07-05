import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'

import { createRouter } from './router.js'
import { createServer } from './server.js'
import { readJsonBody } from './request.js'
import { ok } from './responses.js'
import { listSecurityEvents, resetSecurityEvents } from '../../security/securityEvents.js'

const withProcessEnv = async (patch, run) => {
  const previous = Object.fromEntries(Object.keys(patch).map((key) => [key, process.env[key]]))
  resetSecurityEvents()
  try {
    for (const [key, value] of Object.entries(patch)) {
      if (value == null) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    return await run()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    resetSecurityEvents()
  }
}

const createBodySizeTestServer = async (context = {}) => {
  let handled = 0
  const router = createRouter()
  router.add('POST', '/api/echo', async (request, response) => {
    handled += 1
    ok(response, (await readJsonBody(request)) ?? {})
  })
  const server = createServer(router, context)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    url: `http://127.0.0.1:${port}`,
    handled: () => handled,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  }
}

const requestRaw = (baseUrl, path, body, headers = {}) => new Promise((resolve, reject) => {
  const url = new URL(path, baseUrl)
  const request = http.request({
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...headers,
    },
  }, (response) => {
    const chunks = []
    response.on('data', (chunk) => chunks.push(chunk))
    response.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      resolve({
        status: response.statusCode,
        headers: response.headers,
        payload: text ? JSON.parse(text) : null,
      })
    })
  })
  request.on('error', reject)
  request.end(body)
})

test('request body size guard rejects oversized content-length before route handling', async () => {
  await withProcessEnv({ REQUEST_BODY_MAX_BYTES: '24' }, async () => {
    const server = await createBodySizeTestServer()
    try {
      const body = JSON.stringify({ text: 'too large for the guard' })
      const response = await requestRaw(server.url, '/api/echo', body, {
        'content-length': Buffer.byteLength(body),
      })

      assert.equal(response.status, 413)
      assert.equal(response.payload.error.code, 'BODY_TOO_LARGE')
      assert.equal(response.payload.error.details.source, 'content-length')
      assert.equal(response.payload.error.details.limitBytes, 24)
      const securityEvents = listSecurityEvents({ source: 'body_size', limit: 10 })
      assert.ok(securityEvents.items.some((event) =>
        event.type === 'request.body_rejected' &&
        event.details.source === 'content-length' &&
        event.details.limitBytes === 24
      ))
      assert.equal(server.handled(), 0)
    } finally {
      await server.close()
    }
  })
})

test('request body reader rejects oversized chunked bodies without content-length', async () => {
  await withProcessEnv({ REQUEST_BODY_MAX_BYTES: '24' }, async () => {
    const server = await createBodySizeTestServer()
    try {
      const body = JSON.stringify({ text: 'chunked and too large' })
      const response = await requestRaw(server.url, '/api/echo', body, {
        'transfer-encoding': 'chunked',
      })

      assert.equal(response.status, 413)
      assert.equal(response.payload.error.code, 'BODY_TOO_LARGE')
      assert.equal(response.payload.error.details.source, 'stream')
      assert.equal(response.payload.error.details.limitBytes, 24)
      assert.equal(server.handled(), 1)
    } finally {
      await server.close()
    }
  })
})

test('request body size guard can be disabled for trusted internal deployments', async () => {
  await withProcessEnv({ REQUEST_BODY_SIZE_GUARD_ENABLED: 'false', REQUEST_BODY_MAX_BYTES: '24' }, async () => {
    const server = await createBodySizeTestServer()
    try {
      const body = JSON.stringify({ text: 'allowed because the guard is disabled' })
      const response = await requestRaw(server.url, '/api/echo', body, {
        'content-length': Buffer.byteLength(body),
      })

      assert.equal(response.status, 200)
      assert.equal(response.payload.data.text, 'allowed because the guard is disabled')
      assert.equal(server.handled(), 1)
    } finally {
      await server.close()
    }
  })
})

test('request body size guard emits rejected events for oversized content-length', async () => {
  await withProcessEnv({ REQUEST_BODY_MAX_BYTES: '24' }, async () => {
    const events = []
    const server = await createBodySizeTestServer({
      onRequestBodyRejected: (event) => events.push(event),
    })
    try {
      const body = JSON.stringify({ text: 'too large for the guard' })
      const response = await requestRaw(server.url, '/api/echo', body, {
        'content-length': Buffer.byteLength(body),
        'x-forwarded-for': '198.51.100.42',
      })

      assert.equal(response.status, 413)
      assert.equal(events.length, 1)
      assert.equal(events[0].method, 'POST')
      assert.equal(events[0].pathname, '/api/echo')
      assert.equal(events[0].clientKey, '198.51.100.42')
      assert.equal(events[0].limitBytes, 24)
      assert.equal(events[0].contentLengthBytes, Buffer.byteLength(body))
      assert.equal(events[0].receivedBytes, null)
      assert.equal(events[0].source, 'content-length')
    } finally {
      await server.close()
    }
  })
})

test('request body rejected observer failures remain non-fatal', async () => {
  await withProcessEnv({ REQUEST_BODY_MAX_BYTES: '24' }, async () => {
    const server = await createBodySizeTestServer({
      onRequestBodyRejected: () => {
        throw new Error('metrics sink unavailable')
      },
    })
    try {
      const body = JSON.stringify({ text: 'chunked and too large' })
      const response = await requestRaw(server.url, '/api/echo', body, {
        'transfer-encoding': 'chunked',
      })

      assert.equal(response.status, 413)
      assert.equal(response.payload.error.code, 'BODY_TOO_LARGE')
      assert.equal(response.payload.error.details.source, 'stream')
    } finally {
      await server.close()
    }
  })
})
