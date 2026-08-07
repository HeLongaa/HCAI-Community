import assert from 'node:assert/strict'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma configuration retention minimizes expired values without weakening immutable history', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { Client } = await import('pg')
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const { createPrismaConfigurationRetentionRepository } = await import('../config/prismaConfigurationRetentionRepository.js')
  const {
    approveSystemSettingChange,
    parseSystemSettingChangeRequest,
    parseSystemSettingTransition,
    publishSystemSettingChange,
    requestSystemSettingChange,
    requestSystemSettingRollback,
  } = await import('../settings/systemSettingsRuntime.js')
  const {
    createConfigResource,
    publishConfigResource,
    rollbackConfigResource,
    updateConfigResource,
  } = await import('../configResources/configResourceRuntime.js')

  const repository = await createPrismaRepository()
  assert.ok(repository)
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const requester = { id: `retention-requester-${suffix}`, handle: `retention-requester-${suffix}` }
  const approver = { id: `retention-approver-${suffix}`, handle: `retention-approver-${suffix}` }
  const resourceIds = []
  const settingKeys = ['jobs.worker', 'auth.session']
  const oldDate = new Date('2024-01-01T00:00:00.000Z')
  const now = new Date('2026-07-29T00:00:00.000Z')

  const publishSetting = async (key, value, baseVersion) => {
    const before = await repository.systemSettings.getSetting(key)
    assert.equal(before.publishedVersion, baseVersion, `${key} must be at version ${baseVersion} before publication`)
    const requested = await requestSystemSettingChange({
      payload: parseSystemSettingChangeRequest({ key, value, baseVersion, reasonCode: 'retention_integration', note: 'private operator note' }),
      actor: requester,
      repository: repository.systemSettings,
    })
    const approved = await approveSystemSettingChange({
      change: requested,
      payload: parseSystemSettingTransition({ expectedVersion: 1, reasonCode: 'retention_approved' }),
      actor: approver,
      repository: repository.systemSettings,
    })
    return publishSystemSettingChange({
      change: approved,
      payload: parseSystemSettingTransition({ expectedVersion: 2, reasonCode: 'retention_published' }),
      actor: requester,
      repository: repository.systemSettings,
    })
  }

  try {
    const firstSetting = await publishSetting('jobs.worker', { leaseTtlSeconds: 450, renewIntervalSeconds: 90 }, 0)
    const currentSetting = await publishSetting('jobs.worker', { leaseTtlSeconds: 600, renewIntervalSeconds: 120 }, 1)
    const heldSetting = await publishSetting('auth.session', { refreshTtlDays: 14, sameSite: 'Lax' }, 0)
    const heldCurrent = await publishSetting('auth.session', { refreshTtlDays: 21, sameSite: 'Strict' }, 1)
    const pendingRollback = await requestSystemSettingRollback({
      key: 'auth.session',
      revisionId: heldSetting.revision.id,
      payload: { baseVersion: 2, reasonCode: 'pending_retention_hold', note: '' },
      actor: requester,
      repository: repository.systemSettings,
    })

    const created = await createConfigResource({
      kind: 'feature_flag',
      actor: requester,
      repository: repository.configResources,
      payload: { key: `retention.${suffix}`, title: 'Old private title', description: 'Old private description', value: { enabled: false, payload: { credentialHint: 'private-value' } } },
    })
    resourceIds.push(created.id)
    const firstResource = await publishConfigResource({ resource: created, payload: { expectedVersion: 1, reasonCode: 'initial' }, actor: requester, repository: repository.configResources })
    const updated = await updateConfigResource({
      kind: 'feature_flag', resource: firstResource.resource, actor: requester, repository: repository.configResources,
      payload: { expectedVersion: 2, title: 'Current title', description: 'Current description', value: { enabled: true, payload: {} } },
    })
    const currentResource = await publishConfigResource({ resource: updated, payload: { expectedVersion: 3, reasonCode: 'current' }, actor: requester, repository: repository.configResources })

    const fixtureClient = new Client({ connectionString: databaseUrl })
    await fixtureClient.connect()
    try {
      await fixtureClient.query('BEGIN')
      await fixtureClient.query('ALTER TABLE system_setting_revisions DISABLE TRIGGER USER')
      await fixtureClient.query('ALTER TABLE config_resource_revisions DISABLE TRIGGER USER')
      await fixtureClient.query('UPDATE system_setting_revisions SET created_at = $1 WHERE setting_key = ANY($2::text[])', [oldDate, settingKeys])
      await fixtureClient.query('UPDATE config_resource_revisions SET created_at = $1 WHERE resource_id = $2', [oldDate, created.id])
      await fixtureClient.query("UPDATE system_setting_changes SET published_at = $1 WHERE setting_key = ANY($2::text[]) AND status = 'published'", [oldDate, settingKeys])
      await fixtureClient.query('ALTER TABLE system_setting_revisions ENABLE TRIGGER USER')
      await fixtureClient.query('ALTER TABLE config_resource_revisions ENABLE TRIGGER USER')
      await fixtureClient.query('COMMIT')
    } catch (error) {
      await fixtureClient.query('ROLLBACK')
      throw error
    } finally {
      await fixtureClient.end()
    }

    let releaseLock
    let lockAcquired
    const acquired = new Promise((resolve) => { lockAcquired = resolve })
    const release = new Promise((resolve) => { releaseLock = resolve })
    const publishingTransaction = repository.client.$transaction(async (db) => {
      await db.$queryRawUnsafe('SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))', `configuration-resource:${created.id}`)
      lockAcquired()
      await release
    })
    await acquired
    const racingSweep = repository.configurationRetention.sweepRetention({ now, limit: 100 })
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal((await repository.client.configResourceRevision.findUnique({ where: { id: firstResource.revision.id } })).retentionRedactedAt, null)
    releaseLock()
    await Promise.all([publishingTransaction, racingSweep])

    const result = await repository.configurationRetention.sweepRetention({ now, limit: 100 })
    assert.ok(result.inspected >= 0)
    const minimizedSetting = await repository.client.systemSettingRevision.findUnique({ where: { id: firstSetting.revision.id } })
    const preservedCurrent = await repository.client.systemSettingRevision.findUnique({ where: { id: currentSetting.revision.id } })
    const heldRevision = await repository.client.systemSettingRevision.findUnique({ where: { id: heldSetting.revision.id } })
    const minimizedResource = await repository.client.configResourceRevision.findUnique({ where: { id: firstResource.revision.id } })
    const preservedResource = await repository.client.configResourceRevision.findUnique({ where: { id: currentResource.revision.id } })
    assert.equal(minimizedSetting.value, null)
    assert.equal(minimizedSetting.actorRef, null)
    assert.deepEqual(preservedCurrent.value, { leaseTtlSeconds: 600, renewIntervalSeconds: 120 })
    assert.notEqual(heldRevision.value, null)
    assert.equal(pendingRollback.status, 'pending_approval')
    assert.equal(minimizedResource.title, null)
    assert.equal(minimizedResource.description, null)
    assert.equal(minimizedResource.value, null)
    assert.equal(preservedResource.title, 'Current title')
    const serializedSummary = JSON.stringify(minimizedResource.retentionSummary)
    for (const forbidden of ['Old private title', 'Old private description', 'credentialHint', 'private-value']) assert.equal(serializedSummary.includes(forbidden), false)
    assert.deepEqual(Object.keys(minimizedResource.retentionSummary).sort(), ['operations', 'pathHashes', 'previousValueDigest', 'schemaVersion', 'truncated', 'typeCounts', 'valueDigest'])

    await assert.rejects(
      repository.client.systemSettingRevision.update({ where: { id: minimizedSetting.id }, data: { eventType: 'tampered' } }),
      /retention-minimized system setting revision is immutable/,
    )
    await assert.rejects(
      repository.client.$transaction(async (db) => {
        await db.$executeRawUnsafe("SET LOCAL app.configuration_retention_maintenance = 'on'")
        await db.systemSettingRevision.update({ where: { id: minimizedSetting.id }, data: { value: { restored: true } } })
      }),
      /retention-minimized system setting revision is immutable/,
    )
    await assert.rejects(
      repository.client.$transaction(async (db) => {
        await db.$executeRawUnsafe("SET LOCAL app.configuration_retention_maintenance = 'on'")
        await db.systemSettingRevision.update({
          where: { id: heldRevision.id },
          data: { value: null, actorRef: null, retentionRedactedAt: now, retentionSummarySchemaVersion: 1, retentionSummary: { schemaVersion: 1 } },
        })
      }),
      /immutable system setting revision cannot be update/,
    )
    await assert.rejects(
      requestSystemSettingRollback({ key: 'jobs.worker', revisionId: minimizedSetting.id, payload: { baseVersion: 2, reasonCode: 'expired', note: '' }, actor: requester, repository: repository.systemSettings }),
      (error) => error.code === 'REVISION_REDACTED',
    )

    const failedAuditRepository = createPrismaConfigurationRetentionRepository(repository.client, { recordAudit: async () => { throw new Error('retention audit unavailable') } })
    await repository.client.$transaction(async (db) => {
      await db.systemSettingChange.update({ where: { id: pendingRollback.id }, data: { status: 'rejected', rejectedAt: oldDate } })
    })
    await assert.rejects(failedAuditRepository.sweepRetention({ now, limit: 100 }), /retention audit unavailable/)
    assert.notEqual((await repository.client.systemSettingRevision.findUnique({ where: { id: heldRevision.id } })).value, null)
  } finally {
    await repository.client.$transaction(async (db) => {
      await db.$executeRawUnsafe("SET LOCAL app.system_setting_maintenance = 'on'")
      await db.$executeRawUnsafe("SET LOCAL app.config_resource_maintenance = 'on'")
      await db.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await db.systemSetting.updateMany({ where: { key: { in: settingKeys } }, data: { currentRevisionId: null } })
      await db.systemSettingChange.updateMany({ where: { settingKey: { in: settingKeys }, targetRevisionId: { not: null } }, data: { targetRevisionId: null } })
      await db.systemSettingRevision.deleteMany({ where: { settingKey: { in: settingKeys } } })
      await db.systemSettingChange.deleteMany({ where: { settingKey: { in: settingKeys } } })
      await db.systemSetting.deleteMany({ where: { key: { in: settingKeys } } })
      if (resourceIds.length) {
        await db.configResource.updateMany({ where: { id: { in: resourceIds } }, data: { currentRevisionId: null } })
        await db.featureFlag.deleteMany({ where: { resourceId: { in: resourceIds } } })
        await db.configResourceRevision.deleteMany({ where: { resourceId: { in: resourceIds } } })
        await db.configResource.deleteMany({ where: { id: { in: resourceIds } } })
      }
      await db.auditEvent.deleteMany({ where: { OR: [{ actorId: requester.id }, { actorId: approver.id }, { resourceType: 'configuration_retention' }] } })
    })
    await repository.client.$disconnect()
  }
})
