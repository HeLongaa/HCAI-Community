import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, ArrowUpRight, ListChecks, RefreshCw, RotateCcw, Search } from 'lucide-react'

import { textFor } from '../../domain/utils'
import { adminService } from '../../services/adminService'
import type {
  AdminGlobalSearchResultDto,
  AdminGlobalSearchType,
  AdminOperationsOverviewDto,
  AdminOperationsQueueItemDto,
} from '../../services/contracts'

type SearchScope = 'all' | 'work' | 'platform' | 'security'

const scopeTypes: Record<SearchScope, AdminGlobalSearchType[] | undefined> = {
  all: undefined,
  work: ['task', 'profile', 'admin_review', 'accounting_issue', 'media_asset', 'creative_generation'],
  platform: ['audit_event', 'domain_event', 'event_inbox', 'job_run'],
  security: ['security_event', 'security_alert', 'audit_event'],
}

const formatTimestamp = (value: string | null) => {
  if (!value) return '-'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

const statusClass = (status: string | null) => {
  const normalized = String(status ?? '').toLowerCase()
  if (['critical', 'failed', 'dead_lettered', 'timed_out', 'compensation_failed', 'firing'].includes(normalized)) return 'danger'
  if (['warning', 'pending review', 'review', 'open'].includes(normalized)) return 'warning'
  return 'neutral'
}

function QueueList({
  title,
  items,
  empty,
  onOpen,
}: {
  title: string
  items: AdminOperationsQueueItemDto[]
  empty: string
  onOpen: (item: AdminOperationsQueueItemDto) => void
}) {
  return (
    <section className="admin-overview-queue">
      <header>
        <strong>{title}</strong>
        <span>{items.length}</span>
      </header>
      {items.length === 0 ? <small>{empty}</small> : items.map((item) => (
        <button type="button" key={`${item.type}:${item.id}`} onClick={() => onOpen(item)}>
          <span>
            <b>{item.title}</b>
            <small>{item.detail}</small>
          </span>
          <span className={`admin-overview-status ${statusClass(item.status)}`}>{item.status ?? '-'}</span>
        </button>
      ))}
    </section>
  )
}

export function AdminOverviewPanel({
  t,
  target,
}: {
  t: Record<string, string>
  target?: { resourceType?: string | null; resourceId?: string | null } | null
}) {
  const [windowMinutes, setWindowMinutes] = useState(60)
  const [overview, setOverview] = useState<AdminOperationsOverviewDto | null>(null)
  const [overviewLoading, setOverviewLoading] = useState(true)
  const [overviewError, setOverviewError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<SearchScope>('all')
  const [results, setResults] = useState<AdminGlobalSearchResultDto[]>([])
  const [selected, setSelected] = useState<AdminGlobalSearchResultDto | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchNextCursor, setSearchNextCursor] = useState<string | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true)
    setOverviewError(null)
    try {
      setOverview(await adminService.overview(windowMinutes))
    } catch (error) {
      setOverviewError(error instanceof Error ? error.message : textFor(t, 'Overview unavailable.', '运营概览暂不可用。'))
    } finally {
      setOverviewLoading(false)
    }
  }, [t, windowMinutes])

  const runSearch = useCallback(async (
    nextQuery: string,
    nextTypes = scopeTypes[scope],
    selectId?: string,
    cursor: string | null = null,
    append = false,
  ) => {
    const normalized = nextQuery.trim()
    if (normalized.length < 2) {
      setSearchError(textFor(t, 'Enter at least 2 characters.', '请至少输入 2 个字符。'))
      return
    }
    setSearching(true)
    setSearchError(null)
    setHasSearched(true)
    try {
      const page = await adminService.globalSearch({ q: normalized, types: nextTypes, limit: 20, cursor })
      setResults((current) => append
        ? [...current, ...page.items.filter((item) => !current.some((existing) => existing.type === item.type && existing.id === item.id))]
        : page.items)
      setSearchNextCursor(page.nextCursor)
      const exact = page.items.find((item) => item.id === selectId || item.id === normalized) ?? null
      if (exact) setSelected(exact)
    } catch (error) {
      if (!append) setResults([])
      setSearchNextCursor(null)
      setSearchError(error instanceof Error ? error.message : textFor(t, 'Search unavailable.', '全局搜索暂不可用。'))
    } finally {
      setSearching(false)
    }
  }, [scope, t])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadOverview(), 0)
    return () => window.clearTimeout(timer)
  }, [loadOverview])

  useEffect(() => {
    const resourceType = target?.resourceType as AdminGlobalSearchType | undefined
    const resourceId = target?.resourceId?.trim()
    if (!resourceType || !resourceId) return
    const timer = window.setTimeout(() => {
      setQuery(resourceId)
      setScope('all')
      void runSearch(resourceId, [resourceType], resourceId)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [runSearch, target?.resourceId, target?.resourceType])

  const metricCards = useMemo(() => [
    { key: 'reviews', label: textFor(t, 'Pending reviews', '待处理审核'), value: overview?.totals.pendingReviews ?? 0, icon: ListChecks },
    { key: 'alerts', label: textFor(t, 'Active alerts', '活动告警'), value: overview?.totals.activeAlerts ?? 0, icon: AlertTriangle },
    { key: 'recovery', label: textFor(t, 'Recovery items', '恢复项'), value: overview?.totals.recoveryItems ?? 0, icon: RotateCcw },
    { key: 'failures', label: textFor(t, 'Failed operations', '失败操作'), value: overview?.totals.failedOperations ?? 0, icon: Activity },
  ], [overview, t])

  const openQueueItem = (item: AdminOperationsQueueItemDto) => {
    setQuery(item.id)
    setScope('all')
    void runSearch(item.id, [item.type as AdminGlobalSearchType], item.id)
  }

  const loadMoreResults = () => {
    if (!searchNextCursor || searching) return
    void runSearch(query, scopeTypes[scope], undefined, searchNextCursor, true)
  }

  const openResult = (item: AdminGlobalSearchResultDto) => {
    setSelected(item)
    const params = new URLSearchParams({
      tab: 'Overview',
      overviewResourceType: item.type,
      overviewResourceId: item.id,
    })
    window.history.replaceState(null, '', `#admin?${params.toString()}`)
  }

  return (
    <section className="panel admin-operations-home" data-testid="admin-operations-overview">
      <div className="admin-overview-heading">
        <div>
          <span>{textFor(t, 'Operations overview', '运营概览')}</span>
          <h2>{textFor(t, 'Work requiring attention', '需要关注的工作')}</h2>
          <small>{overview?.generatedAt ? `${textFor(t, 'Updated', '更新于')} ${formatTimestamp(overview.generatedAt)}` : textFor(t, 'Live Admin read models', '实时后台只读视图')}</small>
        </div>
        <div className="admin-overview-actions">
          <div className="segmented-control" aria-label={textFor(t, 'Overview window', '概览时间窗口')}>
            {[15, 60, 240].map((minutes) => (
              <button type="button" className={windowMinutes === minutes ? 'active' : ''} onClick={() => setWindowMinutes(minutes)} key={minutes}>
                {minutes < 60 ? `${minutes}m` : `${minutes / 60}h`}
              </button>
            ))}
          </div>
          <button className="icon-button" type="button" title={textFor(t, 'Refresh overview', '刷新概览')} aria-label={textFor(t, 'Refresh overview', '刷新概览')} onClick={() => void loadOverview()} disabled={overviewLoading}>
            <RefreshCw size={17} />
          </button>
        </div>
      </div>

      {overviewError && <div className="empty-state compact"><strong>{textFor(t, 'Overview unavailable', '运营概览不可用')}</strong><span>{overviewError}</span></div>}
      <div className="admin-overview-metrics" aria-busy={overviewLoading}>
        {metricCards.map(({ key, label, value, icon: Icon }) => (
          <div key={key}>
            <Icon size={17} />
            <strong>{overviewLoading ? '-' : value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>

      <div className="admin-overview-queues">
        <QueueList title={textFor(t, 'Review queue', '审核队列')} items={overview?.pendingReviews ?? []} empty={textFor(t, 'No pending reviews.', '暂无待处理审核。')} onOpen={openQueueItem} />
        <QueueList title={textFor(t, 'Active alerts', '活动告警')} items={overview?.alerts ?? []} empty={textFor(t, 'No active alerts.', '暂无活动告警。')} onOpen={openQueueItem} />
        <QueueList title={textFor(t, 'Recovery queue', '恢复队列')} items={overview?.recoveryItems ?? []} empty={textFor(t, 'No recovery work.', '暂无恢复工作。')} onOpen={openQueueItem} />
      </div>

      <div className="admin-global-search">
        <div className="admin-global-search-heading">
          <div>
            <strong>{textFor(t, 'Global entity search', '全局实体搜索')}</strong>
            <span>{textFor(t, 'Permission-scoped results across operational modules', '跨运营模块的权限范围结果')}</span>
          </div>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); void runSearch(query) }}>
          <label className="admin-search-input">
            <Search size={17} />
            <input data-testid="admin-global-search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={textFor(t, 'Search ID, title, type, or status', '搜索 ID、标题、类型或状态')} />
          </label>
          <select aria-label={textFor(t, 'Search scope', '搜索范围')} value={scope} onChange={(event) => setScope(event.target.value as SearchScope)}>
            <option value="all">{textFor(t, 'All resources', '全部资源')}</option>
            <option value="work">{textFor(t, 'Work and users', '工作与用户')}</option>
            <option value="platform">{textFor(t, 'Platform runtime', '平台运行时')}</option>
            <option value="security">{textFor(t, 'Security and evidence', '安全与证据')}</option>
          </select>
          <button className="primary-button" data-testid="admin-global-search-submit" type="button" onClick={() => void runSearch(query)} disabled={searching || query.trim().length < 2}>
            <Search size={17} />
            {searching ? textFor(t, 'Searching', '搜索中') : textFor(t, 'Search', '搜索')}
          </button>
        </form>
        {searchError && <div className="empty-state compact"><strong>{textFor(t, 'Search unavailable', '搜索不可用')}</strong><span>{searchError}</span></div>}
        {!searchError && hasSearched && !searching && results.length === 0 && <div className="empty-state compact"><strong>{textFor(t, 'No matching entities', '没有匹配实体')}</strong><span>{textFor(t, 'Try another ID, title, type, or scope.', '请尝试其他 ID、标题、类型或范围。')}</span></div>}
        {results.length > 0 && (
          <>
            <div className="admin-search-results" data-testid="admin-global-search-results">
              {results.map((item) => (
                <button className={selected?.type === item.type && selected.id === item.id ? 'selected' : ''} type="button" key={`${item.type}:${item.id}`} onClick={() => openResult(item)}>
                  <span className="admin-search-type">{item.type.replaceAll('_', ' ')}</span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.subtitle}</small>
                  </span>
                  <span className={`admin-overview-status ${statusClass(item.status)}`}>{item.status ?? '-'}</span>
                  <ArrowUpRight size={16} />
                </button>
              ))}
            </div>
            {searchNextCursor && (
              <button className="ghost-button admin-search-load-more" data-testid="admin-global-search-load-more" type="button" onClick={loadMoreResults} disabled={searching}>
                {searching ? textFor(t, 'Loading', '加载中') : textFor(t, 'Load more results', '加载更多结果')}
              </button>
            )}
          </>
        )}
        {selected && (
          <div className="admin-search-selection" data-testid="admin-global-search-selection">
            <span>{selected.type.replaceAll('_', ' ')}</span>
            <strong>{selected.title}</strong>
            <small>{selected.id} · {selected.subtitle} · {formatTimestamp(selected.timestamp)}</small>
          </div>
        )}
      </div>
    </section>
  )
}
