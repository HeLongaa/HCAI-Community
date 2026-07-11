export type Locale = 'en' | 'zh'
export type Role = 'member' | 'contributor' | 'creator' | 'publisher' | 'moderator' | 'admin'
export type Permission =
  | 'task:create'
  | 'task:propose'
  | 'task:claim'
  | 'task:submit'
  | 'task:review'
  | 'task:moderate'
  | 'post:create'
  | 'post:moderate'
  | 'comment:create'
  | 'points:read'
  | 'points:adjust'
  | 'admin:access'
  | 'admin:audit:read'
  | 'admin:queue:read'
  | 'admin:queue:review'
  | 'admin:permissions:manage'
  | 'admin:creative:cancel'
  | 'admin:creative:retry'
  | 'admin:creative:replay'
  | 'admin:creative:provider-control:read'
  | 'admin:creative:provider-control:manage'
  | 'admin:creative:provider-control:recover'
  | 'security:alerts:manage'
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
  | 'aup'
  | 'disclosures'
  | 'support'
export type CommunityView = 'list' | 'detail'
export type PlaygroundMode = 'music' | 'image' | 'video' | 'chat'
export type ThemeMode = 'black' | 'white'
export type NavigateOptions = {
  resetReturn?: boolean
  returnTo?: Page | null
}

export type AdminDeepLink = {
  tab?: 'Task review' | 'Access' | 'Security' | 'Finance' | 'Generations' | 'Submissions' | 'Community' | 'Audit log' | 'Users' | 'Tags' | 'AI config'
  queue?: string | null
  reviewId?: string | null
  auditEventId?: string | null
  ledgerUserHandle?: string | null
  policyHistoryEventId?: string | null
  securityAlertId?: string | null
  mediaStatus?: 'pending' | 'scanning' | 'review' | 'clean' | 'rejected' | 'all' | null
  mediaAssetId?: string | null
}

export type NotificationDeepLink = {
  page: Page
  admin?: AdminDeepLink
}

export type AsyncResourceState = {
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
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
  id: string | number
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
  id: string | number
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
  attachmentIds?: string[]
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

export type AuditEvent = {
  id: string
  actorType: 'user' | 'system'
  actorId: string | null
  action: string
  resourceType: string
  resourceId: string | null
  metadata: unknown
  createdAt: string
}
