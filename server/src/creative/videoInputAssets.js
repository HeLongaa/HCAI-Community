import { fileTypeFromBuffer } from 'file-type'

import { HttpError } from '../common/errors/httpError.js'
import { validationFailed } from '../common/http/validation.js'

const imageContentTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])
const audioContentTypes = new Set(['audio/mpeg', 'audio/wav', 'audio/mp4'])
const imagePurposes = new Set(['submission_asset', 'profile_portfolio', 'library_asset'])
const musicPurposes = new Set(['submission_asset', 'profile_portfolio'])

const byteLimits = Object.freeze({
  image: 20 * 1024 * 1024,
  audio: 50 * 1024 * 1024,
  total: 60 * 1024 * 1024,
})

const extensionByContentType = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/mp4': 'm4a',
})

const unavailable = (reasonCode) => new HttpError(
  422,
  'CREATIVE_INPUT_ASSET_UNAVAILABLE',
  'Creative input asset is unavailable',
  { reasonCode },
)

const invalidBytes = (reasonCode) => new HttpError(
  422,
  'CREATIVE_VIDEO_INPUT_BYTES_INVALID',
  'Creative Video input bytes failed validation',
  { reasonCode },
)

export const videoInputRolesFor = (mode, inputAssetCount) => {
  if (mode === 'text_to_video') return inputAssetCount === 0 ? [] : null
  if (mode === 'image_to_video') return inputAssetCount === 1 ? ['source_image'] : null
  if (mode === 'music_video') {
    if (inputAssetCount === 1) return ['audio_track']
    if (inputAssetCount === 2) return ['audio_track', 'reference_image']
  }
  return null
}

const roleContract = (mode, role) => {
  if (mode === 'image_to_video' && role === 'source_image') {
    return { purposes: imagePurposes, contentTypes: imageContentTypes, kind: 'image' }
  }
  if (mode === 'music_video' && role === 'audio_track') {
    return { purposes: musicPurposes, contentTypes: audioContentTypes, kind: 'audio' }
  }
  if (mode === 'music_video' && role === 'reference_image') {
    return { purposes: musicPurposes, contentTypes: imageContentTypes, kind: 'image' }
  }
  return null
}

const safeAsset = (asset, role, kind) => Object.freeze({
  id: asset.id,
  role,
  kind,
  contentType: asset.contentType,
  sizeBytes: asset.sizeBytes,
  purpose: asset.purpose,
  scanStatus: asset.metadata?.security?.scanStatus ?? null,
})

export const resolveVideoGenerationInputs = async (request, {
  actor,
  mediaRepository,
} = {}) => {
  if (request.workspace !== 'video') return Object.freeze([])
  const roles = videoInputRolesFor(request.mode, request.inputAssetIds.length)
  if (!roles) throw validationFailed(`Video input roles are invalid for ${request.mode}`)
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
    const contract = roleContract(request.mode, roles[index])
    if (!contract) throw unavailable('role_not_allowed')
    if (!contract.purposes.has(asset.purpose)) throw unavailable('purpose_not_allowed')
    if (!contract.contentTypes.has(asset.contentType)) throw unavailable('content_type_not_allowed')
    if (asset.status !== 'uploaded') throw unavailable('asset_not_uploaded')
    if (asset.metadata?.security?.scanStatus !== 'clean') throw unavailable('asset_not_clean')
    if (!Number.isInteger(asset.sizeBytes) || asset.sizeBytes < 1 || asset.sizeBytes > byteLimits[contract.kind]) {
      throw unavailable('declared_size_not_allowed')
    }
    return safeAsset(asset, roles[index], contract.kind)
  }))
}

const detectedMimeMatches = (declared, detected) => {
  if (declared === detected) return true
  return declared === 'audio/mp4' && ['audio/x-m4a', 'video/mp4'].includes(detected)
}

export const readVideoGenerationInputFiles = async (resolvedInputAssets, inputAssetReader) => {
  if (resolvedInputAssets.length === 0) return Object.freeze([])
  if (typeof inputAssetReader !== 'function') {
    throw new HttpError(503, 'CREATIVE_INPUT_ASSET_READER_UNAVAILABLE', 'Creative input asset reader is unavailable')
  }
  let totalBytes = 0
  const files = []
  for (const asset of resolvedInputAssets) {
    const input = await inputAssetReader(asset)
    const body = Buffer.isBuffer(input?.body) ? input.body : Buffer.from(input?.body ?? [])
    if (body.length === 0) throw invalidBytes('input_empty')
    if (body.length !== asset.sizeBytes) throw invalidBytes('input_size_mismatch')
    if (body.length > byteLimits[asset.kind]) throw invalidBytes('input_size_exceeded')
    totalBytes += body.length
    if (totalBytes > byteLimits.total) throw invalidBytes('input_total_size_exceeded')
    const detected = await fileTypeFromBuffer(body)
    if (!detectedMimeMatches(asset.contentType, detected?.mime)) throw invalidBytes('input_magic_type_invalid')
    files.push(Object.freeze({
      assetId: asset.id,
      role: asset.role,
      kind: asset.kind,
      body,
      contentType: asset.contentType,
      extension: extensionByContentType[asset.contentType],
      sizeBytes: body.length,
    }))
  }
  return Object.freeze(files)
}

export const buildVideoOutputLineage = ({ generationId, mode, inputs }) => {
  if (inputs.length === 0) return null
  const relation = mode === 'image_to_video'
    ? 'animated_from'
    : mode === 'music_video'
      ? 'composed_from'
      : null
  if (!relation) return null
  return Object.freeze({
    schemaVersion: 'video-lineage-v1',
    generationId,
    relation,
    parents: inputs.map((asset) => Object.freeze({ assetId: asset.id, role: asset.role })),
  })
}

export const videoLineageInputsForRequest = (request) => {
  const roles = videoInputRolesFor(request.mode, request.inputAssetIds.length)
  if (!roles) return Object.freeze([])
  return Object.freeze(request.inputAssetIds.map((id, index) => Object.freeze({ id, role: roles[index] })))
}

export const attachVideoOutputLineage = (generation, inputs) => {
  if (generation.workspace !== 'video') return generation
  const lineage = buildVideoOutputLineage({
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

export const videoInputAssetContract = Object.freeze({
  schemaVersion: 'video-input-assets-v1',
  imageContentTypes: [...imageContentTypes],
  audioContentTypes: [...audioContentTypes],
  imagePurposes: [...imagePurposes],
  musicPurposes: [...musicPurposes],
  byteLimits,
})
