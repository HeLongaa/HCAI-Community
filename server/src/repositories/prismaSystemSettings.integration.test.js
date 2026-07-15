import assert from 'node:assert/strict'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma system settings preserve concurrent CAS, atomic audit, immutable history, and reviewed rollback', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const { createPrismaSystemSettingsRepository } = await import('../settings/prismaSystemSettingsRepository.js')
  const {
    approveSystemSettingChange,
    publishSystemSettingChange,
    requestSystemSettingChange,
    requestSystemSettingRollback,
  } = await import('../settings/systemSettingsRuntime.js')

  const repository = await createPrismaRepository()
  assert.ok(repository)
  const key = 'jobs.worker'
  const runId = `settings-integration-${Date.now()}`
  const requester = { id: `${runId}-requester`, handle: `${runId}-requester` }
  const secondRequester = { id: `${runId}-requester-2`, handle: `${runId}-requester-2` }
  const approver = { id: `${runId}-approver`, handle: `${runId}-approver` }
  const settings = repository.systemSettings
  const requestedIds = []

  const request = async (actor, value, baseVersion) => {
    const change = await requestSystemSettingChange({
      payload: { key, value, baseVersion, reasonCode: 'integration', note: runId },
      actor,
      repository: settings,
    })
    requestedIds.push(change.id)
    return change
  }
  const approve = (change) => approveSystemSettingChange({
    change,
    payload: { expectedVersion: change.version, reasonCode: 'integration_reviewed', note: runId },
    actor: approver,
    repository: settings,
  })
  const publish = (change, actor) => publishSystemSettingChange({
    change,
    payload: { expectedVersion: change.version, reasonCode: 'integration_publish', note: runId },
    actor,
    repository: settings,
  })

  try {
    const [firstApproved, competingApproved] = await Promise.all([
      request(requester, { leaseTtlSeconds: 450, renewIntervalSeconds: 90 }, 0).then(approve),
      request(secondRequester, { leaseTtlSeconds: 600, renewIntervalSeconds: 120 }, 0).then(approve),
    ])
    const concurrent = await Promise.allSettled([
      publish(firstApproved, requester),
      publish(competingApproved, secondRequester),
    ])
    assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1)
    assert.equal(concurrent.filter((result) => result.status === 'rejected').length, 1)
    const conflictResult = concurrent.find((result) => result.status === 'rejected')
    assert.equal(conflictResult.reason.statusCode, 409)

    const winner = concurrent.find((result) => result.status === 'fulfilled').value
    assert.equal(winner.setting.publishedVersion, 1)
    assert.equal(winner.revision.settingVersion, 1)
    assert.equal(winner.revision.contentHash.length, 64)

    const failedAuditChange = await request(requester, { leaseTtlSeconds: 720, renewIntervalSeconds: 120 }, 1).then(approve)
    const failingRepository = createPrismaSystemSettingsRepository(repository.client, {
      recordAudit: async () => { throw new Error('integration audit unavailable') },
    })
    await assert.rejects(
      publishSystemSettingChange({
        change: failedAuditChange,
        payload: { expectedVersion: failedAuditChange.version, reasonCode: 'audit_failure', note: runId },
        actor: requester,
        repository: failingRepository,
      }),
      /audit unavailable/,
    )
    const afterAuditFailure = await settings.getSetting(key)
    assert.equal(afterAuditFailure.publishedVersion, 1)
    assert.equal(await repository.client.systemSettingRevision.count({ where: { sourceChangeId: failedAuditChange.id } }), 0)
    assert.equal((await settings.findChange(failedAuditChange.id)).status, 'approved')

    const secondPublished = await request(requester, { leaseTtlSeconds: 750, renewIntervalSeconds: 125 }, 1).then(approve).then((change) => publish(change, requester))
    assert.equal(secondPublished.setting.publishedVersion, 2)
    assert.equal(secondPublished.revision.previousRevisionId, winner.revision.id)

    await assert.rejects(
      repository.client.systemSettingRevision.update({ where: { id: winner.revision.id }, data: { eventType: 'tampered' } }),
      /immutable system setting revision cannot be update/,
    )
    await assert.rejects(
      repository.client.systemSettingRevision.delete({ where: { id: winner.revision.id } }),
      /immutable system setting revision cannot be delete/,
    )

    const rollback = await requestSystemSettingRollback({
      key,
      revisionId: winner.revision.id,
      payload: { baseVersion: 2, reasonCode: 'integration_rollback', note: runId },
      actor: requester,
      repository: settings,
    })
    requestedIds.push(rollback.id)
    const rollbackPublished = await approve(rollback).then((change) => publish(change, requester))
    assert.equal(rollbackPublished.revision.eventType, 'rolled_back')
    assert.equal(rollbackPublished.setting.publishedVersion, 3)
    assert.deepEqual(rollbackPublished.setting.value, winner.setting.value)

    const audits = await repository.client.auditEvent.findMany({
      where: { actorId: { startsWith: runId }, action: { in: ['admin.settings.published', 'admin.settings.rolled_back'] } },
    })
    assert.equal(audits.length, 3)
  } finally {
    await repository.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.system_setting_maintenance = 'on'")
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await transaction.systemSetting.updateMany({ where: { key }, data: { currentRevisionId: null } })
      await transaction.systemSettingChange.updateMany({ where: { settingKey: key }, data: { targetRevisionId: null } })
      await transaction.systemSettingRevision.deleteMany({ where: { settingKey: key } })
      await transaction.systemSettingChange.deleteMany({ where: { settingKey: key } })
      await transaction.systemSetting.deleteMany({ where: { key } })
      await transaction.auditEvent.deleteMany({ where: { actorId: { startsWith: runId } } })
    })
    await repository.client.$disconnect()
  }
})
