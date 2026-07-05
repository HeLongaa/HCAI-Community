import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import http from 'node:http'
import test from 'node:test'

import { createRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { registerAdminRoutes } from '../admin/routes.js'
import { registerMediaRoutes } from '../media/routes.js'
import { registerNotificationRoutes } from './routes.js'

const createTestServer = () => createRouteTestServer(registerAdminRoutes, registerMediaRoutes, registerNotificationRoutes)

const createMediaUpload = async (server, token = 'demo-access.promptlin', overrides = {}) => {
  const response = await requestJson(server.url, '/api/media/uploads', {
    body: {
      fileName: 'notification-brief.pdf',
      contentType: 'application/pdf',
      sizeBytes: 2048,
      purpose: 'submission_asset',
      ...overrides,
    },
    token,
  })
  assert.equal(response.status, 201)
  return response.payload.data.asset
}

test('GET /api/notifications returns AUTH_REQUIRED when missing auth', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/notifications', { method: 'GET' })

    assert.equal(status, 401)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'AUTH_REQUIRED')
  } finally {
    await server.close()
  }
})

test('GET /api/notifications validates read state filters', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/notifications?readState=archived', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })

    assert.equal(status, 400)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'VALIDATION_FAILED')
    assert.equal(payload.error.message, 'readState must be one of: unread, read, all')
  } finally {
    await server.close()
  }
})

test('high-value point adjustment creates an unread notification for another approver', async () => {
  const server = await createTestServer()
  try {
    const requested = await requestJson(server.url, '/api/admin/points/adjustments', {
      body: { userHandle: 'promptlin', delta: 9101, reason: 'Notification review setup' },
      token: 'demo-access.opsplus',
    })

    assert.equal(requested.status, 200)
    assert.equal(requested.payload.data.status, 'pending_review')
    const reviewId = requested.payload.data.review.id

    const inbox = await requestJson(server.url, '/api/notifications?unreadOnly=true', {
      method: 'GET',
      token: 'demo-access.finops',
    })

    assert.equal(inbox.status, 200)
    const notification = inbox.payload.data.find((item) =>
      item.type === 'points.adjustment.requested' &&
      item.resourceId === reviewId &&
      item.readAt === null
    )
    assert.ok(notification)
    assert.deepEqual(notification.metadata.target, {
      page: 'admin',
      admin: {
        tab: 'Task review',
        queue: 'points',
        reviewId,
      },
    })
  } finally {
    await server.close()
  }
})

test('point adjustment review decision notifies requester and enforces notification ownership', async () => {
  const server = await createTestServer()
  try {
    const requested = await requestJson(server.url, '/api/admin/points/adjustments', {
      body: { userHandle: 'promptlin', delta: 9102, reason: 'Notification decision setup' },
      token: 'demo-access.opsplus',
    })
    const reviewId = requested.payload.data.review.id

    const approved = await requestJson(server.url, `/api/admin/reviews/${reviewId}/actions`, {
      body: { decision: 'approve', note: 'Approved for notification test.' },
      token: 'demo-access.finops',
    })
    assert.equal(approved.status, 200)

    const requesterInbox = await requestJson(server.url, '/api/notifications?unreadOnly=true', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    const notification = requesterInbox.payload.data.find((item) =>
      item.type === 'points.adjustment.approved' && item.resourceId === reviewId,
    )
    assert.ok(notification)
    assert.equal(notification.metadata.target.admin.reviewId, reviewId)
    assert.equal(notification.metadata.target.admin.queue, 'points')

    const forbiddenRead = await requestJson(server.url, `/api/notifications/${notification.id}/read`, {
      token: 'demo-access.finops',
    })
    assert.equal(forbiddenRead.status, 404)

    const read = await requestJson(server.url, `/api/notifications/${notification.id}/read`, {
      token: 'demo-access.opsplus',
    })
    assert.equal(read.status, 200)
    assert.ok(read.payload.data.readAt)

    const readHistory = await requestJson(server.url, '/api/notifications?readState=read&type=points.adjustment.approved', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(readHistory.status, 200)
    assert.ok(readHistory.payload.data.some((item) => item.id === notification.id))

    const allHistory = await requestJson(server.url, '/api/notifications?readState=all&resourceType=admin_review', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(allHistory.status, 200)
    assert.ok(allHistory.payload.data.some((item) => item.id === notification.id))

    const afterRead = await requestJson(server.url, '/api/notifications?unreadOnly=true', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(afterRead.payload.data.some((item) => item.id === notification.id), false)
  } finally {
    await server.close()
  }
})

test('point policy rollback creates an unread notification for another policy manager', async () => {
  const server = await createTestServer()
  try {
    const updated = await requestJson(server.url, '/api/admin/points/policy', {
      method: 'PUT',
      body: {
        roleLimits: { member: 0, creator: 0, publisher: 0, moderator: 250, admin: 301 },
        reasonCodes: ['support_credit', 'notification_test'],
        approvalTemplates: ['Reviewed for notification coverage.'],
      },
      token: 'demo-access.opsplus',
    })
    assert.equal(updated.status, 200)

    const history = await requestJson(server.url, '/api/admin/points/policy/history?limit=1', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    const eventId = history.payload.data[0].id

    const rollback = await requestJson(server.url, '/api/admin/points/policy/rollback', {
      body: { eventId },
      token: 'demo-access.opsplus',
    })
    assert.equal(rollback.status, 200)

    const inbox = await requestJson(server.url, '/api/notifications?unreadOnly=true', {
      method: 'GET',
      token: 'demo-access.finops',
    })
    const notification = inbox.payload.data.find((item) =>
      item.type === 'points.policy.rolled_back' &&
      item.resourceId === 'default' &&
      item.metadata?.rollbackEventId === eventId
    )
    assert.ok(notification)
    assert.match(notification.metadata.auditEventId, /^audit-/)
    assert.notEqual(notification.metadata.auditEventId, eventId)
    assert.deepEqual(notification.metadata.target, {
      page: 'admin',
      admin: {
        tab: 'Audit log',
        auditEventId: notification.metadata.auditEventId,
      },
    })
  } finally {
    await server.close()
  }
})

test('media governance policy updates notify policy managers with audit deep links', async () => {
  const server = await createTestServer()
  try {
    const updated = await requestJson(server.url, '/api/media/governance-policy', {
      method: 'PUT',
      body: {
        alerts: {
          thresholds: {
            callbackDenied: 1,
            timeout: 5,
            alertDeliveryFailed: 1,
          },
        },
      },
      token: 'demo-access.opsplus',
    })
    assert.equal(updated.status, 200)

    const inbox = await requestJson(server.url, '/api/notifications?type=media.governance_policy.updated', {
      method: 'GET',
      token: 'demo-access.finops',
    })
    const notification = inbox.payload.data.find((item) => item.resourceType === 'media_governance_policy')
    assert.ok(notification)
    assert.match(notification.metadata.auditEventId, /^audit-/)
    assert.deepEqual(notification.metadata.target, {
      page: 'admin',
      admin: {
        tab: 'Audit log',
        auditEventId: notification.metadata.auditEventId,
      },
    })
  } finally {
    await server.close()
  }
})

test('media scan callbacks and retries notify queue operators with admin deep links', async () => {
  const previousProvider = process.env.MEDIA_SCAN_PROVIDER
  const previousSecret = process.env.MEDIA_SCAN_WEBHOOK_SECRET
  process.env.MEDIA_SCAN_PROVIDER = 'webhook'
  process.env.MEDIA_SCAN_WEBHOOK_SECRET = 'scan-secret'
  const server = await createTestServer()
  try {
    const asset = await createMediaUpload(server, 'demo-access.promptlin', {
      fileName: 'manual-review-notification.pdf',
    })
    const completed = await requestJson(server.url, `/api/media/uploads/${asset.id}/complete`, {
      body: { checksum: 'sha256:notify' },
      token: 'demo-access.promptlin',
    })
    assert.equal(completed.status, 200)

    const callback = await requestJson(server.url, `/api/media/uploads/${asset.id}/scan-callback`, {
      body: {
        status: 'review',
        note: 'Needs policy review',
        externalScanId: 'scan-notify',
      },
      headers: { 'x-media-scan-secret': 'scan-secret' },
    })
    assert.equal(callback.status, 200)

    const opsInbox = await requestJson(server.url, '/api/notifications?unreadOnly=true&type=media.scan.review_required&resourceType=media_asset', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(opsInbox.status, 200)
    const reviewNotification = opsInbox.payload.data.find((item) => item.resourceId === asset.id)
    assert.ok(reviewNotification)
    assert.deepEqual(reviewNotification.metadata.target, {
      page: 'admin',
      admin: {
        tab: 'Task review',
        mediaStatus: 'review',
        mediaAssetId: asset.id,
      },
    })

    const retry = await requestJson(server.url, `/api/media/uploads/${asset.id}/scan-retry`, {
      token: 'demo-access.opsplus',
    })
    assert.equal(retry.status, 200)

    const finopsInbox = await requestJson(server.url, '/api/notifications?unreadOnly=true&type=media.scan.retry_requested&resourceType=media_asset', {
      method: 'GET',
      token: 'demo-access.finops',
    })
    const retryNotification = finopsInbox.payload.data.find((item) => item.resourceId === asset.id)
    assert.ok(retryNotification)
    assert.equal(retryNotification.metadata.target.admin.mediaStatus, 'scanning')
    assert.equal(retryNotification.metadata.target.admin.mediaAssetId, asset.id)
  } finally {
    if (previousProvider === undefined) {
      delete process.env.MEDIA_SCAN_PROVIDER
    } else {
      process.env.MEDIA_SCAN_PROVIDER = previousProvider
    }
    if (previousSecret === undefined) {
      delete process.env.MEDIA_SCAN_WEBHOOK_SECRET
    } else {
      process.env.MEDIA_SCAN_WEBHOOK_SECRET = previousSecret
    }
    await server.close()
  }
})

test('media scan alert notifications fan out to queue readers with dedupe', async () => {
  const previousProvider = process.env.MEDIA_SCAN_PROVIDER
  const previousSecret = process.env.MEDIA_SCAN_WEBHOOK_SECRET
  const previousCallbackDeniedThreshold = process.env.MEDIA_SCAN_CALLBACK_DENIED_ALERT_THRESHOLD
  const previousAlertDeliveryFailedThreshold = process.env.MEDIA_SCAN_ALERT_DELIVERY_FAILED_ALERT_THRESHOLD
  const previousAlertWebhookUrl = process.env.MEDIA_SCAN_ALERT_WEBHOOK_URL
  const previousAlertWebhookSecret = process.env.MEDIA_SCAN_ALERT_WEBHOOK_SECRET
  const previousAlertSlackWebhookUrl = process.env.MEDIA_SCAN_ALERT_SLACK_WEBHOOK_URL
  const previousAlertEmailWebhookUrl = process.env.MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_URL
  const previousAlertEmailWebhookSecret = process.env.MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_SECRET
  const previousAlertEmailTo = process.env.MEDIA_SCAN_ALERT_EMAIL_TO
  const previousAlertEmailFrom = process.env.MEDIA_SCAN_ALERT_EMAIL_FROM
  const webhookRequests = []
  const slackRequests = []
  const emailRequests = []
  const webhookServer = http.createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8')
      webhookRequests.push({
        url: request.url,
        headers: request.headers,
        rawBody,
        body: JSON.parse(rawBody),
      })
      response.writeHead(202, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true }))
    })
  })
  const slackServer = http.createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8')
      slackRequests.push({
        url: request.url,
        headers: request.headers,
        rawBody,
        body: JSON.parse(rawBody),
      })
      response.writeHead(500, { 'content-type': 'text/plain' })
      response.end('slack unavailable')
    })
  })
  const emailServer = http.createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8')
      emailRequests.push({
        url: request.url,
        headers: request.headers,
        rawBody,
        body: JSON.parse(rawBody),
      })
      response.writeHead(202, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ queued: true }))
    })
  })
  await new Promise((resolve) => webhookServer.listen(0, '127.0.0.1', resolve))
  await new Promise((resolve) => slackServer.listen(0, '127.0.0.1', resolve))
  await new Promise((resolve) => emailServer.listen(0, '127.0.0.1', resolve))
  const webhookPort = webhookServer.address().port
  const slackPort = slackServer.address().port
  const emailPort = emailServer.address().port
  process.env.MEDIA_SCAN_PROVIDER = 'webhook'
  process.env.MEDIA_SCAN_WEBHOOK_SECRET = 'scan-secret'
  process.env.MEDIA_SCAN_CALLBACK_DENIED_ALERT_THRESHOLD = '1'
  process.env.MEDIA_SCAN_ALERT_DELIVERY_FAILED_ALERT_THRESHOLD = '1'
  process.env.MEDIA_SCAN_ALERT_WEBHOOK_URL = `http://127.0.0.1:${webhookPort}/media-alerts`
  process.env.MEDIA_SCAN_ALERT_WEBHOOK_SECRET = 'alert-secret'
  process.env.MEDIA_SCAN_ALERT_SLACK_WEBHOOK_URL = `http://127.0.0.1:${slackPort}/slack-alerts`
  process.env.MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_URL = `http://127.0.0.1:${emailPort}/email-alerts`
  process.env.MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_SECRET = 'email-secret'
  process.env.MEDIA_SCAN_ALERT_EMAIL_TO = 'ops@example.com,security@example.com'
  process.env.MEDIA_SCAN_ALERT_EMAIL_FROM = 'alerts@example.com'
  const server = await createTestServer()
  try {
    const asset = await createMediaUpload(server, 'demo-access.promptlin', {
      fileName: 'alert-notification.pdf',
    })
    const completed = await requestJson(server.url, `/api/media/uploads/${asset.id}/complete`, {
      body: { checksum: 'sha256:alert' },
      token: 'demo-access.promptlin',
    })
    assert.equal(completed.status, 200)

    const denied = await requestJson(server.url, `/api/media/uploads/${asset.id}/scan-callback`, {
      body: { status: 'clean', externalScanId: 'scan-alert-denied' },
      headers: { 'x-media-scan-secret': 'wrong' },
    })
    assert.equal(denied.status, 403)

    const inbox = await requestJson(server.url, '/api/notifications?unreadOnly=true&type=media.scan.alert&resourceType=media_scan_alert', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(inbox.status, 200)
    const notification = inbox.payload.data.find((item) => item.resourceId === 'media-scan-alert-media.scan.callback_denied.spike')
    assert.ok(notification)
    assert.equal(notification.metadata.alertType, 'media.scan.callback_denied.spike')
    assert.equal(notification.metadata.severity, 'critical')
    assert.deepEqual(notification.metadata.target, {
      page: 'admin',
      admin: {
        tab: 'Task review',
        mediaStatus: null,
        mediaAssetId: asset.id,
      },
    })
    assert.equal(webhookRequests.length, 1)
    assert.equal(webhookRequests[0].url, '/media-alerts')
    assert.equal(webhookRequests[0].body.type, 'media.scan.alert')
    assert.equal(webhookRequests[0].body.alert.type, 'media.scan.callback_denied.spike')
    assert.equal(webhookRequests[0].headers['x-media-scan-alert-id'], 'media-scan-alert-media.scan.callback_denied.spike')
    assert.equal(
      webhookRequests[0].headers['x-media-scan-alert-signature'],
      `sha256=${createHmac('sha256', 'alert-secret').update(webhookRequests[0].rawBody).digest('hex')}`,
    )
    assert.equal(slackRequests.length, 1)
    assert.equal(slackRequests[0].url, '/slack-alerts')
    assert.match(slackRequests[0].body.text, /Scanner callback authentication failures|denied scanner callbacks/)
    assert.equal(slackRequests[0].body.blocks[0].type, 'section')
    assert.match(slackRequests[0].body.blocks[1].elements[0].text, /Severity: critical/)
    assert.equal(emailRequests.length, 1)
    assert.equal(emailRequests[0].url, '/email-alerts')
    assert.deepEqual(emailRequests[0].body.to, ['ops@example.com', 'security@example.com'])
    assert.equal(emailRequests[0].body.from, 'alerts@example.com')
    assert.equal(emailRequests[0].body.type, 'media.scan.alert.email')
    assert.match(emailRequests[0].body.subject, /\[critical\] Scanner callback authentication failures/)
    assert.equal(emailRequests[0].body.alert.type, 'media.scan.callback_denied.spike')
    assert.equal(emailRequests[0].headers['x-media-scan-alert-id'], 'media-scan-alert-media.scan.callback_denied.spike')
    assert.equal(
      emailRequests[0].headers['x-media-scan-alert-signature'],
      `sha256=${createHmac('sha256', 'email-secret').update(emailRequests[0].rawBody).digest('hex')}`,
    )

    const dispatchAudit = await requestJson(server.url, '/api/admin/audit?action=media.scan.alert.dispatch&resourceType=media_scan_alert', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(dispatchAudit.status, 200)
    const dispatchEvents = dispatchAudit.payload.data.filter((event) => event.resourceId === 'media-scan-alert-media.scan.callback_denied.spike')
    const webhookDispatchEvent = dispatchEvents.find((event) => event.metadata.channel === 'webhook')
    const slackDispatchEvent = dispatchEvents.find((event) => event.metadata.channel === 'slack')
    const emailDispatchEvent = dispatchEvents.find((event) => event.metadata.channel === 'email')
    assert.ok(webhookDispatchEvent)
    assert.equal(webhookDispatchEvent.metadata.status, 'sent')
    assert.equal(webhookDispatchEvent.metadata.statusCode, 202)
    assert.ok(slackDispatchEvent)
    assert.equal(slackDispatchEvent.metadata.status, 'failed')
    assert.equal(slackDispatchEvent.metadata.statusCode, 500)
    assert.ok(emailDispatchEvent)
    assert.equal(emailDispatchEvent.metadata.status, 'sent')
    assert.equal(emailDispatchEvent.metadata.statusCode, 202)

    const scanAlerts = await requestJson(server.url, '/api/media/scan-alerts', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(scanAlerts.status, 200)
    const deliveryAlert = scanAlerts.payload.data.find((alert) => alert.type === 'media.scan.alert_delivery_failed.spike')
    assert.ok(deliveryAlert)
    assert.equal(deliveryAlert.count, 1)
    assert.equal(deliveryAlert.threshold, 1)
    assert.deepEqual(deliveryAlert.metadata.recentChannels, ['slack'])

    const deniedAgain = await requestJson(server.url, `/api/media/uploads/${asset.id}/scan-callback`, {
      body: { status: 'clean', externalScanId: 'scan-alert-denied-again' },
      headers: { 'x-media-scan-secret': 'wrong' },
    })
    assert.equal(deniedAgain.status, 403)

    const afterDuplicate = await requestJson(server.url, '/api/notifications?unreadOnly=true&type=media.scan.alert&resourceType=media_scan_alert', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(afterDuplicate.status, 200)
    assert.equal(
      afterDuplicate.payload.data.filter((item) => item.resourceId === 'media-scan-alert-media.scan.callback_denied.spike').length,
      1,
    )
    assert.equal(webhookRequests.length, 2)
    assert.equal(webhookRequests.filter((item) => item.body.alert.type === 'media.scan.callback_denied.spike').length, 1)
    assert.equal(webhookRequests[1].body.alert.type, 'media.scan.alert_delivery_failed.spike')
    assert.equal(slackRequests.length, 2)
    assert.equal(slackRequests.filter((item) => item.body.text.includes('Scanner callback authentication failures')).length, 1)
    assert.match(slackRequests[1].body.text, /Scanner alert delivery failures/)
    assert.equal(emailRequests.length, 2)
    assert.equal(emailRequests.filter((item) => item.body.alert.type === 'media.scan.callback_denied.spike').length, 1)
    assert.equal(emailRequests[1].body.alert.type, 'media.scan.alert_delivery_failed.spike')
  } finally {
    if (previousProvider === undefined) {
      delete process.env.MEDIA_SCAN_PROVIDER
    } else {
      process.env.MEDIA_SCAN_PROVIDER = previousProvider
    }
    if (previousSecret === undefined) {
      delete process.env.MEDIA_SCAN_WEBHOOK_SECRET
    } else {
      process.env.MEDIA_SCAN_WEBHOOK_SECRET = previousSecret
    }
    if (previousCallbackDeniedThreshold === undefined) {
      delete process.env.MEDIA_SCAN_CALLBACK_DENIED_ALERT_THRESHOLD
    } else {
      process.env.MEDIA_SCAN_CALLBACK_DENIED_ALERT_THRESHOLD = previousCallbackDeniedThreshold
    }
    if (previousAlertDeliveryFailedThreshold === undefined) {
      delete process.env.MEDIA_SCAN_ALERT_DELIVERY_FAILED_ALERT_THRESHOLD
    } else {
      process.env.MEDIA_SCAN_ALERT_DELIVERY_FAILED_ALERT_THRESHOLD = previousAlertDeliveryFailedThreshold
    }
    if (previousAlertWebhookUrl === undefined) {
      delete process.env.MEDIA_SCAN_ALERT_WEBHOOK_URL
    } else {
      process.env.MEDIA_SCAN_ALERT_WEBHOOK_URL = previousAlertWebhookUrl
    }
    if (previousAlertWebhookSecret === undefined) {
      delete process.env.MEDIA_SCAN_ALERT_WEBHOOK_SECRET
    } else {
      process.env.MEDIA_SCAN_ALERT_WEBHOOK_SECRET = previousAlertWebhookSecret
    }
    if (previousAlertSlackWebhookUrl === undefined) {
      delete process.env.MEDIA_SCAN_ALERT_SLACK_WEBHOOK_URL
    } else {
      process.env.MEDIA_SCAN_ALERT_SLACK_WEBHOOK_URL = previousAlertSlackWebhookUrl
    }
    if (previousAlertEmailWebhookUrl === undefined) {
      delete process.env.MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_URL
    } else {
      process.env.MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_URL = previousAlertEmailWebhookUrl
    }
    if (previousAlertEmailWebhookSecret === undefined) {
      delete process.env.MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_SECRET
    } else {
      process.env.MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_SECRET = previousAlertEmailWebhookSecret
    }
    if (previousAlertEmailTo === undefined) {
      delete process.env.MEDIA_SCAN_ALERT_EMAIL_TO
    } else {
      process.env.MEDIA_SCAN_ALERT_EMAIL_TO = previousAlertEmailTo
    }
    if (previousAlertEmailFrom === undefined) {
      delete process.env.MEDIA_SCAN_ALERT_EMAIL_FROM
    } else {
      process.env.MEDIA_SCAN_ALERT_EMAIL_FROM = previousAlertEmailFrom
    }
    await server.close()
    await new Promise((resolve) => webhookServer.close(resolve))
    await new Promise((resolve) => slackServer.close(resolve))
    await new Promise((resolve) => emailServer.close(resolve))
  }
})

test('POST /api/notifications/read-all marks only the current user inbox as read', async () => {
  const server = await createTestServer()
  try {
    const requested = await requestJson(server.url, '/api/admin/points/adjustments', {
      body: { userHandle: 'promptlin', delta: 9103, reason: 'Notification read-all setup' },
      token: 'demo-access.opsplus',
    })
    const reviewId = requested.payload.data.review.id

    const beforeReadAll = await requestJson(server.url, '/api/notifications?unreadOnly=true', {
      method: 'GET',
      token: 'demo-access.finops',
    })
    assert.ok(beforeReadAll.payload.data.some((notification) => notification.resourceId === reviewId))

    const readAll = await requestJson(server.url, '/api/notifications/read-all', {
      token: 'demo-access.finops',
    })
    assert.equal(readAll.status, 200)
    assert.ok(readAll.payload.data.updated >= 1)

    const afterReadAll = await requestJson(server.url, '/api/notifications?unreadOnly=true', {
      method: 'GET',
      token: 'demo-access.finops',
    })
    assert.equal(afterReadAll.payload.data.some((notification) => notification.resourceId === reviewId), false)

    const requesterInbox = await requestJson(server.url, '/api/notifications?unreadOnly=true', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(requesterInbox.status, 200)
  } finally {
    await server.close()
  }
})
