import type { AuditEvent, MarketplaceProfile, Permission, Role } from '../domain/types'

export type ApiErrorBody = {
  code: string
  message: string
  details?: unknown
}

export type ApiEnvelope<T> = {
  data: T
  meta?: unknown
  error?: ApiErrorBody
}

export type ApiPaginationMeta = {
  pagination?: {
    limit?: number
    nextCursor?: string | null
  }
}

export type ApiProfileSummary = {
  handle: string
  name?: { en: string; zh: string }
  role?: { en: string; zh: string }
  lane?: string
  initials?: string
}

export type ApiAccount = {
  id: string
  handle: string
  email?: string
  displayName: string
  role: Role
  permissions: Permission[]
  profile?: ApiProfileSummary | null
}

export type LoginRequest = {
  handle?: string
  email?: string
  password?: string
}

export type RegisterRequest = {
  email: string
  password: string
  displayName?: string
  handle?: string
}

export type RefreshSessionRequest = {
  refreshToken?: string
}

export type LogoutRequest = {
  refreshToken?: string | null
}

export type SessionResponse = {
  accessToken: string
  refreshToken: string
  user: ApiAccount
}

export type OAuthProvider = 'google' | 'apple' | 'discord' | 'dev'

export type OAuthStartResponse = {
  provider: OAuthProvider
  state: string
  mode: 'dev' | 'external'
  authorizationUrl: string
}

export type OAuthProviderMetadata = {
  provider: OAuthProvider
  label: string
  configured: boolean
  mode: 'dev' | 'external'
  authorizationUrl: string
  callbackMethod: 'GET' | 'POST'
  scopes: string[]
}

export type OAuthAccountLink = {
  provider: OAuthProvider
  linked: true
  providerUserIdHint: string
}

export type OAuthSessionResponse = SessionResponse & {
  redirectTo?: string
}

export type ApiSession = {
  id: string
  familyId: string
  createdAt: string | null
  expiresAt: string | null
  revokedAt: string | null
  reuseDetectedAt: string | null
  active: boolean
}

export type RevokeSessionsResponse = {
  revoked: number
}

export type UnlinkOAuthAccountResponse = {
  unlinked: boolean
}

export type ApiTask = {
  id: string
  title: string
  category: string
  status: string
  budget: string | {
    money?: string | null
    points?: number | string | null
  }
  deadline: string
  proposals: number
  description: string
  publisher: string
  assignee: string
  requirements: string[]
  attachments: string[]
  privateBrief: string
  submission: string
  resultLinks: string[]
  reviewNote: string
  rights: string
}

export type TaskListQuery = {
  status?: string | null
  category?: string | null
  search?: string | null
  cursor?: string | null
  limit?: number | null
}

export type CreateTaskRequest = {
  title: string
  category: string
  description: string
  acceptanceRules: string
  rewardAmount?: number | null
  rewardCurrency?: string | null
  pointsReward: number
  deadlineAt?: string | null
  visibility?: string
  attachmentIds?: string[]
}

export type SubmitTaskRequest = {
  content: string
  assetIds: string[]
  rightsNote: string
}

export type ReviewTaskRequest = {
  decision: 'approve' | 'reject' | 'request_changes'
  reviewNote: string
  acceptanceChecklist?: ApiAcceptanceChecklistItem[]
}

export type ApiAcceptanceChecklistItem = {
  label: string
  checked: boolean
}

export type TaskChildListQuery = {
  cursor?: string | null
  limit?: number | null
}

export type ApiTaskProposal = {
  id: string
  taskId: string
  proposer: ApiProfileSummary | { handle: string } | null
  coverLetter: string
  estimate: string
  status: 'pending' | 'accepted' | 'rejected'
  decisionNote: string
  createdAt: string
}

export type CreateTaskProposalRequest = {
  coverLetter: string
  estimate?: string
}

export type ReviewTaskProposalRequest = {
  decision: 'accept' | 'reject'
  note?: string
}

export type ApiTaskSubmission = {
  id: string
  taskId: string
  submitter: ApiProfileSummary | { handle: string } | null
  content: string
  assetIds: string[]
  rightsNote: string
  status: 'pending_review' | 'revision_requested' | 'approved' | 'rejected'
  reviewNote: string
  acceptanceChecklist: ApiAcceptanceChecklistItem[]
  reviewedBy: ApiProfileSummary | { handle: string } | null
  reviewedAt: string | null
  createdAt: string
}

export type ApiTaskTimelineItem = {
  id: string
  taskId: string
  type: string
  title: string
  body: string
  actor: ApiProfileSummary | { handle: string } | null
  resourceType: string
  resourceId: string | null
  metadata: Record<string, unknown>
  occurredAt: string
}

export type MediaAssetPurpose = 'task_attachment' | 'submission_asset' | 'profile_portfolio' | 'library_asset'

export type ApiMediaAsset = {
  id: string
  fileName: string
  storageKey: string
  contentType: string
  sizeBytes: number
  purpose: MediaAssetPurpose
  status: 'pending' | 'uploaded' | 'rejected'
  metadata?: unknown
  createdAt: string
  updatedAt: string
}

export type CreateMediaUploadRequest = {
  fileName: string
  contentType: string
  sizeBytes: number
  purpose: MediaAssetPurpose
  metadata?: unknown
}

export type CompleteMediaUploadRequest = {
  checksum?: string
  detectedContentType?: string
}

export type MediaUploadContract = {
  asset: ApiMediaAsset
  upload: {
    provider?: 'mock' | 's3'
    method: 'PUT'
    url: string
    headers: Record<string, string>
    expiresAt: string
  }
}

export type ReviewMediaUploadRequest = {
  decision: 'clean' | 'reject'
  note?: string
  detectedContentType?: string
}

export type MediaReviewQueueQuery = {
  status?: 'pending' | 'scanning' | 'review' | 'clean' | 'rejected' | 'all' | null
  purpose?: MediaAssetPurpose | null
  search?: string | null
  cursor?: string | null
  limit?: number | null
}

export type MediaScanJobQuery = {
  status?: 'active' | 'queued' | 'retrying' | 'timed_out' | 'completed' | 'failed' | 'all' | null
  purpose?: MediaAssetPurpose | null
  search?: string | null
  cursor?: string | null
  limit?: number | null
}

export type MediaScanJobHistoryQuery = {
  cursor?: string | null
  limit?: number | null
}

export type MediaScanJobHistoryPage = {
  items: ApiMediaScanJob[]
  limit: number
  nextCursor: string | null
}

export type MediaScanJobArchiveManifest = {
  exportedAt: string
  mode: 'candidate_manifest' | string
  retention: {
    days?: number
    maxPerAsset?: number
    cutoff?: string
  }
  deleteBoundary: {
    inactiveStatuses: string[]
    activeStatusesRetained: string[]
    prunedByAge: string
    prunedByCount: string
  }
  count: number
  totalCandidates?: number
  limit: number
  nextCursor: string | null
  items: Array<ApiMediaScanJob & {
    archiveReasons?: string[]
    asset?: {
      id: string
      fileName: string
      storageKey: string
      contentType: string
      purpose: MediaAssetPurpose | string
      status: string
      ownerId?: string | null
    } | null
  }>
}

export type MediaScanJobArchiveResult = MediaScanJobArchiveManifest & {
  storage?: {
    provider: 'mock' | 's3' | string
    storageKey: string
    url?: string
    bytes: number
    statusCode?: number | null
    writtenAt: string
  }
}

export type MediaScanSweepResult = {
  inspected: number
  retried: number
  failed: number
  pruned?: number
  retention?: {
    days?: number
    maxPerAsset?: number
    cutoff?: string
  }
  items: ApiMediaAsset[]
}

export type ApiMediaGovernanceConfig = {
  storage: {
    driver: string
  }
  scanner: {
    provider: string
    requestAdapter: string
    requestDispatchConfigured: boolean
    requestSigningConfigured: boolean
    requestTimeoutSeconds: number
    callbackBaseConfigured: boolean
    webhookSecretConfigured: boolean
    callbackSignatureConfigured: boolean
    callbackSignatureToleranceSeconds: number
    retryDelaySeconds: number
    timeoutSeconds: number
    maxAttempts: number
    workerEnabled: boolean
    workerIntervalSeconds: number
  }
  retention: {
    historyRetentionDays: number
    historyRetentionMaxPerAsset: number
  }
  alerts: {
    windowMinutes: number
    thresholds: {
      callbackDenied: number
      dispatchFailed: number
      timeout: number
      alertDeliveryFailed: number
    }
    channels: {
      webhook: {
        configured: boolean
        signed: boolean
        timeoutSeconds: number
      }
      slack: {
        configured: boolean
        timeoutSeconds: number
      }
      email: {
        configured: boolean
        signed: boolean
        recipientCount: number
        fromConfigured: boolean
        timeoutSeconds: number
      }
    }
  }
}

export type MediaGovernancePolicyPatch = {
  scanner?: Partial<Pick<ApiMediaGovernanceConfig['scanner'], 'retryDelaySeconds' | 'timeoutSeconds' | 'maxAttempts' | 'workerIntervalSeconds'>>
  retention?: Partial<ApiMediaGovernanceConfig['retention']>
  alerts?: {
    windowMinutes?: number
    thresholds?: Partial<ApiMediaGovernanceConfig['alerts']['thresholds']>
  }
}

export type MediaGovernancePolicy = {
  scanner: Pick<ApiMediaGovernanceConfig['scanner'], 'retryDelaySeconds' | 'timeoutSeconds' | 'maxAttempts' | 'workerIntervalSeconds'>
  retention: ApiMediaGovernanceConfig['retention']
  alerts: {
    windowMinutes: number
    thresholds: ApiMediaGovernanceConfig['alerts']['thresholds']
  }
}

export type MediaGovernancePolicyHistoryItem = {
  id: string
  action: 'media.governance_policy.updated' | 'media.governance_policy.rolled_back'
  actorId?: string | null
  createdAt: string
  summary: string
  previous: MediaGovernancePolicy | null
  next: MediaGovernancePolicy | null
  diff?: unknown
}

export type ApiMediaScanAlert = {
  id: string
  type: string
  state?: 'active' | 'acknowledged' | 'silenced'
  severity: 'info' | 'warning' | 'critical'
  title: string
  summary: string
  count: number
  threshold: number
  windowMinutes: number
  resourceType: string
  resourceId: string | null
  metadata: Record<string, unknown> | null
  acknowledgedAt?: string | null
  acknowledgedBy?: string | null
  acknowledgementNote?: string | null
  silencedUntil?: string | null
  silencedBy?: string | null
  silenceNote?: string | null
  createdAt: string
}

export type ApiMediaScanAlertEvent = AuditEventDto

export type ApiMediaScanJob = {
  id: string
  assetId: string
  provider: string
  status: 'queued' | 'retrying' | 'completed' | 'failed' | string
  scanStatus: string
  externalScanId: string | null
  attempts: number
  requestedAt: string | null
  timeoutAt: string | null
  nextRetryAt: string | null
  callbackAt: string | null
  failedAt: string | null
  reviewedById: string | null
  reviewedAt: string | null
  note: string | null
  rejectionReason: string | null
  metadata?: unknown
  createdAt: string
  updatedAt: string
}

export type MediaDownloadContract = {
  asset: ApiMediaAsset
  download: {
    provider?: 'mock' | 's3'
    method: 'GET'
    url: string
    headers: Record<string, string>
    expiresAt: string
  }
}

export type ApiPost = {
  id: string
  title: string
  category: string
  author: ApiProfileSummary | { handle: string }
  replies: number
  likes: number
  views: number
  votes: number
  tag: string
  solved: boolean
  excerpt: string
  body?: string | null
}

export type PostListQuery = {
  sort?: 'new' | 'hot' | 'unanswered' | 'solved' | null
  category?: string | null
  tag?: string | null
  cursor?: string | null
  limit?: number | null
}

export type CreatePostRequest = {
  title: string
  body: string
  category: string
  tag?: string
  excerpt?: string
}

export type CreateCommentRequest = {
  body: string
  parentId?: string | null
}

export type ConvertToTaskRequest = {
  acceptanceRules: string
  pointsReward: number
  rewardAmount?: number | null
  deadlineAt?: string | null
}

export type ApiLibraryItem = {
  id: string
  title: string
  type: string
  source: string
  saves: string
  text: string
  sourceId?: string | null
  metadata?: unknown
}

export type LibraryListQuery = {
  type?: string | null
  source?: string | null
  sourceId?: string | null
  search?: string | null
  cursor?: string | null
  limit?: number | null
}

export type CreateLibraryItemRequest = {
  title: string
  text: string
  type: string
  source: string
  sourceId?: string | null
  metadata?: unknown
}

export type ApiLedgerEntry = {
  id: string
  occurredAtLabel: string
  description: string
  delta: number | string
  balanceAfter: number | string
  status: 'pending' | 'settled' | 'cancelled'
  sourceType: string
  sourceId?: string | null
  userHandle?: string | null
}

export type ApiPointsSummary = {
  userHandle: string | null
  balance: number
  available: number
  frozen: number
  pendingSettlement: number
  projectedBalance: number
  lifetimeEarned: number
  lifetimeSpent: number
}

export type ApiNotification = {
  id: string
  type: string
  title: string
  body: string
  resourceType: string
  resourceId?: string | null
  metadata?: unknown
  readAt?: string | null
  createdAt: string
}

export type NotificationListQuery = {
  readState?: 'unread' | 'read' | 'all' | null
  unreadOnly?: boolean | null
  type?: string | null
  resourceType?: string | null
  cursor?: string | null
  limit?: number | null
}

export type MarkAllNotificationsReadResponse = {
  updated: number
}

export type PointsLedgerQuery = {
  status?: 'pending' | 'settled' | 'cancelled' | null
  userHandle?: string | null
  search?: string | null
  cursor?: string | null
  limit?: number | null
}

export type AdminPointAdjustmentRequest = {
  userHandle: string
  delta: number
  reason: string
  reasonCode?: string | null
}

export type AdminPointAdjustmentResponse = {
  status: 'applied' | 'pending_review'
  threshold: number
  entry: ApiLedgerEntry | null
  review: AdminReviewQueueItemDto | null
}

export type PointAdjustmentPolicy = {
  roleLimits: Record<'member' | 'creator' | 'publisher' | 'moderator' | 'admin', number>
  reasonCodes: string[]
  approvalTemplates: string[]
}

export type PointAdjustmentPolicyHistoryItem = {
  id: string
  action: 'points.policy.updated' | 'points.policy.rolled_back'
  actorId?: string | null
  createdAt: string
  summary: string
  previous: PointAdjustmentPolicy | null
  next: PointAdjustmentPolicy | null
  diff?: unknown
}

export type PointAdjustmentReviewMetadata = {
  kind?: 'point_adjustment'
  userHandle?: string
  delta?: number
  reason?: string
  reasonCode?: string | null
  requestedBy?: string
  threshold?: number
  balanceBefore?: number
  projectedBalance?: number
  ledgerEntryId?: string | null
  approvedBy?: string | null
}

export type ApiProfile = Omit<MarketplaceProfile, 'id'> & {
  id?: string
}

export type ProfileListQuery = {
  lane?: string | null
  search?: string | null
  cursor?: string | null
  limit?: number | null
}

export type AuditEventDto = AuditEvent

export type AdminPermissionDto = {
  id: Permission
  description?: string | null
}

export type AdminRolePermissionDto = {
  role: Role
  permissions: Permission[]
}

export type UpdateRolePermissionsRequest = {
  permissions: Permission[]
}

export type AdminReviewListQuery = {
  queue?: string | null
  status?: string | null
  cursor?: string | null
  limit?: number | null
}

export type PointPolicyRollbackRequest = {
  eventId: string
}

export type AdminAuditListQuery = {
  action?: string | null
  resourceType?: string | null
  actorId?: string | null
  cursor?: string | null
  limit?: number | null
}

export type AdminSecurityEventSource = 'rate_limit' | 'body_size' | 'auth_failure' | string

export type AdminSecurityEventListQuery = {
  type?: string | null
  source?: AdminSecurityEventSource | null
  severity?: string | null
  cursor?: string | null
  limit?: number | null
}

export type AdminSecurityEventDto = {
  id: string
  type: string
  severity: string
  source: AdminSecurityEventSource
  clientKey?: string | null
  identity?: string | null
  method?: string | null
  pathname?: string | null
  occurredAt: string
  details?: Record<string, unknown> | unknown
}

export type AdminSecurityAlertDto = {
  id: string
  type: string
  state?: 'active' | 'acknowledged' | 'silenced'
  severity: string
  title: string
  summary: string
  count: number
  threshold: number
  windowMinutes: number
  resourceType: 'security_event' | string
  resourceId?: string | null
  metadata?: {
    source?: AdminSecurityEventSource
    recentEventIds?: string[]
    recentClientKeys?: string[]
    recentIdentities?: string[]
    recentPaths?: string[]
  } | Record<string, unknown> | null
  acknowledgedAt?: string | null
  acknowledgedBy?: string | null
  acknowledgementNote?: string | null
  silencedUntil?: string | null
  silencedBy?: string | null
  silenceNote?: string | null
  createdAt: string
}

export type AdminSecurityAlertEventDto = AdminSecurityEventDto

export type AdminOperationsMetricCount = {
  key: string
  count: number
}

export type AdminOperationsMetricsDto = {
  generatedAt: string
  window: {
    minutes: number
    since: string
    until: string
  }
  security: {
    eventsTotal: number
    eventsBySource: AdminOperationsMetricCount[]
    eventsBySeverity: AdminOperationsMetricCount[]
    alerts: {
      total: number
      byType: AdminOperationsMetricCount[]
      byState: AdminOperationsMetricCount[]
    }
    dispositions: {
      total: number
      acknowledged: number
      silenced: number
      unsilenced: number
      acknowledgementLatency: {
        averageMs: number | null
        samples: number
      }
    }
    deliveryFailures: {
      total: number
      byChannel: AdminOperationsMetricCount[]
      byStatus: AdminOperationsMetricCount[]
      latestAt: string | null
    }
  }
  mediaScan: {
    archiveCandidates: {
      total: number
      sampled: number
      nextCursor: string | null
      retention: Record<string, unknown> | null
    }
    archiveWrites: {
      total: number
      bytes: number
      manifests: number
      candidates: number
      byProvider: AdminOperationsMetricCount[]
      latestAt: string | null
    }
    historyPruned: {
      total: number
      jobs: number
      latestAt: string | null
    }
    alertDeliveryFailures: {
      total: number
      byChannel: AdminOperationsMetricCount[]
      byStatus: AdminOperationsMetricCount[]
      latestAt: string | null
    }
  }
}

export type AdminReviewQueueItemDto = {
  id: string
  status: string
  title: string
  owner: string
  note: string
  queue: string
  decision?: AdminReviewDecision
  reviewedBy?: string | null
  reviewedAt?: string | null
  metadata?: PointAdjustmentReviewMetadata | Record<string, unknown> | null
}

export type AdminReviewDecision = 'approve' | 'reject'

export type AdminReviewActionRequest = {
  decision: AdminReviewDecision
  note?: string
}
