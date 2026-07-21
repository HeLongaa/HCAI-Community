import { api, apiEnvelope, apiRequest, withQuery } from './apiClient'
import type {
  AdminAuditListQuery,
  AdminSupportMetrics,
  AdminSupportTicketPage,
  AdminSupportTicketQuery,
  AdminSupportTicketUpdate,
  ApiSupportRequest,
  AdminOAuthAccount,
  AdminOAuthAccountQuery,
  AdminOAuthAuthorizationQuery,
  AdminOAuthAuthorizationRequest,
  AdminOAuthProviderControl,
  DeveloperAccessControl,
  DeveloperAccessMetrics,
  DeveloperApiV1Contract,
  DeveloperApiKeyCredential,
  DeveloperServiceAccount,
  DeveloperServiceAccountQuery,
  WebhookControl,
  WebhookDelivery,
  WebhookDeliveryQuery,
  WebhookMetrics,
  WebhookSubscription,
  WebhookSubscriptionQuery,
  AdminCommunityBulkAction,
  AdminCommunityBulkPreview,
  AdminCommunityBulkResult,
  AdminCommunityContent,
  AdminCommunityMetrics,
  AdminCommunityQuery,
  AdminCommunityTargetType,
  AdminAuthFailure,
  AdminAuthFailureQuery,
  AdminAuthMetrics,
  AdminAuthRiskPolicy,
  AdminAuthSession,
  AdminAuthSessionQuery,
  RiskCase,
  RiskCaseQuery,
  RiskCaseStatus,
  RiskDisposition,
  RiskLevel,
  RiskMetrics,
  RiskPolicy,
  AdminUserDto,
  AdminUserMetrics,
  AdminUserMetricsExport,
  AdminUserQuery,
  AdminUserStatusResult,
  AdminUserTag,
  AdminUserTagColor,
  AdminTaskBulkAction,
  AdminTaskBulkPreview,
  AdminTaskBulkResult,
  AdminTaskDto,
  AdminTaskMutationEvidence,
  AdminTaskQuery,
  AdminTaskSummary,
  TaskBusinessMetrics,
  TaskBusinessMetricsExport,
  TaskBusinessMetricsQuery,
  ApiTaskLifecycleMutation,
  AdminTaskUpdateRequest,
  AdminAuditArchiveManifestDto,
  AdminAuditArchiveResultDto,
  AdminAuditIntegrityDto,
  AdminAuditRetentionPreviewDto,
  AdminAuditRetentionResultDto,
  AdminAuditRetentionStatusDto,
  AdminAccountingReconciliationPage,
  AdminAccountingReconciliationQuery,
  AdminAccountingIssueDto,
  AdminAccountingIssueSummary,
  AdminAccountingRepairRequest,
  AdminAccountingRepairResponse,
  AdminBillingMetrics,
  AdminBillingMetricsQuery,
  AdminBillingPolicyInventory,
  AdminBillingPolicyPreview,
  AdminCreativeGenerationHistoryPage,
  AdminCreativeGenerationHistoryQuery,
  AdminCreativeGenerationSummary,
  AdminGenerationBusinessMetrics,
  AdminCreativeGenerationBulkAction,
  AdminCreativeGenerationBulkPreview,
  AdminCreativeGenerationBulkResult,
  AdminCreativeGenerationExecution,
  AdminPointAdjustmentRequest,
  AdminPointAdjustmentResponse,
  AdminPermissionDto,
  AdminProviderControlBundle,
  AdminProviderControlRecoveryTarget,
  AdminOperationsMetricsDto,
  AdminOperationsOverviewDto,
  AdminGlobalSearchQuery,
  AdminGlobalSearchResultDto,
  AdminGlobalSearchPage,
  AdminReviewActionRequest,
  AdminReviewDecision,
  AdminReviewListQuery,
  AdminReviewQueueItemDto,
  AdminRolePermissionDto,
  AdminSecurityAlertEventDto,
  AdminSecurityAlertDto,
  AdminSecurityEventDto,
  AdminSecurityEventListQuery,
  ApiLedgerEntry,
  ApiNotification,
  ApiCreativeGenerationRecord,
  ApiCreativeGenerationMutationResponse,
  AdminManualReplayRequest,
  CreativeGenerationMutationRequest,
  ApiPointsSummary,
  ApiPaginationMeta,
  PointAdjustmentPolicyHistoryItem,
  PointAdjustmentPolicy,
  PointsLedgerQuery,
  PersonalBillingEntry,
  PersonalBillingQuery,
  PersonalBillingSummary,
  AuditEventDto,
  UpdateRolePermissionsRequest,
  ReleaseChangeDto,
  ReleaseChangeListQuery,
  ReleaseChangeRequest,
  AdminObservabilityAlertDto,
  AdminObservabilityAlertDetailDto,
  AdminObservabilityIncidentMetricsDto,
  AdminObservabilityIncidentReviewDto,
  AdminObservabilityLogDto,
  AdminObservabilityLogPage,
  AdminObservabilityQuery,
  AdminObservabilitySloControlDto,
  AdminSloSummaryDto,
  AdminTraceDto,
  NotificationTemplate,
  NotificationTemplateDraft,
  NotificationTemplateListQuery,
  NotificationTemplateMetrics,
  NotificationDelivery,
  NotificationDeliveryListQuery,
  NotificationDeliveryMetrics,
  NotificationDeliveryMetricsQuery,
  NotificationChannelConfig,
  NotificationChannelConfigRevision,
  SystemSettingChangeDto,
  SystemSettingChangeRequest,
  SystemSettingDto,
  SystemSettingListQuery,
  SystemSettingPreviewDto,
  SystemSettingPublishResult,
  SystemSettingRevisionDto,
  SystemSettingTransitionRequest,
  ConfigResourceDraftRequest,
  ConfigResourceDto,
  ConfigResourceKind,
  ConfigResourceListQuery,
  ConfigResourcePublishResult,
  ConfigResourceRevisionDto,
  ConfigResourceTransitionRequest,
  ConfigResourceExportDocument,
  FeatureFlagEmergencyResult,
  FeatureFlagEvaluation,
  ModelCatalogModelDto,
  ModelCapabilityDto,
  ModelCapabilityModality,
  ModelControlListQuery,
  ModelControlStatus,
  ModelControlSummaryDto,
  ModelGovernanceSummaryDto,
  ModelDeploymentDto,
  ModelDeploymentEnvironment,
  ModelProviderDto,
  ModelRoutePolicyDraft,
  ModelPromotionDto,
  ModelPromotionListQuery,
  ModelPromotionRequest,
  ModelRouteDecisionDto,
  ModelRouteDecisionListQuery,
  ModelRoutePolicyDto,
  ModelRoutePreviewResult,
  ModelRouteRevisionDto,
  ModelRouteSummaryDto,
  ProviderSecretRefDto,
  ProviderSecretRefListQuery,
  ProviderSecretRefRequest,
  ProviderOperationalPolicyDto,
  ProviderOperationalPolicyRequest,
  ProviderHealthEvidenceDto,
  ProviderOperationsSummaryDto,
  AiEvaluationPolicyDto,
  AiEvaluationPolicyRequest,
  AiEvaluationRunDto,
  AiEvaluationRunRequest,
  AiEvaluationSuiteDto,
  AiEvaluationSuiteRequest,
  AiEvaluationSummaryDto,
  ProviderLegalReviewDto,
  ProviderLegalReviewRequest,
  ProviderLegalSummaryDto,
  DataRightsBackupClass,
  DataRightsMetricsDto,
  DataRightsRequestDto,
  DataRightsRequestType,
  DataRightsStatus,
  ModelVersionDto,
  PricingVersionDto,
} from './contracts'
import type { Permission, Role } from '../domain/types'

export const adminService = {
  async tasks(query?: AdminTaskQuery) {
    const envelope = await api.getEnvelope<AdminTaskDto[]>(withQuery('/admin/tasks', query))
    return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null }
  },
  async taskSummary(query?: AdminTaskQuery) {
    return api.get<AdminTaskSummary>(withQuery('/admin/tasks/summary', query))
  },
  async taskBusinessMetrics(query?: TaskBusinessMetricsQuery) {
    return api.get<TaskBusinessMetrics>(withQuery('/admin/tasks/business-metrics', query))
  },
  async exportTaskBusinessMetrics(query?: TaskBusinessMetricsQuery) {
    return api.get<TaskBusinessMetricsExport>(withQuery('/admin/tasks/business-metrics/export', query))
  },
  async task(id: string) {
    return api.get<AdminTaskDto>(`/admin/tasks/${encodeURIComponent(id)}`)
  },
  async updateTask(id: string, payload: AdminTaskUpdateRequest) {
    return api.patch<AdminTaskDto>(`/admin/tasks/${encodeURIComponent(id)}`, payload)
  },
  async archiveTask(id: string, payload: AdminTaskMutationEvidence) {
    return api.post<AdminTaskDto>(`/admin/tasks/${encodeURIComponent(id)}/archive`, payload)
  },
  async restoreTask(id: string, payload: AdminTaskMutationEvidence) {
    return api.post<AdminTaskDto>(`/admin/tasks/${encodeURIComponent(id)}/restore`, payload)
  },
  async transitionTask(id: string, action: 'publish' | 'cancel', payload: AdminTaskMutationEvidence) {
    return api.post<AdminTaskDto>(`/admin/tasks/${encodeURIComponent(id)}/transitions`, { ...payload, action })
  },
  async taskLifecycle(id: string) {
    const envelope = await api.getEnvelope<ApiTaskLifecycleMutation[]>(`/admin/tasks/${encodeURIComponent(id)}/lifecycle`)
    return envelope.data
  },
  async recoverTaskEscrow(id: string, payload: AdminTaskMutationEvidence & { idempotencyKey: string }) {
    return api.post<ApiTaskLifecycleMutation>(`/admin/tasks/${encodeURIComponent(id)}/recovery`, { ...payload, action: 'release_escrow' })
  },
  async sweepExpiredTasks(limit = 50) {
    return api.post<{ scanned: number; expired: number; mutations: ApiTaskLifecycleMutation[] }>('/admin/tasks/expiry/sweep', { limit })
  },
  async previewTaskBulk(action: AdminTaskBulkAction, targetIds: string[]) {
    return api.post<AdminTaskBulkPreview>('/admin/tasks/bulk/preview', { action, targetIds })
  },
  async executeTaskBulk(body: { action: AdminTaskBulkAction; targetIds: string[]; targetHash: string; confirmationText: string; idempotencyKey: string; reasonCode: string; note?: string }) {
    return api.post<AdminTaskBulkResult>('/admin/tasks/bulk', body)
  },
  async communityContent(targetType: AdminCommunityTargetType, query?: AdminCommunityQuery) {
    const resource = targetType === 'post' ? 'posts' : 'comments'
    const envelope = await api.getEnvelope<AdminCommunityContent[]>(withQuery(`/admin/community/${resource}`, query))
    return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null }
  },
  async communityDetail(targetType: AdminCommunityTargetType, id: string) {
    return api.get<AdminCommunityContent>(`/admin/community/${targetType === 'post' ? 'posts' : 'comments'}/${encodeURIComponent(id)}`)
  },
  async updateCommunityContent(targetType: AdminCommunityTargetType, id: string, payload: Record<string, unknown>) {
    return api.patch<AdminCommunityContent>(`/admin/community/${targetType === 'post' ? 'posts' : 'comments'}/${encodeURIComponent(id)}`, payload)
  },
  async transitionCommunityContent(targetType: AdminCommunityTargetType, id: string, action: AdminCommunityBulkAction, payload: { expectedVersion: number; reasonCode: string; note?: string }) {
    return api.post<AdminCommunityContent>(`/admin/community/${targetType === 'post' ? 'posts' : 'comments'}/${encodeURIComponent(id)}/${action}`, payload)
  },
  async communityMetrics(query?: { dateFrom?: string | null; dateTo?: string | null; category?: string | null }) {
    return api.get<AdminCommunityMetrics>(withQuery('/admin/community/metrics', query))
  },
  async exportCommunityMetrics(query?: { dateFrom?: string | null; dateTo?: string | null; category?: string | null }) {
    return api.get<{ schemaVersion: 1; kind: 'community.metrics.snapshot'; exportedAt: string; metrics: AdminCommunityMetrics }>(withQuery('/admin/community/metrics/export', query))
  },
  async previewCommunityBulk(targetType: AdminCommunityTargetType, action: AdminCommunityBulkAction, targetIds: string[]) {
    return api.post<AdminCommunityBulkPreview>('/admin/community/bulk/preview', { targetType, action, targetIds })
  },
  async executeCommunityBulk(payload: { targetType: AdminCommunityTargetType; action: AdminCommunityBulkAction; targetIds: string[]; targetHash: string; confirmationText: string; idempotencyKey: string; reasonCode: string; note?: string }) {
    return api.post<AdminCommunityBulkResult>('/admin/community/bulk', payload)
  },
  async oauthProviders() {
    return api.get<AdminOAuthProviderControl[]>('/admin/auth/oauth/providers')
  },
  async setOAuthProviderStatus(provider: string, payload: { enabled: boolean; expectedVersion: number; reasonCode: string }) {
    return api.post<AdminOAuthProviderControl>(`/admin/auth/oauth/providers/${encodeURIComponent(provider)}/status`, payload)
  },
  async setOAuthProviderConfiguration(provider: string, payload: { clientId: string; redirectUri: string; scopes: string[]; clientSecretRef: string; expectedVersion: number; reasonCode: string }) {
    return api.put<AdminOAuthProviderControl>(`/admin/auth/oauth/providers/${encodeURIComponent(provider)}/configuration`, payload)
  },
  async oauthAccounts(query?: AdminOAuthAccountQuery) {
    const envelope = await api.getEnvelope<AdminOAuthAccount[]>(withQuery('/admin/auth/oauth/accounts', query))
    return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null }
  },
  async unlinkOAuthAccount(id: string) {
    return api.del<{ unlinked: true; account: AdminOAuthAccount }>(`/admin/auth/oauth/accounts/${encodeURIComponent(id)}`)
  },
  async oauthAuthorizationRequests(query?: AdminOAuthAuthorizationQuery) {
    const envelope = await api.getEnvelope<AdminOAuthAuthorizationRequest[]>(withQuery('/admin/auth/oauth/authorization-requests', query))
    return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null }
  },
  async revokeOAuthAuthorizationRequest(id: string, reasonCode: string) {
    return api.post<{ revoked: true; request: AdminOAuthAuthorizationRequest }>(`/admin/auth/oauth/authorization-requests/${encodeURIComponent(id)}/revoke`, { reasonCode })
  },
  async developerAccessControl() {
    return api.get<DeveloperAccessControl>('/admin/developer/access-control')
  },
  async updateDeveloperAccessControl(payload: Omit<DeveloperAccessControl, 'version' | 'reasonCode' | 'updatedAt'> & { expectedVersion: number; reasonCode: string }) {
    return api.put<DeveloperAccessControl>('/admin/developer/access-control', payload)
  },
  async developerServiceAccounts(query?: DeveloperServiceAccountQuery) {
    const envelope = await api.getEnvelope<DeveloperServiceAccount[]>(withQuery('/admin/developer/service-accounts', query))
    return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null }
  },
  async developerAccessMetrics() {
    return api.get<DeveloperAccessMetrics>('/admin/developer/metrics')
  },
  async developerApiV1Contract() {
    return api.get<DeveloperApiV1Contract>('/admin/developer/api-contract')
  },
  async exportDeveloperServiceAccounts(query?: DeveloperServiceAccountQuery) {
    return api.get<{ kind: 'developer-access.snapshot'; schemaVersion: 1; exportedAt: string; truncated: boolean; items: DeveloperServiceAccount[] }>(withQuery('/admin/developer/service-accounts/export', query))
  },
  async revokeDeveloperServiceAccount(id: string, payload: { expectedVersion: number; reasonCode: string }) {
    return api.post<DeveloperServiceAccount>(`/admin/developer/service-accounts/${encodeURIComponent(id)}/revoke`, payload)
  },
  async revokeDeveloperApiKey(accountId: string, keyId: string, payload: { expectedVersion: number; reasonCode: string }) {
    return api.post<DeveloperApiKeyCredential>(`/admin/developer/service-accounts/${encodeURIComponent(accountId)}/keys/${encodeURIComponent(keyId)}/revoke`, payload)
  },
  webhookControl() {
    return api.get<WebhookControl>('/admin/developer/webhooks/control')
  },
  updateWebhookControl(payload: Omit<WebhookControl, 'version' | 'reasonCode' | 'updatedAt' | 'secretEncryptionAvailable'> & { expectedVersion: number; reasonCode: string }) {
    return api.put<WebhookControl>('/admin/developer/webhooks/control', payload)
  },
  async webhooks(query?: WebhookSubscriptionQuery) {
    const envelope = await api.getEnvelope<WebhookSubscription[]>(withQuery('/admin/developer/webhooks', query))
    return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null }
  },
  disableWebhook(id: string, payload: { expectedVersion: number; reasonCode: string }) {
    return api.post<WebhookSubscription>(`/admin/developer/webhooks/${encodeURIComponent(id)}/disable`, payload)
  },
  async webhookDeliveries(query?: WebhookDeliveryQuery) {
    const envelope = await api.getEnvelope<WebhookDelivery[]>(withQuery('/admin/developer/webhook-deliveries', query))
    return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null }
  },
  replayWebhookDelivery(id: string, payload: { expectedVersion: number; reasonCode: string; idempotencyKey: string }) {
    return api.post<WebhookDelivery>(`/admin/developer/webhook-deliveries/${encodeURIComponent(id)}/replay`, payload)
  },
  webhookMetrics() {
    return api.get<WebhookMetrics>('/admin/developer/webhooks/metrics')
  },
  async authSessions(query?: AdminAuthSessionQuery) {
    const envelope = await api.getEnvelope<AdminAuthSession[]>(withQuery('/admin/auth/sessions', query))
    return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null }
  },
  async authMetrics(query?: { dateFrom?: string; dateTo?: string }) {
    return api.get<AdminAuthMetrics>(withQuery('/admin/auth/metrics', query))
  },
  async authFailures(query?: AdminAuthFailureQuery) {
    const envelope = await api.getEnvelope<AdminAuthFailure[]>(withQuery('/admin/auth/failures', query))
    return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null }
  },
  async authRiskPolicy() {
    return api.get<AdminAuthRiskPolicy>('/admin/auth/risk-policy')
  },
  async updateAuthRiskPolicy(payload: { enabled: boolean; windowSeconds: number; ipAccountThreshold: number; accountIpThreshold: number; expectedVersion: number; reasonCode: string }) {
    return api.put<AdminAuthRiskPolicy>('/admin/auth/risk-policy', payload)
  },
  async dispositionAuthSession(id: string, payload: { riskStatus: AdminAuthSession['riskStatus']; expectedVersion: number; reasonCode: string }) {
    return api.post<{ session: AdminAuthSession }>(`/admin/auth/sessions/${encodeURIComponent(id)}/disposition`, payload)
  },
  async revokeAuthSession(id: string, payload: { expectedVersion: number; reasonCode: string }) {
    return api.post<{ session: AdminAuthSession }>(`/admin/auth/sessions/${encodeURIComponent(id)}/revoke`, payload)
  },
  async revokeUserAuthSessions(userId: string, reasonCode: string) {
    return api.post<{ revoked: number }>(`/admin/auth/users/${encodeURIComponent(userId)}/sessions/revoke`, { reasonCode })
  },
  async riskCases(query?: RiskCaseQuery) {
    const envelope = await api.getEnvelope<RiskCase[]>(withQuery('/admin/risk/cases', query))
    return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null }
  },
  riskCase(id: string) {
    return api.get<RiskCase>(`/admin/risk/cases/${encodeURIComponent(id)}`)
  },
  riskPolicy() {
    return api.get<RiskPolicy>('/admin/risk/policy')
  },
  updateRiskPolicy(payload: Omit<RiskPolicy, 'id' | 'version' | 'updatedByRef' | 'createdAt' | 'updatedAt'> & { expectedVersion: number }) {
    return api.put<RiskPolicy>('/admin/risk/policy', payload)
  },
  transitionRiskCase(id: string, payload: { toStatus: RiskCaseStatus; disposition: RiskDisposition; riskLevel: RiskLevel; reasonCode: string; expectedVersion: number; restrictionSeconds?: number; appealDecision?: 'approved' | 'rejected' }) {
    return api.post<RiskCase>(`/admin/risk/cases/${encodeURIComponent(id)}/transitions`, payload)
  },
  riskMetrics(query?: { dateFrom?: string; dateTo?: string }) {
    return api.get<RiskMetrics>(withQuery('/admin/risk/metrics', query))
  },
  exportRiskCases(query?: RiskCaseQuery) {
    return api.get<{ generatedAt: string; truncated: boolean; filters: Record<string, unknown>; cases: RiskCase[] }>(withQuery('/admin/risk/cases/export', query))
  },
  async users(query?: AdminUserQuery) {
    const envelope = await api.getEnvelope<AdminUserDto[]>(withQuery('/admin/users', query))
    return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null }
  },
  async user(id: string) {
    return api.get<AdminUserDto>(`/admin/users/${encodeURIComponent(id)}`)
  },
  dataRightsRequests(query?: { status?: DataRightsStatus | null; requestType?: DataRightsRequestType | null; limit?: number }) {
    return api.get<DataRightsRequestDto[]>(withQuery('/admin/data-rights/requests', query))
  },
  dataRightsRequest(id: string) {
    return api.get<DataRightsRequestDto>(`/admin/data-rights/requests/${encodeURIComponent(id)}`)
  },
  dataRightsMetrics() {
    return api.get<DataRightsMetricsDto>('/admin/data-rights/metrics')
  },
  processDataRightsRequest(id: string, payload: { expectedVersion: number; reasonCode: string }) {
    return api.post<DataRightsRequestDto>(`/admin/data-rights/requests/${encodeURIComponent(id)}/process`, payload)
  },
  recordDataRightsBackupReceipt(id: string, payload: { backupClass: DataRightsBackupClass; objectRefHash: string; evidenceHash: string; expiredAt: string; verifiedByRef: string }) {
    return api.post<DataRightsRequestDto>(`/admin/data-rights/requests/${encodeURIComponent(id)}/backup-receipts`, payload)
  },
  async suspendUser(id: string, payload: { expectedVersion: number; reasonCode: string }) {
    return api.post<AdminUserStatusResult>(`/admin/users/${encodeURIComponent(id)}/suspend`, payload)
  },
  async restoreUser(id: string, payload: { expectedVersion: number; reasonCode: string }) {
    return api.post<AdminUserStatusResult>(`/admin/users/${encodeURIComponent(id)}/restore`, payload)
  },
  async userMetrics(query?: { dateFrom?: string | null; dateTo?: string | null }) {
    return api.get<AdminUserMetrics>(withQuery('/admin/users/metrics', query))
  },
  async exportUserMetrics(query?: { dateFrom?: string | null; dateTo?: string | null }) {
    return api.get<AdminUserMetricsExport>(withQuery('/admin/users/metrics/export', query))
  },
  async userTags(query?: { status?: 'active' | 'archived' | 'all'; search?: string | null }) {
    return api.get<AdminUserTag[]>(withQuery('/admin/user-tags', query))
  },
  async createUserTag(payload: { key: string; label: string; description?: string | null; color: AdminUserTagColor; reasonCode: string }) {
    return api.post<AdminUserTag>('/admin/user-tags', payload)
  },
  async updateUserTag(id: string, payload: { label: string; description?: string | null; color: AdminUserTagColor; expectedVersion: number; reasonCode: string }) {
    return api.put<AdminUserTag>(`/admin/user-tags/${encodeURIComponent(id)}`, payload)
  },
  async archiveUserTag(id: string, payload: { expectedVersion: number; reasonCode: string }) {
    return api.post<AdminUserTag>(`/admin/user-tags/${encodeURIComponent(id)}/archive`, payload)
  },
  async restoreUserTag(id: string, payload: { expectedVersion: number; reasonCode: string }) {
    return api.post<AdminUserTag>(`/admin/user-tags/${encodeURIComponent(id)}/restore`, payload)
  },
  async assignUserTag(userId: string, tagId: string, payload: { expectedUserVersion: number; reasonCode: string }) {
    return api.post<{ user: AdminUserDto }>(`/admin/users/${encodeURIComponent(userId)}/tags/${encodeURIComponent(tagId)}/assign`, payload)
  },
  async removeUserTag(userId: string, tagId: string, payload: { expectedUserVersion: number; reasonCode: string }) {
    return api.post<{ user: AdminUserDto }>(`/admin/users/${encodeURIComponent(userId)}/tags/${encodeURIComponent(tagId)}/remove`, payload)
  },
  async modelControlSummary() {
    return api.get<ModelControlSummaryDto>('/admin/model-control/summary')
  },
  async modelProviders(query?: ModelControlListQuery) {
    const envelope = await api.getEnvelope<ModelProviderDto[]>(withQuery('/admin/model-control/providers', query))
    return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null }
  },
  async createModelProvider(payload: { key: string; name: string; websiteUrl?: string | null; regions?: string[]; dataProcessingRegions?: string[] }) {
    return api.post<ModelProviderDto>('/admin/model-control/providers', payload)
  },
  async updateModelProvider(id: string, payload: { expectedVersion: number; name: string; websiteUrl?: string | null; regions?: string[]; dataProcessingRegions?: string[] }) {
    return api.patch<ModelProviderDto>(`/admin/model-control/providers/${encodeURIComponent(id)}`, payload)
  },
  async catalogModels(query?: ModelControlListQuery) {
    const envelope = await api.getEnvelope<ModelCatalogModelDto[]>(withQuery('/admin/model-control/models', query))
    return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null }
  },
  async createCatalogModel(payload: { providerId: string; key: string; name: string; family?: string | null }) {
    return api.post<ModelCatalogModelDto>('/admin/model-control/models', payload)
  },
  async createModelVersion(payload: { modelId: string; versionKey: string; releaseDate?: string | null; contextWindow?: number | null; maxOutputUnits?: number | null; parameterSchema?: Record<string, unknown> | null }) {
    return api.post<ModelVersionDto>('/admin/model-control/versions', payload)
  },
  async modelVersions(query?: ModelControlListQuery) {
    const envelope = await api.getEnvelope<ModelVersionDto[]>(withQuery('/admin/model-control/versions', query))
    return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null }
  },
  async modelVersion(id: string) {
    return api.get<ModelVersionDto>(`/admin/model-control/versions/${encodeURIComponent(id)}`)
  },
  async upsertModelCapability(id: string, payload: Omit<ModelCapabilityDto, 'id' | 'modelVersionId'>) {
    return api.put<ModelCapabilityDto>(`/admin/model-control/versions/${encodeURIComponent(id)}/capabilities`, payload)
  },
  async createModelDeployment(payload: { modelVersionId: string; key: string; environment: string; region: string; deploymentRef: string; adapterType?: string | null; providerModelId?: string | null; endpointUrl?: string | null; secretPurpose?: string | null; runtimeConfig?: Record<string, unknown> | null; runtimeEnabled?: boolean }) {
    return api.post<ModelDeploymentDto>('/admin/model-control/deployments', payload)
  },
  async modelDeployments(query?: ModelControlListQuery & { environment?: string | null }) {
    const envelope = await api.getEnvelope<ModelDeploymentDto[]>(withQuery('/admin/model-control/deployments', query))
    return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null }
  },
  async createPricingVersion(payload: { modelVersionId: string; modelDeploymentId?: string | null; versionKey: string; currency: string; unit: string; unitPriceMicros: number; effectiveFrom: string; effectiveTo?: string | null }) {
    return api.post<PricingVersionDto>('/admin/model-control/pricing', payload)
  },
  async transitionModelControl(type: 'provider' | 'model' | 'version' | 'deployment' | 'pricing', id: string, expectedVersion: number, status: ModelControlStatus, reasonCode: string) {
    const resource = type === 'pricing' ? 'pricing' : `${type}s`
    return api.post<ModelProviderDto | ModelCatalogModelDto | ModelVersionDto | ModelDeploymentDto | PricingVersionDto>(`/admin/model-control/${resource}/${encodeURIComponent(id)}/status`, { expectedVersion, status, reasonCode })
  },
  async exportModelControlCatalog() {
    return api.get<Record<string, unknown>>('/admin/model-control/export')
  },
  async modelRouteSummary() {
    return api.get<ModelRouteSummaryDto>('/admin/model-control/routing-summary')
  },
  async modelRoutePolicies(query?: ModelControlListQuery & { environment?: string | null; modality?: string | null }) {
    const envelope = await api.getEnvelope<ModelRoutePolicyDto[]>(withQuery('/admin/model-control/routing-policies', query))
    return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null }
  },
  async modelRoutePolicy(id: string) {
    return api.get<ModelRoutePolicyDto>(`/admin/model-control/routing-policies/${encodeURIComponent(id)}`)
  },
  async createModelRoutePolicy(payload: ModelRoutePolicyDraft & { key: string }) {
    return api.post<ModelRoutePolicyDto>('/admin/model-control/routing-policies', payload)
  },
  async updateModelRoutePolicy(id: string, expectedVersion: number, payload: ModelRoutePolicyDraft) {
    return api.patch<ModelRoutePolicyDto>(`/admin/model-control/routing-policies/${encodeURIComponent(id)}`, { expectedVersion, ...payload })
  },
  async replaceModelRouteTargets(id: string, expectedVersion: number, reasonCode: string, targets: Array<{ modelDeploymentId: string; role: 'primary' | 'backup'; priority: number; enabled: boolean }>) {
    return api.put<ModelRoutePolicyDto>(`/admin/model-control/routing-policies/${encodeURIComponent(id)}/targets`, { expectedVersion, reasonCode, targets })
  },
  async transitionModelRoutePolicy(id: string, expectedVersion: number, status: ModelControlStatus, reasonCode: string) {
    return api.post<ModelRoutePolicyDto>(`/admin/model-control/routing-policies/${encodeURIComponent(id)}/status`, { expectedVersion, status, reasonCode })
  },
  async modelRouteRevisions(id: string) {
    return api.get<ModelRouteRevisionDto[]>(`/admin/model-control/routing-policies/${encodeURIComponent(id)}/revisions`)
  },
  async rollbackModelRoutePolicy(id: string, expectedVersion: number, revisionNumber: number, reasonCode: string) {
    return api.post<ModelRoutePolicyDto>(`/admin/model-control/routing-policies/${encodeURIComponent(id)}/rollback`, { expectedVersion, revisionNumber, reasonCode })
  },
  async previewModelRoute(payload: { modality: ModelCapabilityModality; operation: string; environment: ModelDeploymentEnvironment; region?: string | null; subjectKey: string; role: string }) {
    return api.post<ModelRoutePreviewResult>('/admin/model-control/route-preview', payload)
  },
  async exportModelRouting() {
    return api.get<Record<string, unknown>>('/admin/model-control/routing-export')
  },
  async modelRouteDecisions(query?: ModelRouteDecisionListQuery) {
    const envelope = await api.getEnvelope<ModelRouteDecisionDto[]>(withQuery('/admin/model-control/route-decisions', query))
    return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null }
  },
  async providerSecretRefs(query?: ProviderSecretRefListQuery) {
    const envelope = await api.getEnvelope<ProviderSecretRefDto[]>(withQuery('/admin/model-control/secret-refs', query))
    return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null }
  },
  async createProviderSecretRef(payload: ProviderSecretRefRequest) {
    return api.post<ProviderSecretRefDto>('/admin/model-control/secret-refs', payload)
  },
  async modelPromotions(query?: ModelPromotionListQuery) {
    const envelope = await api.getEnvelope<ModelPromotionDto[]>(withQuery('/admin/model-control/promotions', query))
    return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null }
  },
  async requestModelPromotion(payload: ModelPromotionRequest) {
    return api.post<ModelPromotionDto>('/admin/model-control/promotions', payload)
  },
  async exportModelGovernance() {
    return api.get<Record<string, unknown>>('/admin/model-control/governance-export')
  },
  async modelGovernanceSummary() {
    return api.get<ModelGovernanceSummaryDto>('/admin/model-control/governance-summary')
  },
  async evaluationSuites() {
    const envelope = await api.getEnvelope<AiEvaluationSuiteDto[]>('/admin/model-control/evaluation-suites?limit=100')
    return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null }
  },
  async createEvaluationSuite(payload: AiEvaluationSuiteRequest) {
    return api.post<AiEvaluationSuiteDto>('/admin/model-control/evaluation-suites', payload)
  },
  async evaluationPolicies() {
    const envelope = await api.getEnvelope<AiEvaluationPolicyDto[]>('/admin/model-control/evaluation-policies?limit=100')
    return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null }
  },
  async createEvaluationPolicy(payload: AiEvaluationPolicyRequest) {
    return api.post<AiEvaluationPolicyDto>('/admin/model-control/evaluation-policies', payload)
  },
  async evaluationRuns() {
    const envelope = await api.getEnvelope<AiEvaluationRunDto[]>('/admin/model-control/evaluation-runs?limit=100')
    return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null }
  },
  async createEvaluationRun(payload: AiEvaluationRunRequest) {
    return api.post<AiEvaluationRunDto>('/admin/model-control/evaluation-runs', payload)
  },
  async evaluationSummary() {
    return api.get<AiEvaluationSummaryDto>('/admin/model-control/evaluation-summary')
  },
  async exportEvaluations() {
    return api.get<Record<string, unknown>>('/admin/model-control/evaluation-export')
  },
  async providerLegalReviews() {
    const envelope = await api.getEnvelope<ProviderLegalReviewDto[]>('/admin/model-control/provider-legal-reviews?limit=100')
    return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null }
  },
  async createProviderLegalReview(payload: ProviderLegalReviewRequest) {
    return api.post<ProviderLegalReviewDto>('/admin/model-control/provider-legal-reviews', payload)
  },
  async providerLegalSummary() {
    return api.get<ProviderLegalSummaryDto>('/admin/model-control/provider-legal-summary')
  },
  async exportProviderLegalReviews() {
    return api.get<Record<string, unknown>>('/admin/model-control/provider-legal-export')
  },
  async providerOperationalPolicies() {
    const envelope = await api.getEnvelope<ProviderOperationalPolicyDto[]>('/admin/model-control/provider-operations?limit=100')
    return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null }
  },
  async createProviderOperationalPolicy(payload: ProviderOperationalPolicyRequest) {
    return api.post<ProviderOperationalPolicyDto>('/admin/model-control/provider-operations', payload)
  },
  async transitionProviderOperationalPolicy(id: string, expectedVersion: number, status: 'active' | 'disabled', reasonCode: string) {
    return api.post<ProviderOperationalPolicyDto>(`/admin/model-control/provider-operations/${encodeURIComponent(id)}/status`, { expectedVersion, status, reasonCode })
  },
  async recordProviderHealth(id: string, payload: { sourceKey: string; status: ProviderHealthEvidenceDto['status']; checkedAt: string; latencyMs?: number | null; successRateBps?: number | null; sourceType: ProviderHealthEvidenceDto['sourceType']; sourceRef: string; details?: Record<string, unknown> | null }) {
    return api.post<ProviderHealthEvidenceDto>(`/admin/model-control/provider-operations/${encodeURIComponent(id)}/health`, payload)
  },
  async providerOperationsSummary() {
    return api.get<ProviderOperationsSummaryDto>('/admin/model-control/provider-operations-summary')
  },
  async exportProviderOperations() {
    return api.get<Record<string, unknown>>('/admin/model-control/provider-operations-export')
  },
  async configResources(kind: ConfigResourceKind, query?: ConfigResourceListQuery) {
    const envelope = await api.getEnvelope<ConfigResourceDto[]>(withQuery(`/admin/config-resources/${kind}`, query))
    return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null }
  },
  async createConfigResource(kind: ConfigResourceKind, payload: ConfigResourceDraftRequest) {
    return api.post<ConfigResourceDto>(`/admin/config-resources/${kind}`, payload)
  },
  async updateConfigResource(kind: ConfigResourceKind, id: string, payload: ConfigResourceDraftRequest) {
    return api.patch<ConfigResourceDto>(`/admin/config-resources/${kind}/${encodeURIComponent(id)}`, payload)
  },
  async publishConfigResource(kind: ConfigResourceKind, id: string, payload: ConfigResourceTransitionRequest) {
    return api.post<ConfigResourcePublishResult>(`/admin/config-resources/${kind}/${encodeURIComponent(id)}/publish`, payload)
  },
  async configResourceHistory(kind: ConfigResourceKind, id: string, query?: Pick<ConfigResourceListQuery, 'cursor' | 'limit'>) {
    const envelope = await api.getEnvelope<ConfigResourceRevisionDto[]>(withQuery(`/admin/config-resources/${kind}/${encodeURIComponent(id)}/history`, query))
    return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null }
  },
  async rollbackConfigResource(kind: ConfigResourceKind, id: string, revisionId: string, payload: ConfigResourceTransitionRequest) {
    return api.post<ConfigResourcePublishResult>(`/admin/config-resources/${kind}/${encodeURIComponent(id)}/rollback`, { revisionId, ...payload })
  },
  async deleteConfigResource(kind: ConfigResourceKind, id: string, payload: ConfigResourceTransitionRequest) {
    return apiRequest<ConfigResourceDto>(`/admin/config-resources/${kind}/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify(payload) })
  },
  async restoreConfigResource(kind: ConfigResourceKind, id: string, payload: ConfigResourceTransitionRequest) {
    return api.post<ConfigResourceDto>(`/admin/config-resources/${kind}/${encodeURIComponent(id)}/restore`, payload)
  },
  async bulkDeleteConfigResources(kind: ConfigResourceKind, items: Array<{ id: string; expectedVersion: number }>, reasonCode: string) {
    return api.post<ConfigResourceDto[]>(`/admin/config-resources/${kind}/bulk-delete`, { items, reasonCode })
  },
  async exportConfigResources(kind: ConfigResourceKind) {
    return api.get<ConfigResourceExportDocument>(`/admin/config-resources/${kind}/export`)
  },
  async importConfigResources(kind: ConfigResourceKind, items: ConfigResourceExportDocument['items'], reasonCode: string) {
    return api.post<ConfigResourceDto[]>(`/admin/config-resources/${kind}/import`, { items, reasonCode })
  },
  async previewFeatureFlag(id: string, context: { environment: string; userId: string; roles: string[] }) {
    return api.post<FeatureFlagEvaluation>(`/admin/config-resources/feature_flag/${encodeURIComponent(id)}/preview`, context)
  },
  async setFeatureFlagEmergency(id: string, emergencyOff: boolean, payload: ConfigResourceTransitionRequest) {
    return api.post<FeatureFlagEmergencyResult>(`/admin/config-resources/feature_flag/${encodeURIComponent(id)}/${emergencyOff ? 'emergency-off' : 'emergency-restore'}`, payload)
  },
  async systemSettings(query?: SystemSettingListQuery) {
    const envelope = await api.getEnvelope<SystemSettingDto[]>(withQuery('/admin/settings', query))
    return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null }
  },
  async systemSetting(key: string) {
    return api.get<SystemSettingDto>(`/admin/settings/${encodeURIComponent(key)}`)
  },
  async systemSettingChanges(query?: SystemSettingListQuery) {
    const envelope = await api.getEnvelope<SystemSettingChangeDto[]>(withQuery('/admin/settings/changes', query))
    return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null }
  },
  async systemSettingHistory(key: string, query?: Pick<SystemSettingListQuery, 'cursor' | 'limit'>) {
    const envelope = await api.getEnvelope<SystemSettingRevisionDto[]>(withQuery(`/admin/settings/${encodeURIComponent(key)}/history`, query))
    return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null }
  },
  async previewSystemSetting(key: string, value: Record<string, unknown>) {
    return api.post<SystemSettingPreviewDto>(`/admin/settings/${encodeURIComponent(key)}/preview`, { value })
  },
  async requestSystemSettingChange(key: string, payload: SystemSettingChangeRequest) {
    return api.post<SystemSettingChangeDto>(`/admin/settings/${encodeURIComponent(key)}/changes`, payload)
  },
  async requestSystemSettingRollback(key: string, revisionId: string, payload: Omit<SystemSettingChangeRequest, 'value'>) {
    return api.post<SystemSettingChangeDto>(`/admin/settings/${encodeURIComponent(key)}/rollback-requests`, { revisionId, ...payload })
  },
  async transitionSystemSettingChange(id: string, action: 'approve' | 'reject', payload: SystemSettingTransitionRequest) {
    return api.post<SystemSettingChangeDto>(`/admin/settings/changes/${id}/${action}`, payload)
  },
  async publishSystemSettingChange(id: string, payload: SystemSettingTransitionRequest) {
    return api.post<SystemSettingPublishResult>(`/admin/settings/changes/${id}/publish`, payload)
  },
  async releaseChanges(query?: ReleaseChangeListQuery) {
    const envelope = await api.getEnvelope<ReleaseChangeDto[]>(withQuery('/admin/releases', query))
    return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null }
  },
  async requestReleaseChange(payload: ReleaseChangeRequest) {
    return api.post<ReleaseChangeDto>('/admin/releases', payload)
  },
  async approveReleaseChange(id: string, reasonCode: string, note = '') {
    return api.post<ReleaseChangeDto>(`/admin/releases/${id}/approve`, { reasonCode, note })
  },
  async rejectReleaseChange(id: string, reasonCode: string, note = '') {
    return api.post<ReleaseChangeDto>(`/admin/releases/${id}/reject`, { reasonCode, note })
  },
  async applyReleaseChange(id: string, body: { outcome: 'deployed' | 'failed'; deploymentId: string; evidenceUrl: string; reasonCode: string; note?: string }) {
    return api.post<ReleaseChangeDto>(`/admin/releases/${id}/apply`, body)
  },
  async rollbackReleaseChange(id: string, body: { deploymentId: string; evidenceUrl: string; reasonCode: string; note?: string }) {
    return api.post<ReleaseChangeDto>(`/admin/releases/${id}/rollback`, body)
  },
  async overview(windowMinutes = 60) {
    return api.get<AdminOperationsOverviewDto>(withQuery('/admin/overview', { windowMinutes }))
  },
  async globalSearch(query: AdminGlobalSearchQuery): Promise<AdminGlobalSearchPage> {
    const envelope = await api.getEnvelope<AdminGlobalSearchResultDto[]>(withQuery('/admin/search', {
      q: query.q,
      types: query.types?.join(',') ?? null,
      limit: query.limit ?? 20,
      cursor: query.cursor ?? null,
    }))
    return {
      items: envelope.data,
      nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null,
    }
  },
  async permissions() {
    return api.get<AdminPermissionDto[]>('/admin/permissions')
  },
  async roles() {
    return api.get<AdminRolePermissionDto[]>('/admin/roles')
  },
  async updateRolePermissions(role: Role, permissions: Permission[]) {
    const body: UpdateRolePermissionsRequest = { permissions }
    return api.put<AdminRolePermissionDto>(`/admin/roles/${role}/permissions`, body)
  },
  async supportTickets(query?: AdminSupportTicketQuery): Promise<AdminSupportTicketPage> {
    const envelope = await api.getEnvelope<ApiSupportRequest[]>(withQuery('/admin/support/tickets', query))
    return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null }
  },
  async supportTicket(id: string) {
    return api.get<ApiSupportRequest>(`/admin/support/tickets/${encodeURIComponent(id)}`)
  },
  async updateSupportTicket(id: string, payload: AdminSupportTicketUpdate) {
    return api.patch<ApiSupportRequest>(`/admin/support/tickets/${encodeURIComponent(id)}`, payload)
  },
  async addSupportMessage(id: string, payload: { message: string; expectedVersion: number; reasonCode: string }) {
    return api.post<ApiSupportRequest>(`/admin/support/tickets/${encodeURIComponent(id)}/messages`, payload)
  },
  async linkSupportCase(id: string, payload: { caseType: 'admin_review' | 'moderation_case'; caseId: string; expectedVersion: number; reasonCode: string }) {
    return api.post<ApiSupportRequest>(`/admin/support/tickets/${encodeURIComponent(id)}/case-links`, payload)
  },
  async supportMetrics() {
    return api.get<AdminSupportMetrics>('/admin/support/metrics')
  },
  async reviews(query?: AdminReviewListQuery) {
    return api.get<AdminReviewQueueItemDto[]>(withQuery('/admin/reviews', query))
  },
  async reviewQueueItem(id: string, decision: AdminReviewDecision, note?: string) {
    const body: AdminReviewActionRequest = { decision, note }
    return api.post<AdminReviewQueueItemDto>(`/admin/reviews/${id}/actions`, body)
  },
  async audit(query?: AdminAuditListQuery) {
    return api.get<AuditEventDto[]>(withQuery('/admin/audit', query))
  },
  async auditEvent(id: string) {
    return api.get<AuditEventDto>(`/admin/audit/${id}`)
  },
  async accountingReconciliation(query?: AdminAccountingReconciliationQuery): Promise<AdminAccountingReconciliationPage> {
    const envelope = await api.getEnvelope<AdminAccountingIssueDto[]>(withQuery('/admin/accounting/reconciliation', query))
    const meta = envelope.meta as (ApiPaginationMeta & {
      summary?: AdminAccountingIssueSummary
      generatedAt?: string
    }) | undefined
    return {
      items: envelope.data,
      summary: meta?.summary ?? { total: 0, open: 0, repairPending: 0, resolved: 0, ignored: 0 },
      generatedAt: meta?.generatedAt ?? '',
      nextCursor: meta?.pagination?.nextCursor ?? null,
    }
  },
  async scanAccountingReconciliation(query?: AdminAccountingReconciliationQuery): Promise<AdminAccountingReconciliationPage> {
    const envelope = await apiEnvelope<AdminAccountingIssueDto[]>(withQuery('/admin/accounting/reconciliation/scan', query), { method: 'POST' })
    const meta = envelope.meta as (ApiPaginationMeta & {
      summary?: AdminAccountingIssueSummary
      generatedAt?: string
    }) | undefined
    return {
      items: envelope.data,
      summary: meta?.summary ?? { total: 0, open: 0, repairPending: 0, resolved: 0, ignored: 0 },
      generatedAt: meta?.generatedAt ?? '',
      nextCursor: meta?.pagination?.nextCursor ?? null,
    }
  },
  async accountingIssue(id: string) {
    return api.get<AdminAccountingIssueDto>(`/admin/accounting/reconciliation/${id}`)
  },
  async exportAccountingReconciliationJson(query?: AdminAccountingReconciliationQuery) {
    return api.text(withQuery('/admin/accounting/reconciliation/export', query))
  },
  async requestAccountingRepair(id: string, payload: AdminAccountingRepairRequest) {
    return api.post<AdminAccountingRepairResponse>(`/admin/accounting/reconciliation/${id}/repair-requests`, payload)
  },
  async billingPolicies() {
    return api.get<AdminBillingPolicyInventory>('/admin/accounting/policies')
  },
  async previewBillingPointPolicy(payload: PointAdjustmentPolicy) {
    return api.post<AdminBillingPolicyPreview>('/admin/accounting/policies/point-adjustment/preview', payload)
  },
  async billingMetrics(query?: AdminBillingMetricsQuery) {
    return api.get<AdminBillingMetrics>(withQuery('/admin/accounting/business-metrics', query))
  },
  async exportBillingMetrics(query?: AdminBillingMetricsQuery) {
    return api.get<{ kind: 'accounting.business-metrics.snapshot'; metrics: AdminBillingMetrics }>(withQuery('/admin/accounting/business-metrics/export', query))
  },
  async creativeGenerations(query?: AdminCreativeGenerationHistoryQuery): Promise<AdminCreativeGenerationHistoryPage> {
    const envelope = await api.getEnvelope<ApiCreativeGenerationRecord[]>(withQuery('/admin/creative/generations', query))
    return {
      items: envelope.data,
      nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null,
    }
  },
  async creativeGeneration(id: string) {
    return api.get<AdminCreativeGenerationHistoryPage['items'][number]>(`/admin/creative/generations/${id}`)
  },
  async creativeGenerationSummary(query?: AdminCreativeGenerationHistoryQuery) {
    return api.get<AdminCreativeGenerationSummary>(withQuery('/admin/creative/generations/summary', query))
  },
  async creativeGenerationBusinessMetrics(query?: AdminCreativeGenerationHistoryQuery) {
    return api.get<AdminGenerationBusinessMetrics>(withQuery('/admin/creative/generations/business-metrics', query))
  },
  async exportCreativeGenerationBusinessMetrics(query?: AdminCreativeGenerationHistoryQuery, format: 'json' | 'csv' = 'csv') {
    return api.text(withQuery('/admin/creative/generations/business-metrics/export', { ...query, format }))
  },
  async exportCreativeGenerations(query?: AdminCreativeGenerationHistoryQuery, format: 'json' | 'csv' = 'csv') {
    return api.text(withQuery('/admin/creative/generations/export', { ...query, format, limit: 100 }))
  },
  async previewCreativeGenerationBulkAction(action: AdminCreativeGenerationBulkAction, targetIds: string[]) {
    return api.post<AdminCreativeGenerationBulkPreview>('/admin/creative/generations/bulk-preview', { action, targetIds })
  },
  async executeCreativeGenerationBulkAction(body: {
    action: AdminCreativeGenerationBulkAction
    targetIds: string[]
    targetHash: string
    confirmationText: string
    idempotencyKey: string
    reasonCode?: string
    note?: string
  }) {
    return api.post<AdminCreativeGenerationBulkResult>('/admin/creative/generations/bulk-actions', body)
  },
  async creativeGenerationExecutions(status = 'recovery_required') {
    const envelope = await api.getEnvelope<AdminCreativeGenerationExecution[]>(withQuery('/admin/creative/executions', { status, limit: 50 }))
    return envelope.data
  },
  async recoverCreativeGenerationExecution(id: string, reasonCode: string, errorCode: string) {
    return api.post<AdminCreativeGenerationExecution>(`/admin/creative/executions/${id}/recover`, { reasonCode, errorCode })
  },
  async providerControls(providerId?: string | null) {
    return api.get<AdminProviderControlBundle>(withQuery('/admin/creative/provider-controls', { providerId: providerId ?? null }))
  },
  async disableProviderControl(resourceId: string, expectedVersion: number, reasonCode: string) {
    return api.post<{ changed: boolean; control: AdminProviderControlBundle['controls'][number] }>(
      '/admin/creative/provider-controls/disable',
      { resourceId, expectedVersion, reasonCode },
    )
  },
  async requestProviderControlRecovery(
    resourceId: string,
    target: AdminProviderControlRecoveryTarget,
    expectedVersion: number,
    reasonCode: string,
  ) {
    return api.post<{ duplicate: boolean; review: AdminReviewQueueItemDto }>(
      '/admin/creative/provider-controls/recovery-requests',
      { resourceId, target, expectedVersion, reasonCode },
    )
  },
  async cancelCreativeGeneration(id: string, body: CreativeGenerationMutationRequest) {
    return api.post<ApiCreativeGenerationMutationResponse>(`/admin/creative/generations/${id}/cancel`, body)
  },
  async requestCreativeGenerationRetry(id: string, body: CreativeGenerationMutationRequest) {
    return api.post<ApiCreativeGenerationMutationResponse>(`/admin/creative/generations/${id}/retry-requests`, body)
  },
  async requestCreativeGenerationManualReplay(id: string, body: AdminManualReplayRequest) {
    return api.post<ApiCreativeGenerationMutationResponse>(`/admin/creative/generations/${id}/manual-replay-requests`, body)
  },
  async exportAuditJson(query?: AdminAuditListQuery) {
    return api.text(withQuery('/admin/audit/export', query))
  },
  async verifyAuditIntegrity() {
    return api.get<AdminAuditIntegrityDto>('/admin/audit/verify')
  },
  async auditArchives() {
    return api.get<AdminAuditArchiveManifestDto[]>('/admin/audit/archives')
  },
  async archiveAudit(objectRef?: string | null) {
    return api.post<AdminAuditArchiveResultDto>('/admin/audit/archives', objectRef ? { objectRef } : {})
  },
  async auditRetentionStatus() {
    return api.get<AdminAuditRetentionStatusDto>('/admin/audit/retention')
  },
  async previewAuditRetention() {
    return api.post<AdminAuditRetentionPreviewDto>('/admin/audit/retention/preview', {})
  },
  async executeAuditRetention(previewId: string, confirmation: string) {
    return api.post<AdminAuditRetentionResultDto>('/admin/audit/retention/execute', { previewId, confirmation })
  },
  async securityEvents(query?: AdminSecurityEventListQuery) {
    const envelope = await api.getEnvelope<AdminSecurityEventDto[]>(withQuery('/admin/security/events', query))
    return {
      events: envelope.data,
      nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null,
    }
  },
  async securityAlerts() {
    return api.get<AdminSecurityAlertDto[]>('/admin/security/alerts')
  },
  async securityAlertEvents(id: string) {
    return api.get<AdminSecurityAlertEventDto[]>(`/admin/security/alerts/${id}/events`)
  },
  async exportSecurityAlertJson(id: string) {
    return api.text(`/admin/security/alerts/${id}/export`)
  },
  async acknowledgeSecurityAlert(id: string, note = '') {
    return api.post<AdminSecurityAlertDto>(`/admin/security/alerts/${id}/acknowledge`, { note })
  },
  async silenceSecurityAlert(id: string, until: string, note = '') {
    return api.post<AdminSecurityAlertDto>(`/admin/security/alerts/${id}/silence`, { until, note })
  },
  async unsilenceSecurityAlert(id: string, note = '') {
    return api.post<AdminSecurityAlertDto>(`/admin/security/alerts/${id}/unsilence`, { note })
  },
  async operationsMetrics(windowMinutes = 60) {
    return api.get<AdminOperationsMetricsDto>(withQuery('/admin/operations/metrics', { windowMinutes }))
  },
  async exportOperationsMetricsJson(windowMinutes = 60) {
    return api.text(withQuery('/admin/operations/metrics/export', { windowMinutes }))
  },
  async pointLedger(query?: PointsLedgerQuery) {
    const envelope = await api.getEnvelope<ApiLedgerEntry[]>(withQuery('/admin/points/ledger', query))
    return {
      entries: envelope.data,
      summary: (envelope.meta as { summary?: ApiPointsSummary } | undefined)?.summary ?? null,
    }
  },
  async personalBillingSummary(userHandle: string) {
    return api.get<PersonalBillingSummary>(`/admin/billing/users/${encodeURIComponent(userHandle)}/summary`)
  },
  async personalBillingLedger(userHandle: string, query?: PersonalBillingQuery) {
    const envelope = await api.getEnvelope<PersonalBillingEntry[]>(withQuery(`/admin/billing/users/${encodeURIComponent(userHandle)}/ledger`, query))
    return {
      items: envelope.data,
      nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null,
    }
  },
  async exportPersonalBillingCsv(userHandle: string, query?: PersonalBillingQuery) {
    return api.text(withQuery(`/admin/billing/users/${encodeURIComponent(userHandle)}/ledger/export`, { ...query, format: 'csv' }))
  },
  async adjustPoints(payload: AdminPointAdjustmentRequest) {
    return api.post<AdminPointAdjustmentResponse>('/admin/points/adjustments', payload)
  },
  async pointPolicy() {
    return api.get<PointAdjustmentPolicy>('/admin/points/policy')
  },
  async updatePointPolicy(payload: PointAdjustmentPolicy) {
    return api.put<PointAdjustmentPolicy>('/admin/points/policy', payload)
  },
  async pointPolicyHistory() {
    return api.get<PointAdjustmentPolicyHistoryItem[]>('/admin/points/policy/history?limit=5')
  },
  async rollbackPointPolicy(eventId: string) {
    return api.post<PointAdjustmentPolicy>('/admin/points/policy/rollback', { eventId })
  },
  async observabilityLogs(query?: AdminObservabilityQuery): Promise<AdminObservabilityLogPage> {
    const envelope = await api.getEnvelope<AdminObservabilityLogDto[]>(withQuery('/admin/observability/logs', query))
    return {
      items: envelope.data,
      nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null,
    }
  },
  async observabilityLog(id: string) {
    return api.get<AdminObservabilityLogDto>(`/admin/observability/logs/${id}`)
  },
  async observabilityTrace(traceId: string) {
    return api.get<AdminTraceDto>(`/admin/observability/traces/${traceId}`)
  },
  async observabilitySlos() {
    return api.get<AdminSloSummaryDto>('/admin/observability/slos')
  },
  async evaluateObservabilitySlos() {
    return api.post<AdminSloSummaryDto>('/admin/observability/slos/evaluate')
  },
  async observabilityAlerts() {
    return api.get<AdminObservabilityAlertDto[]>('/admin/observability/alerts')
  },
  async observabilityAlert(id: string) {
    return api.get<AdminObservabilityAlertDetailDto>(`/admin/observability/alerts/${encodeURIComponent(id)}`)
  },
  async observabilitySloControls() {
    return api.get<AdminObservabilitySloControlDto[]>('/admin/observability/slo-controls')
  },
  async updateObservabilitySloControl(sloId: string, body: Omit<AdminObservabilitySloControlDto, 'id' | 'sloId' | 'reasonCode' | 'updatedBy' | 'createdAt' | 'updatedAt'> & { expectedVersion: number; reasonCode: string }) {
    return api.put<AdminObservabilitySloControlDto>(`/admin/observability/slo-controls/${encodeURIComponent(sloId)}`, body)
  },
  async observabilityIncidentMetrics() {
    return api.get<AdminObservabilityIncidentMetricsDto>('/admin/observability/incidents/metrics')
  },
  async transitionObservabilityAlert(
    id: string,
    action: 'acknowledge' | 'silence' | 'resolve',
    body: { expectedVersion: number; note?: string; until?: string },
  ) {
    return api.post<AdminObservabilityAlertDto>(`/admin/observability/alerts/${id}/${action}`, body)
  },
  async escalateObservabilityAlert(id: string, body: { expectedVersion: number; reasonCode: string }) {
    return api.post<AdminObservabilityAlertDto>(`/admin/observability/alerts/${encodeURIComponent(id)}/escalate`, body)
  },
  async reviewObservabilityIncident(id: string, body: { expectedVersion: number; summary: string; rootCause: string; impact: string; correctiveActions: string[]; reasonCode: string }) {
    return api.post<{ alert: AdminObservabilityAlertDto; review: AdminObservabilityIncidentReviewDto }>(`/admin/observability/alerts/${encodeURIComponent(id)}/review`, body)
  },
  async exportObservabilityLogs(query?: AdminObservabilityQuery) {
    return api.text(withQuery('/admin/observability/logs/export', { ...query, cursor: null, limit: 1000 }))
  },
  async exportPointLedgerCsv(query?: PointsLedgerQuery) {
    return api.text(withQuery('/admin/points/ledger.csv', query))
  },
  async notificationTemplates(query?: NotificationTemplateListQuery) {
    const envelope = await api.getEnvelope<NotificationTemplate[]>(withQuery('/admin/notifications/templates', query))
    return {
      items: envelope.data,
      nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null,
    }
  },
  async notificationTemplate(id: string) {
    return api.get<NotificationTemplate>(`/admin/notifications/templates/${id}`)
  },
  async notificationTemplateMetrics() {
    return api.get<NotificationTemplateMetrics>('/admin/notifications/templates/metrics')
  },
  async createNotificationTemplate(payload: NotificationTemplateDraft & { key: string }) {
    return api.post<NotificationTemplate>('/admin/notifications/templates', payload)
  },
  async updateNotificationTemplate(id: string, payload: NotificationTemplateDraft & { expectedVersion: number }) {
    return api.patch<NotificationTemplate>(`/admin/notifications/templates/${id}`, payload)
  },
  async previewNotificationTemplate(id: string, versionNumber: number, variables: Record<string, unknown>) {
    return api.post<{ templateKey: string; templateVersion: number; title: string; body: string }>(`/admin/notifications/templates/${id}/preview`, { versionNumber, variables })
  },
  async publishNotificationTemplate(id: string, payload: { expectedVersion: number; versionNumber?: number; reasonCode: string }) {
    return api.post<NotificationTemplate>(`/admin/notifications/templates/${id}/publish`, payload)
  },
  async rollbackNotificationTemplate(id: string, payload: { expectedVersion: number; versionNumber: number; reasonCode: string }) {
    return api.post<NotificationTemplate>(`/admin/notifications/templates/${id}/rollback`, payload)
  },
  async archiveNotificationTemplate(id: string, payload: { expectedVersion: number; reasonCode: string }) {
    return api.del<NotificationTemplate>(`/admin/notifications/templates/${id}`, { body: JSON.stringify(payload) })
  },
  async restoreNotificationTemplate(id: string, payload: { expectedVersion: number; reasonCode: string }) {
    return api.post<NotificationTemplate>(`/admin/notifications/templates/${id}/restore`, payload)
  },
  async sendNotificationTemplateTest(id: string, variables: Record<string, unknown>) {
    return api.post<ApiNotification>(`/admin/notifications/templates/${id}/send-test`, { variables })
  },
  async exportNotificationTemplates(query?: NotificationTemplateListQuery) {
    return api.text(withQuery('/admin/notifications/templates/export', { ...query, cursor: null, limit: 100, format: 'csv' }))
  },
  async notificationDeliveries(query?: NotificationDeliveryListQuery) {
    const envelope = await api.getEnvelope<NotificationDelivery[]>(withQuery('/admin/notifications/deliveries', query))
    return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null }
  },
  async notificationDelivery(id: string) {
    return api.get<NotificationDelivery>(`/admin/notifications/deliveries/${encodeURIComponent(id)}`)
  },
  async notificationDeliveryMetrics(query?: NotificationDeliveryMetricsQuery) {
    return api.get<NotificationDeliveryMetrics>(withQuery('/admin/notifications/deliveries/metrics', query))
  },
  async exportNotificationDeliveryMetrics(query?: NotificationDeliveryMetricsQuery) {
    return api.text(withQuery('/admin/notifications/deliveries/metrics/export', { ...query, format: 'csv' }))
  },
  async notificationChannelConfigs() {
    return api.get<NotificationChannelConfig[]>('/admin/notifications/channels')
  },
  async notificationChannelConfigHistory(channel: NotificationChannelConfig['channel']) {
    return api.get<NotificationChannelConfigRevision[]>(`/admin/notifications/channels/${encodeURIComponent(channel)}/history`)
  },
  async updateNotificationChannelConfig(channel: NotificationChannelConfig['channel'], payload: Pick<NotificationChannelConfig, 'enabled' | 'deliveryRateTargetBps' | 'failureRateAlertThresholdBps' | 'latencyTargetMs' | 'maxAttempts' | 'retryBackoffSeconds'> & { expectedVersion: number; reasonCode: string }) {
    return api.put<NotificationChannelConfig>(`/admin/notifications/channels/${encodeURIComponent(channel)}`, payload)
  },
  async rollbackNotificationChannelConfig(channel: NotificationChannelConfig['channel'], payload: { revisionNumber: number; expectedVersion: number; reasonCode: string }) {
    return api.post<NotificationChannelConfig>(`/admin/notifications/channels/${encodeURIComponent(channel)}/rollback`, payload)
  },
  async retryNotificationDelivery(id: string, payload: { expectedVersion: number; reasonCode: string }) {
    return api.post<NotificationDelivery>(`/admin/notifications/deliveries/${encodeURIComponent(id)}/retry`, payload)
  },
  async cancelNotificationDelivery(id: string, payload: { expectedVersion: number; reasonCode: string }) {
    return api.post<NotificationDelivery>(`/admin/notifications/deliveries/${encodeURIComponent(id)}/cancel`, payload)
  },
  async exportNotificationDeliveries(query?: NotificationDeliveryListQuery) {
    return api.text(withQuery('/admin/notifications/deliveries/export', { ...query, cursor: null, limit: 100, format: 'csv' }))
  },
}
