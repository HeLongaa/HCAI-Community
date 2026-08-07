import type { Dispatch, SetStateAction } from 'react'

import { adminService } from '../../services/adminService'
import type {
  AdminCreativeGenerationBulkAction,
  AdminCreativeGenerationBulkPreview,
  AdminCreativeGenerationBulkResult,
} from '../../services/contracts'
import type { AdminActionFeedbackMessage } from './AdminActionFeedback'

type Options = {
  isZh: boolean
  canCancel: boolean
  canRequestRetries: boolean
  selectedIds: string[]
  action: AdminCreativeGenerationBulkAction
  preview: AdminCreativeGenerationBulkPreview | null
  confirmation: string
  reasonCode: string
  note: string
  running: boolean
  setSelectedIds: Dispatch<SetStateAction<string[]>>
  setAction: Dispatch<SetStateAction<AdminCreativeGenerationBulkAction>>
  setPreview: Dispatch<SetStateAction<AdminCreativeGenerationBulkPreview | null>>
  setConfirmation: Dispatch<SetStateAction<string>>
  setResult: Dispatch<SetStateAction<AdminCreativeGenerationBulkResult | null>>
  setRunning: Dispatch<SetStateAction<boolean>>
  setFeedback: Dispatch<SetStateAction<AdminActionFeedbackMessage | null>>
  refreshHistory: () => Promise<void>
}

export function useAdminGenerationBulkOperations({
  isZh,
  canCancel,
  canRequestRetries,
  selectedIds,
  action,
  preview,
  confirmation,
  reasonCode,
  note,
  running,
  setSelectedIds,
  setAction,
  setPreview,
  setConfirmation,
  setResult,
  setRunning,
  setFeedback,
  refreshHistory,
}: Options) {
  const resetPreview = () => {
    setPreview(null)
    setResult(null)
    setConfirmation('')
  }

  const toggleSelection = (generationId: string) => {
    setSelectedIds((current) => current.includes(generationId)
      ? current.filter((id) => id !== generationId)
      : current.length < 50 ? [...current, generationId] : current)
    resetPreview()
  }

  const changeAction = (nextAction: AdminCreativeGenerationBulkAction) => {
    setAction(nextAction)
    resetPreview()
  }

  const previewAction = async () => {
    if (!selectedIds.length || running || (action === 'cancel' ? !canCancel : !canRequestRetries)) return
    setRunning(true)
    setResult(null)
    setConfirmation('')
    setFeedback(null)
    try {
      setPreview(await adminService.previewCreativeGenerationBulkAction(action, selectedIds))
      setFeedback({ kind: 'success', text: isZh ? '批量操作预检已完成。' : 'Bulk action preview is ready.' })
    } catch (error) {
      console.info('[admin-service]', error)
      setPreview(null)
      setFeedback({ kind: 'error', text: error instanceof Error ? error.message : (isZh ? '批量预检失败。' : 'Bulk preview failed.') })
    } finally {
      setRunning(false)
    }
  }

  const executeAction = async () => {
    if (!preview || running || confirmation !== preview.requiredConfirmationText) return
    setRunning(true)
    setFeedback(null)
    try {
      const result = await adminService.executeCreativeGenerationBulkAction({
        action: preview.action,
        targetIds: selectedIds,
        targetHash: preview.targetHash,
        confirmationText: confirmation,
        idempotencyKey: `admin-generation-bulk:${preview.action}:${Date.now()}`,
        reasonCode: reasonCode || 'operator_requested',
        note,
      })
      setResult(result)
      setPreview(null)
      setConfirmation('')
      setSelectedIds([])
      await refreshHistory()
      setFeedback({ kind: 'success', text: isZh ? '批量生成操作已完成。' : 'Bulk generation action completed.' })
    } catch (error) {
      console.info('[admin-service]', error)
      setFeedback({ kind: 'error', text: error instanceof Error ? error.message : (isZh ? '批量操作失败。' : 'Bulk action failed.') })
    } finally {
      setRunning(false)
    }
  }

  return {
    actions: {
      resetPreview,
      toggleSelection,
      changeAction,
      previewAction,
      executeAction,
    },
  }
}
