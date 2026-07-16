import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArchiveRestore, Download, ListTree, Megaphone, Plus, RefreshCw, RotateCcw, Save, Search, Send, ToggleLeft, Trash2, Upload } from 'lucide-react'

import type { Permission } from '../../domain/types'
import { adminService } from '../../services/adminService'
import type { ConfigResourceDeletedFilter, ConfigResourceDto, ConfigResourceExportDocument, ConfigResourceKind, ConfigResourceRevisionDto } from '../../services/contracts'

const modes: Array<{ kind: ConfigResourceKind; icon: typeof ToggleLeft; read: Permission; manage: Permission; publish: Permission; en: string; zh: string }> = [
  { kind: 'feature_flag', icon: ToggleLeft, read: 'admin:feature-flags:read', manage: 'admin:feature-flags:manage', publish: 'admin:feature-flags:publish', en: 'Feature flags', zh: '功能开关' },
  { kind: 'reference_data', icon: ListTree, read: 'admin:reference-data:read', manage: 'admin:reference-data:manage', publish: 'admin:reference-data:publish', en: 'Reference data', zh: '字典数据' },
  { kind: 'announcement', icon: Megaphone, read: 'admin:announcements:read', manage: 'admin:announcements:manage', publish: 'admin:announcements:publish', en: 'Announcements', zh: '公告' },
]

const defaults: Record<ConfigResourceKind, Record<string, unknown>> = {
  feature_flag: { enabled: false, payload: {} },
  reference_data: { label: '', value: '', sortOrder: 0, active: true },
  announcement: { body: '', level: 'info', startsAt: null, endsAt: null, active: true },
}
const pretty = (value: unknown) => JSON.stringify(value, null, 2)

export function ConfigurationResourcesPanel({ hasPermission, isZh, notify }: {
  hasPermission: (permission: Permission) => boolean
  isZh: boolean
  notify: (message: string) => void
}) {
  const readableModes = useMemo(() => modes.filter((mode) => hasPermission(mode.read)), [hasPermission])
  const [kind, setKind] = useState<ConfigResourceKind>(() => readableModes[0]?.kind ?? 'feature_flag')
  const [resources, setResources] = useState<ConfigResourceDto[]>([])
  const [revisions, setRevisions] = useState<ConfigResourceRevisionDto[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [deleted, setDeleted] = useState<ConfigResourceDeletedFilter>('active')
  const [sort, setSort] = useState<'key' | 'title' | 'updatedAt' | 'publishedVersion'>('updatedAt')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')
  const [keyDraft, setKeyDraft] = useState('')
  const [titleDraft, setTitleDraft] = useState('')
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [valueDraft, setValueDraft] = useState(pretty(defaults.feature_flag))
  const [reasonCode, setReasonCode] = useState('configuration_reviewed')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const creatingRef = useRef(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  const mode = modes.find((item) => item.kind === kind) ?? modes[0]
  const selected = resources.find((item) => item.id === selectedId) ?? null

  const populateDraft = useCallback((resource: ConfigResourceDto | null, nextKind = kind) => {
    setKeyDraft(resource?.key ?? '')
    setTitleDraft(resource?.title ?? '')
    setDescriptionDraft(resource?.description ?? '')
    setValueDraft(pretty(resource?.draftValue ?? defaults[nextKind]))
  }, [kind])

  const refresh = useCallback(async () => {
    if (!hasPermission(mode.read)) return
    setLoading(true)
    setError(null)
    try {
      const page = await adminService.configResources(kind, { search: search || null, deleted, sort, order, limit: 100 })
      setResources(page.items)
      setSelectedIds((current) => current.filter((id) => page.items.some((item) => item.id === id)))
      setSelectedId((current) => {
        if (creatingRef.current) return null
        if (current && page.items.some((item) => item.id === current)) return current
        const next = page.items[0] ?? null
        populateDraft(next, kind)
        return next?.id ?? null
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [deleted, hasPermission, kind, mode.read, order, populateDraft, search, sort])

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 150)
    return () => window.clearTimeout(timer)
  }, [refresh])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!selected) {
        setRevisions([])
        return
      }
      void adminService.configResourceHistory(kind, selected.id, { limit: 100 })
        .then((page) => setRevisions(page.items))
        .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [kind, selected])

  const run = async (action: () => Promise<void>, success: string) => {
    setLoading(true)
    setError(null)
    try {
      await action()
      notify(success)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }
  const parsedValue = () => {
    const value: unknown = JSON.parse(valueDraft)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(isZh ? '值必须是 JSON 对象。' : 'Value must be a JSON object.')
    return value as Record<string, unknown>
  }
  const selectResource = (resource: ConfigResourceDto) => {
    creatingRef.current = false
    setSelectedId(resource.id)
    populateDraft(resource)
  }
  const createNew = () => {
    creatingRef.current = true
    setSelectedId(null)
    setRevisions([])
    populateDraft(null)
  }
  const saveDraft = () => void run(async () => {
    const payload = { title: titleDraft, description: descriptionDraft || null, value: parsedValue() }
    const saved = selected
      ? await adminService.updateConfigResource(kind, selected.id, { ...payload, expectedVersion: selected.version })
      : await adminService.createConfigResource(kind, { ...payload, key: keyDraft })
    creatingRef.current = false
    setResources((current) => [saved, ...current.filter((item) => item.id !== saved.id)])
    setSelectedId(saved.id)
    populateDraft(saved)
  }, isZh ? '草稿已保存。' : 'Draft saved.')
  const publish = () => selected && void run(async () => {
    const result = await adminService.publishConfigResource(kind, selected.id, { expectedVersion: selected.version, reasonCode })
    setResources((current) => current.map((item) => item.id === result.resource.id ? result.resource : item))
    setRevisions((current) => [result.revision, ...current])
    populateDraft(result.resource)
  }, isZh ? '版本已发布。' : 'Version published.')
  const rollback = (revision: ConfigResourceRevisionDto) => selected && void run(async () => {
    const result = await adminService.rollbackConfigResource(kind, selected.id, revision.id, { expectedVersion: selected.version, reasonCode })
    setResources((current) => current.map((item) => item.id === result.resource.id ? result.resource : item))
    setRevisions((current) => [result.revision, ...current])
    populateDraft(result.resource)
  }, isZh ? '已发布回滚版本。' : 'Rollback version published.')
  const remove = () => selected && void run(async () => {
    await adminService.deleteConfigResource(kind, selected.id, { expectedVersion: selected.version, reasonCode })
    creatingRef.current = false
    setSelectedId(null)
    await refresh()
  }, isZh ? '资源已归档。' : 'Resource archived.')
  const restore = () => selected && void run(async () => {
    const restored = await adminService.restoreConfigResource(kind, selected.id, { expectedVersion: selected.version, reasonCode })
    setResources((current) => current.map((item) => item.id === restored.id ? restored : item))
    populateDraft(restored)
  }, isZh ? '资源已恢复。' : 'Resource restored.')
  const bulkDelete = () => selectedIds.length && void run(async () => {
    const items = resources.filter((item) => selectedIds.includes(item.id)).map((item) => ({ id: item.id, expectedVersion: item.version }))
    await adminService.bulkDeleteConfigResources(kind, items, reasonCode)
    setSelectedIds([])
    creatingRef.current = false
    setSelectedId(null)
    await refresh()
  }, isZh ? '所选资源已归档。' : 'Selected resources archived.')
  const exportResources = () => void run(async () => {
    const exported = await adminService.exportConfigResources(kind)
    const url = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `reference-data-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }, isZh ? '字典数据已导出。' : 'Reference data exported.')
  const importResources = (file: File) => void run(async () => {
    const document = JSON.parse(await file.text()) as Partial<ConfigResourceExportDocument>
    if (!Array.isArray(document.items)) throw new Error(isZh ? '导入文件缺少 items。' : 'Import document must contain items.')
    await adminService.importConfigResources(kind, document.items, reasonCode)
    await refresh()
  }, isZh ? '字典数据已导入。' : 'Reference data imported.')

  if (!readableModes.length) return null

  return (
    <section className="panel system-settings-panel config-resources-panel" data-testid="admin-config-resources">
      <header className="settings-panel-header">
        <div><small>{isZh ? '独立配置域' : 'Configuration domains'}</small><h2>{isZh ? '功能开关、字典与公告' : 'Flags, reference data, and announcements'}</h2></div>
        <div className="button-row">
          {kind === 'reference_data' && <button className="icon-button" type="button" title={isZh ? '导出 JSON' : 'Export JSON'} onClick={exportResources}><Download size={17} /></button>}
          {kind === 'reference_data' && hasPermission(mode.manage) && <><button className="icon-button" type="button" title={isZh ? '导入 JSON' : 'Import JSON'} onClick={() => importInputRef.current?.click()}><Upload size={17} /></button><input ref={importInputRef} className="config-import-input" type="file" accept="application/json,.json" tabIndex={-1} aria-hidden="true" onChange={(event) => { const file = event.target.files?.[0]; if (file) importResources(file); event.target.value = '' }} /></>}
          {hasPermission(mode.manage) && <button className="icon-button" type="button" title={isZh ? '新建' : 'New'} onClick={createNew}><Plus size={17} /></button>}
          <button className="icon-button" type="button" title={isZh ? '刷新' : 'Refresh'} onClick={() => void refresh()} disabled={loading}><RefreshCw size={17} /></button>
        </div>
      </header>

      <div className="config-resource-tabs" role="tablist">
        {readableModes.map((item) => {
          const Icon = item.icon
          return <button type="button" role="tab" aria-selected={kind === item.kind} className={kind === item.kind ? 'active' : ''} key={item.kind} onClick={() => { creatingRef.current = false; setKind(item.kind); setSelectedId(null); setSelectedIds([]); populateDraft(null, item.kind) }}><Icon size={16} />{isZh ? item.zh : item.en}</button>
        })}
      </div>

      <div className="settings-filter-row">
        <label className="settings-search"><Search size={16} /><input aria-label={isZh ? '搜索资源' : 'Search resources'} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <select aria-label={isZh ? '归档状态' : 'Archive status'} value={deleted} onChange={(event) => setDeleted(event.target.value as ConfigResourceDeletedFilter)}><option value="active">{isZh ? '使用中' : 'Active'}</option><option value="deleted">{isZh ? '已归档' : 'Archived'}</option><option value="all">{isZh ? '全部' : 'All'}</option></select>
        <select aria-label={isZh ? '排序字段' : 'Sort field'} value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="updatedAt">{isZh ? '更新时间' : 'Updated'}</option><option value="key">Key</option><option value="title">{isZh ? '标题' : 'Title'}</option><option value="publishedVersion">{isZh ? '发布版本' : 'Published version'}</option></select>
        <button className="icon-button" type="button" title={order === 'asc' ? (isZh ? '升序' : 'Ascending') : (isZh ? '降序' : 'Descending')} onClick={() => setOrder((value) => value === 'asc' ? 'desc' : 'asc')}>{order === 'asc' ? '↑' : '↓'}</button>
      </div>

      {error && <div className="inline-error" role="alert">{error}</div>}
      <div className="settings-workspace">
        <div className="admin-table settings-list config-resource-list">
          {resources.map((item) => <div className={`admin-row compact ${selected?.id === item.id ? 'selected' : ''}`} key={item.id}>
            {hasPermission(mode.manage) && !item.deletedAt && <input type="checkbox" aria-label={`${isZh ? '选择' : 'Select'} ${item.title}`} checked={selectedIds.includes(item.id)} onChange={() => setSelectedIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} />}
            <button type="button" onClick={() => selectResource(item)}><span><strong>{item.title}</strong><small>{item.key}</small></span><span className={`status ${item.deletedAt ? 'rejected' : 'published'}`}>{item.deletedAt ? (isZh ? '已归档' : 'Archived') : `v${item.publishedVersion}`}</span></button>
          </div>)}
          {!loading && !resources.length && <div className="empty-state">{isZh ? '没有匹配资源' : 'No matching resources'}</div>}
          {selectedIds.length > 0 && <button className="ghost-button danger config-bulk-action" type="button" onClick={bulkDelete} disabled={loading}><Trash2 size={16} />{isZh ? `归档 ${selectedIds.length} 项` : `Archive ${selectedIds.length}`}</button>}
        </div>

        <div className="settings-editor config-resource-editor">
          <div className="settings-editor-heading"><span><strong>{selected ? selected.title : (isZh ? '新资源' : 'New resource')}</strong><small>{selected ? `${selected.key} · revision ${selected.publishedVersion}` : (isZh ? mode.zh : mode.en)}</small></span>{selected && <code>v{selected.version}</code>}</div>
          <div className="config-resource-fields">
            <input aria-label="Key" value={keyDraft} onChange={(event) => setKeyDraft(event.target.value)} readOnly={Boolean(selected)} placeholder="key" />
            <input aria-label={isZh ? '标题' : 'Title'} value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} placeholder={isZh ? '标题' : 'Title'} />
            <input aria-label={isZh ? '描述' : 'Description'} value={descriptionDraft} onChange={(event) => setDescriptionDraft(event.target.value)} placeholder={isZh ? '描述' : 'Description'} />
          </div>
          <textarea aria-label={isZh ? '资源 JSON' : 'Resource JSON'} value={valueDraft} onChange={(event) => setValueDraft(event.target.value)} readOnly={!hasPermission(mode.manage) || Boolean(selected?.deletedAt)} spellCheck={false} />
          <div className="settings-action-fields"><input aria-label={isZh ? '原因代码' : 'Reason code'} value={reasonCode} onChange={(event) => setReasonCode(event.target.value)} /><span /></div>
          <div className="button-row">
            {hasPermission(mode.manage) && !selected?.deletedAt && <button className="ghost-button" type="button" onClick={saveDraft} disabled={loading}><Save size={16} />{isZh ? '保存草稿' : 'Save draft'}</button>}
            {selected && hasPermission(mode.publish) && !selected.deletedAt && <button className="primary-button" type="button" onClick={publish} disabled={loading}><Send size={16} />{isZh ? '发布' : 'Publish'}</button>}
            {selected && hasPermission(mode.manage) && !selected.deletedAt && <button className="ghost-button danger" type="button" onClick={remove} disabled={loading}><Trash2 size={16} />{isZh ? '归档' : 'Archive'}</button>}
            {selected?.deletedAt && hasPermission(mode.manage) && <button className="primary-button" type="button" onClick={restore} disabled={loading}><ArchiveRestore size={16} />{isZh ? '恢复' : 'Restore'}</button>}
          </div>
        </div>
      </div>

      {selected && <div className="settings-section"><div className="settings-section-title"><strong>{isZh ? '发布历史' : 'Published history'}</strong><span>{revisions.length}</span></div><div className="admin-table settings-history-list">{revisions.map((revision) => <div className="admin-row compact" key={revision.id}><span><strong>v{revision.resourceVersion} · {revision.eventType.replaceAll('_', ' ')}</strong><small>{revision.actorRef} · {new Date(revision.createdAt).toLocaleString()}</small></span><code>{revision.contentHash.slice(0, 12)}</code>{hasPermission(mode.publish) && !selected.deletedAt && revision.id !== selected.currentRevisionId && <button className="icon-button" type="button" title={isZh ? `回滚到版本 ${revision.resourceVersion}` : `Rollback to version ${revision.resourceVersion}`} onClick={() => rollback(revision)}><RotateCcw size={15} /></button>}</div>)}</div></div>}
    </section>
  )
}
