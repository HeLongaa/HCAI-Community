import { createHash } from 'node:crypto'

import { signMediaUpload } from './uploadSigner.js'

const archiveKey = (now = new Date()) =>
  `archives/media-scan-jobs/${now.toISOString().slice(0, 10)}/manifest-${now.toISOString().replace(/[:.]/g, '-')}.json`

export const writeJsonArchive = async (payload, options = {}) => {
  const now = options.now ?? new Date()
  const body = JSON.stringify(payload, null, 2)
  const bytes = Buffer.byteLength(body)
  const asset = {
    storageKey: options.storageKey ?? archiveKey(now),
    contentType: 'application/json',
    sizeBytes: bytes,
    checksumSha256: createHash('sha256').update(body).digest('hex'),
  }
  const upload = signMediaUpload(asset, { now, source: options.source ?? process.env })
  if (upload.provider === 'mock') {
    return {
      provider: 'mock',
      storageKey: asset.storageKey,
      url: upload.url,
      bytes,
      checksumSha256: asset.checksumSha256,
      writtenAt: now.toISOString(),
    }
  }
  const response = await fetch(upload.url, {
    method: upload.method,
    headers: upload.headers,
    body,
  })
  if (!response.ok) {
    throw new Error(`Archive upload failed with HTTP ${response.status}`)
  }
  return {
    provider: upload.provider,
    storageKey: asset.storageKey,
    url: upload.url.split('?')[0],
    bytes,
    checksumSha256: asset.checksumSha256,
    statusCode: response.status,
    writtenAt: now.toISOString(),
  }
}
