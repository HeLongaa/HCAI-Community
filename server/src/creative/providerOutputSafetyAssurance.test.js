import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertProviderOutputSafetyAssurance,
  buildProviderOutputSafetyAssurance,
} from './providerOutputSafetyAssurance.js'

const base = {
  providerId: 'hcai-router-minimax-video',
  operationRef: 'video-task:01J8S7T2',
  policyRef: 'minimax-content-policy:2026-08',
  source: 'provider_response',
  attestedAt: new Date('2026-08-08T08:00:00.000Z'),
}

test('Provider output assurance persists only bounded references and a stable evidence hash', () => {
  const first = buildProviderOutputSafetyAssurance({
    ...base,
    evidence: { decision: 'allow', checks: ['output-policy'], requestId: 'provider-request-1' },
  })
  const second = buildProviderOutputSafetyAssurance({
    ...base,
    evidence: { requestId: 'provider-request-1', checks: ['output-policy'], decision: 'allow' },
  })

  assert.equal(first.evidenceHash, second.evidenceHash)
  assert.equal(first.evidenceHash.length, 64)
  assert.equal(JSON.stringify(first).includes('provider-request-1'), false)
  assert.equal(assertProviderOutputSafetyAssurance({
    assurance: first,
    providerId: base.providerId,
    operationRef: base.operationRef,
    deploymentEnv: 'production',
  }), true)
})

test('Production rejects operator proof while Staging can retain it for rehearsal', () => {
  const assurance = buildProviderOutputSafetyAssurance({
    ...base,
    source: 'operator_staging',
    evidence: { decision: 'allow', ticketRef: 'staging-rehearsal-42' },
  })

  assert.equal(assertProviderOutputSafetyAssurance({
    assurance,
    providerId: base.providerId,
    operationRef: base.operationRef,
    deploymentEnv: 'staging',
  }), true)
  assert.throws(
    () => assertProviderOutputSafetyAssurance({
      assurance,
      providerId: base.providerId,
      operationRef: base.operationRef,
      deploymentEnv: 'production',
    }),
    { code: 'CREATIVE_PROVIDER_SAFETY_ASSURANCE_INVALID' },
  )
  assert.throws(
    () => assertProviderOutputSafetyAssurance({
      assurance,
      providerId: base.providerId,
      operationRef: base.operationRef,
    }),
    { code: 'CREATIVE_PROVIDER_SAFETY_ASSURANCE_INVALID' },
  )
})

test('Assurance fails closed for mismatched operations and malformed or unbounded evidence', () => {
  const assurance = buildProviderOutputSafetyAssurance({ ...base, evidence: { decision: 'allow' } })
  assert.throws(
    () => assertProviderOutputSafetyAssurance({
      assurance,
      providerId: base.providerId,
      operationRef: 'video-task:different',
      deploymentEnv: 'staging',
    }),
    { code: 'CREATIVE_PROVIDER_SAFETY_ASSURANCE_INVALID' },
  )
  assert.throws(
    () => buildProviderOutputSafetyAssurance({ ...base, evidence: {} }),
    { code: 'CREATIVE_PROVIDER_SAFETY_ASSURANCE_INVALID' },
  )
  assert.throws(
    () => buildProviderOutputSafetyAssurance({ ...base, evidence: { payload: 'x'.repeat(65 * 1024) } }),
    { code: 'CREATIVE_PROVIDER_SAFETY_ASSURANCE_INVALID' },
  )
})
