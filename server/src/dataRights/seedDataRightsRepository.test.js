import assert from 'node:assert/strict'
import test from 'node:test'

import { parseBackupExpiryReceipt, parseDataRightsRequest } from './dataRightsLifecycle.js'
import { createSeedDataRightsRepository } from './seedDataRightsRepository.js'

const actor = { id: 'user-1', handle: 'promptlin', role: 'member', accountVersion: 1 }
const operator = { id: 'admin-1', handle: 'opsplus', role: 'admin' }
const createdAt = new Date('2026-07-20T00:00:00.000Z')
const request = (requestType) => parseDataRightsRequest({ requestType, identityConfirmation: actor.handle, reasonCode: 'owner_requested', expectedAccountVersion: 1 })

test('seed data export is owner scoped, redacted, archived, and rate limited', async () => {
  const audits = []
  const repository = createSeedDataRightsRepository({
    accountForActor: async (candidate) => candidate.id === actor.id ? actor : null,
    snapshotForActor: async () => ({ profile: { handle: actor.handle }, auth: { accessToken: 'must-not-export' } }),
    recordAudit: (event) => audits.push(event),
  })
  const created = await repository.create(actor, request('data_export'), { sessionIssuedAt: createdAt, now: createdAt })
  assert.equal(created.status, 'identity_verified')
  assert.equal((await repository.getOwn({ ...actor, id: 'other' }, created.id)), null)
  const completed = await repository.process(operator, created.id, { expectedVersion: 1, reasonCode: 'export_generated' }, createdAt)
  assert.equal(completed.status, 'completed')
  assert.equal(completed.artifact.checksumSha256.length, 64)
  const exported = await repository.exportPackage(actor, created.id, createdAt)
  assert.equal(exported.package.data.profile.handle, actor.handle)
  assert.equal(JSON.stringify(exported.package).includes('must-not-export'), false)
  assert.ok(audits.some((event) => event.action === 'admin.data_rights.processed'))

  for (let index = 0; index < 2; index += 1) {
    const item = await repository.create(actor, request('data_export'), { sessionIssuedAt: createdAt, now: new Date(createdAt.getTime() + (index + 1) * 1000) })
    await repository.cancelOwn(actor, item.id, { expectedVersion: 1, reasonCode: 'owner_cancelled' }, createdAt)
  }
  await assert.rejects(repository.create(actor, request('data_export'), { sessionIssuedAt: createdAt, now: new Date(createdAt.getTime() + 3000) }), { code: 'DATA_RIGHTS_RATE_LIMITED' })
})

test('seed account deletion waits for grace and all required backup receipts', async () => {
  const deleted = []
  const repository = createSeedDataRightsRepository({
    accountForActor: async (candidate) => candidate.id === actor.id ? actor : null,
    applyDeletion: async (_request, plan) => {
      deleted.push(...plan.receipts)
      return { sessions: 2, media: 4, billing: 3 }
    },
  })
  const created = await repository.create(actor, request('account_deletion'), { sessionIssuedAt: createdAt, now: createdAt })
  await assert.rejects(repository.process(operator, created.id, { expectedVersion: 1, reasonCode: 'primary_delete' }, createdAt), { code: 'DATA_RIGHTS_GRACE_PERIOD_ACTIVE' })
  const primaryAt = new Date('2026-08-20T00:00:00.000Z')
  const primary = await repository.process(operator, created.id, { expectedVersion: 1, reasonCode: 'primary_delete' }, primaryAt)
  assert.equal(primary.status, 'primary_completed')
  assert.equal(primary.deletionReceipts.length, 15)
  assert.equal(primary.deletionReceipts.find((item) => item.domain === 'media').recordCount, 4)
  assert.equal(deleted.length, 15)

  const backupAt = new Date('2026-09-24T00:00:00.000Z')
  for (const [index, backupClass] of ['primary_database', 'object_storage', 'audit_archive'].entries()) {
    const receipt = parseBackupExpiryReceipt({ backupClass, objectRefHash: String(index + 1).repeat(64), evidenceHash: String(index + 4).repeat(64), expiredAt: backupAt.toISOString(), verifiedByRef: 'backup-operator-1' })
    const updated = await repository.recordBackupReceipt(operator, created.id, receipt, backupAt)
    assert.equal(updated.status, index === 2 ? 'completed' : 'primary_completed')
  }
})

test('seed account deletion cancellation clears the linked account schedule', async () => {
  const lifecycle = []
  const repository = createSeedDataRightsRepository({
    accountForActor: async () => actor,
    scheduleDeletion: async () => lifecycle.push('scheduled'),
    cancelDeletion: async () => lifecycle.push('cancelled'),
  })
  const created = await repository.create(actor, request('account_deletion'), { sessionIssuedAt: createdAt, now: createdAt })
  const cancelled = await repository.cancelOwn(actor, created.id, { expectedVersion: created.version, reasonCode: 'owner_cancelled' }, createdAt)
  assert.equal(cancelled.status, 'cancelled')
  assert.deepEqual(lifecycle, ['scheduled', 'cancelled'])
})
