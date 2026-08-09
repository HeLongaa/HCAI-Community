import { useCallback, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import type { AuditEvent } from '../../domain/types'
import { mediaService } from '../../services/mediaService'
import type { ApiMediaAsset, ApiMediaScanAlert, ApiMediaScanAlertEvent, ApiMediaScanJob } from '../../services/contracts'
import type { AdminActionFeedbackMessage } from './AdminActionFeedback'

type Options = {
  isZh: boolean
  selectedAssetId: string | null
  historyNextCursor: string | null
  historyPageSize: number
  setRows: Dispatch<SetStateAction<ApiMediaAsset[]>>
  setSelectedAssetId: Dispatch<SetStateAction<string | null>>
  setHistory: Dispatch<SetStateAction<ApiMediaScanJob[]>>
  setHistoryNextCursor: Dispatch<SetStateAction<string | null>>
  setAlerts: Dispatch<SetStateAction<ApiMediaScanAlert[]>>
  setCallbackEvents: Dispatch<SetStateAction<AuditEvent[]>>
  setFeedback: Dispatch<SetStateAction<AdminActionFeedbackMessage | null>>
  refreshReview: () => Promise<void>
  refreshHistory: () => Promise<void>
  refreshAlerts: () => Promise<void>
  refreshAudit: () => Promise<void>
  refreshMetrics: () => Promise<void>
  onOperationComplete: () => void
}

export function useSecurityMediaOperations({
  isZh,
  selectedAssetId,
  historyNextCursor,
  historyPageSize,
  setRows,
  setSelectedAssetId,
  setHistory,
  setHistoryNextCursor,
  setAlerts,
  setCallbackEvents,
  setFeedback,
  refreshReview,
  refreshHistory,
  refreshAlerts,
  refreshAudit,
  refreshMetrics,
  onOperationComplete,
}: Options) {
  const [reviewingAssetId, setReviewingAssetId] = useState<string | null>(null)
  const [sweeping, setSweeping] = useState(false)
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false)
  const [handlingAlertId, setHandlingAlertId] = useState<string | null>(null)
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null)
  const [alertEvents, setAlertEvents] = useState<ApiMediaScanAlertEvent[]>([])
  const [alertEventsLoading, setAlertEventsLoading] = useState(false)
  const [alertEventsError, setAlertEventsError] = useState<string | null>(null)

  const selectAsset = useCallback((assetId: string | null) => {
    setHistory([])
    setHistoryNextCursor(null)
    setLoadingMoreHistory(false)
    setSelectedAssetId(assetId)
  }, [setHistory, setHistoryNextCursor, setSelectedAssetId])

  const reviewAsset = async (asset: ApiMediaAsset, decision: 'clean' | 'reject') => {
    setReviewingAssetId(asset.id)
    try {
      const reviewed = await mediaService.reviewUpload(asset.id, {
        decision,
        note: decision === 'clean' ? 'Manual review approved in Admin Center.' : 'Manual review rejected in Admin Center.',
      })
      setRows((current) => current.map((item) => item.id === reviewed.id ? reviewed : item))
      void refreshReview()
      if (selectedAssetId === asset.id) void refreshHistory()
      setFeedback({
        kind: 'success',
        text: isZh
          ? `媒体资产已${decision === 'clean' ? '放行' : '拒绝'}：${asset.fileName}`
          : `Media asset ${decision === 'clean' ? 'released' : 'rejected'}: ${asset.fileName}`,
      })
    } catch (error) {
      console.info('[media-service]', error)
      setFeedback({ kind: 'error', text: isZh ? '媒体审核操作失败。' : 'Media review action failed.' })
    } finally {
      setReviewingAssetId(null)
    }
  }

  const retryAsset = async (asset: ApiMediaAsset) => {
    setReviewingAssetId(asset.id)
    try {
      const retried = await mediaService.retryScan(asset.id)
      setRows((current) => current.map((item) => item.id === retried.id ? retried : item))
      void refreshReview()
      if (selectedAssetId === asset.id) void refreshHistory()
      setFeedback({ kind: 'success', text: isZh ? `媒体扫描已重新排队：${asset.fileName}` : `Media scan requeued: ${asset.fileName}` })
    } catch (error) {
      console.info('[media-service]', error)
      setFeedback({ kind: 'error', text: isZh ? '媒体扫描重试失败。' : 'Media scan retry failed.' })
    } finally {
      setReviewingAssetId(null)
    }
  }

  const loadMoreHistory = async () => {
    if (!selectedAssetId || !historyNextCursor || loadingMoreHistory) return
    setLoadingMoreHistory(true)
    try {
      const page = await mediaService.scanJobHistoryPage(selectedAssetId, { cursor: historyNextCursor, limit: historyPageSize })
      setHistory((current) => {
        const seen = new Set(current.map((item) => item.id))
        return [...current, ...page.items.filter((item) => !seen.has(item.id))]
      })
      setHistoryNextCursor(page.nextCursor)
    } catch (error) {
      console.info('[media-service]', error)
      setFeedback({ kind: 'error', text: isZh ? '加载更多扫描历史失败。' : 'Could not load more scan history.' })
    } finally {
      setLoadingMoreHistory(false)
    }
  }

  const updateAlert = (updated: ApiMediaScanAlert) => {
    setAlerts((current) => current.map((item) => item.id === updated.id ? updated : item))
    void refreshAudit()
    void refreshMetrics()
  }

  const acknowledgeAlert = async (alert: ApiMediaScanAlert) => {
    setHandlingAlertId(alert.id)
    try {
      updateAlert(await mediaService.acknowledgeScanAlert(alert.id, isZh ? '已在管理中心确认告警。' : 'Acknowledged from Admin Center.'))
      setFeedback({ kind: 'success', text: isZh ? `已确认扫描告警：${alert.title}` : `Scanner alert acknowledged: ${alert.title}` })
    } catch (error) {
      console.info('[media-service]', error)
      setFeedback({ kind: 'error', text: isZh ? '扫描告警确认失败。' : 'Could not acknowledge scanner alert.' })
    } finally {
      setHandlingAlertId(null)
    }
  }

  const silenceAlert = async (alert: ApiMediaScanAlert, reason: string) => {
    setHandlingAlertId(alert.id)
    try {
      const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      updateAlert(await mediaService.silenceScanAlert(alert.id, until, reason))
      onOperationComplete()
      setFeedback({ kind: 'success', text: isZh ? `已静默扫描告警：${alert.title}` : `Scanner alert silenced: ${alert.title}` })
    } catch (error) {
      console.info('[media-service]', error)
      setFeedback({ kind: 'error', text: isZh ? '扫描告警静默失败。' : 'Could not silence scanner alert.' })
    } finally {
      setHandlingAlertId(null)
    }
  }

  const unsilenceAlert = async (alert: ApiMediaScanAlert) => {
    setHandlingAlertId(alert.id)
    try {
      updateAlert(await mediaService.unsilenceScanAlert(alert.id, isZh ? '管理中心解除静默。' : 'Unsilenced from Admin Center.'))
      setFeedback({ kind: 'success', text: isZh ? `已解除扫描告警静默：${alert.title}` : `Scanner alert unsilenced: ${alert.title}` })
    } catch (error) {
      console.info('[media-service]', error)
      setFeedback({ kind: 'error', text: isZh ? '解除扫描告警静默失败。' : 'Could not unsilence scanner alert.' })
    } finally {
      setHandlingAlertId(null)
    }
  }

  const toggleAlertEvents = async (alert: ApiMediaScanAlert) => {
    if (selectedAlertId === alert.id) {
      setSelectedAlertId(null)
      setAlertEvents([])
      setAlertEventsError(null)
      return
    }
    setSelectedAlertId(alert.id)
    setAlertEvents([])
    setAlertEventsError(null)
    setAlertEventsLoading(true)
    try {
      setAlertEvents(await mediaService.scanAlertEvents(alert.id))
    } catch (error) {
      console.info('[media-service]', error)
      setAlertEventsError(isZh ? '无法读取告警样本。' : 'Could not load alert events.')
    } finally {
      setAlertEventsLoading(false)
    }
  }

  const sweepJobs = async () => {
    setSweeping(true)
    try {
      const result = await mediaService.sweepScanJobs()
      setRows((current) => current.map((item) => result.items.find((updated) => updated.id === item.id) ?? item))
      void refreshReview()
      void refreshAlerts()
      void refreshMetrics()
      const pruned = result.pruned ?? 0
      setFeedback({
        kind: 'success',
        text: isZh
          ? `媒体扫描巡检完成：检查 ${result.inspected}，重试 ${result.retried}，升级 ${result.failed}，清理历史 ${pruned}`
          : `Media scan sweep completed: inspected ${result.inspected}, retried ${result.retried}, escalated ${result.failed}, pruned ${pruned}`,
      })
    } catch (error) {
      console.info('[media-service]', error)
      setFeedback({ kind: 'error', text: isZh ? '媒体扫描巡检失败。' : 'Media scan sweep failed.' })
    } finally {
      setSweeping(false)
    }
  }

  const resetTransientState = () => {
    setSelectedAlertId(null)
    setAlertEvents([])
    setAlertEventsError(null)
    setCallbackEvents([])
  }

  return {
    state: {
      reviewingAssetId,
      sweeping,
      loadingMoreHistory,
      handlingAlertId,
      selectedAlertId,
      alertEvents,
      alertEventsLoading,
      alertEventsError,
    },
    actions: {
      selectAsset,
      reviewAsset,
      retryAsset,
      loadMoreHistory,
      acknowledgeAlert,
      silenceAlert,
      unsilenceAlert,
      toggleAlertEvents,
      sweepJobs,
      resetTransientState,
    },
  }
}
