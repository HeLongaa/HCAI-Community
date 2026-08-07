import { randomUUID } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'
import { requireChatMessageCodec } from '../chat/messageCrypto.js'
import { writeJsonArchive } from '../storage/archiveWriter.js'
import { signMediaDownload } from '../storage/uploadSigner.js'
import {
  assertDataRightsIdentity,
  assertDataRightsLegalHoldWindow,
  assertDataRightsTransition,
  buildDataExportPackage,
  buildDeletionPlan,
  dataRightsDueAt,
  dataRightsEvidenceHash,
  dataRightsExportDownloadTtlSeconds,
  dataRightsRequiredBackupClasses,
  dataRightsSafeSubjectRef,
} from './dataRightsLifecycle.js'
import { buildProviderDeletionTargets, createProviderDeletionGateway, providerDeletionReceipt } from './providerDeletionGateway.js'
import { deleteDataRightsExportObject } from './exportArtifactRetention.js'

const dayMs = 86400_000
const activeStatuses = ['identity_verified', 'processing', 'primary_completed', 'blocked']
const date = (value) => value?.toISOString?.() ?? value ?? null
const actorRef = (actor) => `actor_${dataRightsEvidenceHash({ actorId: actor.id }).slice(0, 24)}`
const legalHoldRef = (id) => `hold_${dataRightsEvidenceHash({ legalHoldId: id }).slice(0, 24)}`
const legalHoldCutoffStatuses = new Set(['processing', 'primary_completed', 'completed'])
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

const legalHoldInclude = { events: { orderBy: [{ sequence: 'asc' }] } }
const legalHoldDto = (row, now = new Date()) => row ? ({
  id: row.id,
  subjectRef: row.subjectRef,
  scopeDomain: row.scopeDomain,
  reasonCode: row.reasonCode,
  authorityRole: row.authorityRole,
  authorityReferenceHash: row.authorityReferenceHash,
  ownerRef: row.ownerRef,
  reviewAt: date(row.reviewAt),
  expiresAt: date(row.expiresAt),
  releasedAt: date(row.releasedAt),
  releaseReasonCode: row.releaseReasonCode,
  releasedByRef: row.releasedByRef,
  version: row.version,
  status: row.releasedAt ? 'released' : row.expiresAt <= now ? 'expired' : 'active',
  createdAt: date(row.createdAt),
  updatedAt: date(row.updatedAt),
  events: (row.events ?? []).map((item) => ({ ...item, createdAt: date(item.createdAt) })),
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

const applyPrimaryDeletion = async (db, request, now, excludedScopes = new Set(), { finalizeAccount = excludedScopes.size === 0 } = {}) => {
  const userId = request.subjectId
  const allowed = (domain) => !excludedScopes.has(domain)
  const supportTickets = await db.supportTicket.findMany({ where: { requesterId: userId }, select: { id: true } })
  const billing = await db.pointLedger.count({ where: { userId } })
  const audit = await db.auditEvent.count({ where: { actorId: userId } })
  const affectedSafety = await db.moderationCase.count({ where: { affectedUserId: userId } })
  const reportedSafety = await db.report.count({ where: { reporterId: userId } })
  const appealedSafety = await db.moderationAppeal.count({ where: { appellantId: userId } })
  const serviceAccounts = await db.serviceAccount.findMany({ where: { ownerUserId: userId }, select: { id: true } })
  const subscriptions = await db.webhookSubscription.findMany({ where: { ownerUserId: userId }, select: { id: true } })
  const assets = await db.mediaAsset.findMany({ where: { ownerId: userId }, select: { id: true } })
  const ids = (rows) => rows.map((item) => item.id)
  const counts = {
    support: allowed('support') ? supportTickets.length : 0,
    billing: allowed('billing') ? billing : 0,
    audit: allowed('audit') ? audit : 0,
    safety: allowed('safety') ? affectedSafety + reportedSafety + appealedSafety : 0,
  }

  counts.identity = allowed('identity') ? (await db.authAccount.deleteMany({ where: { userId } })).count : 0
  await db.oAuthAuthorizationRequest.updateMany({ where: { linkUserId: userId, consumedAt: null, revokedAt: null }, data: { revokedAt: now, revokeReasonCode: 'account_deleted' } })
  counts.sessions = (await db.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now, revokeReasonCode: 'account_deleted', version: { increment: 1 } } })).count
  if (allowed('sessions')) await db.refreshToken.deleteMany({ where: { userId } })
  if (serviceAccounts.length) {
    await db.apiKeyCredential.updateMany({ where: { serviceAccountId: { in: ids(serviceAccounts) }, revokedAt: null }, data: { status: 'revoked', revokedAt: now, revokeReasonCode: 'account_deleted', version: { increment: 1 } } })
    await db.serviceAccount.updateMany({ where: { id: { in: ids(serviceAccounts) } }, data: { status: 'revoked', revokedAt: now, revokeReasonCode: 'account_deleted', version: { increment: 1 } } })
  }
  counts.developer_access = allowed('developer_access') ? serviceAccounts.length : 0
  if (subscriptions.length) {
    await db.webhookSigningSecret.updateMany({ where: { subscriptionId: { in: ids(subscriptions) }, revokedAt: null }, data: { status: 'revoked', revokedAt: now } })
    await db.webhookSubscription.updateMany({ where: { id: { in: ids(subscriptions) } }, data: { status: 'deleted', disabledAt: now, deletedAt: now, version: { increment: 1 } } })
  }
  counts.webhooks = allowed('webhooks') ? subscriptions.length : 0
  counts.chat = allowed('chat') ? (await db.chatConversation.deleteMany({ where: { ownerId: userId } })).count : 0
  counts.notifications = allowed('notifications') ? (await db.notification.deleteMany({ where: { recipientId: userId } })).count : 0
  if (allowed('notifications')) counts.notifications += (await db.notificationPreference.deleteMany({ where: { userId } })).count
  const libraryCount = await db.libraryItem.count({ where: { userId } })
  if (allowed('media')) await db.libraryItem.updateMany({ where: { userId }, data: { title: '[deleted]', content: '', metadata: null } })
  const portfolioCount = await db.profilePortfolioAsset.count({ where: { ownerId: userId } })
  if (allowed('media')) await db.profilePortfolioAsset.updateMany({ where: { ownerId: userId }, data: { title: '[deleted]', caption: '', status: 'archived', archivedAt: now } })
  counts.media = allowed('media') ? assets.length + libraryCount + portfolioCount : 0
  if (allowed('media') && assets.length) {
    await db.mediaAsset.updateMany({ where: { id: { in: ids(assets) }, deletedAt: null }, data: { fileName: '[deleted]', metadata: null, deletedAt: now, deletedByHandle: 'data-rights', deletionReason: 'owner_deletion_request', archivedAt: null } })
    await db.mediaStorageObject.updateMany({ where: { assetId: { in: ids(assets) }, deletedAt: null }, data: { state: 'cleanup_pending', cleanupAfter: now, lastErrorCode: null, version: { increment: 1 } } })
  }
  counts.creative = allowed('creative') ? (await db.creativeGeneration.updateMany({ where: { actorId: userId }, data: { actorId: null, actorHandle: null, promptPreview: null } })).count : 0
  const postCount = await db.post.count({ where: { authorId: userId } })
  const commentCount = await db.comment.count({ where: { authorId: userId } })
  if (allowed('community')) {
    await db.post.updateMany({ where: { authorId: userId }, data: { title: '[deleted]', body: '', metadata: null, deletedAt: now, deletionReasonCode: 'account_deleted', version: { increment: 1 } } })
    await db.comment.updateMany({ where: { authorId: userId }, data: { body: '', deletedAt: now, deletionReasonCode: 'account_deleted', version: { increment: 1 } } })
  }
  const likeCount = allowed('community') ? (await db.postLike.deleteMany({ where: { userId } })).count : 0
  counts.community = allowed('community') ? postCount + commentCount + likeCount : 0
  const publishedTasks = await db.task.count({ where: { publisherId: userId } })
  const proposals = await db.taskProposal.count({ where: { proposerId: userId } })
  const submissions = await db.taskSubmission.count({ where: { submitterId: userId } })
  if (allowed('tasks')) {
    await db.task.updateMany({ where: { publisherId: userId }, data: { title: '[deleted account task]', description: '', acceptanceRules: '', metadata: null, version: { increment: 1 } } })
    await db.taskProposal.updateMany({ where: { proposerId: userId }, data: { coverLetter: '', estimate: null, metadata: null } })
    await db.taskSubmission.updateMany({ where: { submitterId: userId }, data: { content: '', rightsNote: '', reviewNote: null, metadata: null } })
  }
  counts.tasks = allowed('tasks') ? publishedTasks + proposals + submissions : 0
  const removedTags = allowed('profile') ? (await db.userTagAssignment.updateMany({ where: { userId, removedAt: null }, data: { removedAt: now, removeReasonCode: 'account_deleted', version: { increment: 1 } } })).count : 0
  counts.profile = allowed('profile')
    ? (await db.profile.updateMany({ where: { userId }, data: { handle: `deleted_${request.subjectRef.slice(-16)}`, bio: '', skills: [], languages: [], visibility: 'private', discoverable: false, showActivity: false, showPortfolio: false, portfolio: null, stats: null, metadata: null, version: { increment: 1 } } })).count + removedTags
    : 0
  if (!allowed('profile')) await db.profile.updateMany({ where: { userId }, data: { visibility: 'private', discoverable: false, showActivity: false, showPortfolio: false, version: { increment: 1 } } })
  await db.searchDocument.deleteMany({ where: { ownerId: userId } })
  if (allowed('support') && supportTickets.length) {
    const ticketIds = ids(supportTickets)
    await db.supportTicketMessage.updateMany({ where: { ticketId: { in: ticketIds }, dataRightsRedactedAt: null }, data: { body: '[redacted]', dataRightsRedactedAt: now } })
    await db.supportTicket.updateMany({ where: { id: { in: ticketIds } }, data: { subject: '[retained support record]', details: '[redacted]', relatedResourceType: 'none', relatedResourceId: null, dataRightsRedactedAt: now, version: { increment: 1 } } })
  }
  await db.user.update({ where: { id: userId }, data: {
    ...(allowed('identity') ? { email: null, displayName: 'Deleted user', avatarUrl: null } : {}),
    status: 'deleted',
    ...(finalizeAccount ? { deletionRequestedAt: null, deletionScheduledAt: null, deletionReasonCode: null } : {}),
    accountVersion: { increment: 1 },
  } })
  return counts
}

export const createPrismaDataRightsRepository = (client, { runSerializableTransaction, recordAudit, archiveWriter = writeJsonArchive, source = process.env, dispatchProviderDeletion = null, exportObjectDeleter = null } = {}) => {
  const exportPackages = new Map()
  const providerDeletionGateway = dispatchProviderDeletion ?? createProviderDeletionGateway({ source })
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
  const find = async (db, id, subjectId = null) => {
    const row = await db.dataRightsRequest.findFirst({ where: { id: String(id), ...(subjectId ? { subjectId } : {}) } })
    if (!row) return null
    const events = await db.dataRightsEvent.findMany({ where: { requestId: row.id }, orderBy: [{ sequence: 'asc' }] })
    const artifact = await db.dataRightsExportArtifact.findUnique({ where: { requestId: row.id } })
    const deletionReceipts = await db.dataRightsDeletionReceipt.findMany({ where: { requestId: row.id }, orderBy: [{ domain: 'asc' }] })
    const backupReceipts = await db.dataRightsBackupExpiryReceipt.findMany({ where: { requestId: row.id }, orderBy: [{ backupClass: 'asc' }] })
    return { ...row, events, artifact, deletionReceipts, backupReceipts }
  }
  const findLegalHold = async (db, id) => {
    const row = await db.dataRightsLegalHold.findUnique({ where: { id: String(id) } })
    if (!row) return null
    const events = await db.dataRightsLegalHoldEvent.findMany({ where: { legalHoldId: row.id }, orderBy: [{ sequence: 'asc' }] })
    return { ...row, events }
  }
  const transition = async (db, request, actor, toStatus, reasonCode, now, metadata = null) => {
    assertDataRightsTransition(request.status, toStatus)
    const changed = await db.dataRightsRequest.updateMany({ where: { id: request.id, version: request.version, status: request.status }, data: { status: toStatus, version: { increment: 1 }, blockedReasonCode: toStatus === 'blocked' ? reasonCode : null, ...(toStatus === 'primary_completed' ? { primaryCompletedAt: now } : {}), ...(toStatus === 'completed' ? { completedAt: now } : {}), ...(toStatus === 'cancelled' ? { cancelledAt: now } : {}) } })
    if (changed.count !== 1) throw new HttpError(409, 'DATA_RIGHTS_VERSION_CONFLICT', 'Data rights request was updated by another operation')
    await appendEvent(db, request, actor, 'status_transitioned', reasonCode, { fromStatus: request.status, toStatus, metadata, now })
    return find(db, request.id)
  }
  const activeLegalHolds = (db, subjectId, now) => db.dataRightsLegalHold.findMany({
    where: { subjectId, releasedAt: null, expiresAt: { gt: now } },
    orderBy: [{ scopeDomain: 'asc' }, { expiresAt: 'asc' }, { id: 'asc' }],
  })
  const lockSubject = (db, subjectId) => db.$queryRawUnsafe(
    'SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))',
    `data-rights-subject:${subjectId}`,
  )
  const assertLegalHoldBeforeDeletionCutoff = async (db, subject, scopeDomain) => {
    if (subject.status === 'deleted') {
      throw new HttpError(409, 'DATA_RIGHTS_LEGAL_HOLD_CUTOFF_PASSED', 'Account deletion has already passed the legal hold creation cutoff')
    }
    const deletion = await db.dataRightsRequest.findFirst({
      where: { subjectId: subject.id, requestType: 'account_deletion', status: { not: 'cancelled' } },
      select: {
        status: true,
        blockedReasonCode: true,
        deletionReceipts: { select: { domain: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    if (!deletion) return
    const scopeDeleted = deletion.deletionReceipts.some((receipt) => receipt.domain === scopeDomain)
      || (scopeDomain === 'creative' && deletion.deletionReceipts.some((receipt) => receipt.domain.startsWith('provider:')))
    const providerDispatchUncertain = deletion.status === 'blocked' && deletion.blockedReasonCode === 'provider_deletion_failed'
    if (legalHoldCutoffStatuses.has(deletion.status) || providerDispatchUncertain || scopeDeleted) {
      throw new HttpError(409, 'DATA_RIGHTS_LEGAL_HOLD_CUTOFF_PASSED', 'Account deletion has already passed the legal hold creation cutoff')
    }
  }
  const appendLegalHoldEvent = async (db, hold, actor, eventType, reasonCode, now) => {
    const latest = await db.dataRightsLegalHoldEvent.findFirst({ where: { legalHoldId: hold.id }, orderBy: { sequence: 'desc' }, select: { sequence: true } })
    const sequence = Number(latest?.sequence ?? 0) + 1
    const evidence = { legalHoldId: hold.id, sequence, eventType, reasonCode }
    return db.dataRightsLegalHoldEvent.create({ data: { legalHoldId: hold.id, sequence, eventType, actorRef: actorRef(actor), reasonCode, evidenceHash: dataRightsEvidenceHash(evidence), createdAt: now } })
  }
  const blockForLegalHolds = async (db, request, operator, holds, now) => {
    const metadata = {
      legalHoldRefs: holds.map((hold) => legalHoldRef(hold.id)),
      scopeDomains: [...new Set(holds.map((hold) => hold.scopeDomain))].sort(),
      nextExpiryAt: holds.map((hold) => hold.expiresAt).sort((left, right) => left - right)[0].toISOString(),
    }
    let blocked = request
    if (request.status !== 'blocked') blocked = await transition(db, request, operator, 'blocked', 'legal_hold_active', now, metadata)
    await recordAudit({ actor: operator, action: 'admin.data_rights.legal_hold_blocked_deletion', resourceType: 'data_rights_request', resourceId: request.id, metadata }, db)
    return { request: blocked, metadata }
  }

  return {
    createLegalHold: (operator, payload, now = new Date()) => runSerializableTransaction(async (db) => {
      assertDataRightsLegalHoldWindow(payload, now)
      await lockSubject(db, payload.subjectId)
      if (['media', 'audit', 'safety'].includes(payload.scopeDomain)) {
        const subjectRef = dataRightsSafeSubjectRef(payload.subjectId)
        await db.$queryRawUnsafe('SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))', 'security-retention-legal-holds')
        await db.$queryRawUnsafe('SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))', `data-rights-subject-ref:${subjectRef}`)
      }
      const subject = await db.user.findUnique({ where: { id: payload.subjectId }, select: { id: true, status: true } })
      if (!subject) throw new HttpError(404, 'DATA_RIGHTS_LEGAL_HOLD_SUBJECT_NOT_FOUND', 'Legal hold subject was not found')
      await assertLegalHoldBeforeDeletionCutoff(db, subject, payload.scopeDomain)
      const hold = await db.dataRightsLegalHold.create({ data: {
        subjectId: payload.subjectId,
        subjectRef: dataRightsSafeSubjectRef(payload.subjectId),
        scopeDomain: payload.scopeDomain,
        reasonCode: payload.reasonCode,
        authorityRole: payload.authorityRole,
        authorityReferenceHash: payload.authorityReferenceHash,
        ownerRef: actorRef(operator),
        reviewAt: payload.reviewAt,
        expiresAt: payload.expiresAt,
        createdAt: now,
      } })
      await appendLegalHoldEvent(db, hold, operator, 'legal_hold_created', payload.reasonCode, now)
      await recordAudit({ actor: operator, action: 'admin.data_rights.legal_hold_created', resourceType: 'data_rights_legal_hold', resourceId: hold.id, metadata: { subjectRef: hold.subjectRef, scopeDomain: hold.scopeDomain, reviewAt: hold.reviewAt.toISOString(), expiresAt: hold.expiresAt.toISOString() } }, db)
      return legalHoldDto(await findLegalHold(db, hold.id), now)
    }),
    listLegalHolds: async (query = {}, operator = null, now = new Date()) => {
      const statusWhere = query.status === 'active' ? { releasedAt: null, expiresAt: { gt: now } }
        : query.status === 'released' ? { releasedAt: { not: null } }
          : query.status === 'expired' ? { releasedAt: null, expiresAt: { lte: now } }
            : {}
      const rows = await client.dataRightsLegalHold.findMany({
        where: { ...(query.subjectId ? { subjectId: query.subjectId } : {}), ...statusWhere },
        include: legalHoldInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit ?? 50,
      })
      await recordAudit({ actor: operator, action: 'admin.data_rights.legal_holds_listed', resourceType: 'data_rights_legal_hold', resourceId: 'registry', metadata: { status: query.status ?? 'active', limit: query.limit ?? 50 } }, client)
      return rows.map((item) => legalHoldDto(item, now))
    },
    releaseLegalHold: (operator, id, payload, now = new Date()) => runSerializableTransaction(async (db) => {
      const current = await findLegalHold(db, id)
      if (!current) return null
      if (current.version !== payload.expectedVersion) throw new HttpError(409, 'DATA_RIGHTS_LEGAL_HOLD_VERSION_CONFLICT', 'Legal hold was updated by another operation')
      if (current.releasedAt) throw new HttpError(409, 'DATA_RIGHTS_LEGAL_HOLD_RELEASED', 'Legal hold has already been released')
      const changed = await db.dataRightsLegalHold.updateMany({ where: { id: current.id, version: current.version, releasedAt: null }, data: { releasedAt: now, releaseReasonCode: payload.reasonCode, releasedByRef: actorRef(operator), version: { increment: 1 } } })
      if (changed.count !== 1) throw new HttpError(409, 'DATA_RIGHTS_LEGAL_HOLD_VERSION_CONFLICT', 'Legal hold was updated by another operation')
      await appendLegalHoldEvent(db, current, operator, 'legal_hold_released', payload.reasonCode, now)
      await recordAudit({ actor: operator, action: 'admin.data_rights.legal_hold_released', resourceType: 'data_rights_legal_hold', resourceId: current.id, metadata: { subjectRef: current.subjectRef, scopeDomain: current.scopeDomain, version: current.version + 1 } }, db)
      return legalHoldDto(await findLegalHold(db, current.id), now)
    }),
    create: (actor, payload, { sessionIssuedAt, now = new Date() } = {}) => runSerializableTransaction(async (db) => {
      const account = await db.user.findUnique({ where: { id: actor.id }, include: { profile: true } })
      const identity = assertDataRightsIdentity({ actor, account, payload, sessionIssuedAt, now })
      const recent = await db.dataRightsRequest.findMany({ where: { subjectId: actor.id, createdAt: { gte: new Date(now.getTime() - 30 * dayMs) } }, select: { requestType: true, status: true } })
      if (recent.length >= 3) throw new HttpError(429, 'DATA_RIGHTS_RATE_LIMITED', 'No more than three data rights requests are allowed per 30 days')
      if (recent.some((item) => item.requestType === payload.requestType && activeStatuses.includes(item.status))) throw new HttpError(409, 'DATA_RIGHTS_REQUEST_ACTIVE', 'An active request of this type already exists')
      const row = await db.dataRightsRequest.create({ data: { subjectId: actor.id, subjectRef: dataRightsSafeSubjectRef(actor.id), requestType: payload.requestType, reasonCode: payload.reasonCode, identityMethod: identity.method, identityVerifiedAt: now, dueAt: dataRightsDueAt(payload.requestType, now) } })
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
      const processing = await runSerializableTransaction(async (db) => {
        let request = await find(db, id)
        await lockSubject(db, request.subjectId)
        request = await find(db, id)
        if (request.version !== payload.expectedVersion) throw new HttpError(409, 'DATA_RIGHTS_VERSION_CONFLICT', 'Data rights request was updated by another operation')
        if (request.status !== 'processing') request = await transition(db, request, operator, 'processing', payload.reasonCode, now)
        return request
      })
      const holdsBeforeProvider = await activeLegalHolds(client, processing.subjectId, now)
      const heldBeforeProvider = new Set(holdsBeforeProvider.map((hold) => hold.scopeDomain))
      const completedBeforeProvider = new Set(processing.deletionReceipts.map((receipt) => receipt.domain))
      const providerRecords = heldBeforeProvider.has('creative') || completedBeforeProvider.has('creative') ? [] : await client.creativeGeneration.findMany({
          where: { actorId: processing.subjectId },
          select: { providerId: true, providerJobId: true, providerRequestId: true },
        })
      let externalReceipts = []
      try {
        for (const target of buildProviderDeletionTargets(providerRecords)) {
          const result = await providerDeletionGateway({ requestId: processing.id, subjectRef: processing.subjectRef, target, now })
          externalReceipts.push(providerDeletionReceipt({ requestId: processing.id, result, now }))
        }
      } catch (error) {
        await runSerializableTransaction(async (db) => {
          const request = await find(db, id)
          if (request?.status === 'processing') {
            const blocked = await transition(db, request, operator, 'blocked', 'provider_deletion_failed', now, { errorCode: String(error?.code ?? 'DATA_RIGHTS_PROVIDER_DELETION_FAILED').slice(0, 96) })
            await recordAudit({ actor: operator, action: 'admin.data_rights.provider_deletion_blocked', resourceType: 'data_rights_request', resourceId: request.id, metadata: { status: blocked.status, errorCode: String(error?.code ?? 'DATA_RIGHTS_PROVIDER_DELETION_FAILED').slice(0, 96) } }, db)
          }
        })
        throw error
      }
      return runSerializableTransaction(async (db) => {
        let request = await find(db, id)
        if (request.status !== 'processing') throw new HttpError(409, 'DATA_RIGHTS_TRANSITION_INVALID', 'Data rights request is not ready for primary deletion')
        const holds = await activeLegalHolds(db, request.subjectId, now)
        const heldScopes = new Set(holds.map((hold) => hold.scopeDomain))
        const completedScopes = new Set(request.deletionReceipts.filter((receipt) => !receipt.domain.startsWith('provider:')).map((receipt) => receipt.domain))
        const excludedScopes = new Set([...heldScopes, ...completedScopes])
        const plan = buildDeletionPlan({ requestId: request.id, subjectRef: request.subjectRef, primaryCompletedAt: now })
        const eligibleReceipts = plan.receipts.filter((receipt) => !excludedScopes.has(receipt.domain))
        const counts = await applyPrimaryDeletion(db, request, now, excludedScopes, { finalizeAccount: holds.length === 0 })
        await db.dataRightsDeletionReceipt.createMany({ data: eligibleReceipts.map((receipt) => ({ requestId: request.id, ...receipt, recordCount: Number(counts[receipt.domain] ?? 0), retentionExpiresAt: receipt.disposition === 'retained_minimal' ? new Date(now.getTime() + 7 * 365 * dayMs) : null, evidenceHash: dataRightsEvidenceHash({ requestId: request.id, ...receipt, recordCount: Number(counts[receipt.domain] ?? 0) }), createdAt: now })), skipDuplicates: true })
        if (externalReceipts.length) await db.dataRightsDeletionReceipt.createMany({ data: externalReceipts.map((receipt) => ({ requestId: request.id, ...receipt })), skipDuplicates: true })
        if (holds.length) {
          const blocked = await blockForLegalHolds(db, request, operator, holds, now)
          return { legalHoldBlocked: true, metadata: blocked.metadata }
        }
        request = await transition(db, request, operator, 'primary_completed', payload.reasonCode, now, { backupExpiryDueAt: plan.backupExpiryDueAt })
        await recordAudit({ actor: operator, action: 'admin.data_rights.processed', resourceType: 'data_rights_request', resourceId: request.id, metadata: { requestType: request.requestType, status: request.status } }, db)
        return { legalHoldBlocked: false, result: dto(await find(db, request.id)) }
      }).then((outcome) => {
        if (outcome.legalHoldBlocked) throw new HttpError(409, 'DATA_RIGHTS_LEGAL_HOLD_ACTIVE', 'Account deletion is blocked by an active legal hold', outcome.metadata)
        return outcome.result
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
    sweepExpiredExports: async ({ now = new Date(), limit = 25 } = {}) => {
      const boundedLimit = Math.max(1, Math.min(Number.parseInt(limit, 10) || 25, 100))
      const due = await client.dataRightsExportArtifact.findMany({
        where: { expiresAt: { lte: now } },
        orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
        take: boundedLimit,
      })
      const failures = []
      let deleted = 0
      for (const artifact of due) {
        try {
          const receipt = await deleteDataRightsExportObject(artifact, { now, source, deleteObject: exportObjectDeleter ?? undefined })
          const removed = await runSerializableTransaction(async (db) => {
            await db.$executeRawUnsafe("SET LOCAL app.data_rights_maintenance = 'on'")
            const result = await db.dataRightsExportArtifact.deleteMany({ where: { id: artifact.id, expiresAt: { lte: now } } })
            if (result.count !== 1) return false
            const request = await find(db, artifact.requestId)
            if (!request) throw new HttpError(409, 'DATA_RIGHTS_REQUEST_NOT_FOUND', 'Data export request no longer exists')
            await appendEvent(db, request, { id: 'system-data-rights-retention' }, 'export_artifact_expired', 'export_retention_elapsed', {
              metadata: { artifactId: artifact.id, receiptHash: receipt.receiptHash },
              now,
            })
            await recordAudit({
              actor: null,
              action: 'data_rights.export_artifact_expired',
              resourceType: 'data_rights_request',
              resourceId: artifact.requestId,
              metadata: { artifactId: artifact.id, receiptHash: receipt.receiptHash },
            }, db)
            return true
          })
          if (removed) {
            exportPackages.delete(artifact.requestId)
            deleted += 1
          }
        } catch (error) {
          failures.push({ artifactId: artifact.id, errorCode: String(error?.code ?? 'DATA_EXPORT_RETENTION_DELETE_FAILED').slice(0, 96) })
        }
      }
      const result = { inspected: due.length, due: due.length, deleted, failed: failures.length, failures }
      if (failures.length > 0) throw new HttpError(503, 'DATA_EXPORT_RETENTION_PARTIAL_FAILURE', 'One or more expired data export artifacts could not be deleted', result)
      return result
    },
    metrics: async (actor = null) => {
      const rows = await client.dataRightsRequest.findMany({ select: { requestType: true, status: true, dueAt: true } })
      const now = new Date()
      await recordAudit({ actor, action: 'admin.data_rights.metrics_viewed', resourceType: 'data_rights_request', resourceId: 'metrics', metadata: {} }, client)
      return { total: rows.length, active: rows.filter((item) => activeStatuses.includes(item.status)).length, completed: rows.filter((item) => item.status === 'completed').length, overdue: rows.filter((item) => activeStatuses.includes(item.status) && item.dueAt < now).length, byType: Object.fromEntries(['data_export', 'account_deletion'].map((type) => [type, rows.filter((item) => item.requestType === type).length])), byStatus: Object.fromEntries([...new Set(rows.map((item) => item.status))].map((status) => [status, rows.filter((item) => item.status === status).length])) }
    },
  }
}
