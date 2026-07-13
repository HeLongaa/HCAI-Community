const surfaces = new Set([
  'generations', 'image', 'video', 'music', 'chat', 'tasks', 'portfolio', 'admin', 'points', 'assets',
])

const intents = new Set([
  'view', 'resume', 'review', 'retry', 'resolve-budget', 'view-delivery',
])

const adminTabs = new Set([
  'Task review', 'Access', 'Security', 'Finance', 'Generations', 'Submissions', 'Community', 'Audit log', 'Users', 'Tags', 'AI config',
])

const mediaStatuses = new Set(['pending', 'scanning', 'review', 'clean', 'rejected', 'all'])
const idKeys = ['generationId', 'taskId', 'submissionId', 'reviewId', 'assetId']

const safeString = (value, max = 160) => typeof value === 'string' && value.length > 0 && value.length <= max
  ? value
  : null

const legacySurface = (page, workspace) => {
  if (page === 'playground') return ['image', 'video', 'music', 'chat'].includes(workspace) ? workspace : 'image'
  if (page === 'mine' || page === 'tasks') return 'tasks'
  if (page === 'profile') return 'portfolio'
  return surfaces.has(page) ? page : null
}

const defaultSurface = (resourceType) => {
  if (resourceType === 'task') return 'tasks'
  if (resourceType === 'creative_generation') return 'generations'
  if (resourceType === 'media_asset') return 'assets'
  if (resourceType === 'admin_review' || resourceType === 'media_scan_alert' || resourceType === 'security_alert') return 'admin'
  if (resourceType === 'point_adjustment_policy' || resourceType === 'media_governance_policy') return 'admin'
  return 'points'
}

const sanitizeAdminTarget = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result = {}
  if (adminTabs.has(value.tab)) result.tab = value.tab
  for (const key of ['queue', 'reviewId', 'auditEventId', 'ledgerUserHandle', 'policyHistoryEventId', 'securityAlertId', 'mediaAssetId', 'generationId', 'auditSourceKey']) {
    const normalized = safeString(value[key])
    if (normalized) result[key] = normalized
  }
  if (mediaStatuses.has(value.mediaStatus)) result.mediaStatus = value.mediaStatus
  return Object.keys(result).length > 0 ? result : null
}

export const normalizeNotificationTarget = (value, { resourceType, resourceId } = {}) => {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const surface = surfaces.has(source.surface)
    ? source.surface
    : legacySurface(source.page, source.workspace) ?? defaultSurface(resourceType)
  const result = {
    version: 1,
    surface,
    intent: intents.has(source.intent) ? source.intent : 'view',
    fallbackSurface: surfaces.has(source.fallbackSurface) ? source.fallbackSurface : surface === 'admin' ? 'admin' : 'generations',
  }
  const workspace = safeString(source.workspace, 32)
  if (workspace && ['image', 'video', 'music', 'chat'].includes(workspace)) result.workspace = workspace
  for (const key of idKeys) {
    const normalized = safeString(source[key])
    if (normalized) result[key] = normalized
  }
  if (!result.taskId && resourceType === 'task') result.taskId = safeString(resourceId)
  if (!result.generationId && resourceType === 'creative_generation') result.generationId = safeString(resourceId)
  if (!result.assetId && resourceType === 'media_asset') result.assetId = safeString(resourceId)
  const admin = sanitizeAdminTarget(source.admin)
  if (surface === 'admin' && admin) result.admin = admin
  return result
}

export const sanitizeNotificationMetadata = (metadata, resource = {}) => {
  const source = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}
  const safe = {}
  for (const key of ['sourceKey', 'audience', 'status', 'reasonCode', 'workspace', 'operationType', 'errorCode', 'providerId', 'providerMode', 'providerJobId', 'sourceType', 'nextStatus', 'auditEventId', 'rollbackEventId', 'alertType', 'severity', 'previousSubmissionStatus']) {
    const normalized = safeString(source[key])
    if (normalized) safe[key] = normalized
  }
  for (const key of ['taskId', 'proposalId', 'submissionId', 'adminReviewId', 'reviewId', 'assetId', 'generationId', 'targetGenerationId', 'mutationId', 'mutationType', 'mutationStatus', 'userHandle']) {
    const normalized = safeString(source[key])
    if (normalized) safe[key] = normalized
  }
  const targetSource = source.target && typeof source.target === 'object' && !Array.isArray(source.target) ? source.target : {}
  safe.target = normalizeNotificationTarget({
    ...targetSource,
    generationId: targetSource.generationId ?? source.generationId,
    taskId: targetSource.taskId ?? source.taskId,
    submissionId: targetSource.submissionId ?? source.submissionId,
    reviewId: targetSource.reviewId ?? source.reviewId ?? source.adminReviewId,
    assetId: targetSource.assetId ?? source.assetId,
    workspace: targetSource.workspace ?? source.workspace,
  }, resource)
  return safe
}
