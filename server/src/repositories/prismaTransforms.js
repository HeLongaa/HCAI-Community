import { safeErrorPreview } from '../creative/generationRecords.js'
import { sanitizeNotificationMetadata } from './notificationTargets.js'

const asObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : null)

const firstNonEmpty = (...values) => values.find((value) => value !== undefined && value !== null && value !== '')

const parsePoints = (value) => {
  const cleaned = String(value ?? '').replace(/[^\d-]/g, '')
  const parsed = Number.parseInt(cleaned, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

const parseDateOrNull = (value) => {
  const timestamp = Date.parse(String(value ?? ''))
  return Number.isFinite(timestamp) ? new Date(timestamp) : null
}

const parseMoney = (value) => {
  if (value && typeof value === 'object') {
    return parseMoney(value.money)
  }
  const text = String(value ?? '').trim()
  if (!text) {
    return { amount: null, currency: null }
  }
  const currencyMatch = text.match(/^[^\d]+/)
  const numeric = Number.parseFloat(text.replace(/[^\d.-]/g, ''))
  return {
    amount: Number.isFinite(numeric) ? numeric : null,
    currency: currencyMatch?.[0] ?? null,
  }
}

const makeAccountSummary = (account) => ({
  handle: account.handle,
  name: { en: account.displayName ?? account.handle, zh: account.displayName ?? account.handle },
  role: { en: account.role ?? 'member', zh: account.role ?? 'member' },
  lane: account.profile?.lane ?? 'both',
  initials: String(account.displayName ?? account.handle).slice(0, 2).toUpperCase(),
})

const taskStatusLabel = {
  draft: 'Draft',
  open: 'Open',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  submitted: 'Submitted',
  pending_review: 'Pending Review',
  disputed: 'Disputed',
  completed: 'Completed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  expired: 'Expired',
}

const taskStatusValue = {
  Draft: 'draft',
  Open: 'open',
  Assigned: 'assigned',
  'In Progress': 'in_progress',
  Submitted: 'submitted',
  'Pending Review': 'pending_review',
  Disputed: 'disputed',
  Completed: 'completed',
  Rejected: 'rejected',
  Cancelled: 'cancelled',
  Expired: 'expired',
  draft: 'draft',
  open: 'open',
  assigned: 'assigned',
  in_progress: 'in_progress',
  submitted: 'submitted',
  pending_review: 'pending_review',
  disputed: 'disputed',
  completed: 'completed',
  rejected: 'rejected',
  cancelled: 'cancelled',
  expired: 'expired',
}

const buildProfileSummary = (profile) => {
  const metadata = asObject(profile?.metadata)
  const user = profile?.user ?? null
  const displayName = String(firstNonEmpty(metadata?.name?.en, user?.displayName, profile?.handle, user?.id, 'User'))
  const role = firstNonEmpty(metadata?.role, user?.role ? { en: user.role, zh: user.role } : null, {
    en: 'Member',
    zh: '成员',
  })
  return {
    handle: profile?.handle ?? user?.id ?? '',
    name: metadata?.name ?? { en: displayName, zh: displayName },
    role,
    lane: profile?.lane ?? metadata?.lane ?? 'both',
    initials: metadata?.initials ?? displayName.slice(0, 2).toUpperCase(),
  }
}

const buildFallbackProfile = (profile) => ({
  handle: profile.handle,
  lane: profile.lane,
  initials: profile.handle.slice(0, 2).toUpperCase(),
  name: { en: profile.handle, zh: profile.handle },
  role: { en: 'Member', zh: '成员' },
  bio: '',
  tags: [],
  zhTags: [],
  categories: [],
  languages: [],
  stats: {},
  badges: [],
  portfolio: [],
  reviews: [],
})

export const getCommentDto = (comment) => ({
  id: comment.id,
  body: comment.body,
  author: comment.author ? buildProfileSummary(comment.author.profile ? comment.author.profile : comment.author) : null,
  parentId: comment.parentId ?? null,
  moderationState: comment.moderationState ?? 'visible',
  moderationVersion: comment.moderationVersion ?? 0,
  moderationUpdatedAt: comment.moderationUpdatedAt?.toISOString?.() ?? null,
  createdAt: comment.createdAt ? comment.createdAt.toISOString() : '',
})

export const getTaskDto = (task) => {
  const metadata = asObject(task.metadata)
  if (metadata) {
    return {
      ...metadata,
      status: taskStatusLabel[task.status] ?? task.status,
      deadline: task.deadlineAt?.toISOString?.() ?? metadata.deadline ?? '',
      version: task.version ?? 1,
      cancelledAt: task.cancelledAt?.toISOString?.() ?? null,
      expiredAt: task.expiredAt?.toISOString?.() ?? null,
      terminalReasonCode: task.terminalReasonCode ?? null,
    }
  }
  const publisher = task.publisher ? buildProfileSummary(task.publisher.profile ? task.publisher.profile : task.publisher) : null
  const assignee = task.assignee ? buildProfileSummary(task.assignee.profile ? task.assignee.profile : task.assignee) : null
  return {
    id: task.id,
    title: task.title,
    category: task.category,
    budget: {
      money: task.rewardCurrency ? `${task.rewardCurrency}${task.rewardAmount ?? ''}` : String(task.rewardAmount ?? ''),
      points: task.pointsReward,
    },
    status: taskStatusLabel[task.status] ?? task.status,
    deadline: task.deadlineAt ? task.deadlineAt.toISOString() : '',
    proposals: 0,
    description: task.description,
    publisher,
    assignee,
    requirements: [],
    attachments: [],
    privateBrief: '',
    submission: '',
    resultLinks: [],
    reviewNote: '',
    rights: '',
    version: task.version ?? 1,
    cancelledAt: task.cancelledAt?.toISOString?.() ?? null,
    expiredAt: task.expiredAt?.toISOString?.() ?? null,
    terminalReasonCode: task.terminalReasonCode ?? null,
  }
}

export const getTaskProposalDto = (proposal) => ({
  id: proposal.id,
  taskId: proposal.taskId,
  proposer: proposal.proposer ? buildUserSummary(proposal.proposer) : null,
  coverLetter: proposal.coverLetter,
  estimate: proposal.estimate ?? '',
  status: proposal.status,
  decisionNote: asObject(proposal.metadata)?.decisionNote ?? '',
  createdAt: proposal.createdAt ? proposal.createdAt.toISOString() : '',
})

export const getTaskSubmissionDto = (submission) => ({
  id: submission.id,
  taskId: submission.taskId,
  submitter: submission.submitter ? buildUserSummary(submission.submitter) : null,
  content: submission.content,
  assetIds: submission.assetIds ?? [],
  rightsNote: submission.rightsNote ?? '',
  status: submission.status,
  reviewNote: submission.reviewNote ?? '',
  acceptanceChecklist: asObject(submission.metadata)?.acceptanceChecklist ?? [],
  dispute: asObject(submission.metadata)?.dispute ?? null,
  stale: asObject(submission.metadata)?.stale ?? null,
  assetEvidence: asObject(submission.metadata)?.assetEvidence ?? [],
  reviewedBy: submission.reviewedBy ? buildUserSummary(submission.reviewedBy) : null,
  reviewedAt: submission.reviewedAt ? submission.reviewedAt.toISOString() : null,
  createdAt: submission.createdAt ? submission.createdAt.toISOString() : '',
})

export const getPortfolioAssetDto = (item) => ({
  id: item.id,
  assetId: item.assetId,
  sourceGenerationId: item.sourceGenerationId ?? null,
  sourceSubmissionId: item.sourceSubmissionId ?? null,
  title: item.title,
  caption: item.caption,
  status: item.status,
  sortOrder: item.sortOrder,
  publishedAt: item.publishedAt?.toISOString() ?? null,
  withdrawnAt: item.withdrawnAt?.toISOString() ?? null,
  archivedAt: item.archivedAt?.toISOString() ?? null,
  createdAt: item.createdAt?.toISOString() ?? '',
  updatedAt: item.updatedAt?.toISOString() ?? '',
  asset: item.asset ? {
    id: item.asset.id,
    fileName: item.asset.fileName,
    contentType: item.asset.contentType,
    purpose: item.asset.purpose,
  } : null,
})

export const getMediaAssetDto = (asset) => ({
  id: asset.id,
  fileName: asset.fileName,
  storageKey: asset.storageKey,
  contentType: asset.contentType,
  sizeBytes: asset.sizeBytes,
  purpose: asset.purpose,
  status: asset.status,
  storage: asset.storageObject ? {
    provider: asset.storageObject.provider,
    state: asset.storageObject.state,
    verifiedSizeBytes: asset.storageObject.verifiedSizeBytes ?? null,
    verifiedContentType: asset.storageObject.verifiedContentType ?? null,
    verifiedAt: asset.storageObject.verifiedAt?.toISOString?.() ?? asset.storageObject.verifiedAt ?? null,
    quarantinedAt: asset.storageObject.quarantinedAt?.toISOString?.() ?? asset.storageObject.quarantinedAt ?? null,
    cleanupAfter: asset.storageObject.cleanupAfter?.toISOString?.() ?? asset.storageObject.cleanupAfter ?? null,
    deletedAt: asset.storageObject.deletedAt?.toISOString?.() ?? asset.storageObject.deletedAt ?? null,
    lastErrorCode: asset.storageObject.lastErrorCode ?? null,
    version: Number(asset.storageObject.version ?? 1),
  } : null,
  metadata: asset.metadata ?? null,
  archivedAt: asset.archivedAt?.toISOString() ?? null,
  deletedAt: asset.deletedAt?.toISOString() ?? null,
  deletionReason: asset.deletionReason ?? null,
  createdAt: asset.createdAt ? asset.createdAt.toISOString() : '',
  updatedAt: asset.updatedAt ? asset.updatedAt.toISOString() : '',
})

export const getCreativeGenerationDto = (generation) => ({
  id: generation.id,
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
  startedAt: generation.startedAt ? generation.startedAt.toISOString() : null,
  completedAt: generation.completedAt ? generation.completedAt.toISOString() : null,
  failedAt: generation.failedAt ? generation.failedAt.toISOString() : null,
  createdAt: generation.createdAt ? generation.createdAt.toISOString() : '',
  updatedAt: generation.updatedAt ? generation.updatedAt.toISOString() : '',
})

export const getCreativeGenerationMutationDto = (mutation) => ({
  id: String(mutation.id),
  generationId: mutation.generationId,
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
  completedAt: mutation.completedAt ? mutation.completedAt.toISOString() : null,
  createdAt: mutation.createdAt ? mutation.createdAt.toISOString() : '',
  updatedAt: mutation.updatedAt ? mutation.updatedAt.toISOString() : '',
})

export const getCreativeProviderOperationDto = (operation) => ({
  id: String(operation.id),
  generationId: operation.generationId,
  providerId: operation.providerId,
  providerMode: operation.providerMode,
  providerJobId: operation.providerJobId,
  status: operation.status,
  version: Number(operation.version),
  pollAttempts: Number(operation.pollAttempts),
  nextPollAt: operation.nextPollAt?.toISOString() ?? null,
  timeoutAt: operation.timeoutAt.toISOString(),
  lastPayloadHash: operation.lastPayloadHash ?? null,
  outputDigest: operation.outputDigest ?? null,
  lastErrorCode: operation.lastErrorCode ?? null,
  sideEffectsComplete: Boolean(operation.sideEffectsComplete),
  safeMetadata: operation.safeMetadata ?? null,
  terminalAt: operation.terminalAt?.toISOString() ?? null,
  createdAt: operation.createdAt.toISOString(),
  updatedAt: operation.updatedAt.toISOString(),
})

export const getCreativeProviderReplayDto = (replay) => ({
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
  receivedAt: replay.receivedAt ? replay.receivedAt.toISOString() : '',
  appliedAt: replay.appliedAt ? replay.appliedAt.toISOString() : null,
  createdAt: replay.createdAt ? replay.createdAt.toISOString() : '',
  updatedAt: replay.updatedAt ? replay.updatedAt.toISOString() : '',
})

export const getCreativeOutputIngestionDto = (ingestion) => ({
  id: String(ingestion.id),
  sourceKey: ingestion.sourceKey,
  generationId: ingestion.generationId,
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
  claimedAt: ingestion.claimedAt ? ingestion.claimedAt.toISOString() : null,
  leaseExpiresAt: ingestion.leaseExpiresAt ? ingestion.leaseExpiresAt.toISOString() : null,
  completedAt: ingestion.completedAt ? ingestion.completedAt.toISOString() : null,
  createdAt: ingestion.createdAt ? ingestion.createdAt.toISOString() : '',
  updatedAt: ingestion.updatedAt ? ingestion.updatedAt.toISOString() : '',
})

export const getCreativeProviderBudgetWindowDto = (window) => ({
  id: window.id,
  budgetScope: window.budgetScope,
  providerId: window.providerId,
  providerAccountRef: window.providerAccountRef,
  workspace: window.workspace,
  currency: window.currency,
  windowStart: window.windowStart.toISOString(),
  windowEnd: window.windowEnd.toISOString(),
  capMicros: String(window.capMicros),
  reservedMicros: String(window.reservedMicros),
  spentMicros: String(window.spentMicros),
  releasedMicros: String(window.releasedMicros),
  createdAt: window.createdAt.toISOString(),
  updatedAt: window.updatedAt.toISOString(),
})

export const getCreativeProviderCostLedgerDto = (ledger) => ({
  id: ledger.id,
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
  reservedAt: ledger.reservedAt.toISOString(),
  settledAt: ledger.settledAt?.toISOString() ?? null,
  releasedAt: ledger.releasedAt?.toISOString() ?? null,
  reconciliationAt: ledger.reconciliationAt?.toISOString() ?? null,
  createdAt: ledger.createdAt.toISOString(),
  updatedAt: ledger.updatedAt.toISOString(),
  budgetWindow: ledger.budgetWindow ? getCreativeProviderBudgetWindowDto(ledger.budgetWindow) : null,
})

export const getCreativeProviderControlStateDto = (control) => ({
  id: control.id,
  scopeKey: control.scopeKey,
  scopeType: control.scopeType,
  providerId: control.providerId ?? null,
  providerAccountRef: control.providerAccountRef ?? null,
  workspace: control.workspace ?? null,
  modelFamily: control.modelFamily ?? null,
  enabled: control.enabled,
  version: control.version,
  reasonCode: control.reasonCode,
  changedByRef: control.changedByRef ?? null,
  enabledAt: control.enabledAt?.toISOString() ?? null,
  disabledAt: control.disabledAt?.toISOString() ?? null,
  createdAt: control.createdAt.toISOString(),
  updatedAt: control.updatedAt.toISOString(),
})

export const getCreativeProviderCapEvidenceDto = (evidence) => ({
  schemaVersion: 'provider-cap-evidence-v1',
  id: evidence.id,
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
  verifiedAt: evidence.verifiedAt.toISOString(),
  expiresAt: evidence.expiresAt.toISOString(),
  active: evidence.active,
  createdAt: evidence.createdAt.toISOString(),
})

export const getCreativeProviderCircuitStateDto = (circuit) => ({
  id: circuit.id,
  scopeKey: circuit.scopeKey,
  providerId: circuit.providerId,
  providerAccountRef: circuit.providerAccountRef,
  workspace: circuit.workspace,
  modelFamily: circuit.modelFamily ?? null,
  status: circuit.status,
  version: circuit.version,
  failureCount: circuit.failureCount,
  windowStartedAt: circuit.windowStartedAt?.toISOString() ?? null,
  lastFailureAt: circuit.lastFailureAt?.toISOString() ?? null,
  openedAt: circuit.openedAt?.toISOString() ?? null,
  cooldownUntil: circuit.cooldownUntil?.toISOString() ?? null,
  probeLeaseActive: Boolean(circuit.probeLeaseTokenHash && circuit.probeLeaseExpiresAt),
  probeLeaseExpiresAt: circuit.probeLeaseExpiresAt?.toISOString() ?? null,
  reasonCode: circuit.reasonCode ?? null,
  createdAt: circuit.createdAt.toISOString(),
  updatedAt: circuit.updatedAt.toISOString(),
})

export const getCreativeProviderCircuitEventDto = (event) => ({
  id: event.id,
  sourceKey: event.sourceKey,
  circuitStateId: event.circuitStateId,
  category: event.category,
  outcome: event.outcome,
  occurredAt: event.occurredAt.toISOString(),
  createdAt: event.createdAt.toISOString(),
})

export const getCreativeProviderRetryStateDto = (state) => ({
  schemaVersion: 'provider-retry-state-v1',
  id: state.id,
  sourceKey: state.sourceKey,
  generationId: state.generationId,
  providerId: state.providerId,
  workspace: state.workspace,
  operationType: state.operationType,
  status: state.status,
  attempt: state.attempt,
  maxAttempts: state.maxAttempts,
  firstAttemptAt: state.firstAttemptAt.toISOString(),
  lastAttemptAt: state.lastAttemptAt.toISOString(),
  nextAttemptAt: state.nextAttemptAt?.toISOString() ?? null,
  lastFailureKeyHash: state.lastFailureKeyHash,
  lastErrorCode: state.lastErrorCode,
  lastErrorCategory: state.lastErrorCategory,
  delaySource: state.delaySource ?? null,
  policyHash: state.policyHash,
  version: state.version,
  createdAt: state.createdAt.toISOString(),
  updatedAt: state.updatedAt.toISOString(),
})

export const getMediaScanJobDto = (job) => ({
  id: job.id,
  assetId: job.assetId,
  provider: job.provider,
  status: job.status,
  scanStatus: job.scanStatus,
  externalScanId: job.externalScanId ?? null,
  attempts: job.attempts,
  requestedAt: job.requestedAt ? job.requestedAt.toISOString() : null,
  timeoutAt: job.timeoutAt ? job.timeoutAt.toISOString() : null,
  nextRetryAt: job.nextRetryAt ? job.nextRetryAt.toISOString() : null,
  callbackAt: job.callbackAt ? job.callbackAt.toISOString() : null,
  failedAt: job.failedAt ? job.failedAt.toISOString() : null,
  reviewedById: job.reviewedById ?? null,
  reviewedAt: job.reviewedAt ? job.reviewedAt.toISOString() : null,
  note: job.note ?? null,
  rejectionReason: job.rejectionReason ?? null,
  metadata: job.metadata ?? null,
  createdAt: job.createdAt ? job.createdAt.toISOString() : '',
  updatedAt: job.updatedAt ? job.updatedAt.toISOString() : '',
})

export const getNotificationDto = (notification) => ({
  id: notification.id,
  type: notification.type,
  title: notification.title,
  body: notification.body,
  resourceType: notification.resourceType,
  resourceId: notification.resourceId ?? null,
  metadata: sanitizeNotificationMetadata(notification.metadata, notification),
  templateKey: notification.templateKey ?? null,
  templateVersion: notification.templateVersion ?? null,
  readAt: notification.readAt ? notification.readAt.toISOString() : null,
  createdAt: notification.createdAt ? notification.createdAt.toISOString() : '',
})

export const getPostDto = (post) => {
  const metadata = asObject(post.metadata)
  return {
    ...(metadata ?? {}),
    id: post.id,
    title: post.title,
    category: post.category,
    author: (metadata?.author ?? (post.author ? buildProfileSummary(post.author.profile ? post.author.profile : post.author) : null)),
    replies: metadata?.replies ?? 0,
    likes: post.likesCount,
    views: post.viewsCount,
    votes: metadata?.votes ?? 0,
    tag: metadata?.tag ?? '',
    solved: post.solved,
    excerpt: metadata?.excerpt ?? '',
    body: post.body,
    status: post.status ?? 'published',
    version: post.version ?? 1,
    createdAt: post.createdAt?.toISOString?.() ?? null,
    updatedAt: post.updatedAt?.toISOString?.() ?? post.createdAt?.toISOString?.() ?? null,
    publishedAt: post.publishedAt?.toISOString?.() ?? null,
    deletedAt: post.deletedAt?.toISOString?.() ?? null,
    deletionReasonCode: post.deletionReasonCode ?? null,
    moderationState: post.moderationState ?? 'visible',
    moderationVersion: post.moderationVersion ?? 0,
    moderationUpdatedAt: post.moderationUpdatedAt?.toISOString?.() ?? null,
  }
}

export const getPostDetailDto = (post, viewer = null) => {
  const base = getPostDto(post)
  const metadata = asObject(post.metadata) ?? {}
  const canModerate = Array.isArray(viewer?.permissions) && viewer.permissions.includes('post:moderate')
  const ownerHandle = post.author?.profile?.handle ?? null
  const isOwner = Boolean(viewer?.handle && ownerHandle === viewer.handle)
  return {
    ...base,
    comments: (post.comments ?? [])
      .filter((comment) => comment.moderationState !== 'hidden' || canModerate || comment.author?.profile?.handle === viewer?.handle)
      .map(getCommentDto),
    relatedTasks: metadata.relatedTasks ?? [],
    viewerPermissions: metadata.viewerPermissions ?? {
      canComment: Boolean(viewer),
      canLike: Boolean(viewer),
      canConvertToTask: Boolean(viewer),
      canModerate,
      canEdit: isOwner && post.status !== 'deleted',
      canDelete: isOwner && post.status !== 'deleted',
      canPublish: isOwner && post.status === 'draft',
    },
  }
}

export const getProfileDto = (profile) => {
  const metadata = asObject(profile.metadata)
  if (metadata) {
    return metadata
  }
  return buildFallbackProfile(profile)
}

export const getLedgerDto = (entry) => ({
  id: entry.id,
  occurredAtLabel: entry.occurredAtLabel ?? '',
  description: entry.description ?? '',
  delta: entry.delta,
  balanceAfter: entry.balanceAfter,
  status: entry.status,
  sourceType: entry.sourceType,
  sourceId: entry.sourceId ?? null,
  userHandle: entry.user?.profile?.handle ?? null,
})

export const getAdminReviewDto = (review) => {
  const reviewerHandle = review.reviewedBy?.profile?.handle ?? review.reviewedBy?.id ?? null
  return {
    id: review.id,
    status: review.status,
    title: review.title,
    owner: review.owner,
    note: review.note,
    queue: review.queue,
    decision: review.decision ?? undefined,
    reviewedBy: reviewerHandle,
    reviewedAt: review.reviewedAt ? review.reviewedAt.toISOString() : null,
    metadata: review.metadata ?? null,
  }
}

export const buildAdminReviewRecord = (review) => ({
  id: review.id,
  queue: review.queue,
  status: review.status,
  title: review.title,
  owner: review.owner,
  note: review.note,
  decision: review.decision ?? null,
  metadata: review.metadata ?? null,
})

export const buildTaskRecord = (task, publisher, assignee) => {
  const money = parseMoney(task.budget)
  return {
    id: String(task.id),
    title: task.title,
    category: task.category,
    description: task.description,
    acceptanceRules: task.requirements?.[0] ?? task.reviewNote ?? task.rights ?? task.description,
    rewardAmount: money.amount == null ? null : String(money.amount),
    rewardCurrency: money.currency,
    pointsReward: parsePoints(task.pointsReward ?? task.points ?? task.budget?.points),
    status: taskStatusValue[task.status] ?? 'open',
    publisherId: publisher.id,
    assigneeId: assignee?.id ?? null,
    visibility: task.status === 'Open' || task.status === 'open' ? 'public' : 'community',
    deadlineAt: parseDateOrNull(task.deadline),
    metadata: task,
  }
}

export const buildPostRecord = (post, author) => ({
  id: String(post.id),
  authorId: author.id,
  title: post.title,
  body: post.body ?? post.excerpt,
  category: post.category,
  tag: post.tag,
  solved: Boolean(post.solved),
  viewsCount: parsePoints(post.views),
  likesCount: parsePoints(post.likes),
  metadata: post,
})

export const buildPostCommentRecord = (comment, post, author, parent = null) => ({
  id: String(comment.id),
  postId: String(post.id),
  authorId: author.id,
  parentId: parent ? String(parent.id) : null,
  body: comment.body,
})

export const buildPostLikeRecord = (post, user, id) => ({
  id,
  postId: String(post.id),
  userId: user.id,
})

export const buildLibraryItemRecord = (item, user) => ({
  id: item.id ?? `library-${Date.now()}`,
  userId: user.id,
  sourceType: item.sourceType,
  sourceId: item.sourceId ?? null,
  title: item.title,
  content: item.content,
  metadata: item.metadata ?? null,
})

export const buildAuditRecord = ({ actorType, actorId = null, action, resourceType, resourceId = null, metadata = null }) => ({
  actorType,
  actorId,
  action,
  resourceType,
  resourceId,
  metadata,
})

export const buildProfileRecord = (profile, user) => ({
  userId: user.id,
  handle: profile.handle,
  bio: typeof profile.bio === 'string' ? profile.bio : profile.bio?.en ?? null,
  lane: profile.lane,
  skills: profile.tags ?? [],
  languages: profile.languages ?? [],
  portfolio: profile.portfolio ?? null,
  stats: profile.stats ?? null,
  metadata: profile,
})

export const buildLedgerRecord = (entry, user, index) => ({
  id: `ledger-${String(index + 1).padStart(3, '0')}`,
  userId: user.id,
  sourceType: 'community',
  sourceId: null,
  delta: parsePoints(entry[2]),
  balanceAfter: parsePoints(entry[3]),
  status: 'settled',
  description: entry[1],
  occurredAtLabel: entry[0],
})

export const buildUserSummary = (row) => {
  if (!row) {
    return null
  }
  const profile = row.profile ? buildProfileSummary(row.profile) : null
  if (profile) {
    return profile
  }
  const displayName = String(firstNonEmpty(row.displayName, row.profile?.handle, row.email, row.id, 'User'))
  return {
    handle: row.id,
    name: { en: displayName, zh: displayName },
    role: { en: row.role ?? 'member', zh: row.role ?? 'member' },
    lane: 'both',
    initials: displayName.slice(0, 2).toUpperCase(),
  }
}

export const parseTaskStatus = (status) => taskStatusValue[status] ?? 'open'

export const parseTaskVisibility = (status) => (status === 'Open' ? 'public' : 'community')

export const getParsedMoney = parseMoney
export const buildAccountSummary = makeAccountSummary

export const buildTaskViewModel = ({
  id,
  title,
  category,
  status,
  budget,
  deadline,
  deadlineAt = deadline && deadline !== 'TBD' ? deadline : null,
  pointsReward = 0,
  proposals = 0,
  description,
  publisher,
  assignee = null,
  requirements = [],
  attachments = [],
  privateBrief = '',
  submission = '',
  resultLinks = [],
  reviewNote = '',
  rights = '',
}) => ({
  id: String(id),
  title,
  category,
  status,
  budget,
  deadline,
  deadlineAt,
  pointsReward,
  proposals,
  description,
  publisher,
  assignee,
  requirements,
  attachments,
  privateBrief,
  submission,
  resultLinks,
  reviewNote,
  rights,
  version: 1,
  cancelledAt: null,
  expiredAt: null,
  terminalReasonCode: null,
})

export const taskStatusToLabel = (status) => taskStatusLabel[status] ?? status
export const taskStatusFromLabel = (status) => taskStatusValue[status] ?? 'open'
