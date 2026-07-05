import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import {
  AlertTriangle,
  Bot,
  BriefcaseBusiness,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Flag,
  Globe2,
  Heart,
  ListPlus,
  ListMusic,
  LoaderCircle,
  MonitorCheck,
  MessageCircle,
  MoreHorizontal,
  Pause,
  PenLine,
  Play,
  RefreshCcw,
  Search,
  Share2,
  ShieldCheck,
  Shuffle,
  SkipBack,
  SkipForward,
  Star,
  Trophy,
  UserRound,
  UsersRound,
  Volume2,
  WandSparkles,
  X,
} from 'lucide-react'
import type { Locale, MarketplaceProfile, Page, SimulateAction, Track } from '../../domain/types'
import { marketplaceProfiles, tracks } from '../../data/mockData'
import { findProfile, isZhCopy, localizeText, textFor } from '../../domain/utils'
import { authService } from '../../services/authService'
import { isApiClientError } from '../../services/apiClient'
import type { ApiSession, OAuthAccountLink, OAuthProvider, OAuthProviderMetadata } from '../../services/contracts'
import { showLocalTestAccounts } from '../../services/runtimeConfig'
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
  playTrack,
  playing,
  setPlaying,
  requireAuth,
  simulateAction,
}: {
  t: Record<string, string>
  locale: Locale
  page: Page
  setPage: (page: Page) => void
  track: Track
  playTrack: (track: Track) => void
  playing: boolean
  setPlaying: (playing: boolean) => void
  requireAuth: () => void
  simulateAction: SimulateAction
}) {
  const [open, setOpen] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [query, setQuery] = useState('')
  const [shuffleOn, setShuffleOn] = useState(false)
  const [repeatOn, setRepeatOn] = useState(false)
  const [volume, setVolume] = useState(72)
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
  const trackIndex = tracks.findIndex((item) => item.id === track.id)
  const previousTrack = tracks[(trackIndex - 1 + tracks.length) % tracks.length] ?? tracks[0]
  const nextTrack = tracks[(trackIndex + 1) % tracks.length] ?? tracks[0]
  const currentLyricLine = track.lyrics[1] || track.lyrics[0] || track.prompt
  const runGuide = (raw: string) => {
    const value = raw.trim().toLowerCase()
    const action = value
      ? actions.find((item) => item.keys.some((key) => value.includes(key.toLowerCase()))) || primaryAction
      : primaryAction
    setPage(action.page)
    setOpen(false)
    setMoreOpen(false)
    simulateAction(
      isZh ? `灵动岛已跳转：${action.label}` : `Dynamic island routed: ${action.label}`,
      { description: `Dynamic island guide: ${action.label}`, delta: '+1' },
    )
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
          simulateAction(isZh ? 'AI 灵动岛已展开' : 'AI guide expanded')
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
          <button
            className={shuffleOn ? 'active' : ''}
            type="button"
            onClick={() => {
              setShuffleOn((current) => !current)
              simulateAction(shuffleOn ? (isZh ? '已关闭随机播放' : 'Shuffle disabled') : isZh ? '已开启随机播放' : 'Shuffle enabled')
            }}
            aria-label={isZh ? '随机播放' : 'Shuffle'}
          >
            <Shuffle size={17} />
          </button>
          <button type="button" onClick={() => playTrack(previousTrack)} aria-label={isZh ? '上一首' : 'Previous track'}>
            <SkipBack size={17} fill="currentColor" />
          </button>
          <button className="music-play-button" type="button" onClick={() => setPlaying(!playing)} aria-label={playing ? textFor(t, 'Pause', '暂停') : textFor(t, 'Play', '播放')}>
            {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
          </button>
          <button type="button" onClick={() => playTrack(nextTrack)} aria-label={isZh ? '下一首' : 'Next track'}>
            <SkipForward size={17} fill="currentColor" />
          </button>
          <button
            className={repeatOn ? 'active' : ''}
            type="button"
            onClick={() => {
              setRepeatOn((current) => !current)
              simulateAction(repeatOn ? (isZh ? '已关闭循环播放' : 'Repeat disabled') : isZh ? '已开启循环播放' : 'Repeat enabled')
            }}
            aria-label={isZh ? '循环播放' : 'Repeat'}
          >
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
            simulateAction(isZh ? 'AI 灵动岛已收起到右侧' : 'AI guide minimized to the right')
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
          <button type="button" onClick={() => simulateAction(isZh ? '已切换播放模式' : 'Playback mode toggled')} title={textFor(t, 'Playback mode', '播放模式')}>
            <RefreshCcw size={16} />
          </button>
          <label
            className="music-volume-control"
            style={{ '--volume-level': `${volume}%` } as CSSProperties}
            title={textFor(t, 'Volume', '音量')}
            aria-label={textFor(t, 'Volume', '音量')}
          >
            <Volume2 size={16} />
            <input
              type="range"
              min="0"
              max="100"
              value={volume}
              onInput={(event) => setVolume(Number(event.currentTarget.value))}
              onChange={(event) => setVolume(Number(event.currentTarget.value))}
              onMouseUp={(event) => {
                const value = Number(event.currentTarget.value)
                setVolume(value)
                simulateAction(isZh ? `音量 ${value}%` : `Volume ${value}%`)
              }}
              onTouchEnd={(event) => {
                const value = Number(event.currentTarget.value)
                setVolume(value)
                simulateAction(isZh ? `音量 ${value}%` : `Volume ${value}%`)
              }}
              aria-valuetext={`${volume}%`}
            />
          </label>
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
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMoreOpen(false)
                requireAuth()
              }}
            >
              <Download size={16} />
              <span>{textFor(t, 'Free download', '免费下载')}</span>
              <ChevronRight size={15} />
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMoreOpen(false)
                simulateAction(isZh ? '已添加到队列' : 'Added to queue')
              }}
            >
              <ListPlus size={16} />
              <span>{textFor(t, 'Add to queue', '添加到队列')}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMoreOpen(false)
                simulateAction(isZh ? '已复制歌曲链接' : 'Track link copied')
              }}
            >
              <Copy size={16} />
              <span>{textFor(t, 'Copy', '复制')}</span>
              <ChevronRight size={15} />
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMoreOpen(false)
                requireAuth()
              }}
            >
              <Flag size={16} />
              <span>{textFor(t, 'Report', '举报')}</span>
            </button>
          </div>
        )}
        <div className="music-share-row">
          <button type="button" onClick={requireAuth} title={textFor(t, 'Like', '喜欢')}>
            <Heart size={18} />
          </button>
          <button className="music-share-button" type="button" onClick={requireAuth} title={t.share}>
            <Share2 size={16} />
            <span>{t.share}</span>
          </button>
        </div>
      </div>
      <div className="island-expanded" onClick={(event) => event.stopPropagation()}>
        <div className="music-expanded-grid">
          <div className="music-comment-stream" aria-label={textFor(t, 'Comments', '评论')}>
            <button className="music-add-comment" type="button" onClick={requireAuth}>
              <span><UserRound size={22} /></span>
              <strong>{textFor(t, 'Add a comment...', '添加评论...')}</strong>
            </button>
            <div className="music-comment-list">
              <article>
                <img src={tracks[2]?.cover || track.cover} alt="" />
                <div>
                  <strong>Damienhartsfi...</strong>
                  <time>3h</time>
                  <p>{textFor(t, 'I like this song I like it', '我喜欢这首歌，真的喜欢')}</p>
                  <button type="button" onClick={requireAuth}><Heart size={16} /> {textFor(t, 'Reply', '回复')}</button>
                </div>
              </article>
              <article>
                <img src={tracks[3]?.cover || track.cover} alt="" />
                <div>
                  <strong>Rylaiflor</strong>
                  <time>3d</time>
                  <p>🎧☀️🕺</p>
                  <button type="button" onClick={requireAuth}><Heart size={16} /> {textFor(t, 'Reply', '回复')}</button>
                </div>
              </article>
              <article>
                <span className="comment-fallback-avatar"><UserRound size={21} /></span>
                <div>
                  <strong>Sitwsmusic</strong>
                  <time>1w</time>
                  <p>{textFor(t, 'The bassline is clean. This one belongs in the next playlist.', '贝斯线很干净，这首应该进下一轮歌单。')}</p>
                  <button type="button" onClick={requireAuth}><Heart size={16} /> {textFor(t, 'Reply', '回复')}</button>
                </div>
              </article>
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
  playTrack,
  setPage,
  openProfile,
  simulateAction,
}: {
  t: Record<string, string>
  close: () => void
  playTrack: (track: Track) => void
  setPage: (page: Page) => void
  openProfile: (profile: MarketplaceProfile) => void
  simulateAction: SimulateAction
}) {
  const isZh = isZhCopy(t)
  const [query, setQuery] = useState('')

  const results = useMemo(() => {
    if (!query.trim()) return tracks.slice(0, 3)
    return tracks.filter((track) => `${track.title} ${track.artist}`.toLowerCase().includes(query.toLowerCase())).concat(tracks.slice(0, 2))
  }, [query])

  return (
    <div className="search-backdrop" onClick={close}>
      <section className="search-panel" role="dialog" aria-modal="true" aria-label={t.search} onClick={(event) => event.stopPropagation()}>
        <div className="search-input">
          <Search size={18} />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.search} />
          <button type="button" onClick={close} aria-label="Close search">
            <X size={17} />
          </button>
        </div>
        <div className="search-results">
          <button
            type="button"
            className="search-result"
            onClick={() => {
              setPage('playlist')
              simulateAction(isZh ? '已打开搜索结果：Top 50 播放列表' : 'Search result opened: Top 50 playlist')
              close()
            }}
          >
            <ListMusic size={18} />
            <span>
              <strong>Top 50</strong>
              <small>@musicgpt · {textFor(t, 'Playlist', '播放列表')} · 50K {textFor(t, 'likes', '点赞')}</small>
            </span>
            <Star size={16} />
          </button>
          {results.map((track) => (
            <button
              type="button"
              className="search-result"
              key={track.id}
              onClick={() => {
                playTrack(track)
                simulateAction(isZh ? `已播放搜索结果：${track.title}` : `Search result played: ${track.title}`)
                close()
              }}
            >
              <img src={track.cover} alt="" />
              <span>
                <strong>{track.title}</strong>
                <small>
                  @{track.artist} · {track.plays} {textFor(t, 'plays', '播放')}
                </small>
              </span>
              <Download size={16} />
            </button>
          ))}
          <button
            type="button"
            className="search-result"
            onClick={() => {
              const profile = isZh ? findProfile('coursecn') ?? marketplaceProfiles[0] : findProfile('iriswood') ?? marketplaceProfiles[0]
              openProfile(profile)
              simulateAction(isZh ? `已打开搜索结果：${localizeText(profile.name, t)} 用户主页` : `Search result opened: ${localizeText(profile.name, t)} profile`)
              close()
            }}
          >
            <UserRound size={18} />
            <span>
              <strong>{isZh ? '中文课程组' : 'Iris Wood'}</strong>
              <small>@{isZh ? 'coursecn' : 'iriswood'} · {textFor(t, 'public profile', '公开主页')}</small>
            </span>
            <Star size={16} />
          </button>
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
    mode: 'dev',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    callbackMethod: 'GET',
    scopes: ['openid', 'email', 'profile'],
  },
  {
    provider: 'apple',
    label: 'Apple',
    configured: false,
    mode: 'dev',
    authorizationUrl: 'https://appleid.apple.com/auth/authorize',
    callbackMethod: 'POST',
    scopes: ['name', 'email'],
  },
  {
    provider: 'discord',
    label: 'Discord',
    configured: false,
    mode: 'dev',
    authorizationUrl: 'https://discord.com/oauth2/authorize',
    callbackMethod: 'GET',
    scopes: ['identify', 'email'],
  },
]

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
    OAUTH_FAILED: ['Provider verification failed. Try again or use email login.', '第三方验证失败，请重试或使用邮箱登录'],
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
  }
  const copy = messages[error.code]
  return copy ? textFor(t, copy[0], copy[1]) : textFor(t, error.message, error.message)
}

type AuthFieldErrors = Partial<Record<'email' | 'password' | 'handle', string>>

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
  simulateAction,
  loginAs,
  loginWithPassword,
  loginWithOAuthProvider,
  registerWithEmail,
  setPage,
}: {
  t: Record<string, string>
  close: () => void
  simulateAction: SimulateAction
  loginAs: (handle: string) => Promise<void>
  loginWithPassword: (email: string, password: string) => Promise<void>
  loginWithOAuthProvider: (provider: OAuthProvider) => Promise<OAuthLoginResult>
  registerWithEmail: (payload: { email: string; password: string; displayName?: string; handle?: string }) => Promise<void>
  setPage: (page: Page) => void
}) {
  const isZh = isZhCopy(t)
  const [providers, setProviders] = useState<OAuthProviderMetadata[]>(defaultOAuthProviders)
  const [selectedProvider, setSelectedProvider] = useState<OAuthProvider | ''>('')
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [handle, setHandle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({})
  const hasDevOAuthProviders = providers.some((provider) => provider.mode === 'dev' && !provider.configured)
  const hasExternalOAuthProviders = providers.some((provider) => provider.mode === 'external' && provider.configured)

  useEffect(() => {
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
  }, [])

  const getFieldErrors = (): AuthFieldErrors => {
    const next: AuthFieldErrors = {}
    const normalizedEmail = email.trim().toLowerCase()
    if (!emailPattern.test(normalizedEmail)) {
      next.email = textFor(t, 'Enter a valid email address.', '请输入有效邮箱地址。')
    }
    if (!password) {
      next.password = textFor(t, 'Enter your password.', '请输入密码。')
    } else if (mode === 'register' && (password.length < 8 || password.length > 128)) {
      next.password = textFor(t, 'Use 8-128 characters.', '请输入 8-128 个字符。')
    }
    if (mode === 'register' && handle.trim() && !handlePattern.test(handle.trim())) {
      next.handle = textFor(t, 'Use 3-32 letters, numbers, underscores, or hyphens.', '请使用 3-32 位字母、数字、下划线或连字符。')
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
    const action = mode === 'register'
      ? registerWithEmail({
          email,
          password,
          displayName: displayName || undefined,
          handle: handle || undefined,
        })
      : loginWithPassword(email, password)
    void action
      .then(() => {
        simulateAction(
          mode === 'register'
            ? textFor(t, 'Account created and session verified', '账号已创建并完成会话校验')
            : textFor(t, 'Signed in and session verified', '已登录并完成会话校验'),
        )
        close()
      })
      .catch((authError) => {
        console.info('[auth]', authError)
        setError(emailAuthErrorCopy(authError, mode, t))
        setFieldErrors(authFieldErrorsFromApi(authError, mode, t))
      })
      .finally(() => setSubmitting(false))
  }

  return (
    <div className="modal-backdrop" onClick={close}>
      <section className="login-modal" onClick={(event) => event.stopPropagation()}>
        <button className="close-button" type="button" onClick={close}>
          <X size={18} />
        </button>
        <h2>{textFor(t, 'Login or sign up', '登录或注册')}</h2>
        <div className="auth-mode-tabs" role="tablist" aria-label={textFor(t, 'Authentication mode', '认证模式')}>
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
        </div>
        <form className="auth-form" onSubmit={submitEmailAuth} noValidate>
          {mode === 'register' && (
            <>
              <input
                type="text"
                autoComplete="name"
                placeholder={textFor(t, 'Display name', '显示名称')}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
              <label className={fieldErrors.handle ? 'auth-field invalid' : 'auth-field'}>
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
                {fieldErrors.handle && <small id="auth-handle-error">{fieldErrors.handle}</small>}
              </label>
            </>
          )}
          <label className={fieldErrors.email ? 'auth-field invalid' : 'auth-field'}>
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
            {fieldErrors.email && <small id="auth-email-error">{fieldErrors.email}</small>}
          </label>
          <label className={fieldErrors.password ? 'auth-field invalid' : 'auth-field'}>
            <input
              type="password"
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              placeholder={textFor(t, 'Password', '密码')}
              value={password}
              aria-invalid={fieldErrors.password ? 'true' : 'false'}
              aria-describedby={fieldErrors.password ? 'auth-password-error' : undefined}
              onChange={(event) => {
                setPassword(event.target.value)
                clearFieldError('password')
              }}
            />
            {fieldErrors.password && <small id="auth-password-error">{fieldErrors.password}</small>}
          </label>
          {error && <div className="auth-error">{error}</div>}
          <button className="primary-button auth-submit" type="submit" disabled={submitting} onClick={() => undefined}>
            <UserRound size={17} />
            {submitting
              ? textFor(t, 'Submitting...', '提交中...')
              : mode === 'register'
                ? textFor(t, 'Create account', '创建账号')
                : textFor(t, 'Continue with email', '使用邮箱继续')}
          </button>
        </form>
        <div className="oauth-provider-list" aria-label={textFor(t, 'Social login providers', '第三方登录方式')}>
          <div className="oauth-config-status">
            <ShieldCheck size={15} />
            <span>
              {hasExternalOAuthProviders && !hasDevOAuthProviders
                ? textFor(t, 'External OAuth is configured for this environment.', '当前环境已配置外部 OAuth。')
                : textFor(t, 'Using local dev callbacks until external OAuth credentials are configured.', '当前使用本地开发回调；配置外部 OAuth 凭据后会切换。')}
            </span>
          </div>
          {providers.map((provider) => {
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
                    close()
                  }).catch((oauthError) => {
                    console.info('[oauth]', oauthError)
                    setError(oauthErrorCopy(oauthError, t))
                  }).finally(() => {
                    setSelectedProvider('')
                  })
                }}
              >
                <Globe2 size={18} />
                <span>{isZh ? `使用 ${provider.label} 继续` : `Continue with ${provider.label}`}</span>
                <b className={status.className} title={status.title}>
                  {status.label}
                </b>
              </button>
            )
          })}
        </div>
        {showLocalTestAccounts && (
          <button
            className="social-login"
            type="button"
            onClick={() => {
              void loginAs('opsplus').then(() => {
                setPage('admin')
                close()
                simulateAction(isZh ? '已使用本地测试管理员账号登录' : 'Signed in as local admin test account')
              })
            }}
          >
            <UsersRound size={18} />
            {textFor(t, 'Local admin test login', '本地测试管理员登录')}
          </button>
        )}
        <p>
          {textFor(t, 'By continuing, you agree to our', '继续即表示你同意')} {t.terms} {textFor(t, 'and', '和')} {t.privacy}.
        </p>
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
