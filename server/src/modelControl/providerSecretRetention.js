import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { HttpError } from '../common/errors/httpError.js'

const dayMs = 86_400_000
const receiptIdPattern = /^[a-z0-9][a-z0-9._:-]{2,127}$/i
const deletablePurposePattern = /^(?:inference|(?:chat|image|music|video)-inference)$/
const maxResponseBytes = 16_384

const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex')

export const providerSecretRetentionContract = Object.freeze({
  policyId: 'retired_secret_30d',
  retentionDays: 30,
  actions: Object.freeze(['disable', 'delete']),
  defaultSweepLimit: 50,
  maximumSweepLimit: 500,
  deletablePurposePattern,
})

export const providerSecretRetentionCutoff = (now = new Date()) => new Date(
  now.getTime() - providerSecretRetentionContract.retentionDays * dayMs,
)

export const providerSecretRetentionSweepLimit = (value) => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 1) return providerSecretRetentionContract.defaultSweepLimit
  return Math.min(parsed, providerSecretRetentionContract.maximumSweepLimit)
}

export const isProviderSecretPurposeDeletable = (purpose) => deletablePurposePattern.test(String(purpose ?? ''))

const runtimeConfiguration = (source, readCredentialFile) => {
  const enabled = String(source.SECRET_MANAGER_LIFECYCLE_GATEWAY_ENABLED ?? '').trim().toLowerCase() === 'true'
  const confirmation = String(source.SECRET_MANAGER_LIFECYCLE_GATEWAY_CONFIRMATION ?? '').trim()
  const inlineToken = String(source.SECRET_MANAGER_LIFECYCLE_GATEWAY_TOKEN ?? '').trim()
  const tokenFile = String(source.SECRET_MANAGER_LIFECYCLE_GATEWAY_TOKEN_FILE ?? '').trim()
  let endpoint
  try { endpoint = new URL(String(source.SECRET_MANAGER_LIFECYCLE_GATEWAY_URL ?? '').trim()) } catch { endpoint = null }
  if (!enabled || confirmation !== 'managed-secret-lifecycle-enabled') {
    throw new HttpError(503, 'SECRET_MANAGER_LIFECYCLE_UNAVAILABLE', 'Managed secret lifecycle is not configured')
  }
  if (!endpoint || endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new HttpError(503, 'SECRET_MANAGER_LIFECYCLE_CONFIGURATION_INVALID', 'Managed secret lifecycle endpoint is invalid')
  }
  if (inlineToken && tokenFile) throw new HttpError(503, 'SECRET_MANAGER_LIFECYCLE_CONFIGURATION_INVALID', 'Managed secret lifecycle credential is ambiguous')
  if (tokenFile && !path.isAbsolute(tokenFile)) throw new HttpError(503, 'SECRET_MANAGER_LIFECYCLE_CONFIGURATION_INVALID', 'Managed secret lifecycle credential file is invalid')
  let token = inlineToken
  if (tokenFile) {
    try { token = String(readCredentialFile(tokenFile, 'utf8')).trim() } catch { token = '' }
  }
  if (token.length < 16) throw new HttpError(503, 'SECRET_MANAGER_LIFECYCLE_CONFIGURATION_INVALID', 'Managed secret lifecycle credential is invalid')
  return { endpoint: endpoint.toString(), token }
}

const readBoundedJson = async (response) => {
  const declaredLength = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) throw new Error('response_too_large')
  if (!response.body || typeof response.body.getReader !== 'function') throw new Error('response_body_missing')
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!(value instanceof Uint8Array)) throw new Error('response_chunk_invalid')
      total += value.byteLength
      if (total > maxResponseBytes) throw new Error('response_too_large')
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength))
    }
  } catch (error) {
    await reader.cancel(error).catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
  return JSON.parse(Buffer.concat(chunks, total).toString('utf8'))
}

export const createSecretManagerLifecycleGateway = ({ source = process.env, fetchImpl = globalThis.fetch, readCredentialFile = readFileSync } = {}) => async ({
  action,
  secretRef,
  externalVersion,
  purpose,
  now = new Date(),
}) => {
  if (!providerSecretRetentionContract.actions.includes(action) || !isProviderSecretPurposeDeletable(purpose)) {
    throw new HttpError(409, 'SECRET_MANAGER_LIFECYCLE_TARGET_INVALID', 'Managed secret lifecycle target is not eligible')
  }
  if (!/^secret:\/\/[a-zA-Z0-9][a-zA-Z0-9/_.:-]{2,180}$/.test(String(secretRef ?? '')) || !String(externalVersion ?? '').trim()) {
    throw new HttpError(409, 'SECRET_MANAGER_LIFECYCLE_TARGET_INVALID', 'Managed secret lifecycle target is invalid')
  }
  if (typeof fetchImpl !== 'function') throw new HttpError(503, 'SECRET_MANAGER_LIFECYCLE_UNAVAILABLE', 'Managed secret lifecycle transport is unavailable')
  const runtime = runtimeConfiguration(source, readCredentialFile)
  const targetHash = sha256(`${secretRef}:${externalVersion}`)
  let response
  try {
    response = await fetchImpl(runtime.endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${runtime.token}`,
        'content-type': 'application/json',
        'idempotency-key': `secret-lifecycle:${action}:${targetHash}`,
      },
      body: JSON.stringify({ schemaVersion: 1, action, secretRef, externalVersion, requestedAt: now.toISOString() }),
    })
  } catch {
    throw new HttpError(502, 'SECRET_MANAGER_LIFECYCLE_FAILED', 'Managed secret lifecycle request failed')
  }
  let payload
  try { payload = await readBoundedJson(response) } catch { payload = null }
  if (!response.ok) throw new HttpError(502, 'SECRET_MANAGER_LIFECYCLE_FAILED', 'Managed secret lifecycle request failed')
  const receiptId = String(payload?.receiptId ?? '').trim()
  if (payload?.status !== 'completed' || payload?.action !== action || !receiptIdPattern.test(receiptId)) {
    throw new HttpError(502, 'SECRET_MANAGER_LIFECYCLE_RESPONSE_INVALID', 'Managed secret lifecycle response is invalid')
  }
  return Object.freeze({
    action,
    targetHash,
    receiptHash: sha256(`${action}:${receiptId}`),
    completedAt: now.toISOString(),
  })
}
