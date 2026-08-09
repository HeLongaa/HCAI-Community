import type { Dispatch, SetStateAction } from 'react'

import { adminService } from '../../services/adminService'
import type {
  AdminCreativeGenerationHistoryQuery,
  AdminProviderControlRecoveryTarget,
  ApiCreativeGenerationRecord,
} from '../../services/contracts'
import type { AdminActionFeedbackMessage } from './AdminActionFeedback'

type GenerationAction = 'cancel' | 'retry' | 'manual_replay'
type ReplayStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
type ProviderCostSettlementDraft = {
  actualAmount: string
  evidenceRef: string
  reasonCode: string
}

type Options = {
  isZh: boolean
  canRead: boolean
  canCancel: boolean
  canRequestRetries: boolean
  canRepairAccounting: boolean
  canManageProviderControls: boolean
  canRecoverProviderControls: boolean
  query: AdminCreativeGenerationHistoryQuery
  nextCursor: string | null
  loadingMore: boolean
  selectedId: string | null
  selected: ApiCreativeGenerationRecord | null
  loadingDetail: boolean
  runningAction: GenerationAction | null
  replayStatus: ReplayStatus
  mutationReason: string
  mutationNote: string
  providerCostSettlementDraft: ProviderCostSettlementDraft
  settlingProviderCost: boolean
  recoveringExecutionId: string | null
  recoveryReason: string
  recoveryError: string
  runningProviderControlAction: string | null
  providerControlReason: string
  setRows: Dispatch<SetStateAction<ApiCreativeGenerationRecord[]>>
  setNextCursor: Dispatch<SetStateAction<string | null>>
  setLoadingMore: Dispatch<SetStateAction<boolean>>
  setSelectedId: Dispatch<SetStateAction<string | null>>
  setSelected: Dispatch<SetStateAction<ApiCreativeGenerationRecord | null>>
  setLoadingDetail: Dispatch<SetStateAction<boolean>>
  setDetailError: Dispatch<SetStateAction<string | null>>
  setRunningAction: Dispatch<SetStateAction<GenerationAction | null>>
  setProviderCostSettlementDraft: Dispatch<SetStateAction<ProviderCostSettlementDraft>>
  setSettlingProviderCost: Dispatch<SetStateAction<boolean>>
  setRecoveringExecutionId: Dispatch<SetStateAction<string | null>>
  setRunningProviderControlAction: Dispatch<SetStateAction<string | null>>
  setFeedback: Dispatch<SetStateAction<AdminActionFeedbackMessage | null>>
  refreshExecutions: () => Promise<void>
  refreshQueue: () => Promise<void>
  refreshAudit: () => Promise<void>
  refreshProviderControls: () => Promise<void>
}

export function useAdminGenerationOperations({
  isZh,
  canRead,
  canCancel,
  canRequestRetries,
  canRepairAccounting,
  canManageProviderControls,
  canRecoverProviderControls,
  query,
  nextCursor,
  loadingMore,
  selectedId,
  selected,
  loadingDetail,
  runningAction,
  replayStatus,
  mutationReason,
  mutationNote,
  providerCostSettlementDraft,
  settlingProviderCost,
  recoveringExecutionId,
  recoveryReason,
  recoveryError,
  runningProviderControlAction,
  providerControlReason,
  setRows,
  setNextCursor,
  setLoadingMore,
  setSelectedId,
  setSelected,
  setLoadingDetail,
  setDetailError,
  setRunningAction,
  setProviderCostSettlementDraft,
  setSettlingProviderCost,
  setRecoveringExecutionId,
  setRunningProviderControlAction,
  setFeedback,
  refreshExecutions,
  refreshQueue,
  refreshAudit,
  refreshProviderControls,
}: Options) {
  const loadMore = async () => {
    if (!nextCursor || loadingMore || !canRead) return
    setLoadingMore(true)
    setFeedback(null)
    try {
      const page = await adminService.creativeGenerations({ ...query, cursor: nextCursor })
      setRows((current) => [...current, ...page.items.filter((item) => !current.some((row) => row.id === item.id))])
      setNextCursor(page.nextCursor)
    } catch (error) {
      console.info('[admin-service]', error)
      setFeedback({ kind: 'error', text: isZh ? '加载更多生成历史失败。' : 'Could not load more generation history.' })
    } finally {
      setLoadingMore(false)
    }
  }

  const toggleDetail = async (generation: ApiCreativeGenerationRecord) => {
    if (!canRead || loadingDetail) return
    if (selectedId === generation.id) {
      setSelectedId(null)
      setSelected(null)
      setDetailError(null)
      return
    }
    setSelectedId(generation.id)
    setSelected(generation)
    setDetailError(null)
    setLoadingDetail(true)
    try {
      setSelected(await adminService.creativeGeneration(generation.id))
    } catch (error) {
      console.info('[admin-service]', error)
      setDetailError(isZh ? '无法读取生成历史详情。' : 'Could not load generation detail.')
    } finally {
      setLoadingDetail(false)
    }
  }

  const mutate = async (action: GenerationAction) => {
    if (!selected || runningAction || (action === 'cancel' ? !canCancel : !canRequestRetries)) return
    setRunningAction(action)
    setDetailError(null)
    setFeedback(null)
    const request = {
      idempotencyKey: `${action}:${selected.id}:${Date.now()}`,
      reasonCode: mutationReason || 'operator_requested',
      note: mutationNote,
    }
    try {
      if (action === 'cancel') {
        await adminService.cancelCreativeGeneration(selected.id, request)
      } else if (action === 'retry') {
        await adminService.requestCreativeGenerationRetry(selected.id, request)
      } else {
        if (!selected.providerId || !selected.providerMode || !selected.providerJobId) {
          throw new Error('Provider replay identifiers are incomplete')
        }
        await adminService.requestCreativeGenerationManualReplay(selected.id, {
          ...request,
          providerId: selected.providerId,
          providerMode: selected.providerMode,
          providerJobId: selected.providerJobId,
          normalizedStatus: replayStatus,
        })
        await refreshQueue()
      }
      const detail = await adminService.creativeGeneration(selected.id)
      setSelected(detail)
      setRows((rows) => rows.map((row) => row.id === detail.id ? detail : row))
      setFeedback({
        kind: 'success',
        text: action === 'cancel'
          ? (isZh ? '生成任务已取消。' : 'Generation cancelled.')
          : action === 'retry'
            ? (isZh ? '已创建重试授权。' : 'Retry authorization created.')
            : (isZh ? '人工重放已提交复核。' : 'Manual replay sent to review.'),
      })
    } catch (error) {
      console.info('[admin-service]', error)
      const message = error instanceof Error
        ? error.message
        : (isZh ? '生成任务操作失败。' : 'Generation action failed.')
      setDetailError(message)
      setFeedback({ kind: 'error', text: message })
    } finally {
      setRunningAction(null)
    }
  }

  const settleProviderCost = async () => {
    if (!selected || !canRepairAccounting || settlingProviderCost ||
      !providerCostSettlementDraft.actualAmount.trim() ||
      !providerCostSettlementDraft.evidenceRef.trim() ||
      !providerCostSettlementDraft.reasonCode.trim()) return
    setSettlingProviderCost(true)
    setDetailError(null)
    setFeedback(null)
    try {
      await adminService.settleCreativeGenerationProviderCost(selected.id, {
        actualAmount: providerCostSettlementDraft.actualAmount,
        currency: 'USD',
        evidenceRef: providerCostSettlementDraft.evidenceRef,
        reasonCode: providerCostSettlementDraft.reasonCode,
      })
      const detail = await adminService.creativeGeneration(selected.id)
      setSelected(detail)
      setRows((rows) => rows.map((row) => row.id === detail.id ? detail : row))
      setProviderCostSettlementDraft({ actualAmount: '', evidenceRef: '', reasonCode: 'manual_cost_confirmed' })
      void refreshAudit()
      setFeedback({ kind: 'success', text: isZh ? 'Provider 成本已按审计证据结算。' : 'Provider cost was settled with audited evidence.' })
    } catch (error) {
      console.info('[admin-service]', error)
      const message = error instanceof Error
        ? error.message
        : (isZh ? 'Provider 成本结算失败。' : 'Provider cost settlement failed.')
      setDetailError(message)
      setFeedback({ kind: 'error', text: message })
    } finally {
      setSettlingProviderCost(false)
    }
  }

  const recoverExecution = async (executionId: string) => {
    if (!executionId || !canRequestRetries || recoveringExecutionId) return
    setRecoveringExecutionId(executionId)
    setFeedback(null)
    try {
      await adminService.recoverCreativeGenerationExecution(executionId, recoveryReason, recoveryError)
      await refreshExecutions()
      setFeedback({ kind: 'success', text: isZh ? '生成执行已标记失败。' : 'Generation execution marked failed.' })
    } catch (error) {
      console.info('[admin-service]', error)
      setFeedback({ kind: 'error', text: error instanceof Error ? error.message : (isZh ? '执行恢复失败。' : 'Execution recovery failed.') })
    } finally {
      setRecoveringExecutionId(null)
    }
  }

  const runProviderControl = async (
    resourceId: string,
    version: number,
    action: 'disable' | AdminProviderControlRecoveryTarget,
  ) => {
    const canRun = action === 'disable' ? canManageProviderControls : canRecoverProviderControls
    if (!resourceId || !canRun || runningProviderControlAction) return
    const actionKey = `${resourceId}:${action}`
    setRunningProviderControlAction(actionKey)
    setFeedback(null)
    try {
      if (action === 'disable') {
        await adminService.disableProviderControl(resourceId, version, providerControlReason || 'operator_emergency_stop')
        setFeedback({ kind: 'success', text: isZh ? 'Provider 调用已停用。' : 'Provider dispatch disabled.' })
      } else {
        await adminService.requestProviderControlRecovery(resourceId, action, version, providerControlReason || 'operator_recovery_requested')
        await refreshQueue()
        setFeedback({ kind: 'success', text: isZh ? 'Provider 恢复已提交复核。' : 'Provider recovery sent to review.' })
      }
      await refreshProviderControls()
    } catch (error) {
      console.info('[admin-service]', error)
      setFeedback({ kind: 'error', text: error instanceof Error ? error.message : (isZh ? 'Provider 控制操作失败。' : 'Provider control action failed.') })
    } finally {
      setRunningProviderControlAction(null)
    }
  }

  return {
    actions: {
      loadMore,
      toggleDetail,
      mutate,
      settleProviderCost,
      recoverExecution,
      runProviderControl,
    },
  }
}
