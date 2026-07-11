import assert from 'node:assert/strict'
import test from 'node:test'

import providerMatrix from '../../../config/v1-provider-matrix.json' with { type: 'json' }
import {
  buildProviderControlScopes,
  classifyProviderFailure,
  createProviderCapEvidence,
  evaluateProviderControlSnapshot,
  providerCircuitPolicyFor,
  providerCircuitScope,
  validateProviderCapEvidence,
} from './providerControlContract.js'

const now = new Date('2026-07-12T10:00:00.000Z')
const scopes = buildProviderControlScopes({
  providerId: 'replicate',
  providerAccountRef: 'staging',
  workspace: 'image',
  modelFamily: 'flux',
})
const capEvidence = createProviderCapEvidence({
  sourceKey: 'cap-fixture-image-v1',
  scopeKey: scopes[1].scopeKey,
  providerId: 'replicate',
  providerAccountRef: 'staging',
  currency: 'USD',
  capAmount: '5',
  remainingAmount: '1',
  sourceType: 'fixture_config',
  sourceRef: 'fixture:replicate:image:v1',
  verifiedAt: '2026-07-12T09:00:00.000Z',
  expiresAt: '2026-07-12T11:00:00.000Z',
})

test('provider control scopes are ordered from global to model family', () => {
  assert.deepEqual(scopes.map((scope) => scope.scopeType), ['global', 'provider', 'workspace', 'model_family'])
  assert.equal(providerCircuitScope(scopes).scopeType, 'model_family')
  assert.equal(JSON.stringify(scopes).includes('secret'), false)
})

test('provider cap evidence is immutable precise and fails closed when stale or insufficient', () => {
  assert.equal(capEvidence.capMicros, '5000000')
  assert.equal(capEvidence.remainingMicros, '1000000')
  assert.equal(capEvidence.evidenceHash.length, 64)
  assert.equal(validateProviderCapEvidence({ evidence: capEvidence, estimateMicros: '250000', currency: 'USD', now }).allowed, true)
  assert.equal(validateProviderCapEvidence({ evidence: capEvidence, estimateMicros: '1000001', currency: 'USD', now }).reasonCode, 'provider_cap_insufficient')
  assert.equal(validateProviderCapEvidence({ evidence: capEvidence, estimateMicros: '1', currency: 'EUR', now }).reasonCode, 'provider_cap_currency_mismatch')
  assert.equal(validateProviderCapEvidence({ evidence: capEvidence, estimateMicros: '1', currency: 'USD', now: '2026-07-12T11:00:00.000Z' }).reasonCode, 'provider_cap_evidence_expired')
  assert.equal(validateProviderCapEvidence({ evidence: { ...capEvidence, capMicros: '1' }, estimateMicros: '1', currency: 'USD', now }).reasonCode, 'provider_cap_evidence_hash_mismatch')
})

test('machine-readable circuit policies preserve each modality threshold', () => {
  assert.deepEqual(['image', 'chat', 'video', 'music'].map((workspace) => {
    const policy = providerCircuitPolicyFor({ matrix: providerMatrix, workspace })
    return [workspace, policy.failureThreshold, policy.cooldownSeconds, policy.automaticCloseAllowed]
  }), [
    ['image', 3, 300, false],
    ['chat', 5, 120, false],
    ['video', 3, 900, false],
    ['music', 3, 900, false],
  ])
})

test('provider failure classification excludes user policy and validation failures', () => {
  assert.equal(classifyProviderFailure({ code: 'PROVIDER_TIMEOUT' }), 'timeout')
  assert.equal(classifyProviderFailure({ statusCode: 429 }), 'rate_limit')
  assert.equal(classifyProviderFailure({ statusCode: 503 }), 'provider_5xx')
  assert.equal(classifyProviderFailure({ code: 'PROVIDER_INCIDENT' }), 'provider_incident')
  assert.equal(classifyProviderFailure({ statusCode: 400, code: 'VALIDATION_FAILED' }), 'ignored_failure')
  assert.equal(classifyProviderFailure({ code: 'CONTENT_POLICY_BLOCKED' }), 'ignored_failure')
})

test('control evaluation requires global provider cap and circuit evidence', () => {
  const controls = scopes.slice(0, 2).map((scope, index) => ({ ...scope, enabled: true, version: index + 1 }))
  const circuit = { scopeKey: providerCircuitScope(scopes).scopeKey, status: 'closed' }
  assert.equal(evaluateProviderControlSnapshot({
    scopes,
    controls,
    capEvidence,
    circuit,
    estimateMicros: '250000',
    currency: 'USD',
    now,
  }).allowed, true)
  assert.equal(evaluateProviderControlSnapshot({
    scopes,
    controls: controls.slice(1),
    capEvidence,
    circuit,
    estimateMicros: '250000',
    currency: 'USD',
    now,
  }).reasonCode, 'provider_control_state_unknown')
  assert.equal(evaluateProviderControlSnapshot({
    scopes,
    controls: [...controls, { ...scopes[2], enabled: false }],
    capEvidence,
    circuit,
    estimateMicros: '250000',
    currency: 'USD',
    now,
  }).reasonCode, 'provider_kill_switch_active')
  assert.equal(evaluateProviderControlSnapshot({
    scopes,
    controls,
    capEvidence,
    circuit: { ...circuit, status: 'open' },
    estimateMicros: '250000',
    currency: 'USD',
    now,
  }).reasonCode, 'provider_circuit_open')
  assert.equal(evaluateProviderControlSnapshot({
    scopes,
    controls,
    capEvidence,
    circuit: { ...circuit, status: 'half_open' },
    estimateMicros: '250000',
    currency: 'USD',
    now,
  }).reasonCode, 'provider_circuit_probe_required')
})
