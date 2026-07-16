import { api, apiEnvelope, apiRequest, withQuery } from './apiClient'
import type {
  AdminAuditListQuery,
  AdminAuditArchiveManifestDto,
  AdminAuditArchiveResultDto,
  AdminAuditIntegrityDto,
  AdminAccountingReconciliationPage,
  AdminAccountingReconciliationQuery,
  AdminAccountingIssueDto,
  AdminAccountingIssueSummary,
  AdminAccountingRepairRequest,
  AdminAccountingRepairResponse,
  AdminCreativeGenerationHistoryPage,
  AdminCreativeGenerationHistoryQuery,
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
  ApiCreativeGenerationRecord,
  ApiCreativeGenerationMutationResponse,
  AdminManualReplayRequest,
  CreativeGenerationMutationRequest,
  ApiPointsSummary,
  ApiPaginationMeta,
  PointAdjustmentPolicyHistoryItem,
  PointAdjustmentPolicy,
  PointsLedgerQuery,
  AuditEventDto,
  UpdateRolePermissionsRequest,
  ReleaseChangeDto,
  ReleaseChangeListQuery,
  ReleaseChangeRequest,
  AdminObservabilityAlertDto,
  AdminObservabilityLogDto,
  AdminObservabilityLogPage,
  AdminObservabilityQuery,
  AdminSloSummaryDto,
  AdminTraceDto,
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
} from './contracts'
import type { Permission, Role } from '../domain/types'

export const adminService = {
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
  async transitionObservabilityAlert(
    id: string,
    action: 'acknowledge' | 'silence' | 'resolve',
    body: { expectedVersion: number; note?: string; until?: string },
  ) {
    return api.post<AdminObservabilityAlertDto>(`/admin/observability/alerts/${id}/${action}`, body)
  },
  async exportObservabilityLogs(query?: AdminObservabilityQuery) {
    return api.text(withQuery('/admin/observability/logs/export', { ...query, cursor: null, limit: 1000 }))
  },
  async exportPointLedgerCsv(query?: PointsLedgerQuery) {
    return api.text(withQuery('/admin/points/ledger.csv', query))
  },
}
