import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Archive, ArchiveRestore, ArrowDownToLine, Boxes, Check, ExternalLink, File, FileAudio, FileImage, FileVideo, FolderSearch, LayoutGrid, List, LoaderCircle, RefreshCw, Search, Send, SlidersHorizontal, Trash2, Undo2, Upload, X } from 'lucide-react'
import type { Page, PlaygroundMode } from '../../domain/types'
import { textFor } from '../../domain/utils'
import type { ApiAssetLibraryItem, AssetLibraryQuery, AssetMediaType, AssetWorkspace, MediaAssetPurpose } from '../../services/contracts'
import { mediaService } from '../../services/mediaService'
import { uploadMediaFile } from '../../services/mediaUpload'
import { UseCreativeAsset } from './UseCreativeAsset'

type Filters = { search: string; mediaType: '' | AssetMediaType; purpose: '' | MediaAssetPurpose; lifecycle: 'active' | 'archived' | 'deleted' | 'all'; dateFrom: string; dateTo: string; groupBy: 'none' | 'mediaType' | 'purpose' | 'source' }
const emptyFilters: Filters = { search: '', mediaType: '', purpose: '', lifecycle: 'active', dateFrom: '', dateTo: '', groupBy: 'none' }
const icons = { image: FileImage, video: FileVideo, audio: FileAudio, document: File } as const
const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
const formatDate = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const download = async (asset: ApiAssetLibraryItem) => {
  const contract = await mediaService.createDownload(asset.id)
  if (contract.download.url.startsWith('mock://')) return
  const link = document.createElement('a')
  link.href = contract.download.url
  link.download = asset.fileName
  link.rel = 'noopener'
  link.target = '_blank'
  link.click()
}

export function AssetLibraryPage({ t, signedIn, requireAuth, navigateToPage }: {
  t: Record<string, string>
  signedIn: boolean
  requireAuth: () => void
  navigateToPage: (page: Page, workspace?: PlaygroundMode) => void
}) {
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [items, setItems] = useState<ApiAssetLibraryItem[]>([])
  const [selected, setSelected] = useState<ApiAssetLibraryItem | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [filtersExpanded, setFiltersExpanded] = useState(false)
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({})
  const [failedPreviewUrls, setFailedPreviewUrls] = useState<Record<string, string>>({})
  const activeFilterCount = [filters.search, filters.mediaType, filters.purpose, filters.lifecycle !== 'active' ? filters.lifecycle : '', filters.dateFrom, filters.dateTo].filter(Boolean).length
  const mediaCounts = useMemo(() => items.reduce<Record<AssetMediaType, number>>((counts, item) => {
    counts[item.mediaType] += 1
    return counts
  }, { image: 0, video: 0, audio: 0, document: 0 }), [items])
  const groups = useMemo(() => {
    const grouped = new Map<string, ApiAssetLibraryItem[]>()
    for (const item of items) {
      const key = filters.groupBy === 'none' ? 'all' : filters.groupBy === 'purpose' ? item.purpose : filters.groupBy === 'source' ? (item.sourceGeneration?.workspace ?? 'upload') : item.mediaType
      grouped.set(key, [...(grouped.get(key) ?? []), item])
    }
    return [...grouped.entries()].map(([label, assets]) => ({ label, assets }))
  }, [filters.groupBy, items])

  const load = useCallback(async (cursor: string | null = null) => {
    if (!signedIn) return
    setLoading(true)
    setError(null)
    try {
      const query: AssetLibraryQuery = { limit: 24, cursor, search: filters.search || null, mediaType: filters.mediaType || null, purpose: filters.purpose || null, lifecycle: filters.lifecycle, dateFrom: filters.dateFrom ? `${filters.dateFrom}T00:00:00.000Z` : null, dateTo: filters.dateTo ? `${filters.dateTo}T23:59:59.999Z` : null }
      const page = await mediaService.assetLibrary(query)
      setItems((current) => cursor ? [...new Map([...current, ...page.items].map((item) => [item.id, item])).values()] : page.items)
      setNextCursor(page.nextCursor)
      setSelected((current) => page.items.find((item) => item.id === current?.id) ?? (cursor ? current : null))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : textFor(t, 'Could not load assets.', '无法加载资产。'))
    } finally { setLoading(false) }
  }, [filters, signedIn, t])

  useEffect(() => { const timer = window.setTimeout(() => void load(), 180); return () => window.clearTimeout(timer) }, [load])
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine)
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    return () => { window.removeEventListener('online', sync); window.removeEventListener('offline', sync) }
  }, [])
  useEffect(() => {
    let cancelled = false
    const objectUrls: string[] = []
    const candidates = items.filter((item) => online && item.actions.download.available && (item.mediaType === 'image' || item.mediaType === 'video')).slice(0, 12)
    void Promise.all(candidates.map(async (item) => {
      try {
        const contract = await mediaService.createDownload(item.id)
        if (contract.download.url.startsWith('mock://')) return null
        if (Object.keys(contract.download.headers).length === 0) return [item.id, contract.download.url] as const
        if (item.mediaType !== 'image') return null
        const response = await fetch(contract.download.url, { headers: contract.download.headers })
        if (!response.ok) return null
        const objectUrl = URL.createObjectURL(await response.blob())
        objectUrls.push(objectUrl)
        return [item.id, objectUrl] as const
      } catch {
        return null
      }
    })).then((entries) => {
      if (cancelled) return
      setPreviewUrls(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry))))
    })
    return () => {
      cancelled = true
      objectUrls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [items, online])
  useEffect(() => {
    if (!selected) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [selected])

  const updateArchive = async (asset: ApiAssetLibraryItem) => {
    setBusy(asset.id)
    try {
      const updated = asset.archivedAt ? await mediaService.restoreAsset(asset.id) : await mediaService.archiveAsset(asset.id)
      if (filters.lifecycle === 'all') setItems((current) => current.map((item) => item.id === updated.id ? updated : item))
      else setItems((current) => current.filter((item) => item.id !== updated.id))
      setSelected(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Asset action failed') }
    finally { setBusy(null) }
  }

  const updateDeleted = async (asset: ApiAssetLibraryItem) => {
    if (!asset.deletedAt && deleteConfirmId !== asset.id) {
      setDeleteConfirmId(asset.id)
      return
    }
    setBusy(asset.id)
    setError(null)
    try {
      const updated = asset.deletedAt ? await mediaService.recoverAsset(asset.id) : await mediaService.deleteAsset(asset.id)
      if (filters.lifecycle === 'all') setItems((current) => current.map((item) => item.id === updated.id ? updated : item))
      else setItems((current) => current.filter((item) => item.id !== updated.id))
      setSelected(null)
      setDeleteConfirmId(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Asset delete action failed') }
    finally { setBusy(null) }
  }

  const uploadFile = async (file: File | null) => {
    if (!file || !online) return
    setUploading(true)
    setError(null)
    try {
      await uploadMediaFile(file, { purpose: 'library_asset', metadata: { source: 'asset_library' } })
      setFilters((current) => ({ ...current, lifecycle: 'active', search: '' }))
      await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : textFor(t, 'Upload could not be prepared.', '无法准备上传。')) }
    finally { setUploading(false) }
  }

  const reuse = (asset: ApiAssetLibraryItem, workspace: AssetWorkspace) => {
    if (!online || !asset.actions.reuse[workspace].available || workspace === 'music') return
    window.sessionStorage.setItem('hcaiAssetReuse', JSON.stringify({ assetId: asset.id, workspace }))
    navigateToPage('playground', workspace)
  }

  const openSourceGeneration = (asset: ApiAssetLibraryItem) => {
    if (!asset.sourceGeneration) return
    navigateToPage('generations')
    window.history.replaceState(null, '', `#generations/${encodeURIComponent(asset.sourceGeneration.id)}`)
  }

  const mediaLabel = (mediaType: AssetMediaType) => ({
    image: textFor(t, 'Image', '图片'),
    video: textFor(t, 'Video', '视频'),
    audio: textFor(t, 'Audio', '音频'),
    document: textFor(t, 'Document', '文档'),
  })[mediaType]

  const purposeLabel = (purpose: MediaAssetPurpose) => ({
    library_asset: textFor(t, 'Library', '素材库'),
    submission_asset: textFor(t, 'Submission', '任务交付'),
    profile_portfolio: textFor(t, 'Portfolio', '作品集'),
    task_attachment: textFor(t, 'Attachment', '任务附件'),
  })[purpose]

  const statusLabel = (asset: ApiAssetLibraryItem) => asset.deletedAt
    ? textFor(t, 'Trash', '回收站')
    : asset.archivedAt
      ? textFor(t, 'Archived', '已归档')
      : asset.status === 'pending' || asset.scanStatus === 'pending'
        ? textFor(t, 'Processing', '处理中')
        : asset.status === 'rejected'
          ? textFor(t, 'Unavailable', '不可用')
          : textFor(t, 'Ready', '可使用')

  const groupLabel = (label: string) => {
    if (filters.groupBy === 'none') return textFor(t, 'All assets', '全部素材')
    if (filters.groupBy === 'mediaType' && label in icons) return mediaLabel(label as AssetMediaType)
    if (filters.groupBy === 'purpose') return purposeLabel(label as MediaAssetPurpose)
    return label === 'upload' ? textFor(t, 'Uploads', '手动上传') : label.replaceAll('_', ' ')
  }

  const renderAssetCard = (asset: ApiAssetLibraryItem) => {
    const Icon = icons[asset.mediaType]
    const previewUrl = previewUrls[asset.id]
    const previewAvailable = Boolean(previewUrl && failedPreviewUrls[asset.id] !== previewUrl)
    const markPreviewFailed = () => previewUrl && setFailedPreviewUrls((current) => ({ ...current, [asset.id]: previewUrl }))
    const state = statusLabel(asset)
    const stateKind = asset.status === 'pending' || asset.scanStatus === 'pending' ? 'pending' : asset.status === 'rejected' ? 'blocked' : ''
    const StateIcon = stateKind === 'pending' ? LoaderCircle : stateKind === 'blocked' ? X : Check
    return <button className={selected?.id === asset.id ? 'asset-card selected' : 'asset-card'} key={asset.id} onClick={() => { setSelected(asset); setDeleteConfirmId(null) }} type="button">
      <span className={`asset-card-preview ${asset.mediaType}${previewAvailable ? ' has-media' : ''}`} aria-hidden="true">
        {previewAvailable && asset.mediaType === 'image' ? <img alt="" loading="lazy" onError={markPreviewFailed} src={previewUrl}/> : previewAvailable && asset.mediaType === 'video' ? <video muted playsInline preload="metadata" onError={markPreviewFailed} src={previewUrl}/> : <span className="asset-preview-mark" data-testid={previewUrl ? `asset-preview-fallback-${asset.id}` : undefined}><Icon size={32}/></span>}
        <span className="asset-preview-type">{mediaLabel(asset.mediaType)}</span>
      </span>
      <span className="asset-card-copy">
        <strong title={asset.fileName}>{asset.fileName}</strong>
        <small>{formatDate(asset.createdAt)} · {formatBytes(asset.sizeBytes)}</small>
      </span>
      <span className={`asset-card-state ${stateKind}`}><StateIcon className={stateKind === 'pending' ? 'spin' : ''} size={12}/>{state}</span>
    </button>
  }

  const renderAssetDetail = () => {
    if (!selected) return null
    const Icon = icons[selected.mediaType]
    const previewUrl = previewUrls[selected.id]
    const previewAvailable = Boolean(previewUrl && failedPreviewUrls[selected.id] !== previewUrl)
    const markPreviewFailed = () => previewUrl && setFailedPreviewUrls((current) => ({ ...current, [selected.id]: previewUrl }))
    const detail = <aside aria-label={textFor(t, 'Asset details', '素材详情')} className="asset-detail">
      <div className="asset-detail-toolbar">
        <strong>{textFor(t, 'Asset details', '素材详情')}</strong>
        <button aria-label={textFor(t, 'Close asset details', '关闭素材详情')} onClick={() => setSelected(null)} title={textFor(t, 'Close asset details', '关闭素材详情')} type="button"><X size={16}/></button>
      </div>
      <div className={`asset-detail-preview ${selected.mediaType}${previewAvailable ? ' has-media' : ''}`}>
        {previewAvailable && selected.mediaType === 'image' ? <img alt="" onError={markPreviewFailed} src={previewUrl}/> : previewAvailable && selected.mediaType === 'video' ? <video muted playsInline preload="metadata" onError={markPreviewFailed} src={previewUrl}/> : <Icon data-testid={previewUrl ? `asset-detail-preview-fallback-${selected.id}` : undefined} size={42}/>}<span>{mediaLabel(selected.mediaType)}</span>
      </div>
      <div className="asset-detail-title"><div><small>{purposeLabel(selected.purpose)}</small><h2>{selected.fileName}</h2><span className="asset-detail-state"><Check size={12}/>{statusLabel(selected)}</span></div></div>
      <div className="asset-actions">
        <button className="ghost-button" disabled={!selected.actions.download.available || !online} onClick={() => void download(selected).catch((cause) => setError(cause instanceof Error ? cause.message : 'Download failed'))} type="button"><ArrowDownToLine size={15}/>{textFor(t, 'Download', '下载')}</button>
        {selected.sourceGeneration && <button className="ghost-button" onClick={() => openSourceGeneration(selected)} type="button"><ExternalLink size={15}/>{textFor(t, 'Open source task', '打开来源任务')}</button>}
        <button className="ghost-button" disabled={busy === selected.id || !online || !selected.actions.archive.available && !selected.actions.restore.available} onClick={() => void updateArchive(selected)} type="button">{selected.archivedAt ? <ArchiveRestore size={15}/> : <Archive size={15}/>} {selected.archivedAt ? textFor(t, 'Restore', '恢复') : textFor(t, 'Archive', '归档')}</button>
        <button className={deleteConfirmId === selected.id ? 'danger-button' : 'ghost-button'} disabled={busy === selected.id || !online} onClick={() => void updateDeleted(selected)} type="button">{selected.deletedAt ? <Undo2 size={15}/> : <Trash2 size={15}/>} {selected.deletedAt ? textFor(t, 'Recover', '撤销删除') : deleteConfirmId === selected.id ? textFor(t, 'Confirm delete', '确认删除') : textFor(t, 'Delete', '删除')}</button>
      </div>
      <UseCreativeAsset t={t} assetId={selected.id} fileName={selected.fileName} available={!selected.archivedAt && !selected.deletedAt && selected.status === 'uploaded' && selected.scanStatus === 'clean' && Boolean(selected.sourceGeneration)}/>
      <dl>
        <div><dt>{textFor(t, 'Created', '创建时间')}</dt><dd>{formatDate(selected.createdAt)}</dd></div>
        <div><dt>{textFor(t, 'Size', '大小')}</dt><dd>{formatBytes(selected.sizeBytes)}</dd></div>
        <div><dt>{textFor(t, 'Source', '来源')}</dt><dd>{selected.sourceGeneration ? `${selected.sourceGeneration.workspace} / ${selected.sourceGeneration.mode}` : textFor(t, 'Upload', '上传')}</dd></div>
        <div><dt>{textFor(t, 'Lifecycle', '生命周期')}</dt><dd>{statusLabel(selected)}</dd></div>
        <div><dt>{textFor(t, 'Availability', '可用状态')}</dt><dd>{selected.status} / {selected.scanStatus}</dd></div>
        <div><dt>{textFor(t, 'Evidence', '证据引用')}</dt><dd>{selected.referenced ? textFor(t, 'Retained', '已保留') : textFor(t, 'None', '无')}</dd></div>
      </dl>
      <div className="asset-reuse"><strong>{textFor(t, 'Send to studio', '发送到工作台')}</strong><div>{(['image','video','chat'] as AssetWorkspace[]).map((workspace) => <button key={workspace} disabled={!online || !selected.actions.reuse[workspace].available} title={selected.actions.reuse[workspace].reason ?? workspace} onClick={() => reuse(selected, workspace)} type="button"><Send size={14}/>{workspace}</button>)}</div></div>
      <div className="asset-lineage"><div><strong>{textFor(t, 'Version history', '版本关系')}</strong><span>{selected.relations.length}</span></div>{selected.relations.length === 0 ? <p>{textFor(t, 'Original asset. No derived versions yet.', '原始素材，暂无衍生版本。')}</p> : selected.relations.map((relation) => <p key={relation.id}>{relation.relationType.replaceAll('_', ' ')} · {relation.sourceAssetId === selected.id ? `→ ${relation.targetAssetId}` : `← ${relation.sourceAssetId}`}</p>)}</div>
    </aside>
    return createPortal(detail, document.querySelector('.app-shell') ?? document.body)
  }

  if (!signedIn) return <section className="asset-library-page"><div className="asset-library-auth"><Boxes size={28}/><h1>{textFor(t, 'Assets', '资产库')}</h1><p>{textFor(t, 'Sign in to manage your governed creative assets.', '登录后管理你的受治理创作资产。')}</p><button className="primary-button" onClick={requireAuth} type="button">{textFor(t, 'Sign in', '登录')}</button></div></section>

  return <section className="asset-library-page" data-testid="asset-library">
    <header className="asset-library-header">
      <div className="asset-library-heading">
        <span>{textFor(t, 'Creative library', '创作素材库')} · {items.length} {textFor(t, items.length === 1 ? 'item' : 'items', '项')}</span>
        <h1>{textFor(t, 'Assets', '资产库')}</h1>
        <p>{textFor(t, 'Recent outputs and uploaded media, ready for the next idea.', '最近生成与上传的内容，随时进入下一次创作。')}</p>
        <div className="asset-library-breakdown">
          {(Object.entries(mediaCounts) as Array<[AssetMediaType, number]>).filter(([, count]) => count > 0).map(([mediaType, count]) => <span key={mediaType}><b>{count}</b>{mediaLabel(mediaType)}</span>)}
        </div>
      </div>
      <div className="asset-library-header-actions">
        <label className="asset-header-action primary asset-upload-button">
          <Upload size={17}/>
          <span>{uploading ? textFor(t, 'Preparing…', '准备中…') : textFor(t, 'Upload asset', '上传素材')}</span>
          <input aria-label={textFor(t, 'Upload asset', '上传资产')} disabled={uploading || !online} type="file" onChange={(event) => { void uploadFile(event.target.files?.[0] ?? null); event.target.value = '' }}/>
        </label>
        <button className="asset-header-action refresh" aria-label={textFor(t, 'Refresh assets', '刷新资产')} title={textFor(t, 'Refresh assets', '刷新资产')} onClick={() => void load()} type="button">
          <RefreshCw className={loading ? 'spin' : ''} size={17}/>
        </button>
      </div>
    </header>
    {!online && <div className="asset-library-notice offline"><AlertTriangle size={15}/><span>{textFor(t, 'Offline. Showing the last loaded asset state.', '当前离线，正在显示上次加载的资产状态。')}</span></div>}
    {error && <div className="asset-library-notice">{error}<button type="button" onClick={() => setError(null)}>×</button></div>}
    <section className={filtersExpanded ? 'asset-library-filters expanded' : 'asset-library-filters'} aria-label={textFor(t, 'Asset filters', '资产筛选')}>
      <div className="asset-filter-primary">
        <label className="asset-filter-field asset-search"><span>{textFor(t, 'Search', '搜索')}</span><div><Search size={15}/><input aria-label={textFor(t, 'Search assets', '搜索资产')} placeholder={textFor(t, 'Search filename', '搜索文件名')} value={filters.search} onChange={(event) => setFilters((value) => ({ ...value, search: event.target.value }))}/></div></label>
        <label className="asset-filter-field"><span>{textFor(t, 'Media', '类型')}</span><select aria-label={textFor(t, 'Media type', '媒体类型')} value={filters.mediaType} onChange={(event) => setFilters((value) => ({ ...value, mediaType: event.target.value as Filters['mediaType'] }))}><option value="">{textFor(t, 'All media', '全部媒体')}</option><option value="image">{textFor(t, 'Images', '图片')}</option><option value="video">{textFor(t, 'Video', '视频')}</option><option value="audio">{textFor(t, 'Audio', '音频')}</option><option value="document">{textFor(t, 'Documents', '文档')}</option></select></label>
        <label className="asset-filter-field"><span>{textFor(t, 'Status', '状态')}</span><select aria-label={textFor(t, 'Lifecycle state', '生命周期状态')} value={filters.lifecycle} onChange={(event) => setFilters((value) => ({ ...value, lifecycle: event.target.value as Filters['lifecycle'] }))}><option value="active">{textFor(t, 'Active', '使用中')}</option><option value="archived">{textFor(t, 'Archived', '已归档')}</option><option value="deleted">{textFor(t, 'Trash', '回收站')}</option><option value="all">{textFor(t, 'All', '全部')}</option></select></label>
        <button className={filtersExpanded ? 'asset-filter-toggle active' : 'asset-filter-toggle'} aria-expanded={filtersExpanded} onClick={() => setFiltersExpanded((value) => !value)} type="button"><SlidersHorizontal size={16}/><span>{textFor(t, 'Filters', '筛选')}</span>{activeFilterCount > 0 && <b>{activeFilterCount}</b>}</button>
        <div className="asset-view-toggle" role="group" aria-label={textFor(t, 'Asset view', '素材视图')}>
          <button aria-label={textFor(t, 'Grid view', '网格视图')} aria-pressed={viewMode === 'grid'} onClick={() => setViewMode('grid')} title={textFor(t, 'Grid view', '网格视图')} type="button"><LayoutGrid size={16}/></button>
          <button aria-label={textFor(t, 'List view', '列表视图')} aria-pressed={viewMode === 'list'} onClick={() => setViewMode('list')} title={textFor(t, 'List view', '列表视图')} type="button"><List size={16}/></button>
        </div>
      </div>
      {filtersExpanded && <div className="asset-filter-secondary">
        <label className="asset-filter-field"><span>{textFor(t, 'Purpose', '用途')}</span><select aria-label={textFor(t, 'Purpose', '用途')} value={filters.purpose} onChange={(event) => setFilters((value) => ({ ...value, purpose: event.target.value as Filters['purpose'] }))}><option value="">{textFor(t, 'All purposes', '全部用途')}</option><option value="library_asset">{textFor(t, 'Library', '资产库')}</option><option value="submission_asset">{textFor(t, 'Submission', '任务交付')}</option><option value="profile_portfolio">{textFor(t, 'Portfolio', '作品集')}</option><option value="task_attachment">{textFor(t, 'Attachment', '任务附件')}</option></select></label>
        <label className="asset-filter-field"><span>{textFor(t, 'Group', '分组')}</span><select aria-label={textFor(t, 'Group assets by', '资产分组方式')} value={filters.groupBy} onChange={(event) => setFilters((value) => ({ ...value, groupBy: event.target.value as Filters['groupBy'] }))}><option value="none">{textFor(t, 'No grouping', '不分组')}</option><option value="mediaType">{textFor(t, 'Group by media', '按媒体类型')}</option><option value="purpose">{textFor(t, 'Group by purpose', '按用途')}</option><option value="source">{textFor(t, 'Group by source', '按来源')}</option></select></label>
        <label className="asset-filter-field"><span>{textFor(t, 'From', '开始日期')}</span><input aria-label={textFor(t, 'Created after', '创建开始日期')} type="date" value={filters.dateFrom} onChange={(event) => setFilters((value) => ({ ...value, dateFrom: event.target.value }))}/></label>
        <label className="asset-filter-field"><span>{textFor(t, 'To', '结束日期')}</span><input aria-label={textFor(t, 'Created before', '创建结束日期')} type="date" value={filters.dateTo} onChange={(event) => setFilters((value) => ({ ...value, dateTo: event.target.value }))}/></label>
        <button className="asset-filter-reset" disabled={activeFilterCount === 0} onClick={() => setFilters(emptyFilters)} type="button"><X size={15}/>{textFor(t, 'Clear', '清除')}</button>
      </div>}
    </section>
    <section className={items.length === 0 ? 'asset-library-workbench empty' : 'asset-library-workbench'}>
      <div className={`asset-grid ${viewMode}`} aria-busy={loading}>{loading && items.length === 0 ? <div className="asset-empty"><LoaderCircle className="spin"/><span>{textFor(t, 'Loading assets…', '正在加载资产…')}</span></div> : items.length === 0 ? <div className="asset-empty"><FolderSearch/><strong>{textFor(t, 'No assets found', '没有找到资产')}</strong><span>{textFor(t, 'Adjust filters or create something in a studio.', '调整筛选条件或前往工作台创作。')}</span><button className="primary-button" type="button" onClick={() => navigateToPage('playground', 'image')}><ExternalLink size={15}/>{textFor(t, 'Create your first asset', '创作第一份资产')}</button></div> : groups.map((group) => <section className="asset-group" key={group.label}><header><strong>{groupLabel(group.label)}</strong><span>{group.assets.length}</span></header><div>{group.assets.map(renderAssetCard)}</div></section>)}{nextCursor && <button className="asset-load-more" disabled={loading} onClick={() => void load(nextCursor)} type="button">{textFor(t, 'Load more', '加载更多')}</button>}</div>
      {renderAssetDetail()}
    </section>
  </section>
}
