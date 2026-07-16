import type { ApiMediaAsset, MediaAssetPurpose } from './contracts'
import { mediaService } from './mediaService'

const checksumSha256 = async (file: Blob) => {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export const uploadMediaFile = async (file: File, options: {
  purpose: MediaAssetPurpose
  metadata?: unknown
}): Promise<ApiMediaAsset> => {
  const contentType = file.type || 'application/octet-stream'
  const contract = await mediaService.createUpload({
    fileName: file.name,
    contentType,
    sizeBytes: file.size,
    purpose: options.purpose,
    checksumSha256: await checksumSha256(file),
    metadata: options.metadata,
  })

  if (!contract.upload.url.startsWith('mock://')) {
    const response = await fetch(contract.upload.url, {
      method: contract.upload.method,
      headers: contract.upload.headers,
      body: file,
    })
    if (!response.ok) throw new Error(`Storage upload failed with status ${response.status}`)
  }

  return mediaService.completeUpload(contract.asset.id, { detectedContentType: contentType })
}
