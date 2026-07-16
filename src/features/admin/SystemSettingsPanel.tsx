import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Eye, RefreshCw, RotateCcw, Save, Search, Send, X } from 'lucide-react'

import type { Permission } from '../../domain/types'
import { adminService } from '../../services/adminService'
import type {
  SystemSettingChangeDto,
  SystemSettingChangeStatus,
  SystemSettingDto,
  SystemSettingPreviewDto,
  SystemSettingRevisionDto,
} from '../../services/contracts'

const statuses: Array<SystemSettingChangeStatus | ''> = ['', 'pending_approval', 'approved', 'rejected', 'published']
const formatStatus = (value: string) => value.replaceAll('_', ' ')
const pretty = (value: unknown) => JSON.stringify(value, null, 2)

export function SystemSettingsPanel({ hasPermission, isZh, notify }: {
  hasPermission: (permission: Permission) => boolean
  isZh: boolean
  notify: (message: string) => void
}) {
  const [settings, setSettings] = useState<SystemSettingDto[]>([])
  const [changes, setChanges] = useState<SystemSettingChangeDto[]>([])
  const [revisions, setRevisions] = useState<SystemSettingRevisionDto[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [changeStatus, setChangeStatus] = useState<SystemSettingChangeStatus | ''>('')
  const [draft, setDraft] = useState('')
  const [reasonCode, setReasonCode] = useState('settings_reviewed')
  const [note, setNote] = useState('')
  const [preview, setPreview] = useState<SystemSettingPreviewDto | null>(null)
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedSetting = useMemo(
    () => settings.find((item) => item.key === selectedKey) ?? settings[0] ?? null,
    [selectedKey, settings],
  )
  const selectedChange = useMemo(
    () => changes.find((item) => item.id === selectedChangeId) ?? changes[0] ?? null,
    [changes, selectedChangeId],
  )
  const categories = useMemo(() => [...new Set(settings.map((item) => item.domain))].sort(), [settings])

  const refreshSettings = useCallback(async () => {
    if (!hasPermission('admin:settings:read')) return
    const page = await adminService.systemSettings({ search: search || null, category: category || null, limit: 100 })
    setSettings(page.items)
    setSelectedKey((current) => {
      if (current && page.items.some((item) => item.key === current)) return current
      const nextSelected = page.items[0] ?? null
      setDraft(nextSelected ? pretty(nextSelected.value) : '')
      setPreview(null)
      return nextSelected?.key ?? null
    })
  }, [category, hasPermission, search])

  const refreshChanges = useCallback(async (key?: string | null) => {
    if (!hasPermission('admin:settings:read')) return
    const page = await adminService.systemSettingChanges({
      settingKey: key ?? selectedKey,
      status: changeStatus || null,
      limit: 100,
    })
    setChanges(page.items)
    setSelectedChangeId((current) => page.items.some((item) => item.id === current) ? current : page.items[0]?.id ?? null)
  }, [changeStatus, hasPermission, selectedKey])

  const refreshHistory = useCallback(async (key?: string | null) => {
    const target = key ?? selectedKey
    if (!target || !hasPermission('admin:settings:read')) {
      setRevisions([])
      return
    }
    const page = await adminService.systemSettingHistory(target, { limit: 100 })
    setRevisions(page.items)
  }, [hasPermission, selectedKey])

  const refreshAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await refreshSettings()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [refreshSettings])

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshAll(), 0)
    return () => window.clearTimeout(timer)
  }, [refreshAll])

  useEffect(() => {
    if (!selectedSetting) return
    const timer = window.setTimeout(() => {
      void Promise.all([refreshChanges(selectedSetting.key), refreshHistory(selectedSetting.key)]).catch((cause) => {
        setError(cause instanceof Error ? cause.message : String(cause))
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [refreshChanges, refreshHistory, selectedSetting])

  const parseDraft = () => {
    const value: unknown = JSON.parse(draft)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(isZh ? '设置值必须是 JSON 对象。' : 'Setting value must be a JSON object.')
    return value as Record<string, unknown>
  }

  const run = async (action: () => Promise<void>, success?: string) => {
    setLoading(true)
    setError(null)
    try {
      await action()
      if (success) notify(success)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  const previewDraft = () => void run(async () => {
    if (!selectedSetting) return
    setPreview(await adminService.previewSystemSetting(selectedSetting.key, parseDraft()))
  })

  const submitDraft = () => void run(async () => {
    if (!selectedSetting) return
    const change = await adminService.requestSystemSettingChange(selectedSetting.key, {
      value: parseDraft(),
      baseVersion: selectedSetting.publishedVersion,
      reasonCode,
      note,
    })
    setChanges((current) => [change, ...current.filter((item) => item.id !== change.id)])
    setSelectedChangeId(change.id)
    setPreview(null)
  }, isZh ? '设置变更已提交审批。' : 'Setting change submitted for approval.')

  const transitionChange = (action: 'approve' | 'reject') => void run(async () => {
    if (!selectedChange) return
    const changed = await adminService.transitionSystemSettingChange(selectedChange.id, action, {
      expectedVersion: selectedChange.version,
      reasonCode,
      note,
    })
    setChanges((current) => current.map((item) => item.id === changed.id ? changed : item))
  }, action === 'approve'
    ? isZh ? '设置变更已批准。' : 'Setting change approved.'
    : isZh ? '设置变更已拒绝。' : 'Setting change rejected.')

  const publishChange = () => void run(async () => {
    if (!selectedChange) return
    const result = await adminService.publishSystemSettingChange(selectedChange.id, {
      expectedVersion: selectedChange.version,
      reasonCode,
      note,
    })
    setSettings((current) => current.map((item) => item.key === result.setting.key ? result.setting : item))
    setChanges((current) => current.map((item) => item.id === result.change.id ? result.change : item))
    setRevisions((current) => [result.revision, ...current])
    setDraft(pretty(result.setting.value))
    setPreview(null)
  }, isZh ? '设置变更已发布。' : 'Setting change published.')

  const requestRollback = (revision: SystemSettingRevisionDto) => void run(async () => {
    if (!selectedSetting) return
    const change = await adminService.requestSystemSettingRollback(selectedSetting.key, revision.id, {
      baseVersion: selectedSetting.publishedVersion,
      reasonCode,
      note,
    })
    setChanges((current) => [change, ...current.filter((item) => item.id !== change.id)])
    setSelectedChangeId(change.id)
  }, isZh ? '回滚请求已提交审批。' : 'Rollback request submitted for approval.')

  if (!hasPermission('admin:settings:read')) return null

  return (
    <section className="panel system-settings-panel" data-testid="admin-system-settings">
      <header className="settings-panel-header">
        <div><small>{isZh ? '配置控制' : 'Configuration control'}</small><h2>{isZh ? '系统设置' : 'System settings'}</h2></div>
        <button className="icon-button" type="button" title={isZh ? '刷新' : 'Refresh'} onClick={() => void refreshAll()} disabled={loading}><RefreshCw size={17} /></button>
      </header>

      <div className="settings-filter-row">
        <label className="settings-search"><Search size={16} /><input aria-label={isZh ? '搜索设置' : 'Search settings'} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={isZh ? '搜索键名或分类' : 'Search key or category'} /></label>
        <select aria-label={isZh ? '设置分类' : 'Setting category'} value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="">{isZh ? '全部分类' : 'All categories'}</option>
          {categories.map((item) => <option value={item} key={item}>{item}</option>)}
        </select>
        <select aria-label={isZh ? '变更状态' : 'Change status'} value={changeStatus} onChange={(event) => setChangeStatus(event.target.value as SystemSettingChangeStatus | '')}>
          {statuses.map((item) => <option value={item} key={item || 'all'}>{item ? formatStatus(item) : isZh ? '全部变更' : 'All changes'}</option>)}
        </select>
      </div>

      {error && <div className="inline-error" role="alert">{error}</div>}
      <div className="settings-workspace">
        <div className="admin-table settings-list">
          {settings.map((item) => (
            <button className={`admin-row compact ${selectedSetting?.key === item.key ? 'selected' : ''}`} type="button" key={item.key} onClick={() => { setSelectedKey(item.key); setDraft(pretty(item.value)); setPreview(null) }}>
              <span><strong>{item.key}</strong><small>{item.domain} · {item.scope}</small></span>
              <span className={`status ${item.source}`}>v{item.publishedVersion}</span>
              {Boolean(item.pendingChanges) && <small>{item.pendingChanges} {isZh ? '待处理' : 'pending'}</small>}
            </button>
          ))}
          {!loading && !settings.length && <div className="empty-state">{isZh ? '没有匹配的设置' : 'No matching settings'}</div>}
        </div>

        {selectedSetting && <div className="settings-editor">
          <div className="settings-editor-heading"><span><strong>{selectedSetting.key}</strong><small>{selectedSetting.source} · schema v{selectedSetting.valueSchemaVersion}</small></span><code>v{selectedSetting.publishedVersion}</code></div>
          <textarea aria-label={isZh ? '设置 JSON' : 'Setting JSON'} value={draft} onChange={(event) => { setDraft(event.target.value); setPreview(null) }} readOnly={!hasPermission('admin:settings:manage')} spellCheck={false} />
          <div className="settings-action-fields"><input aria-label={isZh ? '原因代码' : 'Reason code'} value={reasonCode} onChange={(event) => setReasonCode(event.target.value)} disabled={!hasPermission('admin:settings:manage')} /><input aria-label={isZh ? '说明' : 'Note'} value={note} onChange={(event) => setNote(event.target.value)} placeholder={isZh ? '变更说明' : 'Change note'} disabled={!hasPermission('admin:settings:manage')} /></div>
          {hasPermission('admin:settings:manage') && <div className="button-row"><button className="ghost-button" type="button" onClick={previewDraft} disabled={loading}><Eye size={16} />{isZh ? '预览' : 'Preview'}</button><button className="primary-button" type="button" onClick={submitDraft} disabled={loading || !preview?.changed}><Send size={16} />{isZh ? '提交审批' : 'Request change'}</button></div>}
          {preview && <div className="settings-preview" data-testid="settings-preview"><div><strong>{isZh ? '影响预览' : 'Impact preview'}</strong><code>{preview.contentHash.slice(0, 16)}</code></div>{preview.diff.changes.map((item) => <div className="settings-diff-row" key={item.path}><strong>{item.path}</strong><span>{pretty(item.previous)}</span><span aria-hidden="true">-&gt;</span><span>{pretty(item.next)}</span></div>)}</div>}
        </div>}
      </div>

      <div className="settings-evidence-grid">
        <div className="settings-section"><div className="settings-section-title"><strong>{isZh ? '变更队列' : 'Change queue'}</strong><button className="icon-button" type="button" title={isZh ? '刷新变更' : 'Refresh changes'} onClick={() => void refreshChanges()}><RefreshCw size={15} /></button></div><div className="admin-table settings-change-list">{changes.map((item) => <button className={`admin-row compact ${selectedChange?.id === item.id ? 'selected' : ''}`} type="button" key={item.id} onClick={() => setSelectedChangeId(item.id)}><span><strong>{formatStatus(item.kind)}</strong><small>{item.requestedByRef} · base v{item.baseVersion}</small></span><span className={`status ${item.status}`}>{formatStatus(item.status)}</span></button>)}</div>{selectedChange && <div className="admin-detail-panel settings-change-detail"><div><strong>{selectedChange.settingKey}</strong><span>v{selectedChange.version}</span></div><p>{selectedChange.reasonCode}{selectedChange.note ? ` · ${selectedChange.note}` : ''}</p><div className="settings-diff-count">{selectedChange.diff.changes.length} {isZh ? '项变更' : 'changes'}</div><div className="button-row">{selectedChange.status === 'pending_approval' && hasPermission('admin:settings:approve') && <><button className="primary-button" type="button" onClick={() => transitionChange('approve')} disabled={loading}><Check size={16} />{isZh ? '批准' : 'Approve'}</button><button className="ghost-button danger" type="button" onClick={() => transitionChange('reject')} disabled={loading}><X size={16} />{isZh ? '拒绝' : 'Reject'}</button></>}{selectedChange.status === 'approved' && hasPermission('admin:settings:publish') && <button className="primary-button" type="button" onClick={publishChange} disabled={loading}><Save size={16} />{isZh ? '发布' : 'Publish'}</button>}</div></div>}</div>
        <div className="settings-section"><div className="settings-section-title"><strong>{isZh ? '发布历史' : 'Published history'}</strong><button className="icon-button" type="button" title={isZh ? '刷新历史' : 'Refresh history'} onClick={() => void refreshHistory()}><RefreshCw size={15} /></button></div><div className="admin-table settings-history-list">{revisions.map((item) => <div className="admin-row compact" key={item.id}><span><strong>v{item.settingVersion} · {formatStatus(item.eventType)}</strong><small>{item.actorRef} · {new Date(item.createdAt).toLocaleString()}</small></span><code>{item.contentHash.slice(0, 12)}</code>{hasPermission('admin:settings:manage') && item.id !== selectedSetting?.currentRevisionId && <button className="icon-button" type="button" title={isZh ? `回滚到版本 ${item.settingVersion}` : `Rollback to version ${item.settingVersion}`} onClick={() => requestRollback(item)} disabled={loading}><RotateCcw size={15} /></button>}</div>)}</div></div>
      </div>
    </section>
  )
}
