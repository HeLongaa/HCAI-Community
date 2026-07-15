import assert from 'node:assert/strict'
import test from 'node:test'

import { adminGlobalSearchTypes, buildAdminOperationsOverview, searchAdminOperations } from './adminOperationsOverview.js'

const page = (items) => ({ items, limit: 50, nextCursor: null })
const repositories = {
  tasks: { list: async () => page([{ id: 'task-1', title: 'Logo refresh', category: 'Design', status: 'Open', privateBrief: 'secret' }]) },
  profiles: { list: async () => page([{ handle: 'logoartist', lane: 'Design', email: 'secret@example.com' }]) },
  adminReviews: { list: async () => page([{ id: 'review-1', title: 'Review logo', queue: 'tasks', owner: 'ops', status: 'Pending review' }]) },
  audit: { list: async () => page([{ id: 'audit-1', action: 'task.reviewed', resourceType: 'task', resourceId: 'task-1', metadata: { token: 'secret' } }]) },
  securityEvents: {
    list: async () => page([{ id: 'security-1', type: 'auth_failure', source: 'auth', severity: 'warning', ipAddress: '127.0.0.1' }]),
    listAlerts: async () => [{ id: 'alert-1', title: 'Auth failures', source: 'auth', severity: 'critical', state: 'firing', samples: [{ token: 'secret' }] }],
  },
  accountingReconciliation: { list: async () => page([{ id: 'issue-1', type: 'balance_drift', unit: 'points', sourceType: 'ledger', status: 'open' }]) },
  domainEvents: { list: async () => page([{ id: 'event-1', eventType: 'task.created.v1', aggregateType: 'task', aggregateId: 'task-1', publication: { status: 'failed' }, payload: { secret: true } }]) },
  domainEventConsumers: { list: async () => page([{ id: 'inbox-1', consumerKey: 'notify', eventType: 'task.created.v1', aggregateType: 'task', aggregateId: 'task-1', consumption: { status: 'dead_lettered' }, event: { secret: true } }]) },
  jobs: { list: async () => page([{ id: 'job-1', definitionId: 'notify', status: 'failed', input: { secret: true } }]) },
  media: { listReviewQueue: async () => page([{ id: 'asset-1', fileName: 'logo.png', purpose: 'submission_asset', contentType: 'image/png', metadata: { security: { scanStatus: 'review' }, storageKey: 'secret' } }]) },
  creativeGenerations: { list: async () => page([{ id: 'generation-1', workspace: 'image', status: 'failed', prompt: 'secret' }]) },
  operationsMetrics: { summary: async () => ({ generatedAt: '2026-07-15T00:00:00.000Z', security: { eventsTotal: 1 } }) },
}

const admin = { permissions: ['admin:access', 'admin:audit:read', 'admin:queue:read', 'admin:accounting:read', 'admin:events:read', 'admin:jobs:read'] }

test('global Admin search covers registered types with safe bounded projections and deep links', async () => {
  assert.equal(adminGlobalSearchTypes.length, 12)
  const { items: results } = await searchAdminOperations({ repositories, actor: admin, query: 'logo', limit: 20 })
  assert.deepEqual(results.map((item) => item.type).sort(), ['admin_review', 'media_asset', 'profile', 'task'])
  assert.ok(results.every((item) => item.target.tab === 'Overview' && item.target.resourceId === item.id))
  assert.equal(JSON.stringify(results).includes('secret'), false)
})

test('global Admin search omits resource families without their read permission', async () => {
  const { items: results } = await searchAdminOperations({ repositories, actor: { permissions: ['admin:access'] }, query: 'logo', limit: 20 })
  assert.deepEqual(results.map((item) => item.type).sort(), ['profile', 'task'])
})

test('global Admin search exposes a stable cursor between bounded pages', async () => {
  const first = await searchAdminOperations({ repositories, actor: admin, query: 'logo', limit: 2 })
  assert.equal(first.items.length, 2)
  assert.ok(first.nextCursor)
  const second = await searchAdminOperations({ repositories, actor: admin, query: 'logo', limit: 2, cursor: first.nextCursor })
  assert.equal(second.items.length, 2)
  assert.equal(second.items.some((item) => first.items.some((previous) => previous.type === item.type && previous.id === item.id)), false)
  const unknown = await searchAdminOperations({ repositories, actor: admin, query: 'logo', limit: 2, cursor: 'task:missing' })
  assert.deepEqual(unknown, { items: [], nextCursor: null })
})

test('operations overview aggregates pending work alerts and recoveries without raw payloads', async () => {
  const overview = await buildAdminOperationsOverview({ repositories, actor: admin, windowMinutes: 60 })
  assert.equal(overview.totals.pendingReviews, 1)
  assert.equal(overview.totals.activeAlerts, 1)
  assert.equal(overview.totals.recoveryItems, 3)
  assert.equal(overview.metrics.security.eventsTotal, 1)
  assert.equal(JSON.stringify(overview).includes('secret'), false)
})
