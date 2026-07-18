import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma notification templates and preferences preserve CAS, immutable versions, rollback, and delivery suppression', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  assert.ok(repository)

  const suffix = `${Date.now()}-${randomUUID().slice(0, 7)}`
  const session = await repository.auth.registerEmailAccount({
    email: `notify-${suffix}@example.com`, password: 'notification-integration-password',
    displayName: 'Notification Integration', handle: `notify${suffix.replaceAll('-', '')}`.slice(0, 30),
  })
  const actor = session.user
  const key = `task.integration_${suffix}`.toLowerCase()
  const schema = { additionalProperties: false, required: ['taskTitle'], properties: { taskTitle: { type: 'string', maxLength: 120 } } }
  let templateId = null

  try {
    const created = await repository.notificationManagement.createTemplate({
      key, name: 'Integration template', description: null, category: 'task', locale: 'en',
      titleTemplate: 'Ready: {{taskTitle}}', bodyTemplate: '{{taskTitle}} is ready.', variableSchema: schema,
    }, actor)
    templateId = created.id
    assert.equal(created.versions[0].status, 'draft')

    const publishAttempts = await Promise.allSettled([
      repository.notificationManagement.publishTemplate(created.id, { expectedVersion: 1, reasonCode: 'integration_a' }, actor),
      repository.notificationManagement.publishTemplate(created.id, { expectedVersion: 1, reasonCode: 'integration_b' }, actor),
    ])
    assert.equal(publishAttempts.filter((result) => result.status === 'fulfilled').length, 1)
    assert.equal(publishAttempts.filter((result) => result.status === 'rejected' && result.reason?.code === 'STATE_CONFLICT').length, 1)
    const published = publishAttempts.find((result) => result.status === 'fulfilled').value
    assert.equal(published.activeVersionNumber, 1)

    const updated = await repository.notificationManagement.updateTemplate(created.id, {
      expectedVersion: published.version, name: 'Integration template v2', description: 'Second version', category: 'task', locale: 'en',
      titleTemplate: 'Updated: {{taskTitle}}', bodyTemplate: '{{taskTitle}} changed.', variableSchema: schema,
    }, actor)
    assert.equal(updated.versions[0].versionNumber, 2)
    assert.equal(updated.versions[1].titleTemplate, 'Ready: {{taskTitle}}')
    const v2 = await repository.notificationManagement.publishTemplate(created.id, { expectedVersion: updated.version, versionNumber: 2, reasonCode: 'integration_v2' }, actor)
    const rolledBack = await repository.notificationManagement.rollbackTemplate(created.id, { expectedVersion: v2.version, versionNumber: 1, reasonCode: 'integration_rollback' }, actor)
    assert.equal(rolledBack.activeVersionNumber, 1)
    assert.equal(rolledBack.versions.find((version) => version.versionNumber === 1).titleTemplate, 'Ready: {{taskTitle}}')

    const preference = await repository.notificationManagement.setPreference({ notificationType: key, inAppEnabled: false, expectedVersion: null }, actor)
    assert.equal(preference.version, 1)
    assert.equal((await repository.notifications.createForHandles([actor.handle], { type: key, title: 'Hidden', body: 'Hidden', resourceType: 'task', resourceId: suffix })).length, 0)
    const enabled = await repository.notificationManagement.setPreference({ notificationType: key, inAppEnabled: true, expectedVersion: 1 }, actor)
    assert.equal(enabled.version, 2)
    const rendered = await repository.notificationManagement.renderPublished(key, { taskTitle: 'Integration task' })
    const delivered = await repository.notifications.createForHandles([actor.handle], { ...rendered, type: key, resourceType: 'task', resourceId: suffix })
    assert.equal(delivered.length, 1)
    assert.equal(delivered[0].templateVersion, 1)
    assert.equal(delivered[0].title, 'Ready: Integration task')

    const audits = await repository.client.auditEvent.findMany({ where: { actorId: actor.id, resourceId: created.id } })
    assert.ok(audits.some((event) => event.action === 'notification.template.published'))
    assert.ok(audits.some((event) => event.action === 'notification.template.rolled_back'))
  } finally {
    await repository.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await transaction.notification.deleteMany({ where: { recipientId: actor.id } })
      await transaction.notificationPreference.deleteMany({ where: { userId: actor.id } })
      if (templateId) await transaction.notificationTemplate.deleteMany({ where: { id: templateId } })
      await transaction.auditEvent.deleteMany({ where: { actorId: actor.id } })
      await transaction.user.deleteMany({ where: { id: actor.id } })
    })
    await repository.client.$disconnect()
  }
})
