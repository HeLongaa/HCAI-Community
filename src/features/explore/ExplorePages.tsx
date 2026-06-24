import { useState } from 'react'
import { Check, Download, Heart, ListMusic, MoreHorizontal, Play } from 'lucide-react'
import type { Page, Track } from '../../domain/types'
import { SectionHeader } from '../../components/ui/SectionHeader'
import { radioStations, tracks, visualWorks } from '../../data/mockData'
import { mediaTypeLabel, textFor } from '../../domain/utils'

export function ExplorePage({
  t,
  playTrack,
  setPage,
  requireAuth,
}: {
  t: Record<string, string>
  playTrack: (track: Track) => void
  setPage: (page: Page) => void
  requireAuth: () => void
}) {
  return (
    <div className="stack">
      <SectionHeader eyebrow={textFor(t, 'Live discovery', '实时发现')} title={t.radio} />
      <RadioCarousel t={t} playTrack={playTrack} />
      <div className="feature-strip compact">
        {[t.unlimitedStreaming, t.freeDownloads, t.noCopyright, t.royaltyFree].map((item) => (
          <span key={item}>
            <Check size={16} />
            {item}
          </span>
        ))}
      </div>
      <ExplorePreview t={t} playTrack={playTrack} setPage={setPage} requireAuth={requireAuth} />
    </div>
  )
}

export function ExplorePreview({
  t,
  playTrack,
  setPage,
  requireAuth,
}: {
  t: Record<string, string>
  playTrack: (track: Track) => void
  setPage: (page: Page) => void
  requireAuth?: () => void
}) {
  const [mediaFilter, setMediaFilter] = useState<'all' | 'Image' | 'Video'>('all')
  const filteredVisualWorks =
    mediaFilter === 'all' ? visualWorks : visualWorks.filter((work) => work.type === mediaFilter)

  return (
    <div className="stack">
      <section>
        <SectionHeader title={t.trending} action={<button className="ghost-button" type="button" onClick={() => setPage('playlist')}>{t.playlists}</button>} />
        <div className="track-grid">
          {tracks.map((track) => (
            <TrackCard key={track.id} t={t} track={track} playTrack={playTrack} setPage={setPage} requireAuth={requireAuth} />
          ))}
        </div>
      </section>
      <section>
        <SectionHeader
          title={textFor(t, 'Trending images & videos', '热门图片与视频')}
          action={
            <div className="media-filter-row" role="tablist" aria-label={textFor(t, 'Trending media filter', '热门媒体分类')}>
              {[
                ['all', textFor(t, 'All', '全部')],
                ['Image', textFor(t, 'Images', '图片')],
                ['Video', textFor(t, 'Videos', '视频')],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={mediaFilter === key ? 'chip active' : 'chip'}
                  onClick={() => setMediaFilter(key as 'all' | 'Image' | 'Video')}
                >
                  {label}
                </button>
              ))}
            </div>
          }
        />
        <div className="visual-grid small">
          {filteredVisualWorks.map((work) => (
            <article className="visual-card" key={work.title}>
              <img src={work.image} alt="" />
              <div>
                <strong>{work.title}</strong>
                <span>
                  {mediaTypeLabel(work.type, t)} · {work.creator} · {work.views} {textFor(t, 'views', '浏览')}
                </span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

function RadioCarousel({ t, playTrack }: { t: Record<string, string>; playTrack: (track: Track) => void }) {
  return (
    <div className="radio-row">
      {radioStations.map((station, index) => (
        <article className="radio-card" key={station.title}>
          <img src={station.image} alt="" />
          <button type="button" onClick={() => playTrack(tracks[index % tracks.length])}>
            <Play size={17} fill="currentColor" />
            {textFor(t, 'Live', '直播')}
          </button>
          <div>
            <strong>{station.title}</strong>
            <span>
              {station.host} · {station.listeners} {textFor(t, 'listening', '人在听')}
            </span>
          </div>
        </article>
      ))}
    </div>
  )
}

function TrackCard({
  t,
  track,
  playTrack,
  setPage,
  requireAuth,
}: {
  t: Record<string, string>
  track: Track
  playTrack: (track: Track) => void
  setPage: (page: Page) => void
  requireAuth?: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <article className="track-card">
      <button className="track-play" type="button" onClick={() => playTrack(track)}>
        <img src={track.cover} alt="" />
        <span>
          <Play size={18} fill="currentColor" />
        </span>
      </button>
      <div className="track-meta">
        <button type="button" onClick={() => playTrack(track)}>
          {track.title}
        </button>
        <span>
          <button type="button" onClick={() => setPage('profile')}>
            {track.artist}
          </button>
          · {track.plays} {textFor(t, 'plays', '播放')}
        </span>
      </div>
      <div className="more-wrap">
        <button className="icon-button small" type="button" onClick={() => setMenuOpen((open) => !open)}>
          <MoreHorizontal size={17} />
        </button>
        {menuOpen && (
          <div className="floating-menu">
            <button type="button" onClick={() => playTrack(track)}>
              <Play size={15} />
              {textFor(t, 'Play', '播放')}
            </button>
            <button type="button" onClick={requireAuth}>
              <Heart size={15} />
              {textFor(t, 'Like', '喜欢')}
            </button>
            <button type="button" onClick={requireAuth}>
              <Download size={15} />
              {textFor(t, 'Download', '下载')}
            </button>
            <button type="button" onClick={requireAuth}>
              <ListMusic size={15} />
              {textFor(t, 'Add to playlist', '加入播放列表')}
            </button>
          </div>
        )}
      </div>
    </article>
  )
}

export function TrackRow({ t, track, playTrack }: { t: Record<string, string>; track: Track; playTrack: (track: Track) => void }) {
  return (
    <div className="track-row">
      <button type="button" onClick={() => playTrack(track)}>
        <img src={track.cover} alt="" />
        <Play size={14} fill="currentColor" />
      </button>
      <div>
        <strong>{track.title}</strong>
        <span>
          {track.artist} · {track.plays} {textFor(t, 'plays', '播放')}
        </span>
      </div>
      <span>{track.duration}</span>
    </div>
  )
}
