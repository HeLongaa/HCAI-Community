import assert from 'node:assert/strict'
import test from 'node:test'

import { openAIImageStagingAcceptanceFixture, runOpenAIImageStagingAcceptance } from '../creative/openaiImageStagingAcceptance.js'

const databaseUrl = process.env.IMAGE_DATABASE_URL ?? (
  String(process.env.IMAGE_DATABASE_INTEGRATION_ENABLED ?? '').trim().toLowerCase() === 'true'
    ? process.env.DATABASE_URL
    : null
)

const actorId = 'image-staging-acceptance-owner'
const actorHandle = 'image-staging-acceptance'
const inputAssetId = 'image-staging-acceptance-source'

test('Prisma OpenAI Image acceptance persists governed outputs and accounting', {
  skip: !databaseUrl,
}, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  process.env.MEDIA_SCAN_PROVIDER = 'mock'
  process.env.STORAGE_DRIVER = 'mock'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repositories = await createPrismaRepository()
  assert.ok(repositories)
  const client = repositories.client
  const output = openAIImageStagingAcceptanceFixture.sourcePng.toString('base64')
  const token = 'openai-image-prisma-fixture-token'
  const now = new Date()
  const providerAccountRef = `image-integration-${now.getTime()}`
  const priorGlobalControl = await client.creativeProviderControlState.findUnique({ where: { scopeKey: 'global' } })
  const source = {
    NODE_ENV: 'production',
    ACCESS_TOKEN_SECRET: 'openai-image-prisma-access-secret-32-bytes',
    CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
    CREATIVE_OPENAI_IMAGE_HTTP_CLIENT_ENABLED: 'true',
    CREATIVE_OPENAI_IMAGE_NETWORK_CALLS_ENABLED: 'true',
    CREATIVE_OPENAI_IMAGE_CONFIRMATION: 'staging-only',
    CREATIVE_OPENAI_IMAGE_API_TOKEN: token,
    CREATIVE_OPENAI_IMAGE_PROVIDER_ACCOUNT_REF: providerAccountRef,
    CREATIVE_OPENAI_IMAGE_DAILY_BUDGET_USD: '0.25',
    CREATIVE_OPENAI_IMAGE_PROVIDER_CAP_USD: '0.25',
    CREATIVE_OPENAI_IMAGE_APP_BUDGET_USD: '0.25',
  }
  let call = 0
  const fetchImpl = async () => {
    call += 1
    const edit = call === 2
    return new Response(JSON.stringify({
      data: [{ b64_json: output }],
      usage: {
        input_tokens: edit ? 70 : 20,
        input_tokens_details: { image_tokens: edit ? 50 : 0, text_tokens: 20 },
        output_tokens: 100,
        total_tokens: edit ? 170 : 120,
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  try {
    await client.user.create({
      data: {
        id: actorId,
        email: `${actorHandle}@example.test`,
        displayName: 'Image Staging Acceptance',
        role: 'creator',
        profile: { create: { handle: actorHandle, lane: 'maker', skills: [], languages: [] } },
      },
    })
    await client.mediaAsset.create({
      data: {
        id: inputAssetId,
        ownerId: actorId,
        fileName: 'image-staging-source.png',
        storageKey: `integration/${inputAssetId}.png`,
        contentType: 'image/png',
        sizeBytes: openAIImageStagingAcceptanceFixture.sourcePng.length,
        purpose: 'library_asset',
        status: 'uploaded',
        metadata: { security: { scanStatus: 'clean' } },
        storageObject: {
          create: {
            provider: 'mock',
            state: 'available',
            checksumSha256: 'a'.repeat(64),
            verifiedSizeBytes: openAIImageStagingAcceptanceFixture.sourcePng.length,
            verifiedContentType: 'image/png',
            verifiedAt: now,
          },
        },
      },
    })
    const summary = await runOpenAIImageStagingAcceptance({ source, fetchImpl, now, repositories })
    assert.equal(summary.providerCalls, 2)

    const generations = await client.creativeGeneration.findMany({
      where: { actorId, providerId: 'openai-gpt-image-2' },
      orderBy: { createdAt: 'asc' },
    })
    assert.equal(generations.length, 2)
    assert.deepEqual(generations.map((generation) => generation.status), ['completed', 'completed'])
    assert.deepEqual(generations.map((generation) => generation.outputAssetIds.length), [1, 1])
    assert.equal(JSON.stringify(generations).includes(token), false)
    assert.equal(JSON.stringify(generations).includes(output), false)

    const generationIds = generations.map((generation) => generation.id)
    const assets = await client.mediaAsset.findMany({ where: { id: { in: generations.flatMap((generation) => generation.outputAssetIds) } } })
    assert.equal(assets.length, 2)
    assert.equal(assets.every((asset) => asset.status === 'uploaded' && asset.metadata?.security?.scanStatus === 'clean'), true)
    const editGeneration = generations.find((generation) => generation.mode === 'image_to_image')
    const editAsset = assets.find((asset) => editGeneration?.outputAssetIds.includes(asset.id))
    assert.equal(editAsset?.metadata?.creative?.lineage?.generationId, editGeneration?.id)

    const [costs, credits, quotas] = await Promise.all([
      client.creativeProviderCostLedger.findMany({ where: { generationId: { in: generationIds } } }),
      client.creativeCreditLedger.findMany({ where: { generationId: { in: generationIds } } }),
      client.creativeQuotaReservation.findMany({ where: { generationId: { in: generationIds } } }),
    ])
    assert.equal(costs.length, 2)
    assert.equal(costs.every((ledger) => ledger.status === 'settled' && ledger.actualMicros != null), true)
    assert.equal(credits.length, 2)
    assert.equal(credits.every((ledger) => ledger.status === 'settled'), true)
    assert.equal(quotas.length, 2)
    assert.equal(quotas.every((reservation) => reservation.status === 'committed'), true)
  } finally {
    const generations = await client.creativeGeneration.findMany({ where: { actorId }, select: { id: true, outputAssetIds: true } })
    const generationIds = generations.map((generation) => generation.id)
    const assetIds = [inputAssetId, ...generations.flatMap((generation) => generation.outputAssetIds)]
    const costs = generationIds.length
      ? await client.creativeProviderCostLedger.findMany({ where: { generationId: { in: generationIds } }, select: { budgetWindowId: true } })
      : []
    await client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      if (generationIds.length) {
        const operations = await transaction.internalAccountingOperation.findMany({
          where: { sourceId: { in: generationIds } },
          select: { id: true },
        })
        await transaction.internalAccountingMovement.deleteMany({ where: { operationId: { in: operations.map((operation) => operation.id) } } })
        await transaction.internalAccountingOperation.deleteMany({ where: { sourceId: { in: generationIds } } })
        await transaction.creativeCreditLedger.deleteMany({ where: { generationId: { in: generationIds } } })
        await transaction.creativeProviderCostLedger.deleteMany({ where: { generationId: { in: generationIds } } })
        await transaction.creativeQuotaReservation.deleteMany({ where: { generationId: { in: generationIds } } })
        await transaction.creativeGeneration.deleteMany({ where: { id: { in: generationIds } } })
      }
      if (assetIds.length) {
        await transaction.mediaAssetRelation.deleteMany({ where: { ownerId: actorId } })
        await transaction.mediaScanJob.deleteMany({ where: { assetId: { in: assetIds } } })
        await transaction.mediaStorageObject.deleteMany({ where: { assetId: { in: assetIds } } })
        await transaction.mediaAsset.deleteMany({ where: { id: { in: assetIds } } })
      }
      await transaction.creativeProviderCircuitEvent.deleteMany({ where: { circuitState: { providerId: 'openai', providerAccountRef, workspace: 'image' } } })
      await transaction.creativeProviderCircuitState.deleteMany({ where: { providerId: 'openai', providerAccountRef, workspace: 'image' } })
      await transaction.creativeProviderCapEvidence.deleteMany({ where: { providerId: 'openai', providerAccountRef } })
      await transaction.creativeProviderControlState.deleteMany({ where: { providerId: 'openai', providerAccountRef } })
      if (priorGlobalControl) {
        await transaction.creativeProviderControlState.update({
          where: { scopeKey: 'global' },
          data: {
            enabled: priorGlobalControl.enabled,
            version: priorGlobalControl.version,
            reasonCode: priorGlobalControl.reasonCode,
            changedByRef: priorGlobalControl.changedByRef,
            enabledAt: priorGlobalControl.enabledAt,
            disabledAt: priorGlobalControl.disabledAt,
          },
        })
      } else {
        await transaction.creativeProviderControlState.deleteMany({ where: { scopeKey: 'global', changedByRef: actorHandle } })
      }
      await transaction.creativeProviderBudgetWindow.deleteMany({ where: { id: { in: costs.map((cost) => cost.budgetWindowId) } } })
      await transaction.creativeQuotaWindow.deleteMany({ where: { actorId } })
      await transaction.creativeGenerationExecution.deleteMany({ where: { actorId } })
      await transaction.auditEvent.deleteMany({ where: { actorId } })
      await transaction.user.deleteMany({ where: { id: actorId } })
    })
    await client.$disconnect()
  }
})
