import type { AdminDeepLink, NotificationDeepLink, Page, PlaygroundMode } from './types'

export type NotificationSurface = 'generations' | 'image' | 'video' | 'music' | 'chat' | 'tasks' | 'portfolio' | 'admin' | 'points' | 'assets' | 'community' | 'support'
export type NotificationTargetV1 = {
  version: 1
  surface: NotificationSurface
  intent: 'view' | 'resume' | 'review' | 'retry' | 'resolve-budget' | 'view-delivery'
  fallbackSurface: NotificationSurface
  workspace?: PlaygroundMode
  generationId?: string
  taskId?: string
  submissionId?: string
  reviewId?: string
  assetId?: string
  caseId?: string
  postId?: string
  commentId?: string
  admin?: AdminDeepLink
}

const surfaces = new Set<NotificationSurface>(['generations', 'image', 'video', 'music', 'chat', 'tasks', 'portfolio', 'admin', 'points', 'assets', 'community', 'support'])
const intents = new Set<NotificationTargetV1['intent']>(['view', 'resume', 'review', 'retry', 'resolve-budget', 'view-delivery'])
const workspaces = new Set<PlaygroundMode>(['image', 'video', 'music', 'chat'])
const adminTabs = new Set<NonNullable<AdminDeepLink['tab']>>(['Overview', 'Task review', 'Access', 'Security', 'Finance', 'Accounting', 'Generations', 'Submissions', 'Community', 'Audit log', 'Users', 'Tags', 'AI config'])
const mediaStatuses = new Set<NonNullable<AdminDeepLink['mediaStatus']>>(['pending', 'scanning', 'review', 'clean', 'rejected', 'all'])
const safeId = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 160 ? value : undefined

const parseAdminTarget = (value: unknown): AdminDeepLink | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const result: AdminDeepLink = {}
  if (adminTabs.has(source.tab as NonNullable<AdminDeepLink['tab']>)) result.tab = source.tab as NonNullable<AdminDeepLink['tab']>
  for (const key of ['overviewResourceType', 'overviewResourceId', 'queue', 'reviewId', 'auditEventId', 'ledgerUserHandle', 'policyHistoryEventId', 'securityAlertId', 'mediaAssetId'] as const) {
    const normalized = safeId(source[key])
    if (normalized) result[key] = normalized
  }
  if (mediaStatuses.has(source.mediaStatus as NonNullable<AdminDeepLink['mediaStatus']>)) result.mediaStatus = source.mediaStatus as NonNullable<AdminDeepLink['mediaStatus']>
  return Object.keys(result).length > 0 ? result : undefined
}

export const parseNotificationTarget = (value: unknown): NotificationTargetV1 | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  if (source.version !== 1 || !surfaces.has(source.surface as NotificationSurface)) return null
  const surface = source.surface as NotificationSurface
  const target: NotificationTargetV1 = {
    version: 1,
    surface,
    intent: intents.has(source.intent as NotificationTargetV1['intent']) ? source.intent as NotificationTargetV1['intent'] : 'view',
    fallbackSurface: surfaces.has(source.fallbackSurface as NotificationSurface) ? source.fallbackSurface as NotificationSurface : surface,
  }
  if (workspaces.has(source.workspace as PlaygroundMode)) target.workspace = source.workspace as PlaygroundMode
  for (const key of ['generationId', 'taskId', 'submissionId', 'reviewId', 'assetId', 'caseId', 'postId', 'commentId'] as const) {
    const id = safeId(source[key])
    if (id) target[key] = id
  }
  if (surface === 'admin') target.admin = parseAdminTarget(source.admin)
  return target
}

const pageForSurface = (surface: NotificationSurface): { page: Page; workspace?: PlaygroundMode } => {
  if (workspaces.has(surface as PlaygroundMode)) return { page: 'playground', workspace: surface as PlaygroundMode }
  if (surface === 'tasks') return { page: 'mine' }
  if (surface === 'portfolio') return { page: 'profile' }
  return { page: surface as Page }
}

export const notificationDeepLink = (target: NotificationTargetV1): NotificationDeepLink => ({ ...pageForSurface(target.surface), admin: target.admin, target })

export const notificationTargetHash = (target: NotificationTargetV1) => {
  if (target.surface === 'generations' && target.generationId) return `#generations/${encodeURIComponent(target.generationId)}`
  if (target.surface === 'assets' && target.assetId) return `#assets/${encodeURIComponent(target.assetId)}`
  const { page, workspace } = pageForSurface(target.surface)
  const params = new URLSearchParams()
  if (workspace) params.set('workspace', workspace)
  for (const key of ['taskId', 'submissionId', 'reviewId', 'assetId', 'caseId', 'postId', 'commentId'] as const) if (target[key]) params.set(key, target[key] as string)
  if (target.surface === 'admin' && target.admin) {
    for (const key of ['tab', 'overviewResourceType', 'overviewResourceId', 'queue', 'reviewId', 'auditEventId', 'ledgerUserHandle', 'policyHistoryEventId', 'securityAlertId', 'mediaAssetId', 'mediaStatus'] as const) {
      const value = target.admin[key]
      if (value) params.set(key, value)
    }
  }
  params.set('intent', target.intent)
  return `#${page}?${params.toString()}`
}

export const adminDeepLinkFromHash = (): AdminDeepLink | null => {
  if (typeof window === 'undefined' || !window.location.hash.startsWith('#admin?')) return null
  const params = new URLSearchParams(window.location.hash.split('?')[1])
  return parseAdminTarget(Object.fromEntries(params)) ?? null
}
