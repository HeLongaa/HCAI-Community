export type Locale = 'en' | 'zh'
export type Role = 'member' | 'contributor' | 'moderator' | 'admin'
export type Page =
  | 'home'
  | 'playground'
  | 'chat'
  | 'explore'
  | 'tasks'
  | 'publish'
  | 'mine'
  | 'community'
  | 'inspiration'
  | 'points'
  | 'admin'
  | 'pricing'
  | 'api'
  | 'earn'
  | 'about'
  | 'playlist'
  | 'profile'
  | 'terms'
  | 'privacy'
export type CommunityView = 'list' | 'detail'
export type PlaygroundMode = 'music' | 'image' | 'video' | 'chat'
export type ThemeMode = 'black' | 'white'
export type NavigateOptions = {
  resetReturn?: boolean
  returnTo?: Page | null
}

export type Track = {
  id: number
  title: string
  artist: string
  plays: string
  duration: string
  cover: string
  prompt: string
  lyrics: string[]
}

export type Work = {
  title: string
  creator: string
  type: 'Image' | 'Video'
  views: string
  image: string
}

export type Task = {
  id: number
  title: string
  category: string
  budget: string
  points: string
  status: string
  deadline: string
  proposals: number
  description: string
  publisher: string
  assignee: string
  requirements: string[]
  attachments: string[]
  privateBrief: string
  submission: string
  resultLinks: string[]
  reviewNote: string
  rights: string
}

export type Post = {
  id: number
  title: string
  category: string
  author: string
  replies: number
  likes: string
  views: string
  votes: number
  tag: string
  solved: boolean
  excerpt: string
  body?: string
}

export type InspirationItem = {
  title: string
  type: string
  source: string
  saves: string
  text: string
}

export type LedgerEntry = [string, string, string, string]

export type PublishDraft = {
  title: string
  category: string
  reward: string
  deadline: string
  visibility: string
  details: string
  rules: string
}

export type LocalizedText = {
  en: string
  zh: string
}

export type MarketplaceProfile = {
  id: string
  handle: string
  initials: string
  lane: 'maker' | 'publisher' | 'both'
  name: LocalizedText
  role: LocalizedText
  bio: LocalizedText
  tags: string[]
  zhTags: string[]
  categories: string[]
  languages: string[]
  stats: {
    score: number
    completed: number
    posted: number
    response: string
    acceptance: string
    earned: string
    paid: string
    rank: string
  }
  badges: LocalizedText[]
  portfolio: LocalizedText[]
  reviews: LocalizedText[]
}

export type SimulateAction = (message: string, ledger?: { description: string; delta: string }) => void
