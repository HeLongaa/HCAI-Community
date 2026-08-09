import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  AtSign,
  Bot,
  BriefcaseBusiness,
  ChevronDown,
  ChevronRight,
  FileText,
  Eye,
  EyeOff,
  Globe2,
  Heart,
  Image,
  ListMusic,
  LoaderCircle,
  LockKeyhole,
  Mail,
  MonitorCheck,
  MessageCircle,
  MoreHorizontal,
  Pause,
  PenLine,
  Play,
  RefreshCcw,
  Search,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Trophy,
  UserRound,
  WandSparkles,
  X,
} from 'lucide-react'
import { SiApple, SiDiscord, SiGithub, SiGoogle } from 'react-icons/si'
import type { Locale, MarketplaceProfile, Page, SimulateAction, Track } from '../../domain/types'
import { isZhCopy, localizeText, textFor } from '../../domain/utils'
import { authService } from '../../services/authService'
import { complianceService, policyConsentRequest } from '../../services/complianceService'
import { isApiClientError } from '../../services/apiClient'
import { profileService } from '../../services/profileService'
import { searchService } from '../../services/searchService'
import { showLocalTestAccounts } from '../../services/runtimeConfig'
import type { ApiComplianceManifest, ApiPolicyConsentStatus, ApiSearchResult, ApiSession, OAuthAccountLink, OAuthProvider, OAuthProviderMetadata, RegisterRequest, RegistrationResponse, SearchResourceType, SearchSort } from '../../services/contracts'
import type { OAuthLoginResult } from '../../hooks/useAccountState'

type IslandAction = {
  page: Page
  label: string
  hint: string
  icon: ReactNode
  keys: string[]
}

export function DynamicIsland({
  t,
  locale,
  page,
  setPage,
  track,
  playing,
  setPlaying,
}: {
  t: Record<string, string>
  locale: Locale
  page: Page
  setPage: (page: Page) => void
  track: Track
  playTrack: (track: Track) => void
  playing: boolean
  setPlaying: (playing: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [query, setQuery] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)
  const isZh = locale === 'zh'
  const pageGuide: Partial<Record<Page, [string, string]>> = {
    home: isZh
      ? ['AI 指引', '告诉我你想做什么，我带你进入任务、社区或创作工具。']
      : ['AI Guide', 'Tell me what you want to do and I will route you to tasks, community, or tools.'],
    tasks: isZh
      ? ['任务广场助手', '筛选需求、查看详情、接取任务或快速发布新需求。']
      : ['Task Plaza Helper', 'Filter work, inspect details, claim a task, or publish a new brief.'],
    community: isZh
      ? ['社区阅读助手', '浏览话题、进入详情、回复帖子，也可以把讨论转成任务。']
      : ['Community Helper', 'Browse topics, open details, reply, or turn a discussion into a task.'],
    publish: isZh
      ? ['发布需求助手', '补全目标、交付物、验收标准和奖励规则后发布。']
      : ['Briefing Helper', 'Complete goals, deliverables, acceptance rules, and reward terms.'],
    mine: isZh
      ? ['我的任务助手', '跟踪已接取、待提交和待验收的任务进度。']
      : ['My Task Helper', 'Track claimed, submitted, and review-stage work.'],
    chat: isZh
      ? ['对话助手', '用对话生成提示词、验收标准、回复或任务说明。']
      : ['Chat Helper', 'Draft prompts, acceptance criteria, replies, and task briefs.'],
    playground: isZh
      ? ['创作工作区助手', '在一个工作区里切换生歌、生图和生视频。']
      : ['Playground Helper', 'Switch between music, image, and video creation in one workspace.'],
    inspiration: isZh
      ? ['灵感库助手', '沉淀帖子、Prompt、教程和可复用交付模板。']
      : ['Library Helper', 'Collect posts, prompts, tutorials, and reusable delivery templates.'],
    points: isZh
      ? ['积分助手', '查看贡献记录、待结算奖励和兑换入口。']
      : ['Rewards Helper', 'Review contribution history, pending rewards, and redemptions.'],
  }
  const actions: IslandAction[] = [
    {
      page: 'tasks',
      label: isZh ? '去任务广场' : 'Open Task Plaza',
      hint: isZh ? '找可接取的 AI 需求，查看预算、周期和验收标准。' : 'Find AI work with budgets, timelines, and acceptance rules.',
      icon: <BriefcaseBusiness size={17} />,
      keys: ['task', 'tasks', 'market', 'job', 'work', '接', '任务', '赚钱', '需求'],
    },
    {
      page: 'publish',
      label: isZh ? '发布需求' : 'Publish Brief',
      hint: isZh ? '把想法整理成任务标题、交付物和验收规则。' : 'Turn an idea into title, deliverables, and review rules.',
      icon: <PenLine size={17} />,
      keys: ['publish', 'post', 'brief', 'request', '发布', '发任务', '需求', '悬赏'],
    },
    {
      page: 'community',
      label: isZh ? '进入社区' : 'Open Community',
      hint: isZh ? '查看话题列表、回复或把帖子转成任务。' : 'Read topics, reply, or convert a discussion into work.',
      icon: <MessageCircle size={17} />,
      keys: ['community', 'forum', 'reply', 'topic', '社区', '论坛', '帖子', '回复'],
    },
    {
      page: 'playground',
      label: isZh ? 'AI 工作区' : 'AI Workspace',
      hint: isZh ? '进入工作区，在音乐、图片、视频和对话间切换。' : 'Open the workspace and switch between music, image, video, and chat.',
      icon: <WandSparkles size={17} />,
      keys: ['create', 'image', 'video', 'playground', 'studio', '创作', '图片', '视频', '工作区'],
    },
    {
      page: 'chat',
      label: isZh ? '工作区对话' : 'Workspace Chat',
      hint: isZh ? '进入 AI 工作区，用对话生成需求、提示词、回复和验收说明。' : 'Open AI Workspace chat to draft briefs, prompts, replies, and acceptance notes.',
      icon: <Bot size={17} />,
      keys: ['chat', 'ask', 'prompt', '对话', '聊天', '提示词', '问答'],
    },
    {
      page: 'points',
      label: isZh ? '积分奖励' : 'Rewards',
      hint: isZh ? '查看贡献积分、奖励和任务结算记录。' : 'Inspect contribution points, rewards, and task settlement history.',
      icon: <Trophy size={17} />,
      keys: ['points', 'reward', 'bonus', '积分', '奖励', '兑换'],
    },
  ]
  const currentGuide = pageGuide[page] || pageGuide.home!
  const primaryAction = actions.find((item) => item.page === page) || actions[0]
  const currentLyricLine = track.lyrics[1] || track.lyrics[0] || track.prompt
  const runGuide = (raw: string) => {
    const value = raw.trim().toLowerCase()
    const action = value
      ? actions.find((item) => item.keys.some((key) => value.includes(key.toLowerCase()))) || primaryAction
      : primaryAction
    setPage(action.page)
    setOpen(false)
    setMoreOpen(false)
  }

  if (minimized) {
    return (
      <button
        className="ai-island-float"
        type="button"
        aria-label={isZh ? '展开 AI 灵动岛' : 'Expand AI guide'}
        title={isZh ? '展开 AI 灵动岛' : 'Expand AI guide'}
        onClick={() => {
          setMinimized(false)
          setOpen(false)
        }}
      >
        <span className="island-orb">AI</span>
      </button>
    )
  }

  return (
    <section
      className={`ai-island music-island ${open ? 'open' : ''}`}
      aria-label={isZh ? 'AI 灵动岛指引' : 'AI dynamic island guide'}
      onClick={() => setOpen(true)}
    >
      <div className="island-compact">
        <button className="island-core music-island-core" type="button" aria-expanded={open} onClick={(event) => {
          event.stopPropagation()
          setOpen((current) => !current)
        }}>
          <span className="island-cover">
            <img src={track.cover} alt="" />
            <span className={playing ? 'status-dot loading' : 'status-dot idle'} />
          </span>
          <span className="island-status">
            <strong>{track.title}</strong>
            <span>{open ? `${track.artist} · ${track.duration}` : currentLyricLine}</span>
          </span>
        </button>
        <div className="music-compact-lyric" aria-hidden={open}>
          {currentLyricLine}
        </div>
        <div className="music-island-controls" onClick={(event) => event.stopPropagation()}>
          <button type="button" disabled title={textFor(t, 'Shuffle is not available', '随机播放暂未开放')} aria-label={isZh ? '随机播放暂未开放' : 'Shuffle unavailable'}>
            <RefreshCcw size={17} />
          </button>
          <button type="button" disabled aria-label={isZh ? '上一首暂不可用' : 'Previous track unavailable'}>
            <SkipBack size={17} fill="currentColor" />
          </button>
          <button className="music-play-button" type="button" onClick={() => setPlaying(!playing)} aria-label={playing ? textFor(t, 'Pause', '暂停') : textFor(t, 'Play', '播放')}>
            {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
          </button>
          <button type="button" disabled aria-label={isZh ? '下一首暂不可用' : 'Next track unavailable'}>
            <SkipForward size={17} fill="currentColor" />
          </button>
          <button type="button" disabled title={textFor(t, 'Repeat is not available', '循环播放暂未开放')} aria-label={isZh ? '循环播放暂未开放' : 'Repeat unavailable'}>
            <RefreshCcw size={17} />
          </button>
        </div>
        <button
          className="island-toggle"
          type="button"
          aria-label={open ? (isZh ? '收起歌词面板' : 'Close lyrics panel') : isZh ? '显示歌词' : 'Show lyrics'}
          title={open ? (isZh ? '收起' : 'Close') : isZh ? '歌词' : 'Lyrics'}
          onClick={(event) => {
          event.stopPropagation()
          setOpen((current) => !current)
        }}>
          <ListMusic size={17} />
        </button>
        <button
          className="island-minimize"
          type="button"
          aria-label={isZh ? '收起到右侧悬浮按钮' : 'Minimize to floating button'}
          title={isZh ? '收起到右侧' : 'Minimize'}
          onClick={(event) => {
            event.stopPropagation()
            setOpen(false)
            setMinimized(true)
          }}
        >
          <ChevronDown size={16} />
        </button>
      </div>
      <button className="music-progress" type="button" onClick={(event) => {
        event.stopPropagation()
        setOpen(true)
      }} aria-label={isZh ? '播放进度' : 'Playback progress'}>
        <span />
        <small>01:14 / {track.duration}</small>
      </button>
      <div className="music-orbit-actions" aria-label={textFor(t, 'Track actions', '歌曲互动')} onClick={(event) => event.stopPropagation()}>
        <div className="music-tool-row">
          <button
            className={moreOpen ? 'active' : ''}
            type="button"
            onClick={() => setMoreOpen((current) => !current)}
            title={textFor(t, 'More actions', '更多操作')}
            aria-expanded={moreOpen}
            aria-haspopup="menu"
          >
            <MoreHorizontal size={17} />
          </button>
          <button type="button" disabled title={textFor(t, 'Playback modes are not available', '播放模式暂未开放')}>
            <RefreshCcw size={16} />
          </button>
          <button type="button" onClick={() => {
            setMoreOpen(false)
            setOpen(false)
          }} title={textFor(t, 'Collapse player', '收起播放器')}>
            <ChevronDown size={17} />
          </button>
          <button type="button" onClick={() => {
            setMoreOpen(false)
            setOpen(false)
          }} title={textFor(t, 'Close', '关闭')}>
            <X size={17} />
          </button>
        </div>
        {moreOpen && (
          <div className="music-more-menu" role="menu" aria-label={textFor(t, 'More actions', '更多操作')}>
            <button type="button" role="menuitem" disabled>{textFor(t, 'Download unavailable', '下载暂未开放')}</button>
            <button type="button" role="menuitem" disabled>{textFor(t, 'Queue unavailable', '队列暂未开放')}</button>
            <button type="button" role="menuitem" disabled>{textFor(t, 'Track link unavailable', '歌曲链接暂未开放')}</button>
            <button type="button" role="menuitem" disabled>{textFor(t, 'Reporting unavailable', '举报暂未开放')}</button>
          </div>
        )}
        <div className="music-share-row">
          <button type="button" disabled title={textFor(t, 'Likes are not available', '点赞暂未开放')}>
            <Heart size={18} />
          </button>
          <button className="music-share-button" type="button" disabled title={textFor(t, 'Sharing is not available', '分享暂未开放')}>
            <span>{textFor(t, 'Share unavailable', '分享暂未开放')}</span>
          </button>
        </div>
      </div>
      <div className="island-expanded" onClick={(event) => event.stopPropagation()}>
        <div className="music-expanded-grid">
          <div className="music-comment-stream" aria-label={textFor(t, 'Comments', '评论')}>
            <button className="music-add-comment" type="button" disabled title={textFor(t, 'Comments are not available', '评论暂未开放')}>
              <span><UserRound size={22} /></span>
              <strong>{textFor(t, 'Add a comment...', '添加评论...')}</strong>
            </button>
            <div className="music-comment-list empty-state compact">
              <strong>{textFor(t, 'No comments yet', '暂无评论')}</strong>
              <span>{textFor(t, 'Comments will appear after the public media catalog is connected.', '公开媒体目录接入后，评论将在这里显示。')}</span>
            </div>
          </div>
          <div className="music-lyrics-reader" aria-label={textFor(t, 'Lyrics', '歌词')}>
            <p className="music-prompt-lead">{track.prompt}</p>
            <span className="music-lyric-title">{track.title}</span>
            <div className="music-lyric-lines">
              <strong>{textFor(t, 'Verse 1', 'Verse 1')}</strong>
              {track.lyrics.map((line, index) => (
                <p className={index === 1 ? 'active' : ''} key={`${track.id}-${line}`}>
                  {line}
                </p>
              ))}
            </div>
          </div>
        </div>
        <div className="island-guide-note">
          <strong>{currentGuide[0]}</strong>
          <span>{currentGuide[1]}</span>
        </div>
        <div className="island-command">
          <input
            value={query}
            placeholder={isZh ? '例如：我要发布任务 / 找任务赚钱 / 看社区 / 生成图片 / 做视频' : 'Try: publish a task / find work / reply in forum / generate images / make video'}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                runGuide(query)
              }
            }}
          />
          <button className="primary-button" type="button" onClick={() => runGuide(query)}>
            {isZh ? '帮我找到' : 'Route me'}
          </button>
        </div>
      </div>
    </section>
  )
}


export function SearchPanel({
  t,
  close,
  setPage,
  openProfile,
}: {
  t: Record<string, string>
  close: () => void
  playTrack: (track: Track) => void
  setPage: (page: Page) => void
  openProfile: (profile: MarketplaceProfile) => void
}) {
  const [query, setQuery] = useState('')
  const [type, setType] = useState<SearchResourceType | 'all'>('all')
  const [sort, setSort] = useState<SearchSort>('relevance')
  const [results, setResults] = useState<Array<{ item: ApiSearchResult; searchEventId: string | null }>>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])') ?? [])]
        .filter((element) => element.getClientRects().length > 0)
      if (!focusable.length) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleDialogKeyDown)
    return () => document.removeEventListener('keydown', handleDialogKeyDown)
  }, [close])

  const runSearch = useCallback(async (cursor: string | null = null, append = false) => {
    const normalized = query.trim()
    if (normalized.length < 2) {
      setResults([])
      setNextCursor(null)
      setSearched(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const page = await searchService.search({ q: normalized, types: type === 'all' ? undefined : [type], sort, limit: 20, cursor })
      const hits = page.items.map((item) => ({ item, searchEventId: page.searchEventId }))
      setResults((current) => append ? [...current, ...hits] : hits)
      setNextCursor(page.nextCursor)
      setSearched(true)
    } catch (searchError) {
      if (!append) setResults([])
      setNextCursor(null)
      setSearched(true)
      setError(searchError instanceof Error ? searchError.message : textFor(t, 'Search unavailable.', '搜索暂不可用。'))
    } finally {
      setLoading(false)
    }
  }, [query, sort, t, type])

  useEffect(() => {
    const timer = window.setTimeout(() => void runSearch(), 300)
    return () => window.clearTimeout(timer)
  }, [runSearch])

  const openResult = async (hit: { item: ApiSearchResult; searchEventId: string | null }, position: number) => {
    if (hit.searchEventId) void searchService.recordClick(hit.searchEventId, { resourceType: hit.item.type, sourceId: hit.item.id, position }).catch(() => {})
    const target = hit.item.target
    try {
      if (target.page === 'profile' && typeof target.handle === 'string') {
        openProfile(await profileService.findByHandle(target.handle))
      } else if (target.page === 'tasks' || target.page === 'community' || target.page === 'profile') {
        setPage(target.page)
      }
      close()
    } catch (navigationError) {
      setError(navigationError instanceof Error ? navigationError.message : textFor(t, 'Result unavailable.', '结果暂不可用。'))
    }
  }

  const resultIcon = (resourceType: SearchResourceType) => resourceType === 'task'
    ? <BriefcaseBusiness size={18} />
    : resourceType === 'community'
      ? <MessageCircle size={18} />
      : resourceType === 'user'
        ? <UserRound size={18} />
        : <Image size={18} />

  return (
    <div className="search-backdrop" onClick={close}>
      <section ref={dialogRef} className="search-panel" role="dialog" aria-modal="true" aria-label={t.search} onClick={(event) => event.stopPropagation()}>
        <div className="search-input">
          <Search size={18} />
          <input data-testid="discovery-search-input" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.search} />
          <button type="button" onClick={close} aria-label="Close search">
            <X size={17} />
          </button>
        </div>
        <div className="search-controls">
          <div className="segmented-control" aria-label={textFor(t, 'Result type', '结果类型')}>
            {(['all', 'task', 'community', 'user', 'asset'] as const).map((item) => (
              <button type="button" key={item} className={type === item ? 'active' : ''} onClick={() => setType(item)}>
                {item === 'all' ? textFor(t, 'All', '全部') : item === 'task' ? textFor(t, 'Tasks', '任务') : item === 'community' ? textFor(t, 'Community', '社区') : item === 'user' ? textFor(t, 'Users', '用户') : textFor(t, 'Assets', '素材')}
              </button>
            ))}
          </div>
          <select aria-label={textFor(t, 'Sort results', '结果排序')} value={sort} onChange={(event) => setSort(event.target.value as SearchSort)}>
            <option value="relevance">{textFor(t, 'Relevant', '相关')}</option>
            <option value="recent">{textFor(t, 'Recent', '最新')}</option>
            <option value="popular">{textFor(t, 'Popular', '热门')}</option>
          </select>
        </div>
        <div className="search-results">
          {loading && results.length === 0 && <div className="search-state"><LoaderCircle className="spin" size={19} /></div>}
          {error && <div className="empty-state compact"><AlertTriangle size={18} /><strong>{textFor(t, 'Search unavailable', '搜索不可用')}</strong><span>{error}</span></div>}
          {!error && searched && !loading && results.length === 0 && <div className="empty-state compact"><FileText size={18} /><strong>{textFor(t, 'No results', '没有结果')}</strong></div>}
          {results.map((hit, index) => (
            <button
              type="button"
              className="search-result"
              key={`${hit.item.type}:${hit.item.id}`}
              onClick={() => void openResult(hit, index + 1)}
            >
              {resultIcon(hit.item.type)}
              <span>
                <strong>{hit.item.title}</strong>
                <small>{hit.item.summary || hit.item.lifecycle || hit.item.type}</small>
              </span>
              <ChevronRight size={16} />
            </button>
          ))}
          {nextCursor && <button className="ghost-button search-load-more" type="button" onClick={() => void runSearch(nextCursor, true)} disabled={loading}>{loading ? <LoaderCircle className="spin" size={16} /> : textFor(t, 'Load more', '加载更多')}</button>}
        </div>
      </section>
    </div>
  )
}

const defaultOAuthProviders: OAuthProviderMetadata[] = [
  {
    provider: 'google',
    label: 'Google',
    configured: false,
    available: false,
    mode: 'unavailable',
    authorizationUrl: null,
    callbackUrl: null,
    browserReturnOrigin: null,
    callbackMethod: 'GET',
    scopes: ['openid', 'email', 'profile'],
  },
  {
    provider: 'github',
    label: 'GitHub',
    configured: false,
    available: false,
    mode: 'unavailable',
    authorizationUrl: null,
    callbackUrl: null,
    browserReturnOrigin: null,
    callbackMethod: 'GET',
    scopes: ['read:user', 'user:email'],
  },
  {
    provider: 'apple',
    label: 'Apple',
    configured: false,
    available: false,
    mode: 'unavailable',
    authorizationUrl: null,
    callbackUrl: null,
    browserReturnOrigin: null,
    callbackMethod: 'POST',
    scopes: ['name', 'email'],
  },
  {
    provider: 'discord',
    label: 'Discord',
    configured: false,
    available: false,
    mode: 'unavailable',
    authorizationUrl: null,
    callbackUrl: null,
    browserReturnOrigin: null,
    callbackMethod: 'GET',
    scopes: ['identify', 'email'],
  },
]

const oauthProviderIcon = (provider: OAuthProvider) => {
  if (provider === 'google') return <SiGoogle aria-hidden="true" />
  if (provider === 'github') return <SiGithub aria-hidden="true" />
  if (provider === 'apple') return <SiApple aria-hidden="true" />
  return <SiDiscord aria-hidden="true" />
}

const oauthProviderStatus = (provider: OAuthProviderMetadata, t: Record<string, string>) => {
  if (provider.configured && provider.mode === 'external') {
    return {
      className: 'oauth-mode-badge live',
      label: textFor(t, 'External OAuth', '外部 OAuth'),
      title: textFor(t, 'External provider credentials are configured.', '已配置外部 OAuth 凭据。'),
    }
  }
  if (provider.mode === 'dev') {
    return {
      className: 'oauth-mode-badge dev',
      label: textFor(t, 'Dev callback', '开发回调'),
      title: textFor(t, 'Provider credentials are not configured; using the signed local dev callback.', '未配置第三方凭据；当前使用本地签名开发回调。'),
    }
  }
  return {
    className: 'oauth-mode-badge unavailable',
    label: textFor(t, 'Not configured', '未配置'),
    title: textFor(t, 'This provider is not available in the current environment.', '当前环境未启用该登录方式。'),
  }
}

const oauthErrorCopy = (error: unknown, t: Record<string, string>) => {
  if (!isApiClientError(error)) {
    return textFor(t, 'OAuth login could not be completed.', 'OAuth 登录未能完成')
  }
  const messages: Record<string, [string, string]> = {
    OAUTH_STATE_INVALID: ['This sign-in request expired. Please try again.', '本次登录请求已过期，请重试'],
    OAUTH_CANCELLED: ['Sign-in was cancelled.', '已取消第三方登录'],
    OAUTH_FAILED: ['Provider verification failed. Try again or use email login.', '第三方验证失败，请重试或使用邮箱登录'],
    OAUTH_PROVIDER_UNAVAILABLE: ['This sign-in provider is unavailable.', '该登录方式当前不可用'],
    OAUTH_ACCOUNT_CONFLICT: ['This provider account is already linked to another user.', '该第三方账号已绑定到其他用户'],
    AUTH_ACCOUNT_REQUIRED: ['Add another sign-in method before unlinking this provider.', '解绑前请先添加另一种登录方式'],
    NOT_FOUND: ['This sign-in provider is unavailable.', '该登录方式暂不可用'],
  }
  const copy = messages[error.code]
  return copy ? textFor(t, copy[0], copy[1]) : textFor(t, error.message, error.message)
}

const emailAuthErrorCopy = (error: unknown, mode: 'login' | 'register', t: Record<string, string>) => {
  if (!isApiClientError(error)) {
    return mode === 'register'
      ? textFor(t, 'Could not create account. Please try again.', '无法创建账号，请稍后重试。')
      : textFor(t, 'Could not sign in. Please try again.', '无法登录，请稍后重试。')
  }
  const messages: Record<string, [string, string]> = {
    AUTH_FAILED: ['Email or password is incorrect.', '邮箱或密码不正确。'],
    ACCOUNT_EXISTS: ['Email or handle is already registered.', '邮箱或用户名已被注册。'],
    VALIDATION_FAILED: ['Check the form fields and try again.', '请检查表单内容后重试。'],
    RATE_LIMITED: ['Too many attempts. Please wait a moment and try again.', '尝试次数过多，请稍后再试。'],
    AUTH_REQUIRED: ['Session verification failed. Please sign in again.', '会话校验失败，请重新登录。'],
    EMAIL_VERIFICATION_REQUIRED: ['Verify your email before signing in.', '请先验证邮箱再登录。'],
    AUTH_EMAIL_ACTION_INVALID: ['This link is invalid, expired, or already used.', '此链接无效、已过期或已被使用。'],
    POLICY_CONSENT_REQUIRED: ['Review and accept the required policies.', '请阅读并同意必需政策。'],
    POLICY_VERSION_MISMATCH: ['Policy versions changed. Review the current policies and try again.', '政策版本已更新，请重新阅读后再试。'],
  }
  const copy = messages[error.code]
  return copy ? textFor(t, copy[0], copy[1]) : textFor(t, error.message, error.message)
}

type AuthFieldErrors = Partial<Record<'email' | 'password' | 'handle' | 'consent', string>>
type AuthMode = 'login' | 'register' | 'forgot' | 'reset' | 'verify' | 'verification-sent' | 'reset-sent' | 'reset-done'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const handlePattern = /^[a-zA-Z0-9_-]{3,32}$/

const authFieldErrorsFromApi = (error: unknown, mode: 'login' | 'register', t: Record<string, string>): AuthFieldErrors => {
  if (!isApiClientError(error)) return {}
  if (error.code === 'AUTH_FAILED') {
    return {
      email: textFor(t, 'Check this email.', '请检查邮箱。'),
      password: textFor(t, 'Check this password.', '请检查密码。'),
    }
  }
  if (error.code === 'ACCOUNT_EXISTS' && mode === 'register') {
    return {
      email: textFor(t, 'This email may already be registered.', '该邮箱可能已被注册。'),
      handle: textFor(t, 'This handle may already be taken.', '该用户名可能已被占用。'),
    }
  }
  if (error.code === 'VALIDATION_FAILED') {
    const message = error.message.toLowerCase()
    return {
      ...(message.includes('email') ? { email: textFor(t, 'Enter a valid email address.', '请输入有效邮箱地址。') } : {}),
      ...(message.includes('password') ? { password: textFor(t, 'Use 8-128 characters.', '请输入 8-128 个字符。') } : {}),
      ...(message.includes('handle') ? { handle: textFor(t, 'Use 3-32 letters, numbers, underscores, or hyphens.', '请使用 3-32 位字母、数字、下划线或连字符。') } : {}),
    }
  }
  return {}
}

export function LoginModal({
  t,
  close,
  onAuthenticated,
  presentation = 'modal',
  leaving = false,
  simulateAction,
  loginAs,
  loginWithPassword,
  loginWithOAuthProvider,
  registerWithEmail,
  verifyEmail,
  resetPassword,
  setPage,
}: {
  t: Record<string, string>
  close: () => void
  onAuthenticated?: (destination?: Page) => void
  presentation?: 'modal' | 'page'
  leaving?: boolean
  simulateAction: SimulateAction
  loginAs?: (handle: string) => Promise<void>
  loginWithPassword: (email: string, password: string) => Promise<void>
  loginWithOAuthProvider: (provider: OAuthProvider) => Promise<OAuthLoginResult>
  registerWithEmail: (payload: RegisterRequest) => Promise<RegistrationResponse>
  verifyEmail: (token: string) => Promise<void>
  resetPassword: (token: string, password: string) => Promise<void>
  setPage: (page: Page) => void
}) {
  const isZh = isZhCopy(t)
  const [providers, setProviders] = useState<OAuthProviderMetadata[]>(defaultOAuthProviders)
  const [selectedProvider, setSelectedProvider] = useState<OAuthProvider | ''>('')
  const authQuery = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
  const initialAction = authQuery.get('action')
  const [mode, setMode] = useState<AuthMode>(initialAction === 'password-reset' ? 'reset' : initialAction === 'verify-email' ? 'verify' : 'login')
  const [actionToken] = useState(() => authQuery.get('token') ?? '')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [handle, setHandle] = useState('')
  const [submitting, setSubmitting] = useState(mode === 'verify' && Boolean(actionToken))
  const [policyManifest, setPolicyManifest] = useState<ApiComplianceManifest | null>(null)
  const [policyAccepted, setPolicyAccepted] = useState(false)
  const [error, setError] = useState(() => mode === 'verify' && !actionToken
    ? textFor(t, 'This verification link is invalid.', '此验证链接无效。')
    : '')
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({})
  const localTestAccounts = [
    { handle: 'opsplus', label: textFor(t, 'Admin', '管理员'), hint: 'opsplus' },
    { handle: 'legalpixel', label: textFor(t, 'Moderator', '审核员'), hint: 'legalpixel' },
    { handle: 'promptlin', label: textFor(t, 'Creator', '创作者'), hint: 'promptlin' },
    { handle: 'veyn', label: textFor(t, 'MiniMax creator', 'MiniMax 创作者'), hint: 'veyn' },
    { handle: 'taskops', label: textFor(t, 'Publisher', '发布方'), hint: 'taskops' },
  ]
  const hasDevOAuthProviders = providers.some((provider) => provider.mode === 'dev' && !provider.configured)
  const hasExternalOAuthProviders = providers.some((provider) => provider.mode === 'external' && provider.configured)
  const availableOAuthProviders = providers.filter((provider) => provider.available)
  const isPage = presentation === 'page'
  const finishAuthentication = (destination?: Page) => {
    if (onAuthenticated) {
      onAuthenticated(destination)
      return
    }
    close()
  }
  const openLinkedPage = (nextPage: Page) => {
    setPage(nextPage)
    if (isPage) {
      return
    }
    close()
  }

  useEffect(() => {
    if (!['login', 'register'].includes(mode)) return
    let active = true
    authService
      .listOAuthProviders()
      .then((items) => {
        if (!active || items.length === 0) return
        setProviders(items.filter((provider) => provider.provider !== 'dev'))
      })
      .catch((providersError) => {
        console.info('[oauth-providers]', providersError)
      })
    return () => {
      active = false
    }
  }, [mode])

  useEffect(() => {
    if (mode !== 'register') return
    let active = true
    complianceService
      .getManifest()
      .then((manifest) => {
        if (active) setPolicyManifest(manifest)
      })
      .catch((manifestError) => {
        console.info('[compliance-manifest]', manifestError)
        if (active) setError(textFor(t, 'Could not load the current policies.', '无法加载当前政策。'))
      })
    return () => {
      active = false
    }
  }, [mode, t])

  useEffect(() => {
    if (mode !== 'verify') return
    if (!actionToken) return
    let active = true
    verifyEmail(actionToken)
      .then(() => {
        if (!active) return
        simulateAction(textFor(t, 'Email verified', '邮箱验证成功'))
        finishAuthentication()
      })
      .catch((verifyError) => {
        if (!active) return
        setError(emailAuthErrorCopy(verifyError, 'login', t))
      })
      .finally(() => {
        if (active) setSubmitting(false)
      })
    return () => { active = false }
  // The action token is immutable for this mounted auth route.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionToken, mode])

  const getFieldErrors = (): AuthFieldErrors => {
    const next: AuthFieldErrors = {}
    const normalizedEmail = email.trim().toLowerCase()
    if (mode !== 'reset' && !emailPattern.test(normalizedEmail)) {
      next.email = textFor(t, 'Enter a valid email address.', '请输入有效邮箱地址。')
    }
    if (!['forgot', 'verification-sent', 'reset-sent', 'verify', 'reset-done'].includes(mode) && !password) {
      next.password = textFor(t, 'Enter your password.', '请输入密码。')
    } else if (['register', 'reset'].includes(mode) && (password.length < 8 || password.length > 128)) {
      next.password = textFor(t, 'Use 8-128 characters.', '请输入 8-128 个字符。')
    }
    if (mode === 'register' && handle.trim() && !handlePattern.test(handle.trim())) {
      next.handle = textFor(t, 'Use 3-32 letters, numbers, underscores, or hyphens.', '请使用 3-32 位字母、数字、下划线或连字符。')
    }
    if (mode === 'register' && (!policyAccepted || !policyManifest)) {
      next.consent = textFor(t, 'Review and accept the current required policies.', '请阅读并同意当前必需政策。')
    }
    return next
  }

  const clearFieldError = (field: keyof AuthFieldErrors) => {
    setFieldErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  const submitEmailAuth = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    const nextFieldErrors = getFieldErrors()
    setFieldErrors(nextFieldErrors)
    if (Object.keys(nextFieldErrors).length > 0) {
      return
    }
    setSubmitting(true)
    if (mode === 'forgot') {
      void authService.requestPasswordReset(email)
        .then(() => setMode('reset-sent'))
        .catch((authError) => setError(emailAuthErrorCopy(authError, 'login', t)))
        .finally(() => setSubmitting(false))
      return
    }
    if (mode === 'reset') {
      void resetPassword(actionToken, password)
        .then(() => {
          setPassword('')
          window.history.replaceState(null, '', '#auth')
          setMode('reset-done')
        })
        .catch((authError) => setError(emailAuthErrorCopy(authError, 'login', t)))
        .finally(() => setSubmitting(false))
      return
    }
    const action = mode === 'register'
      ? registerWithEmail({
          email,
          password,
          displayName: displayName || undefined,
          handle: handle || undefined,
          policyConsent: policyConsentRequest(policyManifest as ApiComplianceManifest, isZh ? 'zh' : 'en'),
        })
      : loginWithPassword(email, password)
    const submittedMode = mode === 'register' ? 'register' : 'login'
    void action
      .then((result) => {
        if (mode === 'register' && result && 'verificationRequired' in result) {
          setMode('verification-sent')
          simulateAction(textFor(t, 'Verification email queued', '验证邮件已进入发送队列'))
          return
        }
        simulateAction(
          mode === 'register'
            ? textFor(t, 'Account created and session verified', '账号已创建并完成会话校验')
            : textFor(t, 'Signed in and session verified', '已登录并完成会话校验'),
        )
        finishAuthentication()
      })
      .catch((authError) => {
        console.info('[auth]', authError)
        setError(emailAuthErrorCopy(authError, submittedMode, t))
        setFieldErrors(authFieldErrorsFromApi(authError, submittedMode, t))
      })
      .finally(() => setSubmitting(false))
  }

  const submitLocalTestAccount = (handleName: string) => {
    if (!loginAs || submitting) return
    setError('')
    setFieldErrors({})
    setSubmitting(true)
    void loginAs(handleName)
      .then(() => {
        simulateAction(textFor(t, `Signed in as ${handleName}`, `已作为 ${handleName} 登录`))
        finishAuthentication()
      })
      .catch((authError) => {
        console.info('[auth-demo]', authError)
        setError(emailAuthErrorCopy(authError, 'login', t))
      })
      .finally(() => setSubmitting(false))
  }

  return (
    <div className={isPage ? `auth-page-shell${leaving ? ' is-leaving' : ''}` : 'modal-backdrop'} onClick={isPage ? undefined : close}>
      {isPage && (
        <a className="auth-page-brand" href="/" aria-label="HCAI Community home">
          <span>HCAI</span>
          <small>COMMUNITY</small>
        </a>
      )}
      <section className={isPage ? 'login-modal auth-page-panel' : 'login-modal'} onClick={(event) => event.stopPropagation()}>
        <button className="close-button" type="button" onClick={close} aria-label={textFor(t, 'Back to home', '返回首页')}>
          <X size={18} />
        </button>
        <div className="auth-heading">
          {isPage && <span className="auth-product-icon"><WandSparkles size={20} /></span>}
          <div>
            {isPage && <small>HCAI COMMUNITY</small>}
            <h2>
              {mode === 'login'
                ? textFor(t, 'Welcome back', '欢迎回来')
                : mode === 'register'
                  ? textFor(t, 'Create your account', '创建你的账号')
                  : mode === 'forgot'
                    ? textFor(t, 'Reset your password', '找回密码')
                    : mode === 'reset'
                      ? textFor(t, 'Choose a new password', '设置新密码')
                      : mode === 'verify'
                        ? textFor(t, 'Verifying your email', '正在验证邮箱')
                        : mode === 'verification-sent'
                          ? textFor(t, 'Check your inbox', '请查收邮件')
                          : mode === 'reset-sent'
                            ? textFor(t, 'Check your inbox', '请查收邮件')
                            : textFor(t, 'Password updated', '密码已更新')}
            </h2>
            {isPage && (
              <p>
                {mode === 'login'
                  ? textFor(t, 'Sign in to continue to your workspace.', '登录后继续进入你的工作空间。')
                  : mode === 'register'
                    ? textFor(t, 'Join the community and start building.', '加入社区，开始共同创造。')
                    : mode === 'reset'
                      ? textFor(t, 'Use a password you have not used here before.', '请设置一个新的安全密码。')
                      : textFor(t, 'A secure, one-time link protects this account action.', '本次账号操作使用一次性安全链接。')}
              </p>
            )}
          </div>
        </div>
        {['login', 'register'].includes(mode) && <div className="auth-mode-tabs" role="tablist" aria-label={textFor(t, 'Authentication mode', '认证模式')}>
          <button
            className={mode === 'login' ? 'active' : ''}
            type="button"
            onClick={() => {
              setMode('login')
              setError('')
              setFieldErrors({})
            }}
          >
            {textFor(t, 'Login', '登录')}
          </button>
          <button
            className={mode === 'register' ? 'active' : ''}
            type="button"
            onClick={() => {
              setMode('register')
              setError('')
              setFieldErrors({})
            }}
          >
            {textFor(t, 'Sign up', '注册')}
          </button>
        </div>}
        {mode === 'forgot' && (
          <button className="auth-back-action" type="button" onClick={() => { setMode('login'); setError(''); setFieldErrors({}) }}>
            {textFor(t, 'Back to sign in', '返回登录')}
          </button>
        )}
        {!['verify', 'verification-sent', 'reset-sent', 'reset-done'].includes(mode) && <form className="auth-form" onSubmit={submitEmailAuth} noValidate>
          {mode === 'register' && (
            <>
              <label className="auth-field">
                <span className="auth-field-label">{textFor(t, 'Display name', '显示名称')}</span>
                <span className="auth-input-control">
                  <UserRound size={17} aria-hidden="true" />
                  <input
                    type="text"
                    autoComplete="name"
                    placeholder={textFor(t, 'Display name', '显示名称')}
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                </span>
              </label>
              <label className={fieldErrors.handle ? 'auth-field invalid' : 'auth-field'}>
                <span className="auth-field-label">{textFor(t, 'Handle', '用户名')}</span>
                <span className="auth-input-control">
                  <AtSign size={17} aria-hidden="true" />
                  <input
                    type="text"
                    autoComplete="username"
                    placeholder={textFor(t, 'Handle', '用户名')}
                    value={handle}
                    aria-invalid={fieldErrors.handle ? 'true' : 'false'}
                    aria-describedby={fieldErrors.handle ? 'auth-handle-error' : undefined}
                    onChange={(event) => {
                      setHandle(event.target.value)
                      clearFieldError('handle')
                    }}
                  />
                </span>
                {fieldErrors.handle && <small id="auth-handle-error">{fieldErrors.handle}</small>}
              </label>
            </>
          )}
          {mode !== 'reset' && <label className={fieldErrors.email ? 'auth-field invalid' : 'auth-field'}>
            <span className="auth-field-label">{textFor(t, 'Email address', '邮箱地址')}</span>
            <span className="auth-input-control">
              <Mail size={17} aria-hidden="true" />
              <input
                type="email"
                autoComplete="email"
                placeholder={textFor(t, 'Email', '邮箱')}
                value={email}
                aria-invalid={fieldErrors.email ? 'true' : 'false'}
                aria-describedby={fieldErrors.email ? 'auth-email-error' : undefined}
                onChange={(event) => {
                  setEmail(event.target.value)
                  clearFieldError('email')
                }}
              />
            </span>
            {fieldErrors.email && <small id="auth-email-error">{fieldErrors.email}</small>}
          </label>}
          {mode !== 'forgot' && <label className={fieldErrors.password ? 'auth-field invalid' : 'auth-field'}>
            <span className="auth-field-label">{textFor(t, 'Password', '密码')}</span>
            <span className="auth-input-control">
              <LockKeyhole size={17} aria-hidden="true" />
              <input
                type={passwordVisible ? 'text' : 'password'}
                autoComplete={mode === 'register' || mode === 'reset' ? 'new-password' : 'current-password'}
                placeholder={textFor(t, 'Password', '密码')}
                value={password}
                aria-invalid={fieldErrors.password ? 'true' : 'false'}
                aria-describedby={fieldErrors.password ? 'auth-password-error' : undefined}
                onChange={(event) => {
                  setPassword(event.target.value)
                  clearFieldError('password')
                }}
              />
              <button
                className="auth-password-toggle"
                type="button"
                onClick={() => setPasswordVisible((visible) => !visible)}
                aria-label={passwordVisible
                  ? textFor(t, 'Hide password', '隐藏密码')
                  : textFor(t, 'Show password', '显示密码')}
              >
                {passwordVisible ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </span>
            {fieldErrors.password && <small id="auth-password-error">{fieldErrors.password}</small>}
          </label>}
          {mode === 'login' && (
            <button className="auth-forgot-action" type="button" onClick={() => { setMode('forgot'); setError(''); setFieldErrors({}) }}>
              {textFor(t, 'Forgot password?', '忘记密码？')}
            </button>
          )}
          {mode === 'register' && (
            <div className={fieldErrors.consent ? 'auth-consent invalid' : 'auth-consent'}>
              <label>
                <input
                  type="checkbox"
                  checked={policyAccepted}
                  onChange={(event) => {
                    setPolicyAccepted(event.target.checked)
                    clearFieldError('consent')
                  }}
                />
                <span>{textFor(t, 'I have reviewed and accept the current required policy versions.', '我已阅读并同意当前必需政策版本。')}</span>
              </label>
              <div className="auth-policy-links">
                {([
                  ['terms', t.terms],
                  ['privacy', t.privacy],
                  ['aup', textFor(t, 'Acceptable Use', '可接受使用政策')],
                  ['disclosures', textFor(t, 'AI disclosures', 'AI 生成说明')],
                ] as Array<[Page, string]>).map(([policyPage, label]) => (
                  <button
                    type="button"
                    key={policyPage}
                    onClick={() => {
                      openLinkedPage(policyPage)
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {fieldErrors.consent && <small>{fieldErrors.consent}</small>}
            </div>
          )}
          {error && <div className="auth-error">{error}</div>}
          <button className="primary-button auth-submit" type="submit" disabled={submitting} onClick={() => undefined}>
            {submitting
              ? textFor(t, 'Submitting...', '提交中...')
              : mode === 'register'
                ? textFor(t, 'Create account', '创建账号')
                : mode === 'forgot'
                  ? textFor(t, 'Send reset link', '发送重置链接')
                  : mode === 'reset'
                    ? textFor(t, 'Update password', '更新密码')
                    : textFor(t, 'Continue with email', '使用邮箱继续')}
            {!submitting && <ArrowRight size={17} />}
          </button>
        </form>}
        {mode === 'verify' && (
          <div className="auth-action-state" role="status">
            {submitting && <LoaderCircle className="spin" size={22} />}
            {error && <div className="auth-error">{error}</div>}
            {error && <button className="ghost-button" type="button" onClick={() => { window.history.replaceState(null, '', '#auth'); setMode('login') }}>{textFor(t, 'Back to sign in', '返回登录')}</button>}
          </div>
        )}
        {mode === 'verification-sent' && (
          <div className="auth-action-state" role="status">
            <Mail size={23} />
            <p>{textFor(t, 'We sent a verification link to your email address.', '验证链接已发送到你的邮箱。')}</p>
            <button className="ghost-button" type="button" disabled={submitting} onClick={() => {
              setSubmitting(true)
              void authService.resendEmailVerification(email).then(() => simulateAction(textFor(t, 'Verification email queued', '验证邮件已重新发送'))).catch((resendError) => setError(emailAuthErrorCopy(resendError, 'login', t))).finally(() => setSubmitting(false))
            }}>{textFor(t, 'Send again', '重新发送')}</button>
            {error && <div className="auth-error">{error}</div>}
          </div>
        )}
        {mode === 'reset-sent' && (
          <div className="auth-action-state" role="status">
            <Mail size={23} />
            <p>{textFor(t, 'If an account matches that email, a reset link is on its way.', '如果该邮箱已注册，重置链接将发送到该邮箱。')}</p>
            <button className="ghost-button" type="button" onClick={() => setMode('login')}>{textFor(t, 'Back to sign in', '返回登录')}</button>
          </div>
        )}
        {mode === 'reset-done' && (
          <div className="auth-action-state" role="status">
            <ShieldCheck size={23} />
            <p>{textFor(t, 'Your password was updated. Sign in again on every device.', '密码已更新，所有设备都需要重新登录。')}</p>
            <button className="primary-button auth-submit" type="button" onClick={() => setMode('login')}>{textFor(t, 'Sign in', '登录')}<ArrowRight size={17} /></button>
          </div>
        )}
        {showLocalTestAccounts && loginAs && ['login', 'register'].includes(mode) && (
          <details className="local-test-account-list">
            <summary>{textFor(t, 'Local test accounts', '本地测试账号')}</summary>
            <div>
              {localTestAccounts.map((account) => (
                <button
                  type="button"
                  key={account.handle}
                  onClick={() => submitLocalTestAccount(account.handle)}
                  disabled={submitting}
                >
                  <strong>{account.label}</strong>
                  <small>@{account.hint}</small>
                </button>
              ))}
            </div>
          </details>
        )}
        {availableOAuthProviders.length > 0 && ['login', 'register'].includes(mode) && (
          <>
            <div className="auth-divider"><span>{textFor(t, 'or continue with', '或使用以下方式')}</span></div>
            <div className="oauth-provider-list" aria-label={textFor(t, 'Social login providers', '第三方登录方式')}>
              {!isPage && (
                <div className="oauth-config-status">
                  <ShieldCheck size={15} />
                  <span>
                    {hasExternalOAuthProviders && !hasDevOAuthProviders
                      ? textFor(t, 'External OAuth is configured for this environment.', '当前环境已配置外部 OAuth。')
                      : textFor(t, 'Using signed local callbacks in this development environment.', '当前开发环境使用签名本地回调。')}
                  </span>
                </div>
              )}
              {availableOAuthProviders.map((provider) => {
                const status = oauthProviderStatus(provider, t)
                return (
                  <button
                    className={selectedProvider === provider.provider ? 'social-login active' : 'social-login'}
                    type="button"
                    key={provider.provider}
                    disabled={selectedProvider !== '' && selectedProvider !== provider.provider}
                    onClick={() => {
                      setSelectedProvider(provider.provider)
                      setError('')
                      void loginWithOAuthProvider(provider.provider).then((result) => {
                        if (result === 'redirecting') {
                          simulateAction(isZh ? `正在跳转到 ${provider.label}` : `Redirecting to ${provider.label}`)
                          return
                        }
                        simulateAction(isZh ? `已使用 ${provider.label} 登录` : `Signed in with ${provider.label}`)
                        finishAuthentication()
                      }).catch((oauthError) => {
                        console.info('[oauth]', oauthError)
                        setError(oauthErrorCopy(oauthError, t))
                      }).finally(() => {
                        setSelectedProvider('')
                      })
                    }}
                  >
                    {isPage ? oauthProviderIcon(provider.provider) : <Globe2 size={18} />}
                    <span>{isPage ? provider.label : isZh ? `使用 ${provider.label} 继续` : `Continue with ${provider.label}`}</span>
                    {!isPage && (
                      <b className={status.className} title={status.title}>
                        {status.label}
                      </b>
                    )}
                  </button>
                )
              })}
            </div>
          </>
        )}
        <div className="auth-legal-note">
          <span>{isPage
            ? textFor(t, 'By continuing, you agree to our', '继续即表示你同意我们的')
            : textFor(t, 'Review our current policies before using the service.', '使用服务前请阅读当前政策。')}</span>
          <button type="button" onClick={() => openLinkedPage('terms')}>{t.terms}</button>
          <button type="button" onClick={() => openLinkedPage('privacy')}>{t.privacy}</button>
          <button type="button" onClick={() => openLinkedPage('support')}>{textFor(t, 'Support', '支持')}</button>
        </div>
      </section>
    </div>
  )
}

export function PolicyConsentModal({
  t,
  status,
  acceptCurrentPolicies,
  logout,
  openPage,
  simulateAction,
}: {
  t: Record<string, string>
  status: ApiPolicyConsentStatus
  acceptCurrentPolicies: (locale: 'en' | 'zh') => Promise<void>
  logout: () => Promise<void>
  openPage: (page: Page) => void
  simulateAction: SimulateAction
}) {
  const isZh = isZhCopy(t)
  const [manifest, setManifest] = useState<ApiComplianceManifest | null>(null)
  const [selectedPolicyId, setSelectedPolicyId] = useState(status.requiredPolicies[0]?.id ?? 'terms')
  const [accepted, setAccepted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    complianceService
      .getManifest()
      .then((nextManifest) => {
        if (active) setManifest(nextManifest)
      })
      .catch((loadError) => {
        console.info('[policy-consent]', loadError)
        if (active) setError(textFor(t, 'Could not load the current policies.', '无法加载当前政策。'))
      })
    return () => {
      active = false
    }
  }, [t])

  const selectedPolicy = manifest?.policies.find((policy) => policy.id === selectedPolicyId) ?? null
  const submitConsent = () => {
    if (!accepted || !manifest) return
    setSubmitting(true)
    setError('')
    void acceptCurrentPolicies(isZh ? 'zh' : 'en')
      .then(() => {
        simulateAction(textFor(t, 'Current policy consent recorded', '已记录当前政策版本同意'))
      })
      .catch((submitError) => {
        console.info('[policy-consent]', submitError)
        setError(emailAuthErrorCopy(submitError, 'register', t))
        setAccepted(false)
      })
      .finally(() => setSubmitting(false))
  }

  return (
    <div className="modal-backdrop policy-consent-backdrop">
      <section className="policy-consent-modal" role="dialog" aria-modal="true" aria-labelledby="policy-consent-title">
        <header className="policy-consent-header">
          <div>
            <span className="eyebrow">{textFor(t, 'Policy update', '政策确认')}</span>
            <h2 id="policy-consent-title">{textFor(t, 'Review the policies required for this account', '请确认账号适用的必需政策')}</h2>
            <p>{textFor(t, 'Your consent record stores the exact versions shown here.', '同意记录会保存此处显示的精确版本。')}</p>
          </div>
          <span className="policy-draft-badge">
            <AlertTriangle size={15} />
            {textFor(t, 'Legal review pending', '待法务审查')}
          </span>
        </header>

        <div className="policy-consent-layout">
          <nav className="policy-consent-tabs" aria-label={textFor(t, 'Required policies', '必需政策')}>
            {status.requiredPolicies.map((policy) => (
              <button
                className={selectedPolicyId === policy.id ? 'active' : ''}
                type="button"
                key={policy.id}
                onClick={() => setSelectedPolicyId(policy.id)}
              >
                <span>{localizeText(policy.title, t)}</span>
                <small>{policy.version}</small>
              </button>
            ))}
          </nav>
          <article className="policy-consent-document">
            {!manifest && !error && (
              <div className="legal-loading"><LoaderCircle className="spin" size={20} /> {textFor(t, 'Loading current policy text', '正在加载当前政策文本')}</div>
            )}
            {selectedPolicy && (
              <>
                <h3>{localizeText(selectedPolicy.title, t)}</h3>
                <p className="legal-summary">{localizeText(selectedPolicy.summary, t)}</p>
                {selectedPolicy.sections.map((section) => (
                  <section key={section.id}>
                    <h4>{localizeText(section.title, t)}</h4>
                    {(isZh ? section.paragraphs.zh : section.paragraphs.en).map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                  </section>
                ))}
              </>
            )}
          </article>
        </div>

        {error && <div className="auth-error">{error}</div>}
        <footer className="policy-consent-footer">
          <label>
            <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
            <span>{textFor(t, 'I reviewed and accept all required policy versions listed above.', '我已阅读并同意上方列出的全部必需政策版本。')}</span>
          </label>
          <div className="button-row">
            <button className="ghost-button" type="button" onClick={() => openPage('support')}>
              {textFor(t, 'Privacy and support', '隐私与支持')}
            </button>
            <button className="ghost-button" type="button" onClick={() => void logout()}>
              {textFor(t, 'Sign out', '退出登录')}
            </button>
            <button className="primary-button" type="button" disabled={!accepted || !manifest || submitting} onClick={submitConsent}>
              <ShieldCheck size={17} />
              {submitting ? textFor(t, 'Recording...', '正在记录...') : textFor(t, 'Accept current versions', '同意当前版本')}
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}

const formatSessionTime = (value: string | null, isZh: boolean) => {
  if (!value) return isZh ? '未知' : 'Unknown'
  try {
    return new Intl.DateTimeFormat(isZh ? 'zh-CN' : 'en-US', {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value))
  } catch {
    return value
  }
}

const sessionStatusLabel = (session: ApiSession, isZh: boolean) => {
  if (session.reuseDetectedAt) return isZh ? '风险标记' : 'Risk flagged'
  if (session.active) return isZh ? '活跃' : 'Active'
  return isZh ? '已撤销' : 'Revoked'
}

export function SecurityModal({
  t,
  close,
  simulateAction,
}: {
  t: Record<string, string>
  close: () => void
  simulateAction: SimulateAction
}) {
  const isZh = isZhCopy(t)
  const [sessions, setSessions] = useState<ApiSession[]>([])
  const [oauthProviders, setOAuthProviders] = useState<OAuthProviderMetadata[]>(defaultOAuthProviders)
  const [oauthAccounts, setOAuthAccounts] = useState<OAuthAccountLink[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingOAuth, setLoadingOAuth] = useState(true)
  const [actingId, setActingId] = useState<string | null>(null)
  const [oauthActingProvider, setOauthActingProvider] = useState<OAuthProvider | null>(null)
  const [error, setError] = useState('')

  const loadSessions = useCallback(() => {
    setLoading(true)
    setError('')
    authService
      .listSessions()
      .then(setSessions)
      .catch((loadError) => {
        console.info('[security-sessions]', loadError)
        setError(textFor(t, 'Could not load sessions.', '无法加载会话'))
      })
      .finally(() => setLoading(false))
  }, [t])

  const loadOAuthAccounts = useCallback(() => {
    setLoadingOAuth(true)
    setError('')
    Promise.all([
      authService.listOAuthProviders(),
      authService.listOAuthAccounts(),
    ])
      .then(([providers, accounts]) => {
        if (providers.length > 0) {
          setOAuthProviders(providers.filter((provider) => provider.provider !== 'dev'))
        }
        setOAuthAccounts(accounts)
      })
      .catch((loadError) => {
        console.info('[oauth-accounts]', loadError)
        setError(textFor(t, 'Could not load linked accounts.', '无法加载已绑定账号'))
      })
      .finally(() => setLoadingOAuth(false))
  }, [t])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadSessions()
      loadOAuthAccounts()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadOAuthAccounts, loadSessions])

  const revokeSession = (id: string) => {
    setActingId(id)
    setError('')
    void authService
      .revokeSession(id)
      .then(() => {
        simulateAction(textFor(t, 'Session revoked', '会话已撤销'))
        loadSessions()
      })
      .catch((revokeError) => {
        console.info('[security-sessions]', revokeError)
        setError(textFor(t, 'Could not revoke this session.', '无法撤销该会话'))
      })
      .finally(() => setActingId(null))
  }

  const revokeAllSessions = () => {
    setActingId('all')
    setError('')
    void authService
      .revokeAllSessions()
      .then((result) => {
        simulateAction(
          isZh
            ? `已撤销 ${result.revoked} 个刷新会话`
            : `Revoked ${result.revoked} refresh sessions`,
        )
        loadSessions()
      })
      .catch((revokeError) => {
        console.info('[security-sessions]', revokeError)
        setError(textFor(t, 'Could not revoke sessions.', '无法撤销会话'))
      })
      .finally(() => setActingId(null))
  }

  const linkOAuthProvider = (provider: OAuthProviderMetadata) => {
    setOauthActingProvider(provider.provider)
    setError('')
    void authService
      .loginWithOAuthProvider(provider.provider, { redirectTo: '/profile', linkAccount: true })
      .then((session) => {
        if (!session) {
          simulateAction(isZh ? `正在跳转到 ${provider.label}` : `Redirecting to ${provider.label}`)
          return
        }
        simulateAction(isZh ? `已绑定 ${provider.label}` : `${provider.label} linked`)
        loadOAuthAccounts()
      })
      .catch((linkError) => {
        console.info('[oauth-link]', linkError)
        setError(oauthErrorCopy(linkError, t))
      })
      .finally(() => setOauthActingProvider(null))
  }

  const unlinkOAuthProvider = (provider: OAuthProviderMetadata) => {
    setOauthActingProvider(provider.provider)
    setError('')
    void authService
      .unlinkOAuthAccount(provider.provider)
      .then(() => {
        simulateAction(isZh ? `已解绑 ${provider.label}` : `${provider.label} unlinked`)
        loadOAuthAccounts()
      })
      .catch((unlinkError) => {
        console.info('[oauth-unlink]', unlinkError)
        setError(oauthErrorCopy(unlinkError, t))
      })
      .finally(() => setOauthActingProvider(null))
  }

  const linkedProviderIds = new Set(oauthAccounts.map((account) => account.provider))

  return (
    <div className="modal-backdrop" onClick={close}>
      <section className="security-modal" onClick={(event) => event.stopPropagation()}>
        <button className="close-button" type="button" onClick={close}>
          <X size={18} />
        </button>
        <div className="security-header">
          <span className="security-icon">
            <ShieldCheck size={19} />
          </span>
          <span>
            <h2>{textFor(t, 'Security sessions', '安全会话')}</h2>
            <p>{textFor(t, 'Manage refresh sessions for this account.', '管理此账号的刷新会话')}</p>
          </span>
        </div>

        <div className="security-note">
          <AlertTriangle size={16} />
          <span>
            {textFor(
              t,
              'Revoking a session blocks future token refresh. Existing short-lived access tokens expire automatically.',
              '撤销会话会阻止后续刷新；现有短效访问令牌会自动过期。',
            )}
          </span>
        </div>

        {error && <div className="auth-error">{error}</div>}

        <div className="oauth-link-panel" data-testid="oauth-link-panel">
          <div className="oauth-link-heading">
            <span>
              <strong>{textFor(t, 'Linked sign-in methods', '已绑定登录方式')}</strong>
              <small>{textFor(t, 'Connect providers for account recovery and faster sign-in.', '绑定第三方账号用于账号恢复和快速登录')}</small>
            </span>
            {loadingOAuth && <LoaderCircle size={16} />}
          </div>
          <div className="oauth-link-list">
            {oauthProviders.map((provider) => {
              const linkedAccount = oauthAccounts.find((account) => account.provider === provider.provider)
              const linked = linkedProviderIds.has(provider.provider)
              const acting = oauthActingProvider === provider.provider
              const status = oauthProviderStatus(provider, t)
              return (
                <article className={linked ? 'oauth-link-row linked' : 'oauth-link-row'} data-testid={`oauth-link-${provider.provider}`} key={provider.provider}>
                  <div className="oauth-link-main">
                    <Globe2 size={17} />
                    <span>
                      <strong>{provider.label}</strong>
                      <small>
                        {linked
                          ? textFor(t, `ID ${linkedAccount?.providerUserIdHint ?? ''}`, `身份 ${linkedAccount?.providerUserIdHint ?? ''}`)
                          : textFor(t, 'Not connected', '未绑定')}
                      </small>
                    </span>
                  </div>
                  <b className={status.className} title={status.title}>
                    {status.label}
                  </b>
                  <button
                    className={linked ? 'ghost-button small' : 'primary-button small'}
                    type="button"
                    disabled={acting || loadingOAuth}
                    onClick={() => {
                      if (linked) {
                        unlinkOAuthProvider(provider)
                      } else {
                        linkOAuthProvider(provider)
                      }
                    }}
                  >
                    {acting ? <LoaderCircle size={15} /> : linked ? <X size={15} /> : <ShieldCheck size={15} />}
                    {linked ? textFor(t, 'Unlink', '解绑') : textFor(t, 'Link', '绑定')}
                  </button>
                </article>
              )
            })}
          </div>
        </div>

        <div className="security-session-list" data-testid="security-session-list">
          {loading ? (
            <div className="security-loading">
              <LoaderCircle size={18} />
              {textFor(t, 'Loading sessions...', '正在加载会话...')}
            </div>
          ) : sessions.length === 0 ? (
            <div className="security-empty">{textFor(t, 'No refresh sessions found.', '暂无刷新会话')}</div>
          ) : (
            sessions.map((session) => (
              <article className={session.active ? 'security-session active' : 'security-session'} data-testid="security-session-card" key={session.id}>
                <div className="security-session-main">
                  <MonitorCheck size={17} />
                  <span>
                    <strong>{textFor(t, 'Refresh session', '刷新会话')}</strong>
                    <small>{session.id}</small>
                  </span>
                </div>
                <div className="security-session-meta">
                  <span className={session.reuseDetectedAt ? 'session-status risk' : session.active ? 'session-status active' : 'session-status'}>
                    {sessionStatusLabel(session, isZh)}
                  </span>
                  <span>{textFor(t, 'Created', '创建')} {formatSessionTime(session.createdAt, isZh)}</span>
                  <span>{textFor(t, 'Expires', '过期')} {formatSessionTime(session.expiresAt, isZh)}</span>
                </div>
                <button
                  className="ghost-button small"
                  data-testid={`revoke-session-${session.id}`}
                  type="button"
                  disabled={!session.active || actingId === session.id}
                  onClick={() => revokeSession(session.id)}
                >
                  {actingId === session.id ? <LoaderCircle size={15} /> : <X size={15} />}
                  {textFor(t, 'Revoke', '撤销')}
                </button>
              </article>
            ))
          )}
        </div>

        <div className="security-actions">
          <button className="ghost-button" type="button" onClick={loadSessions}>
            <RefreshCcw size={16} />
            {textFor(t, 'Refresh', '刷新')}
          </button>
          <button
            className="primary-button"
            data-testid="revoke-all-sessions"
            type="button"
            onClick={revokeAllSessions}
            disabled={actingId === 'all' || sessions.every((session) => !session.active)}
          >
            {actingId === 'all' ? <LoaderCircle size={16} /> : <ShieldCheck size={16} />}
            {textFor(t, 'Revoke all', '全部撤销')}
          </button>
        </div>
      </section>
    </div>
  )
}
