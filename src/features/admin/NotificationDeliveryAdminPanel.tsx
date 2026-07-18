import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, History, RefreshCw, RotateCcw, Save, XCircle } from 'lucide-react'
import { adminService } from '../../services/adminService'
import type { NotificationChannelConfig, NotificationChannelConfigRevision, NotificationDelivery, NotificationDeliveryMetrics, NotificationDeliveryStatus } from '../../services/contracts'

const statuses: NotificationDeliveryStatus[] = ['queued', 'processing', 'retry_scheduled', 'sent', 'suppressed', 'dead_lettered', 'cancelled']
const dateValue = (date: Date) => date.toISOString().slice(0, 10)
const initialFrom = () => dateValue(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
const metricQuery = (dateFrom: string, dateTo: string, channel: '' | 'in_app' | 'email', notificationType: string) => ({
  dateFrom: `${dateFrom}T00:00:00.000Z`,
  dateTo: `${dateTo}T23:59:59.999Z`,
  channel: channel || null,
  notificationType: notificationType.trim() || null,
})
const percent = (bps: number) => `${(bps / 100).toFixed(2)}%`
const latency = (value: number | null) => value == null ? '-' : value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${value.toFixed(0)}ms`

type ConfigDraft = Pick<NotificationChannelConfig, 'enabled' | 'deliveryRateTargetBps' | 'failureRateAlertThresholdBps' | 'latencyTargetMs' | 'maxAttempts' | 'retryBackoffSeconds'>
const draftFor = (config: NotificationChannelConfig): ConfigDraft => ({
  enabled: config.enabled,
  deliveryRateTargetBps: config.deliveryRateTargetBps,
  failureRateAlertThresholdBps: config.failureRateAlertThresholdBps,
  latencyTargetMs: config.latencyTargetMs,
  maxAttempts: config.maxAttempts,
  retryBackoffSeconds: config.retryBackoffSeconds,
})

export function NotificationDeliveryAdminPanel({ canManage, isZh, notify }: {
  canManage: boolean
  isZh: boolean
  notify: (message: string) => void
}) {
  const text = (en: string, zh: string) => isZh ? zh : en
  const [view, setView] = useState<'queue' | 'metrics' | 'channels'>('queue')
  const [items, setItems] = useState<NotificationDelivery[]>([])
  const [selected, setSelected] = useState<NotificationDelivery | null>(null)
  const [metrics, setMetrics] = useState<NotificationDeliveryMetrics | null>(null)
  const [configs, setConfigs] = useState<NotificationChannelConfig[]>([])
  const [drafts, setDrafts] = useState<Record<string, ConfigDraft>>({})
  const [history, setHistory] = useState<Record<string, NotificationChannelConfigRevision[]>>({})
  const [status, setStatus] = useState<NotificationDeliveryStatus | ''>('')
  const [channel, setChannel] = useState<'' | 'in_app' | 'email'>('')
  const [search, setSearch] = useState('')
  const [cursor, setCursor] = useState<string | null>(null)
  const [dateFrom, setDateFrom] = useState(initialFrom)
  const [dateTo, setDateTo] = useState(() => dateValue(new Date()))
  const [metricChannel, setMetricChannel] = useState<'' | 'in_app' | 'email'>('')
  const [notificationType, setNotificationType] = useState('')
  const [reasonCode, setReasonCode] = useState('operator_requested')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (append = false) => {
    setBusy(true)
    setError(null)
    try {
      const [page, summary, channelConfigs] = await Promise.all([
        adminService.notificationDeliveries({ status: status || null, channel: channel || null, search: search.trim() || null, cursor: append ? cursor : null, limit: 25 }),
        adminService.notificationDeliveryMetrics(metricQuery(dateFrom, dateTo, metricChannel, notificationType)),
        adminService.notificationChannelConfigs(),
      ])
      setItems((current) => append ? [...current, ...page.items] : page.items)
      setCursor(page.nextCursor)
      setMetrics(summary)
      setConfigs(channelConfigs)
      setDrafts((current) => Object.fromEntries(channelConfigs.map((config) => [config.channel, current[config.channel] ?? draftFor(config)])))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }, [channel, cursor, dateFrom, dateTo, metricChannel, notificationType, search, status])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(false), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const open = async (item: NotificationDelivery) => {
    setBusy(true)
    try { setSelected(await adminService.notificationDelivery(item.id)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }

  const mutate = async (operation: () => Promise<NotificationDelivery>, message: string) => {
    setBusy(true)
    setError(null)
    try {
      setSelected(await operation())
      await load(false)
      notify(message)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }

  const download = async (kind: 'inventory' | 'metrics') => {
    try {
      const body = kind === 'inventory'
        ? await adminService.exportNotificationDeliveries({ status: status || null, channel: channel || null, search: search.trim() || null })
        : await adminService.exportNotificationDeliveryMetrics(metricQuery(dateFrom, dateTo, metricChannel, notificationType))
      const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `notification-${kind}-${dateValue(new Date())}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }

  const saveConfig = async (config: NotificationChannelConfig) => {
    const draft = drafts[config.channel]
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      const updated = await adminService.updateNotificationChannelConfig(config.channel, { ...draft, expectedVersion: config.version, reasonCode })
      setConfigs((current) => current.map((item) => item.channel === updated.channel ? updated : item))
      setDrafts((current) => ({ ...current, [updated.channel]: draftFor(updated) }))
      setHistory((current) => ({ ...current, [updated.channel]: [] }))
      await load(false)
      notify(text('Channel configuration saved.', '渠道配置已保存。'))
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }

  const loadHistory = async (config: NotificationChannelConfig) => {
    try {
      const revisions = await adminService.notificationChannelConfigHistory(config.channel)
      setHistory((current) => ({ ...current, [config.channel]: revisions }))
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }

  const rollback = async (config: NotificationChannelConfig, revisionNumber: number) => {
    setBusy(true)
    setError(null)
    try {
      const updated = await adminService.rollbackNotificationChannelConfig(config.channel, { revisionNumber, expectedVersion: config.version, reasonCode: 'operator_rollback' })
      setConfigs((current) => current.map((item) => item.channel === updated.channel ? updated : item))
      setDrafts((current) => ({ ...current, [updated.channel]: draftFor(updated) }))
      await loadHistory(updated)
      await load(false)
      notify(text('Channel configuration rolled back.', '渠道配置已回滚。'))
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }

  return (
    <section className="panel notification-delivery-panel" data-testid="notification-delivery-panel">
      <div className="admin-section-heading">
        <div><strong>{text('Notification delivery', '通知投递')}</strong><small>{metrics ? `${metrics.overall.total} ${text('deliveries', '条投递')} · ${metrics.overall.failed} ${text('failed', '失败')} · ${metrics.thresholdBreaches.length} ${text('breaches', '项越线')}` : ''}</small></div>
        <div className="button-row">
          <span className={metrics?.runtime.emailEnvironmentAvailable ? 'status-badge success' : 'status-badge warning'}>{metrics?.runtime.emailEnvironmentAvailable ? text('Email available', 'Email 可用') : text('Email unavailable', 'Email 不可用')}</span>
          <button className="icon-button" type="button" title={text('Refresh', '刷新')} onClick={() => void load(false)}><RefreshCw size={16}/></button>
        </div>
      </div>

      <div className="notification-view-tabs delivery-view-tabs" aria-label={text('Delivery view', '投递视图')}>
        {(['queue', 'metrics', 'channels'] as const).map((value) => <button className={view === value ? 'active' : ''} type="button" key={value} onClick={() => setView(value)}>{value === 'queue' ? text('Queue', '队列') : value === 'metrics' ? text('Metrics', '指标') : text('Channels', '渠道')}</button>)}
      </div>
      {error && <div className="inline-error" role="alert">{error}</div>}

      {view === 'queue' && <>
        <div className="notification-admin-filters delivery-filters">
          <input aria-label={text('Search deliveries', '搜索投递')} placeholder={text('Search ID, title, or type', '搜索 ID、标题或类型')} value={search} onChange={(event) => setSearch(event.target.value)} />
          <select aria-label={text('Delivery status', '投递状态')} value={status} onChange={(event) => setStatus(event.target.value as NotificationDeliveryStatus | '')}><option value="">{text('All statuses', '全部状态')}</option>{statuses.map((value) => <option key={value} value={value}>{value}</option>)}</select>
          <select aria-label={text('Delivery channel', '投递渠道')} value={channel} onChange={(event) => setChannel(event.target.value as typeof channel)}><option value="">{text('All channels', '全部渠道')}</option><option value="in_app">in_app</option><option value="email">email</option></select>
          <button className="icon-button" type="button" title={text('Export inventory', '导出投递清单')} onClick={() => void download('inventory')}><Download size={16}/></button>
        </div>
        <div className="notification-delivery-layout">
          <div className="admin-table notification-delivery-list">
            {items.map((item) => <button className={`admin-row compact ${selected?.id === item.id ? 'selected' : ''}`} type="button" key={item.id} onClick={() => void open(item)}><span><strong>{item.notification?.title ?? item.notificationId}</strong><small>{item.notification?.type} · {item.channel} · {item.attemptCount}/{item.maxAttempts}</small></span><span className={`status ${item.status}`}>{item.status}</span></button>)}
            {!busy && items.length === 0 && <div className="empty-state"><strong>{text('No deliveries', '暂无投递')}</strong></div>}
            {cursor && <button className="ghost-button small" type="button" disabled={busy} onClick={() => void load(true)}>{text('Load more', '加载更多')}</button>}
          </div>
          <div className="notification-delivery-detail">
            {selected ? <>
              <div className="delivery-detail-header"><div><strong>{selected.notification?.title}</strong><small>{selected.id}</small></div><span className={`status ${selected.status}`}>{selected.status}</span></div>
              <dl className="delivery-facts"><div><dt>{text('Recipient', '收件人')}</dt><dd>{selected.notification?.recipient?.emailHint ?? selected.notification?.recipient?.handle ?? '-'}</dd></div><div><dt>{text('Channel', '渠道')}</dt><dd>{selected.channel}</dd></div><div><dt>{text('Available', '可处理时间')}</dt><dd>{new Date(selected.availableAt).toLocaleString()}</dd></div><div><dt>{text('Last error', '最近错误')}</dt><dd>{selected.lastErrorCode ?? '-'}</dd></div></dl>
              <label className="delivery-reason"><span>{text('Reason code', '原因代码')}</span><input value={reasonCode} onChange={(event) => setReasonCode(event.target.value)} /></label>
              <div className="button-row">{canManage && selected.status === 'dead_lettered' && <button className="primary-button small" type="button" disabled={busy} onClick={() => void mutate(() => adminService.retryNotificationDelivery(selected.id, { expectedVersion: selected.version, reasonCode }), text('Delivery queued for retry.', '投递已进入重试队列。'))}><RotateCcw size={15}/>{text('Retry', '重试')}</button>}{canManage && ['queued', 'retry_scheduled'].includes(selected.status) && <button className="ghost-button danger small" type="button" disabled={busy} onClick={() => void mutate(() => adminService.cancelNotificationDelivery(selected.id, { expectedVersion: selected.version, reasonCode }), text('Delivery cancelled.', '投递已取消。'))}><XCircle size={15}/>{text('Cancel', '取消')}</button>}</div>
              <div className="delivery-attempt-list"><strong>{text('Attempts', '尝试记录')}</strong>{(selected.attempts ?? []).map((attempt) => <div key={attempt.id}><span>#{attempt.attemptNumber} · {attempt.status}</span><small>{attempt.errorCode ?? attempt.responseClass ?? '-'} · {new Date(attempt.startedAt).toLocaleString()}</small></div>)}{(selected.attempts ?? []).length === 0 && <small>{text('No external attempt recorded.', '暂无外部投递尝试。')}</small>}</div>
            </> : <div className="empty-state"><strong>{text('Select a delivery', '选择一条投递')}</strong></div>}
          </div>
        </div>
      </>}

      {view === 'metrics' && <>
        <div className="notification-admin-filters delivery-metric-filters">
          <label><span>{text('From', '开始')}</span><input aria-label={text('Metrics from', '指标开始日期')} type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
          <label><span>{text('To', '结束')}</span><input aria-label={text('Metrics to', '指标结束日期')} type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
          <select aria-label={text('Metrics channel', '指标渠道')} value={metricChannel} onChange={(event) => setMetricChannel(event.target.value as typeof metricChannel)}><option value="">{text('All channels', '全部渠道')}</option><option value="in_app">in_app</option><option value="email">email</option></select>
          <input aria-label={text('Notification type filter', '通知类型筛选')} placeholder={text('Notification type', '通知类型')} value={notificationType} onChange={(event) => setNotificationType(event.target.value)} />
          <button className="icon-button" type="button" title={text('Export metrics', '导出指标')} onClick={() => void download('metrics')}><Download size={16}/></button>
        </div>
        <div className="delivery-metric-summary">
          <div><small>{text('Delivery rate', '送达率')}</small><strong>{metrics ? percent(metrics.overall.deliveryRateBps) : '-'}</strong></div>
          <div><small>{text('Failure rate', '失败率')}</small><strong>{metrics ? percent(metrics.overall.failureRateBps) : '-'}</strong></div>
          <div><small>P95</small><strong>{metrics ? latency(metrics.overall.latency.p95Ms) : '-'}</strong></div>
          <div><small>{text('Pending', '待处理')}</small><strong>{metrics?.overall.pending ?? '-'}</strong></div>
        </div>
        <div className="delivery-channel-metrics">{metrics?.byChannel.map((item) => <div key={item.channel} className={item.breaches.any ? 'breached' : ''}><header><span>{item.breaches.any ? <AlertTriangle size={16}/> : <CheckCircle2 size={16}/>}<strong>{item.channel}</strong></span><small>{item.config?.effectiveEnabled ? text('Effective', '已生效') : text('Unavailable', '不可用')}</small></header><dl><div><dt>{text('Delivered', '已送达')}</dt><dd>{item.sent}/{item.terminalEligible}</dd></div><div><dt>{text('Delivery rate', '送达率')}</dt><dd>{percent(item.deliveryRateBps)} / {percent(item.config?.deliveryRateTargetBps ?? 0)}</dd></div><div><dt>{text('Failure rate', '失败率')}</dt><dd>{percent(item.failureRateBps)} / {percent(item.config?.failureRateAlertThresholdBps ?? 0)}</dd></div><div><dt>P95</dt><dd>{latency(item.latency.p95Ms)} / {latency(item.config?.latencyTargetMs ?? null)}</dd></div></dl></div>)}</div>
      </>}

      {view === 'channels' && <>
        <label className="delivery-reason channel-reason"><span>{text('Change reason code', '变更原因代码')}</span><input value={reasonCode} onChange={(event) => setReasonCode(event.target.value)} /></label>
        <div className="notification-channel-configs">{configs.map((config) => {
          const draft = drafts[config.channel] ?? draftFor(config)
          const revisions = history[config.channel] ?? []
          return <section key={config.channel} className="notification-channel-config" data-testid={`notification-channel-${config.channel}`}>
            <header><div><strong>{config.channel}</strong><small>v{config.version} · r{config.activeRevisionNumber} · {config.environmentAvailable ? text('environment ready', '环境就绪') : text('environment unavailable', '环境不可用')}</small></div><span className={config.effectiveEnabled ? 'status-badge success' : 'status-badge warning'}>{config.effectiveEnabled ? text('Effective', '已生效') : text('Disabled', '未生效')}</span></header>
            <div className="channel-config-fields">
              <label><span>{text('Enabled', '启用')}</span><input aria-label={`${config.channel} enabled`} type="checkbox" checked={draft.enabled} disabled={!canManage || config.channel === 'in_app'} onChange={(event) => setDrafts((current) => ({ ...current, [config.channel]: { ...draft, enabled: event.target.checked } }))} /></label>
              <label><span>{text('Delivery target (bps)', '送达目标（基点）')}</span><input aria-label={`${config.channel} delivery rate target`} type="number" min="0" max="10000" value={draft.deliveryRateTargetBps} disabled={!canManage} onChange={(event) => setDrafts((current) => ({ ...current, [config.channel]: { ...draft, deliveryRateTargetBps: Number(event.target.value) } }))} /></label>
              <label><span>{text('Failure alert (bps)', '失败告警（基点）')}</span><input aria-label={`${config.channel} failure rate threshold`} type="number" min="0" max="10000" value={draft.failureRateAlertThresholdBps} disabled={!canManage} onChange={(event) => setDrafts((current) => ({ ...current, [config.channel]: { ...draft, failureRateAlertThresholdBps: Number(event.target.value) } }))} /></label>
              <label><span>{text('P95 target (ms)', 'P95 目标（毫秒）')}</span><input aria-label={`${config.channel} latency target`} type="number" min="1" value={draft.latencyTargetMs} disabled={!canManage} onChange={(event) => setDrafts((current) => ({ ...current, [config.channel]: { ...draft, latencyTargetMs: Number(event.target.value) } }))} /></label>
              <label><span>{text('Max attempts', '最大尝试')}</span><input aria-label={`${config.channel} max attempts`} type="number" min="1" max="20" value={draft.maxAttempts} disabled={!canManage || config.channel === 'in_app'} onChange={(event) => setDrafts((current) => ({ ...current, [config.channel]: { ...draft, maxAttempts: Number(event.target.value) } }))} /></label>
              <label><span>{text('Backoff (s)', '退避（秒）')}</span><input aria-label={`${config.channel} retry backoff`} type="number" min="1" value={draft.retryBackoffSeconds} disabled={!canManage} onChange={(event) => setDrafts((current) => ({ ...current, [config.channel]: { ...draft, retryBackoffSeconds: Number(event.target.value) } }))} /></label>
            </div>
            <div className="button-row">{canManage && <button className="primary-button small" type="button" disabled={busy} onClick={() => void saveConfig(config)}><Save size={15}/>{text('Save', '保存')}</button>}<button className="ghost-button small" type="button" onClick={() => void loadHistory(config)}><History size={15}/>{text('History', '历史')}</button></div>
            {revisions.length > 0 && <div className="channel-config-history">{revisions.map((revision) => <div key={revision.id}><span><strong>r{revision.revisionNumber}</strong><small>{revision.reasonCode} · {new Date(revision.createdAt).toLocaleString()}</small></span>{canManage && revision.revisionNumber !== config.activeRevisionNumber && <button className="icon-button" type="button" title={text('Roll back to revision', '回滚到此修订')} disabled={busy} onClick={() => void rollback(config, revision.revisionNumber)}><RotateCcw size={15}/></button>}</div>)}</div>}
          </section>
        })}</div>
      </>}
    </section>
  )
}
