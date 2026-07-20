import assert from 'node:assert/strict'
import test from 'node:test'

const databaseUrl = process.env.VIDEO_DATABASE_URL ?? (
  String(process.env.VIDEO_DATABASE_INTEGRATION_ENABLED ?? '').trim().toLowerCase() === 'true'
    ? process.env.DATABASE_URL
    : null
)

test('Prisma preserves a pollable Google Veo operation resource without accepting arbitrary Provider URLs', {
  skip: !databaseUrl,
}, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repositories = await createPrismaRepository()
  assert.ok(repositories)
  const client = repositories.client
  const suffix = Date.now()
  const generationId = `video-operation-integration-${suffix}`
  const operationName = `projects/video-staging-123/locations/us-central1/publishers/google/models/veo-3.1-fast-generate-001/operations/operation-${suffix}`
  try {
    await client.creativeGeneration.create({
      data: {
        id: generationId,
        workspace: 'video',
        mode: 'text_to_video',
        providerId: 'google-veo-3-1-fast',
        providerMode: 'google_video',
        status: 'queued',
        promptHash: 'a'.repeat(64),
        inputAssetIds: [],
        parameterKeys: ['durationSeconds'],
        outputAssetIds: [],
        providerRequestId: operationName,
        providerJobId: operationName,
      },
    })
    const recorded = await repositories.creativeProviderOperations.record({
      id: `provider-operation-${generationId}`,
      generationId,
      providerId: 'google-veo-3-1-fast',
      providerMode: 'google_video',
      providerJobId: operationName,
      status: 'queued',
      pollAttempts: 0,
      nextPollAt: new Date().toISOString(),
      timeoutAt: new Date(Date.now() + 900_000).toISOString(),
      sideEffectsComplete: false,
      safeMetadata: { schemaVersion: 'video-provider-operation-v1', modelId: 'veo-3.1-fast-generate-001', workspace: 'video', mode: 'text_to_video' },
    }, null)
    assert.equal(recorded.operation.providerJobId, operationName)
    const updated = await repositories.creativeProviderOperations.update(generationId, {
      status: 'running',
      pollAttempts: 1,
      providerJobId: operationName,
    }, null, { expectedVersion: recorded.operation.version })
    assert.equal(updated.status, 'running')
    assert.equal(updated.providerJobId, operationName)

    const unsafeGenerationId = `${generationId}-unsafe`
    await client.creativeGeneration.create({
      data: {
        id: unsafeGenerationId,
        workspace: 'video',
        mode: 'text_to_video',
        providerId: 'google-veo-3-1-fast',
        status: 'queued',
        promptHash: 'b'.repeat(64),
        inputAssetIds: [],
        parameterKeys: [],
        outputAssetIds: [],
      },
    })
    const unsafe = await repositories.creativeProviderOperations.record({
      id: `provider-operation-${unsafeGenerationId}`,
      generationId: unsafeGenerationId,
      providerId: 'google-veo-3-1-fast',
      providerMode: 'google_video',
      providerJobId: 'https://provider.example/operation?token=secret',
      status: 'queued',
      timeoutAt: new Date(Date.now() + 900_000).toISOString(),
    }, null)
    assert.match(unsafe.operation.providerJobId, /^redacted_[a-f0-9]{16}$/)
  } finally {
    await client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await transaction.creativeProviderOperation.deleteMany({ where: { generationId: { startsWith: generationId } } })
      await transaction.creativeGeneration.deleteMany({ where: { id: { startsWith: generationId } } })
      await transaction.auditEvent.deleteMany({ where: { resourceId: { in: [`provider-operation-${generationId}`, `provider-operation-${generationId}-unsafe`] } } })
    })
    await client.$disconnect()
  }
})
