import type { AuditEvent, LocalizedText, MarketplaceProfile, Permission, Role } from '../domain/types'

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
  policyConsent?: ApiPolicyConsentStatus
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
  policyConsent: PolicyConsentRequest
}

export type CompliancePolicyId = 'terms' | 'privacy' | 'acceptable-use' | 'provider-disclosure' | 'support'

export type ApiCompliancePolicySection = {
  id: string
  title: LocalizedText
  paragraphs: {
    en: string[]
    zh: string[]
  }
}

export type ApiCompliancePolicy = {
  id: CompliancePolicyId
  route: 'terms' | 'privacy' | 'aup' | 'disclosures' | 'support'
  version: string
  status: 'draft_pending_legal_review'
  requiredConsent: boolean
  title: LocalizedText
  summary: LocalizedText
  sections: ApiCompliancePolicySection[]
}

export type ApiSupportCategory = {
  id: SupportRequestCategory
  label: LocalizedText
  initialResponseTarget: string
  implementationOwner: string
}

export type ApiComplianceManifest = {
  schemaVersion: number
  release: string
  asOf: string
  policySetVersion: string
  policyStatus: string
  defaultLocale: 'en' | 'zh'
  supportedLocales: Array<'en' | 'zh'>
  releaseReadiness: {
    legalApproved: boolean
    policyPublicationApproved: boolean
    productionLaunchAllowed: boolean
    ordinaryContinuationIsLegalApproval: boolean
    requiredApproval: string
  }
  operator: {
    productName: string
    legalEntity: string
    jurisdiction: string
    supportChannel: string
    privacyChannel: string
    emergencyNotice: LocalizedText
  }
  consentContract: {
    requiredPolicyIds: CompliancePolicyId[]
    exactVersionMatchRequired: boolean
    affirmativeActionRequired: boolean
    bundledPrecheckedConsentForbidden: boolean
    allowedSources: string[]
  }
  policies: ApiCompliancePolicy[]
  providerDisclosures: Array<{
    providerId: string
    modality: 'image' | 'chat' | 'video' | 'music'
    role: string
    dataCategories: string[]
    productionApproved: boolean
  }>
  supportContract: {
    authenticationRequired: boolean
    forbiddenFields: string[]
    allowedRelatedResourceTypes: SupportRelatedResourceType[]
    categories: ApiSupportCategory[]
  }
}

export type ApiPolicyConsentSummary = {
  id: CompliancePolicyId
  route: ApiCompliancePolicy['route']
  version: string
  title: LocalizedText
  summary: LocalizedText
}

export type ApiPolicyConsentStatus = {
  required: boolean
  current: boolean
  policySetVersion: string
  requiredPolicyVersions: Record<string, string>
  requiredPolicies: ApiPolicyConsentSummary[]
  acceptedAt: string | null
  acceptedSource: string | null
  acceptedPolicyVersions: Record<string, string>
  missingPolicyIds: string[]
  outdatedPolicyIds: string[]
}

export type PolicyConsentRequest = {
  accepted: true
  locale: 'en' | 'zh'
  policyVersions: Record<string, string>
}

export type SupportRequestCategory =
  | 'general_support'
  | 'content_report'
  | 'moderation_appeal'
  | 'privacy_request'
  | 'data_export'
  | 'account_deletion'

export type SupportRelatedResourceType =
  | 'none'
  | 'account'
  | 'task'
  | 'post'
  | 'comment'
  | 'media_asset'
  | 'creative_generation'
  | 'moderation_decision'

export type CreateSupportRequest = {
  category: SupportRequestCategory
  subject: string
  details: string
  relatedResourceType: SupportRelatedResourceType
  relatedResourceId?: string
  locale: 'en' | 'zh'
}

export type ApiSupportRequest = {
  id: string
  status: string
  category: SupportRequestCategory
  categoryLabel: LocalizedText
  subject: string
  details: string
  relatedResourceType: SupportRelatedResourceType
  relatedResourceId: string | null
  initialResponseTarget: string
  implementationOwner: string
  submittedAt: string
}

export type ApiSupportRequestList = {
  items: ApiSupportRequest[]
  nextCursor: string | null
  limit: number
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
  disputeStatus?: string | null
  disputeReason?: string
  disputeReviewId?: string | null
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
  status: 'pending_review' | 'revision_requested' | 'stale' | 'disputed' | 'approved' | 'rejected'
  reviewNote: string
  acceptanceChecklist: ApiAcceptanceChecklistItem[]
  dispute?: Record<string, unknown> | null
  stale?: Record<string, unknown> | null
  reviewedBy: ApiProfileSummary | { handle: string } | null
  reviewedAt: string | null
  createdAt: string
}

export type CreateTaskDisputeRequest = {
  reason: string
}

export type SweepStaleTaskSubmissionsRequest = {
  olderThanHours?: number
  limit?: number
  taskId?: string | number | null
}

export type SweepStaleTaskSubmissionsResponse = {
  marked: number
  items: ApiTaskSubmission[]
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

export type CreativeWorkspace = 'image' | 'video' | 'music' | 'chat'

export type CreateCreativeGenerationRequest = {
  workspace: CreativeWorkspace
  mode: string
  prompt: string
  inputAssetIds?: string[]
  parameters?: Record<string, string | number | boolean | Array<string | number | boolean> | null>
  providerId?: string | null
}

export type ApiCreativeProvider = {
  id: string
  label: string
  mode: string
}

export type ApiCreativeParameterDefinition = {
  type: 'string' | 'number' | 'integer'
  default?: string | number
  options?: Array<string | number>
  minimum?: number
  maximum?: number
}

export type ApiImageModeContract = {
  id: 'text_to_image' | 'image_to_image' | 'image_edit' | 'image_variation'
  label: string
  runtimeAvailable: boolean
  available: boolean
  unavailableReason: string | null
  inputAssets: {
    minimum: number
    maximum: number
    purposes: string[]
    contentTypes: string[]
    roles?: string[]
  }
  parameters: string[]
}

export type ApiCreativeCapability = {
  workspace: CreativeWorkspace
  label: string
  contractVersion?: string
  modes: string[]
  allModes?: string[]
  modeContracts?: ApiImageModeContract[]
  inputAssetPurposes: string[]
  outputTypes: string[]
  maxPromptCharacters: number
  supportedParameters: string[]
  parameterDefinitions?: Record<string, ApiCreativeParameterDefinition>
  runtime?: {
    realProviderCallsApproved: boolean
    productionEnablementApproved: boolean
    productionFallback: string
    silentMockFallback: boolean
  }
}

export type ApiCreativeProviderCatalogEntry = ApiCreativeProvider & {
  enabled: boolean
  configured: boolean
  default: boolean
  capabilities: ApiCreativeCapability[]
  safeMetadata: Record<string, string | number | boolean | null>
}

export type ApiCreativeProviderCatalog = {
  defaultProviderId: string
  providers: ApiCreativeProviderCatalogEntry[]
}

export type ApiCreativeGenerationOutput = {
  id: string
  type: 'image' | 'video' | 'audio' | 'text' | string
  label: string
  contentType: string
  url: string
  storage: {
    persisted: boolean
    provider: string
    mediaAssetId?: string
    scanStatus?: string
    downloadPath?: string
  }
  source: {
    kind: string
    persistedMediaAssetId: string | null
  }
  mediaAsset?: {
    id: string
    status: string
    purpose: MediaAssetPurpose | string
    contentType: string
    scanStatus: string
  }
}

export type ApiCreativeGenerationRecord = {
  id: string
  actorId: string | null
  actorHandle: string | null
  workspace: CreativeWorkspace
  mode: string
  providerId: string
  providerMode: string | null
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'review_required' | string
  promptHash: string
  promptPreview: string | null
  inputAssetIds: string[]
  parameterKeys: string[]
  outputAssetIds: string[]
  usage?: ApiCreativeGenerationUsage | null
  credit?: unknown
  quota?: unknown
  safety?: unknown
  policy?: unknown
  providerRequestId: string | null
  providerJobId: string | null
  retryOfId: string | null
  attemptNumber: number
  errorCode: string | null
  errorMessagePreview: string | null
  startedAt: string | null
  completedAt: string | null
  failedAt: string | null
  createdAt: string
  updatedAt: string
  providerReplayEvidence?: {
    available: boolean
    count: number
    appliedCount: number
    rejectedCount: number
    noopCount: number
    latest: null | {
      id: string
      sourceType: string
      action: string
      previousStatus: string | null
      normalizedStatus: string | null
      reasonCode: string | null
      providerEventIdPresent: boolean
      payloadHashPresent: boolean
      payloadHashPreview: string | null
      sideEffectOutcome: string
      sideEffectCompleted: boolean
      completedOperationCount: number
      failedOperationType: string | null
      errorPreviewPresent: boolean
      receivedAt: string | null
      appliedAt: string | null
    }
  }
  mutationEvidence?: {
    available: boolean
    count: number
    latest: null | {
      id: string | null
      type: string | null
      status: string | null
      reasonCode: string | null
      requestedByHandle: string | null
      reviewId: string | null
      targetGenerationId: string | null
      completedAt: string | null
      createdAt: string | null
    }
  }
  outputIngestionEvidence?: {
    available: boolean
    count: number
    completedCount: number
    failedCount: number
    latest: null | {
      id: string | null
      status: string | null
      outputIndex: number | null
      mediaAssetId: string | null
      detectedContentType: string | null
      sizeBytes: number | null
      sha256Present: boolean
      sha256Preview: string | null
      errorCode: string | null
      claimedAt: string | null
      completedAt: string | null
    }
  }
  providerCostLedgerEvidence?: {
    available: boolean
    status: string | null
    providerId?: string | null
    workspace?: string | null
    currency?: string | null
    estimateAmount?: number | null
    actualAmount?: number | null
    reservedAmount?: number | null
    reasonCode?: string | null
    pricingSnapshotHashPresent?: boolean
    pricingSnapshotHashPreview?: string | null
    budget?: {
      scope: string | null
      capAmount: number | null
      reservedAmount: number | null
      spentAmount: number | null
      releasedAmount: number | null
      windowStart: string | null
      windowEnd: string | null
    }
  }
}

export type ApiUserCreativeGenerationAction = {
  available: boolean
  reasonCode: string | null
  userConfirmationRequired?: boolean
  requiresOriginalRequest?: boolean
}

export type ApiUserCreativeGeneration = {
  id: string
  workspace: CreativeWorkspace
  mode: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'review_required' | string
  promptPreview: string | null
  inputAssetIds: string[]
  parameterKeys: string[]
  provider: {
    id: string
    mode: string | null
  }
  attempt: {
    number: number
    retryOfId: string | null
  }
  usage: {
    estimatedCredits: number
    metered: boolean
  }
  safety: {
    reviewRequired: boolean
  }
  error: {
    code: string
    message: string | null
  } | null
  outputs: Array<{
    assetId: string
    fileName: string
    contentType: string
    status: string
    scanStatus: string
    createdAt: string | null
  }>
  actions: {
    poll: ApiUserCreativeGenerationAction
    cancel: ApiUserCreativeGenerationAction
    retry: ApiUserCreativeGenerationAction
    download: ApiUserCreativeGenerationAction
    reuse: ApiUserCreativeGenerationAction
  }
  startedAt: string | null
  completedAt: string | null
  failedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type UserCreativeGenerationHistoryQuery = {
  cursor?: string | null
  limit?: number
  workspace?: CreativeWorkspace
  status?: string | null
}

export type UserCreativeGenerationHistoryPage = {
  items: ApiUserCreativeGeneration[]
  nextCursor: string | null
}

export type CreativeGenerationMutationType = 'cancel' | 'retry' | 'manual_replay'

export type AdminProviderControlBundle = {
  controls: Array<{
    id: string | null
    scopeKey: string | null
    scopeType: 'global' | 'provider' | 'workspace' | 'model_family'
    providerId: string | null
    workspace: string | null
    modelFamily: string | null
    enabled: boolean
    version: number
    reasonCode: string
    enabledAt: string | null
    disabledAt: string | null
    updatedAt: string
  }>
  circuits: Array<{
    id: string | null
    scopeKey: string | null
    providerId: string | null
    workspace: string
    modelFamily: string | null
    status: 'closed' | 'open' | 'half_open'
    version: number
    failureCount: number
    windowStartedAt: string | null
    lastFailureAt: string | null
    openedAt: string | null
    cooldownUntil: string | null
    probeLeaseActive: boolean
    probeLeaseExpiresAt: string | null
    reasonCode: string | null
  }>
  capEvidence: Array<{
    id: string | null
    providerId: string | null
    currency: string
    capAmount: number | null
    remainingAmount: number | null
    sourceType: string
    evidenceHashPresent: boolean
    evidenceHashPreview: string | null
    verifiedAt: string
    expiresAt: string
    active: boolean
  }>
}

export type AdminProviderControlRecoveryTarget = 'enable' | 'half_open' | 'closed'
export type CreativeGenerationMutationStatus = 'requested' | 'pending_review' | 'approved' | 'processing' | 'succeeded' | 'failed' | 'rejected'

export type ApiCreativeGenerationMutation = {
  id: string
  generationId: string
  type: CreativeGenerationMutationType
  status: CreativeGenerationMutationStatus
  idempotencyKey: string
  requestedById: string | null
  requestedByHandle: string | null
  reasonCode: string
  notePreview: string | null
  reviewId: string | null
  targetGenerationId: string | null
  safeMetadata: Record<string, unknown> | null
  result: Record<string, unknown> | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export type CreativeGenerationMutationRequest = {
  idempotencyKey: string
  reasonCode?: string
  note?: string
}

export type AdminManualReplayRequest = CreativeGenerationMutationRequest & {
  providerId: string
  providerMode: string
  providerJobId: string
  normalizedStatus: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  providerEventId?: string | null
  occurredAt?: string | null
}

export type ApiCreativeGenerationMutationResponse = {
  duplicate: boolean
  mutation: ApiCreativeGenerationMutation
  generation?: ApiCreativeGenerationRecord
  review?: AdminReviewQueueItemDto | null
}

export type ApiCreativeProviderCost = {
  schemaVersion: string | null
  providerId: string | null
  providerAccountRef: string | null
  model: {
    providerModelId: string | null
    providerModelVersion: string | null
    displayName: string | null
    family: string | null
    pricingSource: string | null
    pricingSnapshotAt: string | null
  }
  job: {
    providerRequestId: string | null
    providerJobId: string | null
    region: string | null
    startedAt: string | null
    completedAt: string | null
  }
  usage: {
    unit: string | null
    quantity: number | null
    hardwareClass: string | null
    outputCount: number | null
    inputTokenCount: number | null
    outputTokenCount: number | null
    rawProviderUsageHash: string | null
  }
  estimate: {
    currency: string | null
    amount: number | null
    source: string | null
    confidence: string | null
    calculatedAt: string | null
  }
  actual: {
    currency: string | null
    amount: number | null
    source: string | null
    confidence: string | null
    settledAt: string | null
  }
  budget: {
    budgetScope: string | null
    dailyCapCurrency: string | null
    dailyCapAmount: number | null
    spentAmount: number | null
    projectedSpendAmount: number | null
    remainingAfterEstimateAmount: number | null
    thresholdPercent: number | null
    status: string | null
  }
  risk: {
    costKnown: boolean | null
    costExceededEstimate: boolean | null
    providerUsageMissing: boolean | null
    billingReconciliationRequired: boolean | null
  }
  pricingSnapshot: null | {
    schemaVersion: string | null
    snapshotHash: string | null
    currency: string | null
    billingUnit: string | null
    unitPriceMicros: string | null
    sourceType: string | null
    calculatorVersion: string | null
    effectiveAt: string | null
    capturedAt: string | null
    expiresAt: string | null
  }
  ledger: null | {
    id: string | null
    status: string | null
    estimateMicros: string | null
    actualMicros: string | null
    currency: string | null
    reasonCode: string | null
  }
}

export type ApiCreativeGenerationUsage = {
  estimatedCredits: number | null
  providerCostCents: number | null
  metered: boolean | null
  costModel: string | null
  currency: string | null
  providerUsageUnit: string | null
  providerCost: ApiCreativeProviderCost | null
}

export type AdminCreativeGenerationHistoryQuery = {
  userHandle?: string | null
  actorHandle?: string | null
  workspace?: CreativeWorkspace | string | null
  mode?: string | null
  providerId?: string | null
  status?: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'review_required' | string | null
  reviewRequired?: boolean | null
  mediaAssetId?: string | null
  dateFrom?: string | null
  dateTo?: string | null
  cursor?: string | null
  limit?: number | null
}

export type AdminCreativeGenerationHistoryPage = {
  items: ApiCreativeGenerationRecord[]
  nextCursor: string | null
}

export type ApiCreativeCredit = {
  ledgerId: string
  generationId: string
  quotaReservationId: string | null
  status: 'reserved' | 'settled' | 'refunded' | 'cancelled' | string
  currency: 'credits' | string
  reserved: number
  settled: number
  refunded: number
  amount: number
  reasonCode: string | null
  metadata?: unknown
  reservedAt: string | null
  settledAt: string | null
  refundedAt: string | null
  cancelledAt: string | null
}

export type ApiCreativeGeneration = {
  id: string
  workspace: CreativeWorkspace
  mode: string
  status: 'completed' | 'review_required' | string
  provider: ApiCreativeProvider
  prompt: string
  inputAssetIds: string[]
  parameters: Record<string, unknown>
  outputs: ApiCreativeGenerationOutput[]
  usage: {
    estimatedCredits: number
    providerCostCents: number
    metered: boolean
    costModel?: string
    currency?: string
  }
  credit?: ApiCreativeCredit | null
  quota?: {
    policyVersion: string
    scope: string
    workspace: CreativeWorkspace
    limit: number
    reserved: number
    used: number
    released: number
    remaining: number
    reservationId?: string | null
    window: {
      id: string
      type?: string
      start?: string
      end?: string
      resetsAt: string
    }
  }
  safety: {
    moderationRequired: boolean
    reviewRequired: boolean
    reasons?: Array<{
      id: string
      label: string
    }>
    policyVersion?: string
  }
  policy?: {
    version: string
    enforcedAt: string
    gates: {
      quota: boolean
      credit?: boolean
      moderation: boolean
      review: boolean
    }
  }
  createdAt: string
  generationRecord?: ApiCreativeGenerationRecord | null
}

export type RetryCreativeGenerationRequest = CreativeGenerationMutationRequest & {
  authorizationMutationId?: string | null
  generation: CreateCreativeGenerationRequest
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

export type AdminOperationsMetricBreakdown = {
  total: number
  bySeverity: AdminOperationsMetricCount[]
  byBudgetScope: AdminOperationsMetricCount[]
  byProvider: AdminOperationsMetricCount[]
  byWorkspace: AdminOperationsMetricCount[]
  latestAt: string | null
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
  operations: {
    leases: {
      skippedRuns: {
        total: number
        byKey: AdminOperationsMetricCount[]
        latestAt: string | null
      }
      renewFailures: {
        total: number
        byKey: AdminOperationsMetricCount[]
        latestAt: string | null
      }
    }
  }
  creativeProviderBudget: {
    thresholdAlerts: AdminOperationsMetricBreakdown & {
      byThreshold: AdminOperationsMetricCount[]
    }
    dispatchBlocked: AdminOperationsMetricBreakdown & {
      byReason: AdminOperationsMetricCount[]
    }
    costAnomalies: AdminOperationsMetricBreakdown & {
      byReason: AdminOperationsMetricCount[]
    }
    spend: {
      estimatedAmount: number
      actualAmount: number
      projectedSpendAmount: number
      byCurrency: AdminOperationsMetricCount[]
    }
    providerAlertDispatches: {
      total: number
      succeeded: number
      failed: number
      skipped: number
      byChannel: AdminOperationsMetricCount[]
      byStatus: AdminOperationsMetricCount[]
      byReason: AdminOperationsMetricCount[]
      byProvider: AdminOperationsMetricCount[]
      byWorkspace: AdminOperationsMetricCount[]
      latestAt: string | null
      fixtureDryRuns: {
        total: number
        succeeded: number
        failed: number
        skipped: number
        byChannel: AdminOperationsMetricCount[]
        byStatus: AdminOperationsMetricCount[]
        byReason: AdminOperationsMetricCount[]
        byProvider: AdminOperationsMetricCount[]
        byWorkspace: AdminOperationsMetricCount[]
        latestAt: string | null
      }
      failureSpike: {
        active: boolean
        threshold: number
        failures: number
        byChannel: AdminOperationsMetricCount[]
        byReason: AdminOperationsMetricCount[]
        latestAt: string | null
      }
    }
  }
  creativeProviderControl: {
    total: number
    dispatchBlocked: number
    circuitOpened: number
    recoveryApproved: number
    recoveryRejected: number
    capEvidenceRecorded: number
    capEvidenceExpired: number
    byProvider: AdminOperationsMetricCount[]
    byWorkspace: AdminOperationsMetricCount[]
    byStatus: AdminOperationsMetricCount[]
    byReason: AdminOperationsMetricCount[]
    latestAt: string | null
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
