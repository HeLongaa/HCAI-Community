import { createHash, createHmac } from 'node:crypto'

const defaultUploadTtlSeconds = 15 * 60
const defaultDownloadTtlSeconds = 5 * 60
const defaultScannerReadTtlSeconds = 10 * 60

const awsEncode = (value) =>
  encodeURIComponent(String(value)).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)

const toAmzDate = (date) => date.toISOString().replace(/[:-]|\.\d{3}/g, '')

const toDateStamp = (date) => toAmzDate(date).slice(0, 8)

const hmac = (key, value, encoding) => createHmac('sha256', key).update(value).digest(encoding)

const sha256Hex = (value) => createHash('sha256').update(value).digest('hex')

const sha256HmacHex = (key, value) => hmac(key, value, 'hex')

const getSigningKey = ({ secretAccessKey, dateStamp, region }) => {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp)
  const regionKey = hmac(dateKey, region)
  const serviceKey = hmac(regionKey, 's3')
  return hmac(serviceKey, 'aws4_request')
}

const trimSlash = (value) => String(value ?? '').replace(/\/+$/, '')

const privateDownloadConfig = (source) => {
  const baseUrl = trimSlash(source.STORAGE_PRIVATE_DOWNLOAD_BASE_URL)
  const signingSecret = String(source.STORAGE_PRIVATE_DOWNLOAD_SIGNING_SECRET ?? '').trim()
  if (Boolean(baseUrl) !== Boolean(signingSecret)) {
    throw new Error('STORAGE_PRIVATE_DOWNLOAD_BASE_URL and STORAGE_PRIVATE_DOWNLOAD_SIGNING_SECRET must be configured together')
  }
  return baseUrl ? {
    privateDownloadBaseUrl: baseUrl,
    privateDownloadSigningSecret: signingSecret,
    privateDownloadKeyId: String(source.STORAGE_PRIVATE_DOWNLOAD_KEY_ID ?? 'primary').trim() || 'primary',
  } : {}
}

const normalizeDriver = (source) => String(source.STORAGE_DRIVER ?? (source.STORAGE_BUCKET ? 's3' : 'mock')).trim().toLowerCase()

const boundedPositiveInteger = (value, fallback, maximum = 604800) => {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback
}

export const normalizeStorageChecksumSha256 = (value) => {
  const checksum = String(value ?? '').trim()
  if (/^[a-f0-9]{64}$/i.test(checksum)) return checksum.toLowerCase()
  if (/^[A-Za-z0-9+/]{43}=$/.test(checksum)) {
    const bytes = Buffer.from(checksum, 'base64')
    if (bytes.length === 32) return bytes.toString('hex')
  }
  throw new Error('checksumSha256 must be a SHA-256 hex or base64 digest')
}

const checksumBase64 = (value) => Buffer.from(normalizeStorageChecksumSha256(value), 'hex').toString('base64')

const requireS3Value = (source, key) => {
  const value = String(source[key] ?? '').trim()
  if (!value) {
    throw new Error(`${key} is required when STORAGE_DRIVER=s3`)
  }
  return value
}

export const buildStorageConfig = (source = process.env) => {
  const driver = normalizeDriver(source)
  if (!['mock', 's3'].includes(driver)) {
    throw new Error('STORAGE_DRIVER must be one of: mock, s3')
  }
  if (driver !== 's3') {
    return {
      driver: 'mock',
      uploadTtlSeconds: boundedPositiveInteger(source.STORAGE_UPLOAD_TTL_SECONDS, defaultUploadTtlSeconds),
      downloadTtlSeconds: boundedPositiveInteger(source.STORAGE_DOWNLOAD_TTL_SECONDS, defaultDownloadTtlSeconds),
      scannerReadTtlSeconds: boundedPositiveInteger(source.STORAGE_SCANNER_READ_TTL_SECONDS, defaultScannerReadTtlSeconds),
      ...privateDownloadConfig(source),
    }
  }
  return {
    driver: 's3',
    endpoint: trimSlash(requireS3Value(source, 'STORAGE_ENDPOINT')),
    region: requireS3Value(source, 'STORAGE_REGION'),
    bucket: requireS3Value(source, 'STORAGE_BUCKET'),
    accessKeyId: requireS3Value(source, 'STORAGE_ACCESS_KEY_ID'),
    secretAccessKey: requireS3Value(source, 'STORAGE_SECRET_ACCESS_KEY'),
    sessionToken: String(source.STORAGE_SESSION_TOKEN ?? '').trim() || null,
    uploadTtlSeconds: boundedPositiveInteger(source.STORAGE_UPLOAD_TTL_SECONDS, defaultUploadTtlSeconds),
    downloadTtlSeconds: boundedPositiveInteger(source.STORAGE_DOWNLOAD_TTL_SECONDS, defaultDownloadTtlSeconds),
    scannerReadTtlSeconds: boundedPositiveInteger(source.STORAGE_SCANNER_READ_TTL_SECONDS, defaultScannerReadTtlSeconds),
    ...privateDownloadConfig(source),
  }
}

const signMockUpload = ({ asset, expiresAt }) => ({
  provider: 'mock',
  method: 'PUT',
  url: `mock://media/${encodeURIComponent(asset.storageKey)}?expiresAt=${encodeURIComponent(expiresAt.toISOString())}`,
  headers: {
    'content-type': asset.contentType,
  },
  expiresAt: expiresAt.toISOString(),
})

const signMockDownload = ({ asset, expiresAt }) => ({
  provider: 'mock',
  method: 'GET',
  url: `mock://media/${encodeURIComponent(asset.storageKey)}?download=1&expiresAt=${encodeURIComponent(expiresAt.toISOString())}`,
  headers: {},
  expiresAt: expiresAt.toISOString(),
})

const signS3Request = ({ asset, config, now, expiresAt, ttlSeconds, method, signedHeaders, extraHeaders = {} }) => {
  const endpointUrl = new URL(config.endpoint)
  const amzDate = toAmzDate(now)
  const dateStamp = toDateStamp(now)
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`
  const keyPath = asset.storageKey.split('/').map(awsEncode).join('/')
  const basePath = endpointUrl.pathname === '/' ? '' : endpointUrl.pathname.replace(/\/+$/, '')
  const canonicalUri = `${basePath}/${awsEncode(config.bucket)}/${keyPath}`
  const credential = `${config.accessKeyId}/${credentialScope}`
  const query = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': credential,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(Math.max(1, Math.min(ttlSeconds, 604800))),
    'X-Amz-SignedHeaders': signedHeaders,
    ...(config.sessionToken ? { 'X-Amz-Security-Token': config.sessionToken } : {}),
  }
  const canonicalQueryString = Object.entries(query)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${awsEncode(key)}=${awsEncode(value)}`)
    .join('&')
  const canonicalHeaders = signedHeaders
    .split(';')
    .map((header) => `${header}:${header === 'host' ? endpointUrl.host : extraHeaders[header]}`)
    .join('\n') + '\n'
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n')
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ]
  const signingKey = getSigningKey({ secretAccessKey: config.secretAccessKey, dateStamp, region: config.region })
  const signature = sha256HmacHex(signingKey, stringToSign.join('\n'))
  return {
    provider: 's3',
    method,
    url: `${endpointUrl.origin}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`,
    headers: extraHeaders,
    expiresAt: expiresAt.toISOString(),
  }
}

const signS3Upload = (params) => signS3Request({
  ...params,
  method: 'PUT',
  signedHeaders: 'content-length;content-type;host;x-amz-checksum-sha256',
  extraHeaders: {
    'content-length': String(params.asset.sizeBytes),
    'content-type': params.asset.contentType,
    'x-amz-checksum-sha256': checksumBase64(params.asset.checksumSha256),
  },
})

const signS3Download = (params) => signS3Request({
  ...params,
  method: 'GET',
  signedHeaders: 'host',
})

const signS3Head = (params) => signS3Request({
  ...params,
  method: 'HEAD',
  signedHeaders: 'host;x-amz-checksum-mode',
  extraHeaders: {
    'x-amz-checksum-mode': 'ENABLED',
  },
})

const signS3Delete = (params) => signS3Request({
  ...params,
  method: 'DELETE',
  signedHeaders: 'host',
})

const signPrivateDownload = ({ asset, config, expiresAt }) => {
  const keyPath = asset.storageKey.split('/').map(awsEncode).join('/')
  const path = `/${keyPath}`
  const expires = String(Math.floor(expiresAt.getTime() / 1000))
  const keyId = config.privateDownloadKeyId
  const signature = createHmac('sha256', config.privateDownloadSigningSecret)
    .update(`${path}\n${expires}\n${keyId}`)
    .digest('base64url')
  return {
    provider: 'private-cdn',
    method: 'GET',
    url: `${config.privateDownloadBaseUrl}${path}?expires=${expires}&keyId=${awsEncode(keyId)}&signature=${awsEncode(signature)}`,
    headers: {},
    expiresAt: expiresAt.toISOString(),
  }
}

const contractTimes = (config, now, ttlKey) => {
  const ttlSeconds = Math.max(1, Math.min(config[ttlKey], 604800))
  return { ttlSeconds, expiresAt: new Date(now.getTime() + ttlSeconds * 1000) }
}

export const signMediaUpload = (asset, options = {}) => {
  const config = options.config ?? buildStorageConfig(options.source ?? process.env)
  const now = options.now ?? new Date()
  const { ttlSeconds, expiresAt } = contractTimes(config, now, 'uploadTtlSeconds')
  if (config.driver === 's3') {
    if (!Number.isInteger(asset.sizeBytes) || asset.sizeBytes < 1) throw new Error('sizeBytes is required for S3 uploads')
    if (!asset.checksumSha256) throw new Error('checksumSha256 is required for S3 uploads')
    return signS3Upload({ asset, config, now, expiresAt, ttlSeconds })
  }
  return signMockUpload({ asset, expiresAt })
}

export const signMediaDownload = (asset, options = {}) => {
  const config = options.config ?? buildStorageConfig(options.source ?? process.env)
  const now = options.now ?? new Date()
  const { ttlSeconds, expiresAt } = contractTimes(config, now, 'downloadTtlSeconds')
  if (config.privateDownloadBaseUrl) return signPrivateDownload({ asset, config, expiresAt })
  if (config.driver === 's3') {
    return signS3Download({ asset, config, now, expiresAt, ttlSeconds })
  }
  return signMockDownload({ asset, expiresAt })
}

export const signMediaScannerDownload = (asset, options = {}) => {
  const config = options.config ?? buildStorageConfig(options.source ?? process.env)
  const now = options.now ?? new Date()
  const { ttlSeconds, expiresAt } = contractTimes(config, now, 'scannerReadTtlSeconds')
  if (config.driver === 's3') return signS3Download({ asset, config, now, expiresAt, ttlSeconds })
  return signMockDownload({ asset, expiresAt })
}

export const signMediaObjectHead = (asset, options = {}) => {
  const config = options.config ?? buildStorageConfig(options.source ?? process.env)
  const now = options.now ?? new Date()
  const { ttlSeconds, expiresAt } = contractTimes(config, now, 'uploadTtlSeconds')
  if (config.driver === 's3') return signS3Head({ asset, config, now, expiresAt, ttlSeconds })
  return { provider: 'mock', method: 'HEAD', url: `mock://media/${encodeURIComponent(asset.storageKey)}`, headers: {}, expiresAt: expiresAt.toISOString() }
}

export const signMediaObjectDelete = (asset, options = {}) => {
  const config = options.config ?? buildStorageConfig(options.source ?? process.env)
  const now = options.now ?? new Date()
  const { ttlSeconds, expiresAt } = contractTimes(config, now, 'uploadTtlSeconds')
  if (config.driver === 's3') return signS3Delete({ asset, config, now, expiresAt, ttlSeconds })
  return { provider: 'mock', method: 'DELETE', url: `mock://media/${encodeURIComponent(asset.storageKey)}`, headers: {}, expiresAt: expiresAt.toISOString() }
}
