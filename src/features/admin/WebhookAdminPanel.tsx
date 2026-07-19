import { useCallback, useEffect, useState } from 'react'
import { Ban, Power, RefreshCw, Save, Search, Webhook } from 'lucide-react'
import { SectionHeader } from '../../components/ui/SectionHeader'
import { textFor } from '../../domain/utils'
import { adminService } from '../../services/adminService'
import type { WebhookControl, WebhookDelivery, WebhookMetrics, WebhookSubscription } from '../../services/contracts'

type Props = { t: Record<string, string>; canRead: boolean; canManage: boolean; notify: (message: string) => void }
const idempotencyKey = () => `admin-webhook-replay-${Date.now()}-${crypto.randomUUID()}`

export function WebhookAdminPanel({ t, canRead, canManage, notify }: Props) {
  const [control, setControl] = useState<WebhookControl | null>(null)
  const [metrics, setMetrics] = useState<WebhookMetrics | null>(null)
  const [subscriptions, setSubscriptions] = useState<WebhookSubscription[]>([])
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([])
  const [ownerHandle, setOwnerHandle] = useState('')
  const [subscriptionStatus, setSubscriptionStatus] = useState('')
  const [deliveryStatus, setDeliveryStatus] = useState('dead_lettered')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!canRead) return
    setError(null)
    try {
      const [nextControl, nextMetrics, subscriptionPage, deliveryPage] = await Promise.all([
        adminService.webhookControl(), adminService.webhookMetrics(),
        adminService.webhooks({ ownerHandle: ownerHandle || null, status: subscriptionStatus || null, limit: 50, sort: 'updatedAt', order: 'desc' }),
        adminService.webhookDeliveries({ ownerHandle: ownerHandle || null, status: deliveryStatus || null, limit: 50, sort: 'createdAt', order: 'desc' }),
      ])
      setControl(nextControl); setMetrics(nextMetrics); setSubscriptions(subscriptionPage.items); setDeliveries(deliveryPage.items)
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : textFor(t, 'Could not load webhook operations.', '无法读取 Webhook 运营数据。')) }
  }, [canRead, deliveryStatus, ownerHandle, subscriptionStatus, t])

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer) }, [load])

  const saveControl = async (enabled = control?.enabled) => {
    if (!control || !canManage) return
    setBusy('control')
    try {
      const updated = await adminService.updateWebhookControl({ enabled: Boolean(enabled), maxSubscriptionsPerUser: control.maxSubscriptionsPerUser, maxEventTypesPerSubscription: control.maxEventTypesPerSubscription, defaultMaxAttempts: control.defaultMaxAttempts, baseRetrySeconds: control.baseRetrySeconds, timeoutSeconds: control.timeoutSeconds, expectedVersion: control.version, reasonCode: enabled ? 'admin_enabled' : 'admin_disabled' })
      setControl(updated); notify(textFor(t, 'Webhook control updated.', 'Webhook 控制已更新。')); await load()
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : 'Webhook control update failed'); await load() } finally { setBusy(null) }
  }
  const disable = async (subscription: WebhookSubscription) => {
    if (!window.confirm(textFor(t, `Disable ${subscription.name}?`, `停用 ${subscription.name}？`))) return
    setBusy(subscription.id)
    try { await adminService.disableWebhook(subscription.id, { expectedVersion: subscription.version, reasonCode: 'admin_incident_containment' }); await load() }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : 'Disable failed') } finally { setBusy(null) }
  }
  const replay = async (delivery: WebhookDelivery) => {
    setBusy(delivery.id)
    try { await adminService.replayWebhookDelivery(delivery.id, { expectedVersion: delivery.version, reasonCode: 'admin_endpoint_recovered', idempotencyKey: idempotencyKey() }); await load() }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : 'Replay failed') } finally { setBusy(null) }
  }

  if (!canRead) return null
  return <section className="panel webhook-admin-panel" data-testid="webhook-admin-panel">
    <SectionHeader eyebrow={textFor(t, 'Developer platform', '开发者平台')} title={textFor(t, 'Webhook operations', 'Webhook 运营')} action={<button className="icon-button" type="button" onClick={() => void load()} title={textFor(t, 'Refresh', '刷新')}><RefreshCw size={17} /></button>} />
    {error && <div className="inline-alert error">{error}</div>}
    {control && <div className="webhook-control-grid"><div><Webhook size={18} /><strong>{control.enabled ? textFor(t, 'Enabled', '已启用') : textFor(t, 'Default off', '默认关闭')}</strong><span className={control.secretEncryptionAvailable ? 'status-badge success' : 'status-badge danger'}>{control.secretEncryptionAvailable ? textFor(t, 'Encryption ready', '加密就绪') : textFor(t, 'Key missing', '缺少密钥')}</span><button className={control.enabled ? 'ghost-button danger-button' : 'primary-button'} type="button" onClick={() => void saveControl(!control.enabled)} disabled={!canManage || busy === 'control' || (!control.enabled && !control.secretEncryptionAvailable)}><Power size={16} />{control.enabled ? textFor(t, 'Disable', '停用') : textFor(t, 'Enable', '启用')}</button></div><label><span>{textFor(t, 'Subscriptions per user', '每用户订阅数')}</span><input type="number" min="1" max="20" value={control.maxSubscriptionsPerUser} onChange={(event) => setControl({ ...control, maxSubscriptionsPerUser: Number(event.target.value) })} disabled={!canManage} /></label><label><span>{textFor(t, 'Default attempts', '默认尝试次数')}</span><input type="number" min="1" max="12" value={control.defaultMaxAttempts} onChange={(event) => setControl({ ...control, defaultMaxAttempts: Number(event.target.value) })} disabled={!canManage} /></label><label><span>{textFor(t, 'Backoff seconds', '退避秒数')}</span><input type="number" min="1" max="3600" value={control.baseRetrySeconds} onChange={(event) => setControl({ ...control, baseRetrySeconds: Number(event.target.value) })} disabled={!canManage} /></label><label><span>{textFor(t, 'Timeout seconds', '超时秒数')}</span><input type="number" min="1" max="30" value={control.timeoutSeconds} onChange={(event) => setControl({ ...control, timeoutSeconds: Number(event.target.value) })} disabled={!canManage} /></label><button className="ghost-button" type="button" onClick={() => void saveControl()} disabled={!canManage || busy === 'control'}><Save size={16} />{textFor(t, 'Save policy', '保存策略')}</button></div>}
    {metrics && <div className="developer-metric-strip webhook-metrics"><div><strong>{metrics.subscriptions.active}/{metrics.subscriptions.total}</strong><span>{textFor(t, 'active subscriptions', '活跃订阅')}</span></div><div><strong>{metrics.deliveries.queued}</strong><span>{textFor(t, 'queued', '等待投递')}</span></div><div><strong>{metrics.deliveries.succeeded}</strong><span>{textFor(t, 'succeeded', '成功')}</span></div><div><strong>{metrics.deliveries.deadLettered}</strong><span>DLQ</span></div><div><strong>{metrics.attempts}</strong><span>{textFor(t, 'attempts', '尝试')}</span></div></div>}
    <div className="webhook-admin-filters"><label><span>{textFor(t, 'Owner', 'Owner')}</span><input value={ownerHandle} onChange={(event) => setOwnerHandle(event.target.value)} /></label><label><span>{textFor(t, 'Subscription status', '订阅状态')}</span><select value={subscriptionStatus} onChange={(event) => setSubscriptionStatus(event.target.value)}><option value="">{textFor(t, 'All', '全部')}</option><option value="active">active</option><option value="disabled">disabled</option><option value="deleted">deleted</option></select></label><label><span>{textFor(t, 'Delivery status', '投递状态')}</span><select value={deliveryStatus} onChange={(event) => setDeliveryStatus(event.target.value)}><option value="">{textFor(t, 'All', '全部')}</option><option value="queued">queued</option><option value="retry_scheduled">retry_scheduled</option><option value="succeeded">succeeded</option><option value="dead_lettered">dead_lettered</option><option value="cancelled">cancelled</option></select></label><button className="ghost-button" type="button" onClick={() => void load()}><Search size={16} />{textFor(t, 'Apply', '查询')}</button></div>
    <div className="webhook-admin-columns"><div><h3>{textFor(t, 'Subscriptions', '订阅')}</h3><div className="webhook-admin-list">{subscriptions.map((subscription) => <div className="webhook-admin-row" key={subscription.id}><div><strong>{subscription.name}</strong><code>{subscription.endpointUrl}</code><span>@{subscription.owner?.handle ?? subscription.owner?.displayName} · {subscription.eventTypes.join(', ')}</span></div><span className={`status-badge ${subscription.status === 'active' ? 'success' : 'warning'}`}>{subscription.status}</span>{subscription.status === 'active' && <button className="icon-button" type="button" onClick={() => void disable(subscription)} disabled={!canManage || busy === subscription.id} title={textFor(t, 'Disable subscription', '停用订阅')}><Ban size={15} /></button>}</div>)}</div></div><div><h3>{textFor(t, 'Deliveries', '投递')}</h3><div className="webhook-admin-list">{deliveries.map((delivery) => <div className="webhook-admin-row" key={delivery.id}><div><strong>{delivery.eventType}</strong><code>{delivery.id}</code><span>@{delivery.owner?.handle ?? delivery.owner?.displayName} · {delivery.attemptCount}/{delivery.maxAttempts} · {delivery.lastErrorCode ?? 'ok'}</span></div><span className={`status-badge ${delivery.status === 'succeeded' ? 'success' : delivery.status === 'dead_lettered' ? 'danger' : 'warning'}`}>{delivery.status}</span>{delivery.status === 'dead_lettered' && <button className="ghost-button small" type="button" onClick={() => void replay(delivery)} disabled={!canManage || busy === delivery.id}><RefreshCw size={14} />{textFor(t, 'Replay', '重放')}</button>}</div>)}</div></div></div>
  </section>
}
