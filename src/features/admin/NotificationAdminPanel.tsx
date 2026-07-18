import { useCallback, useEffect, useMemo, useState } from 'react'
import { Archive, Download, Eye, Plus, RefreshCw, RotateCcw, Save, Send, Undo2 } from 'lucide-react'
import { adminService } from '../../services/adminService'
import type { NotificationTemplate, NotificationTemplateDraft, NotificationTemplateMetrics } from '../../services/contracts'
import type { Permission } from '../../domain/types'
import { NotificationDeliveryAdminPanel } from './NotificationDeliveryAdminPanel'

const emptyDraft: NotificationTemplateDraft & { key: string } = {
  key: '', name: '', description: '', category: 'general', locale: 'en',
  titleTemplate: '', bodyTemplate: '',
  variableSchema: { additionalProperties: false, required: [], properties: {} },
}

export function NotificationAdminPanel({ hasPermission, isZh, notify }: {
  hasPermission: (permission: Permission) => boolean
  isZh: boolean
  notify: (message: string) => void
}) {
  const text = (en: string, zh: string) => isZh ? zh : en
  const [items, setItems] = useState<NotificationTemplate[]>([])
  const [selected, setSelected] = useState<NotificationTemplate | null>(null)
  const [metrics, setMetrics] = useState<NotificationTemplateMetrics | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [schemaText, setSchemaText] = useState(JSON.stringify(emptyDraft.variableSchema, null, 2))
  const [variablesText, setVariablesText] = useState('{}')
  const [preview, setPreview] = useState<{ title: string; body: string } | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [reasonCode, setReasonCode] = useState('operator_requested')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'templates' | 'deliveries'>('templates')

  const canRead = hasPermission('admin:notifications:read')
  const canManage = hasPermission('admin:notifications:manage')
  const canPublish = hasPermission('admin:notifications:publish')

  const load = useCallback(async () => {
    if (!canRead) return
    setBusy(true)
    setError(null)
    try {
      const [page, summary] = await Promise.all([
        adminService.notificationTemplates({ search: search || null, status: status ? status as NotificationTemplate['status'] : null, includeDeleted: true, limit: 100 }),
        adminService.notificationTemplateMetrics(),
      ])
      setItems(page.items)
      setMetrics(summary)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }, [canRead, search, status])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const selectTemplate = async (item: NotificationTemplate) => {
    setBusy(true)
    try {
      const detail = await adminService.notificationTemplate(item.id)
      const latest = detail.versions?.[0]
      setSelected(detail)
      setDraft({
        key: detail.key, name: detail.name, description: detail.description ?? '', category: detail.category,
        locale: latest?.locale ?? 'en', titleTemplate: latest?.titleTemplate ?? '', bodyTemplate: latest?.bodyTemplate ?? '',
        variableSchema: latest?.variableSchema ?? emptyDraft.variableSchema,
      })
      setSchemaText(JSON.stringify(latest?.variableSchema ?? emptyDraft.variableSchema, null, 2))
      setPreview(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const parsedDraft = () => ({ ...draft, variableSchema: JSON.parse(schemaText) })
  const mutate = async (operation: () => Promise<NotificationTemplate>, message: string) => {
    setBusy(true)
    setError(null)
    try {
      const updated = await operation()
      await selectTemplate(updated)
      await load()
      notify(message)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const save = () => selected
    ? mutate(() => adminService.updateNotificationTemplate(selected.id, { ...parsedDraft(), expectedVersion: selected.version }), text('Draft version created.', '草稿版本已创建。'))
    : mutate(() => adminService.createNotificationTemplate(parsedDraft()), text('Template created.', '模板已创建。'))

  const latestDraft = selected?.versions?.find((version) => version.status === 'draft')
  const publishedVersions = useMemo(() => selected?.versions?.filter((version) => version.publishedAt) ?? [], [selected])

  const runPreview = async (versionNumber = latestDraft?.versionNumber ?? selected?.activeVersionNumber) => {
    if (!selected || !versionNumber) return
    setBusy(true)
    setError(null)
    try {
      setPreview(await adminService.previewNotificationTemplate(selected.id, versionNumber, JSON.parse(variablesText)))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const download = async () => {
    try {
      const body = await adminService.exportNotificationTemplates({ search: search || null, status: status ? status as NotificationTemplate['status'] : null, includeDeleted: true })
      const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `notification-templates-${new Date().toISOString().slice(0, 10)}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  if (!canRead) return <section className="panel"><div className="empty-state"><strong>{text('Notification operations unavailable', '通知运营不可用')}</strong></div></section>

  const viewTabs = <div className="notification-view-tabs" role="tablist" aria-label={text('Notification operations view', '通知运营视图')}><button type="button" role="tab" aria-selected={view === 'templates'} className={view === 'templates' ? 'active' : ''} onClick={() => setView('templates')}>{text('Templates', '模板')}</button><button type="button" role="tab" aria-selected={view === 'deliveries'} className={view === 'deliveries' ? 'active' : ''} onClick={() => setView('deliveries')}>{text('Delivery queue', '投递队列')}</button></div>

  if (view === 'deliveries') return <>{viewTabs}<NotificationDeliveryAdminPanel canManage={canManage} isZh={isZh} notify={notify} /></>

  return (
    <>{viewTabs}<section className="panel notification-admin-panel" data-testid="notification-admin-panel">
      <div className="admin-section-heading">
        <div><strong>{text('Notification templates', '通知模板')}</strong><small>{metrics ? `${metrics.published}/${metrics.total} ${text('published', '已发布')} · ${metrics.disabledPreferences} ${text('disabled preferences', '项关闭偏好')}` : ''}</small></div>
        <div className="button-row">
          <button className="icon-button" type="button" title={text('Export CSV', '导出 CSV')} onClick={() => void download()}><Download size={16}/></button>
          <button className="icon-button" type="button" title={text('Refresh', '刷新')} onClick={() => void load()}><RefreshCw size={16}/></button>
          {canManage && <button className="primary-button small" type="button" onClick={() => { setSelected(null); setDraft(emptyDraft); setSchemaText(JSON.stringify(emptyDraft.variableSchema, null, 2)); setPreview(null) }}><Plus size={16}/>{text('New', '新建')}</button>}
        </div>
      </div>
      <div className="notification-admin-filters">
        <input aria-label={text('Search templates', '搜索模板')} placeholder={text('Search', '搜索')} value={search} onChange={(event) => setSearch(event.target.value)} />
        <select aria-label={text('Template status', '模板状态')} value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">{text('All statuses', '全部状态')}</option><option value="draft">{text('Draft', '草稿')}</option><option value="published">{text('Published', '已发布')}</option><option value="archived">{text('Archived', '已归档')}</option>
        </select>
      </div>
      {error && <div className="inline-error" role="alert">{error}</div>}
      <div className="notification-admin-layout">
        <div className="admin-table notification-template-list">
          {items.map((item) => <button className={`admin-row compact ${selected?.id === item.id ? 'selected' : ''}`} type="button" key={item.id} onClick={() => void selectTemplate(item)}><span><strong>{item.name}</strong><small>{item.key} · CAS v{item.version}</small></span><span className={`status ${item.status}`}>{item.status}</span></button>)}
        </div>
        <div className="notification-template-editor">
          <div className="notification-template-fields">
            <input aria-label={text('Template key', '模板键')} placeholder="task.assignment_ready" value={draft.key} readOnly={Boolean(selected)} onChange={(event) => setDraft({ ...draft, key: event.target.value })} />
            <input aria-label={text('Template name', '模板名称')} placeholder={text('Name', '名称')} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            <input aria-label={text('Category', '分类')} placeholder="task" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} />
            <input aria-label={text('Locale', '语言')} value={draft.locale} onChange={(event) => setDraft({ ...draft, locale: event.target.value })} />
          </div>
          <input aria-label={text('Description', '说明')} placeholder={text('Description', '说明')} value={draft.description ?? ''} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
          <input aria-label={text('Title template', '标题模板')} placeholder="Ready: {{taskTitle}}" value={draft.titleTemplate} onChange={(event) => setDraft({ ...draft, titleTemplate: event.target.value })} />
          <textarea aria-label={text('Body template', '正文模板')} value={draft.bodyTemplate} onChange={(event) => setDraft({ ...draft, bodyTemplate: event.target.value })} />
          <textarea aria-label={text('Variable schema', '变量模式')} value={schemaText} onChange={(event) => setSchemaText(event.target.value)} spellCheck={false} />
          <div className="button-row">
            {canManage && !selected?.deletedAt && <button className="primary-button small" type="button" disabled={busy} onClick={() => void save()}><Save size={15}/>{text('Save draft', '保存草稿')}</button>}
            {selected && canManage && (selected.deletedAt ? <button className="ghost-button small" type="button" disabled={busy} onClick={() => void mutate(() => adminService.restoreNotificationTemplate(selected.id, { expectedVersion: selected.version, reasonCode }), text('Template restored.', '模板已恢复。'))}><Undo2 size={15}/>{text('Restore', '恢复')}</button> : <button className="ghost-button danger small" type="button" disabled={busy} onClick={() => void mutate(() => adminService.archiveNotificationTemplate(selected.id, { expectedVersion: selected.version, reasonCode }), text('Template archived.', '模板已归档。'))}><Archive size={15}/>{text('Archive', '归档')}</button>)}
          </div>
          {selected && <><div className="notification-preview-controls"><textarea aria-label={text('Preview variables', '预览变量')} value={variablesText} onChange={(event) => setVariablesText(event.target.value)} spellCheck={false}/><input aria-label={text('Reason code', '原因代码')} value={reasonCode} onChange={(event) => setReasonCode(event.target.value)} /></div><div className="button-row">
            <button className="ghost-button small" type="button" disabled={busy || !(latestDraft || selected.activeVersionNumber)} onClick={() => void runPreview()}><Eye size={15}/>{text('Preview', '预览')}</button>
            {canPublish && latestDraft && <button className="primary-button small" type="button" disabled={busy} onClick={() => void mutate(() => adminService.publishNotificationTemplate(selected.id, { expectedVersion: selected.version, versionNumber: latestDraft.versionNumber, reasonCode }), text('Template published.', '模板已发布。'))}><Send size={15}/>{text(`Publish v${latestDraft.versionNumber}`, `发布 v${latestDraft.versionNumber}`)}</button>}
            {canPublish && selected.activeVersionNumber && <button className="ghost-button small" type="button" disabled={busy} onClick={() => void adminService.sendNotificationTemplateTest(selected.id, JSON.parse(variablesText)).then(() => notify(text('Test notification sent.', '测试通知已发送。'))).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))}><Send size={15}/>{text('Send test', '发送测试')}</button>}
          </div></>}
          {preview && <div className="notification-template-preview"><strong>{preview.title}</strong><p>{preview.body}</p></div>}
          {selected && publishedVersions.length > 0 && <div className="notification-version-list">{publishedVersions.map((version) => <div key={version.id}><span><strong>v{version.versionNumber}</strong><small>{version.status} · {version.reasonCode ?? 'published'}</small></span>{canPublish && version.versionNumber !== selected.activeVersionNumber && <button className="icon-button" type="button" title={text(`Rollback to v${version.versionNumber}`, `回滚到 v${version.versionNumber}`)} onClick={() => void mutate(() => adminService.rollbackNotificationTemplate(selected.id, { expectedVersion: selected.version, versionNumber: version.versionNumber, reasonCode }), text('Template rolled back.', '模板已回滚。'))}><RotateCcw size={15}/></button>}</div>)}</div>}
        </div>
      </div>
    </section></>
  )
}
