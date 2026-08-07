import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { createChatMessageCodec } from '../chat/messageCrypto.js'
import { parseBackupExpiryReceipt, parseDataRightsLegalHold, parseDataRightsRequest } from '../dataRights/dataRightsLifecycle.js'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL
const dayMs = 86400_000

test('Prisma data rights lifecycle exports owned data, erases primary data, and preserves immutable evidence', { skip: !databaseUrl }, async () => {
  const originalFetch = globalThis.fetch
  const providerEnvironment = [
    'DATA_RIGHTS_PROVIDER_DELETION_GATEWAY_ENABLED',
    'DATA_RIGHTS_PROVIDER_DELETION_GATEWAY_CONFIRMATION',
    'DATA_RIGHTS_PROVIDER_DELETION_GATEWAY_URL',
    'DATA_RIGHTS_PROVIDER_DELETION_GATEWAY_TOKEN',
  ]
  const originalProviderEnvironment = Object.fromEntries(providerEnvironment.map((key) => [key, process.env[key]]))
  let providerBarrier = null
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  process.env.STORAGE_DRIVER = 'mock'
  process.env.CHAT_MESSAGE_ENCRYPTION_ACTIVE_KEY_ID = 'integration-v1'
  process.env.CHAT_MESSAGE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
  process.env.DATA_RIGHTS_PROVIDER_DELETION_GATEWAY_ENABLED = 'true'
  process.env.DATA_RIGHTS_PROVIDER_DELETION_GATEWAY_CONFIRMATION = 'provider-deletion-enabled'
  process.env.DATA_RIGHTS_PROVIDER_DELETION_GATEWAY_URL = 'https://provider-deletion.integration.test/v1/deletions'
  process.env.DATA_RIGHTS_PROVIDER_DELETION_GATEWAY_TOKEN = 'integration-provider-deletion-token'
  globalThis.fetch = async () => {
    if (providerBarrier) {
      providerBarrier.started()
      await providerBarrier.release
    }
    return { ok: true, text: async () => JSON.stringify({ status: 'completed', receiptId: `receipt-${randomUUID()}`, deletedOperationCount: 1 }) }
  }

  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  assert.ok(repository)

  const runId = `data-rights-${Date.now()}-${randomUUID().slice(0, 8)}`
  const handle = `dr${runId.replaceAll(/[^a-z0-9]/gi, '').slice(-24)}`
  const adminHandle = `da${runId.replaceAll(/[^a-z0-9]/gi, '').slice(-24)}`
  const now = new Date()
  const userIds = []
  const requestIds = []
  const legalHoldIds = []
  let creativeGenerationId = null
  let mediaAssetId = null
  let portfolioAssetId = null
  let supportTicketId = null
  let raceCreativeGenerationId = null

  try {
    const ownerSession = await repository.auth.registerEmailAccount({
      email: `${runId}-owner@example.test`,
      password: 'data-rights-integration-password',
      displayName: 'Data Rights Owner',
      handle,
    })
    const adminSession = await repository.auth.registerEmailAccount({
      email: `${runId}-admin@example.test`,
      password: 'data-rights-integration-password',
      displayName: 'Data Rights Admin',
      handle: adminHandle,
    })
    const owner = ownerSession.user
    const operator = adminSession.user
    userIds.push(owner.id, operator.id)

    const conversationId = `conversation-${randomUUID()}`
    const turnId = `turn-${randomUUID()}`
    const messageId = `message-${randomUUID()}`
    const messageContent = 'Please export this encrypted conversation content.'
    const codec = createChatMessageCodec({
      activeKeyId: 'integration-v1',
      keys: new Map([['integration-v1', Buffer.alloc(32, 7)]]),
    })
    const encrypted = codec.encrypt(messageContent, { conversationId, messageId, role: 'user', sequence: 1 })
    await repository.client.chatConversation.create({ data: {
      id: conversationId,
      ownerId: owner.id,
      mode: 'general',
      retentionExpiresAt: new Date(now.getTime() + 365 * dayMs),
    } })
    await repository.client.chatTurn.create({ data: {
      id: turnId,
      conversationId,
      clientTurnId: `client-${randomUUID()}`,
      mode: 'general',
      status: 'completed',
      completedAt: now,
    } })
    await repository.client.chatMessage.create({ data: {
      id: messageId,
      conversationId,
      turnId,
      role: 'user',
      status: 'complete',
      sequence: 1,
      ...encrypted,
    } })

    mediaAssetId = `media-${randomUUID()}`
    await repository.client.mediaAsset.create({ data: {
      id: mediaAssetId,
      ownerId: owner.id,
      fileName: 'private-export-source.png',
      storageKey: `integration/${runId}/private-export-source.png`,
      contentType: 'image/png',
      sizeBytes: 128,
      purpose: 'profile_portfolio',
      status: 'uploaded',
    } })
    await repository.client.mediaStorageObject.create({ data: {
      assetId: mediaAssetId,
      provider: 'mock',
      state: 'available',
    } })
    portfolioAssetId = `portfolio-${randomUUID()}`
    await repository.client.profilePortfolioAsset.create({ data: {
      id: portfolioAssetId,
      ownerId: owner.id,
      assetId: mediaAssetId,
      title: 'Private portfolio title',
      caption: 'Private portfolio caption',
    } })
    await repository.client.libraryItem.create({ data: {
      userId: owner.id,
      sourceType: 'external',
      title: 'Private library title',
      content: 'Private library content',
    } })
    await repository.client.notificationPreference.create({ data: {
      userId: owner.id,
      notificationType: 'task.updated',
      inAppEnabled: false,
    } })
    supportTicketId = `support-${randomUUID()}`
    await repository.client.supportTicket.create({ data: {
      id: supportTicketId,
      requesterId: owner.id,
      category: 'privacy',
      subject: 'Private support subject',
      details: 'Private support details',
      firstResponseDueAt: new Date(now.getTime() + dayMs),
      resolutionDueAt: new Date(now.getTime() + 3 * dayMs),
    } })
    await repository.client.supportTicketMessage.create({ data: {
      ticketId: supportTicketId,
      authorId: owner.id,
      authorType: 'requester',
      body: 'Private support message',
    } })
    const likedPost = await repository.client.post.create({ data: {
      authorId: operator.id,
      title: 'Integration post',
      body: 'Integration post body',
      category: 'General',
      tag: 'integration',
    } })
    await repository.client.postLike.create({ data: { postId: likedPost.id, userId: owner.id } })

    let ownerRow = await repository.client.user.findUniqueOrThrow({ where: { id: owner.id } })
    const exportRequest = await repository.dataRights.create(owner, parseDataRightsRequest({
      requestType: 'data_export',
      identityConfirmation: handle,
      reasonCode: 'integration_export',
      expectedAccountVersion: ownerRow.accountVersion,
    }), { sessionIssuedAt: now, now })
    requestIds.push(exportRequest.id)
    const completedExport = await repository.dataRights.process(operator, exportRequest.id, {
      expectedVersion: exportRequest.version,
      reasonCode: 'integration_export_generated',
    }, now)
    assert.equal(completedExport.status, 'completed')
    assert.equal(completedExport.artifact.checksumSha256.length, 64)

    const exported = await repository.dataRights.exportPackage(owner, exportRequest.id, now)
    assert.equal(exported.package.data.chat[0].messages[0].content, messageContent)
    assert.equal(exported.package.data.library[0].content, 'Private library content')
    assert.equal(exported.package.data.support[0].messages[0].body, 'Private support message')
    assert.equal(exported.package.data.notifications.preferences[0].inAppEnabled, false)
    assert.equal(exported.package.data.community.likes.length, 1)
    assert.equal(JSON.stringify(exported.package).includes(encrypted.ciphertext), false)
    assert.equal(JSON.stringify(exported.package).includes('encryptionKeyId'), false)
    assert.equal(new Date(exported.download.expiresAt).getTime() - now.getTime(), 900_000)
    await assert.rejects(repository.client.dataRightsExportArtifact.delete({ where: { requestId: exportRequest.id } }), /immutable evidence/)
    const retentionAt = new Date(now.getTime() + 8 * dayMs)
    const retentionResult = await repository.dataRights.sweepExpiredExports({ now: retentionAt, limit: 100 })
    assert.equal(retentionResult.failed, 0)
    assert.ok(retentionResult.deleted >= 1)
    assert.equal(retentionResult.deleted, retentionResult.due)
    assert.equal(await repository.client.dataRightsExportArtifact.findUnique({ where: { requestId: exportRequest.id } }), null)
    const retainedExportRequest = await repository.dataRights.getAdmin(exportRequest.id)
    assert.ok(retainedExportRequest.events.some((event) => event.eventType === 'export_artifact_expired' && event.metadata.receiptHash.length === 64))

    ownerRow = await repository.client.user.findUniqueOrThrow({ where: { id: owner.id } })
    const deletionRequestedAt = new Date(now.getTime() + 60_000)
    creativeGenerationId = `generation-${randomUUID()}`
    await repository.client.creativeGeneration.create({ data: {
      id: creativeGenerationId,
      actorId: owner.id,
      actorHandle: owner.handle,
      workspace: 'image',
      mode: 'generate',
      providerId: 'mock',
      status: 'completed',
      promptHash: 'f'.repeat(64),
      promptPreview: 'Held creative evidence',
      inputAssetIds: [],
      parameterKeys: [],
      outputAssetIds: [],
      completedAt: deletionRequestedAt,
    } })
    const deletionRequest = await repository.dataRights.create(owner, parseDataRightsRequest({
      requestType: 'account_deletion',
      identityConfirmation: handle,
      reasonCode: 'integration_delete',
      expectedAccountVersion: ownerRow.accountVersion,
    }), { sessionIssuedAt: deletionRequestedAt, now: deletionRequestedAt })
    requestIds.push(deletionRequest.id)
    await assert.rejects(repository.dataRights.process(operator, deletionRequest.id, {
      expectedVersion: deletionRequest.version,
      reasonCode: 'integration_primary_delete',
    }, deletionRequestedAt), { code: 'DATA_RIGHTS_GRACE_PERIOD_ACTIVE' })

    const primaryAt = new Date(deletionRequestedAt.getTime() + 31 * dayMs)
    const legalHold = await repository.dataRights.createLegalHold(operator, parseDataRightsLegalHold({
      subjectId: owner.id,
      scopeDomain: 'creative',
      reasonCode: 'integration_preservation',
      authorityRole: 'legal_hold_admin',
      authorityReferenceHash: 'd'.repeat(64),
      reviewAt: new Date(deletionRequestedAt.getTime() + 60 * dayMs).toISOString(),
      expiresAt: new Date(deletionRequestedAt.getTime() + 180 * dayMs).toISOString(),
    }), deletionRequestedAt)
    legalHoldIds.push(legalHold.id)
    await assert.rejects(repository.dataRights.process(operator, deletionRequest.id, {
      expectedVersion: deletionRequest.version,
      reasonCode: 'integration_primary_delete',
    }, primaryAt), { code: 'DATA_RIGHTS_LEGAL_HOLD_ACTIVE' })
    const blocked = await repository.dataRights.getAdmin(deletionRequest.id)
    assert.equal(blocked.status, 'blocked')
    assert.equal(blocked.deletionReceipts.length, 14)
    assert.equal(blocked.deletionReceipts.some((receipt) => receipt.domain === 'creative'), false)
    assert.equal((await repository.client.creativeGeneration.findUniqueOrThrow({ where: { id: creativeGenerationId } })).actorId, owner.id)
    assert.equal(await repository.client.chatConversation.count({ where: { ownerId: owner.id } }), 0)
    await assert.rejects(repository.client.dataRightsLegalHold.delete({ where: { id: legalHold.id } }), /cannot be deleted/)
    await assert.rejects(repository.client.dataRightsLegalHoldEvent.update({ where: { id: legalHold.events[0].id }, data: { reasonCode: 'tampered' } }), /immutable evidence/)

    const released = await repository.dataRights.releaseLegalHold(operator, legalHold.id, { expectedVersion: legalHold.version, reasonCode: 'integration_matter_closed' }, new Date(primaryAt.getTime() + 1000))
    assert.equal(released.status, 'released')
    const primary = await repository.dataRights.process(operator, deletionRequest.id, {
      expectedVersion: blocked.version,
      reasonCode: 'integration_primary_delete',
    }, new Date(primaryAt.getTime() + 2000))
    assert.equal(primary.status, 'primary_completed')
    assert.equal(primary.deletionReceipts.length, 15)
    assert.equal((await repository.client.creativeGeneration.findUniqueOrThrow({ where: { id: creativeGenerationId } })).actorId, null)
    assert.equal(await repository.client.authAccount.count({ where: { userId: owner.id } }), 0)
    assert.equal(await repository.client.chatConversation.count({ where: { ownerId: owner.id } }), 0)
    assert.equal((await repository.client.authSession.findFirstOrThrow({ where: { userId: owner.id } })).revokedAt?.toISOString(), primaryAt.toISOString())
    const deletedUser = await repository.client.user.findUniqueOrThrow({ where: { id: owner.id } })
    assert.equal(deletedUser.status, 'deleted')
    assert.equal(deletedUser.email, null)
    const deletedProfile = await repository.client.profile.findUniqueOrThrow({ where: { userId: owner.id } })
    assert.equal(deletedProfile.visibility, 'private')
    assert.equal(deletedProfile.discoverable, false)
    const deletedAsset = await repository.client.mediaAsset.findUniqueOrThrow({ where: { id: mediaAssetId } })
    assert.equal(deletedAsset.deletedAt?.toISOString(), primaryAt.toISOString())
    assert.equal(deletedAsset.fileName, '[deleted]')
    assert.equal((await repository.client.mediaStorageObject.findUniqueOrThrow({ where: { assetId: mediaAssetId } })).state, 'cleanup_pending')
    assert.equal((await repository.client.profilePortfolioAsset.findUniqueOrThrow({ where: { id: portfolioAssetId } })).status, 'archived')
    assert.equal((await repository.client.libraryItem.findFirstOrThrow({ where: { userId: owner.id } })).content, '')
    assert.equal(await repository.client.notificationPreference.count({ where: { userId: owner.id } }), 0)
    assert.equal(await repository.client.postLike.count({ where: { userId: owner.id } }), 0)
    const redactedTicket = await repository.client.supportTicket.findUniqueOrThrow({ where: { id: supportTicketId } })
    assert.equal(redactedTicket.subject, '[retained support record]')
    assert.equal(redactedTicket.dataRightsRedactedAt?.toISOString(), primaryAt.toISOString())
    const redactedMessage = await repository.client.supportTicketMessage.findFirstOrThrow({ where: { ticketId: supportTicketId } })
    assert.equal(redactedMessage.body, '[redacted]')
    assert.equal(redactedMessage.dataRightsRedactedAt?.toISOString(), primaryAt.toISOString())

    const backupAt = new Date(new Date(primary.primaryCompletedAt).getTime() + 35 * dayMs)
    let finalRequest = primary
    for (const [index, backupClass] of ['primary_database', 'object_storage', 'audit_archive'].entries()) {
      finalRequest = await repository.dataRights.recordBackupReceipt(operator, deletionRequest.id, parseBackupExpiryReceipt({
        backupClass,
        objectRefHash: String(index + 1).repeat(64),
        evidenceHash: String(index + 4).repeat(64),
        expiredAt: backupAt.toISOString(),
        verifiedByRef: 'integration_backup_operator',
      }), backupAt)
      assert.equal(finalRequest.status, index === 2 ? 'completed' : 'primary_completed')
    }
    assert.equal(finalRequest.backupReceipts.length, 3)

    const raceSession = await repository.auth.registerEmailAccount({
      email: `${runId}-race-owner@example.test`,
      password: 'data-rights-integration-password',
      displayName: 'Data Rights Race Owner',
      handle: `race${runId.replaceAll(/[^a-z0-9]/gi, '').slice(-20)}`,
    })
    const raceOwner = raceSession.user
    userIds.push(raceOwner.id)
    raceCreativeGenerationId = `generation-${randomUUID()}`
    await repository.client.creativeGeneration.create({ data: {
      id: raceCreativeGenerationId,
      actorId: raceOwner.id,
      actorHandle: raceOwner.handle,
      workspace: 'image',
      mode: 'generate',
      providerId: 'hcai-router',
      providerJobId: `provider-job-${randomUUID()}`,
      status: 'completed',
      promptHash: 'e'.repeat(64),
      promptPreview: 'Concurrent legal hold cutoff evidence',
      inputAssetIds: [],
      parameterKeys: [],
      outputAssetIds: [],
      completedAt: now,
    } })
    const raceOwnerRow = await repository.client.user.findUniqueOrThrow({ where: { id: raceOwner.id } })
    const raceRequestedAt = new Date(now.getTime() + 120_000)
    const raceDeletion = await repository.dataRights.create(raceOwner, parseDataRightsRequest({
      requestType: 'account_deletion',
      identityConfirmation: raceOwner.handle,
      reasonCode: 'integration_concurrent_delete',
      expectedAccountVersion: raceOwnerRow.accountVersion,
    }), { sessionIssuedAt: raceRequestedAt, now: raceRequestedAt })
    requestIds.push(raceDeletion.id)
    const racePrimaryAt = new Date(raceRequestedAt.getTime() + 31 * dayMs)
    let providerStartedResolve
    let providerReleaseResolve
    const providerStarted = new Promise((resolve) => { providerStartedResolve = resolve })
    const providerRelease = new Promise((resolve) => { providerReleaseResolve = resolve })
    providerBarrier = { started: providerStartedResolve, release: providerRelease }
    const raceProcessing = repository.dataRights.process(operator, raceDeletion.id, {
      expectedVersion: raceDeletion.version,
      reasonCode: 'integration_concurrent_primary_delete',
    }, racePrimaryAt)
    await providerStarted

    await assert.rejects(repository.dataRights.createLegalHold(operator, parseDataRightsLegalHold({
      subjectId: raceOwner.id,
      scopeDomain: 'creative',
      reasonCode: 'integration_late_preservation',
      authorityRole: 'legal_hold_admin',
      authorityReferenceHash: 'c'.repeat(64),
      reviewAt: new Date(racePrimaryAt.getTime() + 30 * dayMs).toISOString(),
      expiresAt: new Date(racePrimaryAt.getTime() + 180 * dayMs).toISOString(),
    }), racePrimaryAt), { code: 'DATA_RIGHTS_LEGAL_HOLD_CUTOFF_PASSED' })

    providerReleaseResolve()
    const raceCompleted = await raceProcessing
    providerBarrier = null
    assert.equal(raceCompleted.status, 'primary_completed')
    assert.ok(raceCompleted.deletionReceipts.some((receipt) => receipt.domain === 'provider:hcai-router'))
    assert.equal(await repository.client.dataRightsLegalHold.count({ where: { subjectId: raceOwner.id } }), 0)

    const eventId = finalRequest.events[0].id
    const deletionReceiptId = finalRequest.deletionReceipts[0].id
    const backupReceiptId = finalRequest.backupReceipts[0].id
    await assert.rejects(repository.client.dataRightsEvent.update({ where: { id: eventId }, data: { reasonCode: 'tampered' } }), /immutable evidence/)
    await assert.rejects(repository.client.dataRightsDeletionReceipt.update({ where: { id: deletionReceiptId }, data: { recordCount: 999 } }), /immutable evidence/)
    await assert.rejects(repository.client.dataRightsBackupExpiryReceipt.delete({ where: { id: backupReceiptId } }), /immutable evidence/)

    const metrics = await repository.dataRights.metrics()
    assert.ok(metrics.completed >= 2)
  } finally {
    await repository.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await transaction.$executeRawUnsafe("SET LOCAL app.data_rights_maintenance = 'on'")
      await transaction.dataRightsBackupExpiryReceipt.deleteMany({ where: { requestId: { in: requestIds } } })
      await transaction.dataRightsDeletionReceipt.deleteMany({ where: { requestId: { in: requestIds } } })
      await transaction.dataRightsExportArtifact.deleteMany({ where: { requestId: { in: requestIds } } })
      await transaction.dataRightsEvent.deleteMany({ where: { requestId: { in: requestIds } } })
      await transaction.dataRightsRequest.deleteMany({ where: { id: { in: requestIds } } })
      await transaction.dataRightsLegalHoldEvent.deleteMany({ where: { legalHoldId: { in: legalHoldIds } } })
      await transaction.dataRightsLegalHold.deleteMany({ where: { id: { in: legalHoldIds } } })
      if (creativeGenerationId) await transaction.creativeGeneration.deleteMany({ where: { id: creativeGenerationId } })
      if (raceCreativeGenerationId) await transaction.creativeGeneration.deleteMany({ where: { id: raceCreativeGenerationId } })
      if (mediaAssetId) {
        if (portfolioAssetId) await transaction.profilePortfolioAsset.deleteMany({ where: { id: portfolioAssetId } })
        await transaction.mediaStorageObject.deleteMany({ where: { assetId: mediaAssetId } })
        await transaction.mediaAsset.deleteMany({ where: { id: mediaAssetId } })
      }
      if (supportTicketId) {
        await transaction.supportTicketMessage.deleteMany({ where: { ticketId: supportTicketId } })
        await transaction.supportTicket.deleteMany({ where: { id: supportTicketId } })
      }
      await transaction.auditEvent.deleteMany({ where: { actorId: { in: userIds } } })
      await transaction.user.deleteMany({ where: { id: { in: userIds } } })
    })
    await repository.client.$disconnect()
    globalThis.fetch = originalFetch
    for (const key of providerEnvironment) {
      if (originalProviderEnvironment[key] == null) delete process.env[key]
      else process.env[key] = originalProviderEnvironment[key]
    }
  }
})
