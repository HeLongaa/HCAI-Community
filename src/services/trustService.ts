import { api, withQuery } from './apiClient'
import type {
  ApiPaginationMeta,
  ModerationCaseDto,
  ModerationCaseMetrics,
  ModerationCaseQuery,
  ModerationDecisionOutcome,
  ModerationDecisionStage,
  ModerationReportCategory,
  ModerationTargetType,
  ModerationBulkAction,
  ModerationBulkPreview,
  ModerationBulkResult,
  ModerationCasePriority,
  ModerationQueueItem,
  SafetyRuleDto,
  SafetyRuleState,
  SafetySignalDto,
  TrustOperationsMetrics,
} from './contracts'

export const trustService = {
  listCases(query: ModerationCaseQuery = {}) {
    return api.get<ModerationCaseDto[]>(withQuery('/trust/cases', query))
  },
  getCase(id: string) {
    return api.get<ModerationCaseDto>(`/trust/cases/${encodeURIComponent(id)}`)
  },
  createReport(payload: { targetType: ModerationTargetType; targetId: string; category: ModerationReportCategory; subject: string; statement: string; locale: 'en' | 'zh'; sourceKey?: string }) {
    return api.post<{ duplicate: boolean; item: ModerationCaseDto }>('/trust/reports', payload)
  },
  appeal(id: string, payload: { reasonCode: string; statement: string; expectedVersion: number }) {
    return api.post<ModerationCaseDto>(`/trust/cases/${encodeURIComponent(id)}/appeals`, payload)
  },
  async adminList(query: ModerationCaseQuery = {}) {
    const envelope = await api.getEnvelope<ModerationCaseDto[]>(withQuery('/admin/trust/cases', query))
    return {
      items: envelope.data,
      nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null,
    }
  },
  adminMetrics() {
    return api.get<ModerationCaseMetrics>('/admin/trust/cases/metrics')
  },
  adminExport(query: ModerationCaseQuery = {}) {
    return api.get<{ schemaVersion: number; exportedAt: string; items: ModerationCaseDto[] }>(withQuery('/admin/trust/cases/export', query))
  },
  adminGet(id: string) {
    return api.get<ModerationCaseDto>(`/admin/trust/cases/${encodeURIComponent(id)}`)
  },
  decide(id: string, payload: { stage: ModerationDecisionStage; outcome: ModerationDecisionOutcome; reasonCode: string; note: string; expectedVersion: number }) {
    return api.post<ModerationCaseDto>(`/admin/trust/cases/${encodeURIComponent(id)}/decisions`, payload)
  },
  addEvidence(id: string, payload: { evidenceType: string; referenceType: string; referenceId: string; contentHash: string; reasonCode: string }) {
    return api.post<{ duplicate: boolean; item: ModerationCaseDto }>(`/admin/trust/cases/${encodeURIComponent(id)}/evidence`, payload)
  },
  listRules() { return api.get<SafetyRuleDto[]>('/admin/trust/rules') },
  createRule(payload: { ruleKey: string; name: string; signalType: string; targetType?: ModerationTargetType | null; category?: ModerationReportCategory | null; minimumScore: number; priority: ModerationCasePriority; configHash: string }) { return api.post<SafetyRuleDto>('/admin/trust/rules', payload) },
  transitionRule(id: string, payload: { toState: Exclude<SafetyRuleState, 'draft'>; rolloutPercent?: number; reasonCode: string }) { return api.post<SafetyRuleDto>(`/admin/trust/rules/${encodeURIComponent(id)}/transitions`, payload) },
  async listSignals(query: { cursor?: string | null; caseId?: string | null; signalType?: string | null; limit?: number } = {}) { const envelope = await api.getEnvelope<SafetySignalDto[]>(withQuery('/admin/trust/signals', query)); return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null } },
  async listQueue(query: { cursor?: string | null; status?: string | null; priority?: ModerationCasePriority | null; assignment?: 'assigned' | 'unassigned' | null; sla?: 'within' | 'breached' | null; search?: string | null; limit?: number } = {}) { const envelope = await api.getEnvelope<ModerationQueueItem[]>(withQuery('/admin/trust/queue', query)); return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null } },
  queueEvent(id: string, payload: { action: 'assign' | 'release' | 'set_priority' | 'escalate'; assigneeId?: string | null; priority?: ModerationCasePriority | null; reasonCode: string }) { return api.post<ModerationQueueItem & { event: unknown }>(`/admin/trust/queue/${encodeURIComponent(id)}/events`, payload) },
  previewBulk(payload: { action: ModerationBulkAction; targetIds: string[]; assigneeId?: string | null; priority?: ModerationCasePriority | null; reasonCode: string }) { return api.post<ModerationBulkPreview>('/admin/trust/queue/bulk/preview', payload) },
  executeBulk(payload: { action: ModerationBulkAction; targetIds: string[]; assigneeId?: string | null; priority?: ModerationCasePriority | null; reasonCode: string; targetHash: string; confirmationText: string; idempotencyKey: string }) { return api.post<ModerationBulkResult>('/admin/trust/queue/bulk', payload) },
  operationsMetrics() { return api.get<TrustOperationsMetrics>('/admin/trust/operations/metrics') },
}
