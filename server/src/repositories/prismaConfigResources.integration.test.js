import assert from 'node:assert/strict'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma config resources preserve concurrent publication, atomic audit, immutable history, rollback, and soft deletion', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const { createPrismaConfigResourcesRepository } = await import('../configResources/prismaConfigResourcesRepository.js')
  const {
    createConfigResource,
    deleteConfigResource,
    publishConfigResource,
    restoreConfigResource,
    rollbackConfigResource,
    updateConfigResource,
  } = await import('../configResources/configResourceRuntime.js')

  const repository = await createPrismaRepository()
  assert.ok(repository)
  const runId = `config-resource-integration-${Date.now()}`
  const actor = { id: `${runId}-admin`, handle: `${runId}-admin` }
  const resources = repository.configResources
  let resourceId = null
  const projectionResourceIds = []

  try {
    const created = await createConfigResource({
      kind: 'feature_flag', actor, repository: resources,
      payload: { key: `${runId}.flag`, title: 'Integration flag', value: { enabled: false, payload: {} } },
    })
    resourceId = created.id
    const concurrent = await Promise.allSettled([
      publishConfigResource({ resource: created, payload: { expectedVersion: 1, reasonCode: 'concurrent_a' }, actor, repository: resources }),
      publishConfigResource({ resource: created, payload: { expectedVersion: 1, reasonCode: 'concurrent_b' }, actor, repository: resources }),
    ])
    assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1)
    assert.equal(concurrent.filter((result) => result.status === 'rejected').length, 1)
    assert.equal(concurrent.find((result) => result.status === 'rejected').reason.statusCode, 409)
    const first = concurrent.find((result) => result.status === 'fulfilled').value
    assert.equal(first.resource.publishedVersion, 1)
    assert.equal(first.revision.contentHash.length, 64)
    assert.deepEqual(await repository.client.featureFlag.findUnique({ where: { resourceId } }).then((row) => ({ enabled: row.enabled, payload: row.payload, publishedVersion: row.publishedVersion })), {
      enabled: false, payload: {}, publishedVersion: 1,
    })

    const updated = await updateConfigResource({
      kind: 'feature_flag', resource: first.resource, actor, repository: resources,
      payload: { expectedVersion: 2, title: 'Integration flag', value: { enabled: true, payload: { variant: 'v2' } } },
    })
    const failingRepository = createPrismaConfigResourcesRepository(repository.client, {
      recordAudit: async () => { throw new Error('integration audit unavailable') },
    })
    await assert.rejects(
      publishConfigResource({ resource: updated, payload: { expectedVersion: 3, reasonCode: 'audit_failure' }, actor, repository: failingRepository }),
      /audit unavailable/,
    )
    const afterAuditFailure = await resources.findById(resourceId)
    assert.equal(afterAuditFailure.publishedVersion, 1)
    assert.equal(afterAuditFailure.version, 3)
    assert.equal(await repository.client.configResourceRevision.count({ where: { resourceId } }), 1)

    const second = await publishConfigResource({ resource: afterAuditFailure, payload: { expectedVersion: 3, reasonCode: 'publish_v2' }, actor, repository: resources })
    assert.equal(second.resource.publishedVersion, 2)
    assert.equal(second.revision.previousRevisionId, first.revision.id)
    assert.equal((await repository.client.featureFlag.findUnique({ where: { resourceId } })).enabled, true)

    await assert.rejects(
      repository.client.configResourceRevision.update({ where: { id: first.revision.id }, data: { eventType: 'tampered' } }),
      /immutable config resource revision cannot be update/,
    )
    await assert.rejects(
      repository.client.configResourceRevision.delete({ where: { id: first.revision.id } }),
      /immutable config resource revision cannot be delete/,
    )

    const rolledBack = await rollbackConfigResource({
      resource: second.resource, actor, repository: resources,
      payload: { expectedVersion: 4, revisionId: first.revision.id, reasonCode: 'restore_v1' },
    })
    assert.equal(rolledBack.resource.publishedVersion, 3)
    assert.equal(rolledBack.resource.publishedValue.enabled, false)
    assert.equal(rolledBack.revision.eventType, 'rolled_back')
    assert.equal((await repository.client.featureFlag.findUnique({ where: { resourceId } })).enabled, false)

    const deleted = await deleteConfigResource({ resource: rolledBack.resource, payload: { expectedVersion: 5, reasonCode: 'retire' }, actor, repository: resources })
    assert.ok(deleted.deletedAt)
    assert.ok((await repository.client.featureFlag.findUnique({ where: { resourceId } })).deletedAt)
    const restored = await restoreConfigResource({ resource: deleted, payload: { expectedVersion: 6, reasonCode: 'restore' }, actor, repository: resources })
    assert.equal(restored.deletedAt, null)
    assert.equal(restored.version, 7)
    assert.equal((await repository.client.featureFlag.findUnique({ where: { resourceId } })).deletedAt, null)

    const reference = await createConfigResource({
      kind: 'reference_data', actor, repository: resources,
      payload: { key: `${runId}.country`, title: 'Integration country', value: { label: 'China', value: 'CN', sortOrder: 1, active: true } },
    })
    projectionResourceIds.push(reference.id)
    const referencePublished = await publishConfigResource({ resource: reference, payload: { expectedVersion: 1, reasonCode: 'publish_reference' }, actor, repository: resources })
    assert.equal((await repository.client.referenceDataEntry.findUnique({ where: { resourceId: reference.id } })).publishedVersion, 1)
    assert.equal(referencePublished.resource.kind, 'reference_data')

    const announcement = await createConfigResource({
      kind: 'announcement', actor, repository: resources,
      payload: { key: `${runId}.notice`, title: 'Integration notice', value: { body: 'Maintenance.', level: 'warning', startsAt: null, endsAt: null, active: true } },
    })
    projectionResourceIds.push(announcement.id)
    await publishConfigResource({ resource: announcement, payload: { expectedVersion: 1, reasonCode: 'publish_announcement' }, actor, repository: resources })
    assert.deepEqual(await repository.client.announcement.findUnique({ where: { resourceId: announcement.id } }).then((row) => ({ title: row.title, level: row.level, publishedVersion: row.publishedVersion })), {
      title: 'Integration notice', level: 'warning', publishedVersion: 1,
    })

    const audits = await repository.client.auditEvent.findMany({
      where: { actorId: actor.id, action: { in: ['admin.config_resources.published', 'admin.config_resources.rolled_back'] } },
    })
    assert.equal(audits.length, 5)
  } finally {
    await repository.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.config_resource_maintenance = 'on'")
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      const resourceIds = [resourceId, ...projectionResourceIds].filter(Boolean)
      if (resourceIds.length) {
        await transaction.configResource.updateMany({ where: { id: { in: resourceIds } }, data: { currentRevisionId: null } })
        await transaction.featureFlag.deleteMany({ where: { resourceId: { in: resourceIds } } })
        await transaction.referenceDataEntry.deleteMany({ where: { resourceId: { in: resourceIds } } })
        await transaction.announcement.deleteMany({ where: { resourceId: { in: resourceIds } } })
        await transaction.configResourceRevision.deleteMany({ where: { resourceId: { in: resourceIds } } })
        await transaction.configResource.deleteMany({ where: { id: { in: resourceIds } } })
      }
      await transaction.auditEvent.deleteMany({ where: { actorId: actor.id } })
    })
    await repository.client.$disconnect()
  }
})
