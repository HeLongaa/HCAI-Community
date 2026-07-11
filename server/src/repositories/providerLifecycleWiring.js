import { createHash } from 'node:crypto'

import { safeProviderJobIdEvidence } from '../creative/generationRecords.js'

const safeEvidencePattern = /^[a-z0-9][a-z0-9:._-]{0,240}$/i
const safeLifecycleActionPattern = /^creative\.provider_(?:callback|lifecycle|replay)\.[a-z0-9._-]+$/i

const compactObject = (value) =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''))

const statusLabel = (status) => String(status ?? 'updated').replaceAll('_', ' ')

const stableHash = (value) =>
  createHash('sha256')
    .update(JSON.stringify(value ?? null))
    .digest('hex')

export const safeProviderLifecycleEvidenceIdentifier = (value, fallback = null) => {
  const normalized = String(value ?? '').trim() || fallback
  if (!normalized) return null
  return safeEvidencePattern.test(normalized)
    ? normalized
    : `redacted_${stableHash(value).slice(0, 16)}`
}

const safeLifecycleAction = (value, fallback) => {
  const normalized = String(value ?? '').trim()
  return normalized && safeLifecycleActionPattern.test(normalized) ? normalized : fallback
}

const safeLifecycleMetadata = ({ sourceKey, generationId, metadata = {} }) => {
  const safeSourceKey = safeProviderLifecycleEvidenceIdentifier(sourceKey)
  const safeGenerationId = safeProviderLifecycleEvidenceIdentifier(generationId)
  return compactObject({
    sourceKey: safeSourceKey,
    generationId: safeGenerationId,
    providerId: safeProviderLifecycleEvidenceIdentifier(metadata.providerId),
    providerMode: safeProviderLifecycleEvidenceIdentifier(metadata.providerMode),
    providerJobId: safeProviderJobIdEvidence(metadata.providerJobId),
    providerEventId: safeProviderJobIdEvidence(metadata.providerEventId),
    providerStatus: safeProviderLifecycleEvidenceIdentifier(metadata.providerStatus),
    sourceType: safeProviderLifecycleEvidenceIdentifier(metadata.sourceType),
    nextStatus: safeProviderLifecycleEvidenceIdentifier(metadata.nextStatus),
    reasonCode: safeProviderLifecycleEvidenceIdentifier(metadata.reasonCode),
    payloadHash: safeProviderLifecycleEvidenceIdentifier(metadata.payloadHash),
    bodyBytes: Number.isFinite(metadata.bodyBytes) ? metadata.bodyBytes : undefined,
    signatureVerified: metadata.signatureVerified == null ? undefined : Boolean(metadata.signatureVerified),
    duplicate: metadata.duplicate == null ? undefined : Boolean(metadata.duplicate),
    executed: metadata.executed == null ? undefined : Boolean(metadata.executed),
    hasContentType: metadata.hasContentType == null ? undefined : Boolean(metadata.hasContentType),
    hasTimestamp: metadata.hasTimestamp == null ? undefined : Boolean(metadata.hasTimestamp),
    hasSignature: metadata.hasSignature == null ? undefined : Boolean(metadata.hasSignature),
    hasNonce: metadata.hasNonce == null ? undefined : Boolean(metadata.hasNonce),
    notificationType: safeLifecycleAction(metadata.notificationType, null),
    auditAction: safeLifecycleAction(metadata.auditAction, null),
    target: {
      page: 'admin',
      admin: {
        tab: 'Generations',
        generationId: safeGenerationId,
        auditSourceKey: safeSourceKey,
      },
    },
  })
}

export const buildProviderLifecycleNotificationPayload = (payload = {}) => {
  const generationId = safeProviderLifecycleEvidenceIdentifier(payload.generationId, 'unknown_generation')
  const status = safeProviderLifecycleEvidenceIdentifier(payload.metadata?.nextStatus, 'updated')
  return {
    type: safeLifecycleAction(payload.type ?? payload.metadata?.notificationType, `creative.provider_lifecycle.${status}`),
    title: `Creative generation ${statusLabel(status)}`,
    body: `Provider lifecycle replay updated generation ${generationId}.`,
    resourceType: 'creative_generation',
    resourceId: generationId,
    metadata: safeLifecycleMetadata(payload),
    dedupeUnread: false,
  }
}

export const buildProviderLifecycleAuditPayload = (payload = {}, actor = null) => {
  const generationId = safeProviderLifecycleEvidenceIdentifier(payload.generationId, 'unknown_generation')
  return {
    actor,
    action: safeLifecycleAction(
      payload.action ?? payload.metadata?.auditAction,
      'creative.provider_replay.updated',
    ),
    resourceType: 'creative_generation',
    resourceId: generationId,
    metadata: safeLifecycleMetadata(payload),
  }
}

export const hasProviderLifecycleSourceKey = (item, sourceKey) =>
  Boolean(sourceKey) && item?.metadata?.sourceKey === sourceKey
