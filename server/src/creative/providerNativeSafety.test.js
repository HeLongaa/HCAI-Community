import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertProviderNativeSafety,
  buildProviderNativeSafety,
  providerNativeSafetyForGeneration,
} from './providerNativeSafety.js'

const provider = {
  id: 'provider-test',
  safeMetadata: { providerNativeSafetyRequired: true },
}

test('Provider native safety maps lifecycle and terminal states to a closed evidence contract', () => {
  assert.equal(providerNativeSafetyForGeneration({ providerId: provider.id, status: 'queued' }).outcome, 'provider_pending')
  assert.equal(providerNativeSafetyForGeneration({ providerId: provider.id, status: 'completed' }).outcome, 'provider_allowed')
  assert.equal(providerNativeSafetyForGeneration({ providerId: provider.id, status: 'failed', providerCategory: 'content_policy' }).outcome, 'provider_refused')
  assert.equal(providerNativeSafetyForGeneration({ providerId: provider.id, status: 'failed', providerCategory: 'provider_5xx' }).outcome, 'provider_unknown')
  assert.throws(
    () => buildProviderNativeSafety({ providerId: provider.id, outcome: 'allow', signal: 'raw_provider_message' }),
    { code: 'CREATIVE_PROVIDER_SAFETY_CONTRACT_FAILED' },
  )
})

test('Provider adapter safety fails closed when evidence is missing or inconsistent with generation state', () => {
  const completed = {
    status: 'completed',
    safety: { providerNative: providerNativeSafetyForGeneration({ providerId: provider.id, status: 'completed' }) },
  }
  assert.doesNotThrow(() => assertProviderNativeSafety(completed, provider))
  assert.throws(
    () => assertProviderNativeSafety({ status: 'completed', safety: {} }, provider),
    { code: 'CREATIVE_PROVIDER_SAFETY_CONTRACT_FAILED' },
  )
  assert.throws(
    () => assertProviderNativeSafety({
      status: 'completed',
      safety: { providerNative: providerNativeSafetyForGeneration({ providerId: provider.id, status: 'queued' }) },
    }, provider),
    { code: 'CREATIVE_PROVIDER_SAFETY_CONTRACT_FAILED' },
  )
})
