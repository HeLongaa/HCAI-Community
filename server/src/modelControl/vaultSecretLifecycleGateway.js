import { createHash, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const maxBodyBytes = 16_384
const maxVaultResponseBytes = 16_384
const lifecyclePath = '/v1/lifecycle'
const requestKeys = Object.freeze(['action', 'externalVersion', 'requestedAt', 'schemaVersion', 'secretRef'])
const actions = new Set(['disable', 'delete'])

const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex')
const boundedInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback
}
const safeEqual = (left, right) => timingSafeEqual(
  createHash('sha256').update(String(left)).digest(),
  createHash('sha256').update(String(right)).digest(),
)
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
const validPathSegments = (value) => {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,240}$/.test(value) || value.includes('//')) return false
  return value.split('/').every((segment) => segment && segment !== '.' && segment !== '..')
}
const encodeVaultPath = (value) => value.split('/').map(encodeURIComponent).join('/')

const readSecretFile = (file, label, readFile) => {
  if (!path.isAbsolute(file)) throw new Error(`${label} must be an absolute path`)
  let value = ''
  try { value = String(readFile(file, 'utf8')).trim() } catch { throw new Error(`${label} is unreadable`) }
  if (value.length < 16 || value.length > 4096) throw new Error(`${label} has an invalid length`)
  return value
}

export const vaultSecretLifecycleGatewayContract = Object.freeze({
  schemaVersion: 1,
  lifecyclePath,
  maxBodyBytes,
  maxVaultResponseBytes,
  actions: Object.freeze([...actions]),
})

export const buildVaultSecretLifecycleGatewayConfig = (source = process.env, { readFile = readFileSync } = {}) => {
  const vaultAddress = new URL(String(source.SECRET_LIFECYCLE_VAULT_ADDR ?? '').trim())
  if (vaultAddress.protocol !== 'https:' || vaultAddress.username || vaultAddress.password || vaultAddress.search || vaultAddress.hash || vaultAddress.pathname !== '/') {
    throw new Error('SECRET_LIFECYCLE_VAULT_ADDR must be a fixed HTTPS origin')
  }
  const deploymentEnv = String(source.DEPLOYMENT_ENV ?? '').trim().toLowerCase()
  const managedVaultConfirmation = String(source.SECRET_LIFECYCLE_MANAGED_VAULT_CONFIRMATION ?? '').trim()
  if (deploymentEnv === 'production' && managedVaultConfirmation !== 'ha-auto-unseal-backed-vault') {
    throw new Error('Production secret lifecycle requires an HA auto-unseal-backed managed Vault confirmation')
  }
  const mount = String(source.SECRET_LIFECYCLE_VAULT_KV_MOUNT ?? '').trim()
  const vaultPathPrefix = String(source.SECRET_LIFECYCLE_VAULT_PATH_PREFIX ?? '').trim().replace(/\/$/, '')
  const secretRefPrefix = String(source.SECRET_LIFECYCLE_SECRET_REF_PREFIX ?? '').trim()
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(mount)) throw new Error('SECRET_LIFECYCLE_VAULT_KV_MOUNT is invalid')
  if (!validPathSegments(vaultPathPrefix)) throw new Error('SECRET_LIFECYCLE_VAULT_PATH_PREFIX is invalid')
  if (!/^secret:\/\/[a-zA-Z0-9][a-zA-Z0-9._/-]{2,180}\/$/.test(secretRefPrefix) || secretRefPrefix.includes('//', 9)) {
    throw new Error('SECRET_LIFECYCLE_SECRET_REF_PREFIX is invalid')
  }
  const bearerTokenFile = String(source.SECRET_LIFECYCLE_GATEWAY_BEARER_TOKEN_FILE ?? '').trim()
  const vaultTokenFile = String(source.SECRET_LIFECYCLE_VAULT_TOKEN_FILE ?? '').trim()
  readSecretFile(bearerTokenFile, 'SECRET_LIFECYCLE_GATEWAY_BEARER_TOKEN_FILE', readFile)
  readSecretFile(vaultTokenFile, 'SECRET_LIFECYCLE_VAULT_TOKEN_FILE', readFile)
  return Object.freeze({
    vaultAddress,
    mount,
    vaultPathPrefix,
    secretRefPrefix,
    bearerTokenFile,
    vaultTokenFile,
    vaultTimeoutMs: boundedInteger(source.SECRET_LIFECYCLE_VAULT_TIMEOUT_MS, 5000, 500, 30_000),
  })
}

const readBoundedRequestJson = async (request) => {
  const declared = Number.parseInt(String(request.headers['content-length'] ?? ''), 10)
  if (Number.isFinite(declared) && declared > maxBodyBytes) throw Object.assign(new Error('request_too_large'), { statusCode: 413 })
  let total = 0
  const chunks = []
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.byteLength
    if (total > maxBodyBytes) throw Object.assign(new Error('request_too_large'), { statusCode: 413 })
    chunks.push(buffer)
  }
  try { return JSON.parse(Buffer.concat(chunks, total).toString('utf8')) } catch { throw Object.assign(new Error('invalid_json'), { statusCode: 400 }) }
}

const readBoundedVaultJson = async (response) => {
  const declared = Number.parseInt(String(response.headers?.get?.('content-length') ?? ''), 10)
  if (Number.isFinite(declared) && declared > maxVaultResponseBytes) throw new Error('vault_response_too_large')
  if (!response.body || typeof response.body.getReader !== 'function') throw new Error('vault_response_body_missing')
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxVaultResponseBytes) throw new Error('vault_response_too_large')
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength))
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  return JSON.parse(Buffer.concat(chunks, total).toString('utf8'))
}

const sendJson = (response, statusCode, payload) => {
  const body = JSON.stringify(payload)
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  })
  response.end(body)
}

const parseLifecycleRequest = (request, payload, config) => {
  if (!isPlainObject(payload) || Object.keys(payload).sort().join(',') !== requestKeys.join(',')) throw Object.assign(new Error('invalid_payload'), { statusCode: 400 })
  if (payload.schemaVersion !== 1 || !actions.has(payload.action)) throw Object.assign(new Error('invalid_payload'), { statusCode: 400 })
  if (typeof payload.secretRef !== 'string' || !payload.secretRef.startsWith(config.secretRefPrefix)) throw Object.assign(new Error('target_not_allowed'), { statusCode: 403 })
  const suffix = payload.secretRef.slice(config.secretRefPrefix.length)
  if (!validPathSegments(suffix)) throw Object.assign(new Error('target_not_allowed'), { statusCode: 403 })
  const versionMatch = String(payload.externalVersion ?? '').match(/^v?([1-9][0-9]{0,9})$/)
  if (!versionMatch) throw Object.assign(new Error('invalid_payload'), { statusCode: 400 })
  const requestedAt = new Date(payload.requestedAt)
  if (typeof payload.requestedAt !== 'string' || !Number.isFinite(requestedAt.getTime()) || requestedAt.toISOString() !== payload.requestedAt) {
    throw Object.assign(new Error('invalid_payload'), { statusCode: 400 })
  }
  const targetHash = sha256(`${payload.secretRef}:${payload.externalVersion}`)
  const expectedIdempotencyKey = `secret-lifecycle:${payload.action}:${targetHash}`
  if (!safeEqual(request.headers['idempotency-key'] ?? '', expectedIdempotencyKey)) throw Object.assign(new Error('invalid_idempotency_key'), { statusCode: 409 })
  return { action: payload.action, version: Number(versionMatch[1]), vaultPath: `${config.vaultPathPrefix}/${suffix}`, targetHash }
}

const vaultRequest = async (config, fetchImpl, readVaultToken, pathname, options = {}) => {
  const endpoint = new URL(pathname, config.vaultAddress)
  const response = await fetchImpl(endpoint, {
    method: options.method ?? 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(config.vaultTimeoutMs),
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-vault-token': readVaultToken(),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  })
  if (!response.ok) throw new Error('vault_request_failed')
  if (options.expectEmpty && response.status === 204) return null
  return readBoundedVaultJson(response)
}

export const createVaultSecretLifecycleHandler = ({
  source = process.env,
  fetchImpl = globalThis.fetch,
  readFile = readFileSync,
  logger = console,
} = {}) => {
  if (typeof fetchImpl !== 'function') throw new Error('Vault transport is unavailable')
  const config = buildVaultSecretLifecycleGatewayConfig(source, { readFile })
  const readBearerToken = () => readSecretFile(config.bearerTokenFile, 'SECRET_LIFECYCLE_GATEWAY_BEARER_TOKEN_FILE', readFile)
  const readVaultToken = () => readSecretFile(config.vaultTokenFile, 'SECRET_LIFECYCLE_VAULT_TOKEN_FILE', readFile)
  return async (request, response) => {
    if (request.method === 'GET' && request.url === '/healthz') return sendJson(response, 200, { status: 'ok' })
    if (request.method === 'GET' && request.url === '/readyz') {
      try {
        readBearerToken()
        const token = await vaultRequest(config, fetchImpl, readVaultToken, '/v1/auth/token/lookup-self')
        if (!String(token?.data?.id ?? '').trim()) throw new Error('vault_token_not_verified')
        return sendJson(response, 200, { status: 'ready' })
      } catch {
        logger.error?.('[secret-lifecycle]', { event: 'readiness_failed' })
        return sendJson(response, 503, { status: 'unavailable' })
      }
    }
    if (request.url !== lifecyclePath) return sendJson(response, 404, { status: 'failed', code: 'not_found' })
    if (request.method !== 'POST') return sendJson(response, 405, { status: 'failed', code: 'method_not_allowed' })
    let bearerToken
    try { bearerToken = readBearerToken() } catch {
      logger.error?.('[secret-lifecycle]', { event: 'credential_unavailable' })
      return sendJson(response, 503, { status: 'failed', code: 'credential_unavailable' })
    }
    if (!safeEqual(request.headers.authorization ?? '', `Bearer ${bearerToken}`)) return sendJson(response, 401, { status: 'failed', code: 'unauthorized' })
    if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) return sendJson(response, 415, { status: 'failed', code: 'unsupported_media_type' })

    let lifecycle
    try {
      const payload = await readBoundedRequestJson(request)
      lifecycle = parseLifecycleRequest(request, payload, config)
      const encodedMount = encodeURIComponent(config.mount)
      const encodedPath = encodeVaultPath(lifecycle.vaultPath)
      const operation = lifecycle.action === 'disable' ? 'delete' : 'destroy'
      await vaultRequest(config, fetchImpl, readVaultToken, `/v1/${encodedMount}/${operation}/${encodedPath}`, {
        method: 'POST', body: { versions: [lifecycle.version] }, expectEmpty: true,
      })
      const metadata = await vaultRequest(config, fetchImpl, readVaultToken, `/v1/${encodedMount}/metadata/${encodedPath}`)
      const version = metadata?.data?.versions?.[String(lifecycle.version)]
      const verified = lifecycle.action === 'disable'
        ? Boolean(version && !version.destroyed && String(version.deletion_time ?? '').trim())
        : Boolean(version?.destroyed)
      if (!verified) throw new Error('vault_state_not_verified')
      const receiptId = `vault-kv2-${lifecycle.action}-${sha256(`${lifecycle.action}:${lifecycle.targetHash}:${lifecycle.version}`)}`
      logger.info?.('[secret-lifecycle]', { event: 'completed', action: lifecycle.action, targetHash: lifecycle.targetHash })
      return sendJson(response, 200, { status: 'completed', action: lifecycle.action, receiptId })
    } catch (error) {
      const statusCode = error?.statusCode ?? 502
      const code = statusCode < 500 ? error.message : 'upstream_failed'
      logger.error?.('[secret-lifecycle]', { event: 'failed', action: lifecycle?.action ?? null, targetHash: lifecycle?.targetHash ?? null, code })
      return sendJson(response, statusCode, { status: 'failed', code })
    }
  }
}
