import { api, withQuery } from './apiClient'
import type { ApiPaginationMeta, ApiSearchDiagnostics, ApiSearchIndexStatus, ApiSearchRankingControl, ApiSearchResult, ApiSearchSyncResult, SearchPage, SearchQuery, SearchResourceType } from './contracts'

const queryParams = (query: SearchQuery) => ({
  ...query,
  types: Array.isArray(query.types) ? query.types.join(',') : query.types,
})

export const searchService = {
  async search(query: SearchQuery) {
    const envelope = await api.getEnvelope<ApiSearchResult[]>(withQuery('/search', queryParams(query)))
    const meta = envelope.meta as (ApiPaginationMeta & { searchEventId?: string | null }) | undefined
    return {
      items: envelope.data,
      nextCursor: meta?.pagination?.nextCursor ?? null,
      searchEventId: meta?.searchEventId ?? null,
    } satisfies SearchPage
  },
  async recordClick(searchEventId: string, payload: { resourceType: SearchResourceType; sourceId: string; position: number }) {
    return api.post<{ recorded: true; id: string }>(`/search/events/${encodeURIComponent(searchEventId)}/clicks`, payload)
  },
  async indexStatus() {
    return api.get<ApiSearchIndexStatus>('/admin/search/index/status')
  },
  async syncIndex(payload: { types?: SearchResourceType[]; limit?: number; reasonCode: string }) {
    return api.post<ApiSearchSyncResult & { status: ApiSearchIndexStatus }>('/admin/search/index/sync', payload)
  },
  async rebuildIndex(payload: { types?: SearchResourceType[]; limit?: number; reasonCode: string }) {
    return api.post<{ rebuild: { types: SearchResourceType[]; enqueued: number; reasonCode: string }; processed: ApiSearchSyncResult; status: ApiSearchIndexStatus }>('/admin/search/index/rebuild', payload)
  },
  async diagnostics(windowHours = 24) {
    return api.get<ApiSearchDiagnostics>(withQuery('/admin/search/diagnostics', { windowHours }))
  },
  async exportDiagnostics(windowHours = 24) {
    return api.get<ApiSearchDiagnostics & { exportedAt: string; format: 'json' }>(withQuery('/admin/search/diagnostics/export', { windowHours }))
  },
  async rankingControl() {
    return api.get<ApiSearchRankingControl>('/admin/search/ranking-control')
  },
  async updateRankingControl(payload: Omit<ApiSearchRankingControl, 'version' | 'reasonCode' | 'updatedByRef' | 'updatedAt'> & { expectedVersion: number; reasonCode: string }) {
    return api.put<ApiSearchRankingControl>('/admin/search/ranking-control', payload)
  },
}
