import { api, withQuery } from './apiClient'
import type { ApiPaginationMeta, RiskCase, RiskCaseQuery } from './contracts'

export const riskService = {
  async cases(query?: Pick<RiskCaseQuery, 'status' | 'cursor' | 'limit'>) {
    const envelope = await api.getEnvelope<RiskCase[]>(withQuery('/risk/cases', query))
    return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null }
  },
  case(id: string) {
    return api.get<RiskCase>(`/risk/cases/${encodeURIComponent(id)}`)
  },
  appeal(id: string, payload: { reasonCode: string; statement: string }) {
    return api.post<{ case: RiskCase; appealId: string }>(`/risk/cases/${encodeURIComponent(id)}/appeals`, payload)
  },
}
