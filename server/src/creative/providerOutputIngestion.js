import { createHash, randomUUID } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'
import { buildCreativeIngestedArtifactMetadata } from './artifactBuilder.js'

const stableHash = (value) => createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex')

export const buildProviderOutputSourceKey = ({ generation, outputDigest, outputIndex }) =>
  `creative-output:${stableHash({
    generationId: generation.id,
    providerId: generation.provider?.id ?? generation.providerId,
    providerJobId: generation.providerJobId ?? null,
    outputDigest,
    outputIndex,
  })}`

const persistedOutput = ({ output, asset, ingestion }) => {
  const scanStatus = asset.metadata?.security?.scanStatus ?? 'pending'
  const downloadPath = `/api/media/assets/${asset.id}/download`
  return {
    ...output,
    contentType: asset.contentType,
    url: downloadPath,
    storage: {
      persisted: true,
      provider: 'media_asset',
      mediaAssetId: asset.id,
      scanStatus,
      downloadPath,
    },
    source: {
      ...output.source,
      persistedMediaAssetId: asset.id,
      ingestionSourceKey: ingestion.sourceKey,
    },
    mediaAsset: {
      id: asset.id,
      status: asset.status,
      purpose: asset.purpose,
      contentType: asset.contentType,
      scanStatus,
    },
  }
}

const safeFailureCode = (error) => String(error?.code ?? 'CREATIVE_PROVIDER_OUTPUT_INGESTION_FAILED').slice(0, 96)

const assertAssetContentIdentity = (asset, fetched) => {
  const identity = asset?.metadata?.ingestion
  if (
    asset?.contentType !== fetched.contentType ||
    Number(asset?.sizeBytes) !== fetched.sizeBytes ||
    identity?.sha256 !== fetched.sha256
  ) {
    throw new HttpError(409, 'CREATIVE_PROVIDER_OUTPUT_ASSET_CONFLICT', 'Creative Provider output asset identity does not match', {
      reasonCode: 'deterministic_asset_content_conflict',
    })
  }
}

export const ingestCreativeProviderOutput = async ({
  generation,
  output,
  outputDigest,
  outputIndex,
  actor,
  repositories,
  fetchOutput,
  now = new Date(),
  leaseSeconds = 60,
}) => {
  const ingestionRepository = repositories.creativeOutputIngestions
  if (!ingestionRepository?.record || !ingestionRepository?.claim || !ingestionRepository?.update) {
    throw new Error('creativeOutputIngestions repository is required')
  }
  if (!repositories.media?.createIngestedAsset) {
    throw new Error('media.createIngestedAsset repository is required')
  }
  const sourceKey = buildProviderOutputSourceKey({ generation, outputDigest, outputIndex })
  const recorded = await ingestionRepository.record({
    sourceKey,
    generationId: generation.id,
    providerId: generation.provider?.id ?? generation.providerId,
    providerJobId: generation.providerJobId ?? null,
    outputDigest,
    outputIndex,
  }, actor)
  let ingestion = recorded.ingestion
  if (ingestion.status === 'completed' && ingestion.mediaAssetId) {
    const asset = await repositories.media.find?.(ingestion.mediaAssetId)
    if (asset) return persistedOutput({ output, asset, ingestion })
  }

  const claimToken = `output-ingestion-${randomUUID()}`
  const claim = await ingestionRepository.claim(sourceKey, {
    claimToken,
    claimedAt: now.toISOString(),
    leaseExpiresAt: new Date(now.getTime() + leaseSeconds * 1000).toISOString(),
  })
  if (!claim.claimed) {
    if (claim.ingestion?.status === 'completed' && claim.ingestion.mediaAssetId) {
      const asset = await repositories.media.find?.(claim.ingestion.mediaAssetId)
      if (asset) return persistedOutput({ output, asset, ingestion: claim.ingestion })
    }
    throw new HttpError(409, 'CREATIVE_PROVIDER_OUTPUT_INGESTION_IN_PROGRESS', 'Creative Provider output ingestion is already in progress', {
      reasonCode: 'ingestion_claim_unavailable',
    })
  }
  ingestion = claim.ingestion
  try {
    if (typeof fetchOutput !== 'function') {
      throw new HttpError(503, 'CREATIVE_PROVIDER_OUTPUT_FETCH_DISABLED', 'Creative Provider output fetch adapter is not configured', {
        reasonCode: 'fetch_adapter_missing',
      })
    }
    const fetched = await fetchOutput({
      url: output.url,
      workspace: generation.workspace,
      declaredContentType: output.contentType,
    })
    const assetId = `media-output-${sourceKey.slice('creative-output:'.length, 48)}`
    const fileName = `${generation.workspace}-${generation.id}-${output.id}.${fetched.extension}`
    const storageKey = `${actor.handle}/generated/${generation.workspace}/${assetId}.${fetched.extension}`
    const metadata = buildCreativeIngestedArtifactMetadata({
      generation,
      output,
      ingestion: { sourceKey, ...fetched },
    })
    const asset = await repositories.media.createIngestedAsset({
      assetId,
      sourceKey,
      storageKey,
      fileName,
      body: fetched.body,
      contentType: fetched.contentType,
      sizeBytes: fetched.sizeBytes,
      sha256: fetched.sha256,
      generation,
      output,
      metadata,
    }, actor)
    if (!asset) throw new Error('Ingested media asset could not be created')
    assertAssetContentIdentity(asset, fetched)
    const completed = await ingestionRepository.update(ingestion.id, {
      status: 'completed',
      mediaAssetId: asset.id,
      storageKey: asset.storageKey,
      detectedContentType: fetched.contentType,
      sizeBytes: fetched.sizeBytes,
      sha256: fetched.sha256,
      errorCode: null,
      claimToken: null,
      claimedAt: null,
      leaseExpiresAt: null,
      completedAt: now.toISOString(),
    }, actor, { claimToken })
    if (completed?.status !== 'completed' || completed.mediaAssetId !== asset.id) {
      throw new HttpError(409, 'CREATIVE_PROVIDER_OUTPUT_INGESTION_CLAIM_LOST', 'Creative Provider output ingestion claim was lost', {
        reasonCode: 'claim_lost_before_completion',
      })
    }
    ingestion = completed
    return persistedOutput({ output, asset, ingestion })
  } catch (error) {
    await ingestionRepository.update(ingestion.id, {
      status: 'failed',
      errorCode: safeFailureCode(error),
      claimToken: null,
      claimedAt: null,
      leaseExpiresAt: null,
    }, actor, { claimToken })
    throw error
  }
}
