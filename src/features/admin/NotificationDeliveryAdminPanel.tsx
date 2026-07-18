import { useCallback, useEffect, useState } from 'react'
import { Download, RefreshCw, RotateCcw, XCircle } from 'lucide-react'
import { adminService } from '../../services/adminService'
import type { NotificationDelivery, NotificationDeliveryMetrics, NotificationDeliveryStatus } from '../../services/contracts'

const statuses: NotificationDeliveryStatus[] = ['queued', 'processing', 'retry_scheduled', 'sent', 'suppressed', 'dead_lettered', 'cancelled']

export function NotificationDeliveryAdminPanel({ canManage, isZh, notify }: {
  canManage: boolean
  isZh: boolean
  notify: (message: string) => void
}) {
  const text = (en: string, zh: string) => isZh ? zh : en
  const [items, setItems] = useState<NotificationDelivery[]>([])
  const [selected, setSelected] = useState<NotificationDelivery | null>(null)
  const [metrics, setMetrics] = useState<NotificationDeliveryMetrics | null>(null)
  const [status, setStatus] = useState<NotificationDeliveryStatus | ''>('')
  const [channel, setChannel] = useState<'' | 'in_app' | 'email'>('')
  const [search, setSearch] = useState('')
  const [cursor, setCursor] = useState<string | null>(null)
  const [reasonCode, setReasonCode] = useState('operator_requested')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (append = false) => {
    setBusy(true)
    setError(null)
    try {
      const [page, summary] = await Promise.all([
        adminService.notificationDeliveries({ status: status || null, channel: channel || null, search: search || null, cursor: append ? cursor : null, limit: 25 }),
        adminService.notificationDeliveryMetrics(),
      ])
      setItems((current) => append ? [...current, ...page.items] : page.items)
      setCursor(page.nextCursor)
      setMetrics(summary)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }, [channel, cursor, search, status])

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
      const updated = await operation()
      setSelected(updated)
      await load(false)
      notify(message)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const download = async () => {
    try {
      const body = await adminService.exportNotificationDeliveries({ status: status || null, channel: channel || null, search: search || null })
      const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `notification-deliveries-${new Date().toISOString().slice(0, 10)}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }

  return (
    <section className="panel notification-delivery-panel" data-testid="notification-delivery-panel">
      <div className="admin-section-heading">
        <div><strong>{text('Delivery queue', '投递队列')}</strong><small>{metrics ? `${metrics.total} ${text('deliveries', '条投递')} · ${metrics.deadLettered} DLQ · ${metrics.due} ${text('due', '待处理')}` : ''}</small></div>
        <div className="button-row">
          <span className={metrics?.config.emailAvailable ? 'status-badge success' : 'status-badge warning'}>{metrics?.config.emailAvailable ? text('Email available', 'Email 可用') : text('Email unavailable', 'Email 不可用')}</span>
          <button className="icon-button" type="button" title={text('Export CSV', '导出 CSV')} onClick={() => void download()}><Download size={16}/></button>
          <button className="icon-button" type="button" title={text('Refresh', '刷新')} onClick={() => void load(false)}><RefreshCw size={16}/></button>
        </div>
      </div>
      <div className="notification-admin-filters delivery-filters">
        <input aria-label={text('Search deliveries', '搜索投递')} placeholder={text('Search ID, title, or type', '搜索 ID、标题或类型')} value={search} onChange={(event) => setSearch(event.target.value)} />
        <select aria-label={text('Delivery status', '投递状态')} value={status} onChange={(event) => setStatus(event.target.value as NotificationDeliveryStatus | '')}><option value="">{text('All statuses', '全部状态')}</option>{statuses.map((value) => <option key={value} value={value}>{value}</option>)}</select>
        <select aria-label={text('Delivery channel', '投递渠道')} value={channel} onChange={(event) => setChannel(event.target.value as typeof channel)}><option value="">{text('All channels', '全部渠道')}</option><option value="in_app">in_app</option><option value="email">email</option></select>
      </div>
      {error && <div className="inline-error" role="alert">{error}</div>}
      <div className="notification-delivery-layout">
        <div className="admin-table notification-delivery-list">
          {items.map((item) => <button className={`admin-row compact ${selected?.id === item.id ? 'selected' : ''}`} type="button" key={item.id} onClick={() => void open(item)}>
            <span><strong>{item.notification?.title ?? item.notificationId}</strong><small>{item.notification?.type} · {item.channel} · {item.attemptCount}/{item.maxAttempts}</small></span>
            <span className={`status ${item.status}`}>{item.status}</span>
          </button>)}
          {!busy && items.length === 0 && <div className="empty-state"><strong>{text('No deliveries', '暂无投递')}</strong></div>}
          {cursor && <button className="ghost-button small" type="button" disabled={busy} onClick={() => void load(true)}>{text('Load more', '加载更多')}</button>}
        </div>
        <div className="notification-delivery-detail">
          {selected ? <>
            <div className="delivery-detail-header"><div><strong>{selected.notification?.title}</strong><small>{selected.id}</small></div><span className={`status ${selected.status}`}>{selected.status}</span></div>
            <dl className="delivery-facts"><div><dt>{text('Recipient', '收件人')}</dt><dd>{selected.notification?.recipient?.emailHint ?? selected.notification?.recipient?.handle ?? '-'}</dd></div><div><dt>{text('Channel', '渠道')}</dt><dd>{selected.channel}</dd></div><div><dt>{text('Available', '可处理时间')}</dt><dd>{new Date(selected.availableAt).toLocaleString()}</dd></div><div><dt>{text('Last error', '最近错误')}</dt><dd>{selected.lastErrorCode ?? '-'}</dd></div></dl>
            <label className="delivery-reason"><span>{text('Reason code', '原因代码')}</span><input value={reasonCode} onChange={(event) => setReasonCode(event.target.value)} /></label>
            <div className="button-row">
              {canManage && selected.status === 'dead_lettered' && <button className="primary-button small" type="button" disabled={busy} onClick={() => void mutate(() => adminService.retryNotificationDelivery(selected.id, { expectedVersion: selected.version, reasonCode }), text('Delivery queued for retry.', '投递已进入重试队列。'))}><RotateCcw size={15}/>{text('Retry', '重试')}</button>}
              {canManage && ['queued', 'retry_scheduled'].includes(selected.status) && <button className="ghost-button danger small" type="button" disabled={busy} onClick={() => void mutate(() => adminService.cancelNotificationDelivery(selected.id, { expectedVersion: selected.version, reasonCode }), text('Delivery cancelled.', '投递已取消。'))}><XCircle size={15}/>{text('Cancel', '取消')}</button>}
            </div>
            <div className="delivery-attempt-list"><strong>{text('Attempts', '尝试记录')}</strong>{(selected.attempts ?? []).map((attempt) => <div key={attempt.id}><span>#{attempt.attemptNumber} · {attempt.status}</span><small>{attempt.errorCode ?? attempt.responseClass ?? '-'} · {new Date(attempt.startedAt).toLocaleString()}</small></div>)}{(selected.attempts ?? []).length === 0 && <small>{text('No external attempt recorded.', '暂无外部投递尝试。')}</small>}</div>
          </> : <div className="empty-state"><strong>{text('Select a delivery', '选择一条投递')}</strong></div>}
        </div>
      </div>
    </section>
  )
}
