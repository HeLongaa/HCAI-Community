import assert from 'node:assert/strict'
import test from 'node:test'

import { createRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { recordSecurityEvent, resetSecurityEvents } from '../../security/securityEvents.js'
import { registerAdminRoutes } from './routes.js'

const createTestServer = () => createRouteTestServer(registerAdminRoutes)

test('GET /api/admin/permissions returns AUTH_REQUIRED when missing auth', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/permissions', { method: 'GET' })

    assert.equal(status, 401)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'AUTH_REQUIRED')
  } finally {
    await server.close()
  }
})

test('GET /api/admin/permissions requires audit read permission', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/permissions', {
      method: 'GET',
      token: 'demo-access.taskops',
    })

    assert.equal(status, 403)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'PERMISSION_DENIED')
    assert.equal(payload.error.message, 'Missing permission: admin:audit:read')
  } finally {
    await server.close()
  }
})

test('GET /api/admin/permissions returns permission catalog for auditors', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/permissions', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })

    assert.equal(status, 200)
    assert.ok(Array.isArray(payload.data))
    assert.ok(payload.data.some((permission) => permission.id === 'admin:queue:review'))
    assert.ok(payload.data.some((permission) => permission.id === 'security:alerts:manage'))
    assert.equal(payload.meta.pagination.limit, payload.data.length)
  } finally {
    await server.close()
  }
})

test('GET /api/admin/roles returns role permission matrix for auditors', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/roles', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })

    assert.equal(status, 200)
    assert.ok(Array.isArray(payload.data))
    const adminRole = payload.data.find((role) => role.role === 'admin')
    const moderatorRole = payload.data.find((role) => role.role === 'moderator')
    assert.ok(adminRole)
    assert.ok(adminRole.permissions.includes('admin:queue:review'))
    assert.ok(adminRole.permissions.includes('security:alerts:manage'))
    assert.ok(moderatorRole)
    assert.equal(moderatorRole.permissions.includes('security:alerts:manage'), false)
    assert.equal(payload.meta.pagination.limit, payload.data.length)
  } finally {
    await server.close()
  }
})

test('GET /api/admin/operations/metrics requires audit read permission', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/operations/metrics', {
      method: 'GET',
      token: 'demo-access.taskops',
    })

    assert.equal(status, 403)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'PERMISSION_DENIED')
    assert.equal(payload.error.message, 'Missing permission: admin:audit:read')
  } finally {
    await server.close()
  }
})

test('GET /api/admin/operations/metrics returns operations aggregates for auditors', async () => {
  resetSecurityEvents()
  const server = await createTestServer()
  try {
    recordSecurityEvent({
      type: 'rate_limit.exceeded',
      severity: 'warning',
      source: 'rate_limit',
      clientKey: '198.51.100.10',
      method: 'POST',
      pathname: '/api/auth/login',
    })

    const { status, payload } = await requestJson(server.url, '/api/admin/operations/metrics?windowMinutes=30', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })

    assert.equal(status, 200)
    assert.equal(payload.error, undefined)
    assert.equal(payload.data.window.minutes, 30)
    assert.ok(payload.data.security.eventsTotal >= 1)
    assert.ok(payload.data.security.eventsBySource.some((item) => item.key === 'rate_limit' && item.count >= 1))
    assert.ok(Array.isArray(payload.data.security.alerts.byState))
    assert.ok(Number.isInteger(payload.data.mediaScan.archiveCandidates.total))
    assert.ok(Array.isArray(payload.data.mediaScan.archiveWrites.byProvider))
  } finally {
    resetSecurityEvents()
    await server.close()
  }
})

test('GET /api/admin/operations/metrics validates window minutes', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/operations/metrics?windowMinutes=2', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })

    assert.equal(status, 400)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'VALIDATION_FAILED')
    assert.equal(payload.error.message, 'windowMinutes must be an integer between 5 and 1440')
  } finally {
    await server.close()
  }
})

test('GET /api/admin/operations/metrics/export requires audit read permission', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/operations/metrics/export', {
      method: 'GET',
      token: 'demo-access.taskops',
    })

    assert.equal(status, 403)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'PERMISSION_DENIED')
    assert.equal(payload.error.message, 'Missing permission: admin:audit:read')
  } finally {
    await server.close()
  }
})

test('GET /api/admin/operations/metrics/export returns auditable handoff artifact', async () => {
  resetSecurityEvents()
  const server = await createTestServer()
  try {
    recordSecurityEvent({
      type: 'rate_limit.exceeded',
      severity: 'warning',
      source: 'rate_limit',
      clientKey: '198.51.100.11',
      method: 'POST',
      pathname: '/api/auth/login',
    })

    const { status, payload } = await requestJson(server.url, '/api/admin/operations/metrics/export?windowMinutes=15', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })

    assert.equal(status, 200)
    assert.equal(payload.kind, 'admin.operations.metrics.snapshot')
    assert.equal(payload.window.minutes, 15)
    assert.equal(payload.metrics.window.minutes, 15)
    assert.equal(payload.actor.handle, 'legalpixel')
    assert.ok(payload.id.startsWith('operations-metrics-'))
    assert.ok(Array.isArray(payload.handoff.remediationHints))
    assert.ok(payload.samples.securityDispatchFailures)
    assert.ok(payload.samples.mediaDispatchFailures)
    assert.ok(payload.samples.archiveWrites)
    assert.ok(payload.samples.historyPruned)

    const audit = await requestJson(server.url, '/api/admin/audit?action=admin.operations.metrics_exported&resourceType=operations_metrics&limit=1', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })
    assert.equal(audit.status, 200)
    assert.equal(audit.payload.data[0].action, 'admin.operations.metrics_exported')
    assert.equal(audit.payload.data[0].resourceId, payload.id)
    assert.equal(audit.payload.data[0].metadata.windowMinutes, 15)
    assert.equal(audit.payload.data[0].metadata.hintCount, payload.handoff.remediationHints.length)
  } finally {
    resetSecurityEvents()
    await server.close()
  }
})

test('GET /api/admin/operations/metrics/export validates window minutes', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/operations/metrics/export?windowMinutes=1441', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })

    assert.equal(status, 400)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'VALIDATION_FAILED')
    assert.equal(payload.error.message, 'windowMinutes must be an integer between 5 and 1440')
  } finally {
    await server.close()
  }
})

test('PUT /api/admin/roles/:role/permissions requires permission management access', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/roles/member/permissions', {
      method: 'PUT',
      body: { permissions: ['task:create'] },
      token: 'demo-access.legalpixel',
    })

    assert.equal(status, 403)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'PERMISSION_DENIED')
    assert.equal(payload.error.message, 'Missing permission: admin:permissions:manage')
  } finally {
    await server.close()
  }
})

test('PUT /api/admin/roles/:role/permissions validates permission ids', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/roles/member/permissions', {
      method: 'PUT',
      body: { permissions: ['task:create', 'unknown:permission'] },
      token: 'demo-access.opsplus',
    })

    assert.equal(status, 400)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'VALIDATION_FAILED')
    assert.equal(payload.error.message, 'permissions contains unsupported values: unknown:permission')
  } finally {
    await server.close()
  }
})

test('PUT /api/admin/roles/:role/permissions returns NOT_FOUND for unknown roles', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/roles/unknown/permissions', {
      method: 'PUT',
      body: { permissions: ['task:create'] },
      token: 'demo-access.opsplus',
    })

    assert.equal(status, 404)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'NOT_FOUND')
  } finally {
    await server.close()
  }
})

test('PUT /api/admin/roles/:role/permissions keeps protected admin grants', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/roles/admin/permissions', {
      method: 'PUT',
      body: { permissions: ['admin:access'] },
      token: 'demo-access.opsplus',
    })

    assert.equal(status, 400)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'VALIDATION_FAILED')
    assert.equal(payload.error.message, 'cannot remove protected permissions: admin:permissions:manage')
  } finally {
    await server.close()
  }
})

test('PUT /api/admin/roles/:role/permissions updates a role permission matrix', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/roles/member/permissions', {
      method: 'PUT',
      body: { permissions: ['task:create', 'post:create'] },
      token: 'demo-access.opsplus',
    })

    assert.equal(status, 200)
    assert.equal(payload.error, undefined)
    assert.deepEqual(payload.data, {
      role: 'member',
      permissions: ['task:create', 'post:create'],
    })

    const { payload: rolesPayload } = await requestJson(server.url, '/api/admin/roles', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    const memberRole = rolesPayload.data.find((role) => role.role === 'member')
    assert.deepEqual(memberRole.permissions, ['task:create', 'post:create'])
  } finally {
    await server.close()
  }
})

test('GET /api/admin/reviews returns AUTH_REQUIRED when missing auth', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/reviews', { method: 'GET' })

    assert.equal(status, 401)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'AUTH_REQUIRED')
  } finally {
    await server.close()
  }
})

test('GET /api/admin/reviews returns PERMISSION_DENIED without queue read permission', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/reviews', {
      method: 'GET',
      token: 'demo-access.taskops',
    })

    assert.equal(status, 403)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'PERMISSION_DENIED')
    assert.equal(payload.error.message, 'Missing permission: admin:queue:read')
  } finally {
    await server.close()
  }
})

test('GET /api/admin/reviews returns review queue data for moderators', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/reviews', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })

    assert.equal(status, 200)
    assert.ok(Array.isArray(payload.data))
    assert.equal(payload.error, undefined)
    assert.equal(payload.data[0].id, 'review-1')
    assert.equal(payload.meta.pagination.nextCursor, null)
    assert.equal(payload.meta.pagination.limit, 20)
  } finally {
    await server.close()
  }
})

test('GET /api/admin/reviews paginates with cursor and limit', async () => {
  const server = await createTestServer()
  try {
    const firstPage = await requestJson(server.url, '/api/admin/reviews?limit=2', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })

    assert.equal(firstPage.status, 200)
    assert.deepEqual(firstPage.payload.data.map((item) => item.id), ['review-1', 'review-2'])
    assert.equal(firstPage.payload.meta.pagination.limit, 2)
    assert.equal(firstPage.payload.meta.pagination.nextCursor, 'review-2')

    const secondPage = await requestJson(server.url, '/api/admin/reviews?limit=2&cursor=review-2', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })

    assert.equal(secondPage.status, 200)
    assert.deepEqual(secondPage.payload.data.map((item) => item.id), ['review-3', 'review-4'])
    assert.equal(secondPage.payload.meta.pagination.nextCursor, null)
  } finally {
    await server.close()
  }
})

test('GET /api/admin/reviews filters by queue and status', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/reviews?queue=tasks&status=Publish%20audit', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })

    assert.equal(status, 200)
    assert.deepEqual(payload.data.map((item) => item.id), ['review-4'])
    assert.equal(payload.meta.pagination.nextCursor, null)
    assert.equal(payload.meta.pagination.limit, 20)
  } finally {
    await server.close()
  }
})

test('GET /api/admin/reviews validates pagination limit', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/reviews?limit=0', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })

    assert.equal(status, 400)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'VALIDATION_FAILED')
    assert.equal(payload.error.message, 'limit must be an integer between 1 and 100')
  } finally {
    await server.close()
  }
})

test('POST /api/admin/reviews/:id/actions requires queue review permission', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/reviews/review-1/actions', {
      body: { decision: 'approve' },
      token: 'demo-access.taskops',
    })

    assert.equal(status, 403)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'PERMISSION_DENIED')
    assert.equal(payload.error.message, 'Missing permission: admin:queue:review')
  } finally {
    await server.close()
  }
})

test('POST /api/admin/reviews/:id/actions validates decisions', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/reviews/review-1/actions', {
      body: { decision: 'hold' },
      token: 'demo-access.legalpixel',
    })

    assert.equal(status, 400)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'VALIDATION_FAILED')
    assert.equal(payload.error.message, 'decision must be one of: approve, reject')
  } finally {
    await server.close()
  }
})

test('POST /api/admin/reviews/:id/actions returns NOT_FOUND for missing queue items', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/reviews/missing-review/actions', {
      body: { decision: 'approve' },
      token: 'demo-access.legalpixel',
    })

    assert.equal(status, 404)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'NOT_FOUND')
  } finally {
    await server.close()
  }
})

test('POST /api/admin/reviews/:id/actions reviews a queue item', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/reviews/review-1/actions', {
      body: { decision: 'approve', note: 'Approved in route test.' },
      token: 'demo-access.legalpixel',
    })

    assert.equal(status, 200)
    assert.equal(payload.error, undefined)
    assert.equal(payload.data.id, 'review-1')
    assert.equal(payload.data.status, 'Approved')
    assert.equal(payload.data.decision, 'approve')
    assert.equal(payload.data.reviewedBy, 'legalpixel')
    assert.equal(payload.data.note, 'Approved in route test.')
    assert.ok(payload.data.reviewedAt)
  } finally {
    await server.close()
  }
})

test('GET /api/admin/audit returns AUTH_REQUIRED when missing auth', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/audit', { method: 'GET' })

    assert.equal(status, 401)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'AUTH_REQUIRED')
  } finally {
    await server.close()
  }
})

test('GET /api/admin/audit returns PERMISSION_DENIED for non-admin users', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/audit', {
      method: 'GET',
      token: 'demo-access.taskops',
    })

    assert.equal(status, 403)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'PERMISSION_DENIED')
    assert.equal(payload.error.message, 'Missing permission: admin:audit:read')
  } finally {
    await server.close()
  }
})

test('GET /api/admin/audit returns audit data and pagination for admins', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/audit', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })

    assert.equal(status, 200)
    assert.ok(Array.isArray(payload.data))
    assert.equal(payload.error, undefined)
    assert.equal(payload.meta.pagination.nextCursor, null)
    assert.equal(payload.meta.pagination.limit, 20)
  } finally {
    await server.close()
  }
})

test('GET /api/admin/audit paginates with cursor and filters by action', async () => {
  const server = await createTestServer()
  try {
    await requestJson(server.url, '/api/admin/reviews/review-3/actions', {
      body: { decision: 'approve', note: 'Audit pagination setup A.' },
      token: 'demo-access.legalpixel',
    })
    await requestJson(server.url, '/api/admin/reviews/review-4/actions', {
      body: { decision: 'approve', note: 'Audit pagination setup B.' },
      token: 'demo-access.legalpixel',
    })

    const firstPage = await requestJson(server.url, '/api/admin/audit?limit=1&action=admin.review.approve', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })

    assert.equal(firstPage.status, 200)
    assert.equal(firstPage.payload.data.length, 1)
    assert.equal(firstPage.payload.data[0].action, 'admin.review.approve')
    assert.equal(firstPage.payload.meta.pagination.limit, 1)
    assert.ok(firstPage.payload.meta.pagination.nextCursor)

    const secondPage = await requestJson(server.url, `/api/admin/audit?limit=1&action=admin.review.approve&cursor=${firstPage.payload.meta.pagination.nextCursor}`, {
      method: 'GET',
      token: 'demo-access.opsplus',
    })

    assert.equal(secondPage.status, 200)
    assert.equal(secondPage.payload.data.length, 1)
    assert.equal(secondPage.payload.data[0].action, 'admin.review.approve')
    assert.notEqual(secondPage.payload.data[0].id, firstPage.payload.data[0].id)
  } finally {
    await server.close()
  }
})

test('GET /api/admin/audit allows moderators with audit read permission', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/audit', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })

    assert.equal(status, 200)
    assert.ok(Array.isArray(payload.data))
    assert.equal(payload.error, undefined)
    assert.equal(payload.meta.pagination.nextCursor, null)
  } finally {
    await server.close()
  }
})

test('GET /api/admin/audit/export returns filtered audit JSON', async () => {
  const server = await createTestServer()
  try {
    const updatedRole = await requestJson(server.url, '/api/admin/roles/member/permissions', {
      method: 'PUT',
      body: { permissions: ['task:create', 'post:create', 'points:read'] },
      token: 'demo-access.opsplus',
    })
    assert.equal(updatedRole.status, 200)

    const exported = await requestJson(server.url, '/api/admin/audit/export?action=admin.role_permissions.updated&resourceType=role&limit=1', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(exported.status, 200)
    assert.equal(exported.payload.query.action, 'admin.role_permissions.updated')
    assert.equal(exported.payload.query.resourceType, 'role')
    assert.equal(exported.payload.query.limit, 1)
    assert.equal(exported.payload.count, 1)
    assert.equal(exported.payload.events[0].action, 'admin.role_permissions.updated')
    assert.equal(exported.payload.events[0].resourceType, 'role')
    assert.ok(exported.payload.exportedAt)
  } finally {
    await server.close()
  }
})

test('GET /api/admin/audit/export requires audit read permission', async () => {
  const server = await createTestServer()
  try {
    const denied = await requestJson(server.url, '/api/admin/audit/export', {
      method: 'GET',
      token: 'demo-access.taskops',
    })
    assert.equal(denied.status, 403)
    assert.equal(denied.payload.error.message, 'Missing permission: admin:audit:read')
  } finally {
    await server.close()
  }
})

test('GET /api/admin/audit/:id returns a single audit event', async () => {
  const server = await createTestServer()
  try {
    const updatedRole = await requestJson(server.url, '/api/admin/roles/member/permissions', {
      method: 'PUT',
      body: { permissions: ['task:create', 'points:read'] },
      token: 'demo-access.opsplus',
    })
    assert.equal(updatedRole.status, 200)

    const auditList = await requestJson(server.url, '/api/admin/audit?limit=1&action=admin.role_permissions.updated', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(auditList.status, 200)
    assert.equal(auditList.payload.data.length, 1)
    const eventId = auditList.payload.data[0].id

    const event = await requestJson(server.url, `/api/admin/audit/${eventId}`, {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(event.status, 200)
    assert.equal(event.payload.data.id, eventId)
    assert.equal(event.payload.data.action, 'admin.role_permissions.updated')
    assert.equal(event.payload.data.resourceType, 'role')
  } finally {
    await server.close()
  }
})

test('GET /api/admin/audit/:id enforces permissions and missing events', async () => {
  const server = await createTestServer()
  try {
    const unauthenticated = await requestJson(server.url, '/api/admin/audit/audit-missing', { method: 'GET' })
    assert.equal(unauthenticated.status, 401)
    assert.equal(unauthenticated.payload.error.code, 'AUTH_REQUIRED')

    const denied = await requestJson(server.url, '/api/admin/audit/audit-missing', {
      method: 'GET',
      token: 'demo-access.taskops',
    })
    assert.equal(denied.status, 403)
    assert.equal(denied.payload.error.message, 'Missing permission: admin:audit:read')

    const missing = await requestJson(server.url, '/api/admin/audit/audit-missing', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(missing.status, 404)
    assert.equal(missing.payload.error.code, 'NOT_FOUND')
  } finally {
    await server.close()
  }
})

test('GET /api/admin/security/events requires audit read permission', async () => {
  const server = await createTestServer()
  try {
    const unauthenticated = await requestJson(server.url, '/api/admin/security/events', { method: 'GET' })
    assert.equal(unauthenticated.status, 401)
    assert.equal(unauthenticated.payload.error.code, 'AUTH_REQUIRED')

    const denied = await requestJson(server.url, '/api/admin/security/events', {
      method: 'GET',
      token: 'demo-access.taskops',
    })
    assert.equal(denied.status, 403)
    assert.equal(denied.payload.error.message, 'Missing permission: admin:audit:read')
  } finally {
    await server.close()
  }
})

test('GET /api/admin/security/events lists and filters recent security events', async () => {
  resetSecurityEvents()
  const server = await createTestServer()
  try {
    recordSecurityEvent({
      type: 'rate_limit.exceeded',
      severity: 'warning',
      source: 'rate_limit',
      clientKey: '198.51.100.1',
      method: 'POST',
      pathname: '/api/auth/login',
      bucket: 'auth',
    })
    recordSecurityEvent({
      type: 'auth.failed_login.ip_accounts',
      severity: 'warning',
      source: 'auth_failure',
      clientKey: '198.51.100.2',
      identity: 'target@example.com',
      method: 'POST',
      pathname: '/api/auth/login',
    })

    const { status, payload } = await requestJson(server.url, '/api/admin/security/events?source=auth_failure', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })

    assert.equal(status, 200)
    assert.equal(payload.data.length, 1)
    assert.equal(payload.data[0].type, 'auth.failed_login.ip_accounts')
    assert.equal(payload.data[0].source, 'auth_failure')
    assert.equal(payload.data[0].identity, 'target@example.com')
    assert.equal(payload.meta.pagination.limit, 20)
    assert.equal(payload.meta.pagination.nextCursor, null)
  } finally {
    resetSecurityEvents()
    await server.close()
  }
})

test('GET /api/admin/security/events paginates with cursor', async () => {
  resetSecurityEvents()
  const server = await createTestServer()
  try {
    recordSecurityEvent({ type: 'security.first', severity: 'warning', source: 'test' })
    recordSecurityEvent({ type: 'security.second', severity: 'warning', source: 'test' })
    recordSecurityEvent({ type: 'security.third', severity: 'warning', source: 'test' })

    const firstPage = await requestJson(server.url, '/api/admin/security/events?source=test&limit=1', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(firstPage.status, 200)
    assert.equal(firstPage.payload.data.length, 1)
    assert.equal(firstPage.payload.data[0].type, 'security.third')
    assert.ok(firstPage.payload.meta.pagination.nextCursor)

    const secondPage = await requestJson(server.url, `/api/admin/security/events?source=test&limit=1&cursor=${firstPage.payload.meta.pagination.nextCursor}`, {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(secondPage.status, 200)
    assert.equal(secondPage.payload.data.length, 1)
    assert.equal(secondPage.payload.data[0].type, 'security.second')
  } finally {
    resetSecurityEvents()
    await server.close()
  }
})

test('GET /api/admin/security/alerts requires audit read permission', async () => {
  const server = await createTestServer()
  try {
    const unauthenticated = await requestJson(server.url, '/api/admin/security/alerts', { method: 'GET' })
    assert.equal(unauthenticated.status, 401)
    assert.equal(unauthenticated.payload.error.code, 'AUTH_REQUIRED')

    const denied = await requestJson(server.url, '/api/admin/security/alerts', {
      method: 'GET',
      token: 'demo-access.taskops',
    })
    assert.equal(denied.status, 403)
    assert.equal(denied.payload.error.message, 'Missing permission: admin:audit:read')
  } finally {
    await server.close()
  }
})

test('GET /api/admin/security/alerts returns aggregated threshold alerts', async () => {
  resetSecurityEvents()
  const previous = {
    window: process.env.SECURITY_ALERT_WINDOW_MINUTES,
    rateLimit: process.env.SECURITY_ALERT_RATE_LIMIT_THRESHOLD,
    bodyRejected: process.env.SECURITY_ALERT_BODY_REJECTED_THRESHOLD,
    authFailure: process.env.SECURITY_ALERT_AUTH_FAILURE_THRESHOLD,
  }
  process.env.SECURITY_ALERT_WINDOW_MINUTES = '15'
  process.env.SECURITY_ALERT_RATE_LIMIT_THRESHOLD = '2'
  process.env.SECURITY_ALERT_BODY_REJECTED_THRESHOLD = '2'
  process.env.SECURITY_ALERT_AUTH_FAILURE_THRESHOLD = '1'
  const server = await createTestServer()
  try {
    recordSecurityEvent({ type: 'rate_limit.exceeded', severity: 'warning', source: 'rate_limit', clientKey: '198.51.100.1', pathname: '/api/auth/login' })
    recordSecurityEvent({ type: 'rate_limit.exceeded', severity: 'warning', source: 'rate_limit', clientKey: '198.51.100.2', pathname: '/api/auth/login' })
    recordSecurityEvent({ type: 'auth.failed_login.ip_accounts', severity: 'critical', source: 'auth_failure', clientKey: '198.51.100.3', identity: 'target@example.com' })

    const { status, payload } = await requestJson(server.url, '/api/admin/security/alerts', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })

    assert.equal(status, 200)
    assert.ok(payload.data.some((alert) => alert.type === 'security.event.rate_limit.spike'))
    const authAlert = payload.data.find((alert) => alert.type === 'security.event.auth_failure_anomaly.spike')
    assert.equal(authAlert.severity, 'critical')
    assert.equal(authAlert.threshold, 1)
    assert.deepEqual(payload.meta.pagination, { limit: payload.data.length, nextCursor: null })
  } finally {
    if (previous.window == null) delete process.env.SECURITY_ALERT_WINDOW_MINUTES
    else process.env.SECURITY_ALERT_WINDOW_MINUTES = previous.window
    if (previous.rateLimit == null) delete process.env.SECURITY_ALERT_RATE_LIMIT_THRESHOLD
    else process.env.SECURITY_ALERT_RATE_LIMIT_THRESHOLD = previous.rateLimit
    if (previous.bodyRejected == null) delete process.env.SECURITY_ALERT_BODY_REJECTED_THRESHOLD
    else process.env.SECURITY_ALERT_BODY_REJECTED_THRESHOLD = previous.bodyRejected
    if (previous.authFailure == null) delete process.env.SECURITY_ALERT_AUTH_FAILURE_THRESHOLD
    else process.env.SECURITY_ALERT_AUTH_FAILURE_THRESHOLD = previous.authFailure
    resetSecurityEvents()
    await server.close()
  }
})

test('admin security alert disposition and event drill-down APIs work', async () => {
  resetSecurityEvents()
  const previous = {
    window: process.env.SECURITY_ALERT_WINDOW_MINUTES,
    rateLimit: process.env.SECURITY_ALERT_RATE_LIMIT_THRESHOLD,
    bodyRejected: process.env.SECURITY_ALERT_BODY_REJECTED_THRESHOLD,
    authFailure: process.env.SECURITY_ALERT_AUTH_FAILURE_THRESHOLD,
  }
  process.env.SECURITY_ALERT_WINDOW_MINUTES = '15'
  process.env.SECURITY_ALERT_RATE_LIMIT_THRESHOLD = '2'
  process.env.SECURITY_ALERT_BODY_REJECTED_THRESHOLD = '2'
  process.env.SECURITY_ALERT_AUTH_FAILURE_THRESHOLD = '1'
  const server = await createTestServer()
  try {
    recordSecurityEvent({ type: 'rate_limit.exceeded', severity: 'warning', source: 'rate_limit', clientKey: '198.51.100.1', pathname: '/api/auth/login' })
    recordSecurityEvent({ type: 'rate_limit.exceeded', severity: 'warning', source: 'rate_limit', clientKey: '198.51.100.2', pathname: '/api/auth/login' })

    const alerts = await requestJson(server.url, '/api/admin/security/alerts', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    const alert = alerts.payload.data.find((item) => item.type === 'security.event.rate_limit.spike')
    assert.ok(alert)
    assert.equal(alert.state, 'active')

    const events = await requestJson(server.url, `/api/admin/security/alerts/${alert.id}/events`, {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(events.status, 200)
    assert.equal(events.payload.data.length, 2)
    assert.ok(events.payload.data.every((event) => event.source === 'rate_limit'))

    const acknowledged = await requestJson(server.url, `/api/admin/security/alerts/${alert.id}/acknowledge`, {
      method: 'POST',
      token: 'demo-access.opsplus',
      body: { note: 'Investigating login pressure.' },
    })
    assert.equal(acknowledged.status, 200)
    assert.equal(acknowledged.payload.data.state, 'acknowledged')
    assert.equal(acknowledged.payload.data.acknowledgedBy, 'opsplus')
    assert.equal(acknowledged.payload.data.acknowledgementNote, 'Investigating login pressure.')

    const invalidSilence = await requestJson(server.url, `/api/admin/security/alerts/${alert.id}/silence`, {
      method: 'POST',
      token: 'demo-access.opsplus',
      body: { until: '2020-01-01T00:00:00.000Z' },
    })
    assert.equal(invalidSilence.status, 400)
    assert.equal(invalidSilence.payload.error.code, 'VALIDATION_FAILED')

    const silencedUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const silenced = await requestJson(server.url, `/api/admin/security/alerts/${alert.id}/silence`, {
      method: 'POST',
      token: 'demo-access.opsplus',
      body: { until: silencedUntil, note: 'Suppress during controlled load test.' },
    })
    assert.equal(silenced.status, 200)
    assert.equal(silenced.payload.data.state, 'silenced')
    assert.equal(silenced.payload.data.silencedBy, 'opsplus')
    assert.equal(silenced.payload.data.silencedUntil, silencedUntil)

    const unsilenced = await requestJson(server.url, `/api/admin/security/alerts/${alert.id}/unsilence`, {
      method: 'POST',
      token: 'demo-access.opsplus',
      body: { note: 'Load test finished.' },
    })
    assert.equal(unsilenced.status, 200)
    assert.equal(unsilenced.payload.data.state, 'acknowledged')
    assert.equal(unsilenced.payload.data.silencedUntil, null)

    const exported = await requestJson(server.url, `/api/admin/security/alerts/${alert.id}/export`, {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(exported.status, 200)
    assert.equal(exported.payload.alert.id, alert.id)
    assert.equal(exported.payload.events.length, 2)
    assert.ok(exported.payload.auditEvents.some((event) => event.action === 'security.alert.acknowledged'))
    assert.ok(exported.payload.auditEvents.some((event) => event.action === 'security.alert.silenced'))

    const missingExport = await requestJson(server.url, '/api/admin/security/alerts/security-alert-missing/export', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(missingExport.status, 404)
  } finally {
    if (previous.window == null) delete process.env.SECURITY_ALERT_WINDOW_MINUTES
    else process.env.SECURITY_ALERT_WINDOW_MINUTES = previous.window
    if (previous.rateLimit == null) delete process.env.SECURITY_ALERT_RATE_LIMIT_THRESHOLD
    else process.env.SECURITY_ALERT_RATE_LIMIT_THRESHOLD = previous.rateLimit
    if (previous.bodyRejected == null) delete process.env.SECURITY_ALERT_BODY_REJECTED_THRESHOLD
    else process.env.SECURITY_ALERT_BODY_REJECTED_THRESHOLD = previous.bodyRejected
    if (previous.authFailure == null) delete process.env.SECURITY_ALERT_AUTH_FAILURE_THRESHOLD
    else process.env.SECURITY_ALERT_AUTH_FAILURE_THRESHOLD = previous.authFailure
    resetSecurityEvents()
    await server.close()
  }
})

test('security alert read APIs allow auditors but disposition requires alert management permission', async () => {
  resetSecurityEvents()
  const previous = {
    window: process.env.SECURITY_ALERT_WINDOW_MINUTES,
    rateLimit: process.env.SECURITY_ALERT_RATE_LIMIT_THRESHOLD,
  }
  process.env.SECURITY_ALERT_WINDOW_MINUTES = '15'
  process.env.SECURITY_ALERT_RATE_LIMIT_THRESHOLD = '2'
  const server = await createTestServer()
  try {
    recordSecurityEvent({ type: 'rate_limit.exceeded', severity: 'warning', source: 'rate_limit', clientKey: '198.51.100.1', pathname: '/api/auth/login' })
    recordSecurityEvent({ type: 'rate_limit.exceeded', severity: 'warning', source: 'rate_limit', clientKey: '198.51.100.2', pathname: '/api/auth/login' })

    const alerts = await requestJson(server.url, '/api/admin/security/alerts', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })
    assert.equal(alerts.status, 200)
    const alert = alerts.payload.data.find((item) => item.type === 'security.event.rate_limit.spike')
    assert.ok(alert)

    const events = await requestJson(server.url, `/api/admin/security/alerts/${alert.id}/events`, {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })
    assert.equal(events.status, 200)
    assert.equal(events.payload.data.length, 2)

    const exported = await requestJson(server.url, `/api/admin/security/alerts/${alert.id}/export`, {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })
    assert.equal(exported.status, 200)
    assert.equal(exported.payload.alert.id, alert.id)

    const acknowledge = await requestJson(server.url, `/api/admin/security/alerts/${alert.id}/acknowledge`, {
      method: 'POST',
      token: 'demo-access.legalpixel',
      body: { note: 'Read-only operator cannot acknowledge.' },
    })
    assert.equal(acknowledge.status, 403)
    assert.equal(acknowledge.payload.error.message, 'Missing permission: security:alerts:manage')

    const until = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const silence = await requestJson(server.url, `/api/admin/security/alerts/${alert.id}/silence`, {
      method: 'POST',
      token: 'demo-access.legalpixel',
      body: { until, note: 'Read-only operator cannot silence.' },
    })
    assert.equal(silence.status, 403)
    assert.equal(silence.payload.error.message, 'Missing permission: security:alerts:manage')

    const unsilence = await requestJson(server.url, `/api/admin/security/alerts/${alert.id}/unsilence`, {
      method: 'POST',
      token: 'demo-access.legalpixel',
      body: { note: 'Read-only operator cannot unsilence.' },
    })
    assert.equal(unsilence.status, 403)
    assert.equal(unsilence.payload.error.message, 'Missing permission: security:alerts:manage')
  } finally {
    if (previous.window == null) delete process.env.SECURITY_ALERT_WINDOW_MINUTES
    else process.env.SECURITY_ALERT_WINDOW_MINUTES = previous.window
    if (previous.rateLimit == null) delete process.env.SECURITY_ALERT_RATE_LIMIT_THRESHOLD
    else process.env.SECURITY_ALERT_RATE_LIMIT_THRESHOLD = previous.rateLimit
    resetSecurityEvents()
    await server.close()
  }
})

test('GET /api/admin/points/ledger requires points adjustment permission', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/points/ledger', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })

    assert.equal(status, 403)
    assert.equal(payload.error.code, 'PERMISSION_DENIED')
    assert.equal(payload.error.message, 'Missing permission: points:adjust')
  } finally {
    await server.close()
  }
})

test('GET /api/admin/points/ledger searches user ledgers with balance summary', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/points/ledger?userHandle=promptlin&limit=5', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })

    assert.equal(status, 200)
    assert.ok(Array.isArray(payload.data))
    assert.ok(payload.data.every((entry) => entry.userHandle === 'promptlin'))
    assert.equal(payload.meta.pagination.limit, 5)
    assert.equal(payload.meta.summary.userHandle, 'promptlin')
    assert.equal(typeof payload.meta.summary.available, 'number')
    assert.equal(typeof payload.meta.summary.lifetimeEarned, 'number')
  } finally {
    await server.close()
  }
})

test('GET /api/admin/points/policy returns current adjustment policy', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/points/policy', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })

    assert.equal(status, 200)
    assert.equal(payload.data.roleLimits.admin, 5000)
    assert.equal(payload.data.roleLimits.moderator, 1000)
    assert.ok(payload.data.reasonCodes.includes('support_credit'))
    assert.ok(Array.isArray(payload.data.approvalTemplates))
  } finally {
    await server.close()
  }
})

test('PUT /api/admin/points/policy requires permission management access', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/points/policy', {
      method: 'PUT',
      body: {
        roleLimits: { member: 0, creator: 0, publisher: 0, moderator: 500, admin: 2500 },
        reasonCodes: ['support_credit'],
        approvalTemplates: ['Verified.'],
      },
      token: 'demo-access.legalpixel',
    })

    assert.equal(status, 403)
    assert.equal(payload.error.code, 'PERMISSION_DENIED')
    assert.equal(payload.error.message, 'Missing permission: admin:permissions:manage')
  } finally {
    await server.close()
  }
})

test('PUT /api/admin/points/policy updates direct limits used by adjustment routing', async () => {
  const server = await createTestServer()
  try {
    const updated = await requestJson(server.url, '/api/admin/points/policy', {
      method: 'PUT',
      body: {
        roleLimits: { member: 0, creator: 0, publisher: 0, moderator: 250, admin: 200 },
        reasonCodes: ['support_credit', 'settlement_fix'],
        approvalTemplates: ['Verified with support evidence.'],
      },
      token: 'demo-access.opsplus',
    })

    assert.equal(updated.status, 200)
    assert.equal(updated.payload.data.roleLimits.admin, 200)
    assert.deepEqual(updated.payload.data.reasonCodes, ['support_credit', 'settlement_fix'])

    const adjustment = await requestJson(server.url, '/api/admin/points/adjustments', {
      body: { userHandle: 'promptlin', delta: 250, reason: 'Policy configured review', reasonCode: 'settlement_fix' },
      token: 'demo-access.opsplus',
    })

    assert.equal(adjustment.status, 200)
    assert.equal(adjustment.payload.data.status, 'pending_review')
    assert.equal(adjustment.payload.data.threshold, 200)
    assert.equal(adjustment.payload.data.review.metadata.threshold, 200)
    assert.equal(adjustment.payload.data.review.metadata.reasonCode, 'settlement_fix')

    const audit = await requestJson(server.url, '/api/admin/audit?action=points.policy.updated', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(audit.status, 200)
    assert.equal(audit.payload.data[0].metadata.next.roleLimits.admin, 200)
    assert.equal(audit.payload.data[0].metadata.diff.roleLimits.admin.to, 200)
  } finally {
    await server.close()
  }
})

test('GET and POST /api/admin/points/policy history support diff inspection and rollback', async () => {
  const server = await createTestServer()
  try {
    const updated = await requestJson(server.url, '/api/admin/points/policy', {
      method: 'PUT',
      body: {
        roleLimits: { member: 0, creator: 0, publisher: 0, moderator: 250, admin: 300 },
        reasonCodes: ['support_credit', 'fraud_correction'],
        approvalTemplates: ['Reviewed with finance evidence.'],
      },
      token: 'demo-access.opsplus',
    })
    assert.equal(updated.status, 200)
    assert.equal(updated.payload.data.roleLimits.admin, 300)

    const history = await requestJson(server.url, '/api/admin/points/policy/history?limit=5', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(history.status, 200)
    assert.ok(history.payload.data.length >= 1)
    assert.equal(history.payload.data[0].next.roleLimits.admin, 300)
    assert.match(history.payload.data[0].summary, /admin/)

    const rollback = await requestJson(server.url, '/api/admin/points/policy/rollback', {
      body: { eventId: history.payload.data[0].id },
      token: 'demo-access.opsplus',
    })
    assert.equal(rollback.status, 200)
    assert.equal(rollback.payload.data.roleLimits.admin, history.payload.data[0].previous.roleLimits.admin)

    const afterRollback = await requestJson(server.url, '/api/admin/points/policy', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(afterRollback.payload.data.roleLimits.admin, rollback.payload.data.roleLimits.admin)
  } finally {
    await server.close()
  }
})

test('POST /api/admin/points/adjustments creates a ledger entry and audit event', async () => {
  const server = await createTestServer()
  try {
    const adjusted = await requestJson(server.url, '/api/admin/points/adjustments', {
      body: { userHandle: 'promptlin', delta: 125, reason: 'Support credit' },
      token: 'demo-access.opsplus',
    })

    assert.equal(adjusted.status, 200)
    assert.equal(adjusted.payload.data.status, 'applied')
    assert.equal(adjusted.payload.data.entry.userHandle, 'promptlin')
    assert.equal(adjusted.payload.data.entry.delta, 125)
    assert.equal(adjusted.payload.data.entry.sourceType, 'manual_adjustment')
    assert.match(adjusted.payload.data.entry.description, /Support credit/)
    assert.equal(adjusted.payload.data.review, null)

    const ledger = await requestJson(server.url, '/api/admin/points/ledger?userHandle=promptlin&search=Support%20credit', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(ledger.status, 200)
    assert.equal(ledger.payload.data[0].id, adjusted.payload.data.entry.id)

    const audit = await requestJson(server.url, '/api/admin/audit?action=points.adjusted', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(audit.status, 200)
    assert.equal(audit.payload.data[0].resourceId, adjusted.payload.data.entry.id)
    assert.equal(audit.payload.data[0].metadata.reason, 'Support credit')
  } finally {
    await server.close()
  }
})

test('POST /api/admin/points/adjustments sends high-value adjustments to review before settlement', async () => {
  const server = await createTestServer()
  try {
    const requested = await requestJson(server.url, '/api/admin/points/adjustments', {
      body: { userHandle: 'promptlin', delta: 9000, reason: 'High value support correction' },
      token: 'demo-access.opsplus',
    })

    assert.equal(requested.status, 200)
    assert.equal(requested.payload.data.status, 'pending_review')
    assert.equal(requested.payload.data.entry, null)
    assert.equal(requested.payload.data.review.queue, 'points')
    assert.equal(requested.payload.data.review.owner, 'promptlin')
    assert.equal(requested.payload.data.review.metadata.kind, 'point_adjustment')
    assert.equal(requested.payload.data.review.metadata.delta, 9000)
    assert.equal(requested.payload.data.review.metadata.requestedBy, 'opsplus')
    assert.equal(typeof requested.payload.data.review.metadata.balanceBefore, 'number')
    assert.equal(
      requested.payload.data.review.metadata.projectedBalance,
      requested.payload.data.review.metadata.balanceBefore + 9000,
    )

    const beforeApproval = await requestJson(server.url, '/api/admin/points/ledger?userHandle=promptlin&search=High%20value%20support', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(beforeApproval.status, 200)
    assert.equal(beforeApproval.payload.data.length, 0)

    const approved = await requestJson(server.url, `/api/admin/reviews/${requested.payload.data.review.id}/actions`, {
      body: { decision: 'approve', note: 'Approved high-value correction.' },
      token: 'demo-access.finops',
    })

    assert.equal(approved.status, 200)
    assert.equal(approved.payload.data.status, 'Approved')
    assert.equal(approved.payload.data.metadata.ledgerEntryId.startsWith('ledger-'), true)

    const afterApproval = await requestJson(server.url, '/api/admin/points/ledger?userHandle=promptlin&search=High%20value%20support', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(afterApproval.status, 200)
    assert.equal(afterApproval.payload.data.length, 1)
    assert.equal(afterApproval.payload.data[0].sourceId, requested.payload.data.review.id)
    assert.equal(afterApproval.payload.data[0].delta, 9000)

    const secondApproval = await requestJson(server.url, `/api/admin/reviews/${requested.payload.data.review.id}/actions`, {
      body: { decision: 'approve', note: 'Duplicate approval should be idempotent.' },
      token: 'demo-access.finops',
    })
    assert.equal(secondApproval.status, 200)

    const afterReplay = await requestJson(server.url, '/api/admin/points/ledger?userHandle=promptlin&search=High%20value%20support', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(afterReplay.payload.data.length, 1)
  } finally {
    await server.close()
  }
})

test('POST /api/admin/reviews/:id/actions blocks self-approval for point adjustments', async () => {
  const server = await createTestServer()
  try {
    const requested = await requestJson(server.url, '/api/admin/points/adjustments', {
      body: { userHandle: 'promptlin', delta: 8500, reason: 'Self approval guard setup' },
      token: 'demo-access.opsplus',
    })

    assert.equal(requested.status, 200)
    assert.equal(requested.payload.data.status, 'pending_review')

    const approved = await requestJson(server.url, `/api/admin/reviews/${requested.payload.data.review.id}/actions`, {
      body: { decision: 'approve', note: 'Trying to self approve.' },
      token: 'demo-access.opsplus',
    })

    assert.equal(approved.status, 400)
    assert.equal(approved.payload.error.code, 'VALIDATION_FAILED')
    assert.equal(approved.payload.error.message, 'point adjustment reviews require a different approver')

    const ledger = await requestJson(server.url, '/api/admin/points/ledger?userHandle=promptlin&search=Self%20approval%20guard', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(ledger.status, 200)
    assert.equal(ledger.payload.data.length, 0)
  } finally {
    await server.close()
  }
})

test('POST /api/admin/reviews/:id/actions requires points adjustment permission for points queue reviews', async () => {
  const server = await createTestServer()
  try {
    const requested = await requestJson(server.url, '/api/admin/points/adjustments', {
      body: { userHandle: 'promptlin', delta: 8200, reason: 'Points queue permission guard' },
      token: 'demo-access.opsplus',
    })

    assert.equal(requested.status, 200)
    assert.equal(requested.payload.data.status, 'pending_review')

    const approved = await requestJson(server.url, `/api/admin/reviews/${requested.payload.data.review.id}/actions`, {
      body: { decision: 'approve', note: 'Moderator has queue review but no points adjust.' },
      token: 'demo-access.legalpixel',
    })

    assert.equal(approved.status, 403)
    assert.equal(approved.payload.error.code, 'PERMISSION_DENIED')
    assert.equal(approved.payload.error.message, 'Missing permission: points:adjust')
  } finally {
    await server.close()
  }
})

test('GET /api/admin/points/ledger.csv exports ledger rows as CSV', async () => {
  const server = await createTestServer()
  try {
    const response = await fetch(`${server.url}/api/admin/points/ledger.csv?userHandle=promptlin&limit=2`, {
      method: 'GET',
      headers: {
        accept: 'text/csv',
        authorization: 'Bearer demo-access.opsplus',
      },
    })
    const body = await response.text()

    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), /^text\/csv/)
    assert.match(body, /^id,userHandle,occurredAt,description,delta,balanceAfter,status,sourceType,sourceId/)
    assert.match(body, /promptlin/)
  } finally {
    await server.close()
  }
})
