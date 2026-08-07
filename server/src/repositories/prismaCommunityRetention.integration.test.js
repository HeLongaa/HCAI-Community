import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { communityRetentionContract } from '../community/communityRetention.js'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma community retention anonymizes eligible content and preserves active cases and legal holds', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const register = (label) => repository.auth.registerEmailAccount({
    email: `community-retention-${label}-${suffix}@example.com`,
    password: 'community-retention-integration-password',
    displayName: `Retention ${label}`,
    handle: `cr${label}${suffix.replaceAll('-', '')}`.slice(0, 30),
  })
  const users = await Promise.all(['eligible', 'reported', 'held', 'racing'].map(register))
  const [eligible, reported, held, racing] = users.map((session) => session.user)
  const ids = {
    post: `community-retention-post-${suffix}`,
    reportedComment: `community-retention-reported-${suffix}`,
    heldComment: `community-retention-held-${suffix}`,
    case: `community-retention-case-${suffix}`,
    hold: `community-retention-hold-${suffix}`,
    racingComment: `community-retention-racing-${suffix}`,
    racingHold: `community-retention-racing-hold-${suffix}`,
  }
  const deletedAt = new Date('2026-05-01T00:00:00.000Z')
  const now = new Date('2026-07-28T00:00:00.000Z')

  try {
    await repository.client.post.create({
      data: {
        id: ids.post,
        authorId: eligible.id,
        title: 'private title',
        body: 'private body',
        category: 'general',
        tag: 'retention',
        status: 'deleted',
        deletedAt,
        deletionReasonCode: 'owner_requested',
        metadata: { private: 'value' },
        likes: { create: { id: `like-${suffix}`, userId: reported.id } },
        comments: {
          create: [
            { id: ids.reportedComment, authorId: reported.id, body: 'reported body', deletedAt, deletionReasonCode: 'owner_requested' },
            { id: ids.heldComment, authorId: held.id, body: 'held body', deletedAt, deletionReasonCode: 'owner_requested' },
          ],
        },
      },
    })
    await repository.client.moderationCase.create({
      data: { id: ids.case, targetType: 'comment', targetId: ids.reportedComment, affectedUserId: reported.id },
    })
    await repository.client.dataRightsLegalHold.create({
      data: {
        id: ids.hold,
        subjectId: held.id,
        subjectRef: `subject-${suffix}`,
        scopeDomain: 'community',
        reasonCode: 'litigation_preservation',
        authorityRole: 'legal_hold_admin',
        authorityReferenceHash: 'a'.repeat(64),
        ownerRef: `actor_${'b'.repeat(24)}`,
        reviewAt: new Date('2026-08-01T00:00:00.000Z'),
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
      },
    })

    const result = await repository.communityRetention.sweepRetention({ now, limit: 10 })
    assert.deepEqual(result, { policyId: 'community_delete_plus_30d', inspected: 3, anonymized: 1, blocked: 2 })

    const anonymizedPost = await repository.client.post.findUnique({ where: { id: ids.post } })
    assert.equal(anonymizedPost.authorId, communityRetentionContract.tombstoneUserId)
    assert.equal(anonymizedPost.title, communityRetentionContract.tombstoneText)
    assert.equal(anonymizedPost.body, communityRetentionContract.tombstoneText)
    assert.equal(anonymizedPost.metadata, null)
    assert.equal(anonymizedPost.likesCount, 0)
    assert.equal(await repository.client.postLike.count({ where: { postId: ids.post } }), 0)

    const blockedComments = await repository.client.comment.findMany({ where: { id: { in: [ids.reportedComment, ids.heldComment] } } })
    assert.deepEqual(blockedComments.map((row) => row.authorId).sort(), [held.id, reported.id].sort())
    assert.ok(blockedComments.every((row) => row.body !== communityRetentionContract.tombstoneText))

    await repository.client.comment.create({
      data: { id: ids.racingComment, postId: ids.post, authorId: racing.id, body: 'racing hold body', deletedAt, deletionReasonCode: 'owner_requested' },
    })
    let lockedResolve
    const locked = new Promise((resolve) => { lockedResolve = resolve })
    const holdTransaction = repository.client.$transaction(async (db) => {
      await db.$queryRawUnsafe(
        'SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))',
        `data-rights-subject:${racing.id}`,
      )
      lockedResolve()
      await new Promise((resolve) => setTimeout(resolve, 100))
      await db.dataRightsLegalHold.create({
        data: {
          id: ids.racingHold,
          subjectId: racing.id,
          subjectRef: `racing-subject-${suffix}`,
          scopeDomain: 'community',
          reasonCode: 'litigation_preservation',
          authorityRole: 'legal_hold_admin',
          authorityReferenceHash: 'c'.repeat(64),
          ownerRef: `actor_${'d'.repeat(24)}`,
          reviewAt: new Date('2026-08-01T00:00:00.000Z'),
          expiresAt: new Date('2027-01-01T00:00:00.000Z'),
        },
      })
    })
    await locked
    const racingSweep = repository.communityRetention.sweepRetention({ now, limit: 10 })
    await holdTransaction
    assert.deepEqual(await racingSweep, { policyId: 'community_delete_plus_30d', inspected: 3, anonymized: 0, blocked: 3 })
    assert.equal((await repository.client.comment.findUnique({ where: { id: ids.racingComment } })).authorId, racing.id)
  } finally {
    await repository.client.moderationCase.deleteMany({ where: { id: ids.case } }).catch(() => {})
    await repository.client.dataRightsLegalHold.deleteMany({ where: { id: { in: [ids.hold, ids.racingHold] } } }).catch(() => {})
    await repository.client.post.deleteMany({ where: { id: ids.post } }).catch(() => {})
    await repository.client.user.deleteMany({ where: { id: { in: users.map((session) => session.user.id) } } }).catch(() => {})
    await repository.client.$disconnect()
  }
})
