import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeedModelControlRepository } from './seedModelControlRepository.js'
import { createSeedModelGovernanceRepository } from './seedModelGovernanceRepository.js'
import { createSeedModelRoutingRepository } from './seedModelRoutingRepository.js'
import { openAIImageStagingSpec, provisionOpenAIImageStaging } from './openAIImageStagingProvisioning.js'

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
      const evidence = { ...payload, id: `cap-${caps.size + 1}`, createdAt: '2026-08-08T13:00:00.000Z' }
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

test('GPT Image 2 staging provisioning creates an active, priced, idempotent runtime', async () => {
  const repo = repositories()
  const actor = { id: 'staging-admin', handle: 'helong', role: 'admin' }
  const options = { repositories: repo, actor, credential: 'temporary-image-key', secretExpiresAt: '2026-08-09T13:00:00.000Z', now: new Date('2026-08-08T13:00:00.000Z') }
  const first = await provisionOpenAIImageStaging(options)
  const second = await provisionOpenAIImageStaging(options)

  for (const resource of [first.provider, first.model, first.version, first.deployment, ...first.pricing, first.route]) assert.equal(resource.status, 'active')
  assert.equal(first.deployment.adapterType, 'openai_image')
  assert.equal(first.deployment.endpointUrl, 'https://router.hctopup.com/v1')
  assert.equal(first.deployment.runtimeConfig.dailyBudgetUsd, 10)
  assert.equal(first.pricing.length, 12)
  assert.equal(first.pricing.find((item) => item.unit === 'image_output_1024x1024_medium').unitPriceMicros, 53_000)
  assert.equal(first.pricing.find((item) => item.unit === 'output_image_tokens').unitPriceMicros, 30_000_000)
  assert.equal(first.route.priority, 0)
  assert.equal(first.route.targets[0].modelDeploymentId, first.deployment.id)
  assert.equal(second.provider.id, first.provider.id)
  assert.equal(second.route.id, first.route.id)
  assert.deepEqual(second.pricing.map((item) => item.id), first.pricing.map((item) => item.id))
  assert.equal(second.secretRef.id, first.secretRef.id)
  assert.equal(first.providerControls.controls.length, 2)
  assert.equal(first.providerControls.capEvidence.capMicros, '10000000')
  assert.equal(first.providerControls.circuit.status, 'closed')
  assert.equal(second.providerControls.capEvidence.id, first.providerControls.capEvidence.id)
  assert.equal(second.providerControls.circuit.id, first.providerControls.circuit.id)
  assert.equal(JSON.stringify(first).includes('temporary-image-key'), false)

  const catalog = await repo.modelControl.exportCatalog()
  assert.equal(catalog.providers.filter((item) => item.key === openAIImageStagingSpec.providerKey).length, 1)
  assert.equal(catalog.deployments.filter((item) => item.key === openAIImageStagingSpec.deploymentKey).length, 1)
  assert.equal(catalog.pricingVersions.filter((item) => item.modelVersionId === first.version.id).length, 12)
})

test('GPT Image 2 staging provisioning rotates changed credentials without persisting plaintext', async () => {
  const repo = repositories()
  const actor = { handle: 'helong' }
  const first = await provisionOpenAIImageStaging({ repositories: repo, actor, credential: 'temporary-image-key-v1', secretExternalVersion: 'temporary-v1', secretExpiresAt: '2026-08-09T13:00:00.000Z', now: new Date('2026-08-08T13:00:00.000Z') })
  const second = await provisionOpenAIImageStaging({ repositories: repo, actor, credential: 'temporary-image-key-v2', secretExternalVersion: 'temporary-v2', secretExpiresAt: '2026-08-10T13:00:00.000Z', now: new Date('2026-08-09T13:00:00.000Z') })

  assert.equal(second.secretRef.rotatedFromId, first.secretRef.id)
  assert.notEqual(second.secretRef.checksumSha256, first.secretRef.checksumSha256)
  assert.equal(second.secretRef.secretRef, openAIImageStagingSpec.secretRef)
  assert.equal(JSON.stringify(second).includes('temporary-image-key-v2'), false)
  assert.notEqual(second.providerControls.capEvidence.id, first.providerControls.capEvidence.id)
})
