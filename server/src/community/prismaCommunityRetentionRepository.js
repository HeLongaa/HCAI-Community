import {
  communityRetentionContract,
  communityRetentionCutoff,
  communityRetentionSweepLimit,
  moderationCaseBlocksCommunityRetention,
} from './communityRetention.js'

const candidateOrder = (left, right) => (
  left.deletedAt.getTime() - right.deletedAt.getTime()
  || left.targetType.localeCompare(right.targetType)
  || left.id.localeCompare(right.id)
)

const loadCandidates = async (db, cutoff, take, candidateIds = null) => {
  const select = { id: true, authorId: true, deletedAt: true, version: true }
  const idWhere = candidateIds ? { id: { in: candidateIds } } : {}
  const [posts, comments] = await Promise.all([
    db.post.findMany({
      where: {
        ...idWhere,
        deletedAt: { lte: cutoff },
        authorId: { not: communityRetentionContract.tombstoneUserId },
      },
      select,
      orderBy: [{ deletedAt: 'asc' }, { id: 'asc' }],
      take,
    }),
    db.comment.findMany({
      where: {
        ...idWhere,
        deletedAt: { lte: cutoff },
        authorId: { not: communityRetentionContract.tombstoneUserId },
      },
      select,
      orderBy: [{ deletedAt: 'asc' }, { id: 'asc' }],
      take,
    }),
  ])
  return [
    ...posts.map((row) => ({ ...row, targetType: 'post' })),
    ...comments.map((row) => ({ ...row, targetType: 'comment' })),
  ].sort(candidateOrder).slice(0, take)
}

const ensureTombstoneUser = (db) => db.user.upsert({
  where: { id: communityRetentionContract.tombstoneUserId },
  update: {},
  create: {
    id: communityRetentionContract.tombstoneUserId,
    displayName: 'Deleted user',
    role: 'member',
    status: 'deleted',
    profile: {
      create: {
        handle: communityRetentionContract.tombstoneHandle,
        lane: 'both',
        skills: [],
        languages: [],
        visibility: 'private',
        discoverable: false,
        showActivity: false,
        showPortfolio: false,
      },
    },
  },
})

export const createPrismaCommunityRetentionRepository = (client, { recordAudit }) => ({
  sweepRetention: async ({ now = new Date(), limit } = {}) => {
    const cutoff = communityRetentionCutoff(now)
    const take = communityRetentionSweepLimit(limit)
    const discovered = await loadCandidates(client, cutoff, take)
    if (discovered.length === 0) {
      return { policyId: communityRetentionContract.policyId, inspected: 0, anonymized: 0, blocked: 0 }
    }
    return client.$transaction(async (db) => {
      const discoveredAuthorIds = [...new Set(discovered.map((row) => row.authorId))].sort()
      const discoveredTargets = discovered.map((row) => `${row.targetType}:${row.id}`).sort()
      for (const authorId of discoveredAuthorIds) {
        await db.$queryRawUnsafe(
          'SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))',
          `data-rights-subject:${authorId}`,
        )
      }
      for (const target of discoveredTargets) {
        await db.$queryRawUnsafe(
          'SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))',
          `moderation-target:${target}`,
        )
      }
      const candidates = await loadCandidates(db, cutoff, take, discovered.map((row) => row.id))
      const authorIds = [...new Set(candidates.map((row) => row.authorId))]
      const targetIds = candidates.map((row) => row.id)
      const [holds, cases] = await Promise.all([
        db.dataRightsLegalHold.findMany({
          where: {
            subjectId: { in: authorIds },
            scopeDomain: 'community',
            releasedAt: null,
            expiresAt: { gt: now },
          },
          select: { subjectId: true },
        }),
        db.moderationCase.findMany({
          where: {
            targetType: { in: ['post', 'comment'] },
            targetId: { in: targetIds },
          },
          select: {
            targetType: true,
            targetId: true,
            decisions: { select: { stage: true, createdAt: true } },
            appeals: { select: { id: true } },
          },
        }),
      ])
      const heldAuthors = new Set(holds.map((row) => row.subjectId))
      const blockedTargets = new Set(cases
        .filter((row) => moderationCaseBlocksCommunityRetention(row, now))
        .map((row) => `${row.targetType}:${row.targetId}`))
      const eligible = candidates.filter((row) => (
        !heldAuthors.has(row.authorId)
        && !blockedTargets.has(`${row.targetType}:${row.id}`)
      ))
      if (eligible.length > 0) await ensureTombstoneUser(db)

      let anonymized = 0
      for (const candidate of eligible) {
        const model = candidate.targetType === 'post' ? db.post : db.comment
        if (candidate.targetType === 'post') {
          await db.postLike.deleteMany({ where: { postId: candidate.id } })
        }
        const data = candidate.targetType === 'post'
          ? {
              authorId: communityRetentionContract.tombstoneUserId,
              title: communityRetentionContract.tombstoneText,
              body: communityRetentionContract.tombstoneText,
              metadata: null,
              likesCount: 0,
              deletionReasonCode: 'retention_expired',
              version: { increment: 1 },
            }
          : {
              authorId: communityRetentionContract.tombstoneUserId,
              body: communityRetentionContract.tombstoneText,
              deletionReasonCode: 'retention_expired',
              version: { increment: 1 },
            }
        const changed = await model.updateMany({
          where: {
            id: candidate.id,
            authorId: candidate.authorId,
            deletedAt: candidate.deletedAt,
            version: candidate.version,
          },
          data,
        })
        if (changed.count !== 1) throw new Error(`Community retention state changed for ${candidate.targetType}:${candidate.id}`)
        anonymized += 1
        await recordAudit({
          actor: null,
          action: `system.community.${candidate.targetType}.retention_anonymized`,
          resourceType: candidate.targetType,
          resourceId: candidate.id,
          metadata: { policyId: communityRetentionContract.policyId, deletedAt: candidate.deletedAt.toISOString() },
        }, db)
      }
      return {
        policyId: communityRetentionContract.policyId,
        inspected: candidates.length,
        anonymized,
        blocked: candidates.length - eligible.length,
      }
    }, { isolationLevel: 'ReadCommitted' })
  },
})
