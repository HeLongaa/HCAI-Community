import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeedModelControlRepository } from './seedModelControlRepository.js'
import { createSeedModelGovernanceRepository } from './seedModelGovernanceRepository.js'
import { createSeedModelRoutingRepository } from './seedModelRoutingRepository.js'
import {
  minimaxVideoStagingSpec,
  provisionMiniMaxVideoStaging,
  summarizeMiniMaxVideoStagingProvisioning,
} from './minimaxVideoStagingProvisioning.js'

const repositories = () => {
  const modelControl = createSeedModelControlRepository()
  const modelRouting = createSeedModelRoutingRepository({ modelControl })
  const modelGovernance = createSeedModelGovernanceRepository({ modelControl, modelRouting })
  const controls = new Map()
  const caps = new Map()
  const circuits = new Map()
  const creativeProviderControls = {
    findControl: async (scopeKey) => controls.get(scopeKey) ?? null,
    setControl: async (payload) => {
      const current = controls.get(payload.scopeKey)
      const control = current ?? { ...payload, id: `control-${controls.size + 1}`, version: 1 }
      controls.set(payload.scopeKey, control)
      return { changed: !current, control }
    },
    findCapEvidence: async (scopeKey) => [...caps.values()].find((item) => item.scopeKey === scopeKey && item.active) ?? null,
    putCapEvidence: async (payload) => {
      for (const [id, item] of caps) if (item.scopeKey === payload.scopeKey && item.active) caps.set(id, { ...item, active: false })
      const evidence = { ...payload, id: `cap-${caps.size + 1}`, createdAt: '2026-08-09T00:00:00.000Z' }
      caps.set(evidence.id, evidence)
      return { created: true, evidence }
    },
    ensureCircuit: async (scope) => {
      const current = circuits.get(scope.scopeKey)
      const circuit = current ?? { ...scope, id: `circuit-${circuits.size + 1}`, status: 'closed', version: 1 }
      circuits.set(scope.scopeKey, circuit)
      return { created: !current, circuit }
    },
  }
  return { modelControl, modelRouting, modelGovernance, creativeProviderControls }
}

test('MiniMax staging provisioning is active, isolated from Seedance, and idempotent', async () => {
  const repo = repositories()
  const actor = { id: 'profile-veyn', handle: 'veyn', role: 'admin' }
  const options = {
    repositories: repo,
    actor,
    credential: 'temporary-minimax-key',
    secretExpiresAt: '2026-08-10T00:00:00.000Z',
    now: new Date('2026-08-09T00:00:00.000Z'),
  }
  const first = await provisionMiniMaxVideoStaging(options)
  const second = await provisionMiniMaxVideoStaging(options)

  for (const resource of [first.provider, first.model, first.version, first.deployment, first.pricing, first.route]) assert.equal(resource.status, 'active')
  assert.equal(first.deployment.adapterType, 'router_minimax_video')
  assert.equal(first.pricing.unit, 'generated_seconds')
  assert.equal(first.route.priority, 0)
  assert.equal(first.route.targets[0].modelDeploymentId, first.deployment.id)
  assert.equal(second.provider.id, first.provider.id)
  assert.equal(second.route.id, first.route.id)
  assert.equal(second.secretRef.id, first.secretRef.id)
  assert.equal(first.providerControls.controls.length, 2)
  assert.equal(first.providerControls.capEvidence.capMicros, '1200000')
  assert.equal(first.providerControls.capEvidence.remainingMicros, '1200000')
  assert.equal(first.providerControls.circuit.status, 'closed')
  assert.equal(second.providerControls.capEvidence.id, first.providerControls.capEvidence.id)
  assert.equal(second.providerControls.circuit.id, first.providerControls.circuit.id)
  assert.equal(JSON.stringify(first).includes('temporary-minimax-key'), false)

  const catalog = await repo.modelControl.exportCatalog()
  assert.equal(catalog.providers.filter((item) => item.key === minimaxVideoStagingSpec.providerKey).length, 1)
  assert.equal(catalog.deployments.filter((item) => item.key === minimaxVideoStagingSpec.deploymentKey).length, 1)
})

test('MiniMax staging provisioning rotates a changed credential without persisting plaintext', async () => {
  const repo = repositories()
  const actor = { handle: 'veyn' }
  const first = await provisionMiniMaxVideoStaging({ repositories: repo, actor, credential: 'temporary-minimax-key-v1', secretExternalVersion: 'temporary-v1' })
  const second = await provisionMiniMaxVideoStaging({ repositories: repo, actor, credential: 'temporary-minimax-key-v2', secretExternalVersion: 'temporary-v2' })

  assert.equal(second.secretRef.rotatedFromId, first.secretRef.id)
  assert.notEqual(second.secretRef.checksumSha256, first.secretRef.checksumSha256)
  assert.equal(second.secretRef.secretRef, minimaxVideoStagingSpec.secretRef)
  assert.equal(JSON.stringify(second).includes('temporary-minimax-key-v2'), false)
})

test('summarizes provisioning without exposing credential-bearing resource fields', () => {
  const summary = summarizeMiniMaxVideoStagingProvisioning({
    provider: { id: 'provider-1', key: 'provider-key', status: 'active', credential: 'must-not-leak' },
    version: { id: 'version-1', versionKey: 'v1', status: 'active' },
    secretRef: { id: 'secret-1', secretRef: 'secret://env/key', checksumSha256: 'must-not-leak' },
    providerControls: {
      controls: [{ id: 'control-1' }, { id: 'control-2' }],
      capEvidence: { id: 'cap-1', sourceRefHash: 'must-not-leak' },
      circuit: { id: 'circuit-1', status: 'closed' },
    },
  })

  assert.equal(summary.decision, 'configured')
  assert.deepEqual(summary.resources, {
    provider: { id: 'provider-1', key: 'provider-key', status: 'active' },
    version: { id: 'version-1', key: 'v1', status: 'active' },
    secretRef: { id: 'secret-1', key: null, status: 'configured' },
    providerControls: {
      controlIds: ['control-1', 'control-2'],
      capEvidenceId: 'cap-1',
      circuitId: 'circuit-1',
      circuitStatus: 'closed',
    },
  })
  assert.doesNotMatch(JSON.stringify(summary), /must-not-leak|secret:\/\/env/)
})

test('reports no_go when a required secret reference was not provisioned', () => {
  assert.equal(summarizeMiniMaxVideoStagingProvisioning({ secretRef: null }).decision, 'no_go')
  assert.equal(summarizeMiniMaxVideoStagingProvisioning({ secretRef: null }, { requireSecret: false }).decision, 'configured')
})
