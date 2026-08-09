import { useMemo, useState } from 'react'

import type {
  AdminAccountingIssueDto,
  AdminAccountingIssueStatus,
  AdminAccountingIssueSummary,
  AdminAccountingReconciliationQuery,
  AdminAccountingUnit,
  AdminBillingMetrics,
  AdminBillingMetricsQuery,
  AdminBillingPolicyInventory,
  AdminBillingPolicyPreview,
  PersonalBillingEntry,
  PersonalBillingSummary,
  PointAdjustmentPolicy,
  PointAdjustmentPolicyHistoryItem,
} from '../../services/contracts'
import type { AdminActionFeedbackMessage } from './AdminActionFeedback'

export const pointPolicyRoles: Array<keyof PointAdjustmentPolicy['roleLimits']> = ['member', 'creator', 'publisher', 'moderator', 'admin']

export function useAdminAccountingState() {
  const [issues, setIssues] = useState<AdminAccountingIssueDto[]>([])
  const [summary, setSummary] = useState<AdminAccountingIssueSummary>({ total: 0, open: 0, repairPending: 0, resolved: 0, ignored: 0 })
  const [generatedAt, setGeneratedAt] = useState('')
  const [statusFilter, setStatusFilter] = useState<AdminAccountingIssueStatus | null>('open')
  const [unitFilter, setUnitFilter] = useState<AdminAccountingUnit | null>(null)
  const [typeFilter, setTypeFilter] = useState('')
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [requestingRepairId, setRequestingRepairId] = useState<string | null>(null)
  const [billingMetrics, setBillingMetrics] = useState<AdminBillingMetrics | null>(null)
  const [personalSummary, setPersonalSummary] = useState<PersonalBillingSummary | null>(null)
  const [personalEntries, setPersonalEntries] = useState<PersonalBillingEntry[]>([])
  const [policies, setPolicies] = useState<AdminBillingPolicyInventory | null>(null)
  const [preview, setPreview] = useState<AdminBillingPolicyPreview | null>(null)
  const [billingUnitFilter, setBillingUnitFilter] = useState<AdminAccountingUnit | null>(null)
  const [billingSourceType, setBillingSourceType] = useState('')
  const [billingDateFrom, setBillingDateFrom] = useState('')
  const [billingDateTo, setBillingDateTo] = useState('')
  const [previewingPolicy, setPreviewingPolicy] = useState(false)
  const [exportingMetrics, setExportingMetrics] = useState(false)
  const [pointPolicy, setPointPolicy] = useState<PointAdjustmentPolicy | null>(null)
  const [policyRoleLimits, setPolicyRoleLimits] = useState<Record<string, string>>({})
  const [policyReasonCodes, setPolicyReasonCodes] = useState('')
  const [policyApprovalTemplates, setPolicyApprovalTemplates] = useState('')
  const [policyHistory, setPolicyHistory] = useState<PointAdjustmentPolicyHistoryItem[]>([])
  const [savingPointPolicy, setSavingPointPolicy] = useState(false)
  const [rollingBackPolicy, setRollingBackPolicy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<AdminActionFeedbackMessage | null>(null)

  const query = useMemo<AdminAccountingReconciliationQuery>(() => ({
    status: statusFilter,
    unit: unitFilter,
    type: typeFilter || null,
    limit: 20,
  }), [statusFilter, typeFilter, unitFilter])

  const metricsQuery = useMemo<AdminBillingMetricsQuery>(() => ({
    unit: billingUnitFilter,
    sourceType: billingSourceType || null,
    dateFrom: billingDateFrom || null,
    dateTo: billingDateTo || null,
  }), [billingDateFrom, billingDateTo, billingSourceType, billingUnitFilter])

  return {
    state: { issues, summary, generatedAt, statusFilter, unitFilter, typeFilter, selectedIssueId,
      scanning, exporting, requestingRepairId, billingMetrics, personalSummary, personalEntries,
      policies, preview, billingUnitFilter, billingSourceType, billingDateFrom, billingDateTo,
      previewingPolicy, exportingMetrics, pointPolicy, policyRoleLimits, policyReasonCodes,
      policyApprovalTemplates, policyHistory, savingPointPolicy, rollingBackPolicy, feedback, query, metricsQuery },
    setters: { setIssues, setSummary, setGeneratedAt, setStatusFilter, setUnitFilter, setTypeFilter,
      setSelectedIssueId, setScanning, setExporting, setRequestingRepairId, setBillingMetrics,
      setPersonalSummary, setPersonalEntries, setPolicies, setPreview, setBillingUnitFilter,
      setBillingSourceType, setBillingDateFrom, setBillingDateTo, setPreviewingPolicy,
      setExportingMetrics, setPointPolicy, setPolicyRoleLimits, setPolicyReasonCodes,
      setPolicyApprovalTemplates, setPolicyHistory, setSavingPointPolicy, setRollingBackPolicy, setFeedback },
  }
}
