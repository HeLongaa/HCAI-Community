import { HttpError } from '../common/errors/httpError.js'
import { validationFailed } from '../common/http/validation.js'

const allowedPurposes = new Set(['submission_asset', 'profile_portfolio', 'library_asset'])
const allowedContentTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])

const modeRoles = Object.freeze({
  text_to_image: [],
  image_to_image: ['source'],
  image_edit: ['source', 'mask'],
  image_variation: ['source'],
})

const relationByMode = Object.freeze({
  image_to_image: 'derived_from',
  image_edit: 'edited_from',
  image_variation: 'variation_of',
})

const unavailable = (reasonCode) => new HttpError(
  422,
  'CREATIVE_INPUT_ASSET_UNAVAILABLE',
  'Creative input asset is unavailable',
  { reasonCode },
)

const safeAsset = (asset, role) => Object.freeze({
  id: asset.id,
  role,
  contentType: asset.contentType,
  sizeBytes: asset.sizeBytes,
  purpose: asset.purpose,
  scanStatus: asset.metadata?.security?.scanStatus ?? null,
})

export const resolveImageGenerationInputs = async (request, {
  actor,
  mediaRepository,
} = {}) => {
  if (request.workspace !== 'image') return Object.freeze([])
  const roles = modeRoles[request.mode]
  if (!roles) throw validationFailed(`Unsupported image input mode: ${request.mode}`)
  if (request.inputAssetIds.length !== roles.length) {
    throw validationFailed(`inputAssetIds must include ${roles.length} image asset(s) for ${request.mode}`)
  }
  if (new Set(request.inputAssetIds).size !== request.inputAssetIds.length) {
    throw validationFailed('inputAssetIds must not contain duplicate assets')
  }
  if (roles.length === 0) return Object.freeze([])
  if (!mediaRepository?.findAccessibleCreativeInput) {
    throw new HttpError(503, 'CREATIVE_INPUT_ASSET_REPOSITORY_UNAVAILABLE', 'Creative input asset validation is unavailable')
  }

  const assets = await Promise.all(request.inputAssetIds.map((assetId) =>
    mediaRepository.findAccessibleCreativeInput(assetId, actor)))
  return Object.freeze(assets.map((asset, index) => {
    if (!asset) throw unavailable('not_found_or_forbidden')
    if (!allowedPurposes.has(asset.purpose)) throw unavailable('purpose_not_allowed')
    if (!allowedContentTypes.has(asset.contentType)) throw unavailable('content_type_not_allowed')
    if (asset.status !== 'uploaded') throw unavailable('asset_not_uploaded')
    if (asset.metadata?.security?.scanStatus !== 'clean') throw unavailable('asset_not_clean')
    if (roles[index] === 'mask' && asset.contentType !== 'image/png') throw unavailable('mask_must_be_png')
    return safeAsset(asset, roles[index])
  }))
}

export const buildImageOutputLineage = ({ generationId, mode, inputs }) => {
  const relation = relationByMode[mode]
  if (!relation || inputs.length === 0) return null
  return Object.freeze({
    schemaVersion: 'image-lineage-v1',
    generationId,
    relation,
    parents: inputs.map((asset) => Object.freeze({ assetId: asset.id, role: asset.role })),
  })
}

export const attachImageOutputLineage = (generation, inputs) => {
  const lineage = buildImageOutputLineage({
    generationId: generation.id,
    mode: generation.mode,
    inputs,
  })
  if (!lineage) return generation
  return {
    ...generation,
    outputs: generation.outputs.map((output) => ({
      ...output,
      source: { ...output.source, lineage },
    })),
  }
}

export const imageInputAssetContract = Object.freeze({
  schemaVersion: 'image-input-assets-v1',
  allowedPurposes: [...allowedPurposes],
  allowedContentTypes: [...allowedContentTypes],
  modeRoles,
  relationByMode,
})
