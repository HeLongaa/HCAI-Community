import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowUpRight,
  Bot,
  Bookmark,
  BookmarkCheck,
  CheckSquare2,
  ChevronRight,
  CircleUserRound,
  FilePlus2,
  History,
  LoaderCircle,
  ListChecks,
  Pencil,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  WandSparkles,
} from 'lucide-react'
import type { AsyncResourceState, InspirationItem, Page } from '../../domain/types'
import { isZhCopy, textFor } from '../../domain/utils'
import type { ApiInspirationCategory, InspirationSubmissionRequest } from '../../services/contracts'
import { communityService } from '../../services/communityService'

type LibraryView = 'catalog' | 'favorites' | 'submit' | 'submissions' | 'edit' | 'detail'
type CollectionMode = 'catalog' | 'favorites' | 'submissions'

const routeState = (): { view: LibraryView; id: string | null } => {
  const path = window.location.hash.replace(/^#/, '').split('?')[0]
  if (path === 'inspiration/favorites') return { view: 'favorites', id: null }
  if (path === 'inspiration/submit') return { view: 'submit', id: null }
  if (path === 'inspiration/submissions') return { view: 'submissions', id: null }
  const edit = path.match(/^inspiration\/submissions\/(.+)\/edit$/)
  if (edit) return { view: 'edit', id: decodeURIComponent(edit[1]) }
  const detail = path.match(/^inspiration\/(.+)$/)
  return detail ? { view: 'detail', id: decodeURIComponent(detail[1]) } : { view: 'catalog', id: null }
}

const statusLabels = {
  draft: ['Draft', '草稿'],
  pending_review: ['Pending review', '等待审核'],
  changes_requested: ['Changes requested', '需要修改'],
  published: ['Published', '已发布'],
  rejected: ['Rejected', '未通过'],
  archived: ['Archived', '已下架'],
} as const

const contentLines = (value: unknown) => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
  : typeof value === 'string' ? value.split('\n').map((item) => item.trim()).filter(Boolean) : []

const navigate = (path: string) => {
  window.history.pushState(null, '', path)
  window.dispatchEvent(new Event('hcai:navigation'))
  window.dispatchEvent(new HashChangeEvent('hashchange'))
  window.scrollTo({ top: 0, behavior: 'instant' })
}

const statusText = (item: InspirationItem, isZh: boolean) => {
  const revisionStatus = item.pendingRevision?.status
  if (revisionStatus) {
    const label = statusLabels[revisionStatus]
    return `${isZh ? '新版' : 'New version'} · ${isZh ? label[1] : label[0]}`
  }
  const label = item.status ? statusLabels[item.status] : null
  return label ? (isZh ? label[1] : label[0]) : '-'
}

export function InspirationPage({
  t,
  items,
  setPage,
  status,
  signedIn,
  requireAuth,
}: {
  t: Record<string, string>
  items: InspirationItem[]
  setPage: (page: Page) => void
  status: AsyncResourceState
  signedIn: boolean
  requireAuth: () => void
}) {
  const isZh = isZhCopy(t)
  const [route, setRoute] = useState(routeState)
  const [catalogOverrides, setCatalogOverrides] = useState<Record<string, InspirationItem>>({})
  const [categories, setCategories] = useState<ApiInspirationCategory[]>([])
  const [activeCategory, setActiveCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [domain, setDomain] = useState('all')
  const [difficulty, setDifficulty] = useState('all')
  const [sourceKind, setSourceKind] = useState('all')
  const [favoriteSearch, setFavoriteSearch] = useState('')
  const [favoriteCategory, setFavoriteCategory] = useState('all')
  const [favoriteDomain, setFavoriteDomain] = useState('all')
  const [favoriteAge, setFavoriteAge] = useState('all')
  const [favoriteCutoff, setFavoriteCutoff] = useState<number | null>(null)
  const [selected, setSelected] = useState<InspirationItem | null>(null)
  const [secondaryItems, setSecondaryItems] = useState<InspirationItem[]>([])
  const [selectedFavoriteIds, setSelectedFavoriteIds] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const catalog = useMemo(
    () => items.map((item) => catalogOverrides[String(item.id)] ?? item),
    [catalogOverrides, items],
  )

  useEffect(() => {
    const sync = () => setRoute(routeState())
    window.addEventListener('hashchange', sync)
    window.addEventListener('popstate', sync)
    return () => {
      window.removeEventListener('hashchange', sync)
      window.removeEventListener('popstate', sync)
    }
  }, [])

  useEffect(() => {
    void communityService.listInspirationCategories().then(setCategories).catch((nextError) => {
      console.info('[inspiration-categories]', nextError)
      setError(textFor(t, 'Categories could not be loaded.', '分类暂时无法加载。'))
    })
  }, [t])

  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(async () => {
      if (cancelled) return
      setError(null)
      if (route.view === 'detail' && route.id) {
        setBusy('detail')
        try {
          const item = await communityService.getInspiration(route.id)
          if (!cancelled) setSelected(item)
        } catch {
          if (!cancelled) setSelected(null)
        } finally {
          if (!cancelled) setBusy(null)
        }
      } else if (route.view === 'favorites' && signedIn) {
        setBusy('favorites')
        try {
          const nextItems = await communityService.listInspirationFavorites()
          if (!cancelled) {
            setSecondaryItems(nextItems)
            setSelectedFavoriteIds(new Set())
          }
        } catch {
          if (!cancelled) setError(textFor(t, 'Favorites could not be loaded.', '收藏列表暂时无法加载。'))
        } finally {
          if (!cancelled) setBusy(null)
        }
      } else if ((route.view === 'submissions' || route.view === 'edit') && signedIn) {
        setBusy(route.view)
        try {
          const nextItems = await communityService.listMyInspirationSubmissions()
          if (!cancelled) {
            setSecondaryItems(nextItems)
            if (route.view === 'edit') setSelected(nextItems.find((item) => String(item.id) === route.id) ?? null)
          }
        } catch {
          if (!cancelled) setError(textFor(t, 'Submissions could not be loaded.', '投稿记录暂时无法加载。'))
        } finally {
          if (!cancelled) setBusy(null)
        }
      }
    })
    return () => { cancelled = true }
  }, [route, signedIn, t])

  const typeCategories = categories.filter((item) => item.kind === 'content_type')
  const domainCategories = categories.filter((item) => item.kind === 'domain')
  const difficultyCategories = categories.filter((item) => item.kind === 'difficulty')
  const domainLabelMap = useMemo(
    () => Object.fromEntries(domainCategories.map((item) => [item.slug, isZh ? item.nameZh : item.nameEn])),
    [domainCategories, isZh],
  )
  const difficultyLabelMap = useMemo(
    () => Object.fromEntries(difficultyCategories.map((item) => [item.slug, isZh ? item.nameZh : item.nameEn])),
    [difficultyCategories, isZh],
  )
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return catalog.filter((item) => {
      if (activeCategory !== 'all' && item.category?.slug !== activeCategory) return false
      if (domain !== 'all' && !item.domains?.includes(domain)) return false
      if (difficulty !== 'all' && item.difficulty !== difficulty) return false
      if (sourceKind !== 'all' && item.sourceKind !== sourceKind) return false
      if (needle && !`${item.title} ${item.summary ?? item.text} ${item.problem ?? ''} ${item.author?.displayName ?? ''}`.toLowerCase().includes(needle)) return false
      return true
    })
  }, [activeCategory, catalog, difficulty, domain, search, sourceKind])
  const filteredFavorites = useMemo(() => {
    const needle = favoriteSearch.trim().toLowerCase()
    return secondaryItems.filter((item) => {
      if (favoriteCategory !== 'all' && item.category?.slug !== favoriteCategory) return false
      if (favoriteDomain !== 'all' && !item.domains?.includes(favoriteDomain)) return false
      if (favoriteCutoff && (!item.favoritedAt || new Date(item.favoritedAt).getTime() < favoriteCutoff)) return false
      if (needle && !`${item.title} ${item.summary ?? item.text}`.toLowerCase().includes(needle)) return false
      return true
    })
  }, [favoriteCategory, favoriteCutoff, favoriteDomain, favoriteSearch, secondaryItems])
  const featured = filtered.filter((item) => item.featured).slice(0, 3)

  const replaceItem = (next: InspirationItem) => {
    setCatalogOverrides((current) => ({ ...current, [String(next.id)]: next }))
    setSecondaryItems((current) => current.map((item) => String(item.id) === String(next.id) ? next : item))
    setSelected((current) => String(current?.id) === String(next.id) ? next : current)
  }

  const toggleFavorite = async (item: InspirationItem) => {
    if (!signedIn) return requireAuth()
    if (item.id == null) return
    setBusy(`favorite-${item.id}`)
    setError(null)
    try {
      const next = await communityService.favoriteInspiration(item.id, !item.favorited)
      replaceItem(next)
      if (route.view === 'favorites' && !next.favorited) {
        setSecondaryItems((current) => current.filter((entry) => String(entry.id) !== String(next.id)))
        setSelectedFavoriteIds((current) => {
          const nextIds = new Set(current)
          nextIds.delete(String(next.id))
          return nextIds
        })
      }
    } catch {
      setError(textFor(t, 'Favorite was not changed. Please try again.', '收藏状态没有更新，请重试。'))
    } finally {
      setBusy(null)
    }
  }

  const removeSelectedFavorites = async () => {
    if (!selectedFavoriteIds.size) return
    setBusy('remove-favorites')
    setError(null)
    try {
      await communityService.removeInspirationFavorites([...selectedFavoriteIds])
      setSecondaryItems((current) => current.filter((item) => !selectedFavoriteIds.has(String(item.id))))
      setSelectedFavoriteIds(new Set())
    } catch {
      setError(textFor(t, 'Selected favorites were not removed.', '所选收藏没有移除，请重试。'))
    } finally {
      setBusy(null)
    }
  }

  const withdrawSubmission = async (item: InspirationItem) => {
    if (item.id == null) return
    setBusy(`withdraw-${item.id}`)
    setError(null)
    try {
      replaceItem(await communityService.withdrawInspiration(item.id))
    } catch {
      setError(textFor(t, 'The submission could not be withdrawn.', '投稿没有撤回，请重试。'))
    } finally {
      setBusy(null)
    }
  }

  const useInWorkspace = async (item: InspirationItem) => {
    if (!signedIn) return requireAuth()
    if (item.id == null) return
    setBusy(`use-${item.id}`)
    setError(null)
    try {
      const result = await communityService.sendLibraryItemToWorkspace(item.id)
      window.sessionStorage.setItem('hcaiInspirationWorkspaceDraft', JSON.stringify(result.workspaceDraft))
      setPage('chat')
    } catch {
      setError(textFor(t, 'This content could not be opened in the workspace.', '这条内容暂时无法进入工作台。'))
    } finally {
      setBusy(null)
    }
  }

  const createTaskDraft = (item: InspirationItem) => {
    if (!signedIn) return requireAuth()
    const categoryByDomain: Record<string, string> = {
      image: 'Image', video: 'Video', music: 'Music', automation: 'Automation',
      writing: 'Prompt', assistant: 'Prompt', marketing: 'Prompt', education: 'Prompt',
    }
    const steps = contentLines(item.content?.steps)
    const outputs = contentLines(item.content?.outputs)
    window.sessionStorage.setItem('hcaiInspirationTaskDraft', JSON.stringify({
      title: item.title,
      category: categoryByDomain[item.domains?.[0] ?? ''] ?? 'Prompt',
      details: [item.problem, item.audience ? `${isZh ? '适合人群' : 'Audience'}: ${item.audience}` : '', ...steps.map((step, index) => `${index + 1}. ${step}`)].filter(Boolean).join('\n\n'),
      rules: outputs.map((output) => `- ${output}`).join('\n'),
      source: `Inspiration ${item.id} · v${item.version ?? 1}`,
    }))
    setPage('publish')
  }

  if (route.view === 'submit') {
    return (
      <SubmissionForm
        t={t}
        categories={categories}
        signedIn={signedIn}
        requireAuth={requireAuth}
        onComplete={() => navigate('#inspiration/submissions')}
      />
    )
  }

  if (route.view === 'edit') {
    if (busy === 'edit') return <LoadingPage t={t} />
    if (!selected) return <UnavailablePage t={t} onBack={() => navigate('#inspiration/submissions')} />
    return (
      <SubmissionForm
        t={t}
        categories={categories}
        signedIn={signedIn}
        requireAuth={requireAuth}
        item={selected}
        onComplete={() => navigate('#inspiration/submissions')}
      />
    )
  }

  if (route.view === 'detail') {
    return (
      <DetailView
        t={t}
        item={selected}
        loading={busy === 'detail'}
        error={error}
        busy={busy}
        difficultyLabels={difficultyLabelMap}
        onBack={() => navigate('#inspiration')}
        onFavorite={toggleFavorite}
        onUse={useInWorkspace}
        onCreateTask={createTaskDraft}
      />
    )
  }

  const collectionTitle = route.view === 'favorites'
    ? textFor(t, 'My Favorites', '我的收藏')
    : route.view === 'submissions' ? textFor(t, 'My Submissions', '我的投稿') : null
  const collectionItems = route.view === 'catalog' ? filtered : route.view === 'favorites' ? filteredFavorites : secondaryItems
  const collectionMode: CollectionMode = route.view === 'favorites' ? 'favorites' : route.view === 'submissions' ? 'submissions' : 'catalog'
  const catalogHasFilters = Boolean(search.trim()) || activeCategory !== 'all' || domain !== 'all' || difficulty !== 'all' || sourceKind !== 'all'
  const showCatalogStart = route.view === 'catalog' && catalog.length === 0 && !catalogHasFilters && !status.loading

  return (
    <div className="inspiration-workbench">
      <header className="inspiration-workbench-header">
        <div>
          <span>{textFor(t, 'INSPIRATION LIBRARY', '灵感库')}</span>
          <h1>{collectionTitle ?? textFor(t, 'Discover skills and proven methods', '发现可复用的 Skill 与方法')}</h1>
          <p>{collectionTitle
            ? textFor(t, 'Keep useful knowledge organized and continue from where you left off.', '集中管理你收藏或提交的内容，并继续下一步。')
            : textFor(t, 'Browse reviewed skills, workflows, templates, prompt packs, tutorials, and case studies. Use any published item directly in AI Workspace.', '查找经过整理和审核的 Skill、工作流、模板、提示词包、教程与案例，并直接在 AI 工作台使用。')}</p>
        </div>
        <div className="inspiration-header-actions">
          {route.view !== 'catalog' && (
            <button type="button" onClick={() => navigate('#inspiration')}>
              <ArrowLeft size={17} />{textFor(t, 'Library', '返回灵感库')}
            </button>
          )}
          {route.view === 'catalog' && (
            <button type="button" onClick={() => signedIn ? navigate('#inspiration/favorites') : requireAuth()}>
              <Bookmark size={17} />{textFor(t, 'My Favorites', '我的收藏')}
            </button>
          )}
          {route.view === 'catalog' && (
            <button className="primary" type="button" onClick={() => signedIn ? navigate('#inspiration/submit') : requireAuth()}>
              <FilePlus2 size={17} />{textFor(t, 'Submit Inspiration', '投稿灵感')}
            </button>
          )}
          {route.view === 'submissions' && (
            <button className="primary" type="button" onClick={() => navigate('#inspiration/submit')}>
              <FilePlus2 size={17} />{textFor(t, 'New submission', '新建投稿')}
            </button>
          )}
          {route.view === 'favorites' && (
            <button type="button" onClick={() => navigate('#inspiration/submissions')}>
              <CircleUserRound size={17} />{textFor(t, 'My Submissions', '我的投稿')}
            </button>
          )}
        </div>
      </header>

      {route.view === 'favorites' && (
        <section className="inspiration-filters inspiration-favorite-filters" aria-label={textFor(t, 'Favorite filters', '收藏筛选')}>
          <label className="inspiration-search"><Search size={18}/><input value={favoriteSearch} onChange={(event) => setFavoriteSearch(event.target.value)} placeholder={textFor(t, 'Search saved resources', '搜索已收藏内容')}/></label>
          <FilterSelect label={textFor(t, 'Type', '类型')} value={favoriteCategory} onChange={setFavoriteCategory} options={typeCategories.map((item) => [item.slug, isZh ? item.nameZh : item.nameEn])} allLabel={textFor(t, 'All types', '全部类型')}/>
          <FilterSelect label={textFor(t, 'Domain', '领域')} value={favoriteDomain} onChange={setFavoriteDomain} options={domainCategories.map((item) => [item.slug, isZh ? item.nameZh : item.nameEn])} allLabel={textFor(t, 'All domains', '全部领域')}/>
          <FilterSelect label={textFor(t, 'Saved', '收藏时间')} value={favoriteAge} onChange={(value) => { setFavoriteAge(value); setFavoriteCutoff(value === 'all' ? null : Date.now() - Number(value) * 24 * 60 * 60 * 1000) }} options={[["7", textFor(t, 'Last 7 days', '最近 7 天')], ["30", textFor(t, 'Last 30 days', '最近 30 天')], ["90", textFor(t, 'Last 90 days', '最近 90 天')]]} allLabel={textFor(t, 'Any time', '全部时间')}/>
        </section>
      )}

      {route.view === 'catalog' && (
        <>
          <nav className="inspiration-category-nav" aria-label={textFor(t, 'Content categories', '内容分类')}>
            <button className={activeCategory === 'all' ? 'active' : ''} type="button" onClick={() => setActiveCategory('all')}>
              {textFor(t, 'All', '全部')}
            </button>
            {typeCategories.map((category) => (
              <button className={activeCategory === category.slug ? 'active' : ''} type="button" key={category.id} onClick={() => setActiveCategory(category.slug)}>
                {isZh ? category.nameZh : category.nameEn}
              </button>
            ))}
          </nav>
          <section className="inspiration-filters" aria-label={textFor(t, 'Catalog filters', '目录筛选')}>
            <label className="inspiration-search">
              <Search size={18} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={textFor(t, 'Search skills, problems, or authors', '搜索 Skill、问题或作者')} />
            </label>
            <FilterSelect label={textFor(t, 'Domain', '领域')} value={domain} onChange={setDomain} options={domainCategories.map((item) => [item.slug, isZh ? item.nameZh : item.nameEn])} allLabel={textFor(t, 'All domains', '全部领域')} />
            <FilterSelect label={textFor(t, 'Level', '难度')} value={difficulty} onChange={setDifficulty} options={difficultyCategories.map((item) => [item.slug, isZh ? item.nameZh : item.nameEn])} allLabel={textFor(t, 'All levels', '全部难度')} />
            <FilterSelect label={textFor(t, 'Source', '来源')} value={sourceKind} onChange={setSourceKind} options={[["official", textFor(t, 'Official', '官方')], ["user_submission", textFor(t, 'Community', '用户投稿')]]} allLabel={textFor(t, 'All sources', '全部来源')} />
          </section>
          {featured.length > 0 && (
            <section className="inspiration-featured">
              <div className="inspiration-section-title">
                <div><span>{textFor(t, 'CURATED', '编辑精选')}</span><h2>{textFor(t, 'Recommended starting points', '值得优先了解')}</h2></div>
                <Sparkles size={18} />
              </div>
              <div className="inspiration-featured-grid">
                {featured.map((item) => (
                  <FeaturedItem
                    key={String(item.id)}
                    item={item}
                    isZh={isZh}
                    domainLabels={domainLabelMap}
                    onOpen={() => navigate(`#inspiration/${encodeURIComponent(String(item.id))}`)}
                    onFavorite={() => void toggleFavorite(item)}
                    busy={busy === `favorite-${item.id}`}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {error && <div className="inspiration-inline-error" role="alert">{error}</div>}
      {(status.loading || busy === 'favorites' || busy === 'submissions') && <LoadingState t={t} />}
      {showCatalogStart && <CatalogStart t={t} setPage={setPage} />}
      {route.view === 'submissions' && !busy && (
        <div className="inspiration-submission-note">
          <SlidersHorizontal size={17} />
          <span>{textFor(t, 'Published content stays online while a new version is reviewed.', '已发布内容提交新版审核时，当前公开版本会继续在线。')}</span>
        </div>
      )}
      {!status.loading && !['favorites', 'submissions'].includes(busy ?? '') && (
        <CatalogList
          t={t}
          items={collectionItems}
          domainLabels={domainLabelMap}
          difficultyLabels={difficultyLabelMap}
          mode={collectionMode}
          emptyFiltered={route.view === 'catalog'
            ? catalogHasFilters
            : route.view === 'favorites' && (Boolean(favoriteSearch.trim()) || favoriteCategory !== 'all' || favoriteDomain !== 'all' || favoriteAge !== 'all')}
          onOpen={(item) => navigate(`#inspiration/${encodeURIComponent(String(item.id))}`)}
          onFavorite={(item) => void toggleFavorite(item)}
          onEdit={(item) => navigate(`#inspiration/submissions/${encodeURIComponent(String(item.id))}/edit`)}
          onWithdraw={(item) => void withdrawSubmission(item)}
          selectedIds={selectedFavoriteIds}
          onToggleSelected={(id) => setSelectedFavoriteIds((current) => {
            const next = new Set(current)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
          })}
          onRemoveSelected={() => void removeSelectedFavorites()}
          busy={busy}
        />
      )}
    </div>
  )
}

function CatalogStart({ t, setPage }: { t: Record<string, string>; setPage: (page: Page) => void }) {
  const actions: Array<{ page: Page; icon: typeof WandSparkles; title: string; description: string }> = [
    {
      page: 'playground',
      icon: WandSparkles,
      title: textFor(t, 'Open AI Workspace', '进入 AI 工作台'),
      description: textFor(t, 'Create with image, video, music, and conversation models.', '使用图片、视频、音乐与对话模型开始创作。'),
    },
    {
      page: 'tasks',
      icon: ListChecks,
      title: textFor(t, 'Browse active tasks', '浏览进行中的任务'),
      description: textFor(t, 'Find a real brief to contribute to or build on.', '寻找可以参与或继续推进的真实需求。'),
    },
    {
      page: 'chat',
      icon: Bot,
      title: textFor(t, 'Ask the Assistant', '询问 AI 助手'),
      description: textFor(t, 'Turn an early idea into a practical first step.', '把还不完整的想法整理成可执行的第一步。'),
    },
  ]

  return (
    <section className="inspiration-catalog-start" aria-labelledby="inspiration-catalog-start-title">
      <div className="inspiration-catalog-start-copy">
        <span>{textFor(t, 'START CREATING', '开始创作')}</span>
        <h2 id="inspiration-catalog-start-title">{textFor(t, 'Make something while the library grows', '在灵感库持续完善时，先开始创作')}</h2>
        <p>{textFor(t, 'Published methods will appear here after review. Your workspace, tasks, and assistant are ready now.', '审核通过的方法会陆续出现在这里；工作台、任务与 AI 助手现在已经可以使用。')}</p>
      </div>
      <div className="inspiration-catalog-start-actions">
        {actions.map(({ page, icon: Icon, title, description }) => (
          <button key={page} type="button" onClick={() => setPage(page)}>
            <span className="inspiration-catalog-start-icon"><Icon size={18} /></span>
            <span>
              <strong>{title}</strong>
              <small>{description}</small>
            </span>
            <ArrowUpRight size={17} />
          </button>
        ))}
      </div>
    </section>
  )
}

function FilterSelect({ label, value, onChange, options, allLabel }: { label: string; value: string; onChange: (value: string) => void; options: string[][]; allLabel: string }) {
  return (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="all">{allLabel}</option>
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
    </label>
  )
}

function FeaturedItem({ item, isZh, domainLabels, onOpen, onFavorite, busy }: { item: InspirationItem; isZh: boolean; domainLabels: Record<string, string>; onOpen: () => void; onFavorite: () => void; busy: boolean }) {
  return (
    <article className="inspiration-featured-item">
      <button className="inspiration-featured-main" type="button" onClick={onOpen}>
        <small>{isZh ? item.category?.nameZh : item.category?.nameEn}</small>
        <h3>{item.title}</h3>
        <p>{item.summary ?? item.text}</p>
        <span>{item.domains?.slice(0, 2).map((value) => domainLabels[value] ?? value).join(' · ')}</span>
      </button>
      <button className="inspiration-save-icon" type="button" aria-label={item.favorited ? 'Unfavorite' : 'Favorite'} onClick={onFavorite} disabled={busy}>
        {item.favorited ? <BookmarkCheck size={18} /> : <Bookmark size={18} />}
      </button>
    </article>
  )
}

function CatalogList({
  t,
  items,
  domainLabels,
  difficultyLabels,
  mode,
  emptyFiltered,
  onOpen,
  onFavorite,
  onEdit,
  onWithdraw,
  selectedIds,
  onToggleSelected,
  onRemoveSelected,
  busy,
}: {
  t: Record<string, string>
  items: InspirationItem[]
  domainLabels: Record<string, string>
  difficultyLabels: Record<string, string>
  mode: CollectionMode
  emptyFiltered: boolean
  onOpen: (item: InspirationItem) => void
  onFavorite: (item: InspirationItem) => void
  onEdit: (item: InspirationItem) => void
  onWithdraw: (item: InspirationItem) => void
  selectedIds: Set<string>
  onToggleSelected: (id: string) => void
  onRemoveSelected: () => void
  busy: string | null
}) {
  const isZh = isZhCopy(t)
  const submissionMode = mode === 'submissions'
  const favoritesMode = mode === 'favorites'
  return (
    <section className={`inspiration-catalog inspiration-catalog-${mode}`}>
      <div className="inspiration-section-title">
        <div>
          <span>{submissionMode ? textFor(t, 'YOUR CONTENT', '你的内容') : favoritesMode ? textFor(t, 'SAVED', '已收藏') : textFor(t, 'CATALOG', '全部内容')}</span>
          <h2>{submissionMode ? textFor(t, 'Submission history', '投稿记录') : textFor(t, `${items.length} ${items.length === 1 ? 'resource' : 'resources'}`, `${items.length} 条内容`)}</h2>
        </div>
        {favoritesMode && selectedIds.size > 0 && (
          <button className="inspiration-batch-remove" type="button" onClick={onRemoveSelected} disabled={busy === 'remove-favorites'}>
            {busy === 'remove-favorites' ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}
            {textFor(t, `Remove ${selectedIds.size}`, `移除 ${selectedIds.size} 项`)}
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <div className="inspiration-empty">
          <strong>{submissionMode ? textFor(t, 'No submissions yet', '还没有投稿') : favoritesMode ? emptyFiltered ? textFor(t, 'No saved resources match these filters', '没有符合筛选条件的收藏') : textFor(t, 'No favorites yet', '还没有收藏') : emptyFiltered ? textFor(t, 'No published content matches these filters', '没有符合条件的已发布内容') : textFor(t, 'The published collection is being curated', '公开内容正在整理中')}</strong>
          <span>{submissionMode ? textFor(t, 'Create a draft when you have a method worth sharing.', '有值得分享的方法时，可以先创建草稿。') : favoritesMode ? emptyFiltered ? textFor(t, 'Change or clear a filter to see more saved resources.', '调整或清除筛选后查看其他收藏。') : textFor(t, 'Favorite a published resource to keep it here.', '收藏公开内容后会显示在这里。') : emptyFiltered ? textFor(t, 'Try changing a filter or return later after new content is reviewed.', '可以调整筛选，或等待新的内容通过审核。') : textFor(t, 'Reviewed skills, workflows, and case studies will appear here without mixing in sample content.', '经过审核的 Skill、工作流与案例会显示在这里，不会混入示例内容。')}</span>
        </div>
      ) : (
        <div className="inspiration-list">
          <div className="inspiration-list-head">
            {favoritesMode && <span />}
            <span>{textFor(t, 'Resource', '内容')}</span>
            <span>{textFor(t, 'Domain / level', '领域 / 难度')}</span>
            <span>{submissionMode ? textFor(t, 'Status', '状态') : textFor(t, 'Usage', '使用')}</span>
            <span />
          </div>
          {items.map((item) => {
            const itemId = String(item.id)
            const canEdit = submissionMode && (
              ['draft', 'changes_requested', 'rejected'].includes(item.status ?? '')
              || (item.status === 'published' && (!item.pendingRevision || ['draft', 'changes_requested', 'rejected'].includes(item.pendingRevision.status)))
            )
            const canWithdraw = submissionMode && (item.status === 'pending_review' || item.pendingRevision?.status === 'pending_review')
            const openSubmission = () => item.status === 'published' ? onOpen(item) : canEdit ? onEdit(item) : undefined
            return (
              <div className={`inspiration-row ${favoritesMode ? 'is-selectable' : ''}`} key={itemId}>
                {favoritesMode && (
                  <button className="inspiration-row-select" type="button" onClick={() => onToggleSelected(itemId)} aria-label={selectedIds.has(itemId) ? textFor(t, 'Deselect', '取消选择') : textFor(t, 'Select', '选择')}>
                    {selectedIds.has(itemId) ? <CheckSquare2 size={18} /> : <Square size={18} />}
                  </button>
                )}
                <button className="inspiration-row-open" type="button" onClick={openSubmission ?? (() => onOpen(item))}>
                  <span className="inspiration-row-main">
                    <small>{isZh ? item.category?.nameZh : item.category?.nameEn}</small>
                    <strong>{item.title}</strong>
                    <span>{item.summary ?? item.text}</span>
                    {submissionMode && (item.pendingRevision?.reviewNote || item.reviewNote) && <em>{item.pendingRevision?.reviewNote ?? item.reviewNote}</em>}
                  </span>
                  <span className="inspiration-row-meta">
                    {item.domains?.slice(0, 2).map((value) => domainLabels[value] ?? value).join(' · ') || '-'}
                    <small>{item.difficulty ? difficultyLabels[item.difficulty] ?? item.difficulty : '-'}</small>
                  </span>
                  <span className="inspiration-row-count">
                    {submissionMode ? statusText(item, isZh) : `${item.usageCount ?? 0}`}
                    <small>{submissionMode ? `v${item.pendingRevision?.version ?? item.version ?? 1}` : textFor(t, 'uses', '次使用')}</small>
                  </span>
                  <ChevronRight size={18} />
                </button>
                {!submissionMode && (
                  <button className="inspiration-row-save" type="button" onClick={() => onFavorite(item)} disabled={busy === `favorite-${item.id}`} aria-label={item.favorited ? textFor(t, 'Remove favorite', '取消收藏') : textFor(t, 'Favorite', '收藏')}>
                    {item.favorited ? <BookmarkCheck size={18} /> : <Bookmark size={18} />}
                  </button>
                )}
                {submissionMode && (canEdit || canWithdraw) && (
                  <div className="inspiration-submission-actions">
                    {canEdit && <button type="button" onClick={() => onEdit(item)}><Pencil size={15} />{textFor(t, 'Edit', '编辑')}</button>}
                    {canWithdraw && <button type="button" onClick={() => onWithdraw(item)} disabled={busy === `withdraw-${item.id}`}><Undo2 size={15} />{textFor(t, 'Withdraw', '撤回')}</button>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function LoadingState({ t }: { t: Record<string, string> }) {
  return <div className="inspiration-state"><LoaderCircle className="spin" size={20} /><strong>{textFor(t, 'Loading content', '正在加载内容')}</strong></div>
}

function LoadingPage({ t }: { t: Record<string, string> }) {
  return <div className="inspiration-workbench inspiration-detail-page"><LoadingState t={t} /></div>
}

function UnavailablePage({ t, onBack }: { t: Record<string, string>; onBack: () => void }) {
  return (
    <div className="inspiration-workbench inspiration-detail-page">
      <button className="inspiration-back" type="button" onClick={onBack}><ArrowLeft size={17} />{textFor(t, 'Back', '返回')}</button>
      <div className="inspiration-empty"><strong>{textFor(t, 'Content unavailable', '内容不可用')}</strong><span>{textFor(t, 'It may be under review, archived, or removed.', '它可能仍在审核、已经下架或不存在。')}</span></div>
    </div>
  )
}

function DetailView({ t, item, loading, error, busy, difficultyLabels, onBack, onFavorite, onUse, onCreateTask }: { t: Record<string, string>; item: InspirationItem | null; loading: boolean; error: string | null; busy: string | null; difficultyLabels: Record<string, string>; onBack: () => void; onFavorite: (item: InspirationItem) => Promise<void>; onUse: (item: InspirationItem) => Promise<void>; onCreateTask: (item: InspirationItem) => void }) {
  const isZh = isZhCopy(t)
  if (loading) return <LoadingPage t={t} />
  if (!item) return <UnavailablePage t={t} onBack={onBack} />
  const sections = [
    [textFor(t, 'Prerequisites', '前置条件'), contentLines(item.content?.prerequisites)],
    [textFor(t, 'Steps', '具体步骤'), contentLines(item.content?.steps)],
    [textFor(t, 'Inputs', '需要输入'), contentLines(item.content?.inputs)],
    [textFor(t, 'Expected output', '预期输出'), contentLines(item.content?.outputs)],
    [textFor(t, 'Examples', '示例'), contentLines(item.content?.examples)],
    [textFor(t, 'Common mistakes', '常见错误'), contentLines(item.content?.mistakes)],
  ].filter(([, lines]) => lines.length > 0) as Array<[string, string[]]>
  return (
    <div className="inspiration-workbench inspiration-detail-page">
      <button className="inspiration-back" type="button" onClick={onBack}><ArrowLeft size={17} />{textFor(t, 'Back to library', '返回灵感库')}</button>
      <header className="inspiration-detail-header">
        <div>
          <span>{isZh ? item.category?.nameZh : item.category?.nameEn} · {item.sourceKind === 'official' ? textFor(t, 'Official', '官方') : textFor(t, 'Community submission', '用户投稿')}</span>
          <h1>{item.title}</h1>
          <p>{item.summary ?? item.text}</p>
        </div>
        <div className="inspiration-header-actions">
          <button type="button" onClick={() => void onFavorite(item)} disabled={busy === `favorite-${item.id}`}>
            {item.favorited ? <BookmarkCheck size={17} /> : <Bookmark size={17} />}{item.favorited ? textFor(t, 'Saved', '已收藏') : textFor(t, 'Favorite', '收藏')}
          </button>
          {item.supportsTaskDraft && <button type="button" onClick={() => onCreateTask(item)}><FilePlus2 size={17} />{textFor(t, 'Create task draft', '创建任务草稿')}</button>}
          <button className="primary" type="button" onClick={() => void onUse(item)} disabled={busy === `use-${item.id}`}>
            {busy === `use-${item.id}` ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}{textFor(t, 'Use in Workspace', '在工作台使用')}
          </button>
        </div>
      </header>
      {error && <div className="inspiration-inline-error">{error}</div>}
      <div className="inspiration-detail-layout">
        <main>
          <section className="inspiration-problem">
            <span>{textFor(t, 'WHAT IT SOLVES', '解决什么问题')}</span>
            <h2>{item.problem}</h2>
            <p><strong>{textFor(t, 'Best for', '适合人群')}</strong>{item.audience}</p>
          </section>
          {sections.map(([title, lines], sectionIndex) => (
            <section className="inspiration-content-section" key={title}>
              <span>{String(sectionIndex + 1).padStart(2, '0')}</span>
              <div>
                <h2>{title}</h2>
                {title === textFor(t, 'Steps', '具体步骤')
                  ? <ol>{lines.map((line) => <li key={line}>{line}</li>)}</ol>
                  : <ul>{lines.map((line) => <li key={line}>{line}</li>)}</ul>}
              </div>
            </section>
          ))}
          {item.revisions && item.revisions.length > 0 && (
            <section className="inspiration-version-history">
              <h2><History size={17} />{textFor(t, 'Published versions', '公开版本记录')}</h2>
              {item.revisions.map((revision) => (
                <div key={revision.id}><strong>v{revision.version}</strong><span>{new Date(revision.createdAt).toLocaleDateString(isZh ? 'zh-CN' : 'en-US')}</span></div>
              ))}
            </section>
          )}
        </main>
        <aside className="inspiration-detail-meta">
          <h2>{textFor(t, 'About this resource', '内容信息')}</h2>
          <dl>
            <div><dt>{textFor(t, 'Author', '作者')}</dt><dd>{item.author?.displayName ?? textFor(t, 'Official editorial team', '官方编辑团队')}</dd></div>
            <div><dt>{textFor(t, 'Version', '版本')}</dt><dd>v{item.version ?? 1}</dd></div>
            <div><dt>{textFor(t, 'Level', '难度')}</dt><dd>{item.difficulty ? difficultyLabels[item.difficulty] ?? item.difficulty : '-'}</dd></div>
            <div><dt>{textFor(t, 'Used', '使用')}</dt><dd>{item.usageCount ?? 0}</dd></div>
            <div><dt>{textFor(t, 'Updated', '更新')}</dt><dd>{item.updatedAt ? new Date(item.updatedAt).toLocaleDateString(isZh ? 'zh-CN' : 'en-US') : '-'}</dd></div>
            <div><dt>{textFor(t, 'Source', '来源')}</dt><dd>{item.sourceAttribution || textFor(t, 'Original contribution', '原创投稿')}</dd></div>
          </dl>
        </aside>
      </div>
    </div>
  )
}

type SubmissionFormState = {
  title: string
  summary: string
  problem: string
  audience: string
  categoryId: string
  difficulty: string
  domains: string[]
  toolModels: string
  prerequisites: string
  steps: string
  inputs: string
  outputs: string
  examples: string
  mistakes: string
  sourceAttribution: string
  license: string
}

const formFromItem = (item?: InspirationItem | null): SubmissionFormState => {
  const snapshot = (item?.pendingRevision?.snapshot ?? item ?? {}) as Record<string, unknown>
  const content = (snapshot.content && typeof snapshot.content === 'object' ? snapshot.content : {}) as Record<string, unknown>
  return {
    title: typeof snapshot.title === 'string' ? snapshot.title : '',
    summary: typeof snapshot.summary === 'string' ? snapshot.summary : '',
    problem: typeof snapshot.problem === 'string' ? snapshot.problem : '',
    audience: typeof snapshot.audience === 'string' ? snapshot.audience : '',
    categoryId: typeof snapshot.categoryId === 'string' ? snapshot.categoryId : item?.category?.id ?? '',
    difficulty: typeof snapshot.difficulty === 'string' ? snapshot.difficulty : 'beginner',
    domains: Array.isArray(snapshot.domains) ? snapshot.domains.filter((value): value is string => typeof value === 'string') : [],
    toolModels: Array.isArray(snapshot.toolModels) ? snapshot.toolModels.join(', ') : '',
    prerequisites: contentLines(content.prerequisites).join('\n'),
    steps: contentLines(content.steps).join('\n'),
    inputs: contentLines(content.inputs).join('\n'),
    outputs: contentLines(content.outputs).join('\n'),
    examples: contentLines(content.examples).join('\n'),
    mistakes: contentLines(content.mistakes).join('\n'),
    sourceAttribution: typeof snapshot.sourceAttribution === 'string' ? snapshot.sourceAttribution : '',
    license: typeof snapshot.license === 'string' ? snapshot.license : '',
  }
}

function SubmissionForm({ t, categories, signedIn, requireAuth, item, onComplete }: { t: Record<string, string>; categories: ApiInspirationCategory[]; signedIn: boolean; requireAuth: () => void; item?: InspirationItem | null; onComplete: () => void }) {
  const isZh = isZhCopy(t)
  const contentCategories = categories.filter((category) => category.kind === 'content_type')
  const domainCategories = categories.filter((category) => category.kind === 'domain')
  const difficultyCategories = categories.filter((category) => category.kind === 'difficulty')
  const [form, setForm] = useState<SubmissionFormState>(() => {
    if (item) return formFromItem(item)
    try {
      const raw = window.sessionStorage.getItem('hcaiInspirationSubmissionPrefill')
      if (!raw) return formFromItem()
      window.sessionStorage.removeItem('hcaiInspirationSubmissionPrefill')
      return { ...formFromItem(), ...JSON.parse(raw) as Partial<SubmissionFormState> }
    } catch {
      return formFromItem()
    }
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selectedCategoryId = form.categoryId || contentCategories[0]?.id || ''
  const update = <K extends keyof SubmissionFormState>(field: K, value: SubmissionFormState[K]) => setForm((current) => ({ ...current, [field]: value }))
  const save = async (submit: boolean) => {
    if (!signedIn) return requireAuth()
    setBusy(true)
    setError(null)
    const request: InspirationSubmissionRequest = {
      title: form.title,
      summary: form.summary,
      problem: form.problem,
      audience: form.audience,
      categoryId: selectedCategoryId,
      contentType: contentCategories.find((category) => category.id === selectedCategoryId)?.slug ?? item?.contentType ?? 'skills',
      domains: form.domains,
      difficulty: form.difficulty as InspirationSubmissionRequest['difficulty'],
      toolModels: form.toolModels.split(',').map((value) => value.trim()).filter(Boolean),
      content: {
        prerequisites: contentLines(form.prerequisites),
        steps: contentLines(form.steps),
        inputs: contentLines(form.inputs),
        outputs: contentLines(form.outputs),
        examples: contentLines(form.examples),
        mistakes: contentLines(form.mistakes),
      },
      sourceAttribution: form.sourceAttribution || null,
      license: form.license || null,
    }
    try {
      const draft = item?.id != null
        ? await communityService.updateInspirationSubmission(item.id, request)
        : await communityService.createInspirationSubmission(request)
      if (submit && draft.id != null) await communityService.submitInspiration(draft.id)
      onComplete()
    } catch {
      setError(textFor(t, 'The draft was not saved. Check required fields and try again.', '草稿没有保存，请检查必填内容后重试。'))
    } finally {
      setBusy(false)
    }
  }
  const newVersion = item?.status === 'published'
  const reviewNote = item?.pendingRevision?.reviewNote ?? item?.reviewNote
  const requiredComplete = [form.title, form.summary, form.problem, form.audience, form.steps, form.outputs, selectedCategoryId]
    .filter((value) => Boolean(value.trim())).length
  const formStatus = item?.pendingRevision?.status ?? item?.status ?? 'draft'
  const formStatusLabel = statusLabels[formStatus as keyof typeof statusLabels] ?? statusLabels.draft
  return (
    <div className="inspiration-workbench inspiration-submit-page">
      <button className="inspiration-back" type="button" onClick={() => navigate('#inspiration/submissions')}><ArrowLeft size={17} />{textFor(t, 'Back to submissions', '返回我的投稿')}</button>
      <header className="inspiration-form-header">
        <span>{newVersion ? textFor(t, 'NEW VERSION', '提交新版') : textFor(t, 'COMMUNITY CONTRIBUTION', '用户投稿')}</span>
        <h1>{newVersion ? textFor(t, 'Update a published resource', '更新已发布内容') : item ? textFor(t, 'Continue your submission', '继续完善投稿') : textFor(t, 'Share a reusable method', '分享可复用的方法')}</h1>
        <p>{newVersion
          ? textFor(t, 'The current version stays public until an administrator approves this update.', '管理员审核新版期间，当前公开版本会继续在线。')
          : textFor(t, 'Save a draft first or submit it for review. It will not appear publicly until an administrator approves it.', '可以先保存草稿，也可以提交审核；管理员通过前不会公开显示。')}</p>
      </header>
      {reviewNote && <div className="inspiration-review-note"><strong>{textFor(t, 'Review note', '审核意见')}</strong><span>{reviewNote}</span></div>}
      <form className="inspiration-submission-form" onSubmit={(event) => { event.preventDefault(); void save(true) }}>
        <div className="inspiration-form-main">
          <section className="inspiration-form-section">
            <div className="inspiration-form-section-heading"><span>01</span><div><h2>{textFor(t, 'Basics', '基础信息')}</h2><p>{textFor(t, 'Name the resource and define the problem it addresses.', '说明这项内容是什么，以及它解决的问题。')}</p></div></div>
            <div className="inspiration-form-grid">
              <label className="wide"><span>{textFor(t, 'Title', '标题')}</span><input required maxLength={140} value={form.title} onChange={(event) => update('title', event.target.value)} /></label>
              <label className="wide"><span>{textFor(t, 'Short summary', '简短介绍')}</span><textarea required rows={2} maxLength={320} value={form.summary} onChange={(event) => update('summary', event.target.value)} /></label>
              <label className="wide"><span>{textFor(t, 'What problem does it solve?', '它解决什么问题？')}</span><textarea required rows={3} value={form.problem} onChange={(event) => update('problem', event.target.value)} /></label>
              <label className="wide"><span>{textFor(t, 'Who is it for?', '适合谁？')}</span><textarea required rows={2} value={form.audience} onChange={(event) => update('audience', event.target.value)} /></label>
            </div>
          </section>

          <section className="inspiration-form-section">
            <div className="inspiration-form-section-heading"><span>02</span><div><h2>{textFor(t, 'Classification', '内容分类')}</h2><p>{textFor(t, 'Place the resource in the right type, domain, and level.', '选择内容类型、适用领域和难度。')}</p></div></div>
            <div className="inspiration-form-grid">
              <label><span>{textFor(t, 'Content type', '内容类型')}</span><select required value={selectedCategoryId} onChange={(event) => update('categoryId', event.target.value)}><option value="" disabled>{textFor(t, 'Choose a type', '选择类型')}</option>{contentCategories.map((category) => <option key={category.id} value={category.id}>{isZh ? category.nameZh : category.nameEn}</option>)}</select></label>
              <label><span>{textFor(t, 'Difficulty', '难度')}</span><select value={form.difficulty || difficultyCategories[0]?.slug || ''} onChange={(event) => update('difficulty', event.target.value)}>{difficultyCategories.map((category) => <option key={category.id} value={category.slug}>{isZh ? category.nameZh : category.nameEn}</option>)}</select></label>
              <label className="wide"><span>{textFor(t, 'Tools or models', '适用工具或模型')}</span><input value={form.toolModels} onChange={(event) => update('toolModels', event.target.value)} placeholder={textFor(t, 'Separate with commas', '用逗号分隔')} /></label>
              <fieldset className="wide"><legend>{textFor(t, 'Domains', '适用领域')}</legend><div>{domainCategories.map((category) => <label key={category.id}><input type="checkbox" checked={form.domains.includes(category.slug)} onChange={(event) => update('domains', event.target.checked ? [...form.domains, category.slug] : form.domains.filter((itemValue) => itemValue !== category.slug))} />{isZh ? category.nameZh : category.nameEn}</label>)}</div></fieldset>
            </div>
          </section>

          <section className="inspiration-form-section">
            <div className="inspiration-form-section-heading"><span>03</span><div><h2>{textFor(t, 'Method content', '方法内容')}</h2><p>{textFor(t, 'Document the reusable process and its expected result.', '整理可复用的过程和预期结果。')}</p></div></div>
            <div className="inspiration-form-grid">
              {(['prerequisites', 'steps', 'inputs', 'outputs', 'examples', 'mistakes'] as const).map((field) => (
                <label className="wide" key={field}>
                  <span>{({ prerequisites: textFor(t, 'Prerequisites', '前置条件'), steps: textFor(t, 'Steps (one per line)', '具体步骤（每行一步）'), inputs: textFor(t, 'Inputs', '需要输入'), outputs: textFor(t, 'Expected outputs', '预期输出'), examples: textFor(t, 'Examples', '示例'), mistakes: textFor(t, 'Common mistakes', '常见错误') })[field]}</span>
                  <textarea className={field === 'steps' ? 'is-long' : ''} required={field === 'steps' || field === 'outputs'} rows={field === 'steps' ? 7 : 3} value={form[field]} onChange={(event) => update(field, event.target.value)} />
                </label>
              ))}
            </div>
          </section>

          <section className="inspiration-form-section">
            <div className="inspiration-form-section-heading"><span>04</span><div><h2>{textFor(t, 'Source and rights', '来源与授权')}</h2><p>{textFor(t, 'Record attribution and reuse permissions when applicable.', '如有需要，请注明来源和可使用范围。')}</p></div></div>
            <div className="inspiration-form-grid">
              <label><span>{textFor(t, 'Source', '来源说明')}</span><input value={form.sourceAttribution} onChange={(event) => update('sourceAttribution', event.target.value)} /></label>
              <label><span>{textFor(t, 'License', '授权说明')}</span><input value={form.license} onChange={(event) => update('license', event.target.value)} /></label>
            </div>
          </section>
        </div>

        <aside className="inspiration-form-sidebar">
          <div className="inspiration-form-status">
            <span>{textFor(t, 'Submission status', '投稿状态')}</span>
            <strong>{isZh ? formStatusLabel[1] : formStatusLabel[0]}</strong>
          </div>
          <dl>
            <div><dt>{textFor(t, 'Required', '必填内容')}</dt><dd>{requiredComplete} / 7</dd></div>
            <div><dt>{textFor(t, 'Visibility', '公开状态')}</dt><dd>{textFor(t, 'After approval', '审核通过后')}</dd></div>
            {item?.version && <div><dt>{textFor(t, 'Version', '版本')}</dt><dd>v{item.pendingRevision?.version ?? item.version}</dd></div>}
          </dl>
          {error && <div className="inspiration-inline-error">{error}</div>}
          <div className="inspiration-form-actions">
            <button type="button" disabled={busy} onClick={() => void save(false)}>{textFor(t, 'Save draft', '保存草稿')}</button>
            <button className="primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}{textFor(t, 'Submit for review', '提交审核')}</button>
          </div>
        </aside>
      </form>
    </div>
  )
}
