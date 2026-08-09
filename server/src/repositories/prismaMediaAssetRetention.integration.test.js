import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { dataRightsSafeSubjectRef } from '../dataRights/dataRightsLifecycle.js'
import { createPrismaMediaAssetRetentionRepository } from '../media/prismaMediaAssetRetentionRepository.js'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma media asset retention tombstones metadata after object deletion and fails closed on holds and concurrent references', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const session = await repository.auth.registerEmailAccount({
    email: `media-retention-${suffix}@example.test`, password: 'media-retention-password',
    displayName: 'Media Retention', handle: `mr${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-20)}`,
  })
  const user = session.user
  const subjectRef = dataRightsSafeSubjectRef(user.id)
  const now = new Date('2028-07-29T00:00:00.000Z')
  const old = new Date('2028-01-01T00:00:00.000Z')
  const ids = {
    eligible: `media-retention-eligible-${suffix}`,
    held: `media-retention-held-${suffix}`,
    objectPending: `media-retention-object-pending-${suffix}`,
    pendingNoObject: `media-retention-pending-no-object-${suffix}`,
    target: `media-retention-target-${suffix}`,
    generation: `media-retention-generation-${suffix}`,
    task: `media-retention-task-${suffix}`,
    submission: `media-retention-submission-${suffix}`,
    conversation: `media-retention-conversation-${suffix}`,
    turn: `media-retention-turn-${suffix}`,
    scan: `media-retention-scan-${suffix}`,
    portfolio: `media-retention-portfolio-${suffix}`,
    library: `media-retention-library-${suffix}`,
    relation: `media-retention-relation-${suffix}`,
    hold: `media-retention-hold-${suffix}`,
    racingHoldAsset: `media-retention-racing-hold-asset-${suffix}`,
    racingHold: `media-retention-racing-hold-${suffix}`,
  }
  const createAsset = async (id, state = 'deleted') => {
    await repository.client.mediaAsset.create({ data: {
      id, ownerId: user.id, fileName: 'private-name.png', storageKey: `private/${id}.png`, contentType: 'image/png',
      sizeBytes: 4096, purpose: 'library_asset', status: 'uploaded', metadata: { privatePrompt: 'remove me' },
      deletedAt: old, deletedByHandle: user.handle, deletionReason: 'user_requested', createdAt: old, updatedAt: old,
    } })
    await repository.client.mediaStorageObject.create({ data: {
      assetId: id, provider: 's3', state, etag: 'private-etag', checksumSha256: 'a'.repeat(64),
      verifiedSizeBytes: 4096, verifiedContentType: 'image/png', deletedAt: state === 'deleted' ? old : null,
    } })
  }

  try {
    await createAsset(ids.eligible)
    await createAsset(ids.held)
    await createAsset(ids.objectPending, 'cleanup_pending')
    await repository.client.mediaAsset.create({ data: {
      id: ids.pendingNoObject, ownerId: user.id, fileName: 'abandoned.tmp', storageKey: `private/${ids.pendingNoObject}`,
      contentType: 'application/octet-stream', sizeBytes: 0, purpose: 'library_asset', status: 'pending', createdAt: old, updatedAt: old,
    } })
    await repository.client.mediaAsset.create({ data: {
      id: ids.target, ownerId: user.id, fileName: 'target.png', storageKey: `private/${ids.target}.png`, contentType: 'image/png',
      sizeBytes: 1024, purpose: 'library_asset', status: 'uploaded', createdAt: now, updatedAt: now,
    } })
    assert.equal((await repository.client.mediaAsset.findUnique({ where: { id: ids.eligible } })).subjectRef, subjectRef)

    await repository.client.creativeGeneration.create({ data: {
      id: ids.generation, actorId: user.id, actorHandle: user.handle, subjectRef, workspace: 'image', mode: 'text_to_image',
      providerId: 'retention-provider', status: 'completed', promptHash: 'b'.repeat(64), inputAssetIds: [ids.eligible],
      parameterKeys: [], outputAssetIds: [ids.eligible], completedAt: old, createdAt: old, updatedAt: old,
    } })
    await repository.client.creativeGenerationAsset.create({ data: { generationId: ids.generation, assetId: ids.eligible, ownerId: user.id, direction: 'output', position: 0 } })
    await repository.client.task.create({ data: {
      id: ids.task, title: 'Retention task', category: 'design', description: 'Retention fixture',
      acceptanceRules: 'Retention fixture', pointsReward: 0, status: 'completed', publisherId: user.id,
      assigneeId: user.id, visibility: 'invite_only', createdAt: old, updatedAt: old,
    } })
    await repository.client.taskSubmission.create({ data: {
      id: ids.submission, taskId: ids.task, submitterId: user.id, content: 'Retention fixture',
      assetIds: [ids.eligible], status: 'approved', createdAt: old, updatedAt: old,
    } })
    await repository.client.taskSubmissionAsset.create({ data: {
      submissionId: ids.submission, assetId: ids.eligible, ownerId: user.id, position: 0,
    } })
    await repository.client.chatConversation.create({ data: {
      id: ids.conversation, ownerId: user.id, mode: 'general', retentionExpiresAt: new Date('2029-07-29T00:00:00.000Z'),
    } })
    await repository.client.chatTurn.create({ data: {
      id: ids.turn, conversationId: ids.conversation, clientTurnId: `client-${suffix}`,
      mode: 'general', status: 'completed', inputAssetIds: [ids.eligible], completedAt: old,
    } })
    await repository.client.chatTurnInputAsset.create({ data: {
      turnId: ids.turn, assetId: ids.eligible, ownerId: user.id, position: 0,
    } })
    await repository.client.mediaScanJob.create({ data: {
      id: ids.scan, assetId: ids.eligible, provider: 'fixture', status: 'completed', scanStatus: 'clean',
      externalScanId: `private-${suffix}`, reviewedById: user.id, reviewedAt: old, note: 'Private note',
      rejectionReason: 'Private reason', metadata: { private: true }, createdAt: old, updatedAt: old,
    } })
    await repository.client.profilePortfolioAsset.create({ data: { id: ids.portfolio, ownerId: user.id, assetId: ids.eligible, title: 'Private title', caption: 'Private caption' } })
    await repository.client.libraryItem.create({ data: { id: ids.library, userId: user.id, sourceType: 'asset', sourceId: ids.eligible, title: 'Private copy', content: 'Private content' } })
    await repository.client.mediaAssetRelation.create({ data: { id: ids.relation, ownerId: user.id, sourceAssetId: ids.eligible, targetAssetId: ids.target, relationType: 'parent' } })
    await repository.client.dataRightsLegalHold.create({ data: {
      id: ids.hold, subjectId: user.id, subjectRef, scopeDomain: 'media', reasonCode: 'retention_fixture',
      authorityRole: 'legal_hold_admin', authorityReferenceHash: 'c'.repeat(64), ownerRef: `actor_${'d'.repeat(24)}`,
      reviewAt: new Date(now.getTime() + 86_400_000), expiresAt: new Date(now.getTime() + 7 * 86_400_000),
    } })

    let result = await repository.mediaAssetRetention.sweepRetention({ now, limit: 1 })
    assert.equal(result.recordsRedacted, 0)
    await repository.dataRights.releaseLegalHold(user, ids.hold, { expectedVersion: 1, reasonCode: 'retention_fixture_complete' }, now)

    let auditEntered
    const entered = new Promise((resolve) => { auditEntered = resolve })
    let releaseAudit
    const release = new Promise((resolve) => { releaseAudit = resolve })
    const racingRepository = createPrismaMediaAssetRetentionRepository(repository.client, {
      recordAudit: async () => { auditEntered(); await release },
    })
    const sweep = racingRepository.sweepRetention({ now, limit: 1 })
    await entered
    const racingReference = assert.rejects(repository.client.mediaAssetRelation.create({ data: {
      id: `media-retention-racing-${suffix}`, ownerId: user.id, sourceAssetId: ids.eligible,
      targetAssetId: ids.target, relationType: 'variant',
    } }), /MEDIA_ASSET_RETENTION_REDACTED/)
    await new Promise((resolve) => setTimeout(resolve, 50))
    releaseAudit()
    result = await sweep
    assert.equal(result.recordsRedacted, 1)
    await racingReference

    const tombstone = await repository.client.mediaAsset.findUnique({ where: { id: ids.eligible }, include: { storageObject: true } })
    assert.equal(tombstone.ownerId, null)
    assert.equal(tombstone.subjectRef, null)
    assert.equal(tombstone.fileName, '[deleted]')
    assert.match(tombstone.storageKey, /^retained\/[a-f0-9]{64}$/)
    assert.equal(tombstone.sizeBytes, 0)
    assert.equal(tombstone.metadata, null)
    assert.equal(tombstone.storageObject.checksumSha256, null)
    assert.deepEqual(tombstone.retentionSummary, { policyId: 'media_asset_delete_plus_30d', schemaVersion: 1, objectDeletionVerified: true, objectNeverPersisted: false, relatedRecordsMinimized: 7 })
    const portfolio = await repository.client.profilePortfolioAsset.findUnique({ where: { id: ids.portfolio } })
    assert.equal(portfolio.ownerId, null)
    assert.equal(portfolio.sourceGenerationId, null)
    assert.equal(portfolio.sourceSubmissionId, null)
    assert.equal(portfolio.title, '[deleted]')
    assert.equal(portfolio.caption, '')
    assert.equal(portfolio.status, 'archived')
    assert.equal(await repository.client.libraryItem.count({ where: { sourceType: 'asset', sourceId: ids.eligible } }), 0)
    const relation = await repository.client.mediaAssetRelation.findUnique({ where: { id: ids.relation } })
    assert.equal(relation.ownerId, null)
    assert.equal(relation.sourceGenerationId, null)
    assert.equal(relation.targetWorkspace, null)
    assert.equal(relation.role, null)
    const generationAsset = await repository.client.creativeGenerationAsset.findUnique({ where: {
      generationId_direction_assetId: { generationId: ids.generation, direction: 'output', assetId: ids.eligible },
    } })
    assert.equal(generationAsset.ownerId, null)
    const submissionAsset = await repository.client.taskSubmissionAsset.findUnique({ where: {
      submissionId_assetId: { submissionId: ids.submission, assetId: ids.eligible },
    } })
    assert.equal(submissionAsset.ownerId, null)
    const chatAsset = await repository.client.chatTurnInputAsset.findUnique({ where: {
      turnId_assetId: { turnId: ids.turn, assetId: ids.eligible },
    } })
    assert.equal(chatAsset.ownerId, null)
    const scan = await repository.client.mediaScanJob.findUnique({ where: { id: ids.scan } })
    assert.equal(scan.externalScanId, null)
    assert.equal(scan.reviewedById, null)
    assert.equal(scan.note, null)
    assert.equal(scan.rejectionReason, null)
    assert.equal(scan.metadata, null)
    const generation = await repository.client.creativeGeneration.findUnique({ where: { id: ids.generation } })
    assert.deepEqual(generation.inputAssetIds, [])
    assert.deepEqual(generation.outputAssetIds, [])
    assert.deepEqual((await repository.client.taskSubmission.findUnique({ where: { id: ids.submission } })).assetIds, [])
    assert.deepEqual((await repository.client.chatTurn.findUnique({ where: { id: ids.turn } })).inputAssetIds, [])
    await assert.rejects(repository.client.mediaAsset.update({ where: { id: ids.eligible }, data: { fileName: 'restored.png' } }), /MEDIA_ASSET_RETENTION_REDACTED/)
    await assert.rejects(repository.client.$executeRawUnsafe(`
      WITH maintenance AS (SELECT set_config('app.media_asset_retention_maintenance', 'on', true))
      UPDATE media_assets SET retention_summary = retention_summary || '{"private":"leak"}'::jsonb
      FROM maintenance WHERE id = $1`, ids.eligible), /media_assets_retention_tombstone_valid/)
    await assert.rejects(repository.media.setAdminAssetDeleted(ids.eligible, false, user), { code: 'ASSET_RETENTION_REDACTED' })
    assert.equal((await repository.client.mediaAsset.findUnique({ where: { id: ids.objectPending } })).retentionRedactedAt, null)
    result = await repository.mediaAssetRetention.sweepRetention({ now, limit: 10 })
    assert.equal(result.recordsRedacted, 2)
    const neverPersisted = await repository.client.mediaAsset.findUnique({ where: { id: ids.pendingNoObject } })
    assert.deepEqual(neverPersisted.retentionSummary, { policyId: 'media_asset_delete_plus_30d', schemaVersion: 1, objectDeletionVerified: false, objectNeverPersisted: true, relatedRecordsMinimized: 0 })

    await createAsset(ids.racingHoldAsset)
    let holdLockEntered
    const holdLock = new Promise((resolve) => { holdLockEntered = resolve })
    let releaseHoldLock
    const holdRelease = new Promise((resolve) => { releaseHoldLock = resolve })
    const racingHold = repository.client.$transaction(async (db) => {
      await db.$queryRawUnsafe('SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))', 'security-retention-legal-holds')
      await db.$queryRawUnsafe('SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))', `data-rights-subject-ref:${subjectRef}`)
      holdLockEntered()
      await holdRelease
      return db.dataRightsLegalHold.create({ data: {
        id: ids.racingHold, subjectId: user.id, subjectRef, scopeDomain: 'media', reasonCode: 'retention_race',
        authorityRole: 'legal_hold_admin', authorityReferenceHash: 'e'.repeat(64), ownerRef: `actor_${'f'.repeat(24)}`,
        reviewAt: new Date(now.getTime() + 86_400_000), expiresAt: new Date(now.getTime() + 7 * 86_400_000),
      } })
    })
    await holdLock
    const heldSweep = repository.mediaAssetRetention.sweepRetention({ now, limit: 10 })
    releaseHoldLock()
    await racingHold
    result = await heldSweep
    assert.equal(result.recordsRedacted, 0)
    assert.equal((await repository.client.mediaAsset.findUnique({ where: { id: ids.racingHoldAsset } })).retentionRedactedAt, null)
  } finally {
    await repository.client.$transaction(async (db) => {
      await db.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await db.$executeRawUnsafe("SET LOCAL app.data_rights_maintenance = 'on'")
      await db.mediaAssetRelation.deleteMany({ where: { OR: [{ sourceAssetId: { in: Object.values(ids) } }, { targetAssetId: { in: Object.values(ids) } }] } })
      await db.chatTurnInputAsset.deleteMany({ where: { turnId: ids.turn } })
      await db.chatTurn.deleteMany({ where: { id: ids.turn } })
      await db.chatConversation.deleteMany({ where: { id: ids.conversation } })
      await db.taskSubmissionAsset.deleteMany({ where: { submissionId: ids.submission } })
      await db.taskSubmission.deleteMany({ where: { id: ids.submission } })
      await db.task.deleteMany({ where: { id: ids.task } })
      await db.creativeGenerationAsset.deleteMany({ where: { generationId: ids.generation } })
      await db.creativeGeneration.deleteMany({ where: { id: ids.generation } })
      await db.profilePortfolioAsset.deleteMany({ where: { assetId: { in: Object.values(ids) } } })
      await db.libraryItem.deleteMany({ where: { sourceId: { in: Object.values(ids) } } })
      await db.mediaScanJob.deleteMany({ where: { assetId: { in: Object.values(ids) } } })
      await db.mediaStorageObject.deleteMany({ where: { assetId: { in: Object.values(ids) } } })
      await db.mediaAsset.deleteMany({ where: { id: { in: Object.values(ids) } } })
      await db.dataRightsLegalHoldEvent.deleteMany({ where: { legalHoldId: { in: [ids.hold, ids.racingHold] } } })
      await db.dataRightsLegalHold.deleteMany({ where: { id: { in: [ids.hold, ids.racingHold] } } })
      await db.auditEvent.deleteMany({ where: { OR: [{ actorId: user.id }, { resourceType: 'media_asset_retention' }] } })
      await db.refreshToken.deleteMany({ where: { userId: user.id } })
      await db.authSession.deleteMany({ where: { userId: user.id } })
      await db.authAccount.deleteMany({ where: { userId: user.id } })
      await db.profile.deleteMany({ where: { userId: user.id } })
      await db.user.delete({ where: { id: user.id } })
    })
    await repository.client.$disconnect()
  }
})
