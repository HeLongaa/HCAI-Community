import { type MouseEvent, type PointerEvent } from 'react'
import {
  BriefcaseBusiness,
  Check,
  MessageCircle,
  PenLine,
  Plus,
  Radio,
} from 'lucide-react'
import type {
  Page,
  Track,
} from '../../domain/types'
import type { DataSourceState } from '../layout/viewModels'
import { copy } from '../../i18n/copy'
import { SectionHeader } from '../ui/SectionHeader'
import { StatusBadge } from '../../features/tasks'
import { ExplorePreview } from '../../features/explore'
import {
  posts,
  tasks,
} from '../../data/mockData'
import {
  categoryLabel,
  hasCjk,
  isZhCopy,
  localizedPosts,
  localizedTasks,
  statusLabel,
  textFor,
} from '../../domain/utils'

export function CompassIcon(props: { size: number }) {
  return <Radio size={props.size} />
}

export function HomePage({
  t,
  setPage,
  playTrack,
  dataSources,
}: {
  t: Record<string, string>
  setPage: (page: Page) => void
  playTrack: (track: Track) => void
  dataSources: DataSourceState[]
}) {
  const moveHeroGlow = (event: MouseEvent<HTMLElement> | PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    event.currentTarget.style.setProperty('--mx', `${((event.clientX - rect.left) / rect.width) * 100}%`)
    event.currentTarget.style.setProperty('--my', `${((event.clientY - rect.top) / rect.height) * 100}%`)
  }
  const isZh = isZhCopy(t)
  const featuredTask = isZh ? tasks.find((task) => hasCjk(task.title)) ?? tasks[0] : tasks[0]

  return (
    <div className="stack">
      <section className="hero-section interactive-hero" onPointerMove={moveHeroGlow} onMouseMove={moveHeroGlow}>
        <div className="hero-fx" aria-hidden="true">
          <span className="fx-orbit orbit-a" />
          <span className="fx-orbit orbit-b" />
          <span className="fx-node node-a" />
          <span className="fx-node node-b" />
          <span className="fx-node node-c" />
        </div>
        <div className="hero-copy">
          <span className="pill">
            <BriefcaseBusiness size={16} />
            {textFor(t, 'AI Work Marketplace', 'AI 任务协作平台')}
          </span>
          <h1>{t.heroTitle}</h1>
          <p>{t.heroText}</p>
          <div className="button-row">
            <button className="primary-button large" type="button" onClick={() => setPage('tasks')}>
              <BriefcaseBusiness size={18} />
              {t.startCreating}
            </button>
            <button className="ghost-button large" type="button" onClick={() => setPage('publish')}>
              <PenLine size={18} />
              {t.publish}
            </button>
            <button className="ghost-button large" type="button" onClick={() => setPage('community')}>
              <MessageCircle size={18} />
              {t.community}
            </button>
          </div>
        </div>
        <div className="hero-market-card">
          <div className="market-card-top">
            <span className="status-badge open">{statusLabel(featuredTask.status, t)}</span>
            <strong>{featuredTask.points}</strong>
          </div>
          <div>
            <span className="eyebrow">{textFor(t, 'Featured task', '精选任务')}</span>
            <h3>{featuredTask.title}</h3>
            <p>{featuredTask.description}</p>
          </div>
          <div className="market-metrics">
            <span>{featuredTask.proposals} {textFor(t, 'proposals', '个提案')}</span>
            <span>{featuredTask.deadline}</span>
            <span>{categoryLabel(featuredTask.category, t)}</span>
          </div>
          <div className="button-row">
            <button className="primary-button" type="button" onClick={() => setPage('tasks')}>
              {textFor(t, 'View task', '查看任务')}
            </button>
            <button className="ghost-button" type="button" onClick={() => setPage('community')}>
              {textFor(t, 'Discuss', '去社区讨论')}
            </button>
          </div>
        </div>
      </section>

      <div className="feature-strip">
        {(isZh
          ? ['发布 AI 需求', '接取付费任务', '展示交付作品', '讨论提示词']
          : ['Post AI requests', 'Accept paid tasks', 'Showcase work', 'Discuss prompts']
        ).map((item) => (
          <span key={item}>
            <Check size={17} />
            {item}
          </span>
        ))}
      </div>

      <section className="data-source-panel" aria-label={textFor(t, 'Current data sources', '当前数据来源')}>
        <div>
          <span className="eyebrow">{textFor(t, 'Runtime state', '运行状态')}</span>
          <strong>{textFor(t, 'What is live API vs demo?', '哪些是 API，哪些是演示？')}</strong>
        </div>
        <div className="data-source-list">
          {dataSources.map((source) => (
            <span className={`data-source-chip ${source.state}`} key={source.label} title={source.detail}>
              <b>{source.label}</b>
              {source.detail}
            </span>
          ))}
        </div>
      </section>

      <DashboardOverview t={t} setPage={setPage} />
      <MarketplaceOverview t={t} setPage={setPage} />
      <CommunityOverview t={t} setPage={setPage} />
      <ExplorePreview t={t} playTrack={playTrack} setPage={setPage} />
    </div>
  )
}

function DashboardOverview({
  t,
  setPage,
}: {
  t: Record<string, string>
  setPage: (page: Page) => void
}) {
  const cards = isZhCopy(t)
    ? [
        ['发布需求', '把粗略想法整理成有奖励、周期、附件和验收标准的 AI 任务。', 'publish' as Page],
        ['我的任务台', '跟踪已接取任务、提交交付物、回复验收意见并沉淀履历。', 'mine' as Page],
      ]
    : [
        ['Publish request', 'Turn a rough idea into a scoped AI task with reward, deadline, attachments, and acceptance rules.', 'publish' as Page],
        ['My task desk', 'Track claimed work, submit deliverables, answer review notes, and build contribution history.', 'mine' as Page],
      ]

  return (
    <section>
      <SectionHeader eyebrow={textFor(t, 'Workspace', '工作台')} title={t.dashboardTitle} />
      <div className="core-grid">
        {cards.map(([title, text, target]) => (
          <button className="core-action-card" data-testid={`home-action-${target}`} type="button" key={title} onClick={() => setPage(target as Page)}>
            <span className="pill small">
              {isZhCopy(t) ? copy.zh[target as keyof typeof copy.zh] ?? target : copy.en[target as keyof typeof copy.en] ?? target}
            </span>
            <span className="core-action-indicator" aria-hidden="true" />
            <strong>{title}</strong>
            <p>{text}</p>
          </button>
        ))}
      </div>
    </section>
  )
}

function MarketplaceOverview({
  t,
  setPage,
}: {
  t: Record<string, string>
  setPage: (page: Page) => void
}) {
  const previewTasks = localizedTasks(tasks, t).slice(0, 3)
  return (
    <section>
      <SectionHeader
        eyebrow={textFor(t, 'Core', '核心')}
        title={t.tasksTitle}
        action={
          <button className="primary-button" type="button" onClick={() => setPage('tasks')}>
            <Plus size={17} />
            {t.postTask}
          </button>
        }
      />
      <div className="core-grid">
        {previewTasks.map((task) => (
          <article className="core-task-card" key={task.id}>
            <div className="market-card-top">
              <StatusBadge status={task.status} t={t} />
              <strong>{task.budget}</strong>
            </div>
            <h3>{task.title}</h3>
            <p>{task.description}</p>
            <div className="market-metrics">
              <span>{categoryLabel(task.category, t)}</span>
              <span>{task.deadline}</span>
              <span>{task.proposals} {textFor(t, 'proposals', '个提案')}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function CommunityOverview({
  t,
  setPage,
}: {
  t: Record<string, string>
  setPage: (page: Page) => void
}) {
  const previewPosts = localizedPosts(posts, t)
  return (
    <section>
      <SectionHeader
        eyebrow={textFor(t, 'Core', '核心')}
        title={t.communityTitle}
        action={
          <button className="ghost-button" type="button" onClick={() => setPage('community')}>
            <MessageCircle size={17} />
            {t.community}
          </button>
        }
      />
      <div className="core-grid community-core">
        {previewPosts.map((post) => (
          <article className="core-post-card" key={post.id}>
            <span className="pill small">{post.tag}</span>
            <h3>{post.title}</h3>
            <p>{post.excerpt}</p>
            <span>
              @{post.author} · {post.replies} {textFor(t, 'replies', '条回复')} · {post.likes} {textFor(t, 'likes', '点赞')}
            </span>
          </article>
        ))}
      </div>
    </section>
  )
}
