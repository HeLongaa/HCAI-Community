import assert from 'node:assert/strict'
import test from 'node:test'

import { configureEnvironmentProxy } from './environmentProxy.js'

test('environment proxy stays disabled unless explicitly enabled', () => {
  let configured = false
  assert.equal(configureEnvironmentProxy({}, { setGlobalProxyFromEnv: () => { configured = true } }), false)
  assert.equal(configured, false)
})

test('environment proxy passes the deployment proxy allowlist to Node', () => {
  const source = {
    NODE_USE_ENV_PROXY: '1',
    HTTPS_PROXY: 'http://proxy.example.com:8080',
    NO_PROXY: '127.0.0.1,localhost',
  }
  let received = null
  assert.equal(configureEnvironmentProxy(source, { setGlobalProxyFromEnv: (value) => { received = value } }), true)
  assert.equal(received, source)
})

test('environment proxy fails clearly on unsupported Node runtimes', () => {
  assert.throws(
    () => configureEnvironmentProxy({ NODE_USE_ENV_PROXY: '1' }, {}),
    /setGlobalProxyFromEnv support/,
  )
})
