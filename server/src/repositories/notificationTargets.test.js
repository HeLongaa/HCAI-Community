import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeNotificationTarget, sanitizeNotificationMetadata } from './notificationTargets.js'

test('normalizes legacy workspace targets into NotificationTargetV1', () => {
  assert.deepEqual(normalizeNotificationTarget({ page: 'playground', workspace: 'video', intent: 'retry' }, {
    resourceType: 'creative_generation',
    resourceId: 'gen-1',
  }), {
    version: 1,
    surface: 'video',
    intent: 'retry',
    fallbackSurface: 'generations',
    workspace: 'video',
    generationId: 'gen-1',
  })
})

test('allowlists metadata and folds malformed targets to a safe surface', () => {
  const metadata = sanitizeNotificationMetadata({
    taskId: 'task-1',
    rawPrompt: 'do not leak',
    target: { page: 'https://evil.example', token: 'secret' },
  }, { resourceType: 'task', resourceId: 'task-1' })
  assert.equal(metadata.rawPrompt, undefined)
  assert.equal(JSON.stringify(metadata).includes('secret'), false)
  assert.deepEqual(metadata.target, {
    version: 1,
    surface: 'tasks',
    intent: 'view',
    fallbackSurface: 'generations',
    taskId: 'task-1',
  })
})

test('admin targets retain only supported drill-down fields', () => {
  const target = normalizeNotificationTarget({
    page: 'admin',
    admin: { tab: 'Security', securityAlertId: 'alert-1', rawUrl: 'https://private.example' },
  }, { resourceType: 'security_alert', resourceId: 'alert-1' })
  assert.deepEqual(target.admin, { tab: 'Security', securityAlertId: 'alert-1' })
  assert.equal(JSON.stringify(target).includes('private.example'), false)
})
