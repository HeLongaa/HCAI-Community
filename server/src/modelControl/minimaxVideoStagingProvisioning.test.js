import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeedModelControlRepository } from './seedModelControlRepository.js'
import { createSeedModelGovernanceRepository } from './seedModelGovernanceRepository.js'
import { createSeedModelRoutingRepository } from './seedModelRoutingRepository.js'
import { minimaxVideoStagingSpec, provisionMiniMaxVideoStaging } from './minimaxVideoStagingProvisioning.js'

const repositories = () => {
  const modelControl = createSeedModelControlRepository()
  const modelRouting = createSeedModelRoutingRepository({ modelControl })
  const modelGovernance = createSeedModelGovernanceRepository({ modelControl, modelRouting })
  return { modelControl, modelRouting, modelGovernance }
}

test('MiniMax staging provisioning is active, isolated from Seedance, and idempotent', async () => {
  const repo = repositories()
  const actor = { id: 'profile-veyn', handle: 'veyn', role: 'admin' }
  const first = await provisionMiniMaxVideoStaging({ repositories: repo, actor, credential: 'temporary-minimax-key' })
  const second = await provisionMiniMaxVideoStaging({ repositories: repo, actor, credential: 'temporary-minimax-key' })

  for (const resource of [first.provider, first.model, first.version, first.deployment, first.pricing, first.route]) assert.equal(resource.status, 'active')
  assert.equal(first.deployment.adapterType, 'router_minimax_video')
  assert.equal(first.pricing.unit, 'generated_seconds')
  assert.equal(first.route.priority, 0)
  assert.equal(first.route.targets[0].modelDeploymentId, first.deployment.id)
  assert.equal(second.provider.id, first.provider.id)
  assert.equal(second.route.id, first.route.id)
  assert.equal(second.secretRef.id, first.secretRef.id)
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
