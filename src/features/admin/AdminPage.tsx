import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, Archive, BarChart3, Bell, Clipboard, Download, Settings2, ShieldAlert, ShieldCheck, Trophy } from 'lucide-react'
import type { AdminDeepLink, AuditEvent, Page, Permission, Role, SimulateAction } from '../../domain/types'
import { SectionHeader } from '../../components/ui/SectionHeader'
import { NotificationList } from '../../components/ui/NotificationList'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { isZhCopy, pointText, textFor } from '../../domain/utils'
import { adminService } from '../../services/adminService'
import { notificationService } from '../../services/notificationService'
import { mediaService } from '../../services/mediaService'
import { useAsyncResource } from '../../hooks/useAsyncResource'
import { SubmissionReviewPanel } from './SubmissionReviewPanel'
import { SecurityWorkspaceNavigation } from './SecurityWorkspaceNavigation'
import { SecurityWorkspacePanel } from './SecurityWorkspacePanel'
import { SecurityIncidentsWorkspace } from './SecurityIncidentsWorkspace'
import { SecurityGovernanceWorkspace } from './SecurityGovernanceWorkspace'
import { SecurityMediaWorkspace } from './SecurityMediaWorkspace'
import { SecurityOperationsWorkspace, type OperationsSampleKey } from './SecurityOperationsWorkspace'
import { securityWorkspaces, type SecurityWorkspace } from './securityWorkspace'
import { useAdminSecurityResources } from './useAdminSecurityResources'
import { accountingIssueCanRepair, useAdminAccountingOperations } from './useAdminAccountingOperations'
import { pointPolicyRoles, useAdminAccountingState } from './useAdminAccountingState'
import { useAdminAuditOperations } from './useAdminAuditOperations'
import { useAdminAuditState } from './useAdminAuditState'
import { useAdminGenerationBulkOperations } from './useAdminGenerationBulkOperations'
import { useAdminGenerationOperations } from './useAdminGenerationOperations'
import { useAdminGenerationState, type GenerationOperationsWorkspace } from './useAdminGenerationState'
import { useSecurityGovernanceOperations } from './useSecurityGovernanceOperations'
import { useSecurityGovernanceState } from './useSecurityGovernanceState'
import { useSecurityIncidentOperations } from './useSecurityIncidentOperations'
import { useSecurityIncidentState } from './useSecurityIncidentState'
import { useSecurityMediaOperations } from './useSecurityMediaOperations'
import { useSecurityMediaState } from './useSecurityMediaState'
import { downloadJsonArtifact, downloadTextArtifact } from './downloadAdminArtifact'
import { AdminGenerationRecordsPanel } from './AdminGenerationRecordsPanel'
import { AdminGenerationRecoveryPanel } from './AdminGenerationRecoveryPanel'
import { AdminGenerationMetricsPanel } from './AdminGenerationMetricsPanel'
import { AdminGenerationWorkspacePanel } from './AdminGenerationWorkspacePanel'
import { AdminGenerationWorkspaceNavigation } from './AdminGenerationWorkspaceNavigation'
import { AdminProviderControlsPanel } from './AdminProviderControlsPanel'
import './admin-workspaces.css'
import './admin-generations.css'
import './admin-accounting.css'
import './admin-audit.css'
import { AdminActionFeedback, type AdminActionFeedbackMessage } from './AdminActionFeedback'
import { SecurityOperationConfirmation, type PendingSecurityOperation } from './SecurityOperationConfirmation'
import type {
  AdminPermissionDto,
  AdminAccountingIssueStatus,
  AdminAccountingUnit,
  AdminBillingMetrics,
  AdminBillingPolicyInventory,
  AdminCreativeGenerationSummary,
  AdminGenerationBusinessMetrics,
  AdminCreativeGenerationExecution,
  AdminOperationsMetricsDto,
  AdminProviderControlBundle,
  AdminReviewDecision,
  AdminReviewQueueItemDto,
  AdminRolePermissionDto,
  ApiCreativeGenerationRecord,
  ApiLedgerEntry,
  ApiMediaGovernanceConfig,
  ApiNotification,
  ApiPointsSummary,
  MediaGovernancePolicyPatch,
  NotificationListQuery,
  PointAdjustmentPolicy,
  PointAdjustmentPolicyHistoryItem,
  PointsLedgerQuery,
  PersonalBillingEntry,
  PersonalBillingSummary,
} from '../../services/contracts'

const AdminOverviewPanel = lazy(() => import('./AdminOverviewPanel').then((module) => ({ default: module.AdminOverviewPanel })))
const ReleaseControlPanel = lazy(() => import('./ReleaseControlPanel').then((module) => ({ default: module.ReleaseControlPanel })))
const ObservabilityPanel = lazy(() => import('./ObservabilityPanel').then((module) => ({ default: module.ObservabilityPanel })))
const SystemSettingsPanel = lazy(() => import('./SystemSettingsPanel').then((module) => ({ default: module.SystemSettingsPanel })))
const ConfigurationResourcesPanel = lazy(() => import('./ConfigurationResourcesPanel').then((module) => ({ default: module.ConfigurationResourcesPanel })))
const ModelControlPanel = lazy(() => import('./ModelControlPanel').then((module) => ({ default: module.ModelControlPanel })))
const OAuthAdminPanel = lazy(() => import('./OAuthAdminPanel').then((module) => ({ default: module.OAuthAdminPanel })))
const DeveloperAccessAdminPanel = lazy(() => import('./DeveloperAccessAdminPanel').then((module) => ({ default: module.DeveloperAccessAdminPanel })))
const WebhookAdminPanel = lazy(() => import('./WebhookAdminPanel').then((module) => ({ default: module.WebhookAdminPanel })))
const SupportAdminPanel = lazy(() => import('./SupportAdminPanel').then((module) => ({ default: module.SupportAdminPanel })))
const CommunityAdminPanel = lazy(() => import('./CommunityAdminPanel').then((module) => ({ default: module.CommunityAdminPanel })))
const InspirationAdminPanel = lazy(() => import('./InspirationAdminPanel').then((module) => ({ default: module.InspirationAdminPanel })))
const DataRightsAdminPanel = lazy(() => import('./DataRightsAdminPanel').then((module) => ({ default: module.DataRightsAdminPanel })))
const AuthSessionAdminPanel = lazy(() => import('./AuthSessionAdminPanel').then((module) => ({ default: module.AuthSessionAdminPanel })))
const TaskAdminPanel = lazy(() => import('./TaskAdminPanel').then((module) => ({ default: module.TaskAdminPanel })))
const EntitlementAdminPanel = lazy(() => import('./EntitlementAdminPanel').then((module) => ({ default: module.EntitlementAdminPanel })))
const UserAdminPanel = lazy(() => import('./UserAdminPanel').then((module) => ({ default: module.UserAdminPanel })))
const NotificationAdminPanel = lazy(() => import('./NotificationAdminPanel').then((module) => ({ default: module.NotificationAdminPanel })))
const AuditRetentionPanel = lazy(() => import('./AuditRetentionPanel').then((module) => ({ default: module.AuditRetentionPanel })))
const TrustSafetyWorkspace = lazy(() => import('./TrustSafetyWorkspace').then((module) => ({ default: module.TrustSafetyWorkspace })))

const notificationReadStates: Array<NonNullable<NotificationListQuery['readState']>> = ['unread', 'all', 'read']
const notificationTypes = ['task.proposal_submitted', 'task.proposal_accepted', 'task.proposal_rejected', 'task.submission_submitted', 'task.submission_resubmitted', 'task.revision_requested', 'task.submission_approved', 'task.submission_rejected', 'task.reward_settled', 'task.submission_stale', 'task.dispute_opened', 'task.dispute_received', 'points.adjustment.requested', 'points.adjustment.approved', 'points.adjustment.rejected', 'points.policy.updated', 'points.policy.rolled_back', 'media.governance_policy.updated', 'media.governance_policy.rolled_back', 'media.scan.review_required', 'media.scan.rejected', 'media.scan.retry_requested', 'media.scan.alert', 'security.event.alert']
const notificationResourceTypes = ['task', 'admin_review', 'point_adjustment_policy', 'media_governance_policy', 'media_asset', 'media_scan_alert', 'security_alert']
const operationsMetricWindows = [15, 60, 240, 1440]
const mediaScanHistoryPageSize = 6
const mediaPolicyDraftKeys = [
  'retryDelaySeconds',
  'timeoutSeconds',
  'maxAttempts',
  'workerIntervalSeconds',
  'historyRetentionDays',
  'historyRetentionMaxPerAsset',
  'storageCleanupRetentionDays',
  'windowMinutes',
  'callbackDenied',
  'dispatchFailed',
  'timeoutThreshold',
  'alertDeliveryFailed',
] as const
type MediaPolicyDraftKey = typeof mediaPolicyDraftKeys[number]
type MediaPolicyDraft = Record<MediaPolicyDraftKey, string>
type MediaPolicyImpactPreviewItem = {
  key: MediaPolicyDraftKey
  status: 'changed' | 'invalid'
  en: string
  zh: string
  from: string
  to: string
  impactEn: string
  impactZh: string
}
type MediaPolicyRiskItem = {
  key: MediaPolicyDraftKey
  en: string
  zh: string
  from: string
  to: string
  riskEn: string
  riskZh: string
}
const emptyMediaPolicyDraft = Object.fromEntries(mediaPolicyDraftKeys.map((key) => [key, ''])) as MediaPolicyDraft
const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const mediaGovernanceDiffFields = [
  { path: ['scanner', 'retryDelaySeconds'], en: 'Retry delay seconds', zh: '重试延迟秒' },
  { path: ['scanner', 'timeoutSeconds'], en: 'Scan timeout seconds', zh: '扫描超时秒' },
  { path: ['scanner', 'maxAttempts'], en: 'Max attempts', zh: '最大尝试' },
  { path: ['scanner', 'workerIntervalSeconds'], en: 'Worker interval seconds', zh: 'Worker 间隔秒' },
  { path: ['retention', 'historyRetentionDays'], en: 'Retention days', zh: '保留天数' },
  { path: ['retention', 'historyRetentionMaxPerAsset'], en: 'Max history per asset', zh: '单资产历史上限' },
  { path: ['retention', 'storageCleanupRetentionDays'], en: 'Object cleanup retention days', zh: '对象清理保留天数' },
  { path: ['alerts', 'windowMinutes'], en: 'Alert window minutes', zh: '告警窗口分钟' },
  { path: ['alerts', 'thresholds', 'callbackDenied'], en: 'Callback denied threshold', zh: '回调拒绝阈值' },
  { path: ['alerts', 'thresholds', 'dispatchFailed'], en: 'Dispatch failed threshold', zh: '派发失败阈值' },
  { path: ['alerts', 'thresholds', 'timeout'], en: 'Timeout threshold', zh: '超时阈值' },
  { path: ['alerts', 'thresholds', 'alertDeliveryFailed'], en: 'Alert delivery failed threshold', zh: '告警投递失败阈值' },
] as const
const isDiffChange = (value: unknown): value is { from: unknown; to: unknown } => {
  const record = asRecord(value)
  return 'from' in record && 'to' in record
}
const readDiffChange = (diff: unknown, path: readonly string[]) => {
  let current: unknown = diff
  for (const key of path) {
    current = asRecord(current)[key]
  }
  return isDiffChange(current) ? current : null
}
const formatDiffValue = (value: unknown) => {
  if (value == null || value === '') return 'unset'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
const mediaGovernanceDiffRows = (diff: unknown) =>
  mediaGovernanceDiffFields.flatMap((field) => {
    const change = readDiffChange(diff, field.path)
    return change ? [{
      key: field.path.join('.'),
      en: field.en,
      zh: field.zh,
      from: formatDiffValue(change.from),
      to: formatDiffValue(change.to),
    }] : []
  })
const formatMetadataJson = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
const auditEventShareUrl = (eventId: string) => {
  const hash = `admin/audit/${encodeURIComponent(eventId)}`
  if (typeof window === 'undefined') return `#${hash}`
  const url = new URL(window.location.href)
  url.hash = hash
  return url.toString()
}
const isOperationsMetricsExportAudit = (event: AuditEvent) =>
  event.action === 'admin.operations.metrics_exported' && event.resourceType === 'operations_metrics'
const metadataEntries = (metadata: Record<string, unknown>) =>
  Object.entries(metadata).filter(([key]) => !['diff', 'previous', 'next', 'summary'].includes(key))
const generationProviderCost = (generation: ApiCreativeGenerationRecord) => generation.usage?.providerCost ?? null
const mediaGovernancePreviewFields = [
  {
    key: 'retryDelaySeconds',
    en: 'Retry delay seconds',
    zh: '重试延迟秒',
    current: (config: ApiMediaGovernanceConfig) => config.scanner.retryDelaySeconds,
    impactEn: 'Scan retry scheduling for timed-out jobs.',
    impactZh: '影响超时扫描任务的重试调度。',
  },
  {
    key: 'timeoutSeconds',
    en: 'Scan timeout seconds',
    zh: '扫描超时秒',
    current: (config: ApiMediaGovernanceConfig) => config.scanner.timeoutSeconds,
    impactEn: 'Config projection and operator expectations; scan request dispatch remains environment-owned.',
    impactZh: '影响配置展示和运营预期；扫描请求派发仍由环境变量控制。',
  },
  {
    key: 'maxAttempts',
    en: 'Max attempts',
    zh: '最大尝试',
    current: (config: ApiMediaGovernanceConfig) => config.scanner.maxAttempts,
    impactEn: 'Sweep escalation from retrying to manual review.',
    impactZh: '影响巡检从重试升级到人工复核的时机。',
  },
  {
    key: 'workerIntervalSeconds',
    en: 'Worker interval seconds',
    zh: 'Worker 间隔秒',
    current: (config: ApiMediaGovernanceConfig) => config.scanner.workerIntervalSeconds,
    impactEn: 'Config projection for the sweep worker cadence.',
    impactZh: '影响巡检 Worker 频率的配置展示。',
  },
  {
    key: 'historyRetentionDays',
    en: 'Retention days',
    zh: '保留天数',
    current: (config: ApiMediaGovernanceConfig) => config.retention.historyRetentionDays,
    impactEn: 'Scan job history pruning cutoff.',
    impactZh: '影响扫描任务历史清理的时间边界。',
  },
  {
    key: 'historyRetentionMaxPerAsset',
    en: 'Max history per asset',
    zh: '单资产历史上限',
    current: (config: ApiMediaGovernanceConfig) => config.retention.historyRetentionMaxPerAsset,
    impactEn: 'Maximum retained scan history rows per media asset.',
    impactZh: '影响每个媒体资产保留的扫描历史数量。',
  },
  {
    key: 'storageCleanupRetentionDays',
    en: 'Object cleanup retention days',
    zh: '对象清理保留天数',
    current: (config: ApiMediaGovernanceConfig) => config.retention.storageCleanupRetentionDays,
    impactEn: 'Delay before soft-deleted private objects become eligible for physical deletion.',
    impactZh: '影响软删除私有对象进入物理清理的等待时间。',
  },
  {
    key: 'windowMinutes',
    en: 'Alert window minutes',
    zh: '告警窗口分钟',
    current: (config: ApiMediaGovernanceConfig) => config.alerts.windowMinutes,
    impactEn: 'Lookback window for scanner health alert aggregation.',
    impactZh: '影响扫描健康告警聚合的回看窗口。',
  },
  {
    key: 'callbackDenied',
    en: 'Callback denied threshold',
    zh: '回调拒绝阈值',
    current: (config: ApiMediaGovernanceConfig) => config.alerts.thresholds.callbackDenied,
    impactEn: 'Authentication failure spike alert trigger.',
    impactZh: '影响回调鉴权失败峰值告警触发。',
  },
  {
    key: 'dispatchFailed',
    en: 'Dispatch failed threshold',
    zh: '派发失败阈值',
    current: (config: ApiMediaGovernanceConfig) => config.alerts.thresholds.dispatchFailed,
    impactEn: 'Scanner dispatch failure spike alert trigger.',
    impactZh: '影响扫描派发失败峰值告警触发。',
  },
  {
    key: 'timeoutThreshold',
    en: 'Timeout threshold',
    zh: '超时阈值',
    current: (config: ApiMediaGovernanceConfig) => config.alerts.thresholds.timeout,
    impactEn: 'Timeout escalation spike alert trigger.',
    impactZh: '影响扫描超时升级峰值告警触发。',
  },
  {
    key: 'alertDeliveryFailed',
    en: 'Alert delivery failed threshold',
    zh: '告警投递失败阈值',
    current: (config: ApiMediaGovernanceConfig) => config.alerts.thresholds.alertDeliveryFailed,
    impactEn: 'External alert delivery failure spike trigger.',
    impactZh: '影响外部告警投递失败峰值触发。',
  },
] as const
const mediaGovernanceHighRiskRules: Partial<Record<MediaPolicyDraftKey, {
  risky: (current: number, draft: number) => boolean
  riskEn: string
  riskZh: string
}>> = {
  maxAttempts: {
    risky: (current, draft) => draft < current,
    riskEn: 'Lower max attempts can move active scan jobs to manual review sooner.',
    riskZh: '降低最大尝试次数会让扫描任务更早进入人工复核。',
  },
  historyRetentionDays: {
    risky: (current, draft) => draft < current,
    riskEn: 'Shorter retention may prune older scan history on the next sweep.',
    riskZh: '缩短保留天数可能在下次巡检时清理更早的扫描历史。',
  },
  historyRetentionMaxPerAsset: {
    risky: (current, draft) => draft < current,
    riskEn: 'Lower per-asset retention may prune additional scan history rows.',
    riskZh: '降低单资产历史上限可能清理更多扫描历史记录。',
  },
  storageCleanupRetentionDays: {
    risky: (current, draft) => draft < current,
    riskEn: 'Shorter object retention makes soft-deleted objects physically irreversible sooner.',
    riskZh: '缩短对象保留期会更早触发不可逆的物理删除。',
  },
  callbackDenied: {
    risky: (current, draft) => draft > current,
    riskEn: 'Higher callback-denied threshold can delay authentication failure alerts.',
    riskZh: '提高回调拒绝阈值可能延迟鉴权失败告警。',
  },
  dispatchFailed: {
    risky: (current, draft) => draft > current,
    riskEn: 'Higher dispatch-failed threshold can delay scanner dispatch failure alerts.',
    riskZh: '提高派发失败阈值可能延迟扫描派发失败告警。',
  },
  timeoutThreshold: {
    risky: (current, draft) => draft > current,
    riskEn: 'Higher timeout threshold can delay timeout escalation alerts.',
    riskZh: '提高超时阈值可能延迟扫描超时升级告警。',
  },
  alertDeliveryFailed: {
    risky: (current, draft) => draft > current,
    riskEn: 'Higher alert-delivery threshold can delay delivery failure visibility.',
    riskZh: '提高告警投递失败阈值可能延迟发现外部投递问题。',
  },
}
const mediaPolicyDraftFromConfig = (config: ApiMediaGovernanceConfig): MediaPolicyDraft => ({
  retryDelaySeconds: String(config.scanner.retryDelaySeconds),
  timeoutSeconds: String(config.scanner.timeoutSeconds),
  maxAttempts: String(config.scanner.maxAttempts),
  workerIntervalSeconds: String(config.scanner.workerIntervalSeconds),
  historyRetentionDays: String(config.retention.historyRetentionDays),
  historyRetentionMaxPerAsset: String(config.retention.historyRetentionMaxPerAsset),
  storageCleanupRetentionDays: String(config.retention.storageCleanupRetentionDays),
  windowMinutes: String(config.alerts.windowMinutes),
  callbackDenied: String(config.alerts.thresholds.callbackDenied),
  dispatchFailed: String(config.alerts.thresholds.dispatchFailed),
  timeoutThreshold: String(config.alerts.thresholds.timeout),
  alertDeliveryFailed: String(config.alerts.thresholds.alertDeliveryFailed),
})
const positiveDraftNumber = (value: string) => {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}
const mediaPolicyPatchFromDraft = (draft: MediaPolicyDraft): MediaGovernancePolicyPatch | null => {
  const values = Object.fromEntries(mediaPolicyDraftKeys.map((key) => [key, positiveDraftNumber(draft[key])])) as Record<MediaPolicyDraftKey, number | null>
  if (Object.values(values).some((value) => value == null)) {
    return null
  }
  return {
    scanner: {
      retryDelaySeconds: values.retryDelaySeconds ?? undefined,
      timeoutSeconds: values.timeoutSeconds ?? undefined,
      maxAttempts: values.maxAttempts ?? undefined,
      workerIntervalSeconds: values.workerIntervalSeconds ?? undefined,
    },
    retention: {
      historyRetentionDays: values.historyRetentionDays ?? undefined,
      historyRetentionMaxPerAsset: values.historyRetentionMaxPerAsset ?? undefined,
      storageCleanupRetentionDays: values.storageCleanupRetentionDays ?? undefined,
    },
    alerts: {
      windowMinutes: values.windowMinutes ?? undefined,
      thresholds: {
        callbackDenied: values.callbackDenied ?? undefined,
        dispatchFailed: values.dispatchFailed ?? undefined,
        timeout: values.timeoutThreshold ?? undefined,
        alertDeliveryFailed: values.alertDeliveryFailed ?? undefined,
      },
    },
  }
}

export function AdminPage({
  t,
  setPage,
  simulateAction,
  account,
  deepLink,
  onDeepLinkHandled,
  onOpenNotificationResource,
}: {
  t: Record<string, string>
  setPage: (page: Page) => void
  simulateAction: SimulateAction
  account: {
    hasPermission: (permission: Permission) => boolean
    permissions: Permission[]
    userRole: Role
  }
  deepLink?: AdminDeepLink | null
  onDeepLinkHandled?: () => void
  onOpenNotificationResource?: (notification: ApiNotification) => void
}) {
  const isZh = isZhCopy(t)
  const adminTabGroups = [
    { id: 'operations', label: textFor(t, 'Operations', '运营'), icon: Activity, tabs: ['Overview', 'Observability', 'Notifications', 'Support'] },
    { id: 'content', label: textFor(t, 'Content', '内容'), icon: Clipboard, tabs: ['Task review', 'Submissions', 'Community', 'Inspiration', 'Tags'] },
    { id: 'safety', label: textFor(t, 'Safety', '安全'), icon: ShieldCheck, tabs: ['Trust & Safety', 'Security', 'Audit log'] },
    { id: 'platform', label: textFor(t, 'Platform', '平台'), icon: Settings2, tabs: ['Settings', 'Access', 'Users', 'AI config', 'Release'] },
    { id: 'finance', label: textFor(t, 'Finance', '财务'), icon: BarChart3, tabs: ['Finance', 'Accounting', 'Generations'] },
  ]
  const adminTabs = adminTabGroups.flatMap((group) => group.tabs)
  const adminTabLabels: Record<string, string> = {
    Overview: textFor(t, 'Overview', '概览'),
    Observability: textFor(t, 'Observability', '可观测性'),
    Settings: textFor(t, 'Settings', '系统设置'),
    Notifications: textFor(t, 'Notifications', '通知'),
    Support: textFor(t, 'Support', '支持'),
    'Trust & Safety': textFor(t, 'Trust & Safety', '信任与安全'),
    'Task review': textFor(t, 'Task review', '任务审核'),
    Access: textFor(t, 'Access', '权限'),
    Security: textFor(t, 'Security', '安全'),
    Finance: textFor(t, 'Finance', '账务'),
    Accounting: textFor(t, 'Accounting', '对账'),
    Generations: textFor(t, 'Generations', '生成历史'),
    Submissions: textFor(t, 'Submissions', '交付物'),
    Community: textFor(t, 'Community', '社区'),
    Inspiration: textFor(t, 'Inspiration', '灵感库'),
    'Audit log': textFor(t, 'Audit log', '审计日志'),
    Users: textFor(t, 'Users', '用户'),
    Tags: textFor(t, 'Tags', '标签'),
    'AI config': textFor(t, 'AI config', 'AI 配置'),
    Release: textFor(t, 'Release', '发布控制'),
  }
  const adminTabDescriptions: Record<string, string> = {
    Overview: textFor(t, 'Monitor operational health and open work across the product.', '查看产品运营状态与待处理工作。'),
    Observability: textFor(t, 'Inspect service health, alerts, and runtime diagnostics.', '检查服务健康、告警与运行诊断。'),
    Notifications: textFor(t, 'Manage system notifications, delivery, and preferences.', '管理系统通知、投递与偏好设置。'),
    Support: textFor(t, 'Review and resolve customer support requests.', '查看并处理用户支持请求。'),
    'Task review': textFor(t, 'Review task operations and moderation decisions.', '审核任务运营状态与治理决策。'),
    Submissions: textFor(t, 'Inspect submitted work and delivery status.', '检查用户交付物与处理状态。'),
    Community: textFor(t, 'Operate published community content and reports.', '运营已发布的社区内容与举报。'),
    Inspiration: textFor(t, 'Maintain the governed inspiration catalog.', '维护受治理的灵感内容目录。'),
    Tags: textFor(t, 'Manage user and content classification tags.', '管理用户与内容分类标签。'),
    'Trust & Safety': textFor(t, 'Review risk cases, policies, and safety operations.', '处理风险案例、安全策略与治理工作。'),
    Security: textFor(t, 'Inspect security events and media governance controls.', '检查安全事件与媒体治理控制。'),
    'Audit log': textFor(t, 'Trace administrative changes and exportable evidence.', '追踪管理变更与可导出的审计证据。'),
    Settings: textFor(t, 'Manage runtime settings and configuration resources.', '管理运行设置与配置资源。'),
    Access: textFor(t, 'Control sessions, OAuth, developer access, and webhooks.', '控制会话、OAuth、开发者访问与 Webhook。'),
    Users: textFor(t, 'Manage accounts and data-rights operations.', '管理账号与数据权利操作。'),
    'AI config': textFor(t, 'Configure providers, models, routing, and evaluation gates.', '配置供应商、模型、路由与评估门禁。'),
    Release: textFor(t, 'Review release readiness and deployment controls.', '检查发布就绪状态与部署控制。'),
    Finance: textFor(t, 'Manage entitlements and product billing policy.', '管理产品权益与计费策略。'),
    Accounting: textFor(t, 'Reconcile ledger entries and accounting exceptions.', '核对账务流水与会计异常。'),
    Generations: textFor(t, 'Operate generation history, recovery, and provider controls.', '运营生成历史、恢复任务与供应商控制。'),
  }
  const [activeTab, setActiveTab] = useState(() => {
    const saved = typeof window === 'undefined' ? null : window.sessionStorage.getItem('hcaiAdminActiveTab')
    return saved && adminTabs.includes(saved) ? saved : 'Overview'
  })
  const activeAdminGroup = adminTabGroups.find((group) => group.tabs.includes(activeTab)) ?? adminTabGroups[0]
  useEffect(() => {
    window.sessionStorage.setItem('hcaiAdminActiveTab', activeTab)
  }, [activeTab])
  const selectAdminTab = (tab: string) => {
    setActiveTab(tab)
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('.admin-current-section-header')?.scrollIntoView({ block: 'start' })
    })
  }
  const [overviewTarget, setOverviewTarget] = useState<{ resourceType?: string | null; resourceId?: string | null } | null>(null)
  const [queueItems, setQueueItems] = useState<AdminReviewQueueItemDto[]>([])
  const [reviewQueueFilter, setReviewQueueFilter] = useState<string | null>(null)
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null)
  const [reviewingQueueItems, setReviewingQueueItems] = useState<Record<string, AdminReviewDecision>>({})
  const [reviewActionMessage, setReviewActionMessage] = useState<AdminActionFeedbackMessage | null>(null)
  const auditState = useAdminAuditState()
  const { events: auditEvents, expandedEventIds: expandedAuditEventIds, exporting: exportingAudit,
    integrity: auditIntegrity, archives: auditArchives, verifying: verifyingAudit, archiving: archivingAudit,
    actionFilter: auditActionFilter, resourceTypeFilter: auditResourceTypeFilter,
    resourceIdFilter: auditResourceIdFilter, actorTypeFilter: auditActorTypeFilter,
    actorIdFilter: auditActorIdFilter, dateFrom: auditDateFrom, dateTo: auditDateTo,
    direction: auditDirection, feedback: auditActionMessage, query: auditQuery } = auditState.state
  const { setEvents: setAuditEvents, setExpandedEventIds: setExpandedAuditEventIds,
    setExporting: setExportingAudit, setIntegrity: setAuditIntegrity, setArchives: setAuditArchives,
    setVerifying: setVerifyingAudit, setArchiving: setArchivingAudit,
    setActionFilter: setAuditActionFilter, setResourceTypeFilter: setAuditResourceTypeFilter,
    setResourceIdFilter: setAuditResourceIdFilter, setActorTypeFilter: setAuditActorTypeFilter,
    setActorIdFilter: setAuditActorIdFilter, setDateFrom: setAuditDateFrom,
    setDateTo: setAuditDateTo, setDirection: setAuditDirection, setFeedback: setAuditActionMessage } = auditState.setters
  const [permissions, setPermissions] = useState<AdminPermissionDto[]>([])
  const [notifications, setNotifications] = useState<ApiNotification[]>([])
  const [readingNotification, setReadingNotification] = useState<string | null>(null)
  const [notificationReadState, setNotificationReadState] = useState<NonNullable<NotificationListQuery['readState']>>('unread')
  const [notificationType, setNotificationType] = useState<string | null>(null)
  const [notificationResourceType, setNotificationResourceType] = useState<string | null>(null)
  const [rolePermissions, setRolePermissions] = useState<AdminRolePermissionDto[]>([])
  const [editingRole, setEditingRole] = useState<Role | null>(null)
  const [permissionDraft, setPermissionDraft] = useState<Permission[]>([])
  const [savingRole, setSavingRole] = useState<Role | null>(null)
  const [ledgerUserHandle, setLedgerUserHandle] = useState('promptlin')
  const [ledgerStatus, setLedgerStatus] = useState<PointsLedgerQuery['status']>(null)
  const [ledgerSearch, setLedgerSearch] = useState('')
  const [ledgerRows, setLedgerRows] = useState<ApiLedgerEntry[]>([])
  const [ledgerSummary, setLedgerSummary] = useState<ApiPointsSummary | null>(null)
  const accountingState = useAdminAccountingState()
  const { issues: accountingIssues, summary: accountingSummary, generatedAt: accountingGeneratedAt,
    statusFilter: accountingStatusFilter, unitFilter: accountingUnitFilter, typeFilter: accountingTypeFilter,
    selectedIssueId: selectedAccountingIssueId, scanning: scanningAccounting,
    exporting: exportingAccounting, requestingRepairId: requestingAccountingRepairId,
    billingMetrics, personalSummary: personalBillingSummary, personalEntries: personalBillingEntries,
    policies: billingPolicies, preview: billingPreview, billingUnitFilter, billingSourceType,
    billingDateFrom, billingDateTo, previewingPolicy: previewingBillingPolicy,
    exportingMetrics: exportingBillingMetrics, pointPolicy, policyRoleLimits, policyReasonCodes,
    policyApprovalTemplates, policyHistory, savingPointPolicy, rollingBackPolicy, feedback: accountingActionMessage, query: accountingQuery,
    metricsQuery: billingMetricsQuery } = accountingState.state
  const { setIssues: setAccountingIssues, setSummary: setAccountingSummary,
    setGeneratedAt: setAccountingGeneratedAt, setStatusFilter: setAccountingStatusFilter,
    setUnitFilter: setAccountingUnitFilter, setTypeFilter: setAccountingTypeFilter,
    setSelectedIssueId: setSelectedAccountingIssueId, setScanning: setScanningAccounting,
    setExporting: setExportingAccounting, setRequestingRepairId: setRequestingAccountingRepairId,
    setBillingMetrics, setPersonalSummary: setPersonalBillingSummary,
    setPersonalEntries: setPersonalBillingEntries, setPolicies: setBillingPolicies,
    setPreview: setBillingPreview, setBillingUnitFilter, setBillingSourceType, setBillingDateFrom,
    setBillingDateTo, setPreviewingPolicy: setPreviewingBillingPolicy,
    setExportingMetrics: setExportingBillingMetrics, setPointPolicy, setPolicyRoleLimits,
    setPolicyReasonCodes, setPolicyApprovalTemplates, setPolicyHistory, setSavingPointPolicy,
    setRollingBackPolicy, setFeedback: setAccountingActionMessage } = accountingState.setters

  const generationState = useAdminGenerationState()
  const { workspace: generationOperationsWorkspace, providerControls,
    providerControlReason, runningProviderControlAction, nextCursor: generationNextCursor,
    loadingMore: loadingMoreGenerations, selectedId: selectedGenerationId, selected: selectedGeneration,
    providerCostSettlementDraft, settlingProviderCost, loadingDetail: loadingGenerationDetail,
    userHandle: generationUserHandle,
    historyWorkspace: generationWorkspace, providerId: generationProviderId,
    statusFilter: generationStatusFilter, reviewFilter: generationReviewFilter,
    mediaAssetId: generationMediaAssetId, dateFrom: generationDateFrom, dateTo: generationDateTo,
    sort: generationSort, direction: generationDirection,
    metricsWorkspace: generationMetricsWorkspace, metricsProviderId: generationMetricsProviderId,
    metricsDateFrom: generationMetricsDateFrom, metricsDateTo: generationMetricsDateTo,
    exporting: exportingGenerations, exportingMetrics: exportingGenerationMetrics,
    mutationReason: generationMutationReason, mutationNote: generationMutationNote,
    replayStatus: generationReplayStatus, runningAction: runningGenerationAction,
    selectedIds: selectedGenerationIds, bulkAction: generationBulkAction,
    bulkPreview: generationBulkPreview, bulkConfirmation: generationBulkConfirmation,
    runningBulkAction: runningGenerationBulkAction,
    executions: generationExecutions, recoveringExecutionId: recoveringGenerationExecutionId,
    recoveryReason: generationRecoveryReason, recoveryError: generationRecoveryError,
    actionMessage: generationActionMessage,
    query: generationQuery, metricsQuery: generationMetricsQuery } = generationState.state
  const { setRows: setGenerationRows, setWorkspace: setGenerationOperationsWorkspace,
    setProviderControls, setProviderControlReason, setRunningProviderControlAction,
    setNextCursor: setGenerationNextCursor, setLoadingMore: setLoadingMoreGenerations,
    setSelectedId: setSelectedGenerationId, setSelected: setSelectedGeneration,
    setProviderCostSettlementDraft, setSettlingProviderCost,
    setLoadingDetail: setLoadingGenerationDetail, setDetailError: setGenerationDetailError,
    setUserHandle: setGenerationUserHandle, setHistoryWorkspace: setGenerationWorkspace,
    setProviderId: setGenerationProviderId, setStatusFilter: setGenerationStatusFilter,
    setReviewFilter: setGenerationReviewFilter, setMediaAssetId: setGenerationMediaAssetId,
    setDateFrom: setGenerationDateFrom, setDateTo: setGenerationDateTo,
    setSort: setGenerationSort, setDirection: setGenerationDirection, setSummary: setGenerationSummary,
    setMetricsWorkspace: setGenerationMetricsWorkspace, setMetricsProviderId: setGenerationMetricsProviderId,
    setMetricsDateFrom: setGenerationMetricsDateFrom, setMetricsDateTo: setGenerationMetricsDateTo,
    setMetricsSummary: setGenerationMetricsSummary, setBusinessMetrics: setGenerationBusinessMetrics,
    setExporting: setExportingGenerations, setExportingMetrics: setExportingGenerationMetrics,
    setRunningAction: setRunningGenerationAction,
    setSelectedIds: setSelectedGenerationIds, setBulkAction: setGenerationBulkAction,
    setBulkPreview: setGenerationBulkPreview, setBulkConfirmation: setGenerationBulkConfirmation,
    setBulkResult: setGenerationBulkResult, setRunningBulkAction: setRunningGenerationBulkAction,
    setExecutions: setGenerationExecutions, setRecoveringExecutionId: setRecoveringGenerationExecutionId,
    setRecoveryReason: setGenerationRecoveryReason, setRecoveryError: setGenerationRecoveryError,
    setActionMessage: setGenerationActionMessage } = generationState.setters
  const [adjustDelta, setAdjustDelta] = useState('100')
  const [adjustReason, setAdjustReason] = useState('')
  const [adjustReasonCode, setAdjustReasonCode] = useState('')
  const [adjustingPoints, setAdjustingPoints] = useState(false)
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({})
  const [exportingLedger, setExportingLedger] = useState(false)
  const [highlightedReviewId, setHighlightedReviewId] = useState<string | null>(null)
  const [highlightedPolicyEventId, setHighlightedPolicyEventId] = useState<string | null>(null)
  const [highlightedMediaAssetId, setHighlightedMediaAssetId] = useState<string | null>(null)
  const [highlightedAuditEventId, setHighlightedAuditEventId] = useState<string | null>(null)
  const mediaState = useSecurityMediaState()
  const { rows: mediaRows, status: mediaStatus, purpose: mediaPurpose, search: mediaSearch,
    selectedAssetId: selectedMediaAssetId, scanHistory: mediaScanHistory,
    scanHistoryNextCursor: mediaScanHistoryNextCursor, scanAlerts: mediaScanAlerts,
    callbackFailureEvents } = mediaState.state
  const { setRows: setMediaRows, setStatus: setMediaStatus, setPurpose: setMediaPurpose,
    setSearch: setMediaSearch, setSelectedAssetId: setSelectedMediaAssetId,
    setScanHistory: setMediaScanHistory, setScanHistoryNextCursor: setMediaScanHistoryNextCursor,
    setScanAlerts: setMediaScanAlerts, setCallbackFailureEvents } = mediaState.setters
  const governanceState = useSecurityGovernanceState<MediaPolicyDraft>(emptyMediaPolicyDraft)
  const { config: mediaGovernanceConfig, draft: mediaPolicyDraft, history: mediaPolicyHistory,
    expandedHistoryEventIds: expandedMediaPolicyEventIds } = governanceState.state
  const { setConfig: setMediaGovernanceConfig, setDraft: setMediaPolicyDraft,
    setHistory: setMediaPolicyHistory,
    setExpandedHistoryEventIds: setExpandedMediaPolicyEventIds } = governanceState.setters
  const incidentState = useSecurityIncidentState()
  const { alerts: securityAlerts, events: securityEvents, sourceFilter: securitySourceFilter,
    severityFilter: securitySeverityFilter, typeFilter: securityTypeFilter,
    nextCursor: securityNextCursor, incidents: securityIncidents, selectedOpenIncidentId,
    query: securityQuery } = incidentState.state
  const { setAlerts: setSecurityAlerts, setEvents: setSecurityEvents,
    setSourceFilter: setSecuritySourceFilter, setSeverityFilter: setSecuritySeverityFilter,
    setTypeFilter: setSecurityTypeFilter, setNextCursor: setSecurityNextCursor,
    setIncidents: setSecurityIncidents, setSelectedOpenIncidentId } = incidentState.setters
  const [highlightedSecurityAlertId, setHighlightedSecurityAlertId] = useState<string | null>(null)
  const [observabilityAlertId, setObservabilityAlertId] = useState<string | null>(null)
  const clearObservabilityAlertId = useCallback(() => setObservabilityAlertId(null), [])
  const [pendingSecurityOperation, setPendingSecurityOperation] = useState<PendingSecurityOperation | null>(null)
  const [securityOperationReason, setSecurityOperationReason] = useState('')
  const [securityOperationCritical, setSecurityOperationCritical] = useState(false)
  const [securityActionMessage, setSecurityActionMessage] = useState<AdminActionFeedbackMessage | null>(null)
  const [securityWorkspace, setSecurityWorkspace] = useState<SecurityWorkspace>(() => {
    const saved = typeof window === 'undefined' ? null : window.sessionStorage.getItem('hcaiSecurityWorkspace') as SecurityWorkspace | null
    return saved && securityWorkspaces.includes(saved) ? saved : 'overview'
  })
  const [operationsMetricsWindow, setOperationsMetricsWindow] = useState(60)
  const [operationsMetrics, setOperationsMetrics] = useState<AdminOperationsMetricsDto | null>(null)
  const [writingScanArchive, setWritingScanArchive] = useState(false)
  const [operationsSampleKey, setOperationsSampleKey] = useState<OperationsSampleKey | null>(null)
  const [operationsSamples, setOperationsSamples] = useState<AuditEvent[]>([])
  const [loadingOperationsSamples, setLoadingOperationsSamples] = useState(false)
  const [operationsSamplesError, setOperationsSamplesError] = useState<string | null>(null)
  const [exportingOperationsSnapshot, setExportingOperationsSnapshot] = useState(false)
  const canManagePermissions = account.hasPermission('admin:permissions:manage')
  const canAdjustPoints = account.hasPermission('points:adjust')
  const canReadQueues = account.hasPermission('admin:queue:read')
  const canReviewQueues = account.hasPermission('admin:queue:review')
  const canReadMedia = account.hasPermission('admin:media:read')
  const canManageMedia = account.hasPermission('admin:media:manage')
  const canExportMedia = account.hasPermission('admin:media:export')
  const canReadAudit = account.hasPermission('admin:audit:read')
  const canExportAudit = account.hasPermission('admin:audit:export')
  const canVerifyAudit = account.hasPermission('admin:audit:verify')
  const canArchiveAudit = account.hasPermission('admin:audit:archive')
  const canExecuteAuditRetention = account.hasPermission('admin:audit:retention')
  const canReadAccounting = account.hasPermission('admin:accounting:read')
  const canScanAccounting = account.hasPermission('admin:accounting:scan')
  const canRepairAccounting = account.hasPermission('admin:accounting:repair')
  const canCancelGenerations = account.hasPermission('admin:creative:cancel')
  const canRequestGenerationRetries = account.hasPermission('admin:creative:retry')
  const canRequestManualReplay = account.hasPermission('admin:creative:replay')
  const canReadProviderControls = account.hasPermission('admin:creative:provider-control:read')
  const canManageProviderControls = account.hasPermission('admin:creative:provider-control:manage')
  const canRecoverProviderControls = account.hasPermission('admin:creative:provider-control:recover')
  const canManageSecurityAlerts = account.hasPermission('security:alerts:manage')
  const ledgerQuery: PointsLedgerQuery = {
    userHandle: ledgerUserHandle,
    status: ledgerStatus,
    search: ledgerSearch,
    limit: 12,
  }
  const visibleQueueItems = reviewQueueFilter
    ? queueItems.filter((item) => item.queue === reviewQueueFilter)
    : queueItems
  const pointReviewCount = queueItems.filter((item) => item.queue === 'points' && !item.decision).length
  useEffect(() => {
    window.sessionStorage.setItem('hcaiSecurityWorkspace', securityWorkspace)
  }, [securityWorkspace])
  const notificationStatus = useAsyncResource<ApiNotification[]>({
    load: () => notificationService.list({
      readState: notificationReadState,
      type: notificationType,
      resourceType: notificationResourceType,
      limit: 8,
    }),
    onSuccess: (items) => setNotifications(items),
    getErrorMessage: () => (isZh ? '无法读取未读提醒。' : 'Could not load unread reminders.'),
    deps: [isZh, notificationReadState, notificationType, notificationResourceType],
    logLabel: 'notification-service',
  })
  const queueStatus = useAsyncResource<AdminReviewQueueItemDto[] | null>({
    load: () => activeTab === 'Submissions' ? adminService.reviews() : Promise.resolve(null),
    onSuccess: (items) => {
      if (!items) return
      setQueueItems(items)
    },
    getErrorMessage: () => (isZh ? '运营队列 API 暂不可用；未显示本地替代数据。' : 'The operations queue API is unavailable; no local substitute is shown.'),
    deps: [activeTab, isZh],
    logLabel: 'admin-service',
  })
  const auditStatus = useAsyncResource<AuditEvent[]>({
    load: () => adminService.audit(auditQuery),
    onSuccess: (events) => {
      setAuditEvents(events)
    },
    getErrorMessage: () => (isZh ? '无法读取审计日志，请确认已使用管理员账号登录。' : 'Could not load audit log. Sign in as an admin account.'),
    deps: [auditActionFilter, auditResourceTypeFilter, auditResourceIdFilter, auditActorTypeFilter, auditActorIdFilter, auditDateFrom, auditDateTo, auditDirection, isZh],
    logLabel: 'admin-service',
  })
  const {
    securityAlertStatus,
    securityStatus,
    securityIncidentStatus,
    operationsMetricsStatus,
    mediaReviewStatus,
    mediaGovernanceConfigStatus,
    mediaPolicyHistoryStatus,
    mediaScanHistoryStatus,
    mediaScanAlertStatus,
    callbackFailureStatus,
  } = useAdminSecurityResources({
    active: activeTab === 'Security',
    workspace: securityWorkspace,
    canReadAudit,
    canReadQueues,
    isZh,
    securityQuery,
    operationsMetricsWindow,
    mediaStatus,
    mediaPurpose,
    mediaSearch,
    selectedMediaAssetId,
    mediaScanHistoryPageSize,
    setSecurityAlerts,
    setSecurityEvents,
    setSecurityNextCursor,
    setSecurityIncidents,
    setSelectedOpenIncidentId,
    setOperationsMetrics,
    setMediaRows,
    onMediaGovernanceConfig: (config) => {
      setMediaGovernanceConfig(config)
      setMediaPolicyDraft(mediaPolicyDraftFromConfig(config))
    },
    setMediaPolicyHistory,
    setMediaScanHistory,
    setMediaScanHistoryNextCursor,
    setMediaScanAlerts,
    setCallbackFailureEvents,
  })
  const permissionsStatus = useAsyncResource<AdminPermissionDto[]>({
    load: () => adminService.permissions(),
    onSuccess: (items) => {
      setPermissions(items)
    },
    getErrorMessage: () => (isZh ? '无法读取权限目录，请确认账号具备审计读取权限。' : 'Could not load permission catalog. Confirm audit read access.'),
    deps: [isZh],
    logLabel: 'admin-service',
  })
  const rolesStatus = useAsyncResource<AdminRolePermissionDto[]>({
    load: () => adminService.roles(),
    onSuccess: (items) => {
      setRolePermissions(items)
    },
    getErrorMessage: () => (isZh ? '无法读取角色权限矩阵，请稍后重试。' : 'Could not load role permission matrix. Try again later.'),
    deps: [isZh],
    logLabel: 'admin-service',
  })
  const ledgerStatusResource = useAsyncResource<{ entries: ApiLedgerEntry[]; summary: ApiPointsSummary | null }>({
    load: () => canAdjustPoints
      ? adminService.pointLedger(ledgerQuery)
      : Promise.resolve({ entries: [], summary: null }),
    onSuccess: ({ entries, summary }) => {
      setLedgerRows(entries)
      setLedgerSummary(summary)
    },
    getErrorMessage: () => (isZh ? '无法读取用户账本，请确认账号具备积分调整权限。' : 'Could not load user ledger. Confirm points adjustment access.'),
    deps: [canAdjustPoints, isZh, ledgerUserHandle, ledgerStatus, ledgerSearch],
    logLabel: 'admin-service',
  })
  const accountingStatusResource = useAsyncResource<Awaited<ReturnType<typeof adminService.accountingReconciliation>>>({
    load: () => canReadAccounting
      ? adminService.accountingReconciliation(accountingQuery)
      : Promise.resolve({
          items: [],
          summary: { total: 0, open: 0, repairPending: 0, resolved: 0, ignored: 0 },
          generatedAt: '',
          nextCursor: null,
        }),
    onSuccess: (page) => {
      setAccountingIssues(page.items)
      setAccountingSummary(page.summary)
      setAccountingGeneratedAt(page.generatedAt)
      if (selectedAccountingIssueId && !page.items.some((issue) => issue.id === selectedAccountingIssueId)) {
        setSelectedAccountingIssueId(null)
      }
    },
    getErrorMessage: () => (isZh ? '无法读取内部对账结果。' : 'Could not load internal accounting reconciliation.'),
    deps: [canReadAccounting, isZh, accountingStatusFilter, accountingUnitFilter, accountingTypeFilter],
    logLabel: 'admin-service',
  })
  const billingMetricsStatus = useAsyncResource<AdminBillingMetrics | null>({
    load: () => canReadAccounting ? adminService.billingMetrics(billingMetricsQuery) : Promise.resolve(null),
    onSuccess: setBillingMetrics,
    getErrorMessage: () => (isZh ? '无法读取账务业务统计。' : 'Could not load accounting business metrics.'),
    deps: [canReadAccounting, isZh, billingUnitFilter, billingSourceType, billingDateFrom, billingDateTo],
    logLabel: 'admin-service',
  })
  const personalBillingStatus = useAsyncResource<{ summary: PersonalBillingSummary; items: PersonalBillingEntry[] } | null>({
    load: () => canReadAccounting && ledgerUserHandle.trim()
      ? Promise.all([
          adminService.personalBillingSummary(ledgerUserHandle.trim()),
          adminService.personalBillingLedger(ledgerUserHandle.trim(), { unit: billingUnitFilter, sourceType: billingSourceType || null, dateFrom: billingDateFrom || null, dateTo: billingDateTo || null, limit: 8, sort: 'desc' }),
        ]).then(([summary, page]) => ({ summary, items: page.items }))
      : Promise.resolve(null),
    onSuccess: (result) => { setPersonalBillingSummary(result?.summary ?? null); setPersonalBillingEntries(result?.items ?? []) },
    getErrorMessage: () => (isZh ? '无法读取所选用户账务明细。' : 'Could not load selected user billing details.'),
    deps: [canReadAccounting, isZh, ledgerUserHandle, billingUnitFilter, billingSourceType, billingDateFrom, billingDateTo],
    logLabel: 'admin-service',
  })
  const billingPolicyStatus = useAsyncResource<AdminBillingPolicyInventory | null>({
    load: () => canReadAccounting ? adminService.billingPolicies() : Promise.resolve(null),
    onSuccess: setBillingPolicies,
    getErrorMessage: () => (isZh ? '无法读取账务策略版本。' : 'Could not load accounting policy versions.'),
    deps: [canReadAccounting, isZh],
    logLabel: 'admin-service',
  })
  const generationHistoryStatus = useAsyncResource<{ items: ApiCreativeGenerationRecord[]; nextCursor: string | null; summary: AdminCreativeGenerationSummary } | null>({
    load: () => canReadAudit && activeTab === 'Generations' && generationOperationsWorkspace === 'records'
      ? Promise.all([adminService.creativeGenerations(generationQuery), adminService.creativeGenerationSummary(generationQuery)]).then(([page, summary]) => ({ ...page, summary }))
      : Promise.resolve(null),
    onSuccess: (result) => {
      if (!result) return
      const { items, nextCursor, summary } = result
      setGenerationRows(items)
      setGenerationNextCursor(nextCursor)
      setGenerationSummary(summary)
      if (selectedGenerationId && !items.some((item) => item.id === selectedGenerationId)) {
        setSelectedGenerationId(null)
        setSelectedGeneration(null)
        setGenerationDetailError(null)
      }
    },
    getErrorMessage: () => (isZh ? '无法读取生成历史，请确认账号具备审计读取权限。' : 'Could not load generation history. Confirm audit read access.'),
    deps: [canReadAudit, activeTab, generationOperationsWorkspace, isZh, generationUserHandle, generationWorkspace, generationProviderId, generationStatusFilter, generationReviewFilter, generationMediaAssetId, generationDateFrom, generationDateTo, generationSort, generationDirection],
    logLabel: 'admin-service',
  })
  const generationMetricsStatus = useAsyncResource<{ summary: AdminCreativeGenerationSummary; metrics: AdminGenerationBusinessMetrics } | null>({
    load: () => canReadAudit && activeTab === 'Generations' && generationOperationsWorkspace === 'metrics'
      ? Promise.all([adminService.creativeGenerationSummary(generationMetricsQuery), adminService.creativeGenerationBusinessMetrics(generationMetricsQuery)]).then(([summary, metrics]) => ({ summary, metrics }))
      : Promise.resolve(null),
    onSuccess: (result) => {
      if (!result) return
      setGenerationMetricsSummary(result.summary)
      setGenerationBusinessMetrics(result.metrics)
    },
    getErrorMessage: () => (isZh ? '无法读取生成业务指标。' : 'Could not load generation business metrics.'),
    deps: [canReadAudit, activeTab, generationOperationsWorkspace, isZh, generationMetricsWorkspace, generationMetricsProviderId, generationMetricsDateFrom, generationMetricsDateTo],
    logLabel: 'admin-service',
  })
  const generationExecutionStatus = useAsyncResource<AdminCreativeGenerationExecution[]>({
    load: () => canReadAudit && activeTab === 'Generations' && generationOperationsWorkspace === 'recovery' ? adminService.creativeGenerationExecutions() : Promise.resolve([]),
    onSuccess: setGenerationExecutions,
    getErrorMessage: () => (isZh ? '无法读取生成恢复队列。' : 'Could not load generation recovery queue.'),
    deps: [canReadAudit, activeTab, generationOperationsWorkspace, isZh],
    logLabel: 'admin-service',
  })
  const providerControlStatus = useAsyncResource<AdminProviderControlBundle>({
    load: () => canReadProviderControls && activeTab === 'Generations' && generationOperationsWorkspace === 'providers'
      ? adminService.providerControls()
      : Promise.resolve({ controls: [], circuits: [], capEvidence: [] }),
    onSuccess: setProviderControls,
    getErrorMessage: () => (isZh ? '无法读取 Provider 控制状态。' : 'Could not load Provider controls.'),
    deps: [canReadProviderControls, activeTab, generationOperationsWorkspace, isZh],
    logLabel: 'admin-service',
  })
  const pointPolicyStatus = useAsyncResource<PointAdjustmentPolicy | null>({
    load: () => canAdjustPoints ? adminService.pointPolicy() : Promise.resolve(null),
    onSuccess: (policy) => {
      if (!policy) return
      setPointPolicy(policy)
      setPolicyRoleLimits(Object.fromEntries(pointPolicyRoles.map((role) => [role, String(policy.roleLimits[role] ?? 0)])))
      setPolicyReasonCodes(policy.reasonCodes.join(', '))
      setPolicyApprovalTemplates(policy.approvalTemplates.join('\n'))
    },
    getErrorMessage: () => (isZh ? '无法读取积分策略。' : 'Could not load point policy.'),
    deps: [canAdjustPoints, isZh],
    logLabel: 'admin-service',
  })
  const pointPolicyHistoryStatus = useAsyncResource<PointAdjustmentPolicyHistoryItem[]>({
    load: () => canAdjustPoints ? adminService.pointPolicyHistory() : Promise.resolve([]),
    onSuccess: (items) => setPolicyHistory(items),
    getErrorMessage: () => (isZh ? '无法读取积分策略历史。' : 'Could not load point policy history.'),
    deps: [canAdjustPoints, isZh],
    logLabel: 'admin-service',
  })
  const mediaPolicyImpactPreview = useMemo<MediaPolicyImpactPreviewItem[]>(() => {
    if (!mediaGovernanceConfig) {
      return []
    }
    const items: MediaPolicyImpactPreviewItem[] = []
    for (const field of mediaGovernancePreviewFields) {
      const draftValue = mediaPolicyDraft[field.key]
      const parsed = positiveDraftNumber(draftValue)
      if (parsed == null) {
        items.push({
          key: field.key,
          status: 'invalid',
          en: field.en,
          zh: field.zh,
          from: String(field.current(mediaGovernanceConfig)),
          to: draftValue,
          impactEn: 'Policy values must be positive integers before saving.',
          impactZh: '策略值必须是正整数后才能保存。',
        })
        continue
      }
      const current = field.current(mediaGovernanceConfig)
      if (parsed === current) {
        continue
      }
      items.push({
        key: field.key,
        status: 'changed',
        en: field.en,
        zh: field.zh,
        from: String(current),
        to: String(parsed),
        impactEn: field.impactEn,
        impactZh: field.impactZh,
      })
    }
    return items
  }, [mediaGovernanceConfig, mediaPolicyDraft])
  const hasInvalidMediaPolicyDraft = mediaPolicyImpactPreview.some((item) => item.status === 'invalid')
  const highRiskMediaPolicyChanges = useMemo<MediaPolicyRiskItem[]>(() => {
    if (!mediaGovernanceConfig) {
      return []
    }
    const risks: MediaPolicyRiskItem[] = []
    for (const field of mediaGovernancePreviewFields) {
      const rule = mediaGovernanceHighRiskRules[field.key]
      if (!rule) {
        continue
      }
      const parsed = positiveDraftNumber(mediaPolicyDraft[field.key])
      if (parsed == null) {
        continue
      }
      const current = field.current(mediaGovernanceConfig)
      if (!rule.risky(current, parsed)) {
        continue
      }
      risks.push({
        key: field.key,
        en: field.en,
        zh: field.zh,
        from: String(current),
        to: String(parsed),
        riskEn: rule.riskEn,
        riskZh: rule.riskZh,
      })
    }
    return risks
  }, [mediaGovernanceConfig, mediaPolicyDraft])

  const generationBulkOperations = useAdminGenerationBulkOperations({
    isZh,
    canCancel: canCancelGenerations,
    canRequestRetries: canRequestGenerationRetries,
    selectedIds: selectedGenerationIds,
    action: generationBulkAction,
    preview: generationBulkPreview,
    confirmation: generationBulkConfirmation,
    reasonCode: generationMutationReason,
    note: generationMutationNote,
    running: runningGenerationBulkAction,
    setSelectedIds: setSelectedGenerationIds,
    setAction: setGenerationBulkAction,
    setPreview: setGenerationBulkPreview,
    setConfirmation: setGenerationBulkConfirmation,
    setResult: setGenerationBulkResult,
    setRunning: setRunningGenerationBulkAction,
    setFeedback: setGenerationActionMessage,
    refreshHistory: generationHistoryStatus.refresh,
  })
  const generationOperations = useAdminGenerationOperations({
    isZh,
    canRead: canReadAudit,
    canCancel: canCancelGenerations,
    canRequestRetries: canRequestGenerationRetries,
    canRepairAccounting,
    canManageProviderControls,
    canRecoverProviderControls,
    query: generationQuery,
    nextCursor: generationNextCursor,
    loadingMore: loadingMoreGenerations,
    selectedId: selectedGenerationId,
    selected: selectedGeneration,
    loadingDetail: loadingGenerationDetail,
    runningAction: runningGenerationAction,
    replayStatus: generationReplayStatus,
    mutationReason: generationMutationReason,
    mutationNote: generationMutationNote,
    providerCostSettlementDraft,
    settlingProviderCost,
    recoveringExecutionId: recoveringGenerationExecutionId,
    recoveryReason: generationRecoveryReason,
    recoveryError: generationRecoveryError,
    runningProviderControlAction,
    providerControlReason,
    setRows: setGenerationRows,
    setNextCursor: setGenerationNextCursor,
    setLoadingMore: setLoadingMoreGenerations,
    setSelectedId: setSelectedGenerationId,
    setSelected: setSelectedGeneration,
    setLoadingDetail: setLoadingGenerationDetail,
    setDetailError: setGenerationDetailError,
    setRunningAction: setRunningGenerationAction,
    setProviderCostSettlementDraft,
    setSettlingProviderCost,
    setRecoveringExecutionId: setRecoveringGenerationExecutionId,
    setRunningProviderControlAction,
    setFeedback: setGenerationActionMessage,
    refreshExecutions: generationExecutionStatus.refresh,
    refreshQueue: queueStatus.refresh,
    refreshAudit: auditStatus.refresh,
    refreshProviderControls: providerControlStatus.refresh,
  })
  const accountingOperations = useAdminAccountingOperations({
    isZh,
    canScan: canScanAccounting,
    canRepair: canRepairAccounting,
    canPreviewPolicy: canReadAccounting,
    canManagePolicy: canManagePermissions,
    query: accountingQuery,
    scanning: scanningAccounting,
    requestingRepairId: requestingAccountingRepairId,
    previewingPolicy: previewingBillingPolicy,
    pointPolicy,
    billingPolicyFallback: billingPolicies?.pointAdjustment.policy ?? null,
    policyRoleLimits,
    policyReasonCodes,
    policyApprovalTemplates,
    savingPointPolicy,
    rollingBackPolicy,
    setIssues: setAccountingIssues,
    setSummary: setAccountingSummary,
    setGeneratedAt: setAccountingGeneratedAt,
    setScanning: setScanningAccounting,
    setRequestingRepairId: setRequestingAccountingRepairId,
    setPreview: setBillingPreview,
    setPreviewingPolicy: setPreviewingBillingPolicy,
    setPointPolicy,
    setPolicyRoleLimits,
    setPolicyReasonCodes,
    setPolicyApprovalTemplates,
    setSavingPointPolicy,
    setRollingBackPolicy,
    setQueueItems,
    setReviewQueueFilter,
    refreshQueue: queueStatus.refresh,
    refreshAudit: auditStatus.refresh,
    refreshPolicyHistory: pointPolicyHistoryStatus.refresh,
    refreshNotifications: notificationStatus.refresh,
    setFeedback: setAccountingActionMessage,
  })
  const auditOperations = useAdminAuditOperations({
    isZh,
    canVerify: canVerifyAudit,
    canArchive: canArchiveAudit,
    verifying: verifyingAudit,
    archiving: archivingAudit,
    setIntegrity: setAuditIntegrity,
    setArchives: setAuditArchives,
    setVerifying: setVerifyingAudit,
    setArchiving: setArchivingAudit,
    refreshAudit: auditStatus.refresh,
    setFeedback: setAuditActionMessage,
  })

  const {
    toggleSelection: toggleGenerationSelection,
    changeAction: changeGenerationBulkAction,
    previewAction: previewGenerationBulkAction,
    executeAction: executeGenerationBulkAction,
  } = generationBulkOperations.actions
  const {
    loadMore: loadMoreGenerations,
    toggleDetail: toggleGenerationDetail,
    mutate: runGenerationMutation,
    settleProviderCost: settleSelectedProviderCost,
    recoverExecution: recoverGenerationExecution,
    runProviderControl: runProviderControlAction,
  } = generationOperations.actions
  const {
    scan: scanAccounting,
    previewPolicy: previewBillingPolicy,
    requestRepair: requestAccountingRepair,
    savePointPolicy,
    rollbackPointPolicy,
  } = accountingOperations.actions
  const {
    verifyIntegrity: verifyAuditIntegrity,
    archiveEvidence: archiveAuditEvidence,
  } = auditOperations.actions

  const incidentOperations = useSecurityIncidentOperations({
    isZh,
    canReadAudit,
    incidents: securityIncidents,
    selectedOpenIncidentId,
    nextCursor: securityNextCursor,
    query: securityQuery,
    setAlerts: setSecurityAlerts,
    setEvents: setSecurityEvents,
    setNextCursor: setSecurityNextCursor,
    setIncidents: setSecurityIncidents,
    setSelectedOpenIncidentId,
    setFeedback: setSecurityActionMessage,
    refreshAudit: auditStatus.refresh,
    refreshMetrics: operationsMetricsStatus.refresh,
    refreshAlerts: securityAlertStatus.refresh,
    refreshEvents: securityStatus.refresh,
    refreshIncidents: securityIncidentStatus.refresh,
    onOperationComplete: () => setPendingSecurityOperation(null),
  })
  const mediaOperations = useSecurityMediaOperations({
    isZh,
    selectedAssetId: selectedMediaAssetId,
    historyNextCursor: mediaScanHistoryNextCursor,
    historyPageSize: mediaScanHistoryPageSize,
    setRows: setMediaRows,
    setSelectedAssetId: setSelectedMediaAssetId,
    setHistory: setMediaScanHistory,
    setHistoryNextCursor: setMediaScanHistoryNextCursor,
    setAlerts: setMediaScanAlerts,
    setCallbackEvents: setCallbackFailureEvents,
    setFeedback: setSecurityActionMessage,
    refreshReview: mediaReviewStatus.refresh,
    refreshHistory: mediaScanHistoryStatus.refresh,
    refreshAlerts: mediaScanAlertStatus.refresh,
    refreshAudit: auditStatus.refresh,
    refreshMetrics: operationsMetricsStatus.refresh,
    onOperationComplete: () => setPendingSecurityOperation(null),
  })
  const governanceOperations = useSecurityGovernanceOperations({
    isZh,
    draft: mediaPolicyDraft,
    hasInvalidDraft: hasInvalidMediaPolicyDraft,
    highRiskChangeCount: highRiskMediaPolicyChanges.length,
    setConfig: setMediaGovernanceConfig,
    setDraft: setMediaPolicyDraft,
    toPatch: mediaPolicyPatchFromDraft,
    fromConfig: mediaPolicyDraftFromConfig,
    setFeedback: setSecurityActionMessage,
    refreshHistory: mediaPolicyHistoryStatus.refresh,
    refreshAlerts: mediaScanAlertStatus.refresh,
    refreshAudit: auditStatus.refresh,
    onOperationComplete: () => setPendingSecurityOperation(null),
  })
  const {
    handlingAlertId: handlingSecurityAlertId,
    selectedAlertId: selectedSecurityAlertId,
    exportingAlertId: exportingSecurityAlertId,
    alertEvents: securityAlertEvents,
    alertEventsLoading: loadingSecurityAlertEvents,
    alertEventsError: securityAlertEventsError,
    loadingMoreEvents: loadingMoreSecurityEvents,
    handlingIncidentId: handlingSecurityIncidentId,
  } = incidentOperations.state
  const {
    reviewingAssetId: reviewingMediaId,
    sweeping: sweepingMediaJobs,
    loadingMoreHistory: loadingMoreMediaScanHistory,
    handlingAlertId: handlingScanAlertId,
    selectedAlertId: selectedScanAlertId,
    alertEvents: scanAlertEvents,
    alertEventsLoading: loadingScanAlertEvents,
    alertEventsError: scanAlertEventsError,
  } = mediaOperations.state
  const {
    saving: savingMediaPolicy,
    confirmingSave: confirmingMediaPolicySave,
    rollingBackEventId: rollingBackMediaPolicy,
  } = governanceOperations.state
  const {
    refreshWorkspace: refreshSecurityIncidents,
    createIncident: createSecurityIncident,
    attachEvent: attachSecurityEventToIncident,
    resolveIncident: resolveSecurityIncident,
    acknowledgeAlert: acknowledgeSecurityAlert,
    silenceAlert: silenceSecurityAlert,
    unsilenceAlert: unsilenceSecurityAlert,
    openAlertEvents: openSecurityAlertEvents,
    toggleAlertEvents: toggleSecurityAlertEvents,
    exportAlert: exportSecurityAlert,
    loadMoreEvents: loadMoreSecurityEvents,
  } = incidentOperations.actions
  const {
    selectAsset: selectMediaAsset,
    reviewAsset: reviewMediaAsset,
    retryAsset: retryMediaAsset,
    loadMoreHistory: loadMoreMediaScanHistory,
    acknowledgeAlert: acknowledgeScanAlert,
    silenceAlert: silenceScanAlert,
    unsilenceAlert: unsilenceScanAlert,
    toggleAlertEvents: toggleScanAlertEvents,
    sweepJobs: sweepMediaJobs,
  } = mediaOperations.actions
  const {
    save: saveMediaGovernancePolicy,
    commit: commitMediaGovernancePolicy,
    rollback: rollbackMediaGovernancePolicy,
    cancelSaveConfirmation: cancelMediaPolicySaveConfirmation,
  } = governanceOperations.actions

  useEffect(() => {
    if (!deepLink) return
    const timer = window.setTimeout(() => {
      if (deepLink.tab) {
        setActiveTab(deepLink.tab)
      }
      if (deepLink.overviewResourceType || deepLink.overviewResourceId) {
        setOverviewTarget({ resourceType: deepLink.overviewResourceType, resourceId: deepLink.overviewResourceId })
      }
      if (deepLink.queue !== undefined) {
        setReviewQueueFilter(deepLink.queue)
      }
      if (deepLink.reviewId) {
        setActiveTab('Submissions')
        setReviewQueueFilter(deepLink.queue ?? 'points')
        setSelectedReviewId(deepLink.reviewId)
        setHighlightedReviewId(deepLink.reviewId)
      }
      if (deepLink.ledgerUserHandle) {
        setActiveTab('Finance')
        setLedgerUserHandle(deepLink.ledgerUserHandle)
      }
      if (deepLink.policyHistoryEventId) {
        setActiveTab('Finance')
        setHighlightedPolicyEventId(deepLink.policyHistoryEventId)
      }
      if (deepLink.auditEventId) {
        setActiveTab('Audit log')
        setAuditActionFilter('')
        setAuditResourceTypeFilter('')
        setHighlightedAuditEventId(deepLink.auditEventId)
        setExpandedAuditEventIds((current) => ({ ...current, [deepLink.auditEventId as string]: true }))
        void adminService.auditEvent(deepLink.auditEventId).then((event) => {
          setAuditEvents((current) => current.some((item) => item.id === event.id) ? current : [event, ...current])
        }).catch((error) => {
          console.info('[admin-service]', error)
        })
      }
      if (deepLink.securityAlertId) {
        setActiveTab('Security')
        setHighlightedSecurityAlertId(deepLink.securityAlertId)
        void openSecurityAlertEvents(deepLink.securityAlertId)
      }
      if (deepLink.observabilityAlertId) {
        setActiveTab('Observability')
        setObservabilityAlertId(deepLink.observabilityAlertId)
      }
      if (deepLink.mediaAssetId) {
        setMediaSearch(deepLink.mediaAssetId)
        setHighlightedMediaAssetId(deepLink.mediaAssetId)
        selectMediaAsset(deepLink.mediaAssetId)
      }
      if (deepLink.mediaStatus) {
        setMediaStatus(deepLink.mediaStatus)
      }
      simulateAction(
        isZh
          ? '已根据通知定位到相关运营区域。'
          : 'Focused the related operations area from the notification.',
      )
      onDeepLinkHandled?.()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [deepLink, isZh, onDeepLinkHandled, openSecurityAlertEvents, selectMediaAsset,
    setAuditActionFilter, setAuditEvents, setAuditResourceTypeFilter, setExpandedAuditEventIds,
    setMediaSearch, setMediaStatus, simulateAction])

  const formatAuditTime = (value: string) => {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString(isZh ? 'zh-CN' : 'en-US')
  }

  const formatMetricNumber = (value: number | null | undefined) =>
    new Intl.NumberFormat(isZh ? 'zh-CN' : 'en-US', { maximumFractionDigits: 0 }).format(Number(value ?? 0))

  const formatMetricAmount = (value: number | null | undefined) =>
    new Intl.NumberFormat(isZh ? 'zh-CN' : 'en-US', { maximumFractionDigits: 2 }).format(Number(value ?? 0))

  const formatProviderCostAmount = (amount: number | null | undefined, currency: string | null | undefined) =>
    amount == null ? '-' : `${currency ?? 'USD'} ${formatMetricAmount(amount)}`

  const formatProviderCostSummary = (generation: ApiCreativeGenerationRecord) => {
    const providerCost = generationProviderCost(generation)
    if (!providerCost) return textFor(t, 'cost unavailable', '成本不可用')
    const currency = providerCost.actual.currency ?? providerCost.estimate.currency ?? providerCost.budget.dailyCapCurrency
    const amount = providerCost.actual.amount ?? providerCost.estimate.amount
    const confidence = providerCost.actual.confidence ?? providerCost.estimate.confidence ?? textFor(t, 'unknown', '未知')
    return `${formatProviderCostAmount(amount, currency)} · ${confidence}`
  }

  const formatProviderBudgetSummary = (generation: ApiCreativeGenerationRecord) => {
    const providerCost = generationProviderCost(generation)
    if (!providerCost) return textFor(t, 'budget unavailable', '预算不可用')
    const budget = providerCost.budget
    const currency = budget.dailyCapCurrency ?? providerCost.estimate.currency ?? providerCost.actual.currency
    return [
      budget.status ?? textFor(t, 'unknown', '未知'),
      budget.budgetScope ?? '-',
      `${textFor(t, 'cap', '上限')} ${formatProviderCostAmount(budget.dailyCapAmount, currency)}`,
      `${textFor(t, 'projected', '预计')} ${formatProviderCostAmount(budget.projectedSpendAmount, currency)}`,
    ].join(' · ')
  }

  const formatMetricBytes = (value: number | null | undefined) => {
    const bytes = Number(value ?? 0)
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB']
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
    const amount = bytes / (1024 ** exponent)
    return `${amount >= 10 || exponent === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[exponent]}`
  }

  const formatMetricLatency = (value: number | null | undefined) => {
    if (value == null) return '-'
    if (value < 1000) return `${value} ms`
    const seconds = value / 1000
    if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 0 : 1)} s`
    const minutes = seconds / 60
    return `${minutes.toFixed(minutes >= 10 ? 0 : 1)} m`
  }

  const metricCountSummary = (items: AdminOperationsMetricsDto['security']['eventsBySource']) =>
    items.length > 0 ? items.slice(0, 3).map((item) => `${item.key} ${item.count}`).join(' · ') : '-'

  const metricCount = (items: AdminOperationsMetricsDto['security']['eventsBySource'], key: string) =>
    items.find((item) => item.key === key)?.count ?? 0

  const operationSampleConfig = (key: OperationsSampleKey) => ({
    securityDispatchFailures: {
      title: textFor(t, 'Security dispatch failure samples', '安全派发失败样本'),
      action: 'security.alert.dispatch',
      resourceType: 'security_alert',
      failedOnly: true,
    },
    mediaDispatchFailures: {
      title: textFor(t, 'Media dispatch failure samples', '媒体派发失败样本'),
      action: 'media.scan.alert.dispatch',
      resourceType: 'media_scan_alert',
      failedOnly: true,
    },
    archiveWrites: {
      title: textFor(t, 'Scan archive writes', '扫描归档写入记录'),
      action: 'media.scan.history_archived',
      resourceType: 'media_scan_jobs',
      failedOnly: false,
    },
    historyPruned: {
      title: textFor(t, 'Scan history prune records', '扫描历史清理记录'),
      action: 'media.scan.history_pruned',
      resourceType: 'media_scan_jobs',
      failedOnly: false,
    },
    creativeProviderBudgetThresholds: {
      title: textFor(t, 'Provider budget threshold samples', 'Provider 预算阈值样本'),
      action: 'creative.provider_budget.threshold_crossed',
      resourceType: 'creative_provider_budget',
      failedOnly: false,
    },
    creativeProviderBudgetDispatchBlocks: {
      title: textFor(t, 'Provider budget dispatch blocks', 'Provider 预算阻断样本'),
      action: 'creative.provider_budget.dispatch_blocked',
      resourceType: 'creative_provider_budget',
      failedOnly: false,
    },
    creativeProviderCostAnomalies: {
      title: textFor(t, 'Provider cost anomaly samples', 'Provider 成本异常样本'),
      action: 'creative.provider_cost.anomaly_detected',
      resourceType: 'creative_provider_budget',
      failedOnly: false,
    },
    creativeProviderAlertDispatches: {
      title: textFor(t, 'Provider alert dispatch samples', 'Provider 告警派发样本'),
      action: 'creative.provider_alert.dispatch',
      resourceType: 'creative_provider_budget_alert',
      failedOnly: false,
    },
  }[key])

  const operationSampleCountLabel = (key: string) => ({
    securityDispatchFailures: textFor(t, 'Security dispatch', '安全派发'),
    mediaDispatchFailures: textFor(t, 'Media dispatch', '媒体派发'),
    archiveWrites: textFor(t, 'Archive writes', '归档写入'),
    historyPruned: textFor(t, 'History pruned', '历史清理'),
    creativeProviderBudgetThresholds: textFor(t, 'Provider thresholds', 'Provider 阈值'),
    creativeProviderBudgetDispatchBlocks: textFor(t, 'Provider blocks', 'Provider 阻断'),
    creativeProviderCostAnomalies: textFor(t, 'Provider anomalies', 'Provider 异常'),
    creativeProviderAlertDispatches: textFor(t, 'Provider alert dispatches', 'Provider 告警派发'),
  }[key] ?? key)

  const operationSampleMetaEntries = (event: AuditEvent) => {
    const preferred = ['channel', 'status', 'statusCode', 'error', 'errorPreview', 'provider', 'providerId', 'workspace', 'budgetScope', 'severity', 'reasonCode', 'crossedThresholdPercent', 'usageRatioPercent', 'currency', 'storageKey', 'count', 'totalCandidates', 'bytes', 'pruned', 'alertType']
    const metadata = asRecord(event.metadata)
    const entries = preferred
      .filter((key) => metadata[key] != null && metadata[key] !== '')
      .map((key) => [key, metadata[key]] as const)
    if (entries.length > 0) {
      return entries.slice(0, 5)
    }
    return metadataEntries(metadata).slice(0, 5)
  }

  const loadOperationSamples = async (key: OperationsSampleKey, limit = 5) => {
    const config = operationSampleConfig(key)
    const events = await adminService.audit({
      action: config.action,
      resourceType: config.resourceType,
      limit: 20,
    })
    const filtered = config.failedOnly
      ? events.filter((event) => asRecord(event.metadata).status === 'failed')
      : events
    return filtered.slice(0, limit)
  }

  const buildOperationsHandoff = (metrics: AdminOperationsMetricsDto) => {
    const activeAlerts = metricCount(metrics.security.alerts.byState, 'active')
    const securityDeliveryFailures = metrics.security.deliveryFailures.total
    const mediaDeliveryFailures = metrics.mediaScan.alertDeliveryFailures.total
    const providerCriticalDispatchBlocks = metricCount(metrics.creativeProviderBudget.dispatchBlocked.bySeverity, 'critical')
    const providerAlertDispatchFailureSpike = metrics.creativeProviderBudget.providerAlertDispatches.failureSpike
    const providerThreshold100 = metrics.creativeProviderBudget.thresholdAlerts.byThreshold
      .filter((item) => Number(item.key) >= 100)
      .reduce((total, item) => total + item.count, 0)
    const providerCurrencyMismatches = metricCount(metrics.creativeProviderBudget.costAnomalies.byReason, 'currency_mismatch')
    const archiveCandidates = metrics.mediaScan.archiveCandidates.total
    const archiveWrites = metrics.mediaScan.archiveWrites.total
    const prunedJobs = metrics.mediaScan.historyPruned.jobs
    const ackLatencyMs = metrics.security.dispositions.acknowledgementLatency.averageMs
    const remediationHints = [
      ...(activeAlerts > 0 ? [{
        id: 'security-alerts-active',
        severity: 'warning',
        title: textFor(t, 'Active security alerts need disposition', '存在待处置安全告警'),
        reason: textFor(t, `${activeAlerts} active alert(s) in the selected window.`, `当前窗口存在 ${activeAlerts} 个活跃告警。`),
        recommendedActions: [
          textFor(t, 'Open the Security alerts list and review recent samples.', '打开安全告警列表并查看近期样本。'),
          textFor(t, 'Acknowledge confirmed incidents or silence noisy alerts with an expiry.', '确认真实事件，或为噪声告警设置有期限的静默。'),
        ],
        auditFilter: { resourceType: 'security_alert' },
      }] : []),
      ...(securityDeliveryFailures > 0 ? [{
        id: 'security-alert-delivery-failures',
        severity: 'critical',
        title: textFor(t, 'Check security alert delivery channels', '检查安全告警投递渠道'),
        reason: textFor(t, `${securityDeliveryFailures} security alert delivery failure(s) were recorded.`, `记录到 ${securityDeliveryFailures} 次安全告警投递失败。`),
        recommendedActions: [
          textFor(t, 'Verify SECURITY_ALERT webhook, Slack, and email channel configuration.', '核对 SECURITY_ALERT webhook、Slack 和邮件渠道配置。'),
          textFor(t, 'Compare channel, status code, and error metadata in dispatch audit samples.', '对比派发审计样本里的渠道、状态码和错误元数据。'),
        ],
        auditFilter: { action: 'security.alert.dispatch', resourceType: 'security_alert' },
      }] : []),
      ...(mediaDeliveryFailures > 0 ? [{
        id: 'media-alert-delivery-failures',
        severity: 'critical',
        title: textFor(t, 'Check media alert delivery channels', '检查媒体告警投递渠道'),
        reason: textFor(t, `${mediaDeliveryFailures} media alert delivery failure(s) were recorded.`, `记录到 ${mediaDeliveryFailures} 次媒体告警投递失败。`),
        recommendedActions: [
          textFor(t, 'Verify MEDIA_SCAN_ALERT webhook, Slack, and email endpoints.', '核对 MEDIA_SCAN_ALERT webhook、Slack 和邮件端点。'),
          textFor(t, 'Confirm channel secrets and timeout values before re-running scanner operations.', '重新执行扫描运营动作前，确认渠道密钥与超时配置。'),
        ],
        auditFilter: { action: 'media.scan.alert.dispatch', resourceType: 'media_scan_alert' },
      }] : []),
      ...(providerCriticalDispatchBlocks > 0 ? [{
        id: 'provider-budget-critical-dispatch-blocks',
        severity: 'critical',
        title: textFor(t, 'Keep provider budget kill switch active', '保持 Provider 预算熔断开启'),
        reason: textFor(t, `${providerCriticalDispatchBlocks} critical provider budget dispatch block(s) were recorded.`, `记录到 ${providerCriticalDispatchBlocks} 次 critical Provider 预算派发阻断。`),
        recommendedActions: [
          textFor(t, 'Review provider budget dispatch-block samples before allowing paid dispatch.', '允许付费派发前，先复核 Provider 预算阻断样本。'),
          textFor(t, 'Confirm app-side and provider-side caps still match the intended budget scope.', '确认应用侧和 Provider 侧 cap 仍匹配目标预算范围。'),
        ],
        auditFilter: { action: 'creative.provider_budget.dispatch_blocked', resourceType: 'creative_provider_budget' },
      }] : []),
      ...(providerAlertDispatchFailureSpike.active ? [{
        id: 'provider-alert-dispatch-failures',
        severity: 'warning',
        title: textFor(t, 'Check provider alert dispatch readiness', '检查 Provider 告警派发就绪度'),
        reason: textFor(t, `${providerAlertDispatchFailureSpike.failures} provider alert dispatch failure(s) reached the configured threshold of ${providerAlertDispatchFailureSpike.threshold}.`, `${providerAlertDispatchFailureSpike.failures} 次 Provider 告警派发失败已达到配置阈值 ${providerAlertDispatchFailureSpike.threshold}。`),
        recommendedActions: [
          textFor(t, 'Review provider alert dispatch samples by channel and reason.', '按渠道和原因复核 Provider 告警派发样本。'),
          textFor(t, 'Keep real external delivery disabled until approved clients are explicitly wired.', '在批准的 client 明确接入前，保持真实外部投递关闭。'),
        ],
        auditFilter: { action: 'creative.provider_alert.dispatch', resourceType: 'creative_provider_budget_alert' },
      }] : []),
      ...(providerThreshold100 > 0 ? [{
        id: 'provider-budget-threshold-100',
        severity: 'critical',
        title: textFor(t, 'Provider budget reached or exceeded cap', 'Provider 预算已达到或超过上限'),
        reason: textFor(t, `${providerThreshold100} provider budget threshold event(s) were at or above 100%.`, `有 ${providerThreshold100} 条 Provider 预算阈值事件达到或超过 100%。`),
        recommendedActions: [
          textFor(t, 'Check daily caps before re-enabling paid provider dispatch for the affected scope.', '为受影响范围重新开启付费 Provider 派发前，先检查每日 cap。'),
          textFor(t, 'Compare threshold samples with recent creative generation cost metadata.', '对比阈值样本和近期创意生成成本元数据。'),
        ],
        auditFilter: { action: 'creative.provider_budget.threshold_crossed', resourceType: 'creative_provider_budget' },
      }] : []),
      ...(providerCurrencyMismatches > 0 ? [{
        id: 'provider-cost-currency-mismatch',
        severity: 'critical',
        title: textFor(t, 'Block provider settlement until currency is normalized', '币种归一前阻止 Provider 结算'),
        reason: textFor(t, `${providerCurrencyMismatches} provider cost currency mismatch anomaly event(s) were recorded.`, `记录到 ${providerCurrencyMismatches} 条 Provider 成本币种不匹配异常。`),
        recommendedActions: [
          textFor(t, 'Review cost anomaly samples and adapter currency mapping.', '复核成本异常样本和适配器币种映射。'),
          textFor(t, 'Do not settle provider cost accounting until the expected and actual currency match.', '预期币种和实际币种一致前，不要结算 Provider 成本账。'),
        ],
        auditFilter: { action: 'creative.provider_cost.anomaly_detected', resourceType: 'creative_provider_budget' },
      }] : []),
      ...(archiveCandidates > 0 ? [{
        id: 'scan-archive-candidates',
        severity: 'info',
        title: textFor(t, 'Archive scan history before pruning', '清理前先归档扫描历史'),
        reason: textFor(t, `${archiveCandidates} scan history candidate(s) are eligible for cold archive.`, `有 ${archiveCandidates} 条扫描历史候选可冷归档。`),
        recommendedActions: [
          textFor(t, 'Write the archive manifest before running sweep pruning.', '运行巡检清理前先写入归档 manifest。'),
          textFor(t, 'Verify media.scan.history_archived before accepting prune results.', '确认 media.scan.history_archived 后再接受清理结果。'),
        ],
        auditFilter: { action: 'media.scan.history_archived', resourceType: 'media_scan_jobs' },
      }] : []),
      ...(archiveCandidates > 0 && archiveWrites === 0 ? [{
        id: 'scan-archive-not-yet-written',
        severity: 'warning',
        title: textFor(t, 'Archive candidates have no recent write', '归档候选暂无近期写入'),
        reason: textFor(t, 'Candidates exist, but no archive write is present in this metrics window.', '存在归档候选，但当前指标窗口内没有归档写入记录。'),
        recommendedActions: [
          textFor(t, 'Use Write archive from the metrics panel or run POST /api/media/scan-jobs/archive.', '使用指标面板的写入归档，或调用 POST /api/media/scan-jobs/archive。'),
        ],
        auditFilter: { action: 'media.scan.history_archived', resourceType: 'media_scan_jobs' },
      }] : []),
      ...(prunedJobs > 0 ? [{
        id: 'scan-history-pruned',
        severity: 'info',
        title: textFor(t, 'Review scan history prune volume', '复核扫描历史清理规模'),
        reason: textFor(t, `${prunedJobs} scan history job(s) were pruned.`, `已清理 ${prunedJobs} 条扫描历史任务。`),
        recommendedActions: [
          textFor(t, 'Compare prune count with archive write counts and retention policy.', '对比清理数量、归档写入数量和保留策略。'),
          textFor(t, 'If prune volume is unexpected, review MEDIA_SCAN_HISTORY_RETENTION_* settings.', '如果清理规模异常，复核 MEDIA_SCAN_HISTORY_RETENTION_* 设置。'),
        ],
        auditFilter: { action: 'media.scan.history_pruned', resourceType: 'media_scan_jobs' },
      }] : []),
      ...(ackLatencyMs != null && ackLatencyMs > 15 * 60 * 1000 ? [{
        id: 'security-ack-latency-high',
        severity: 'warning',
        title: textFor(t, 'Security acknowledgement latency is high', '安全告警确认延迟较高'),
        reason: textFor(t, `Average acknowledgement latency is ${formatMetricLatency(ackLatencyMs)}.`, `平均确认延迟为 ${formatMetricLatency(ackLatencyMs)}。`),
        recommendedActions: [
          textFor(t, 'Review on-call routing and notification delivery health.', '复核值班路由和通知投递健康状态。'),
          textFor(t, 'Check whether delivery failures delayed operator response.', '检查是否因投递失败延迟了运营响应。'),
        ],
        auditFilter: { action: 'security.alert.acknowledged', resourceType: 'security_alert' },
      }] : []),
    ]
    return {
      summary: textFor(
        t,
        `${remediationHints.length} handoff hint(s) generated for the ${metrics.window.minutes} minute window.`,
        `已为 ${metrics.window.minutes} 分钟窗口生成 ${remediationHints.length} 条交接建议。`,
      ),
      recommendedNextActions: remediationHints.slice(0, 3).flatMap((hint) => hint.recommendedActions.slice(0, 1)),
      remediationHints,
    }
  }

  const focusMediaGovernanceAudit = () => {
    setAuditActionFilter('')
    setAuditResourceTypeFilter('media_governance_policy')
    setHighlightedAuditEventId(null)
    setActiveTab('Audit log')
    simulateAction(isZh ? '已筛选媒体治理策略审计事件。' : 'Filtered media governance policy audit events.')
  }

  const focusAuditFilter = (action: string, resourceType: string, message: { en: string; zh: string }) => {
    setAuditActionFilter(action)
    setAuditResourceTypeFilter(resourceType)
    setHighlightedAuditEventId(null)
    setActiveTab('Audit log')
    simulateAction(isZh ? message.zh : message.en)
  }

  const focusMediaGovernanceFromMetrics = () => {
    setActiveTab('Security')
    setSecurityWorkspace('media')
    setMediaStatus('all')
    setMediaPurpose(null)
    setMediaSearch('')
  }

  const writeScanArchiveFromMetrics = async () => {
    setWritingScanArchive(true)
    try {
      const result = await mediaService.writeScanJobArchive({ limit: 100 })
      void operationsMetricsStatus.refresh()
      void auditStatus.refresh()
      setSecurityActionMessage({
        kind: 'success',
        text: isZh
          ? `扫描历史归档已写入：${result.storage?.storageKey ?? result.count}，候选 ${result.totalCandidates ?? result.count}`
          : `Scan history archive written: ${result.storage?.storageKey ?? result.count}, candidates ${result.totalCandidates ?? result.count}`,
      })
    } catch (error) {
      console.info('[media-service]', error)
      setSecurityActionMessage({ kind: 'error', text: isZh ? '扫描历史归档写入失败。' : 'Could not write scan history archive.' })
    } finally {
      setWritingScanArchive(false)
    }
  }

  const toggleOperationSamples = async (key: OperationsSampleKey) => {
    if (operationsSampleKey === key) {
      setOperationsSampleKey(null)
      setOperationsSamples([])
      setOperationsSamplesError(null)
      return
    }
    const config = operationSampleConfig(key)
    setOperationsSampleKey(key)
    setOperationsSamples([])
    setOperationsSamplesError(null)
    setLoadingOperationsSamples(true)
    try {
      const samples = await loadOperationSamples(key)
      setOperationsSamples(samples)
      setSecurityActionMessage({ kind: 'success', text: isZh ? `已读取${config.title}。` : `Loaded ${config.title}.` })
    } catch (error) {
      console.info('[admin-service]', error)
      setOperationsSamplesError(isZh ? '无法读取指标样本。' : 'Could not load metric samples.')
    } finally {
      setLoadingOperationsSamples(false)
    }
  }

  const exportOperationsSnapshot = async () => {
    if (!operationsMetrics) return
    setExportingOperationsSnapshot(true)
    try {
      const json = await adminService.exportOperationsMetricsJson(operationsMetrics.window.minutes)
      downloadTextArtifact({
        content: json,
        fileName: `operations-metrics-${operationsMetrics.window.minutes}m-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
        mimeType: 'application/json;charset=utf-8',
      })
      void auditStatus.refresh()
      setSecurityActionMessage({ kind: 'success', text: isZh ? '已导出运营指标快照。' : 'Exported operations metrics snapshot.' })
    } catch (error) {
      console.info('[admin-service]', error)
      setSecurityActionMessage({ kind: 'error', text: isZh ? '导出运营指标快照失败。' : 'Could not export operations metrics snapshot.' })
    } finally {
      setExportingOperationsSnapshot(false)
    }
  }

  const openOperationsMetricsFromAudit = (metadata: Record<string, unknown>) => {
    const windowMinutes = Number(metadata.windowMinutes ?? 60)
    const nextWindow = Number.isInteger(windowMinutes) && windowMinutes >= 5 && windowMinutes <= 1440
      ? windowMinutes
      : 60
    setOperationsMetricsWindow(nextWindow)
    setActiveTab('Security')
    if (nextWindow === operationsMetricsWindow) {
      void operationsMetricsStatus.refresh()
    }
    setSecurityActionMessage({
      kind: 'success',
      text: isZh
        ? `已切换到 ${nextWindow} 分钟运营指标窗口。`
        : `Opened the ${nextWindow} minute operations metrics window.`,
    })
  }

  const focusAuditEvent = (eventId: string, resourceType = '') => {
    setAuditActionFilter('')
    setAuditResourceTypeFilter(resourceType)
    setHighlightedAuditEventId(eventId)
    setExpandedAuditEventIds((current) => ({ ...current, [eventId]: true }))
    void adminService.auditEvent(eventId).then((event) => {
      setAuditEvents((current) => current.some((item) => item.id === event.id) ? current : [event, ...current])
    }).catch((error) => {
      console.info('[admin-service]', error)
    })
    setActiveTab('Audit log')
    simulateAction(isZh ? '已定位审计事件。' : 'Focused the audit event.')
  }

  const clearAuditFilters = () => {
    setAuditActionFilter('')
    setAuditResourceTypeFilter('')
    setAuditResourceIdFilter('')
    setAuditActorTypeFilter('all')
    setAuditActorIdFilter('')
    setAuditDateFrom('')
    setAuditDateTo('')
    setAuditDirection('desc')
    setHighlightedAuditEventId(null)
    simulateAction(isZh ? '已清除审计筛选。' : 'Cleared audit filters.')
  }

  const clearSecurityFilters = () => {
    setSecuritySourceFilter(null)
    setSecuritySeverityFilter('')
    setSecurityTypeFilter('')
    setSecurityNextCursor(null)
    setSecurityActionMessage({ kind: 'success', text: isZh ? '已清除安全事件筛选。' : 'Cleared security event filters.' })
  }

  const filterSecurityEventsBySource = (source: string) => {
    setSecuritySourceFilter(source)
    setSecuritySeverityFilter('')
    setSecurityTypeFilter('')
    setSecurityNextCursor(null)
    setSecurityActionMessage({ kind: 'success', text: isZh ? '已按告警来源筛选安全事件。' : 'Filtered security events by alert source.' })
  }

  const clearGenerationFilters = () => {
    setGenerationUserHandle('')
    setGenerationWorkspace('')
    setGenerationProviderId('')
    setGenerationStatusFilter('')
    setGenerationReviewFilter('all')
    setGenerationMediaAssetId('')
    setGenerationDateFrom('')
    setGenerationDateTo('')
    setGenerationSort('createdAt')
    setGenerationDirection('desc')
    setGenerationNextCursor(null)
    setSelectedGenerationId(null)
    setSelectedGeneration(null)
    setSelectedGenerationIds([])
    setGenerationBulkPreview(null)
    setGenerationBulkResult(null)
    setGenerationBulkConfirmation('')
    setGenerationDetailError(null)
    setGenerationActionMessage(null)
  }

  const clearGenerationMetricsFilters = () => {
    setGenerationMetricsWorkspace('')
    setGenerationMetricsProviderId('')
    setGenerationMetricsDateFrom('')
    setGenerationMetricsDateTo('')
  }

  const changeGenerationOperationsWorkspace = (workspace: GenerationOperationsWorkspace) => {
    setGenerationActionMessage(null)
    setGenerationOperationsWorkspace(workspace)
  }

  const exportGenerations = async () => {
    if (!canExportAudit || exportingGenerations) return
    setExportingGenerations(true)
    setGenerationActionMessage(null)
    try {
      const csv = await adminService.exportCreativeGenerations(generationQuery, 'csv')
      downloadTextArtifact({
        content: csv,
        fileName: `creative-generations-${new Date().toISOString().slice(0, 10)}.csv`,
        mimeType: 'text/csv;charset=utf-8',
      })
      setGenerationActionMessage({ kind: 'success', text: isZh ? '已导出生成记录。' : 'Exported generation records.' })
    } catch (error) {
      console.info('[admin-service]', error)
      setGenerationActionMessage({ kind: 'error', text: isZh ? '导出生成记录失败。' : 'Could not export generation records.' })
    } finally {
      setExportingGenerations(false)
    }
  }

  const exportGenerationMetrics = async () => {
    if (!canExportAudit || exportingGenerationMetrics) return
    setExportingGenerationMetrics(true)
    setGenerationActionMessage(null)
    try {
      const csv = await adminService.exportCreativeGenerationBusinessMetrics(generationMetricsQuery, 'csv')
      downloadTextArtifact({
        content: csv,
        fileName: `creative-generation-metrics-${new Date().toISOString().slice(0, 10)}.csv`,
        mimeType: 'text/csv;charset=utf-8',
      })
      setGenerationActionMessage({ kind: 'success', text: isZh ? '已导出生成业务统计。' : 'Exported generation business metrics.' })
    } catch (error) {
      console.info('[admin-service]', error)
      setGenerationActionMessage({ kind: 'error', text: isZh ? '导出生成业务统计失败。' : 'Could not export generation business metrics.' })
    } finally {
      setExportingGenerationMetrics(false)
    }
  }

  const focusGenerationMediaAsset = (assetId: string) => {
    setActiveTab('Task review')
    setMediaStatus('all')
    setMediaPurpose(null)
    setMediaSearch(assetId)
    setHighlightedMediaAssetId(assetId)
    selectMediaAsset(assetId)
    simulateAction(isZh ? '已定位到生成输出媒体资产。' : 'Focused the generated media asset.')
  }

  const focusGenerationAudit = (generationId?: string) => {
    setAuditActionFilter('')
    setAuditResourceTypeFilter('creative_generation')
    setHighlightedAuditEventId(null)
    setActiveTab('Audit log')
    simulateAction(
      generationId
        ? (isZh ? `已筛选生成记录审计：${generationId}` : `Filtered creative generation audit for ${generationId}.`)
        : (isZh ? '已筛选创作生成审计事件。' : 'Filtered creative generation audit events.'),
    )
  }

  const beginSecurityOperation = (operation: PendingSecurityOperation) => {
    setPendingSecurityOperation(operation)
    setSecurityActionMessage(null)
    setSecurityOperationCritical(false)
    setSecurityOperationReason(
      operation.kind === 'open-incident'
        ? 'security_review_started'
        : operation.kind === 'resolve-incident'
          ? 'incident_contained'
          : operation.kind === 'rollback-media-policy'
            ? ''
            : 'operator_24h_silence',
    )
  }

  const copyAuditEventLink = async (event: AuditEvent) => {
    const link = auditEventShareUrl(event.id)
    try {
      await navigator.clipboard.writeText(link)
      simulateAction(isZh ? '已复制审计定位链接。' : 'Copied the audit event link.')
    } catch (error) {
      console.info('[audit-link]', error)
      simulateAction(isZh ? '复制审计链接失败。' : 'Could not copy the audit event link.')
    }
  }

  const exportAuditEventJson = (event: AuditEvent) => {
    const payload = {
      ...event,
      link: auditEventShareUrl(event.id),
      deepLink: {
        page: 'admin',
        admin: {
          tab: 'Audit log',
          auditEventId: event.id,
        },
      },
    }
    downloadTextArtifact({
      content: formatMetadataJson(payload),
      fileName: `audit-event-${event.id}.json`,
      mimeType: 'application/json;charset=utf-8',
    })
    simulateAction(isZh ? '已导出审计事件 JSON。' : 'Exported the audit event JSON.')
  }

  const setMediaPolicyDraftValue = (key: MediaPolicyDraftKey, value: string) => {
    cancelMediaPolicySaveConfirmation()
    setMediaPolicyDraft((current) => ({ ...current, [key]: value }))
  }

  const reviewQueueItem = async (item: AdminReviewQueueItemDto, decision: AdminReviewDecision) => {
    setReviewingQueueItems((current) => ({ ...current, [item.id]: decision }))
    setReviewActionMessage(null)
    try {
      const reviewed = await adminService.reviewQueueItem(
        item.id,
        decision,
        reviewNotes[item.id]?.trim() ||
          (isZh
            ? `运营队列已${decision === 'approve' ? '通过' : '驳回'}。`
            : `Review queue item ${decision === 'approve' ? 'approved' : 'rejected'}.`),
      )
      setQueueItems((current) => current.map((queueItem) => (queueItem.id === reviewed.id ? reviewed : queueItem)))
      setReviewNotes((current) => {
        const next = { ...current }
        delete next[item.id]
        return next
      })
      if (item.queue === 'points') {
        void ledgerStatusResource.refresh()
        void auditStatus.refresh()
        void notificationStatus.refresh()
      }
      setReviewActionMessage({
        kind: 'success',
        text: isZh
          ? `已${decision === 'approve' ? '通过' : '驳回'}：${item.title}`
          : `${decision === 'approve' ? 'Approved' : 'Rejected'}: ${item.title}`,
      })
    } catch (error) {
      console.info('[admin-service]', error)
      setReviewActionMessage({ kind: 'error', text: isZh ? `处理失败：${item.title}` : `Action failed: ${item.title}` })
    } finally {
      setReviewingQueueItems((current) => {
        const next = { ...current }
        delete next[item.id]
        return next
      })
    }
  }

  const beginEditRole = (role: AdminRolePermissionDto) => {
    setEditingRole(role.role)
    setPermissionDraft([...role.permissions])
  }

  const cancelEditRole = () => {
    setEditingRole(null)
    setPermissionDraft([])
  }

  const togglePermissionDraft = (permission: Permission) => {
    if (editingRole === 'admin' && permission === 'admin:permissions:manage') return
    setPermissionDraft((current) =>
      current.includes(permission)
        ? current.filter((item) => item !== permission)
        : [...current, permission],
    )
  }

  const saveRolePermissions = async (role: Role) => {
    setSavingRole(role)
    try {
      const updated = await adminService.updateRolePermissions(role, permissionDraft)
      setRolePermissions((current) => current.map((item) => (item.role === updated.role ? updated : item)))
      cancelEditRole()
      simulateAction(isZh ? `已更新 ${role} 角色权限。` : `Updated permissions for ${role}.`)
    } catch (error) {
      console.info('[admin-service]', error)
      simulateAction(isZh ? `更新 ${role} 角色权限失败。` : `Could not update permissions for ${role}.`)
    } finally {
      setSavingRole(null)
    }
  }

  const adjustPoints = async () => {
    const delta = Number.parseInt(adjustDelta, 10)
    if (!Number.isFinite(delta) || delta === 0 || !adjustReason.trim()) {
      simulateAction(isZh ? '请填写非零调整积分和调整原因。' : 'Enter a non-zero points delta and a reason.')
      return
    }
    setAdjustingPoints(true)
    try {
      const result = await adminService.adjustPoints({
        userHandle: ledgerUserHandle.trim(),
        delta,
        reason: adjustReason.trim(),
        reasonCode: adjustReasonCode || null,
      })
      setAdjustReason('')
      const review = result.review
      const entry = result.entry
      if (result.status === 'pending_review' && review) {
        setQueueItems((current) => [review, ...current.filter((item) => item.id !== review.id)])
        setReviewQueueFilter('points')
        void notificationStatus.refresh()
        simulateAction(
          isZh
            ? `大额积分调整已提交审批：@${review.owner}，阈值 ${result.threshold}`
            : `High-value point adjustment sent to review for @${review.owner}. Threshold ${result.threshold}.`,
        )
      } else if (entry) {
        setLedgerRows((current) => [entry, ...current.filter((item) => item.id !== entry.id)])
        void ledgerStatusResource.refresh()
        simulateAction(
          isZh
            ? `已调整 @${entry.userHandle} 积分：${delta}`
            : `Adjusted @${entry.userHandle} by ${delta} points.`,
        )
      }
      void auditStatus.refresh()
    } catch (error) {
      console.info('[admin-service]', error)
      simulateAction(isZh ? '积分调整失败，请检查用户和权限。' : 'Point adjustment failed. Check the user and permissions.')
    } finally {
      setAdjustingPoints(false)
    }
  }

  const exportLedger = async () => {
    setExportingLedger(true)
    try {
      const csv = await adminService.exportPointLedgerCsv({ ...ledgerQuery, limit: 100 })
      downloadTextArtifact({
        content: csv,
        fileName: `points-ledger-${ledgerUserHandle || 'all'}.csv`,
        mimeType: 'text/csv;charset=utf-8',
      })
      simulateAction(isZh ? '已导出积分账本 CSV。' : 'Exported points ledger CSV.')
    } catch (error) {
      console.info('[admin-service]', error)
      simulateAction(isZh ? '导出积分账本失败。' : 'Could not export points ledger.')
    } finally {
      setExportingLedger(false)
    }
  }

  const exportAccounting = async () => {
    if (!canReadAccounting || exportingAccounting) return
    setExportingAccounting(true)
    try {
      const json = await adminService.exportAccountingReconciliationJson({ ...accountingQuery, limit: 100 })
      downloadTextArtifact({
        content: json,
        fileName: `accounting-reconciliation-${new Date().toISOString().slice(0, 10)}.json`,
        mimeType: 'application/json;charset=utf-8',
      })
      simulateAction(isZh ? '已导出内部对账证据。' : 'Exported internal accounting evidence.')
    } catch (error) {
      console.info('[admin-service]', error)
      simulateAction(isZh ? '内部对账导出失败。' : 'Could not export internal accounting evidence.')
    } finally {
      setExportingAccounting(false)
    }
  }

  const exportBillingMetrics = async () => {
    setExportingBillingMetrics(true)
    try {
      const artifact = await adminService.exportBillingMetrics(billingMetricsQuery)
      downloadJsonArtifact({
        value: artifact,
        fileName: 'accounting-business-metrics.json',
        mimeType: 'application/json',
      })
    } catch (error) {
      console.info('[admin-service]', error)
      simulateAction(isZh ? '账务统计导出失败。' : 'Could not export accounting metrics.')
    } finally {
      setExportingBillingMetrics(false)
    }
  }

  const exportPersonalBilling = async () => {
    try {
      const csv = await adminService.exportPersonalBillingCsv(ledgerUserHandle.trim(), { unit: billingUnitFilter, sourceType: billingSourceType || null, dateFrom: billingDateFrom || null, dateTo: billingDateTo || null, sort: 'desc' })
      downloadTextArtifact({
        content: csv,
        fileName: `billing-${ledgerUserHandle.trim() || 'user'}.csv`,
        mimeType: 'text/csv;charset=utf-8',
      })
    } catch (error) {
      console.info('[admin-service]', error)
      simulateAction(isZh ? '用户账务导出失败。' : 'Could not export user billing ledger.')
    }
  }

  const exportAuditEvents = async () => {
    setExportingAudit(true)
    try {
      const json = await adminService.exportAuditJson({ ...auditQuery, limit: 100 })
      const filterName = [auditActionFilter, auditResourceTypeFilter].filter(Boolean).join('-') || 'all'
      downloadTextArtifact({
        content: json,
        fileName: `audit-events-${filterName}.json`,
        mimeType: 'application/json;charset=utf-8',
      })
      simulateAction(isZh ? '已导出审计事件 JSON。' : 'Exported audit events JSON.')
    } catch (error) {
      console.info('[admin-service]', error)
      simulateAction(isZh ? '导出审计事件失败。' : 'Could not export audit events.')
    } finally {
      setExportingAudit(false)
    }
  }

  const applyApprovalTemplate = (itemId: string, template: string) => {
    setReviewNotes((current) => ({ ...current, [itemId]: template }))
  }

  const markNotificationRead = async (notification: ApiNotification) => {
    setReadingNotification(notification.id)
    try {
      const updated = await notificationService.markRead(notification.id)
      setNotifications((current) => current
        .map((item) => (item.id === updated.id ? updated : item))
        .filter((item) => notificationReadState !== 'unread' || !item.readAt))
      simulateAction(isZh ? `已处理提醒：${notification.title}` : `Reminder marked read: ${notification.title}`)
    } catch (error) {
      console.info('[notification-service]', error)
      simulateAction(isZh ? '提醒处理失败。' : 'Could not mark reminder as read.')
    } finally {
      setReadingNotification(null)
    }
  }

  const securityOperationBusy = pendingSecurityOperation
    ? pendingSecurityOperation.kind === 'rollback-media-policy'
      ? rollingBackMediaPolicy === pendingSecurityOperation.eventId
      : pendingSecurityOperation.kind === 'silence-scan-alert'
        ? handlingScanAlertId === pendingSecurityOperation.alert.id
        : pendingSecurityOperation.kind === 'silence-security-alert'
          ? handlingSecurityAlertId === pendingSecurityOperation.alert.id
          : handlingSecurityIncidentId !== null
    : false

  const confirmSecurityOperation = () => {
    if (!pendingSecurityOperation) return
    const reason = securityOperationReason.trim()
    switch (pendingSecurityOperation.kind) {
      case 'open-incident':
        void createSecurityIncident(pendingSecurityOperation.event, reason, securityOperationCritical)
        break
      case 'resolve-incident':
        void resolveSecurityIncident(pendingSecurityOperation.incident, reason)
        break
      case 'silence-security-alert':
        void silenceSecurityAlert(pendingSecurityOperation.alert, reason)
        break
      case 'silence-scan-alert':
        void silenceScanAlert(pendingSecurityOperation.alert, reason)
        break
      case 'rollback-media-policy':
        void rollbackMediaGovernancePolicy(pendingSecurityOperation.eventId)
        break
    }
  }

  return (
    <div className="admin-center">
      <div className="admin-center-header">
        <SectionHeader
          eyebrow={textFor(t, 'Operations', '运营')}
          title={t.adminTitle}
          action={
            <button className="ghost-button" type="button" onClick={() => setPage('points')}>
              <Trophy size={17} />
              {textFor(t, 'Points ledger', '积分流水')}
            </button>
          }
        />
      </div>
      <div className="admin-center-layout">
        <nav className="admin-section-rail" aria-label={textFor(t, 'Admin sections', '管理中心分区')} data-testid="admin-section-rail">
          {adminTabGroups.map((group) => {
            const GroupIcon = group.icon
            return (
              <div className="admin-section-group" data-active={group.id === activeAdminGroup.id ? 'true' : 'false'} key={group.id}>
                <div className="admin-section-group-label">
                  <GroupIcon size={14} aria-hidden="true" />
                  <span>{group.label}</span>
                </div>
                <div className="admin-section-links">
                  {group.tabs.map((item) => (
                    <button
                      className={activeTab === item ? 'admin-section-link active' : 'admin-section-link'}
                      type="button"
                      aria-current={activeTab === item ? 'page' : undefined}
                      key={item}
                      onClick={() => selectAdminTab(item)}
                    >
                      {adminTabLabels[item]}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </nav>
        <div className="admin-center-content">
          <label className="admin-tab-select">
            <span>{textFor(t, 'Current section', '当前分区')}</span>
            <select aria-label={textFor(t, 'Current section', '当前分区')} value={activeTab} onChange={(event) => selectAdminTab(event.target.value)}>
              {adminTabGroups.map((group) => (
                <optgroup label={group.label} key={group.id}>
                  {group.tabs.map((item) => <option value={item} key={item}>{adminTabLabels[item]}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <header className="admin-current-section-header" data-testid="admin-current-section">
            <span>{activeAdminGroup.label}</span>
            <h2>{adminTabLabels[activeTab]}</h2>
            <p>{adminTabDescriptions[activeTab]}</p>
          </header>
      <Suspense fallback={<div className="route-loading" role="status" aria-live="polite"><span className="status-dot loading" aria-hidden="true" />{textFor(t, 'Loading section', '正在加载分区')}</div>}>
      {activeTab === 'Observability' && (
        <ObservabilityPanel
          hasPermission={account.hasPermission}
          isZh={isZh}
          initialAlertId={observabilityAlertId}
          onInitialAlertHandled={clearObservabilityAlertId}
        />
      )}
      {activeTab === 'Settings' && (
        <div className="admin-settings-stack">
          <SystemSettingsPanel
            hasPermission={account.hasPermission}
            isZh={isZh}
          />
          <ConfigurationResourcesPanel
            hasPermission={account.hasPermission}
            isZh={isZh}
          />
        </div>
      )}
      {activeTab === 'AI config' && (
        <ModelControlPanel
          hasPermission={account.hasPermission}
          isZh={isZh}
        />
      )}
      {(activeTab === 'Users' || activeTab === 'Tags') && (
        <div className="admin-settings-stack">
          <UserAdminPanel
            t={t}
            canRead={account.hasPermission('admin:users:read')}
            canManage={account.hasPermission('admin:users:manage')}
          />
          {activeTab === 'Users' && (
            <DataRightsAdminPanel
              isZh={isZh}
              canRead={account.hasPermission('admin:data-rights:read')}
              canManage={account.hasPermission('admin:data-rights:manage')}
            />
          )}
        </div>
      )}
      {activeTab === 'Notifications' && (
        <NotificationAdminPanel
          hasPermission={account.hasPermission}
          isZh={isZh}
        />
      )}
      {activeTab === 'Support' && (
        <SupportAdminPanel isZh={isZh} canRead={account.hasPermission('admin:support:read')} canManage={account.hasPermission('admin:support:manage')} />
      )}
      {activeTab === 'Trust & Safety' && (
        <TrustSafetyWorkspace t={t} hasPermission={account.hasPermission} isZh={isZh} />
      )}
      {activeTab === 'Overview' && <AdminOverviewPanel t={t} target={overviewTarget} />}
      {activeTab === 'Release' && (
        <ReleaseControlPanel
          hasPermission={account.hasPermission}
          isZh={isZh}
        />
      )}
      {activeTab === 'Task review' && (
        <TaskAdminPanel
          hasPermission={account.hasPermission}
          isZh={isZh}
        />
      )}
      {activeTab === 'Community' && (
        <CommunityAdminPanel hasPermission={account.hasPermission} isZh={isZh} />
      )}
      {activeTab === 'Inspiration' && (
        <InspirationAdminPanel
          isZh={isZh}
          canRead={account.hasPermission('admin:inspiration:read')}
          canManage={account.hasPermission('admin:inspiration:manage')}
        />
      )}
      {activeTab === 'Access' && (
        <div className="admin-settings-stack">
          <AuthSessionAdminPanel
            t={t}
            canRead={account.hasPermission('admin:auth:read')}
            canManage={account.hasPermission('admin:auth:manage')}
          />
          <OAuthAdminPanel
            t={t}
            canRead={account.hasPermission('admin:auth:read')}
            canManage={account.hasPermission('admin:auth:manage')}
          />
          <DeveloperAccessAdminPanel
            t={t}
            canRead={account.hasPermission('admin:developer:read')}
            canManage={account.hasPermission('admin:developer:manage')}
          />
          <WebhookAdminPanel
            t={t}
            canRead={account.hasPermission('admin:webhooks:read')}
            canManage={account.hasPermission('admin:webhooks:manage')}
          />
        </div>
      )}
      {activeTab === 'Finance' && (
        <EntitlementAdminPanel
          hasPermission={account.hasPermission}
          isZh={isZh}
        />
      )}
      </Suspense>
      <section className="panel" hidden={activeTab !== 'Notifications'}>
        <SectionHeader
          eyebrow={textFor(t, 'Notifications', '通知')}
          title={textFor(t, `Reminders ${notifications.length}`, `提醒 ${notifications.length}`)}
          action={
            <button className="ghost-button" type="button" onClick={() => void notificationStatus.refresh()}>
              <Bell size={17} />
              {textFor(t, 'Refresh', '刷新')}
            </button>
          }
        />
        <div className="permission-summary">
          <div className="chip-row">
            {notificationReadStates.map((state) => (
              <button
                className={notificationReadState === state ? 'chip active' : 'chip'}
                type="button"
                key={state}
                onClick={() => setNotificationReadState(state)}
              >
                {{
                  unread: textFor(t, 'Unread', '未读'),
                  all: textFor(t, 'All', '全部'),
                  read: textFor(t, 'Read', '已读'),
                }[state]}
              </button>
            ))}
          </div>
          <label>
            <span>{textFor(t, 'Type', '类型')}</span>
            <select
              aria-label={textFor(t, 'Notification type', '通知类型')}
              value={notificationType ?? ''}
              onChange={(event) => setNotificationType(event.target.value || null)}
            >
              <option value="">{textFor(t, 'All types', '全部类型')}</option>
              {notificationTypes.map((type) => (
                <option value={type} key={type}>{type}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{textFor(t, 'Resource', '资源')}</span>
            <select
              aria-label={textFor(t, 'Notification resource', '通知资源')}
              value={notificationResourceType ?? ''}
              onChange={(event) => setNotificationResourceType(event.target.value || null)}
            >
              <option value="">{textFor(t, 'All resources', '全部资源')}</option>
              {notificationResourceTypes.map((resourceType) => (
                <option value={resourceType} key={resourceType}>{resourceType}</option>
              ))}
            </select>
          </label>
        </div>
        <NotificationList
          t={t}
          notifications={notifications}
          loading={notificationStatus.loading}
          error={notificationStatus.error}
          variant="admin"
          readingId={readingNotification}
          onOpen={onOpenNotificationResource}
          onMarkRead={markNotificationRead}
          formatTime={formatAuditTime}
          loadingBody={textFor(t, 'Reading notification inbox from the API.', '正在从 API 读取通知收件箱。')}
          emptyBody={textFor(t, 'Point approvals and policy changes will appear here.', '积分审批和策略变更会出现在这里。')}
        />
      </section>
      <section className="panel" hidden={activeTab !== 'Access'}>
        <SectionHeader
          eyebrow={textFor(t, 'Access', '权限')}
          title={textFor(t, 'Role permission matrix', '角色权限矩阵')}
        />
        <div className="permission-summary">
          <div>
            <strong>{permissions.length}</strong>
            <span>{textFor(t, 'permissions', '项权限')}</span>
          </div>
          <div>
            <strong>{rolePermissions.length}</strong>
            <span>{textFor(t, 'roles', '个角色')}</span>
          </div>
          <div>
            <strong>{canManagePermissions ? textFor(t, 'Editable', '可编辑') : textFor(t, 'Read only', '只读')}</strong>
            <span>{textFor(t, 'current access', '当前访问')}</span>
          </div>
          <button
            className="ghost-button"
            type="button"
            onClick={() => {
              cancelEditRole()
              void permissionsStatus.refresh()
              void rolesStatus.refresh()
            }}
          >
            {textFor(t, 'Refresh', '刷新')}
          </button>
        </div>
        <div className="permission-matrix">
          {(permissionsStatus.loading || rolesStatus.loading) && (
            <div className="empty-state">
              <strong>{textFor(t, 'Loading access policy', '正在加载权限策略')}</strong>
              <span>{textFor(t, 'Reading role grants from the API.', '正在从 API 读取角色授权矩阵。')}</span>
            </div>
          )}
          {(!permissionsStatus.loading && permissionsStatus.error) || (!rolesStatus.loading && rolesStatus.error) ? (
            <div className="empty-state">
              <strong>{textFor(t, 'Access policy unavailable', '权限策略暂不可用')}</strong>
              <span>{permissionsStatus.error ?? rolesStatus.error}</span>
            </div>
          ) : null}
          {!permissionsStatus.loading && !rolesStatus.loading && !permissionsStatus.error && !rolesStatus.error && rolePermissions.map((role) => (
            <div className="permission-row" data-testid={`permission-row-${role.role}`} key={role.role}>
              <div className="permission-role">
                <strong>{role.role}</strong>
                <span>{textFor(t, `${role.permissions.length} grants`, `${role.permissions.length} 项授权`)}</span>
                {canManagePermissions && (
                  <div className="button-row compact-buttons">
                    {editingRole === role.role ? (
                      <>
                        <button className="ghost-button small" data-testid={`permission-cancel-${role.role}`} type="button" onClick={cancelEditRole} disabled={savingRole === role.role}>
                          {textFor(t, 'Cancel', '取消')}
                        </button>
                        <button className="primary-button small" data-testid={`permission-save-${role.role}`} type="button" onClick={() => void saveRolePermissions(role.role)} disabled={savingRole === role.role}>
                          {savingRole === role.role ? textFor(t, 'Saving', '保存中') : textFor(t, 'Save', '保存')}
                        </button>
                      </>
                    ) : (
                      <button className="ghost-button small" data-testid={`permission-edit-${role.role}`} type="button" onClick={() => beginEditRole(role)}>
                        {textFor(t, 'Edit', '编辑')}
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="permission-chip-grid">
                {permissions.map((permission) => {
                  const isEditing = editingRole === role.role
                  const isProtected = role.role === 'admin' && permission.protected === true
                  const granted = isEditing ? permissionDraft.includes(permission.id) : role.permissions.includes(permission.id)
                  return isEditing ? (
                    <button
                      className={granted ? 'permission-chip granted editable' : 'permission-chip editable'}
                      data-testid={`permission-chip-${role.role}-${permission.id}`}
                      type="button"
                      key={`${role.role}-${permission.id}`}
                      onClick={() => togglePermissionDraft(permission.id)}
                      disabled={savingRole === role.role || isProtected}
                      title={isProtected ? textFor(t, 'Protected permission', '受保护权限') : undefined}
                    >
                      {permission.id}
                    </button>
                  ) : (
                    <span className={granted ? 'permission-chip granted' : 'permission-chip'} data-testid={`permission-chip-${role.role}-${permission.id}`} key={`${role.role}-${permission.id}`}>
                      {permission.id}
                    </span>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </section>
      {activeTab === 'Security' && (
        <>
          <SecurityWorkspaceNavigation
            t={t}
            workspace={securityWorkspace}
            onChange={(workspace) => {
              setSecurityWorkspace(workspace)
              setPendingSecurityOperation(null)
              setSecurityActionMessage(null)
            }}
          />
          <AdminActionFeedback message={securityActionMessage} />
          {pendingSecurityOperation && (
            <SecurityOperationConfirmation
              t={t}
              operation={pendingSecurityOperation}
              reason={securityOperationReason}
              criticalConfirmed={securityOperationCritical}
              busy={securityOperationBusy}
              onReasonChange={setSecurityOperationReason}
              onCriticalChange={setSecurityOperationCritical}
              onConfirm={confirmSecurityOperation}
              onCancel={() => setPendingSecurityOperation(null)}
            />
          )}
        </>
      )}
      {activeTab === 'Security' && securityWorkspace === 'media' && (
        <SecurityMediaWorkspace
          t={t}
          canReadQueues={canReadQueues}
          canReviewQueues={canReviewQueues}
          canReadAudit={canReadAudit}
          canReadMedia={canReadMedia}
          canManageMedia={canManageMedia}
          canExportMedia={canExportMedia}
          reviewStatus={mediaReviewStatus}
          rows={mediaRows}
          filters={{ status: mediaStatus, purpose: mediaPurpose, search: mediaSearch }}
          highlightedAssetId={highlightedMediaAssetId}
          selectedAssetId={selectedMediaAssetId}
          reviewingAssetId={reviewingMediaId}
          sweeping={sweepingMediaJobs}
          scanHistory={{
            status: mediaScanHistoryStatus,
            items: mediaScanHistory,
            nextCursor: mediaScanHistoryNextCursor,
            loadingMore: loadingMoreMediaScanHistory,
          }}
          scanAlerts={{
            status: mediaScanAlertStatus,
            items: mediaScanAlerts,
            handlingId: handlingScanAlertId,
            selectedId: selectedScanAlertId,
            events: scanAlertEvents,
            eventsLoading: loadingScanAlertEvents,
            eventsError: scanAlertEventsError,
          }}
          callbackStatus={callbackFailureStatus}
          callbackEvents={callbackFailureEvents}
          onFilterStatus={setMediaStatus}
          onFilterPurpose={setMediaPurpose}
          onFilterSearch={setMediaSearch}
          onSelectAsset={selectMediaAsset}
          onRetryAsset={(asset) => void retryMediaAsset(asset)}
          onReviewAsset={(asset, decision) => void reviewMediaAsset(asset, decision)}
          onLoadMoreHistory={() => void loadMoreMediaScanHistory()}
          onToggleAlertEvents={(alert) => void toggleScanAlertEvents(alert)}
          onAcknowledgeAlert={(alert) => void acknowledgeScanAlert(alert)}
          onUnsilenceAlert={(alert) => void unsilenceScanAlert(alert)}
          onBeginOperation={beginSecurityOperation}
          onSweep={() => void sweepMediaJobs()}
        />
      )}
      {activeTab === 'Security' && securityWorkspace === 'governance' && (
        <SecurityGovernanceWorkspace
          t={t}
          canReadQueues={canReadQueues}
          canReadAudit={canReadAudit}
          canManagePermissions={canManagePermissions}
          status={mediaGovernanceConfigStatus}
          config={mediaGovernanceConfig}
          draft={mediaPolicyDraft}
          saving={savingMediaPolicy}
          hasInvalidDraft={hasInvalidMediaPolicyDraft}
          impactPreview={mediaPolicyImpactPreview}
          confirmingSave={confirmingMediaPolicySave}
          highRiskChanges={highRiskMediaPolicyChanges}
          historyStatus={mediaPolicyHistoryStatus}
          history={mediaPolicyHistory}
          expandedEventIds={expandedMediaPolicyEventIds}
          rollingBackEventId={rollingBackMediaPolicy}
          onFocusPolicyAudit={focusMediaGovernanceAudit}
          onDraftChange={setMediaPolicyDraftValue}
          onSave={() => void saveMediaGovernancePolicy()}
          onCancelConfirmation={cancelMediaPolicySaveConfirmation}
          onCommit={() => void commitMediaGovernancePolicy()}
          onToggleHistoryEvent={(eventId) => setExpandedMediaPolicyEventIds((current) => ({ ...current, [eventId]: !current[eventId] }))}
          onFocusAuditEvent={(eventId) => focusAuditEvent(eventId, 'media_governance_policy')}
          onBeginRollback={(eventId) => beginSecurityOperation({ kind: 'rollback-media-policy', eventId })}
        />
     )}
     <section className="panel" data-testid="admin-finance-ledger" hidden={activeTab !== 'Finance'}>
        <SectionHeader
          eyebrow={textFor(t, 'Finance', '账务')}
          title={textFor(t, 'User ledger operations', '用户账本运营')}
          action={
            <button className="ghost-button" type="button" onClick={() => void exportLedger()} disabled={!canAdjustPoints || exportingLedger}>
              {exportingLedger ? textFor(t, 'Exporting', '导出中') : textFor(t, 'Export CSV', '导出 CSV')}
            </button>
          }
        />
        <AdminActionFeedback message={accountingActionMessage} />
        <div className="permission-summary">
          <label>
            <span>{textFor(t, 'User', '用户')}</span>
            <input
              aria-label={textFor(t, 'Ledger user handle', '账本用户 Handle')}
              value={ledgerUserHandle}
              onChange={(event) => setLedgerUserHandle(event.target.value)}
              placeholder="promptlin"
            />
          </label>
          <label>
            <span>{textFor(t, 'Status', '状态')}</span>
            <select
              aria-label={textFor(t, 'Ledger status', '账本状态')}
              value={ledgerStatus ?? ''}
              onChange={(event) => setLedgerStatus(event.target.value ? event.target.value as PointsLedgerQuery['status'] : null)}
            >
              <option value="">{textFor(t, 'All', '全部')}</option>
              <option value="settled">{textFor(t, 'Settled', '已结算')}</option>
              <option value="pending">{textFor(t, 'Pending', '待结算')}</option>
              <option value="cancelled">{textFor(t, 'Cancelled', '已取消')}</option>
            </select>
          </label>
          <label>
            <span>{textFor(t, 'Search', '搜索')}</span>
            <input
              aria-label={textFor(t, 'Search ledger', '搜索账本')}
              value={ledgerSearch}
              onChange={(event) => setLedgerSearch(event.target.value)}
              placeholder={textFor(t, 'Reason, source, id', '原因、来源、ID')}
            />
          </label>
          <button className="ghost-button" type="button" onClick={() => void ledgerStatusResource.refresh()} disabled={!canAdjustPoints}>
            {textFor(t, 'Refresh', '刷新')}
          </button>
        </div>
        <div className="market-dashboard">
          {[
            [textFor(t, 'Available', '可用'), ledgerSummary?.available],
            [textFor(t, 'Frozen', '冻结'), ledgerSummary?.frozen],
            [textFor(t, 'Pending', '待结算'), ledgerSummary?.pendingSettlement],
            [textFor(t, 'Earned', '累计收入'), ledgerSummary?.lifetimeEarned],
          ].map(([label, value]) => (
            <article className="metric-card highlight" key={label}>
              <span>{label}</span>
              <strong>{pointText(String(value ?? 0), t)}</strong>
              <small>{textFor(t, 'API-backed ledger projection', 'API 返回的账务投影')}</small>
            </article>
          ))}
        </div>
        <div className="permission-summary">
          <label>
            <span>{textFor(t, 'Delta', '调整值')}</span>
            <input
              aria-label={textFor(t, 'Adjustment delta', '积分调整值')}
              value={adjustDelta}
              onChange={(event) => setAdjustDelta(event.target.value)}
              inputMode="numeric"
            />
          </label>
          <label>
            <span>{textFor(t, 'Reason', '原因')}</span>
            <input
              aria-label={textFor(t, 'Adjustment reason', '积分调整原因')}
              value={adjustReason}
              onChange={(event) => setAdjustReason(event.target.value)}
              placeholder={textFor(t, 'Support credit', '客服补偿')}
            />
          </label>
          <label>
            <span>{textFor(t, 'Category', '分类')}</span>
            <select
              aria-label={textFor(t, 'Adjustment reason category', '积分调整原因分类')}
              value={adjustReasonCode}
              onChange={(event) => setAdjustReasonCode(event.target.value)}
            >
              <option value="">{textFor(t, 'Uncategorized', '未分类')}</option>
              {(pointPolicy?.reasonCodes ?? []).map((reasonCode) => (
                <option value={reasonCode} key={reasonCode}>{reasonCode}</option>
              ))}
            </select>
          </label>
          <button className="primary-button" type="button" onClick={() => void adjustPoints()} disabled={!canAdjustPoints || adjustingPoints}>
            {adjustingPoints ? textFor(t, 'Saving', '保存中') : textFor(t, 'Apply adjustment', '提交调整')}
          </button>
          <button className="ghost-button" type="button" onClick={() => setReviewQueueFilter('points')}>
            {textFor(t, `Point approvals ${pointReviewCount}`, `积分审批 ${pointReviewCount}`)}
          </button>
        </div>
        <div className="permission-row">
          <div className="permission-role">
            <strong>{textFor(t, 'Adjustment policy', '调整策略')}</strong>
            <span>
              {pointPolicyStatus.loading
                ? textFor(t, 'Loading policy', '正在加载策略')
                : textFor(t, 'Role limits, reasons, templates', '角色额度、原因分类、审批模板')}
            </span>
            <div className="button-row compact-buttons">
              <button className="ghost-button small" type="button" onClick={() => void pointPolicyStatus.refresh()} disabled={!canAdjustPoints}>
                {textFor(t, 'Refresh', '刷新')}
              </button>
              <button className="primary-button small" type="button" onClick={() => void savePointPolicy()} disabled={!canManagePermissions || savingPointPolicy || !pointPolicy}>
                {savingPointPolicy ? textFor(t, 'Saving', '保存中') : textFor(t, 'Save policy', '保存策略')}
              </button>
            </div>
          </div>
          <div className="permission-chip-grid">
            {pointPolicyRoles.map((role) => (
              <label className="policy-input" key={role}>
                <span>{role}</span>
                <input
                  aria-label={`${role} point adjustment limit`}
                  value={policyRoleLimits[role] ?? ''}
                  onChange={(event) => setPolicyRoleLimits((current) => ({ ...current, [role]: event.target.value }))}
                  inputMode="numeric"
                  disabled={!canManagePermissions}
                />
              </label>
            ))}
            <label className="policy-input wide">
              <span>{textFor(t, 'Reason codes', '原因分类')}</span>
              <input
                aria-label={textFor(t, 'Point adjustment reason codes', '积分调整原因分类')}
                value={policyReasonCodes}
                onChange={(event) => setPolicyReasonCodes(event.target.value)}
                disabled={!canManagePermissions}
              />
            </label>
            <label className="policy-input wide">
              <span>{textFor(t, 'Approval templates', '审批模板')}</span>
              <textarea
                aria-label={textFor(t, 'Point adjustment approval templates', '积分调整审批模板')}
                value={policyApprovalTemplates}
                onChange={(event) => setPolicyApprovalTemplates(event.target.value)}
                disabled={!canManagePermissions}
              />
            </label>
            <div className="policy-history">
              <div className="policy-history-header">
                <strong>{textFor(t, 'Policy history', '策略历史')}</strong>
                <button className="ghost-button small" type="button" onClick={() => void pointPolicyHistoryStatus.refresh()} disabled={!canAdjustPoints}>
                  {textFor(t, 'Refresh', '刷新')}
                </button>
              </div>
              {pointPolicyHistoryStatus.loading && (
                <span>{textFor(t, 'Loading policy history', '正在加载策略历史')}</span>
              )}
              {!pointPolicyHistoryStatus.loading && pointPolicyHistoryStatus.error && (
                <span>{pointPolicyHistoryStatus.error}</span>
              )}
              {!pointPolicyHistoryStatus.loading && !pointPolicyHistoryStatus.error && policyHistory.length === 0 && (
                <span>{textFor(t, 'No policy changes yet', '暂无策略变更')}</span>
              )}
              {!pointPolicyHistoryStatus.loading && !pointPolicyHistoryStatus.error && policyHistory.map((event) => (
                <div className={highlightedPolicyEventId === event.id ? 'policy-history-row deep-linked' : 'policy-history-row'} key={event.id}>
                  <div>
                    <strong>{event.action.replace('points.policy.', '')}</strong>
                    <span>{event.summary}</span>
                    <small>{event.actorId ?? 'system'} · {formatAuditTime(event.createdAt)}</small>
                  </div>
                  <button
                    className="ghost-button small"
                    type="button"
                    onClick={() => void rollbackPointPolicy(event.id)}
                    disabled={!canManagePermissions || !event.previous || rollingBackPolicy === event.id}
                  >
                    {rollingBackPolicy === event.id ? textFor(t, 'Rolling back', '回滚中') : textFor(t, 'Rollback', '回滚')}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="admin-table">
          {ledgerStatusResource.loading && (
            <div className="empty-state">
              <strong>{textFor(t, 'Loading ledger', '正在加载账本')}</strong>
              <span>{textFor(t, 'Reading user ledger and balance projection.', '正在读取用户流水和余额投影。')}</span>
            </div>
          )}
          {!ledgerStatusResource.loading && ledgerStatusResource.error && (
            <div className="empty-state">
              <strong>{textFor(t, 'Ledger unavailable', '账本不可用')}</strong>
              <span>{ledgerStatusResource.error}</span>
            </div>
          )}
          {!ledgerStatusResource.loading && !ledgerStatusResource.error && ledgerRows.length === 0 && (
            <div className="empty-state">
              <strong>{textFor(t, 'No ledger rows', '暂无流水')}</strong>
              <span>{textFor(t, 'Try another user, status, or search term.', '尝试其他用户、状态或搜索词。')}</span>
            </div>
          )}
          {!ledgerStatusResource.loading && !ledgerStatusResource.error && ledgerRows.map((entry) => (
            <div className="admin-row" key={entry.id}>
              <StatusBadge status={entry.status} t={t} />
              <strong>{entry.description}</strong>
              <span>@{entry.userHandle ?? ledgerSummary?.userHandle ?? '-'}</span>
              <small>{entry.sourceType}{entry.sourceId ? ` / ${entry.sourceId}` : ''} · {entry.occurredAtLabel}</small>
              <b className={Number(entry.delta) >= 0 ? 'positive' : 'negative'}>{Number(entry.delta) >= 0 ? `+${entry.delta}` : entry.delta}</b>
            </div>
          ))}
        </div>
      </section>
      <section className="panel accounting-reconciliation-panel" data-testid="admin-accounting-reconciliation" hidden={activeTab !== 'Accounting'}>
        <SectionHeader
          eyebrow={textFor(t, 'Internal accounting', '内部账务')}
          title={textFor(t, 'Reconciliation', '对账中心')}
          action={
            <div className="button-row compact-buttons">
              <button className="ghost-button" type="button" onClick={() => void exportAccounting()} disabled={!canReadAccounting || exportingAccounting}>
                <Download size={16} />
                {exportingAccounting ? textFor(t, 'Exporting', '导出中') : textFor(t, 'Export JSON', '导出 JSON')}
              </button>
              <button className="primary-button" type="button" onClick={() => void scanAccounting()} disabled={!canScanAccounting || scanningAccounting}>
                <Activity size={16} />
                {scanningAccounting ? textFor(t, 'Scanning', '扫描中') : textFor(t, 'Run scan', '执行扫描')}
              </button>
            </div>
          }
        />
        <AdminActionFeedback message={accountingActionMessage} />
        <div className="billing-policy-overview">
          <div><span>{textFor(t, 'Point policy version', '积分策略版本')}</span><strong>v{billingPolicies?.pointAdjustment.version ?? 0}</strong><small>{billingPolicies?.pointAdjustment.updatedAt ? formatAuditTime(billingPolicies.pointAdjustment.updatedAt) : textFor(t, 'Default policy', '默认策略')}</small></div>
          <div><span>{textFor(t, 'Creative policy', '创作计费策略')}</span><strong>{billingPolicies?.creative.activeVersion ?? textFor(t, 'Unavailable', '不可用')}</strong><small>{textFor(t, 'Immutable history', '不可变历史')}</small></div>
          <div><span>{textFor(t, 'Economic boundary', '经济边界')}</span><strong>{textFor(t, 'Internal units', '内部单位')}</strong><small>{textFor(t, 'Not withdrawable or currency-convertible', '不可提现或兑换货币')}</small></div>
          <button className="ghost-button small" type="button" onClick={() => void previewBillingPolicy()} disabled={!canReadAccounting || previewingBillingPolicy}>{previewingBillingPolicy ? textFor(t, 'Previewing', '预览中') : textFor(t, 'Preview policy impact', '预览策略影响')}</button>
        </div>
        {billingPolicyStatus.error && <div className="empty-state"><strong>{textFor(t, 'Policy versions unavailable', '策略版本不可用')}</strong><span>{billingPolicyStatus.error}</span></div>}
        {billingPreview && <div className="billing-policy-impact"><strong>{billingPreview.summary}</strong><span>{billingPreview.impact.rolesChanged} {textFor(t, 'role routes changed', '个角色路由变化')} · +{billingPreview.impact.reasonCodesAdded}/-{billingPreview.impact.reasonCodesRemoved} {textFor(t, 'reason codes', '个原因代码')}</span><small>{billingPreview.impact.creativePolicyVersion} · {textFor(t, 'creative runtime unchanged', '创作运行时不变')}</small></div>}
        <div className="admin-personal-billing" data-testid="admin-personal-billing">
          <div className="admin-section-heading"><div><strong>{textFor(t, 'Selected user billing', '所选用户账务')}</strong><small>{textFor(t, 'Points, frozen balances, credits, quota, refunds, and sources', '积分、冻结、Credit、配额、退款与来源')}</small></div><div className="button-row"><input aria-label={textFor(t, 'Billing user handle', '账务用户 Handle')} value={ledgerUserHandle} onChange={(event) => setLedgerUserHandle(event.target.value)} /><button className="icon-button" type="button" title={textFor(t, 'Export user billing CSV', '导出用户账务 CSV')} onClick={() => void exportPersonalBilling()} disabled={!canReadAccounting || !ledgerUserHandle.trim()}><Download size={16}/></button></div></div>
          {personalBillingStatus.error && <div className="empty-state compact"><strong>{textFor(t, 'User billing unavailable', '用户账务不可用')}</strong><span>{personalBillingStatus.error}</span></div>}
          <div className="market-dashboard billing-metrics-dashboard">
            <article className="metric-card highlight"><span>{textFor(t, 'Available points', '可用积分')}</span><strong>{personalBillingSummary?.points.available ?? 0}</strong><small>{personalBillingSummary?.points.frozen ?? 0} {textFor(t, 'frozen', '冻结')}</small></article>
            <article className="metric-card highlight"><span>{textFor(t, 'Settled credits', '已结算 Credit')}</span><strong>{personalBillingSummary?.creativeCredits.settled ?? 0}</strong><small>{personalBillingSummary?.creativeCredits.refunded ?? 0} {textFor(t, 'refunded', '已退款')}</small></article>
            <article className="metric-card highlight"><span>{textFor(t, 'Quota remaining', '剩余配额')}</span><strong>{personalBillingSummary?.quotas.remaining ?? 0}</strong><small>{personalBillingSummary?.quotas.used ?? 0}/{personalBillingSummary?.quotas.limit ?? 0} {textFor(t, 'used', '已使用')}</small></article>
          </div>
          <div className="admin-table compact-billing-ledger">{personalBillingEntries.map((entry) => <div className="admin-row compact" key={entry.id}><span className={`status ${entry.status}`}>{entry.status}</span><strong>{entry.description}</strong><b className={entry.amount >= 0 ? 'positive' : 'negative'}>{entry.amount > 0 ? '+' : ''}{entry.amount}</b><small>{entry.unit} · {entry.sourceType}/{entry.sourceId ?? '-'}</small></div>)}{!personalBillingStatus.loading && !personalBillingStatus.error && personalBillingEntries.length === 0 && <div className="empty-state compact"><strong>{textFor(t, 'No billing entries', '暂无账务明细')}</strong></div>}</div>
        </div>
        <div className="permission-summary billing-metrics-filters">
          <label><span>{textFor(t, 'Metric unit', '统计单位')}</span><select aria-label={textFor(t, 'Billing metric unit', '账务统计单位')} value={billingUnitFilter ?? ''} onChange={(event) => setBillingUnitFilter(event.target.value ? event.target.value as AdminAccountingUnit : null)}><option value="">{textFor(t, 'All', '全部')}</option><option value="points">points</option><option value="creative_credit">creative_credit</option><option value="quota_unit">quota_unit</option></select></label>
          <label><span>{textFor(t, 'Source', '来源')}</span><input aria-label={textFor(t, 'Billing metric source', '账务统计来源')} value={billingSourceType} onChange={(event) => setBillingSourceType(event.target.value)} placeholder="generation"/></label>
          <label><span>{textFor(t, 'From', '开始')}</span><input aria-label={textFor(t, 'Billing metrics start date', '账务统计开始日期')} type="date" value={billingDateFrom} onChange={(event) => setBillingDateFrom(event.target.value)}/></label>
          <label><span>{textFor(t, 'To', '结束')}</span><input aria-label={textFor(t, 'Billing metrics end date', '账务统计结束日期')} type="date" value={billingDateTo} onChange={(event) => setBillingDateTo(event.target.value)}/></label>
          <button className="icon-button" type="button" aria-label={textFor(t, 'Export accounting metrics JSON', '导出账务统计 JSON')} title={textFor(t, 'Export accounting metrics JSON', '导出账务统计 JSON')} onClick={() => void exportBillingMetrics()} disabled={!canReadAccounting || exportingBillingMetrics}><Download size={16}/></button>
        </div>
        {billingMetricsStatus.error && <div className="empty-state"><strong>{textFor(t, 'Business metrics unavailable', '业务统计不可用')}</strong><span>{billingMetricsStatus.error}</span></div>}
        <div className="market-dashboard billing-metrics-dashboard">
          <article className="metric-card highlight"><span>{textFor(t, 'Points consumed', '积分消耗')}</span><strong>{billingMetrics?.consumption.points ?? 0}</strong><small>{billingMetrics?.refunds.points ?? 0} {textFor(t, 'refunded', '已退回')}</small></article>
          <article className="metric-card highlight"><span>{textFor(t, 'Creative credits', '创作积分')}</span><strong>{billingMetrics?.consumption.creativeCredits ?? 0}</strong><small>{billingMetrics?.refunds.creativeCredits ?? 0} {textFor(t, 'refunded', '已退回')}</small></article>
          <article className="metric-card highlight"><span>{textFor(t, 'Quota used', '配额消耗')}</span><strong>{billingMetrics?.consumption.quotaUnits ?? 0}</strong><small>{billingMetrics?.refunds.quotaUnits ?? 0} {textFor(t, 'released', '已释放')}</small></article>
          <article className="metric-card highlight"><span>{textFor(t, 'Open anomalies', '待处理异常')}</span><strong>{billingMetrics?.anomalies.open ?? 0}</strong><small>{billingMetrics?.operations.failed ?? 0} {textFor(t, 'failed operations', '个失败操作')}</small></article>
        </div>
        <div className="permission-summary">
          <label>
            <span>{textFor(t, 'Status', '状态')}</span>
            <select
              aria-label={textFor(t, 'Accounting issue status', '对账问题状态')}
              value={accountingStatusFilter ?? ''}
              onChange={(event) => setAccountingStatusFilter(event.target.value ? event.target.value as AdminAccountingIssueStatus : null)}
            >
              <option value="">{textFor(t, 'All', '全部')}</option>
              <option value="open">{textFor(t, 'Open', '待处理')}</option>
              <option value="repair_pending">{textFor(t, 'Repair pending', '待审批')}</option>
              <option value="resolved">{textFor(t, 'Resolved', '已解决')}</option>
              <option value="ignored">{textFor(t, 'Ignored', '已忽略')}</option>
            </select>
          </label>
          <label>
            <span>{textFor(t, 'Unit', '单位')}</span>
            <select
              aria-label={textFor(t, 'Accounting unit', '账务单位')}
              value={accountingUnitFilter ?? ''}
              onChange={(event) => setAccountingUnitFilter(event.target.value ? event.target.value as AdminAccountingUnit : null)}
            >
              <option value="">{textFor(t, 'All', '全部')}</option>
              <option value="points">points</option>
              <option value="creative_credit">creative_credit</option>
              <option value="quota_unit">quota_unit</option>
            </select>
          </label>
          <label>
            <span>{textFor(t, 'Issue type', '问题类型')}</span>
            <input
              aria-label={textFor(t, 'Accounting issue type', '对账问题类型')}
              value={accountingTypeFilter}
              onChange={(event) => setAccountingTypeFilter(event.target.value)}
              placeholder="point_balance_drift"
            />
          </label>
          <button className="ghost-button" type="button" onClick={() => void accountingStatusResource.refresh()} disabled={!canReadAccounting}>
            {textFor(t, 'Refresh', '刷新')}
          </button>
        </div>
        <div className="market-dashboard">
          {[
            [textFor(t, 'Open', '待处理'), accountingSummary.open],
            [textFor(t, 'Repair pending', '待审批'), accountingSummary.repairPending],
            [textFor(t, 'Resolved', '已解决'), accountingSummary.resolved],
            [textFor(t, 'Total', '总计'), accountingSummary.total],
          ].map(([label, value]) => (
            <article className="metric-card highlight" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
              <small>{accountingGeneratedAt ? formatAuditTime(accountingGeneratedAt) : textFor(t, 'No scan yet', '尚未扫描')}</small>
            </article>
          ))}
        </div>
        <div className="admin-table">
          {accountingStatusResource.loading && (
            <div className="empty-state">
              <strong>{textFor(t, 'Loading reconciliation', '正在加载对账结果')}</strong>
            </div>
          )}
          {!accountingStatusResource.loading && accountingStatusResource.error && (
            <div className="empty-state">
              <strong>{textFor(t, 'Reconciliation unavailable', '对账不可用')}</strong>
              <span>{accountingStatusResource.error}</span>
            </div>
          )}
          {!accountingStatusResource.loading && !accountingStatusResource.error && accountingIssues.length === 0 && (
            <div className="empty-state">
              <strong>{textFor(t, 'No matching issues', '没有匹配的问题')}</strong>
              <span>{textFor(t, 'The selected reconciliation view is clear.', '当前筛选范围内没有对账异常。')}</span>
            </div>
          )}
          {!accountingStatusResource.error && accountingIssues.map((issue) => (
            <div className="admin-row" key={issue.id}>
              <StatusBadge status={issue.status} t={t} />
              <strong>{issue.type}</strong>
              <span>{issue.unit} · {issue.sourceType}</span>
              <small>
                {textFor(t, 'expected', '预期')} {issue.expectedAmount ?? '-'} · {textFor(t, 'actual', '实际')} {issue.actualAmount ?? '-'} · {textFor(t, 'difference', '差额')} {issue.differenceAmount ?? '-'}
              </small>
              <div className="button-row compact-buttons">
                <button
                  className="ghost-button small"
                  type="button"
                  onClick={() => setSelectedAccountingIssueId((current) => current === issue.id ? null : issue.id)}
                >
                  {selectedAccountingIssueId === issue.id ? textFor(t, 'Hide', '收起') : textFor(t, 'Evidence', '证据')}
                </button>
                {accountingIssueCanRepair(issue) && (
                  <button
                    className="danger-button small"
                    type="button"
                    onClick={() => void requestAccountingRepair(issue)}
                    disabled={!canRepairAccounting || Boolean(requestingAccountingRepairId)}
                  >
                    <ShieldAlert size={15} />
                    {requestingAccountingRepairId === issue.id ? textFor(t, 'Requesting', '提交中') : textFor(t, 'Request compensation', '申请补偿')}
                  </button>
                )}
              </div>
              {selectedAccountingIssueId === issue.id && (
                <div className="admin-detail-panel">
                  <strong>{issue.issueKey}</strong>
                  <span>{issue.sourceId}</span>
                  <pre>{formatMetadataJson(issue.evidence)}</pre>
                  {issue.repairOperationKey && <small>{issue.repairOperationKey}</small>}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
      <AdminGenerationWorkspaceNavigation
        t={t}
        workspace={generationOperationsWorkspace}
        hidden={activeTab !== 'Generations'}
        actionMessage={generationActionMessage}
        onChange={changeGenerationOperationsWorkspace}
      />
      <AdminProviderControlsPanel
        t={t}
        hidden={activeTab !== 'Generations' || generationOperationsWorkspace !== 'providers'}
        status={providerControlStatus}
        controls={providerControls}
        reason={providerControlReason}
        runningAction={runningProviderControlAction}
        canRead={canReadProviderControls}
        canManage={canManageProviderControls}
        canRecover={canRecoverProviderControls}
        setReason={setProviderControlReason}
        formatAmount={formatProviderCostAmount}
        formatTime={formatAuditTime}
        onRunAction={runProviderControlAction}
      />
      <AdminGenerationWorkspacePanel
        t={t}
        workspace={generationOperationsWorkspace}
        hidden={activeTab !== 'Generations' || generationOperationsWorkspace === 'providers'}
        loading={generationOperationsWorkspace === 'records'
          ? generationHistoryStatus.loading
          : generationOperationsWorkspace === 'recovery'
            ? generationExecutionStatus.loading
            : generationMetricsStatus.loading}
        exporting={generationOperationsWorkspace === 'records' ? exportingGenerations : exportingGenerationMetrics}
        canRead={canReadAudit}
        canExport={canExportAudit}
        onRefresh={() => {
          if (generationOperationsWorkspace === 'records') void generationHistoryStatus.refresh()
          else if (generationOperationsWorkspace === 'recovery') void generationExecutionStatus.refresh()
          else void generationMetricsStatus.refresh()
        }}
        onExport={generationOperationsWorkspace === 'records'
          ? () => void exportGenerations()
          : generationOperationsWorkspace === 'metrics'
            ? () => void exportGenerationMetrics()
            : undefined}
      >
        {generationOperationsWorkspace === 'records' && (
          <AdminGenerationRecordsPanel
            t={t}
            state={generationState.state}
            setters={generationState.setters}
            status={generationHistoryStatus}
            canRead={canReadAudit}
            canReadQueues={canReadQueues}
            canCancel={canCancelGenerations}
            canRequestRetries={canRequestGenerationRetries}
            canRequestManualReplay={canRequestManualReplay}
            canRepairAccounting={canRepairAccounting}
            onClearFilters={clearGenerationFilters}
            onChangeBulkAction={changeGenerationBulkAction}
            onPreviewBulkAction={previewGenerationBulkAction}
            onExecuteBulkAction={executeGenerationBulkAction}
            onToggleSelection={toggleGenerationSelection}
            onToggleDetail={toggleGenerationDetail}
            onFocusMedia={focusGenerationMediaAsset}
            onFocusAudit={(generationId) => focusGenerationAudit(generationId)}
            onLoadMore={loadMoreGenerations}
            onMutation={runGenerationMutation}
            onSettleProviderCost={settleSelectedProviderCost}
            formatTime={formatAuditTime}
            formatNumber={formatMetricNumber}
            formatProviderCostAmount={formatProviderCostAmount}
            formatProviderCostSummary={formatProviderCostSummary}
            formatProviderBudgetSummary={formatProviderBudgetSummary}
          />
        )}
        {generationOperationsWorkspace === 'metrics' && (
          <AdminGenerationMetricsPanel
            t={t}
            state={generationState.state}
            setters={generationState.setters}
            status={generationMetricsStatus}
            canRead={canReadAudit}
            onClearFilters={clearGenerationMetricsFilters}
            formatNumber={formatMetricNumber}
          />
        )}
        {generationOperationsWorkspace === 'recovery' && (
          <AdminGenerationRecoveryPanel
            t={t}
            status={generationExecutionStatus}
            executions={generationExecutions}
            reason={generationRecoveryReason}
            errorCode={generationRecoveryError}
            recoveringExecutionId={recoveringGenerationExecutionId}
            canRecover={canRequestGenerationRetries}
            setReason={setGenerationRecoveryReason}
            setErrorCode={setGenerationRecoveryError}
            formatTime={formatAuditTime}
            onRecover={recoverGenerationExecution}
          />
        )}
      </AdminGenerationWorkspacePanel>
      {activeTab === 'Submissions' && <SubmissionReviewPanel
        t={t}
        items={visibleQueueItems}
        loading={queueStatus.loading}
        error={queueStatus.error}
        filter={reviewQueueFilter}
        pointReviewCount={pointReviewCount}
        selectedId={selectedReviewId}
        highlightedId={highlightedReviewId}
        reviewing={reviewingQueueItems}
        notes={reviewNotes}
        approvalTemplates={pointPolicy?.approvalTemplates ?? []}
        actionMessage={reviewActionMessage}
        canReview={canReviewQueues}
        onFilterChange={setReviewQueueFilter}
        onSelect={setSelectedReviewId}
        onNoteChange={(id, value) => setReviewNotes((current) => ({ ...current, [id]: value }))}
        onApplyTemplate={applyApprovalTemplate}
        onReview={(item, decision) => void reviewQueueItem(item, decision)}
        onRefresh={() => void queueStatus.refresh()}
        onClearHighlight={() => setHighlightedReviewId(null)}
        onClearActionMessage={() => setReviewActionMessage(null)}
      />}
      {activeTab === 'Security' && securityWorkspace === 'overview' && (
        <SecurityOperationsWorkspace
          t={t}
          canReadAudit={canReadAudit}
          canReadQueues={canReadQueues}
          canReviewQueues={canReviewQueues}
          status={operationsMetricsStatus}
          metrics={operationsMetrics}
          handoff={operationsMetrics ? buildOperationsHandoff(operationsMetrics) : null}
          windowMinutes={operationsMetricsWindow}
          windowOptions={operationsMetricWindows}
          exporting={exportingOperationsSnapshot}
          writingArchive={writingScanArchive}
          sampleKey={operationsSampleKey}
          sampleTitle={operationsSampleKey ? operationSampleConfig(operationsSampleKey).title : ''}
          samples={operationsSamples}
          samplesLoading={loadingOperationsSamples}
          samplesError={operationsSamplesError}
          formatNumber={formatMetricNumber}
          formatAmount={formatMetricAmount}
          formatBytes={formatMetricBytes}
          formatLatency={formatMetricLatency}
          formatAuditTime={formatAuditTime}
          formatCountSummary={metricCountSummary}
          sampleMetaEntries={operationSampleMetaEntries}
          onRefresh={() => void operationsMetricsStatus.refresh()}
          onWindowChange={setOperationsMetricsWindow}
          onExport={() => void exportOperationsSnapshot()}
          onOpenMediaQueue={focusMediaGovernanceFromMetrics}
          onWriteArchive={() => void writeScanArchiveFromMetrics()}
          onToggleSamples={(key) => void toggleOperationSamples(key)}
          onFocusAudit={focusAuditFilter}
          onCloseSamples={() => {
            setOperationsSampleKey(null)
            setOperationsSamples([])
            setOperationsSamplesError(null)
          }}
        />
      )}
      {activeTab === 'Security' && securityWorkspace === 'incidents' && (
        <SecurityWorkspacePanel
          t={t}
          workspace="incidents"
          action={
            <button className="ghost-button" type="button" onClick={() => void refreshSecurityIncidents()} disabled={!canReadAudit || securityStatus.loading || securityAlertStatus.loading || securityIncidentStatus.loading}>
              <ShieldAlert size={17} />
              {securityStatus.loading || securityAlertStatus.loading || securityIncidentStatus.loading ? textFor(t, 'Loading', '加载中') : textFor(t, 'Refresh', '刷新')}
            </button>
          }
        >
          <SecurityIncidentsWorkspace
            t={t}
            canReadAudit={canReadAudit}
            canManageSecurityAlerts={canManageSecurityAlerts}
            alerts={{
              status: securityAlertStatus,
              items: securityAlerts,
              highlightedId: highlightedSecurityAlertId,
              handlingId: handlingSecurityAlertId,
              selectedId: selectedSecurityAlertId,
              exportingId: exportingSecurityAlertId,
              events: securityAlertEvents,
              eventsLoading: loadingSecurityAlertEvents,
              eventsError: securityAlertEventsError,
            }}
            incidents={{
              status: securityIncidentStatus,
              items: securityIncidents,
              selectedOpenId: selectedOpenIncidentId,
              handlingId: handlingSecurityIncidentId,
            }}
            eventStream={{
              status: securityStatus,
              items: securityEvents,
              source: securitySourceFilter,
              severity: securitySeverityFilter,
              type: securityTypeFilter,
              nextCursor: securityNextCursor,
              loadingMore: loadingMoreSecurityEvents,
            }}
            actions={{
              onToggleAlertEvents: (alert) => void toggleSecurityAlertEvents(alert),
              onAcknowledgeAlert: (alert) => void acknowledgeSecurityAlert(alert),
              onUnsilenceAlert: (alert) => void unsilenceSecurityAlert(alert),
              onExportAlert: (alert) => void exportSecurityAlert(alert),
              onFilterByAlertSource: filterSecurityEventsBySource,
              onSelectOpenIncident: setSelectedOpenIncidentId,
              onBeginOperation: beginSecurityOperation,
              onAttachEvent: (event) => void attachSecurityEventToIncident(event),
              onSourceChange: (source) => {
                setSecurityNextCursor(null)
                setSecuritySourceFilter(source)
              },
              onSeverityChange: (severity) => {
                setSecurityNextCursor(null)
                setSecuritySeverityFilter(severity)
              },
              onTypeChange: (type) => {
                setSecurityNextCursor(null)
                setSecurityTypeFilter(type)
              },
              onClearFilters: clearSecurityFilters,
              onLoadMore: () => void loadMoreSecurityEvents(),
            }}
          />
        </SecurityWorkspacePanel>
      )}
      <section className="panel admin-audit-panel" hidden={activeTab !== 'Audit log'}>
        <SectionHeader
          eyebrow={textFor(t, 'Audit', '审计')}
          title={textFor(t, 'Recent privileged actions', '近期高权限操作')}
          action={
            <button className="ghost-button" type="button" onClick={() => void auditStatus.refresh()} disabled={!canReadAudit || auditStatus.loading}>
              {auditStatus.loading ? textFor(t, 'Loading', '加载中') : textFor(t, 'Refresh', '刷新')}
            </button>
          }
        />
        <AdminActionFeedback message={auditActionMessage} />
        <div className="permission-summary">
          <label>
            <span>{textFor(t, 'Action', '动作')}</span>
            <input
              list="audit-action-options"
              aria-label={textFor(t, 'Audit action filter', '审计动作筛选')}
              value={auditActionFilter}
              onChange={(event) => {
                setHighlightedAuditEventId(null)
                setAuditActionFilter(event.target.value)
              }}
              disabled={!canReadAudit}
            />
            <datalist id="audit-action-options">
              <option value="media.governance_policy.updated">media.governance_policy.updated</option>
              <option value="media.governance_policy.rolled_back">media.governance_policy.rolled_back</option>
              <option value="points.policy.updated">points.policy.updated</option>
              <option value="points.policy.rolled_back">points.policy.rolled_back</option>
              <option value="media.scan.timeout">media.scan.timeout</option>
              <option value="media.scan.callback_denied">media.scan.callback_denied</option>
            </datalist>
          </label>
          <label>
            <span>{textFor(t, 'Resource type', '资源类型')}</span>
            <input
              list="audit-resource-options"
              aria-label={textFor(t, 'Audit resource type filter', '审计资源类型筛选')}
              value={auditResourceTypeFilter}
              onChange={(event) => {
                setHighlightedAuditEventId(null)
                setAuditResourceTypeFilter(event.target.value)
              }}
              disabled={!canReadAudit}
            />
            <datalist id="audit-resource-options">
              <option value="media_governance_policy">media_governance_policy</option>
              <option value="point_adjustment_policy">point_adjustment_policy</option>
              <option value="media_asset">media_asset</option>
              <option value="media_scan_alert">media_scan_alert</option>
              <option value="operations_metrics">operations_metrics</option>
              <option value="admin_review">admin_review</option>
            </datalist>
          </label>
          <label>
            <span>{textFor(t, 'Resource ID', '资源 ID')}</span>
            <input aria-label={textFor(t, 'Audit resource ID filter', '审计资源 ID 筛选')} value={auditResourceIdFilter} onChange={(event) => setAuditResourceIdFilter(event.target.value)} disabled={!canReadAudit} />
          </label>
          <label>
            <span>{textFor(t, 'Actor type', '操作者类型')}</span>
            <select aria-label={textFor(t, 'Audit actor type filter', '审计操作者类型筛选')} value={auditActorTypeFilter} onChange={(event) => setAuditActorTypeFilter(event.target.value as typeof auditActorTypeFilter)} disabled={!canReadAudit}>
              <option value="all">{textFor(t, 'All actors', '全部操作者')}</option>
              <option value="user">user</option>
              <option value="system">system</option>
            </select>
          </label>
          <label>
            <span>{textFor(t, 'Actor ID', '操作者 ID')}</span>
            <input aria-label={textFor(t, 'Audit actor ID filter', '审计操作者 ID 筛选')} value={auditActorIdFilter} onChange={(event) => setAuditActorIdFilter(event.target.value)} disabled={!canReadAudit} />
          </label>
          <label>
            <span>{textFor(t, 'From', '开始日期')}</span>
            <input type="date" aria-label={textFor(t, 'Audit start date', '审计开始日期')} value={auditDateFrom} onChange={(event) => setAuditDateFrom(event.target.value)} disabled={!canReadAudit} />
          </label>
          <label>
            <span>{textFor(t, 'To', '结束日期')}</span>
            <input type="date" aria-label={textFor(t, 'Audit end date', '审计结束日期')} value={auditDateTo} onChange={(event) => setAuditDateTo(event.target.value)} disabled={!canReadAudit} />
          </label>
          <label>
            <span>{textFor(t, 'Order', '排序')}</span>
            <select aria-label={textFor(t, 'Audit sort direction', '审计排序方向')} value={auditDirection} onChange={(event) => setAuditDirection(event.target.value as typeof auditDirection)} disabled={!canReadAudit}>
              <option value="desc">{textFor(t, 'Newest first', '最新优先')}</option>
              <option value="asc">{textFor(t, 'Oldest first', '最早优先')}</option>
            </select>
          </label>
          <button className="ghost-button" type="button" onClick={focusMediaGovernanceAudit} disabled={!canReadAudit}>
            {textFor(t, 'Media policy audit', '媒体策略审计')}
          </button>
          <button className="ghost-button" type="button" onClick={() => void exportAuditEvents()} disabled={!canExportAudit || exportingAudit}>
            <Download size={17} />
            {exportingAudit ? textFor(t, 'Exporting', '导出中') : textFor(t, 'Export JSON', '导出 JSON')}
          </button>
          <button className="ghost-button" type="button" onClick={() => void verifyAuditIntegrity()} disabled={!canVerifyAudit || verifyingAudit}>
            <ShieldCheck size={17} />
            {verifyingAudit ? textFor(t, 'Verifying', '验证中') : textFor(t, 'Verify integrity', '验证完整性')}
          </button>
          <button className="ghost-button" type="button" onClick={() => void archiveAuditEvidence()} disabled={!canArchiveAudit || archivingAudit}>
            <Archive size={17} />
            {archivingAudit ? textFor(t, 'Archiving', '归档中') : textFor(t, 'Archive evidence', '归档证据')}
          </button>
          <button className="ghost-button" type="button" onClick={clearAuditFilters} disabled={!canReadAudit || (!auditActionFilter && !auditResourceTypeFilter && !auditResourceIdFilter && auditActorTypeFilter === 'all' && !auditActorIdFilter && !auditDateFrom && !auditDateTo && auditDirection === 'desc' && !highlightedAuditEventId)}>
            {textFor(t, 'Clear filters', '清除筛选')}
          </button>
        </div>
        {auditIntegrity && (
          <div className={`audit-integrity-summary ${auditIntegrity.status}`} role="status">
            <strong>{auditIntegrity.status === 'complete'
              ? textFor(t, 'Integrity complete', '完整性正常')
              : auditIntegrity.status === 'broken'
                ? textFor(t, 'Integrity broken', '完整性损坏')
                : textFor(t, 'Integrity unverifiable', '无法验证完整性')}</strong>
            <span>{textFor(t, 'Events', '事件')}: {auditIntegrity.count} · {textFor(t, 'Archives', '归档')}: {auditArchives.length}</span>
            {auditIntegrity.rootHash && <code>{auditIntegrity.rootHash.slice(0, 16)}</code>}
          </div>
        )}
        {activeTab === 'Audit log' && (
          <Suspense fallback={<div className="route-loading" role="status" aria-live="polite"><span className="status-dot loading" aria-hidden="true" />{textFor(t, 'Loading retention controls', '正在加载保留策略')}</div>}>
            <AuditRetentionPanel
              canRead={canReadAudit}
              canExecute={canExecuteAuditRetention}
              isZh={isZh}
              t={t}
              onChanged={() => {
                void auditStatus.refresh()
                void verifyAuditIntegrity()
              }}
            />
          </Suspense>
        )}
        <div className="admin-table">
          {auditStatus.loading && (
            <div className="empty-state">
              <strong>{textFor(t, 'Loading audit log', '正在加载审计日志')}</strong>
              <span>{textFor(t, 'Reading administrator-visible events from the API.', '正在从 API 读取管理员可见事件。')}</span>
            </div>
          )}
          {!auditStatus.loading && auditStatus.error && (
            <div className="empty-state">
              <strong>{textFor(t, 'Audit unavailable', '审计不可用')}</strong>
              <span>{auditStatus.error}</span>
              <button className="ghost-button" type="button" onClick={() => void auditStatus.refresh()}>
                {textFor(t, 'Retry sync', '重试同步')}
              </button>
            </div>
          )}
          {!auditStatus.loading && !auditStatus.error && auditEvents.length === 0 && (
            <div className="empty-state">
              <strong>{textFor(t, 'No audit events yet', '暂无审计事件')}</strong>
              <span>{textFor(t, 'Create, claim, review, or moderate content to populate this log.', '执行创建、接单、验收或治理操作后会出现在这里。')}</span>
            </div>
          )}
          {!auditStatus.loading && !auditStatus.error && auditEvents.map((event) => {
            const metadata = asRecord(event.metadata)
            const expanded = Boolean(expandedAuditEventIds[event.id])
            const diffRows = mediaGovernanceDiffRows(metadata.diff)
            const projectedDiff = event.diff
            const extraMetadata = metadataEntries(metadata)
            const hasDetails = Object.keys(metadata).length > 0 || Boolean(projectedDiff)
            const operationsSampleCounts = asRecord(metadata.sampleCounts)
            const operationsSampleCountEntries = Object.entries(operationsSampleCounts)
            return (
              <div className={highlightedAuditEventId === event.id ? 'admin-row deep-linked' : 'admin-row'} key={event.id}>
                <StatusBadge status="Publish audit" t={t} />
                <strong>{event.action}</strong>
                <span>{event.actorId ? `@${event.actorId}` : event.actorType}</span>
                <small>
                  {event.resourceType}
                  {event.resourceId ? ` / ${event.resourceId}` : ''} · {formatAuditTime(event.createdAt)}
                </small>
                <div className="button-row">
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => simulateAction(isZh ? `已查看审计事件：${event.action}` : `Audit event inspected: ${event.action}`)}
                  >
                    {textFor(t, 'Inspect', '查看')}
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => void copyAuditEventLink(event)}
                  >
                    <Clipboard size={17} />
                    {textFor(t, 'Copy link', '复制链接')}
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => exportAuditEventJson(event)}
                  >
                    <Download size={17} />
                    {textFor(t, 'Export JSON', '导出 JSON')}
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => setExpandedAuditEventIds((current) => ({ ...current, [event.id]: !expanded }))}
                    disabled={!hasDetails}
                  >
                    {expanded ? textFor(t, 'Hide details', '收起详情') : textFor(t, 'Details', '详情')}
                  </button>
                </div>
                {expanded && (
                  <div className="audit-detail-panel">
                    {projectedDiff?.changes?.length ? (
                      <div className="policy-diff-grid">
                        {projectedDiff.changes.map((change) => (
                          <div className="policy-diff-row" key={change.path}>
                            <strong>{change.path}</strong>
                            <span>{formatDiffValue(change.before)}</span>
                            <span aria-hidden="true">-&gt;</span>
                            <span>{formatDiffValue(change.after)}</span>
                          </div>
                        ))}
                      </div>
                    ) : projectedDiff?.value != null ? (
                      <div className="audit-json-block">
                        <strong>{textFor(t, 'Projected diff', '安全差异')}</strong>
                        <pre>{formatMetadataJson(projectedDiff.value)}</pre>
                      </div>
                    ) : null}
                    {isOperationsMetricsExportAudit(event) ? (
                      <div className="audit-operations-snapshot">
                        <div>
                          <strong>{textFor(t, 'Operations handoff snapshot', '运营交接快照')}</strong>
                          <span>
                            {textFor(t, 'Exported window', '导出窗口')}: {formatMetricNumber(Number(metadata.windowMinutes ?? 60))}m
                            {' · '}
                            {textFor(t, 'Hints', '建议')}: {formatMetricNumber(Number(metadata.hintCount ?? 0))}
                            {' · '}
                            {formatAuditTime(String(metadata.exportedAt ?? event.createdAt))}
                          </span>
                        </div>
                        {operationsSampleCountEntries.length > 0 ? (
                          <div className="audit-operations-sample-counts">
                            {operationsSampleCountEntries.map(([key, value]) => (
                              <span key={key}>
                                <b>{operationSampleCountLabel(key)}</b>
                                {formatMetricNumber(Number(value ?? 0))}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        <button
                          className="ghost-button"
                          type="button"
                          onClick={() => openOperationsMetricsFromAudit(metadata)}
                        >
                          <BarChart3 size={17} />
                          {textFor(t, 'Open metrics window', '打开指标窗口')}
                        </button>
                      </div>
                    ) : null}
                    {metadata.summary ? (
                      <div className="audit-detail-summary">
                        <strong>{textFor(t, 'Summary', '摘要')}</strong>
                        <span>{String(metadata.summary)}</span>
                      </div>
                    ) : null}
                    {diffRows.length > 0 ? (
                      <div className="policy-diff-grid">
                        {diffRows.map((row) => (
                          <div className="policy-diff-row" key={row.key}>
                            <strong>{textFor(t, row.en, row.zh)}</strong>
                            <span>{row.from}</span>
                            <span aria-hidden="true">-&gt;</span>
                            <span>{row.to}</span>
                          </div>
                        ))}
                      </div>
                    ) : metadata.diff ? (
                      <div className="audit-json-block">
                        <strong>diff</strong>
                        <pre>{formatMetadataJson(metadata.diff)}</pre>
                      </div>
                    ) : null}
                    {metadata.previous ? (
                      <div className="audit-json-block">
                        <strong>previous</strong>
                        <pre>{formatMetadataJson(metadata.previous)}</pre>
                      </div>
                    ) : null}
                    {metadata.next ? (
                      <div className="audit-json-block">
                        <strong>next</strong>
                        <pre>{formatMetadataJson(metadata.next)}</pre>
                      </div>
                    ) : null}
                    {extraMetadata.length > 0 && (
                      <div className="audit-metadata-grid">
                        {extraMetadata.map(([key, value]) => (
                          <div key={key}>
                            <strong>{key}</strong>
                            <span>{typeof value === 'object' ? formatMetadataJson(value) : String(value ?? 'null')}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>
        </div>
      </div>
    </div>
  )
}
