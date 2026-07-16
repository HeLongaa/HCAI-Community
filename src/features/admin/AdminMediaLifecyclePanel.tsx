import { useCallback, useEffect, useState } from 'react'
import { Archive, ArchiveRestore, LoaderCircle, RefreshCw, Trash2, Undo2 } from 'lucide-react'
import { textFor } from '../../domain/utils'
import type { AdminMediaAssetQuery, ApiAdminMediaAsset, MediaAssetPurpose } from '../../services/contracts'
import { mediaService } from '../../services/mediaService'

const purposes: Array<'' | MediaAssetPurpose> = ['', 'task_attachment', 'submission_asset', 'profile_portfolio', 'library_asset']

export function AdminMediaLifecyclePanel({ t, canRead, canReview }: { t: Record<string, string>; canRead: boolean; canReview: boolean }) {
  const [items, setItems] = useState<ApiAdminMediaAsset[]>([])
  const [query, setQuery] = useState<AdminMediaAssetQuery>({ lifecycle: 'all', sort: 'created_desc', limit: 12 })
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (cursor: string | null = null) => {
    if (!canRead) return
    setLoading(true)
    setError(null)
    try {
      const page = await mediaService.adminAssets({ ...query, cursor })
      setItems((current) => cursor ? [...current, ...page.items] : page.items)
      setNextCursor(page.nextCursor)
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

  const runAction = async (item: ApiAdminMediaAsset, action: 'archive' | 'restore' | 'delete' | 'recover') => {
    setBusy(item.id)
    setError(null)
    try {
      const updated = await mediaService.adminAssetAction(item.id, action, action === 'delete' ? 'admin_lifecycle_action' : undefined)
      setItems((current) => current.map((candidate) => candidate.id === updated.id ? updated : candidate))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : textFor(t, 'Asset state action failed.', '素材状态操作失败。'))
    } finally {
      setBusy(null)
    }
  }

  return <div className="admin-media-lifecycle" data-testid="admin-media-lifecycle">
    <div className="admin-media-lifecycle-heading">
      <div><strong>{textFor(t, 'Asset lifecycle', '素材生命周期')}</strong><span>{textFor(t, 'Owner-safe metadata and portfolio visibility state', '所有者安全元数据与作品集可见性状态')}</span></div>
      <button className="icon-button" aria-label={textFor(t, 'Refresh asset lifecycle', '刷新素材生命周期')} disabled={!canRead || loading} onClick={() => void load()} type="button"><RefreshCw className={loading ? 'spin' : ''} size={16}/></button>
    </div>
    <div className="admin-media-lifecycle-filters">
      <input aria-label={textFor(t, 'Search asset lifecycle', '搜索素材生命周期')} placeholder={textFor(t, 'ID, filename, owner', 'ID、文件名、所有者')} value={query.search ?? ''} onChange={(event) => setQuery((current) => ({ ...current, search: event.target.value || null }))}/>
      <select aria-label={textFor(t, 'Admin asset lifecycle state', '管理端素材生命周期状态')} value={query.lifecycle ?? 'all'} onChange={(event) => setQuery((current) => ({ ...current, lifecycle: event.target.value as AdminMediaAssetQuery['lifecycle'] }))}><option value="all">{textFor(t, 'All states', '全部状态')}</option><option value="active">{textFor(t, 'Active', '使用中')}</option><option value="archived">{textFor(t, 'Archived', '已归档')}</option><option value="deleted">{textFor(t, 'Deleted', '回收站')}</option></select>
      <select aria-label={textFor(t, 'Admin asset purpose', '管理端素材用途')} value={query.purpose ?? ''} onChange={(event) => setQuery((current) => ({ ...current, purpose: event.target.value as MediaAssetPurpose || null }))}>{purposes.map((purpose) => <option key={purpose || 'all'} value={purpose}>{purpose || textFor(t, 'All purposes', '全部用途')}</option>)}</select>
      <select aria-label={textFor(t, 'Admin asset sort', '管理端素材排序')} value={query.sort ?? 'created_desc'} onChange={(event) => setQuery((current) => ({ ...current, sort: event.target.value as AdminMediaAssetQuery['sort'] }))}><option value="created_desc">{textFor(t, 'Newest first', '最新优先')}</option><option value="created_asc">{textFor(t, 'Oldest first', '最早优先')}</option><option value="updated_desc">{textFor(t, 'Recently updated', '最近更新')}</option><option value="name_asc">{textFor(t, 'Filename', '文件名')}</option></select>
    </div>
    {error && <p className="use-creative-asset-notice error">{error}</p>}
    <div className="admin-media-lifecycle-list" aria-busy={loading}>
      {!loading && items.length === 0 && <div className="empty-state"><strong>{textFor(t, 'No matching assets', '没有匹配的素材')}</strong><span>{textFor(t, 'Adjust lifecycle filters or search.', '调整生命周期筛选或搜索条件。')}</span></div>}
      {items.map((item) => <article key={item.id}>
        <div><strong>{item.fileName}</strong><span>@{item.owner.handle} · {item.purpose} · {item.status}/{item.scanStatus}</span><small>{item.deletedAt ? textFor(t, 'Deleted', '回收站') : item.archivedAt ? textFor(t, 'Archived', '已归档') : textFor(t, 'Active', '使用中')} · {item.relations.length} {textFor(t, 'relations', '条关系')} · {item.portfolio.length} {textFor(t, 'portfolio records', '条作品集记录')}</small></div>
        <div className="button-row">
          {!item.deletedAt && !item.archivedAt && <button className="ghost-button small" disabled={!canReview || busy === item.id} onClick={() => void runAction(item, 'archive')} type="button"><Archive size={14}/>{textFor(t, 'Archive', '归档')}</button>}
          {!item.deletedAt && item.archivedAt && <button className="ghost-button small" disabled={!canReview || busy === item.id} onClick={() => void runAction(item, 'restore')} type="button"><ArchiveRestore size={14}/>{textFor(t, 'Restore', '恢复')}</button>}
          {!item.deletedAt && <button className="ghost-button small" disabled={!canReview || busy === item.id} onClick={() => void runAction(item, 'delete')} type="button"><Trash2 size={14}/>{textFor(t, 'Delete', '删除')}</button>}
          {item.deletedAt && <button className="ghost-button small" disabled={!canReview || busy === item.id} onClick={() => void runAction(item, 'recover')} type="button"><Undo2 size={14}/>{textFor(t, 'Recover', '撤销删除')}</button>}
        </div>
      </article>)}
      {loading && <div className="portfolio-manager-state"><LoaderCircle className="spin" size={16}/>{textFor(t, 'Loading assets…', '正在加载素材…')}</div>}
    </div>
    {nextCursor && <button className="ghost-button" disabled={loading} onClick={() => void load(nextCursor)} type="button">{textFor(t, 'Load more', '加载更多')}</button>}
  </div>
}
