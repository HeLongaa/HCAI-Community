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
  ApiGenerationTask,
  ApiCreativeAccountingPreview,
  GenerationCenterPage,
  GenerationCenterQuery,
  GenerationCenterSummary,
  UserCreativeGenerationHistoryPage,
  UserCreativeGenerationHistoryQuery,
} from './contracts'

export const creativeService = {
  accountingPreview(workspace: CreateCreativeGenerationRequest['workspace'], mode: string, providerId?: string | null) {
    return api.get<ApiCreativeAccountingPreview>(withQuery('/creative/accounting-policy/preview', {
      workspace,
      mode,
      providerId: providerId || undefined,
    }))
  },
  listProviders() {
    return api.get<ApiCreativeProviderCatalog>('/creative/providers')
  },
  listInputAssets() {
    return api.get<ApiMediaAsset[]>('/creative/input-assets?limit=24')
  },
  createGeneration(body: CreateCreativeGenerationRequest) {
    return api.post<ApiCreativeGeneration>('/creative/generations', {
      ...body,
      idempotencyKey: body.idempotencyKey ?? `generation:${crypto.randomUUID()}`,
    })
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
  async listGenerationTasks(query: GenerationCenterQuery = {}): Promise<GenerationCenterPage> {
    const envelope = await api.getEnvelope<ApiGenerationTask[]>(withQuery('/creative/generation-center', query))
    return {
      items: envelope.data,
      nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null,
    }
  },
  generationTask(id: string) {
    return api.get<ApiGenerationTask>(`/creative/generation-center/${id}`)
  },
  generationCenterSummary(query: GenerationCenterQuery = {}) {
    return api.get<GenerationCenterSummary>(withQuery('/creative/generation-center/summary', query))
  },
  exportGenerationCenter(query: GenerationCenterQuery = {}, format: 'json' | 'csv' = 'json') {
    return api.text(withQuery('/creative/generation-center/export', { ...query, format, limit: 500 }))
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
