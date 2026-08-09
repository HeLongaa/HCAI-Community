import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { dataRightsSafeSubjectRef } from '../dataRights/dataRightsLifecycle.js'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma Provider lifecycle retention minimizes terminal evidence and fails closed on reconciliation and legal hold', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const now = new Date('2028-07-28T00:00:00.000Z')
  const old = new Date('2027-01-01T00:00:00.000Z')
  const users = []
  const generationIds = {
    eligible: `provider-retention-eligible-${suffix}`,
    reconciliation: `provider-retention-reconciliation-${suffix}`,
    held: `provider-retention-held-${suffix}`,
  }
  const holdId = `provider-retention-hold-${suffix}`
  const issueId = `provider-retention-issue-${suffix}`

  const register = async (label) => {
    const session = await repository.auth.registerEmailAccount({
      email: `provider-retention-${label}-${suffix}@example.test`,
      password: 'provider-retention-password',
      displayName: `Provider Retention ${label}`,
      handle: `pr${label}${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-16)}`,
    })
    users.push(session.user)
    return session.user
  }
  const createGeneration = (id, user) => repository.client.creativeGeneration.create({ data: {
    id,
    actorId: user.id,
    actorHandle: user.handle,
    subjectRef: dataRightsSafeSubjectRef(user.id),
    workspace: 'video',
    mode: 'text_to_video',
    providerId: 'retention-provider',
    status: 'completed',
    promptHash: 'a'.repeat(64),
    promptPreview: 'bounded preview',
    inputAssetIds: [],
    parameterKeys: [],
    outputAssetIds: [],
    safety: { outcome: 'allow' },
    completedAt: old,
    createdAt: old,
    updatedAt: old,
  } })
  const createReplay = (generationId, label) => repository.client.creativeProviderReplayLedger.create({ data: {
    id: `provider-retention-replay-${label}-${suffix}`,
    generationId,
    providerId: 'retention-provider',
    providerMode: 'staging',
    providerJobId: `private-job-${label}`,
    providerEventId: `private-event-${label}`,
    sourceType: 'callback',
    idempotencyKey: `private-replay-key-${label}-${suffix}`,
    payloadHash: 'b'.repeat(64),
    previousStatus: 'running',
    normalizedStatus: 'completed',
    action: 'applied',
    reasonCode: 'provider_completed',
    sideEffectPlan: { operations: [{ assetId: 'private-asset', providerJobId: 'private-job' }] },
    sideEffectResult: { operations: [{ creditLedgerId: 'private-ledger', status: 'completed' }] },
    errorPreview: 'private error',
    receivedAt: old,
    appliedAt: old,
    createdAt: old,
    updatedAt: old,
  } })

  try {
    const eligibleUser = await register('eligible')
    const reconciliationUser = await register('reconciliation')
    const heldUser = await register('held')
    await createGeneration(generationIds.eligible, eligibleUser)
    await createGeneration(generationIds.reconciliation, reconciliationUser)
    await createGeneration(generationIds.held, heldUser)
    await createReplay(generationIds.eligible, 'eligible')
    await createReplay(generationIds.reconciliation, 'reconciliation')
    await createReplay(generationIds.held, 'held')

    await repository.client.creativeProviderOperation.create({ data: {
      id: `provider-retention-operation-${suffix}`,
      generationId: generationIds.eligible,
      providerId: 'retention-provider',
      providerMode: 'staging',
      providerJobId: 'private-operation-job',
      status: 'completed',
      timeoutAt: old,
      lastPayloadHash: 'c'.repeat(64),
      outputDigest: 'd'.repeat(64),
      sideEffectsComplete: true,
      safeMetadata: { providerUrl: 'private', outputAssetId: 'private-output' },
      terminalAt: old,
      createdAt: old,
      updatedAt: old,
    } })
    await repository.client.creativeGenerationMutation.create({ data: {
      id: `provider-retention-mutation-${suffix}`,
      generationId: generationIds.eligible,
      type: 'manual_replay',
      status: 'succeeded',
      idempotencyKey: `private-mutation-key-${suffix}`,
      requestedById: eligibleUser.id,
      requestedByHandle: eligibleUser.handle,
      reasonCode: 'manual_replay_completed',
      notePreview: 'private note',
      targetGenerationId: generationIds.held,
      safeMetadata: { privateRef: 'private' },
      result: { generationId: generationIds.held },
      completedAt: old,
      createdAt: old,
      updatedAt: old,
    } })
    await repository.client.creativeOutputIngestion.create({ data: {
      id: `provider-retention-ingestion-${suffix}`,
      sourceKey: `private-ingestion-key-${suffix}`,
      generationId: generationIds.eligible,
      providerId: 'retention-provider',
      providerJobId: 'private-ingestion-job',
      outputDigest: 'e'.repeat(64),
      outputIndex: 0,
      status: 'completed',
      mediaAssetId: 'private-media',
      storageKey: 'private/storage/key',
      detectedContentType: 'video/mp4',
      sizeBytes: 1234,
      sha256: 'f'.repeat(64),
      claimToken: 'private-claim',
      claimedAt: old,
      leaseExpiresAt: old,
      completedAt: old,
      createdAt: old,
      updatedAt: old,
    } })
    await repository.client.creativeProviderRetryState.create({ data: {
      id: `provider-retention-retry-${suffix}`,
      sourceKey: `private-retry-key-${suffix}`,
      generationId: generationIds.eligible,
      providerId: 'retention-provider',
      workspace: 'video',
      operationType: 'poll',
      status: 'cleared',
      attempt: 2,
      maxAttempts: 3,
      firstAttemptAt: old,
      lastAttemptAt: old,
      nextAttemptAt: old,
      lastFailureKeyHash: '1'.repeat(64),
      lastErrorCode: 'PROVIDER_TIMEOUT',
      lastErrorCategory: 'provider_unavailable',
      delaySource: 'provider_retry_after',
      policyHash: '2'.repeat(64),
      createdAt: old,
      updatedAt: old,
    } })
    await repository.client.accountingReconciliationIssue.create({ data: {
      id: issueId,
      issueKey: `provider-retention-issue-key-${suffix}`,
      type: 'provider_cost_mismatch',
      unit: 'creative_credit',
      status: 'open',
      sourceType: 'creative_generation',
      sourceId: generationIds.reconciliation,
      evidence: { generationId: generationIds.reconciliation },
      detectedAt: old,
      createdAt: old,
      updatedAt: old,
    } })
    await repository.client.dataRightsLegalHold.create({ data: {
      id: holdId,
      subjectId: heldUser.id,
      subjectRef: dataRightsSafeSubjectRef(heldUser.id),
      scopeDomain: 'audit',
      reasonCode: 'provider_retention_fixture',
      authorityRole: 'legal_hold_admin',
      authorityReferenceHash: '3'.repeat(64),
      ownerRef: `actor_${'4'.repeat(24)}`,
      reviewAt: new Date(now.getTime() + 86_400_000),
      expiresAt: new Date(now.getTime() + 7 * 86_400_000),
    } })

    const result = await repository.providerLifecycleRetention.sweepRetention({ now, limit: 10 })
    assert.deepEqual(result, { policyId: 'provider_lifecycle_terminal_180d', inspected: 1, generationsMinimized: 1, recordsMinimized: 5, blocked: 0 })

    const operation = await repository.client.creativeProviderOperation.findUnique({ where: { generationId: generationIds.eligible } })
    const mutation = await repository.client.creativeGenerationMutation.findFirst({ where: { generationId: generationIds.eligible } })
    const replay = await repository.client.creativeProviderReplayLedger.findFirst({ where: { generationId: generationIds.eligible } })
    const ingestion = await repository.client.creativeOutputIngestion.findFirst({ where: { generationId: generationIds.eligible } })
    const retry = await repository.client.creativeProviderRetryState.findFirst({ where: { generationId: generationIds.eligible } })
    assert.equal(operation.providerJobId, null)
    assert.equal(operation.safeMetadata.retained, true)
    assert.equal(mutation.requestedById, null)
    assert.equal(mutation.notePreview, null)
    assert.match(mutation.idempotencyKey, /^retained_mutation_/)
    assert.equal(replay.providerEventId, null)
    assert.equal(replay.errorPreview, null)
    assert.equal(replay.sideEffectPlan.operationCount, 1)
    assert.equal(ingestion.mediaAssetId, null)
    assert.equal(ingestion.storageKey, null)
    assert.equal(retry.nextAttemptAt, null)
    assert.equal(retry.delaySource, null)
    assert.ok([operation, mutation, replay, ingestion, retry].every((row) => row.retentionRedactedAt?.toISOString() === now.toISOString()))
    await assert.rejects(repository.client.creativeProviderReplayLedger.update({ where: { id: replay.id }, data: { errorPreview: 'restored' } }), /PROVIDER_LIFECYCLE_RETENTION_REDACTED/)
    assert.equal((await repository.client.creativeProviderReplayLedger.findFirst({ where: { generationId: generationIds.reconciliation } })).retentionRedactedAt, null)
    assert.equal((await repository.client.creativeProviderReplayLedger.findFirst({ where: { generationId: generationIds.held } })).retentionRedactedAt, null)
  } finally {
    await repository.client.$transaction(async (db) => {
      await db.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await db.$executeRawUnsafe("SET LOCAL app.data_rights_maintenance = 'on'")
      await db.$executeRawUnsafe("SET LOCAL app.provider_lifecycle_retention_maintenance = 'on'")
      await db.accountingReconciliationIssue.deleteMany({ where: { id: issueId } })
      await db.creativeProviderOperation.deleteMany({ where: { generationId: { in: Object.values(generationIds) } } })
      await db.creativeGenerationMutation.deleteMany({ where: { generationId: { in: Object.values(generationIds) } } })
      await db.creativeProviderReplayLedger.deleteMany({ where: { generationId: { in: Object.values(generationIds) } } })
      await db.creativeOutputIngestion.deleteMany({ where: { generationId: { in: Object.values(generationIds) } } })
      await db.creativeProviderRetryState.deleteMany({ where: { generationId: { in: Object.values(generationIds) } } })
      await db.creativeGeneration.deleteMany({ where: { id: { in: Object.values(generationIds) } } })
      await db.dataRightsLegalHoldEvent.deleteMany({ where: { legalHoldId: holdId } })
      await db.dataRightsLegalHold.deleteMany({ where: { id: holdId } })
      await db.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: users.map((user) => user.id) } }, { resourceType: 'provider_lifecycle_retention' }] } })
      await db.refreshToken.deleteMany({ where: { userId: { in: users.map((user) => user.id) } } })
      await db.authSession.deleteMany({ where: { userId: { in: users.map((user) => user.id) } } })
      await db.authAccount.deleteMany({ where: { userId: { in: users.map((user) => user.id) } } })
      await db.profile.deleteMany({ where: { userId: { in: users.map((user) => user.id) } } })
      await db.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } })
    })
    await repository.client.$disconnect()
  }
})
