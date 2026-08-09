import { useEffect, useMemo, useState } from 'react'

import type {
  AdminCreativeGenerationBulkAction,
  AdminCreativeGenerationBulkPreview,
  AdminCreativeGenerationBulkResult,
  AdminCreativeGenerationExecution,
  AdminCreativeGenerationHistoryQuery,
  AdminCreativeGenerationSummary,
  AdminGenerationBusinessMetrics,
  AdminProviderControlBundle,
  ApiCreativeGenerationRecord,
} from '../../services/contracts'
import type { AdminActionFeedbackMessage } from './AdminActionFeedback'

export type GenerationOperationsWorkspace = 'records' | 'recovery' | 'providers' | 'metrics'

const workspaces: GenerationOperationsWorkspace[] = ['records', 'recovery', 'providers', 'metrics']
const emptySummary = (): AdminCreativeGenerationSummary => ({
  total: 0,
  active: 0,
  failed: 0,
  reviewRequired: 0,
  outputAssets: 0,
  byStatus: {},
  byWorkspace: {},
  byProvider: {},
})

export function useAdminGenerationState() {
  const [rows, setRows] = useState<ApiCreativeGenerationRecord[]>([])
  const [workspace, setWorkspace] = useState<GenerationOperationsWorkspace>(() => {
    const saved = typeof window === 'undefined' ? null : window.sessionStorage.getItem('hcaiGenerationOperationsWorkspace') as GenerationOperationsWorkspace | null
    return saved && workspaces.includes(saved) ? saved : 'records'
  })
  const [providerControls, setProviderControls] = useState<AdminProviderControlBundle>({ controls: [], circuits: [], capEvidence: [] })
  const [providerControlReason, setProviderControlReason] = useState('operator_requested')
  const [runningProviderControlAction, setRunningProviderControlAction] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<ApiCreativeGenerationRecord | null>(null)
  const [providerCostSettlementDraft, setProviderCostSettlementDraft] = useState({ actualAmount: '', evidenceRef: '', reasonCode: 'manual_cost_confirmed' })
  const [settlingProviderCost, setSettlingProviderCost] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [userHandle, setUserHandle] = useState('')
  const [historyWorkspace, setHistoryWorkspace] = useState('')
  const [providerId, setProviderId] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [reviewFilter, setReviewFilter] = useState<'all' | 'true' | 'false'>('all')
  const [mediaAssetId, setMediaAssetId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sort, setSort] = useState<'createdAt' | 'updatedAt' | 'status'>('createdAt')
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc')
  const [summary, setSummary] = useState<AdminCreativeGenerationSummary>(emptySummary)
  const [metricsWorkspace, setMetricsWorkspace] = useState('')
  const [metricsProviderId, setMetricsProviderId] = useState('')
  const [metricsDateFrom, setMetricsDateFrom] = useState('')
  const [metricsDateTo, setMetricsDateTo] = useState('')
  const [metricsSummary, setMetricsSummary] = useState<AdminCreativeGenerationSummary>(emptySummary)
  const [businessMetrics, setBusinessMetrics] = useState<AdminGenerationBusinessMetrics | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportingMetrics, setExportingMetrics] = useState(false)
  const [mutationReason, setMutationReason] = useState('operator_requested')
  const [mutationNote, setMutationNote] = useState('')
  const [replayStatus, setReplayStatus] = useState<'queued' | 'running' | 'completed' | 'failed' | 'cancelled'>('failed')
  const [runningAction, setRunningAction] = useState<'cancel' | 'retry' | 'manual_replay' | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkAction, setBulkAction] = useState<AdminCreativeGenerationBulkAction>('cancel')
  const [bulkPreview, setBulkPreview] = useState<AdminCreativeGenerationBulkPreview | null>(null)
  const [bulkConfirmation, setBulkConfirmation] = useState('')
  const [bulkResult, setBulkResult] = useState<AdminCreativeGenerationBulkResult | null>(null)
  const [runningBulkAction, setRunningBulkAction] = useState(false)
  const [executions, setExecutions] = useState<AdminCreativeGenerationExecution[]>([])
  const [recoveringExecutionId, setRecoveringExecutionId] = useState<string | null>(null)
  const [recoveryReason, setRecoveryReason] = useState('operator_verified_no_result')
  const [recoveryError, setRecoveryError] = useState('CREATIVE_GENERATION_EXECUTION_ABANDONED')
  const [actionMessage, setActionMessage] = useState<AdminActionFeedbackMessage | null>(null)

  useEffect(() => {
    window.sessionStorage.setItem('hcaiGenerationOperationsWorkspace', workspace)
  }, [workspace])

  const query = useMemo<AdminCreativeGenerationHistoryQuery>(() => ({
    userHandle: userHandle || null,
    workspace: historyWorkspace || null,
    providerId: providerId || null,
    status: statusFilter || null,
    reviewRequired: reviewFilter === 'all' ? null : reviewFilter === 'true',
    mediaAssetId: mediaAssetId || null,
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
    sort,
    direction,
    limit: 12,
  }), [dateFrom, dateTo, direction, historyWorkspace, mediaAssetId, providerId, reviewFilter, sort, statusFilter, userHandle])

  const metricsQuery = useMemo<AdminCreativeGenerationHistoryQuery>(() => ({
    workspace: metricsWorkspace || null,
    providerId: metricsProviderId || null,
    dateFrom: metricsDateFrom || null,
    dateTo: metricsDateTo || null,
  }), [metricsDateFrom, metricsDateTo, metricsProviderId, metricsWorkspace])

  return {
    state: { rows, workspace, providerControls, providerControlReason, runningProviderControlAction,
      nextCursor, loadingMore, selectedId, selected, providerCostSettlementDraft, settlingProviderCost,
      loadingDetail, detailError, userHandle, historyWorkspace, providerId, statusFilter, reviewFilter,
      mediaAssetId, dateFrom, dateTo, sort, direction, summary, metricsWorkspace, metricsProviderId,
      metricsDateFrom, metricsDateTo, metricsSummary, businessMetrics, exporting, exportingMetrics,
      mutationReason, mutationNote, replayStatus, runningAction, selectedIds, bulkAction, bulkPreview,
      bulkConfirmation, bulkResult, runningBulkAction, executions, recoveringExecutionId,
      recoveryReason, recoveryError, actionMessage, query, metricsQuery },
    setters: { setRows, setWorkspace, setProviderControls, setProviderControlReason,
      setRunningProviderControlAction, setNextCursor, setLoadingMore, setSelectedId, setSelected,
      setProviderCostSettlementDraft, setSettlingProviderCost, setLoadingDetail, setDetailError,
      setUserHandle, setHistoryWorkspace, setProviderId, setStatusFilter, setReviewFilter,
      setMediaAssetId, setDateFrom, setDateTo, setSort, setDirection, setSummary, setMetricsWorkspace,
      setMetricsProviderId, setMetricsDateFrom, setMetricsDateTo, setMetricsSummary, setBusinessMetrics,
      setExporting, setExportingMetrics, setMutationReason, setMutationNote, setReplayStatus,
      setRunningAction, setSelectedIds, setBulkAction, setBulkPreview, setBulkConfirmation,
      setBulkResult, setRunningBulkAction, setExecutions, setRecoveringExecutionId,
      setRecoveryReason, setRecoveryError, setActionMessage },
  }
}
