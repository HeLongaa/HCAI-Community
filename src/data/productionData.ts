import type { InspirationItem, LedgerEntry, MarketplaceProfile, Post, Task, Track, Work } from '../domain/types'

const unavailableTrack = (id: number): Track => ({
  id,
  title: 'Catalog unavailable',
  artist: 'Unavailable',
  plays: '—',
  duration: '00:00',
  cover: '',
  prompt: 'This catalog is unavailable until an approved application data source is configured.',
  lyrics: [],
})

export const tracks: Track[] = [1, 2, 3, 4].map(unavailableTrack)
export const radioStations = [{ title: 'Radio unavailable', description: 'No approved production radio catalog is configured.', color: 'gray' }]
export const visualWorks: Work[] = [
  { id: 'unavailable-image', title: 'Image catalog unavailable', maker: 'System', type: 'Image', image: '', likes: '—', views: '—', prompt: 'No approved production catalog is configured.' } as unknown as Work,
  { id: 'unavailable-video', title: 'Video catalog unavailable', maker: 'System', type: 'Video', image: '', likes: '—', views: '—', prompt: 'No approved production catalog is configured.' } as unknown as Work,
]
export const marketplaceProfiles: MarketplaceProfile[] = [{
  handle: 'unavailable', name: 'Profile unavailable', avatar: '', bio: 'No approved profile data source is available.',
  role: 'contributor', tier: 'Free', points: 0, followers: '0', following: '0', works: 0, tags: [], badges: [], portfolio: [],
} as unknown as MarketplaceProfile]
export const tasks: Task[] = [{
  id: 'unavailable', title: 'Task marketplace unavailable', description: 'The task API is unavailable. No local task data is shown.',
  category: 'Unavailable', status: 'Open', publisher: 'system', assignee: '', points: 0, deadline: '—', proposals: 0,
  requirements: [], attachments: [], resultLinks: [], rights: '', submission: '', reviewNote: '', createdAt: '',
} as unknown as Task]
export const posts: Post[] = [{
  id: 'unavailable', title: 'Community unavailable', body: 'The community API is unavailable. No local posts are shown.',
  author: 'system', category: 'Unavailable', likes: '0', replies: 0, views: '0', votes: 0, solved: false, createdAt: '', tags: [],
} as unknown as Post]
export const inspirationItems: InspirationItem[] = [{
  id: 'unavailable', title: 'Library unavailable', description: 'No approved library data source is available.', type: 'Unavailable', image: '',
} as unknown as InspirationItem]
export const pointsLedger: LedgerEntry[] = [{ id: 'unavailable', description: 'Points API unavailable', delta: '—', time: '—' } as unknown as LedgerEntry]
export const adminQueues = [['Unavailable', 'Admin queue unavailable', 'System', 'The Admin API did not return queue data.']] as const
export const planCards = [{ name: 'Unavailable', price: '—', description: 'No approved production pricing catalog is configured.', features: [] }]
export const apiFeatures = [{ title: 'API catalog unavailable', body: 'No approved production API catalog is configured.' }]
