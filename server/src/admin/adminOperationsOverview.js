import { hasPermission } from '../auth/permissions.js'

export const adminGlobalSearchTypes = Object.freeze([
  'task',
  'profile',
  'admin_review',
  'audit_event',
  'security_event',
  'security_alert',
  'accounting_issue',
  'domain_event',
  'event_inbox',
  'job_run',
  'media_asset',
  'creative_generation',
])

const text = (value, fallback = '') => String(value ?? fallback).trim().slice(0, 160)
const pageItems = (page) => Array.isArray(page?.items) ? page.items : Array.isArray(page) ? page : []
const includesQuery = (query, values) => values.some((value) => text(value).toLowerCase().includes(query))
const statusOf = (item, nestedKey = null) => text(nestedKey ? item?.[nestedKey]?.status : item?.status, '') || null
const timestampOf = (item) => item?.occurredAt ?? item?.receivedAt ?? item?.detectedAt ?? item?.updatedAt ?? item?.createdAt ?? null

const result = (type, item, title, subtitle, status = statusOf(item)) => ({
  type,
  id: text(item?.id),
  title: text(title, item?.id),
  subtitle: text(subtitle),
  status: status ? text(status) : null,
  timestamp: timestampOf(item),
  target: {
    page: 'admin',
    tab: 'Overview',
    resourceType: type,
    resourceId: text(item?.id),
  },
})

const registry = [
  {
    type: 'task',
    permission: 'admin:access',
    load: (repositories, query, limit) => repositories.tasks.list({ search: query, limit }),
    matches: (item, query) => includesQuery(query, [item.id, item.title, item.category, item.status]),
    project: (item) => result('task', item, item.title, `${item.category ?? 'Task'} · ${item.publisher ?? 'unassigned'}`),
  },
  {
    type: 'profile',
    permission: 'admin:access',
    load: (repositories, query, limit) => repositories.profiles.list({ search: query, limit }),
    matches: (item, query) => includesQuery(query, [item.id, item.handle, item.displayName, item.lane]),
    project: (item) => result('profile', { ...item, id: item.handle }, `@${item.handle}`, item.lane ?? 'Profile', null),
  },
  {
    type: 'admin_review',
    permission: 'admin:queue:read',
    load: (repositories, _query, limit) => repositories.adminReviews.list({ limit }),
    matches: (item, query) => includesQuery(query, [item.id, item.title, item.queue, item.owner, item.status]),
    project: (item) => result('admin_review', item, item.title, `${item.queue ?? 'review'} · ${item.owner ?? 'unassigned'}`),
  },
  {
    type: 'audit_event',
    permission: 'admin:audit:read',
    load: (repositories, _query, limit) => repositories.audit.list({ limit }),
    matches: (item, query) => includesQuery(query, [item.id, item.action, item.resourceType, item.resourceId, item.actorId]),
    project: (item) => result('audit_event', item, item.action, `${item.resourceType ?? 'resource'} · ${item.resourceId ?? item.id}`, item.outcome),
  },
  {
    type: 'security_event',
    permission: 'admin:audit:read',
    load: (repositories, _query, limit) => repositories.securityEvents.list({ limit }),
    matches: (item, query) => includesQuery(query, [item.id, item.type, item.source, item.severity]),
    project: (item) => result('security_event', item, item.type, `${item.source ?? 'security'} · ${item.severity ?? 'unknown'}`, item.severity),
  },
  {
    type: 'security_alert',
    permission: 'admin:audit:read',
    load: (repositories) => repositories.securityEvents.listAlerts(),
    matches: (item, query) => includesQuery(query, [item.id, item.type, item.title, item.source, item.severity, item.state]),
    project: (item) => result('security_alert', item, item.title ?? item.type, `${item.source ?? 'security'} · ${item.severity ?? 'unknown'}`, item.state),
  },
  {
    type: 'accounting_issue',
    permission: 'admin:accounting:read',
    load: (repositories, _query, limit) => repositories.accountingReconciliation.list({ limit }),
    matches: (item, query) => includesQuery(query, [item.id, item.issueKey, item.type, item.unit, item.sourceType, item.status]),
    project: (item) => result('accounting_issue', item, item.type, `${item.unit ?? 'accounting'} · ${item.sourceType ?? 'unknown'}`),
  },
  {
    type: 'domain_event',
    permission: 'admin:events:read',
    load: (repositories, _query, limit) => repositories.domainEvents.list({ limit }),
    matches: (item, query) => includesQuery(query, [item.id, item.eventType, item.type, item.aggregateType, item.aggregateId, item.publication?.status]),
    project: (item) => result('domain_event', item, item.eventType ?? item.type, `${item.aggregateType ?? 'aggregate'} · ${item.aggregateId ?? item.id}`, statusOf(item, 'publication')),
  },
  {
    type: 'event_inbox',
    permission: 'admin:events:read',
    load: (repositories, _query, limit) => repositories.domainEventConsumers.list({ limit }),
    matches: (item, query) => includesQuery(query, [item.id, item.consumerKey, item.eventType, item.aggregateType, item.aggregateId, item.consumption?.status]),
    project: (item) => result('event_inbox', item, item.consumerKey, `${item.eventType ?? 'event'} · ${item.aggregateType ?? 'aggregate'}`, statusOf(item, 'consumption')),
  },
  {
    type: 'job_run',
    permission: 'admin:jobs:read',
    load: (repositories, _query, limit) => repositories.jobs.list({ limit }),
    matches: (item, query) => includesQuery(query, [item.id, item.definitionId, item.status, item.correlationId]),
    project: (item) => result('job_run', item, item.definitionId ?? 'Job run', item.id),
  },
  {
    type: 'media_asset',
    permission: 'admin:queue:read',
    load: (repositories, query, limit) => repositories.media.listReviewQueue({ search: query, limit }),
    matches: (item, query) => includesQuery(query, [item.id, item.fileName, item.purpose, item.contentType, item.status, item.metadata?.security?.scanStatus]),
    project: (item) => result('media_asset', item, item.fileName, `${item.purpose ?? 'media'} · ${item.contentType ?? 'unknown'}`, item.metadata?.security?.scanStatus ?? item.status),
  },
  {
    type: 'creative_generation',
    permission: 'admin:audit:read',
    load: (repositories, _query, limit) => repositories.creativeGenerations.list({ limit }),
    matches: (item, query) => includesQuery(query, [item.id, item.workspace, item.status, item.providerId, item.userHandle]),
    project: (item) => result('creative_generation', item, `${item.workspace ?? 'Creative'} generation`, item.id),
  },
]

const safeLoad = async (loader) => {
  try {
    return pageItems(await loader())
  } catch {
    return []
  }
}

export const searchAdminOperations = async ({ repositories, actor, query, types = adminGlobalSearchTypes, limit = 20, cursor = null }) => {
  const normalizedQuery = text(query).toLowerCase()
  const allowedTypes = new Set(types)
  const descriptors = registry.filter(({ type, permission }) => allowedTypes.has(type) && hasPermission(actor, permission))
  const perTypeLimit = 100
  const groups = await Promise.all(descriptors.map(async (descriptor) => {
    const items = await safeLoad(() => descriptor.load(repositories, normalizedQuery, perTypeLimit))
    return items.filter((item) => descriptor.matches(item, normalizedQuery)).map(descriptor.project)
  }))
  const sorted = groups.flat().filter((item) => item.id).sort((left, right) => {
    const leftExact = left.id.toLowerCase() === normalizedQuery ? 1 : 0
    const rightExact = right.id.toLowerCase() === normalizedQuery ? 1 : 0
    return rightExact - leftExact || String(right.timestamp ?? '').localeCompare(String(left.timestamp ?? '')) || left.title.localeCompare(right.title)
  })
  const cursorIndex = cursor ? sorted.findIndex((item) => `${item.type}:${item.id}` === cursor) : -1
  const remaining = cursor ? (cursorIndex >= 0 ? sorted.slice(cursorIndex + 1) : []) : sorted
  const items = remaining.slice(0, limit)
  return {
    items,
    nextCursor: remaining.length > limit && items.length > 0 ? `${items.at(-1).type}:${items.at(-1).id}` : null,
  }
}

const queueItem = (type, item, title, detail, status = statusOf(item)) => ({
  type,
  id: text(item?.id),
  title: text(title, item?.id),
  detail: text(detail),
  status: status ? text(status) : null,
  timestamp: timestampOf(item),
})

export const buildAdminOperationsOverview = async ({ repositories, actor, windowMinutes = 60 }) => {
  const canAudit = hasPermission(actor, 'admin:audit:read')
  const canReadQueues = hasPermission(actor, 'admin:queue:read')
  const canReadEvents = hasPermission(actor, 'admin:events:read')
  const canReadJobs = hasPermission(actor, 'admin:jobs:read')
  const [metrics, reviews, alerts, inboxes, events, jobs] = await Promise.all([
    canAudit ? repositories.operationsMetrics.summary({ windowMinutes }) : null,
    canReadQueues ? safeLoad(() => repositories.adminReviews.list({ status: 'Pending review', limit: 50 })) : [],
    canAudit ? safeLoad(() => repositories.securityEvents.listAlerts()) : [],
    canReadEvents ? safeLoad(() => repositories.domainEventConsumers.list({ limit: 50 })) : [],
    canReadEvents ? safeLoad(() => repositories.domainEvents.list({ limit: 50 })) : [],
    canReadJobs ? safeLoad(() => repositories.jobs.list({ limit: 50 })) : [],
  ])
  const activeAlerts = alerts.filter((item) => !['resolved'].includes(String(item.state ?? item.status).toLowerCase()))
  const recoveryInbox = inboxes.filter((item) => ['dead_lettered', 'compensation_failed'].includes(item.consumption?.status))
  const failedEvents = events.filter((item) => item.publication?.status === 'failed')
  const failedJobs = jobs.filter((item) => ['dead_lettered', 'failed', 'timed_out'].includes(item.status))
  const recoveryItems = [
    ...recoveryInbox.map((item) => queueItem('event_inbox', item, item.consumerKey, item.eventType, item.consumption?.status)),
    ...failedEvents.map((item) => queueItem('domain_event', item, item.eventType, `${item.aggregateType} · ${item.aggregateId}`, item.publication?.status)),
    ...failedJobs.map((item) => queueItem('job_run', item, item.definitionId, item.id)),
  ].slice(0, 12)
  return {
    generatedAt: new Date().toISOString(),
    windowMinutes,
    totals: {
      pendingReviews: reviews.length,
      activeAlerts: activeAlerts.length,
      recoveryItems: recoveryItems.length,
      failedOperations: recoveryInbox.length + failedEvents.length + failedJobs.length,
    },
    pendingReviews: reviews.slice(0, 8).map((item) => queueItem('admin_review', item, item.title, `${item.queue} · ${item.owner}`)),
    alerts: activeAlerts.slice(0, 8).map((item) => queueItem('security_alert', item, item.title ?? item.type, `${item.source ?? 'security'} · ${item.severity ?? 'unknown'}`, item.state)),
    recoveryItems,
    metrics,
  }
}
