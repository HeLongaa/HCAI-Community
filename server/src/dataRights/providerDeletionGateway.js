import { createHash } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'

const providerIdPattern = /^[a-z0-9][a-z0-9._:-]{1,95}$/i
const receiptIdPattern = /^[a-z0-9][a-z0-9._:-]{2,127}$/i
const externalProvider = (providerId) => !/^(?:mock|fixture)(?:[-_:]|$)/i.test(String(providerId ?? ''))
const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex')

export const buildProviderDeletionTargets = (records = []) => {
  const grouped = new Map()
  for (const record of records) {
    const providerId = String(record?.providerId ?? '').trim()
    if (!providerIdPattern.test(providerId) || !externalProvider(providerId)) continue
    const target = grouped.get(providerId) ?? { providerId, operationRefs: new Set(), generationCount: 0 }
    target.generationCount += 1
    for (const candidate of [record.providerJobId, record.providerRequestId]) {
      const operationRef = String(candidate ?? '').trim()
      if (operationRef && operationRef.length <= 256) target.operationRefs.add(operationRef)
    }
    grouped.set(providerId, target)
  }
  return [...grouped.values()]
    .sort((left, right) => left.providerId.localeCompare(right.providerId))
    .map((target) => ({
      providerId: target.providerId,
      generationCount: target.generationCount,
      operationRefs: [...target.operationRefs].sort().slice(0, 100),
    }))
}

export const buildProviderDeletionGatewayConfig = (source = process.env) => {
  const enabled = String(source.DATA_RIGHTS_PROVIDER_DELETION_GATEWAY_ENABLED ?? '').trim().toLowerCase() === 'true'
  const confirmation = String(source.DATA_RIGHTS_PROVIDER_DELETION_GATEWAY_CONFIRMATION ?? '').trim()
  const token = String(source.DATA_RIGHTS_PROVIDER_DELETION_GATEWAY_TOKEN ?? '').trim()
  let endpoint
  try { endpoint = new URL(String(source.DATA_RIGHTS_PROVIDER_DELETION_GATEWAY_URL ?? '').trim()) } catch { endpoint = null }
  if (!enabled || confirmation !== 'provider-deletion-enabled') {
    throw new HttpError(503, 'DATA_RIGHTS_PROVIDER_DELETION_UNAVAILABLE', 'External Provider deletion is not configured')
  }
  if (!endpoint || endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new HttpError(503, 'DATA_RIGHTS_PROVIDER_DELETION_CONFIGURATION_INVALID', 'External Provider deletion endpoint is invalid')
  }
  if (token.length < 16) throw new HttpError(503, 'DATA_RIGHTS_PROVIDER_DELETION_CONFIGURATION_INVALID', 'External Provider deletion credential is invalid')
  return { endpoint: endpoint.toString(), token }
}

const safeResponse = async (response) => {
  const text = await response.text()
  if (Buffer.byteLength(text) > 16_384) throw new HttpError(502, 'DATA_RIGHTS_PROVIDER_DELETION_RESPONSE_INVALID', 'External Provider deletion response is invalid')
  let payload
  try { payload = JSON.parse(text) } catch { payload = null }
  if (!response.ok) throw new HttpError(502, 'DATA_RIGHTS_PROVIDER_DELETION_FAILED', 'External Provider deletion request failed')
  const receiptId = String(payload?.receiptId ?? '').trim()
  const deletedOperationCount = Number(payload?.deletedOperationCount)
  if (payload?.status !== 'completed' || !receiptIdPattern.test(receiptId) || !Number.isInteger(deletedOperationCount) || deletedOperationCount < 0) {
    throw new HttpError(502, 'DATA_RIGHTS_PROVIDER_DELETION_RESPONSE_INVALID', 'External Provider deletion response is invalid')
  }
  return { receiptId, deletedOperationCount }
}

export const createProviderDeletionGateway = ({ source = process.env, fetchImpl = globalThis.fetch } = {}) => async ({ requestId, subjectRef, target, now = new Date() }) => {
  if (!providerIdPattern.test(String(target?.providerId ?? '')) || !Array.isArray(target?.operationRefs) || target.operationRefs.length > 100) {
    throw new HttpError(500, 'DATA_RIGHTS_PROVIDER_DELETION_TARGET_INVALID', 'External Provider deletion target is invalid')
  }
  if (typeof fetchImpl !== 'function') throw new HttpError(503, 'DATA_RIGHTS_PROVIDER_DELETION_UNAVAILABLE', 'External Provider deletion transport is unavailable')
  const runtime = buildProviderDeletionGatewayConfig(source)
  const response = await fetchImpl(runtime.endpoint, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${runtime.token}`,
      'content-type': 'application/json',
      'idempotency-key': `data-rights:${requestId}:${target.providerId}`,
    },
    body: JSON.stringify({
      schemaVersion: 1,
      requestId,
      subjectRef,
      providerId: target.providerId,
      operationRefs: target.operationRefs,
      requestedAt: now.toISOString(),
    }),
  })
  const result = await safeResponse(response)
  return Object.freeze({
    providerId: target.providerId,
    generationCount: target.generationCount,
    deletedOperationCount: result.deletedOperationCount,
    receiptHash: sha256(`${target.providerId}:${result.receiptId}`),
    completedAt: now.toISOString(),
  })
}

export const providerDeletionReceipt = ({ requestId, result, now = new Date() }) => ({
  domain: `provider:${result.providerId}`,
  disposition: 'externally_erased',
  recordCount: result.deletedOperationCount,
  legalBasisCode: 'owner_deletion_request',
  retentionExpiresAt: null,
  evidenceHash: sha256(JSON.stringify({
    requestId,
    providerId: result.providerId,
    generationCount: result.generationCount,
    deletedOperationCount: result.deletedOperationCount,
    receiptHash: result.receiptHash,
    completedAt: result.completedAt,
  })),
  createdAt: now,
})
