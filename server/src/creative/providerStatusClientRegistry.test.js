import assert from 'node:assert/strict'
import test from 'node:test'

import { createProviderPollingStatusClients } from './providerStatusClientRegistry.js'

const enabledSource = {
  NODE_ENV: 'production',
  ACCESS_TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
  CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
  CREATIVE_PROVIDER_MODE: 'replicate_staging',
  CREATIVE_STAGING_IMAGE_PROVIDER: 'replicate',
  CREATIVE_STAGING_PROVIDER_API_TOKEN: 'replicate-fixture-token',
  CREATIVE_STAGING_PROVIDER_CONFIRMATION: 'staging-only',
  CREATIVE_PROVIDER_HTTP_CLIENT_ENABLED: 'true',
  CREATIVE_PROVIDER_POLLING_ENABLED: 'true',
  CREATIVE_PROVIDER_POLLING_WORKER_ENABLED: 'true',
}

test('createProviderPollingStatusClients returns no clients while polling is disabled', () => {
  let fetchCalls = 0
  const clients = createProviderPollingStatusClients({
    source: {},
    fetchImpl: async () => {
      fetchCalls += 1
      throw new Error('network must remain disabled')
    },
  })

  assert.deepEqual(clients, {})
  assert.equal(fetchCalls, 0)
})

test('createProviderPollingStatusClients exposes only the guarded Replicate status client', async () => {
  const calls = []
  const clients = createProviderPollingStatusClients({
    source: enabledSource,
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return new Response(JSON.stringify({
        id: 'pred_registry_1',
        status: 'processing',
        input: { prompt: 'private full prompt' },
      }), { status: 200 })
    },
  })

  assert.deepEqual(Object.keys(clients), ['replicate'])
  assert.equal(clients.replicate.createPrediction, undefined)
  assert.deepEqual(await clients.replicate.getPrediction('pred_registry_1'), {
    id: 'pred_registry_1',
    status: 'processing',
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.replicate.com/v1/predictions/pred_registry_1')
})
