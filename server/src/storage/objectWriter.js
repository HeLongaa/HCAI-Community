import { createHash } from 'node:crypto'

import { signMediaUpload } from './uploadSigner.js'

export const writeStorageObject = async ({ body, contentType, storageKey }, options = {}) => {
  const now = options.now ?? new Date()
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body, null, 2)
  const bytes = Buffer.byteLength(payload)
  const asset = {
    storageKey,
    contentType,
    sizeBytes: bytes,
    checksumSha256: createHash('sha256').update(payload).digest('hex'),
  }
  const upload = signMediaUpload(asset, { now, source: options.source ?? process.env })
  if (upload.provider === 'mock') {
    return {
      provider: 'mock',
      storageKey,
      url: upload.url,
      bytes,
      checksumSha256: asset.checksumSha256,
      writtenAt: now.toISOString(),
    }
  }
  const response = await fetch(upload.url, {
    method: upload.method,
    headers: upload.headers,
    body: payload,
  })
  if (!response.ok) {
    throw new Error(`Storage object upload failed with HTTP ${response.status}`)
  }
  return {
    provider: upload.provider,
    storageKey,
    url: upload.url.split('?')[0],
    bytes,
    checksumSha256: asset.checksumSha256,
    statusCode: response.status,
    writtenAt: now.toISOString(),
  }
}
