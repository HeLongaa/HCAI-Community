import { useCallback, useEffect, useState } from 'react'
import { Ban, BellRing, Power, RefreshCw, Save, Search, Webhook } from 'lucide-react'
import { SectionHeader } from '../../components/ui/SectionHeader'
import { textFor } from '../../domain/utils'
import { adminService } from '../../services/adminService'
import type {
  ProviderAlertDelivery,
  ProviderAlertDeliveryChannel,
  ProviderAlertDeliveryStatus,
  WebhookControl,
  WebhookDelivery,
  WebhookMetrics,
  WebhookSubscription,
} from '../../services/contracts'
import { AdminActionFeedback, type AdminActionFeedbackMessage } from './AdminActionFeedback'
import { AdminOperationConfirmation } from './AdminOperationConfirmation'

type Props = { t: Record<string, string>; canRead: boolean; canManage: boolean }

const idempotencyKey = (scope: string) => `admin-${scope}-${Date.now()}-${crypto.randomUUID()}`
const statusTone = (status: string) => status === 'succeeded' || status === 'active'
  ? 'success'
  : status === 'dead_lettered' || status === 'cancelled'
    ? 'danger'
    : 'warning'
const compactDate = (value: string | null) => value
  ? new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
  : '-'

export function WebhookAdminPanel({ t, canRead, canManage }: Props) {
  const [control, setControl] = useState<WebhookControl | null>(null)
  const [metrics, setMetrics] = useState<WebhookMetrics | null>(null)
  const [subscriptions, setSubscriptions] = useState<WebhookSubscription[]>([])
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([])
  const [providerAlerts, setProviderAlerts] = useState<ProviderAlertDelivery[]>([])
  const [ownerHandle, setOwnerHandle] = useState('')
  const [subscriptionStatus, setSubscriptionStatus] = useState('')
  const [deliveryStatus, setDeliveryStatus] = useState('dead_lettered')
  const [providerAlertStatus, setProviderAlertStatus] = useState<ProviderAlertDeliveryStatus | ''>('dead_lettered')
  const [providerAlertChannel, setProviderAlertChannel] = useState<ProviderAlertDeliveryChannel | ''>('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [providerAlertError, setProviderAlertError] = useState<string | null>(null)
  const [providerAlertsLoaded, setProviderAlertsLoaded] = useState(false)
  const [feedback, setFeedback] = useState<AdminActionFeedbackMessage | null>(null)
  const [pendingDisable, setPendingDisable] = useState<WebhookSubscription | null>(null)

  const loadWebhooks = useCallback(async () => {
    if (!canRead) return
    setError(null)
    try {
      const [nextControl, nextMetrics, subscriptionPage, deliveryPage] = await Promise.all([
        adminService.webhookControl(),
        adminService.webhookMetrics(),
        adminService.webhooks({ ownerHandle: ownerHandle || null, status: subscriptionStatus || null, limit: 50, sort: 'updatedAt', order: 'desc' }),
        adminService.webhookDeliveries({ ownerHandle: ownerHandle || null, status: deliveryStatus || null, limit: 50, sort: 'createdAt', order: 'desc' }),
      ])
      setControl(nextControl)
      setMetrics(nextMetrics)
      setSubscriptions(subscriptionPage.items)
      setDeliveries(deliveryPage.items)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : textFor(t, 'Could not load webhook operations.', '无法读取 Webhook 运营数据。'))
    }
  }, [canRead, deliveryStatus, ownerHandle, subscriptionStatus, t])

  const loadProviderAlerts = useCallback(async () => {
    if (!canRead) return
    setProviderAlertError(null)
    try {
      const page = await adminService.providerAlertDeliveries({
        status: providerAlertStatus || null,
        channel: providerAlertChannel || null,
        limit: 50,
      })
      setProviderAlerts(page.items)
    } catch (nextError) {
      setProviderAlertError(nextError instanceof Error ? nextError.message : textFor(t, 'Could not load provider alerts.', '无法读取 Provider 告警投递。'))
    } finally {
      setProviderAlertsLoaded(true)
    }
  }, [canRead, providerAlertChannel, providerAlertStatus, t])

  const refreshAll = useCallback(async () => {
    await Promise.all([loadWebhooks(), loadProviderAlerts()])
  }, [loadProviderAlerts, loadWebhooks])

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshAll(), 0)
    return () => window.clearTimeout(timer)
  }, [refreshAll])

  const saveControl = async (enabled = control?.enabled) => {
    if (!control || !canManage) return
    setBusy('control')
    setError(null)
    setFeedback(null)
    try {
      const updated = await adminService.updateWebhookControl({
        enabled: Boolean(enabled),
        maxSubscriptionsPerUser: control.maxSubscriptionsPerUser,
        maxEventTypesPerSubscription: control.maxEventTypesPerSubscription,
        defaultMaxAttempts: control.defaultMaxAttempts,
        baseRetrySeconds: control.baseRetrySeconds,
        timeoutSeconds: control.timeoutSeconds,
        expectedVersion: control.version,
        reasonCode: enabled ? 'admin_enabled' : 'admin_disabled',
      })
      setControl(updated)
      await loadWebhooks()
      setFeedback({ kind: 'success', text: textFor(t, 'Webhook control updated.', 'Webhook 控制已更新。') })
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : 'Webhook control update failed'
      await loadWebhooks()
      setError(message)
    } finally {
      setBusy(null)
    }
  }

  const disable = async (subscription: WebhookSubscription) => {
    setBusy(subscription.id)
    setError(null)
    setFeedback(null)
    try {
      await adminService.disableWebhook(subscription.id, { expectedVersion: subscription.version, reasonCode: 'admin_incident_containment' })
      await loadWebhooks()
      setPendingDisable(null)
      setFeedback({ kind: 'success', text: textFor(t, 'Webhook subscription disabled.', 'Webhook 订阅已停用。') })
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Disable failed')
    } finally {
      setBusy(null)
    }
  }

  const replay = async (delivery: WebhookDelivery) => {
    setBusy(delivery.id)
    setError(null)
    setFeedback(null)
    try {
      await adminService.replayWebhookDelivery(delivery.id, {
        expectedVersion: delivery.version,
        reasonCode: 'admin_endpoint_recovered',
        idempotencyKey: idempotencyKey('webhook-replay'),
      })
      await loadWebhooks()
      setFeedback({ kind: 'success', text: textFor(t, 'Webhook delivery queued for replay.', 'Webhook 投递已进入重放队列。') })
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Replay failed')
    } finally {
      setBusy(null)
    }
  }

  const replayProviderAlert = async (delivery: ProviderAlertDelivery) => {
    const busyKey = `provider-alert:${delivery.id}`
    setBusy(busyKey)
    setProviderAlertError(null)
    setFeedback(null)
    try {
      await adminService.replayProviderAlertDelivery(delivery.id, {
        expectedVersion: delivery.version,
        reasonCode: 'provider_channel_recovered',
        idempotencyKey: idempotencyKey('provider-alert-replay'),
        maxAttempts: 5,
      })
      await loadProviderAlerts()
      setFeedback({ kind: 'success', text: textFor(t, 'Provider alert queued for replay.', 'Provider 告警已进入重放队列。') })
    } catch (nextError) {
      setProviderAlertError(nextError instanceof Error ? nextError.message : textFor(t, 'Provider alert replay failed.', 'Provider 告警重放失败。'))
    } finally {
      setBusy(null)
    }
  }

  if (!canRead) return null

  return <section className="panel webhook-admin-panel" data-testid="webhook-admin-panel">
    <SectionHeader
      eyebrow={textFor(t, 'Developer platform', '开发者平台')}
      title={textFor(t, 'Webhook operations', 'Webhook 运营')}
      action={<button className="icon-button" type="button" onClick={() => void refreshAll()} title={textFor(t, 'Refresh', '刷新')}><RefreshCw size={17} /></button>}
    />
    {error && <div className="inline-alert error">{error}</div>}
    <AdminActionFeedback message={feedback} />
    {pendingDisable && <AdminOperationConfirmation
      ariaLabel={textFor(t, 'Confirm Webhook subscription disable', '确认停用 Webhook 订阅')}
      title={textFor(t, `Disable ${pendingDisable.name}?`, `停用 ${pendingDisable.name}？`)}
      description={textFor(t, 'New events will no longer be delivered to this endpoint. Existing delivery evidence remains available.', '新事件将不再投递到此端点，已有投递证据仍会保留。')}
      confirmLabel={textFor(t, 'Disable subscription', '停用订阅')}
      cancelLabel={textFor(t, 'Back', '返回')}
      onConfirm={() => void disable(pendingDisable)}
      onCancel={() => setPendingDisable(null)}
      busy={busy === pendingDisable.id}
    />}
    {control && <div className="webhook-control-grid">
      <div><Webhook size={18} /><strong>{control.enabled ? textFor(t, 'Enabled', '已启用') : textFor(t, 'Default off', '默认关闭')}</strong><span className={control.secretEncryptionAvailable ? 'status-badge success' : 'status-badge danger'}>{control.secretEncryptionAvailable ? textFor(t, 'Encryption ready', '加密就绪') : textFor(t, 'Key missing', '缺少密钥')}</span><button className={control.enabled ? 'ghost-button danger-button' : 'primary-button'} type="button" onClick={() => void saveControl(!control.enabled)} disabled={!canManage || busy === 'control' || (!control.enabled && !control.secretEncryptionAvailable)}><Power size={16} />{control.enabled ? textFor(t, 'Disable', '停用') : textFor(t, 'Enable', '启用')}</button></div>
      <label><span>{textFor(t, 'Subscriptions per user', '每用户订阅数')}</span><input type="number" min="1" max="20" value={control.maxSubscriptionsPerUser} onChange={(event) => setControl({ ...control, maxSubscriptionsPerUser: Number(event.target.value) })} disabled={!canManage} /></label>
      <label><span>{textFor(t, 'Default attempts', '默认尝试次数')}</span><input type="number" min="1" max="12" value={control.defaultMaxAttempts} onChange={(event) => setControl({ ...control, defaultMaxAttempts: Number(event.target.value) })} disabled={!canManage} /></label>
      <label><span>{textFor(t, 'Backoff seconds', '退避秒数')}</span><input type="number" min="1" max="3600" value={control.baseRetrySeconds} onChange={(event) => setControl({ ...control, baseRetrySeconds: Number(event.target.value) })} disabled={!canManage} /></label>
      <label><span>{textFor(t, 'Timeout seconds', '超时秒数')}</span><input type="number" min="1" max="30" value={control.timeoutSeconds} onChange={(event) => setControl({ ...control, timeoutSeconds: Number(event.target.value) })} disabled={!canManage} /></label>
      <button className="ghost-button" type="button" onClick={() => void saveControl()} disabled={!canManage || busy === 'control'}><Save size={16} />{textFor(t, 'Save policy', '保存策略')}</button>
    </div>}
    {metrics && <div className="developer-metric-strip webhook-metrics"><div><strong>{metrics.subscriptions.active}/{metrics.subscriptions.total}</strong><span>{textFor(t, 'active subscriptions', '活跃订阅')}</span></div><div><strong>{metrics.deliveries.queued}</strong><span>{textFor(t, 'queued', '等待投递')}</span></div><div><strong>{metrics.deliveries.succeeded}</strong><span>{textFor(t, 'succeeded', '成功')}</span></div><div><strong>{metrics.deliveries.deadLettered}</strong><span>DLQ</span></div><div><strong>{metrics.attempts}</strong><span>{textFor(t, 'attempts', '尝试')}</span></div></div>}
    <div className="webhook-admin-filters">
      <label><span>{textFor(t, 'Owner', 'Owner')}</span><input value={ownerHandle} onChange={(event) => setOwnerHandle(event.target.value)} /></label>
      <label><span>{textFor(t, 'Subscription status', '订阅状态')}</span><select value={subscriptionStatus} onChange={(event) => setSubscriptionStatus(event.target.value)}><option value="">{textFor(t, 'All', '全部')}</option><option value="active">active</option><option value="disabled">disabled</option><option value="deleted">deleted</option></select></label>
      <label><span>{textFor(t, 'Delivery status', '投递状态')}</span><select value={deliveryStatus} onChange={(event) => setDeliveryStatus(event.target.value)}><option value="">{textFor(t, 'All', '全部')}</option><option value="queued">queued</option><option value="retry_scheduled">retry_scheduled</option><option value="succeeded">succeeded</option><option value="dead_lettered">dead_lettered</option><option value="cancelled">cancelled</option></select></label>
      <button className="ghost-button" type="button" onClick={() => void loadWebhooks()}><Search size={16} />{textFor(t, 'Apply', '查询')}</button>
    </div>
    <div className="webhook-admin-columns">
      <div><h3>{textFor(t, 'Subscriptions', '订阅')}</h3><div className="webhook-admin-list">{subscriptions.length === 0 && <div className="webhook-admin-empty">{textFor(t, 'No matching subscriptions.', '没有符合条件的订阅。')}</div>}{subscriptions.map((subscription) => <div className="webhook-admin-row" key={subscription.id}><div><strong>{subscription.name}</strong><code>{subscription.endpointUrl}</code><span>@{subscription.owner?.handle ?? subscription.owner?.displayName} · {subscription.eventTypes.join(', ')}</span></div><span className={`status-badge ${statusTone(subscription.status)}`}>{subscription.status}</span>{subscription.status === 'active' && <button className="icon-button" type="button" onClick={() => setPendingDisable(subscription)} disabled={!canManage || busy === subscription.id} title={textFor(t, 'Disable subscription', '停用订阅')}><Ban size={15} /></button>}</div>)}</div></div>
      <div><h3>{textFor(t, 'Deliveries', '投递')}</h3><div className="webhook-admin-list">{deliveries.length === 0 && <div className="webhook-admin-empty">{textFor(t, 'No matching deliveries.', '没有符合条件的投递。')}</div>}{deliveries.map((delivery) => <div className="webhook-admin-row" key={delivery.id}><div><strong>{delivery.eventType}</strong><code>{delivery.id}</code><span>@{delivery.owner?.handle ?? delivery.owner?.displayName} · {delivery.attemptCount}/{delivery.maxAttempts} · {delivery.lastErrorCode ?? 'ok'}</span></div><span className={`status-badge ${statusTone(delivery.status)}`}>{delivery.status}</span>{delivery.status === 'dead_lettered' && <button className="ghost-button small" type="button" onClick={() => void replay(delivery)} disabled={!canManage || busy === delivery.id}><RefreshCw size={14} />{textFor(t, 'Replay', '重放')}</button>}</div>)}</div></div>
    </div>

    <section className="provider-alert-section" data-testid="provider-alert-section">
      <div className="provider-alert-heading"><div><BellRing size={18} /><div><h3>{textFor(t, 'Provider alert delivery', 'Provider 告警投递')}</h3><p>{textFor(t, 'Operational delivery state for budget and provider incidents.', '预算与 Provider 事件的外部告警投递状态。')}</p></div></div><span className="status-badge neutral">{providerAlerts.length}</span></div>
      {providerAlertError && <div className="inline-alert error">{providerAlertError}</div>}
      <div className="provider-alert-toolbar">
        <label><span>{textFor(t, 'Status', '状态')}</span><select aria-label={textFor(t, 'Provider alert status', 'Provider 告警状态')} value={providerAlertStatus} onChange={(event) => setProviderAlertStatus(event.target.value as ProviderAlertDeliveryStatus | '')}><option value="">{textFor(t, 'All', '全部')}</option><option value="queued">queued</option><option value="processing">processing</option><option value="retry_scheduled">retry_scheduled</option><option value="succeeded">succeeded</option><option value="dead_lettered">dead_lettered</option><option value="cancelled">cancelled</option></select></label>
        <label><span>{textFor(t, 'Channel', '通道')}</span><select aria-label={textFor(t, 'Provider alert channel', 'Provider 告警通道')} value={providerAlertChannel} onChange={(event) => setProviderAlertChannel(event.target.value as ProviderAlertDeliveryChannel | '')}><option value="">{textFor(t, 'All', '全部')}</option><option value="webhook">webhook</option><option value="slack">slack</option><option value="email">email</option></select></label>
        <button className="ghost-button" type="button" onClick={() => void loadProviderAlerts()}><Search size={16} />{textFor(t, 'Apply', '查询')}</button>
      </div>
      <div className="provider-alert-list">
        {providerAlertsLoaded && providerAlerts.length === 0 && !providerAlertError && <div className="webhook-admin-empty">{textFor(t, 'No provider alerts match these filters.', '没有符合当前筛选条件的 Provider 告警。')}</div>}
        {providerAlerts.map((delivery) => <article className="provider-alert-row" key={delivery.id}>
          <div className="provider-alert-primary"><div><strong>{delivery.action}</strong><span className={`status-badge ${statusTone(delivery.status)}`}>{delivery.status}</span></div><code title={delivery.sourceKey}>{delivery.sourceKey}</code></div>
          <dl><div><dt>{textFor(t, 'Channel', '通道')}</dt><dd>{delivery.channel}</dd></div><div><dt>{textFor(t, 'Attempts', '尝试')}</dt><dd>{delivery.attemptCount}/{delivery.maxAttempts}</dd></div><div><dt>HTTP</dt><dd>{delivery.lastStatusCode ?? '-'}</dd></div><div><dt>{textFor(t, 'Error', '错误')}</dt><dd title={delivery.lastErrorCode ?? undefined}>{delivery.lastErrorCode ?? '-'}</dd></div><div><dt>{textFor(t, 'Updated', '更新时间')}</dt><dd>{compactDate(delivery.updatedAt)}</dd></div></dl>
          {delivery.status === 'dead_lettered' && <button className="ghost-button small provider-alert-replay" type="button" onClick={() => void replayProviderAlert(delivery)} disabled={!canManage || busy === `provider-alert:${delivery.id}`}><RefreshCw size={14} />{textFor(t, 'Replay', '重放')}</button>}
        </article>)}
      </div>
    </section>
  </section>
}
