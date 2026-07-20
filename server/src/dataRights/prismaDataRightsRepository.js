import { randomUUID } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'
import { requireChatMessageCodec } from '../chat/messageCrypto.js'
import { writeJsonArchive } from '../storage/archiveWriter.js'
import { signMediaDownload } from '../storage/uploadSigner.js'
import {
  assertDataRightsIdentity,
  assertDataRightsTransition,
  buildDataExportPackage,
  buildDeletionPlan,
  dataRightsDueAt,
  dataRightsEvidenceHash,
  dataRightsExportDownloadTtlSeconds,
  dataRightsRequiredBackupClasses,
  dataRightsSafeSubjectRef,
} from './dataRightsLifecycle.js'

const dayMs = 86400_000
const activeStatuses = ['identity_verified', 'processing', 'primary_completed', 'blocked']
const date = (value) => value?.toISOString?.() ?? value ?? null
const actorRef = (actor) => `actor_${dataRightsEvidenceHash({ actorId: actor.id }).slice(0, 24)}`
const include = {
  events: { orderBy: [{ sequence: 'asc' }] },
  artifact: true,
  deletionReceipts: { orderBy: [{ domain: 'asc' }] },
  backupReceipts: { orderBy: [{ backupClass: 'asc' }] },
}

const dto = (row) => row ? ({
  id: row.id, subjectRef: row.subjectRef, requestType: row.requestType, status: row.status, reasonCode: row.reasonCode,
  identityMethod: row.identityMethod, identityVerifiedAt: date(row.identityVerifiedAt), dueAt: date(row.dueAt),
  primaryCompletedAt: date(row.primaryCompletedAt), completedAt: date(row.completedAt), cancelledAt: date(row.cancelledAt),
  blockedReasonCode: row.blockedReasonCode, version: row.version, createdAt: date(row.createdAt), updatedAt: date(row.updatedAt),
  artifact: row.artifact ? { ...row.artifact, expiresAt: date(row.artifact.expiresAt), createdAt: date(row.artifact.createdAt) } : null,
  events: (row.events ?? []).map((item) => ({ ...item, createdAt: date(item.createdAt) })),
  deletionReceipts: (row.deletionReceipts ?? []).map((item) => ({ ...item, retentionExpiresAt: date(item.retentionExpiresAt), createdAt: date(item.createdAt) })),
  backupReceipts: (row.backupReceipts ?? []).map((item) => ({ ...item, expiredAt: date(item.expiredAt), createdAt: date(item.createdAt) })),
}) : null

const exportSnapshot = async (db, subjectId, source) => {
  const [account, tasksPublished, tasksAssigned, proposals, submissions, posts, comments, likes, library, media, mediaRelations, creative, chats, notifications, notificationPreferences, support, billing, entitlements, reports, moderationAppeals, riskAppeals] = await Promise.all([
    db.user.findUnique({ where: { id: subjectId }, select: {
      id: true, email: true, displayName: true, avatarUrl: true, role: true, status: true, createdAt: true, updatedAt: true,
      profile: { select: { handle: true, bio: true, lane: true, skills: true, languages: true, visibility: true, discoverable: true, showActivity: true, showPortfolio: true, updatedAt: true, portfolioAssets: { select: { id: true, assetId: true, title: true, caption: true, status: true, sortOrder: true, publishedAt: true, withdrawnAt: true, archivedAt: true, createdAt: true, updatedAt: true } } } },
      authAccounts: { select: { provider: true, createdAt: true, updatedAt: true } },
      authSessions: { select: { id: true, clientLabel: true, riskStatus: true, revokedAt: true, createdAt: true, lastSeenAt: true, expiresAt: true } },
      tagAssignments: { select: { assignReasonCode: true, assignedAt: true, removeReasonCode: true, removedAt: true, tag: { select: { key: true, label: true, color: true, archivedAt: true } } } },
    } }),
    db.task.findMany({ where: { publisherId: subjectId }, select: { id: true, title: true, category: true, description: true, acceptanceRules: true, pointsReward: true, status: true, visibility: true, deadlineAt: true, createdAt: true, updatedAt: true } }),
    db.task.findMany({ where: { assigneeId: subjectId }, select: { id: true, title: true, category: true, status: true, deadlineAt: true, createdAt: true, updatedAt: true } }),
    db.taskProposal.findMany({ where: { proposerId: subjectId }, select: { id: true, taskId: true, coverLetter: true, estimate: true, status: true, createdAt: true, updatedAt: true } }),
    db.taskSubmission.findMany({ where: { submitterId: subjectId }, select: { id: true, taskId: true, content: true, rightsNote: true, status: true, reviewNote: true, createdAt: true, updatedAt: true } }),
    db.post.findMany({ where: { authorId: subjectId }, select: { id: true, title: true, body: true, category: true, tag: true, status: true, createdAt: true, updatedAt: true, deletedAt: true } }),
    db.comment.findMany({ where: { authorId: subjectId }, select: { id: true, postId: true, body: true, createdAt: true, updatedAt: true, deletedAt: true } }),
    db.postLike.findMany({ where: { userId: subjectId }, select: { id: true, postId: true, createdAt: true } }),
    db.libraryItem.findMany({ where: { userId: subjectId }, select: { id: true, sourceType: true, sourceId: true, title: true, content: true, createdAt: true } }),
    db.mediaAsset.findMany({ where: { ownerId: subjectId }, select: { id: true, fileName: true, contentType: true, sizeBytes: true, purpose: true, status: true, createdAt: true, archivedAt: true, deletedAt: true } }),
    db.mediaAssetRelation.findMany({ where: { ownerId: subjectId }, select: { id: true, sourceAssetId: true, targetAssetId: true, relationType: true, targetWorkspace: true, role: true, createdAt: true } }),
    db.creativeGeneration.findMany({ where: { actorId: subjectId }, select: { id: true, workspace: true, mode: true, providerId: true, status: true, promptPreview: true, parameterKeys: true, outputAssetIds: true, createdAt: true, completedAt: true, failedAt: true } }),
    db.chatConversation.findMany({ where: { ownerId: subjectId }, select: {
      id: true, mode: true, status: true, lastMessageAt: true, createdAt: true, updatedAt: true,
      turns: { select: { id: true, mode: true, status: true, createdAt: true, completedAt: true, failedAt: true } },
      messages: { orderBy: [{ sequence: 'asc' }, { id: 'asc' }], select: { id: true, conversationId: true, role: true, status: true, sequence: true, ciphertext: true, encryptionKeyId: true, encryptionIv: true, authenticationTag: true, characterCount: true, createdAt: true, updatedAt: true } },
    } }),
    db.notification.findMany({ where: { recipientId: subjectId }, select: { id: true, type: true, title: true, body: true, resourceType: true, resourceId: true, readAt: true, createdAt: true } }),
    db.notificationPreference.findMany({ where: { userId: subjectId }, select: { notificationType: true, inAppEnabled: true, createdAt: true, updatedAt: true } }),
    db.supportTicket.findMany({ where: { requesterId: subjectId }, select: { id: true, category: true, status: true, priority: true, subject: true, details: true, relatedResourceType: true, relatedResourceId: true, createdAt: true, updatedAt: true, resolvedAt: true, closedAt: true, messages: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, authorType: true, body: true, createdAt: true } } } }),
    db.pointLedger.findMany({ where: { userId: subjectId }, select: { id: true, sourceType: true, sourceId: true, delta: true, balanceAfter: true, status: true, description: true, createdAt: true } }),
    db.personalEntitlementGrant.findMany({ where: { userId: subjectId }, select: { id: true, status: true, startsAt: true, endsAt: true, reasonCode: true, sourceType: true, sourceId: true, revokedAt: true, createdAt: true, updatedAt: true, planVersion: { select: { version: true, plan: { select: { key: true, title: true } } } } } }),
    db.report.findMany({ where: { reporterId: subjectId }, select: { id: true, caseId: true, category: true, subject: true, statement: true, locale: true, createdAt: true } }),
    db.moderationAppeal.findMany({ where: { appellantId: subjectId }, select: { id: true, caseId: true, reasonCode: true, statement: true, createdAt: true } }),
    db.riskAppeal.findMany({ where: { appellantId: subjectId }, select: { id: true, caseId: true, status: true, reasonCode: true, statementHash: true, statementPreview: true, decisionReasonCode: true, decidedAt: true, createdAt: true } }),
  ])
  const codec = chats.some((conversation) => conversation.messages.length > 0) ? requireChatMessageCodec(source) : null
  const exportedChats = chats.map(({ messages, ...conversation }) => ({
    ...conversation,
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role,
      status: message.status,
      sequence: message.sequence,
      content: codec.decrypt(message),
      characterCount: message.characterCount,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    })),
  }))
  return {
    account,
    tasks: { published: tasksPublished, assigned: tasksAssigned, proposals, submissions },
    community: { posts, comments, likes },
    library,
    media: { assets: media, relations: mediaRelations },
    creative,
    chat: exportedChats,
    notifications: { items: notifications, preferences: notificationPreferences },
    support,
    billing: { ledger: billing, entitlements },
    safety: { reports, moderationAppeals, riskAppeals },
  }
}

const applyPrimaryDeletion = async (db, request, now) => {
  const userId = request.subjectId
  const [supportTickets, billing, audit, affectedSafety, reportedSafety, appealedSafety] = await Promise.all([
    db.supportTicket.findMany({ where: { requesterId: userId }, select: { id: true } }),
    db.pointLedger.count({ where: { userId } }),
    db.auditEvent.count({ where: { actorId: userId } }),
    db.moderationCase.count({ where: { affectedUserId: userId } }),
    db.report.count({ where: { reporterId: userId } }),
    db.moderationAppeal.count({ where: { appellantId: userId } }),
  ])
  const serviceAccounts = await db.serviceAccount.findMany({ where: { ownerUserId: userId }, select: { id: true } })
  const subscriptions = await db.webhookSubscription.findMany({ where: { ownerUserId: userId }, select: { id: true } })
  const assets = await db.mediaAsset.findMany({ where: { ownerId: userId }, select: { id: true } })
  const ids = (rows) => rows.map((item) => item.id)
  const counts = { support: supportTickets.length, billing, audit, safety: affectedSafety + reportedSafety + appealedSafety }

  counts.identity = (await db.authAccount.deleteMany({ where: { userId } })).count
  await db.oAuthAuthorizationRequest.updateMany({ where: { linkUserId: userId, consumedAt: null, revokedAt: null }, data: { revokedAt: now, revokeReasonCode: 'account_deleted' } })
  counts.sessions = (await db.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now, revokeReasonCode: 'account_deleted', version: { increment: 1 } } })).count
  await db.refreshToken.deleteMany({ where: { userId } })
  if (serviceAccounts.length) {
    await db.apiKeyCredential.updateMany({ where: { serviceAccountId: { in: ids(serviceAccounts) }, revokedAt: null }, data: { status: 'revoked', revokedAt: now, revokeReasonCode: 'account_deleted', version: { increment: 1 } } })
    await db.serviceAccount.updateMany({ where: { id: { in: ids(serviceAccounts) } }, data: { status: 'revoked', revokedAt: now, revokeReasonCode: 'account_deleted', version: { increment: 1 } } })
  }
  counts.developer_access = serviceAccounts.length
  if (subscriptions.length) {
    await db.webhookSigningSecret.updateMany({ where: { subscriptionId: { in: ids(subscriptions) }, revokedAt: null }, data: { status: 'revoked', revokedAt: now } })
    await db.webhookSubscription.updateMany({ where: { id: { in: ids(subscriptions) } }, data: { status: 'deleted', disabledAt: now, deletedAt: now, version: { increment: 1 } } })
  }
  counts.webhooks = subscriptions.length
  counts.chat = (await db.chatConversation.deleteMany({ where: { ownerId: userId } })).count
  counts.notifications = (await db.notification.deleteMany({ where: { recipientId: userId } })).count
  counts.notifications += (await db.notificationPreference.deleteMany({ where: { userId } })).count
  const libraryCount = await db.libraryItem.count({ where: { userId } })
  await db.libraryItem.updateMany({ where: { userId }, data: { title: '[deleted]', content: '', metadata: null } })
  const portfolioCount = await db.profilePortfolioAsset.count({ where: { ownerId: userId } })
  await db.profilePortfolioAsset.updateMany({ where: { ownerId: userId }, data: { title: '[deleted]', caption: '', status: 'archived', archivedAt: now } })
  counts.media = assets.length + libraryCount + portfolioCount
  if (assets.length) {
    await db.mediaAsset.updateMany({ where: { id: { in: ids(assets) }, deletedAt: null }, data: { fileName: '[deleted]', metadata: null, deletedAt: now, deletedByHandle: 'data-rights', deletionReason: 'owner_deletion_request', archivedAt: null } })
    await db.mediaStorageObject.updateMany({ where: { assetId: { in: ids(assets) }, deletedAt: null }, data: { state: 'cleanup_pending', cleanupAfter: now, lastErrorCode: null, version: { increment: 1 } } })
  }
  counts.creative = (await db.creativeGeneration.updateMany({ where: { actorId: userId }, data: { actorId: null, actorHandle: null, promptPreview: null } })).count
  const postCount = await db.post.count({ where: { authorId: userId } })
  const commentCount = await db.comment.count({ where: { authorId: userId } })
  await db.post.updateMany({ where: { authorId: userId }, data: { title: '[deleted]', body: '', metadata: null, deletedAt: now, deletionReasonCode: 'account_deleted', version: { increment: 1 } } })
  await db.comment.updateMany({ where: { authorId: userId }, data: { body: '', deletedAt: now, deletionReasonCode: 'account_deleted', version: { increment: 1 } } })
  const likeCount = (await db.postLike.deleteMany({ where: { userId } })).count
  counts.community = postCount + commentCount + likeCount
  const publishedTasks = await db.task.count({ where: { publisherId: userId } })
  const proposals = await db.taskProposal.count({ where: { proposerId: userId } })
  const submissions = await db.taskSubmission.count({ where: { submitterId: userId } })
  await db.task.updateMany({ where: { publisherId: userId }, data: { title: '[deleted account task]', description: '', acceptanceRules: '', metadata: null, version: { increment: 1 } } })
  await db.taskProposal.updateMany({ where: { proposerId: userId }, data: { coverLetter: '', estimate: null, metadata: null } })
  await db.taskSubmission.updateMany({ where: { submitterId: userId }, data: { content: '', rightsNote: '', reviewNote: null, metadata: null } })
  counts.tasks = publishedTasks + proposals + submissions
  const removedTags = (await db.userTagAssignment.updateMany({ where: { userId, removedAt: null }, data: { removedAt: now, removeReasonCode: 'account_deleted', version: { increment: 1 } } })).count
  counts.profile = (await db.profile.updateMany({ where: { userId }, data: { handle: `deleted_${request.subjectRef.slice(-16)}`, bio: '', skills: [], languages: [], visibility: 'private', discoverable: false, showActivity: false, showPortfolio: false, portfolio: null, stats: null, metadata: null, version: { increment: 1 } } })).count + removedTags
  await db.searchDocument.deleteMany({ where: { ownerId: userId } })
  if (supportTickets.length) {
    const ticketIds = ids(supportTickets)
    await db.supportTicketMessage.updateMany({ where: { ticketId: { in: ticketIds }, dataRightsRedactedAt: null }, data: { body: '[redacted]', dataRightsRedactedAt: now } })
    await db.supportTicket.updateMany({ where: { id: { in: ticketIds } }, data: { subject: '[retained support record]', details: '[redacted]', relatedResourceType: 'none', relatedResourceId: null, dataRightsRedactedAt: now, version: { increment: 1 } } })
  }
  await db.user.update({ where: { id: userId }, data: { email: null, displayName: 'Deleted user', avatarUrl: null, status: 'deleted', deletionRequestedAt: null, deletionScheduledAt: null, deletionReasonCode: null, accountVersion: { increment: 1 } } })
  return counts
}

export const createPrismaDataRightsRepository = (client, { runSerializableTransaction, recordAudit, archiveWriter = writeJsonArchive, source = process.env } = {}) => {
  const exportPackages = new Map()
  const appendEvent = async (db, request, actor, eventType, reasonCode, { fromStatus = null, toStatus = null, metadata = null, now = new Date() } = {}) => {
    const latest = await db.dataRightsEvent.findFirst({
      where: { requestId: request.id },
      orderBy: { sequence: 'desc' },
      select: { sequence: true },
    })
    const sequence = Number(latest?.sequence ?? 0) + 1
    const evidence = { requestId: request.id, sequence, eventType, reasonCode, fromStatus, toStatus, metadata }
    return db.dataRightsEvent.create({ data: { requestId: request.id, sequence, eventType, actorRef: actorRef(actor), reasonCode, fromStatus, toStatus, evidenceHash: dataRightsEvidenceHash(evidence), metadata, createdAt: now } })
  }
  const find = (db, id, subjectId = null) => db.dataRightsRequest.findFirst({ where: { id: String(id), ...(subjectId ? { subjectId } : {}) }, include })
  const transition = async (db, request, actor, toStatus, reasonCode, now, metadata = null) => {
    assertDataRightsTransition(request.status, toStatus)
    const changed = await db.dataRightsRequest.updateMany({ where: { id: request.id, version: request.version, status: request.status }, data: { status: toStatus, version: { increment: 1 }, blockedReasonCode: toStatus === 'blocked' ? reasonCode : null, ...(toStatus === 'primary_completed' ? { primaryCompletedAt: now } : {}), ...(toStatus === 'completed' ? { completedAt: now } : {}), ...(toStatus === 'cancelled' ? { cancelledAt: now } : {}) } })
    if (changed.count !== 1) throw new HttpError(409, 'DATA_RIGHTS_VERSION_CONFLICT', 'Data rights request was updated by another operation')
    await appendEvent(db, request, actor, 'status_transitioned', reasonCode, { fromStatus: request.status, toStatus, metadata, now })
    return find(db, request.id)
  }

  return {
    create: (actor, payload, { sessionIssuedAt, now = new Date() } = {}) => runSerializableTransaction(async (db) => {
      const account = await db.user.findUnique({ where: { id: actor.id }, include: { profile: true } })
      const identity = assertDataRightsIdentity({ actor, account, payload, sessionIssuedAt, now })
      const recent = await db.dataRightsRequest.findMany({ where: { subjectId: actor.id, createdAt: { gte: new Date(now.getTime() - 30 * dayMs) } }, select: { requestType: true, status: true } })
      if (recent.length >= 3) throw new HttpError(429, 'DATA_RIGHTS_RATE_LIMITED', 'No more than three data rights requests are allowed per 30 days')
      if (recent.some((item) => item.requestType === payload.requestType && activeStatuses.includes(item.status))) throw new HttpError(409, 'DATA_RIGHTS_REQUEST_ACTIVE', 'An active request of this type already exists')
      const row = await db.dataRightsRequest.create({ data: { subjectId: actor.id, subjectRef: dataRightsSafeSubjectRef(actor.id), requestType: payload.requestType, reasonCode: payload.reasonCode, identityMethod: identity.method, identityVerifiedAt: now, dueAt: dataRightsDueAt(payload.requestType, now) }, include })
      await appendEvent(db, row, actor, 'request_created', payload.reasonCode, { toStatus: row.status, metadata: { requestType: row.requestType, identityMethod: row.identityMethod }, now })
      if (payload.requestType === 'account_deletion') {
        const changed = await db.user.updateMany({ where: { id: actor.id, accountVersion: payload.expectedAccountVersion, status: 'active', deletionRequestedAt: null }, data: { deletionRequestedAt: now, deletionScheduledAt: dataRightsDueAt(payload.requestType, now), deletionReasonCode: payload.reasonCode, accountVersion: { increment: 1 } } })
        if (changed.count !== 1) throw new HttpError(409, 'ACCOUNT_VERSION_CONFLICT', 'Account status was updated by another request')
      }
      await recordAudit({ actor, action: 'data_rights.request_created', resourceType: 'data_rights_request', resourceId: row.id, metadata: { requestType: row.requestType, status: row.status } }, db)
      return dto(await find(db, row.id))
    }),
    listOwn: async (actor) => (await client.dataRightsRequest.findMany({ where: { subjectId: actor.id }, include, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })).map(dto),
    getOwn: async (actor, id) => dto(await find(client, id, actor.id)),
    cancelOwn: (actor, id, payload, now = new Date()) => runSerializableTransaction(async (db) => {
      const current = await find(db, id, actor.id)
      if (!current) return null
      if (current.version !== payload.expectedVersion) throw new HttpError(409, 'DATA_RIGHTS_VERSION_CONFLICT', 'Data rights request was updated by another operation')
      const updated = await transition(db, current, actor, 'cancelled', payload.reasonCode, now)
      if (current.requestType === 'account_deletion') await db.user.update({ where: { id: actor.id }, data: { deletionRequestedAt: null, deletionScheduledAt: null, deletionReasonCode: null, accountVersion: { increment: 1 } } })
      await recordAudit({ actor, action: 'data_rights.request_cancelled', resourceType: 'data_rights_request', resourceId: current.id, metadata: { requestType: current.requestType, version: updated.version } }, db)
      return dto(updated)
    }),
    listAdmin: async (query, actor = null) => {
      const rows = await client.dataRightsRequest.findMany({ where: { ...(query.status ? { status: query.status } : {}), ...(query.requestType ? { requestType: query.requestType } : {}) }, include, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit })
      await recordAudit({ actor, action: 'admin.data_rights.listed', resourceType: 'data_rights_request', resourceId: 'queue', metadata: { status: query.status, requestType: query.requestType, limit: query.limit } }, client)
      return rows.map(dto)
    },
    getAdmin: async (id, actor = null) => {
      const request = await find(client, id)
      if (request) await recordAudit({ actor, action: 'admin.data_rights.viewed', resourceType: 'data_rights_request', resourceId: request.id, metadata: { requestType: request.requestType, status: request.status } }, client)
      return dto(request)
    },
    process: async (operator, id, payload, now = new Date()) => {
      const current = await find(client, id)
      if (!current) return null
      if (current.version !== payload.expectedVersion) throw new HttpError(409, 'DATA_RIGHTS_VERSION_CONFLICT', 'Data rights request was updated by another operation')
      if (current.requestType === 'account_deletion' && now < current.dueAt) throw new HttpError(409, 'DATA_RIGHTS_GRACE_PERIOD_ACTIVE', 'Account deletion grace period has not elapsed')
      if (current.requestType === 'data_export') {
        const snapshot = await exportSnapshot(client, current.subjectId, source)
        const built = buildDataExportPackage({ requestId: current.id, subjectRef: current.subjectRef, snapshot, generatedAt: now })
        const storageKey = `exports/data-rights/${current.subjectRef}/${current.id}.json`
        const storage = await archiveWriter(built.package, { now, source, storageKey })
        exportPackages.set(current.id, built.package)
        return runSerializableTransaction(async (db) => {
          let request = await find(db, id)
          if (request.status !== 'processing') request = await transition(db, request, operator, 'processing', payload.reasonCode, now)
          await db.dataRightsExportArtifact.create({ data: { requestId: request.id, storageKey, checksumSha256: built.checksumSha256, sizeBytes: built.sizeBytes, expiresAt: new Date(built.expiresAt), createdAt: now } })
          request = await transition(db, request, operator, 'completed', payload.reasonCode, now, { checksumSha256: built.checksumSha256, sizeBytes: built.sizeBytes })
          await recordAudit({ actor: operator, action: 'admin.data_rights.processed', resourceType: 'data_rights_request', resourceId: request.id, metadata: { requestType: request.requestType, status: request.status, persisted: storage.persisted } }, db)
          return dto(await find(db, request.id))
        })
      }
      return runSerializableTransaction(async (db) => {
        let request = await find(db, id)
        if (request.status !== 'processing') request = await transition(db, request, operator, 'processing', payload.reasonCode, now)
        const plan = buildDeletionPlan({ requestId: request.id, subjectRef: request.subjectRef, primaryCompletedAt: now })
        const counts = await applyPrimaryDeletion(db, request, now)
        await db.dataRightsDeletionReceipt.createMany({ data: plan.receipts.map((receipt) => ({ requestId: request.id, ...receipt, recordCount: Number(counts[receipt.domain] ?? 0), retentionExpiresAt: receipt.disposition === 'retained_minimal' ? new Date(now.getTime() + 7 * 365 * dayMs) : null, evidenceHash: dataRightsEvidenceHash({ requestId: request.id, ...receipt, recordCount: Number(counts[receipt.domain] ?? 0) }), createdAt: now })) })
        request = await transition(db, request, operator, 'primary_completed', payload.reasonCode, now, { backupExpiryDueAt: plan.backupExpiryDueAt })
        await recordAudit({ actor: operator, action: 'admin.data_rights.processed', resourceType: 'data_rights_request', resourceId: request.id, metadata: { requestType: request.requestType, status: request.status } }, db)
        return dto(await find(db, request.id))
      })
    },
    recordBackupReceipt: (operator, id, payload, now = new Date()) => runSerializableTransaction(async (db) => {
      let request = await find(db, id)
      if (!request) return null
      if (request.status !== 'primary_completed') throw new HttpError(409, 'DATA_RIGHTS_PRIMARY_NOT_COMPLETED', 'Primary deletion must complete before backup evidence')
      if (!dataRightsRequiredBackupClasses.includes(payload.backupClass)) throw new HttpError(400, 'VALIDATION_FAILED', `backupClass must be one of: ${dataRightsRequiredBackupClasses.join(', ')}`)
      const dueAt = new Date(request.primaryCompletedAt.getTime() + 35 * dayMs)
      if (payload.expiredAt < dueAt || now < dueAt) throw new HttpError(409, 'DATA_RIGHTS_BACKUP_EXPIRY_PENDING', 'Backup expiry evidence is not yet due')
      try { await db.dataRightsBackupExpiryReceipt.create({ data: { requestId: request.id, ...payload, createdAt: now } }) } catch (error) { if (error?.code === 'P2002') throw new HttpError(409, 'DATA_RIGHTS_BACKUP_RECEIPT_EXISTS', 'Backup expiry receipt already exists'); throw error }
      await appendEvent(db, request, operator, 'backup_expiry_recorded', 'backup_expiry_verified', { metadata: { backupClass: payload.backupClass, evidenceHash: payload.evidenceHash }, now })
      const classes = await db.dataRightsBackupExpiryReceipt.findMany({ where: { requestId: request.id }, select: { backupClass: true } })
      if (dataRightsRequiredBackupClasses.every((item) => classes.some((receipt) => receipt.backupClass === item))) request = await transition(db, request, operator, 'completed', 'all_backup_expiry_verified', now)
      await recordAudit({ actor: operator, action: 'admin.data_rights.backup_expiry_recorded', resourceType: 'data_rights_request', resourceId: request.id, metadata: { backupClass: payload.backupClass, status: request.status } }, db)
      return dto(await find(db, request.id))
    }),
    exportPackage: async (actor, id, now = new Date()) => {
      const request = await find(client, id, actor.id)
      if (!request?.artifact || request.status !== 'completed') return null
      if (request.artifact.expiresAt <= now) throw new HttpError(410, 'DATA_EXPORT_EXPIRED', 'Data export artifact has expired')
      const download = signMediaDownload({ storageKey: request.artifact.storageKey, contentType: 'application/json' }, {
        now,
        source: { ...source, STORAGE_DOWNLOAD_TTL_SECONDS: String(dataRightsExportDownloadTtlSeconds) },
      })
      await recordAudit({ actor, action: 'data_rights.export_downloaded', resourceType: 'data_rights_request', resourceId: request.id, metadata: { checksumSha256: request.artifact.checksumSha256, expiresAt: request.artifact.expiresAt.toISOString() } }, client)
      return { artifact: dto(request).artifact, download, ...(exportPackages.has(id) ? { package: structuredClone(exportPackages.get(id)) } : {}) }
    },
    metrics: async (actor = null) => {
      const rows = await client.dataRightsRequest.findMany({ select: { requestType: true, status: true, dueAt: true } })
      const now = new Date()
      await recordAudit({ actor, action: 'admin.data_rights.metrics_viewed', resourceType: 'data_rights_request', resourceId: 'metrics', metadata: {} }, client)
      return { total: rows.length, active: rows.filter((item) => activeStatuses.includes(item.status)).length, completed: rows.filter((item) => item.status === 'completed').length, overdue: rows.filter((item) => activeStatuses.includes(item.status) && item.dueAt < now).length, byType: Object.fromEntries(['data_export', 'account_deletion'].map((type) => [type, rows.filter((item) => item.requestType === type).length])), byStatus: Object.fromEntries([...new Set(rows.map((item) => item.status))].map((status) => [status, rows.filter((item) => item.status === status).length])) }
    },
  }
}
