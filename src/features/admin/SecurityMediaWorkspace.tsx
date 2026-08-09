import { lazy, Suspense } from 'react'

import { StatusBadge } from '../../components/ui/StatusBadge'
import type { AsyncResourceState, AuditEvent } from '../../domain/types'
import { isZhCopy, textFor } from '../../domain/utils'
import type {
  ApiMediaAsset,
  ApiMediaScanAlert,
  ApiMediaScanAlertEvent,
  ApiMediaScanJob,
  MediaAssetPurpose,
  MediaReviewQueueQuery,
} from '../../services/contracts'
import type { PendingSecurityOperation } from './SecurityOperationConfirmation'
import { SecurityWorkspacePanel } from './SecurityWorkspacePanel'

const AdminMediaLifecyclePanel = lazy(() => import('./AdminMediaLifecyclePanel').then((module) => ({ default: module.AdminMediaLifecyclePanel })))
const mediaReviewStatuses: Array<NonNullable<MediaReviewQueueQuery['status']>> = ['review', 'scanning', 'pending', 'rejected', 'clean', 'all']
const mediaPurposes: MediaAssetPurpose[] = ['task_attachment', 'submission_asset', 'profile_portfolio', 'library_asset']

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

type Filters = {
  status: NonNullable<MediaReviewQueueQuery['status']>
  purpose: MediaAssetPurpose | null
  search: string
}

type ScanHistoryState = {
  status: AsyncResourceState
  items: ApiMediaScanJob[]
  nextCursor: string | null
  loadingMore: boolean
}

type ScanAlertState = {
  status: AsyncResourceState
  items: ApiMediaScanAlert[]
  handlingId: string | null
  selectedId: string | null
  events: ApiMediaScanAlertEvent[]
  eventsLoading: boolean
  eventsError: string | null
}

export function SecurityMediaWorkspace({
  t,
  canReadQueues,
  canReviewQueues,
  canReadAudit,
  canReadMedia,
  canManageMedia,
  canExportMedia,
  reviewStatus,
  rows,
  filters,
  highlightedAssetId,
  selectedAssetId,
  reviewingAssetId,
  sweeping,
  scanHistory,
  scanAlerts,
  callbackStatus,
  callbackEvents,
  onFilterStatus,
  onFilterPurpose,
  onFilterSearch,
  onSelectAsset,
  onRetryAsset,
  onReviewAsset,
  onLoadMoreHistory,
  onToggleAlertEvents,
  onAcknowledgeAlert,
  onUnsilenceAlert,
  onBeginOperation,
  onSweep,
}: {
  t: Record<string, string>
  canReadQueues: boolean
  canReviewQueues: boolean
  canReadAudit: boolean
  canReadMedia: boolean
  canManageMedia: boolean
  canExportMedia: boolean
  reviewStatus: AsyncResourceState
  rows: ApiMediaAsset[]
  filters: Filters
  highlightedAssetId: string | null
  selectedAssetId: string | null
  reviewingAssetId: string | null
  sweeping: boolean
  scanHistory: ScanHistoryState
  scanAlerts: ScanAlertState
  callbackStatus: AsyncResourceState
  callbackEvents: AuditEvent[]
  onFilterStatus: (status: NonNullable<MediaReviewQueueQuery['status']>) => void
  onFilterPurpose: (purpose: MediaAssetPurpose | null) => void
  onFilterSearch: (search: string) => void
  onSelectAsset: (assetId: string | null) => void
  onRetryAsset: (asset: ApiMediaAsset) => void
  onReviewAsset: (asset: ApiMediaAsset, decision: 'clean' | 'reject') => void
  onLoadMoreHistory: () => void
  onToggleAlertEvents: (alert: ApiMediaScanAlert) => void
  onAcknowledgeAlert: (alert: ApiMediaScanAlert) => void
  onUnsilenceAlert: (alert: ApiMediaScanAlert) => void
  onBeginOperation: (operation: PendingSecurityOperation) => void
  onSweep: () => void
}) {
  const isZh = isZhCopy(t)
  const formatAuditTime = (value: string) => {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString(isZh ? 'zh-CN' : 'en-US')
  }

  return (
    <SecurityWorkspacePanel
      t={t}
      workspace="media"
      action={
        <div className="button-row security-workspace-actions">
          <button className="ghost-button" type="button" onClick={() => void reviewStatus.refresh()} disabled={!canReadQueues || reviewStatus.loading}>
            {reviewStatus.loading ? textFor(t, 'Loading', '加载中') : textFor(t, 'Refresh', '刷新')}
          </button>
          <button className="ghost-button" type="button" onClick={onSweep} disabled={!canReadQueues || sweeping}>
            {sweeping ? textFor(t, 'Sweeping', '巡检中') : textFor(t, 'Sweep jobs', '扫描任务巡检')}
          </button>
        </div>
      }
    >
      <div className="security-media-workspace" data-testid="security-media-workspace">
        <Suspense fallback={<div className="route-loading" role="status" aria-live="polite"><span className="status-dot loading" aria-hidden="true" />{textFor(t, 'Loading media lifecycle', '正在加载媒体生命周期')}</div>}>
          <AdminMediaLifecyclePanel t={t} canRead={canReadMedia} canReview={canManageMedia} canExport={canExportMedia} />
        </Suspense>

        <div className="permission-summary">
          <label>
            <span>{textFor(t, 'Scan status', '扫描状态')}</span>
            <select aria-label={textFor(t, 'Media scan status', '媒体扫描状态')} value={filters.status} onChange={(event) => onFilterStatus(event.target.value as NonNullable<MediaReviewQueueQuery['status']>)}>
              {mediaReviewStatuses.map((status) => <option value={status} key={status}>{status}</option>)}
            </select>
          </label>
          <label>
            <span>{textFor(t, 'Purpose', '用途')}</span>
            <select aria-label={textFor(t, 'Media purpose', '媒体用途')} value={filters.purpose ?? ''} onChange={(event) => onFilterPurpose(event.target.value ? event.target.value as MediaAssetPurpose : null)}>
              <option value="">{textFor(t, 'All purposes', '全部用途')}</option>
              {mediaPurposes.map((purpose) => <option value={purpose} key={purpose}>{purpose}</option>)}
            </select>
          </label>
          <label>
            <span>{textFor(t, 'Search', '搜索')}</span>
            <input aria-label={textFor(t, 'Search media queue', '搜索媒体队列')} value={filters.search} onChange={(event) => onFilterSearch(event.target.value)} placeholder={textFor(t, 'Filename, type, owner', '文件名、类型、所有者')} />
          </label>
        </div>

        <div className="admin-table">
          {reviewStatus.loading && <div className="empty-state"><strong>{textFor(t, 'Loading media queue', '正在加载媒体队列')}</strong><span>{textFor(t, 'Reading scan and quarantine candidates.', '正在读取扫描与隔离候选项。')}</span></div>}
          {!reviewStatus.loading && reviewStatus.error && <div className="empty-state"><strong>{textFor(t, 'Media queue unavailable', '媒体队列暂不可用')}</strong><span>{reviewStatus.error}</span></div>}
          {!reviewStatus.loading && !reviewStatus.error && rows.length === 0 && <div className="empty-state"><strong>{textFor(t, 'No media assets', '暂无媒体资产')}</strong><span>{textFor(t, 'Try another scan status, purpose, or search term.', '尝试其他扫描状态、用途或搜索词。')}</span></div>}
          {!reviewStatus.loading && !reviewStatus.error && rows.map((asset) => {
            const security = asRecord(asRecord(asset.metadata).security)
            const scanStatus = String(security.scanStatus ?? 'pending')
            const scanJobStatus = String(security.scanJobStatus ?? '')
            return (
              <div className={highlightedAssetId === asset.id ? 'admin-row deep-linked' : 'admin-row'} key={asset.id}>
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
                  <button className={selectedAssetId === asset.id ? 'ghost-button active' : 'ghost-button'} type="button" onClick={() => onSelectAsset(selectedAssetId === asset.id ? null : asset.id)}>{textFor(t, 'History', '历史')}</button>
                  <button className="ghost-button" type="button" onClick={() => onRetryAsset(asset)} disabled={reviewingAssetId === asset.id || scanJobStatus === 'queued' || scanJobStatus === 'retrying'}>{reviewingAssetId === asset.id ? textFor(t, 'Saving', '保存中') : textFor(t, 'Retry scan', '重试扫描')}</button>
                  <button className="ghost-button" type="button" onClick={() => onReviewAsset(asset, 'reject')} disabled={reviewingAssetId === asset.id || scanStatus === 'rejected'}>{reviewingAssetId === asset.id ? textFor(t, 'Saving', '保存中') : textFor(t, 'Reject', '拒绝')}</button>
                  <button className="primary-button" type="button" onClick={() => onReviewAsset(asset, 'clean')} disabled={reviewingAssetId === asset.id || scanStatus === 'clean'}>{reviewingAssetId === asset.id ? textFor(t, 'Saving', '保存中') : textFor(t, 'Release', '放行')}</button>
                </div>
              </div>
            )
          })}
        </div>

        {selectedAssetId && (
          <div className="admin-detail-panel">
            <div><strong>{textFor(t, 'Scan job history', '扫描任务历史')}</strong><span>{selectedAssetId}</span></div>
            {scanHistory.status.loading && scanHistory.items.length === 0 && <p>{textFor(t, 'Loading scan attempts.', '正在加载扫描尝试。')}</p>}
            {scanHistory.status.loading && scanHistory.items.length > 0 && <p>{textFor(t, 'Refreshing scan attempts.', '正在刷新扫描尝试。')}</p>}
            {!scanHistory.status.loading && scanHistory.status.error && <p>{scanHistory.status.error}</p>}
            {!scanHistory.status.loading && !scanHistory.status.error && scanHistory.items.length === 0 && <p>{textFor(t, 'No scan job records yet.', '暂无扫描任务记录。')}</p>}
            {!scanHistory.status.loading && !scanHistory.status.error && scanHistory.items.map((job) => {
              const metadata = asRecord(job.metadata)
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
            {!scanHistory.status.error && scanHistory.nextCursor && (
              <button className="ghost-button" type="button" onClick={onLoadMoreHistory} disabled={scanHistory.loadingMore || scanHistory.status.loading}>
                {scanHistory.loadingMore ? textFor(t, 'Loading more', '加载更多中') : textFor(t, 'Load more history', '加载更多历史')}
              </button>
            )}
          </div>
        )}

        <div className="admin-detail-panel">
          <div><strong>{textFor(t, 'Scan alerts', '扫描告警')}</strong><button className="ghost-button" type="button" onClick={() => void scanAlerts.status.refresh()} disabled={!canReadQueues || scanAlerts.status.loading}>{scanAlerts.status.loading ? textFor(t, 'Loading', '加载中') : textFor(t, 'Refresh', '刷新')}</button></div>
          {scanAlerts.status.error && <p>{scanAlerts.status.error}</p>}
          {!scanAlerts.status.loading && !scanAlerts.status.error && scanAlerts.items.length === 0 && <p>{textFor(t, 'No scanner alert thresholds are currently breached.', '当前没有触发扫描告警阈值。')}</p>}
          {!scanAlerts.status.error && scanAlerts.items.map((alert) => {
            const isHandling = scanAlerts.handlingId === alert.id
            const state = alert.state ?? 'active'
            const statusCopy = state === 'silenced' ? textFor(t, 'silenced', '已静默') : state === 'acknowledged' ? textFor(t, 'acknowledged', '已确认') : textFor(t, 'active', '活跃')
            return (
              <div className="admin-row compact" key={alert.id}>
                <StatusBadge status={state === 'active' ? alert.severity : state} t={t} />
                <strong>{alert.title}</strong>
                <span>{statusCopy} · {textFor(t, 'count', '次数')} {alert.count} / {alert.threshold}</span>
                <small>{alert.summary} · {textFor(t, 'window', '窗口')} {alert.windowMinutes}m{alert.acknowledgedBy ? ` · ${textFor(t, 'ack', '确认')} @${alert.acknowledgedBy}` : ''}{alert.silencedUntil ? ` · ${textFor(t, 'silent until', '静默至')} ${alert.silencedUntil.slice(0, 16)}` : ''}</small>
                <div className="button-row">
                  <button className="ghost-button" type="button" onClick={() => onToggleAlertEvents(alert)} disabled={!canReadQueues || scanAlerts.eventsLoading}>{scanAlerts.selectedId === alert.id ? textFor(t, 'Hide events', '收起样本') : textFor(t, 'Events', '样本')}</button>
                  <button className="ghost-button" type="button" onClick={() => onAcknowledgeAlert(alert)} disabled={!canReviewQueues || isHandling}>{isHandling ? textFor(t, 'Saving', '保存中') : textFor(t, 'Acknowledge', '确认')}</button>
                  {state === 'silenced'
                    ? <button className="ghost-button" type="button" onClick={() => onUnsilenceAlert(alert)} disabled={!canReviewQueues || isHandling}>{isHandling ? textFor(t, 'Saving', '保存中') : textFor(t, 'Unsilence', '解除静默')}</button>
                    : <button className="ghost-button" type="button" onClick={() => onBeginOperation({ kind: 'silence-scan-alert', alert })} disabled={!canReviewQueues || isHandling}>{isHandling ? textFor(t, 'Saving', '保存中') : textFor(t, 'Silence 24h', '静默24小时')}</button>}
                </div>
                {scanAlerts.selectedId === alert.id && (
                  <div className="admin-inline-list">
                    {scanAlerts.eventsLoading && <small>{textFor(t, 'Loading alert events.', '正在加载告警样本。')}</small>}
                    {scanAlerts.eventsError && <small>{scanAlerts.eventsError}</small>}
                    {!scanAlerts.eventsLoading && !scanAlerts.eventsError && scanAlerts.events.length === 0 && <small>{textFor(t, 'No recent samples for this alert.', '暂无该告警的近期样本。')}</small>}
                    {!scanAlerts.eventsLoading && !scanAlerts.eventsError && scanAlerts.events.map((event) => {
                      const metadata = asRecord(event.metadata)
                      const details = [metadata.reason, metadata.dispatchStatus, metadata.dispatchStatusCode, metadata.dispatchError, metadata.status, metadata.statusCode, metadata.error, metadata.externalScanId]
                        .filter((item) => item !== undefined && item !== null && item !== '').map(String)
                      return <small key={event.id}>{event.action} · {event.resourceId ?? event.resourceType} · {formatAuditTime(event.createdAt)}{details.length > 0 ? ` · ${details.slice(0, 3).join(' · ')}` : ''}</small>
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="admin-detail-panel">
          <div><strong>{textFor(t, 'Callback failures', '回调失败')}</strong><button className="ghost-button" type="button" onClick={() => void callbackStatus.refresh()} disabled={!canReadQueues || !canReadAudit || callbackStatus.loading}>{callbackStatus.loading ? textFor(t, 'Loading', '加载中') : textFor(t, 'Refresh', '刷新')}</button></div>
          {!canReadAudit && <p>{textFor(t, 'Audit read permission is required to inspect denied callbacks.', '需要审计读取权限才能查看被拒绝的回调。')}</p>}
          {callbackStatus.error && <p>{callbackStatus.error}</p>}
          {canReadAudit && !callbackStatus.loading && !callbackStatus.error && callbackEvents.length === 0 && <p>{textFor(t, 'No recent denied scanner callbacks.', '暂无近期被拒绝的扫描回调。')}</p>}
          {canReadAudit && !callbackStatus.error && callbackEvents.map((event) => {
            const metadata = asRecord(event.metadata)
            const headers = asRecord(metadata.headers)
            const externalScanId = metadata.externalScanId ? String(metadata.externalScanId) : ''
            return (
              <div className="admin-row compact" key={event.id}>
                <StatusBadge status="rejected" t={t} />
                <strong>{String(metadata.reason ?? event.action)}</strong>
                <span>{event.resourceId ?? textFor(t, 'Unknown asset', '未知资产')}</span>
                <small>{externalScanId ? `${externalScanId} · ` : ''}{textFor(t, 'secret', '密钥')} {headers.hasSecret ? textFor(t, 'yes', '是') : textFor(t, 'no', '否')} · {textFor(t, 'timestamp', '时间戳')} {headers.hasTimestamp ? textFor(t, 'yes', '是') : textFor(t, 'no', '否')} · {textFor(t, 'signature', '签名')} {headers.hasSignature ? textFor(t, 'yes', '是') : textFor(t, 'no', '否')} · {formatAuditTime(event.createdAt)}</small>
              </div>
            )
          })}
        </div>
      </div>
    </SecurityWorkspacePanel>
  )
}
