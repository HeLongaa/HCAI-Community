import { api } from './apiClient'
import type {
  ApiCreativeGeneration,
  ApiCreativeGenerationMutationResponse,
  ApiCreativeProviderCatalog,
  ApiMediaAsset,
  CreateCreativeGenerationRequest,
  CreativeGenerationMutationRequest,
  RetryCreativeGenerationRequest,
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
