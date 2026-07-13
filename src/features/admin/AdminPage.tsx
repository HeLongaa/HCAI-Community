import { useEffect, useMemo, useState } from 'react'
import { Activity, Archive, BarChart3, Bell, Clipboard, Download, PlayCircle, RotateCcw, ShieldAlert, Trophy, XCircle } from 'lucide-react'
import type { AdminDeepLink, AuditEvent, Page, Permission, Role, SimulateAction } from '../../domain/types'
import { SectionHeader } from '../../components/ui/SectionHeader'
import { NotificationList } from '../../components/ui/NotificationList'
import { StatusBadge } from '../tasks'
import { adminQueues } from '../../data/mockData'
import { isZhCopy, pointText, textFor } from '../../domain/utils'
import { adminService } from '../../services/adminService'
import { notificationService } from '../../services/notificationService'
import { mediaService } from '../../services/mediaService'
import { useAsyncResource } from '../../hooks/useAsyncResource'
import type {
  AdminPermissionDto,
  AdminCreativeGenerationHistoryQuery,
  AdminOperationsMetricsDto,
  AdminProviderControlBundle,
  AdminProviderControlRecoveryTarget,
  AdminReviewDecision,
  AdminReviewQueueItemDto,
  AdminRolePermissionDto,
  AdminSecurityAlertEventDto,
  AdminSecurityAlertDto,
  AdminSecurityEventDto,
  AdminSecurityEventListQuery,
  ApiCreativeGenerationRecord,
  ApiLedgerEntry,
  ApiMediaGovernanceConfig,
  ApiMediaAsset,
  ApiMediaScanAlert,
  ApiMediaScanAlertEvent,
  ApiMediaScanJob,
  ApiNotification,
  ApiPointsSummary,
  MediaScanJobHistoryPage,
  MediaAssetPurpose,
  MediaGovernancePolicyPatch,
  MediaGovernancePolicyHistoryItem,
  MediaReviewQueueQuery,
  NotificationListQuery,
  PointAdjustmentPolicy,
  PointAdjustmentPolicyHistoryItem,
  PointAdjustmentReviewMetadata,
  PointsLedgerQuery,
} from '../../services/contracts'

const pointPolicyRoles: Array<keyof PointAdjustmentPolicy['roleLimits']> = ['member', 'creator', 'publisher', 'moderator', 'admin']
const notificationReadStates: Array<NonNullable<NotificationListQuery['readState']>> = ['unread', 'all', 'read']
const notificationTypes = ['task.proposal_submitted', 'task.proposal_accepted', 'task.proposal_rejected', 'task.submission_submitted', 'task.submission_resubmitted', 'task.revision_requested', 'task.submission_approved', 'task.submission_rejected', 'task.reward_settled', 'task.submission_stale', 'task.dispute_opened', 'task.dispute_received', 'points.adjustment.requested', 'points.adjustment.approved', 'points.adjustment.rejected', 'points.policy.updated', 'points.policy.rolled_back', 'media.governance_policy.updated', 'media.governance_policy.rolled_back', 'media.scan.review_required', 'media.scan.rejected', 'media.scan.retry_requested', 'media.scan.alert', 'security.event.alert']
const notificationResourceTypes = ['task', 'admin_review', 'point_adjustment_policy', 'media_governance_policy', 'media_asset', 'media_scan_alert', 'security_alert']
const mediaReviewStatuses: Array<NonNullable<MediaReviewQueueQuery['status']>> = ['review', 'scanning', 'pending', 'rejected', 'clean', 'all']
const mediaPurposes: MediaAssetPurpose[] = ['task_attachment', 'submission_asset', 'profile_portfolio', 'library_asset']
const creativeHistoryWorkspaces = ['image', 'video', 'music', 'chat']
const creativeHistoryStatuses = ['queued', 'running', 'completed', 'failed', 'cancelled', 'review_required']
const securityEventSources: Array<NonNullable<AdminSecurityEventListQuery['source']>> = ['rate_limit', 'body_size', 'auth_failure']
const securityEventSeverities = ['warning', 'info', 'critical']
const operationsMetricWindows = [15, 60, 240, 1440]
type OperationsSampleKey =
  | 'securityDispatchFailures'
  | 'mediaDispatchFailures'
  | 'archiveWrites'
  | 'historyPruned'
  | 'creativeProviderBudgetThresholds'
  | 'creativeProviderBudgetDispatchBlocks'
  | 'creativeProviderCostAnomalies'
  | 'creativeProviderAlertDispatches'
const mediaScanHistoryPageSize = 6
const mediaPolicyDraftKeys = [
  'retryDelaySeconds',
  'timeoutSeconds',
  'maxAttempts',
  'workerIntervalSeconds',
  'historyRetentionDays',
  'historyRetentionMaxPerAsset',
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
const isPointAdjustmentMetadata = (metadata: unknown): metadata is PointAdjustmentReviewMetadata =>
  Boolean(metadata && typeof metadata === 'object' && (metadata as PointAdjustmentReviewMetadata).kind === 'point_adjustment')
const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const mediaGovernanceDiffFields = [
  { path: ['scanner', 'retryDelaySeconds'], en: 'Retry delay seconds', zh: '重试延迟秒' },
  { path: ['scanner', 'timeoutSeconds'], en: 'Scan timeout seconds', zh: '扫描超时秒' },
  { path: ['scanner', 'maxAttempts'], en: 'Max attempts', zh: '最大尝试' },
  { path: ['scanner', 'workerIntervalSeconds'], en: 'Worker interval seconds', zh: 'Worker 间隔秒' },
  { path: ['retention', 'historyRetentionDays'], en: 'Retention days', zh: '保留天数' },
  { path: ['retention', 'historyRetentionMaxPerAsset'], en: 'Max history per asset', zh: '单资产历史上限' },
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
const formatGenerationStatus = (status: string) => status.replaceAll('_', ' ')
const recordNumber = (record: Record<string, unknown>, key: string) => {
  const value = Number(record[key] ?? 0)
  return Number.isFinite(value) ? value : 0
}
const generationCredit = (generation: ApiCreativeGenerationRecord) => asRecord(generation.credit)
const generationQuota = (generation: ApiCreativeGenerationRecord) => asRecord(generation.quota)
const generationSafety = (generation: ApiCreativeGenerationRecord) => asRecord(generation.safety)
const generationCreditStatus = (generation: ApiCreativeGenerationRecord) => String(generationCredit(generation).status ?? 'none')
const generationCreditAmount = (generation: ApiCreativeGenerationRecord, key: 'reserved' | 'settled' | 'refunded') => recordNumber(generationCredit(generation), key)
const generationQuotaAmount = (generation: ApiCreativeGenerationRecord, key: 'limit' | 'used' | 'remaining' | 'released' | 'reserved') => recordNumber(generationQuota(generation), key)
const generationReviewRequired = (generation: ApiCreativeGenerationRecord) => Boolean(generationSafety(generation).reviewRequired)
const generationReplayCount = (generation: ApiCreativeGenerationRecord) =>
  generation.providerReplayEvidence?.available ? generation.providerReplayEvidence.count : 0
const generationProviderCost = (generation: ApiCreativeGenerationRecord) => generation.usage?.providerCost ?? null
const providerReplayEvidenceSummary = (generation: ApiCreativeGenerationRecord, t: Record<string, string>) => {
  const evidence = generation.providerReplayEvidence
  if (!evidence?.available) return textFor(t, 'Replay ledger unavailable', 'Replay ledger 不可用')
  if (!evidence.count) return textFor(t, 'No replay records', '暂无 replay 记录')
  const latest = evidence.latest
  if (!latest) return `${evidence.count} ${textFor(t, 'records', '条记录')}`
  return [
    `${evidence.count} ${textFor(t, 'records', '条记录')}`,
    `${latest.sourceType}/${latest.action}/${latest.normalizedStatus ?? '-'}`,
    `${textFor(t, 'outcome', '结果')} ${latest.sideEffectOutcome}`,
    latest.payloadHashPresent
      ? `${textFor(t, 'payload hash', 'payload hash')} ${latest.payloadHashPreview ?? textFor(t, 'present', '存在')}`
      : textFor(t, 'payload hash missing', '缺少 payload hash'),
    latest.sideEffectCompleted
      ? textFor(t, 'side effects complete', 'side effect 已完成')
      : textFor(t, 'side effects pending', 'side effect 未完成'),
  ].join(' · ')
}
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
  const adminTabs = ['Task review', 'Access', 'Security', 'Finance', 'Generations', 'Submissions', 'Community', 'Audit log', 'Users', 'Tags', 'AI config']
  const adminTabLabels: Record<string, string> = {
    'Task review': textFor(t, 'Task review', '任务审核'),
    Access: textFor(t, 'Access', '权限'),
    Security: textFor(t, 'Security', '安全'),
    Finance: textFor(t, 'Finance', '账务'),
    Generations: textFor(t, 'Generations', '生成历史'),
    Submissions: textFor(t, 'Submissions', '交付物'),
    Community: textFor(t, 'Community', '社区'),
    'Audit log': textFor(t, 'Audit log', '审计日志'),
    Users: textFor(t, 'Users', '用户'),
    Tags: textFor(t, 'Tags', '标签'),
    'AI config': textFor(t, 'AI config', 'AI 配置'),
  }
  const fallbackQueueItems: AdminReviewQueueItemDto[] = useMemo(() => (isZh
    ? [
        ['Pending review', '音乐提示词包', 'soundforge', '验收后发放 1,200 积分'],
        ['Resubmission', '电商图片广告工作流', 'shopstudio', '已驳回一次，需要补充品类样例'],
        ['Community report', 'AI 任务定价讨论帖', 'n8than', '可考虑精选到灵感库'],
        ['Publish audit', '产品发布视频需求', 'launchteam', '检查私密附件权限'],
      ]
    : adminQueues).map(([status, title, owner, note], index) => ({
      id: `fallback-review-${index + 1}`,
      status,
      title,
      owner,
      note,
      queue: status,
    })), [isZh])
  const [activeTab, setActiveTab] = useState('Task review')
  const [queueItems, setQueueItems] = useState<AdminReviewQueueItemDto[]>(fallbackQueueItems)
  const [reviewQueueFilter, setReviewQueueFilter] = useState<string | null>(null)
  const [reviewingQueueItems, setReviewingQueueItems] = useState<Record<string, AdminReviewDecision>>({})
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([])
  const [expandedAuditEventIds, setExpandedAuditEventIds] = useState<Record<string, boolean>>({})
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
  const [generationRows, setGenerationRows] = useState<ApiCreativeGenerationRecord[]>([])
  const [providerControls, setProviderControls] = useState<AdminProviderControlBundle>({ controls: [], circuits: [], capEvidence: [] })
  const [providerControlReason, setProviderControlReason] = useState('operator_requested')
  const [runningProviderControlAction, setRunningProviderControlAction] = useState<string | null>(null)
  const [generationNextCursor, setGenerationNextCursor] = useState<string | null>(null)
  const [loadingMoreGenerations, setLoadingMoreGenerations] = useState(false)
  const [selectedGenerationId, setSelectedGenerationId] = useState<string | null>(null)
  const [selectedGeneration, setSelectedGeneration] = useState<ApiCreativeGenerationRecord | null>(null)
  const [loadingGenerationDetail, setLoadingGenerationDetail] = useState(false)
  const [generationDetailError, setGenerationDetailError] = useState<string | null>(null)
  const [generationUserHandle, setGenerationUserHandle] = useState('')
  const [generationWorkspace, setGenerationWorkspace] = useState('')
  const [generationProviderId, setGenerationProviderId] = useState('')
  const [generationStatusFilter, setGenerationStatusFilter] = useState('')
  const [generationReviewFilter, setGenerationReviewFilter] = useState<'all' | 'true' | 'false'>('all')
  const [generationMediaAssetId, setGenerationMediaAssetId] = useState('')
  const [generationDateFrom, setGenerationDateFrom] = useState('')
  const [generationDateTo, setGenerationDateTo] = useState('')
  const [generationMutationReason, setGenerationMutationReason] = useState('operator_requested')
  const [generationMutationNote, setGenerationMutationNote] = useState('')
  const [generationReplayStatus, setGenerationReplayStatus] = useState<'queued' | 'running' | 'completed' | 'failed' | 'cancelled'>('failed')
  const [runningGenerationAction, setRunningGenerationAction] = useState<'cancel' | 'retry' | 'manual_replay' | null>(null)
  const [adjustDelta, setAdjustDelta] = useState('100')
  const [adjustReason, setAdjustReason] = useState('')
  const [adjustReasonCode, setAdjustReasonCode] = useState('')
  const [adjustingPoints, setAdjustingPoints] = useState(false)
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({})
  const [exportingLedger, setExportingLedger] = useState(false)
  const [exportingAudit, setExportingAudit] = useState(false)
  const [pointPolicy, setPointPolicy] = useState<PointAdjustmentPolicy | null>(null)
  const [policyRoleLimits, setPolicyRoleLimits] = useState<Record<string, string>>({})
  const [policyReasonCodes, setPolicyReasonCodes] = useState('')
  const [policyApprovalTemplates, setPolicyApprovalTemplates] = useState('')
  const [policyHistory, setPolicyHistory] = useState<PointAdjustmentPolicyHistoryItem[]>([])
  const [savingPointPolicy, setSavingPointPolicy] = useState(false)
  const [rollingBackPolicy, setRollingBackPolicy] = useState<string | null>(null)
  const [highlightedReviewId, setHighlightedReviewId] = useState<string | null>(null)
  const [highlightedPolicyEventId, setHighlightedPolicyEventId] = useState<string | null>(null)
  const [highlightedMediaAssetId, setHighlightedMediaAssetId] = useState<string | null>(null)
  const [highlightedAuditEventId, setHighlightedAuditEventId] = useState<string | null>(null)
  const [mediaRows, setMediaRows] = useState<ApiMediaAsset[]>([])
  const [mediaStatus, setMediaStatus] = useState<NonNullable<MediaReviewQueueQuery['status']>>('review')
  const [mediaPurpose, setMediaPurpose] = useState<MediaAssetPurpose | null>(null)
  const [mediaSearch, setMediaSearch] = useState('')
  const [mediaGovernanceConfig, setMediaGovernanceConfig] = useState<ApiMediaGovernanceConfig | null>(null)
  const [mediaPolicyDraft, setMediaPolicyDraft] = useState<MediaPolicyDraft>(emptyMediaPolicyDraft)
  const [mediaPolicyHistory, setMediaPolicyHistory] = useState<MediaGovernancePolicyHistoryItem[]>([])
  const [expandedMediaPolicyEventIds, setExpandedMediaPolicyEventIds] = useState<Record<string, boolean>>({})
  const [savingMediaPolicy, setSavingMediaPolicy] = useState(false)
  const [confirmingMediaPolicySave, setConfirmingMediaPolicySave] = useState(false)
  const [rollingBackMediaPolicy, setRollingBackMediaPolicy] = useState<string | null>(null)
  const [reviewingMediaId, setReviewingMediaId] = useState<string | null>(null)
  const [sweepingMediaJobs, setSweepingMediaJobs] = useState(false)
  const [selectedMediaAssetId, setSelectedMediaAssetId] = useState<string | null>(null)
  const [mediaScanHistory, setMediaScanHistory] = useState<ApiMediaScanJob[]>([])
  const [mediaScanHistoryNextCursor, setMediaScanHistoryNextCursor] = useState<string | null>(null)
  const [loadingMoreMediaScanHistory, setLoadingMoreMediaScanHistory] = useState(false)
  const [mediaScanAlerts, setMediaScanAlerts] = useState<ApiMediaScanAlert[]>([])
  const [handlingScanAlertId, setHandlingScanAlertId] = useState<string | null>(null)
  const [selectedScanAlertId, setSelectedScanAlertId] = useState<string | null>(null)
  const [scanAlertEvents, setScanAlertEvents] = useState<ApiMediaScanAlertEvent[]>([])
  const [loadingScanAlertEvents, setLoadingScanAlertEvents] = useState(false)
  const [scanAlertEventsError, setScanAlertEventsError] = useState<string | null>(null)
  const [callbackFailureEvents, setCallbackFailureEvents] = useState<AuditEvent[]>([])
  const [auditActionFilter, setAuditActionFilter] = useState('')
  const [auditResourceTypeFilter, setAuditResourceTypeFilter] = useState('')
  const [securityAlerts, setSecurityAlerts] = useState<AdminSecurityAlertDto[]>([])
  const [handlingSecurityAlertId, setHandlingSecurityAlertId] = useState<string | null>(null)
  const [selectedSecurityAlertId, setSelectedSecurityAlertId] = useState<string | null>(null)
  const [highlightedSecurityAlertId, setHighlightedSecurityAlertId] = useState<string | null>(null)
  const [exportingSecurityAlertId, setExportingSecurityAlertId] = useState<string | null>(null)
  const [securityAlertEvents, setSecurityAlertEvents] = useState<AdminSecurityAlertEventDto[]>([])
  const [loadingSecurityAlertEvents, setLoadingSecurityAlertEvents] = useState(false)
  const [securityAlertEventsError, setSecurityAlertEventsError] = useState<string | null>(null)
  const [securityEvents, setSecurityEvents] = useState<AdminSecurityEventDto[]>([])
  const [securitySourceFilter, setSecuritySourceFilter] = useState<AdminSecurityEventListQuery['source']>(null)
  const [securitySeverityFilter, setSecuritySeverityFilter] = useState('')
  const [securityTypeFilter, setSecurityTypeFilter] = useState('')
  const [securityNextCursor, setSecurityNextCursor] = useState<string | null>(null)
  const [loadingMoreSecurityEvents, setLoadingMoreSecurityEvents] = useState(false)
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
  const canReadAudit = account.hasPermission('admin:audit:read')
  const canCancelGenerations = account.hasPermission('admin:creative:cancel')
  const canRequestGenerationRetries = account.hasPermission('admin:creative:retry')
  const canRequestManualReplay = account.hasPermission('admin:creative:replay')
  const canReadProviderControls = account.hasPermission('admin:creative:provider-control:read')
  const canManageProviderControls = account.hasPermission('admin:creative:provider-control:manage')
  const canRecoverProviderControls = account.hasPermission('admin:creative:provider-control:recover')
  const canManageSecurityAlerts = account.hasPermission('security:alerts:manage')
  const securityQuery: AdminSecurityEventListQuery = {
    source: securitySourceFilter,
    severity: securitySeverityFilter || null,
    type: securityTypeFilter || null,
    limit: 12,
  }
  const ledgerQuery: PointsLedgerQuery = {
    userHandle: ledgerUserHandle,
    status: ledgerStatus,
    search: ledgerSearch,
    limit: 12,
  }
  const generationQuery: AdminCreativeGenerationHistoryQuery = {
    userHandle: generationUserHandle || null,
    workspace: generationWorkspace || null,
    providerId: generationProviderId || null,
    status: generationStatusFilter || null,
    reviewRequired: generationReviewFilter === 'all' ? null : generationReviewFilter === 'true',
    mediaAssetId: generationMediaAssetId || null,
    dateFrom: generationDateFrom || null,
    dateTo: generationDateTo || null,
    limit: 12,
  }
  const visibleQueueItems = reviewQueueFilter
    ? queueItems.filter((item) => item.queue === reviewQueueFilter)
    : queueItems
  const pointReviewCount = queueItems.filter((item) => item.queue === 'points' && !item.decision).length
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
  const queueStatus = useAsyncResource<AdminReviewQueueItemDto[]>({
    load: () => adminService.reviews(),
    onSuccess: (items) => {
      if (items.length > 0) setQueueItems(items)
    },
    getErrorMessage: () => (isZh ? '运营队列 API 暂不可用；未显示本地替代数据。' : 'The operations queue API is unavailable; no local substitute is shown.'),
    deps: [isZh],
    logLabel: 'admin-service',
  })
  const auditStatus = useAsyncResource<AuditEvent[]>({
    load: () => adminService.audit({
      action: auditActionFilter || null,
      resourceType: auditResourceTypeFilter || null,
      limit: 20,
    }),
    onSuccess: (events) => {
      setAuditEvents(events)
    },
    getErrorMessage: () => (isZh ? '无法读取审计日志，请确认已使用管理员账号登录。' : 'Could not load audit log. Sign in as an admin account.'),
    deps: [auditActionFilter, auditResourceTypeFilter, isZh],
    logLabel: 'admin-service',
  })
  const securityAlertStatus = useAsyncResource<AdminSecurityAlertDto[]>({
    load: () => canReadAudit ? adminService.securityAlerts() : Promise.resolve([]),
    onSuccess: (alerts) => {
      setSecurityAlerts(alerts)
    },
    getErrorMessage: () => (isZh ? '无法读取安全告警，请确认账号具备审计读取权限。' : 'Could not load security alerts. Confirm audit read access.'),
    deps: [canReadAudit, isZh],
    logLabel: 'admin-service',
  })
  const securityStatus = useAsyncResource<{ events: AdminSecurityEventDto[]; nextCursor: string | null }>({
    load: () => canReadAudit
      ? adminService.securityEvents(securityQuery)
      : Promise.resolve({ events: [], nextCursor: null }),
    onSuccess: ({ events, nextCursor }) => {
      setSecurityEvents(events)
      setSecurityNextCursor(nextCursor)
    },
    getErrorMessage: () => (isZh ? '无法读取安全事件，请确认账号具备审计读取权限。' : 'Could not load security events. Confirm audit read access.'),
    deps: [canReadAudit, isZh, securitySourceFilter, securitySeverityFilter, securityTypeFilter],
    logLabel: 'admin-service',
  })
  const operationsMetricsStatus = useAsyncResource<AdminOperationsMetricsDto | null>({
    load: () => canReadAudit ? adminService.operationsMetrics(operationsMetricsWindow) : Promise.resolve(null),
    onSuccess: (metrics) => setOperationsMetrics(metrics),
    getErrorMessage: () => (isZh ? '无法读取运营指标，请确认账号具备审计读取权限。' : 'Could not load operations metrics. Confirm audit read access.'),
    deps: [canReadAudit, isZh, operationsMetricsWindow],
    logLabel: 'admin-service',
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
  const generationHistoryStatus = useAsyncResource<{ items: ApiCreativeGenerationRecord[]; nextCursor: string | null }>({
    load: () => canReadAudit
      ? adminService.creativeGenerations(generationQuery)
      : Promise.resolve({ items: [], nextCursor: null }),
    onSuccess: ({ items, nextCursor }) => {
      setGenerationRows(items)
      setGenerationNextCursor(nextCursor)
      if (selectedGenerationId && !items.some((item) => item.id === selectedGenerationId)) {
        setSelectedGenerationId(null)
        setSelectedGeneration(null)
        setGenerationDetailError(null)
      }
    },
    getErrorMessage: () => (isZh ? '无法读取生成历史，请确认账号具备审计读取权限。' : 'Could not load generation history. Confirm audit read access.'),
    deps: [canReadAudit, isZh, generationUserHandle, generationWorkspace, generationProviderId, generationStatusFilter, generationReviewFilter, generationMediaAssetId, generationDateFrom, generationDateTo],
    logLabel: 'admin-service',
  })
  const providerControlStatus = useAsyncResource<AdminProviderControlBundle>({
    load: () => canReadProviderControls
      ? adminService.providerControls()
      : Promise.resolve({ controls: [], circuits: [], capEvidence: [] }),
    onSuccess: setProviderControls,
    getErrorMessage: () => (isZh ? '无法读取 Provider 控制状态。' : 'Could not load Provider controls.'),
    deps: [canReadProviderControls, isZh],
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
  const mediaReviewStatus = useAsyncResource<ApiMediaAsset[]>({
    load: () => canReadQueues
      ? mediaService.reviewQueue({
          status: mediaStatus,
          purpose: mediaPurpose,
          search: mediaSearch,
          limit: 12,
        })
      : Promise.resolve([]),
    onSuccess: (items) => setMediaRows(items),
    getErrorMessage: () => (isZh ? '无法读取媒体审核队列。' : 'Could not load media review queue.'),
    deps: [canReadQueues, isZh, mediaStatus, mediaPurpose, mediaSearch],
    logLabel: 'media-service',
  })
  const mediaGovernanceConfigStatus = useAsyncResource<ApiMediaGovernanceConfig | null>({
    load: () => canReadQueues ? mediaService.governanceConfig() : Promise.resolve(null),
    onSuccess: (config) => {
      setMediaGovernanceConfig(config)
      if (config) {
        setMediaPolicyDraft(mediaPolicyDraftFromConfig(config))
      }
    },
    getErrorMessage: () => (isZh ? '无法读取媒体治理配置。' : 'Could not load media governance config.'),
    deps: [canReadQueues, isZh],
    logLabel: 'media-service',
  })
  const mediaPolicyHistoryStatus = useAsyncResource<MediaGovernancePolicyHistoryItem[]>({
    load: () => canReadQueues ? mediaService.governancePolicyHistory() : Promise.resolve([]),
    onSuccess: (items) => setMediaPolicyHistory(items),
    getErrorMessage: () => (isZh ? '无法读取媒体治理策略历史。' : 'Could not load media governance policy history.'),
    deps: [canReadQueues, isZh],
    logLabel: 'media-service',
  })
  const mediaScanHistoryStatus = useAsyncResource<MediaScanJobHistoryPage>({
    load: () => canReadQueues && selectedMediaAssetId
      ? mediaService.scanJobHistoryPage(selectedMediaAssetId, { limit: mediaScanHistoryPageSize })
      : Promise.resolve({ items: [], limit: mediaScanHistoryPageSize, nextCursor: null }),
    onSuccess: (page) => {
      setMediaScanHistory(page.items)
      setMediaScanHistoryNextCursor(page.nextCursor)
    },
    getErrorMessage: () => (isZh ? '无法读取扫描任务历史。' : 'Could not load scan job history.'),
    deps: [canReadQueues, isZh, selectedMediaAssetId],
    logLabel: 'media-service',
  })
  const mediaScanAlertStatus = useAsyncResource<ApiMediaScanAlert[]>({
    load: () => canReadQueues ? mediaService.scanAlerts() : Promise.resolve([]),
    onSuccess: (items) => setMediaScanAlerts(items),
    getErrorMessage: () => (isZh ? '无法读取扫描告警。' : 'Could not load scan alerts.'),
    deps: [canReadQueues, isZh],
    logLabel: 'media-service',
  })
  const callbackFailureStatus = useAsyncResource<AuditEvent[]>({
    load: () => canReadQueues && canReadAudit
      ? adminService.audit({
          action: 'media.scan.callback_denied',
          resourceType: 'media_asset',
          limit: 5,
        })
      : Promise.resolve([]),
    onSuccess: (events) => setCallbackFailureEvents(events),
    getErrorMessage: () => (isZh ? '无法读取扫描回调失败事件。' : 'Could not load scanner callback failures.'),
    deps: [canReadAudit, canReadQueues, isZh],
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

  useEffect(() => {
    if (queueStatus.error || queueItems.length === 0) {
      const timer = window.setTimeout(() => setQueueItems(fallbackQueueItems), 0)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [fallbackQueueItems, queueItems.length, queueStatus.error])

  useEffect(() => {
    if (!deepLink) return
    const timer = window.setTimeout(() => {
      if (deepLink.tab) {
        setActiveTab(deepLink.tab)
      }
      if (deepLink.queue !== undefined) {
        setReviewQueueFilter(deepLink.queue)
      }
      if (deepLink.reviewId) {
        setActiveTab('Task review')
        setReviewQueueFilter(deepLink.queue ?? 'points')
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
        setSelectedSecurityAlertId(deepLink.securityAlertId)
        setSecurityAlertEvents([])
        setSecurityAlertEventsError(null)
        setLoadingSecurityAlertEvents(true)
        void adminService.securityAlertEvents(deepLink.securityAlertId).then((events) => {
          setSecurityAlertEvents(events)
        }).catch((error) => {
          console.info('[admin-service]', error)
          setSecurityAlertEventsError(isZh ? '无法读取安全告警样本。' : 'Could not load security alert events.')
        }).finally(() => {
          setLoadingSecurityAlertEvents(false)
        })
      }
      if (deepLink.mediaAssetId) {
        setMediaSearch(deepLink.mediaAssetId)
        setHighlightedMediaAssetId(deepLink.mediaAssetId)
        setMediaScanHistory([])
        setMediaScanHistoryNextCursor(null)
        setLoadingMoreMediaScanHistory(false)
        setSelectedMediaAssetId(deepLink.mediaAssetId)
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
  }, [deepLink, isZh, onDeepLinkHandled, simulateAction])

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

  const enabledLabel = (value: boolean) => value
    ? textFor(t, 'configured', '已配置')
    : textFor(t, 'not configured', '未配置')

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
    setActiveTab('Task review')
    setMediaStatus('all')
    setMediaPurpose(null)
    setMediaSearch('')
    simulateAction(isZh ? '已定位到媒体治理和扫描归档区域。' : 'Focused media governance and scan archive controls.')
  }

  const writeScanArchiveFromMetrics = async () => {
    setWritingScanArchive(true)
    try {
      const result = await mediaService.writeScanJobArchive({ limit: 100 })
      void operationsMetricsStatus.refresh()
      void auditStatus.refresh()
      simulateAction(
        isZh
          ? `扫描历史归档已写入：${result.storage?.storageKey ?? result.count}，候选 ${result.totalCandidates ?? result.count}`
          : `Scan history archive written: ${result.storage?.storageKey ?? result.count}, candidates ${result.totalCandidates ?? result.count}`,
      )
    } catch (error) {
      console.info('[media-service]', error)
      simulateAction(isZh ? '扫描历史归档写入失败。' : 'Could not write scan history archive.')
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
      simulateAction(
        isZh
          ? `已读取${config.title}。`
          : `Loaded ${config.title}.`,
      )
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
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `operations-metrics-${operationsMetrics.window.minutes}m-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
      link.click()
      URL.revokeObjectURL(url)
      void auditStatus.refresh()
      simulateAction(isZh ? '已导出运营指标快照。' : 'Exported operations metrics snapshot.')
    } catch (error) {
      console.info('[admin-service]', error)
      simulateAction(isZh ? '导出运营指标快照失败。' : 'Could not export operations metrics snapshot.')
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
    simulateAction(
      isZh
        ? `已切换到 ${nextWindow} 分钟运营指标窗口。`
        : `Opened the ${nextWindow} minute operations metrics window.`,
    )
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
    setHighlightedAuditEventId(null)
    simulateAction(isZh ? '已清除审计筛选。' : 'Cleared audit filters.')
  }

  const clearSecurityFilters = () => {
    setSecuritySourceFilter(null)
    setSecuritySeverityFilter('')
    setSecurityTypeFilter('')
    setSecurityNextCursor(null)
    simulateAction(isZh ? '已清除安全事件筛选。' : 'Cleared security event filters.')
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
    setGenerationNextCursor(null)
    setSelectedGenerationId(null)
    setSelectedGeneration(null)
    setGenerationDetailError(null)
    simulateAction(isZh ? '已清除生成历史筛选。' : 'Cleared generation history filters.')
  }

  const loadMoreGenerations = async () => {
    if (!generationNextCursor || loadingMoreGenerations || !canReadAudit) return
    setLoadingMoreGenerations(true)
    try {
      const page = await adminService.creativeGenerations({
        ...generationQuery,
        cursor: generationNextCursor,
      })
      setGenerationRows((current) => [...current, ...page.items.filter((item) => !current.some((row) => row.id === item.id))])
      setGenerationNextCursor(page.nextCursor)
      simulateAction(isZh ? '已加载更多生成历史。' : 'Loaded more generation history.')
    } catch (error) {
      console.info('[admin-service]', error)
      simulateAction(isZh ? '加载更多生成历史失败。' : 'Could not load more generation history.')
    } finally {
      setLoadingMoreGenerations(false)
    }
  }

  const toggleGenerationDetail = async (generation: ApiCreativeGenerationRecord) => {
    if (selectedGenerationId === generation.id) {
      setSelectedGenerationId(null)
      setSelectedGeneration(null)
      setGenerationDetailError(null)
      return
    }
    setSelectedGenerationId(generation.id)
    setSelectedGeneration(generation)
    setGenerationDetailError(null)
    setLoadingGenerationDetail(true)
    try {
      const detail = await adminService.creativeGeneration(generation.id)
      setSelectedGeneration(detail)
      simulateAction(isZh ? '已读取生成历史详情。' : 'Loaded generation history detail.')
    } catch (error) {
      console.info('[admin-service]', error)
      setGenerationDetailError(isZh ? '无法读取生成历史详情。' : 'Could not load generation detail.')
    } finally {
      setLoadingGenerationDetail(false)
    }
  }

  const runGenerationMutation = async (action: 'cancel' | 'retry' | 'manual_replay') => {
    if (!selectedGeneration || runningGenerationAction) return
    setRunningGenerationAction(action)
    setGenerationDetailError(null)
    const request = {
      idempotencyKey: `${action}:${selectedGeneration.id}:${Date.now()}`,
      reasonCode: generationMutationReason || 'operator_requested',
      note: generationMutationNote,
    }
    try {
      if (action === 'cancel') {
        await adminService.cancelCreativeGeneration(selectedGeneration.id, request)
      } else if (action === 'retry') {
        await adminService.requestCreativeGenerationRetry(selectedGeneration.id, request)
      } else {
        if (!selectedGeneration.providerId || !selectedGeneration.providerMode || !selectedGeneration.providerJobId) {
          throw new Error('Provider replay identifiers are incomplete')
        }
        await adminService.requestCreativeGenerationManualReplay(selectedGeneration.id, {
          ...request,
          providerId: selectedGeneration.providerId,
          providerMode: selectedGeneration.providerMode,
          providerJobId: selectedGeneration.providerJobId,
          normalizedStatus: generationReplayStatus,
        })
        await queueStatus.refresh()
      }
      const detail = await adminService.creativeGeneration(selectedGeneration.id)
      setSelectedGeneration(detail)
      setGenerationRows((rows) => rows.map((row) => row.id === detail.id ? detail : row))
      simulateAction(action === 'cancel'
        ? textFor(t, 'Generation cancelled.', '生成任务已取消。')
        : action === 'retry'
          ? textFor(t, 'Retry authorization created.', '已创建重试授权。')
          : textFor(t, 'Manual replay sent to review.', '人工重放已提交复核。'))
    } catch (error) {
      console.info('[admin-service]', error)
      setGenerationDetailError(error instanceof Error
        ? error.message
        : textFor(t, 'Generation action failed.', '生成任务操作失败。'))
    } finally {
      setRunningGenerationAction(null)
    }
  }

  const runProviderControlAction = async (
    resourceId: string,
    version: number,
    action: 'disable' | AdminProviderControlRecoveryTarget,
  ) => {
    const actionKey = `${resourceId}:${action}`
    if (runningProviderControlAction) return
    setRunningProviderControlAction(actionKey)
    try {
      if (action === 'disable') {
        await adminService.disableProviderControl(resourceId, version, providerControlReason || 'operator_emergency_stop')
        simulateAction(textFor(t, 'Provider dispatch disabled.', 'Provider 调用已停用。'))
      } else {
        await adminService.requestProviderControlRecovery(resourceId, action, version, providerControlReason || 'operator_recovery_requested')
        await queueStatus.refresh()
        simulateAction(textFor(t, 'Provider recovery sent to review.', 'Provider 恢复已提交复核。'))
      }
      await providerControlStatus.refresh()
    } catch (error) {
      console.info('[admin-service]', error)
      simulateAction(error instanceof Error ? error.message : textFor(t, 'Provider control action failed.', 'Provider 控制操作失败。'))
    } finally {
      setRunningProviderControlAction(null)
    }
  }

  const focusGenerationMediaAsset = (assetId: string) => {
    setActiveTab('Task review')
    setMediaStatus('all')
    setMediaPurpose(null)
    setMediaSearch(assetId)
    setHighlightedMediaAssetId(assetId)
    setMediaScanHistory([])
    setMediaScanHistoryNextCursor(null)
    setLoadingMoreMediaScanHistory(false)
    setSelectedMediaAssetId(assetId)
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

  const refreshSecurityPanel = async () => {
    await Promise.all([securityAlertStatus.refresh(), securityStatus.refresh(), operationsMetricsStatus.refresh()])
  }

  const updateSecurityAlert = (updated: AdminSecurityAlertDto) => {
    setSecurityAlerts((current) => current.map((item) => (item.id === updated.id ? updated : item)))
    void auditStatus.refresh()
    void operationsMetricsStatus.refresh()
  }

  const acknowledgeSecurityAlert = async (alert: AdminSecurityAlertDto) => {
    setHandlingSecurityAlertId(alert.id)
    try {
      const updated = await adminService.acknowledgeSecurityAlert(
        alert.id,
        isZh ? '已在管理中心确认安全告警。' : 'Acknowledged from Admin Center.',
      )
      updateSecurityAlert(updated)
      simulateAction(isZh ? `已确认安全告警：${alert.title}` : `Security alert acknowledged: ${alert.title}`)
    } catch (error) {
      console.info('[admin-service]', error)
      simulateAction(isZh ? '安全告警确认失败。' : 'Could not acknowledge security alert.')
    } finally {
      setHandlingSecurityAlertId(null)
    }
  }

  const silenceSecurityAlert = async (alert: AdminSecurityAlertDto) => {
    setHandlingSecurityAlertId(alert.id)
    try {
      const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      const updated = await adminService.silenceSecurityAlert(
        alert.id,
        until,
        isZh ? '管理中心静默 24 小时。' : 'Silenced from Admin Center for 24 hours.',
      )
      updateSecurityAlert(updated)
      simulateAction(isZh ? `已静默安全告警：${alert.title}` : `Security alert silenced: ${alert.title}`)
    } catch (error) {
      console.info('[admin-service]', error)
      simulateAction(isZh ? '安全告警静默失败。' : 'Could not silence security alert.')
    } finally {
      setHandlingSecurityAlertId(null)
    }
  }

  const unsilenceSecurityAlert = async (alert: AdminSecurityAlertDto) => {
    setHandlingSecurityAlertId(alert.id)
    try {
      const updated = await adminService.unsilenceSecurityAlert(
        alert.id,
        isZh ? '管理中心解除静默。' : 'Unsilenced from Admin Center.',
      )
      updateSecurityAlert(updated)
      simulateAction(isZh ? `已解除安全告警静默：${alert.title}` : `Security alert unsilenced: ${alert.title}`)
    } catch (error) {
      console.info('[admin-service]', error)
      simulateAction(isZh ? '解除安全告警静默失败。' : 'Could not unsilence security alert.')
    } finally {
      setHandlingSecurityAlertId(null)
    }
  }

  const toggleSecurityAlertEvents = async (alert: AdminSecurityAlertDto) => {
    if (selectedSecurityAlertId === alert.id) {
      setSelectedSecurityAlertId(null)
      setSecurityAlertEvents([])
      setSecurityAlertEventsError(null)
      return
    }
    setSelectedSecurityAlertId(alert.id)
    setSecurityAlertEvents([])
    setSecurityAlertEventsError(null)
    setLoadingSecurityAlertEvents(true)
    try {
      const events = await adminService.securityAlertEvents(alert.id)
      setSecurityAlertEvents(events)
    } catch (error) {
      console.info('[admin-service]', error)
      setSecurityAlertEventsError(isZh ? '无法读取安全告警样本。' : 'Could not load security alert events.')
    } finally {
      setLoadingSecurityAlertEvents(false)
    }
  }

  const exportSecurityAlert = async (alert: AdminSecurityAlertDto) => {
    setExportingSecurityAlertId(alert.id)
    try {
      const json = await adminService.exportSecurityAlertJson(alert.id)
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `security-alert-${alert.id}.json`
      link.click()
      URL.revokeObjectURL(url)
      simulateAction(isZh ? `已导出安全告警：${alert.title}` : `Exported security alert: ${alert.title}`)
    } catch (error) {
      console.info('[admin-service]', error)
      simulateAction(isZh ? '导出安全告警失败。' : 'Could not export security alert.')
    } finally {
      setExportingSecurityAlertId(null)
    }
  }

  const loadMoreSecurityEvents = async () => {
    if (!securityNextCursor || loadingMoreSecurityEvents || !canReadAudit) return
    setLoadingMoreSecurityEvents(true)
    try {
      const page = await adminService.securityEvents({
        ...securityQuery,
        cursor: securityNextCursor,
      })
      setSecurityEvents((current) => [...current, ...page.events.filter((event) => !current.some((item) => item.id === event.id))])
      setSecurityNextCursor(page.nextCursor)
      simulateAction(isZh ? '已加载更多安全事件。' : 'Loaded more security events.')
    } catch (error) {
      console.info('[admin-service]', error)
      simulateAction(isZh ? '加载更多安全事件失败。' : 'Could not load more security events.')
    } finally {
      setLoadingMoreSecurityEvents(false)
    }
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
    const blob = new Blob([formatMetadataJson(payload)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `audit-event-${event.id}.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    simulateAction(isZh ? '已导出审计事件 JSON。' : 'Exported the audit event JSON.')
  }

  const setMediaPolicyDraftValue = (key: MediaPolicyDraftKey, value: string) => {
    setConfirmingMediaPolicySave(false)
    setMediaPolicyDraft((current) => ({ ...current, [key]: value }))
  }

  const commitMediaGovernancePolicy = async () => {
    const patch = mediaPolicyPatchFromDraft(mediaPolicyDraft)
    if (!patch) {
      simulateAction(isZh ? '请填写有效的正整数策略值。' : 'Enter positive integer policy values.')
      return
    }
    setSavingMediaPolicy(true)
    setConfirmingMediaPolicySave(false)
    try {
      const updated = await mediaService.updateGovernancePolicy(patch)
      setMediaGovernanceConfig(updated)
      setMediaPolicyDraft(mediaPolicyDraftFromConfig(updated))
      void mediaPolicyHistoryStatus.refresh()
      void mediaScanAlertStatus.refresh()
      void auditStatus.refresh()
      simulateAction(isZh ? '已更新媒体治理策略。' : 'Updated media governance policy.')
    } catch (error) {
      console.info('[media-service]', error)
      simulateAction(isZh ? '媒体治理策略保存失败。' : 'Could not save media governance policy.')
    } finally {
      setSavingMediaPolicy(false)
    }
  }

  const saveMediaGovernancePolicy = async () => {
    if (hasInvalidMediaPolicyDraft) {
      simulateAction(isZh ? '请先修正无效的策略值。' : 'Fix invalid policy values before saving.')
      return
    }
    if (highRiskMediaPolicyChanges.length > 0) {
      setConfirmingMediaPolicySave(true)
      simulateAction(isZh ? '请确认高风险媒体治理策略变更。' : 'Confirm high-risk media governance policy changes.')
      return
    }
    await commitMediaGovernancePolicy()
  }

  const rollbackMediaGovernancePolicy = async (eventId: string) => {
    setRollingBackMediaPolicy(eventId)
    try {
      const updated = await mediaService.rollbackGovernancePolicy(eventId)
      setMediaGovernanceConfig(updated)
      setMediaPolicyDraft(mediaPolicyDraftFromConfig(updated))
      void mediaPolicyHistoryStatus.refresh()
      void mediaScanAlertStatus.refresh()
      void auditStatus.refresh()
      simulateAction(isZh ? '已回滚媒体治理策略。' : 'Rolled back media governance policy.')
    } catch (error) {
      console.info('[media-service]', error)
      simulateAction(isZh ? '媒体治理策略回滚失败。' : 'Could not roll back media governance policy.')
    } finally {
      setRollingBackMediaPolicy(null)
    }
  }

  const reviewQueueItem = async (item: AdminReviewQueueItemDto, decision: AdminReviewDecision) => {
    setReviewingQueueItems((current) => ({ ...current, [item.id]: decision }))
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
      simulateAction(
        isZh
          ? `已${decision === 'approve' ? '通过' : '驳回'}队列事项：${item.title}`
          : `Queue item ${decision === 'approve' ? 'approved' : 'rejected'}: ${item.title}`,
      )
    } catch (error) {
      console.info('[admin-service]', error)
      simulateAction(isZh ? `队列事项处理失败：${item.title}` : `Queue action failed: ${item.title}`)
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
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `points-ledger-${ledgerUserHandle || 'all'}.csv`
      link.click()
      URL.revokeObjectURL(url)
      simulateAction(isZh ? '已导出积分账本 CSV。' : 'Exported points ledger CSV.')
    } catch (error) {
      console.info('[admin-service]', error)
      simulateAction(isZh ? '导出积分账本失败。' : 'Could not export points ledger.')
    } finally {
      setExportingLedger(false)
    }
  }

  const exportAuditEvents = async () => {
    setExportingAudit(true)
    try {
      const json = await adminService.exportAuditJson({
        action: auditActionFilter || null,
        resourceType: auditResourceTypeFilter || null,
        limit: 100,
      })
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      const filterName = [auditActionFilter, auditResourceTypeFilter].filter(Boolean).join('-') || 'all'
      link.href = url
      link.download = `audit-events-${filterName}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      simulateAction(isZh ? '已导出审计事件 JSON。' : 'Exported audit events JSON.')
    } catch (error) {
      console.info('[admin-service]', error)
      simulateAction(isZh ? '导出审计事件失败。' : 'Could not export audit events.')
    } finally {
      setExportingAudit(false)
    }
  }

  const savePointPolicy = async () => {
    const roleLimits = Object.fromEntries(pointPolicyRoles.map((role) => [role, Number.parseInt(policyRoleLimits[role] ?? '0', 10)])) as PointAdjustmentPolicy['roleLimits']
    if (pointPolicyRoles.some((role) => !Number.isInteger(roleLimits[role]) || roleLimits[role] < 0)) {
      simulateAction(isZh ? '请填写有效的角色额度。' : 'Enter valid role limits.')
      return
    }
    const reasonCodes = policyReasonCodes.split(',').map((item) => item.trim()).filter(Boolean)
    const approvalTemplates = policyApprovalTemplates.split('\n').map((item) => item.trim()).filter(Boolean)
    if (reasonCodes.length === 0 || approvalTemplates.length === 0) {
      simulateAction(isZh ? '请至少保留一个原因分类和审批模板。' : 'Keep at least one reason code and approval template.')
      return
    }
    setSavingPointPolicy(true)
    try {
      const updated = await adminService.updatePointPolicy({ roleLimits, reasonCodes, approvalTemplates })
      setPointPolicy(updated)
      setPolicyRoleLimits(Object.fromEntries(pointPolicyRoles.map((role) => [role, String(updated.roleLimits[role] ?? 0)])))
      setPolicyReasonCodes(updated.reasonCodes.join(', '))
      setPolicyApprovalTemplates(updated.approvalTemplates.join('\n'))
      void auditStatus.refresh()
      void pointPolicyHistoryStatus.refresh()
      simulateAction(isZh ? '已更新积分调整策略。' : 'Updated point adjustment policy.')
    } catch (error) {
      console.info('[admin-service]', error)
      simulateAction(isZh ? '积分策略保存失败。' : 'Could not save point policy.')
    } finally {
      setSavingPointPolicy(false)
    }
  }

  const applyApprovalTemplate = (itemId: string, template: string) => {
    setReviewNotes((current) => ({ ...current, [itemId]: template }))
  }

  const rollbackPointPolicy = async (eventId: string) => {
    setRollingBackPolicy(eventId)
    try {
      const updated = await adminService.rollbackPointPolicy(eventId)
      setPointPolicy(updated)
      setPolicyRoleLimits(Object.fromEntries(pointPolicyRoles.map((role) => [role, String(updated.roleLimits[role] ?? 0)])))
      setPolicyReasonCodes(updated.reasonCodes.join(', '))
      setPolicyApprovalTemplates(updated.approvalTemplates.join('\n'))
      void pointPolicyHistoryStatus.refresh()
      void auditStatus.refresh()
      void notificationStatus.refresh()
      simulateAction(isZh ? '已回滚积分调整策略。' : 'Rolled back point adjustment policy.')
    } catch (error) {
      console.info('[admin-service]', error)
      simulateAction(isZh ? '积分策略回滚失败。' : 'Could not roll back point policy.')
    } finally {
      setRollingBackPolicy(null)
    }
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

  const reviewMediaAsset = async (asset: ApiMediaAsset, decision: 'clean' | 'reject') => {
    setReviewingMediaId(asset.id)
    try {
      const reviewed = await mediaService.reviewUpload(asset.id, {
        decision,
        note: decision === 'clean'
          ? 'Manual review approved in Admin Center.'
          : 'Manual review rejected in Admin Center.',
      })
      setMediaRows((current) => current.map((item) => (item.id === reviewed.id ? reviewed : item)))
      void mediaReviewStatus.refresh()
      if (selectedMediaAssetId === asset.id) {
        void mediaScanHistoryStatus.refresh()
      }
      simulateAction(
        isZh
          ? `媒体资产已${decision === 'clean' ? '放行' : '拒绝'}：${asset.fileName}`
          : `Media asset ${decision === 'clean' ? 'released' : 'rejected'}: ${asset.fileName}`,
      )
    } catch (error) {
      console.info('[media-service]', error)
      simulateAction(isZh ? '媒体审核操作失败。' : 'Media review action failed.')
    } finally {
      setReviewingMediaId(null)
    }
  }

  const retryMediaAsset = async (asset: ApiMediaAsset) => {
    setReviewingMediaId(asset.id)
    try {
      const retried = await mediaService.retryScan(asset.id)
      setMediaRows((current) => current.map((item) => (item.id === retried.id ? retried : item)))
      void mediaReviewStatus.refresh()
      if (selectedMediaAssetId === asset.id) {
        void mediaScanHistoryStatus.refresh()
      }
      simulateAction(isZh ? `媒体扫描已重新排队：${asset.fileName}` : `Media scan requeued: ${asset.fileName}`)
    } catch (error) {
      console.info('[media-service]', error)
      simulateAction(isZh ? '媒体扫描重试失败。' : 'Media scan retry failed.')
    } finally {
      setReviewingMediaId(null)
    }
  }

  const loadMoreMediaScanHistory = async () => {
    if (!selectedMediaAssetId || !mediaScanHistoryNextCursor || loadingMoreMediaScanHistory) return
    setLoadingMoreMediaScanHistory(true)
    try {
      const page = await mediaService.scanJobHistoryPage(selectedMediaAssetId, {
        cursor: mediaScanHistoryNextCursor,
        limit: mediaScanHistoryPageSize,
      })
      setMediaScanHistory((current) => {
        const seen = new Set(current.map((item) => item.id))
        return [...current, ...page.items.filter((item) => !seen.has(item.id))]
      })
      setMediaScanHistoryNextCursor(page.nextCursor)
    } catch (error) {
      console.info('[media-service]', error)
      simulateAction(isZh ? '加载更多扫描历史失败。' : 'Could not load more scan history.')
    } finally {
      setLoadingMoreMediaScanHistory(false)
    }
  }

  const updateScanAlert = (updated: ApiMediaScanAlert) => {
    setMediaScanAlerts((current) => current.map((item) => (item.id === updated.id ? updated : item)))
    void auditStatus.refresh()
    void operationsMetricsStatus.refresh()
  }

  const acknowledgeScanAlert = async (alert: ApiMediaScanAlert) => {
    setHandlingScanAlertId(alert.id)
    try {
      const updated = await mediaService.acknowledgeScanAlert(
        alert.id,
        isZh ? '已在管理中心确认告警。' : 'Acknowledged from Admin Center.',
      )
      updateScanAlert(updated)
      simulateAction(isZh ? `已确认扫描告警：${alert.title}` : `Scanner alert acknowledged: ${alert.title}`)
    } catch (error) {
      console.info('[media-service]', error)
      simulateAction(isZh ? '扫描告警确认失败。' : 'Could not acknowledge scanner alert.')
    } finally {
      setHandlingScanAlertId(null)
    }
  }

  const silenceScanAlert = async (alert: ApiMediaScanAlert) => {
    setHandlingScanAlertId(alert.id)
    try {
      const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      const updated = await mediaService.silenceScanAlert(
        alert.id,
        until,
        isZh ? '管理中心静默 24 小时。' : 'Silenced from Admin Center for 24 hours.',
      )
      updateScanAlert(updated)
      simulateAction(isZh ? `已静默扫描告警：${alert.title}` : `Scanner alert silenced: ${alert.title}`)
    } catch (error) {
      console.info('[media-service]', error)
      simulateAction(isZh ? '扫描告警静默失败。' : 'Could not silence scanner alert.')
    } finally {
      setHandlingScanAlertId(null)
    }
  }

  const unsilenceScanAlert = async (alert: ApiMediaScanAlert) => {
    setHandlingScanAlertId(alert.id)
    try {
      const updated = await mediaService.unsilenceScanAlert(
        alert.id,
        isZh ? '管理中心解除静默。' : 'Unsilenced from Admin Center.',
      )
      updateScanAlert(updated)
      simulateAction(isZh ? `已解除扫描告警静默：${alert.title}` : `Scanner alert unsilenced: ${alert.title}`)
    } catch (error) {
      console.info('[media-service]', error)
      simulateAction(isZh ? '解除扫描告警静默失败。' : 'Could not unsilence scanner alert.')
    } finally {
      setHandlingScanAlertId(null)
    }
  }

  const toggleScanAlertEvents = async (alert: ApiMediaScanAlert) => {
    if (selectedScanAlertId === alert.id) {
      setSelectedScanAlertId(null)
      setScanAlertEvents([])
      setScanAlertEventsError(null)
      return
    }
    setSelectedScanAlertId(alert.id)
    setScanAlertEvents([])
    setScanAlertEventsError(null)
    setLoadingScanAlertEvents(true)
    try {
      const events = await mediaService.scanAlertEvents(alert.id)
      setScanAlertEvents(events)
    } catch (error) {
      console.info('[media-service]', error)
      setScanAlertEventsError(isZh ? '无法读取告警样本。' : 'Could not load alert events.')
    } finally {
      setLoadingScanAlertEvents(false)
    }
  }

  const sweepMediaJobs = async () => {
    setSweepingMediaJobs(true)
    try {
      const result = await mediaService.sweepScanJobs()
      setMediaRows((current) => current.map((item) => result.items.find((updated) => updated.id === item.id) ?? item))
      void mediaReviewStatus.refresh()
      void mediaScanAlertStatus.refresh()
      void operationsMetricsStatus.refresh()
      const pruned = result.pruned ?? 0
      simulateAction(
        isZh
          ? `媒体扫描巡检完成：检查 ${result.inspected}，重试 ${result.retried}，升级 ${result.failed}，清理历史 ${pruned}`
          : `Media scan sweep completed: inspected ${result.inspected}, retried ${result.retried}, escalated ${result.failed}, pruned ${pruned}`,
      )
    } catch (error) {
      console.info('[media-service]', error)
      simulateAction(isZh ? '媒体扫描巡检失败。' : 'Media scan sweep failed.')
    } finally {
      setSweepingMediaJobs(false)
    }
  }

  return (
    <div className="stack">
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
      <div className="chip-row">
        {adminTabs.map((item) => (
          <button
            className={activeTab === item ? 'chip active' : 'chip'}
            type="button"
            key={item}
            onClick={() => {
              setActiveTab(item)
              simulateAction(isZh ? `管理中心已切换：${adminTabLabels[item]}` : `Admin tab changed: ${item}`)
            }}
          >
            {adminTabLabels[item]}
          </button>
        ))}
      </div>
      <section className="panel">
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
      <section className="panel">
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
                  const isProtected = role.role === 'admin' && permission.id === 'admin:permissions:manage'
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
      <section className="panel">
        <SectionHeader
          eyebrow={textFor(t, 'Media governance', '媒体治理')}
          title={textFor(t, 'Upload review queue', '上传审核队列')}
          action={
            <>
              <button className="ghost-button" type="button" onClick={() => void mediaReviewStatus.refresh()} disabled={!canReadQueues}>
                {textFor(t, 'Refresh', '刷新')}
              </button>
              <button className="ghost-button" type="button" onClick={() => void sweepMediaJobs()} disabled={!canReadQueues || sweepingMediaJobs}>
                {sweepingMediaJobs ? textFor(t, 'Sweeping', '巡检中') : textFor(t, 'Sweep jobs', '扫描任务巡检')}
              </button>
            </>
          }
        />
        <div className="admin-detail-panel">
          <div>
            <strong>{textFor(t, 'Governance config', '治理配置')}</strong>
            <button className="ghost-button" type="button" onClick={() => void mediaGovernanceConfigStatus.refresh()} disabled={!canReadQueues || mediaGovernanceConfigStatus.loading}>
              {mediaGovernanceConfigStatus.loading ? textFor(t, 'Loading', '加载中') : textFor(t, 'Refresh', '刷新')}
            </button>
          </div>
          {mediaGovernanceConfigStatus.error && (
            <p>{mediaGovernanceConfigStatus.error}</p>
          )}
          {!mediaGovernanceConfigStatus.error && mediaGovernanceConfig && (
            <>
              <div className="button-row compact-buttons">
                <button className="ghost-button small" type="button" onClick={focusMediaGovernanceAudit} disabled={!canReadAudit}>
                  {textFor(t, 'View policy audit', '查看策略审计')}
                </button>
              </div>
              <div className="governance-config-grid">
                <div>
                  <strong>{mediaGovernanceConfig.storage.driver}</strong>
                  <span>{textFor(t, 'Storage driver', '存储驱动')}</span>
                </div>
                <div>
                  <strong>{mediaGovernanceConfig.scanner.provider}</strong>
                  <span>
                    {textFor(t, 'Scanner provider', '扫描提供方')} · {mediaGovernanceConfig.scanner.requestAdapter}
                  </span>
                </div>
                <div>
                  <strong>{enabledLabel(mediaGovernanceConfig.scanner.requestDispatchConfigured)}</strong>
                  <span>
                    {textFor(t, 'Dispatch', '派发')} · {mediaGovernanceConfig.scanner.requestTimeoutSeconds}s · {enabledLabel(mediaGovernanceConfig.scanner.requestSigningConfigured)}
                  </span>
                </div>
                <div>
                  <strong>{enabledLabel(mediaGovernanceConfig.scanner.callbackSignatureConfigured)}</strong>
                  <span>
                    {textFor(t, 'Callback signature', '回调签名')} · {mediaGovernanceConfig.scanner.callbackSignatureToleranceSeconds}s
                  </span>
                </div>
                <div>
                  <strong>{mediaGovernanceConfig.scanner.timeoutSeconds}s</strong>
                  <span>
                    {textFor(t, 'Scan timeout', '扫描超时')} · {textFor(t, 'attempts', '尝试')} {mediaGovernanceConfig.scanner.maxAttempts}
                  </span>
                </div>
                <div>
                  <strong>{enabledLabel(mediaGovernanceConfig.scanner.workerEnabled)}</strong>
                  <span>
                    {textFor(t, 'Sweep worker', '巡检 Worker')} · {mediaGovernanceConfig.scanner.workerIntervalSeconds}s
                  </span>
                </div>
                <div>
                  <strong>{mediaGovernanceConfig.retention.historyRetentionDays}d</strong>
                  <span>
                    {textFor(t, 'History retention', '历史保留')} · {mediaGovernanceConfig.retention.historyRetentionMaxPerAsset}/{textFor(t, 'asset', '资产')}
                  </span>
                </div>
                <div>
                  <strong>{mediaGovernanceConfig.alerts.windowMinutes}m</strong>
                  <span>
                    {textFor(t, 'Alert window', '告警窗口')} · {mediaGovernanceConfig.alerts.thresholds.callbackDenied}/{mediaGovernanceConfig.alerts.thresholds.dispatchFailed}/{mediaGovernanceConfig.alerts.thresholds.timeout}/{mediaGovernanceConfig.alerts.thresholds.alertDeliveryFailed}
                  </span>
                </div>
                <div>
                  <strong>
                    {[
                      mediaGovernanceConfig.alerts.channels.webhook.configured ? 'webhook' : null,
                      mediaGovernanceConfig.alerts.channels.slack.configured ? 'slack' : null,
                      mediaGovernanceConfig.alerts.channels.email.configured ? 'email' : null,
                    ].filter(Boolean).join(', ') || textFor(t, 'none', '无')}
                  </strong>
                  <span>
                    {textFor(t, 'External alert channels', '外部告警通道')} · {textFor(t, 'email recipients', '邮件收件人')} {mediaGovernanceConfig.alerts.channels.email.recipientCount}
                  </span>
                </div>
              </div>
              <div className="governance-policy-form">
                {[
                  ['retryDelaySeconds', textFor(t, 'Retry delay seconds', '重试延迟秒')],
                  ['timeoutSeconds', textFor(t, 'Scan timeout seconds', '扫描超时秒')],
                  ['maxAttempts', textFor(t, 'Max attempts', '最大尝试')],
                  ['workerIntervalSeconds', textFor(t, 'Worker interval seconds', 'Worker 间隔秒')],
                  ['historyRetentionDays', textFor(t, 'Retention days', '保留天数')],
                  ['historyRetentionMaxPerAsset', textFor(t, 'Max history per asset', '单资产历史上限')],
                  ['windowMinutes', textFor(t, 'Alert window minutes', '告警窗口分钟')],
                  ['callbackDenied', textFor(t, 'Callback denied threshold', '回调拒绝阈值')],
                  ['dispatchFailed', textFor(t, 'Dispatch failed threshold', '派发失败阈值')],
                  ['timeoutThreshold', textFor(t, 'Timeout threshold', '超时阈值')],
                  ['alertDeliveryFailed', textFor(t, 'Alert delivery failed threshold', '告警投递失败阈值')],
                ].map(([key, label]) => (
                  <label key={key}>
                    <span>{label}</span>
                    <input
                      min="1"
                      type="number"
                      value={mediaPolicyDraft[key as MediaPolicyDraftKey]}
                      onChange={(event) => setMediaPolicyDraftValue(key as MediaPolicyDraftKey, event.target.value)}
                      disabled={!canManagePermissions || savingMediaPolicy}
                    />
                  </label>
                ))}
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => void saveMediaGovernancePolicy()}
                  disabled={!canManagePermissions || savingMediaPolicy || hasInvalidMediaPolicyDraft}
                >
                  {savingMediaPolicy ? textFor(t, 'Saving policy', '保存策略中') : textFor(t, 'Save policy', '保存策略')}
                </button>
              </div>
              <div className="policy-impact-preview">
                <div className="policy-impact-header">
                  <strong>{textFor(t, 'Pending runtime impact', '待保存运行影响')}</strong>
                  <span>
                    {mediaPolicyImpactPreview.length === 0
                      ? textFor(t, 'No pending changes', '暂无待保存变更')
                      : textFor(t, `${mediaPolicyImpactPreview.length} pending item${mediaPolicyImpactPreview.length === 1 ? '' : 's'}`, `${mediaPolicyImpactPreview.length} 项待处理`)}
                  </span>
                </div>
                {mediaPolicyImpactPreview.length === 0 && (
                  <span>{textFor(t, 'Current draft matches the active media governance policy.', '当前草稿与生效的媒体治理策略一致。')}</span>
                )}
                {mediaPolicyImpactPreview.map((item) => (
                  <div className={item.status === 'invalid' ? 'policy-impact-row invalid' : 'policy-impact-row'} key={item.key}>
                    <div>
                      <strong>{textFor(t, item.en, item.zh)}</strong>
                      <span>{item.from} -&gt; {item.to || textFor(t, 'empty', '空值')}</span>
                    </div>
                    <span>{textFor(t, item.impactEn, item.impactZh)}</span>
                  </div>
                ))}
              </div>
              {confirmingMediaPolicySave && highRiskMediaPolicyChanges.length > 0 && (
                <div className="policy-save-confirmation" role="alert">
                  <div className="policy-impact-header">
                    <strong>{textFor(t, 'Confirm high-risk changes', '确认高风险变更')}</strong>
                    <span>{textFor(t, 'Review these operational impacts before saving.', '保存前请复核这些运营影响。')}</span>
                  </div>
                  {highRiskMediaPolicyChanges.map((item) => (
                    <div className="policy-impact-row warning" key={item.key}>
                      <div>
                        <strong>{textFor(t, item.en, item.zh)}</strong>
                        <span>{item.from} -&gt; {item.to}</span>
                      </div>
                      <span>{textFor(t, item.riskEn, item.riskZh)}</span>
                    </div>
                  ))}
                  <div className="button-row compact-buttons">
                    <button className="ghost-button small" type="button" onClick={() => setConfirmingMediaPolicySave(false)} disabled={savingMediaPolicy}>
                      {textFor(t, 'Cancel', '取消')}
                    </button>
                    <button className="primary-button small" type="button" onClick={() => void commitMediaGovernancePolicy()} disabled={savingMediaPolicy}>
                      {savingMediaPolicy ? textFor(t, 'Saving', '保存中') : textFor(t, 'Confirm save', '确认保存')}
                    </button>
                  </div>
                </div>
              )}
              <div className="policy-history">
                <div className="policy-history-header">
                  <strong>{textFor(t, 'Governance policy history', '治理策略历史')}</strong>
                  <button className="ghost-button small" type="button" onClick={() => void mediaPolicyHistoryStatus.refresh()} disabled={!canReadQueues}>
                    {textFor(t, 'Refresh', '刷新')}
                  </button>
                </div>
                {mediaPolicyHistoryStatus.loading && (
                  <span>{textFor(t, 'Loading policy history', '正在加载策略历史')}</span>
                )}
                {!mediaPolicyHistoryStatus.loading && mediaPolicyHistoryStatus.error && (
                  <span>{mediaPolicyHistoryStatus.error}</span>
                )}
                {!mediaPolicyHistoryStatus.loading && !mediaPolicyHistoryStatus.error && mediaPolicyHistory.length === 0 && (
                  <span>{textFor(t, 'No governance policy changes yet', '暂无治理策略变更')}</span>
                )}
                {!mediaPolicyHistoryStatus.loading && !mediaPolicyHistoryStatus.error && mediaPolicyHistory.map((event) => {
                  const diffRows = mediaGovernanceDiffRows(event.diff)
                  const expanded = Boolean(expandedMediaPolicyEventIds[event.id])
                  return (
                    <div className="policy-history-entry" key={event.id}>
                      <div className="policy-history-row">
                        <div>
                          <strong>{event.action.replace('media.governance_policy.', '')}</strong>
                          <span>{event.summary}</span>
                          <small>{event.actorId ?? 'system'} · {formatAuditTime(event.createdAt)}</small>
                        </div>
                        <div className="button-row compact-buttons">
                          <button
                            className="ghost-button small"
                            type="button"
                            onClick={() => setExpandedMediaPolicyEventIds((current) => ({ ...current, [event.id]: !expanded }))}
                            disabled={diffRows.length === 0}
                          >
                            {expanded ? textFor(t, 'Hide diff', '收起差异') : textFor(t, 'View diff', '查看差异')}
                          </button>
                          <button
                            className="ghost-button small"
                            type="button"
                            onClick={() => focusAuditEvent(event.id, 'media_governance_policy')}
                            disabled={!canReadAudit}
                          >
                            {textFor(t, 'Audit', '审计')}
                          </button>
                          <button
                            className="ghost-button small"
                            type="button"
                            onClick={() => void rollbackMediaGovernancePolicy(event.id)}
                            disabled={!canManagePermissions || !event.previous || rollingBackMediaPolicy === event.id}
                          >
                            {rollingBackMediaPolicy === event.id ? textFor(t, 'Rolling back', '回滚中') : textFor(t, 'Rollback', '回滚')}
                          </button>
                        </div>
                      </div>
                      {expanded && (
                        <div className="policy-diff-grid">
                          {diffRows.length === 0 && (
                            <span>{textFor(t, 'No material field changes', '无实质字段变化')}</span>
                          )}
                          {diffRows.map((row) => (
                            <div className="policy-diff-row" key={row.key}>
                              <strong>{textFor(t, row.en, row.zh)}</strong>
                              <span>{row.from}</span>
                              <span aria-hidden="true">-&gt;</span>
                              <span>{row.to}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
        <div className="permission-summary">
          <label>
            <span>{textFor(t, 'Scan status', '扫描状态')}</span>
            <select
              aria-label={textFor(t, 'Media scan status', '媒体扫描状态')}
              value={mediaStatus}
              onChange={(event) => setMediaStatus(event.target.value as NonNullable<MediaReviewQueueQuery['status']>)}
            >
              {mediaReviewStatuses.map((status) => (
                <option value={status} key={status}>{status}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{textFor(t, 'Purpose', '用途')}</span>
            <select
              aria-label={textFor(t, 'Media purpose', '媒体用途')}
              value={mediaPurpose ?? ''}
              onChange={(event) => setMediaPurpose(event.target.value ? event.target.value as MediaAssetPurpose : null)}
            >
              <option value="">{textFor(t, 'All purposes', '全部用途')}</option>
              {mediaPurposes.map((purpose) => (
                <option value={purpose} key={purpose}>{purpose}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{textFor(t, 'Search', '搜索')}</span>
            <input
              aria-label={textFor(t, 'Search media queue', '搜索媒体队列')}
              value={mediaSearch}
              onChange={(event) => setMediaSearch(event.target.value)}
              placeholder={textFor(t, 'Filename, type, owner', '文件名、类型、所有者')}
            />
          </label>
        </div>
        <div className="admin-table">
          {mediaReviewStatus.loading && (
            <div className="empty-state">
              <strong>{textFor(t, 'Loading media queue', '正在加载媒体队列')}</strong>
              <span>{textFor(t, 'Reading scan and quarantine candidates.', '正在读取扫描与隔离候选项。')}</span>
            </div>
          )}
          {!mediaReviewStatus.loading && mediaReviewStatus.error && (
            <div className="empty-state">
              <strong>{textFor(t, 'Media queue unavailable', '媒体队列暂不可用')}</strong>
              <span>{mediaReviewStatus.error}</span>
            </div>
          )}
          {!mediaReviewStatus.loading && !mediaReviewStatus.error && mediaRows.length === 0 && (
            <div className="empty-state">
              <strong>{textFor(t, 'No media assets', '暂无媒体资产')}</strong>
              <span>{textFor(t, 'Try another scan status, purpose, or search term.', '尝试其他扫描状态、用途或搜索词。')}</span>
            </div>
          )}
          {!mediaReviewStatus.loading && !mediaReviewStatus.error && mediaRows.map((asset) => {
            const security = asset.metadata && typeof asset.metadata === 'object' && !Array.isArray(asset.metadata)
              ? (asset.metadata as { security?: Record<string, unknown> }).security ?? {}
              : {}
            const scanStatus = String(security.scanStatus ?? 'pending')
            const scanJobStatus = String(security.scanJobStatus ?? '')
            return (
              <div className={highlightedMediaAssetId === asset.id ? 'admin-row deep-linked' : 'admin-row'} key={asset.id}>
                <StatusBadge status={scanStatus} t={t} />
                <strong>{asset.fileName}</strong>
                <span>{asset.purpose}</span>
                <small>
                  {asset.contentType} · {asset.sizeBytes} bytes · {String(security.scanProvider ?? 'manual')}
                  {scanJobStatus ? ` · ${scanJobStatus}` : ''}
                  {security.scanAttempts ? ` · ${textFor(t, 'attempts', '尝试')} ${String(security.scanAttempts)}` : ''}
                  {security.scanTimeoutAt ? ` · ${textFor(t, 'timeout', '超时')} ${String(security.scanTimeoutAt).slice(0, 16)}` : ''}
                  {security.rejectionReason ? ` · ${String(security.rejectionReason)}` : ''}
                  {security.scanDispatchStatus ? ` · dispatch ${String(security.scanDispatchStatus)}` : ''}
                </small>
                <div className="button-row">
                  <button
                    className={selectedMediaAssetId === asset.id ? 'ghost-button active' : 'ghost-button'}
                    type="button"
                    onClick={() => {
                      setMediaScanHistory([])
                      setMediaScanHistoryNextCursor(null)
                      setLoadingMoreMediaScanHistory(false)
                      setSelectedMediaAssetId(selectedMediaAssetId === asset.id ? null : asset.id)
                    }}
                  >
                    {textFor(t, 'History', '历史')}
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => void retryMediaAsset(asset)}
                    disabled={reviewingMediaId === asset.id || scanJobStatus === 'queued' || scanJobStatus === 'retrying'}
                  >
                    {reviewingMediaId === asset.id ? textFor(t, 'Saving', '保存中') : textFor(t, 'Retry scan', '重试扫描')}
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => void reviewMediaAsset(asset, 'reject')}
                    disabled={reviewingMediaId === asset.id || scanStatus === 'rejected'}
                  >
                    {reviewingMediaId === asset.id ? textFor(t, 'Saving', '保存中') : textFor(t, 'Reject', '拒绝')}
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => void reviewMediaAsset(asset, 'clean')}
                    disabled={reviewingMediaId === asset.id || scanStatus === 'clean'}
                  >
                    {reviewingMediaId === asset.id ? textFor(t, 'Saving', '保存中') : textFor(t, 'Release', '放行')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        {selectedMediaAssetId && (
          <div className="admin-detail-panel">
            <div>
              <strong>{textFor(t, 'Scan job history', '扫描任务历史')}</strong>
              <span>{selectedMediaAssetId}</span>
            </div>
            {mediaScanHistoryStatus.loading && mediaScanHistory.length === 0 && (
              <p>{textFor(t, 'Loading scan attempts.', '正在加载扫描尝试。')}</p>
            )}
            {mediaScanHistoryStatus.loading && mediaScanHistory.length > 0 && (
              <p>{textFor(t, 'Refreshing scan attempts.', '正在刷新扫描尝试。')}</p>
            )}
            {!mediaScanHistoryStatus.loading && mediaScanHistoryStatus.error && (
              <p>{mediaScanHistoryStatus.error}</p>
            )}
            {!mediaScanHistoryStatus.loading && !mediaScanHistoryStatus.error && mediaScanHistory.length === 0 && (
              <p>{textFor(t, 'No scan job records yet.', '暂无扫描任务记录。')}</p>
            )}
            {!mediaScanHistoryStatus.loading && !mediaScanHistoryStatus.error && mediaScanHistory.map((job) => {
              const metadata = job.metadata && typeof job.metadata === 'object' && !Array.isArray(job.metadata)
                ? job.metadata as Record<string, unknown>
                : {}
              return (
                <div className="admin-row compact" key={job.id}>
                  <StatusBadge status={job.scanStatus} t={t} />
                  <strong>{job.provider} · {job.status}</strong>
                  <span>{textFor(t, 'attempt', '尝试')} {job.attempts}</span>
                  <small>
                    {job.externalScanId ? `${job.externalScanId} · ` : ''}
                    {job.requestedAt ? `${textFor(t, 'requested', '请求')} ${job.requestedAt.slice(0, 16)} · ` : ''}
                    {job.timeoutAt ? `${textFor(t, 'timeout', '超时')} ${job.timeoutAt.slice(0, 16)} · ` : ''}
                    {job.callbackAt ? `${textFor(t, 'callback', '回调')} ${job.callbackAt.slice(0, 16)} · ` : ''}
                    {job.failedAt ? `${textFor(t, 'failed', '失败')} ${job.failedAt.slice(0, 16)} · ` : ''}
                    {metadata.dispatchStatus ? `dispatch ${String(metadata.dispatchStatus)} · ` : ''}
                    {metadata.dispatchError ? `${String(metadata.dispatchError)} · ` : ''}
                    {job.rejectionReason ? String(job.rejectionReason) : job.note ?? ''}
                  </small>
                </div>
              )
            })}
            {!mediaScanHistoryStatus.error && mediaScanHistoryNextCursor && (
              <button
                className="ghost-button"
                type="button"
                onClick={() => void loadMoreMediaScanHistory()}
                disabled={loadingMoreMediaScanHistory || mediaScanHistoryStatus.loading}
              >
                {loadingMoreMediaScanHistory
                  ? textFor(t, 'Loading more', '加载更多中')
                  : textFor(t, 'Load more history', '加载更多历史')}
              </button>
            )}
          </div>
        )}
        <div className="admin-detail-panel">
          <div>
            <strong>{textFor(t, 'Scan alerts', '扫描告警')}</strong>
            <button className="ghost-button" type="button" onClick={() => void mediaScanAlertStatus.refresh()} disabled={!canReadQueues || mediaScanAlertStatus.loading}>
              {mediaScanAlertStatus.loading ? textFor(t, 'Loading', '加载中') : textFor(t, 'Refresh', '刷新')}
            </button>
          </div>
          {mediaScanAlertStatus.error && (
            <p>{mediaScanAlertStatus.error}</p>
          )}
          {!mediaScanAlertStatus.loading && !mediaScanAlertStatus.error && mediaScanAlerts.length === 0 && (
            <p>{textFor(t, 'No scanner alert thresholds are currently breached.', '当前没有触发扫描告警阈值。')}</p>
          )}
          {!mediaScanAlertStatus.error && mediaScanAlerts.map((alert) => {
            const isHandling = handlingScanAlertId === alert.id
            const state = alert.state ?? 'active'
            const statusCopy = state === 'silenced'
              ? textFor(t, 'silenced', '已静默')
              : state === 'acknowledged'
                ? textFor(t, 'acknowledged', '已确认')
                : textFor(t, 'active', '活跃')
            return (
              <div className="admin-row compact" key={alert.id}>
                <StatusBadge status={state === 'active' ? alert.severity : state} t={t} />
                <strong>{alert.title}</strong>
                <span>{statusCopy} · {textFor(t, 'count', '次数')} {alert.count} / {alert.threshold}</span>
                <small>
                  {alert.summary} · {textFor(t, 'window', '窗口')} {alert.windowMinutes}m
                  {alert.acknowledgedBy ? ` · ${textFor(t, 'ack', '确认')} @${alert.acknowledgedBy}` : ''}
                  {alert.silencedUntil ? ` · ${textFor(t, 'silent until', '静默至')} ${alert.silencedUntil.slice(0, 16)}` : ''}
                </small>
                <div className="button-row">
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => void toggleScanAlertEvents(alert)}
                    disabled={!canReadQueues || loadingScanAlertEvents}
                  >
                    {selectedScanAlertId === alert.id ? textFor(t, 'Hide events', '收起样本') : textFor(t, 'Events', '样本')}
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => void acknowledgeScanAlert(alert)}
                    disabled={!canReviewQueues || isHandling}
                  >
                    {isHandling ? textFor(t, 'Saving', '保存中') : textFor(t, 'Acknowledge', '确认')}
                  </button>
                  {state === 'silenced' ? (
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => void unsilenceScanAlert(alert)}
                      disabled={!canReviewQueues || isHandling}
                    >
                      {isHandling ? textFor(t, 'Saving', '保存中') : textFor(t, 'Unsilence', '解除静默')}
                    </button>
                  ) : (
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => void silenceScanAlert(alert)}
                      disabled={!canReviewQueues || isHandling}
                    >
                      {isHandling ? textFor(t, 'Saving', '保存中') : textFor(t, 'Silence 24h', '静默24小时')}
                    </button>
                  )}
                </div>
                {selectedScanAlertId === alert.id && (
                  <div className="admin-inline-list">
                    {loadingScanAlertEvents && (
                      <small>{textFor(t, 'Loading alert events.', '正在加载告警样本。')}</small>
                    )}
                    {scanAlertEventsError && (
                      <small>{scanAlertEventsError}</small>
                    )}
                    {!loadingScanAlertEvents && !scanAlertEventsError && scanAlertEvents.length === 0 && (
                      <small>{textFor(t, 'No recent samples for this alert.', '暂无该告警的近期样本。')}</small>
                    )}
                    {!loadingScanAlertEvents && !scanAlertEventsError && scanAlertEvents.map((event) => {
                      const metadata = asRecord(event.metadata)
                      const details = [
                        metadata.reason,
                        metadata.dispatchStatus,
                        metadata.dispatchStatusCode,
                        metadata.dispatchError,
                        metadata.status,
                        metadata.statusCode,
                        metadata.error,
                        metadata.externalScanId,
                      ].filter((item) => item !== undefined && item !== null && item !== '').map(String)
                      return (
                        <small key={event.id}>
                          {event.action} · {event.resourceId ?? event.resourceType} · {formatAuditTime(event.createdAt)}
                          {details.length > 0 ? ` · ${details.slice(0, 3).join(' · ')}` : ''}
                        </small>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className="admin-detail-panel">
          <div>
            <strong>{textFor(t, 'Callback failures', '回调失败')}</strong>
            <button className="ghost-button" type="button" onClick={() => void callbackFailureStatus.refresh()} disabled={!canReadQueues || !canReadAudit || callbackFailureStatus.loading}>
              {callbackFailureStatus.loading ? textFor(t, 'Loading', '加载中') : textFor(t, 'Refresh', '刷新')}
            </button>
          </div>
          {!canReadAudit && (
            <p>{textFor(t, 'Audit read permission is required to inspect denied callbacks.', '需要审计读取权限才能查看被拒绝的回调。')}</p>
          )}
          {callbackFailureStatus.error && (
            <p>{callbackFailureStatus.error}</p>
          )}
          {canReadAudit && !callbackFailureStatus.loading && !callbackFailureStatus.error && callbackFailureEvents.length === 0 && (
            <p>{textFor(t, 'No recent denied scanner callbacks.', '暂无近期被拒绝的扫描回调。')}</p>
          )}
          {canReadAudit && !callbackFailureStatus.error && callbackFailureEvents.map((event) => {
            const metadata = asRecord(event.metadata)
            const headers = asRecord(metadata.headers)
            const externalScanId = metadata.externalScanId ? String(metadata.externalScanId) : ''
            const yes = textFor(t, 'yes', '是')
            const no = textFor(t, 'no', '否')
            return (
              <div className="admin-row compact" key={event.id}>
                <StatusBadge status="rejected" t={t} />
                <strong>{String(metadata.reason ?? event.action)}</strong>
                <span>{event.resourceId ?? textFor(t, 'Unknown asset', '未知资产')}</span>
                <small>
                  {externalScanId ? `${externalScanId} · ` : ''}
                  {textFor(t, 'secret', '密钥')} {headers.hasSecret ? yes : no} · {textFor(t, 'timestamp', '时间戳')} {headers.hasTimestamp ? yes : no} · {textFor(t, 'signature', '签名')} {headers.hasSignature ? yes : no} · {formatAuditTime(event.createdAt)}
                </small>
              </div>
            )
          })}
        </div>
      </section>
      <section className="panel">
        <SectionHeader
          eyebrow={textFor(t, 'Finance', '账务')}
          title={textFor(t, 'User ledger operations', '用户账本运营')}
          action={
            <button className="ghost-button" type="button" onClick={() => void exportLedger()} disabled={!canAdjustPoints || exportingLedger}>
              {exportingLedger ? textFor(t, 'Exporting', '导出中') : textFor(t, 'Export CSV', '导出 CSV')}
            </button>
          }
        />
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
              <strong>{pointText(String(value ?? 0))}</strong>
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
      <section className="panel" data-testid="admin-provider-controls">
        <SectionHeader
          eyebrow={textFor(t, 'Creative operations', '创作运营')}
          title={textFor(t, 'Provider controls', 'Provider 控制')}
          action={
            <button className="ghost-button" type="button" onClick={() => void providerControlStatus.refresh()} disabled={!canReadProviderControls || providerControlStatus.loading}>
              {providerControlStatus.loading ? textFor(t, 'Loading', '加载中') : textFor(t, 'Refresh', '刷新')}
            </button>
          }
        />
        <div className="permission-summary">
          <label>
            <span>{textFor(t, 'Reason code', '原因代码')}</span>
            <input
              aria-label={textFor(t, 'Provider control reason code', 'Provider 控制原因代码')}
              value={providerControlReason}
              onChange={(event) => setProviderControlReason(event.target.value)}
              placeholder="operator_requested"
            />
          </label>
        </div>
        {providerControlStatus.error && (
          <div className="empty-state">
            <strong>{textFor(t, 'Provider controls unavailable', 'Provider 控制不可用')}</strong>
            <span>{providerControlStatus.error}</span>
          </div>
        )}
        {!providerControlStatus.error && (
          <div className="admin-table">
            {providerControls.controls.map((control) => {
              const resourceId = control.id ?? ''
              const actionKey = `${resourceId}:${control.enabled ? 'disable' : 'enable'}`
              return (
                <div className="admin-row" key={resourceId}>
                  <StatusBadge status={control.enabled ? 'Enabled' : 'Disabled'} t={t} />
                  <strong>{control.providerId ?? control.scopeType}</strong>
                  <span>{control.workspace ?? control.scopeType}{control.modelFamily ? ` / ${control.modelFamily}` : ''}</span>
                  <small>{control.reasonCode} · v{control.version}</small>
                  <button
                    className={control.enabled ? 'danger-button' : 'ghost-button'}
                    type="button"
                    onClick={() => void runProviderControlAction(resourceId, control.version, control.enabled ? 'disable' : 'enable')}
                    disabled={!resourceId || (control.enabled ? !canManageProviderControls : !canRecoverProviderControls) || Boolean(runningProviderControlAction)}
                  >
                    {runningProviderControlAction === actionKey
                      ? textFor(t, 'Working', '处理中')
                      : control.enabled
                        ? textFor(t, 'Disable', '停用')
                        : textFor(t, 'Request enable', '申请启用')}
                  </button>
                </div>
              )
            })}
            {providerControls.circuits.map((circuit) => {
              const resourceId = circuit.id ?? ''
              const target: AdminProviderControlRecoveryTarget | null = circuit.status === 'open'
                ? 'half_open'
                : circuit.status === 'half_open'
                  ? 'closed'
                  : null
              return (
                <div className="admin-row" key={`circuit-${resourceId}`}>
                  <StatusBadge status={circuit.status} t={t} />
                  <strong>{circuit.providerId ?? '-'}</strong>
                  <span>{circuit.workspace}{circuit.modelFamily ? ` / ${circuit.modelFamily}` : ''}</span>
                  <small>{circuit.failureCount} {textFor(t, 'failures', '次故障')} · {circuit.reasonCode ?? '-'}</small>
                  {target && (
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => void runProviderControlAction(resourceId, circuit.version, target)}
                      disabled={!resourceId || !canRecoverProviderControls || Boolean(runningProviderControlAction)}
                    >
                      {target === 'half_open' ? textFor(t, 'Request probe', '申请探测') : textFor(t, 'Request close', '申请关闭熔断')}
                    </button>
                  )}
                </div>
              )
            })}
            {providerControls.capEvidence.map((evidence) => (
              <div className="admin-row" key={`cap-${evidence.id}`}>
                <StatusBadge status={evidence.active ? 'Active' : 'Inactive'} t={t} />
                <strong>{evidence.providerId ?? '-'}</strong>
                <span>{formatProviderCostAmount(evidence.capAmount, evidence.currency)}</span>
                <small>{textFor(t, 'remaining', '剩余')} {formatProviderCostAmount(evidence.remainingAmount, evidence.currency)} · {evidence.sourceType} · {formatAuditTime(evidence.expiresAt)}</small>
                <span>SHA-256 {evidence.evidenceHashPreview ?? '-'}</span>
              </div>
            ))}
            {!providerControlStatus.loading && providerControls.controls.length === 0 && providerControls.circuits.length === 0 && (
              <div className="empty-state">
                <strong>{textFor(t, 'No Provider controls', '暂无 Provider 控制')}</strong>
                <span>{textFor(t, 'No durable control state is available.', '暂无可用的持久化控制状态。')}</span>
              </div>
            )}
          </div>
        )}
      </section>
      <section className="panel" data-testid="admin-generation-history">
        <SectionHeader
          eyebrow={textFor(t, 'Creative operations', '创作运营')}
          title={textFor(t, 'Generation history', '生成历史')}
          action={
            <button className="ghost-button" type="button" onClick={() => void generationHistoryStatus.refresh()} disabled={!canReadAudit || generationHistoryStatus.loading}>
              {generationHistoryStatus.loading ? textFor(t, 'Loading', '加载中') : textFor(t, 'Refresh', '刷新')}
            </button>
          }
        />
        <div className="permission-summary">
          <label>
            <span>{textFor(t, 'User', '用户')}</span>
            <input
              aria-label={textFor(t, 'Generation user handle', '生成用户 Handle')}
              value={generationUserHandle}
              onChange={(event) => setGenerationUserHandle(event.target.value)}
              placeholder="promptlin"
              disabled={!canReadAudit}
            />
          </label>
          <label>
            <span>{textFor(t, 'Workspace', '工作区')}</span>
            <select
              aria-label={textFor(t, 'Generation workspace', '生成工作区')}
              value={generationWorkspace}
              onChange={(event) => setGenerationWorkspace(event.target.value)}
              disabled={!canReadAudit}
            >
              <option value="">{textFor(t, 'All workspaces', '全部工作区')}</option>
              {creativeHistoryWorkspaces.map((workspace) => (
                <option value={workspace} key={workspace}>{workspace}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{textFor(t, 'Provider', '提供方')}</span>
            <input
              aria-label={textFor(t, 'Generation provider', '生成提供方')}
              value={generationProviderId}
              onChange={(event) => setGenerationProviderId(event.target.value)}
              placeholder="mock-image"
              disabled={!canReadAudit}
            />
          </label>
          <label>
            <span>{textFor(t, 'Status', '状态')}</span>
            <select
              aria-label={textFor(t, 'Generation status', '生成状态')}
              value={generationStatusFilter}
              onChange={(event) => setGenerationStatusFilter(event.target.value)}
              disabled={!canReadAudit}
            >
              <option value="">{textFor(t, 'All statuses', '全部状态')}</option>
              {creativeHistoryStatuses.map((status) => (
                <option value={status} key={status}>{formatGenerationStatus(status)}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{textFor(t, 'Review', '复核')}</span>
            <select
              aria-label={textFor(t, 'Generation review filter', '生成复核筛选')}
              value={generationReviewFilter}
              onChange={(event) => setGenerationReviewFilter(event.target.value as 'all' | 'true' | 'false')}
              disabled={!canReadAudit}
            >
              <option value="all">{textFor(t, 'All', '全部')}</option>
              <option value="true">{textFor(t, 'Review required', '需要复核')}</option>
              <option value="false">{textFor(t, 'No review gate', '无需复核')}</option>
            </select>
          </label>
          <label>
            <span>{textFor(t, 'Media asset', '媒体资产')}</span>
            <input
              aria-label={textFor(t, 'Generation media asset id', '生成媒体资产 ID')}
              value={generationMediaAssetId}
              onChange={(event) => setGenerationMediaAssetId(event.target.value)}
              placeholder="media-..."
              disabled={!canReadAudit}
            />
          </label>
          <label>
            <span>{textFor(t, 'From', '开始日期')}</span>
            <input
              aria-label={textFor(t, 'Generation date from', '生成开始日期')}
              type="date"
              value={generationDateFrom}
              onChange={(event) => setGenerationDateFrom(event.target.value)}
              disabled={!canReadAudit}
            />
          </label>
          <label>
            <span>{textFor(t, 'To', '结束日期')}</span>
            <input
              aria-label={textFor(t, 'Generation date to', '生成结束日期')}
              type="date"
              value={generationDateTo}
              onChange={(event) => setGenerationDateTo(event.target.value)}
              disabled={!canReadAudit}
            />
          </label>
          <button
            className="ghost-button"
            type="button"
            onClick={clearGenerationFilters}
            disabled={!canReadAudit || (!generationUserHandle && !generationWorkspace && !generationProviderId && !generationStatusFilter && generationReviewFilter === 'all' && !generationMediaAssetId && !generationDateFrom && !generationDateTo)}
          >
            {textFor(t, 'Clear filters', '清除筛选')}
          </button>
        </div>
        <div className="market-dashboard">
          {[
            [textFor(t, 'Visible rows', '当前记录'), generationRows.length, textFor(t, 'Durable generation records', '持久化生成记录')],
            [textFor(t, 'Needs review', '需要复核'), generationRows.filter(generationReviewRequired).length, textFor(t, 'Safety or media gate active', '安全或媒体门禁生效')],
            [textFor(t, 'Settled credits', '已结算 Credits'), generationRows.reduce((sum, row) => sum + generationCreditAmount(row, 'settled'), 0), textFor(t, 'From durable credit metadata', '来自持久化 credit 元数据')],
            [textFor(t, 'Output assets', '输出资产'), generationRows.reduce((sum, row) => sum + row.outputAssetIds.length, 0), textFor(t, 'Linked media asset ids', '已关联媒体资产 ID')],
          ].map(([label, value, detail]) => (
            <article className="metric-card highlight" key={label}>
              <span>{label}</span>
              <strong>{formatMetricNumber(Number(value))}</strong>
              <small>{detail}</small>
            </article>
          ))}
        </div>
        <div className="admin-table">
          {generationHistoryStatus.loading && (
            <div className="empty-state">
              <strong>{textFor(t, 'Loading generation history', '正在加载生成历史')}</strong>
              <span>{textFor(t, 'Reading durable generation, quota, credit, and safety metadata.', '正在读取持久化生成、额度、Credit 与安全元数据。')}</span>
            </div>
          )}
          {!generationHistoryStatus.loading && generationHistoryStatus.error && (
            <div className="empty-state">
              <strong>{textFor(t, 'Generation history unavailable', '生成历史不可用')}</strong>
              <span>{generationHistoryStatus.error}</span>
              <button className="ghost-button" type="button" onClick={() => void generationHistoryStatus.refresh()}>
                {textFor(t, 'Retry sync', '重试同步')}
              </button>
            </div>
          )}
          {!generationHistoryStatus.loading && !generationHistoryStatus.error && generationRows.length === 0 && (
            <div className="empty-state">
              <strong>{textFor(t, 'No generation records', '暂无生成记录')}</strong>
              <span>{textFor(t, 'Try another user, provider, media asset, date, or status filter.', '尝试其他用户、提供方、媒体资产、日期或状态筛选。')}</span>
            </div>
          )}
          {!generationHistoryStatus.error && generationRows.map((generation) => {
            const firstOutputAssetId = generation.outputAssetIds[0]
            const title = generation.promptPreview || `${generation.promptHash.slice(0, 12)}...`
            const creditStatus = generationCreditStatus(generation)
            const quotaUsed = generationQuotaAmount(generation, 'used')
            const quotaLimit = generationQuotaAmount(generation, 'limit')
            const providerCost = generationProviderCost(generation)
            const isSelected = selectedGenerationId === generation.id
            return (
              <div className={isSelected ? 'admin-row generation-row deep-linked' : 'admin-row generation-row'} key={generation.id}>
                <StatusBadge status={formatGenerationStatus(generation.status)} t={t} />
                <strong>{title}</strong>
                <span>
                  @{generation.actorHandle ?? generation.actorId ?? 'system'} · {generation.workspace}/{generation.mode} · {generation.providerId}
                </span>
                <small>
                  {formatAuditTime(generation.createdAt)}
                  {' · '}
                  {creditStatus} {generationCreditAmount(generation, 'settled')}/{generationCreditAmount(generation, 'reserved')}
                  {' · '}
                  {textFor(t, 'quota', '额度')} {quotaUsed}/{quotaLimit || '-'}
                  {' · '}
                  {textFor(t, 'outputs', '输出')} {generation.outputAssetIds.length}
                  {' · '}
                  {textFor(t, 'replays', 'Replay')} {generationReplayCount(generation)}
                  {providerCost ? ` · ${textFor(t, 'cost', '成本')} ${formatProviderCostSummary(generation)} · ${textFor(t, 'budget', '预算')} ${providerCost.budget.status ?? '-'}` : ''}
                  {generationReviewRequired(generation) ? ` · ${textFor(t, 'review required', '需要复核')}` : ''}
                </small>
                <div className="button-row">
                  <button className={isSelected ? 'ghost-button active' : 'ghost-button'} type="button" onClick={() => void toggleGenerationDetail(generation)}>
                    {isSelected ? textFor(t, 'Hide details', '收起详情') : textFor(t, 'Details', '详情')}
                  </button>
                  <button className="ghost-button" type="button" onClick={() => firstOutputAssetId && focusGenerationMediaAsset(firstOutputAssetId)} disabled={!firstOutputAssetId || !canReadQueues}>
                    {textFor(t, 'Media', '媒体')}
                  </button>
                  <button className="ghost-button" type="button" onClick={() => focusGenerationAudit(generation.id)} disabled={!canReadAudit}>
                    {textFor(t, 'Audit', '审计')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        {generationNextCursor && !generationHistoryStatus.error && (
          <div className="button-row">
            <button className="ghost-button" type="button" onClick={() => void loadMoreGenerations()} disabled={loadingMoreGenerations || !canReadAudit}>
              {loadingMoreGenerations ? textFor(t, 'Loading', '加载中') : textFor(t, 'Load more', '加载更多')}
            </button>
          </div>
        )}
        {selectedGenerationId && (
          <div className="admin-detail-panel">
            <div>
              <strong>{textFor(t, 'Generation detail', '生成详情')}</strong>
              <span>{selectedGenerationId}</span>
            </div>
            {loadingGenerationDetail && (
              <p>{textFor(t, 'Refreshing detail from the API.', '正在从 API 刷新详情。')}</p>
            )}
            {generationDetailError && (
              <p>{generationDetailError}</p>
            )}
            {selectedGeneration && (
              <>
                <div className="permission-summary generation-mutation-controls">
                  <label>
                    <span>{textFor(t, 'Reason code', '原因代码')}</span>
                    <input
                      aria-label={textFor(t, 'Generation action reason code', '生成操作原因代码')}
                      value={generationMutationReason}
                      onChange={(event) => setGenerationMutationReason(event.target.value)}
                      disabled={Boolean(runningGenerationAction)}
                    />
                  </label>
                  <label>
                    <span>{textFor(t, 'Operator note', '操作说明')}</span>
                    <input
                      aria-label={textFor(t, 'Generation action note', '生成操作说明')}
                      value={generationMutationNote}
                      onChange={(event) => setGenerationMutationNote(event.target.value)}
                      disabled={Boolean(runningGenerationAction)}
                    />
                  </label>
                  <label>
                    <span>{textFor(t, 'Replay status', '重放状态')}</span>
                    <select
                      aria-label={textFor(t, 'Manual replay status', '人工重放状态')}
                      value={generationReplayStatus}
                      onChange={(event) => setGenerationReplayStatus(event.target.value as typeof generationReplayStatus)}
                      disabled={Boolean(runningGenerationAction)}
                    >
                      {(['queued', 'running', 'completed', 'failed', 'cancelled'] as const).map((status) => (
                        <option value={status} key={status}>{formatGenerationStatus(status)}</option>
                      ))}
                    </select>
                  </label>
                  <div className="button-row">
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => void runGenerationMutation('cancel')}
                      disabled={!canCancelGenerations || !['queued', 'running'].includes(selectedGeneration.status) || Boolean(runningGenerationAction)}
                      title={textFor(t, 'Cancel generation', '取消生成任务')}
                    >
                      <XCircle size={16} aria-hidden="true" />
                      {textFor(t, 'Cancel', '取消')}
                    </button>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => void runGenerationMutation('retry')}
                      disabled={!canRequestGenerationRetries || !['failed', 'cancelled'].includes(selectedGeneration.status) || Boolean(runningGenerationAction)}
                      title={textFor(t, 'Authorize user retry', '授权用户重试')}
                    >
                      <RotateCcw size={16} aria-hidden="true" />
                      {textFor(t, 'Authorize retry', '授权重试')}
                    </button>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => void runGenerationMutation('manual_replay')}
                      disabled={!canRequestManualReplay || !selectedGeneration.providerJobId || Boolean(runningGenerationAction) || (generationReplayStatus === 'completed' && selectedGeneration.outputAssetIds.length === 0)}
                      title={textFor(t, 'Request manual Provider replay', '申请人工 Provider 重放')}
                    >
                      <PlayCircle size={16} aria-hidden="true" />
                      {textFor(t, 'Request replay', '申请重放')}
                    </button>
                  </div>
                </div>
                <div className="audit-metadata-grid">
                  <div>
                    <strong>{textFor(t, 'Prompt', '提示词')}</strong>
                    <span>{selectedGeneration.promptPreview ?? textFor(t, 'Preview unavailable', '无预览')} · {selectedGeneration.promptHash}</span>
                  </div>
                  <div>
                    <strong>{textFor(t, 'Provider job', '提供方任务')}</strong>
                    <span>{selectedGeneration.providerRequestId ?? '-'} / {selectedGeneration.providerJobId ?? '-'}</span>
                  </div>
                  <div>
                    <strong>{textFor(t, 'Attempt', '尝试次数')}</strong>
                    <span>#{selectedGeneration.attemptNumber}{selectedGeneration.retryOfId ? ` · ${textFor(t, 'retry of', '重试来源')} ${selectedGeneration.retryOfId}` : ''}</span>
                  </div>
                  <div>
                    <strong>{textFor(t, 'Provider replay', 'Provider replay')}</strong>
                    <span>{providerReplayEvidenceSummary(selectedGeneration, t)}</span>
                  </div>
                  <div>
                    <strong>{textFor(t, 'Latest operation', '最新操作')}</strong>
                    <span>
                      {selectedGeneration.mutationEvidence?.latest
                        ? `${selectedGeneration.mutationEvidence.latest.type ?? '-'} · ${selectedGeneration.mutationEvidence.latest.status ?? '-'} · ${selectedGeneration.mutationEvidence.latest.reasonCode ?? '-'}`
                        : textFor(t, 'No generation operations', '暂无生成操作')}
                    </span>
                  </div>
                  <div>
                    <strong>{textFor(t, 'Output ingestion', '输出摄取')}</strong>
                    <span>
                      {selectedGeneration.outputIngestionEvidence?.available
                        ? `${selectedGeneration.outputIngestionEvidence.completedCount}/${selectedGeneration.outputIngestionEvidence.count} ${textFor(t, 'completed', '已完成')}${selectedGeneration.outputIngestionEvidence.failedCount ? ` · ${selectedGeneration.outputIngestionEvidence.failedCount} ${textFor(t, 'failed', '失败')}` : ''}`
                        : textFor(t, 'Ingestion ledger unavailable', '摄取账本不可用')}
                    </span>
                  </div>
                  {selectedGeneration.outputIngestionEvidence?.latest && (
                    <div>
                      <strong>{textFor(t, 'Latest ingestion', '最新摄取')}</strong>
                      <span>
                        #{selectedGeneration.outputIngestionEvidence.latest.outputIndex ?? '-'} · {selectedGeneration.outputIngestionEvidence.latest.status ?? '-'}
                        {' · '}{selectedGeneration.outputIngestionEvidence.latest.detectedContentType ?? '-'}
                        {' · '}{selectedGeneration.outputIngestionEvidence.latest.sizeBytes ?? 0} B
                        {selectedGeneration.outputIngestionEvidence.latest.sha256Present
                          ? ` · SHA-256 ${selectedGeneration.outputIngestionEvidence.latest.sha256Preview ?? textFor(t, 'present', '存在')}`
                          : ''}
                        {selectedGeneration.outputIngestionEvidence.latest.errorCode
                          ? ` · ${selectedGeneration.outputIngestionEvidence.latest.errorCode}`
                          : ''}
                      </span>
                    </div>
                  )}
                  <div>
                    <strong>{textFor(t, 'Provider cost', 'Provider cost')}</strong>
                    <span>{formatProviderCostSummary(selectedGeneration)}</span>
                  </div>
                  <div>
                    <strong>{textFor(t, 'Provider budget', 'Provider budget')}</strong>
                    <span>{formatProviderBudgetSummary(selectedGeneration)}</span>
                  </div>
                  <div>
                    <strong>{textFor(t, 'Cost ledger', '成本账本')}</strong>
                    <span>
                      {selectedGeneration.providerCostLedgerEvidence?.status
                        ? [
                            selectedGeneration.providerCostLedgerEvidence.status,
                            `${textFor(t, 'estimate', '预估')} ${formatProviderCostAmount(selectedGeneration.providerCostLedgerEvidence.estimateAmount, selectedGeneration.providerCostLedgerEvidence.currency)}`,
                            `${textFor(t, 'actual', '实际')} ${formatProviderCostAmount(selectedGeneration.providerCostLedgerEvidence.actualAmount, selectedGeneration.providerCostLedgerEvidence.currency)}`,
                            `${textFor(t, 'reserved', '预留')} ${formatProviderCostAmount(selectedGeneration.providerCostLedgerEvidence.budget?.reservedAmount, selectedGeneration.providerCostLedgerEvidence.currency)}`,
                            `${textFor(t, 'spent', '已用')} ${formatProviderCostAmount(selectedGeneration.providerCostLedgerEvidence.budget?.spentAmount, selectedGeneration.providerCostLedgerEvidence.currency)}`,
                            selectedGeneration.providerCostLedgerEvidence.reasonCode ?? null,
                          ].filter(Boolean).join(' · ')
                        : textFor(t, 'Cost ledger unavailable', '成本账本不可用')}
                    </span>
                  </div>
                  {selectedGeneration.providerReplayEvidence?.latest && (
                    <div>
                      <strong>{textFor(t, 'Latest replay', '最新 replay')}</strong>
                      <span>
                        {textFor(t, 'previous', '之前')} {selectedGeneration.providerReplayEvidence.latest.previousStatus ?? '-'}
                        {' -> '}
                        {selectedGeneration.providerReplayEvidence.latest.normalizedStatus ?? '-'}
                        {' · '}
                        {textFor(t, 'reason', '原因')} {selectedGeneration.providerReplayEvidence.latest.reasonCode ?? '-'}
                        {' · '}
                        {textFor(t, 'ops', '操作')} {selectedGeneration.providerReplayEvidence.latest.completedOperationCount}
                        {selectedGeneration.providerReplayEvidence.latest.failedOperationType
                          ? ` · ${textFor(t, 'failed', '失败')} ${selectedGeneration.providerReplayEvidence.latest.failedOperationType}`
                          : ''}
                        {selectedGeneration.providerReplayEvidence.latest.errorPreviewPresent
                          ? ` · ${textFor(t, 'error preview present', '存在错误预览')}`
                          : ''}
                      </span>
                    </div>
                  )}
                  <div>
                    <strong>{textFor(t, 'Timeline', '时间线')}</strong>
                    <span>
                      {textFor(t, 'started', '开始')} {selectedGeneration.startedAt ? formatAuditTime(selectedGeneration.startedAt) : '-'}
                      {' · '}
                      {textFor(t, 'completed', '完成')} {selectedGeneration.completedAt ? formatAuditTime(selectedGeneration.completedAt) : '-'}
                      {' · '}
                      {textFor(t, 'failed', '失败')} {selectedGeneration.failedAt ? formatAuditTime(selectedGeneration.failedAt) : '-'}
                    </span>
                  </div>
                  <div>
                    <strong>{textFor(t, 'Error', '错误')}</strong>
                    <span>{selectedGeneration.errorCode ?? '-'} {selectedGeneration.errorMessagePreview ?? ''}</span>
                  </div>
                  <div>
                    <strong>{textFor(t, 'Quota', '额度')}</strong>
                    <span>{formatMetadataJson(selectedGeneration.quota ?? {})}</span>
                  </div>
                  <div>
                    <strong>{textFor(t, 'Credit', 'Credit')}</strong>
                    <span>{formatMetadataJson(selectedGeneration.credit ?? {})}</span>
                  </div>
                  <div>
                    <strong>{textFor(t, 'Safety', '安全')}</strong>
                    <span>{formatMetadataJson(selectedGeneration.safety ?? {})}</span>
                  </div>
                  <div>
                    <strong>{textFor(t, 'Policy', '策略')}</strong>
                    <span>{formatMetadataJson(selectedGeneration.policy ?? {})}</span>
                  </div>
                </div>
                <div className="permission-chip-grid">
                  {selectedGeneration.inputAssetIds.map((assetId) => (
                    <span className="permission-chip" key={`input-${assetId}`}>{textFor(t, 'input', '输入')}:{assetId}</span>
                  ))}
                  {selectedGeneration.outputAssetIds.map((assetId) => (
                    <button className="permission-chip editable" type="button" key={`output-${assetId}`} onClick={() => focusGenerationMediaAsset(assetId)} disabled={!canReadQueues}>
                      {textFor(t, 'output', '输出')}:{assetId}
                    </button>
                  ))}
                  {selectedGeneration.parameterKeys.map((key) => (
                    <span className="permission-chip granted" key={`parameter-${key}`}>{textFor(t, 'parameter', '参数')}:{key}</span>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </section>
      <section className="panel">
        <SectionHeader eyebrow={textFor(t, 'Queue', '队列')} title={textFor(t, 'Review and moderation', '审核与治理')} />
        <div className="permission-summary">
          <button
            className={reviewQueueFilter === null ? 'chip active' : 'chip'}
            type="button"
            onClick={() => setReviewQueueFilter(null)}
          >
            {textFor(t, 'All queues', '全部队列')}
          </button>
          <button
            className={reviewQueueFilter === 'points' ? 'chip active' : 'chip'}
            type="button"
            onClick={() => setReviewQueueFilter('points')}
          >
            {textFor(t, `Point approvals ${pointReviewCount}`, `积分审批 ${pointReviewCount}`)}
          </button>
        </div>
        <div className="admin-table">
          {queueStatus.loading && (
            <div className="empty-state">
              <strong>{textFor(t, 'Loading review queue', '正在加载审核队列')}</strong>
              <span>{textFor(t, 'Reading operations review items from the API.', '正在从 API 读取运营审核事项。')}</span>
            </div>
          )}
          {!queueStatus.loading && queueStatus.error && (
            <div className="empty-state">
              <strong>{textFor(t, 'Queue API unavailable', '队列 API 暂不可用')}</strong>
              <span>{queueStatus.error}</span>
              <button className="ghost-button" type="button" onClick={() => void queueStatus.refresh()}>
                {textFor(t, 'Retry sync', '重试同步')}
              </button>
            </div>
          )}
          {!queueStatus.loading && !queueStatus.error && visibleQueueItems.length === 0 && (
            <div className="empty-state">
              <strong>{textFor(t, 'No review items', '暂无审核事项')}</strong>
              <span>{textFor(t, 'Try another queue filter.', '尝试切换其他队列筛选。')}</span>
            </div>
          )}
          {visibleQueueItems.map((item) => {
            const pointMetadata = isPointAdjustmentMetadata(item.metadata) ? item.metadata : null
            return (
              <div className={highlightedReviewId === item.id ? 'admin-row review-row deep-linked' : 'admin-row review-row'} key={item.id}>
                <StatusBadge status={item.status} t={t} />
                <strong>{item.title}</strong>
                <span>@{item.owner}</span>
                <small>
                  {item.decision
                    ? textFor(t, `Reviewed by @${item.reviewedBy ?? 'system'}`, `已由 @${item.reviewedBy ?? 'system'} 处理`)
                    : item.note}
                </small>
                {pointMetadata && (
                  <div className="review-detail">
                    <span>{textFor(t, 'Requester', '申请人')}: @{pointMetadata.requestedBy ?? '-'}</span>
                    <span>{textFor(t, 'Reason', '原因')}: {pointMetadata.reasonCode ?? textFor(t, 'Uncategorized', '未分类')}</span>
                    <span>{textFor(t, 'Impact', '影响')}: {`${pointText(String(pointMetadata.balanceBefore ?? 0))} -> ${pointText(String(pointMetadata.projectedBalance ?? 0))}`}</span>
                    <span>{textFor(t, 'Limit', '额度')}: {pointText(String(pointMetadata.threshold ?? 0))}</span>
                  </div>
                )}
                <label className="review-note">
                  <span>{textFor(t, 'Review note', '审核备注')}</span>
                  <textarea
                    value={reviewNotes[item.id] ?? ''}
                    onChange={(event) => setReviewNotes((current) => ({ ...current, [item.id]: event.target.value }))}
                    disabled={Boolean(item.decision || reviewingQueueItems[item.id])}
                  />
                </label>
                {pointMetadata && pointPolicy?.approvalTemplates?.length ? (
                  <div className="button-row compact-buttons">
                    {pointPolicy.approvalTemplates.slice(0, 3).map((template) => (
                      <button
                        className="ghost-button small"
                        type="button"
                        key={template}
                        onClick={() => applyApprovalTemplate(item.id, template)}
                        disabled={Boolean(item.decision || reviewingQueueItems[item.id])}
                      >
                        {template}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="button-row">
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => void reviewQueueItem(item, 'reject')}
                    disabled={Boolean(item.decision || reviewingQueueItems[item.id])}
                  >
                    {reviewingQueueItems[item.id] === 'reject' ? textFor(t, 'Rejecting', '正在驳回') : textFor(t, 'Reject', '驳回')}
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => void reviewQueueItem(item, 'approve')}
                    disabled={Boolean(item.decision || reviewingQueueItems[item.id])}
                  >
                    {reviewingQueueItems[item.id] === 'approve' ? textFor(t, 'Approving', '正在通过') : textFor(t, 'Approve', '通过')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </section>
      <section className="panel">
        <SectionHeader
          eyebrow={textFor(t, 'Security', '安全')}
          title={textFor(t, 'Security event stream', '安全事件流')}
          action={
            <button className="ghost-button" type="button" onClick={() => void refreshSecurityPanel()} disabled={!canReadAudit || securityStatus.loading || securityAlertStatus.loading || operationsMetricsStatus.loading}>
              <ShieldAlert size={17} />
              {securityStatus.loading || securityAlertStatus.loading || operationsMetricsStatus.loading ? textFor(t, 'Loading', '加载中') : textFor(t, 'Refresh', '刷新')}
            </button>
          }
        />
        <div className="operations-overview" data-testid="admin-operations-metrics">
          <div className="operations-overview-toolbar">
            <div>
              <span className="eyebrow">{textFor(t, 'Operations metrics', '运营指标')}</span>
              <strong>{textFor(t, 'Security and media health', '安全与媒体健康')}</strong>
            </div>
            <div className="operations-toolbar-actions">
              <div className="segmented-control" aria-label={textFor(t, 'Metrics window', '指标窗口')}>
                {operationsMetricWindows.map((minutes) => (
                  <button
                    className={operationsMetricsWindow === minutes ? 'active' : ''}
                    type="button"
                    key={minutes}
                    onClick={() => setOperationsMetricsWindow(minutes)}
                    disabled={!canReadAudit || operationsMetricsStatus.loading}
                  >
                    {minutes < 60 ? `${minutes}m` : minutes === 1440 ? '24h' : `${minutes / 60}h`}
                  </button>
                ))}
              </div>
              <button className="ghost-button small" type="button" onClick={() => void exportOperationsSnapshot()} disabled={!canReadAudit || !operationsMetrics || exportingOperationsSnapshot}>
                <Download size={15} />
                {exportingOperationsSnapshot ? textFor(t, 'Exporting', '导出中') : textFor(t, 'Export snapshot', '导出快照')}
              </button>
            </div>
          </div>
          {operationsMetricsStatus.loading && (
            <div className="empty-state compact">
              <strong>{textFor(t, 'Loading operations metrics', '正在加载运营指标')}</strong>
              <span>{textFor(t, 'Aggregating security events, alert actions, and scan archive signals.', '正在聚合安全事件、告警处置和扫描归档信号。')}</span>
            </div>
          )}
          {!operationsMetricsStatus.loading && operationsMetricsStatus.error && (
            <div className="empty-state compact">
              <strong>{textFor(t, 'Operations metrics unavailable', '运营指标不可用')}</strong>
              <span>{operationsMetricsStatus.error}</span>
              <button className="ghost-button" type="button" onClick={() => void operationsMetricsStatus.refresh()}>
                {textFor(t, 'Retry sync', '重试同步')}
              </button>
            </div>
          )}
          {!operationsMetricsStatus.loading && !operationsMetricsStatus.error && operationsMetrics && (
            <>
              {buildOperationsHandoff(operationsMetrics).remediationHints.length > 0 && (
                <div className="operations-handoff-panel">
                  <div>
                    <strong>{textFor(t, 'Handoff notes', '交接提示')}</strong>
                    <span>{buildOperationsHandoff(operationsMetrics).summary}</span>
                  </div>
                  <div className="operations-handoff-list">
                    {buildOperationsHandoff(operationsMetrics).remediationHints.slice(0, 3).map((hint) => (
                      <span className={`operations-handoff-item ${hint.severity}`} key={hint.id}>
                        <b>{hint.title}</b>
                        {hint.recommendedActions[0]}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="operations-metrics-grid">
                <article className="operations-metric-card">
                  <Activity size={18} />
                  <span>{textFor(t, 'Security events', '安全事件')}</span>
                  <strong>{formatMetricNumber(operationsMetrics.security.eventsTotal)}</strong>
                  <small>{metricCountSummary(operationsMetrics.security.eventsBySource)}</small>
                </article>
                <article className="operations-metric-card">
                  <ShieldAlert size={18} />
                  <span>{textFor(t, 'Active alerts', '当前告警')}</span>
                  <strong>{formatMetricNumber(operationsMetrics.security.alerts.total)}</strong>
                  <small>{metricCountSummary(operationsMetrics.security.alerts.byState)}</small>
                </article>
                <article className="operations-metric-card">
                  <BarChart3 size={18} />
                  <span>{textFor(t, 'Disposition latency', '处置延迟')}</span>
                  <strong>{formatMetricLatency(operationsMetrics.security.dispositions.acknowledgementLatency.averageMs)}</strong>
                  <small>{`${operationsMetrics.security.dispositions.acknowledged} ${textFor(t, 'acknowledged', '已确认')} · ${operationsMetrics.security.dispositions.silenced} ${textFor(t, 'silenced', '已静默')}`}</small>
                </article>
                <article className="operations-metric-card">
                  <Archive size={18} />
                  <span>{textFor(t, 'Archive candidates', '归档候选')}</span>
                  <strong>{formatMetricNumber(operationsMetrics.mediaScan.archiveCandidates.total)}</strong>
                  <small>{`${formatMetricNumber(operationsMetrics.mediaScan.archiveWrites.total)} ${textFor(t, 'writes', '写入')} · ${formatMetricBytes(operationsMetrics.mediaScan.archiveWrites.bytes)}`}</small>
                  <div className="operations-card-actions">
                    <button className="ghost-button small" type="button" onClick={focusMediaGovernanceFromMetrics} disabled={!canReadQueues}>
                      <Activity size={15} />
                      {textFor(t, 'Media queue', '媒体队列')}
                    </button>
                    <button className="ghost-button small" type="button" onClick={() => void writeScanArchiveFromMetrics()} disabled={!canReviewQueues || writingScanArchive}>
                      <Archive size={15} />
                      {writingScanArchive ? textFor(t, 'Writing', '写入中') : textFor(t, 'Write archive', '写入归档')}
                    </button>
                    <button className="ghost-button small" type="button" onClick={() => void toggleOperationSamples('archiveWrites')} disabled={!canReadAudit || loadingOperationsSamples}>
                      <Clipboard size={15} />
                      {textFor(t, 'Archive records', '归档记录')}
                    </button>
                  </div>
                </article>
                <article className="operations-metric-card">
                  <Bell size={18} />
                  <span>{textFor(t, 'Provider budget alerts', 'Provider 预算告警')}</span>
                  <strong>{formatMetricNumber(operationsMetrics.creativeProviderBudget.thresholdAlerts.total)}</strong>
                  <small>{metricCountSummary(operationsMetrics.creativeProviderBudget.thresholdAlerts.byThreshold)}</small>
                  <div className="operations-card-actions">
                    <button
                      className="ghost-button small"
                      type="button"
                      onClick={() => focusAuditFilter('creative.provider_budget.threshold_crossed', 'creative_provider_budget', {
                        en: 'Filtered audit log to provider budget threshold events.',
                        zh: '已筛选 Provider 预算阈值审计事件。',
                      })}
                      disabled={!canReadAudit}
                    >
                      <Clipboard size={15} />
                      {textFor(t, 'Audit thresholds', '阈值审计')}
                    </button>
                    <button className="ghost-button small" type="button" onClick={() => void toggleOperationSamples('creativeProviderBudgetThresholds')} disabled={!canReadAudit || loadingOperationsSamples}>
                      <Bell size={15} />
                      {textFor(t, 'Recent alerts', '近期告警')}
                    </button>
                  </div>
                </article>
                <article className="operations-metric-card">
                  <BarChart3 size={18} />
                  <span>{textFor(t, 'Provider spend signals', 'Provider 成本信号')}</span>
                  <strong>{formatMetricAmount(operationsMetrics.creativeProviderBudget.spend.projectedSpendAmount)}</strong>
                  <small>{`${textFor(t, 'estimated', '预估')} ${formatMetricAmount(operationsMetrics.creativeProviderBudget.spend.estimatedAmount)} · ${textFor(t, 'actual', '实际')} ${formatMetricAmount(operationsMetrics.creativeProviderBudget.spend.actualAmount)}`}</small>
                </article>
                <article className="operations-metric-card">
                  <ShieldAlert size={18} />
                  <span>{textFor(t, 'Provider control plane', 'Provider 控制面')}</span>
                  <strong>{formatMetricNumber(operationsMetrics.creativeProviderControl.dispatchBlocked)}</strong>
                  <small>{`${formatMetricNumber(operationsMetrics.creativeProviderControl.circuitOpened)} ${textFor(t, 'circuits opened', '次熔断')} · ${formatMetricNumber(operationsMetrics.creativeProviderControl.capEvidenceExpired)} ${textFor(t, 'cap records expired', '条额度证据过期')}`}</small>
                </article>
              </div>
              <div className="operations-breakdown-grid">
                <div>
                  <strong>{textFor(t, 'Security delivery failures', '安全告警投递失败')}</strong>
                  <span>{`${formatMetricNumber(operationsMetrics.security.deliveryFailures.total)} · ${metricCountSummary(operationsMetrics.security.deliveryFailures.byChannel)}`}</span>
                  <button
                    className="ghost-button small"
                    type="button"
                    onClick={() => focusAuditFilter('security.alert.dispatch', 'security_alert', {
                      en: 'Filtered audit log to security alert dispatches.',
                      zh: '已筛选安全告警派发审计事件。',
                    })}
                    disabled={!canReadAudit}
                  >
                    <Clipboard size={15} />
                    {textFor(t, 'Audit dispatches', '派发审计')}
                  </button>
                  <button className="ghost-button small" type="button" onClick={() => void toggleOperationSamples('securityDispatchFailures')} disabled={!canReadAudit || loadingOperationsSamples}>
                    <ShieldAlert size={15} />
                    {textFor(t, 'Recent failures', '近期失败')}
                  </button>
                </div>
                <div>
                  <strong>{textFor(t, 'Media alert delivery failures', '媒体告警投递失败')}</strong>
                  <span>{`${formatMetricNumber(operationsMetrics.mediaScan.alertDeliveryFailures.total)} · ${metricCountSummary(operationsMetrics.mediaScan.alertDeliveryFailures.byChannel)}`}</span>
                  <button
                    className="ghost-button small"
                    type="button"
                    onClick={() => focusAuditFilter('media.scan.alert.dispatch', 'media_scan_alert', {
                      en: 'Filtered audit log to media scan alert dispatches.',
                      zh: '已筛选媒体扫描告警派发审计事件。',
                    })}
                    disabled={!canReadAudit}
                  >
                    <Clipboard size={15} />
                    {textFor(t, 'Audit dispatches', '派发审计')}
                  </button>
                  <button className="ghost-button small" type="button" onClick={() => void toggleOperationSamples('mediaDispatchFailures')} disabled={!canReadAudit || loadingOperationsSamples}>
                    <ShieldAlert size={15} />
                    {textFor(t, 'Recent failures', '近期失败')}
                  </button>
                </div>
                <div>
                  <strong>{textFor(t, 'Provider dispatch blocked', 'Provider 派发阻断')}</strong>
                  <span>{`${formatMetricNumber(operationsMetrics.creativeProviderBudget.dispatchBlocked.total)} · ${metricCountSummary(operationsMetrics.creativeProviderBudget.dispatchBlocked.byReason)}`}</span>
                  <button
                    className="ghost-button small"
                    type="button"
                    onClick={() => focusAuditFilter('creative.provider_budget.dispatch_blocked', 'creative_provider_budget', {
                      en: 'Filtered audit log to provider budget dispatch blocks.',
                      zh: '已筛选 Provider 预算派发阻断审计事件。',
                    })}
                    disabled={!canReadAudit}
                  >
                    <Clipboard size={15} />
                    {textFor(t, 'Block audit', '阻断审计')}
                  </button>
                  <button className="ghost-button small" type="button" onClick={() => void toggleOperationSamples('creativeProviderBudgetDispatchBlocks')} disabled={!canReadAudit || loadingOperationsSamples}>
                    <ShieldAlert size={15} />
                    {textFor(t, 'Recent blocks', '近期阻断')}
                  </button>
                </div>
                <div>
                  <strong>{textFor(t, 'Provider recovery reviews', 'Provider 恢复审批')}</strong>
                  <span>{`${formatMetricNumber(operationsMetrics.creativeProviderControl.recoveryApproved)} ${textFor(t, 'approved', '已批准')} · ${formatMetricNumber(operationsMetrics.creativeProviderControl.recoveryRejected)} ${textFor(t, 'rejected', '已拒绝')} · ${metricCountSummary(operationsMetrics.creativeProviderControl.byStatus)}`}</span>
                  <button
                    className="ghost-button small"
                    type="button"
                    onClick={() => focusAuditFilter('creative.provider_control.recovery_approved', 'admin_review', {
                      en: 'Filtered audit log to provider control recovery approvals.',
                      zh: '已筛选 Provider 控制恢复审批审计事件。',
                    })}
                    disabled={!canReadAudit}
                  >
                    <Clipboard size={15} />
                    {textFor(t, 'Recovery audit', '恢复审计')}
                  </button>
                </div>
                <div>
                  <strong>{textFor(t, 'Provider cost anomalies', 'Provider 成本异常')}</strong>
                  <span>{`${formatMetricNumber(operationsMetrics.creativeProviderBudget.costAnomalies.total)} · ${metricCountSummary(operationsMetrics.creativeProviderBudget.costAnomalies.byReason)}`}</span>
                  <button
                    className="ghost-button small"
                    type="button"
                    onClick={() => focusAuditFilter('creative.provider_cost.anomaly_detected', 'creative_provider_budget', {
                      en: 'Filtered audit log to provider cost anomalies.',
                      zh: '已筛选 Provider 成本异常审计事件。',
                    })}
                    disabled={!canReadAudit}
                  >
                    <Clipboard size={15} />
                    {textFor(t, 'Anomaly audit', '异常审计')}
                  </button>
                  <button className="ghost-button small" type="button" onClick={() => void toggleOperationSamples('creativeProviderCostAnomalies')} disabled={!canReadAudit || loadingOperationsSamples}>
                    <BarChart3 size={15} />
                    {textFor(t, 'Recent anomalies', '近期异常')}
                  </button>
                </div>
                <div>
                  <strong>{textFor(t, 'Provider alert dispatches', 'Provider 告警派发')}</strong>
                  <span>{`${formatMetricNumber(operationsMetrics.creativeProviderBudget.providerAlertDispatches.total)} · ${formatMetricNumber(operationsMetrics.creativeProviderBudget.providerAlertDispatches.failed)} ${textFor(t, 'failed', '失败')} · ${metricCountSummary(operationsMetrics.creativeProviderBudget.providerAlertDispatches.byChannel)} · ${textFor(t, 'dry-run', '演练')} ${formatMetricNumber(operationsMetrics.creativeProviderBudget.providerAlertDispatches.fixtureDryRuns.total)} · ${formatMetricNumber(operationsMetrics.creativeProviderBudget.providerAlertDispatches.fixtureDryRuns.failed)} ${textFor(t, 'failed', '失败')}`}</span>
                  <button
                    className="ghost-button small"
                    type="button"
                    onClick={() => focusAuditFilter('creative.provider_alert.dispatch', 'creative_provider_budget_alert', {
                      en: 'Filtered audit log to provider alert dispatches.',
                      zh: '已筛选 Provider 告警派发审计事件。',
                    })}
                    disabled={!canReadAudit}
                  >
                    <Clipboard size={15} />
                    {textFor(t, 'Dispatch audit', '派发审计')}
                  </button>
                  <button className="ghost-button small" type="button" onClick={() => void toggleOperationSamples('creativeProviderAlertDispatches')} disabled={!canReadAudit || loadingOperationsSamples}>
                    <Bell size={15} />
                    {textFor(t, 'Recent dispatches', '近期派发')}
                  </button>
                </div>
                <div>
                  <strong>{textFor(t, 'Scan history pruned', '扫描历史清理')}</strong>
                  <span>{`${formatMetricNumber(operationsMetrics.mediaScan.historyPruned.jobs)} ${textFor(t, 'jobs', '任务')} · ${operationsMetrics.mediaScan.historyPruned.latestAt ? formatAuditTime(operationsMetrics.mediaScan.historyPruned.latestAt) : '-'}`}</span>
                  <button
                    className="ghost-button small"
                    type="button"
                    onClick={() => focusAuditFilter('media.scan.history_pruned', 'media_scan_jobs', {
                      en: 'Filtered audit log to scan history pruning.',
                      zh: '已筛选扫描历史清理审计事件。',
                    })}
                    disabled={!canReadAudit}
                  >
                    <Clipboard size={15} />
                    {textFor(t, 'Prune audit', '清理审计')}
                  </button>
                  <button className="ghost-button small" type="button" onClick={() => void toggleOperationSamples('historyPruned')} disabled={!canReadAudit || loadingOperationsSamples}>
                    <Archive size={15} />
                    {textFor(t, 'Recent prunes', '近期清理')}
                  </button>
                </div>
              </div>
              {operationsSampleKey && (
                <div className="operations-sample-panel">
                  <div className="operations-sample-header">
                    <strong>{operationSampleConfig(operationsSampleKey).title}</strong>
                    <button className="ghost-button small" type="button" onClick={() => {
                      setOperationsSampleKey(null)
                      setOperationsSamples([])
                      setOperationsSamplesError(null)
                    }}>
                      {textFor(t, 'Close', '关闭')}
                    </button>
                  </div>
                  {loadingOperationsSamples && (
                    <small>{textFor(t, 'Loading metric samples.', '正在加载指标样本。')}</small>
                  )}
                  {operationsSamplesError && (
                    <small>{operationsSamplesError}</small>
                  )}
                  {!loadingOperationsSamples && !operationsSamplesError && operationsSamples.length === 0 && (
                    <small>{textFor(t, 'No matching recent samples.', '暂无匹配的近期样本。')}</small>
                  )}
                  {!loadingOperationsSamples && !operationsSamplesError && operationsSamples.map((event) => (
                    <div className="operations-sample-row" key={event.id}>
                      <div>
                        <strong>{event.action}</strong>
                        <span>{event.resourceId ?? event.resourceType} · {formatAuditTime(event.createdAt)}</span>
                      </div>
                      <div className="operations-sample-meta">
                        {operationSampleMetaEntries(event).map(([key, value]) => (
                          <span key={key}>
                            <b>{key}</b>
                            {typeof value === 'object' ? formatMetadataJson(value) : String(value)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div className="admin-table" data-testid="admin-security-alerts">
          {securityAlertStatus.loading && (
            <div className="empty-state">
              <strong>{textFor(t, 'Loading security alerts', '正在加载安全告警')}</strong>
              <span>{textFor(t, 'Checking rate-limit, body-size, and failed-login thresholds.', '正在检查限流、请求体和登录异常阈值。')}</span>
            </div>
          )}
          {!securityAlertStatus.loading && securityAlertStatus.error && (
            <div className="empty-state">
              <strong>{textFor(t, 'Security alerts unavailable', '安全告警不可用')}</strong>
              <span>{securityAlertStatus.error}</span>
              <button className="ghost-button" type="button" onClick={() => void securityAlertStatus.refresh()}>
                {textFor(t, 'Retry sync', '重试同步')}
              </button>
            </div>
          )}
          {!securityAlertStatus.loading && !securityAlertStatus.error && securityAlerts.length === 0 && (
            <div className="empty-state">
              <strong>{textFor(t, 'No active security alerts', '暂无活跃安全告警')}</strong>
              <span>{textFor(t, 'Threshold-crossing security patterns will appear here before the raw event stream.', '超过阈值的安全模式会先出现在这里，再向下查看原始事件。')}</span>
            </div>
          )}
          {!securityAlertStatus.error && securityAlerts.map((alert) => {
            const metadata = asRecord(alert.metadata)
            const recentEventIds = Array.isArray(metadata.recentEventIds) ? metadata.recentEventIds.map(String) : []
            const recentClientKeys = Array.isArray(metadata.recentClientKeys) ? metadata.recentClientKeys.map(String) : []
            const recentPaths = Array.isArray(metadata.recentPaths) ? metadata.recentPaths.map(String) : []
            const recentChannels = Array.isArray(metadata.recentChannels) ? metadata.recentChannels.map(String) : []
            const recentErrors = Array.isArray(metadata.recentErrors) ? metadata.recentErrors.map(String) : []
            const source = typeof metadata.source === 'string' ? metadata.source : null
            const isAlertDispatchSource = source === 'alert_dispatch'
            const isHandling = handlingSecurityAlertId === alert.id
            const state = alert.state ?? 'active'
            const statusCopy = state === 'silenced'
              ? textFor(t, 'silenced', '已静默')
              : state === 'acknowledged'
                ? textFor(t, 'acknowledged', '已确认')
                : textFor(t, 'active', '活跃')
            return (
              <div className={highlightedSecurityAlertId === alert.id ? 'admin-row deep-linked' : 'admin-row'} key={alert.id}>
                <StatusBadge status={state === 'active' ? alert.severity : state} t={t} />
                <strong>{alert.title}</strong>
                <span>{`${statusCopy} · ${alert.count}/${alert.threshold} · ${alert.windowMinutes}m`}</span>
                <small>
                  {alert.summary}
                  {alert.acknowledgedBy ? ` · ${textFor(t, 'ack', '确认')} @${alert.acknowledgedBy}` : ''}
                  {alert.silencedUntil ? ` · ${textFor(t, 'silent until', '静默至')} ${alert.silencedUntil.slice(0, 16)}` : ''}
                </small>
                <div className="audit-metadata-grid">
                  <div>
                    <strong>{textFor(t, 'Source', '来源')}</strong>
                    <span>{source ?? alert.resourceType}</span>
                  </div>
                  <div>
                    <strong>{isAlertDispatchSource ? textFor(t, 'Channels', '渠道') : textFor(t, 'Clients', '客户端')}</strong>
                    <span>{isAlertDispatchSource ? recentChannels.join(', ') || '-' : recentClientKeys.join(', ') || '-'}</span>
                  </div>
                  <div>
                    <strong>{isAlertDispatchSource ? textFor(t, 'Errors', '错误') : textFor(t, 'Paths', '路径')}</strong>
                    <span>{isAlertDispatchSource ? recentErrors.join(', ') || '-' : recentPaths.join(', ') || '-'}</span>
                  </div>
                  <div>
                    <strong>{textFor(t, 'Events', '事件')}</strong>
                    <span>{recentEventIds.length ? recentEventIds.slice(0, 3).join(', ') : '-'}</span>
                  </div>
                </div>
                {source && (
                  <div className="button-row">
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => void toggleSecurityAlertEvents(alert)}
                      disabled={!canReadAudit || loadingSecurityAlertEvents}
                    >
                      {selectedSecurityAlertId === alert.id ? textFor(t, 'Hide events', '收起样本') : textFor(t, 'Events', '样本')}
                    </button>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => void acknowledgeSecurityAlert(alert)}
                      disabled={!canManageSecurityAlerts || isHandling}
                    >
                      {isHandling ? textFor(t, 'Saving', '保存中') : textFor(t, 'Acknowledge', '确认')}
                    </button>
                    {state === 'silenced' ? (
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => void unsilenceSecurityAlert(alert)}
                        disabled={!canManageSecurityAlerts || isHandling}
                      >
                        {isHandling ? textFor(t, 'Saving', '保存中') : textFor(t, 'Unsilence', '解除静默')}
                      </button>
                    ) : (
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => void silenceSecurityAlert(alert)}
                        disabled={!canManageSecurityAlerts || isHandling}
                      >
                        {isHandling ? textFor(t, 'Saving', '保存中') : textFor(t, 'Silence 24h', '静默24小时')}
                      </button>
                    )}
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => void exportSecurityAlert(alert)}
                      disabled={!canReadAudit || exportingSecurityAlertId === alert.id}
                    >
                      <Download size={17} />
                      {exportingSecurityAlertId === alert.id ? textFor(t, 'Exporting', '导出中') : textFor(t, 'Export JSON', '导出 JSON')}
                    </button>
                    {!isAlertDispatchSource && (
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => {
                          setSecuritySourceFilter(source)
                          setSecuritySeverityFilter('')
                          setSecurityTypeFilter('')
                          setSecurityNextCursor(null)
                          simulateAction(isZh ? '已按告警来源筛选安全事件。' : 'Filtered security events by alert source.')
                        }}
                      >
                        {textFor(t, 'View source events', '查看来源事件')}
                      </button>
                    )}
                  </div>
                )}
                {selectedSecurityAlertId === alert.id && (
                  <div className="admin-inline-list">
                    {loadingSecurityAlertEvents && (
                      <small>{textFor(t, 'Loading alert events.', '正在加载告警样本。')}</small>
                    )}
                    {securityAlertEventsError && (
                      <small>{securityAlertEventsError}</small>
                    )}
                    {!loadingSecurityAlertEvents && !securityAlertEventsError && securityAlertEvents.length === 0 && (
                      <small>{textFor(t, 'No recent samples for this alert.', '暂无该告警的近期样本。')}</small>
                    )}
                    {!loadingSecurityAlertEvents && !securityAlertEventsError && securityAlertEvents.map((event) => (
                      <small key={event.id}>
                        {event.type} · {event.source} · {event.clientKey ?? textFor(t, 'Unknown client', '未知来源')} · {event.pathname ?? '-'} · {formatAuditTime(event.occurredAt)}
                      </small>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className="permission-summary">
          <label>
            <span>{textFor(t, 'Source', '来源')}</span>
            <select
              aria-label={textFor(t, 'Security event source', '安全事件来源')}
              value={securitySourceFilter ?? ''}
              onChange={(event) => {
                setSecurityNextCursor(null)
                setSecuritySourceFilter(event.target.value || null)
              }}
              disabled={!canReadAudit}
            >
              <option value="">{textFor(t, 'All sources', '全部来源')}</option>
              {securityEventSources.map((source) => (
                <option value={source} key={source}>{source}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{textFor(t, 'Severity', '级别')}</span>
            <select
              aria-label={textFor(t, 'Security event severity', '安全事件级别')}
              value={securitySeverityFilter}
              onChange={(event) => {
                setSecurityNextCursor(null)
                setSecuritySeverityFilter(event.target.value)
              }}
              disabled={!canReadAudit}
            >
              <option value="">{textFor(t, 'All severities', '全部级别')}</option>
              {securityEventSeverities.map((severity) => (
                <option value={severity} key={severity}>{severity}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{textFor(t, 'Type', '类型')}</span>
            <input
              aria-label={textFor(t, 'Security event type', '安全事件类型')}
              value={securityTypeFilter}
              onChange={(event) => {
                setSecurityNextCursor(null)
                setSecurityTypeFilter(event.target.value)
              }}
              placeholder="auth.failed_login.ip_accounts"
              disabled={!canReadAudit}
            />
          </label>
          <button className="ghost-button" type="button" onClick={clearSecurityFilters} disabled={!canReadAudit || (!securitySourceFilter && !securitySeverityFilter && !securityTypeFilter)}>
            {textFor(t, 'Clear filters', '清除筛选')}
          </button>
        </div>
        <div className="admin-table" data-testid="admin-security-events">
          {securityStatus.loading && (
            <div className="empty-state">
              <strong>{textFor(t, 'Loading security events', '正在加载安全事件')}</strong>
              <span>{textFor(t, 'Reading rate-limit, body-size, and auth anomaly events.', '正在读取限流、请求体和登录异常事件。')}</span>
            </div>
          )}
          {!securityStatus.loading && securityStatus.error && (
            <div className="empty-state">
              <strong>{textFor(t, 'Security events unavailable', '安全事件不可用')}</strong>
              <span>{securityStatus.error}</span>
              <button className="ghost-button" type="button" onClick={() => void securityStatus.refresh()}>
                {textFor(t, 'Retry sync', '重试同步')}
              </button>
            </div>
          )}
          {!securityStatus.loading && !securityStatus.error && securityEvents.length === 0 && (
            <div className="empty-state">
              <strong>{textFor(t, 'No security events yet', '暂无安全事件')}</strong>
              <span>{textFor(t, 'Rate limits, body-size rejections, and failed-login anomalies will appear here.', '限流、请求体拒绝和登录异常会出现在这里。')}</span>
            </div>
          )}
          {!securityStatus.error && securityEvents.map((event) => {
            const details = asRecord(event.details)
            const detailEntries = Object.entries(details).filter(([key]) => !['method', 'pathname', 'clientKey', 'identity', 'occurredAt'].includes(key))
            return (
              <div className="admin-row" key={event.id}>
                <StatusBadge status={event.severity} t={t} />
                <strong>{event.type}</strong>
                <span>{event.clientKey ? event.clientKey : textFor(t, 'Unknown client', '未知来源')}</span>
                <small>
                  {event.source} · {event.method ?? '-'} {event.pathname ?? '-'} · {event.identity ? `${event.identity} · ` : ''}{formatAuditTime(event.occurredAt)}
                </small>
                {detailEntries.length > 0 && (
                  <div className="audit-metadata-grid">
                    {detailEntries.slice(0, 8).map(([key, value]) => (
                      <div key={key}>
                        <strong>{key}</strong>
                        <span>{typeof value === 'object' ? formatMetadataJson(value) : String(value ?? 'null')}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        {securityNextCursor && !securityStatus.error && (
          <div className="button-row">
            <button className="ghost-button" type="button" onClick={() => void loadMoreSecurityEvents()} disabled={loadingMoreSecurityEvents || !canReadAudit}>
              {loadingMoreSecurityEvents ? textFor(t, 'Loading', '加载中') : textFor(t, 'Load more', '加载更多')}
            </button>
          </div>
        )}
      </section>
      <section className="panel">
        <SectionHeader
          eyebrow={textFor(t, 'Audit', '审计')}
          title={textFor(t, 'Recent privileged actions', '近期高权限操作')}
          action={
            <button className="ghost-button" type="button" onClick={() => void auditStatus.refresh()} disabled={!canReadAudit || auditStatus.loading}>
              {auditStatus.loading ? textFor(t, 'Loading', '加载中') : textFor(t, 'Refresh', '刷新')}
            </button>
          }
        />
        <div className="permission-summary">
          <label>
            <span>{textFor(t, 'Action', '动作')}</span>
            <select
              aria-label={textFor(t, 'Audit action filter', '审计动作筛选')}
              value={auditActionFilter}
              onChange={(event) => {
                setHighlightedAuditEventId(null)
                setAuditActionFilter(event.target.value)
              }}
              disabled={!canReadAudit}
            >
              <option value="">{textFor(t, 'All actions', '全部动作')}</option>
              <option value="media.governance_policy.updated">media.governance_policy.updated</option>
              <option value="media.governance_policy.rolled_back">media.governance_policy.rolled_back</option>
              <option value="points.policy.updated">points.policy.updated</option>
              <option value="points.policy.rolled_back">points.policy.rolled_back</option>
              <option value="media.scan.timeout">media.scan.timeout</option>
              <option value="media.scan.callback_denied">media.scan.callback_denied</option>
            </select>
          </label>
          <label>
            <span>{textFor(t, 'Resource type', '资源类型')}</span>
            <select
              aria-label={textFor(t, 'Audit resource type filter', '审计资源类型筛选')}
              value={auditResourceTypeFilter}
              onChange={(event) => {
                setHighlightedAuditEventId(null)
                setAuditResourceTypeFilter(event.target.value)
              }}
              disabled={!canReadAudit}
            >
              <option value="">{textFor(t, 'All resources', '全部资源')}</option>
              <option value="media_governance_policy">media_governance_policy</option>
              <option value="point_adjustment_policy">point_adjustment_policy</option>
              <option value="media_asset">media_asset</option>
              <option value="media_scan_alert">media_scan_alert</option>
              <option value="operations_metrics">operations_metrics</option>
              <option value="admin_review">admin_review</option>
            </select>
          </label>
          <button className="ghost-button" type="button" onClick={focusMediaGovernanceAudit} disabled={!canReadAudit}>
            {textFor(t, 'Media policy audit', '媒体策略审计')}
          </button>
          <button className="ghost-button" type="button" onClick={() => void exportAuditEvents()} disabled={!canReadAudit || exportingAudit}>
            <Download size={17} />
            {exportingAudit ? textFor(t, 'Exporting', '导出中') : textFor(t, 'Export JSON', '导出 JSON')}
          </button>
          <button className="ghost-button" type="button" onClick={clearAuditFilters} disabled={!canReadAudit || (!auditActionFilter && !auditResourceTypeFilter && !highlightedAuditEventId)}>
            {textFor(t, 'Clear filters', '清除筛选')}
          </button>
        </div>
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
            const extraMetadata = metadataEntries(metadata)
            const hasDetails = Object.keys(metadata).length > 0
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
  )
}
