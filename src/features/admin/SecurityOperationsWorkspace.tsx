import { Activity, Archive, BarChart3, Bell, Clipboard, Download, ShieldAlert } from 'lucide-react'

import type { AsyncResourceState, AuditEvent } from '../../domain/types'
import { textFor } from '../../domain/utils'
import type { AdminOperationsMetricsDto } from '../../services/contracts'
import { SecurityWorkspacePanel } from './SecurityWorkspacePanel'

export type OperationsSampleKey =
  | 'securityDispatchFailures'
  | 'mediaDispatchFailures'
  | 'archiveWrites'
  | 'historyPruned'
  | 'creativeProviderBudgetThresholds'
  | 'creativeProviderBudgetDispatchBlocks'
  | 'creativeProviderCostAnomalies'
  | 'creativeProviderAlertDispatches'

type Handoff = {
  summary: string
  remediationHints: Array<{
    id: string
    severity: string
    title: string
    recommendedActions: string[]
  }>
}

type AuditMessage = { en: string; zh: string }

export function SecurityOperationsWorkspace({
  t,
  canReadAudit,
  canReadQueues,
  canReviewQueues,
  status,
  metrics,
  handoff,
  windowMinutes,
  windowOptions,
  exporting,
  writingArchive,
  sampleKey,
  sampleTitle,
  samples,
  samplesLoading,
  samplesError,
  formatNumber,
  formatAmount,
  formatBytes,
  formatLatency,
  formatAuditTime,
  formatCountSummary,
  sampleMetaEntries,
  onRefresh,
  onWindowChange,
  onExport,
  onOpenMediaQueue,
  onWriteArchive,
  onToggleSamples,
  onFocusAudit,
  onCloseSamples,
}: {
  t: Record<string, string>
  canReadAudit: boolean
  canReadQueues: boolean
  canReviewQueues: boolean
  status: AsyncResourceState
  metrics: AdminOperationsMetricsDto | null
  handoff: Handoff | null
  windowMinutes: number
  windowOptions: number[]
  exporting: boolean
  writingArchive: boolean
  sampleKey: OperationsSampleKey | null
  sampleTitle: string
  samples: AuditEvent[]
  samplesLoading: boolean
  samplesError: string | null
  formatNumber: (value: number | null | undefined) => string
  formatAmount: (value: number | null | undefined) => string
  formatBytes: (value: number | null | undefined) => string
  formatLatency: (value: number | null | undefined) => string
  formatAuditTime: (value: string) => string
  formatCountSummary: (items: AdminOperationsMetricsDto['security']['eventsBySource']) => string
  sampleMetaEntries: (event: AuditEvent) => ReadonlyArray<readonly [string, unknown]>
  onRefresh: () => void
  onWindowChange: (minutes: number) => void
  onExport: () => void
  onOpenMediaQueue: () => void
  onWriteArchive: () => void
  onToggleSamples: (key: OperationsSampleKey) => void
  onFocusAudit: (action: string, resourceType: string, message: AuditMessage) => void
  onCloseSamples: () => void
}) {
  return (
    <SecurityWorkspacePanel
      t={t}
      workspace="overview"
      action={
        <button className="ghost-button" type="button" onClick={onRefresh} disabled={!canReadAudit || status.loading}>
          <ShieldAlert size={17} />
          {status.loading ? textFor(t, 'Loading', '加载中') : textFor(t, 'Refresh', '刷新')}
        </button>
      }
    >
      <div className="operations-overview" data-testid="admin-operations-metrics">
        <div className="operations-overview-toolbar">
          <div><span className="eyebrow">{textFor(t, 'Operations metrics', '运营指标')}</span><strong>{textFor(t, 'Security and media health', '安全与媒体健康')}</strong></div>
          <div className="operations-toolbar-actions">
            <div className="segmented-control" aria-label={textFor(t, 'Metrics window', '指标窗口')}>
              {windowOptions.map((minutes) => (
                <button className={windowMinutes === minutes ? 'active' : ''} type="button" key={minutes} onClick={() => onWindowChange(minutes)} disabled={!canReadAudit || status.loading}>
                  {minutes < 60 ? `${minutes}m` : minutes === 1440 ? '24h' : `${minutes / 60}h`}
                </button>
              ))}
            </div>
            <button className="ghost-button small" type="button" onClick={onExport} disabled={!canReadAudit || !metrics || exporting}>
              <Download size={15} />
              {exporting ? textFor(t, 'Exporting', '导出中') : textFor(t, 'Export snapshot', '导出快照')}
            </button>
          </div>
        </div>

        {status.loading && <div className="empty-state compact"><strong>{textFor(t, 'Loading operations metrics', '正在加载运营指标')}</strong><span>{textFor(t, 'Aggregating security events, alert actions, and scan archive signals.', '正在聚合安全事件、告警处置和扫描归档信号。')}</span></div>}
        {!status.loading && status.error && <div className="empty-state compact"><strong>{textFor(t, 'Operations metrics unavailable', '运营指标不可用')}</strong><span>{status.error}</span><button className="ghost-button" type="button" onClick={() => void status.refresh()}>{textFor(t, 'Retry sync', '重试同步')}</button></div>}

        {!status.loading && !status.error && metrics && (
          <>
            {handoff && handoff.remediationHints.length > 0 && (
              <div className="operations-handoff-panel">
                <div><strong>{textFor(t, 'Handoff notes', '交接提示')}</strong><span>{handoff.summary}</span></div>
                <div className="operations-handoff-list">
                  {handoff.remediationHints.slice(0, 3).map((hint) => <span className={`operations-handoff-item ${hint.severity}`} key={hint.id}><b>{hint.title}</b>{hint.recommendedActions[0]}</span>)}
                </div>
              </div>
            )}

            <div className="operations-metrics-grid">
              <article className="operations-metric-card"><Activity size={18} /><span>{textFor(t, 'Security events', '安全事件')}</span><strong>{formatNumber(metrics.security.eventsTotal)}</strong><small>{formatCountSummary(metrics.security.eventsBySource)}</small></article>
              <article className="operations-metric-card"><ShieldAlert size={18} /><span>{textFor(t, 'Active alerts', '当前告警')}</span><strong>{formatNumber(metrics.security.alerts.total)}</strong><small>{formatCountSummary(metrics.security.alerts.byState)}</small></article>
              <article className="operations-metric-card"><BarChart3 size={18} /><span>{textFor(t, 'Disposition latency', '处置延迟')}</span><strong>{formatLatency(metrics.security.dispositions.acknowledgementLatency.averageMs)}</strong><small>{`${metrics.security.dispositions.acknowledged} ${textFor(t, 'acknowledged', '已确认')} · ${metrics.security.dispositions.silenced} ${textFor(t, 'silenced', '已静默')}`}</small></article>
              <article className="operations-metric-card">
                <Archive size={18} /><span>{textFor(t, 'Archive candidates', '归档候选')}</span><strong>{formatNumber(metrics.mediaScan.archiveCandidates.total)}</strong><small>{`${formatNumber(metrics.mediaScan.archiveWrites.total)} ${textFor(t, 'writes', '写入')} · ${formatBytes(metrics.mediaScan.archiveWrites.bytes)}`}</small>
                <div className="operations-card-actions">
                  <button className="ghost-button small" type="button" onClick={onOpenMediaQueue} disabled={!canReadQueues}><Activity size={15} />{textFor(t, 'Media queue', '媒体队列')}</button>
                  <button className="ghost-button small" type="button" onClick={onWriteArchive} disabled={!canReviewQueues || writingArchive}><Archive size={15} />{writingArchive ? textFor(t, 'Writing', '写入中') : textFor(t, 'Write archive', '写入归档')}</button>
                  <button className="ghost-button small" type="button" onClick={() => onToggleSamples('archiveWrites')} disabled={!canReadAudit || samplesLoading}><Clipboard size={15} />{textFor(t, 'Archive records', '归档记录')}</button>
                </div>
              </article>
              <article className="operations-metric-card">
                <Bell size={18} /><span>{textFor(t, 'Provider budget alerts', 'Provider 预算告警')}</span><strong>{formatNumber(metrics.creativeProviderBudget.thresholdAlerts.total)}</strong><small>{formatCountSummary(metrics.creativeProviderBudget.thresholdAlerts.byThreshold)}</small>
                <div className="operations-card-actions">
                  <button className="ghost-button small" type="button" onClick={() => onFocusAudit('creative.provider_budget.threshold_crossed', 'creative_provider_budget', { en: 'Filtered audit log to provider budget threshold events.', zh: '已筛选 Provider 预算阈值审计事件。' })} disabled={!canReadAudit}><Clipboard size={15} />{textFor(t, 'Audit thresholds', '阈值审计')}</button>
                  <button className="ghost-button small" type="button" onClick={() => onToggleSamples('creativeProviderBudgetThresholds')} disabled={!canReadAudit || samplesLoading}><Bell size={15} />{textFor(t, 'Recent alerts', '近期告警')}</button>
                </div>
              </article>
              <article className="operations-metric-card"><BarChart3 size={18} /><span>{textFor(t, 'Provider spend signals', 'Provider 成本信号')}</span><strong>{formatAmount(metrics.creativeProviderBudget.spend.projectedSpendAmount)}</strong><small>{`${textFor(t, 'estimated', '预估')} ${formatAmount(metrics.creativeProviderBudget.spend.estimatedAmount)} · ${textFor(t, 'actual', '实际')} ${formatAmount(metrics.creativeProviderBudget.spend.actualAmount)}`}</small></article>
              <article className="operations-metric-card"><ShieldAlert size={18} /><span>{textFor(t, 'Provider control plane', 'Provider 控制面')}</span><strong>{formatNumber(metrics.creativeProviderControl.dispatchBlocked)}</strong><small>{`${formatNumber(metrics.creativeProviderControl.circuitOpened)} ${textFor(t, 'circuits opened', '次熔断')} · ${formatNumber(metrics.creativeProviderControl.capEvidenceExpired)} ${textFor(t, 'cap records expired', '条额度证据过期')}`}</small></article>
            </div>

            <div className="operations-breakdown-grid">
              <div>
                <strong>{textFor(t, 'Security delivery failures', '安全告警投递失败')}</strong><span>{`${formatNumber(metrics.security.deliveryFailures.total)} · ${formatCountSummary(metrics.security.deliveryFailures.byChannel)}`}</span>
                <button className="ghost-button small" type="button" onClick={() => onFocusAudit('security.alert.dispatch', 'security_alert', { en: 'Filtered audit log to security alert dispatches.', zh: '已筛选安全告警派发审计事件。' })} disabled={!canReadAudit}><Clipboard size={15} />{textFor(t, 'Audit dispatches', '派发审计')}</button>
                <button className="ghost-button small" type="button" onClick={() => onToggleSamples('securityDispatchFailures')} disabled={!canReadAudit || samplesLoading}><ShieldAlert size={15} />{textFor(t, 'Recent failures', '近期失败')}</button>
              </div>
              <div>
                <strong>{textFor(t, 'Media alert delivery failures', '媒体告警投递失败')}</strong><span>{`${formatNumber(metrics.mediaScan.alertDeliveryFailures.total)} · ${formatCountSummary(metrics.mediaScan.alertDeliveryFailures.byChannel)}`}</span>
                <button className="ghost-button small" type="button" onClick={() => onFocusAudit('media.scan.alert.dispatch', 'media_scan_alert', { en: 'Filtered audit log to media scan alert dispatches.', zh: '已筛选媒体扫描告警派发审计事件。' })} disabled={!canReadAudit}><Clipboard size={15} />{textFor(t, 'Audit dispatches', '派发审计')}</button>
                <button className="ghost-button small" type="button" onClick={() => onToggleSamples('mediaDispatchFailures')} disabled={!canReadAudit || samplesLoading}><ShieldAlert size={15} />{textFor(t, 'Recent failures', '近期失败')}</button>
              </div>
              <div>
                <strong>{textFor(t, 'Provider dispatch blocked', 'Provider 派发阻断')}</strong><span>{`${formatNumber(metrics.creativeProviderBudget.dispatchBlocked.total)} · ${formatCountSummary(metrics.creativeProviderBudget.dispatchBlocked.byReason)}`}</span>
                <button className="ghost-button small" type="button" onClick={() => onFocusAudit('creative.provider_budget.dispatch_blocked', 'creative_provider_budget', { en: 'Filtered audit log to provider budget dispatch blocks.', zh: '已筛选 Provider 预算派发阻断审计事件。' })} disabled={!canReadAudit}><Clipboard size={15} />{textFor(t, 'Block audit', '阻断审计')}</button>
                <button className="ghost-button small" type="button" onClick={() => onToggleSamples('creativeProviderBudgetDispatchBlocks')} disabled={!canReadAudit || samplesLoading}><ShieldAlert size={15} />{textFor(t, 'Recent blocks', '近期阻断')}</button>
              </div>
              <div>
                <strong>{textFor(t, 'Provider recovery reviews', 'Provider 恢复审批')}</strong><span>{`${formatNumber(metrics.creativeProviderControl.recoveryApproved)} ${textFor(t, 'approved', '已批准')} · ${formatNumber(metrics.creativeProviderControl.recoveryRejected)} ${textFor(t, 'rejected', '已拒绝')} · ${formatCountSummary(metrics.creativeProviderControl.byStatus)}`}</span>
                <button className="ghost-button small" type="button" onClick={() => onFocusAudit('creative.provider_control.recovery_approved', 'admin_review', { en: 'Filtered audit log to provider control recovery approvals.', zh: '已筛选 Provider 控制恢复审批审计事件。' })} disabled={!canReadAudit}><Clipboard size={15} />{textFor(t, 'Recovery audit', '恢复审计')}</button>
              </div>
              <div>
                <strong>{textFor(t, 'Provider cost anomalies', 'Provider 成本异常')}</strong><span>{`${formatNumber(metrics.creativeProviderBudget.costAnomalies.total)} · ${formatCountSummary(metrics.creativeProviderBudget.costAnomalies.byReason)}`}</span>
                <button className="ghost-button small" type="button" onClick={() => onFocusAudit('creative.provider_cost.anomaly_detected', 'creative_provider_budget', { en: 'Filtered audit log to provider cost anomalies.', zh: '已筛选 Provider 成本异常审计事件。' })} disabled={!canReadAudit}><Clipboard size={15} />{textFor(t, 'Anomaly audit', '异常审计')}</button>
                <button className="ghost-button small" type="button" onClick={() => onToggleSamples('creativeProviderCostAnomalies')} disabled={!canReadAudit || samplesLoading}><BarChart3 size={15} />{textFor(t, 'Recent anomalies', '近期异常')}</button>
              </div>
              <div>
                <strong>{textFor(t, 'Provider alert dispatches', 'Provider 告警派发')}</strong><span>{`${formatNumber(metrics.creativeProviderBudget.providerAlertDispatches.total)} · ${formatNumber(metrics.creativeProviderBudget.providerAlertDispatches.failed)} ${textFor(t, 'failed', '失败')} · ${formatCountSummary(metrics.creativeProviderBudget.providerAlertDispatches.byChannel)} · ${textFor(t, 'dry-run', '演练')} ${formatNumber(metrics.creativeProviderBudget.providerAlertDispatches.fixtureDryRuns.total)} · ${formatNumber(metrics.creativeProviderBudget.providerAlertDispatches.fixtureDryRuns.failed)} ${textFor(t, 'failed', '失败')}`}</span>
                <button className="ghost-button small" type="button" onClick={() => onFocusAudit('creative.provider_alert.dispatch', 'creative_provider_budget_alert', { en: 'Filtered audit log to provider alert dispatches.', zh: '已筛选 Provider 告警派发审计事件。' })} disabled={!canReadAudit}><Clipboard size={15} />{textFor(t, 'Dispatch audit', '派发审计')}</button>
                <button className="ghost-button small" type="button" onClick={() => onToggleSamples('creativeProviderAlertDispatches')} disabled={!canReadAudit || samplesLoading}><Bell size={15} />{textFor(t, 'Recent dispatches', '近期派发')}</button>
              </div>
              <div>
                <strong>{textFor(t, 'Scan history pruned', '扫描历史清理')}</strong><span>{`${formatNumber(metrics.mediaScan.historyPruned.jobs)} ${textFor(t, 'jobs', '任务')} · ${metrics.mediaScan.historyPruned.latestAt ? formatAuditTime(metrics.mediaScan.historyPruned.latestAt) : '-'}`}</span>
                <button className="ghost-button small" type="button" onClick={() => onFocusAudit('media.scan.history_pruned', 'media_scan_jobs', { en: 'Filtered audit log to scan history pruning.', zh: '已筛选扫描历史清理审计事件。' })} disabled={!canReadAudit}><Clipboard size={15} />{textFor(t, 'Prune audit', '清理审计')}</button>
                <button className="ghost-button small" type="button" onClick={() => onToggleSamples('historyPruned')} disabled={!canReadAudit || samplesLoading}><Archive size={15} />{textFor(t, 'Recent prunes', '近期清理')}</button>
              </div>
            </div>

            {sampleKey && (
              <div className="operations-sample-panel">
                <div className="operations-sample-header"><strong>{sampleTitle}</strong><button className="ghost-button small" type="button" onClick={onCloseSamples}>{textFor(t, 'Close', '关闭')}</button></div>
                {samplesLoading && <small>{textFor(t, 'Loading metric samples.', '正在加载指标样本。')}</small>}
                {samplesError && <small>{samplesError}</small>}
                {!samplesLoading && !samplesError && samples.length === 0 && <small>{textFor(t, 'No matching recent samples.', '暂无匹配的近期样本。')}</small>}
                {!samplesLoading && !samplesError && samples.map((event) => (
                  <div className="operations-sample-row" key={event.id}>
                    <div><strong>{event.action}</strong><span>{event.resourceId ?? event.resourceType} · {formatAuditTime(event.createdAt)}</span></div>
                    <div className="operations-sample-meta">
                      {sampleMetaEntries(event).map(([key, value]) => <span key={key}><b>{key}</b>{typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}</span>)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </SecurityWorkspacePanel>
  )
}
