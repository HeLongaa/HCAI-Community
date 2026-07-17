import { api, withQuery } from './apiClient'
import type {
  ApiPaginationMeta,
  EffectiveEntitlementDto,
  EntitlementDecisionDto,
  EntitlementGrantDto,
  EntitlementGrantSummary,
  EntitlementListQuery,
  EntitlementPlanDto,
  EntitlementPlanSummary,
  EntitlementPlanVersionDto,
} from './contracts'

const pageMeta = <T>(meta: unknown, fallback: T) => {
  const value = meta as ApiPaginationMeta & { summary?: T }
  return {
    nextCursor: value?.pagination?.nextCursor ?? null,
    summary: value?.summary ?? fallback,
  }
}

export const entitlementService = {
  me: () => api.get<EffectiveEntitlementDto>('/entitlements/me'),
  evaluate: (payload: { capability: string; quotaKey?: string | null; units?: number }) =>
    api.post<EntitlementDecisionDto>('/entitlements/evaluate', payload),
  async plans(query?: EntitlementListQuery) {
    const envelope = await api.getEnvelope<EntitlementPlanDto[]>(withQuery('/admin/entitlements/plans', query))
    return { items: envelope.data, ...pageMeta(envelope.meta, { total: 0, draft: 0, active: 0, retired: 0 } satisfies EntitlementPlanSummary) }
  },
  plan: (id: string) => api.get<EntitlementPlanDto>(`/admin/entitlements/plans/${encodeURIComponent(id)}`),
  createPlan: (payload: { key: string; title: string; description?: string | null }) =>
    api.post<EntitlementPlanDto>('/admin/entitlements/plans', payload),
  appendPlanVersion: (id: string, payload: {
    expectedPlanVersion: number
    capabilities: Record<string, boolean>
    quotas: Record<string, number>
    effectiveAt: string
    expiresAt?: string | null
    reasonCode: string
  }) => api.post<{ plan: EntitlementPlanDto; planVersion: EntitlementPlanVersionDto }>(`/admin/entitlements/plans/${encodeURIComponent(id)}/versions`, payload),
  transitionPlan: (id: string, payload: { status: 'active' | 'retired'; planVersionId?: string | null; expectedVersion: number; reasonCode: string }) =>
    api.post<EntitlementPlanDto>(`/admin/entitlements/plans/${encodeURIComponent(id)}/transitions`, payload),
  async grants(query?: EntitlementListQuery) {
    const envelope = await api.getEnvelope<EntitlementGrantDto[]>(withQuery('/admin/entitlements/grants', query))
    return { items: envelope.data, ...pageMeta(envelope.meta, { scheduled: 0, active: 0, revoked: 0, expired: 0 } satisfies EntitlementGrantSummary) }
  },
  grant: (id: string) => api.get<EntitlementGrantDto>(`/admin/entitlements/grants/${encodeURIComponent(id)}`),
  createGrant: (payload: { userHandle: string; planVersionId: string; startsAt: string; endsAt?: string | null; reasonCode: string; sourceType?: string; sourceId?: string | null }) =>
    api.post<EntitlementGrantDto>('/admin/entitlements/grants', payload),
  transitionGrant: (id: string, payload: { status: 'active' | 'revoked' | 'expired'; expectedVersion: number; reasonCode: string }) =>
    api.post<EntitlementGrantDto>(`/admin/entitlements/grants/${encodeURIComponent(id)}/transitions`, payload),
  sweepExpired: (limit = 50) => api.post<{ inspected: number; expired: number; items: EntitlementGrantDto[] }>('/admin/entitlements/grants/expiry-sweep', { limit, reasonCode: 'validity_window_elapsed' }),
  evaluateAdmin: (payload: { userHandle: string; capability: string; quotaKey?: string | null; units?: number }) =>
    api.post<EntitlementDecisionDto>('/admin/entitlements/evaluate', payload),
  exportSnapshot: () => api.get<{ kind: string; schemaVersion: number; exportedAt: string; plans: EntitlementPlanDto[]; grants: EntitlementGrantDto[] }>('/admin/entitlements/plans/export'),
}
