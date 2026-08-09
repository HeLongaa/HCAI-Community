import type { Dispatch, SetStateAction } from 'react'

import { adminService } from '../../services/adminService'
import type {
  AdminAccountingIssueDto,
  AdminAccountingIssueSummary,
  AdminAccountingReconciliationQuery,
  AdminBillingPolicyPreview,
  AdminReviewQueueItemDto,
  PointAdjustmentPolicy,
} from '../../services/contracts'
import type { AdminActionFeedbackMessage } from './AdminActionFeedback'
import { pointPolicyRoles } from './useAdminAccountingState'

export const accountingIssueCanRepair = (issue: AdminAccountingIssueDto) =>
  issue.status === 'open' && (
    (issue.type === 'point_balance_drift' && issue.sourceType === 'internal_point_account') ||
    (issue.type === 'quota_state_mismatch' && issue.sourceType === 'creative_quota_window')
  )

type Options = {
  isZh: boolean
  canScan: boolean
  canRepair: boolean
  canPreviewPolicy: boolean
  canManagePolicy: boolean
  query: AdminAccountingReconciliationQuery
  scanning: boolean
  requestingRepairId: string | null
  previewingPolicy: boolean
  pointPolicy: PointAdjustmentPolicy | null
  billingPolicyFallback: PointAdjustmentPolicy | null
  policyRoleLimits: Record<string, string>
  policyReasonCodes: string
  policyApprovalTemplates: string
  savingPointPolicy: boolean
  rollingBackPolicy: string | null
  setIssues: Dispatch<SetStateAction<AdminAccountingIssueDto[]>>
  setSummary: Dispatch<SetStateAction<AdminAccountingIssueSummary>>
  setGeneratedAt: Dispatch<SetStateAction<string>>
  setScanning: Dispatch<SetStateAction<boolean>>
  setRequestingRepairId: Dispatch<SetStateAction<string | null>>
  setPreview: Dispatch<SetStateAction<AdminBillingPolicyPreview | null>>
  setPreviewingPolicy: Dispatch<SetStateAction<boolean>>
  setPointPolicy: Dispatch<SetStateAction<PointAdjustmentPolicy | null>>
  setPolicyRoleLimits: Dispatch<SetStateAction<Record<string, string>>>
  setPolicyReasonCodes: Dispatch<SetStateAction<string>>
  setPolicyApprovalTemplates: Dispatch<SetStateAction<string>>
  setSavingPointPolicy: Dispatch<SetStateAction<boolean>>
  setRollingBackPolicy: Dispatch<SetStateAction<string | null>>
  setQueueItems: Dispatch<SetStateAction<AdminReviewQueueItemDto[]>>
  setReviewQueueFilter: Dispatch<SetStateAction<string | null>>
  refreshQueue: () => Promise<void>
  refreshAudit: () => Promise<void>
  refreshPolicyHistory: () => Promise<void>
  refreshNotifications: () => Promise<void>
  setFeedback: Dispatch<SetStateAction<AdminActionFeedbackMessage | null>>
}

const policyFromDraft = (
  policyRoleLimits: Record<string, string>,
  policyReasonCodes: string,
  policyApprovalTemplates: string,
) => ({
  roleLimits: Object.fromEntries(pointPolicyRoles.map((role) => [role, Number.parseInt(policyRoleLimits[role] ?? '0', 10)])) as PointAdjustmentPolicy['roleLimits'],
  reasonCodes: policyReasonCodes.split(',').map((item) => item.trim()).filter(Boolean),
  approvalTemplates: policyApprovalTemplates.split('\n').map((item) => item.trim()).filter(Boolean),
})

export function useAdminAccountingOperations({
  isZh,
  canScan,
  canRepair,
  canPreviewPolicy,
  canManagePolicy,
  query,
  scanning,
  requestingRepairId,
  previewingPolicy,
  pointPolicy,
  billingPolicyFallback,
  policyRoleLimits,
  policyReasonCodes,
  policyApprovalTemplates,
  savingPointPolicy,
  rollingBackPolicy,
  setIssues,
  setSummary,
  setGeneratedAt,
  setScanning,
  setRequestingRepairId,
  setPreview,
  setPreviewingPolicy,
  setPointPolicy,
  setPolicyRoleLimits,
  setPolicyReasonCodes,
  setPolicyApprovalTemplates,
  setSavingPointPolicy,
  setRollingBackPolicy,
  setQueueItems,
  setReviewQueueFilter,
  refreshQueue,
  refreshAudit,
  refreshPolicyHistory,
  refreshNotifications,
  setFeedback,
}: Options) {
  const syncPointPolicyDraft = (policy: PointAdjustmentPolicy) => {
    setPointPolicy(policy)
    setPolicyRoleLimits(Object.fromEntries(pointPolicyRoles.map((role) => [role, String(policy.roleLimits[role] ?? 0)])))
    setPolicyReasonCodes(policy.reasonCodes.join(', '))
    setPolicyApprovalTemplates(policy.approvalTemplates.join('\n'))
  }

  const scan = async () => {
    if (!canScan || scanning) return
    setScanning(true)
    setFeedback(null)
    try {
      const page = await adminService.scanAccountingReconciliation(query)
      setIssues(page.items)
      setSummary(page.summary)
      setGeneratedAt(page.generatedAt)
      setFeedback({ kind: 'success', text: isZh ? `对账扫描完成：${page.summary.open} 个未解决问题。` : `Accounting scan complete: ${page.summary.open} open issue(s).` })
    } catch (error) {
      console.info('[admin-service]', error)
      setFeedback({ kind: 'error', text: error instanceof Error ? error.message : (isZh ? '内部对账扫描失败。' : 'Internal accounting scan failed.') })
    } finally {
      setScanning(false)
    }
  }

  const previewPolicy = async () => {
    if (!canPreviewPolicy || previewingPolicy) return
    const candidate = pointPolicy
      ? policyFromDraft(policyRoleLimits, policyReasonCodes, policyApprovalTemplates)
      : billingPolicyFallback
    if (!candidate) {
      setFeedback({ kind: 'error', text: isZh ? '当前账务策略不可用。' : 'The current billing policy is unavailable.' })
      return
    }
    setPreviewingPolicy(true)
    setFeedback(null)
    try {
      setPreview(await adminService.previewBillingPointPolicy(candidate))
      setFeedback({ kind: 'success', text: isZh ? '账务策略影响预览已生成。' : 'Billing policy impact preview generated.' })
    } catch (error) {
      console.info('[admin-service]', error)
      setFeedback({ kind: 'error', text: error instanceof Error ? error.message : (isZh ? '账务策略影响预览失败。' : 'Could not preview billing policy impact.') })
    } finally {
      setPreviewingPolicy(false)
    }
  }

  const requestRepair = async (issue: AdminAccountingIssueDto) => {
    if (!canRepair || requestingRepairId || !accountingIssueCanRepair(issue)) return
    setRequestingRepairId(issue.id)
    setFeedback(null)
    try {
      const result = await adminService.requestAccountingRepair(issue.id, {
        repairKind: 'compensation',
        reasonCode: issue.type === 'point_balance_drift' ? 'repair_balance_drift' : 'repair_missing_movement',
        reason: `Compensate ${issue.issueKey} without rewriting historical accounting evidence.`,
      })
      setIssues((current) => current.map((item) => item.id === issue.id ? result.issue : item))
      setSummary((current) => ({
        ...current,
        open: Math.max(0, current.open - 1),
        repairPending: current.repairPending + 1,
      }))
      setQueueItems((current) => [result.review, ...current.filter((item) => item.id !== result.review.id)])
      setReviewQueueFilter('accounting_reconciliation')
      void refreshQueue()
      void refreshAudit()
      setFeedback({ kind: 'success', text: isZh ? '补偿申请已提交双人审批。' : 'Compensation request sent for dual review.' })
    } catch (error) {
      console.info('[admin-service]', error)
      setFeedback({ kind: 'error', text: error instanceof Error ? error.message : (isZh ? '补偿申请失败。' : 'Could not request compensation.') })
    } finally {
      setRequestingRepairId(null)
    }
  }

  const savePointPolicy = async () => {
    if (!canManagePolicy || !pointPolicy || savingPointPolicy) return
    const candidate = policyFromDraft(policyRoleLimits, policyReasonCodes, policyApprovalTemplates)
    if (pointPolicyRoles.some((role) => !Number.isInteger(candidate.roleLimits[role]) || candidate.roleLimits[role] < 0)) {
      setFeedback({ kind: 'error', text: isZh ? '请填写有效的角色额度。' : 'Enter valid role limits.' })
      return
    }
    if (candidate.reasonCodes.length === 0 || candidate.approvalTemplates.length === 0) {
      setFeedback({ kind: 'error', text: isZh ? '请至少保留一个原因分类和审批模板。' : 'Keep at least one reason code and approval template.' })
      return
    }
    setSavingPointPolicy(true)
    setFeedback(null)
    try {
      syncPointPolicyDraft(await adminService.updatePointPolicy(candidate))
      void refreshAudit()
      void refreshPolicyHistory()
      setFeedback({ kind: 'success', text: isZh ? '已更新积分调整策略。' : 'Updated point adjustment policy.' })
    } catch (error) {
      console.info('[admin-service]', error)
      setFeedback({ kind: 'error', text: error instanceof Error ? error.message : (isZh ? '积分策略保存失败。' : 'Could not save point policy.') })
    } finally {
      setSavingPointPolicy(false)
    }
  }

  const rollbackPointPolicy = async (eventId: string) => {
    if (!canManagePolicy || rollingBackPolicy) return
    setRollingBackPolicy(eventId)
    setFeedback(null)
    try {
      syncPointPolicyDraft(await adminService.rollbackPointPolicy(eventId))
      void refreshPolicyHistory()
      void refreshAudit()
      void refreshNotifications()
      setFeedback({ kind: 'success', text: isZh ? '已回滚积分调整策略。' : 'Rolled back point adjustment policy.' })
    } catch (error) {
      console.info('[admin-service]', error)
      setFeedback({ kind: 'error', text: error instanceof Error ? error.message : (isZh ? '积分策略回滚失败。' : 'Could not roll back point policy.') })
    } finally {
      setRollingBackPolicy(null)
    }
  }

  return {
    actions: {
      scan,
      previewPolicy,
      requestRepair,
      savePointPolicy,
      rollbackPointPolicy,
    },
  }
}
