import { signMediaUpload } from './uploadSigner.js'

export const writeStorageObject = async ({ body, contentType, storageKey }, options = {}) => {
  const now = options.now ?? new Date()
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body, null, 2)
  const asset = {
    storageKey,
    contentType,
  }
  const upload = signMediaUpload(asset, { now, source: options.source ?? process.env })
  const bytes = Buffer.byteLength(payload)
  if (upload.provider === 'mock') {
    return {
      provider: 'mock',
      storageKey,
      url: upload.url,
      bytes,
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
    statusCode: response.status,
    writtenAt: now.toISOString(),
  }
}
