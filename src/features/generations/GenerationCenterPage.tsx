import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowDownToLine,
  CalendarDays,
  ChevronRight,
  CircleX,
  ExternalLink,
  FileOutput,
  Image,
  ListFilter,
  LoaderCircle,
  MessageSquareText,
  Music2,
  RefreshCw,
  RotateCcw,
  Video,
  X,
} from 'lucide-react'
import type { Page, PlaygroundMode } from '../../domain/types'
import { textFor } from '../../domain/utils'
import { creativeService } from '../../services/creativeService'
import { mediaService } from '../../services/mediaService'
import type { ApiGenerationTask, CreativeWorkspace, GenerationCenterQuery } from '../../services/contracts'

type Filters = {
  workspace: '' | CreativeWorkspace
  status: string
  dateFrom: string
  dateTo: string
}

const emptyFilters: Filters = { workspace: '', status: '', dateFrom: '', dateTo: '' }
const activeStatuses = new Set(['queued', 'running'])

const workspaceIcon = {
  image: Image,
  chat: MessageSquareText,
  video: Video,
  music: Music2,
} satisfies Record<CreativeWorkspace, typeof Image>

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
  const [selected, setSelected] = useState<ApiGenerationTask | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [actionId, setActionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [online, setOnline] = useState(() => navigator.onLine)

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
      const page = await creativeService.listGenerationTasks(queryFor(filters, cursor))
      mergeItems(page.items, Boolean(cursor))
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
  useEffect(() => {
    if (!signedIn || !online || !hasActiveItems) return
    const interval = window.setInterval(() => void load(null, true), 5_000)
    return () => window.clearInterval(interval)
  }, [hasActiveItems, load, online, signedIn])

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

  return (
    <main className="generation-center-page" data-testid="generation-center">
      <header className="generation-center-header">
        <div>
          <span className="generation-center-eyebrow"><ListFilter size={14} /> {textFor(t, 'Creation operations', '创作运营')}</span>
          <h1>{textFor(t, 'Generations', '生成任务')}</h1>
          <p>{textFor(t, 'One queue for Image, Chat, Video, and Music.', '统一查看图片、对话、视频和音乐任务。')}</p>
        </div>
        <button
          aria-label={textFor(t, 'Refresh generation history', '刷新生成历史')}
          className="icon-button generation-refresh"
          disabled={refreshing || !online}
          title={textFor(t, 'Refresh', '刷新')}
          type="button"
          onClick={() => void load(null, true)}
        >
          <RefreshCw className={refreshing ? 'spin' : ''} size={17} />
        </button>
      </header>

      {!online && <div className="generation-center-notice"><AlertTriangle size={15} /> {textFor(t, 'Offline. Showing the last loaded history.', '当前离线，正在显示上次加载的历史。')}</div>}
      {error && <div className="generation-center-notice error"><CircleX size={15} /><span>{error}</span><button aria-label={textFor(t, 'Dismiss error', '关闭错误')} type="button" onClick={() => setError(null)}><X size={15} /></button></div>}

      <section className="generation-filter-bar" aria-label={textFor(t, 'Generation filters', '生成任务筛选')}>
        <label>
          <span>{textFor(t, 'Workspace', '工作台')}</span>
          <select aria-label={textFor(t, 'Workspace filter', '工作台筛选')} value={filters.workspace} onChange={(event) => setFilters((current) => ({ ...current, workspace: event.target.value as Filters['workspace'] }))}>
            <option value="">{textFor(t, 'All workspaces', '全部工作台')}</option>
            <option value="image">Image</option>
            <option value="chat">Chat</option>
            <option value="video">Video</option>
            <option value="music">Music</option>
          </select>
        </label>
        <label>
          <span>{textFor(t, 'Status', '状态')}</span>
          <select aria-label={textFor(t, 'Status filter', '状态筛选')} value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
            <option value="">{textFor(t, 'All statuses', '全部状态')}</option>
            <option value="queued">{textFor(t, 'Queued', '排队中')}</option>
            <option value="running">{textFor(t, 'Running', '运行中')}</option>
            <option value="completed">{textFor(t, 'Completed', '已完成')}</option>
            <option value="review_required">{textFor(t, 'Review required', '待审核')}</option>
            <option value="failed">{textFor(t, 'Failed', '失败')}</option>
            <option value="cancelled">{textFor(t, 'Cancelled', '已取消')}</option>
          </select>
        </label>
        <label>
          <span>{textFor(t, 'From', '开始日期')}</span>
          <span className="generation-date-input"><CalendarDays size={14} /><input aria-label={textFor(t, 'Start date', '开始日期')} type="date" value={filters.dateFrom} onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))} /></span>
        </label>
        <label>
          <span>{textFor(t, 'To', '结束日期')}</span>
          <span className="generation-date-input"><CalendarDays size={14} /><input aria-label={textFor(t, 'End date', '结束日期')} type="date" value={filters.dateTo} onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))} /></span>
        </label>
        <button className="ghost-button generation-clear-filters" onClick={() => setFilters(emptyFilters)} disabled={Object.values(filters).every((value) => !value)} type="button">
          <X size={15} /> {textFor(t, 'Clear', '清除')}
        </button>
      </section>

      <section className="generation-center-workbench">
        <div className="generation-task-list" aria-busy={loading}>
          <div className="generation-task-list-head">
            <span>{textFor(t, 'Task', '任务')}</span>
            <span>{textFor(t, 'Status', '状态')}</span>
            <span>{textFor(t, 'Updated', '更新时间')}</span>
            <span aria-hidden="true" />
          </div>
          {loading ? (
            <div className="generation-center-state"><LoaderCircle className="spin" size={22} /><span>{textFor(t, 'Loading generation history...', '正在加载生成历史...')}</span></div>
          ) : items.length === 0 ? (
            <div className="generation-center-state"><FileOutput size={24} /><strong>{textFor(t, 'No generations found', '没有找到生成任务')}</strong><span>{textFor(t, 'Adjust the filters or start in a workspace.', '调整筛选条件或前往工作台开始创作。')}</span></div>
          ) : items.map((task) => {
            const Icon = workspaceIcon[task.workspace]
            return (
              <button className={selected?.id === task.id ? 'generation-task-row selected' : 'generation-task-row'} data-testid={`generation-task-${task.id}`} key={task.id} type="button" onClick={() => void selectTask(task)}>
                <span className="generation-task-main"><span className={`generation-workspace-icon ${task.workspace}`}><Icon size={16} /></span><span><strong>{task.summary ?? `${task.workspace} / ${task.mode}`}</strong><small>{task.workspace} · {task.mode} · #{task.attempt.number}</small></span></span>
                <span><span className={`generation-status ${task.status}`}>{task.status.replace('_', ' ')}</span></span>
                <time>{formatDate(task.updatedAt, locale)}</time>
                <ChevronRight size={16} />
              </button>
            )
          })}
          {nextCursor && (
            <button className="generation-load-more" disabled={loadingMore} type="button" onClick={() => void load(nextCursor)}>
              {loadingMore ? <LoaderCircle className="spin" size={15} /> : <ChevronRight size={15} />}
              {textFor(t, 'Load more', '加载更多')}
            </button>
          )}
        </div>

        <aside className="generation-task-detail" aria-live="polite">
          {!selected ? (
            <div className="generation-center-state compact"><ListFilter size={22} /><span>{textFor(t, 'Select a task to inspect it.', '选择任务以查看详情。')}</span></div>
          ) : (
            <>
              <div className="generation-detail-heading">
                <div><span>{selected.workspace} / {selected.mode}</span><h2>{selected.summary ?? textFor(t, 'Protected task content', '受保护的任务内容')}</h2></div>
                <span className={`generation-status ${selected.status}`}>{selected.status.replace('_', ' ')}</span>
              </div>
              <dl className="generation-detail-grid">
                <div><dt>{textFor(t, 'Created', '创建时间')}</dt><dd>{formatDate(selected.createdAt, locale)}</dd></div>
                <div><dt>{textFor(t, 'Attempt', '尝试次数')}</dt><dd>#{selected.attempt.number}</dd></div>
                <div><dt>{textFor(t, 'Credits', '额度')}</dt><dd>{selected.usage.estimatedCredits} {selected.usage.metered ? textFor(t, 'metered', '已计量') : textFor(t, 'estimated', '预估')}</dd></div>
                <div><dt>{textFor(t, 'Review', '审核')}</dt><dd>{selected.review.required ? textFor(t, 'Required', '需要审核') : textFor(t, 'Clear', '无需审核')}</dd></div>
              </dl>
              {selected.error && <div className="generation-detail-error"><AlertTriangle size={16} /><span><strong>{selected.error.code}</strong>{selected.error.message && <small>{selected.error.message}</small>}</span></div>}
              <div className="generation-output-list">
                <div className="generation-detail-section-title"><span>{textFor(t, 'Outputs', '输出资产')}</span><small>{selected.outputs.length}</small></div>
                {selected.outputs.length === 0 ? <p>{textFor(t, 'No output asset is available yet.', '暂时没有可用的输出资产。')}</p> : selected.outputs.map((output) => (
                  <div className="generation-output-row" key={output.assetId}>
                    <FileOutput size={16} />
                    <span><strong>{output.fileName}</strong><small>{output.scanStatus} · {output.contentType}</small></span>
                    <button aria-label={`${textFor(t, 'Download', '下载')} ${output.fileName}`} disabled={!selected.actions.download.available} title={textFor(t, 'Download', '下载')} type="button" onClick={() => void downloadAsset(output.assetId).catch((downloadError) => setError(downloadError instanceof Error ? downloadError.message : 'Download failed'))}><ArrowDownToLine size={15} /></button>
                  </div>
                ))}
              </div>
              <div className="generation-detail-actions">
                <button className="primary-button" type="button" onClick={() => openWorkspace(selected)}><ExternalLink size={15} /> {textFor(t, 'Open workspace', '打开工作台')}</button>
                <button className="ghost-button" disabled={!selected.actions.cancel.available || actionId === selected.id} title={selected.actions.cancel.reasonCode ?? textFor(t, 'Cancel task', '取消任务')} type="button" onClick={() => void cancelTask(selected)}>{actionId === selected.id ? <LoaderCircle className="spin" size={15} /> : <CircleX size={15} />} {textFor(t, 'Cancel', '取消')}</button>
                <button className="ghost-button" disabled={!selected.actions.retry.available} title={selected.actions.retry.reasonCode ?? textFor(t, 'Retry in workspace', '在工作台重试')} type="button" onClick={() => openWorkspace(selected)}><RotateCcw size={15} /> {textFor(t, 'Retry in workspace', '在工作台重试')}</button>
              </div>
            </>
          )}
        </aside>
      </section>
    </main>
  )
}
