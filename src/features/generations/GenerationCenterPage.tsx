import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpDown,
  BadgeCheck,
  Boxes,
  CalendarDays,
  ChevronRight,
  CircleX,
  Coins,
  ExternalLink,
  FileOutput,
  Hash,
  Image,
  ListFilter,
  LoaderCircle,
  MessageSquareText,
  Music2,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Video,
  X,
} from 'lucide-react'
import type { Page, PlaygroundMode } from '../../domain/types'
import { textFor } from '../../domain/utils'
import { creativeService } from '../../services/creativeService'
import { UseCreativeAsset } from '../assets/UseCreativeAsset'
import { mediaService } from '../../services/mediaService'
import type { ApiGenerationTask, CreativeWorkspace, GenerationCenterQuery, GenerationCenterSummary } from '../../services/contracts'
import { MediaLoadFallback } from '../../components/ui/MediaLoadFallback'

type Filters = {
  workspace: '' | CreativeWorkspace
  status: string
  dateFrom: string
  dateTo: string
  sort: 'createdAt' | 'updatedAt' | 'status'
  direction: 'asc' | 'desc'
}

const emptyFilters: Filters = { workspace: '', status: '', dateFrom: '', dateTo: '', sort: 'createdAt', direction: 'desc' }
const activeStatuses = new Set(['queued', 'running'])

const workspaceIcon = {
  image: Image,
  chat: MessageSquareText,
  video: Video,
  music: Music2,
} satisfies Record<CreativeWorkspace, typeof Image>

const workspaceLabel = (workspace: CreativeWorkspace, locale: string) => locale === 'zh' ? ({
  image: '图片',
  chat: '对话',
  video: '视频',
  music: '音乐',
})[workspace] : ({
  image: 'Image',
  chat: 'Chat',
  video: 'Video',
  music: 'Music',
})[workspace]

const modeLabel = (mode: string, locale: string) => {
  const labels: Record<string, [string, string]> = {
    text_to_image: ['Text to Image', '文生图'],
    image_to_image: ['Image to Image', '图生图'],
    image_edit: ['Image Edit', '图片编辑'],
    image_variation: ['Image Variation', '图片变体'],
    assistant: ['Assistant', '智能对话'],
    prompt_assist: ['Prompt Assist', '提示词助手'],
    storyboard: ['Storyboard', '分镜创作'],
    text_to_video: ['Text to Video', '文生视频'],
    image_to_video: ['Image to Video', '图生视频'],
    music_video: ['Music Video', '音乐视频'],
    instrumental: ['Instrumental', '纯音乐'],
    lyrics_to_song: ['Lyrics to Song', '歌词成曲'],
  }
  return labels[mode]?.[locale === 'zh' ? 1 : 0] ?? mode.replaceAll('_', ' ')
}

const generationStatusLabel = (status: string, locale: string) => {
  if (locale !== 'zh') return status.replaceAll('_', ' ')
  return ({
    queued: '排队中',
    running: '生成中',
    completed: '已完成',
    review_required: '待审核',
    failed: '失败',
    cancelled: '已取消',
  } as Record<string, string>)[status] ?? status
}

const outputMeta = (output: ApiGenerationTask['outputs'][number], locale: string) => {
  const scan = locale === 'zh' ? ({ clean: '可用', pending: '处理中', rejected: '不可用', failed: '扫描失败' } as Record<string, string>)[output.scanStatus] ?? output.scanStatus : output.scanStatus
  const type = output.contentType.split('/')[1]?.toUpperCase() ?? output.contentType
  return locale === 'zh'
    ? `${scan} · ${type} · ${output.lineage.length} 条来源关系`
    : `${scan} · ${type} · ${output.lineage.length} lineage links`
}

const outputTitle = (output: ApiGenerationTask['outputs'][number], locale: string, index: number, total: number) => {
  const labels = output.contentType.startsWith('video/')
    ? ['Video output', '视频产物']
    : output.contentType.startsWith('image/')
      ? ['Image output', '图片产物']
      : output.contentType.startsWith('audio/')
        ? ['Audio output', '音频产物']
        : ['Generated output', '生成产物']
  const label = labels[locale === 'zh' ? 1 : 0]
  return total > 1 ? `${label} ${String(index + 1).padStart(2, '0')}` : label
}

const formatDate = (value: string | null, locale: string) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const queryFor = (filters: Filters, cursor: string | null = null): GenerationCenterQuery => ({
  limit: 20,
  cursor,
  workspace: filters.workspace || null,
  status: filters.status || null,
  dateFrom: filters.dateFrom ? `${filters.dateFrom}T00:00:00.000Z` : null,
  dateTo: filters.dateTo ? `${filters.dateTo}T23:59:59.999Z` : null,
  sort: filters.sort,
  direction: filters.direction,
})

const downloadAsset = async (assetId: string) => {
  const contract = await mediaService.createDownload(assetId)
  if (contract.download.url.startsWith('mock://')) return
  const response = await fetch(contract.download.url, { headers: contract.download.headers })
  if (!response.ok) throw new Error('Download failed')
  const blobUrl = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = blobUrl
  link.download = contract.asset.fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(blobUrl)
}

export function GenerationCenterPage({
  t,
  signedIn,
  requireAuth,
  navigateToPage,
}: {
  t: Record<string, string>
  signedIn: boolean
  requireAuth: () => void
  navigateToPage: (page: Page, workspace?: PlaygroundMode) => void
}) {
  const locale = t.home === '首页' ? 'zh' : 'en'
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [items, setItems] = useState<ApiGenerationTask[]>([])
  const [summary, setSummary] = useState<GenerationCenterSummary | null>(null)
  const [selected, setSelected] = useState<ApiGenerationTask | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [actionId, setActionId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [preview, setPreview] = useState<{ assetId: string; url: string } | null>(null)
  const [failedPreviewUrl, setFailedPreviewUrl] = useState<string | null>(null)

  const mergeItems = useCallback((incoming: ApiGenerationTask[], append = false) => {
    setItems((current) => {
      const base = append ? current : []
      const mergedById = new Map(base.map((item) => [item.id, item]))
      for (const item of incoming) mergedById.set(item.id, item)
      const merged = [...mergedById.values()]
      return merged.sort((left, right) => String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? '')))
    })
  }, [])

  const load = useCallback(async (cursor: string | null = null, background = false) => {
    if (!signedIn) return
    if (cursor) setLoadingMore(true)
    else if (background) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const query = queryFor(filters, cursor)
      const [page, nextSummary] = await Promise.all([
        creativeService.listGenerationTasks(query),
        cursor ? Promise.resolve(null) : creativeService.generationCenterSummary(query),
      ])
      mergeItems(page.items, Boolean(cursor))
      if (nextSummary) setSummary(nextSummary)
      setNextCursor(page.nextCursor)
      setSelected((current) => {
        if (cursor) return current ?? page.items[0] ?? null
        if (background && current) return page.items.find((item) => item.id === current.id) ?? current
        return page.items[0] ?? null
      })
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : textFor(t, 'Could not load generation history.', '无法加载生成历史。'))
    } finally {
      setLoading(false)
      setLoadingMore(false)
      setRefreshing(false)
    }
  }, [filters, mergeItems, signedIn, t])

  useEffect(() => {
    if (!signedIn) return
    const timeout = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timeout)
  }, [load, signedIn])

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  const hasActiveItems = useMemo(() => items.some((item) => activeStatuses.has(item.status)), [items])
  const hasFilters = useMemo(() => JSON.stringify(filters) !== JSON.stringify(emptyFilters), [filters])
  const activeFilterCount = useMemo(() => (
    [filters.workspace, filters.status, filters.dateFrom, filters.dateTo].filter(Boolean).length
    + (filters.sort !== emptyFilters.sort || filters.direction !== emptyFilters.direction ? 1 : 0)
  ), [filters])
  useEffect(() => {
    if (!signedIn || !online || !hasActiveItems) return
    const interval = window.setInterval(() => void load(null, true), 5_000)
    return () => window.clearInterval(interval)
  }, [hasActiveItems, load, online, signedIn])

  const selectedPreviewOutput = selected?.outputs.find((output) => output.status === 'uploaded' && output.scanStatus === 'clean') ?? null
  useEffect(() => {
    let active = true
    let objectUrl: string | null = null
    if (!selectedPreviewOutput || !selected?.actions.download.available || !online) return
    void mediaService.createDownload(selectedPreviewOutput.assetId)
      .then(async (contract) => {
        if (!active || contract.download.url.startsWith('mock://')) return
        if (Object.keys(contract.download.headers).length === 0) {
          setPreview({ assetId: selectedPreviewOutput.assetId, url: contract.download.url })
          return
        }
        const response = await fetch(contract.download.url, { headers: contract.download.headers })
        if (!response.ok) return
        objectUrl = URL.createObjectURL(await response.blob())
        if (active) setPreview({ assetId: selectedPreviewOutput.assetId, url: objectUrl })
      })
      .catch(() => undefined)
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [online, selected?.actions.download.available, selectedPreviewOutput])

  const previewUrl = preview && selectedPreviewOutput && preview.assetId === selectedPreviewOutput.assetId ? preview.url : null
  const previewLoading = Boolean(selectedPreviewOutput && selected?.actions.download.available && online && !previewUrl)
  const previewMediaFailed = Boolean(previewUrl && failedPreviewUrl === previewUrl)

  const selectTask = async (task: ApiGenerationTask) => {
    setSelected(task)
    window.history.replaceState(null, '', `#generations/${encodeURIComponent(task.id)}`)
    try {
      const detail = await creativeService.generationTask(task.id)
      setSelected(detail)
      mergeItems([detail], true)
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : textFor(t, 'Could not load task details.', '无法加载任务详情。'))
    }
  }

  useEffect(() => {
    if (!signedIn) return
    const match = window.location.hash.match(/^#generations\/(.+)$/)
    if (!match) return
    creativeService.generationTask(decodeURIComponent(match[1]))
      .then((task) => {
        setSelected(task)
        mergeItems([task], true)
      })
      .catch(() => window.history.replaceState(null, '', '#generations'))
  }, [mergeItems, signedIn])

  const cancelTask = async (task: ApiGenerationTask) => {
    if (!task.actions.cancel.available) return
    setActionId(task.id)
    setError(null)
    try {
      await creativeService.cancelGeneration(task.id, {
        idempotencyKey: `generation-center-${crypto.randomUUID()}`,
        reasonCode: 'user_cancelled',
      })
      const detail = await creativeService.generationTask(task.id)
      setSelected(detail)
      mergeItems([detail], true)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : textFor(t, 'Could not cancel this task.', '无法取消此任务。'))
    } finally {
      setActionId(null)
    }
  }

  const openWorkspace = (task: ApiGenerationTask) => {
    navigateToPage(task.deepLink.page, task.deepLink.workspace)
  }

  const exportHistory = async () => {
    setExporting(true)
    setError(null)
    try {
      const payload = await creativeService.exportGenerationCenter(queryFor(filters), 'json')
      const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `generation-center-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : textFor(t, 'Could not export generation history.', '无法导出生成历史。'))
    } finally {
      setExporting(false)
    }
  }

  if (!signedIn) {
    return (
      <main className="generation-center-page">
        <section className="generation-center-auth">
          <ListFilter size={28} />
          <h1>{textFor(t, 'Generations', '生成任务')}</h1>
          <p>{textFor(t, 'Sign in to view your generation history.', '登录后查看你的生成历史。')}</p>
          <button className="primary-button" type="button" onClick={requireAuth}>{textFor(t, 'Sign in', '登录')}</button>
        </section>
      </main>
    )
  }

  const workspaces: Array<{ value: '' | CreativeWorkspace; label: string; Icon: typeof Image }> = [
    { value: '', label: textFor(t, 'All', '全部'), Icon: Sparkles },
    ...(['image', 'video', 'music', 'chat'] as CreativeWorkspace[]).map((workspace) => ({ value: workspace, label: workspaceLabel(workspace, locale), Icon: workspaceIcon[workspace] })),
  ]

  return (
    <main className="generation-center-page" data-testid="generation-center">
      <header className="generation-center-header">
        <div>
          <span className="generation-center-eyebrow"><Sparkles size={14} /> {textFor(t, 'Generation archive', '生成档案')}</span>
          <h1>{textFor(t, 'Your creative runs', '每一次创作，都在这里')}</h1>
          <p>{textFor(t, 'Review outputs, continue an idea, or trace how a generation was made.', '回看生成结果、继续一个想法，也能追溯每次创作的完整过程。')}</p>
        </div>
        <div className="generation-center-header-actions">
          <button aria-label={textFor(t, 'Export generation history', '导出生成历史')} className="generation-header-action" disabled={exporting || !online} type="button" onClick={() => void exportHistory()}>
            {exporting ? <LoaderCircle className="spin" size={17} /> : <ArrowDownToLine size={17} />}
            <span>{exporting ? textFor(t, 'Exporting', '正在导出') : textFor(t, 'Export', '导出')}</span>
          </button>
          <button aria-label={textFor(t, 'Refresh generation history', '刷新生成历史')} className="generation-header-action" disabled={refreshing || !online} type="button" onClick={() => void load(null, true)}>
            <RefreshCw className={refreshing ? 'spin' : ''} size={17} />
            <span>{refreshing ? textFor(t, 'Refreshing', '正在刷新') : textFor(t, 'Refresh', '刷新')}</span>
          </button>
        </div>
      </header>

      {!online && <div className="generation-center-notice"><AlertTriangle size={15} /> {textFor(t, 'Offline. Showing the last loaded history.', '当前离线，正在显示上次加载的历史。')}</div>}
      {error && <div className="generation-center-notice error"><CircleX size={15} /><span>{error}</span><button aria-label={textFor(t, 'Dismiss error', '关闭错误')} type="button" onClick={() => setError(null)}><X size={15} /></button></div>}

      <section className="generation-command-bar" aria-label={textFor(t, 'Generation view controls', '生成记录视图控制')}>
        <div className="generation-workspace-tabs" role="tablist" aria-label={textFor(t, 'Workspace filter', '工作台筛选')}>
          {workspaces.map(({ value, label, Icon }) => <button aria-selected={filters.workspace === value} className={filters.workspace === value ? 'active' : ''} key={value || 'all'} role="tab" type="button" onClick={() => setFilters((current) => ({ ...current, workspace: value }))}><Icon size={15}/><span>{label}</span></button>)}
        </div>
        <button aria-controls="generation-filters" aria-expanded={filtersOpen} className={filtersOpen ? 'generation-filter-toggle active' : 'generation-filter-toggle'} type="button" onClick={() => setFiltersOpen((current) => !current)}>
          <SlidersHorizontal size={16}/><span>{textFor(t, 'Filters', '筛选')}</span>{activeFilterCount > 0 && <strong>{activeFilterCount}</strong>}
        </button>
      </section>

      {summary && summary.total > 0 && <section className="generation-center-summary" aria-label={textFor(t, 'Generation summary', '生成统计')}>
        <span><strong>{summary.total}</strong>{textFor(t, 'runs', '次生成')}</span>
        <span><i className="active" />{summary.active} {textFor(t, 'active', '进行中')}</span>
        <span><i className="failed" />{summary.failed} {textFor(t, 'failed', '失败')}</span>
        <span><i className="output" />{summary.outputAssets} {textFor(t, 'outputs', '个产物')}</span>
      </section>}

      <section id="generation-filters" className={filtersOpen ? 'generation-filter-bar open' : 'generation-filter-bar'} aria-label={textFor(t, 'Generation filters', '生成任务筛选')}>
        <label><span>{textFor(t, 'Status', '状态')}</span><select aria-label={textFor(t, 'Status filter', '状态筛选')} value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="">{textFor(t, 'All statuses', '全部状态')}</option><option value="queued">{textFor(t, 'Queued', '排队中')}</option><option value="running">{textFor(t, 'Running', '运行中')}</option><option value="completed">{textFor(t, 'Completed', '已完成')}</option><option value="review_required">{textFor(t, 'Review required', '待审核')}</option><option value="failed">{textFor(t, 'Failed', '失败')}</option><option value="cancelled">{textFor(t, 'Cancelled', '已取消')}</option></select></label>
        <div className="generation-sort-group"><label><span>{textFor(t, 'Sort', '排序')}</span><select aria-label={textFor(t, 'Generation sort', '生成任务排序')} value={filters.sort} onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value as Filters['sort'] }))}><option value="createdAt">{textFor(t, 'Created', '创建时间')}</option><option value="updatedAt">{textFor(t, 'Updated', '更新时间')}</option><option value="status">{textFor(t, 'Status', '状态')}</option></select></label><button className="generation-sort-direction" aria-label={filters.direction === 'desc' ? textFor(t, 'Sort descending', '降序排列') : textFor(t, 'Sort ascending', '升序排列')} type="button" onClick={() => setFilters((current) => ({ ...current, direction: current.direction === 'desc' ? 'asc' : 'desc' }))}><ArrowUpDown size={16}/></button></div>
        <label><span>{textFor(t, 'From', '开始日期')}</span><span className="generation-date-input"><CalendarDays size={14}/><input aria-label={textFor(t, 'Start date', '开始日期')} type="date" value={filters.dateFrom} onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))}/></span></label>
        <label><span>{textFor(t, 'To', '结束日期')}</span><span className="generation-date-input"><CalendarDays size={14}/><input aria-label={textFor(t, 'End date', '结束日期')} type="date" value={filters.dateTo} onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))}/></span></label>
        <button className="generation-clear-filters" onClick={() => setFilters(emptyFilters)} disabled={!hasFilters} type="button"><X size={15}/>{textFor(t, 'Clear', '清除')}</button>
      </section>

      <section className={items.length > 0 ? 'generation-creative-layout' : 'generation-creative-layout empty'}>
        <div className="generation-task-list" aria-busy={loading}>
          {items.length > 0 && <header className="generation-task-list-head"><div><span>{textFor(t, 'Recent runs', '最近生成')}</span><small>{textFor(t, 'Select one to replay the result', '选择一条记录回看结果')}</small></div><strong>{items.length}</strong></header>}
          {loading ? <div className="generation-center-state"><LoaderCircle className="spin" size={22}/><span>{textFor(t, 'Loading generation history...', '正在加载生成历史...')}</span></div> : items.length === 0 ? <div className="generation-center-state generation-empty-state"><span className="generation-empty-icon"><FileOutput size={22}/></span><strong>{hasFilters ? textFor(t, 'No tasks match these filters', '没有符合筛选条件的任务') : textFor(t, 'No generations yet', '还没有生成任务')}</strong><span>{hasFilters ? textFor(t, 'Change or clear the filters to see more tasks.', '调整或清除筛选条件以查看其他任务。') : textFor(t, 'Start creating and your outputs will appear here.', '开始创作后，生成结果会出现在这里。')}</span>{hasFilters ? <button className="ghost-button" type="button" onClick={() => setFilters(emptyFilters)}><X size={15}/>{textFor(t, 'Clear filters', '清除筛选')}</button> : <button className="primary-button" type="button" onClick={() => navigateToPage('playground', 'image')}><ExternalLink size={15}/>{textFor(t, 'Start creating', '开始创作')}</button>}</div> : items.map((task, index) => {
            const Icon = workspaceIcon[task.workspace]
            return <button className={selected?.id === task.id ? 'generation-task-row selected' : 'generation-task-row'} data-testid={`generation-task-${task.id}`} key={task.id} type="button" onClick={() => void selectTask(task)}><span className="generation-task-index">{String(index + 1).padStart(2, '0')}</span><span className={`generation-workspace-icon ${task.workspace}`}><Icon size={17}/></span><span className="generation-task-main"><strong>{task.summary ?? `${workspaceLabel(task.workspace, locale)} / ${modeLabel(task.mode, locale)}`}</strong><small>{modeLabel(task.mode, locale)} · {formatDate(task.updatedAt, locale)}</small></span><span className={`generation-status ${task.status}`}>{generationStatusLabel(task.status, locale)}</span><ChevronRight size={16}/></button>
          })}
          {nextCursor && <button className="generation-load-more" disabled={loadingMore} type="button" onClick={() => void load(nextCursor)}>{loadingMore ? <LoaderCircle className="spin" size={15}/> : <ChevronRight size={15}/>} {textFor(t, 'Load more', '加载更多')}</button>}
        </div>

        {items.length > 0 && <article className="generation-task-detail" aria-live="polite">
          {!selected ? <div className="generation-center-state compact"><ListFilter size={22}/><span>{textFor(t, 'Select a task to inspect it.', '选择任务以查看详情。')}</span></div> : <>
            <div className={`generation-preview-stage ${selected.status}`}>
              <div className="generation-preview-toolbar"><span><Sparkles size={13}/>{workspaceLabel(selected.workspace, locale)} · {modeLabel(selected.mode, locale)}</span><span className={`generation-status ${selected.status}`}>{generationStatusLabel(selected.status, locale)}</span></div>
              {previewLoading ? <div className="generation-preview-placeholder"><LoaderCircle className="spin" size={30}/><strong>{textFor(t, 'Preparing private preview', '正在准备私有预览')}</strong></div> : previewUrl && previewMediaFailed ? <MediaLoadFallback title={textFor(t, 'Preview could not be loaded', '预览加载失败')} detail={textFor(t, 'The output is still protected in Assets. Refresh to request a new private preview.', '产物仍安全保存在资产库中，可刷新后重新获取私有预览。')} testId="generation-preview-load-failed"/> : previewUrl && selectedPreviewOutput?.contentType.startsWith('video/') ? <video controls playsInline preload="metadata" src={previewUrl} data-testid="generation-media-preview" onError={() => setFailedPreviewUrl(previewUrl)}/> : previewUrl && selectedPreviewOutput?.contentType.startsWith('image/') ? <img alt={selected.summary ?? textFor(t, 'Generated image', '生成图片')} src={previewUrl} onError={() => setFailedPreviewUrl(previewUrl)}/> : previewUrl && selectedPreviewOutput?.contentType.startsWith('audio/') ? <div className="generation-preview-placeholder"><Music2 size={36}/><strong>{selectedPreviewOutput.fileName}</strong><audio controls src={previewUrl} onError={() => setFailedPreviewUrl(previewUrl)}/></div> : <div className="generation-preview-placeholder">{selected.error ? <AlertTriangle size={36}/> : <Sparkles size={36}/>}<strong>{selected.error ? textFor(t, 'This run did not complete', '这次生成未完成') : activeStatuses.has(selected.status) ? textFor(t, 'Creation in progress', '创作正在进行') : textFor(t, 'Preview unavailable', '暂无预览')}</strong><span>{selected.error ? textFor(t, 'Review the failure details below.', '请在下方查看失败原因。') : textFor(t, 'Open the workspace to continue from this run.', '可打开工作台继续这次创作。')}</span></div>}
            </div>

            <div className="generation-detail-heading"><div><span>{textFor(t, 'Prompt snapshot', '创作描述')}</span><h2>{selected.summary ?? textFor(t, 'Protected task content', '受保护的任务内容')}</h2></div><button className="generation-open-workspace" type="button" onClick={() => openWorkspace(selected)}><ExternalLink size={15}/>{textFor(t, 'Continue in workspace', '继续创作')}</button></div>

            <div className="generation-detail-content">
              <div className="generation-detail-facts" aria-label={textFor(t, 'Run facts', '生成信息')}>
                <span><CalendarDays size={15}/><small>{textFor(t, 'Created', '创建')}</small><strong>{formatDate(selected.createdAt, locale)}</strong></span>
                <span><Hash size={15}/><small>{textFor(t, 'Attempt', '尝试')}</small><strong>#{selected.attempt.number}</strong></span>
                <span><Coins size={15}/><small>{textFor(t, 'Credits', '积分')}</small><strong>{selected.usage.estimatedCredits}</strong></span>
                <span><BadgeCheck size={15}/><small>{textFor(t, 'Review', '审核')}</small><strong>{selected.review.required ? textFor(t, 'Required', '需要') : textFor(t, 'Clear', '通过')}</strong></span>
              </div>
              {selected.error && <div className="generation-detail-error"><AlertTriangle size={16}/><span><strong>{selected.error.code}</strong>{selected.error.message && <small>{selected.error.message}</small>}</span></div>}
              <div className="generation-output-list"><div className="generation-detail-section-title"><div><span>{textFor(t, 'Output', '生成产物')}</span><small>{textFor(t, 'Ready for your next move', '可以继续使用')}</small></div><strong>{selected.outputs.length}</strong></div>{selected.outputs.length === 0 ? <p>{textFor(t, 'No output asset is available yet.', '暂时没有可用的输出资产。')}</p> : selected.outputs.map((output, index) => {
                const OutputIcon = output.contentType.startsWith('video/') ? Video : output.contentType.startsWith('image/') ? Image : output.contentType.startsWith('audio/') ? Music2 : FileOutput
                return <div className="generation-output-row" key={output.assetId}>
                  <span className="generation-output-icon"><OutputIcon size={20}/></span>
                  <span className="generation-output-copy">
                    <strong>{outputTitle(output, locale, index, selected.outputs.length)}</strong>
                    <small title={output.fileName}>{output.fileName}</small>
                    <span className="generation-output-meta">{outputMeta(output, locale)}</span>
                  </span>
                  <span className="generation-output-utility-actions">
                    <button aria-label={`${textFor(t, 'Download', '下载')} ${output.fileName}`} disabled={!selected.actions.download.available} title={textFor(t, 'Download', '下载')} type="button" onClick={() => void downloadAsset(output.assetId).catch((downloadError) => setError(downloadError instanceof Error ? downloadError.message : 'Download failed'))}><ArrowDownToLine size={15}/></button>
                    <button aria-label={`${textFor(t, 'Open asset', '打开资产')} ${output.fileName}`} title={textFor(t, 'Open asset library', '打开资产库')} type="button" onClick={() => navigateToPage('assets')}><Boxes size={15}/></button>
                  </span>
                  <UseCreativeAsset t={t} assetId={output.assetId} fileName={output.fileName} available={selected.status === 'completed' && output.status === 'uploaded' && output.scanStatus === 'clean'}/>
                </div>
              })}</div>
              <details className="generation-run-details"><summary><span>{textFor(t, 'Run details', '生成详情')}</span><ChevronRight size={15}/></summary><dl><div><dt>{textFor(t, 'Policy', '策略')}</dt><dd>{!selected.accounting || selected.accounting.legacy ? textFor(t, 'Legacy', '旧版') : selected.accounting.policyVersion}</dd></div><div><dt>{textFor(t, 'Quota', '限额')}</dt><dd>{selected.accounting?.quotaUnits ?? selected.usage.estimatedCredits} {textFor(t, 'units', '单位')}</dd></div><div><dt>{textFor(t, 'Provider cost', '提供方成本')}</dt><dd>{selected.accounting?.providerCost.availability === 'available' ? selected.accounting.providerCost.ledgerStatus : textFor(t, 'unavailable', '不可用')}</dd></div></dl></details>
              {(selected.actions.cancel.available || selected.actions.retry.available) && <div className="generation-detail-actions">{selected.actions.cancel.available && <button className="ghost-button" disabled={actionId === selected.id} title={textFor(t, 'Cancel task', '取消任务')} type="button" onClick={() => void cancelTask(selected)}>{actionId === selected.id ? <LoaderCircle className="spin" size={15}/> : <CircleX size={15}/>} {textFor(t, 'Cancel', '取消')}</button>}{selected.actions.retry.available && <button className="ghost-button" type="button" onClick={() => openWorkspace(selected)}><RotateCcw size={15}/>{textFor(t, 'Retry in workspace', '在工作台重试')}</button>}</div>}
            </div>
          </>}
        </article>}
      </section>
    </main>
  )
}
