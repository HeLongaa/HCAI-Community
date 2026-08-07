import type { AsyncResourceState } from '../../domain/types'
import { isZhCopy, textFor } from '../../domain/utils'
import type { ApiMediaGovernanceConfig, MediaGovernancePolicyHistoryItem } from '../../services/contracts'
import { SecurityWorkspacePanel } from './SecurityWorkspacePanel'

type MediaPolicyDraftKey =
  | 'retryDelaySeconds'
  | 'timeoutSeconds'
  | 'maxAttempts'
  | 'workerIntervalSeconds'
  | 'historyRetentionDays'
  | 'historyRetentionMaxPerAsset'
  | 'storageCleanupRetentionDays'
  | 'windowMinutes'
  | 'callbackDenied'
  | 'dispatchFailed'
  | 'timeoutThreshold'
  | 'alertDeliveryFailed'
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

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

const diffFields = [
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

const readDiffChange = (diff: unknown, path: readonly string[]) => {
  let current: unknown = diff
  for (const key of path) current = asRecord(current)[key]
  const record = asRecord(current)
  return 'from' in record && 'to' in record ? record : null
}

const formatDiffValue = (value: unknown) => {
  if (value == null || value === '') return 'unset'
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

const governanceDiffRows = (diff: unknown) => diffFields.flatMap((field) => {
  const change = readDiffChange(diff, field.path)
  return change ? [{
    key: field.path.join('.'),
    en: field.en,
    zh: field.zh,
    from: formatDiffValue(change.from),
    to: formatDiffValue(change.to),
  }] : []
})

export function SecurityGovernanceWorkspace({
  t,
  canReadQueues,
  canReadAudit,
  canManagePermissions,
  status,
  config,
  draft,
  saving,
  hasInvalidDraft,
  impactPreview,
  confirmingSave,
  highRiskChanges,
  historyStatus,
  history,
  expandedEventIds,
  rollingBackEventId,
  onFocusPolicyAudit,
  onDraftChange,
  onSave,
  onCancelConfirmation,
  onCommit,
  onToggleHistoryEvent,
  onFocusAuditEvent,
  onBeginRollback,
}: {
  t: Record<string, string>
  canReadQueues: boolean
  canReadAudit: boolean
  canManagePermissions: boolean
  status: AsyncResourceState
  config: ApiMediaGovernanceConfig | null
  draft: MediaPolicyDraft
  saving: boolean
  hasInvalidDraft: boolean
  impactPreview: MediaPolicyImpactPreviewItem[]
  confirmingSave: boolean
  highRiskChanges: MediaPolicyRiskItem[]
  historyStatus: AsyncResourceState
  history: MediaGovernancePolicyHistoryItem[]
  expandedEventIds: Record<string, boolean>
  rollingBackEventId: string | null
  onFocusPolicyAudit: () => void
  onDraftChange: (key: MediaPolicyDraftKey, value: string) => void
  onSave: () => void
  onCancelConfirmation: () => void
  onCommit: () => void
  onToggleHistoryEvent: (eventId: string) => void
  onFocusAuditEvent: (eventId: string) => void
  onBeginRollback: (eventId: string) => void
}) {
  const isZh = isZhCopy(t)
  const formatAuditTime = (value: string) => {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString(isZh ? 'zh-CN' : 'en-US')
  }
  const enabledLabel = (value: boolean) => value
    ? textFor(t, 'configured', '已配置')
    : textFor(t, 'not configured', '未配置')

  return (
    <SecurityWorkspacePanel
      t={t}
      workspace="governance"
      action={
        <button className="ghost-button" type="button" onClick={() => void status.refresh()} disabled={!canReadQueues || status.loading}>
          {status.loading ? textFor(t, 'Loading', '加载中') : textFor(t, 'Refresh', '刷新')}
        </button>
      }
    >
      <div className="admin-detail-panel security-governance-workspace" data-testid="security-governance-workspace">
        {status.error && <p>{status.error}</p>}
        {!status.error && config && (
          <>
            <div className="button-row governance-audit-actions">
              <button className="ghost-button small" type="button" onClick={onFocusPolicyAudit} disabled={!canReadAudit}>
                {textFor(t, 'View policy audit', '查看策略审计')}
              </button>
            </div>
            <div className="governance-config-grid">
              <div><strong>{config.storage.driver}</strong><span>{textFor(t, 'Storage driver', '存储驱动')}</span></div>
              <div><strong>{enabledLabel(config.storage.privateDownloadConfigured)}</strong><span>{textFor(t, 'Private CDN', '私有 CDN')} · {config.storage.downloadTtlSeconds}s</span></div>
              <div><strong>{enabledLabel(config.storage.cleanupWorkerEnabled)}</strong><span>{textFor(t, 'Object cleanup', '对象清理')} · {config.storage.cleanupWorkerIntervalSeconds}s · {config.storage.cleanupBatchSize}/{textFor(t, 'run', '次')}</span></div>
              <div><strong>{config.scanner.provider}</strong><span>{textFor(t, 'Scanner provider', '扫描提供方')} · {config.scanner.requestAdapter}</span></div>
              <div><strong>{enabledLabel(config.scanner.requestDispatchConfigured)}</strong><span>{textFor(t, 'Dispatch', '派发')} · {config.scanner.requestTimeoutSeconds}s · {enabledLabel(config.scanner.requestSigningConfigured)}</span></div>
              <div><strong>{enabledLabel(config.scanner.callbackSignatureConfigured)}</strong><span>{textFor(t, 'Callback signature', '回调签名')} · {config.scanner.callbackSignatureToleranceSeconds}s</span></div>
              <div><strong>{config.scanner.timeoutSeconds}s</strong><span>{textFor(t, 'Scan timeout', '扫描超时')} · {textFor(t, 'attempts', '尝试')} {config.scanner.maxAttempts}</span></div>
              <div><strong>{enabledLabel(config.scanner.workerEnabled)}</strong><span>{textFor(t, 'Sweep worker', '巡检 Worker')} · {config.scanner.workerIntervalSeconds}s</span></div>
              <div><strong>{config.retention.historyRetentionDays}d</strong><span>{textFor(t, 'History retention', '历史保留')} · {config.retention.historyRetentionMaxPerAsset}/{textFor(t, 'asset', '资产')}</span></div>
              <div><strong>{config.alerts.windowMinutes}m</strong><span>{textFor(t, 'Alert window', '告警窗口')} · {config.alerts.thresholds.callbackDenied}/{config.alerts.thresholds.dispatchFailed}/{config.alerts.thresholds.timeout}/{config.alerts.thresholds.alertDeliveryFailed}</span></div>
              <div>
                <strong>{[
                  config.alerts.channels.webhook.configured ? 'webhook' : null,
                  config.alerts.channels.slack.configured ? 'slack' : null,
                  config.alerts.channels.email.configured ? 'email' : null,
                ].filter(Boolean).join(', ') || textFor(t, 'none', '无')}</strong>
                <span>{textFor(t, 'External alert channels', '外部告警通道')} · {textFor(t, 'email recipients', '邮件收件人')} {config.alerts.channels.email.recipientCount}</span>
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
                ['storageCleanupRetentionDays', textFor(t, 'Object cleanup retention days', '对象清理保留天数')],
                ['windowMinutes', textFor(t, 'Alert window minutes', '告警窗口分钟')],
                ['callbackDenied', textFor(t, 'Callback denied threshold', '回调拒绝阈值')],
                ['dispatchFailed', textFor(t, 'Dispatch failed threshold', '派发失败阈值')],
                ['timeoutThreshold', textFor(t, 'Timeout threshold', '超时阈值')],
                ['alertDeliveryFailed', textFor(t, 'Alert delivery failed threshold', '告警投递失败阈值')],
              ].map(([key, label]) => (
                <label key={key}>
                  <span>{label}</span>
                  <input min="1" type="number" value={draft[key as MediaPolicyDraftKey]} onChange={(event) => onDraftChange(key as MediaPolicyDraftKey, event.target.value)} disabled={!canManagePermissions || saving} />
                </label>
              ))}
              <button className="primary-button" type="button" onClick={onSave} disabled={!canManagePermissions || saving || hasInvalidDraft}>
                {saving ? textFor(t, 'Saving policy', '保存策略中') : textFor(t, 'Save policy', '保存策略')}
              </button>
            </div>

            <div className="policy-impact-preview">
              <div className="policy-impact-header">
                <strong>{textFor(t, 'Pending runtime impact', '待保存运行影响')}</strong>
                <span>{impactPreview.length === 0
                  ? textFor(t, 'No pending changes', '暂无待保存变更')
                  : textFor(t, `${impactPreview.length} pending item${impactPreview.length === 1 ? '' : 's'}`, `${impactPreview.length} 项待处理`)}</span>
              </div>
              {impactPreview.length === 0 && <span>{textFor(t, 'Current draft matches the active media governance policy.', '当前草稿与生效的媒体治理策略一致。')}</span>}
              {impactPreview.map((item) => (
                <div className={item.status === 'invalid' ? 'policy-impact-row invalid' : 'policy-impact-row'} key={item.key}>
                  <div><strong>{textFor(t, item.en, item.zh)}</strong><span>{item.from} -&gt; {item.to || textFor(t, 'empty', '空值')}</span></div>
                  <span>{textFor(t, item.impactEn, item.impactZh)}</span>
                </div>
              ))}
            </div>

            {confirmingSave && highRiskChanges.length > 0 && (
              <div className="policy-save-confirmation" role="alert">
                <div className="policy-impact-header"><strong>{textFor(t, 'Confirm high-risk changes', '确认高风险变更')}</strong><span>{textFor(t, 'Review these operational impacts before saving.', '保存前请复核这些运营影响。')}</span></div>
                {highRiskChanges.map((item) => (
                  <div className="policy-impact-row warning" key={item.key}>
                    <div><strong>{textFor(t, item.en, item.zh)}</strong><span>{item.from} -&gt; {item.to}</span></div>
                    <span>{textFor(t, item.riskEn, item.riskZh)}</span>
                  </div>
                ))}
                <div className="button-row compact-buttons">
                  <button className="ghost-button small" type="button" onClick={onCancelConfirmation} disabled={saving}>{textFor(t, 'Cancel', '取消')}</button>
                  <button className="primary-button small" type="button" onClick={onCommit} disabled={saving}>{saving ? textFor(t, 'Saving', '保存中') : textFor(t, 'Confirm save', '确认保存')}</button>
                </div>
              </div>
            )}

            <div className="policy-history">
              <div className="policy-history-header">
                <strong>{textFor(t, 'Governance policy history', '治理策略历史')}</strong>
                <button className="ghost-button small" type="button" onClick={() => void historyStatus.refresh()} disabled={!canReadQueues}>{textFor(t, 'Refresh', '刷新')}</button>
              </div>
              {historyStatus.loading && <span>{textFor(t, 'Loading policy history', '正在加载策略历史')}</span>}
              {!historyStatus.loading && historyStatus.error && <span>{historyStatus.error}</span>}
              {!historyStatus.loading && !historyStatus.error && history.length === 0 && <span>{textFor(t, 'No governance policy changes yet', '暂无治理策略变更')}</span>}
              {!historyStatus.loading && !historyStatus.error && history.map((event) => {
                const diffRows = governanceDiffRows(event.diff)
                const expanded = Boolean(expandedEventIds[event.id])
                return (
                  <div className="policy-history-entry" key={event.id}>
                    <div className="policy-history-row">
                      <div><strong>{event.action.replace('media.governance_policy.', '')}</strong><span>{event.summary}</span><small>{event.actorId ?? 'system'} · {formatAuditTime(event.createdAt)}</small></div>
                      <div className="button-row compact-buttons">
                        <button className="ghost-button small" type="button" onClick={() => onToggleHistoryEvent(event.id)} disabled={diffRows.length === 0}>{expanded ? textFor(t, 'Hide diff', '收起差异') : textFor(t, 'View diff', '查看差异')}</button>
                        <button className="ghost-button small" type="button" onClick={() => onFocusAuditEvent(event.id)} disabled={!canReadAudit}>{textFor(t, 'Audit', '审计')}</button>
                        <button className="ghost-button small" type="button" onClick={() => onBeginRollback(event.id)} disabled={!canManagePermissions || !event.previous || rollingBackEventId === event.id}>{rollingBackEventId === event.id ? textFor(t, 'Rolling back', '回滚中') : textFor(t, 'Rollback', '回滚')}</button>
                      </div>
                    </div>
                    {expanded && (
                      <div className="policy-diff-grid">
                        {diffRows.length === 0 && <span>{textFor(t, 'No material field changes', '无实质字段变化')}</span>}
                        {diffRows.map((row) => <div className="policy-diff-row" key={row.key}><strong>{textFor(t, row.en, row.zh)}</strong><span>{row.from}</span><span aria-hidden="true">-&gt;</span><span>{row.to}</span></div>)}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </SecurityWorkspacePanel>
  )
}
