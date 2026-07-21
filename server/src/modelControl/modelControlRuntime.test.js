import assert from 'node:assert/strict'
import test from 'node:test'

import { parseDeploymentCreate } from './modelControlRuntime.js'

const base = { modelVersionId: 'version-1', key: 'image-staging', environment: 'staging', region: 'us', deploymentRef: 'router-staging' }

test('deployment runtime configuration accepts only safe adapter metadata', () => {
  const parsed = parseDeploymentCreate({ ...base, adapterType: 'openai_image', providerModelId: 'gpt-image-2', endpointUrl: 'https://router.example/v1', secretPurpose: 'inference', runtimeConfig: { requestFormat: 'openai' }, runtimeEnabled: true }, { handle: 'admin' })
  assert.equal(parsed.endpointUrl, 'https://router.example/v1')
  assert.equal(parsed.runtimeEnabled, true)
  assert.deepEqual(parsed.runtimeConfig, { requestFormat: 'openai' })
})

test('deployment runtime configuration rejects credentials and unsafe endpoints', () => {
  assert.throws(() => parseDeploymentCreate({ ...base, adapterType: 'openai_image', providerModelId: 'gpt-image-2', endpointUrl: 'https://user:pass@router.example/v1', secretPurpose: 'inference', runtimeEnabled: true }), /safe HTTPS URL/)
  assert.throws(() => parseDeploymentCreate({ ...base, adapterType: 'openai_image', providerModelId: 'gpt-image-2', endpointUrl: 'https://router.example/v1', secretPurpose: 'inference', runtimeConfig: { apiToken: 'inline' }, runtimeEnabled: true }), /cannot contain credentials/)
  assert.throws(() => parseDeploymentCreate({ ...base, runtimeEnabled: 'false' }), /must be a boolean/)
})

test('chat deployment accepts only supported safety response formats', () => {
  const chat = { ...base, adapterType: 'openai_chat', providerModelId: 'gpt-5.6-terra', endpointUrl: 'https://router.example/v1', secretPurpose: 'inference', runtimeEnabled: true }
  assert.deepEqual(parseDeploymentCreate({ ...chat, runtimeConfig: { safetyResponseFormat: 'text' } }, { handle: 'admin' }).runtimeConfig, { safetyResponseFormat: 'text' })
  assert.throws(
    () => parseDeploymentCreate({ ...chat, runtimeConfig: { safetyResponseFormat: 'json_object' } }, { handle: 'admin' }),
    /must be one of: json_schema, text/,
  )
  assert.deepEqual(
    parseDeploymentCreate({ ...chat, runtimeConfig: { apiDialect: 'chat_completions', safetyResponseFormat: 'text' } }, { handle: 'admin' }).runtimeConfig,
    { apiDialect: 'chat_completions', safetyResponseFormat: 'text' },
  )
  assert.throws(
    () => parseDeploymentCreate({ ...chat, runtimeConfig: { apiDialect: 'legacy' } }, { handle: 'admin' }),
    /must be one of: responses, chat_completions/,
  )
})
