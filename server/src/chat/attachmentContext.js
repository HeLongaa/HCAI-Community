import { HttpError } from '../common/errors/httpError.js'
import { chatCapabilityContract } from '../creative/chatCapabilityContract.js'

const unavailable = (reasonCode, index) => new HttpError(
  422,
  'CHAT_ATTACHMENT_UNAVAILABLE',
  'A selected Chat attachment is unavailable',
  { reasonCode, index },
)

export const resolveChatAttachments = async (inputAssetIds, actor, mediaRepository) => {
  const contract = chatCapabilityContract.context.attachments
  if (inputAssetIds.length === 0) return Object.freeze([])
  if (!mediaRepository?.findOwnedChatInput) {
    throw new HttpError(503, 'CHAT_ATTACHMENT_VALIDATION_UNAVAILABLE', 'Chat attachment validation is unavailable')
  }
  const assets = await Promise.all(inputAssetIds.map((assetId) => mediaRepository.findOwnedChatInput(assetId, actor)))
  let totalBytes = 0
  const resolved = assets.map((asset, index) => {
    if (!asset) throw unavailable('not_found_or_forbidden', index)
    if (!contract.purposes.includes(asset.purpose)) throw unavailable('purpose_not_allowed', index)
    if (!contract.contentTypes.includes(asset.contentType)) throw unavailable('content_type_not_allowed', index)
    if (asset.status !== 'uploaded') throw unavailable('asset_not_uploaded', index)
    if (asset.metadata?.security?.scanStatus !== 'clean') throw unavailable('asset_not_clean', index)
    if (asset.sizeBytes > contract.maximumBytesPerAsset) throw unavailable('asset_too_large', index)
    totalBytes += asset.sizeBytes
    if (totalBytes > contract.maximumTotalBytes) throw unavailable('total_size_exceeded', index)
    return Object.freeze({
      id: asset.id,
      fileName: asset.fileName,
      contentType: asset.contentType,
      sizeBytes: asset.sizeBytes,
      purpose: asset.purpose,
      scanStatus: 'clean',
      ...(asset.storageKey ? { storageKey: asset.storageKey } : {}),
    })
  })
  return Object.freeze(resolved)
}
