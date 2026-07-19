import { createServer } from '../common/http/server.js'
import { createRouter } from '../common/http/router.js'
import { registerCreativeRoutes } from '../modules/creative/routes.js'
import {
  buildProviderControlScopes,
  createProviderCapEvidence,
  providerCircuitScope,
} from './providerControlContract.js'
import { resetCreativePolicyState } from './policy.js'
import { createSeedRepository } from '../repositories/seedRepository.js'

const providerIdentityFor = (source) => ({
  providerId: 'openai',
  providerAccountRef: String(source.CREATIVE_OPENAI_IMAGE_PROVIDER_ACCOUNT_REF ?? 'staging').trim() || 'staging',
  workspace: 'image',
  modelFamily: 'image',
})

const actor = Object.freeze({
  id: 'image-staging-acceptance-owner',
  handle: 'image-staging-acceptance',
  role: 'creator',
  permissions: [],
})

const authToken = 'image-staging-acceptance-token'
const inputAssetId = 'image-staging-acceptance-source'

const sourcePng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

const provisionProviderControls = async ({ repositories, source, now }) => {
  const providerIdentity = providerIdentityFor(source)
  const scopes = buildProviderControlScopes(providerIdentity)
  const global = await repositories.creativeProviderControls.findControl('global')
  await repositories.creativeProviderControls.setControl({
    ...scopes[0],
    enabled: true,
    reasonCode: 'image_staging_acceptance_enabled',
    expectedVersion: global?.version ?? 0,
  }, actor)
  await repositories.creativeProviderControls.setControl({
    ...scopes[1],
    enabled: true,
    reasonCode: 'image_staging_provider_enabled',
    expectedVersion: 0,
  }, actor)
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000)
  await repositories.creativeProviderControls.putCapEvidence(createProviderCapEvidence({
    sourceKey: `image-staging-cap-${now.getTime()}`,
    scopeKey: scopes[1].scopeKey,
    providerId: providerIdentity.providerId,
    providerAccountRef: providerIdentity.providerAccountRef,
    currency: 'USD',
    capAmount: source.CREATIVE_OPENAI_IMAGE_PROVIDER_CAP_USD,
    remainingAmount: source.CREATIVE_OPENAI_IMAGE_APP_BUDGET_USD,
    sourceType: 'manual_attestation',
    sourceRef: 'image-staging-acceptance',
    verifiedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  }), actor)
  await repositories.creativeProviderControls.ensureCircuit(providerCircuitScope(scopes), actor)
}

const listen = (server) => new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    server.off('error', reject)
    resolve()
  })
})

const close = (server) => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve())
})

const postGeneration = async (origin, body) => {
  const response = await fetch(`${origin}/api/creative/generations`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${authToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  return { status: response.status, payload: await response.json() }
}

const assertCompletedGeneration = (result, mode) => {
  const generation = result.payload?.data
  if (result.status !== 200 || generation?.status !== 'completed' || generation?.mode !== mode) {
    const code = result.payload?.error?.code ?? 'none'
    const status = generation?.status ?? 'none'
    throw new Error(`OpenAI Image ${mode} application acceptance failed: http=${result.status} code=${code} status=${status}`)
  }
  const output = generation.outputs?.[0]
  if (
    output?.storage?.persisted !== true ||
    output.storage.provider !== 'media_asset' ||
    output.storage.scanStatus !== 'clean' ||
    !String(output.url ?? '').startsWith('/api/media/assets/')
  ) {
    throw new Error(`OpenAI Image ${mode} output governance acceptance failed`)
  }
  if (generation.credit?.status !== 'settled' || Number(generation.quota?.used) < 1) {
    throw new Error(`OpenAI Image ${mode} accounting acceptance failed`)
  }
  return generation
}

export const runOpenAIImageStagingAcceptance = async ({
  source = process.env,
  fetchImpl = fetch,
  now = new Date(),
  repositories: providedRepositories = null,
} = {}) => {
  resetCreativePolicyState()
  const repositories = providedRepositories ?? createSeedRepository()
  const originalFindInput = repositories.media.findAccessibleCreativeInput
  repositories.media.findAccessibleCreativeInput = async (id, requestedActor) => id === inputAssetId && requestedActor.id === actor.id
    ? {
        id: inputAssetId,
        ownerHandle: actor.handle,
        fileName: 'staging-source.png',
        contentType: 'image/png',
        sizeBytes: sourcePng.length,
        purpose: 'library_asset',
        status: 'uploaded',
        metadata: { security: { scanStatus: 'clean' } },
      }
    : originalFindInput(id, requestedActor)

  await provisionProviderControls({ repositories, source, now })
  let providerCalls = 0
  const countedFetch = async (...args) => {
    providerCalls += 1
    return fetchImpl(...args)
  }
  const router = createRouter()
  registerCreativeRoutes(router, {
    repositories,
    source,
    executionSource: source,
    now: () => new Date(now),
    inputAssetReader: async (asset) => asset.id === inputAssetId ? { body: sourcePng } : null,
    openAIImageFetchImpl: countedFetch,
  })
  const server = createServer(router, {
    resolveUser: async (token) => token === authToken ? actor : null,
  })
  await listen(server)
  const address = server.address()
  const origin = `http://127.0.0.1:${address.port}`

  try {
    const sharedParameters = {
      aspectRatio: '1:1',
      stylePreset: 'poster',
      quality: 'low',
      outputCount: 1,
      outputFormat: 'png',
    }
    const textResult = await postGeneration(origin, {
      idempotencyKey: `image-staging-text-${now.getTime()}`,
      workspace: 'image',
      mode: 'text_to_image',
      providerId: 'openai-gpt-image-2',
      prompt: 'A simple cobalt square centered on a white background.',
      inputAssetIds: [],
      parameters: sharedParameters,
    })
    const textGeneration = assertCompletedGeneration(textResult, 'text_to_image')

    const editResult = await postGeneration(origin, {
      idempotencyKey: `image-staging-edit-${now.getTime()}`,
      workspace: 'image',
      mode: 'image_to_image',
      providerId: 'openai-gpt-image-2',
      prompt: 'Keep the composition and change the square to emerald green.',
      inputAssetIds: [inputAssetId],
      parameters: { ...sharedParameters, strength: 0.5 },
    })
    const editGeneration = assertCompletedGeneration(editResult, 'image_to_image')
    if (editGeneration.outputs[0].source?.lineage?.parents?.[0]?.assetId !== inputAssetId) {
      throw new Error('OpenAI Image input lineage acceptance failed')
    }

    const callsBeforeBlockedPrompt = providerCalls
    const blocked = await postGeneration(origin, {
      idempotencyKey: `image-staging-blocked-${now.getTime()}`,
      workspace: 'image',
      mode: 'text_to_image',
      providerId: 'openai-gpt-image-2',
      prompt: 'Create a graphic violence gore scene.',
      inputAssetIds: [],
      parameters: sharedParameters,
    })
    if (
      blocked.status !== 422 ||
      blocked.payload?.error?.code !== 'CREATIVE_MODERATION_BLOCKED' ||
      providerCalls !== callsBeforeBlockedPrompt
    ) {
      throw new Error('OpenAI Image pre-dispatch moderation acceptance failed')
    }

    const textLedger = await repositories.creativeProviderCosts.findForGeneration(textGeneration.id)
    const editLedger = await repositories.creativeProviderCosts.findForGeneration(editGeneration.id)
    if (!['settled', 'reconciliation_required'].includes(textLedger?.status)) {
      throw new Error('OpenAI Image text cost closeout acceptance failed')
    }
    if (!['settled', 'reconciliation_required'].includes(editLedger?.status)) {
      throw new Error('OpenAI Image edit cost closeout acceptance failed')
    }
    if (providerCalls !== 2) {
      throw new Error(`OpenAI Image staging Provider call count must be 2, received ${providerCalls}`)
    }

    return Object.freeze({
      schemaVersion: 'openai-image-staging-acceptance-v1',
      providerId: 'openai-gpt-image-2',
      modelId: 'gpt-image-2',
      providerCalls,
      textToImageCompleted: true,
      imageToImageCompleted: true,
      inputModerationPassed: true,
      outputScanPassed: true,
      persistedOutputCount: 2,
      lineageVerified: true,
      textCostStatus: textLedger.status,
      editCostStatus: editLedger.status,
      creditSettled: true,
      quotaCommitted: true,
      providerStateStored: false,
      productionNoGo: true,
    })
  } finally {
    await close(server)
  }
}

export const openAIImageStagingAcceptanceFixture = Object.freeze({ sourcePng })
