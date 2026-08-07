import { useCallback, useEffect, useState } from 'react'
import { Ban, Copy, RefreshCw, RotateCw, Save, Send, Trash2, Webhook } from 'lucide-react'
import { ActionFeedback, type ActionFeedbackMessage } from '../../components/ui/ActionFeedback'
import { OperationConfirmation } from '../../components/ui/OperationConfirmation'
import { SectionHeader } from '../../components/ui/SectionHeader'
import { textFor } from '../../domain/utils'
import { developerService } from '../../services/developerService'
import type { WebhookControl, WebhookDelivery, WebhookEventDefinition, WebhookSubscription } from '../../services/contracts'

type Props = { t: Record<string, string> }
type Draft = { name: string; endpointUrl: string; eventTypes: string[]; maxAttempts: number }
type PendingWebhookOperation = { kind: 'rotate' | 'delete'; subscription: WebhookSubscription }
const blankDraft = (control: WebhookControl | null): Draft => ({ name: '', endpointUrl: '', eventTypes: [], maxAttempts: control?.defaultMaxAttempts ?? 5 })
const replayKey = () => `webhook-replay-${Date.now()}-${crypto.randomUUID()}`

export function WebhookDeveloperPanel({ t }: Props) {
  const [control, setControl] = useState<WebhookControl | null>(null)
  const [events, setEvents] = useState<WebhookEventDefinition[]>([])
  const [subscriptions, setSubscriptions] = useState<WebhookSubscription[]>([])
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([])
  const [view, setView] = useState<'subscriptions' | 'deliveries'>('subscriptions')
  const [draft, setDraft] = useState<Draft>(blankDraft(null))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deliveryStatus, setDeliveryStatus] = useState('')
  const [oneTimeSecret, setOneTimeSecret] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<ActionFeedbackMessage | null>(null)
  const [pendingOperation, setPendingOperation] = useState<PendingWebhookOperation | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [nextControl, nextEvents, subscriptionPage, deliveryPage] = await Promise.all([
        developerService.webhookControl(), developerService.webhookEvents(),
        developerService.webhooks({ limit: 50, sort: 'updatedAt', order: 'desc' }),
        developerService.webhookDeliveries({ status: deliveryStatus || null, limit: 50, sort: 'createdAt', order: 'desc' }),
      ])
      setControl(nextControl); setEvents(nextEvents); setSubscriptions(subscriptionPage.items); setDeliveries(deliveryPage.items)
      setDraft((current) => current.eventTypes.length ? current : { ...current, maxAttempts: nextControl.defaultMaxAttempts, eventTypes: nextEvents[0] ? [nextEvents[0].key] : [] })
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : textFor(t, 'Could not load webhooks.', '无法读取 Webhook。')) }
  }, [deliveryStatus, t])

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer) }, [load])

  const submit = async () => {
    if (!draft.name.trim() || !draft.endpointUrl.trim() || !draft.eventTypes.length) return
    const wasEditing = Boolean(editingId)
    setBusy(editingId ?? 'create'); setError(null); setFeedback(null)
    try {
      if (editingId) {
        const current = subscriptions.find((item) => item.id === editingId)
        if (!current) return
        await developerService.updateWebhook(editingId, { ...draft, name: draft.name.trim(), endpointUrl: draft.endpointUrl.trim(), expectedVersion: current.version, reasonCode: 'owner_configuration_update' })
      } else {
        const result = await developerService.createWebhook({ ...draft, name: draft.name.trim(), endpointUrl: draft.endpointUrl.trim() })
        setOneTimeSecret(result.signingSecret)
      }
      setEditingId(null); setDraft(blankDraft(control)); await load()
      setFeedback({ kind: 'success', text: wasEditing ? textFor(t, 'Webhook subscription updated.', 'Webhook 订阅已更新。') : textFor(t, 'Webhook subscription created. Store the signing secret now.', 'Webhook 订阅已创建，请立即保存签名密钥。') })
    } catch (nextError) { setFeedback({ kind: 'error', text: nextError instanceof Error ? nextError.message : textFor(t, 'Webhook update failed.', 'Webhook 更新失败。') }) } finally { setBusy(null) }
  }

  const startEdit = (subscription: WebhookSubscription) => {
    setEditingId(subscription.id)
    setDraft({ name: subscription.name, endpointUrl: subscription.endpointUrl, eventTypes: subscription.eventTypes, maxAttempts: subscription.maxAttempts })
  }
  const transition = async (subscription: WebhookSubscription, action: 'enable' | 'disable') => {
    setBusy(subscription.id)
    setFeedback(null)
    try {
      await developerService.transitionWebhook(subscription.id, action, { expectedVersion: subscription.version, reasonCode: `owner_${action}` })
      await load()
      setFeedback({ kind: 'success', text: action === 'enable' ? textFor(t, 'Webhook subscription enabled.', 'Webhook 订阅已启用。') : textFor(t, 'Webhook subscription disabled.', 'Webhook 订阅已停用。') })
    } catch (nextError) { setFeedback({ kind: 'error', text: nextError instanceof Error ? nextError.message : textFor(t, 'Webhook transition failed.', 'Webhook 状态更新失败。') }) } finally { setBusy(null) }
  }
  const rotate = async (subscription: WebhookSubscription) => {
    setBusy(subscription.id)
    setFeedback(null)
    try {
      const result = await developerService.rotateWebhookSecret(subscription.id, { expectedVersion: subscription.version, reasonCode: 'owner_scheduled_rotation' })
      setOneTimeSecret(result.signingSecret)
      await load()
      setPendingOperation(null)
      setFeedback({ kind: 'success', text: textFor(t, `${subscription.name} signing secret rotated. Store it now.`, `${subscription.name} 的签名密钥已轮换，请立即保存。`) })
    } catch (nextError) { setFeedback({ kind: 'error', text: nextError instanceof Error ? nextError.message : textFor(t, 'Secret rotation failed.', '签名密钥轮换失败。') }) } finally { setBusy(null) }
  }
  const remove = async (subscription: WebhookSubscription) => {
    setBusy(subscription.id)
    setFeedback(null)
    try {
      await developerService.deleteWebhook(subscription.id, { expectedVersion: subscription.version, reasonCode: 'owner_deleted' })
      await load()
      setPendingOperation(null)
      setFeedback({ kind: 'success', text: textFor(t, `${subscription.name} was deleted.`, `${subscription.name} 已删除。`) })
    } catch (nextError) { setFeedback({ kind: 'error', text: nextError instanceof Error ? nextError.message : textFor(t, 'Webhook delete failed.', 'Webhook 删除失败。') }) } finally { setBusy(null) }
  }
  const replay = async (delivery: WebhookDelivery) => {
    setBusy(delivery.id)
    setFeedback(null)
    try {
      await developerService.replayWebhookDelivery(delivery.id, { expectedVersion: delivery.version, reasonCode: 'owner_endpoint_recovered', idempotencyKey: replayKey() })
      await load()
      setFeedback({ kind: 'success', text: textFor(t, 'Webhook delivery queued for replay.', 'Webhook 投递已进入重放队列。') })
    } catch (nextError) { setFeedback({ kind: 'error', text: nextError instanceof Error ? nextError.message : textFor(t, 'Replay failed.', '重放失败。') }) } finally { setBusy(null) }
  }

  const confirmPendingOperation = () => {
    if (!pendingOperation) return
    if (pendingOperation.kind === 'rotate') void rotate(pendingOperation.subscription)
    else void remove(pendingOperation.subscription)
  }

  const copyOneTimeSecret = async () => {
    if (!oneTimeSecret) return
    setFeedback(null)
    try {
      await navigator.clipboard.writeText(oneTimeSecret)
      setFeedback({ kind: 'success', text: textFor(t, 'Signing secret copied.', '签名密钥已复制。') })
    } catch (nextError) {
      setFeedback({ kind: 'error', text: nextError instanceof Error ? nextError.message : textFor(t, 'Could not copy the signing secret.', '无法复制签名密钥。') })
    }
  }

  return <section className="page-section webhook-developer" data-testid="webhook-developer-panel">
    <SectionHeader eyebrow="Webhook" title={textFor(t, 'Event delivery', '事件投递')} action={<button className="icon-button" type="button" onClick={() => void load()} title={textFor(t, 'Refresh', '刷新')}><RefreshCw size={17} /></button>} />
    {error && <div className="inline-alert error">{error}</div>}
    <ActionFeedback message={feedback} />
    {control && (!control.enabled || !control.secretEncryptionAvailable) && <div className="inline-alert warning"><Webhook size={18} />{!control.enabled ? textFor(t, 'Webhook delivery is disabled by an administrator.', '管理员尚未启用 Webhook 投递。') : textFor(t, 'Signing secret encryption is unavailable.', '签名密钥加密不可用。')}</div>}
    {oneTimeSecret && <div className="panel one-time-key" data-testid="one-time-webhook-secret"><SectionHeader eyebrow={textFor(t, 'Shown once', '仅显示一次')} title={textFor(t, 'Signing secret', '签名密钥')} /><div className="secret-display"><code>{oneTimeSecret}</code><button className="icon-button" type="button" title={textFor(t, 'Copy secret', '复制密钥')} onClick={() => void copyOneTimeSecret()}><Copy size={17} /></button></div><button className="ghost-button" type="button" onClick={() => setOneTimeSecret(null)}>{textFor(t, 'I stored it', '我已保存')}</button></div>}
    <div className="segmented-control webhook-view-toggle" role="tablist"><button type="button" className={view === 'subscriptions' ? 'active' : ''} onClick={() => setView('subscriptions')}>{textFor(t, 'Subscriptions', '订阅')}</button><button type="button" className={view === 'deliveries' ? 'active' : ''} onClick={() => setView('deliveries')}>{textFor(t, 'Deliveries', '投递')}</button></div>

    {view === 'subscriptions' && <>
      <div className="webhook-form"><label><span>{textFor(t, 'Name', '名称')}</span><input aria-label="Webhook name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} maxLength={80} /></label><label className="grow"><span>{textFor(t, 'HTTPS endpoint', 'HTTPS Endpoint')}</span><input aria-label="Webhook endpoint" value={draft.endpointUrl} onChange={(event) => setDraft({ ...draft, endpointUrl: event.target.value })} placeholder="https://example.com/webhooks" /></label><label><span>{textFor(t, 'Attempts', '尝试次数')}</span><input aria-label="Webhook max attempts" type="number" min="1" max="12" value={draft.maxAttempts} onChange={(event) => setDraft({ ...draft, maxAttempts: Number(event.target.value) })} /></label><button className="primary-button" type="button" onClick={() => void submit()} disabled={!control?.enabled || !control.secretEncryptionAvailable || busy === (editingId ?? 'create')}><Save size={16} />{editingId ? textFor(t, 'Save', '保存') : textFor(t, 'Create', '创建')}</button>{editingId && <button className="ghost-button" type="button" onClick={() => { setEditingId(null); setDraft(blankDraft(control)) }}><Ban size={16} />{textFor(t, 'Cancel', '取消')}</button>}</div>
      <div className="webhook-event-scope">{events.map((event) => <label key={event.key}><input type="checkbox" checked={draft.eventTypes.includes(event.key)} onChange={(change) => setDraft({ ...draft, eventTypes: change.target.checked ? [...draft.eventTypes, event.key] : draft.eventTypes.filter((item) => item !== event.key) })} /><span>{event.key}</span></label>)}</div>
      <div className="webhook-subscription-list">{subscriptions.filter((item) => item.status !== 'deleted').map((subscription) => <article className="webhook-subscription-row" key={subscription.id}><div className="webhook-row-main"><strong>{subscription.name}</strong><code>{subscription.endpointUrl}</code><span>{subscription.eventTypes.join(', ')} · {subscription.maxAttempts} {textFor(t, 'attempts', '次尝试')} · {subscription.signingSecretHint}</span></div><span className={`status-badge ${subscription.status === 'active' ? 'success' : 'warning'}`}>{subscription.status}</span><div className="button-row"><button className="icon-button" type="button" onClick={() => startEdit(subscription)} title={textFor(t, 'Edit subscription', '编辑订阅')}><Save size={15} /></button><button className="icon-button" type="button" onClick={() => setPendingOperation({ kind: 'rotate', subscription })} title={textFor(t, 'Rotate secret', '轮换密钥')} disabled={busy === subscription.id}><RotateCw size={15} /></button><button className="icon-button" type="button" onClick={() => void transition(subscription, subscription.status === 'active' ? 'disable' : 'enable')} title={subscription.status === 'active' ? textFor(t, 'Disable', '停用') : textFor(t, 'Enable', '启用')} disabled={busy === subscription.id}>{subscription.status === 'active' ? <Ban size={15} /> : <Send size={15} />}</button><button className="icon-button" type="button" onClick={() => setPendingOperation({ kind: 'delete', subscription })} title={textFor(t, 'Delete', '删除')} disabled={busy === subscription.id}><Trash2 size={15} /></button></div>{pendingOperation?.subscription.id === subscription.id && <OperationConfirmation ariaLabel={textFor(t, 'Confirm Webhook operation', '确认 Webhook 操作')} title={pendingOperation.kind === 'rotate' ? textFor(t, `Rotate ${subscription.name} signing secret?`, `轮换 ${subscription.name} 的签名密钥？`) : textFor(t, `Delete ${subscription.name}?`, `删除 ${subscription.name}？`)} description={pendingOperation.kind === 'rotate' ? textFor(t, 'The current signing secret stops immediately. The replacement is shown only once.', '当前签名密钥将立即失效，新密钥仅显示一次。') : textFor(t, 'This subscription will stop receiving events and cannot be restored.', '此订阅将停止接收事件，且无法恢复。')} confirmLabel={pendingOperation.kind === 'rotate' ? textFor(t, 'Rotate secret', '轮换密钥') : textFor(t, 'Delete subscription', '删除订阅')} cancelLabel={textFor(t, 'Back', '返回')} onConfirm={confirmPendingOperation} onCancel={() => setPendingOperation(null)} busy={busy === subscription.id} tone="danger" compact />}</article>)}{!subscriptions.filter((item) => item.status !== 'deleted').length && <div className="empty-state"><strong>{textFor(t, 'No webhook subscriptions', '暂无 Webhook 订阅')}</strong></div>}</div>
    </>}

    {view === 'deliveries' && <><div className="webhook-delivery-filter"><label><span>{textFor(t, 'Status', '状态')}</span><select value={deliveryStatus} onChange={(event) => setDeliveryStatus(event.target.value)}><option value="">{textFor(t, 'All', '全部')}</option><option value="queued">queued</option><option value="retry_scheduled">retry_scheduled</option><option value="succeeded">succeeded</option><option value="dead_lettered">dead_lettered</option><option value="cancelled">cancelled</option></select></label></div><div className="webhook-delivery-list">{deliveries.map((delivery) => <article className="webhook-delivery-row" key={delivery.id}><div><strong>{delivery.eventType}</strong><code>{delivery.id}</code><span>{delivery.subscriptionName} · {delivery.attemptCount}/{delivery.maxAttempts} · HTTP {delivery.lastStatusCode ?? '-'} · {delivery.lastErrorCode ?? textFor(t, 'No error', '无错误')}</span></div><span className={`status-badge ${delivery.status === 'succeeded' ? 'success' : delivery.status === 'dead_lettered' ? 'danger' : 'warning'}`}>{delivery.status}</span>{delivery.status === 'dead_lettered' && <button className="ghost-button small" type="button" onClick={() => void replay(delivery)} disabled={busy === delivery.id}><RefreshCw size={15} />{textFor(t, 'Replay', '重放')}</button>}</article>)}{!deliveries.length && <div className="empty-state"><strong>{textFor(t, 'No deliveries', '暂无投递')}</strong></div>}</div></>}
  </section>
}
