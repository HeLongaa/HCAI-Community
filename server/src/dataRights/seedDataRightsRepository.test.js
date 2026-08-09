import assert from 'node:assert/strict'
import test from 'node:test'

import { parseBackupExpiryReceipt, parseDataRightsLegalHold, parseDataRightsRequest } from './dataRightsLifecycle.js'
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

test('seed data export retention deletes the object before its locator and records hashed evidence', async () => {
  const deleted = []
  const audits = []
  const repository = createSeedDataRightsRepository({
    accountForActor: async () => actor,
    snapshotForActor: async () => ({ profile: { handle: actor.handle } }),
    exportObjectDeleter: async (asset, options) => {
      deleted.push(asset.storageKey)
      return { provider: 'mock', statusCode: null, deletedAt: options.now.toISOString() }
    },
    recordAudit: (event) => audits.push(event),
  })
  const created = await repository.create(actor, request('data_export'), { sessionIssuedAt: createdAt, now: createdAt })
  const completed = await repository.process(operator, created.id, { expectedVersion: 1, reasonCode: 'export_generated' }, createdAt)
  const expiredAt = new Date(createdAt.getTime() + 8 * 86400_000)

  assert.deepEqual(await repository.sweepExpiredExports({ now: expiredAt, limit: 1 }), {
    inspected: 1,
    due: 1,
    deleted: 1,
    failed: 0,
    failures: [],
  })
  assert.deepEqual(deleted, [completed.artifact.storageKey])
  const after = await repository.getOwn(actor, created.id)
  assert.equal(after.artifact, null)
  assert.ok(after.events.some((event) => event.eventType === 'export_artifact_expired' && event.metadata.receiptHash.length === 64))
  assert.ok(audits.some((event) => event.action === 'data_rights.export_artifact_expired'))
  assert.equal(await repository.exportPackage(actor, created.id, expiredAt), null)
})

test('seed data export retention preserves the locator when object deletion fails', async () => {
  const repository = createSeedDataRightsRepository({
    accountForActor: async () => actor,
    snapshotForActor: async () => ({ profile: { handle: actor.handle } }),
    exportObjectDeleter: async () => {
      const error = new Error('storage unavailable')
      error.code = 'STORAGE_DELETE_UNAVAILABLE'
      throw error
    },
  })
  const created = await repository.create(actor, request('data_export'), { sessionIssuedAt: createdAt, now: createdAt })
  await repository.process(operator, created.id, { expectedVersion: 1, reasonCode: 'export_generated' }, createdAt)
  const expiredAt = new Date(createdAt.getTime() + 8 * 86400_000)

  await assert.rejects(repository.sweepExpiredExports({ now: expiredAt, limit: 1 }), (error) => {
    assert.equal(error.code, 'DATA_EXPORT_RETENTION_PARTIAL_FAILURE')
    assert.deepEqual(error.details.failures.map((item) => item.errorCode), ['STORAGE_DELETE_UNAVAILABLE'])
    return true
  })
  assert.notEqual((await repository.getOwn(actor, created.id)).artifact, null)
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

test('seed account deletion confirms external Provider erasure before local deletion', async () => {
  const lifecycle = []
  const repository = createSeedDataRightsRepository({
    accountForActor: async () => actor,
    listProviderDeletionRecords: async () => [{ providerId: 'hcai-router', providerJobId: 'private-job-ref' }],
    dispatchProviderDeletion: async ({ target }) => {
      lifecycle.push(`provider:${target.providerId}`)
      return { providerId: target.providerId, generationCount: 1, deletedOperationCount: 1, receiptHash: 'a'.repeat(64), completedAt: '2026-08-20T00:00:00.000Z' }
    },
    applyDeletion: async () => { lifecycle.push('local'); return {} },
  })
  const created = await repository.create(actor, request('account_deletion'), { sessionIssuedAt: createdAt, now: createdAt })
  const completed = await repository.process(operator, created.id, { expectedVersion: 1, reasonCode: 'primary_delete' }, new Date('2026-08-20T00:00:00.000Z'))
  assert.deepEqual(lifecycle, ['provider:hcai-router', 'local'])
  const providerReceipt = completed.deletionReceipts.find((item) => item.domain === 'provider:hcai-router')
  assert.equal(providerReceipt.disposition, 'externally_erased')
  assert.equal(JSON.stringify(completed).includes('private-job-ref'), false)
})

test('seed legal hold creation fails deterministically after Provider deletion reaches its durable cutoff', async () => {
  let releaseProvider
  let markProviderStarted
  const providerStarted = new Promise((resolve) => { markProviderStarted = resolve })
  const providerRelease = new Promise((resolve) => { releaseProvider = resolve })
  const repository = createSeedDataRightsRepository({
    accountForActor: async () => actor,
    listProviderDeletionRecords: async () => [{ providerId: 'hcai-router', providerJobId: 'private-job-ref' }],
    dispatchProviderDeletion: async ({ target }) => {
      markProviderStarted()
      await providerRelease
      return { providerId: target.providerId, generationCount: 1, deletedOperationCount: 1, receiptHash: 'a'.repeat(64), completedAt: '2026-08-20T00:00:00.000Z' }
    },
  })
  const deletion = await repository.create(actor, request('account_deletion'), { sessionIssuedAt: createdAt, now: createdAt })
  const primaryAt = new Date('2026-08-20T00:00:00.000Z')
  const processing = repository.process(operator, deletion.id, { expectedVersion: deletion.version, reasonCode: 'primary_delete' }, primaryAt)
  await providerStarted

  await assert.rejects(repository.createLegalHold(operator, parseDataRightsLegalHold({
    subjectId: actor.id,
    scopeDomain: 'creative',
    reasonCode: 'late_preservation_attempt',
    authorityRole: 'legal_hold_admin',
    authorityReferenceHash: 'c'.repeat(64),
    reviewAt: new Date(primaryAt.getTime() + 30 * 86400_000).toISOString(),
    expiresAt: new Date(primaryAt.getTime() + 180 * 86400_000).toISOString(),
  }), primaryAt), { code: 'DATA_RIGHTS_LEGAL_HOLD_CUTOFF_PASSED' })

  releaseProvider()
  assert.equal((await processing).status, 'primary_completed')
})

test('seed account deletion blocks local erasure when Provider deletion is unavailable', async () => {
  let localDeletionCalled = false
  const repository = createSeedDataRightsRepository({
    accountForActor: async () => actor,
    listProviderDeletionRecords: async () => [{ providerId: 'hcai-router', providerJobId: 'private-job-ref' }],
    dispatchProviderDeletion: async () => { const error = new Error('gateway unavailable'); error.code = 'DATA_RIGHTS_PROVIDER_DELETION_UNAVAILABLE'; throw error },
    applyDeletion: async () => { localDeletionCalled = true; return {} },
  })
  const created = await repository.create(actor, request('account_deletion'), { sessionIssuedAt: createdAt, now: createdAt })
  await assert.rejects(repository.process(operator, created.id, { expectedVersion: 1, reasonCode: 'primary_delete' }, new Date('2026-08-20T00:00:00.000Z')), { code: 'DATA_RIGHTS_PROVIDER_DELETION_UNAVAILABLE' })
  assert.equal(localDeletionCalled, false)
  assert.equal((await repository.getAdmin(created.id)).status, 'blocked')
})

test('seed legal hold blocks deletion before Provider dispatch and release resumes the same request', async () => {
  const lifecycle = []
  const repository = createSeedDataRightsRepository({
    accountForActor: async (candidate) => candidate.id === actor.id ? actor : null,
    listProviderDeletionRecords: async () => { lifecycle.push('provider-list'); return [] },
    applyDeletion: async () => { lifecycle.push('local'); return {} },
  })
  const deletion = await repository.create(actor, request('account_deletion'), { sessionIssuedAt: createdAt, now: createdAt })
  const hold = await repository.createLegalHold(operator, parseDataRightsLegalHold({
    subjectId: actor.id,
    scopeDomain: 'creative',
    reasonCode: 'litigation_preservation',
    authorityRole: 'legal_hold_admin',
    authorityReferenceHash: 'a'.repeat(64),
    reviewAt: new Date(createdAt.getTime() + 30 * 86400_000).toISOString(),
    expiresAt: new Date(createdAt.getTime() + 180 * 86400_000).toISOString(),
  }), createdAt)
  const primaryAt = new Date(createdAt.getTime() + 31 * 86400_000)

  await assert.rejects(repository.process(operator, deletion.id, { expectedVersion: deletion.version, reasonCode: 'primary_delete' }, primaryAt), { code: 'DATA_RIGHTS_LEGAL_HOLD_ACTIVE' })
  const blocked = await repository.getAdmin(deletion.id)
  assert.equal(blocked.status, 'blocked')
  assert.equal(blocked.blockedReasonCode, 'legal_hold_active')
  assert.equal(blocked.deletionReceipts.length, 14)
  assert.equal(blocked.deletionReceipts.some((receipt) => receipt.domain === 'creative'), false)
  assert.deepEqual(lifecycle, ['local'])
  assert.equal((await repository.listLegalHolds({ status: 'active', limit: 10 }, operator, primaryAt))[0].status, 'active')

  const released = await repository.releaseLegalHold(operator, hold.id, { expectedVersion: hold.version, reasonCode: 'matter_closed' }, new Date(primaryAt.getTime() + 1000))
  assert.equal(released.status, 'released')
  assert.equal(released.events.at(-1).eventType, 'legal_hold_released')
  const completed = await repository.process(operator, deletion.id, { expectedVersion: blocked.version, reasonCode: 'primary_delete' }, new Date(primaryAt.getTime() + 2000))
  assert.equal(completed.status, 'primary_completed')
  assert.equal(completed.deletionReceipts.length, 15)
  assert.deepEqual(lifecycle, ['local', 'provider-list', 'local'])
})

test('seed expired legal hold no longer blocks an unrelated due deletion run', async () => {
  let deleted = false
  const repository = createSeedDataRightsRepository({
    accountForActor: async (candidate) => candidate.id === actor.id ? actor : null,
    applyDeletion: async () => { deleted = true; return {} },
  })
  const deletion = await repository.create(actor, request('account_deletion'), { sessionIssuedAt: createdAt, now: createdAt })
  await repository.createLegalHold(operator, parseDataRightsLegalHold({
    subjectId: actor.id,
    scopeDomain: 'audit',
    reasonCode: 'incident_preservation',
    authorityRole: 'security_legal_incident_owner',
    authorityReferenceHash: 'b'.repeat(64),
    reviewAt: new Date(createdAt.getTime() + 10 * 86400_000).toISOString(),
    expiresAt: new Date(createdAt.getTime() + 40 * 86400_000).toISOString(),
  }), createdAt)
  const afterExpiry = new Date(createdAt.getTime() + 41 * 86400_000)
  const completed = await repository.process(operator, deletion.id, { expectedVersion: deletion.version, reasonCode: 'primary_delete' }, afterExpiry)
  assert.equal(completed.status, 'primary_completed')
  assert.equal(deleted, true)
  assert.equal((await repository.listLegalHolds({ status: 'expired', limit: 10 }, operator, afterExpiry))[0].status, 'expired')
})
