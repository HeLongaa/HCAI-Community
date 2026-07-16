import { api, withQuery } from './apiClient'
import type {
  ApiMediaAsset,
  ApiAdminMediaAsset,
  AdminMediaAssetBulkResult,
  AdminMediaAssetExport,
  ApiAssetLibraryItem,
  AssetLibraryQuery,
  AdminMediaAssetQuery,
  ApiMediaGovernanceConfig,
  MediaGovernancePolicyHistoryItem,
  ApiMediaScanAlert,
  ApiMediaScanAlertEvent,
  ApiMediaScanJob,
  ApiPortfolioAsset,
  ApiSavedAssetReference,
  ApiPaginationMeta,
  CompleteMediaUploadRequest,
  CreateMediaUploadRequest,
  MediaDownloadContract,
  MediaGovernancePolicyPatch,
  MediaScanJobArchiveManifest,
  MediaScanJobArchiveResult,
  MediaScanJobHistoryPage,
  MediaReviewQueueQuery,
  MediaScanJobHistoryQuery,
  MediaScanJobQuery,
  MediaScanSweepResult,
  MediaUploadContract,
  ReviewMediaUploadRequest,
} from './contracts'

export const mediaService = {
  async assetLibrary(query?: AssetLibraryQuery) {
    const envelope = await api.getEnvelope<ApiAssetLibraryItem[]>(withQuery('/media/assets', query))
    const pagination = (envelope.meta as ApiPaginationMeta | undefined)?.pagination
    return { items: envelope.data, limit: pagination?.limit ?? query?.limit ?? envelope.data.length, nextCursor: pagination?.nextCursor ?? null }
  },
  assetLibraryItem(id: string) {
    return api.get<ApiAssetLibraryItem>(`/media/assets/${id}`)
  },
  archiveAsset(id: string) {
    return api.post<ApiAssetLibraryItem>(`/media/assets/${id}/archive`)
  },
  restoreAsset(id: string) {
    return api.post<ApiAssetLibraryItem>(`/media/assets/${id}/restore`)
  },
  deleteAsset(id: string) {
    return api.del<ApiAssetLibraryItem>(`/media/assets/${id}`)
  },
  recoverAsset(id: string) {
    return api.post<ApiAssetLibraryItem>(`/media/assets/${id}/recover`)
  },
  async adminAssets(query?: AdminMediaAssetQuery) {
    const envelope = await api.getEnvelope<ApiAdminMediaAsset[]>(withQuery('/admin/media/assets', query))
    const pagination = (envelope.meta as ApiPaginationMeta | undefined)?.pagination
    return { items: envelope.data, limit: pagination?.limit ?? query?.limit ?? envelope.data.length, nextCursor: pagination?.nextCursor ?? null }
  },
  adminAsset(id: string) {
    return api.get<ApiAdminMediaAsset>(`/admin/media/assets/${id}`)
  },
  adminAssetAction(id: string, action: 'archive' | 'restore' | 'delete' | 'recover', reason?: string) {
    return api.post<ApiAdminMediaAsset>(`/admin/media/assets/${id}/${action}`, action === 'delete' ? { reason: reason || 'admin_requested' } : undefined)
  },
  adminAssetScan(id: string, body: ReviewMediaUploadRequest) {
    return api.post<ApiAdminMediaAsset>(`/admin/media/assets/${id}/scan`, body)
  },
  adminAssetScanRetry(id: string) {
    return api.post<ApiAdminMediaAsset>(`/admin/media/assets/${id}/scan-retry`)
  },
  adminAssetBulkAction(ids: string[], action: 'archive' | 'restore' | 'delete' | 'recover', reason = 'admin_bulk_action') {
    return api.post<AdminMediaAssetBulkResult>('/admin/media/assets/bulk-actions', { ids, action, reason })
  },
  adminAssetExport(query: AdminMediaAssetQuery, format: 'json' | 'csv') {
    const path = withQuery('/admin/media/assets/export', { ...query, cursor: null, format })
    return format === 'csv' ? api.text(path) : api.get<AdminMediaAssetExport>(path)
  },
  saveAssetToLibrary(id: string) {
    return api.post<ApiSavedAssetReference>(`/media/assets/${id}/library`)
  },
  addAssetToPortfolio(id: string, body: { title?: string; caption?: string; sourceSubmissionId?: string | null } = {}) {
    return api.post<ApiPortfolioAsset>(`/media/assets/${id}/portfolio`, body)
  },
  createUpload(body: CreateMediaUploadRequest) {
    return api.post<MediaUploadContract>('/media/uploads', body)
  },
  completeUpload(id: string, body: CompleteMediaUploadRequest = {}) {
    return api.post<ApiMediaAsset>(`/media/uploads/${id}/complete`, body)
  },
  reviewUpload(id: string, body: ReviewMediaUploadRequest) {
    return api.post<ApiMediaAsset>(`/media/uploads/${id}/scan`, body)
  },
  reviewQueue(query?: MediaReviewQueueQuery) {
    return api.get<ApiMediaAsset[]>(withQuery('/media/review-queue', query))
  },
  scanJobs(query?: MediaScanJobQuery) {
    return api.get<ApiMediaAsset[]>(withQuery('/media/scan-jobs', query))
  },
  scanJobArchive(query?: MediaScanJobHistoryQuery) {
    return api.get<MediaScanJobArchiveManifest>(withQuery('/media/scan-jobs/archive', query))
  },
  writeScanJobArchive(query?: MediaScanJobHistoryQuery) {
    return api.post<MediaScanJobArchiveResult>(withQuery('/media/scan-jobs/archive', query))
  },
  governanceConfig() {
    return api.get<ApiMediaGovernanceConfig>('/media/governance-config')
  },
  updateGovernancePolicy(body: MediaGovernancePolicyPatch) {
    return api.put<ApiMediaGovernanceConfig>('/media/governance-policy', body)
  },
  governancePolicyHistory() {
    return api.get<MediaGovernancePolicyHistoryItem[]>('/media/governance-policy/history?limit=5')
  },
  rollbackGovernancePolicy(eventId: string) {
    return api.post<ApiMediaGovernanceConfig>('/media/governance-policy/rollback', { eventId })
  },
  scanAlerts() {
    return api.get<ApiMediaScanAlert[]>('/media/scan-alerts')
  },
  scanAlertEvents(id: string) {
    return api.get<ApiMediaScanAlertEvent[]>(`/media/scan-alerts/${id}/events`)
  },
  acknowledgeScanAlert(id: string, note = '') {
    return api.post<ApiMediaScanAlert>(`/media/scan-alerts/${id}/acknowledge`, { note })
  },
  silenceScanAlert(id: string, until: string, note = '') {
    return api.post<ApiMediaScanAlert>(`/media/scan-alerts/${id}/silence`, { until, note })
  },
  unsilenceScanAlert(id: string, note = '') {
    return api.post<ApiMediaScanAlert>(`/media/scan-alerts/${id}/unsilence`, { note })
  },
  scanJobHistory(id: string, query?: MediaScanJobHistoryQuery) {
    return api.get<ApiMediaScanJob[]>(withQuery(`/media/uploads/${id}/scan-jobs`, query))
  },
  async scanJobHistoryPage(id: string, query?: MediaScanJobHistoryQuery): Promise<MediaScanJobHistoryPage> {
    const envelope = await api.getEnvelope<ApiMediaScanJob[]>(withQuery(`/media/uploads/${id}/scan-jobs`, query))
    const pagination = (envelope.meta as ApiPaginationMeta | undefined)?.pagination
    return {
      items: envelope.data,
      limit: pagination?.limit ?? query?.limit ?? envelope.data.length,
      nextCursor: pagination?.nextCursor ?? null,
    }
  },
  retryScan(id: string) {
    return api.post<ApiMediaAsset>(`/media/uploads/${id}/scan-retry`)
  },
  sweepScanJobs() {
    return api.post<MediaScanSweepResult>('/media/scan-jobs/sweep')
  },
  createDownload(id: string) {
    return api.get<MediaDownloadContract>(`/media/assets/${id}/download`)
  },
}
