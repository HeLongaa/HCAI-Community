import { useCallback, useEffect, useMemo, useState } from 'react'
import { Archive, ArchiveRestore, ArrowDownToLine, Boxes, ChevronRight, File, FileAudio, FileImage, FileVideo, FolderSearch, LoaderCircle, RefreshCw, Search, Send, ShieldCheck } from 'lucide-react'
import type { Page, PlaygroundMode } from '../../domain/types'
import { textFor } from '../../domain/utils'
import type { ApiAssetLibraryItem, AssetLibraryQuery, AssetMediaType, AssetWorkspace, MediaAssetPurpose } from '../../services/contracts'
import { mediaService } from '../../services/mediaService'

type Filters = { search: string; mediaType: '' | AssetMediaType; purpose: '' | MediaAssetPurpose; archived: 'active' | 'archived' | 'all'; dateFrom: string; dateTo: string; groupBy: 'mediaType' | 'purpose' | 'source' }
const emptyFilters: Filters = { search: '', mediaType: '', purpose: '', archived: 'active', dateFrom: '', dateTo: '', groupBy: 'mediaType' }
const icons = { image: FileImage, video: FileVideo, audio: FileAudio, document: File } as const
const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`

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
  const [error, setError] = useState<string | null>(null)
  const groups = useMemo(() => {
    const grouped = new Map<string, ApiAssetLibraryItem[]>()
    for (const item of items) {
      const key = filters.groupBy === 'purpose' ? item.purpose : filters.groupBy === 'source' ? (item.sourceGeneration?.workspace ?? 'upload') : item.mediaType
      grouped.set(key, [...(grouped.get(key) ?? []), item])
    }
    return [...grouped.entries()].map(([label, assets]) => ({ label, assets }))
  }, [filters.groupBy, items])

  const load = useCallback(async (cursor: string | null = null) => {
    if (!signedIn) return
    setLoading(true)
    setError(null)
    try {
      const query: AssetLibraryQuery = { limit: 24, cursor, search: filters.search || null, mediaType: filters.mediaType || null, purpose: filters.purpose || null, archived: filters.archived, dateFrom: filters.dateFrom ? `${filters.dateFrom}T00:00:00.000Z` : null, dateTo: filters.dateTo ? `${filters.dateTo}T23:59:59.999Z` : null }
      const page = await mediaService.assetLibrary(query)
      setItems((current) => cursor ? [...new Map([...current, ...page.items].map((item) => [item.id, item])).values()] : page.items)
      setNextCursor(page.nextCursor)
      setSelected((current) => page.items.find((item) => item.id === current?.id) ?? (cursor ? current : page.items[0] ?? null))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : textFor(t, 'Could not load assets.', '无法加载资产。'))
    } finally { setLoading(false) }
  }, [filters, signedIn, t])

  useEffect(() => { const timer = window.setTimeout(() => void load(), 180); return () => window.clearTimeout(timer) }, [load])

  const updateArchive = async (asset: ApiAssetLibraryItem) => {
    setBusy(asset.id)
    try {
      const updated = asset.archivedAt ? await mediaService.restoreAsset(asset.id) : await mediaService.archiveAsset(asset.id)
      if (filters.archived === 'all') setItems((current) => current.map((item) => item.id === updated.id ? updated : item))
      else setItems((current) => current.filter((item) => item.id !== updated.id))
      setSelected(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Asset action failed') }
    finally { setBusy(null) }
  }

  const reuse = (asset: ApiAssetLibraryItem, workspace: AssetWorkspace) => {
    if (!asset.actions.reuse[workspace].available || workspace === 'music') return
    window.sessionStorage.setItem('hcaiAssetReuse', JSON.stringify({ assetId: asset.id, workspace }))
    navigateToPage('playground', workspace)
  }

  const renderAssetCard = (asset: ApiAssetLibraryItem) => {
    const Icon = icons[asset.mediaType]
    return <button className={selected?.id === asset.id ? 'asset-card selected' : 'asset-card'} key={asset.id} onClick={() => setSelected(asset)} type="button"><span className={`asset-thumb ${asset.mediaType}`}><Icon size={24}/></span><span className="asset-card-copy"><strong>{asset.fileName}</strong><small>{asset.mediaType} · {formatBytes(asset.sizeBytes)}</small><span><ShieldCheck size={12}/>{asset.scanStatus}{asset.archivedAt && ` · ${textFor(t, 'archived', '已归档')}`}</span></span><ChevronRight size={15}/></button>
  }

  if (!signedIn) return <main className="asset-library-page"><section className="asset-library-auth"><Boxes size={28}/><h1>{textFor(t, 'Assets', '资产库')}</h1><p>{textFor(t, 'Sign in to manage your governed creative assets.', '登录后管理你的受治理创作资产。')}</p><button className="primary-button" onClick={requireAuth} type="button">{textFor(t, 'Sign in', '登录')}</button></section></main>

  return <main className="asset-library-page" data-testid="asset-library">
    <header className="asset-library-header"><div><span><Boxes size={14}/> {textFor(t, 'Creative system of record', '创作资产事实源')}</span><h1>{textFor(t, 'Assets', '资产库')}</h1><p>{textFor(t, 'Search, trace, archive, and reuse governed outputs across studios.', '跨工作台搜索、追溯、归档和复用受治理的创作产物。')}</p></div><button className="icon-button" aria-label={textFor(t, 'Refresh assets', '刷新资产')} onClick={() => void load()} type="button"><RefreshCw className={loading ? 'spin' : ''} size={17}/></button></header>
    {error && <div className="asset-library-notice">{error}<button type="button" onClick={() => setError(null)}>×</button></div>}
    <section className="asset-library-filters" aria-label={textFor(t, 'Asset filters', '资产筛选')}>
      <label className="asset-search"><Search size={15}/><input aria-label={textFor(t, 'Search assets', '搜索资产')} placeholder={textFor(t, 'Search filename', '搜索文件名')} value={filters.search} onChange={(event) => setFilters((value) => ({ ...value, search: event.target.value }))}/></label>
      <select aria-label={textFor(t, 'Media type', '媒体类型')} value={filters.mediaType} onChange={(event) => setFilters((value) => ({ ...value, mediaType: event.target.value as Filters['mediaType'] }))}><option value="">{textFor(t, 'All media', '全部媒体')}</option><option value="image">{textFor(t, 'Images', '图片')}</option><option value="video">{textFor(t, 'Video', '视频')}</option><option value="audio">{textFor(t, 'Audio', '音频')}</option><option value="document">{textFor(t, 'Documents', '文档')}</option></select>
      <select aria-label={textFor(t, 'Purpose', '用途')} value={filters.purpose} onChange={(event) => setFilters((value) => ({ ...value, purpose: event.target.value as Filters['purpose'] }))}><option value="">{textFor(t, 'All purposes', '全部用途')}</option><option value="library_asset">{textFor(t, 'Library', '资产库')}</option><option value="submission_asset">{textFor(t, 'Submission', '任务交付')}</option><option value="profile_portfolio">{textFor(t, 'Portfolio', '作品集')}</option><option value="task_attachment">{textFor(t, 'Attachment', '任务附件')}</option></select>
      <select aria-label={textFor(t, 'Archive state', '归档状态')} value={filters.archived} onChange={(event) => setFilters((value) => ({ ...value, archived: event.target.value as Filters['archived'] }))}><option value="active">{textFor(t, 'Active', '使用中')}</option><option value="archived">{textFor(t, 'Archived', '已归档')}</option><option value="all">{textFor(t, 'All', '全部')}</option></select>
      <select aria-label={textFor(t, 'Group assets by', '资产分组方式')} value={filters.groupBy} onChange={(event) => setFilters((value) => ({ ...value, groupBy: event.target.value as Filters['groupBy'] }))}><option value="mediaType">{textFor(t, 'Group by media', '按媒体类型')}</option><option value="purpose">{textFor(t, 'Group by purpose', '按用途')}</option><option value="source">{textFor(t, 'Group by source', '按来源')}</option></select>
      <input aria-label={textFor(t, 'Created after', '创建开始日期')} type="date" value={filters.dateFrom} onChange={(event) => setFilters((value) => ({ ...value, dateFrom: event.target.value }))}/>
      <input aria-label={textFor(t, 'Created before', '创建结束日期')} type="date" value={filters.dateTo} onChange={(event) => setFilters((value) => ({ ...value, dateTo: event.target.value }))}/>
    </section>
    <section className="asset-library-workbench">
      <div className="asset-grid" aria-busy={loading}>{loading && items.length === 0 ? <div className="asset-empty"><LoaderCircle className="spin"/><span>{textFor(t, 'Loading assets…', '正在加载资产…')}</span></div> : items.length === 0 ? <div className="asset-empty"><FolderSearch/><strong>{textFor(t, 'No assets found', '没有找到资产')}</strong><span>{textFor(t, 'Adjust filters or create something in a studio.', '调整筛选条件或前往工作台创作。')}</span></div> : groups.map((group) => <section className="asset-group" key={group.label}><header><strong>{group.label.replaceAll('_', ' ')}</strong><span>{group.assets.length}</span></header><div>{group.assets.map(renderAssetCard)}</div></section>)}{nextCursor && <button className="asset-load-more" disabled={loading} onClick={() => void load(nextCursor)} type="button">{textFor(t, 'Load more', '加载更多')}</button>}</div>
      <aside className="asset-detail">{!selected ? <div className="asset-empty"><Boxes/><span>{textFor(t, 'Select an asset for details.', '选择资产以查看详情。')}</span></div> : <><div className="asset-detail-title"><span className={`asset-thumb ${selected.mediaType}`}>{(() => { const Icon = icons[selected.mediaType]; return <Icon size={22}/> })()}</span><div><small>{selected.purpose.replaceAll('_', ' ')}</small><h2>{selected.fileName}</h2></div></div><dl><div><dt>{textFor(t, 'Governance', '治理状态')}</dt><dd>{selected.status} / {selected.scanStatus}</dd></div><div><dt>{textFor(t, 'Size', '大小')}</dt><dd>{formatBytes(selected.sizeBytes)}</dd></div><div><dt>{textFor(t, 'Source', '来源')}</dt><dd>{selected.sourceGeneration ? `${selected.sourceGeneration.workspace} / ${selected.sourceGeneration.mode}` : textFor(t, 'Upload', '上传')}</dd></div><div><dt>{textFor(t, 'Evidence', '证据引用')}</dt><dd>{selected.referenced ? textFor(t, 'Retained', '已保留') : textFor(t, 'None', '无')}</dd></div></dl><div className="asset-lineage"><div><strong>{textFor(t, 'Version & reuse lineage', '版本与复用关系')}</strong><span>{selected.relations.length}</span></div>{selected.relations.length === 0 ? <p>{textFor(t, 'Original asset. No derived versions yet.', '原始资产，暂无衍生版本。')}</p> : selected.relations.map((relation) => <p key={relation.id}>{relation.relationType.replaceAll('_', ' ')} · {relation.sourceAssetId === selected.id ? `→ ${relation.targetAssetId}` : `← ${relation.sourceAssetId}`}</p>)}</div><div className="asset-actions"><button className="ghost-button" disabled={!selected.actions.download.available} onClick={() => void download(selected).catch((cause) => setError(cause instanceof Error ? cause.message : 'Download failed'))} type="button"><ArrowDownToLine size={15}/>{textFor(t, 'Download', '下载')}</button><button className="ghost-button" disabled={busy === selected.id} onClick={() => void updateArchive(selected)} type="button">{selected.archivedAt ? <ArchiveRestore size={15}/> : <Archive size={15}/>} {selected.archivedAt ? textFor(t, 'Restore', '恢复') : textFor(t, 'Archive', '归档')}</button></div><div className="asset-reuse"><strong>{textFor(t, 'Send to studio', '发送到工作台')}</strong>{(['image','video','chat'] as AssetWorkspace[]).map((workspace) => <button key={workspace} disabled={!selected.actions.reuse[workspace].available} title={selected.actions.reuse[workspace].reason ?? workspace} onClick={() => reuse(selected, workspace)} type="button"><Send size={14}/>{workspace}</button>)}</div></>}</aside>
    </section>
  </main>
}
