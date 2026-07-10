import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import http from 'node:http'
import test from 'node:test'

import { createRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { registerAdminRoutes } from '../admin/routes.js'
import { registerMediaRoutes } from './routes.js'

const createTestServer = () => createRouteTestServer(registerMediaRoutes, registerAdminRoutes)

const validUploadBody = () => ({
  fileName: 'brief.pdf',
  contentType: 'application/pdf',
  sizeBytes: 2048,
  purpose: 'task_attachment',
  metadata: { taskId: 'task-1' },
})

const createUpload = async (server, token = 'demo-access.taskops', overrides = {}) => {
  const result = await requestJson(server.url, '/api/media/uploads', {
    body: { ...validUploadBody(), ...overrides },
    token,
  })
  assert.equal(result.status, 201)
  return result.payload.data
}

const signMediaScanCallbackBody = (secret, timestamp, body) =>
  `sha256=${createHmac('sha256', secret).update(`${timestamp}.${JSON.stringify(body)}`).digest('hex')}`

const postSignedScannerCallback = async (url, body, { webhookSecret = 'scan-secret', signatureSecret = 'callback-secret' } = {}) => {
  const timestamp = String(Date.now())
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-media-scan-secret': webhookSecret,
      'x-media-scan-timestamp': timestamp,
      'x-media-scan-signature': signMediaScanCallbackBody(signatureSecret, timestamp, body),
    },
    body: JSON.stringify(body),
  })
  return {
    status: response.status,
    payload: await response.json(),
  }
}

test('POST /api/media/uploads requires authentication', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/media/uploads', {
      body: validUploadBody(),
    })

    assert.equal(status, 401)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'AUTH_REQUIRED')
  } finally {
    await server.close()
  }
})

test('POST /api/media/uploads validates upload payloads', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/media/uploads', {
      body: { ...validUploadBody(), sizeBytes: 0 },
      token: 'demo-access.taskops',
    })

    assert.equal(status, 400)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'VALIDATION_FAILED')
    assert.equal(payload.error.message, 'sizeBytes must be an integer between 1 and 52428800')
  } finally {
    await server.close()
  }
})

test('POST /api/media/uploads enforces purpose content-type policy', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/media/uploads', {
      body: { ...validUploadBody(), contentType: 'video/mp4' },
      token: 'demo-access.taskops',
    })

    assert.equal(status, 400)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'VALIDATION_FAILED')
    assert.equal(payload.error.message, 'contentType is not allowed for task_attachment')
  } finally {
    await server.close()
  }
})

test('POST /api/media/uploads creates a pending asset and upload contract', async () => {
  const server = await createTestServer()
  try {
    const { asset, upload } = await createUpload(server)

    assert.ok(asset.id.startsWith('media-'))
    assert.equal(asset.fileName, validUploadBody().fileName)
    assert.equal(asset.contentType, validUploadBody().contentType)
    assert.equal(asset.sizeBytes, validUploadBody().sizeBytes)
    assert.equal(asset.purpose, validUploadBody().purpose)
    assert.equal(asset.status, 'pending')
    assert.equal(asset.metadata.taskId, 'task-1')
    assert.equal(upload.provider, 'mock')
    assert.equal(upload.method, 'PUT')
    assert.ok(upload.url.startsWith('mock://media/'))
    assert.equal(upload.headers['content-type'], validUploadBody().contentType)
    assert.ok(upload.expiresAt)

    const audit = await requestJson(server.url, `/api/admin/audit?action=media.upload.created&resourceType=media_asset&limit=100`, {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    const event = audit.payload.data.find((item) => item.resourceId === asset.id)
    assert.ok(event)
    assert.equal(event.metadata.purpose, 'task_attachment')
    assert.equal(event.metadata.sizeBytes, 2048)
  } finally {
    await server.close()
  }
})

test('POST /api/media/uploads/:id/complete marks owner uploads as uploaded', async () => {
  const server = await createTestServer()
  try {
    const { asset } = await createUpload(server, 'demo-access.promptlin', { purpose: 'submission_asset' })
    const { status, payload } = await requestJson(server.url, `/api/media/uploads/${asset.id}/complete`, {
      body: { checksum: 'sha256:abc123' },
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 200)
    assert.equal(payload.error, undefined)
    assert.equal(payload.data.id, asset.id)
    assert.equal(payload.data.status, 'uploaded')
    assert.equal(payload.data.metadata.checksum, 'sha256:abc123')
    assert.equal(payload.data.metadata.security.scanStatus, 'pending')
    assert.equal(payload.data.metadata.security.detectedContentType, 'application/pdf')

    const audit = await requestJson(server.url, `/api/admin/audit?action=media.upload.completed&resourceType=media_asset&limit=100`, {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    const event = audit.payload.data.find((item) => item.resourceId === asset.id)
    assert.ok(event)
    assert.equal(event.metadata.purpose, 'submission_asset')
    assert.equal(event.metadata.scanStatus, 'pending')
  } finally {
    await server.close()
  }
})

test('POST /api/media/uploads/:id/complete rejects detected content-type mismatches', async () => {
  const server = await createTestServer()
  try {
    const { asset } = await createUpload(server, 'demo-access.promptlin', { purpose: 'submission_asset' })
    const { status, payload } = await requestJson(server.url, `/api/media/uploads/${asset.id}/complete`, {
      body: { checksum: 'sha256:abc123', detectedContentType: 'image/png' },
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 200)
    assert.equal(payload.data.status, 'rejected')
    assert.equal(payload.data.metadata.security.scanStatus, 'rejected')
    assert.equal(payload.data.metadata.security.rejectionReason, 'content_type_mismatch')
  } finally {
    await server.close()
  }
})

test('POST /api/media/uploads/:id/complete hides uploads owned by another user', async () => {
  const server = await createTestServer()
  try {
    const { asset } = await createUpload(server, 'demo-access.taskops')
    const { status, payload } = await requestJson(server.url, `/api/media/uploads/${asset.id}/complete`, {
      body: { checksum: 'sha256:abc123' },
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 404)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'NOT_FOUND')
  } finally {
    await server.close()
  }
})

test('POST /api/media/uploads/:id/complete allows admin ownership bypass', async () => {
  const server = await createTestServer()
  try {
    const { asset } = await createUpload(server, 'demo-access.taskops')
    const { status, payload } = await requestJson(server.url, `/api/media/uploads/${asset.id}/complete`, {
      body: { checksum: 'sha256:admin' },
      token: 'demo-access.opsplus',
    })

    assert.equal(status, 200)
    assert.equal(payload.error, undefined)
    assert.equal(payload.data.status, 'uploaded')
  } finally {
    await server.close()
  }
})

test('media scan and private download contracts require clean assets', async () => {
  const server = await createTestServer()
  try {
    const { asset } = await createUpload(server, 'demo-access.promptlin', { purpose: 'submission_asset' })
    await requestJson(server.url, `/api/media/uploads/${asset.id}/complete`, {
      body: { checksum: 'sha256:clean' },
      token: 'demo-access.promptlin',
    })

    const pendingDownload = await requestJson(server.url, `/api/media/assets/${asset.id}/download`, {
      method: 'GET',
      token: 'demo-access.promptlin',
    })
    assert.equal(pendingDownload.status, 404)

    const scan = await requestJson(server.url, `/api/media/uploads/${asset.id}/scan`, {
      body: { decision: 'clean', note: 'AV placeholder passed' },
      token: 'demo-access.opsplus',
    })
    assert.equal(scan.status, 200)
    assert.equal(scan.payload.data.metadata.security.scanStatus, 'clean')
    assert.equal(scan.payload.data.metadata.security.scannedBy, 'opsplus')

    const download = await requestJson(server.url, `/api/media/assets/${asset.id}/download`, {
      method: 'GET',
      token: 'demo-access.promptlin',
    })
    assert.equal(download.status, 200)
    assert.equal(download.payload.data.asset.id, asset.id)
    assert.equal(download.payload.data.download.provider, 'mock')
    assert.equal(download.payload.data.download.method, 'GET')
    assert.ok(download.payload.data.download.url.startsWith('mock://media/'))

    const audit = await requestJson(server.url, `/api/admin/audit?action=media.download.signed&resourceType=media_asset&limit=100`, {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    const event = audit.payload.data.find((item) => item.resourceId === asset.id)
    assert.ok(event)
    assert.equal(event.metadata.purpose, 'submission_asset')

    const otherUserDownload = await requestJson(server.url, `/api/media/assets/${asset.id}/download`, {
      method: 'GET',
      token: 'demo-access.taskops',
    })
    assert.equal(otherUserDownload.status, 404)
  } finally {
    await server.close()
  }
})

test('media scan rejection blocks private downloads', async () => {
  const server = await createTestServer()
  try {
    const { asset } = await createUpload(server, 'demo-access.promptlin', { purpose: 'submission_asset' })
    await requestJson(server.url, `/api/media/uploads/${asset.id}/complete`, {
      body: { checksum: 'sha256:bad' },
      token: 'demo-access.promptlin',
    })
    const scan = await requestJson(server.url, `/api/media/uploads/${asset.id}/scan`, {
      body: { decision: 'reject', note: 'Unsafe placeholder result' },
      token: 'demo-access.opsplus',
    })
    assert.equal(scan.status, 200)
    assert.equal(scan.payload.data.status, 'rejected')

    const download = await requestJson(server.url, `/api/media/assets/${asset.id}/download`, {
      method: 'GET',
      token: 'demo-access.promptlin',
    })
    assert.equal(download.status, 404)
  } finally {
    await server.close()
  }
})

test('GET /api/media/review-queue requires queue read permission', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/media/review-queue', {
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

test('media scan job operations require queue permissions', async () => {
  const server = await createTestServer()
  try {
    const scanJobs = await requestJson(server.url, '/api/media/scan-jobs', {
      method: 'GET',
      token: 'demo-access.taskops',
    })
    assert.equal(scanJobs.status, 403)
    assert.equal(scanJobs.payload.error.code, 'PERMISSION_DENIED')
    assert.equal(scanJobs.payload.error.message, 'Missing permission: admin:queue:read')

    const archive = await requestJson(server.url, '/api/media/scan-jobs/archive', {
      method: 'GET',
      token: 'demo-access.taskops',
    })
    assert.equal(archive.status, 403)
    assert.equal(archive.payload.error.code, 'PERMISSION_DENIED')
    assert.equal(archive.payload.error.message, 'Missing permission: admin:queue:read')

    const writeArchive = await requestJson(server.url, '/api/media/scan-jobs/archive', {
      token: 'demo-access.taskops',
    })
    assert.equal(writeArchive.status, 403)
    assert.equal(writeArchive.payload.error.code, 'PERMISSION_DENIED')
    assert.equal(writeArchive.payload.error.message, 'Missing permission: admin:queue:review')

    const retry = await requestJson(server.url, '/api/media/uploads/media-missing/scan-retry', {
      token: 'demo-access.taskops',
    })
    assert.equal(retry.status, 403)
    assert.equal(retry.payload.error.code, 'PERMISSION_DENIED')
    assert.equal(retry.payload.error.message, 'Missing permission: admin:queue:review')

    const sweep = await requestJson(server.url, '/api/media/scan-jobs/sweep', {
      token: 'demo-access.taskops',
    })
    assert.equal(sweep.status, 403)
    assert.equal(sweep.payload.error.code, 'PERMISSION_DENIED')
    assert.equal(sweep.payload.error.message, 'Missing permission: admin:queue:review')

    const alerts = await requestJson(server.url, '/api/media/scan-alerts', {
      method: 'GET',
      token: 'demo-access.taskops',
    })
    assert.equal(alerts.status, 403)
    assert.equal(alerts.payload.error.code, 'PERMISSION_DENIED')
    assert.equal(alerts.payload.error.message, 'Missing permission: admin:queue:read')

    const config = await requestJson(server.url, '/api/media/governance-config', {
      method: 'GET',
      token: 'demo-access.taskops',
    })
    assert.equal(config.status, 403)
    assert.equal(config.payload.error.code, 'PERMISSION_DENIED')
    assert.equal(config.payload.error.message, 'Missing permission: admin:queue:read')

    const updatePolicy = await requestJson(server.url, '/api/media/governance-policy', {
      method: 'PUT',
      body: { scanner: { timeoutSeconds: 30 } },
      token: 'demo-access.taskops',
    })
    assert.equal(updatePolicy.status, 403)
    assert.equal(updatePolicy.payload.error.code, 'PERMISSION_DENIED')
    assert.equal(updatePolicy.payload.error.message, 'Missing permission: admin:permissions:manage')

    const policyHistory = await requestJson(server.url, '/api/media/governance-policy/history', {
      method: 'GET',
      token: 'demo-access.taskops',
    })
    assert.equal(policyHistory.status, 403)
    assert.equal(policyHistory.payload.error.code, 'PERMISSION_DENIED')
    assert.equal(policyHistory.payload.error.message, 'Missing permission: admin:queue:read')

    const rollbackPolicy = await requestJson(server.url, '/api/media/governance-policy/rollback', {
      body: { eventId: 'audit-missing' },
      token: 'demo-access.taskops',
    })
    assert.equal(rollbackPolicy.status, 403)
    assert.equal(rollbackPolicy.payload.error.code, 'PERMISSION_DENIED')
    assert.equal(rollbackPolicy.payload.error.message, 'Missing permission: admin:permissions:manage')

    const alertEvents = await requestJson(server.url, '/api/media/scan-alerts/media-scan-alert-media.scan.callback_denied.spike/events', {
      method: 'GET',
      token: 'demo-access.taskops',
    })
    assert.equal(alertEvents.status, 403)
    assert.equal(alertEvents.payload.error.code, 'PERMISSION_DENIED')
    assert.equal(alertEvents.payload.error.message, 'Missing permission: admin:queue:read')

    const acknowledgeAlert = await requestJson(server.url, '/api/media/scan-alerts/media-scan-alert-media.scan.callback_denied.spike/acknowledge', {
      token: 'demo-access.taskops',
    })
    assert.equal(acknowledgeAlert.status, 403)
    assert.equal(acknowledgeAlert.payload.error.code, 'PERMISSION_DENIED')
    assert.equal(acknowledgeAlert.payload.error.message, 'Missing permission: admin:queue:review')
  } finally {
    await server.close()
  }
})

test('GET /api/media/governance-config returns safe scanner policy state', async () => {
  const previous = {
    provider: process.env.MEDIA_SCAN_PROVIDER,
    secret: process.env.MEDIA_SCAN_WEBHOOK_SECRET,
    requestUrl: process.env.MEDIA_SCAN_REQUEST_URL,
    requestSecret: process.env.MEDIA_SCAN_REQUEST_SECRET,
    callbackBaseUrl: process.env.MEDIA_SCAN_CALLBACK_BASE_URL,
    callbackSignatureSecret: process.env.MEDIA_SCAN_CALLBACK_SIGNATURE_SECRET,
    alertWebhookUrl: process.env.MEDIA_SCAN_ALERT_WEBHOOK_URL,
    alertWebhookSecret: process.env.MEDIA_SCAN_ALERT_WEBHOOK_SECRET,
    alertEmailUrl: process.env.MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_URL,
    alertEmailSecret: process.env.MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_SECRET,
    alertEmailTo: process.env.MEDIA_SCAN_ALERT_EMAIL_TO,
  }
  process.env.MEDIA_SCAN_PROVIDER = 'webhook'
  process.env.MEDIA_SCAN_WEBHOOK_SECRET = 'scan-secret'
  process.env.MEDIA_SCAN_REQUEST_URL = 'https://scanner.example.com/jobs'
  process.env.MEDIA_SCAN_REQUEST_SECRET = 'request-secret'
  process.env.MEDIA_SCAN_CALLBACK_BASE_URL = 'https://api.example.com'
  process.env.MEDIA_SCAN_CALLBACK_SIGNATURE_SECRET = 'callback-secret'
  process.env.MEDIA_SCAN_ALERT_WEBHOOK_URL = 'https://ops.example.com/media-alerts'
  process.env.MEDIA_SCAN_ALERT_WEBHOOK_SECRET = 'alert-secret'
  process.env.MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_URL = 'https://mailer.example.com/alerts'
  process.env.MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_SECRET = 'email-secret'
  process.env.MEDIA_SCAN_ALERT_EMAIL_TO = 'ops@example.com,security@example.com'
  const server = await createTestServer()
  try {
    const config = await requestJson(server.url, '/api/media/governance-config', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(config.status, 200)
    assert.equal(config.payload.data.scanner.provider, 'webhook')
    assert.equal(config.payload.data.scanner.requestDispatchConfigured, true)
    assert.equal(config.payload.data.scanner.requestSigningConfigured, true)
    assert.equal(config.payload.data.scanner.callbackSignatureConfigured, true)
    assert.equal(config.payload.data.alerts.channels.webhook.configured, true)
    assert.equal(config.payload.data.alerts.channels.webhook.signed, true)
    assert.equal(config.payload.data.alerts.channels.email.configured, true)
    assert.equal(config.payload.data.alerts.channels.email.recipientCount, 2)
    assert.equal(JSON.stringify(config.payload.data).includes('scanner.example.com'), false)
    assert.equal(JSON.stringify(config.payload.data).includes('secret'), false)

    const invalid = await requestJson(server.url, '/api/media/governance-policy', {
      method: 'PUT',
      body: { alerts: { thresholds: { timeout: 0 } } },
      token: 'demo-access.opsplus',
    })
    assert.equal(invalid.status, 400)
    assert.equal(invalid.payload.error.code, 'VALIDATION_FAILED')
    assert.equal(invalid.payload.error.message, 'timeout must be a positive integer')

    const updated = await requestJson(server.url, '/api/media/governance-policy', {
      method: 'PUT',
      body: {
        scanner: {
          timeoutSeconds: 45,
          maxAttempts: 5,
        },
        retention: {
          historyRetentionDays: 30,
          historyRetentionMaxPerAsset: 8,
        },
        alerts: {
          windowMinutes: 15,
          thresholds: {
            timeout: 4,
            alertDeliveryFailed: 7,
          },
        },
      },
      token: 'demo-access.opsplus',
    })
    assert.equal(updated.status, 200)
    assert.equal(updated.payload.data.scanner.timeoutSeconds, 45)
    assert.equal(updated.payload.data.scanner.maxAttempts, 5)
    assert.equal(updated.payload.data.retention.historyRetentionDays, 30)
    assert.equal(updated.payload.data.retention.historyRetentionMaxPerAsset, 8)
    assert.equal(updated.payload.data.alerts.windowMinutes, 15)
    assert.equal(updated.payload.data.alerts.thresholds.timeout, 4)
    assert.equal(updated.payload.data.alerts.thresholds.alertDeliveryFailed, 7)

    const afterUpdate = await requestJson(server.url, '/api/media/governance-config', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(afterUpdate.status, 200)
    assert.equal(afterUpdate.payload.data.scanner.timeoutSeconds, 45)
    assert.equal(afterUpdate.payload.data.alerts.thresholds.timeout, 4)

    const history = await requestJson(server.url, '/api/media/governance-policy/history?limit=5', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(history.status, 200)
    assert.ok(history.payload.data.length >= 1)
    assert.equal(history.payload.data[0].action, 'media.governance_policy.updated')
    assert.equal(history.payload.data[0].next.scanner.timeoutSeconds, 45)
    assert.equal(history.payload.data[0].next.scanner.maxAttempts, 5)
    assert.equal(history.payload.data[0].diff.scanner.timeoutSeconds.to, 45)
    assert.match(history.payload.data[0].summary, /scanner\.timeoutSeconds/)

    const rollback = await requestJson(server.url, '/api/media/governance-policy/rollback', {
      body: { eventId: history.payload.data[0].id },
      token: 'demo-access.opsplus',
    })
    assert.equal(rollback.status, 200)
    assert.equal(rollback.payload.data.scanner.timeoutSeconds, history.payload.data[0].previous.scanner.timeoutSeconds)
    assert.equal(rollback.payload.data.scanner.maxAttempts, history.payload.data[0].previous.scanner.maxAttempts)

    const afterRollback = await requestJson(server.url, '/api/media/governance-config', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(afterRollback.status, 200)
    assert.equal(afterRollback.payload.data.scanner.timeoutSeconds, rollback.payload.data.scanner.timeoutSeconds)
    assert.equal(afterRollback.payload.data.scanner.maxAttempts, rollback.payload.data.scanner.maxAttempts)
  } finally {
    for (const [key, value] of Object.entries({
      MEDIA_SCAN_PROVIDER: previous.provider,
      MEDIA_SCAN_WEBHOOK_SECRET: previous.secret,
      MEDIA_SCAN_REQUEST_URL: previous.requestUrl,
      MEDIA_SCAN_REQUEST_SECRET: previous.requestSecret,
      MEDIA_SCAN_CALLBACK_BASE_URL: previous.callbackBaseUrl,
      MEDIA_SCAN_CALLBACK_SIGNATURE_SECRET: previous.callbackSignatureSecret,
      MEDIA_SCAN_ALERT_WEBHOOK_URL: previous.alertWebhookUrl,
      MEDIA_SCAN_ALERT_WEBHOOK_SECRET: previous.alertWebhookSecret,
      MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_URL: previous.alertEmailUrl,
      MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_SECRET: previous.alertEmailSecret,
      MEDIA_SCAN_ALERT_EMAIL_TO: previous.alertEmailTo,
    })) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    await server.close()
  }
})

test('GET /api/media/scan-jobs/archive returns a retention manifest for queue readers', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/media/scan-jobs/archive?limit=25', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })

    assert.equal(status, 200)
    assert.equal(payload.data.mode, 'candidate_manifest')
    assert.equal(payload.data.limit, 25)
    assert.equal(payload.data.nextCursor, null)
    assert.ok(Array.isArray(payload.data.items))
    assert.ok(Array.isArray(payload.data.deleteBoundary.inactiveStatuses))
    assert.ok(payload.data.deleteBoundary.inactiveStatuses.includes('completed'))
    assert.ok(payload.data.deleteBoundary.activeStatusesRetained.includes('queued'))
    assert.equal(typeof payload.data.retention.days, 'number')
    assert.equal(typeof payload.data.retention.maxPerAsset, 'number')
  } finally {
    await server.close()
  }
})

test('POST /api/media/scan-jobs/archive writes a manifest and records audit metadata', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/media/scan-jobs/archive?limit=25', {
      token: 'demo-access.opsplus',
    })

    assert.equal(status, 200)
    assert.equal(payload.data.mode, 'candidate_manifest')
    assert.equal(payload.data.limit, 25)
    assert.equal(payload.data.storage.provider, 'mock')
    assert.ok(payload.data.storage.storageKey.startsWith('archives/media-scan-jobs/'))
    assert.equal(typeof payload.data.storage.bytes, 'number')

    const audit = await requestJson(server.url, '/api/admin/audit?action=media.scan.history_archived&resourceType=media_scan_jobs&limit=1', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(audit.status, 200)
    assert.equal(audit.payload.data[0].action, 'media.scan.history_archived')
    assert.equal(audit.payload.data[0].metadata.storageKey, payload.data.storage.storageKey)
    assert.equal(audit.payload.data[0].metadata.provider, 'mock')
  } finally {
    await server.close()
  }
})

test('mock media scanner feeds the review queue and clean/rejected history', async () => {
  const previousProvider = process.env.MEDIA_SCAN_PROVIDER
  process.env.MEDIA_SCAN_PROVIDER = 'mock'
  const server = await createTestServer()
  try {
    const review = await createUpload(server, 'demo-access.promptlin', {
      fileName: 'manual-review-brief.pdf',
      purpose: 'submission_asset',
    })
    const clean = await createUpload(server, 'demo-access.promptlin', {
      fileName: 'clean-brief.pdf',
      purpose: 'submission_asset',
    })
    const rejected = await createUpload(server, 'demo-access.promptlin', {
      fileName: 'malware-brief.pdf',
      purpose: 'submission_asset',
    })

    const completedReview = await requestJson(server.url, `/api/media/uploads/${review.asset.id}/complete`, {
      body: { checksum: 'sha256:review' },
      token: 'demo-access.promptlin',
    })
    const completedClean = await requestJson(server.url, `/api/media/uploads/${clean.asset.id}/complete`, {
      body: { checksum: 'sha256:clean' },
      token: 'demo-access.promptlin',
    })
    const completedRejected = await requestJson(server.url, `/api/media/uploads/${rejected.asset.id}/complete`, {
      body: { checksum: 'sha256:reject' },
      token: 'demo-access.promptlin',
    })

    assert.equal(completedReview.payload.data.metadata.security.scanStatus, 'review')
    assert.equal(completedClean.payload.data.metadata.security.scanStatus, 'clean')
    assert.equal(completedRejected.payload.data.metadata.security.scanStatus, 'rejected')
    assert.equal(completedRejected.payload.data.status, 'rejected')

    const reviewQueue = await requestJson(server.url, '/api/media/review-queue?status=review&purpose=submission_asset', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(reviewQueue.status, 200)
    assert.ok(reviewQueue.payload.data.some((asset) => asset.id === review.asset.id))
    assert.equal(reviewQueue.payload.data.some((asset) => asset.id === clean.asset.id), false)

    const rejectedQueue = await requestJson(server.url, '/api/media/review-queue?status=rejected&search=malware', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(rejectedQueue.status, 200)
    assert.ok(rejectedQueue.payload.data.some((asset) => asset.id === rejected.asset.id))
  } finally {
    if (previousProvider === undefined) {
      delete process.env.MEDIA_SCAN_PROVIDER
    } else {
      process.env.MEDIA_SCAN_PROVIDER = previousProvider
    }
    await server.close()
  }
})

test('webhook media scanner records callback results and gates downloads', async () => {
  const previousProvider = process.env.MEDIA_SCAN_PROVIDER
  const previousSecret = process.env.MEDIA_SCAN_WEBHOOK_SECRET
  process.env.MEDIA_SCAN_PROVIDER = 'webhook'
  process.env.MEDIA_SCAN_WEBHOOK_SECRET = 'scan-secret'
  const server = await createTestServer()
  try {
    const policy = await requestJson(server.url, '/api/media/governance-policy', {
      method: 'PUT',
      body: { alerts: { thresholds: { callbackDenied: 2 } } },
      token: 'demo-access.opsplus',
    })
    assert.equal(policy.status, 200)
    assert.equal(policy.payload.data.alerts.thresholds.callbackDenied, 2)

    const { asset } = await createUpload(server, 'demo-access.promptlin', {
      fileName: 'external-scan-brief.pdf',
      purpose: 'submission_asset',
    })
    const completed = await requestJson(server.url, `/api/media/uploads/${asset.id}/complete`, {
      body: { checksum: 'sha256:webhook' },
      token: 'demo-access.promptlin',
    })
    assert.equal(completed.status, 200)
    assert.equal(completed.payload.data.status, 'uploaded')
    assert.equal(completed.payload.data.metadata.security.scanProvider, 'webhook')
    assert.equal(completed.payload.data.metadata.security.scanStatus, 'scanning')
    assert.ok(completed.payload.data.metadata.security.externalScanId)
    assert.equal(completed.payload.data.metadata.security.scanJobStatus, 'queued')
    assert.equal(completed.payload.data.metadata.security.scanAttempts, 1)

    const activeJobs = await requestJson(server.url, '/api/media/scan-jobs?status=active&search=external-scan', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(activeJobs.status, 200)
    assert.ok(activeJobs.payload.data.some((item) => item.id === asset.id))

    const history = await requestJson(server.url, `/api/media/uploads/${asset.id}/scan-jobs?limit=1`, {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(history.status, 200)
    assert.deepEqual(history.payload.meta.pagination, {
      limit: 1,
      nextCursor: null,
    })
    assert.equal(history.payload.data[0].assetId, asset.id)
    assert.equal(history.payload.data[0].status, 'queued')
    assert.equal(history.payload.data[0].scanStatus, 'scanning')
    assert.equal(history.payload.data[0].attempts, 1)

    const deniedHistory = await requestJson(server.url, `/api/media/uploads/${asset.id}/scan-jobs`, {
      method: 'GET',
      token: 'demo-access.promptlin',
    })
    assert.equal(deniedHistory.status, 403)
    assert.equal(deniedHistory.payload.error.code, 'PERMISSION_DENIED')

    const blockedDownload = await requestJson(server.url, `/api/media/assets/${asset.id}/download`, {
      method: 'GET',
      token: 'demo-access.promptlin',
    })
    assert.equal(blockedDownload.status, 404)

    const deniedCallback = await requestJson(server.url, `/api/media/uploads/${asset.id}/scan-callback`, {
      body: { status: 'clean', externalScanId: 'scan-ok' },
      headers: { 'x-media-scan-secret': 'wrong' },
    })
    assert.equal(deniedCallback.status, 403)
    assert.equal(deniedCallback.payload.error.code, 'PERMISSION_DENIED')

    const scanAlertsBeforeThreshold = await requestJson(server.url, '/api/media/scan-alerts', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(scanAlertsBeforeThreshold.status, 200)
    assert.equal(scanAlertsBeforeThreshold.payload.data.some((alert) =>
      alert.type === 'media.scan.callback_denied.spike'
    ), false)

    const secondDeniedCallback = await requestJson(server.url, `/api/media/uploads/${asset.id}/scan-callback`, {
      body: { status: 'clean', externalScanId: 'scan-ok' },
      headers: { 'x-media-scan-secret': 'wrong-again' },
    })
    assert.equal(secondDeniedCallback.status, 403)
    assert.equal(secondDeniedCallback.payload.error.code, 'PERMISSION_DENIED')

    const scanAlerts = await requestJson(server.url, '/api/media/scan-alerts', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(scanAlerts.status, 200)
    assert.ok(scanAlerts.payload.data.some((alert) =>
      alert.type === 'media.scan.callback_denied.spike' &&
      alert.severity === 'critical' &&
      alert.count >= 2 &&
      alert.threshold === 2 &&
      alert.state === 'active',
    ))
    const scanAlert = scanAlerts.payload.data.find((alert) => alert.type === 'media.scan.callback_denied.spike')

    const alertEvents = await requestJson(server.url, `/api/media/scan-alerts/${scanAlert.id}/events`, {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(alertEvents.status, 200)
    assert.ok(alertEvents.payload.data.some((event) =>
      event.action === 'media.scan.callback_denied' &&
      event.resourceType === 'media_asset' &&
      event.resourceId === asset.id &&
      event.metadata.reason === 'Invalid media scan callback secret'
    ))

    const missingAlertEvents = await requestJson(server.url, '/api/media/scan-alerts/media-scan-alert-missing/events', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(missingAlertEvents.status, 404)

    const invalidSilence = await requestJson(server.url, `/api/media/scan-alerts/${scanAlert.id}/silence`, {
      body: { until: '2020-01-01T00:00:00.000Z' },
      token: 'demo-access.opsplus',
    })
    assert.equal(invalidSilence.status, 400)
    assert.equal(invalidSilence.payload.error.code, 'VALIDATION_FAILED')

    const acknowledged = await requestJson(server.url, `/api/media/scan-alerts/${scanAlert.id}/acknowledge`, {
      body: { note: 'Investigating scanner callback credentials.' },
      token: 'demo-access.opsplus',
    })
    assert.equal(acknowledged.status, 200)
    assert.equal(acknowledged.payload.data.state, 'acknowledged')
    assert.equal(acknowledged.payload.data.acknowledgedBy, 'opsplus')
    assert.equal(acknowledged.payload.data.acknowledgementNote, 'Investigating scanner callback credentials.')

    const silencedUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const silenced = await requestJson(server.url, `/api/media/scan-alerts/${scanAlert.id}/silence`, {
      body: { until: silencedUntil, note: 'Suppress while rotating scanner secret.' },
      token: 'demo-access.opsplus',
    })
    assert.equal(silenced.status, 200)
    assert.equal(silenced.payload.data.state, 'silenced')
    assert.equal(silenced.payload.data.silencedBy, 'opsplus')
    assert.equal(silenced.payload.data.silencedUntil, silencedUntil)

    const listedSilenced = await requestJson(server.url, '/api/media/scan-alerts', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(listedSilenced.status, 200)
    assert.equal(
      listedSilenced.payload.data.find((alert) => alert.id === scanAlert.id).state,
      'silenced',
    )

    const unsilenced = await requestJson(server.url, `/api/media/scan-alerts/${scanAlert.id}/unsilence`, {
      body: { note: 'Scanner callback credentials fixed.' },
      token: 'demo-access.opsplus',
    })
    assert.equal(unsilenced.status, 200)
    assert.equal(unsilenced.payload.data.state, 'acknowledged')
    assert.equal(unsilenced.payload.data.silencedUntil, null)

    const callback = await requestJson(server.url, `/api/media/uploads/${asset.id}/scan-callback`, {
      body: {
        status: 'clean',
        note: 'Vendor passed',
        detectedContentType: 'application/pdf',
        externalScanId: 'scan-ok',
      },
      headers: { 'x-media-scan-secret': 'scan-secret' },
    })
    assert.equal(callback.status, 200)
    assert.equal(callback.payload.data.status, 'uploaded')
    assert.equal(callback.payload.data.metadata.security.scanStatus, 'clean')
    assert.equal(callback.payload.data.metadata.security.externalScanId, 'scan-ok')
    assert.equal(callback.payload.data.metadata.security.scanJobStatus, 'completed')
    assert.ok(callback.payload.data.metadata.security.callbackReceivedAt)

    const download = await requestJson(server.url, `/api/media/assets/${asset.id}/download`, {
      method: 'GET',
      token: 'demo-access.promptlin',
    })
    assert.equal(download.status, 200)
    assert.equal(download.payload.data.asset.id, asset.id)

    const completedJobs = await requestJson(server.url, '/api/media/scan-jobs?status=completed&search=scan-ok', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(completedJobs.status, 200)
    assert.ok(completedJobs.payload.data.some((item) => item.id === asset.id))

    const retry = await requestJson(server.url, `/api/media/uploads/${asset.id}/scan-retry`, {
      token: 'demo-access.opsplus',
    })
    assert.equal(retry.status, 200)
    assert.equal(retry.payload.data.metadata.security.scanStatus, 'scanning')
    assert.equal(retry.payload.data.metadata.security.scanJobStatus, 'retrying')
    assert.equal(retry.payload.data.metadata.security.scanAttempts, 2)
    assert.notEqual(retry.payload.data.metadata.security.externalScanId, 'scan-ok')

    const retriedHistory = await requestJson(server.url, `/api/media/uploads/${asset.id}/scan-jobs`, {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(retriedHistory.status, 200)
    assert.deepEqual(retriedHistory.payload.meta.pagination, {
      limit: 10,
      nextCursor: null,
    })
    assert.equal(retriedHistory.payload.data[0].status, 'retrying')
    assert.equal(retriedHistory.payload.data[0].attempts, 2)
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

test('webhook media scanner dispatches scan requests when configured', async () => {
  const previousProvider = process.env.MEDIA_SCAN_PROVIDER
  const previousSecret = process.env.MEDIA_SCAN_WEBHOOK_SECRET
  const previousRequestUrl = process.env.MEDIA_SCAN_REQUEST_URL
  const previousRequestSecret = process.env.MEDIA_SCAN_REQUEST_SECRET
  const previousRequestAdapter = process.env.MEDIA_SCAN_REQUEST_ADAPTER
  const previousCallbackBaseUrl = process.env.MEDIA_SCAN_CALLBACK_BASE_URL
  let scannerRequest = null
  const scanner = http.createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    const rawBody = Buffer.concat(chunks).toString('utf8')
    scannerRequest = {
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: JSON.parse(rawBody),
    }
    response.writeHead(202, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ accepted: true }))
  })
  await new Promise((resolve) => scanner.listen(0, '127.0.0.1', resolve))
  const scannerPort = scanner.address().port
  process.env.MEDIA_SCAN_PROVIDER = 'webhook'
  process.env.MEDIA_SCAN_WEBHOOK_SECRET = 'scan-secret'
  process.env.MEDIA_SCAN_REQUEST_SECRET = 'request-secret'
  process.env.MEDIA_SCAN_REQUEST_ADAPTER = 'generic-webhook'
  process.env.MEDIA_SCAN_REQUEST_URL = `http://127.0.0.1:${scannerPort}/scan-jobs`
  process.env.MEDIA_SCAN_CALLBACK_BASE_URL = 'https://api.example.test'
  const server = await createTestServer()
  try {
    const { asset } = await createUpload(server, 'demo-access.promptlin', {
      fileName: 'dispatch-scan-brief.pdf',
      purpose: 'submission_asset',
    })
    const completed = await requestJson(server.url, `/api/media/uploads/${asset.id}/complete`, {
      body: { checksum: 'sha256:dispatch' },
      token: 'demo-access.promptlin',
    })
    assert.equal(completed.status, 200)
    assert.equal(completed.payload.data.metadata.security.scanDispatchStatus, 'sent')
    assert.equal(completed.payload.data.metadata.security.scanDispatchStatusCode, 202)
    assert.equal(completed.payload.data.metadata.security.scanRequestAdapter, 'generic-webhook')
    assert.ok(completed.payload.data.metadata.security.scanDispatchRequestedAt)
    assert.equal(scannerRequest.method, 'POST')
    assert.equal(scannerRequest.url, '/scan-jobs')
    assert.equal(scannerRequest.body.scanId, completed.payload.data.metadata.security.externalScanId)
    assert.equal(scannerRequest.body.adapter, 'generic-webhook')
    assert.equal(scannerRequest.body.callbackUrl, `https://api.example.test/api/media/uploads/${asset.id}/scan-callback`)
    assert.equal(scannerRequest.body.asset.id, asset.id)
    assert.equal(scannerRequest.headers['x-media-scan-id'], completed.payload.data.metadata.security.externalScanId)
    assert.equal(scannerRequest.headers['x-media-scan-adapter'], 'generic-webhook')
    assert.match(scannerRequest.headers['x-media-scan-signature'], /^sha256=[a-f0-9]{64}$/)
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
    if (previousRequestUrl === undefined) {
      delete process.env.MEDIA_SCAN_REQUEST_URL
    } else {
      process.env.MEDIA_SCAN_REQUEST_URL = previousRequestUrl
    }
    if (previousRequestSecret === undefined) {
      delete process.env.MEDIA_SCAN_REQUEST_SECRET
    } else {
      process.env.MEDIA_SCAN_REQUEST_SECRET = previousRequestSecret
    }
    if (previousRequestAdapter === undefined) {
      delete process.env.MEDIA_SCAN_REQUEST_ADAPTER
    } else {
      process.env.MEDIA_SCAN_REQUEST_ADAPTER = previousRequestAdapter
    }
    if (previousCallbackBaseUrl === undefined) {
      delete process.env.MEDIA_SCAN_CALLBACK_BASE_URL
    } else {
      process.env.MEDIA_SCAN_CALLBACK_BASE_URL = previousCallbackBaseUrl
    }
    await server.close()
    await new Promise((resolve) => scanner.close(resolve))
  }
})

test('webhook media scanner dispatches ClamAV HTTP adapter payloads', async () => {
  const previousProvider = process.env.MEDIA_SCAN_PROVIDER
  const previousSecret = process.env.MEDIA_SCAN_WEBHOOK_SECRET
  const previousRequestUrl = process.env.MEDIA_SCAN_REQUEST_URL
  const previousRequestSecret = process.env.MEDIA_SCAN_REQUEST_SECRET
  const previousRequestAdapter = process.env.MEDIA_SCAN_REQUEST_ADAPTER
  const previousCallbackBaseUrl = process.env.MEDIA_SCAN_CALLBACK_BASE_URL
  let scannerRequest = null
  const scanner = http.createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    const rawBody = Buffer.concat(chunks).toString('utf8')
    scannerRequest = {
      method: request.method,
      url: request.url,
      headers: request.headers,
      rawBody,
      body: JSON.parse(rawBody),
    }
    response.writeHead(202, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ accepted: true }))
  })
  await new Promise((resolve) => scanner.listen(0, '127.0.0.1', resolve))
  const scannerPort = scanner.address().port
  process.env.MEDIA_SCAN_PROVIDER = 'webhook'
  process.env.MEDIA_SCAN_WEBHOOK_SECRET = 'scan-secret'
  process.env.MEDIA_SCAN_REQUEST_SECRET = 'clamav-request-secret'
  process.env.MEDIA_SCAN_REQUEST_ADAPTER = 'clamav-http'
  process.env.MEDIA_SCAN_REQUEST_URL = `http://127.0.0.1:${scannerPort}/clamav/jobs`
  process.env.MEDIA_SCAN_CALLBACK_BASE_URL = 'https://api.example.test'
  const server = await createTestServer()
  try {
    const { asset } = await createUpload(server, 'demo-access.promptlin', {
      fileName: 'clamav-scan-brief.pdf',
      purpose: 'submission_asset',
    })
    const completed = await requestJson(server.url, `/api/media/uploads/${asset.id}/complete`, {
      body: { checksum: 'sha256:clamav' },
      token: 'demo-access.promptlin',
    })
    const scanId = completed.payload.data.metadata.security.externalScanId
    assert.equal(completed.status, 200)
    assert.equal(completed.payload.data.metadata.security.scanDispatchStatus, 'sent')
    assert.equal(completed.payload.data.metadata.security.scanRequestAdapter, 'clamav-http')
    assert.equal(scannerRequest.method, 'POST')
    assert.equal(scannerRequest.url, '/clamav/jobs')
    assert.equal(scannerRequest.body.jobId, scanId)
    assert.equal(scannerRequest.body.adapter, 'clamav-http')
    assert.equal(scannerRequest.body.callbackUrl, `https://api.example.test/api/media/uploads/${asset.id}/scan-callback`)
    assert.equal(scannerRequest.body.source.type, 'object-storage')
    assert.equal(scannerRequest.body.source.storageKey, asset.storageKey)
    assert.equal(scannerRequest.body.source.fileName, 'clamav-scan-brief.pdf')
    assert.equal(scannerRequest.body.source.contentType, 'application/pdf')
    assert.equal(scannerRequest.body.metadata.assetId, asset.id)
    assert.equal(scannerRequest.body.metadata.purpose, 'submission_asset')
    assert.equal(scannerRequest.headers['x-media-scan-id'], scanId)
    assert.equal(scannerRequest.headers['x-media-scan-adapter'], 'clamav-http')
    assert.equal(scannerRequest.headers['x-clamav-job-id'], scanId)
    assert.equal(
      scannerRequest.headers['x-media-scan-signature'],
      `sha256=${createHmac('sha256', 'clamav-request-secret').update(scannerRequest.rawBody).digest('hex')}`,
    )
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
    if (previousRequestUrl === undefined) {
      delete process.env.MEDIA_SCAN_REQUEST_URL
    } else {
      process.env.MEDIA_SCAN_REQUEST_URL = previousRequestUrl
    }
    if (previousRequestSecret === undefined) {
      delete process.env.MEDIA_SCAN_REQUEST_SECRET
    } else {
      process.env.MEDIA_SCAN_REQUEST_SECRET = previousRequestSecret
    }
    if (previousRequestAdapter === undefined) {
      delete process.env.MEDIA_SCAN_REQUEST_ADAPTER
    } else {
      process.env.MEDIA_SCAN_REQUEST_ADAPTER = previousRequestAdapter
    }
    if (previousCallbackBaseUrl === undefined) {
      delete process.env.MEDIA_SCAN_CALLBACK_BASE_URL
    } else {
      process.env.MEDIA_SCAN_CALLBACK_BASE_URL = previousCallbackBaseUrl
    }
    await server.close()
    await new Promise((resolve) => scanner.close(resolve))
  }
})

test('clamav-http scanner smoke maps clean review and rejected callbacks', async () => {
  const previousProvider = process.env.MEDIA_SCAN_PROVIDER
  const previousSecret = process.env.MEDIA_SCAN_WEBHOOK_SECRET
  const previousRequestUrl = process.env.MEDIA_SCAN_REQUEST_URL
  const previousRequestSecret = process.env.MEDIA_SCAN_REQUEST_SECRET
  const previousRequestAdapter = process.env.MEDIA_SCAN_REQUEST_ADAPTER
  const previousCallbackBaseUrl = process.env.MEDIA_SCAN_CALLBACK_BASE_URL
  const previousSignatureSecret = process.env.MEDIA_SCAN_CALLBACK_SIGNATURE_SECRET
  const scannerRequests = []
  const scanner = http.createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    const rawBody = Buffer.concat(chunks).toString('utf8')
    scannerRequests.push({
      url: request.url,
      headers: request.headers,
      body: JSON.parse(rawBody),
    })
    response.writeHead(202, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ queued: true }))
  })
  await new Promise((resolve) => scanner.listen(0, '127.0.0.1', resolve))
  const scannerPort = scanner.address().port
  process.env.MEDIA_SCAN_PROVIDER = 'webhook'
  process.env.MEDIA_SCAN_WEBHOOK_SECRET = 'scan-secret'
  process.env.MEDIA_SCAN_REQUEST_SECRET = 'clamav-request-secret'
  process.env.MEDIA_SCAN_REQUEST_ADAPTER = 'clamav-http'
  process.env.MEDIA_SCAN_REQUEST_URL = `http://127.0.0.1:${scannerPort}/clamav/jobs`
  process.env.MEDIA_SCAN_CALLBACK_SIGNATURE_SECRET = 'callback-secret'
  const server = await createTestServer()
  process.env.MEDIA_SCAN_CALLBACK_BASE_URL = server.url
  try {
    const completeForStatus = async (status) => {
      const { asset } = await createUpload(server, 'demo-access.promptlin', {
        fileName: `clamav-${status}-brief.pdf`,
        purpose: 'submission_asset',
      })
      const completed = await requestJson(server.url, `/api/media/uploads/${asset.id}/complete`, {
        body: { checksum: `sha256:clamav-${status}` },
        token: 'demo-access.promptlin',
      })
      assert.equal(completed.status, 200)
      const request = scannerRequests.at(-1)
      assert.equal(request.url, '/clamav/jobs')
      assert.equal(request.body.adapter, 'clamav-http')
      assert.equal(request.body.metadata.assetId, asset.id)
      assert.equal(request.body.callbackUrl, `${server.url}/api/media/uploads/${asset.id}/scan-callback`)
      assert.equal(request.headers['x-clamav-job-id'], completed.payload.data.metadata.security.externalScanId)
      return { asset, request }
    }

    const clean = await completeForStatus('clean')
    const cleanCallback = await postSignedScannerCallback(clean.request.body.callbackUrl, {
      status: 'clean',
      note: 'ClamAV passed',
      detectedContentType: 'application/pdf',
      externalScanId: clean.request.body.jobId,
    })
    assert.equal(cleanCallback.status, 200)
    assert.equal(cleanCallback.payload.data.status, 'uploaded')
    assert.equal(cleanCallback.payload.data.metadata.security.scanStatus, 'clean')
    assert.equal(cleanCallback.payload.data.metadata.security.scanJobStatus, 'completed')

    const review = await completeForStatus('review')
    const reviewCallback = await postSignedScannerCallback(review.request.body.callbackUrl, {
      status: 'review',
      note: 'ClamAV requested manual inspection',
      detectedContentType: 'application/pdf',
      externalScanId: review.request.body.jobId,
    })
    assert.equal(reviewCallback.status, 200)
    assert.equal(reviewCallback.payload.data.status, 'uploaded')
    assert.equal(reviewCallback.payload.data.metadata.security.scanStatus, 'review')
    assert.equal(reviewCallback.payload.data.metadata.security.scanJobStatus, 'completed')

    const rejected = await completeForStatus('rejected')
    const rejectedCallback = await postSignedScannerCallback(rejected.request.body.callbackUrl, {
      status: 'rejected',
      note: 'ClamAV detected malware',
      reason: 'clamav_signature_match',
      detectedContentType: 'application/pdf',
      externalScanId: rejected.request.body.jobId,
    })
    assert.equal(rejectedCallback.status, 200)
    assert.equal(rejectedCallback.payload.data.status, 'rejected')
    assert.equal(rejectedCallback.payload.data.metadata.security.scanStatus, 'rejected')
    assert.equal(rejectedCallback.payload.data.metadata.security.scanJobStatus, 'failed')
    assert.equal(rejectedCallback.payload.data.metadata.security.rejectionReason, 'clamav_signature_match')

    const rejectedDownload = await requestJson(server.url, `/api/media/assets/${rejected.asset.id}/download`, {
      method: 'GET',
      token: 'demo-access.promptlin',
    })
    assert.equal(rejectedDownload.status, 404)
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
    if (previousRequestUrl === undefined) {
      delete process.env.MEDIA_SCAN_REQUEST_URL
    } else {
      process.env.MEDIA_SCAN_REQUEST_URL = previousRequestUrl
    }
    if (previousRequestSecret === undefined) {
      delete process.env.MEDIA_SCAN_REQUEST_SECRET
    } else {
      process.env.MEDIA_SCAN_REQUEST_SECRET = previousRequestSecret
    }
    if (previousRequestAdapter === undefined) {
      delete process.env.MEDIA_SCAN_REQUEST_ADAPTER
    } else {
      process.env.MEDIA_SCAN_REQUEST_ADAPTER = previousRequestAdapter
    }
    if (previousCallbackBaseUrl === undefined) {
      delete process.env.MEDIA_SCAN_CALLBACK_BASE_URL
    } else {
      process.env.MEDIA_SCAN_CALLBACK_BASE_URL = previousCallbackBaseUrl
    }
    if (previousSignatureSecret === undefined) {
      delete process.env.MEDIA_SCAN_CALLBACK_SIGNATURE_SECRET
    } else {
      process.env.MEDIA_SCAN_CALLBACK_SIGNATURE_SECRET = previousSignatureSecret
    }
    await server.close()
    await new Promise((resolve) => scanner.close(resolve))
  }
})

test('webhook media scanner callback supports timestamped HMAC signatures', async () => {
  const previousProvider = process.env.MEDIA_SCAN_PROVIDER
  const previousSecret = process.env.MEDIA_SCAN_WEBHOOK_SECRET
  const previousSignatureSecret = process.env.MEDIA_SCAN_CALLBACK_SIGNATURE_SECRET
  const previousTolerance = process.env.MEDIA_SCAN_CALLBACK_SIGNATURE_TOLERANCE_SECONDS
  process.env.MEDIA_SCAN_PROVIDER = 'webhook'
  process.env.MEDIA_SCAN_WEBHOOK_SECRET = 'scan-secret'
  process.env.MEDIA_SCAN_CALLBACK_SIGNATURE_SECRET = 'callback-secret'
  process.env.MEDIA_SCAN_CALLBACK_SIGNATURE_TOLERANCE_SECONDS = '300'
  const server = await createRouteTestServer(registerMediaRoutes, registerAdminRoutes)
  try {
    const { asset } = await createUpload(server, 'demo-access.promptlin', {
      fileName: 'signed-callback-brief.pdf',
      purpose: 'submission_asset',
    })
    const completed = await requestJson(server.url, `/api/media/uploads/${asset.id}/complete`, {
      body: { checksum: 'sha256:signed-callback' },
      token: 'demo-access.promptlin',
    })
    assert.equal(completed.status, 200)

    const body = {
      status: 'clean',
      note: 'Signed vendor callback passed',
      detectedContentType: 'application/pdf',
      externalScanId: completed.payload.data.metadata.security.externalScanId,
    }
    const missingSignature = await requestJson(server.url, `/api/media/uploads/${asset.id}/scan-callback`, {
      body,
      headers: { 'x-media-scan-secret': 'scan-secret' },
    })
    assert.equal(missingSignature.status, 403)
    assert.equal(missingSignature.payload.error.message, 'Missing media scan callback timestamp')

    const failureAudit = await requestJson(server.url, '/api/admin/audit?action=media.scan.callback_denied', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(failureAudit.status, 200)
    assert.equal(failureAudit.payload.data[0].resourceId, asset.id)
    assert.equal(failureAudit.payload.data[0].metadata.reason, 'Missing media scan callback timestamp')
    assert.equal(failureAudit.payload.data[0].metadata.externalScanId, body.externalScanId)
    assert.equal(failureAudit.payload.data[0].metadata.headers.hasSecret, true)
    assert.equal(failureAudit.payload.data[0].metadata.headers.hasTimestamp, false)
    assert.equal(failureAudit.payload.data[0].metadata.headers.hasSignature, false)

    const timestamp = String(Date.now())
    const callback = await requestJson(server.url, `/api/media/uploads/${asset.id}/scan-callback`, {
      body,
      headers: {
        'x-media-scan-secret': 'scan-secret',
        'x-media-scan-timestamp': timestamp,
        'x-media-scan-signature': signMediaScanCallbackBody('callback-secret', timestamp, body),
      },
    })
    assert.equal(callback.status, 200)
    assert.equal(callback.payload.data.metadata.security.scanStatus, 'clean')
    assert.equal(callback.payload.data.metadata.security.scanJobStatus, 'completed')
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
    if (previousSignatureSecret === undefined) {
      delete process.env.MEDIA_SCAN_CALLBACK_SIGNATURE_SECRET
    } else {
      process.env.MEDIA_SCAN_CALLBACK_SIGNATURE_SECRET = previousSignatureSecret
    }
    if (previousTolerance === undefined) {
      delete process.env.MEDIA_SCAN_CALLBACK_SIGNATURE_TOLERANCE_SECONDS
    } else {
      process.env.MEDIA_SCAN_CALLBACK_SIGNATURE_TOLERANCE_SECONDS = previousTolerance
    }
    await server.close()
  }
})

test('media scan sweep escalates timed out jobs after max attempts', async () => {
  const previousProvider = process.env.MEDIA_SCAN_PROVIDER
  const previousSecret = process.env.MEDIA_SCAN_WEBHOOK_SECRET
  const previousTimeout = process.env.MEDIA_SCAN_TIMEOUT_SECONDS
  process.env.MEDIA_SCAN_PROVIDER = 'webhook'
  process.env.MEDIA_SCAN_WEBHOOK_SECRET = 'scan-secret'
  process.env.MEDIA_SCAN_TIMEOUT_SECONDS = '1'
  const server = await createTestServer()
  try {
    const policy = await requestJson(server.url, '/api/media/governance-policy', {
      method: 'PUT',
      body: {
        scanner: { maxAttempts: 1 },
        retention: {
          historyRetentionDays: 14,
          historyRetentionMaxPerAsset: 3,
        },
      },
      token: 'demo-access.opsplus',
    })
    assert.equal(policy.status, 200)
    assert.equal(policy.payload.data.scanner.maxAttempts, 1)
    assert.equal(policy.payload.data.retention.historyRetentionDays, 14)
    assert.equal(policy.payload.data.retention.historyRetentionMaxPerAsset, 3)

    const { asset } = await createUpload(server, 'demo-access.promptlin', {
      fileName: 'timeout-sweep-brief.pdf',
      purpose: 'submission_asset',
    })
    const completed = await requestJson(server.url, `/api/media/uploads/${asset.id}/complete`, {
      body: { checksum: 'sha256:timeout' },
      token: 'demo-access.promptlin',
    })
    assert.equal(completed.status, 200)
    assert.equal(completed.payload.data.metadata.security.scanJobStatus, 'queued')

    await new Promise((resolve) => setTimeout(resolve, 1100))

    const sweep = await requestJson(server.url, '/api/media/scan-jobs/sweep', {
      token: 'demo-access.opsplus',
    })
    assert.equal(sweep.status, 200)
    assert.equal(sweep.payload.data.inspected, 1)
    assert.equal(sweep.payload.data.retried, 0)
    assert.equal(sweep.payload.data.failed, 1)
    assert.equal(sweep.payload.data.pruned, 0)
    assert.equal(sweep.payload.data.retention.days, 14)
    assert.equal(sweep.payload.data.retention.maxPerAsset, 3)
    assert.equal(sweep.payload.data.items[0].id, asset.id)
    assert.equal(sweep.payload.data.items[0].metadata.security.scanJobStatus, 'failed')
    assert.equal(sweep.payload.data.items[0].metadata.security.scanStatus, 'review')
    assert.equal(sweep.payload.data.items[0].metadata.security.rejectionReason, 'scan_timeout')

    const failedJobs = await requestJson(server.url, `/api/media/scan-jobs?status=failed&search=${asset.id}`, {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(failedJobs.status, 200)
    assert.ok(failedJobs.payload.data.some((item) => item.id === asset.id))
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
    if (previousTimeout === undefined) {
      delete process.env.MEDIA_SCAN_TIMEOUT_SECONDS
    } else {
      process.env.MEDIA_SCAN_TIMEOUT_SECONDS = previousTimeout
    }
    await server.close()
  }
})
