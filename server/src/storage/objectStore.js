import { buildStorageConfig, normalizeStorageChecksumSha256, signMediaObjectDelete, signMediaObjectHead } from './uploadSigner.js'

const normalizedContentType = (value) => String(value ?? '').split(';', 1)[0].trim().toLowerCase()

export class StorageObjectError extends Error {
  constructor(code, message, options = {}) {
    super(message)
    this.name = 'StorageObjectError'
    this.code = code
    this.statusCode = options.statusCode ?? null
    this.retryable = Boolean(options.retryable)
  }
}

const responseChecksumHex = (headers) => {
  const checksum = headers.get('x-amz-checksum-sha256') || headers.get('x-storage-checksum-sha256')
  return checksum ? normalizeStorageChecksumSha256(checksum) : null
}

export const inspectStorageObject = async (asset, options = {}) => {
  const config = options.config ?? buildStorageConfig(options.source ?? process.env)
  const now = options.now ?? new Date()
  if (config.driver === 'mock') {
    return {
      provider: 'mock',
      etag: null,
      checksumSha256: asset.checksumSha256 ? normalizeStorageChecksumSha256(asset.checksumSha256) : null,
      sizeBytes: asset.sizeBytes,
      contentType: normalizedContentType(asset.contentType),
      verifiedAt: now.toISOString(),
    }
  }

  const contract = signMediaObjectHead(asset, { config, now })
  let response
  try {
    response = await (options.fetchImpl ?? fetch)(contract.url, {
      method: contract.method,
      headers: contract.headers,
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    })
  } catch (error) {
    throw new StorageObjectError('STORAGE_HEAD_UNAVAILABLE', 'Storage object verification request failed', { retryable: true, cause: error })
  }
  if (response.status === 404) throw new StorageObjectError('STORAGE_OBJECT_NOT_FOUND', 'Uploaded object was not found', { statusCode: 404 })
  if (!response.ok) {
    throw new StorageObjectError('STORAGE_HEAD_FAILED', `Storage object verification failed with HTTP ${response.status}`, {
      statusCode: response.status,
      retryable: response.status >= 500 || response.status === 429,
    })
  }

  const sizeBytes = Number.parseInt(response.headers.get('content-length') ?? '', 10)
  const contentType = normalizedContentType(response.headers.get('content-type'))
  const checksumSha256 = responseChecksumHex(response.headers)
  const expectedChecksum = asset.checksumSha256 ? normalizeStorageChecksumSha256(asset.checksumSha256) : null
  if (!Number.isInteger(sizeBytes) || sizeBytes !== asset.sizeBytes) {
    throw new StorageObjectError('STORAGE_SIZE_MISMATCH', 'Uploaded object size does not match the declared size')
  }
  if (!contentType || contentType !== normalizedContentType(asset.contentType)) {
    throw new StorageObjectError('STORAGE_CONTENT_TYPE_MISMATCH', 'Uploaded object content type does not match the declared type')
  }
  if (expectedChecksum && checksumSha256 !== expectedChecksum) {
    throw new StorageObjectError('STORAGE_CHECKSUM_MISMATCH', 'Uploaded object checksum does not match the declared checksum')
  }
  return {
    provider: 's3',
    etag: response.headers.get('etag')?.replace(/^"|"$/g, '') || null,
    checksumSha256,
    sizeBytes,
    contentType,
    verifiedAt: now.toISOString(),
  }
}

export const deleteStorageObject = async (asset, options = {}) => {
  const config = options.config ?? buildStorageConfig(options.source ?? process.env)
  const now = options.now ?? new Date()
  if (config.driver === 'mock') return { provider: 'mock', deletedAt: now.toISOString(), statusCode: null }
  const contract = signMediaObjectDelete(asset, { config, now })
  let response
  try {
    response = await (options.fetchImpl ?? fetch)(contract.url, {
      method: contract.method,
      headers: contract.headers,
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    })
  } catch (error) {
    throw new StorageObjectError('STORAGE_DELETE_UNAVAILABLE', 'Storage object delete request failed', { retryable: true, cause: error })
  }
  if (!response.ok && response.status !== 404) {
    throw new StorageObjectError('STORAGE_DELETE_FAILED', `Storage object delete failed with HTTP ${response.status}`, {
      statusCode: response.status,
      retryable: response.status >= 500 || response.status === 429,
    })
  }
  return { provider: 's3', deletedAt: now.toISOString(), statusCode: response.status }
}
