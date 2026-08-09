import { Download } from 'lucide-react'

import { StatusBadge } from '../../components/ui/StatusBadge'
import type { AsyncResourceState } from '../../domain/types'
import { isZhCopy, textFor } from '../../domain/utils'
import type {
  AdminSecurityAlertDto,
  AdminSecurityAlertEventDto,
  AdminSecurityEventDto,
  AdminSecurityEventListQuery,
  AdminSecurityIncidentDto,
} from '../../services/contracts'
import type { PendingSecurityOperation } from './SecurityOperationConfirmation'

const securityEventSources: Array<NonNullable<AdminSecurityEventListQuery['source']>> = ['rate_limit', 'body_size', 'auth_failure']
const securityEventSeverities = ['warning', 'info', 'critical']

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

const formatMetadataJson = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

type AlertState = {
  status: AsyncResourceState
  items: AdminSecurityAlertDto[]
  highlightedId: string | null
  handlingId: string | null
  selectedId: string | null
  exportingId: string | null
  events: AdminSecurityAlertEventDto[]
  eventsLoading: boolean
  eventsError: string | null
}

type IncidentState = {
  status: AsyncResourceState
  items: AdminSecurityIncidentDto[]
  selectedOpenId: string
  handlingId: string | null
}

type EventStreamState = {
  status: AsyncResourceState
  items: AdminSecurityEventDto[]
  source: AdminSecurityEventListQuery['source']
  severity: string
  type: string
  nextCursor: string | null
  loadingMore: boolean
}

type Actions = {
  onToggleAlertEvents: (alert: AdminSecurityAlertDto) => void
  onAcknowledgeAlert: (alert: AdminSecurityAlertDto) => void
  onUnsilenceAlert: (alert: AdminSecurityAlertDto) => void
  onExportAlert: (alert: AdminSecurityAlertDto) => void
  onFilterByAlertSource: (source: string) => void
  onSelectOpenIncident: (incidentId: string) => void
  onBeginOperation: (operation: PendingSecurityOperation) => void
  onAttachEvent: (event: AdminSecurityEventDto) => void
  onSourceChange: (source: AdminSecurityEventListQuery['source']) => void
  onSeverityChange: (severity: string) => void
  onTypeChange: (type: string) => void
  onClearFilters: () => void
  onLoadMore: () => void
}

export function SecurityIncidentsWorkspace({
  t,
  canReadAudit,
  canManageSecurityAlerts,
  alerts,
  incidents,
  eventStream,
  actions,
}: {
  t: Record<string, string>
  canReadAudit: boolean
  canManageSecurityAlerts: boolean
  alerts: AlertState
  incidents: IncidentState
  eventStream: EventStreamState
  actions: Actions
}) {
  const isZh = isZhCopy(t)
  const formatAuditTime = (value: string) => {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString(isZh ? 'zh-CN' : 'en-US')
  }

  return (
    <div className="security-incidents-workspace" data-testid="security-incidents-workspace">
      <div className="admin-table" data-testid="admin-security-alerts">
        {alerts.status.loading && (
          <div className="empty-state">
            <strong>{textFor(t, 'Loading security alerts', '正在加载安全告警')}</strong>
            <span>{textFor(t, 'Checking rate-limit, body-size, and failed-login thresholds.', '正在检查限流、请求体和登录异常阈值。')}</span>
          </div>
        )}
        {!alerts.status.loading && alerts.status.error && (
          <div className="empty-state">
            <strong>{textFor(t, 'Security alerts unavailable', '安全告警不可用')}</strong>
            <span>{alerts.status.error}</span>
            <button className="ghost-button" type="button" onClick={() => void alerts.status.refresh()}>
              {textFor(t, 'Retry sync', '重试同步')}
            </button>
          </div>
        )}
        {!alerts.status.loading && !alerts.status.error && alerts.items.length === 0 && (
          <div className="empty-state">
            <strong>{textFor(t, 'No active security alerts', '暂无活跃安全告警')}</strong>
            <span>{textFor(t, 'Threshold-crossing security patterns will appear here before the raw event stream.', '超过阈值的安全模式会先出现在这里，再向下查看原始事件。')}</span>
          </div>
        )}
        {!alerts.status.error && alerts.items.map((alert) => {
          const metadata = asRecord(alert.metadata)
          const recentEventIds = Array.isArray(metadata.recentEventIds) ? metadata.recentEventIds.map(String) : []
          const recentClientKeys = Array.isArray(metadata.recentClientKeys) ? metadata.recentClientKeys.map(String) : []
          const recentPaths = Array.isArray(metadata.recentPaths) ? metadata.recentPaths.map(String) : []
          const recentChannels = Array.isArray(metadata.recentChannels) ? metadata.recentChannels.map(String) : []
          const recentErrors = Array.isArray(metadata.recentErrors) ? metadata.recentErrors.map(String) : []
          const source = typeof metadata.source === 'string' ? metadata.source : null
          const isAlertDispatchSource = source === 'alert_dispatch'
          const isHandling = alerts.handlingId === alert.id
          const state = alert.state ?? 'active'
          const statusCopy = state === 'silenced'
            ? textFor(t, 'silenced', '已静默')
            : state === 'acknowledged'
              ? textFor(t, 'acknowledged', '已确认')
              : textFor(t, 'active', '活跃')
          return (
            <div className={alerts.highlightedId === alert.id ? 'admin-row deep-linked' : 'admin-row'} key={alert.id}>
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
                    onClick={() => actions.onToggleAlertEvents(alert)}
                    disabled={!canReadAudit || alerts.eventsLoading}
                  >
                    {alerts.selectedId === alert.id ? textFor(t, 'Hide events', '收起样本') : textFor(t, 'Events', '样本')}
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => actions.onAcknowledgeAlert(alert)}
                    disabled={!canManageSecurityAlerts || isHandling}
                  >
                    {isHandling ? textFor(t, 'Saving', '保存中') : textFor(t, 'Acknowledge', '确认')}
                  </button>
                  {state === 'silenced' ? (
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => actions.onUnsilenceAlert(alert)}
                      disabled={!canManageSecurityAlerts || isHandling}
                    >
                      {isHandling ? textFor(t, 'Saving', '保存中') : textFor(t, 'Unsilence', '解除静默')}
                    </button>
                  ) : (
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => actions.onBeginOperation({ kind: 'silence-security-alert', alert })}
                      disabled={!canManageSecurityAlerts || isHandling}
                    >
                      {isHandling ? textFor(t, 'Saving', '保存中') : textFor(t, 'Silence 24h', '静默24小时')}
                    </button>
                  )}
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => actions.onExportAlert(alert)}
                    disabled={!canReadAudit || alerts.exportingId === alert.id}
                  >
                    <Download size={17} />
                    {alerts.exportingId === alert.id ? textFor(t, 'Exporting', '导出中') : textFor(t, 'Export JSON', '导出 JSON')}
                  </button>
                  {!isAlertDispatchSource && (
                    <button className="ghost-button" type="button" onClick={() => actions.onFilterByAlertSource(source)}>
                      {textFor(t, 'View source events', '查看来源事件')}
                    </button>
                  )}
                </div>
              )}
              {alerts.selectedId === alert.id && (
                <div className="admin-inline-list">
                  {alerts.eventsLoading && <small>{textFor(t, 'Loading alert events.', '正在加载告警样本。')}</small>}
                  {alerts.eventsError && <small>{alerts.eventsError}</small>}
                  {!alerts.eventsLoading && !alerts.eventsError && alerts.events.length === 0 && (
                    <small>{textFor(t, 'No recent samples for this alert.', '暂无该告警的近期样本。')}</small>
                  )}
                  {!alerts.eventsLoading && !alerts.eventsError && alerts.events.map((event) => (
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
          <span>{textFor(t, 'Open incident target', '开放事故')}</span>
          <select
            aria-label={textFor(t, 'Open security incident target', '开放安全事故目标')}
            value={incidents.selectedOpenId}
            onChange={(event) => actions.onSelectOpenIncident(event.target.value)}
            disabled={!canManageSecurityAlerts || !incidents.items.some((incident) => incident.status === 'open')}
          >
            <option value="">{textFor(t, 'No open incident', '暂无开放事故')}</option>
            {incidents.items.filter((incident) => incident.status === 'open').map((incident) => (
              <option value={incident.id} key={incident.id}>{incident.id}</option>
            ))}
          </select>
        </label>
        <button className="ghost-button" type="button" onClick={() => void incidents.status.refresh()} disabled={!canReadAudit || incidents.status.loading}>
          {incidents.status.loading ? textFor(t, 'Loading incidents', '加载事故中') : textFor(t, 'Refresh incidents', '刷新事故')}
        </button>
      </div>

      <div className="admin-table" data-testid="admin-security-incidents">
        {incidents.status.error && (
          <div className="empty-state">
            <strong>{textFor(t, 'Security incidents unavailable', '安全事故不可用')}</strong>
            <span>{incidents.status.error}</span>
          </div>
        )}
        {!incidents.status.loading && !incidents.status.error && incidents.items.length === 0 && (
          <div className="empty-state">
            <strong>{textFor(t, 'No security incidents', '暂无安全事故')}</strong>
            <span>{textFor(t, 'Confirmed investigations will be tracked here.', '已确认进入调查的安全事件会在此跟踪。')}</span>
          </div>
        )}
        {!incidents.status.error && incidents.items.map((incident) => (
          <div className="admin-row" key={incident.id}>
            <StatusBadge status={incident.status === 'open' ? (incident.criticalConfirmed ? 'critical' : 'warning') : 'resolved'} t={t} />
            <strong>{incident.id}</strong>
            <span>{incident.eventCount} {textFor(t, 'events', '个事件')} · v{incident.version}</span>
            <small>{incident.reasonCode} · {formatAuditTime(incident.openedAt)}{incident.resolvedReasonCode ? ` · ${incident.resolvedReasonCode}` : ''}</small>
            {incident.status === 'open' && (
              <div className="button-row">
                <button className="ghost-button" type="button" onClick={() => actions.onBeginOperation({ kind: 'resolve-incident', incident })} disabled={!canManageSecurityAlerts || incidents.handlingId === incident.id}>
                  {incidents.handlingId === incident.id ? textFor(t, 'Saving', '保存中') : textFor(t, 'Resolve incident', '关闭事故')}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="permission-summary">
        <label>
          <span>{textFor(t, 'Source', '来源')}</span>
          <select
            aria-label={textFor(t, 'Security event source', '安全事件来源')}
            value={eventStream.source ?? ''}
            onChange={(event) => actions.onSourceChange(event.target.value || null)}
            disabled={!canReadAudit}
          >
            <option value="">{textFor(t, 'All sources', '全部来源')}</option>
            {securityEventSources.map((source) => <option value={source} key={source}>{source}</option>)}
          </select>
        </label>
        <label>
          <span>{textFor(t, 'Severity', '级别')}</span>
          <select aria-label={textFor(t, 'Security event severity', '安全事件级别')} value={eventStream.severity} onChange={(event) => actions.onSeverityChange(event.target.value)} disabled={!canReadAudit}>
            <option value="">{textFor(t, 'All severities', '全部级别')}</option>
            {securityEventSeverities.map((severity) => <option value={severity} key={severity}>{severity}</option>)}
          </select>
        </label>
        <label>
          <span>{textFor(t, 'Type', '类型')}</span>
          <input
            aria-label={textFor(t, 'Security event type', '安全事件类型')}
            value={eventStream.type}
            onChange={(event) => actions.onTypeChange(event.target.value)}
            placeholder="auth.failed_login.ip_accounts"
            disabled={!canReadAudit}
          />
        </label>
        <button className="ghost-button" type="button" onClick={actions.onClearFilters} disabled={!canReadAudit || (!eventStream.source && !eventStream.severity && !eventStream.type)}>
          {textFor(t, 'Clear filters', '清除筛选')}
        </button>
      </div>

      <div className="admin-table" data-testid="admin-security-events">
        {eventStream.status.loading && (
          <div className="empty-state">
            <strong>{textFor(t, 'Loading security events', '正在加载安全事件')}</strong>
            <span>{textFor(t, 'Reading rate-limit, body-size, and auth anomaly events.', '正在读取限流、请求体和登录异常事件。')}</span>
          </div>
        )}
        {!eventStream.status.loading && eventStream.status.error && (
          <div className="empty-state">
            <strong>{textFor(t, 'Security events unavailable', '安全事件不可用')}</strong>
            <span>{eventStream.status.error}</span>
            <button className="ghost-button" type="button" onClick={() => void eventStream.status.refresh()}>
              {textFor(t, 'Retry sync', '重试同步')}
            </button>
          </div>
        )}
        {!eventStream.status.loading && !eventStream.status.error && eventStream.items.length === 0 && (
          <div className="empty-state">
            <strong>{textFor(t, 'No security events yet', '暂无安全事件')}</strong>
            <span>{textFor(t, 'Rate limits, body-size rejections, and failed-login anomalies will appear here.', '限流、请求体拒绝和登录异常会出现在这里。')}</span>
          </div>
        )}
        {!eventStream.status.error && eventStream.items.map((event) => {
          const details = asRecord(event.details)
          const detailEntries = Object.entries(details).filter(([key]) => !['method', 'pathname', 'clientKey', 'identity', 'occurredAt'].includes(key))
          return (
            <div className="admin-row" key={event.id}>
              <StatusBadge status={event.severity} t={t} />
              <strong>{event.type}</strong>
              <span>{event.clientKey ? event.clientKey : textFor(t, 'Unknown client', '未知来源')}</span>
              <small>{event.source} · {event.method ?? '-'} {event.pathname ?? '-'} · {event.identity ? `${event.identity} · ` : ''}{formatAuditTime(event.occurredAt)}</small>
              <div className="button-row">
                {event.incidentId ? (
                  <small>{textFor(t, 'Incident', '事故')} · {event.incidentId}</small>
                ) : (
                  <>
                    <button className="ghost-button" type="button" onClick={() => actions.onBeginOperation({ kind: 'open-incident', event })} disabled={!canManageSecurityAlerts || incidents.handlingId === event.id}>
                      {incidents.handlingId === event.id ? textFor(t, 'Saving', '保存中') : textFor(t, 'Open incident', '创建事故')}
                    </button>
                    <button className="ghost-button" type="button" onClick={() => actions.onAttachEvent(event)} disabled={!canManageSecurityAlerts || !incidents.selectedOpenId || incidents.handlingId === event.id}>
                      {textFor(t, 'Attach to selected', '关联所选事故')}
                    </button>
                  </>
                )}
              </div>
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

      {eventStream.nextCursor && !eventStream.status.error && (
        <div className="button-row">
          <button className="ghost-button" type="button" onClick={actions.onLoadMore} disabled={eventStream.loadingMore || !canReadAudit}>
            {eventStream.loadingMore ? textFor(t, 'Loading', '加载中') : textFor(t, 'Load more', '加载更多')}
          </button>
        </div>
      )}
    </div>
  )
}
