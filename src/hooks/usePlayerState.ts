import { useEffect, useRef, useState } from 'react'
import type { Track } from '../domain/types'
import { tracks } from '../data/mockData'

export function usePlayerState() {
  const [activeTrack, setActiveTrack] = useState<Track>(tracks[0])
  const [playing, setPlaying] = useState(false)
  const audio = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    audio.current?.pause()
    audio.current = activeTrack.audioUrl ? new Audio(activeTrack.audioUrl) : null
    const current = audio.current
    const finish = () => setPlaying(false)
    current?.addEventListener('ended', finish)
    return () => {
      current?.pause()
      current?.removeEventListener('ended', finish)
    }
  }, [activeTrack.audioUrl])

  useEffect(() => {
    const current = audio.current
    if (!current) return
    if (playing) void current.play().catch(() => setPlaying(false))
    else current.pause()
  }, [playing, activeTrack.audioUrl])

  const updatePlaying = (next: boolean | ((current: boolean) => boolean)) => {
    setPlaying((current) => {
      const requested = typeof next === 'function' ? next(current) : next
      return Boolean(activeTrack.audioUrl) && requested
    })
  }

  const playTrack = (track: Track) => {
    setActiveTrack(track)
    setPlaying(Boolean(track.audioUrl))
  }

  return {
    activeTrack,
    playing,
    setPlaying: updatePlaying,
    playTrack,
  }
}
