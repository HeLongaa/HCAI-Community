import { useCallback, useEffect, useMemo, useState } from 'react'
import { Archive, ArchiveRestore, CheckCircle2, Download, LoaderCircle, RefreshCw, RotateCcw, Trash2, Undo2, XCircle } from 'lucide-react'
import { textFor } from '../../domain/utils'
import type { AdminMediaAssetQuery, ApiAdminMediaAsset, MediaAssetPurpose } from '../../services/contracts'
import { mediaService } from '../../services/mediaService'

const purposes: Array<'' | MediaAssetPurpose> = ['', 'task_attachment', 'submission_asset', 'profile_portfolio', 'library_asset']
type LifecycleAction = 'archive' | 'restore' | 'delete' | 'recover'

export function AdminMediaLifecyclePanel({ t, canRead, canReview, canExport }: { t: Record<string, string>; canRead: boolean; canReview: boolean; canExport: boolean }) {
  const [items, setItems] = useState<ApiAdminMediaAsset[]>([])
  const [query, setQuery] = useState<AdminMediaAssetQuery>({ lifecycle: 'all', sort: 'created_desc', limit: 12 })
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ApiAdminMediaAsset | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async (cursor: string | null = null) => {
    if (!canRead) return
    setLoading(true)
    setError(null)
    try {
      const page = await mediaService.adminAssets({ ...query, cursor })
      setItems((current) => cursor ? [...current, ...page.items] : page.items)
      setNextCursor(page.nextCursor)
      if (!cursor && page.items.length) setFocusedId((current) => current && page.items.some((item) => item.id === current) ? current : page.items[0].id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : textFor(t, 'Could not load asset lifecycle.', '无法加载素材生命周期。'))
    } finally {
      setLoading(false)
    }
  }, [canRead, query, t])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180)
    return () => window.clearTimeout(timer)
  }, [load])

  useEffect(() => {
    if (!focusedId || !canRead) return
    let active = true
    void mediaService.adminAsset(focusedId).then((asset) => { if (active) setDetail(asset) }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : textFor(t, 'Could not load asset detail.', '无法加载素材详情。'))
    })
    return () => { active = false }
  }, [canRead, focusedId, t])

  const updateItem = (updated: ApiAdminMediaAsset) => {
    setItems((current) => current.map((candidate) => candidate.id === updated.id ? updated : candidate))
    if (focusedId === updated.id) setDetail(updated)
  }

  const runAction = async (item: ApiAdminMediaAsset, action: LifecycleAction) => {
    if (action === 'delete' && !window.confirm(textFor(t, 'Move this asset to trash?', '将此素材移入回收站？'))) return
    setBusy(item.id)
    setError(null)
    try {
      updateItem(await mediaService.adminAssetAction(item.id, action, action === 'delete' ? 'admin_lifecycle_action' : undefined))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : textFor(t, 'Asset state action failed.', '素材状态操作失败。'))
    } finally {
      setBusy(null)
    }
  }

  const runScan = async (item: ApiAdminMediaAsset, decision: 'clean' | 'reject') => {
    setBusy(item.id)
    setError(null)
    try {
      updateItem(await mediaService.adminAssetScan(item.id, { decision, note: 'admin_media_workbench' }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : textFor(t, 'Scan decision failed.', '扫描处置失败。'))
    } finally {
      setBusy(null)
    }
  }

  const runBulk = async (action: LifecycleAction) => {
    const ids = [...selectedIds]
    if (!ids.length) return
    if (action === 'delete' && !window.confirm(textFor(t, `Move ${ids.length} assets to trash?`, `将 ${ids.length} 个素材移入回收站？`))) return
    setBusy('bulk')
    setError(null)
    try {
      const result = await mediaService.adminAssetBulkAction(ids, action)
      result.results.forEach((entry) => { if (entry.status === 'succeeded') updateItem(entry.asset) })
      setSelectedIds(new Set(result.results.filter((entry) => entry.status === 'failed').map((entry) => entry.id)))
      setNotice(textFor(t, `${result.succeeded} succeeded, ${result.failed} failed.`, `成功 ${result.succeeded} 项，失败 ${result.failed} 项。`))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : textFor(t, 'Bulk action failed.', '批量操作失败。'))
    } finally {
      setBusy(null)
    }
  }

  const exportAssets = async (format: 'json' | 'csv') => {
    setBusy(`export-${format}`)
    try {
      const exported = await mediaService.adminAssetExport(query, format)
      const content = typeof exported === 'string' ? exported : JSON.stringify(exported, null, 2)
      const url = URL.createObjectURL(new Blob([content], { type: format === 'csv' ? 'text/csv' : 'application/json' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `media-assets.${format}`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : textFor(t, 'Export failed.', '导出失败。'))
    } finally {
      setBusy(null)
    }
  }

  const focused = detail?.id === focusedId ? detail : items.find((item) => item.id === focusedId) ?? null
  const allSelected = useMemo(() => items.length > 0 && items.every((item) => selectedIds.has(item.id)), [items, selectedIds])
  const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(items.map((item) => item.id)))

  return <div className="admin-media-lifecycle" data-testid="admin-media-lifecycle">
    <div className="admin-media-lifecycle-heading">
      <div><strong>{textFor(t, 'Asset administration', '素材资产管理')}</strong><span>{textFor(t, 'Safe metadata, scan evidence, lineage and portfolio state', '安全元数据、扫描证据、谱系与作品集状态')}</span></div>
      <div className="button-row">
        {canExport && <><button className="icon-button" aria-label={textFor(t, 'Export media JSON', '导出素材 JSON')} disabled={Boolean(busy)} onClick={() => void exportAssets('json')} type="button"><Download size={16}/></button><button className="ghost-button small" disabled={Boolean(busy)} onClick={() => void exportAssets('csv')} type="button">CSV</button></>}
        <button className="icon-button" aria-label={textFor(t, 'Refresh asset lifecycle', '刷新素材生命周期')} disabled={!canRead || loading} onClick={() => void load()} type="button"><RefreshCw className={loading ? 'spin' : ''} size={16}/></button>
      </div>
    </div>
    <div className="admin-media-lifecycle-filters">
      <input aria-label={textFor(t, 'Search asset lifecycle', '搜索素材生命周期')} placeholder={textFor(t, 'ID, filename, owner', 'ID、文件名、所有者')} value={query.search ?? ''} onChange={(event) => setQuery((current) => ({ ...current, search: event.target.value || null }))}/>
      <select aria-label={textFor(t, 'Admin asset lifecycle state', '管理端素材生命周期状态')} value={query.lifecycle ?? 'all'} onChange={(event) => setQuery((current) => ({ ...current, lifecycle: event.target.value as AdminMediaAssetQuery['lifecycle'] }))}><option value="all">{textFor(t, 'All states', '全部状态')}</option><option value="active">{textFor(t, 'Active', '使用中')}</option><option value="archived">{textFor(t, 'Archived', '已归档')}</option><option value="deleted">{textFor(t, 'Deleted', '回收站')}</option></select>
      <select aria-label={textFor(t, 'Admin asset purpose', '管理端素材用途')} value={query.purpose ?? ''} onChange={(event) => setQuery((current) => ({ ...current, purpose: event.target.value as MediaAssetPurpose || null }))}>{purposes.map((purpose) => <option key={purpose || 'all'} value={purpose}>{purpose || textFor(t, 'All purposes', '全部用途')}</option>)}</select>
      <select aria-label={textFor(t, 'Admin asset sort', '管理端素材排序')} value={query.sort ?? 'created_desc'} onChange={(event) => setQuery((current) => ({ ...current, sort: event.target.value as AdminMediaAssetQuery['sort'] }))}><option value="created_desc">{textFor(t, 'Newest first', '最新优先')}</option><option value="created_asc">{textFor(t, 'Oldest first', '最早优先')}</option><option value="updated_desc">{textFor(t, 'Recently updated', '最近更新')}</option><option value="name_asc">{textFor(t, 'Filename', '文件名')}</option></select>
    </div>
    {(error || notice) && <p className={`use-creative-asset-notice ${error ? 'error' : ''}`}>{error ?? notice}</p>}
    <div className="admin-media-bulkbar">
      <label><input type="checkbox" checked={allSelected} onChange={toggleAll}/>{selectedIds.size} {textFor(t, 'selected', '项已选')}</label>
      <div className="button-row"><button className="ghost-button small" disabled={!canReview || !selectedIds.size || Boolean(busy)} onClick={() => void runBulk('archive')} type="button"><Archive size={14}/>{textFor(t, 'Archive', '归档')}</button><button className="ghost-button small" disabled={!canReview || !selectedIds.size || Boolean(busy)} onClick={() => void runBulk('restore')} type="button"><ArchiveRestore size={14}/>{textFor(t, 'Restore', '恢复')}</button><button className="ghost-button small" disabled={!canReview || !selectedIds.size || Boolean(busy)} onClick={() => void runBulk('delete')} type="button"><Trash2 size={14}/>{textFor(t, 'Delete', '删除')}</button><button className="ghost-button small" disabled={!canReview || !selectedIds.size || Boolean(busy)} onClick={() => void runBulk('recover')} type="button"><Undo2 size={14}/>{textFor(t, 'Recover', '撤销删除')}</button></div>
    </div>
    <div className="admin-media-workbench">
      <div className="admin-media-lifecycle-list" aria-busy={loading}>
        {!loading && items.length === 0 && <div className="empty-state"><strong>{textFor(t, 'No matching assets', '没有匹配的素材')}</strong><span>{textFor(t, 'Adjust lifecycle filters or search.', '调整生命周期筛选或搜索条件。')}</span></div>}
        {items.map((item) => <article className={focusedId === item.id ? 'selected' : ''} key={item.id}>
          <input aria-label={`${textFor(t, 'Select', '选择')} ${item.fileName}`} type="checkbox" checked={selectedIds.has(item.id)} onChange={() => setSelectedIds((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next })}/>
          <button className="admin-media-row-copy" type="button" onClick={() => setFocusedId(item.id)}><strong>{item.fileName}</strong><span>@{item.owner.handle} · {item.purpose} · {item.status}/{item.scanStatus}</span><small>{item.deletedAt ? textFor(t, 'Deleted', '回收站') : item.archivedAt ? textFor(t, 'Archived', '已归档') : textFor(t, 'Active', '使用中')} · {item.relations.length} {textFor(t, 'relations', '条关系')} · {item.portfolio.length} {textFor(t, 'portfolio records', '条作品集记录')}</small></button>
        </article>)}
        {loading && <div className="portfolio-manager-state"><LoaderCircle className="spin" size={16}/>{textFor(t, 'Loading assets…', '正在加载素材…')}</div>}
        {nextCursor && <button className="ghost-button" disabled={loading} onClick={() => void load(nextCursor)} type="button">{textFor(t, 'Load more', '加载更多')}</button>}
      </div>
      <aside className="admin-media-detail">
        {!focused && <div className="empty-state"><strong>{textFor(t, 'Select an asset', '选择一个素材')}</strong></div>}
        {focused && <>
          <div><small>{focused.id}</small><h3>{focused.fileName}</h3><span>@{focused.owner.handle} · {focused.contentType}</span></div>
          <dl><div><dt>{textFor(t, 'Lifecycle', '生命周期')}</dt><dd>{focused.deletedAt ? 'deleted' : focused.archivedAt ? 'archived' : 'active'}</dd></div><div><dt>{textFor(t, 'Scan', '扫描')}</dt><dd>{focused.scanStatus}</dd></div><div><dt>{textFor(t, 'Size', '大小')}</dt><dd>{focused.sizeBytes.toLocaleString()} B</dd></div><div><dt>{textFor(t, 'Purpose', '用途')}</dt><dd>{focused.purpose}</dd></div><div><dt>{textFor(t, 'Relations', '关系')}</dt><dd>{focused.relations.length}</dd></div><div><dt>{textFor(t, 'Portfolio', '作品集')}</dt><dd>{focused.portfolio.length}</dd></div></dl>
          <div className="button-row admin-media-detail-actions">
            {!focused.deletedAt && !focused.archivedAt && <button className="ghost-button small" disabled={!canReview || busy === focused.id} onClick={() => void runAction(focused, 'archive')} type="button"><Archive size={14}/>{textFor(t, 'Archive', '归档')}</button>}
            {!focused.deletedAt && focused.archivedAt && <button className="ghost-button small" disabled={!canReview || busy === focused.id} onClick={() => void runAction(focused, 'restore')} type="button"><ArchiveRestore size={14}/>{textFor(t, 'Restore', '恢复')}</button>}
            {!focused.deletedAt && <button className="ghost-button small" disabled={!canReview || busy === focused.id} onClick={() => void runAction(focused, 'delete')} type="button"><Trash2 size={14}/>{textFor(t, 'Delete', '删除')}</button>}
            {focused.deletedAt && <button className="ghost-button small" disabled={!canReview || busy === focused.id} onClick={() => void runAction(focused, 'recover')} type="button"><Undo2 size={14}/>{textFor(t, 'Recover', '撤销删除')}</button>}
          </div>
          {!focused.deletedAt && <div className="button-row admin-media-detail-actions"><button className="ghost-button small" disabled={!canReview || busy === focused.id} onClick={() => void runScan(focused, 'clean')} type="button"><CheckCircle2 size={14}/>{textFor(t, 'Mark clean', '标记安全')}</button><button className="ghost-button small" disabled={!canReview || busy === focused.id} onClick={() => void runScan(focused, 'reject')} type="button"><XCircle size={14}/>{textFor(t, 'Reject', '拒绝')}</button><button className="ghost-button small" disabled={!canReview || busy === focused.id} onClick={async () => { setBusy(focused.id); try { updateItem(await mediaService.adminAssetScanRetry(focused.id)) } finally { setBusy(null) } }} type="button"><RotateCcw size={14}/>{textFor(t, 'Retry scan', '重试扫描')}</button></div>}
          <div className="admin-media-evidence"><strong>{textFor(t, 'Scan attempts', '扫描尝试')}</strong>{(focused.scanJobs ?? []).slice(0, 5).map((job) => <span key={job.id}>{job.status} · {job.provider} · {job.attempts} {textFor(t, 'attempts', '次尝试')}</span>)}{!(focused.scanJobs ?? []).length && <span>{textFor(t, 'No scan attempts', '暂无扫描尝试')}</span>}</div>
        </>}
      </aside>
    </div>
  </div>
}
