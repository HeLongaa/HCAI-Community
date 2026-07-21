import assert from 'node:assert/strict'
import test from 'node:test'

import { createChatRuntime } from './chatRuntime.js'
import { attachProductionRuntimeApproval } from '../common/runtime/productionApproval.js'

const stagingSource = {
  NODE_ENV: 'production',
  CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
  CHAT_PROVIDER_MODE: 'openai_staging',
  CHAT_OPENAI_HTTP_CLIENT_ENABLED: 'true',
  CHAT_OPENAI_NETWORK_CALLS_ENABLED: 'true',
  CHAT_OPENAI_SAFETY_CLASSIFIER_ENABLED: 'true',
  CHAT_OPENAI_CONFIRMATION: 'staging-only',
  CHAT_OPENAI_API_TOKEN: 'fixture-token',
}

test('Chat runtime defaults to Mock and disabled mode fails closed', async () => {
  assert.deepEqual(createChatRuntime({ source: {} }), { mode: 'mock' })
  const disabled = createChatRuntime({ source: { CHAT_PROVIDER_MODE: 'disabled' } })
  assert.equal(disabled.mode, 'disabled')
  await assert.rejects(disabled.streamAdapter(), (error) => error.code === 'CHAT_PROVIDER_DISABLED')
  await assert.rejects(disabled.inputSafetyClassifier(), (error) => error.code === 'CHAT_PROVIDER_DISABLED')
})

test('OpenAI staging runtime is constructed with injected transport without dispatching it', () => {
  let calls = 0
  const runtime = createChatRuntime({ source: stagingSource, fetchImpl: async () => { calls += 1 } })
  assert.equal(runtime.mode, 'openai_staging')
  assert.equal(runtime.generationProvider.id, 'openai-gpt-5-6-terra')
  assert.equal(typeof runtime.providerCostPlanner, 'function')
  assert.equal(typeof runtime.streamAdapter, 'function')
  assert.equal(typeof runtime.inputSafetyClassifier, 'function')
  assert.equal(calls, 0)
})

test('database-approved production runtime is distinct from staging and constructs without dispatch', () => {
  let calls = 0
  const source = attachProductionRuntimeApproval({
    ...stagingSource,
    CREATIVE_PROVIDER_RUNTIME_ENV: 'production',
    CHAT_PROVIDER_MODE: 'openai_production',
    CHAT_OPENAI_CONFIRMATION: 'database-approved',
  }, {
    environment: 'production', decisionId: 'decision-1', routePolicyId: 'route-1', deploymentId: 'deployment-1', secretRefId: 'secret-1',
  })
  const runtime = createChatRuntime({ source, fetchImpl: async () => { calls += 1 } })
  assert.equal(runtime.mode, 'openai_production')
  assert.equal(calls, 0)
})
