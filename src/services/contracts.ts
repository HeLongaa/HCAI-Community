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
  available: boolean
  mode: 'dev' | 'external' | 'unavailable'
  authorizationUrl: string | null
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

export type ApiTaskWorkflow = {
  taskId: string
  taskStatus: string
  disputeStatus: string | null
  latestSubmissionStatus: string | null
  role: 'publisher' | 'assignee' | 'proposer' | 'admin' | 'viewer'
  actions: Array<'view' | 'propose' | 'claim' | 'review_proposals' | 'submit' | 'review_submission' | 'open_dispute' | 'view_timeline'>
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
  assetEvidence: ApiCreativeAssetEvidence[]
  reviewedBy: ApiProfileSummary | { handle: string } | null
  reviewedAt: string | null
  createdAt: string
}

export type ApiCreativeAssetEvidence = {
  assetId: string
  fileName: string
  contentType: string
  purpose: MediaAssetPurpose
  sourceGeneration: { id: string; workspace: CreativeWorkspace; mode: string; status: string }
  governance: { assetStatus: string; scanStatus: string; archived: boolean; capturedAt: string }
}

export type ApiTaskDeliveryTarget = {
  id: string
  title: string
  status: string
  category: string
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
export type MediaStorageState = 'pending_upload' | 'verifying' | 'quarantined' | 'available' | 'cleanup_pending' | 'deleting' | 'deleted' | 'verification_failed'

export type ApiMediaStorageObject = {
  provider: string
  state: MediaStorageState
  verifiedSizeBytes?: number | null
  verifiedContentType?: string | null
  verifiedAt: string | null
  quarantinedAt?: string | null
  cleanupAfter: string | null
  deletedAt: string | null
  lastErrorCode: string | null
  version: number
}

export type ApiMediaAsset = {
  id: string
  fileName: string
  storageKey: string
  contentType: string
  sizeBytes: number
  purpose: MediaAssetPurpose
  status: 'pending' | 'uploaded' | 'rejected'
  storage?: ApiMediaStorageObject | null
  metadata?: unknown
  archivedAt?: string | null
  deletedAt?: string | null
  deletionReason?: string | null
  createdAt: string
  updatedAt: string
}

export type AssetWorkspace = 'image' | 'video' | 'music' | 'chat'
export type AssetMediaType = 'image' | 'video' | 'audio' | 'document'

export type ApiAssetRelation = {
  id: string
  sourceAssetId: string
  targetAssetId: string
  relationType: 'parent' | 'variant' | 'reused_as_input'
  sourceGenerationId: string | null
  targetWorkspace: AssetWorkspace | null
  role: string | null
  createdAt: string
}

export type ApiAssetLibraryItem = {
  id: string
  fileName: string
  contentType: string
  mediaType: AssetMediaType
  sizeBytes: number
  purpose: MediaAssetPurpose
  status: 'pending' | 'uploaded' | 'rejected'
  scanStatus: string
  storage: ApiMediaStorageObject | null
  archivedAt: string | null
  deletedAt: string | null
  deletionReason: string | null
  sourceGeneration: { id: string; workspace: AssetWorkspace; mode: string; status: string; createdAt: string } | null
  relations: ApiAssetRelation[]
  referenced: boolean
  actions: {
    download: { available: boolean; reason: string | null }
    archive: { available: boolean; reason: string | null }
    restore: { available: boolean; reason: string | null }
    delete: { available: boolean; reason: string | null }
    recover: { available: boolean; reason: string | null }
    reuse: Record<AssetWorkspace, { available: boolean; reason: string | null }>
  }
  createdAt: string
  updatedAt: string
}

export type ApiSavedAssetReference = {
  id: string
  title: string
  type: string
  source: string
  sourceId: string | null
  metadata: unknown
}

export type PortfolioAssetStatus = 'draft' | 'published' | 'withdrawn' | 'archived'

export type ApiPortfolioAsset = {
  id: string
  assetId: string
  sourceGenerationId: string | null
  sourceSubmissionId: string | null
  title: string
  caption: string
  status: PortfolioAssetStatus
  sortOrder: number
  publishedAt: string | null
  withdrawnAt: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  asset: { id: string; fileName: string; contentType: string; purpose: MediaAssetPurpose } | null
}

export type AssetLibraryQuery = {
  cursor?: string | null
  limit?: number | null
  search?: string | null
  purpose?: MediaAssetPurpose | null
  mediaType?: AssetMediaType | null
  workspace?: AssetWorkspace | null
  archived?: 'active' | 'archived' | 'all' | null
  lifecycle?: 'active' | 'archived' | 'deleted' | 'all' | null
  dateFrom?: string | null
  dateTo?: string | null
}

export type AdminMediaAssetQuery = AssetLibraryQuery & {
  ownerHandle?: string | null
  status?: 'pending' | 'uploaded' | 'rejected' | null
  storageState?: MediaStorageState | null
  sort?: 'created_desc' | 'created_asc' | 'updated_desc' | 'name_asc' | null
}

export type ApiAdminMediaAsset = ApiAssetLibraryItem & {
  owner: { id: string; handle: string }
  portfolio: ApiPortfolioAsset[]
  scanJobs?: ApiMediaScanJob[]
}

export type AdminMediaAssetBulkResult = {
  action: 'archive' | 'restore' | 'delete' | 'recover'
  requested: number
  succeeded: number
  failed: number
  results: Array<{ id: string; status: 'succeeded'; asset: ApiAdminMediaAsset } | { id: string; status: 'failed'; code: string }>
}

export type AdminMediaAssetExport = {
  schemaVersion: 1
  exportedAt: string
  truncated: boolean
  items: ApiAdminMediaAsset[]
}

export type MediaStorageCleanupResult = {
  inspected: number
  deleted: number
  failed: number
  limit: number
  items: Array<{ assetId: string; status: 'deleted' | 'failed' | 'skipped'; provider?: string; reasonCode?: string }>
}

export type CreateMediaUploadRequest = {
  fileName: string
  contentType: string
  sizeBytes: number
  purpose: MediaAssetPurpose
  checksumSha256?: string
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
    uploadTtlSeconds: number
    downloadTtlSeconds: number
    scannerReadTtlSeconds: number
    privateDownloadConfigured: boolean
    cleanupWorkerEnabled: boolean
    cleanupWorkerIntervalSeconds: number
    cleanupBatchSize: number
    cleanupRetentionDays: number
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
    storageCleanupRetentionDays: number
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
    provider?: 'mock' | 's3' | 'private-cdn'
    method: 'GET'
    url: string
    headers: Record<string, string>
    expiresAt: string
  }
}

export type CreativeWorkspace = 'image' | 'video' | 'music' | 'chat'

export type ChatMode = 'assistant' | 'prompt_assist' | 'storyboard'
export type ChatTurnStatus = 'queued' | 'streaming' | 'completed' | 'stopped' | 'interrupted' | 'failed' | 'blocked'
export type ChatMessageStatus = 'complete' | 'streaming' | 'stopped' | 'interrupted' | 'failed' | 'blocked'
export type ChatProductContextReference = { type: 'task' | 'library_item'; id: string }
export type ChatSafetyEvidence = {
  safetyId: string
  policyVersion: string
  stage: 'input' | 'output'
  disposition: 'allow' | 'block' | 'review' | 'pending'
  classified: boolean
  reasonCodes: string[]
  source: 'mock_fixture' | 'injected_fixture' | 'production_classifier' | 'unavailable'
  characterCount: number
  classifiedAt: string
}

export type ApiChatConversation = {
  id: string
  mode: ChatMode
  status: 'active' | 'archived'
  title: string
  lastMessageAt: string
  createdAt: string
}

export type ApiChatMessage = {
  id: string
  turnId: string
  role: 'user' | 'assistant'
  status: ChatMessageStatus
  sequence: number
  content: string
  createdAt: string
  updatedAt: string
}

export type ApiChatInputAsset = {
  id: string
  fileName: string
  contentType: 'text/plain' | 'text/markdown' | 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp'
  sizeBytes: number
  purpose: 'task_attachment' | 'library_asset'
}

export type ApiChatTurn = {
  id: string
  conversationId: string
  generationId: string | null
  clientTurnId: string
  mode: ChatMode
  status: ChatTurnStatus
  errorCode: string | null
  usage: { inputTokens?: number; outputTokens?: number; metered?: boolean } | null
  inputAssetIds: string[]
  productContext: ChatProductContextReference[]
  safety: { input: ChatSafetyEvidence; output: ChatSafetyEvidence | null; reviewId: string | null } | null
  stopRequestedAt: string | null
  disconnectedAt: string | null
  completedAt: string | null
  createdAt: string
  messages: ApiChatMessage[]
}

export type ChatStreamEvent =
  | { event: 'turn.accepted'; data: { duplicate: boolean; turn: ApiChatTurn } }
  | { event: 'turn.snapshot'; data: { turn: ApiChatTurn } }
  | { event: 'content.delta'; data: { turnId: string; messageId: string; text: string } }
  | { event: 'usage'; data: { turnId: string; usage: ApiChatTurn['usage'] } }
  | { event: `turn.${ChatTurnStatus}`; data: { turnId: string; status: ChatTurnStatus; errorCode: string | null; safetyId?: string | null; moderationDecisionId?: string | null } }

export type CreateCreativeGenerationRequest = {
  workspace: CreativeWorkspace
  mode: string
  prompt: string
  inputAssetIds?: string[]
  parameters?: Record<string, string | number | boolean | Array<string | number | boolean> | null>
  providerId?: string | null
  modelId?: string | null
}

export type ApiCreativeAccountingPreview = {
  policy: {
    schema: 'CreativeAccountingPolicyV1'
    version: string
    effectiveAt: string
  }
  workspace: CreativeWorkspace
  mode: string
  credits: {
    estimate: number
    unit: 'creative_credits'
  }
  quota: {
    policyVersion: string
    scope: string
    workspace: CreativeWorkspace
    weight: number
    limit: number
    reserved: number
    used: number
    released: number
    remaining: number
    allowed: boolean
    window: { start: string; end: string; resetsAt: string }
  }
  capability: {
    providerId: string
    available: boolean
    reasonCode: string | null
  }
  providerCost: {
    availability: 'available' | 'unavailable'
    reasonCode: string | null
  }
  settlement: {
    success: string
    reviewRequired: string
    noOutputFailureOrCancellation: string
    providerCostUnknown: string
  }
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
  minimumLength?: number
  maximumLength?: number
}

export type ApiCreativeModeContract = {
  id: 'text_to_image' | 'image_to_image' | 'image_edit' | 'image_variation'
    | 'assistant' | 'prompt_assist' | 'storyboard'
    | 'text_to_video' | 'image_to_video' | 'music_video'
    | 'instrumental' | 'lyrics_to_song'
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
  requiredParameters?: string[]
}

export type ApiCreativeCapability = {
  workspace: CreativeWorkspace
  label: string
  contractVersion?: string
  modes: string[]
  allModes?: string[]
  modeContracts?: ApiCreativeModeContract[]
  inputAssetPurposes: string[]
  outputTypes: string[]
  maxPromptCharacters: number
  supportedParameters: string[]
  parameterDefinitions?: Record<string, ApiCreativeParameterDefinition>
  output?: Record<string, unknown>
  modelDecision?: Record<string, unknown>
  runtime?: {
    realProviderCallsApproved: boolean
    productionEnablementApproved: boolean
    productionFallback: string
    silentMockFallback: boolean
    [key: string]: unknown
  }
  cost?: Record<string, unknown>
  safety?: Record<string, unknown>
  context?: Record<string, unknown>
  persistence?: Record<string, unknown>
  tools?: Record<string, unknown>
  lifecycle?: Record<string, unknown>
  composition?: Record<string, unknown>
  productBoundary?: Record<string, unknown>
  rights?: Record<string, unknown>
  data?: Record<string, unknown>
}

export type ApiCreativeProviderCatalogEntry = ApiCreativeProvider & {
  enabled: boolean
  configured: boolean
  default: boolean
  fixtureInjectable?: boolean
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
  accounting?: {
    policyVersion: string
    legacy: boolean
    quotaUnits: number
    providerCost: {
      availability: 'available' | 'unavailable'
      ledgerStatus: string | null
    }
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

export type ApiGenerationTask = {
  id: string
  workspace: CreativeWorkspace
  mode: string
  status: string
  summary: string | null
  attempt: {
    number: number
    retryOfId: string | null
  }
  usage: {
    estimatedCredits: number
    metered: boolean
  }
  accounting?: ApiUserCreativeGeneration['accounting']
  review: {
    required: boolean
  }
  error: {
    code: string
    message: string | null
  } | null
  outputs: ApiUserCreativeGeneration['outputs']
  actions: {
    view: ApiUserCreativeGenerationAction
    cancel: ApiUserCreativeGenerationAction
    retry: ApiUserCreativeGenerationAction
    download: ApiUserCreativeGenerationAction
    reuse: ApiUserCreativeGenerationAction
  }
  deepLink: {
    page: 'playground'
    workspace: CreativeWorkspace
  }
  startedAt: string | null
  completedAt: string | null
  failedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type GenerationCenterQuery = {
  cursor?: string | null
  limit?: number
  workspace?: CreativeWorkspace | null
  status?: string | null
  dateFrom?: string | null
  dateTo?: string | null
}

export type GenerationCenterPage = {
  items: ApiGenerationTask[]
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
  quotaUnits: number | null
  creditEstimateKind: string | null
  providerCostAvailability: {
    availability: 'available' | 'unavailable' | null
    reasonCode: string | null
  } | null
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
    quotaUnits: number
    creditEstimateKind: 'policy_estimate'
    providerCostAvailability: {
      availability: 'available' | 'unavailable'
      reasonCode: string | null
    }
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

export type ReleaseChangeStatus = 'pending_approval' | 'approved' | 'rejected' | 'deployed' | 'failed' | 'rolled_back'
export type ReleaseChangeType = 'promotion' | 'secret_rotation' | 'configuration'
export type ReleaseEnvironment = 'development' | 'staging' | 'production'
export type ReleaseEvidenceDto = {
  id: string
  eventType: string
  actorRef: string
  reasonCode: string
  evidence: Record<string, unknown>
  evidenceHash: string
  createdAt: string
}
export type ReleaseChangeDto = {
  id: string
  changeType: ReleaseChangeType
  status: ReleaseChangeStatus
  sourceEnvironment: ReleaseEnvironment | null
  targetEnvironment: ReleaseEnvironment
  artifactVersion: string
  rollbackVersion: string
  secretRef: string | null
  secretVersion: string | null
  summary: string
  reasonCode: string
  requestedByRef: string
  approvedByRef: string | null
  appliedByRef: string | null
  rolledBackByRef: string | null
  version: number
  createdAt: string
  updatedAt: string
  evidence: ReleaseEvidenceDto[]
}
export type ReleaseChangeListQuery = {
  status?: ReleaseChangeStatus | null
  targetEnvironment?: ReleaseEnvironment | null
  changeType?: ReleaseChangeType | null
  cursor?: string | null
  limit?: number | null
}
export type ReleaseChangeRequest = {
  changeType: ReleaseChangeType
  sourceEnvironment?: ReleaseEnvironment | null
  targetEnvironment: ReleaseEnvironment
  artifactVersion: string
  rollbackVersion: string
  secretRef?: string | null
  secretVersion?: string | null
  summary: string
  reasonCode: string
}

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

export type AuditIntegrityStatus = 'complete' | 'broken' | 'unverifiable'
export type AdminAuditIntegrityDto = {
  status: AuditIntegrityStatus
  verified: boolean
  count: number
  firstSequence?: string | number | null
  lastSequence?: string | number | null
  rootHash: string | null
  failures: Array<{ sequence?: number; reason: string }>
}
export type AdminAuditArchiveManifestDto = {
  id: string
  fromSequence: string | number
  toSequence: string | number
  eventCount: number
  rootHash: string
  objectRef: string
  actorId: string | null
  createdAt: string
}
export type AdminAuditArchiveResultDto = {
  integrity: AdminAuditIntegrityDto
  manifest: AdminAuditArchiveManifestDto | null
}

export type AdminAccountingUnit = 'points' | 'creative_credit' | 'quota_unit'
export type AdminAccountingIssueStatus = 'open' | 'repair_pending' | 'resolved' | 'ignored'

export type AdminAccountingIssueDto = {
  id: string
  issueKey: string
  type: string
  unit: AdminAccountingUnit
  status: AdminAccountingIssueStatus
  sourceType: string
  sourceId: string
  expectedAmount: number | null
  actualAmount: number | null
  differenceAmount: number | null
  operationKey: string | null
  repairOperationKey: string | null
  evidence: Record<string, unknown> | null
  detectedAt: string
  reviewedAt: string | null
  resolvedAt: string | null
}

export type AdminAccountingIssueSummary = {
  total: number
  open: number
  repairPending: number
  resolved: number
  ignored: number
}

export type AdminAccountingReconciliationQuery = {
  status?: AdminAccountingIssueStatus | null
  unit?: AdminAccountingUnit | null
  type?: string | null
  cursor?: string | null
  limit?: number | null
}

export type AdminAccountingReconciliationPage = {
  items: AdminAccountingIssueDto[]
  summary: AdminAccountingIssueSummary
  generatedAt: string
  nextCursor: string | null
}

export type AdminAccountingRepairRequest = {
  repairKind: 'compensation'
  reasonCode: 'repair_missing_movement' | 'repair_balance_drift'
  reason: string
}

export type AdminAccountingRepairResponse = {
  issue: AdminAccountingIssueDto
  review: AdminReviewQueueItemDto
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

export type AdminOperationsQueueItemDto = {
  type: string
  id: string
  title: string
  detail: string
  status: string | null
  timestamp: string | null
}

export type AdminOperationsOverviewDto = {
  generatedAt: string
  windowMinutes: number
  totals: {
    pendingReviews: number
    activeAlerts: number
    recoveryItems: number
    failedOperations: number
  }
  pendingReviews: AdminOperationsQueueItemDto[]
  alerts: AdminOperationsQueueItemDto[]
  recoveryItems: AdminOperationsQueueItemDto[]
  metrics: AdminOperationsMetricsDto | null
}

export type AdminGlobalSearchType =
  | 'task'
  | 'profile'
  | 'admin_review'
  | 'audit_event'
  | 'security_event'
  | 'security_alert'
  | 'accounting_issue'
  | 'domain_event'
  | 'event_inbox'
  | 'job_run'
  | 'media_asset'
  | 'creative_generation'

export type AdminGlobalSearchResultDto = {
  type: AdminGlobalSearchType
  id: string
  title: string
  subtitle: string
  status: string | null
  timestamp: string | null
  target: {
    page: 'admin'
    tab: 'Overview'
    resourceType: AdminGlobalSearchType
    resourceId: string
  }
}

export type AdminGlobalSearchQuery = {
  q: string
  types?: AdminGlobalSearchType[]
  limit?: number
  cursor?: string | null
}

export type AdminGlobalSearchPage = {
  items: AdminGlobalSearchResultDto[]
  nextCursor: string | null
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

export type AdminObservabilityLevel = 'debug' | 'info' | 'warn' | 'error'
export type AdminObservabilityOutcome = 'success' | 'client_error' | 'server_error'
export type AdminObservabilityAlertState = 'firing' | 'acknowledged' | 'silenced' | 'resolved'

export type AdminObservabilityQuery = {
  level?: AdminObservabilityLevel | null
  service?: string | null
  module?: string | null
  operation?: string | null
  outcome?: AdminObservabilityOutcome | null
  errorCode?: string | null
  requestId?: string | null
  traceId?: string | null
  resourceType?: string | null
  resourceId?: string | null
  dateFrom?: string | null
  dateTo?: string | null
  cursor?: string | null
  limit?: number
}

export type AdminObservabilityLogDto = {
  id: string
  timestamp: string
  level: AdminObservabilityLevel
  service: string
  environment: string
  event: string
  requestId: string | null
  traceId: string | null
  spanId: string | null
  parentSpanId: string | null
  module: string
  operation: string
  outcome: AdminObservabilityOutcome
  durationMs: number | null
  errorCode: string | null
  method: string | null
  routeTemplate: string | null
  statusCode: number | null
  resourceType: string | null
  resourceId: string | null
  attributes: Record<string, unknown> | null
}

export type AdminObservabilityLogPage = {
  items: AdminObservabilityLogDto[]
  nextCursor: string | null
}

export type AdminTraceSpanDto = {
  id: string
  traceId: string
  spanId: string
  parentSpanId: string | null
  requestId: string | null
  service: string
  module: string
  operation: string
  outcome: AdminObservabilityOutcome
  startedAt: string
  endedAt: string
  durationMs: number
  errorCode: string | null
  resourceType: string | null
  resourceId: string | null
  jobId: string | null
  eventId: string | null
}

export type AdminTraceDto = {
  traceId: string
  startedAt: string
  endedAt: string
  spans: AdminTraceSpanDto[]
}

export type AdminSloWindowDto = {
  requests: number
  availability: number | null
  serverErrors: number
  latencyEligible: number
  latencyWithinTarget: number | null
  latencyViolations: number
}

export type AdminSloDto = {
  id: string
  target: number
  shortWindowBurn: number
  longWindowBurn: number
  firing: boolean
  current: number | null
  owner: string
  runbook: string
}

export type AdminSloSummaryDto = {
  generatedAt?: string
  status?: 'complete' | 'unverifiable'
  reason?: string
  windows?: {
    fiveMinutes: AdminSloWindowDto
    sixtyMinutes: AdminSloWindowDto
    thirtyDays: AdminSloWindowDto
  }
  slos?: AdminSloDto[]
  alerts?: AdminObservabilityAlertDto[]
}

export type AdminObservabilityAlertDto = {
  id: string
  alertKey: string
  sloId: string
  state: AdminObservabilityAlertState
  severity: string
  shortWindowBurn: number
  longWindowBurn: number
  threshold: number
  owner: string
  runbook: string
  version: number
  startedAt: string
  acknowledgedAt: string | null
  acknowledgedBy: string | null
  silencedUntil: string | null
  resolvedAt: string | null
  resolutionNote: string | null
  createdAt: string
  updatedAt: string
}

export type SystemSettingChangeStatus = 'pending_approval' | 'approved' | 'rejected' | 'published'
export type SystemSettingChangeKind = 'update' | 'rollback'

export type SystemSettingDiffItem = {
  path: string
  previous: unknown
  next: unknown
}

export type SystemSettingDiff = {
  schemaVersion: number
  changes: SystemSettingDiffItem[]
}

export type SystemSettingDto = {
  key: string
  domain: string
  scope: string
  schema: Record<string, unknown>
  value: Record<string, unknown>
  valueSchemaVersion: number
  publishedVersion: number
  currentRevisionId: string | null
  source: 'default' | 'published'
  updatedAt: string | null
  pendingChanges?: number
}

export type SystemSettingChangeDto = {
  id: string
  settingKey: string
  kind: SystemSettingChangeKind
  status: SystemSettingChangeStatus
  baseVersion: number
  candidateValue: Record<string, unknown>
  candidateValueSchemaVersion: number
  diff: SystemSettingDiff
  targetRevisionId: string | null
  requestedByRef: string
  approvedByRef: string | null
  rejectedByRef: string | null
  publishedByRef: string | null
  reasonCode: string
  note: string | null
  version: number
  requestedAt: string
  approvedAt: string | null
  rejectedAt: string | null
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

export type SystemSettingRevisionDto = {
  id: string
  settingKey: string
  settingVersion: number
  value: Record<string, unknown>
  valueSchemaVersion: number
  previousRevisionId: string | null
  sourceChangeId: string
  eventType: 'published' | 'rolled_back'
  contentHash: string
  actorRef: string
  createdAt: string
}

export type SystemSettingPreviewDto = {
  key: string
  domain: string
  scope: string
  baseVersion: number
  valueSchemaVersion: number
  previous: Record<string, unknown>
  next: Record<string, unknown>
  diff: SystemSettingDiff
  changed: boolean
  contentHash: string
}

export type SystemSettingListQuery = {
  category?: string | null
  search?: string | null
  status?: SystemSettingChangeStatus | null
  settingKey?: string | null
  cursor?: string | null
  limit?: number
}

export type SystemSettingChangeRequest = {
  value: Record<string, unknown>
  baseVersion: number
  reasonCode: string
  note?: string
}

export type SystemSettingTransitionRequest = {
  expectedVersion: number
  reasonCode: string
  note?: string
}

export type SystemSettingPublishResult = {
  change: SystemSettingChangeDto
  setting: SystemSettingDto
  revision: SystemSettingRevisionDto
}

export type ConfigResourceKind = 'feature_flag' | 'reference_data' | 'announcement'
export type ConfigResourceDeletedFilter = 'active' | 'deleted' | 'all'
export type FeatureFlagRuleType = 'user' | 'role' | 'environment'
export type FeatureFlagRule = {
  id: string
  type: FeatureFlagRuleType
  values: string[]
  enabled: boolean
  payload?: unknown
}
export type FeatureFlagDefinition = {
  enabled: boolean
  payload: unknown
  rules: FeatureFlagRule[]
  rolloutPercentage: number | null
  rolloutSeed: string
}
export type FeatureFlagEvaluation = {
  key: string
  enabled: boolean
  payload: unknown
  reason: 'emergency_off' | 'user_rule' | 'role_rule' | 'environment_rule' | 'percentage_rollout' | 'default'
  ruleId: string | null
  emergencyOff: boolean
  publishedVersion?: number
}
export type FeatureFlagEmergencyResult = {
  resource: ConfigResourceDto
  featureFlag: {
    emergencyOff: boolean
    emergencyOffByRef: string | null
    emergencyOffReasonCode: string | null
    emergencyOffAt: string | null
  }
}

export type ConfigResourceDto = {
  id: string
  kind: ConfigResourceKind
  key: string
  title: string
  description: string | null
  draftValue: Record<string, unknown>
  draftValueSchemaVersion: number
  publishedValue: Record<string, unknown> | null
  publishedValueSchemaVersion: number
  publishedVersion: number
  currentRevisionId: string | null
  version: number
  createdByRef: string
  updatedByRef: string
  deletedByRef: string | null
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

export type ConfigResourceRevisionDto = {
  id: string
  resourceId: string
  resourceVersion: number
  title: string
  description: string | null
  value: Record<string, unknown>
  valueSchemaVersion: number
  previousRevisionId: string | null
  eventType: 'published' | 'rolled_back'
  contentHash: string
  actorRef: string
  reasonCode: string
  createdAt: string
}

export type ConfigResourceListQuery = {
  search?: string | null
  deleted?: ConfigResourceDeletedFilter
  sort?: 'key' | 'title' | 'updatedAt' | 'publishedVersion'
  order?: 'asc' | 'desc'
  cursor?: string | null
  limit?: number
}

export type ConfigResourceDraftRequest = {
  key?: string
  title: string
  description?: string | null
  value: Record<string, unknown>
  expectedVersion?: number
}

export type ConfigResourceTransitionRequest = {
  expectedVersion: number
  reasonCode: string
}

export type ConfigResourcePublishResult = {
  resource: ConfigResourceDto
  revision: ConfigResourceRevisionDto
}

export type ConfigResourceExportDocument = {
  schemaVersion: 1
  kind: ConfigResourceKind
  exportedAt: string
  items: Array<ConfigResourceDraftRequest & { key: string; expectedVersion: number }>
}

export type ModelControlStatus = 'draft' | 'active' | 'disabled' | 'deprecated' | 'archived'
export type ModelCapabilityModality = 'image' | 'chat' | 'video' | 'music'
export type ModelDeploymentEnvironment = 'development' | 'staging' | 'production'
export type ModelProviderDto = {
  id: string
  key: string
  name: string
  status: ModelControlStatus
  websiteUrl: string | null
  regions: string[]
  dataProcessingRegions: string[]
  modelCount?: number
  version: number
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}
export type ModelCatalogModelDto = {
  id: string
  providerId: string
  key: string
  name: string
  family: string | null
  status: ModelControlStatus
  versionCount?: number
  version: number
  provider?: ModelProviderDto | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}
export type ModelCapabilityDto = {
  id: string
  modelVersionId: string
  modality: ModelCapabilityModality
  operations: string[]
  inputMimeTypes: string[]
  outputMimeTypes: string[]
  constraints: Record<string, unknown> | null
}
export type ModelDeploymentDto = {
  id: string
  modelVersionId: string
  key: string
  environment: ModelDeploymentEnvironment
  region: string
  deploymentRef: string
  status: ModelControlStatus
  trafficEligible: boolean
  version: number
  createdAt: string
  updatedAt: string
}
export type PricingVersionDto = {
  id: string
  modelVersionId: string
  modelDeploymentId: string | null
  versionKey: string
  currency: string
  unit: string
  unitPriceMicros: number
  status: ModelControlStatus
  effectiveFrom: string
  effectiveTo: string | null
  version: number
}
export type ModelVersionDto = {
  id: string
  modelId: string
  versionKey: string
  status: ModelControlStatus
  releaseDate: string | null
  deprecationDate: string | null
  contextWindow: number | null
  maxOutputUnits: number | null
  parameterSchema: Record<string, unknown> | null
  version: number
  model?: ModelCatalogModelDto | null
  capabilities?: ModelCapabilityDto[]
  deployments?: ModelDeploymentDto[]
  prices?: PricingVersionDto[]
  createdAt: string
  updatedAt: string
}
export type ModelControlSummaryDto = {
  counts: { providers: number; models: number; versions: number; capabilities: number; deployments: number; pricingVersions: number }
  statusCounts: Partial<Record<ModelControlStatus, number>>
  providerTrafficEnabled: false
  realProviderApprovalRequired: true
}
export type ModelControlListQuery = {
  search?: string | null
  status?: ModelControlStatus | null
  providerId?: string | null
  sort?: 'key' | 'name' | 'status' | 'updatedAt'
  order?: 'asc' | 'desc'
  cursor?: string | null
  limit?: number
}
export type ModelRouteFallbackMode = 'fail_closed' | 'ordered'
export type ModelRouteTargetRole = 'primary' | 'backup'
export type ModelRouteTargetDto = {
  id: string
  policyId: string
  modelDeploymentId: string
  role: ModelRouteTargetRole
  priority: number
  enabled: boolean
  deployment?: ModelDeploymentDto & { modelVersion?: ModelVersionDto | null }
}
export type ModelRoutePolicyDto = {
  id: string
  key: string
  name: string
  modality: ModelCapabilityModality
  operation: string
  environment: ModelDeploymentEnvironment
  region: string | null
  audienceRoles: string[]
  rolloutPercentage: number
  rolloutSeed: string
  fallbackMode: ModelRouteFallbackMode
  priority: number
  status: ModelControlStatus
  version: number
  revisionCount: number
  targets: ModelRouteTargetDto[]
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}
export type ModelRoutePolicyDraft = {
  key?: string
  name: string
  modality: ModelCapabilityModality
  operation: string
  environment: ModelDeploymentEnvironment
  region?: string | null
  audienceRoles?: string[]
  rolloutPercentage?: number
  rolloutSeed?: string
  fallbackMode?: ModelRouteFallbackMode
  priority?: number
}
export type ModelRouteRevisionDto = {
  id: string
  policyId: string
  revisionNumber: number
  snapshot: Record<string, unknown>
  reasonCode: string
  createdByRef: string
  createdAt: string
}
export type ModelRouteSummaryDto = {
  policyCount: number
  revisionCount: number
  statusCounts: Partial<Record<ModelControlStatus, number>>
  targetCounts: Partial<Record<ModelRouteTargetRole, number>>
  providerTrafficEnabled: false
  automaticFallbackDefault: 'fail_closed'
}
export type ModelRoutePreviewResult = {
  status: 'selected' | 'unavailable'
  reasonCode: string
  policy: { id: string; key: string; fallbackMode: ModelRouteFallbackMode; bucket?: number } | null
  selected: { targetId: string; role: ModelRouteTargetRole; deploymentId: string; deploymentKey: string | null; modelVersionId: string | null; modelKey: string | null; providerKey: string | null } | null
  attempts: Array<{ targetId: string; role: ModelRouteTargetRole; deploymentId: string; deploymentKey: string | null; selected: boolean; reasonCode: string }>
  consideredPolicies: Array<{ policyId: string; policyKey: string; matched: boolean; reasonCode: string | null; bucket?: number }>
  providerTrafficEnabled: false
}
