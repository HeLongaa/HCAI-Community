import assert from 'node:assert/strict'
import test from 'node:test'

import providerMatrix from '../../../config/v1-provider-matrix.json' with { type: 'json' }
import {
  buildProviderControlScopes,
  createProviderCapEvidence,
  providerCircuitPolicyFor,
  providerCircuitScope,
} from '../creative/providerControlContract.js'
import { createSeedRepository } from './seedRepository.js'
import { serializeAuditEvent } from './serializers.js'

const actor = { id: 'demo-user-admin', handle: 'legalpixel' }

test('Provider control audit serialization drops high-cardinality and secret evidence', () => {
  const event = serializeAuditEvent({
    id: 'audit-control-secret',
    actorType: 'user',
    actorId: 'admin-1',
    action: 'creative.provider_control.cap_evidence_recorded',
    resourceType: 'creative_provider_cap_evidence',
    resourceId: 'https://provider.example/evidence?token=secret',
    metadata: {
      providerId: 'replicate',
      currency: 'USD',
      sourceType: 'manual_attestation',
      expiresAt: '2026-07-13T00:00:00.000Z',
      providerAccountRef: 'account-secret',
      evidenceHash: 'a'.repeat(64),
      sourceRefHash: 'b'.repeat(64),
      probeToken: 'probe-secret',
    },
    createdAt: '2026-07-12T12:00:00.000Z',
  })

  assert.match(event.resourceId, /^redacted_[a-f0-9]{16}$/)
  assert.deepEqual(event.metadata, {
    providerId: 'replicate',
    currency: 'USD',
    sourceType: 'manual_attestation',
    expiresAt: '2026-07-13T00:00:00.000Z',
  })
  const serialized = JSON.stringify(event)
  assert.equal(serialized.includes('account-secret'), false)
  assert.equal(serialized.includes('probe-secret'), false)
  assert.equal(serialized.includes('a'.repeat(64)), false)
  assert.equal(serialized.includes('b'.repeat(64)), false)
})

test('seed Provider control repository versions switches and keeps cap evidence immutable', async () => {
  const repository = createSeedRepository()
  const suffix = Date.now()
  const scopes = buildProviderControlScopes({
    providerId: `fixture-provider-${suffix}`,
    providerAccountRef: 'staging',
    workspace: 'image',
    modelFamily: 'flux',
  })
  const globalCurrent = await repository.creativeProviderControls.findControl('global')
  const global = await repository.creativeProviderControls.setControl({
    ...scopes[0],
    enabled: true,
    reasonCode: 'fixture_control_plane_enabled',
    expectedVersion: globalCurrent?.version ?? 0,
  }, actor)
  const provider = await repository.creativeProviderControls.setControl({
    ...scopes[1],
    enabled: true,
    reasonCode: 'fixture_provider_enabled',
    expectedVersion: 0,
  }, actor)
  const duplicate = await repository.creativeProviderControls.setControl({
    ...scopes[1],
    enabled: true,
    reasonCode: 'fixture_provider_enabled',
    expectedVersion: provider.control.version,
  }, actor)
  assert.equal(global.control.enabled, true)
  assert.equal(provider.control.version, 1)
  assert.equal(duplicate.changed, false)
  assert.throws(
    () => repository.creativeProviderControls.setControl({
      ...scopes[1],
      enabled: false,
      reasonCode: 'stale_operator_change',
      expectedVersion: 0,
    }, actor),
    { code: 'CREATIVE_PROVIDER_CONTROL_CONFLICT' },
  )

  const evidence = createProviderCapEvidence({
    sourceKey: `cap-fixture-${suffix}`,
    scopeKey: scopes[1].scopeKey,
    providerId: scopes[1].providerId,
    providerAccountRef: scopes[1].providerAccountRef,
    currency: 'USD',
    capAmount: '5',
    remainingAmount: '1',
    sourceType: 'fixture_config',
    sourceRef: `fixture:cap:${suffix}`,
    verifiedAt: '2026-07-12T09:00:00.000Z',
    expiresAt: '2026-07-12T11:00:00.000Z',
  })
  const firstEvidence = await repository.creativeProviderControls.putCapEvidence(evidence, actor)
  const duplicateEvidence = await repository.creativeProviderControls.putCapEvidence(evidence, actor)
  assert.equal(firstEvidence.created, true)
  assert.equal(duplicateEvidence.created, false)
  assert.deepEqual(await repository.creativeProviderControls.findCapEvidence(scopes[1].scopeKey), firstEvidence.evidence)
})

test('seed Provider circuit dedupes failures opens atomically and requires an explicit successful probe to close', async () => {
  const repository = createSeedRepository()
  const suffix = Date.now()
  const scopes = buildProviderControlScopes({
    providerId: `fixture-circuit-${suffix}`,
    providerAccountRef: 'staging',
    workspace: 'image',
    modelFamily: 'flux',
  })
  const scope = providerCircuitScope(scopes)
  const policy = providerCircuitPolicyFor({ matrix: providerMatrix, workspace: 'image' })
  const ensured = await repository.creativeProviderControls.ensureCircuit(scope, actor)
  assert.equal(ensured.circuit.status, 'closed')

  for (let index = 0; index < 3; index += 1) {
    const result = await repository.creativeProviderControls.recordCircuitEvent({
      sourceKey: `circuit-failure-${suffix}-${index}`,
      scopeKey: scope.scopeKey,
      category: 'timeout',
      occurredAt: `2026-07-12T10:0${index}:00.000Z`,
      policy,
    }, actor)
    assert.equal(result.duplicate, false)
  }
  const duplicate = await repository.creativeProviderControls.recordCircuitEvent({
    sourceKey: `circuit-failure-${suffix}-2`,
    scopeKey: scope.scopeKey,
    category: 'timeout',
    occurredAt: '2026-07-12T10:02:00.000Z',
    policy,
  }, actor)
  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.circuit.status, 'open')
  assert.equal(duplicate.circuit.failureCount, 3)

  const halfOpen = await repository.creativeProviderControls.transitionCircuit(scope.scopeKey, {
    status: 'half_open',
    expectedVersion: duplicate.circuit.version,
    reasonCode: 'approved_fixture_probe',
    now: '2026-07-12T10:10:00.000Z',
    probeTtlSeconds: 60,
  }, actor)
  assert.equal(halfOpen.circuit.status, 'half_open')
  assert.ok(halfOpen.probeToken)
  assert.equal((await repository.creativeProviderControls.claimProbe(scope.scopeKey, halfOpen.probeToken, actor, '2026-07-12T10:10:30.000Z')).claimed, true)
  assert.equal((await repository.creativeProviderControls.claimProbe(scope.scopeKey, halfOpen.probeToken, actor, '2026-07-12T10:10:31.000Z')).claimed, false)

  const probeSuccess = await repository.creativeProviderControls.recordCircuitEvent({
    sourceKey: `circuit-probe-success-${suffix}`,
    scopeKey: scope.scopeKey,
    category: 'success',
    occurredAt: '2026-07-12T10:10:40.000Z',
    policy,
  }, actor)
  const closed = await repository.creativeProviderControls.transitionCircuit(scope.scopeKey, {
    status: 'closed',
    expectedVersion: probeSuccess.circuit.version,
    reasonCode: 'fixture_probe_confirmed',
    now: '2026-07-12T10:11:00.000Z',
  }, actor)
  assert.equal(closed.circuit.status, 'closed')
  assert.equal(closed.circuit.failureCount, 0)
})
