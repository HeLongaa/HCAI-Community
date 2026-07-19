export type Locale = 'en' | 'zh'
export type Role = 'member' | 'contributor' | 'creator' | 'publisher' | 'moderator' | 'admin'
export type Permission =
  | 'task:create'
  | 'task:cancel'
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
  | 'entitlements:read'
  | 'developer:credentials:manage'
  | 'developer:webhooks:manage'
  | 'admin:access'
  | 'admin:audit:read'
  | 'admin:audit:export'
  | 'admin:audit:verify'
  | 'admin:audit:archive'
  | 'admin:audit:retention'
  | 'admin:observability:read'
  | 'admin:observability:export'
  | 'admin:observability:manage'
  | 'admin:queue:read'
  | 'admin:queue:review'
  | 'admin:trust:read'
  | 'admin:trust:review'
  | 'admin:trust:export'
  | 'admin:trust:operate'
  | 'admin:trust:rules'
  | 'admin:tasks:read'
  | 'admin:tasks:manage'
  | 'admin:community:read'
  | 'admin:community:manage'
  | 'admin:community:export'
  | 'admin:task-rules:read'
  | 'admin:task-rules:manage'
  | 'admin:task-rules:publish'
  | 'admin:media:read'
  | 'admin:media:manage'
  | 'admin:media:export'
  | 'admin:accounting:read'
  | 'admin:accounting:scan'
  | 'admin:accounting:repair'
  | 'admin:entitlements:read'
  | 'admin:entitlements:manage'
  | 'admin:entitlements:transition'
  | 'admin:permissions:manage'
  | 'admin:auth:read'
  | 'admin:auth:manage'
  | 'admin:users:read'
  | 'admin:users:manage'
  | 'admin:notifications:read'
  | 'admin:notifications:manage'
  | 'admin:notifications:publish'
  | 'admin:developer:read'
  | 'admin:developer:manage'
  | 'admin:webhooks:read'
  | 'admin:webhooks:manage'
  | 'admin:support:read'
  | 'admin:search:read'
  | 'admin:search:manage'
  | 'admin:support:manage'
  | 'admin:creative:cancel'
  | 'admin:creative:retry'
  | 'admin:creative:replay'
  | 'admin:creative:provider-control:read'
  | 'admin:creative:provider-control:manage'
  | 'admin:creative:provider-control:recover'
  | 'admin:model-control:read'
  | 'admin:model-control:manage'
  | 'admin:model-control:transition'
  | 'admin:model-evaluations:read'
  | 'admin:model-evaluations:manage'
  | 'admin:model-evaluations:execute'
  | 'admin:provider-legal:read'
  | 'admin:provider-legal:manage'
  | 'security:alerts:manage'
  | 'admin:releases:read'
  | 'admin:releases:manage'
  | 'admin:releases:approve'
  | 'admin:releases:deploy'
  | 'admin:settings:read'
  | 'admin:settings:manage'
  | 'admin:settings:approve'
  | 'admin:settings:publish'
  | 'admin:feature-flags:read'
  | 'admin:feature-flags:manage'
  | 'admin:feature-flags:publish'
  | 'admin:feature-flags:emergency'
  | 'admin:reference-data:read'
  | 'admin:reference-data:manage'
  | 'admin:reference-data:publish'
  | 'admin:announcements:read'
  | 'admin:announcements:manage'
  | 'admin:announcements:publish'
export type Page =
  | 'home'
  | 'playground'
  | 'generations'
  | 'assets'
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
  tab?: 'Overview' | 'Observability' | 'Settings' | 'Notifications' | 'Task review' | 'Access' | 'Security' | 'Finance' | 'Accounting' | 'Generations' | 'Submissions' | 'Community' | 'Audit log' | 'Users' | 'Tags' | 'AI config'
  overviewResourceType?: string | null
  overviewResourceId?: string | null
  queue?: string | null
  reviewId?: string | null
  auditEventId?: string | null
  ledgerUserHandle?: string | null
  policyHistoryEventId?: string | null
  securityAlertId?: string | null
  observabilityAlertId?: string | null
  mediaStatus?: 'pending' | 'scanning' | 'review' | 'clean' | 'rejected' | 'all' | null
  mediaAssetId?: string | null
}

export type NotificationDeepLink = {
  page: Page
  workspace?: PlaygroundMode
  admin?: AdminDeepLink
  target?: import('./notificationTargets').NotificationTargetV1
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
  version?: number
  cancelledAt?: string | null
  expiredAt?: string | null
  terminalReasonCode?: string | null
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
  status?: 'draft' | 'published' | 'deleted'
  version?: number
  createdAt?: string | null
  updatedAt?: string | null
  publishedAt?: string | null
  deletedAt?: string | null
  moderationState?: 'visible' | 'hidden'
  moderationVersion?: number
  moderationUpdatedAt?: string | null
  comments?: CommunityComment[]
}

export type CommunityComment = {
  id: string
  body: string
  author: string
  parentId: string | null
  moderationState: 'visible' | 'hidden'
  moderationVersion: number
  moderationUpdatedAt: string | null
  createdAt: string
}

export type CommunityPostDraft = {
  title: string
  body: string
  category: string
  tag: string
  excerpt: string
}

export type InspirationItem = {
  id?: string | number
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
  acceptanceTemplateId?: string | null
}

export type LocalizedText = {
  en: string
  zh: string
}

export type PortfolioDisplayItem = LocalizedText | {
  id: string
  assetId: string
  title: string
  caption: string
  status: 'draft' | 'published' | 'withdrawn' | 'archived'
  asset: { fileName: string; contentType: string } | null
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
  portfolio: PortfolioDisplayItem[]
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
  diff?: {
    source: 'previous_next' | 'before_after' | 'explicit'
    changes?: Array<{ path: string; before: unknown; after: unknown }>
    value?: unknown
  } | null
  createdAt: string
  integrity: {
    sequence: string
    previousHash: string | null
    contentHash: string
    chainVersion: number
  } | null
}
