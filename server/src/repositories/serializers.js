import { safeErrorPreview, safeProviderJobIdEvidence } from '../creative/generationRecords.js'
import { projectAuditDiff, safeAuditMetadata } from '../audit/auditRetention.js'
import { safeProviderBudgetEvidenceIdentifier } from '../creative/providerBudgetEvents.js'
import { safeProviderLifecycleEvidenceIdentifier } from './providerLifecycleWiring.js'
import { sanitizeNotificationMetadata } from './notificationTargets.js'

const providerBudgetAuditActions = new Set([
  'creative.provider_budget.threshold_crossed',
  'creative.provider_budget.dispatch_blocked',
  'creative.provider_cost.anomaly_detected',
  'creative.provider_alert.dispatch',
  'creative.provider_cost.reserved',
  'creative.provider_cost.settled',
  'creative.provider_cost.released',
  'creative.provider_cost.reconciliation_required',
])

const providerBudgetAuditResourceTypes = new Set([
  'creative_provider_budget',
  'creative_provider_budget_alert',
  'creative_provider_cost_ledger',
])

const providerControlAuditResourceTypes = new Set([
  'creative_provider_control',
  'creative_provider_cap_evidence',
  'creative_provider_circuit',
  'admin_review',
])

const providerControlAuditMetadataKeys = new Set([
  'blockedScopeType',
  'category',
  'currency',
  'enabled',
  'expiresAt',
  'failureCount',
  'modelFamily',
  'outcome',
  'providerId',
  'reasonCode',
  'scopeType',
  'sourceType',
  'status',
  'target',
  'verifiedAt',
  'version',
  'workspace',
])

const providerLifecycleAuditActions = new Set([
  'creative.provider_callback.accepted',
  'creative.provider_callback.rejected',
  'creative.provider_callback.duplicate_suppressed',
  'creative.provider_lifecycle.side_effect_applied',
  'creative.provider_lifecycle.side_effect_failed',
  'creative.provider_polling.status_fetched',
  'creative.provider_polling.retry_scheduled',
  'creative.provider_polling.timed_out',
  'creative.provider_polling.rejected',
  'creative.provider_replay.updated',
])

const providerRetryAuditActions = new Set([
  'creative.provider_retry.scheduled',
  'creative.provider_retry.exhausted',
  'creative.provider_retry.cleared',
])

const providerRetryAuditMetadataKeys = new Set([
  'generationId',
  'providerId',
  'workspace',
  'operationType',
  'status',
  'attempt',
  'maxAttempts',
  'nextAttemptAt',
  'errorCode',
  'errorCategory',
  'delaySource',
  'version',
  'reasonCode',
])

const providerRetryIdentifierKeys = new Set([
  'generationId',
  'providerId',
  'workspace',
  'operationType',
  'status',
  'errorCode',
  'errorCategory',
  'delaySource',
  'reasonCode',
])

const providerReplayLedgerAuditActions = new Set([
  'creative.provider_replay.recorded',
  'creative.provider_replay.applied',
  'creative.provider_replay.side_effect_result_recorded',
])

const creativeGenerationAuditActions = new Set([
  'creative.generation.created',
  'creative.generation.running',
  'creative.generation.outputs_linked',
  'creative.generation.completed',
  'creative.generation.failed',
  'creative.generation.cancelled',
])

const creativeCreditAuditActions = new Set([
  'creative.credit.reserved',
  'creative.credit.settled',
  'creative.credit.refunded',
  'creative.credit.cancelled',
])

const creativeQuotaAuditActions = new Set([
  'creative.quota.reserved',
  'creative.quota.committed',
  'creative.quota.released',
])

const mediaAssetLifecycleAuditActions = new Set([
  'media.upload.created',
  'media.upload.completed',
  'media.generated_asset.created',
  'media.download.signed',
])

const providerBudgetIdentifierKeys = new Set([
  'alertAction',
  'alertType',
  'auditEventId',
  'auditEventSourceKey',
  'budgetEventIdempotencyKey',
  'budgetScope',
  'budgetStatus',
  'channel',
  'currency',
  'dispatchMode',
  'estimateConfidence',
  'idempotencyKey',
  'generationId',
  'mode',
  'persistedFrom',
  'providerAccountRef',
  'providerId',
  'providerModelId',
  'providerUsageUnit',
  'pricingSnapshotHash',
  'reasonCode',
  'severity',
  'sourceKey',
  'status',
  'workspace',
])

const providerLifecycleIdentifierKeys = new Set([
  'auditAction',
  'auditSourceKey',
  'errorCode',
  'generationId',
  'nextStatus',
  'notificationType',
  'payloadHash',
  'providerId',
  'providerMode',
  'providerStatus',
  'reasonCode',
  'sourceKey',
  'sourceType',
])

const providerLifecycleProviderEvidenceKeys = new Set([
  'providerEventId',
  'providerJobId',
  'providerRequestId',
])

const providerReplayLedgerIdentifierKeys = new Set([
  'action',
  'generationId',
  'providerId',
  'reasonCode',
  'sourceType',
])

const creativeGenerationIdentifierKeys = new Set([
  'errorCode',
  'generationId',
  'mode',
  'outputAssetIds',
  'outputId',
  'providerId',
  'reasonCode',
  'reasons',
  'status',
  'workspace',
])

const creativeAccountingIdentifierKeys = new Set([
  'creditLedgerId',
  'generationId',
  'ledgerId',
  'mode',
  'quotaReservationId',
  'quotaWindowId',
  'reservationId',
  'status',
  'workspace',
])

const mediaAssetLifecycleIdentifierKeys = new Set([
  'generationId',
  'outputId',
  'providerId',
  'purpose',
  'scanStatus',
  'workspace',
])

const isProviderBudgetAuditEvent = (event) =>
  providerBudgetAuditActions.has(event?.action) && providerBudgetAuditResourceTypes.has(event?.resourceType)

const isProviderControlAuditEvent = (event) =>
  providerControlAuditResourceTypes.has(event?.resourceType) &&
  (event?.action?.startsWith('creative.provider_control.') || event?.action?.startsWith('creative.provider_circuit.'))

const safeProviderControlAuditMetadata = (metadata) => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  return Object.fromEntries(Object.entries(metadata)
    .filter(([key]) => providerControlAuditMetadataKeys.has(key))
    .map(([key, value]) => [
      key,
      typeof value === 'string' && !['expiresAt', 'verifiedAt'].includes(key)
        ? safeProviderBudgetEvidenceIdentifier(value)
        : value,
    ]))
}

const safeProviderBudgetAuditMetadataValue = (value, key = '') => {
  if (typeof value === 'string') {
    return providerBudgetIdentifierKeys.has(key)
      ? safeProviderBudgetEvidenceIdentifier(value)
      : safeErrorPreview(value)
  }
  if (Array.isArray(value)) {
    return value.map((item) => safeProviderBudgetAuditMetadataValue(item))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      safeProviderBudgetAuditMetadataValue(childValue, childKey),
    ]))
  }
  return value
}

const safeProviderBudgetAuditMetadata = (metadata) =>
  metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? safeProviderBudgetAuditMetadataValue(metadata)
    : null

const isProviderLifecycleAuditEvent = (event) =>
  providerLifecycleAuditActions.has(event?.action) && event?.resourceType === 'creative_generation'

const safeProviderLifecycleAuditMetadataValue = (value, key = '') => {
  if (typeof value === 'string') {
    if (providerLifecycleProviderEvidenceKeys.has(key)) return safeProviderJobIdEvidence(value)
    return providerLifecycleIdentifierKeys.has(key)
      ? safeProviderLifecycleEvidenceIdentifier(value)
      : safeErrorPreview(value)
  }
  if (Array.isArray(value)) {
    return value.map((item) => safeProviderLifecycleAuditMetadataValue(item))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      safeProviderLifecycleAuditMetadataValue(childValue, childKey),
    ]))
  }
  return value
}

const safeProviderLifecycleAuditMetadata = (metadata) =>
  metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? safeProviderLifecycleAuditMetadataValue(metadata)
    : null

const isProviderRetryAuditEvent = (event) =>
  providerRetryAuditActions.has(event?.action) && event?.resourceType === 'creative_provider_retry_state'

const safeProviderRetryAuditMetadata = (metadata) => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  return Object.fromEntries(Object.entries(metadata)
    .filter(([key]) => providerRetryAuditMetadataKeys.has(key))
    .map(([key, value]) => [
      key,
      typeof value === 'string'
        ? providerRetryIdentifierKeys.has(key)
          ? safeProviderLifecycleEvidenceIdentifier(value)
          : safeErrorPreview(value)
        : value,
    ]))
}

const isProviderReplayLedgerAuditEvent = (event) =>
  providerReplayLedgerAuditActions.has(event?.action) && event?.resourceType === 'creative_provider_replay_ledger'

const safeProviderReplayLedgerAuditMetadataValue = (value, key = '') => {
  if (typeof value === 'string') {
    if (key === 'providerJobId') return safeProviderJobIdEvidence(value)
    return providerReplayLedgerIdentifierKeys.has(key)
      ? safeProviderLifecycleEvidenceIdentifier(value)
      : safeErrorPreview(value)
  }
  if (Array.isArray(value)) {
    return value.map((item) => safeProviderReplayLedgerAuditMetadataValue(item))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      safeProviderReplayLedgerAuditMetadataValue(childValue, childKey),
    ]))
  }
  return value
}

const safeProviderReplayLedgerAuditMetadata = (metadata) =>
  metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? safeProviderReplayLedgerAuditMetadataValue(metadata)
    : null

const isCreativeGenerationAuditEvent = (event) =>
  (creativeGenerationAuditActions.has(event?.action) && event?.resourceType === 'creative_generation') ||
  (event?.action === 'creative.generation.review_required' && event?.resourceType === 'media_asset')

const safeCreativeGenerationAuditMetadataValue = (value, key = '') => {
  if (typeof value === 'string') {
    return creativeGenerationIdentifierKeys.has(key)
      ? safeProviderLifecycleEvidenceIdentifier(value)
      : safeErrorPreview(value)
  }
  if (Array.isArray(value)) {
    return value.map((item) => safeCreativeGenerationAuditMetadataValue(item, key))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      safeCreativeGenerationAuditMetadataValue(childValue, childKey),
    ]))
  }
  return value
}

const safeCreativeGenerationAuditMetadata = (metadata) =>
  metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? safeCreativeGenerationAuditMetadataValue(metadata)
    : null

const isCreativeAccountingAuditEvent = (event) =>
  (creativeCreditAuditActions.has(event?.action) && event?.resourceType === 'creative_credit_ledger') ||
  (creativeQuotaAuditActions.has(event?.action) && event?.resourceType === 'creative_quota_reservation')

const safeCreativeAccountingAuditMetadataValue = (value, key = '') => {
  if (typeof value === 'string') {
    if (key === 'reason' || key === 'reasonCode') return safeErrorPreview(value)
    return creativeAccountingIdentifierKeys.has(key)
      ? safeProviderLifecycleEvidenceIdentifier(value)
      : safeErrorPreview(value)
  }
  if (Array.isArray(value)) {
    return value.map((item) => safeCreativeAccountingAuditMetadataValue(item, key))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      safeCreativeAccountingAuditMetadataValue(childValue, childKey),
    ]))
  }
  return value
}

const safeCreativeAccountingAuditMetadata = (metadata) =>
  metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? safeCreativeAccountingAuditMetadataValue(metadata)
    : null

const isMediaAssetLifecycleAuditEvent = (event) =>
  mediaAssetLifecycleAuditActions.has(event?.action) && event?.resourceType === 'media_asset'

const safeMediaAssetLifecycleAuditMetadataValue = (value, key = '') => {
  if (typeof value === 'string') {
    return mediaAssetLifecycleIdentifierKeys.has(key)
      ? safeProviderLifecycleEvidenceIdentifier(value)
      : safeErrorPreview(value)
  }
  if (Array.isArray(value)) {
    return value.map((item) => safeMediaAssetLifecycleAuditMetadataValue(item, key))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      safeMediaAssetLifecycleAuditMetadataValue(childValue, childKey),
    ]))
  }
  return value
}

const safeMediaAssetLifecycleAuditMetadata = (metadata) =>
  metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? safeMediaAssetLifecycleAuditMetadataValue(metadata)
    : null

const parsePoints = (value) => {
  const cleaned = String(value).replace(/[^\d-]/g, '')
  const parsed = Number.parseInt(cleaned, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

export const serializeAccount = (account) => ({
  id: account.id,
  handle: account.handle,
  email: account.email,
  displayName: account.displayName,
  role: account.role,
  permissions: account.permissions,
  profile: account.profile,
})

const serializeTaskActor = (actor, fallback = 'Unassigned') => typeof actor === 'string' ? actor : actor?.handle ?? fallback

export const serializeTask = (task) => ({
  id: String(task.id),
  title: task.title,
  category: task.category,
  status: task.status,
  budget: task.budget,
  deadline: task.deadline,
  proposals: task.proposals,
  description: task.description,
  publisher: serializeTaskActor(task.publisher, ''),
  assignee: serializeTaskActor(task.assignee),
  requirements: task.requirements,
  attachments: task.attachments,
  privateBrief: task.privateBrief,
  submission: task.submission,
  resultLinks: task.resultLinks,
  reviewNote: task.reviewNote,
  rights: task.rights,
  disputeStatus: task.disputeStatus ?? null,
  disputeReason: task.disputeReason ?? '',
  disputeReviewId: task.disputeReviewId ?? null,
  version: Number(task.version) || 1,
  cancelledAt: task.cancelledAt ?? null,
  expiredAt: task.expiredAt ?? null,
  terminalReasonCode: task.terminalReasonCode ?? null,
})

export const serializeTaskDetail = serializeTask

export const serializeTaskProposal = (proposal) => ({
  id: String(proposal.id),
  taskId: String(proposal.taskId),
  proposer: proposal.proposer,
  coverLetter: proposal.coverLetter,
  estimate: proposal.estimate ?? '',
  status: proposal.status,
  decisionNote: proposal.decisionNote ?? '',
  createdAt: proposal.createdAt ?? '',
})

export const serializeTaskSubmission = (submission) => ({
  id: String(submission.id),
  taskId: String(submission.taskId),
  submitter: submission.submitter,
  content: submission.content,
  assetIds: submission.assetIds ?? [],
  rightsNote: submission.rightsNote ?? '',
  status: submission.status,
  reviewNote: submission.reviewNote ?? '',
  acceptanceChecklist: submission.acceptanceChecklist ?? submission.metadata?.acceptanceChecklist ?? [],
  dispute: submission.dispute ?? submission.metadata?.dispute ?? null,
  stale: submission.stale ?? submission.metadata?.stale ?? null,
  assetEvidence: submission.assetEvidence ?? submission.metadata?.assetEvidence ?? [],
  reviewedBy: submission.reviewedBy ?? null,
  reviewedAt: submission.reviewedAt ?? null,
  createdAt: submission.createdAt ?? '',
})

export const serializePortfolioAsset = (item, asset = null) => ({
  id: String(item.id),
  assetId: String(item.assetId),
  sourceGenerationId: item.sourceGenerationId ?? null,
  sourceSubmissionId: item.sourceSubmissionId ?? null,
  title: item.title,
  caption: item.caption ?? '',
  status: item.status,
  sortOrder: item.sortOrder ?? 0,
  publishedAt: item.publishedAt ?? null,
  withdrawnAt: item.withdrawnAt ?? null,
  archivedAt: item.archivedAt ?? null,
  createdAt: item.createdAt ?? '',
  updatedAt: item.updatedAt ?? '',
  asset: asset ? {
    id: String(asset.id),
    fileName: asset.fileName,
    contentType: asset.contentType,
    purpose: asset.purpose,
  } : null,
})

export const serializeMediaAsset = (asset) => ({
  id: String(asset.id),
  fileName: asset.fileName,
  storageKey: asset.storageKey,
  contentType: asset.contentType,
  sizeBytes: asset.sizeBytes,
  purpose: asset.purpose,
  status: asset.status,
  storage: asset.storage ? {
    provider: asset.storage.provider,
    state: asset.storage.state,
    verifiedSizeBytes: asset.storage.verifiedSizeBytes ?? null,
    verifiedContentType: asset.storage.verifiedContentType ?? null,
    verifiedAt: asset.storage.verifiedAt ?? null,
    quarantinedAt: asset.storage.quarantinedAt ?? null,
    cleanupAfter: asset.storage.cleanupAfter ?? null,
    deletedAt: asset.storage.deletedAt ?? null,
    lastErrorCode: asset.storage.lastErrorCode ?? null,
    version: Number(asset.storage.version ?? 1),
  } : null,
  metadata: asset.metadata ?? null,
  createdAt: asset.createdAt ?? '',
  updatedAt: asset.updatedAt ?? '',
})

export const serializeCreativeGeneration = (generation) => ({
  id: String(generation.id),
  actorId: generation.actorId ?? null,
  actorHandle: generation.actorHandle ?? null,
  workspace: generation.workspace,
  mode: generation.mode,
  providerId: generation.providerId,
  providerMode: generation.providerMode ?? null,
  status: generation.status,
  promptHash: generation.promptHash,
  promptPreview: generation.promptPreview ?? null,
  inputAssetIds: generation.inputAssetIds ?? [],
  parameterKeys: generation.parameterKeys ?? [],
  outputAssetIds: generation.outputAssetIds ?? [],
  usage: generation.usage ?? null,
  credit: generation.credit ?? null,
  quota: generation.quota ?? null,
  safety: generation.safety ?? null,
  policy: generation.policy ?? null,
  providerRequestId: generation.providerRequestId ?? null,
  providerJobId: generation.providerJobId ?? null,
  retryOfId: generation.retryOfId ?? null,
  attemptNumber: Number(generation.attemptNumber ?? 1),
  errorCode: generation.errorCode ?? null,
  errorMessagePreview: generation.errorMessagePreview ? safeErrorPreview(generation.errorMessagePreview) : null,
  startedAt: generation.startedAt ?? null,
  completedAt: generation.completedAt ?? null,
  failedAt: generation.failedAt ?? null,
  createdAt: generation.createdAt ?? '',
  updatedAt: generation.updatedAt ?? '',
})

export const serializeCreativeGenerationMutation = (mutation) => ({
  id: String(mutation.id),
  generationId: String(mutation.generationId),
  type: mutation.type,
  status: mutation.status,
  idempotencyKey: mutation.idempotencyKey,
  requestedById: mutation.requestedById ?? null,
  requestedByHandle: mutation.requestedByHandle ?? null,
  reasonCode: mutation.reasonCode,
  notePreview: mutation.notePreview ?? null,
  reviewId: mutation.reviewId ?? null,
  targetGenerationId: mutation.targetGenerationId ?? null,
  safeMetadata: mutation.safeMetadata ?? null,
  result: mutation.result ?? null,
  completedAt: mutation.completedAt ?? null,
  createdAt: mutation.createdAt ?? '',
  updatedAt: mutation.updatedAt ?? '',
})

export const serializeCreativeProviderOperation = (operation) => ({
  id: String(operation.id),
  generationId: String(operation.generationId),
  providerId: operation.providerId,
  providerMode: operation.providerMode,
  providerJobId: operation.providerJobId,
  status: operation.status,
  version: Number(operation.version ?? 1),
  pollAttempts: Number(operation.pollAttempts ?? 0),
  nextPollAt: operation.nextPollAt ?? null,
  timeoutAt: operation.timeoutAt,
  lastPayloadHash: operation.lastPayloadHash ?? null,
  outputDigest: operation.outputDigest ?? null,
  lastErrorCode: operation.lastErrorCode ?? null,
  sideEffectsComplete: Boolean(operation.sideEffectsComplete),
  safeMetadata: operation.safeMetadata ?? null,
  terminalAt: operation.terminalAt ?? null,
  createdAt: operation.createdAt ?? '',
  updatedAt: operation.updatedAt ?? '',
})

export const serializeCreativeProviderReplay = (replay) => ({
  id: String(replay.id),
  generationId: replay.generationId,
  providerId: replay.providerId,
  providerMode: replay.providerMode ?? null,
  providerJobId: replay.providerJobId ?? null,
  providerEventId: replay.providerEventId ?? null,
  sourceType: replay.sourceType,
  idempotencyKey: replay.idempotencyKey,
  payloadHash: replay.payloadHash ?? null,
  previousStatus: replay.previousStatus ?? null,
  normalizedStatus: replay.normalizedStatus ?? null,
  action: replay.action,
  reasonCode: replay.reasonCode ?? null,
  sideEffectPlan: replay.sideEffectPlan ?? null,
  sideEffectResult: replay.sideEffectResult ?? null,
  errorPreview: replay.errorPreview ?? null,
  receivedAt: replay.receivedAt ?? '',
  appliedAt: replay.appliedAt ?? null,
  createdAt: replay.createdAt ?? '',
  updatedAt: replay.updatedAt ?? '',
})

export const serializeCreativeOutputIngestion = (ingestion) => ({
  id: String(ingestion.id),
  sourceKey: ingestion.sourceKey,
  generationId: String(ingestion.generationId),
  providerId: ingestion.providerId,
  providerJobId: ingestion.providerJobId ?? null,
  outputDigest: ingestion.outputDigest,
  outputIndex: Number(ingestion.outputIndex),
  status: ingestion.status,
  mediaAssetId: ingestion.mediaAssetId ?? null,
  storageKey: ingestion.storageKey ?? null,
  detectedContentType: ingestion.detectedContentType ?? null,
  sizeBytes: ingestion.sizeBytes == null ? null : Number(ingestion.sizeBytes),
  sha256: ingestion.sha256 ?? null,
  errorCode: ingestion.errorCode ?? null,
  claimToken: ingestion.claimToken ?? null,
  claimedAt: ingestion.claimedAt ?? null,
  leaseExpiresAt: ingestion.leaseExpiresAt ?? null,
  completedAt: ingestion.completedAt ?? null,
  createdAt: ingestion.createdAt ?? '',
  updatedAt: ingestion.updatedAt ?? '',
})

export const serializeCreativeProviderBudgetWindow = (window) => ({
  id: String(window.id),
  budgetScope: window.budgetScope,
  providerId: window.providerId,
  providerAccountRef: window.providerAccountRef,
  workspace: window.workspace,
  currency: window.currency,
  windowStart: window.windowStart ?? '',
  windowEnd: window.windowEnd ?? '',
  capMicros: String(window.capMicros),
  reservedMicros: String(window.reservedMicros),
  spentMicros: String(window.spentMicros),
  releasedMicros: String(window.releasedMicros),
  createdAt: window.createdAt ?? '',
  updatedAt: window.updatedAt ?? '',
})

export const serializeCreativeProviderCostLedger = (ledger, budgetWindow = null) => ({
  id: String(ledger.id),
  sourceKey: ledger.sourceKey,
  generationId: ledger.generationId,
  budgetWindowId: ledger.budgetWindowId,
  providerId: ledger.providerId,
  providerAccountRef: ledger.providerAccountRef,
  providerModelId: ledger.providerModelId,
  providerJobId: ledger.providerJobId ?? null,
  workspace: ledger.workspace,
  mode: ledger.mode,
  currency: ledger.currency,
  pricingSnapshot: ledger.pricingSnapshot,
  pricingSnapshotHash: ledger.pricingSnapshotHash,
  estimateMicros: String(ledger.estimateMicros),
  reservedMicros: String(ledger.reservedMicros),
  actualMicros: ledger.actualMicros == null ? null : String(ledger.actualMicros),
  status: ledger.status,
  usage: ledger.usage ?? null,
  risk: ledger.risk ?? null,
  reasonCode: ledger.reasonCode ?? null,
  reservedAt: ledger.reservedAt ?? '',
  settledAt: ledger.settledAt ?? null,
  releasedAt: ledger.releasedAt ?? null,
  reconciliationAt: ledger.reconciliationAt ?? null,
  createdAt: ledger.createdAt ?? '',
  updatedAt: ledger.updatedAt ?? '',
  budgetWindow: budgetWindow ? serializeCreativeProviderBudgetWindow(budgetWindow) : null,
})

export const serializeCreativeProviderControlState = (control) => ({
  id: String(control.id),
  scopeKey: control.scopeKey,
  scopeType: control.scopeType,
  providerId: control.providerId ?? null,
  providerAccountRef: control.providerAccountRef ?? null,
  workspace: control.workspace ?? null,
  modelFamily: control.modelFamily ?? null,
  enabled: Boolean(control.enabled),
  version: Number(control.version),
  reasonCode: control.reasonCode,
  changedByRef: control.changedByRef ?? null,
  enabledAt: control.enabledAt ?? null,
  disabledAt: control.disabledAt ?? null,
  createdAt: control.createdAt ?? '',
  updatedAt: control.updatedAt ?? '',
})

export const serializeCreativeProviderCapEvidence = (evidence) => ({
  schemaVersion: 'provider-cap-evidence-v1',
  id: String(evidence.id),
  sourceKey: evidence.sourceKey,
  scopeKey: evidence.scopeKey,
  providerId: evidence.providerId,
  providerAccountRef: evidence.providerAccountRef,
  currency: evidence.currency,
  capMicros: String(evidence.capMicros),
  remainingMicros: evidence.remainingMicros == null ? null : String(evidence.remainingMicros),
  sourceType: evidence.sourceType,
  sourceRefHash: evidence.sourceRefHash,
  evidenceHash: evidence.evidenceHash,
  verifiedAt: evidence.verifiedAt ?? '',
  expiresAt: evidence.expiresAt ?? '',
  active: Boolean(evidence.active),
  createdAt: evidence.createdAt ?? '',
})

export const serializeCreativeProviderCircuitState = (circuit) => ({
  id: String(circuit.id),
  scopeKey: circuit.scopeKey,
  providerId: circuit.providerId,
  providerAccountRef: circuit.providerAccountRef,
  workspace: circuit.workspace,
  modelFamily: circuit.modelFamily ?? null,
  status: circuit.status,
  version: Number(circuit.version),
  failureCount: Number(circuit.failureCount),
  windowStartedAt: circuit.windowStartedAt ?? null,
  lastFailureAt: circuit.lastFailureAt ?? null,
  openedAt: circuit.openedAt ?? null,
  cooldownUntil: circuit.cooldownUntil ?? null,
  probeLeaseActive: Boolean(circuit.probeLeaseTokenHash && circuit.probeLeaseExpiresAt),
  probeLeaseExpiresAt: circuit.probeLeaseExpiresAt ?? null,
  reasonCode: circuit.reasonCode ?? null,
  createdAt: circuit.createdAt ?? '',
  updatedAt: circuit.updatedAt ?? '',
})

export const serializeCreativeProviderCircuitEvent = (event) => ({
  id: String(event.id),
  sourceKey: event.sourceKey,
  circuitStateId: event.circuitStateId,
  category: event.category,
  outcome: event.outcome,
  occurredAt: event.occurredAt ?? '',
  createdAt: event.createdAt ?? '',
})

export const serializeCreativeProviderRetryState = (state) => ({
  schemaVersion: 'provider-retry-state-v1',
  id: String(state.id),
  sourceKey: state.sourceKey,
  generationId: String(state.generationId),
  providerId: state.providerId,
  workspace: state.workspace,
  operationType: state.operationType,
  status: state.status,
  attempt: Number(state.attempt),
  maxAttempts: Number(state.maxAttempts),
  firstAttemptAt: state.firstAttemptAt ?? '',
  lastAttemptAt: state.lastAttemptAt ?? '',
  nextAttemptAt: state.nextAttemptAt ?? null,
  lastFailureKeyHash: state.lastFailureKeyHash,
  lastErrorCode: state.lastErrorCode,
  lastErrorCategory: state.lastErrorCategory,
  delaySource: state.delaySource ?? null,
  policyHash: state.policyHash,
  version: Number(state.version),
  createdAt: state.createdAt ?? '',
  updatedAt: state.updatedAt ?? '',
})

export const serializeNotification = (notification) => ({
  id: String(notification.id),
  type: notification.type,
  title: notification.title,
  body: notification.body,
  resourceType: notification.resourceType,
  resourceId: notification.resourceId ?? null,
  metadata: sanitizeNotificationMetadata(notification.metadata, notification),
  templateKey: notification.templateKey ?? null,
  templateVersion: notification.templateVersion ?? null,
  readAt: notification.readAt ?? null,
  createdAt: notification.createdAt ?? '',
})

export const serializeAuditEvent = (event) => {
  const providerBudgetEvent = isProviderBudgetAuditEvent(event)
  const providerControlEvent = isProviderControlAuditEvent(event)
  const providerLifecycleEvent = isProviderLifecycleAuditEvent(event)
  const providerRetryEvent = isProviderRetryAuditEvent(event)
  const providerReplayLedgerEvent = isProviderReplayLedgerAuditEvent(event)
  const creativeGenerationEvent = isCreativeGenerationAuditEvent(event)
  const creativeAccountingEvent = isCreativeAccountingAuditEvent(event)
  const mediaAssetLifecycleEvent = isMediaAssetLifecycleAuditEvent(event)
  return {
    id: String(event.id),
    actorType: event.actorType,
    actorId: event.actorId ?? null,
    action: event.action,
    resourceType: event.resourceType,
    resourceId: providerBudgetEvent || providerControlEvent
      ? safeProviderBudgetEvidenceIdentifier(event.resourceId)
      : providerLifecycleEvent || providerRetryEvent
        ? safeProviderLifecycleEvidenceIdentifier(event.resourceId)
        : providerReplayLedgerEvent
          ? safeProviderLifecycleEvidenceIdentifier(event.resourceId)
          : creativeGenerationEvent
            ? safeProviderLifecycleEvidenceIdentifier(event.resourceId)
            : creativeAccountingEvent
              ? safeProviderLifecycleEvidenceIdentifier(event.resourceId)
              : mediaAssetLifecycleEvent
                ? safeProviderLifecycleEvidenceIdentifier(event.resourceId)
                : event.resourceId ?? null,
    metadata: providerControlEvent
      ? safeProviderControlAuditMetadata(event.metadata)
      : providerBudgetEvent
      ? safeProviderBudgetAuditMetadata(event.metadata)
      : providerLifecycleEvent
        ? safeProviderLifecycleAuditMetadata(event.metadata)
        : providerRetryEvent
          ? safeProviderRetryAuditMetadata(event.metadata)
        : providerReplayLedgerEvent
          ? safeProviderReplayLedgerAuditMetadata(event.metadata)
          : creativeGenerationEvent
            ? safeCreativeGenerationAuditMetadata(event.metadata)
            : creativeAccountingEvent
              ? safeCreativeAccountingAuditMetadata(event.metadata)
              : mediaAssetLifecycleEvent
                ? safeMediaAssetLifecycleAuditMetadata(event.metadata)
                : safeAuditMetadata(event.metadata ?? null),
    diff: projectAuditDiff(event.metadata),
    createdAt: event.createdAt?.toISOString?.() ?? event.createdAt ?? '',
    integrity: event.sequence == null || !event.contentHash ? null : {
      sequence: String(event.sequence),
      previousHash: event.previousHash ?? null,
      contentHash: event.contentHash,
      chainVersion: event.chainVersion ?? 1,
    },
  }
}

export const serializeSecurityEvent = (event) => ({
  id: String(event.id),
  type: event.type,
  severity: event.severity,
  source: event.source,
  clientKey: event.clientKey ?? null,
  identity: event.identity ?? null,
  method: event.method ?? null,
  pathname: event.pathname ?? null,
  occurredAt: event.occurredAt?.toISOString?.() ?? event.occurredAt ?? '',
  details: event.details ?? null,
})

export const serializeSecurityAlertDispatchEvent = (event) => {
  const metadata = event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
    ? event.metadata
    : {}
  return {
    id: String(event.id),
    type: event.action ?? 'security.alert.dispatch',
    severity: String(metadata.severity ?? 'warning'),
    source: 'alert_dispatch',
    clientKey: metadata.channel ? String(metadata.channel) : null,
    identity: metadata.status ? String(metadata.status) : null,
    method: null,
    pathname: metadata.alertType ? String(metadata.alertType) : event.resourceId ?? null,
    occurredAt: event.createdAt?.toISOString?.() ?? event.createdAt ?? '',
    details: metadata,
  }
}

export const serializePost = (post) => ({
  id: String(post.id),
  title: post.title,
  category: post.category,
  author: post.author,
  replies: post.replies,
  likes: parsePoints(post.likes),
  views: parsePoints(post.views),
  votes: post.votes,
  tag: post.tag,
  solved: post.solved,
  excerpt: post.excerpt,
  body: post.body,
  status: post.status ?? 'published',
  version: Number(post.version) || 1,
  createdAt: post.createdAt ?? null,
  updatedAt: post.updatedAt ?? post.createdAt ?? null,
  publishedAt: post.publishedAt ?? null,
  deletedAt: post.deletedAt ?? null,
  deletionReasonCode: post.deletionReasonCode ?? null,
})

export const serializePostDetail = (post) => ({
  ...serializePost(post),
  comments: post.comments ?? [],
  relatedTasks: post.relatedTasks ?? [],
  viewerPermissions: post.viewerPermissions ?? {},
})

export const serializeProfile = (profile) => ({
  handle: profile.handle,
  lane: profile.lane,
  initials: profile.initials,
  name: profile.name,
  role: profile.role,
  bio: profile.bio,
  tags: profile.tags,
  zhTags: profile.zhTags,
  categories: profile.categories,
  languages: profile.languages,
  stats: profile.stats,
  badges: profile.badges,
  portfolio: profile.portfolio,
  reviews: profile.reviews,
})

export const serializeLedgerEntry = (entry) => ({
  id: entry.id,
  occurredAtLabel: entry.occurredAtLabel,
  description: entry.description,
  delta: entry.delta,
  balanceAfter: entry.balanceAfter,
  status: entry.status,
  sourceType: entry.sourceType,
  sourceId: entry.sourceId ?? null,
  userHandle: entry.userHandle ?? null,
})

export const serializeAdminReview = (review) => ({
  id: String(review.id),
  status: review.status,
  title: review.title,
  owner: review.owner,
  note: review.note,
  queue: review.queue,
  decision: review.decision ?? undefined,
  reviewedBy: review.reviewedBy ?? null,
  reviewedAt: review.reviewedAt ?? null,
  metadata: review.metadata ?? null,
})

export const serializeLibraryItem = (item) => ({
  id: String(item.id),
  title: item.title,
  type: item.type,
  source: item.source,
  saves: item.saves,
  text: item.text,
  sourceId: item.sourceId ?? null,
  metadata: item.metadata ?? null,
})
