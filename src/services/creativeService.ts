import { api } from './apiClient'
import type { ApiCreativeGeneration, CreateCreativeGenerationRequest } from './contracts'

export const creativeService = {
  createGeneration(body: CreateCreativeGenerationRequest) {
    return api.post<ApiCreativeGeneration>('/creative/generations', body)
  },
}
