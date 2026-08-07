import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import { mediaService } from '../../services/mediaService'
import type { ApiMediaGovernanceConfig, MediaGovernancePolicyPatch } from '../../services/contracts'
import type { AdminActionFeedbackMessage } from './AdminActionFeedback'

type Options<TDraft extends object> = {
  isZh: boolean
  draft: TDraft
  hasInvalidDraft: boolean
  highRiskChangeCount: number
  setConfig: Dispatch<SetStateAction<ApiMediaGovernanceConfig | null>>
  setDraft: Dispatch<SetStateAction<TDraft>>
  toPatch: (draft: TDraft) => MediaGovernancePolicyPatch | null
  fromConfig: (config: ApiMediaGovernanceConfig) => TDraft
  setFeedback: Dispatch<SetStateAction<AdminActionFeedbackMessage | null>>
  refreshHistory: () => Promise<void>
  refreshAlerts: () => Promise<void>
  refreshAudit: () => Promise<void>
  onOperationComplete: () => void
}

export function useSecurityGovernanceOperations<TDraft extends object>({
  isZh,
  draft,
  hasInvalidDraft,
  highRiskChangeCount,
  setConfig,
  setDraft,
  toPatch,
  fromConfig,
  setFeedback,
  refreshHistory,
  refreshAlerts,
  refreshAudit,
  onOperationComplete,
}: Options<TDraft>) {
  const [saving, setSaving] = useState(false)
  const [confirmingSave, setConfirmingSave] = useState(false)
  const [rollingBackEventId, setRollingBackEventId] = useState<string | null>(null)

  const cancelSaveConfirmation = () => setConfirmingSave(false)

  const commit = async () => {
    const patch = toPatch(draft)
    if (!patch) {
      setFeedback({ kind: 'error', text: isZh ? '请填写有效的正整数策略值。' : 'Enter positive integer policy values.' })
      return
    }
    setSaving(true)
    setConfirmingSave(false)
    try {
      const updated = await mediaService.updateGovernancePolicy(patch)
      setConfig(updated)
      setDraft(fromConfig(updated))
      void refreshHistory()
      void refreshAlerts()
      void refreshAudit()
      setFeedback({ kind: 'success', text: isZh ? '已更新媒体治理策略。' : 'Updated media governance policy.' })
    } catch (error) {
      console.info('[media-service]', error)
      setFeedback({ kind: 'error', text: isZh ? '媒体治理策略保存失败。' : 'Could not save media governance policy.' })
    } finally {
      setSaving(false)
    }
  }

  const save = async () => {
    if (hasInvalidDraft) {
      setFeedback({ kind: 'error', text: isZh ? '请先修正无效的策略值。' : 'Fix invalid policy values before saving.' })
      return
    }
    if (highRiskChangeCount > 0) {
      setConfirmingSave(true)
      setFeedback({ kind: 'success', text: isZh ? '请确认高风险媒体治理策略变更。' : 'Confirm high-risk media governance policy changes.' })
      return
    }
    await commit()
  }

  const rollback = async (eventId: string) => {
    setRollingBackEventId(eventId)
    try {
      const updated = await mediaService.rollbackGovernancePolicy(eventId)
      setConfig(updated)
      setDraft(fromConfig(updated))
      void refreshHistory()
      void refreshAlerts()
      void refreshAudit()
      onOperationComplete()
      setFeedback({ kind: 'success', text: isZh ? '已回滚媒体治理策略。' : 'Rolled back media governance policy.' })
    } catch (error) {
      console.info('[media-service]', error)
      setFeedback({ kind: 'error', text: isZh ? '媒体治理策略回滚失败。' : 'Could not roll back media governance policy.' })
    } finally {
      setRollingBackEventId(null)
    }
  }

  return {
    state: { saving, confirmingSave, rollingBackEventId },
    actions: { save, commit, rollback, cancelSaveConfirmation },
  }
}
