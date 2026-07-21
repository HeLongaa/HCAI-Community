import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { resolveModelRuntimeDeployment } from '../modelControl/modelRuntimeResolver.js'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL ??
  (process.env.CHAT_DATABASE_INTEGRATION_ENABLED === 'true' ? process.env.DATABASE_URL : null)

test('Prisma Chat Route and Deployment drive runtime config, rotation, disable, and rollback', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const runId = `chat-runtime-${Date.now()}-${randomUUID().slice(0, 8)}`
  const actor = { id: `${runId}-actor`, handle: `${runId}-admin`, role: 'admin' }
  const ids = {}
  const envNameV1 = `${runId}-token-v1`
  const envNameV2 = `${runId}-token-v2`
  const envKey = (value) => value.replaceAll('-', '_').toUpperCase()
  const baseSource = {
    NODE_ENV: 'production',
    CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
    [envKey(envNameV1)]: 'database-chat-token-v1',
    [envKey(envNameV2)]: 'database-chat-token-v2',
  }

  try {
    const provider = await repository.modelControl.createProvider({ id: `${runId}-provider`, key: `${runId}-provider`, name: 'Chat Router', websiteUrl: 'https://router.example', regions: ['us'], dataProcessingRegions: ['us'], createdByRef: actor.handle, updatedByRef: actor.handle })
    ids.provider = provider.id
    const model = await repository.modelControl.createModel({ id: `${runId}-model`, providerId: provider.id, key: `${runId}-model`, name: 'Terra Chat', family: 'chat', createdByRef: actor.handle, updatedByRef: actor.handle })
    ids.model = model.id
    const version = await repository.modelControl.createVersion({ id: `${runId}-version`, modelId: model.id, versionKey: 'v1', releaseDate: null, contextWindow: 131072, maxOutputUnits: 8192, parameterSchema: null, createdByRef: actor.handle, updatedByRef: actor.handle })
    ids.version = version.id
    ids.capability = `${runId}-capability`
    await repository.modelControl.upsertCapability({ id: ids.capability, modelVersionId: version.id, modality: 'chat', operations: ['generate'], inputMimeTypes: ['text/plain'], outputMimeTypes: ['text/plain'], constraints: null })
    const deployment = await repository.modelControl.createDeployment({
      id: `${runId}-deployment`, modelVersionId: version.id, key: `${runId}-staging`, environment: 'staging', region: 'us', deploymentRef: `${runId}-deployment-ref`,
      adapterType: 'openai_chat', providerModelId: 'gpt-5.6-terra', endpointUrl: 'https://router.example/v1', secretPurpose: 'chat-inference',
      runtimeConfig: { apiDialect: 'chat_completions', safetyResponseFormat: 'text' }, runtimeConfigSchemaVersion: 1, runtimeEnabled: true,
      createdByRef: actor.handle, updatedByRef: actor.handle,
    })
    ids.deployment = deployment.id
    for (const [type, resource] of [['provider', provider], ['model', model], ['version', version], ['deployment', deployment]]) {
      await repository.modelControl.transition(type, resource.id, { expectedVersion: resource.version, status: 'active', reasonCode: 'chat_runtime_ready', actorRef: actor.handle })
    }

    const policy = await repository.modelRouting.create({ id: `${runId}-policy`, key: `${runId}-policy`, name: 'Chat staging route', modality: 'chat', operation: 'generate', environment: 'staging', region: 'us', audienceRoles: [], rolloutPercentage: 100, rolloutSeed: 'v1', fallbackMode: 'fail_closed', priority: 1, createdByRef: actor.handle, updatedByRef: actor.handle })
    ids.policy = policy.id
    const targeted = await repository.modelRouting.replaceTargets(policy.id, { expectedVersion: policy.version, actorRef: actor.handle, reasonCode: 'chat_runtime_target', targets: [{ id: `${runId}-target`, policyId: policy.id, modelDeploymentId: deployment.id, role: 'primary', priority: 1, enabled: true }] })
    const active = await repository.modelRouting.transition(policy.id, { expectedVersion: targeted.version, status: 'active', reasonCode: 'chat_runtime_active', actorRef: actor.handle })

    const secretV1 = await repository.modelGovernance.createSecretRef({ id: `${runId}-secret-v1`, providerId: provider.id, environment: 'staging', purpose: 'chat-inference', secretRef: `secret://env/${envNameV1}`, externalVersion: 'v1', ownerRef: actor.handle, checksumSha256: 'a'.repeat(64), expiresAt: null, rotatedFromId: null, reasonCode: 'chat_runtime_secret', createdByRef: actor.handle })
    ids.secretV1 = secretV1.id
    const resolvedV1 = await resolveModelRuntimeDeployment({ repositories: repository, modality: 'chat', environment: 'staging', region: 'us', actor, baseSource })
    assert.equal(resolvedV1.providerModelId, 'gpt-5.6-terra')
    assert.equal(resolvedV1.runtimeSource.CHAT_OPENAI_API_DIALECT, 'chat_completions')
    assert.equal(resolvedV1.runtimeSource.CHAT_OPENAI_SAFETY_RESPONSE_FORMAT, 'text')
    assert.equal(resolvedV1.runtimeSource.CHAT_OPENAI_API_TOKEN, 'database-chat-token-v1')
    assert.equal(JSON.stringify(resolvedV1).includes('database-chat-token-v1'), false)

    const secretV2 = await repository.modelGovernance.createSecretRef({ id: `${runId}-secret-v2`, providerId: provider.id, environment: 'staging', purpose: 'chat-inference', secretRef: `secret://env/${envNameV2}`, externalVersion: 'v2', ownerRef: actor.handle, checksumSha256: 'b'.repeat(64), expiresAt: null, rotatedFromId: secretV1.id, reasonCode: 'chat_runtime_rotation', createdByRef: actor.handle })
    ids.secretV2 = secretV2.id
    const resolvedV2 = await resolveModelRuntimeDeployment({ repositories: repository, modality: 'chat', environment: 'staging', region: 'us', actor, baseSource })
    assert.equal(resolvedV2.secretRefId, secretV2.id)
    assert.equal(resolvedV2.runtimeSource.CHAT_OPENAI_API_TOKEN, 'database-chat-token-v2')
    await assert.rejects(
      resolveModelRuntimeDeployment({ repositories: repository, modality: 'chat', environment: 'staging', region: 'us', actor, baseSource: { NODE_ENV: 'production', CREATIVE_PROVIDER_RUNTIME_ENV: 'staging' } }),
      (error) => error.code === 'MODEL_RUNTIME_ROUTE_UNAVAILABLE',
    )

    const disabled = await repository.modelRouting.transition(policy.id, { expectedVersion: active.version, status: 'disabled', reasonCode: 'chat_runtime_kill_switch', actorRef: actor.handle })
    assert.equal(await resolveModelRuntimeDeployment({ repositories: repository, modality: 'chat', environment: 'staging', region: 'us', actor, baseSource }), null)
    const rolledBack = await repository.modelRouting.rollback(policy.id, { expectedVersion: disabled.version, revisionNumber: 2, reasonCode: 'chat_runtime_rollback', actorRef: actor.handle })
    const reactivated = await repository.modelRouting.transition(policy.id, { expectedVersion: rolledBack.version, status: 'active', reasonCode: 'chat_runtime_reactivated', actorRef: actor.handle })
    assert.equal(reactivated.status, 'active')
    assert.equal((await resolveModelRuntimeDeployment({ repositories: repository, modality: 'chat', environment: 'staging', region: 'us', actor, baseSource })).deploymentId, deployment.id)
  } finally {
    await repository.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.model_control_maintenance = 'on'")
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      if (ids.policy) {
        await transaction.modelRouteDecision.deleteMany({ where: { policyId: ids.policy } })
        await transaction.modelRoutePolicyRevision.deleteMany({ where: { policyId: ids.policy } })
        await transaction.modelRouteTarget.deleteMany({ where: { policyId: ids.policy } })
        await transaction.modelRoutePolicy.deleteMany({ where: { id: ids.policy } })
      }
      if (ids.provider) await transaction.providerSecretRef.deleteMany({ where: { providerId: ids.provider } })
      if (ids.deployment) await transaction.modelDeployment.deleteMany({ where: { id: ids.deployment } })
      if (ids.capability) await transaction.modelCapability.deleteMany({ where: { id: ids.capability } })
      if (ids.version) await transaction.modelVersion.deleteMany({ where: { id: ids.version } })
      if (ids.model) await transaction.model.deleteMany({ where: { id: ids.model } })
      if (ids.provider) await transaction.provider.deleteMany({ where: { id: ids.provider } })
      await transaction.auditEvent.deleteMany({ where: { resourceId: { in: Object.values(ids) } } })
    })
    await repository.client.$disconnect()
  }
})
