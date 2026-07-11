import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildProviderControlScopes,
  createProviderCapEvidence,
  providerCircuitScope,
} from './providerControlContract.js'
import { createProviderControlPlane } from './providerControlPlane.js'
import { createSeedRepository } from '../repositories/seedRepository.js'

const actor = { id: 'demo-user-admin', handle: 'legalpixel' }
const now = new Date('2026-07-12T10:00:00.000Z')

const provision = async (repository, suffix) => {
  const identity = {
    providerId: `fixture-plane-${suffix}`,
    providerAccountRef: 'staging',
    workspace: 'image',
    modelFamily: 'flux',
  }
  const scopes = buildProviderControlScopes(identity)
  const global = await repository.creativeProviderControls.findControl('global')
  await repository.creativeProviderControls.setControl({
    ...scopes[0],
    enabled: true,
    reasonCode: 'fixture_global_enabled',
    expectedVersion: global?.version ?? 0,
  }, actor)
  await repository.creativeProviderControls.setControl({
    ...scopes[1],
    enabled: true,
    reasonCode: 'fixture_provider_enabled',
    expectedVersion: 0,
  }, actor)
  await repository.creativeProviderControls.putCapEvidence(createProviderCapEvidence({
    sourceKey: `cap-plane-${suffix}`,
    scopeKey: scopes[1].scopeKey,
    providerId: identity.providerId,
    providerAccountRef: identity.providerAccountRef,
    currency: 'USD',
    capAmount: '5',
    remainingAmount: '1',
    sourceType: 'fixture_config',
    sourceRef: `fixture:plane:${suffix}`,
    verifiedAt: '2026-07-12T09:00:00.000Z',
    expiresAt: '2026-07-12T11:00:00.000Z',
  }), actor)
  await repository.creativeProviderControls.ensureCircuit(providerCircuitScope(scopes), actor)
  return { identity, scopes }
}

test('Provider control plane permits fully evidenced fixture dispatch and blocks dynamic workspace switch', async () => {
  const repository = createSeedRepository()
  const { identity, scopes } = await provision(repository, Date.now())
  const plane = createProviderControlPlane({ repository: repository.creativeProviderControls })
  const allowed = await plane.assertDispatchAllowed({ ...identity, estimateMicros: '250000', currency: 'USD', actor, now })
  assert.equal(allowed.evaluation.allowed, true)

  await repository.creativeProviderControls.setControl({
    ...scopes[2],
    enabled: false,
    reasonCode: 'operator_emergency_stop',
    expectedVersion: 0,
  }, actor)
  await assert.rejects(
    plane.assertDispatchAllowed({ ...identity, estimateMicros: '250000', currency: 'USD', actor, now }),
    (error) => error.code === 'CREATIVE_PROVIDER_CONTROL_BLOCKED' && error.details.reasonCode === 'provider_kill_switch_active',
  )
})

test('Provider control plane opens after policy threshold and suppresses duplicate failure source keys', async () => {
  const repository = createSeedRepository()
  const suffix = Date.now()
  const { identity, scopes } = await provision(repository, suffix)
  const plane = createProviderControlPlane({ repository: repository.creativeProviderControls })
  for (let index = 0; index < 3; index += 1) {
    await plane.recordResult({
      ...identity,
      sourceKey: `plane-timeout-${suffix}-${index}`,
      error: { code: 'PROVIDER_TIMEOUT' },
      actor,
      now: new Date(`2026-07-12T10:0${index}:00.000Z`),
    })
  }
  await plane.recordResult({
    ...identity,
    sourceKey: `plane-timeout-${suffix}-2`,
    error: { code: 'PROVIDER_TIMEOUT' },
    actor,
    now,
  })
  const circuit = await repository.creativeProviderControls.findCircuit(providerCircuitScope(scopes).scopeKey)
  assert.equal(circuit.status, 'open')
  assert.equal(circuit.failureCount, 3)
  await assert.rejects(
    plane.assertDispatchAllowed({ ...identity, estimateMicros: '250000', currency: 'USD', actor, now }),
    { code: 'CREATIVE_PROVIDER_CONTROL_BLOCKED' },
  )
})
