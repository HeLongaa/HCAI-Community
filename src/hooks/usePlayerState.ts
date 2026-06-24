import { useState } from 'react'
import type { Track } from '../domain/types'
import { tracks } from '../data/mockData'

export function usePlayerState() {
  const [activeTrack, setActiveTrack] = useState<Track>(tracks[0])
  const [playing, setPlaying] = useState(false)

  const playTrack = (track: Track) => {
    setActiveTrack(track)
    setPlaying(true)
  }

  return {
    activeTrack,
    playing,
    setPlaying,
    playTrack,
  }
}
