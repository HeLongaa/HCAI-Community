import { api } from './apiClient'
import type {
  ApiCreativeGeneration,
  ApiCreativeGenerationMutationResponse,
  CreateCreativeGenerationRequest,
  CreativeGenerationMutationRequest,
  RetryCreativeGenerationRequest,
} from './contracts'

export const creativeService = {
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
