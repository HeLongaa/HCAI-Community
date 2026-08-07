import assert from 'node:assert/strict'
import test from 'node:test'

import { inspectProductionWorkers, productionWorkerRequirements } from './lib/production-smoke.mjs'

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
