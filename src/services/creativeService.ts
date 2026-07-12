import { api, withQuery } from './apiClient'
import type {
  ApiPaginationMeta,
  ApiCreativeGeneration,
  ApiCreativeGenerationMutationResponse,
  ApiCreativeProviderCatalog,
  ApiMediaAsset,
  CreateCreativeGenerationRequest,
  CreativeGenerationMutationRequest,
  RetryCreativeGenerationRequest,
  ApiUserCreativeGeneration,
  UserCreativeGenerationHistoryPage,
  UserCreativeGenerationHistoryQuery,
} from './contracts'

export const creativeService = {
  listProviders() {
    return api.get<ApiCreativeProviderCatalog>('/creative/providers')
  },
  listInputAssets() {
    return api.get<ApiMediaAsset[]>('/creative/input-assets?limit=24')
  },
  createGeneration(body: CreateCreativeGenerationRequest) {
    return api.post<ApiCreativeGeneration>('/creative/generations', body)
  },
  async listGenerations(query: UserCreativeGenerationHistoryQuery = {}): Promise<UserCreativeGenerationHistoryPage> {
    const envelope = await api.getEnvelope<ApiUserCreativeGeneration[]>(withQuery('/creative/generations', query))
    return {
      items: envelope.data,
      nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null,
    }
  },
  generation(id: string) {
    return api.get<ApiUserCreativeGeneration>(`/creative/generations/${id}`)
  },
  cancelGeneration(id: string, body: CreativeGenerationMutationRequest) {
    return api.post<ApiCreativeGenerationMutationResponse>(`/creative/generations/${id}/cancel`, body)
  },
  retryGeneration(id: string, body: RetryCreativeGenerationRequest) {
    return api.post<{
      duplicate: boolean
      mutation: ApiCreativeGenerationMutationResponse['mutation']
      generation?: ApiCreativeGeneration
      targetGeneration?: ApiCreativeGenerationMutationResponse['generation']
    }>(`/creative/generations/${id}/retry`, body)
  },
}
