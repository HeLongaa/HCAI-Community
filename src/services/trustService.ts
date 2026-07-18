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
}
