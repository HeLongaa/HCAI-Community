import { useState } from 'react'
import {
  ArrowRight,
  Bot,
  BriefcaseBusiness,
  Clock3,
  FolderOpen,
  Image,
  ListChecks,
  MessageCircle,
  Music2,
  Plus,
  Sparkles,
  Video,
} from 'lucide-react'
import type { Page, PlaygroundMode, Post, Task } from '../../domain/types'
import { categoryLabel, localizedPosts, localizedTasks, textFor } from '../../domain/utils'
import type { ApiUserCreativeGeneration } from '../../services/contracts'
import { MediaLoadFallback } from '../ui/MediaLoadFallback'

type HomePageProps = {
  t: Record<string, string>
  setPage: (page: Page) => void
  openWorkspace: (mode: PlaygroundMode) => void
  tasks: Task[]
  posts: Post[]
  accountHandle: string | null
  accountName: string
  generationCount: number
  reusableAssetCount: number
  latestGeneration: ApiUserCreativeGeneration | null
  latestImageUrl: string | null
}

const normalizedStatus = (value: string) => value.trim().toLowerCase().replaceAll(' ', '_')

const canPreviewImage = (url: string | null) => Boolean(url && /^(https?:|blob:|data:image\/)/i.test(url))

const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] || ''

export function HomePage({
  t,
  setPage,
  openWorkspace,
  tasks,
  posts,
  accountHandle,
  accountName,
  generationCount,
  reusableAssetCount,
  latestGeneration,
  latestImageUrl,
}: HomePageProps) {
  const localizedTaskList = localizedTasks(tasks, t)
  const openTasks = localizedTaskList
    .filter((task) => normalizedStatus(task.status) === 'open')
    .slice(0, 2)
  const recentPosts = localizedPosts(posts, t).slice(0, 2)
  const myTasks = accountHandle
    ? localizedTaskList.filter((task) => task.publisher === accountHandle || task.assignee === accountHandle)
    : []
  const latestOutput = latestGeneration?.outputs[0] ?? null
  const latestPrompt = latestGeneration?.promptPreview?.trim() || textFor(t, 'Untitled image generation', '未命名图片创作')
  const latestStatus = latestGeneration?.status ?? 'ready'
  const isNewWorkspace = generationCount === 0 && reusableAssetCount === 0 && myTasks.length === 0
  const displayName = firstName(accountName) || firstName(accountHandle) || textFor(t, 'there', '你好')
  const heroImageUrl = canPreviewImage(latestImageUrl) ? latestImageUrl ?? '' : '/showcase/home-cinematic.jpg'
  const heroIsSample = !canPreviewImage(latestImageUrl)
  const [failedHeroUrl, setFailedHeroUrl] = useState<string | null>(null)
  const heroMediaFailed = failedHeroUrl === heroImageUrl
  const studios: Array<{ mode: PlaygroundMode; label: string; description: string; icon: typeof Image }> = [
    { mode: 'image', label: textFor(t, 'Image', '图片'), description: textFor(t, 'Generate, edit, and create variations', '生成、编辑和制作变体'), icon: Image },
    { mode: 'video', label: textFor(t, 'Video', '视频'), description: textFor(t, 'Turn prompts and images into motion', '将提示词和图片转成视频'), icon: Video },
    { mode: 'music', label: textFor(t, 'Music', '音乐'), description: textFor(t, 'Create tracks from a structured brief', '根据创作需求生成音乐'), icon: Music2 },
    { mode: 'chat', label: textFor(t, 'Assistant', '助手'), description: textFor(t, 'Shape ideas, prompts, and production plans', '整理想法、提示词和制作方案'), icon: Bot },
  ]
  const statusItems = [
    { label: textFor(t, 'Generations', '生成记录'), value: generationCount, icon: Clock3, page: 'generations' as Page },
    { label: textFor(t, 'Assets', '可复用资产'), value: reusableAssetCount, icon: FolderOpen, page: 'assets' as Page },
    { label: textFor(t, 'My tasks', '我的任务'), value: myTasks.length, icon: ListChecks, page: 'mine' as Page },
  ]
  const formattedTime = latestGeneration?.createdAt
    ? new Intl.DateTimeFormat(textFor(t, 'en-US', 'zh-CN'), { month: 'short', day: 'numeric' }).format(new Date(latestGeneration.createdAt))
    : null

  return (
    <div className="home-workbench">
      <header className="home-welcome">
        <div>
          <span className="home-welcome-kicker"><Sparkles size={14} />{textFor(t, 'Creative workspace', '创作空间')}</span>
          <h1>{textFor(t, `Welcome back, ${displayName}.`, `欢迎回来，${displayName}。`)}</h1>
          <p>{textFor(t, 'Make the next frame, image, track, or idea.', '开始下一个画面、视频、音乐或想法。')}</p>
        </div>
        <div className="home-header-actions" aria-label={textFor(t, 'Quick actions', '快捷操作')}>
          <button type="button" onClick={() => setPage('tasks')}>
            <BriefcaseBusiness size={17} />
            <span><strong>{textFor(t, 'Tasks', '发布 / 接任务')}</strong><small>{textFor(t, 'Post or find work', '进入任务广场')}</small></span>
          </button>
          <button type="button" onClick={() => setPage('community')}>
            <MessageCircle size={17} />
            <span><strong>{textFor(t, 'Community', '社区')}</strong><small>{textFor(t, 'Discuss and share', '讨论与分享')}</small></span>
          </button>
          <button className="primary" type="button" onClick={() => openWorkspace('image')}>
            <Plus size={17} />
            <span><strong>{textFor(t, 'Create', '创作')}</strong><small>{textFor(t, 'Open studio', '进入创作台')}</small></span>
          </button>
        </div>
      </header>

      <section className="home-studio-workbench" aria-label={textFor(t, 'Creative workspace', '创作工作台')}>
        <article className={`home-recent-work ${latestGeneration ? 'has-work' : 'is-empty'}`}>
          <div className="home-hero-media">
            {heroMediaFailed ? (
              <MediaLoadFallback
                title={textFor(t, 'Preview unavailable', '预览暂不可用')}
                detail={textFor(t, 'The studio is still available while this image reloads.', '图片恢复期间仍可继续进入工作台创作。')}
                testId="home-media-fallback"
              />
            ) : (
              <img onError={() => setFailedHeroUrl(heroImageUrl)} src={heroImageUrl} alt={latestGeneration ? latestPrompt : textFor(t, 'Cinematic architecture study in red light', '红色光影中的建筑视觉习作')} />
            )}
            <div className="home-hero-shade" />
            <div className="home-hero-copy">
              <span className={`home-work-status status-${normalizedStatus(latestStatus)}`}>
                {heroIsSample ? textFor(t, 'Studio sample / not your asset', '工作台示例 / 非你的资产') : latestStatus.replaceAll('_', ' ')}
              </span>
              <h2>{latestGeneration ? latestPrompt : textFor(t, 'Turn an idea into a world.', '把一个想法，变成一个世界。')}</h2>
              <p>{latestGeneration
                ? [formattedTime, latestOutput?.fileName].filter(Boolean).join(' / ')
                : textFor(t, 'Begin with a prompt, a reference image, or a single frame.', '从一句提示词、一张参考图，或一个镜头开始。')}</p>
            </div>
          </div>
          <div className="home-hero-actions">
            <div>
              <span>{latestGeneration ? textFor(t, 'Recent work', '最近创作') : textFor(t, 'Image studio', '图片工作台')}</span>
              <small>{latestGeneration ? textFor(t, 'Continue from your latest result', '从最近结果继续') : textFor(t, 'Generate, edit, and explore variations', '生成、编辑并探索变体')}</small>
            </div>
            <button type="button" onClick={() => openWorkspace('image')}>
              {latestGeneration ? textFor(t, 'Continue', '继续') : textFor(t, 'Create image', '创作图片')}<ArrowRight size={16} />
            </button>
          </div>
        </article>

        <aside className="home-studio-directory">
          <div>
            <span>{textFor(t, 'CREATE WITH AI', '使用 AI 创作')}</span>
            <h2>{textFor(t, 'Studios', '工作台')}</h2>
            <p>{textFor(t, 'One workspace, four ways to make.', '一个空间，四种创作方式。')}</p>
          </div>
          <div className="home-studio-list">
            {studios.map((studio) => {
              const Icon = studio.icon
              return (
                <button type="button" data-workspace={studio.mode} key={studio.mode} onClick={() => openWorkspace(studio.mode)}>
                  <Icon size={18} />
                  <span><strong>{studio.label}</strong><small>{studio.description}</small></span>
                  <ArrowRight size={15} />
                </button>
              )
            })}
          </div>
        </aside>
      </section>

      <nav className="home-status-strip" aria-label={textFor(t, 'Workspace summary', '工作状态')}>
        {statusItems.map((item) => {
          const Icon = item.icon
          return (
            <button data-testid={item.page === 'mine' ? 'home-action-mine' : undefined} type="button" key={item.page} onClick={() => setPage(item.page)}>
              <Icon size={17} />
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </button>
          )
        })}
        {isNewWorkspace && <span className="home-new-note">{textFor(t, 'Your workspace is ready.', '你的工作区已经准备好了。')}</span>}
      </nav>

      <section className="home-collaboration">
        <header>
          <div>
            <h2>{textFor(t, 'Work with the community', '参与协作')}</h2>
            <p>{textFor(t, 'Open requests and recent conversations, kept out of your main creative flow.', '开放需求和近期讨论，不打断主要创作流程。')}</p>
          </div>
        </header>

        <div className="home-collaboration-grid">
          <div className="home-compact-feed">
            <header><h3>{textFor(t, 'Open tasks', '开放任务')}</h3><button type="button" onClick={() => setPage('tasks')}>{textFor(t, 'All tasks', '全部任务')}<ArrowRight size={14} /></button></header>
            <div>
              {openTasks.map((task) => (
                <button type="button" key={task.id} onClick={() => setPage('tasks')}>
                  <span><strong>{task.title}</strong><small>{categoryLabel(task.category, t)} / {task.deadline}</small></span>
                  <b>{task.points}</b>
                </button>
              ))}
              {openTasks.length === 0 && <div className="home-feed-empty"><BriefcaseBusiness size={19} /><strong>{textFor(t, 'No open tasks', '暂无开放任务')}</strong><span>{textFor(t, 'New requests will appear here.', '新的需求会显示在这里。')}</span></div>}
            </div>
          </div>

          <div className="home-compact-feed community-feed">
            <header><h3>{textFor(t, 'Recent conversations', '近期讨论')}</h3><button type="button" onClick={() => setPage('community')}>{textFor(t, 'Community', '社区')}<ArrowRight size={14} /></button></header>
            <div>
              {recentPosts.map((post) => (
                <button type="button" key={post.id} onClick={() => setPage('community')}>
                  <span><strong>{post.title}</strong><small>@{post.author} / {post.replies} {textFor(t, 'replies', '条回复')}</small></span>
                  <MessageCircle size={16} />
                </button>
              ))}
              {recentPosts.length === 0 && <div className="home-feed-empty"><MessageCircle size={19} /><strong>{textFor(t, 'No conversations yet', '暂无讨论')}</strong><span>{textFor(t, 'Start a useful topic when you are ready.', '准备好后可以发起一个话题。')}</span></div>}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
