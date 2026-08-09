import { Image, ListMusic, Play } from 'lucide-react'
import type { Page, Track } from '../../domain/types'
import { SectionHeader } from '../../components/ui/SectionHeader'
import { textFor } from '../../domain/utils'

export function ExplorePage({
  t,
  setPage,
}: {
  t: Record<string, string>
  playTrack: (track: Track) => void
  setPage: (page: Page) => void
  requireAuth: () => void
}) {
  return (
    <div className="stack">
      <SectionHeader eyebrow={textFor(t, 'Discover', '发现')} title={textFor(t, 'Public creative catalog', '公开创作目录')} />
      <div className="empty-state">
        <Image size={28} />
        <strong>{textFor(t, 'No public works yet', '暂无公开作品')}</strong>
        <span>{textFor(t, 'Only governed, explicitly published works will appear here.', '这里只展示经过治理并明确公开发布的作品。')}</span>
        <button className="primary-button" type="button" onClick={() => setPage('playground')}>
          {textFor(t, 'Open AI Workspace', '进入 AI 工作台')}
        </button>
      </div>
    </div>
  )
}

export function ExplorePreview({
  t,
  setPage,
}: {
  t: Record<string, string>
  playTrack: (track: Track) => void
  setPage: (page: Page) => void
  requireAuth?: () => void
}) {
  return (
    <section className="stack">
      <SectionHeader title={textFor(t, 'Published media', '已发布媒体')} />
      <div className="empty-state compact">
        <ListMusic size={24} />
        <strong>{textFor(t, 'The public media catalog is empty', '公开媒体目录为空')}</strong>
        <button className="ghost-button" type="button" onClick={() => setPage('assets')}>
          {textFor(t, 'Open your assets', '查看我的资产')}
        </button>
      </div>
    </section>
  )
}

export function TrackRow({ track, playTrack }: { track: Track; playTrack: (track: Track) => void }) {
  return (
    <div className="track-row">
      <button type="button" disabled={!track.audioUrl} onClick={() => playTrack(track)}>
        {track.cover && <img src={track.cover} alt="" />}
        <Play size={14} fill="currentColor" />
      </button>
      <div>
        <strong>{track.title}</strong>
        <span>{track.artist}</span>
      </div>
      <span>{track.duration}</span>
    </div>
  )
}
