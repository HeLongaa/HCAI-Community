import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import http from 'node:http'
import test from 'node:test'

import {
  buildVaultSecretLifecycleGatewayConfig,
  createVaultSecretLifecycleHandler,
  vaultSecretLifecycleGatewayContract,
} from './vaultSecretLifecycleGateway.js'

const bearerToken = 'gateway-bearer-token-0123456789'
const vaultToken = 'vault-service-token-0123456789'
const source = {
  SECRET_LIFECYCLE_VAULT_ADDR: 'https://vault.internal.test/',
  SECRET_LIFECYCLE_VAULT_KV_MOUNT: 'provider-secrets',
  SECRET_LIFECYCLE_VAULT_PATH_PREFIX: 'hcai/staging/providers',
  SECRET_LIFECYCLE_SECRET_REF_PREFIX: 'secret://vault/providers/',
  SECRET_LIFECYCLE_GATEWAY_BEARER_TOKEN_FILE: '/run/secrets/gateway-token',
  SECRET_LIFECYCLE_VAULT_TOKEN_FILE: '/run/secrets/vault-token',
}
const readFile = (file) => {
  if (file.endsWith('gateway-token')) return bearerToken
  if (file.endsWith('vault-token')) return vaultToken
  throw new Error('unexpected file')
}
const silentLogger = { info() {}, error() {} }

const listen = async (handler) => {
  const server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  }
}

const lifecyclePayload = (overrides = {}) => ({
  schemaVersion: 1,
  action: 'disable',
  secretRef: 'secret://vault/providers/router/chat',
  externalVersion: 'v2',
  requestedAt: '2026-08-08T00:00:00.000Z',
  ...overrides,
})
const targetHash = (payload) => {
  return createHash('sha256').update(`${payload.secretRef}:${payload.externalVersion}`).digest('hex')
}

const postLifecycle = (url, payload, options = {}) => {
  const hash = options.targetHash ?? targetHash(payload)
  return fetch(`${url}${vaultSecretLifecycleGatewayContract.lifecyclePath}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${options.bearerToken ?? bearerToken}`,
      'content-type': 'application/json',
      'idempotency-key': options.idempotencyKey ?? `secret-lifecycle:${payload.action}:${hash}`,
    },
    body: options.rawBody ?? JSON.stringify(payload),
  })
}

test('Vault lifecycle gateway soft-deletes and verifies the selected KV v2 version', async (t) => {
  const calls = []
  const handler = createVaultSecretLifecycleHandler({
    source, readFile, logger: silentLogger,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), method: options.method, headers: options.headers, body: options.body })
      if (String(url).includes('/metadata/')) return new Response(JSON.stringify({ data: { versions: { 2: { deletion_time: '2026-08-08T00:01:00Z', destroyed: false } } } }))
      return new Response(null, { status: 204 })
    },
  })
  const runtime = await listen(handler)
  t.after(runtime.close)
  const payload = lifecyclePayload()
  const response = await postLifecycle(runtime.url, payload)
  const result = await response.json()
  assert.equal(response.status, 200)
  assert.equal(result.status, 'completed')
  assert.equal(result.action, 'disable')
  assert.match(result.receiptId, /^vault-kv2-disable-[a-f0-9]{64}$/)
  assert.equal(calls[0].url, 'https://vault.internal.test/v1/provider-secrets/delete/hcai/staging/providers/router/chat')
  assert.deepEqual(JSON.parse(calls[0].body), { versions: [2] })
  assert.equal(calls[0].headers['x-vault-token'], vaultToken)
  assert.equal(calls[1].url, 'https://vault.internal.test/v1/provider-secrets/metadata/hcai/staging/providers/router/chat')
  assert.equal(JSON.stringify(result).includes(payload.secretRef), false)
  assert.equal(JSON.stringify(result).includes(vaultToken), false)
})

test('Vault lifecycle gateway destroys and verifies the selected KV v2 version', async (t) => {
  const calls = []
  const handler = createVaultSecretLifecycleHandler({
    source, readFile, logger: silentLogger,
    fetchImpl: async (url) => {
      calls.push(String(url))
      if (String(url).includes('/metadata/')) return new Response(JSON.stringify({ data: { versions: { 3: { deletion_time: '', destroyed: true } } } }))
      return new Response(null, { status: 204 })
    },
  })
  const runtime = await listen(handler)
  t.after(runtime.close)
  const payload = lifecyclePayload({ action: 'delete', externalVersion: '3' })
  const response = await postLifecycle(runtime.url, payload)
  assert.equal(response.status, 200)
  assert.match(calls[0], /\/destroy\//)
})

test('Vault lifecycle gateway rejects unauthenticated, unknown-field, traversal, and replay-key requests', async (t) => {
  let upstreamCalls = 0
  const handler = createVaultSecretLifecycleHandler({ source, readFile, logger: silentLogger, fetchImpl: async () => { upstreamCalls += 1; throw new Error('must not call') } })
  const runtime = await listen(handler)
  t.after(runtime.close)

  const unauthorized = await postLifecycle(runtime.url, lifecyclePayload(), { bearerToken: 'wrong-token-that-is-long-enough' })
  assert.equal(unauthorized.status, 401)
  const unknownFieldPayload = lifecyclePayload({ vaultToken: 'smuggled' })
  const unknownField = await postLifecycle(runtime.url, unknownFieldPayload)
  assert.equal(unknownField.status, 400)
  const traversalPayload = lifecyclePayload({ secretRef: 'secret://vault/providers/router/../root' })
  const traversal = await postLifecycle(runtime.url, traversalPayload)
  assert.equal(traversal.status, 403)
  const replayKey = await postLifecycle(runtime.url, lifecyclePayload(), { idempotencyKey: 'secret-lifecycle:disable:wrong' })
  assert.equal(replayKey.status, 409)
  assert.equal(upstreamCalls, 0)
})

test('Vault lifecycle gateway rejects oversized requests and unverified Vault state', async (t) => {
  const handler = createVaultSecretLifecycleHandler({
    source, readFile, logger: silentLogger,
    fetchImpl: async (url) => String(url).includes('/metadata/')
      ? new Response(JSON.stringify({ data: { versions: { 2: { deletion_time: '', destroyed: false } } } }))
      : new Response(null, { status: 204 }),
  })
  const runtime = await listen(handler)
  t.after(runtime.close)

  const payload = lifecyclePayload()
  const unverified = await postLifecycle(runtime.url, payload)
  assert.equal(unverified.status, 502)
  assert.deepEqual(await unverified.json(), { status: 'failed', code: 'upstream_failed' })

  const oversized = await fetch(`${runtime.url}/v1/lifecycle`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearerToken}`, 'content-type': 'application/json', 'content-length': String(vaultSecretLifecycleGatewayContract.maxBodyBytes + 1) },
    body: 'x'.repeat(vaultSecretLifecycleGatewayContract.maxBodyBytes + 1),
  })
  assert.equal(oversized.status, 413)
})

test('Vault lifecycle gateway configuration fails closed for unsafe origins and paths', () => {
  assert.throws(() => buildVaultSecretLifecycleGatewayConfig({ ...source, SECRET_LIFECYCLE_VAULT_ADDR: 'http://vault:8200/' }, { readFile }), /fixed HTTPS origin/)
  assert.throws(() => buildVaultSecretLifecycleGatewayConfig({ ...source, SECRET_LIFECYCLE_VAULT_PATH_PREFIX: '../root' }, { readFile }), /PATH_PREFIX/)
  assert.throws(() => buildVaultSecretLifecycleGatewayConfig({ ...source, SECRET_LIFECYCLE_GATEWAY_BEARER_TOKEN_FILE: 'relative/token' }, { readFile }), /absolute path/)
})
