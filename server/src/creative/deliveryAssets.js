import { HttpError } from '../common/errors/httpError.js'

export const creativeDeliveryTargets = Object.freeze({
  task_submission: Object.freeze(['submission_asset', 'profile_portfolio', 'library_asset']),
  private_library: Object.freeze(['submission_asset', 'profile_portfolio', 'library_asset']),
  profile_portfolio: Object.freeze(['submission_asset', 'profile_portfolio', 'library_asset']),
})

const asObject = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const safeEvidenceFileName = (value) => String(value ?? '')
  .split(/[\\/]/).at(-1)
  ?.replace(/[\u0000-\u001f\u007f]/g, '_')
  .slice(0, 180) || 'asset'

const ownerMatches = (asset, actor) => {
  if (asset.ownerId && actor?.id) return String(asset.ownerId) === String(actor.id)
  return Boolean(asset.ownerHandle && actor?.handle && asset.ownerHandle === actor.handle)
}

const generationMatches = (generation, asset, actor) => {
  if (!generation || generation.status !== 'completed' || !generation.outputAssetIds?.includes(asset.id)) return false
  if (generation.actorId && actor?.id) return String(generation.actorId) === String(actor.id)
  return Boolean(generation.actorHandle && actor?.handle && generation.actorHandle === actor.handle)
}

export const evaluateCreativeDeliveryAsset = ({ asset, generation, actor, target }) => {
  if (!asset) return { eligible: false, code: 'ASSET_NOT_FOUND' }
  if (!ownerMatches(asset, actor)) return { eligible: false, code: 'ASSET_OWNER_MISMATCH' }
  if (asset.deletedAt) return { eligible: false, code: 'ASSET_DELETED' }
  if (asset.archivedAt) return { eligible: false, code: 'ASSET_ARCHIVED' }
  if (asset.status !== 'uploaded') return { eligible: false, code: 'ASSET_NOT_UPLOADED' }
  if (asObject(asset.metadata).security?.scanStatus !== 'clean') return { eligible: false, code: 'ASSET_SCAN_NOT_CLEAN' }
  if (!creativeDeliveryTargets[target]?.includes(asset.purpose)) return { eligible: false, code: 'ASSET_PURPOSE_INCOMPATIBLE' }
  if (!generationMatches(generation, asset, actor)) return { eligible: false, code: 'ASSET_GENERATION_EVIDENCE_MISSING' }
  return { eligible: true, code: null }
}

export const assertCreativeDeliveryAsset = (input) => {
  const result = evaluateCreativeDeliveryAsset(input)
  if (!result.eligible) {
    throw new HttpError(409, result.code, 'Asset is not eligible for this delivery target')
  }
  return input.asset
}

export const buildCreativeAssetEvidence = (asset, generation, capturedAt = new Date()) => ({
  assetId: String(asset.id),
  fileName: safeEvidenceFileName(asset.fileName),
  contentType: String(asset.contentType),
  purpose: String(asset.purpose),
  sourceGeneration: {
    id: String(generation.id),
    workspace: String(generation.workspace),
    mode: String(generation.mode),
    status: String(generation.status),
  },
  governance: {
    assetStatus: String(asset.status),
    scanStatus: String(asObject(asset.metadata).security?.scanStatus ?? ''),
    archived: Boolean(asset.archivedAt),
    deleted: Boolean(asset.deletedAt),
    capturedAt: capturedAt instanceof Date ? capturedAt.toISOString() : String(capturedAt),
  },
})

export const resolveCreativeDeliveryAssets = ({ assetIds, assets, generations, actor, target, capturedAt = new Date() }) => {
  const uniqueIds = [...new Set((assetIds ?? []).map(String))]
  const assetById = new Map((assets ?? []).map((asset) => [String(asset.id), asset]))
  const generationByAssetId = new Map()
  for (const generation of generations ?? []) {
    for (const assetId of generation.outputAssetIds ?? []) generationByAssetId.set(String(assetId), generation)
  }
  return uniqueIds.map((assetId) => {
    const asset = assetById.get(assetId) ?? null
    const generation = generationByAssetId.get(assetId) ?? null
    assertCreativeDeliveryAsset({ asset, generation, actor, target })
    return { asset, generation, evidence: buildCreativeAssetEvidence(asset, generation, capturedAt) }
  })
}
