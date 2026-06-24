import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import {
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
  MessageCircle,
  MoreHorizontal,
  Pause,
  PenLine,
  Play,
  RefreshCcw,
  Search,
  Share2,
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
import type { Locale, MarketplaceProfile, Page, Role, SimulateAction, Track } from '../../domain/types'
import { marketplaceProfiles, tracks } from '../../data/mockData'
import { findProfile, isZhCopy, localizeText, textFor } from '../../domain/utils'

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

export function LoginModal({
  t,
  close,
  simulateAction,
  setUserRole,
  setPage,
}: {
  t: Record<string, string>
  close: () => void
  simulateAction: SimulateAction
  setUserRole: (role: Role) => void
  setPage: (page: Page) => void
}) {
  const isZh = isZhCopy(t)
  const providers = isZh ? ['微信登录', '手机号登录', '邮箱登录', 'Google', 'Apple'] : ['Google', 'Apple', 'Discord', 'Facebook', 'Email']
  const [selectedProvider, setSelectedProvider] = useState('')

  return (
    <div className="modal-backdrop" onClick={close}>
      <section className="login-modal" onClick={(event) => event.stopPropagation()}>
        <button className="close-button" type="button" onClick={close}>
          <X size={18} />
        </button>
        <h2>{textFor(t, 'Login or sign up', '登录或注册')}</h2>
        {providers.map((provider) => (
          <button
            className={selectedProvider === provider ? 'social-login active' : 'social-login'}
            type="button"
            key={provider}
            onClick={() => {
              setSelectedProvider(provider)
              simulateAction(isZh ? `已选择登录方式：${provider}，当前为前端模拟登录` : `Login method selected: ${provider}. This is a front-end mock.`)
            }}
          >
            <Globe2 size={18} />
            {isZh ? `使用 ${provider} 继续` : `Continue with ${provider}`}
          </button>
        ))}
        <button
          className="social-login"
          type="button"
          onClick={() => {
            setUserRole('admin')
            setPage('admin')
            close()
            simulateAction(isZh ? '已使用管理员演示账号登录' : 'Signed in as admin demo account')
          }}
        >
          <UsersRound size={18} />
          {textFor(t, 'Admin demo login', '管理员演示登录')}
        </button>
        <p>
          {textFor(t, 'By continuing, you agree to our', '继续即表示你同意')} {t.terms} {textFor(t, 'and', '和')} {t.privacy}.
        </p>
      </section>
    </div>
  )
}
