import { api, withQuery } from './apiClient'
import type { ApiPaginationMeta, ApiSearchIndexStatus, ApiSearchResult, ApiSearchSyncResult, SearchQuery, SearchResourceType } from './contracts'

const queryParams = (query: SearchQuery) => ({
  ...query,
  types: Array.isArray(query.types) ? query.types.join(',') : query.types,
})

export const searchService = {
  async search(query: SearchQuery) {
    const envelope = await api.getEnvelope<ApiSearchResult[]>(withQuery('/search', queryParams(query)))
    return {
      items: envelope.data,
      nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null,
    }
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
}
