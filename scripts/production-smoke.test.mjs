import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { inspectDurableSecurityAlertDelivery, inspectProductionWorkers, productionWorkerRequirements } from './lib/production-smoke.mjs'
import { inspectProtectedRuntimeConfiguration } from './lib/protected-runtime-smoke.mjs'

test('production smoke requires every declared core and retention worker', () => {
  const enabled = Object.fromEntries(productionWorkerRequirements.map(({ key }) => [key, true]))
  enabled.creativeProviderAlertsEnabled = true
  enabled.notificationEmailDeliveryEnabled = true
  enabled.mediaScanProvider = 'webhook'
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
  baseline.notificationEmailDeliveryEnabled = true
  baseline.mediaScanProvider = 'webhook'
  for (const requirement of productionWorkerRequirements) {
    const checks = inspectProductionWorkers({ ...baseline, [requirement.key]: false })
    assert.deepEqual(checks.filter(({ enabled }) => !enabled).map(({ variable }) => variable), [requirement.variable])
  }
  assert.equal(inspectProductionWorkers({
    ...Object.fromEntries(productionWorkerRequirements.map(({ key }) => [key, 'true'])),
    creativeProviderAlertsEnabled: true,
    notificationEmailDeliveryEnabled: true,
    mediaScanProvider: 'webhook',
  }).every(({ enabled }) => !enabled), true)
})

test('Provider alert worker is required only when its delivery feature is enabled', () => {
  const baseline = Object.fromEntries(productionWorkerRequirements.map(({ key }) => [key, true]))
  const disabled = inspectProductionWorkers({ ...baseline, creativeProviderAlertsEnabled: false, creativeProviderAlertDeliveryWorkerEnabled: false })
  assert.equal(disabled.find(({ key }) => key === 'creativeProviderAlertDeliveryWorkerEnabled').enabled, true)
  const enabled = inspectProductionWorkers({ ...baseline, creativeProviderAlertsEnabled: true, creativeProviderAlertDeliveryWorkerEnabled: false })
  assert.equal(enabled.find(({ key }) => key === 'creativeProviderAlertDeliveryWorkerEnabled').enabled, false)
})

test('scanner and notification workers are required only when their external delivery modes are enabled', () => {
  const baseline = Object.fromEntries(productionWorkerRequirements.map(({ key }) => [key, true]))
  baseline.mediaScanWorkerEnabled = false
  baseline.notificationDeliveryWorkerEnabled = false
  const disabled = inspectProductionWorkers({ ...baseline, mediaScanProvider: 'manual', notificationEmailDeliveryEnabled: false })
  assert.equal(disabled.find(({ key }) => key === 'mediaScanWorkerEnabled').enabled, true)
  assert.equal(disabled.find(({ key }) => key === 'notificationDeliveryWorkerEnabled').enabled, true)
  const enabled = inspectProductionWorkers({ ...baseline, mediaScanProvider: 'webhook', notificationEmailDeliveryEnabled: true })
  assert.equal(enabled.find(({ key }) => key === 'mediaScanWorkerEnabled').enabled, false)
  assert.equal(enabled.find(({ key }) => key === 'notificationDeliveryWorkerEnabled').enabled, false)
})

test('security alert release delivery requires the durable notification email queue', () => {
  assert.deepEqual(inspectDurableSecurityAlertDelivery({
    notificationEmailDeliveryEnabled: true,
    hasNotificationEmailWebhookUrl: true,
    hasNotificationEmailWebhookSecret: true,
    hasNotificationEmailFrom: true,
    notificationEmailProviderReceiptRequired: true,
    notificationDeliveryWorkerEnabled: true,
    hasSecurityAlertWebhookUrl: false,
  }), {
    ready: true,
    emailEnabled: true,
    emailEndpointConfigured: true,
    emailSigningConfigured: true,
    emailSenderConfigured: true,
    providerReceiptRequired: true,
    workerEnabled: true,
  })
  for (const incomplete of [
    { notificationEmailDeliveryEnabled: false, hasNotificationEmailWebhookUrl: true, hasNotificationEmailWebhookSecret: true, hasNotificationEmailFrom: true, notificationEmailProviderReceiptRequired: true, notificationDeliveryWorkerEnabled: true },
    { notificationEmailDeliveryEnabled: true, hasNotificationEmailWebhookUrl: false, hasNotificationEmailWebhookSecret: true, hasNotificationEmailFrom: true, notificationEmailProviderReceiptRequired: true, notificationDeliveryWorkerEnabled: true },
    { notificationEmailDeliveryEnabled: true, hasNotificationEmailWebhookUrl: true, hasNotificationEmailWebhookSecret: false, hasNotificationEmailFrom: true, notificationEmailProviderReceiptRequired: true, notificationDeliveryWorkerEnabled: true },
    { notificationEmailDeliveryEnabled: true, hasNotificationEmailWebhookUrl: true, hasNotificationEmailWebhookSecret: true, hasNotificationEmailFrom: false, notificationEmailProviderReceiptRequired: true, notificationDeliveryWorkerEnabled: true },
    { notificationEmailDeliveryEnabled: true, hasNotificationEmailWebhookUrl: true, hasNotificationEmailWebhookSecret: true, hasNotificationEmailFrom: true, notificationEmailProviderReceiptRequired: false, notificationDeliveryWorkerEnabled: true },
    { notificationEmailDeliveryEnabled: true, hasNotificationEmailWebhookUrl: true, hasNotificationEmailWebhookSecret: true, hasNotificationEmailFrom: true, notificationEmailProviderReceiptRequired: true, notificationDeliveryWorkerEnabled: false },
    { hasSecurityAlertWebhookUrl: true, hasSecurityAlertSlackWebhookUrl: true, securityAlertEmailRecipientCount: 1 },
  ]) {
    assert.equal(inspectDurableSecurityAlertDelivery(incomplete).ready, false)
  }
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

test('deployment environment job passes every fixture setting and default-off runtime switch', () => {
  const smokeSource = fs.readFileSync(new URL('./smoke-production.mjs', import.meta.url), 'utf8')
  const workflowSource = fs.readFileSync(new URL('../.github/workflows/quality-gates.yml', import.meta.url), 'utf8')
  const fixtureBlock = smokeSource.match(/const productionFixture = \{([\s\S]*?)\n\}/)?.[1] ?? ''
  const fixtureKeys = [...fixtureBlock.matchAll(/^  ([A-Z][A-Z0-9_]*):/gm)].map((match) => match[1])
  const defaultOffBoundaryKeys = [
    'DEPLOYMENT_ENV',
    'DATABASE_URL',
    'SECRET_MANAGER_PROVIDER',
    'CREATIVE_PROVIDER_HTTP_CLIENT_ENABLED',
    'CREATIVE_PROVIDER_CALLBACK_ENABLED',
    'CREATIVE_PROVIDER_POLLING_ENABLED',
    'CREATIVE_PROVIDER_POLLING_WORKER_ENABLED',
    'CREATIVE_ROUTER_VIDEO_LIFECYCLE_ENABLED',
    'CREATIVE_ROUTER_VIDEO_LIFECYCLE_WORKER_ENABLED',
    'CHAT_PROVIDER_MODE',
    'CHAT_OPENAI_HTTP_CLIENT_ENABLED',
    'CHAT_OPENAI_NETWORK_CALLS_ENABLED',
    'CHAT_OPENAI_SAFETY_CLASSIFIER_ENABLED',
    'CHAT_ATTACHMENT_BYTES_ENABLED',
  ]
  const deploymentJob = workflowSource.match(/  deployment-env-smoke:([\s\S]*?)\n  infrastructure-rehearsal:/)?.[1] ?? ''

  for (const key of [...new Set([...fixtureKeys, ...defaultOffBoundaryKeys])]) {
    if (key === 'NODE_ENV') {
      assert.match(deploymentJob, /^      NODE_ENV: production$/m)
      continue
    }
    assert.match(deploymentJob, new RegExp(`^      ${key}: \\\$(?:\\{\\{) (?:vars|secrets)\\.${key} (?:\\}\\})$`, 'm'), `${key} must be passed through by deployment-env-smoke`)
  }
})
