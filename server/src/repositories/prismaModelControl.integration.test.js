import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma model control preserves activated versions, additive pricing, and generation references', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  assert.ok(repository)
  const runId = `model-control-${Date.now()}-${randomUUID().slice(0, 8)}`
  const actorRef = `${runId}-admin`
  const ids = {}

  try {
    const provider = await repository.modelControl.createProvider({ id: `${runId}-provider`, key: `${runId}-provider`, name: 'Integration Provider', websiteUrl: null, regions: ['us'], dataProcessingRegions: ['us'], createdByRef: actorRef, updatedByRef: actorRef })
    ids.provider = provider.id
    const model = await repository.modelControl.createModel({ id: `${runId}-model`, providerId: provider.id, key: `${runId}-model`, name: 'Integration Model', family: 'image', createdByRef: actorRef, updatedByRef: actorRef })
    ids.model = model.id
    const version = await repository.modelControl.createVersion({ id: `${runId}-version`, modelId: model.id, versionKey: 'v1', releaseDate: null, contextWindow: null, maxOutputUnits: 4, parameterSchema: { type: 'object' }, createdByRef: actorRef, updatedByRef: actorRef })
    ids.version = version.id
    const capability = await repository.modelControl.upsertCapability({ id: `${runId}-capability`, modelVersionId: version.id, modality: 'image', operations: ['generate'], inputMimeTypes: [], outputMimeTypes: ['image/png'], constraints: { maxOutputs: 4 } })
    ids.capability = capability.id
    const deployment = await repository.modelControl.createDeployment({ id: `${runId}-deployment`, modelVersionId: version.id, key: `${runId}-staging`, environment: 'staging', region: 'us', deploymentRef: `${runId}-deployment-ref`, createdByRef: actorRef, updatedByRef: actorRef })
    ids.deployment = deployment.id
    const priceV1 = await repository.modelControl.createPricing({ id: `${runId}-price-v1`, modelVersionId: version.id, modelDeploymentId: deployment.id, versionKey: 'usd-v1', currency: 'USD', unit: 'image', unitPriceMicros: 10000, effectiveFrom: '2026-07-01T00:00:00.000Z', effectiveTo: null, createdByRef: actorRef, updatedByRef: actorRef })
    ids.priceV1 = priceV1.id
    const priceV2 = await repository.modelControl.createPricing({ id: `${runId}-price-v2`, modelVersionId: version.id, modelDeploymentId: deployment.id, versionKey: 'usd-v2', currency: 'USD', unit: 'image', unitPriceMicros: 12000, effectiveFrom: '2026-08-01T00:00:00.000Z', effectiveTo: null, createdByRef: actorRef, updatedByRef: actorRef })
    ids.priceV2 = priceV2.id

    const activated = await repository.modelControl.transition('version', version.id, { expectedVersion: 1, status: 'active', reasonCode: 'integration_reviewed', actorRef })
    assert.equal(activated.status, 'active')
    await assert.rejects(
      repository.client.modelVersion.update({ where: { id: version.id }, data: { maxOutputUnits: 8 } }),
      /activated model versions are immutable/,
    )
    await assert.rejects(
      repository.client.modelCapability.update({ where: { id: capability.id }, data: { operations: ['edit'] } }),
      /capabilities for activated model versions are immutable/,
    )
    await assert.rejects(
      repository.client.pricingVersion.update({ where: { id: priceV1.id }, data: { unitPriceMicros: 1 } }),
      /pricing versions are immutable/,
    )

    ids.generation = `${runId}-generation`
    await repository.client.creativeGeneration.create({ data: {
      id: ids.generation, workspace: 'image', mode: 'generate', providerId: provider.key, status: 'completed', promptHash: 'a'.repeat(64),
      inputAssetIds: [], parameterKeys: [], outputAssetIds: [], modelVersionId: version.id, modelDeploymentId: deployment.id, pricingVersionId: priceV1.id,
    } })
    const generation = await repository.client.creativeGeneration.findUnique({ where: { id: ids.generation }, include: { modelVersion: true, modelDeployment: true, pricingVersion: true } })
    assert.equal(generation.modelVersion.versionKey, 'v1')
    assert.equal(generation.modelDeployment.key, deployment.key)
    assert.equal(generation.pricingVersion.unitPriceMicros, 10000)
    assert.equal((await repository.modelControl.exportCatalog()).pricingVersions.length >= 2, true)
  } finally {
    await repository.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.model_control_maintenance = 'on'")
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      if (ids.generation) await transaction.creativeGeneration.deleteMany({ where: { id: ids.generation } })
      if (ids.version) {
        await transaction.pricingVersion.deleteMany({ where: { modelVersionId: ids.version } })
        await transaction.modelDeployment.deleteMany({ where: { modelVersionId: ids.version } })
        await transaction.modelCapability.deleteMany({ where: { modelVersionId: ids.version } })
        await transaction.modelVersion.deleteMany({ where: { id: ids.version } })
      }
      if (ids.model) await transaction.model.deleteMany({ where: { id: ids.model } })
      if (ids.provider) await transaction.provider.deleteMany({ where: { id: ids.provider } })
      await transaction.auditEvent.deleteMany({ where: { resourceId: { in: Object.values(ids) } } })
    })
    await repository.client.$disconnect()
  }
})
