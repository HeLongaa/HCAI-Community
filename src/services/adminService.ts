import { api, withQuery } from './apiClient'
import type {
  AdminAuditListQuery,
  AdminCreativeGenerationHistoryPage,
  AdminCreativeGenerationHistoryQuery,
  AdminPointAdjustmentRequest,
  AdminPointAdjustmentResponse,
  AdminPermissionDto,
  AdminProviderControlBundle,
  AdminProviderControlRecoveryTarget,
  AdminOperationsMetricsDto,
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
} from './contracts'
import type { Permission, Role } from '../domain/types'

export const adminService = {
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
  async exportPointLedgerCsv(query?: PointsLedgerQuery) {
    return api.text(withQuery('/admin/points/ledger.csv', query))
  },
}
