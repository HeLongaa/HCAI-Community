import { useState } from 'react'
import { BriefcaseBusiness, Heart, Play, Share2, Trophy, UserRound } from 'lucide-react'
import type { MarketplaceProfile, Page, SimulateAction, Task, Track } from '../../domain/types'
import { SectionHeader } from '../../components/ui/SectionHeader'
import { Comment } from '../community'
import { TrackRow } from '../explore'
import { MyTasksPage, StatusBadge } from '../tasks'
import { marketplaceProfiles, tracks } from '../../data/mockData'
import { categoryLabel, isZhCopy, localizeText, localizedTasks, pointText, profileTags, textFor } from '../../domain/utils'

export function PlaylistPage({
  t,
  playTrack,
  simulateAction,
}: {
  t: Record<string, string>
  playTrack: (track: Track) => void
  simulateAction: SimulateAction
}) {
  const isZh = isZhCopy(t)
  const [liked, setLiked] = useState(false)

  return (
    <div className="stack">
      <section className="playlist-header">
        <img src={tracks[0].cover} alt="" />
        <div>
          <span className="eyebrow">{t.playlists}</span>
          <h1>Top 100</h1>
          <p>{textFor(t, 'Discover the top tracks, covers, and creator-made AI songs across every mood.', '发现不同情绪下最受欢迎的曲目、翻唱和创作者 AI 歌曲。')}</p>
          <div className="button-row">
            <button className="primary-button" type="button" onClick={() => playTrack(tracks[0])}>
              <Play size={17} fill="currentColor" />
              {textFor(t, 'Play', '播放')}
            </button>
            <button
              className={liked ? 'ghost-button active' : 'ghost-button'}
              type="button"
              onClick={() => {
                setLiked((current) => !current)
                simulateAction(
                  liked
                    ? isZh
                      ? '已取消收藏播放列表 Top 100'
                      : 'Playlist removed from liked: Top 100'
                    : isZh
                      ? '已收藏播放列表 Top 100'
                      : 'Playlist liked: Top 100',
                )
              }}
            >
              <Heart size={17} />
              {liked ? '98.1K' : '98K'}
            </button>
          </div>
        </div>
      </section>
      <div className="panel">
        {tracks.map((track) => (
          <TrackRow key={track.id} t={t} track={track} playTrack={playTrack} />
        ))}
      </div>
    </div>
  )
}

export function ProfilePage({
  t,
  profile,
  personalProfileId,
  tasks,
  setPage,
  openProfile,
  submitTask,
  simulateAction,
}: {
  t: Record<string, string>
  profile: MarketplaceProfile
  personalProfileId: string
  tasks: Task[]
  setPage: (page: Page) => void
  openProfile: (profile: MarketplaceProfile) => void
  submitTask: (task: Task, options?: { assetIds?: string[]; rightsNote?: string }) => Promise<void>
  simulateAction: SimulateAction
}) {
  const isZh = isZhCopy(t)
  const isPersonalCenter = profile.id === personalProfileId
  const [activeTab, setActiveTab] = useState<'overview' | 'myTasks' | 'delivered' | 'reviews' | 'posted'>('overview')
  const tabs: { key: typeof activeTab; label: string }[] = [
    { key: 'overview', label: textFor(t, 'Overview', '概览') },
    ...(isPersonalCenter ? [{ key: 'myTasks' as const, label: t.mine }] : []),
    { key: 'delivered', label: textFor(t, 'Delivered work', '交付成果') },
    { key: 'reviews', label: textFor(t, 'Reviews', '评价') },
    { key: 'posted', label: textFor(t, 'Published briefs', '发布需求') },
  ]
  const activeTabLabel = tabs.find((item) => item.key === activeTab)?.label ?? tabs[0].label
  const tags = profileTags(profile, t)
  const profileTasks = localizedTasks(tasks, t).filter((task) => task.assignee === profile.handle || task.publisher === profile.handle)
  const deliveredTasks = profileTasks.filter((task) => task.assignee === profile.handle)
  const postedTasks = profileTasks.filter((task) => task.publisher === profile.handle)
  const relatedProfiles = marketplaceProfiles
    .filter((item) => item.id !== profile.id && item.categories.some((category) => profile.categories.includes(category)))
    .slice(0, 4)
  const displayedTasks =
    activeTab === 'posted' ? postedTasks : activeTab === 'delivered' ? deliveredTasks : profileTasks.slice(0, 4)
  return (
    <div className="stack">
      <section className="profile-shell">
        <aside className="profile-card public-profile-card">
          <div className="profile-cover" />
          <div className="profile-body">
            <div className="profile-avatar">{profile.initials}</div>
            <div className="profile-name">
              <strong>{localizeText(profile.name, t)}</strong>
              <span>@{profile.handle} · {localizeText(profile.role, t)}</span>
            </div>
            <p>{localizeText(profile.bio, t)}</p>
            <div className="profile-stats">
              <div className="profile-stat">
                <strong>{profile.stats.score}</strong>
                <span>{isZh ? '信誉分' : 'score'}</span>
              </div>
              <div className="profile-stat">
                <strong>{profile.stats.completed}</strong>
                <span>{isZh ? '已交付' : 'delivered'}</span>
              </div>
              <div className="profile-stat">
                <strong>{profile.stats.posted}</strong>
                <span>{isZh ? '已发布' : 'posted'}</span>
              </div>
            </div>
            <div className="skill-cloud">
              {tags.map((tag) => (
                <span className="tag" key={tag}>{tag}</span>
              ))}
            </div>
            <div className="quick-action-row">
            <button
              className="primary-button"
              type="button"
              onClick={() =>
                simulateAction(
                  isZh ? `已模拟关注 @${profile.handle}` : `Followed @${profile.handle} in the front-end mock`,
                    { description: `Followed profile: @${profile.handle}`, delta: '+1' },
                  )
                }
              >
                <UserRound size={17} />
                {t.follow}
              </button>
              <button
                className="ghost-button"
                type="button"
                onClick={() => setPage('points')}
              >
                <Trophy size={17} />
                {t.points}
              </button>
              <button
                className="ghost-button"
                type="button"
                onClick={() => simulateAction(isZh ? `已复制用户主页链接：@${profile.handle}` : `Profile link copied: @${profile.handle}`)}
              >
                <Share2 size={17} />
                {t.share}
              </button>
            </div>
          </div>
        </aside>
        <section className="public-panel">
          <div className="profile-hero-row">
            <div>
              <span className="eyebrow">{isPersonalCenter ? textFor(t, 'Personal center', '个人中心') : textFor(t, 'Public profile', '公开主页')}</span>
              <h1>{localizeText(profile.name, t)}</h1>
              <p>{localizeText(profile.bio, t)}</p>
            </div>
            <div className="profile-rank-card">
              <span>{textFor(t, 'Marketplace rank', '广场排名')}</span>
              <strong>{profile.stats.rank}</strong>
              <small>
                {textFor(t, 'Response', '响应')} {profile.stats.response} · {textFor(t, 'Acceptance', '通过率')} {profile.stats.acceptance}
              </small>
            </div>
          </div>
            <div className="profile-proof-grid">
            <article>
              <span>{textFor(t, 'Earned', '获得积分')}</span>
              <strong>{profile.stats.earned}</strong>
            </article>
            <article>
              <span>{textFor(t, 'Settled points', '结算积分')}</span>
              <strong>{pointText(profile.stats.paid)}</strong>
            </article>
            <article>
              <span>{textFor(t, 'Languages', '语言')}</span>
              <strong>{profile.languages.join(' / ')}</strong>
            </article>
            <article>
              <span>{textFor(t, 'Categories', '分类')}</span>
              <strong>{profile.categories.map((category) => categoryLabel(category, t)).join(' / ')}</strong>
            </article>
          </div>
          <div className="badge-row">
            {profile.badges.map((badge) => (
              <span className="pill small" key={badge.en}>{localizeText(badge, t)}</span>
            ))}
          </div>
        </section>
      </section>
      <div className="chip-row">
        {tabs.map((item) => (
          <button
            className={activeTab === item.key ? 'chip active' : 'chip'}
            type="button"
            key={item.key}
            onClick={() => {
              setActiveTab(item.key)
              simulateAction(isZh ? `已切换用户主页内容：${item.label}` : `Public profile tab changed: ${item.label}`)
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      {activeTab === 'myTasks' ? (
        <MyTasksPage t={t} tasks={tasks} setPage={setPage} accountHandle={profile.handle} submitTask={submitTask} simulateAction={simulateAction} />
      ) : (
      <div className="profile-layout-grid">
        <section className="panel">
          <SectionHeader
            eyebrow={textFor(t, 'Proof', '能力证明')}
            title={activeTabLabel}
            action={
              <button className="ghost-button" type="button" onClick={() => setPage('tasks')}>
                <BriefcaseBusiness size={17} />
                {textFor(t, 'Task Plaza', '任务广场')}
              </button>
            }
          />
          {activeTab === 'reviews' ? (
            <div className="review-list">
              {profile.reviews.map((review) => (
                <Comment author={profile.handle} text={localizeText(review, t)} key={review.en} />
              ))}
            </div>
          ) : (
            <div className="proof-list">
              {displayedTasks.length ? (
                displayedTasks.map((task) => (
                  <div className="proof-item task-proof-item" key={task.id}>
                    <StatusBadge status={task.status} t={t} />
                    <strong>{task.title}</strong>
                    <span>
                      {categoryLabel(task.category, t)} · {task.points} · @{task.publisher}
                    </span>
                  </div>
                ))
              ) : (
                profile.portfolio.map((item) => (
                  <div className="proof-item task-proof-item" key={item.en}>
                    <StatusBadge status="Completed" t={t} />
                    <strong>{localizeText(item, t)}</strong>
                    <span>{textFor(t, 'Portfolio item from public profile', '公开主页作品案例')}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </section>
        <aside className="panel">
          <SectionHeader eyebrow={textFor(t, 'Related users', '相关用户')} title={textFor(t, 'People to compare', '可对比用户')} />
          <div className="rank-list compact-list">
            {relatedProfiles.map((item) => (
              <button className="rank-row" type="button" key={item.id} onClick={() => openProfile(item)}>
                <span className="avatar compact">{item.initials}</span>
                <span className="rank-copy">
                  <strong>{localizeText(item.name, t)}</strong>
                  <small>@{item.handle} · {profileTags(item, t).slice(0, 2).join(' / ')}</small>
                </span>
                <span className="rank-metric">
                  <strong>{item.stats.score}</strong>
                  <small>{isZh ? '分' : 'score'}</small>
                </span>
              </button>
            ))}
          </div>
        </aside>
      </div>
      )}
    </div>
  )
}
