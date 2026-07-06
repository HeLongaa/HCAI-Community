const compactObject = (value) =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''))

const statusLabel = (status) => String(status ?? 'updated').replaceAll('_', ' ')

const safeLifecycleMetadata = ({ sourceKey, generationId, metadata = {} }) => compactObject({
  sourceKey,
  generationId,
  providerId: metadata.providerId,
  providerMode: metadata.providerMode,
  providerJobId: metadata.providerJobId,
  sourceType: metadata.sourceType,
  nextStatus: metadata.nextStatus,
  notificationType: metadata.notificationType,
  auditAction: metadata.auditAction,
  target: {
    page: 'admin',
    admin: {
      tab: 'Generations',
      generationId,
      auditSourceKey: sourceKey,
    },
  },
})

export const buildProviderLifecycleNotificationPayload = (payload = {}) => {
  const generationId = String(payload.generationId ?? '')
  const status = payload.metadata?.nextStatus ?? 'updated'
  return {
    type: payload.type ?? `creative.provider_lifecycle.${status}`,
    title: `Creative generation ${statusLabel(status)}`,
    body: `Provider lifecycle replay updated generation ${generationId}.`,
    resourceType: 'creative_generation',
    resourceId: generationId,
    metadata: safeLifecycleMetadata(payload),
    dedupeUnread: false,
  }
}

export const buildProviderLifecycleAuditPayload = (payload = {}, actor = null) => {
  const generationId = String(payload.generationId ?? '')
  return {
    actor,
    action: payload.action ?? payload.metadata?.auditAction ?? 'creative.provider_replay.updated',
    resourceType: 'creative_generation',
    resourceId: generationId,
    metadata: safeLifecycleMetadata(payload),
  }
}

export const hasProviderLifecycleSourceKey = (item, sourceKey) =>
  Boolean(sourceKey) && item?.metadata?.sourceKey === sourceKey
