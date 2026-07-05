import { createHash, createHmac } from 'node:crypto'

const defaultUploadTtlSeconds = 15 * 60

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

const normalizeDriver = (source) => String(source.STORAGE_DRIVER ?? (source.STORAGE_BUCKET ? 's3' : 'mock')).trim().toLowerCase()

const requireS3Value = (source, key) => {
  const value = String(source[key] ?? '').trim()
  if (!value) {
    throw new Error(`${key} is required when STORAGE_DRIVER=s3`)
  }
  return value
}

export const buildStorageConfig = (source = process.env) => {
  const driver = normalizeDriver(source)
  if (driver !== 's3') {
    return {
      driver: 'mock',
      uploadTtlSeconds: Number.parseInt(source.STORAGE_UPLOAD_TTL_SECONDS ?? '', 10) || defaultUploadTtlSeconds,
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
    uploadTtlSeconds: Number.parseInt(source.STORAGE_UPLOAD_TTL_SECONDS ?? '', 10) || defaultUploadTtlSeconds,
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

const signS3Request = ({ asset, config, now, expiresAt, method, signedHeaders, extraHeaders = {} }) => {
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
    'X-Amz-Expires': String(Math.max(1, Math.min(config.uploadTtlSeconds, 604800))),
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
  signedHeaders: 'content-type;host',
  extraHeaders: {
    'content-type': params.asset.contentType,
  },
})

const signS3Download = (params) => signS3Request({
  ...params,
  method: 'GET',
  signedHeaders: 'host',
})

export const signMediaUpload = (asset, options = {}) => {
  const config = options.config ?? buildStorageConfig(options.source ?? process.env)
  const now = options.now ?? new Date()
  const ttlSeconds = Math.max(1, Math.min(config.uploadTtlSeconds, 604800))
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000)
  if (config.driver === 's3') {
    return signS3Upload({ asset, config, now, expiresAt })
  }
  return signMockUpload({ asset, expiresAt })
}

export const signMediaDownload = (asset, options = {}) => {
  const config = options.config ?? buildStorageConfig(options.source ?? process.env)
  const now = options.now ?? new Date()
  const ttlSeconds = Math.max(1, Math.min(config.uploadTtlSeconds, 604800))
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000)
  if (config.driver === 's3') {
    return signS3Download({ asset, config, now, expiresAt })
  }
  return signMockDownload({ asset, expiresAt })
}
