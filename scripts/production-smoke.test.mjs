import assert from 'node:assert/strict'
import test from 'node:test'

import { inspectProductionWorkers, productionWorkerRequirements } from './lib/production-smoke.mjs'
import { inspectProtectedRuntimeConfiguration } from './lib/protected-runtime-smoke.mjs'

test('production smoke requires every declared core and retention worker', () => {
  const enabled = Object.fromEntries(productionWorkerRequirements.map(({ key }) => [key, true]))
  enabled.creativeProviderAlertsEnabled = true
  const checks = inspectProductionWorkers(enabled)
  assert.equal(checks.length, 29)
  assert.equal(checks.filter(({ group }) => group === 'core').length, 9)
  assert.equal(checks.filter(({ group }) => group === 'retention').length, 20)
  assert.equal(checks.every(({ enabled: pass }) => pass), true)
  assert.equal(productionWorkerRequirements.some(({ key }) => key === 'creativeProviderPollingWorkerEnabled'), false)
})

test('production smoke identifies each disabled worker without accepting truthy strings', () => {
  const baseline = Object.fromEntries(productionWorkerRequirements.map(({ key }) => [key, true]))
  baseline.creativeProviderAlertsEnabled = true
  for (const requirement of productionWorkerRequirements) {
    const checks = inspectProductionWorkers({ ...baseline, [requirement.key]: false })
    assert.deepEqual(checks.filter(({ enabled }) => !enabled).map(({ variable }) => variable), [requirement.variable])
  }
  assert.equal(inspectProductionWorkers({ ...Object.fromEntries(productionWorkerRequirements.map(({ key }) => [key, 'true'])), creativeProviderAlertsEnabled: true }).every(({ enabled }) => !enabled), true)
})

test('Provider alert worker is required only when its delivery feature is enabled', () => {
  const baseline = Object.fromEntries(productionWorkerRequirements.map(({ key }) => [key, true]))
  const disabled = inspectProductionWorkers({ ...baseline, creativeProviderAlertsEnabled: false, creativeProviderAlertDeliveryWorkerEnabled: false })
  assert.equal(disabled.find(({ key }) => key === 'creativeProviderAlertDeliveryWorkerEnabled').enabled, true)
  const enabled = inspectProductionWorkers({ ...baseline, creativeProviderAlertsEnabled: true, creativeProviderAlertDeliveryWorkerEnabled: false })
  assert.equal(enabled.find(({ key }) => key === 'creativeProviderAlertDeliveryWorkerEnabled').enabled, false)
})

test('protected runtime smoke accumulates independent failures without exposing configuration values', () => {
  const exposedValues = ['chat-key-material', 'chat-provider-token', 'provider-deletion-token']
  const result = inspectProtectedRuntimeConfiguration(
    {
      CHAT_MESSAGE_ENCRYPTION_KEY: exposedValues[0],
      CHAT_OPENAI_API_TOKEN: exposedValues[1],
      DATA_RIGHTS_PROVIDER_DELETION_GATEWAY_TOKEN: exposedValues[2],
    },
    {
      buildChatEncryption: () => { throw new Error(`invalid ${exposedValues[0]}`) },
      buildChatRuntime: () => { throw new Error(`invalid ${exposedValues[1]}`) },
      buildProviderDeletionGateway: () => {
        const error = new Error(`invalid ${exposedValues[2]}`)
        error.code = 'DATA_RIGHTS_PROVIDER_DELETION_CONFIGURATION_INVALID'
        throw error
      },
    },
  )

  assert.deepEqual(result.checks.map(({ name, pass }) => ({ name, pass })), [
    { name: 'Chat message encryption configured', pass: false },
    { name: 'Chat runtime configuration valid', pass: false },
    { name: 'external Provider deletion gateway configured', pass: false },
  ])
  const diagnostics = JSON.stringify(result.checks)
  for (const value of exposedValues) assert.equal(diagnostics.includes(value), false)
  assert.match(diagnostics, /DATA_RIGHTS_PROVIDER_DELETION_CONFIGURATION_INVALID/)
  assert.equal(result.chatEncryption.configured, false)
  assert.equal(result.chatRuntime.mode, 'invalid')
  assert.equal(result.providerDeletionGatewayConfigured, false)
})

test('protected runtime smoke accepts independently valid configurations', () => {
  const result = inspectProtectedRuntimeConfiguration(
    {},
    {
      buildChatEncryption: () => ({ configured: true, activeKeyId: 'v1', keys: new Map([['v1', Buffer.alloc(32)]]) }),
      buildChatRuntime: () => ({ mode: 'disabled' }),
      buildProviderDeletionGateway: () => ({ endpoint: 'https://privacy.example.test/', token: 'not-returned-by-summary' }),
    },
  )

  assert.equal(result.checks.every(({ pass }) => pass), true)
  assert.equal(result.providerDeletionGatewayConfigured, true)
})
