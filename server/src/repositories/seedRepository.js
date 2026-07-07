import { randomUUID } from 'node:crypto'
import { hasPermission, permissions, rolePermissions } from '../auth/permissions.js'
import { hashPassword, verifyPassword } from '../auth/passwords.js'
import { createAccessToken, createOpaqueToken, futureDate, refreshTokenTtlMs, verifyAccessToken } from '../auth/sessionTokens.js'
import { seedStore } from '../data/seed.js'
import { flushSecurityEvents, listSecurityEvents } from '../security/securityEvents.js'
import {
  applySecurityAlertDispositions,
  buildSecurityAlertPolicy,
  buildSecurityEventAlerts,
  securityAlertDispositionActions,
  securityAlertSource,
} from '../security/alertPolicy.js'
import { dispatchSecurityAlert } from '../security/alertDispatcher.js'
import {
  serializeAdminReview,
  serializeAuditEvent,
  serializeCreativeGeneration,
  serializeCreativeProviderReplay,
  serializeLedgerEntry,
  serializeLibraryItem,
  serializeMediaAsset,
  serializeNotification,
  serializePost,
  serializePostDetail,
  serializeProfile,
  serializeSecurityAlertDispatchEvent,
  serializeTask,
  serializeTaskProposal,
  serializeTaskSubmission,
} from './serializers.js'
import { buildTaskViewModel } from './prismaTransforms.js'
import { signMediaDownload, signMediaUpload } from '../storage/uploadSigner.js'
import { diffPointAdjustmentPolicy, normalizePointAdjustmentPolicy, summarizePointPolicyDiff } from '../points/adjustmentPolicy.js'
import {
  buildDefaultMediaGovernancePolicy,
  diffMediaGovernancePolicy,
  mergeMediaGovernancePolicy,
  normalizeMediaGovernancePolicy,
  summarizeMediaGovernancePolicyDiff,
} from '../config/env.js'
import {
  retryMediaScanAsset,
  scanMediaAsset,
} from '../media/scanProvider.js'
import { dispatchMediaScanAlert } from '../media/alertDispatcher.js'
import { writeJsonArchive } from '../storage/archiveWriter.js'
import { writeStorageObject } from '../storage/objectWriter.js'
import {
  buildOperationsMetricSamples,
  buildOperationsMetrics,
  buildOperationsMetricsSnapshot,
  operationsMetricsSampleDefinitions,
} from '../operations/metrics.js'
import {
  buildProviderLifecycleAuditPayload,
  buildProviderLifecycleNotificationPayload,
  hasProviderLifecycleSourceKey,
} from './providerLifecycleWiring.js'
import {
  buildProviderBudgetNotificationPayload,
  hasProviderBudgetNotificationSourceKey,
} from './providerBudgetNotificationWiring.js'

const sessionByRefreshToken = new Map()
const emailAccountByEmail = new Map()
const oauthAccountByProviderKey = new Map()
const creativeGenerationsById = new Map()
const creativeProviderReplayLedgerById = new Map()
const creativeProviderReplayLedgerByIdempotencyKey = new Map()
const creativeCreditLedgerById = new Map()
const creativeQuotaWindowsById = new Map()
const creativeQuotaReservationsById = new Map()

const getAccountByHandle = (handle) => seedStore.demoAccountByHandle.get(handle) ?? null
const getAccountById = (id) => seedStore.demoAccounts.find((account) => account.id === id) ?? null
const normalizeEmail = (email) => String(email ?? '').trim().toLowerCase()
const oauthKey = (provider, providerUserId) => `${provider}:${providerUserId}`
const splitOAuthKey = (key) => {
  const [provider, ...rest] = String(key).split(':')
  return { provider, providerUserId: rest.join(':') }
}

const makeUniqueHandle = (email, fallback = 'oauth') => {
  const base = String(email?.split('@')[0] ?? fallback).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || fallback
  let handle = base.length >= 3 ? base : `user_${base}`
  let suffix = 1
  while (getAccountByHandle(handle)) {
    handle = `${base.slice(0, 24)}${suffix}`
    suffix += 1
  }
  return handle
}

const getHandle = (value) => {
  if (!value || value === 'Unassigned') {
    return null
  }
  if (typeof value === 'string') {
    return value
  }
  return value.handle ?? value.id ?? null
}

const canAccessOwnedResource = (ownerHandle, actor, elevatedPermission = 'admin:access') => {
  if (!ownerHandle) {
    return true
  }
  return Boolean(actor?.handle === ownerHandle || hasPermission(actor, elevatedPermission))
}

const buildAccountSummary = (actor) => ({
  handle: actor.handle,
  name: { en: actor.displayName ?? actor.handle, zh: actor.displayName ?? actor.handle },
  role: { en: actor.role ?? 'member', zh: actor.role ?? 'member' },
  lane: actor.profile?.lane ?? 'both',
  initials: String(actor.displayName ?? actor.handle).slice(0, 2).toUpperCase(),
})

const parsePointsAmount = (value) => {
  const cleaned = String(value ?? '').replace(/[^\d-]/g, '')
  const parsed = Number.parseInt(cleaned, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

const latestLedgerBalance = (userHandle) => {
  const latest = seedStore.pointsLedger.find((entry) => !userHandle || entry.userHandle === userHandle)
  return parsePointsAmount(latest?.balanceAfter)
}

const buildPointSummary = (entries, userHandle) => {
  const balance = latestLedgerBalance(userHandle)
  const frozen = entries
    .filter((entry) => entry.status === 'pending' && parsePointsAmount(entry.delta) < 0)
    .reduce((total, entry) => total + Math.abs(parsePointsAmount(entry.delta)), 0)
  const pendingSettlement = entries
    .filter((entry) => entry.status === 'pending' && parsePointsAmount(entry.delta) > 0)
    .reduce((total, entry) => total + parsePointsAmount(entry.delta), 0)
  const lifetimeEarned = entries
    .filter((entry) => entry.status === 'settled' && parsePointsAmount(entry.delta) > 0)
    .reduce((total, entry) => total + parsePointsAmount(entry.delta), 0)
  const lifetimeSpent = entries
    .filter((entry) => entry.status === 'settled' && parsePointsAmount(entry.delta) < 0)
    .reduce((total, entry) => total + Math.abs(parsePointsAmount(entry.delta)), 0)
  return {
    userHandle,
    balance,
    available: balance,
    frozen,
    pendingSettlement,
    projectedBalance: balance + frozen + pendingSettlement,
    lifetimeEarned,
    lifetimeSpent,
  }
}

const getSessionDto = (session) => ({
  id: session.id,
  familyId: session.familyId,
  createdAt: session.createdAt.toISOString(),
  expiresAt: session.expiresAt.toISOString(),
  revokedAt: session.revokedAt?.toISOString?.() ?? null,
  reuseDetectedAt: session.reuseDetectedAt?.toISOString?.() ?? null,
  active: !session.revokedAt && session.expiresAt > new Date(),
})

const issueSession = (account, options = {}) => {
  const seededAccount = getAccountByHandle(account.handle) ?? account
  const accessToken = createAccessToken(seededAccount.id, { handle: seededAccount.handle })
  const refreshToken = createOpaqueToken('hcai_refresh')
  sessionByRefreshToken.set(refreshToken, {
    id: randomUUID(),
    familyId: options.familyId ?? randomUUID(),
    handle: seededAccount.handle,
    expiresAt: futureDate(refreshTokenTtlMs),
    revokedAt: null,
    replacedByToken: null,
    reuseDetectedAt: null,
    createdAt: new Date(),
  })
  return {
    accessToken,
    refreshToken,
    user: seededAccount,
  }
}

const registerEmailAccount = async ({ email, password, displayName, handle }) => {
  const normalizedEmail = normalizeEmail(email)
  if (
    emailAccountByEmail.has(normalizedEmail) ||
    seedStore.demoAccounts.some((account) => normalizeEmail(account.email) === normalizedEmail || account.handle === handle)
  ) {
    return null
  }
  const account = {
    id: `seed-user-${randomUUID()}`,
    handle,
    email: normalizedEmail,
    displayName,
    role: 'member',
    permissions: [...rolePermissions.member],
    profile: {
      handle,
      lane: 'both',
    },
    passwordHash: await hashPassword(password),
    tokens: {
      accessToken: `demo-access.${handle}`,
      refreshToken: `demo-refresh.${handle}`,
    },
  }
  seedStore.demoAccounts.push(account)
  seedStore.demoAccountByHandle.set(handle, account)
  seedStore.demoAccountByAccessToken.set(account.tokens.accessToken, account)
  seedStore.demoAccountByRefreshToken.set(account.tokens.refreshToken, account)
  emailAccountByEmail.set(normalizedEmail, account)
  recordAudit(account, 'auth.account.registered', 'user', account.id, { provider: 'email' })
  return issueSession(account)
}

const loginWithPassword = async ({ email, password }) => {
  const account = emailAccountByEmail.get(normalizeEmail(email))
  if (!account || !(await verifyPassword(password, account.passwordHash))) {
    return null
  }
  return issueSession(account)
}

const completeOAuthLogin = async ({ profile, linkUserId = null }) => {
  const key = oauthKey(profile.provider, profile.providerUserId)
  const linkedHandle = oauthAccountByProviderKey.get(key)
  if (linkUserId) {
    const actor = getAccountById(linkUserId)
    if (!actor || (linkedHandle && getAccountByHandle(linkedHandle)?.id !== linkUserId)) {
      return null
    }
    oauthAccountByProviderKey.set(key, actor.handle)
    recordAudit(actor, 'auth.oauth.linked', 'auth_account', key, { provider: profile.provider })
    return issueSession(actor)
  }

  if (linkedHandle) {
    const linkedAccount = getAccountByHandle(linkedHandle)
    return linkedAccount ? issueSession(linkedAccount) : null
  }

  const normalizedEmail = normalizeEmail(profile.email)
  const existing = seedStore.demoAccounts.find((account) => normalizeEmail(account.email) === normalizedEmail) ?? null
  if (existing) {
    oauthAccountByProviderKey.set(key, existing.handle)
    recordAudit(existing, 'auth.oauth.linked', 'auth_account', key, { provider: profile.provider })
    return issueSession(existing)
  }

  const handle = makeUniqueHandle(normalizedEmail, profile.provider)
  const account = {
    id: `seed-user-${randomUUID()}`,
    handle,
    email: normalizedEmail,
    displayName: profile.displayName,
    role: 'member',
    permissions: [...rolePermissions.member],
    profile: {
      handle,
      lane: 'both',
    },
    passwordHash: null,
    tokens: {
      accessToken: `demo-access.${handle}`,
      refreshToken: `demo-refresh.${handle}`,
    },
  }
  seedStore.demoAccounts.push(account)
  seedStore.demoAccountByHandle.set(handle, account)
  seedStore.demoAccountByAccessToken.set(account.tokens.accessToken, account)
  seedStore.demoAccountByRefreshToken.set(account.tokens.refreshToken, account)
  oauthAccountByProviderKey.set(key, account.handle)
  recordAudit(account, 'auth.oauth.registered', 'user', account.id, { provider: profile.provider })
  return issueSession(account)
}

const listOAuthAccounts = (actor) =>
  [...oauthAccountByProviderKey.entries()]
    .filter(([, handle]) => getAccountByHandle(handle)?.id === actor.id)
    .map(([key]) => splitOAuthKey(key))
    .sort((left, right) => left.provider.localeCompare(right.provider))

const countSeedAuthMethods = (actor) => {
  const emailMethod = actor.passwordHash || emailAccountByEmail.get(normalizeEmail(actor.email))?.id === actor.id ? 1 : 0
  const seededDemoMethod = String(actor.id).startsWith('demo-user-') ? 1 : 0
  return emailMethod + seededDemoMethod + listOAuthAccounts(actor).length
}

const unlinkOAuthAccount = (provider, actor) => {
  const account = listOAuthAccounts(actor).find((item) => item.provider === provider)
  if (!account) {
    return null
  }
  if (countSeedAuthMethods(actor) <= 1) {
    return { blocked: true }
  }
  oauthAccountByProviderKey.delete(oauthKey(account.provider, account.providerUserId))
  recordAudit(actor, 'auth.oauth.unlinked', 'auth_account', `${account.provider}:${account.providerUserId}`, { provider: account.provider })
  return { unlinked: true }
}

const getTaskById = (id) => seedStore.taskById.get(Number(id)) ?? null

const updateTask = (id, updater, canUpdate = () => true) => {
  const current = getTaskById(id)
  if (!current) {
    return null
  }
  if (!canUpdate(current)) {
    return null
  }
  const next = updater(current)
  if (!next) {
    return null
  }
  const index = seedStore.tasks.findIndex((task) => Number(task.id) === Number(id))
  if (index >= 0) {
    seedStore.tasks[index] = next
  }
  seedStore.taskById.set(Number(id), next)
  return next
}

const postCommentsByPostId = new Map()
const postLikeSetsByPostId = new Map()

const getPostById = (id) => seedStore.postById.get(Number(id)) ?? null

const ensurePostComments = (postId) => {
  if (!postCommentsByPostId.has(postId)) {
    postCommentsByPostId.set(postId, [])
  }
  return postCommentsByPostId.get(postId)
}

const ensurePostLikes = (postId) => {
  if (!postLikeSetsByPostId.has(postId)) {
    postLikeSetsByPostId.set(postId, new Set())
  }
  return postLikeSetsByPostId.get(postId)
}

const getPostComments = (postId) => ensurePostComments(Number(postId))

const getPostLikes = (postId) => ensurePostLikes(Number(postId))

const buildViewerPermissions = (viewer) => ({
  canComment: Boolean(viewer),
  canLike: Boolean(viewer),
  canConvertToTask: Boolean(viewer),
  canModerate: hasPermission(viewer, 'post:moderate'),
})

const libraryItemsById = new Map()
const seedLibraryItems = seedStore.inspirationItems.map((item, index) => ({
  id: `library-${index + 1}`,
  type: item.type,
  source: item.source,
  saves: item.saves,
  text: item.text,
  title: item.title,
  ownerHandle: 'taskops',
  sourceId: null,
  metadata: null,
}))

for (const item of seedLibraryItems) {
  libraryItemsById.set(item.id, item)
}

const auditEvents = []
const operationLeaseStore = new Map()

const recordAudit = (actor, action, resourceType, resourceId = null, metadata = null) => {
  const event = {
    id: `audit-${auditEvents.length + 1}`,
    actorType: actor ? 'user' : 'system',
    actorId: actor?.id ?? null,
    action,
    resourceType,
    resourceId,
    metadata,
    createdAt: new Date().toISOString(),
  }
  auditEvents.unshift(event)
  return event
}

const leaseExpiry = (ttlSeconds) => new Date(Date.now() + Math.max(1, Number(ttlSeconds ?? 300)) * 1000)

const serializeOperationLease = (lease) => lease ? {
  key: lease.key,
  ownerId: lease.ownerId,
  token: lease.token,
  metadata: lease.metadata ?? null,
  acquiredAt: lease.acquiredAt?.toISOString?.() ?? lease.acquiredAt,
  renewedAt: lease.renewedAt?.toISOString?.() ?? lease.renewedAt ?? null,
  expiresAt: lease.expiresAt?.toISOString?.() ?? lease.expiresAt,
  releasedAt: lease.releasedAt?.toISOString?.() ?? lease.releasedAt ?? null,
} : null

const recordOperationLeaseAudit = (action, leaseKey, metadata = {}) => {
  recordAudit(null, action, 'operation_lease', leaseKey, metadata)
}

const auditMetadata = (event) => event?.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
  ? event.metadata
  : {}

const taskTimelineCopy = {
  'task.created': { type: 'created', title: 'Task opened', body: 'The task was published.' },
  'task.claimed': { type: 'claimed', title: 'Creator joined', body: 'A creator started work on this task.' },
  'task.proposal.created': { type: 'proposal_created', title: 'Proposal submitted', body: 'A creator submitted a proposal.' },
  'task.proposal.accepted': { type: 'proposal_accepted', title: 'Proposal accepted', body: 'The publisher accepted a proposal.' },
  'task.proposal.rejected': { type: 'proposal_rejected', title: 'Proposal rejected', body: 'The publisher declined a proposal.' },
  'task.submitted': { type: 'submitted', title: 'Work submitted', body: 'The creator submitted delivery work.' },
  'task.revision_requested': { type: 'revision_requested', title: 'Changes requested', body: 'The publisher requested revisions.' },
  'task.dispute.opened': { type: 'dispute_opened', title: 'Dispute opened', body: 'The creator opened a dispute for the submitted work.' },
  'task.submission.stale': { type: 'submission_stale', title: 'Review overdue', body: 'A pending submission passed the review SLA.' },
  'task.approved': { type: 'approved', title: 'Task approved', body: 'The task was approved and points were settled.' },
  'task.rejected': { type: 'rejected', title: 'Task rejected', body: 'The publisher rejected the submitted work.' },
}

const serializeTaskTimelineItem = (event, taskId) => {
  const copy = taskTimelineCopy[event.action] ?? {
    type: event.action.replace(/^task\./, '').replaceAll('.', '_'),
    title: 'Task activity',
    body: event.action,
  }
  const metadata = auditMetadata(event)
  const actor = event.actorId
    ? seedStore.demoAccounts.find((account) => account.id === event.actorId)
    : null
  return {
    id: String(event.id),
    taskId: String(taskId),
    type: copy.type,
    title: copy.title,
    body: metadata.reviewNote ?? metadata.note ?? copy.body,
    actor: actor ? buildAccountSummary(actor) : null,
    resourceType: event.resourceType,
    resourceId: event.resourceId ?? null,
    metadata,
    occurredAt: event.createdAt ?? '',
  }
}

const inAuditWindow = (event, since, until) => {
  const createdAt = new Date(event.createdAt)
  return !Number.isNaN(createdAt.getTime()) && createdAt >= since && createdAt <= until
}

const buildSeedOperationsMetrics = (options = {}, generatedAt = new Date()) => buildOperationsMetrics({
  windowMinutes: options.windowMinutes,
  generatedAt,
  securityEvents: listSecurityEvents({ limit: Number.parseInt(process.env.SECURITY_EVENT_MAX_ITEMS ?? '500', 10) || 500 }).items,
  auditEvents,
  securityAlerts: getSeedSecurityEventAlerts(),
  mediaScanArchiveManifest: getSeedMediaScanJobArchiveManifest({ limit: 1 }),
  providerAlertDispatchFailureThreshold: Number.parseInt(process.env.CREATIVE_PROVIDER_ALERT_DELIVERY_FAILED_ALERT_THRESHOLD ?? '2', 10) || 2,
})

const getSeedOperationsMetricSamples = (options = {}, generatedAt = new Date()) => {
  const windowMinutes = options.windowMinutes ?? 60
  const until = generatedAt instanceof Date ? generatedAt : new Date(generatedAt)
  const since = new Date(until.getTime() - windowMinutes * 60 * 1000)
  const samplesByKey = Object.fromEntries(
    Object.entries(operationsMetricsSampleDefinitions).map(([key, definition]) => [
      key,
      auditEvents
        .filter((event) =>
          event.action === definition.action &&
          event.resourceType === definition.resourceType &&
          inAuditWindow(event, since, until) &&
          (!definition.failedOnly || auditMetadata(event).status === 'failed')
        )
        .slice(0, 5)
        .map(serializeAuditEvent),
    ]),
  )
  return buildOperationsMetricSamples(samplesByKey)
}

const settleTaskReward = (task, recipientHandle) => {
  const pointsReward = Number(task.pointsReward) || parsePointsAmount(task.budget)
  if (!recipientHandle || pointsReward <= 0) {
    return null
  }
  const existing = seedStore.pointsLedger.find((entry) => entry.sourceType === 'task_completion' && entry.sourceId === String(task.id) && entry.userHandle === recipientHandle)
  if (existing) {
    return existing
  }
  const latestBalance = latestLedgerBalance(recipientHandle)
  const entry = {
    id: `ledger-${randomUUID()}`,
    occurredAtLabel: 'Just now',
    description: `Task accepted: ${task.title}`,
    delta: pointsReward,
    balanceAfter: latestBalance + pointsReward,
    status: 'settled',
    sourceType: 'task_completion',
    sourceId: String(task.id),
    userHandle: recipientHandle,
  }
  seedStore.pointsLedger.unshift(entry)
  return entry
}

const incrementProfileStat = (stats, key, delta) => {
  const current = stats[key]
  if (current === undefined || current === null) {
    return delta
  }
  const numeric = Number(current)
  return Number.isFinite(numeric) ? numeric + delta : current
}

const applyProfileStatsUpdate = (handle, deltas) => {
  if (!handle) {
    return null
  }
  const profile = seedStore.profileByHandle.get(handle) ?? null
  if (!profile) {
    return null
  }
  const nextProfile = {
    ...profile,
    stats: { ...(profile.stats ?? {}) },
  }
  for (const [key, delta] of Object.entries(deltas)) {
    nextProfile.stats[key] = incrementProfileStat(nextProfile.stats, key, delta)
  }
  seedStore.profileByHandle.set(handle, nextProfile)
  const index = seedStore.profiles.findIndex((entry) => entry.handle === handle)
  if (index >= 0) {
    seedStore.profiles[index] = nextProfile
  }
  return nextProfile
}

const applyTaskCompletionReputation = (task, creatorHandle) => {
  applyProfileStatsUpdate(creatorHandle, { completed: 1, score: 10 })
  applyProfileStatsUpdate(getHandle(task.publisher), { completed: 1, score: 6 })
}

const createTaskEscrow = (task, publisherHandle) => {
  const pointsReward = Number(task.pointsReward) || parsePointsAmount(task.budget)
  if (!publisherHandle || pointsReward <= 0) {
    return null
  }
  const existing = seedStore.pointsLedger.find((entry) => entry.sourceType === 'task_escrow' && entry.sourceId === String(task.id) && entry.userHandle === publisherHandle)
  if (existing) {
    return existing
  }
  const entry = {
    id: `ledger-escrow-${task.id}-${publisherHandle}`,
    occurredAtLabel: 'Just now',
    description: `Task reward held: ${task.title}`,
    delta: -pointsReward,
    balanceAfter: latestLedgerBalance(publisherHandle) - pointsReward,
    status: 'pending',
    sourceType: 'task_escrow',
    sourceId: String(task.id),
    userHandle: publisherHandle,
  }
  seedStore.pointsLedger.unshift(entry)
  return entry
}

const finalizeTaskEscrow = (task, publisherHandle, decision) => {
  const pointsReward = Number(task.pointsReward) || parsePointsAmount(task.budget)
  const escrow = seedStore.pointsLedger.find((entry) => entry.sourceType === 'task_escrow' && entry.sourceId === String(task.id) && entry.userHandle === publisherHandle)
  if (!escrow) {
    return null
  }
  escrow.status = decision === 'approve' ? 'settled' : 'cancelled'
  if (decision === 'approve') {
    return escrow
  }
  const existingRelease = seedStore.pointsLedger.find((entry) => entry.sourceType === 'task_escrow_release' && entry.sourceId === String(task.id) && entry.userHandle === publisherHandle)
  if (existingRelease || pointsReward <= 0) {
    return existingRelease ?? escrow
  }
  const release = {
    id: `ledger-escrow-release-${task.id}-${publisherHandle}`,
    occurredAtLabel: 'Just now',
    description: `Task reward released: ${task.title}`,
    delta: pointsReward,
    balanceAfter: latestLedgerBalance(publisherHandle) + pointsReward,
    status: 'settled',
    sourceType: 'task_escrow_release',
    sourceId: String(task.id),
    userHandle: publisherHandle,
  }
  seedStore.pointsLedger.unshift(release)
  return release
}

const createManualPointAdjustment = (payload, actor, options = {}) => {
  const account = getAccountByHandle(payload.userHandle)
  if (!account) {
    return null
  }
  const sourceId = options.sourceId ?? `adjustment-${randomUUID()}`
  const existing = seedStore.pointsLedger.find(
    (entry) => entry.userHandle === account.handle && entry.sourceType === 'manual_adjustment' && entry.sourceId === sourceId,
  )
  if (existing) {
    return existing
  }
  const entry = {
    id: `ledger-adjust-${randomUUID()}`,
    occurredAtLabel: 'Just now',
    description: `Manual adjustment: ${payload.reason}`,
    delta: payload.delta,
    balanceAfter: latestLedgerBalance(account.handle) + payload.delta,
    status: 'settled',
    sourceType: 'manual_adjustment',
    sourceId,
    userHandle: account.handle,
  }
  seedStore.pointsLedger.unshift(entry)
  recordAudit(actor, 'points.adjusted', 'point_ledger', entry.id, {
    userHandle: account.handle,
    delta: payload.delta,
    reason: payload.reason,
    reasonCode: payload.reasonCode ?? null,
    reviewId: options.reviewId ?? null,
  })
  return entry
}

const createPointAdjustmentReview = (payload, actor, threshold) => {
  const account = getAccountByHandle(payload.userHandle)
  if (!account) {
    return null
  }
  const review = {
    id: `review-points-${randomUUID()}`,
    queue: 'points',
    status: 'Pending review',
    title: `Point adjustment for @${account.handle}: ${payload.delta > 0 ? '+' : ''}${payload.delta}`,
    owner: account.handle,
    note: payload.reason,
    metadata: {
      kind: 'point_adjustment',
      userHandle: account.handle,
      delta: payload.delta,
      reason: payload.reason,
      reasonCode: payload.reasonCode ?? null,
      requestedBy: actor.handle,
      threshold,
      balanceBefore: latestLedgerBalance(account.handle),
      projectedBalance: latestLedgerBalance(account.handle) + payload.delta,
    },
  }
  adminReviewQueue.unshift(review)
  adminReviewById.set(review.id, review)
  recordAudit(actor, 'points.adjustment_requested', 'admin_review', review.id, {
    userHandle: account.handle,
    delta: payload.delta,
    reason: payload.reason,
    reasonCode: payload.reasonCode ?? null,
    threshold,
  })
  notifyPointApprovers(actor, {
    type: 'points.adjustment.requested',
    title: `Point adjustment review: @${account.handle}`,
    body: `${actor.handle} requested ${payload.delta > 0 ? '+' : ''}${payload.delta} points for @${account.handle}.`,
    resourceType: 'admin_review',
    resourceId: review.id,
    metadata: {
      ...review.metadata,
      target: {
        page: 'admin',
        admin: {
          tab: 'Task review',
          queue: 'points',
          reviewId: review.id,
        },
      },
    },
  })
  return review
}

const adminReviewQueue = seedStore.adminReviewQueue.map((item) => ({ ...item }))

const adminReviewById = new Map(adminReviewQueue.map((item) => [item.id, item]))
const editableRolePermissions = new Map(Object.entries(rolePermissions).map(([role, values]) => [role, [...values]]))
let pointAdjustmentPolicy = null
let mediaGovernancePolicy = null
const getSeedMediaGovernancePolicy = () =>
  normalizeMediaGovernancePolicy(mediaGovernancePolicy ?? {}, buildDefaultMediaGovernancePolicy())
const taskProposals = []
const taskSubmissions = []
const mediaAssetsById = new Map()
const notifications = []

const getCursorValue = (item, cursorKey) => item?.[cursorKey] ?? item?.id ?? item?.handle ?? null

const paginateByCursor = (items, { cursor = null, limit = 20, cursorKey = 'id' } = {}) => {
  const startIndex = cursor ? items.findIndex((item) => getCursorValue(item, cursorKey) === cursor) + 1 : 0
  const safeStartIndex = startIndex > 0 ? startIndex : 0
  const pageItems = items.slice(safeStartIndex, safeStartIndex + limit)
  const hasMore = safeStartIndex + limit < items.length
  return {
    items: pageItems,
    nextCursor: hasMore && pageItems.length > 0 ? getCursorValue(pageItems[pageItems.length - 1], cursorKey) : null,
    limit,
  }
}

function uniqueHandles(handles) {
  return [...new Set(handles.filter(Boolean))]
}

function createNotificationsForHandles(handles, payload) {
  const now = new Date().toISOString()
  const created = uniqueHandles(handles)
    .map((handle) => getAccountByHandle(handle))
    .filter(Boolean)
    .filter((recipient) => !payload.dedupeUnread || !notifications.some((notification) =>
      notification.recipientHandle === recipient.handle &&
      notification.type === payload.type &&
      notification.resourceType === payload.resourceType &&
      notification.resourceId === (payload.resourceId ?? null) &&
      !notification.readAt,
    ))
    .map((recipient) => ({
      id: `notification-${randomUUID()}`,
      recipientId: recipient.id,
      recipientHandle: recipient.handle,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      resourceType: payload.resourceType,
      resourceId: payload.resourceId ?? null,
      metadata: payload.metadata ?? null,
      readAt: null,
      createdAt: now,
    }))
  notifications.unshift(...created)
  return created.map(serializeNotification)
}

function notifyPointApprovers(actor, payload) {
  return createNotificationsForHandles(
    seedStore.demoAccounts
      .filter((account) =>
        account.handle !== actor?.handle &&
        hasPermission(account, 'admin:queue:review') &&
        hasPermission(account, 'points:adjust'),
      )
      .map((account) => account.handle),
    payload,
  )
}

function notifyPolicyManagers(actor, payload) {
  return createNotificationsForHandles(
    seedStore.demoAccounts
      .filter((account) => account.handle !== actor?.handle && hasPermission(account, 'admin:permissions:manage'))
      .map((account) => account.handle),
    payload,
  )
}

function notifyAdminQueueReaders(actor, payload) {
  return createNotificationsForHandles(
    seedStore.demoAccounts
      .filter((account) => account.handle !== actor?.handle && hasPermission(account, 'admin:queue:read'))
      .map((account) => account.handle),
    payload,
  )
}

const notifyMediaQueueReaders = notifyAdminQueueReaders

function notifyAuditReaders(actor, payload) {
  return createNotificationsForHandles(
    seedStore.demoAccounts
      .filter((account) => account.handle !== actor?.handle && hasPermission(account, 'admin:audit:read'))
      .map((account) => account.handle),
    payload,
  )
}

function providerLifecycleRecipientHandles(actor, payload = {}) {
  return uniqueHandles([
    payload.actorHandle,
    ...seedStore.demoAccounts
      .filter((account) => account.handle !== actor?.handle && hasPermission(account, 'admin:audit:read'))
      .map((account) => account.handle),
  ])
}

function createProviderLifecycleNotifications(payload = {}, actor = null) {
  const notificationPayload = buildProviderLifecycleNotificationPayload(payload)
  const handles = providerLifecycleRecipientHandles(actor, payload)
    .filter((handle) => !notifications.some((notification) =>
      notification.recipientHandle === handle &&
      notification.type === notificationPayload.type &&
      notification.resourceType === notificationPayload.resourceType &&
      notification.resourceId === notificationPayload.resourceId &&
      hasProviderLifecycleSourceKey(notification, payload.sourceKey),
    ))
  return createNotificationsForHandles(handles, notificationPayload)
}

function providerBudgetRecipientHandles(actor) {
  return uniqueHandles(seedStore.demoAccounts
    .filter((account) => account.handle !== actor?.handle && hasPermission(account, 'admin:audit:read'))
    .map((account) => account.handle))
}

function createProviderBudgetNotificationsFromAuditEvents(auditEventsToNotify = [], actor = null) {
  const handles = providerBudgetRecipientHandles(actor)
  const created = []
  for (const auditEvent of auditEventsToNotify) {
    const notificationPayload = buildProviderBudgetNotificationPayload(auditEvent)
    if (!notificationPayload) {
      continue
    }
    const missingHandles = handles.filter((handle) => !notifications.some((notification) =>
      notification.recipientHandle === handle &&
      notification.type === notificationPayload.type &&
      notification.resourceType === notificationPayload.resourceType &&
      notification.resourceId === notificationPayload.resourceId &&
      hasProviderBudgetNotificationSourceKey(notification, notificationPayload.metadata.sourceKey),
    ))
    created.push(...createNotificationsForHandles(missingHandles, notificationPayload))
  }
  return created
}

function recordProviderLifecycleAudit(payload = {}, actor = null) {
  const auditPayload = buildProviderLifecycleAuditPayload(payload, actor)
  const existing = auditEvents.find((event) =>
    event.action === auditPayload.action &&
    event.resourceType === auditPayload.resourceType &&
    event.resourceId === auditPayload.resourceId &&
    hasProviderLifecycleSourceKey(event, payload.sourceKey),
  )
  if (existing) {
    return serializeAuditEvent(existing)
  }
  return serializeAuditEvent(recordAudit(
    auditPayload.actor,
    auditPayload.action,
    auditPayload.resourceType,
    auditPayload.resourceId,
    auditPayload.metadata,
  ))
}

function recordProviderBudgetAuditEvents(payloads = [], actor = null) {
  return payloads.map((payload) => {
    const metadata = auditMetadata(payload)
    const sourceKey = metadata.sourceKey
    const existing = auditEvents.find((event) =>
      event.action === payload.action &&
      event.resourceType === payload.resourceType &&
      event.resourceId === (payload.resourceId ?? null) &&
      Boolean(sourceKey) &&
      auditMetadata(event).sourceKey === sourceKey,
    )
    if (existing) {
      return {
        created: false,
        event: serializeAuditEvent(existing),
      }
    }
    const event = recordAudit(
      actor,
      payload.action,
      payload.resourceType,
      payload.resourceId ?? null,
      metadata,
    )
    return {
      created: true,
      event: serializeAuditEvent(event),
    }
  })
}

const taskNotificationTarget = (page = 'mine') => ({ page })

const mediaScanAlertNotification = (alert) => ({
  type: 'media.scan.alert',
  title: alert.title,
  body: alert.summary,
  resourceType: 'media_scan_alert',
  resourceId: alert.id,
  dedupeUnread: true,
  metadata: {
    alertId: alert.id,
    alertType: alert.type,
    severity: alert.severity,
    count: alert.count,
    threshold: alert.threshold,
    windowMinutes: alert.windowMinutes,
    recentResourceIds: alert.metadata?.recentResourceIds ?? [],
    target: {
      page: 'admin',
      admin: {
        tab: 'Task review',
        mediaStatus: null,
        mediaAssetId: alert.metadata?.recentResourceIds?.[0] ?? null,
      },
    },
  },
})

const securityAlertNotification = (alert) => ({
  type: 'security.event.alert',
  title: alert.title,
  body: alert.summary,
  resourceType: 'security_alert',
  resourceId: alert.id,
  dedupeUnread: true,
  metadata: {
    alertId: alert.id,
    alertType: alert.type,
    severity: alert.severity,
    count: alert.count,
    threshold: alert.threshold,
    windowMinutes: alert.windowMinutes,
    recentEventIds: alert.metadata?.recentEventIds ?? [],
    recentClientKeys: alert.metadata?.recentClientKeys ?? [],
    target: {
      page: 'admin',
      admin: {
        tab: 'Security',
        securityAlertId: alert.id,
      },
    },
  },
})

const getSeedSecurityEventAlerts = () => {
  const policy = buildSecurityAlertPolicy()
  const since = Date.now() - policy.windowMinutes * 60 * 1000
  const events = listSecurityEvents({ limit: Number.parseInt(process.env.SECURITY_EVENT_MAX_ITEMS ?? '500', 10) || 500 }).items
    .filter((event) => new Date(event.occurredAt).getTime() >= since)
  const alertDeliveryFailureEvents = auditEvents.filter((event) =>
    event.action === 'security.alert.dispatch' &&
    new Date(event.createdAt).getTime() >= since &&
    event.metadata?.status === 'failed'
  )
  const dispositionEvents = auditEvents.filter((event) =>
    event.resourceType === 'security_alert' && securityAlertDispositionActions.includes(event.action)
  )
  return applySecurityAlertDispositions(buildSecurityEventAlerts({
    rateLimitEvents: events.filter((event) => event.source === 'rate_limit'),
    bodyRejectedEvents: events.filter((event) => event.source === 'body_size'),
    authFailureEvents: events.filter((event) => event.source === 'auth_failure'),
    alertDeliveryFailureEvents,
    policy,
  }), dispositionEvents)
}

const recordSeedSecurityAlertDisposition = (id, disposition, payload, actor) => {
  const alert = getSeedSecurityEventAlerts().find((item) => item.id === String(id))
  if (!alert) {
    return null
  }
  recordAudit(actor, `security.alert.${disposition}`, 'security_alert', alert.id, {
    alertType: alert.type,
    severity: alert.severity,
    note: payload.note ?? '',
    actorHandle: actor?.handle ?? null,
    ...(payload.silencedUntil ? { silencedUntil: payload.silencedUntil } : {}),
  })
  return getSeedSecurityEventAlerts().find((item) => item.id === alert.id) ?? null
}

const getSeedSecurityAlertEvents = (id, options = {}) => {
  const alert = getSeedSecurityEventAlerts().find((item) => item.id === String(id))
  if (!alert) {
    return null
  }
  const policy = buildSecurityAlertPolicy()
  const since = Date.now() - policy.windowMinutes * 60 * 1000
  const source = securityAlertSource(alert)
  if (source === 'alert_dispatch') {
    return auditEvents
      .filter((event) =>
        event.action === 'security.alert.dispatch' &&
        new Date(event.createdAt).getTime() >= since &&
        event.metadata?.status === 'failed'
      )
      .slice(0, options.limit ?? 5)
      .map(serializeSecurityAlertDispatchEvent)
  }
  return listSecurityEvents({ limit: Number.parseInt(process.env.SECURITY_EVENT_MAX_ITEMS ?? '500', 10) || 500 }).items
    .filter((event) => new Date(event.occurredAt).getTime() >= since)
    .filter((event) => !source || event.source === source)
    .slice(0, options.limit ?? 5)
}

const getSeedSecurityAlertExport = (id) => {
  const alert = getSeedSecurityEventAlerts().find((item) => item.id === String(id))
  if (!alert) {
    return null
  }
  return {
    exportedAt: new Date().toISOString(),
    alert,
    events: getSeedSecurityAlertEvents(alert.id, { limit: 20 }) ?? [],
    auditEvents: auditEvents
      .filter((event) =>
        (event.resourceType === 'security_alert' && event.resourceId === alert.id) ||
        (securityAlertSource(alert) === 'alert_dispatch' && alert.metadata?.recentEventIds?.includes(event.id))
      )
      .map(serializeAuditEvent),
  }
}

async function notifySecurityEventAlerts(actor) {
  const created = []
  for (const alert of getSeedSecurityEventAlerts()) {
    if (alert.state === 'silenced') {
      continue
    }
    const notificationsCreated = notifyAuditReaders(actor, securityAlertNotification(alert))
    created.push(...notificationsCreated)
    if (notificationsCreated.length > 0) {
      const dispatches = await dispatchSecurityAlert(alert)
      for (const dispatch of dispatches) {
        recordAudit(actor, 'security.alert.dispatch', 'security_alert', alert.id, {
          alertType: alert.type,
          severity: alert.severity,
          channel: dispatch.channel,
          status: dispatch.status,
          statusCode: dispatch.statusCode ?? null,
          error: dispatch.error ?? null,
        })
      }
    }
  }
  return created
}

async function notifyMediaScanAlerts(actor) {
  const created = []
  for (const alert of getSeedMediaScanAlerts()) {
    if (alert.state === 'silenced') {
      continue
    }
    const notificationsCreated = notifyMediaQueueReaders(actor, mediaScanAlertNotification(alert))
    created.push(...notificationsCreated)
    if (notificationsCreated.length > 0) {
      const dispatches = await dispatchMediaScanAlert(alert)
      for (const dispatch of dispatches) {
        recordAudit(actor, 'media.scan.alert.dispatch', 'media_scan_alert', alert.id, {
          alertType: alert.type,
          severity: alert.severity,
          channel: dispatch.channel,
          status: dispatch.status,
          statusCode: dispatch.statusCode ?? null,
          error: dispatch.error ?? null,
        })
      }
    }
  }
  return created
}

const makeBudget = (payload) => {
  if (payload.rewardAmount) {
    return payload.rewardCurrency ? `${payload.rewardCurrency}${payload.rewardAmount}` : String(payload.rewardAmount)
  }
  return `${payload.pointsReward} pts`
}

const makeStorageKey = (actor, payload, id = randomUUID()) =>
  `${actor.handle}/${payload.purpose}/${id}-${payload.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`

const makeGeneratedStorageKey = (actor, payload, id = randomUUID()) =>
  `${actor.handle}/generated/${payload.generation.workspace}/${id}-${payload.artifact.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`

const makeUploadContract = (asset) => {
  return {
    asset: serializeMediaAsset(asset),
    upload: signMediaUpload(asset),
  }
}

const makeDownloadContract = (asset) => ({
  asset: serializeMediaAsset(asset),
  download: signMediaDownload(asset),
})

const mediaSecurityMetadata = (asset, patch = {}) => ({
  ...(asset.metadata ?? {}),
  security: {
    ...(asset.metadata?.security ?? {}),
    ...patch,
  },
})

const makeCreativeGenerationRecord = (payload, patch = {}) => {
  const now = new Date().toISOString()
  return {
    id: String(payload.id),
    actorId: payload.actorId ?? null,
    actorHandle: payload.actorHandle ?? null,
    workspace: payload.workspace,
    mode: payload.mode,
    providerId: payload.providerId,
    providerMode: payload.providerMode ?? null,
    status: payload.status ?? 'queued',
    promptHash: payload.promptHash,
    promptPreview: payload.promptPreview ?? null,
    inputAssetIds: payload.inputAssetIds ?? [],
    parameterKeys: payload.parameterKeys ?? [],
    outputAssetIds: payload.outputAssetIds ?? [],
    usage: payload.usage ?? null,
    credit: payload.credit ?? null,
    quota: payload.quota ?? null,
    safety: payload.safety ?? null,
    policy: payload.policy ?? null,
    providerRequestId: payload.providerRequestId ?? null,
    providerJobId: payload.providerJobId ?? null,
    errorCode: payload.errorCode ?? null,
    errorMessagePreview: payload.errorMessagePreview ?? null,
    startedAt: payload.startedAt ?? null,
    completedAt: payload.completedAt ?? null,
    failedAt: payload.failedAt ?? null,
    createdAt: payload.createdAt ?? now,
    updatedAt: now,
    ...patch,
  }
}

const makeCreativeProviderReplayRecord = (payload, patch = {}) => {
  const now = new Date().toISOString()
  return {
    id: payload.id ?? `provider-replay-${randomUUID()}`,
    generationId: String(payload.generationId ?? ''),
    providerId: payload.providerId,
    providerMode: payload.providerMode ?? null,
    providerJobId: payload.providerJobId ?? null,
    providerEventId: payload.providerEventId ?? null,
    sourceType: payload.sourceType,
    idempotencyKey: payload.idempotencyKey,
    payloadHash: payload.payloadHash ?? null,
    previousStatus: payload.previousStatus ?? null,
    normalizedStatus: payload.normalizedStatus ?? null,
    action: payload.action ?? 'noop',
    reasonCode: payload.reasonCode ?? null,
    sideEffectPlan: payload.sideEffectPlan ?? null,
    sideEffectResult: payload.sideEffectResult ?? null,
    errorPreview: payload.errorPreview ?? null,
    receivedAt: payload.receivedAt ?? now,
    appliedAt: payload.appliedAt ?? null,
    createdAt: payload.createdAt ?? now,
    updatedAt: now,
    ...patch,
  }
}

const patchCreativeGeneration = (id, patch, actor, auditAction) => {
  const current = creativeGenerationsById.get(String(id))
  if (!current) {
    return null
  }
  const updated = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  }
  creativeGenerationsById.set(updated.id, updated)
  recordAudit(actor, auditAction, 'creative_generation', updated.id, {
    status: updated.status,
    outputAssetIds: updated.outputAssetIds,
  })
  return serializeCreativeGeneration(updated)
}

const creativeQuotaWindowId = ({ actorHandle, workspace, windowType, windowStart }) =>
  `${actorHandle ?? 'unknown'}:${workspace}:${windowType}:${windowStart}`

const getCreativeCreditDto = (ledger) => ledger ? ({
  ledgerId: ledger.id,
  generationId: ledger.generationId,
  quotaReservationId: ledger.quotaReservationId ?? null,
  status: ledger.status,
  currency: 'credits',
  reserved: ledger.reservationAmount,
  settled: ledger.settledAmount,
  refunded: ledger.refundedAmount,
  amount: ledger.reservationAmount,
  reasonCode: ledger.reasonCode ?? null,
  metadata: ledger.metadata ?? null,
  reservedAt: ledger.reservedAt ?? null,
  settledAt: ledger.settledAt ?? null,
  refundedAt: ledger.refundedAt ?? null,
  cancelledAt: ledger.cancelledAt ?? null,
}) : null

const findCreativeCreditLedger = (reference) => {
  const key = String(reference ?? '')
  if (!key) {
    return null
  }
  return creativeCreditLedgerById.get(key) ??
    [...creativeCreditLedgerById.values()].find((ledger) =>
      ledger.generationId === key || ledger.quotaReservationId === key) ??
    null
}

const getCreativeQuotaDto = (window, reservationId = null) => ({
  policyVersion: window.policyVersion,
  scope: 'user_workspace_daily',
  workspace: window.workspace,
  limit: window.limitUnits,
  reserved: window.reservedUnits,
  used: window.usedUnits,
  released: window.releasedUnits,
  remaining: Math.max(window.limitUnits - window.reservedUnits - window.usedUnits, 0),
  reservationId,
  window: {
    id: window.windowStart.slice(0, 10),
    type: window.windowType,
    start: window.windowStart,
    end: window.windowEnd,
    resetsAt: window.windowEnd,
  },
})

const getOrCreateCreativeQuotaWindow = (payload) => {
  const id = creativeQuotaWindowId(payload)
  const existing = creativeQuotaWindowsById.get(id)
  if (existing) {
    if (existing.limitUnits !== payload.limit) {
      const updated = {
        ...existing,
        limitUnits: payload.limit,
        updatedAt: new Date().toISOString(),
      }
      creativeQuotaWindowsById.set(id, updated)
      return updated
    }
    return existing
  }
  const now = new Date().toISOString()
  const created = {
    id,
    actorId: payload.actorId ?? null,
    actorHandle: payload.actorHandle ?? null,
    workspace: payload.workspace,
    windowType: payload.windowType,
    windowStart: payload.windowStart,
    windowEnd: payload.windowEnd,
    limitUnits: payload.limit,
    reservedUnits: 0,
    usedUnits: 0,
    releasedUnits: 0,
    policyVersion: payload.policyVersion,
    createdAt: now,
    updatedAt: now,
  }
  creativeQuotaWindowsById.set(id, created)
  return created
}

const mediaAssetScanStatus = (asset) => asset.metadata?.security?.scanStatus ?? 'pending'
const mediaScanJobStatus = (asset) => {
  const security = asset.metadata?.security ?? {}
  if (!security.scanJobStatus) {
    return null
  }
  if (security.scanJobStatus === 'queued' || security.scanJobStatus === 'retrying') {
    const timeoutAt = security.scanTimeoutAt ? new Date(security.scanTimeoutAt).getTime() : null
    if (timeoutAt && timeoutAt < Date.now()) {
      return 'timed_out'
    }
  }
  return security.scanJobStatus
}
const mediaScanJobTimedOut = (asset) => {
  const security = asset.metadata?.security ?? {}
  if (security.scanJobStatus !== 'queued' && security.scanJobStatus !== 'retrying') {
    return false
  }
  const timeoutAt = security.scanTimeoutAt ? new Date(security.scanTimeoutAt).getTime() : null
  return Boolean(timeoutAt && timeoutAt < Date.now())
}

const mediaScanAlertDispositionActions = [
  'media.scan.alert.acknowledged',
  'media.scan.alert.silenced',
  'media.scan.alert.unsilenced',
]

const objectMetadata = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {}

const applyMediaScanAlertDispositions = (alerts, dispositionEvents = []) => {
  const now = Date.now()
  return alerts.map((alert) => {
    const events = dispositionEvents
      .filter((event) => event.resourceId === alert.id)
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    const acknowledged = events.find((event) => event.action === 'media.scan.alert.acknowledged') ?? null
    const silenced = events.find((event) => event.action === 'media.scan.alert.silenced') ?? null
    const unsilenced = events.find((event) => event.action === 'media.scan.alert.unsilenced') ?? null
    const acknowledgedMetadata = objectMetadata(acknowledged?.metadata)
    const silenceMetadata = objectMetadata(silenced?.metadata)
    const silenceUntil = silenceMetadata.silencedUntil ? String(silenceMetadata.silencedUntil) : null
    const silenceUntilMs = Date.parse(silenceUntil ?? '')
    const silenceCreatedMs = Date.parse(silenced?.createdAt ?? '')
    const unsilenceCreatedMs = Date.parse(unsilenced?.createdAt ?? '')
    const silenceIsCurrent = Boolean(
      silenced &&
      Number.isFinite(silenceUntilMs) &&
      silenceUntilMs > now &&
      (!unsilenced || silenceCreatedMs > unsilenceCreatedMs),
    )
    return {
      ...alert,
      state: silenceIsCurrent ? 'silenced' : acknowledged ? 'acknowledged' : 'active',
      acknowledgedAt: acknowledged?.createdAt ?? null,
      acknowledgedBy: acknowledgedMetadata.actorHandle ?? null,
      acknowledgementNote: acknowledgedMetadata.note ?? null,
      silencedUntil: silenceIsCurrent ? silenceUntil : null,
      silencedBy: silenceIsCurrent ? silenceMetadata.actorHandle ?? null : null,
      silenceNote: silenceIsCurrent ? silenceMetadata.note ?? null : null,
    }
  })
}

const buildMediaScanAlerts = ({
  callbackDeniedEvents = [],
  timeoutEvents = [],
  dispatchFailures = [],
  alertDeliveryFailures = [],
  policy = getSeedMediaGovernancePolicy(),
} = {}) => {
  const windowMinutes = policy.alerts.windowMinutes
  const thresholds = policy.alerts.thresholds
  const alerts = []
  const pushAlert = ({ type, severity, title, summary, count, threshold, metadata = {} }) => {
    if (count < threshold) return
    alerts.push({
      id: `media-scan-alert-${type}`,
      type,
      severity,
      title,
      summary,
      count,
      threshold,
      windowMinutes,
      resourceType: 'media_asset',
      resourceId: null,
      metadata,
      createdAt: new Date().toISOString(),
    })
  }
  pushAlert({
    type: 'media.scan.callback_denied.spike',
    severity: 'critical',
    title: 'Scanner callback authentication failures',
    summary: `${callbackDeniedEvents.length} denied scanner callbacks in the last ${windowMinutes} minutes.`,
    count: callbackDeniedEvents.length,
    threshold: thresholds.callbackDenied,
    metadata: {
      action: 'media.scan.callback_denied',
      recentResourceIds: callbackDeniedEvents.map((event) => event.resourceId).filter(Boolean).slice(0, 5),
    },
  })
  pushAlert({
    type: 'media.scan.dispatch_failed.spike',
    severity: 'warning',
    title: 'Scanner dispatch failures',
    summary: `${dispatchFailures.length} scanner dispatch failures in the last ${windowMinutes} minutes.`,
    count: dispatchFailures.length,
    threshold: thresholds.dispatchFailed,
    metadata: {
      recentResourceIds: dispatchFailures.map((item) => item.id).filter(Boolean).slice(0, 5),
    },
  })
  pushAlert({
    type: 'media.scan.timeout.spike',
    severity: 'warning',
    title: 'Scanner timeout escalations',
    summary: `${timeoutEvents.length} scan timeout escalations in the last ${windowMinutes} minutes.`,
    count: timeoutEvents.length,
    threshold: thresholds.timeout,
    metadata: {
      action: 'media.scan.timeout',
      recentResourceIds: timeoutEvents.map((event) => event.resourceId).filter(Boolean).slice(0, 5),
    },
  })
  pushAlert({
    type: 'media.scan.alert_delivery_failed.spike',
    severity: 'warning',
    title: 'Scanner alert delivery failures',
    summary: `${alertDeliveryFailures.length} scanner alert delivery failures in the last ${windowMinutes} minutes.`,
    count: alertDeliveryFailures.length,
    threshold: thresholds.alertDeliveryFailed,
    metadata: {
      action: 'media.scan.alert.dispatch',
      recentResourceIds: alertDeliveryFailures.map((event) => event.resourceId).filter(Boolean).slice(0, 5),
      recentChannels: [...new Set(alertDeliveryFailures.map((event) => event.metadata?.channel).filter(Boolean))].slice(0, 5),
    },
  })
  return alerts
}
const getSeedMediaScanAlerts = () => {
  const policy = getSeedMediaGovernancePolicy()
  const since = Date.now() - policy.alerts.windowMinutes * 60 * 1000
  const recentAuditEvents = auditEvents.filter((event) => new Date(event.createdAt).getTime() >= since)
  const dispositionEvents = auditEvents.filter((event) =>
    event.resourceType === 'media_scan_alert' && mediaScanAlertDispositionActions.includes(event.action)
  )
  const dispatchFailures = [...mediaAssetsById.values()].filter((asset) => {
    const security = asset.metadata?.security ?? {}
    const updatedAt = new Date(asset.updatedAt ?? 0).getTime()
    return updatedAt >= since && security.scanDispatchStatus === 'failed'
  })
  return applyMediaScanAlertDispositions(buildMediaScanAlerts({
    callbackDeniedEvents: recentAuditEvents.filter((event) => event.action === 'media.scan.callback_denied'),
    timeoutEvents: recentAuditEvents.filter((event) => event.action === 'media.scan.timeout'),
    dispatchFailures,
    alertDeliveryFailures: recentAuditEvents.filter((event) =>
      event.action === 'media.scan.alert.dispatch' && event.metadata?.status === 'failed'
    ),
    policy,
  }), dispositionEvents)
}

const recordSeedMediaScanAlertDisposition = (id, disposition, payload, actor) => {
  const alert = getSeedMediaScanAlerts().find((item) => item.id === String(id))
  if (!alert) {
    return null
  }
  recordAudit(actor, `media.scan.alert.${disposition}`, 'media_scan_alert', alert.id, {
    alertType: alert.type,
    severity: alert.severity,
    note: payload.note ?? '',
    actorHandle: actor?.handle ?? null,
    ...(payload.silencedUntil ? { silencedUntil: payload.silencedUntil } : {}),
  })
  return getSeedMediaScanAlerts().find((item) => item.id === alert.id) ?? null
}

const getSeedMediaScanAlertEvents = (id, limit = 5) => {
  const alert = getSeedMediaScanAlerts().find((item) => item.id === String(id))
  if (!alert) {
    return null
  }
  const policy = getSeedMediaGovernancePolicy()
  const since = Date.now() - policy.alerts.windowMinutes * 60 * 1000
  const recentAuditEvents = auditEvents.filter((event) => new Date(event.createdAt).getTime() >= since)
  if (alert.type === 'media.scan.callback_denied.spike') {
    return recentAuditEvents.filter((event) => event.action === 'media.scan.callback_denied').slice(0, limit)
  }
  if (alert.type === 'media.scan.timeout.spike') {
    return recentAuditEvents.filter((event) => event.action === 'media.scan.timeout').slice(0, limit)
  }
  if (alert.type === 'media.scan.alert_delivery_failed.spike') {
    return recentAuditEvents
      .filter((event) => event.action === 'media.scan.alert.dispatch' && event.metadata?.status === 'failed')
      .slice(0, limit)
  }
  if (alert.type === 'media.scan.dispatch_failed.spike') {
    return [...mediaAssetsById.values()]
      .filter((asset) => {
        const security = asset.metadata?.security ?? {}
        const updatedAt = new Date(asset.updatedAt ?? 0).getTime()
        return updatedAt >= since && security.scanDispatchStatus === 'failed'
      })
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      .slice(0, limit)
      .map((asset) => {
        const security = asset.metadata?.security ?? {}
        return {
          id: `media-scan-dispatch-failure-${asset.id}`,
          actorType: 'system',
          actorId: null,
          action: 'media.scan.dispatch_failed',
          resourceType: 'media_asset',
          resourceId: asset.id,
          metadata: {
            fileName: asset.fileName,
            externalScanId: security.externalScanId ?? null,
            dispatchStatus: security.scanDispatchStatus ?? null,
            dispatchStatusCode: security.scanDispatchStatusCode ?? null,
            dispatchError: security.scanDispatchError ?? null,
          },
          createdAt: asset.updatedAt,
        }
      })
  }
  return []
}
const mediaMatchesSearch = (asset, search) => {
  if (!search) return true
  const value = String(search).toLowerCase()
  return [asset.id, asset.fileName, asset.storageKey, asset.ownerHandle, asset.contentType, asset.metadata?.security?.externalScanId]
    .some((item) => String(item ?? '').toLowerCase().includes(value))
}

const buildSeedMediaScanJob = (asset) => {
  const security = asset.metadata?.security ?? {}
  if (!security.scanJobStatus) {
    return null
  }
  return {
    id: `media-scan-job-${asset.id}-${security.scanAttempts ?? 1}`,
    assetId: asset.id,
    provider: security.scanProvider ?? 'manual',
    status: security.scanJobStatus,
    scanStatus: security.scanStatus ?? 'pending',
    externalScanId: security.externalScanId ?? null,
    attempts: Number(security.scanAttempts ?? 1),
    requestedAt: security.scanRequestedAt ?? null,
    timeoutAt: security.scanTimeoutAt ?? null,
    nextRetryAt: security.nextRetryAt ?? null,
    callbackAt: security.callbackReceivedAt ?? null,
    failedAt: security.failedAt ?? null,
    reviewedById: null,
    reviewedAt: security.scannedAt ?? null,
    note: security.scanNote ?? null,
    rejectionReason: security.rejectionReason ?? null,
    metadata: {
      requestAdapter: security.scanRequestAdapter ?? null,
      dispatchStatus: security.scanDispatchStatus ?? null,
      dispatchStatusCode: security.scanDispatchStatusCode ?? null,
      dispatchError: security.scanDispatchError ?? null,
      dispatchRequestedAt: security.scanDispatchRequestedAt ?? null,
    },
    createdAt: security.scanRequestedAt ?? asset.createdAt,
    updatedAt: asset.updatedAt,
  }
}

const getSeedMediaScanJobArchiveManifest = (options = {}) => {
  const policy = getSeedMediaGovernancePolicy()
  const retention = {
    days: policy.retention.historyRetentionDays,
    maxPerAsset: policy.retention.historyRetentionMaxPerAsset,
  }
  return {
    exportedAt: new Date().toISOString(),
    mode: 'candidate_manifest',
    retention,
    deleteBoundary: {
      inactiveStatuses: ['completed', 'failed'],
      activeStatusesRetained: ['queued', 'retrying', 'timed_out'],
      prunedByAge: `createdAt older than ${retention.days} days`,
      prunedByCount: `inactive jobs beyond newest ${retention.maxPerAsset} per asset`,
    },
    count: 0,
    limit: options.limit ?? 100,
    nextCursor: null,
    items: [],
  }
}

export const createSeedRepository = () => ({
  auth: {
    getCurrentUser: () => seedStore.me,
    findDemoAccountByAccessToken: (token) => {
      const payload = verifyAccessToken(token)
      if (payload) {
        return getAccountById(payload.sub) ?? getAccountByHandle(payload.handle) ?? null
      }
      return seedStore.demoAccountByAccessToken.get(token) ?? null
    },
    findDemoAccountByRefreshToken: (token) => {
      const session = sessionByRefreshToken.get(token)
      if (session && !session.revokedAt && session.expiresAt > new Date()) {
        return getAccountByHandle(session.handle)
      }
      return seedStore.demoAccountByRefreshToken.get(token) ?? null
    },
    findDemoAccountByHandle: (handle) => seedStore.demoAccountByHandle.get(handle) ?? null,
    listDemoAccounts: () => seedStore.demoAccounts,
    issueSession: (account) => issueSession(account),
    registerEmailAccount,
    loginWithPassword,
    completeOAuthLogin,
    listOAuthAccounts,
    unlinkOAuthAccount,
    rotateSession: (token) => {
      const session = sessionByRefreshToken.get(token)
      if (session?.revokedAt && session.replacedByToken) {
        const now = new Date()
        for (const [refreshToken, candidate] of sessionByRefreshToken.entries()) {
          if (candidate.familyId === session.familyId) {
            sessionByRefreshToken.set(refreshToken, { ...candidate, revokedAt: candidate.revokedAt ?? now, reuseDetectedAt: now })
          }
        }
        recordAudit(getAccountByHandle(session.handle), 'auth.session.reuse_detected', 'auth_session', session.id, { familyId: session.familyId })
        return null
      }
      const handle = session && !session.revokedAt && session.expiresAt > new Date()
        ? session.handle
        : seedStore.demoAccountByRefreshToken.get(token)?.handle ?? null
      if (!handle) {
        return null
      }
      const account = getAccountByHandle(handle)
      const next = account ? issueSession(account, { familyId: session?.familyId }) : null
      if (session && next) {
        sessionByRefreshToken.set(token, { ...session, revokedAt: new Date(), replacedByToken: next.refreshToken })
      }
      return next
    },
    revokeSession: (token) => {
      const session = sessionByRefreshToken.get(token)
      if (session) {
        sessionByRefreshToken.set(token, { ...session, revokedAt: new Date() })
      }
      return true
    },
    listSessions: (actor) =>
      [...sessionByRefreshToken.values()]
        .filter((session) => getAccountByHandle(session.handle)?.id === actor.id)
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
        .map(getSessionDto),
    revokeSessionById: (id, actor) => {
      for (const [token, session] of sessionByRefreshToken.entries()) {
        if (session.id === id && getAccountByHandle(session.handle)?.id === actor.id && !session.revokedAt) {
          sessionByRefreshToken.set(token, { ...session, revokedAt: new Date() })
          return true
        }
      }
      return false
    },
    revokeAllSessions: (actor) => {
      let revoked = 0
      for (const [token, session] of sessionByRefreshToken.entries()) {
        if (getAccountByHandle(session.handle)?.id === actor.id && !session.revokedAt) {
          sessionByRefreshToken.set(token, { ...session, revokedAt: new Date() })
          revoked += 1
        }
      }
      return { revoked }
    },
  },
  tasks: {
    list: (options = {}) => {
      const search = options.search ? options.search.toLowerCase() : null
      const filtered = seedStore.tasks.filter((task) => {
        if (options.status && task.status !== options.status) return false
        if (options.category && task.category !== options.category) return false
        if (search) {
          const haystack = `${task.title} ${task.description} ${task.category}`.toLowerCase()
          if (!haystack.includes(search)) return false
        }
        return true
      }).map(serializeTask)
      return paginateByCursor(filtered, options)
    },
    findById: (id) => {
      const task = getTaskById(id)
      return task ? serializeTask(task) : null
    },
    create: (payload, actor) => {
      const id = String(seedStore.tasks.length + 1)
      const task = buildTaskViewModel({
        id: Number(id),
        title: payload.title,
        category: payload.category,
        status: 'Open',
        budget: makeBudget(payload),
        deadline: payload.deadlineAt ?? 'TBD',
        pointsReward: payload.pointsReward,
        proposals: 0,
        description: payload.description,
        publisher: actor.handle,
        assignee: 'Unassigned',
        requirements: [payload.acceptanceRules],
        attachments: payload.attachmentIds ?? [],
        privateBrief: '',
        submission: 'No submission yet.',
        resultLinks: [],
        reviewNote: '',
        rights: '',
      })
      seedStore.tasks.push(task)
      seedStore.taskById.set(Number(id), task)
      createTaskEscrow(task, actor.handle)
      recordAudit(actor, 'task.created', 'task', task.id, { status: 'open', category: payload.category })
      return serializeTask(task)
    },
    claim: (id, actor) => {
      const task = updateTask(id, (task) => ({
        ...task,
        status: 'In Progress',
        assignee: actor.handle,
      }))
      if (task) {
        recordAudit(actor, 'task.claimed', 'task', task.id, { status: task.status })
      }
      return task ? serializeTask(task) : null
    },
    createProposal: (id, payload, actor) => {
      const task = updateTask(id, (task) => ({
        ...task,
        proposals: (Number(task.proposals) || 0) + 1,
      }))
      if (!task) {
        return null
      }
      const proposal = {
        id: `proposal-${randomUUID()}`,
        taskId: String(task.id),
        proposer: buildAccountSummary(actor),
        proposerHandle: actor.handle,
        coverLetter: payload.coverLetter,
        estimate: payload.estimate,
        status: 'pending',
        createdAt: new Date().toISOString(),
      }
      taskProposals.unshift(proposal)
      recordAudit(actor, 'task.proposal.created', 'task', task.id, { proposalId: proposal.id })
      createNotificationsForHandles([getHandle(task.publisher)], {
        type: 'task.proposal_submitted',
        title: `Proposal submitted: ${task.title}`,
        body: `${actor.handle} submitted a proposal for ${task.title}.`,
        resourceType: 'task',
        resourceId: String(task.id),
        metadata: { taskId: String(task.id), proposalId: proposal.id, proposerHandle: actor.handle, target: taskNotificationTarget('mine') },
      })
      return serializeTaskProposal(proposal)
    },
    listProposals: (id, actor, options = {}) => {
      const task = getTaskById(id)
      if (!task) {
        return null
      }
      const publisherHandle = getHandle(task.publisher)
      const canViewAll = canAccessOwnedResource(publisherHandle, actor)
      const proposals = taskProposals
        .filter((proposal) => proposal.taskId === String(task.id))
        .filter((proposal) => canViewAll || proposal.proposerHandle === actor.handle)
        .map(serializeTaskProposal)
      return paginateByCursor(proposals, options)
    },
    reviewProposal: (id, proposalId, payload, actor) => {
      const proposal = taskProposals.find((entry) => entry.taskId === String(id) && entry.id === String(proposalId)) ?? null
      if (!proposal) {
        return null
      }
      const task = updateTask(id, (task) => ({
        ...task,
        ...(payload.decision === 'accept' ? {
          status: 'In Progress',
          assignee: proposal.proposerHandle,
        } : {}),
      }), (task) => canAccessOwnedResource(getHandle(task.publisher), actor))
      if (!task) {
        return null
      }
      proposal.status = payload.decision === 'accept' ? 'accepted' : 'rejected'
      proposal.decisionNote = payload.note ?? ''
      const autoRejectedProposerHandles = []
      if (payload.decision === 'accept') {
        for (const entry of taskProposals) {
          if (entry.taskId === String(id) && entry.id !== proposal.id && entry.status === 'pending') {
            entry.status = 'rejected'
            entry.decisionNote = 'Auto-rejected after another proposal was accepted.'
            autoRejectedProposerHandles.push(entry.proposerHandle)
          }
        }
      }
      recordAudit(actor, payload.decision === 'accept' ? 'task.proposal.accepted' : 'task.proposal.rejected', 'task_proposal', proposal.id, {
        taskId: String(id),
        proposer: proposal.proposerHandle,
      })
      createNotificationsForHandles([proposal.proposerHandle], {
        type: payload.decision === 'accept' ? 'task.proposal_accepted' : 'task.proposal_rejected',
        title: payload.decision === 'accept' ? `Proposal accepted: ${task.title}` : `Proposal rejected: ${task.title}`,
        body: payload.decision === 'accept'
          ? `${task.title} is ready for delivery.`
          : `${task.title} proposal was not selected.`,
        resourceType: 'task',
        resourceId: String(task.id),
        metadata: { taskId: String(task.id), proposalId: proposal.id, reviewNote: payload.note ?? '', target: taskNotificationTarget('mine') },
      })
      if (autoRejectedProposerHandles.length > 0) {
        createNotificationsForHandles(autoRejectedProposerHandles, {
          type: 'task.proposal_rejected',
          title: `Proposal not selected: ${task.title}`,
          body: `${task.title} moved forward with another proposal.`,
          resourceType: 'task',
          resourceId: String(task.id),
          metadata: { taskId: String(task.id), selectedProposalId: proposal.id, target: taskNotificationTarget('mine') },
          dedupeUnread: true,
        })
      }
      return serializeTaskProposal(proposal)
    },
    submit: (id, payload, actor = null) => {
      const task = updateTask(id, (task) => ({
        ...task,
        status: 'Pending Review',
        submission: payload.content,
        resultLinks: payload.assetIds?.length ? payload.assetIds : task.resultLinks,
        rights: payload.rightsNote ?? task.rights,
      }), (task) => canAccessOwnedResource(getHandle(task.assignee), actor))
      if (task) {
        const previousSubmission = taskSubmissions.find((entry) => entry.taskId === String(task.id) && entry.submitterHandle === actor.handle) ?? null
        const isResubmission = previousSubmission?.status === 'revision_requested'
        const submission = {
          id: `submission-${randomUUID()}`,
          taskId: String(task.id),
          submitter: buildAccountSummary(actor),
          submitterHandle: actor.handle,
          content: payload.content,
          assetIds: payload.assetIds ?? [],
          rightsNote: payload.rightsNote ?? '',
          status: 'pending_review',
          reviewNote: '',
          reviewedBy: null,
          reviewedAt: null,
          createdAt: new Date().toISOString(),
        }
        taskSubmissions.unshift(submission)
        recordAudit(actor, 'task.submitted', 'task', task.id, { status: task.status })
        createNotificationsForHandles([getHandle(task.publisher)], {
          type: isResubmission ? 'task.submission_resubmitted' : 'task.submission_submitted',
          title: isResubmission ? 'Task revision ready for review' : 'Task submission ready for review',
          body: isResubmission
            ? `${actor.handle} resubmitted work for ${task.title}.`
            : `${actor.handle} submitted work for ${task.title}.`,
          resourceType: 'task',
          resourceId: String(task.id),
          metadata: { taskId: String(task.id), submissionId: submission.id, status: submission.status, previousSubmissionStatus: previousSubmission?.status ?? null, target: taskNotificationTarget('mine') },
        })
      }
      return task ? serializeTask(task) : null
    },
    listSubmissions: (id, actor, options = {}) => {
      const task = getTaskById(id)
      if (!task) {
        return null
      }
      const publisherHandle = getHandle(task.publisher)
      const assigneeHandle = getHandle(task.assignee)
      const canViewAsPublisher = canAccessOwnedResource(publisherHandle, actor)
      const canViewAsAssignee = assigneeHandle && actor?.handle === assigneeHandle
      if (!canViewAsPublisher && !canViewAsAssignee) {
        return null
      }
      const submissions = taskSubmissions
        .filter((submission) => submission.taskId === String(task.id))
        .map(serializeTaskSubmission)
      return paginateByCursor(submissions, options)
    },
    listTimeline: (id, actor, options = {}) => {
      const task = getTaskById(id)
      if (!task) {
        return null
      }
      const proposalRows = taskProposals.filter((proposal) => proposal.taskId === String(task.id))
      const submissionRows = taskSubmissions.filter((submission) => submission.taskId === String(task.id))
      const participantHandles = uniqueHandles([
        getHandle(task.publisher),
        getHandle(task.assignee),
        ...proposalRows.map((proposal) => proposal.proposerHandle),
        ...submissionRows.map((submission) => submission.submitterHandle),
      ])
      if (!participantHandles.includes(actor.handle) && !hasPermission(actor, 'admin:access')) {
        return null
      }
      const proposalIds = proposalRows.map((proposal) => proposal.id)
      const timelineEvents = auditEvents.filter((event) =>
        (event.resourceType === 'task' && String(event.resourceId) === String(task.id)) ||
        (event.resourceType === 'task_proposal' && proposalIds.includes(String(event.resourceId))),
      )
      const hasCreatedEvent = timelineEvents.some((event) => event.action === 'task.created')
      if (!hasCreatedEvent && !options.cursor) {
        const publisher = getAccountByHandle(getHandle(task.publisher))
        timelineEvents.push({
          id: `task-${task.id}-created`,
          actorType: publisher ? 'user' : 'system',
          actorId: publisher?.id ?? null,
          action: 'task.created',
          resourceType: 'task',
          resourceId: String(task.id),
          metadata: { status: task.status, category: task.category },
          createdAt: task.createdAt ?? '',
        })
      }
      const items = timelineEvents
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
        .map((event) => serializeTaskTimelineItem(event, task.id))
      return paginateByCursor(items, options)
    },
    createDispute: (id, payload, actor = null) => {
      const task = getTaskById(id)
      if (!task) {
        return null
      }
      const submission = taskSubmissions.find((entry) =>
        entry.taskId === String(task.id) && ['rejected', 'stale', 'disputed'].includes(entry.status),
      ) ?? null
      if (!submission) {
        return null
      }
      if (actor?.handle !== submission.submitterHandle && !hasPermission(actor, 'admin:access')) {
        return null
      }
      const publisherHandle = getHandle(task.publisher)
      const reviewId = submission.dispute?.adminReviewId ?? `review-task-dispute-${task.id}-${submission.id}`
      const disputeMetadata = {
        kind: 'task_dispute',
        taskId: String(task.id),
        submissionId: submission.id,
        creatorHandle: submission.submitterHandle,
        publisherHandle,
        reason: payload.reason,
        previousSubmissionStatus: submission.status,
        openedBy: actor?.handle ?? submission.submitterHandle,
        openedAt: new Date().toISOString(),
      }
      const existingReview = adminReviewById.get(reviewId)
      const review = {
        ...(existingReview ?? {
          id: reviewId,
          queue: 'task_disputes',
          status: 'Task dispute',
          title: `Task dispute: ${task.title}`,
          owner: submission.submitterHandle,
          decision: undefined,
          reviewedBy: null,
          reviewedAt: null,
        }),
        note: payload.reason,
        metadata: disputeMetadata,
      }
      adminReviewById.set(reviewId, review)
      if (!existingReview) {
        adminReviewQueue.unshift(review)
      } else {
        const index = adminReviewQueue.findIndex((item) => item.id === reviewId)
        if (index >= 0) {
          adminReviewQueue[index] = review
        }
      }
      submission.status = 'disputed'
      submission.dispute = {
        ...disputeMetadata,
        adminReviewId: reviewId,
      }
      const updatedTask = updateTask(id, (task) => ({
        ...task,
        status: 'Disputed',
        disputeStatus: 'open',
        disputeReason: payload.reason,
        disputeReviewId: reviewId,
      }), () => true)
      recordAudit(actor, 'task.dispute.opened', 'task', task.id, {
        note: payload.reason,
        submissionId: submission.id,
        adminReviewId: reviewId,
        previousSubmissionStatus: disputeMetadata.previousSubmissionStatus,
      })
      const notificationPayload = {
        type: 'task.dispute_opened',
        title: `Task dispute opened: ${task.title}`,
        body: `${actor?.handle ?? submission.submitterHandle} opened a dispute: ${payload.reason}`,
        resourceType: 'task',
        resourceId: String(task.id),
        metadata: { taskId: String(task.id), submissionId: submission.id, adminReviewId: reviewId, target: taskNotificationTarget('mine') },
        dedupeUnread: true,
      }
      createNotificationsForHandles([publisherHandle], notificationPayload)
      createNotificationsForHandles([submission.submitterHandle], {
        type: 'task.dispute_received',
        title: `Dispute opened: ${task.title}`,
        body: `Your dispute for ${task.title} is now in the task dispute queue.`,
        resourceType: 'task',
        resourceId: String(task.id),
        metadata: { taskId: String(task.id), submissionId: submission.id, adminReviewId: reviewId, target: taskNotificationTarget('mine') },
        dedupeUnread: true,
      })
      notifyAdminQueueReaders(actor, {
        ...notificationPayload,
        resourceType: 'admin_review',
        resourceId: reviewId,
        metadata: {
          ...notificationPayload.metadata,
          target: {
            page: 'admin',
            admin: { tab: 'Task review', queue: 'task_disputes', reviewId },
          },
        },
      })
      return updatedTask ? serializeTask(updatedTask) : null
    },
    sweepStaleSubmissions: (payload, actor = null) => {
      const cutoff = Date.now() - payload.olderThanHours * 60 * 60 * 1000
      const staleRows = taskSubmissions
        .filter((submission) => {
          const createdAt = new Date(submission.createdAt).getTime()
          return submission.status === 'pending_review' &&
            !Number.isNaN(createdAt) &&
            createdAt < cutoff &&
            (!payload.taskId || submission.taskId === String(payload.taskId))
        })
        .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
        .slice(0, payload.limit)
      for (const submission of staleRows) {
        const task = getTaskById(submission.taskId)
        const staleMetadata = {
          staleAt: new Date().toISOString(),
          olderThanHours: payload.olderThanHours,
          previousSubmissionStatus: submission.status,
        }
        submission.status = 'stale'
        submission.stale = staleMetadata
        recordAudit(actor, 'task.submission.stale', 'task', submission.taskId, {
          submissionId: submission.id,
          olderThanHours: payload.olderThanHours,
          note: `Submission has been pending review for more than ${payload.olderThanHours} hours.`,
        })
        createNotificationsForHandles(
          uniqueHandles([getHandle(task?.publisher), submission.submitterHandle]),
          {
            type: 'task.submission_stale',
            title: `Task review overdue: ${task?.title ?? submission.taskId}`,
            body: `A submission has been pending review for more than ${payload.olderThanHours} hours.`,
            resourceType: 'task',
            resourceId: String(submission.taskId),
            metadata: { taskId: String(submission.taskId), submissionId: submission.id, olderThanHours: payload.olderThanHours, target: taskNotificationTarget('mine') },
            dedupeUnread: true,
          },
        )
      }
      return {
        marked: staleRows.length,
        items: staleRows.map(serializeTaskSubmission),
      }
    },
    review: (id, payload, actor = null) => {
      const isApproval = payload.decision === 'approve'
      const isRevisionRequest = payload.decision === 'request_changes'
      const previousTask = seedStore.taskById.get(Number(id))
      const shouldApplyCompletionReputation = isApproval && previousTask?.status !== 'Completed'
      const task = updateTask(id, (task) => ({
        ...task,
        status: isApproval ? 'Completed' : isRevisionRequest ? 'In Progress' : 'Rejected',
        reviewNote: payload.reviewNote,
        acceptanceChecklist: payload.acceptanceChecklist ?? [],
      }), (task) => canAccessOwnedResource(getHandle(task.publisher), actor))
      if (task) {
        const submission = taskSubmissions.find((entry) => entry.taskId === String(task.id) && entry.status === 'pending_review')
        if (submission) {
          submission.status = isApproval ? 'approved' : isRevisionRequest ? 'revision_requested' : 'rejected'
          submission.reviewNote = payload.reviewNote
          submission.acceptanceChecklist = payload.acceptanceChecklist ?? []
          submission.reviewedBy = buildAccountSummary(actor)
          submission.reviewedAt = new Date().toISOString()
        }
        if (isApproval) {
          finalizeTaskEscrow(task, getHandle(task.publisher), 'approve')
          settleTaskReward(task, getHandle(task.assignee) ?? submission?.submitterHandle)
          if (shouldApplyCompletionReputation) {
            applyTaskCompletionReputation(task, getHandle(task.assignee) ?? submission?.submitterHandle)
          }
        } else if (!isRevisionRequest) {
          finalizeTaskEscrow(task, getHandle(task.publisher), 'reject')
        }
        const assigneeHandle = getHandle(task.assignee) ?? submission?.submitterHandle
        const notificationCopy = {
          approve: {
            type: 'task.submission_approved',
            title: 'Task submission approved',
            body: `${task.title} was approved and points were released.`,
          },
          reject: {
            type: 'task.submission_rejected',
            title: 'Task submission rejected',
            body: `${task.title} was rejected.`,
          },
          request_changes: {
            type: 'task.revision_requested',
            title: 'Task changes requested',
            body: `${task.title} needs revisions before acceptance.`,
          },
        }[payload.decision]
        createNotificationsForHandles([assigneeHandle], {
          ...notificationCopy,
          resourceType: 'task',
          resourceId: String(task.id),
          metadata: { taskId: String(task.id), status: task.status, reviewNote: payload.reviewNote, acceptanceChecklist: payload.acceptanceChecklist ?? [], target: taskNotificationTarget('mine') },
        })
        if (payload.decision === 'approve') {
          createNotificationsForHandles([assigneeHandle], {
            type: 'task.reward_settled',
            title: 'Task reward settled',
            body: `${task.title} reward points were released to your ledger.`,
            resourceType: 'task',
            resourceId: String(task.id),
            metadata: { taskId: String(task.id), status: task.status, target: { page: 'points' } },
            dedupeUnread: true,
          })
        }
        recordAudit(actor, isApproval ? 'task.approved' : isRevisionRequest ? 'task.revision_requested' : 'task.rejected', 'task', task.id, {
          status: task.status,
          reviewNote: payload.reviewNote,
          acceptanceChecklist: payload.acceptanceChecklist ?? [],
        })
      }
      return task ? serializeTask(task) : null
    },
  },
  posts: {
    list: (options = {}) => {
      const filtered = seedStore.posts.filter((post) => {
        if (options.category && post.category !== options.category) return false
        if (options.tag && post.tag !== options.tag) return false
        return true
      })
      const sorted = [...filtered].sort((left, right) => {
        if (options.sort === 'hot') {
          return (Number(right.likes) + Number(right.replies)) - (Number(left.likes) + Number(left.replies))
        }
        if (options.sort === 'unanswered') {
          return Number(left.replies) - Number(right.replies)
        }
        return Number(right.id) - Number(left.id)
      }).map(serializePost)
      return paginateByCursor(sorted, options)
    },
    findById: (id, viewer = null) => {
      const post = getPostById(id)
      if (!post) {
        return null
      }
      return serializePostDetail({
        ...post,
        comments: getPostComments(id),
        relatedTasks: [],
        viewerPermissions: buildViewerPermissions(viewer),
      })
    },
    create: (payload, actor) => {
      const author = getAccountByHandle(actor.handle)
      if (!author) {
        return null
      }
      const id = String(seedStore.posts.length + 1)
      const post = {
        id,
        title: payload.title,
        category: payload.category,
        author: {
          handle: author.handle,
          name: { en: author.displayName, zh: author.displayName },
          role: { en: author.role, zh: author.role },
          lane: author.profile?.lane ?? 'both',
        },
        replies: 0,
        likes: 0,
        views: 0,
        votes: 0,
        tag: payload.tag ?? '',
        solved: false,
        excerpt: payload.excerpt ?? payload.body ?? '',
        body: payload.body,
      }
      seedStore.posts.push(post)
      seedStore.postById.set(Number(id), post)
      recordAudit(actor, 'post.created', 'post', post.id)
      return serializePost(post)
    },
    comment: (id, payload, actor) => {
      const post = getPostById(id)
      if (!post) {
        return null
      }
      const author = getAccountByHandle(actor.handle)
      if (!author) {
        return null
      }
      const comments = ensurePostComments(Number(id))
      const comment = {
        id: `comment-${comments.length + 1}`,
        body: payload.body,
        author: {
          handle: author.handle,
          name: { en: author.displayName, zh: author.displayName },
          role: { en: author.role, zh: author.role },
          lane: author.profile?.lane ?? 'both',
          initials: author.displayName.slice(0, 2).toUpperCase(),
        },
        parentId: payload.parentId ?? null,
        createdAt: new Date().toISOString(),
      }
      comments.unshift(comment)
      const nextPost = {
        ...post,
        replies: (Number(post.replies) || 0) + 1,
      }
      seedStore.postById.set(Number(id), nextPost)
      const index = seedStore.posts.findIndex((entry) => Number(entry.id) === Number(id))
      if (index >= 0) {
        seedStore.posts[index] = nextPost
      }
      recordAudit(actor, 'post.commented', 'post', post.id, { parentId: payload.parentId ?? null })
      return comment
    },
    like: (id, actor) => {
      const post = getPostById(id)
      if (!post) {
        return null
      }
      const likes = getPostLikes(id)
      const key = actor.handle
      if (!likes.has(key)) {
        likes.add(key)
        const nextPost = { ...post, likes: Number(post.likes) + 1 }
        seedStore.postById.set(Number(id), nextPost)
        const index = seedStore.posts.findIndex((entry) => Number(entry.id) === Number(id))
        if (index >= 0) {
          seedStore.posts[index] = nextPost
        }
        recordAudit(actor, 'post.liked', 'post', post.id)
        return { liked: true, post: serializePost(nextPost) }
      }
      return { liked: true, post: serializePost(post) }
    },
    unlike: (id, actor) => {
      const post = getPostById(id)
      if (!post) {
        return null
      }
      const likes = getPostLikes(id)
      const key = actor.handle
      if (likes.has(key)) {
        likes.delete(key)
        const nextPost = { ...post, likes: Math.max(0, Number(post.likes) - 1) }
        seedStore.postById.set(Number(id), nextPost)
        const index = seedStore.posts.findIndex((entry) => Number(entry.id) === Number(id))
        if (index >= 0) {
          seedStore.posts[index] = nextPost
        }
        recordAudit(actor, 'post.unliked', 'post', post.id)
        return { liked: false, post: serializePost(nextPost) }
      }
      return { liked: false, post: serializePost(post) }
    },
    convertToTask: (id, payload, actor) => {
      const post = getPostById(id)
      if (!post) {
        return null
      }
      const ownerHandle = getHandle(post.author)
      if (ownerHandle && ownerHandle !== actor.handle && !hasPermission(actor, 'post:moderate') && !hasPermission(actor, 'admin:access')) {
        return null
      }
      const taskId = String(seedStore.tasks.length + 1)
      const task = buildTaskViewModel({
        id: Number(taskId),
        title: post.title,
        category: post.category,
        status: 'Open',
        budget: payload.rewardAmount ? `${payload.rewardAmount}` : `${payload.pointsReward} pts`,
        deadline: payload.deadlineAt ?? 'TBD',
        pointsReward: payload.pointsReward,
        proposals: 0,
        description: post.body,
        publisher: actor.handle,
        assignee: 'Unassigned',
        requirements: [payload.acceptanceRules],
        attachments: [],
        privateBrief: '',
        submission: 'No submission yet.',
        resultLinks: [],
        reviewNote: '',
        rights: '',
      })
      seedStore.tasks.push(task)
      seedStore.taskById.set(Number(taskId), task)
      recordAudit(actor, 'post.converted_to_task', 'post', post.id, { taskId: task.id })
      return task
    },
  },
  profiles: {
    list: (options = {}) => {
      const search = options.search ? options.search.toLowerCase() : null
      const filtered = seedStore.profiles.filter((profile) => {
        if (options.lane && profile.lane !== options.lane) return false
        if (search) {
          const haystack = `${profile.handle} ${profile.name?.en ?? ''} ${profile.name?.zh ?? ''} ${profile.tags?.join(' ') ?? ''}`.toLowerCase()
          if (!haystack.includes(search)) return false
        }
        return true
      }).map(serializeProfile)
      return paginateByCursor(filtered, { ...options, cursorKey: 'handle' })
    },
    findByHandle: (handle) => {
      const profile = seedStore.profileByHandle.get(handle) ?? null
      return profile ? serializeProfile(profile) : null
    },
    listRankings: () =>
      seedStore.profiles
        .map(serializeProfile)
        .sort((left, right) => (right.stats?.score ?? 0) - (left.stats?.score ?? 0)),
    updateCurrent: (user, patch) => {
      const current = seedStore.profileByHandle.get(user.handle) ?? null
      if (!current) {
        return null
      }
      const nextHandle = patch.handle ?? current.handle
      const updated = {
        ...current,
        ...patch,
        handle: nextHandle,
        name: patch.name ? { ...current.name, ...patch.name } : current.name,
        role: patch.role ? { ...current.role, ...patch.role } : current.role,
        bio: patch.bio ?? current.bio,
        tags: patch.tags ?? current.tags,
        zhTags: patch.zhTags ?? current.zhTags,
        categories: patch.categories ?? current.categories,
        languages: patch.languages ?? current.languages,
        stats: patch.stats ?? current.stats,
        badges: patch.badges ?? current.badges,
        portfolio: patch.portfolio ?? current.portfolio,
        reviews: patch.reviews ?? current.reviews,
      }
      if (nextHandle !== current.handle) {
        seedStore.profileByHandle.delete(current.handle)
      }
      seedStore.profileByHandle.set(nextHandle, updated)
      const index = seedStore.profiles.findIndex((entry) => entry.handle === current.handle)
      if (index >= 0) {
        seedStore.profiles[index] = updated
      }
      return serializeProfile(updated)
    },
  },
  points: {
    listLedger: (options = {}) => {
      const userHandle = options.userHandle ?? null
      const entries = seedStore.pointsLedger
        .filter((entry) => !userHandle || entry.userHandle === userHandle)
        .filter((entry) => !options.status || entry.status === options.status)
        .filter((entry) => {
          if (!options.search) return true
          const search = String(options.search).toLowerCase()
          return [entry.description, entry.sourceType, entry.sourceId, entry.userHandle]
            .some((value) => String(value ?? '').toLowerCase().includes(search))
        })
        .map(serializeLedgerEntry)
      const page = paginateByCursor(entries, options)
      return {
        ...page,
        summary: buildPointSummary(seedStore.pointsLedger.filter((entry) => !userHandle || entry.userHandle === userHandle), userHandle),
      }
    },
    adjust: (payload, actor) => {
      const entry = createManualPointAdjustment(payload, actor)
      return entry ? serializeLedgerEntry(entry) : null
    },
    requestAdjustment: (payload, actor, threshold) => {
      const account = getAccountByHandle(payload.userHandle)
      if (!account) {
        return null
      }
      if (Math.abs(payload.delta) > threshold) {
        const review = createPointAdjustmentReview(payload, actor, threshold)
        return {
          status: 'pending_review',
          threshold,
          review: serializeAdminReview(review),
          entry: null,
        }
      }
      const entry = createManualPointAdjustment(payload, actor)
      return {
        status: 'applied',
        threshold,
        entry: serializeLedgerEntry(entry),
        review: null,
      }
    },
    getAdjustmentPolicy: (fallbackPolicy) => {
      pointAdjustmentPolicy = normalizePointAdjustmentPolicy(pointAdjustmentPolicy ?? fallbackPolicy, fallbackPolicy)
      return pointAdjustmentPolicy
    },
    updateAdjustmentPolicy: (policy, actor, fallbackPolicy) => {
      const previous = normalizePointAdjustmentPolicy(pointAdjustmentPolicy ?? fallbackPolicy, fallbackPolicy)
      pointAdjustmentPolicy = normalizePointAdjustmentPolicy(policy, fallbackPolicy)
      const diff = diffPointAdjustmentPolicy(previous, pointAdjustmentPolicy)
      const audit = recordAudit(actor, 'points.policy.updated', 'point_adjustment_policy', 'default', {
        previous,
        next: pointAdjustmentPolicy,
        diff,
        summary: summarizePointPolicyDiff(diff),
      })
      notifyPolicyManagers(actor, {
        type: 'points.policy.updated',
        title: 'Point adjustment policy updated',
        body: `${actor.handle} updated the point adjustment policy.`,
        resourceType: 'point_adjustment_policy',
        resourceId: 'default',
        metadata: {
          auditEventId: audit.id,
          summary: summarizePointPolicyDiff(diff),
          target: {
            page: 'admin',
            admin: {
              tab: 'Audit log',
              auditEventId: audit.id,
            },
          },
        },
      })
      return pointAdjustmentPolicy
    },
    listAdjustmentPolicyHistory: (options = {}) => {
      const filtered = auditEvents
        .filter((event) => ['points.policy.updated', 'points.policy.rolled_back'].includes(event.action))
        .map((event) => ({
          id: event.id,
          action: event.action,
          actorId: event.actorId,
          createdAt: event.createdAt,
          summary: event.metadata?.summary ?? summarizePointPolicyDiff(event.metadata?.diff ?? {}),
          previous: event.metadata?.previous ?? null,
          next: event.metadata?.next ?? null,
          diff: event.metadata?.diff ?? null,
        }))
      return paginateByCursor(filtered, options)
    },
    rollbackAdjustmentPolicy: (eventId, actor, fallbackPolicy) => {
      const event = auditEvents.find((item) => item.id === eventId) ?? null
      const previous = event?.metadata?.previous ?? null
      if (!previous) {
        return null
      }
      const current = normalizePointAdjustmentPolicy(pointAdjustmentPolicy ?? fallbackPolicy, fallbackPolicy)
      const rolledBack = normalizePointAdjustmentPolicy(previous, fallbackPolicy)
      pointAdjustmentPolicy = rolledBack
      const diff = diffPointAdjustmentPolicy(current, rolledBack)
      const audit = recordAudit(actor, 'points.policy.rolled_back', 'point_adjustment_policy', 'default', {
        rollbackEventId: eventId,
        previous: current,
        next: rolledBack,
        diff,
        summary: `rollback ${eventId}: ${summarizePointPolicyDiff(diff)}`,
      })
      notifyPolicyManagers(actor, {
        type: 'points.policy.rolled_back',
        title: 'Point adjustment policy rolled back',
        body: `${actor.handle} rolled back the point adjustment policy.`,
        resourceType: 'point_adjustment_policy',
        resourceId: 'default',
        metadata: {
          rollbackEventId: eventId,
          auditEventId: audit.id,
          summary: `rollback ${eventId}: ${summarizePointPolicyDiff(diff)}`,
          target: {
            page: 'admin',
            admin: {
              tab: 'Audit log',
              auditEventId: audit.id,
            },
          },
        },
      })
      return rolledBack
    },
  },
  notifications: {
    list: (actor, options = {}) => {
      const filtered = notifications
        .filter((notification) => notification.recipientHandle === actor.handle)
        .filter((notification) => {
          if (options.readState === 'read') return Boolean(notification.readAt)
          if (options.readState === 'all') return true
          return !notification.readAt
        })
        .filter((notification) => !options.type || notification.type === options.type)
        .filter((notification) => !options.resourceType || notification.resourceType === options.resourceType)
      return paginateByCursor(filtered.map(serializeNotification), options)
    },
    markRead: (id, actor) => {
      const notification = notifications.find((item) => item.id === String(id) && item.recipientHandle === actor.handle) ?? null
      if (!notification) {
        return null
      }
      if (!notification.readAt) {
        notification.readAt = new Date().toISOString()
      }
      return serializeNotification(notification)
    },
    markAllRead: (actor) => {
      const now = new Date().toISOString()
      let updated = 0
      for (const notification of notifications) {
        if (notification.recipientHandle === actor.handle && !notification.readAt) {
          notification.readAt = now
          updated += 1
        }
      }
      return { updated }
    },
    createForHandles: createNotificationsForHandles,
  },
  providerLifecycleNotifications: {
    create: createProviderLifecycleNotifications,
  },
  providerBudgetNotifications: {
    createFromAuditEvents: createProviderBudgetNotificationsFromAuditEvents,
  },
  providerLifecycleAudit: {
    record: recordProviderLifecycleAudit,
  },
  providerBudgetAudit: {
    recordMany: recordProviderBudgetAuditEvents,
  },
  audit: {
    find: (id) => {
      const event = auditEvents.find((item) => item.id === String(id)) ?? null
      return event ? serializeAuditEvent(event) : null
    },
    list: (options = {}) => {
      const filtered = auditEvents.filter((event) => {
        if (options.action && event.action !== options.action) return false
        if (options.resourceType && event.resourceType !== options.resourceType) return false
        if (options.actorId && event.actorId !== options.actorId) return false
        return true
      })
      return paginateByCursor(filtered.map(serializeAuditEvent), options)
    },
  },
  securityEvents: {
    flushPending: flushSecurityEvents,
    list: (options = {}) => listSecurityEvents(options),
    listAlerts: () => getSeedSecurityEventAlerts(),
    listAlertEvents: (id, options = {}) => getSeedSecurityAlertEvents(id, options),
    exportAlert: (id) => getSeedSecurityAlertExport(id),
    acknowledgeAlert: (id, payload, actor) => recordSeedSecurityAlertDisposition(id, 'acknowledged', payload, actor),
    silenceAlert: (id, payload, actor) => recordSeedSecurityAlertDisposition(id, 'silenced', payload, actor),
    unsilenceAlert: (id, payload, actor) => recordSeedSecurityAlertDisposition(id, 'unsilenced', payload, actor),
    notifyAlerts: (actor = null) => notifySecurityEventAlerts(actor),
  },
  operationLeases: {
    acquire: async ({ key, ownerId, ttlSeconds = 300, metadata = null } = {}) => {
      const leaseKey = String(key ?? '').trim()
      if (!leaseKey) {
        throw new Error('Operation lease key is required')
      }
      const holder = String(ownerId ?? '').trim() || `worker-${randomUUID()}`
      const now = new Date()
      const current = operationLeaseStore.get(leaseKey) ?? null
      const active = current && !current.releasedAt && current.expiresAt > now
      if (active) {
        recordOperationLeaseAudit('operations.lease.skipped', leaseKey, {
          ownerId: holder,
          heldBy: current.ownerId,
          expiresAt: current.expiresAt.toISOString(),
        })
        return {
          acquired: false,
          reason: 'active_lease',
          ownerId: current.ownerId,
          expiresAt: current.expiresAt.toISOString(),
        }
      }
      const recoveredExpired = Boolean(current && !current.releasedAt && current.expiresAt <= now)
      const lease = {
        key: leaseKey,
        ownerId: holder,
        token: randomUUID(),
        metadata,
        acquiredAt: now,
        renewedAt: now,
        expiresAt: leaseExpiry(ttlSeconds),
        releasedAt: null,
      }
      operationLeaseStore.set(leaseKey, lease)
      recordOperationLeaseAudit(recoveredExpired ? 'operations.lease.recovered' : 'operations.lease.acquired', leaseKey, {
        ownerId: holder,
        ttlSeconds,
        expiresAt: lease.expiresAt.toISOString(),
        recoveredExpired,
      })
      return {
        acquired: true,
        recoveredExpired,
        ...serializeOperationLease(lease),
      }
    },
    renew: async ({ key, token, ttlSeconds = 300 } = {}) => {
      const leaseKey = String(key ?? '').trim()
      const current = operationLeaseStore.get(leaseKey) ?? null
      const now = new Date()
      const renewed = Boolean(current && current.token === token && !current.releasedAt && current.expiresAt > now)
      if (renewed) {
        current.renewedAt = now
        current.expiresAt = leaseExpiry(ttlSeconds)
      }
      recordOperationLeaseAudit(renewed ? 'operations.lease.renewed' : 'operations.lease.renew_failed', leaseKey, {
        ttlSeconds,
        expiresAt: renewed ? current.expiresAt.toISOString() : null,
      })
      return {
        renewed,
        key: leaseKey,
        expiresAt: renewed ? current.expiresAt.toISOString() : null,
      }
    },
    release: async ({ key, token } = {}) => {
      const leaseKey = String(key ?? '').trim()
      const current = operationLeaseStore.get(leaseKey) ?? null
      const now = new Date()
      const released = Boolean(current && current.token === token && !current.releasedAt)
      if (released) {
        current.releasedAt = now
        current.expiresAt = now
      }
      recordOperationLeaseAudit(released ? 'operations.lease.released' : 'operations.lease.release_failed', leaseKey, {
        releasedAt: released ? now.toISOString() : null,
      })
      return {
        released,
        key: leaseKey,
        releasedAt: released ? now.toISOString() : null,
      }
    },
  },
  operationsMetrics: {
    summary: async (options = {}) => buildSeedOperationsMetrics(options),
    exportSnapshot: async (options = {}, actor = null) => {
      const exportedAt = new Date()
      const metrics = buildSeedOperationsMetrics(options, exportedAt)
      const samples = getSeedOperationsMetricSamples(options, exportedAt)
      const snapshot = buildOperationsMetricsSnapshot({ metrics, samples, actor, exportedAt })
      const snapshotId = `operations-metrics-${exportedAt.getTime()}`
      recordAudit(actor, 'admin.operations.metrics_exported', 'operations_metrics', snapshotId, {
        windowMinutes: metrics.window.minutes,
        sampleCounts: Object.fromEntries(Object.entries(samples).map(([key, sample]) => [key, sample.count])),
        hintCount: snapshot.handoff.remediationHints.length,
        exportedAt: snapshot.exportedAt,
      })
      return {
        ...snapshot,
        id: snapshotId,
      }
    },
  },
  authorization: {
    listPermissions: () => permissions.map((id) => ({ id, description: null })),
    listRolePermissions: () =>
      [...editableRolePermissions.entries()].map(([role, rolePermissionIds]) => ({
        role,
        permissions: [...rolePermissionIds],
      })),
    updateRolePermissions: (role, permissionIds, actor) => {
      if (!editableRolePermissions.has(role)) {
        return null
      }
      editableRolePermissions.set(role, [...permissionIds])
      recordAudit(actor, 'admin.role_permissions.updated', 'role', role, {
        permissions: permissionIds,
      })
      return {
        role,
        permissions: [...permissionIds],
      }
    },
  },
  creativeGenerations: {
    create: (payload, actor) => {
      const existing = creativeGenerationsById.get(String(payload.id))
      if (existing) {
        return serializeCreativeGeneration(existing)
      }
      const record = makeCreativeGenerationRecord(payload)
      creativeGenerationsById.set(record.id, record)
      recordAudit(actor, 'creative.generation.created', 'creative_generation', record.id, {
        workspace: record.workspace,
        mode: record.mode,
        providerId: record.providerId,
        status: record.status,
      })
      return serializeCreativeGeneration(record)
    },
    markRunning: (id, patch = {}, actor) => patchCreativeGeneration(String(id), {
      ...patch,
      status: 'running',
      startedAt: patch.startedAt ?? new Date().toISOString(),
    }, actor, 'creative.generation.running'),
    linkOutputAssets: (id, assetIds = [], actor) => {
      const current = creativeGenerationsById.get(String(id))
      const nextAssetIds = [...new Set([...(current?.outputAssetIds ?? []), ...assetIds.filter(Boolean)])]
      return patchCreativeGeneration(String(id), { outputAssetIds: nextAssetIds }, actor, 'creative.generation.outputs_linked')
    },
    complete: (id, patch = {}, actor) => patchCreativeGeneration(String(id), {
      ...patch,
      status: patch.status ?? 'completed',
      completedAt: patch.completedAt ?? new Date().toISOString(),
    }, actor, 'creative.generation.completed'),
    fail: (id, patch = {}, actor) => patchCreativeGeneration(String(id), {
      ...patch,
      status: 'failed',
      failedAt: patch.failedAt ?? new Date().toISOString(),
    }, actor, 'creative.generation.failed'),
    cancel: (id, patch = {}, actor) => patchCreativeGeneration(String(id), {
      ...patch,
      status: 'cancelled',
    }, actor, 'creative.generation.cancelled'),
    find: (id) => {
      const record = creativeGenerationsById.get(String(id))
      return record ? serializeCreativeGeneration(record) : null
    },
    list: (options = {}) => {
      const filtered = [...creativeGenerationsById.values()]
        .filter((record) => !options.actorHandle || record.actorHandle === options.actorHandle)
        .filter((record) => !options.workspace || record.workspace === options.workspace)
        .filter((record) => !options.mode || record.mode === options.mode)
        .filter((record) => !options.providerId || record.providerId === options.providerId)
        .filter((record) => !options.status || record.status === options.status)
        .filter((record) => options.reviewRequired == null || Boolean(record.safety?.reviewRequired) === options.reviewRequired)
        .filter((record) => !options.mediaAssetId || (record.outputAssetIds ?? []).includes(options.mediaAssetId))
        .filter((record) => !options.dateFrom || new Date(record.createdAt).getTime() >= new Date(options.dateFrom).getTime())
        .filter((record) => !options.dateTo || new Date(record.createdAt).getTime() <= new Date(options.dateTo).getTime())
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
        .map(serializeCreativeGeneration)
      return paginateByCursor(filtered, options)
    },
  },
  creativeProviderReplays: {
    record: (payload, actor) => {
      const idempotencyKey = String(payload.idempotencyKey ?? '')
      const existingId = creativeProviderReplayLedgerByIdempotencyKey.get(idempotencyKey)
      const existing = existingId ? creativeProviderReplayLedgerById.get(existingId) : null
      if (existing) {
        return {
          created: false,
          replay: serializeCreativeProviderReplay(existing),
        }
      }

      const record = makeCreativeProviderReplayRecord({ ...payload, idempotencyKey })
      creativeProviderReplayLedgerById.set(record.id, record)
      creativeProviderReplayLedgerByIdempotencyKey.set(record.idempotencyKey, record.id)
      recordAudit(actor, 'creative.provider_replay.recorded', 'creative_provider_replay_ledger', record.id, {
        generationId: record.generationId,
        providerId: record.providerId,
        providerJobId: record.providerJobId,
        sourceType: record.sourceType,
        action: record.action,
        reasonCode: record.reasonCode,
      })
      return {
        created: true,
        replay: serializeCreativeProviderReplay(record),
      }
    },
    markApplied: (id, sideEffectResult = {}, actor) => {
      const current = creativeProviderReplayLedgerById.get(String(id))
      if (!current) {
        return null
      }
      const updated = {
        ...current,
        action: 'applied',
        sideEffectResult,
        appliedAt: current.appliedAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      creativeProviderReplayLedgerById.set(updated.id, updated)
      recordAudit(actor, 'creative.provider_replay.applied', 'creative_provider_replay_ledger', updated.id, {
        generationId: updated.generationId,
        providerId: updated.providerId,
        providerJobId: updated.providerJobId,
        sourceType: updated.sourceType,
      })
      return serializeCreativeProviderReplay(updated)
    },
    markSideEffectResult: (id, sideEffectResult = {}, actor) => {
      const current = creativeProviderReplayLedgerById.get(String(id))
      if (!current) {
        return null
      }
      const completed = Boolean(sideEffectResult.completed)
      const failed = sideEffectResult.operations?.find?.((operation) => operation.status === 'failed') ?? null
      const updated = {
        ...current,
        action: completed ? 'applied' : 'rejected',
        sideEffectResult,
        errorPreview: completed ? null : failed?.errorPreview ?? current.errorPreview ?? null,
        appliedAt: completed ? current.appliedAt ?? new Date().toISOString() : current.appliedAt,
        updatedAt: new Date().toISOString(),
      }
      creativeProviderReplayLedgerById.set(updated.id, updated)
      recordAudit(actor, 'creative.provider_replay.side_effect_result_recorded', 'creative_provider_replay_ledger', updated.id, {
        generationId: updated.generationId,
        providerId: updated.providerId,
        providerJobId: updated.providerJobId,
        sourceType: updated.sourceType,
        action: updated.action,
      })
      return serializeCreativeProviderReplay(updated)
    },
    findByIdempotencyKey: (idempotencyKey) => {
      const id = creativeProviderReplayLedgerByIdempotencyKey.get(String(idempotencyKey ?? ''))
      const record = id ? creativeProviderReplayLedgerById.get(id) : null
      return record ? serializeCreativeProviderReplay(record) : null
    },
    listForGeneration: (generationId, options = {}) => {
      const items = [...creativeProviderReplayLedgerById.values()]
        .filter((record) => record.generationId === String(generationId))
        .sort((left, right) => new Date(right.receivedAt).getTime() - new Date(left.receivedAt).getTime())
        .map(serializeCreativeProviderReplay)
      return paginateByCursor(items, options)
    },
  },
  creativeCredits: {
    reserve: (payload, actor) => {
      const existing = payload.quotaReservationId
        ? findCreativeCreditLedger(payload.quotaReservationId)
        : null
      if (existing) {
        return {
          reserved: existing.status === 'reserved',
          credit: getCreativeCreditDto(existing),
        }
      }

      const now = new Date().toISOString()
      const amount = Math.max(0, Number.parseInt(String(payload.amount ?? payload.estimatedCredits ?? 0), 10) || 0)
      const ledger = {
        id: `credit-${randomUUID()}`,
        generationId: String(payload.generationId ?? ''),
        quotaReservationId: payload.quotaReservationId ?? null,
        actorId: payload.actorId ?? null,
        actorHandle: payload.actorHandle ?? null,
        workspace: payload.workspace,
        mode: payload.mode,
        reservationAmount: amount,
        settledAmount: 0,
        refundedAmount: 0,
        status: 'reserved',
        reasonCode: payload.reasonCode ?? 'generation_reserved',
        metadata: payload.metadata ?? null,
        reservedAt: now,
        settledAt: null,
        refundedAt: null,
        cancelledAt: null,
        createdAt: now,
        updatedAt: now,
      }
      creativeCreditLedgerById.set(ledger.id, ledger)
      recordAudit(actor, 'creative.credit.reserved', 'creative_credit_ledger', ledger.id, {
        generationId: ledger.generationId,
        quotaReservationId: ledger.quotaReservationId,
        workspace: ledger.workspace,
        mode: ledger.mode,
        amount,
      })
      return {
        reserved: true,
        credit: getCreativeCreditDto(ledger),
      }
    },
    settle: (reference, payload = {}, actor) => {
      const ledger = findCreativeCreditLedger(reference)
      if (!ledger) {
        return null
      }
      if (ledger.status !== 'reserved') {
        return getCreativeCreditDto(ledger)
      }
      const now = new Date().toISOString()
      const settledAmount = Math.max(0, Number.parseInt(String(payload.settledAmount ?? ledger.reservationAmount), 10) || 0)
      const updated = {
        ...ledger,
        status: 'settled',
        settledAmount,
        refundedAmount: 0,
        reasonCode: payload.reasonCode ?? 'generation_completed',
        metadata: payload.metadata ?? ledger.metadata ?? null,
        settledAt: now,
        updatedAt: now,
      }
      creativeCreditLedgerById.set(updated.id, updated)
      recordAudit(actor, 'creative.credit.settled', 'creative_credit_ledger', updated.id, {
        generationId: updated.generationId,
        quotaReservationId: updated.quotaReservationId,
        workspace: updated.workspace,
        mode: updated.mode,
        settledAmount,
      })
      return getCreativeCreditDto(updated)
    },
    refund: (reference, payload = {}, actor) => {
      const ledger = findCreativeCreditLedger(reference)
      if (!ledger) {
        return null
      }
      if (ledger.status !== 'reserved') {
        return getCreativeCreditDto(ledger)
      }
      const now = new Date().toISOString()
      const refundedAmount = Math.max(0, Number.parseInt(String(payload.refundedAmount ?? ledger.reservationAmount), 10) || 0)
      const updated = {
        ...ledger,
        status: 'refunded',
        settledAmount: 0,
        refundedAmount,
        reasonCode: payload.reasonCode ?? 'generation_failed',
        metadata: payload.metadata ?? ledger.metadata ?? null,
        refundedAt: now,
        updatedAt: now,
      }
      creativeCreditLedgerById.set(updated.id, updated)
      recordAudit(actor, 'creative.credit.refunded', 'creative_credit_ledger', updated.id, {
        generationId: updated.generationId,
        quotaReservationId: updated.quotaReservationId,
        workspace: updated.workspace,
        mode: updated.mode,
        refundedAmount,
        reasonCode: updated.reasonCode,
      })
      return getCreativeCreditDto(updated)
    },
    cancel: (reference, payload = {}, actor) => {
      const ledger = findCreativeCreditLedger(reference)
      if (!ledger) {
        return null
      }
      if (ledger.status !== 'reserved') {
        return getCreativeCreditDto(ledger)
      }
      const now = new Date().toISOString()
      const updated = {
        ...ledger,
        status: 'cancelled',
        settledAmount: 0,
        refundedAmount: 0,
        reasonCode: payload.reasonCode ?? 'no_charge',
        metadata: payload.metadata ?? ledger.metadata ?? null,
        cancelledAt: now,
        updatedAt: now,
      }
      creativeCreditLedgerById.set(updated.id, updated)
      recordAudit(actor, 'creative.credit.cancelled', 'creative_credit_ledger', updated.id, {
        generationId: updated.generationId,
        quotaReservationId: updated.quotaReservationId,
        workspace: updated.workspace,
        mode: updated.mode,
        reasonCode: updated.reasonCode,
      })
      return getCreativeCreditDto(updated)
    },
  },
  creativeQuota: {
    reserve: (payload, actor) => {
      const units = Math.max(1, Number(payload.costUnits) || 1)
      const window = getOrCreateCreativeQuotaWindow(payload)
      if (window.usedUnits + window.reservedUnits + units > window.limitUnits) {
        return {
          reserved: false,
          quota: getCreativeQuotaDto(window),
        }
      }
      const reservationId = `quota-${randomUUID()}`
      const updatedWindow = {
        ...window,
        reservedUnits: window.reservedUnits + units,
        updatedAt: new Date().toISOString(),
      }
      const reservation = {
        id: reservationId,
        quotaWindowId: updatedWindow.id,
        generationId: payload.generationId ?? null,
        actorId: payload.actorId ?? null,
        actorHandle: payload.actorHandle ?? null,
        workspace: payload.workspace,
        units,
        status: 'reserved',
        reason: null,
        reservedAt: new Date().toISOString(),
        committedAt: null,
        releasedAt: null,
      }
      creativeQuotaWindowsById.set(updatedWindow.id, updatedWindow)
      creativeQuotaReservationsById.set(reservation.id, reservation)
      recordAudit(actor, 'creative.quota.reserved', 'creative_quota_reservation', reservation.id, {
        generationId: reservation.generationId,
        workspace: reservation.workspace,
        units,
        quotaWindowId: reservation.quotaWindowId,
      })
      return {
        reserved: true,
        reservationId,
        quota: getCreativeQuotaDto(updatedWindow, reservationId),
      }
    },
    commit: (reservationId, actor) => {
      const reservation = creativeQuotaReservationsById.get(String(reservationId))
      if (!reservation) {
        return null
      }
      const window = creativeQuotaWindowsById.get(reservation.quotaWindowId)
      if (!window) {
        return null
      }
      if (reservation.status === 'committed') {
        return getCreativeQuotaDto(window, reservation.id)
      }
      if (reservation.status === 'released') {
        return getCreativeQuotaDto(window, reservation.id)
      }
      const updatedWindow = {
        ...window,
        reservedUnits: Math.max(window.reservedUnits - reservation.units, 0),
        usedUnits: window.usedUnits + reservation.units,
        updatedAt: new Date().toISOString(),
      }
      const updatedReservation = {
        ...reservation,
        status: 'committed',
        committedAt: new Date().toISOString(),
      }
      creativeQuotaWindowsById.set(updatedWindow.id, updatedWindow)
      creativeQuotaReservationsById.set(updatedReservation.id, updatedReservation)
      recordAudit(actor, 'creative.quota.committed', 'creative_quota_reservation', updatedReservation.id, {
        generationId: updatedReservation.generationId,
        workspace: updatedReservation.workspace,
        units: updatedReservation.units,
      })
      return getCreativeQuotaDto(updatedWindow, updatedReservation.id)
    },
    release: (reservationId, reason = 'released', actor) => {
      const reservation = creativeQuotaReservationsById.get(String(reservationId))
      if (!reservation) {
        return null
      }
      const window = creativeQuotaWindowsById.get(reservation.quotaWindowId)
      if (!window) {
        return null
      }
      if (reservation.status === 'released') {
        return getCreativeQuotaDto(window, reservation.id)
      }
      if (reservation.status === 'committed') {
        return getCreativeQuotaDto(window, reservation.id)
      }
      const updatedWindow = {
        ...window,
        reservedUnits: Math.max(window.reservedUnits - reservation.units, 0),
        releasedUnits: window.releasedUnits + reservation.units,
        updatedAt: new Date().toISOString(),
      }
      const updatedReservation = {
        ...reservation,
        status: 'released',
        reason,
        releasedAt: new Date().toISOString(),
      }
      creativeQuotaWindowsById.set(updatedWindow.id, updatedWindow)
      creativeQuotaReservationsById.set(updatedReservation.id, updatedReservation)
      recordAudit(actor, 'creative.quota.released', 'creative_quota_reservation', updatedReservation.id, {
        generationId: updatedReservation.generationId,
        workspace: updatedReservation.workspace,
        units: updatedReservation.units,
        reason,
      })
      return getCreativeQuotaDto(updatedWindow, updatedReservation.id)
    },
    getQuotaWindow: (payload) => {
      const window = creativeQuotaWindowsById.get(creativeQuotaWindowId(payload))
      return window ? getCreativeQuotaDto(window) : null
    },
  },
  media: {
    createUpload: (payload, actor) => {
      const now = new Date().toISOString()
      const id = `media-${randomUUID()}`
      const asset = {
        id,
        ownerHandle: actor.handle,
        fileName: payload.fileName,
        storageKey: makeStorageKey(actor, payload, id),
        contentType: payload.contentType,
        sizeBytes: payload.sizeBytes,
        purpose: payload.purpose,
        status: 'pending',
        metadata: payload.metadata ?? null,
        createdAt: now,
        updatedAt: now,
      }
      mediaAssetsById.set(asset.id, asset)
      recordAudit(actor, 'media.upload.created', 'media_asset', asset.id, {
        purpose: asset.purpose,
        sizeBytes: asset.sizeBytes,
      })
      return makeUploadContract(asset)
    },
    completeUpload: async (id, payload, actor) => {
      const asset = mediaAssetsById.get(String(id)) ?? null
      if (!asset || !canAccessOwnedResource(asset.ownerHandle, actor)) {
        return null
      }
      const detectedContentType = payload.detectedContentType || asset.contentType
      const contentTypeMatches = detectedContentType.toLowerCase() === asset.contentType.toLowerCase()
      const scanResult = contentTypeMatches ? await scanMediaAsset(asset) : null
      const updated = {
        ...asset,
        status: contentTypeMatches && scanResult?.status !== 'rejected' ? 'uploaded' : 'rejected',
        metadata: {
          ...mediaSecurityMetadata(asset, {
            checksum: payload.checksum || undefined,
            declaredContentType: asset.contentType,
            detectedContentType,
            scanProvider: scanResult?.provider ?? 'manual',
            scanStatus: contentTypeMatches ? scanResult.status : 'rejected',
            scanNote: scanResult?.note,
            scanRequestedAt: scanResult?.requestedAt,
            externalScanId: scanResult?.externalScanId,
            scanJobStatus: scanResult?.scanJobStatus,
            scanAttempts: scanResult?.scanAttempts,
            scanTimeoutAt: scanResult?.scanTimeoutAt,
            nextRetryAt: scanResult?.nextRetryAt,
            scanRequestAdapter: scanResult?.requestAdapter,
            scanDispatchStatus: scanResult?.dispatchStatus,
            scanDispatchStatusCode: scanResult?.dispatchStatusCode,
            scanDispatchError: scanResult?.dispatchError,
            scanDispatchRequestedAt: scanResult?.dispatchRequestedAt,
            rejectionReason: contentTypeMatches ? scanResult?.reason ?? undefined : 'content_type_mismatch',
            completedAt: new Date().toISOString(),
          }),
          checksum: payload.checksum || undefined,
        },
        updatedAt: new Date().toISOString(),
      }
      mediaAssetsById.set(updated.id, updated)
      recordAudit(actor, 'media.upload.completed', 'media_asset', updated.id, {
        purpose: updated.purpose,
        scanStatus: updated.metadata?.security?.scanStatus,
      })
      return serializeMediaAsset(updated)
    },
    createGeneratedAsset: async (payload, actor) => {
      const now = new Date().toISOString()
      const id = `media-${randomUUID()}`
      const storageKey = makeGeneratedStorageKey(actor, payload, id)
      const storage = await writeStorageObject({
        body: payload.artifact.body,
        contentType: payload.artifact.contentType,
        storageKey,
      })
      const asset = {
        id,
        ownerHandle: actor.handle,
        fileName: payload.artifact.fileName,
        storageKey,
        contentType: payload.artifact.contentType,
        sizeBytes: storage.bytes,
        purpose: 'library_asset',
        status: 'pending',
        metadata: {
          creative: payload.artifact.metadata,
          storage: {
            provider: storage.provider,
            writtenAt: storage.writtenAt,
          },
        },
        createdAt: now,
        updatedAt: now,
      }
      const scanResult = await scanMediaAsset(asset)
      const policyReviewRequired = Boolean(payload.generation.safety?.reviewRequired)
      const effectiveScanStatus = policyReviewRequired ? 'review' : scanResult?.status ?? 'pending'
      const updated = {
        ...asset,
        status: effectiveScanStatus === 'rejected' ? 'rejected' : 'uploaded',
        metadata: mediaSecurityMetadata(asset, {
          declaredContentType: asset.contentType,
          detectedContentType: asset.contentType,
          scanProvider: scanResult?.provider ?? 'manual',
          scanStatus: effectiveScanStatus,
          scanNote: policyReviewRequired ? 'Creative policy requires manual review.' : scanResult?.note,
          scanRequestedAt: scanResult?.requestedAt,
          externalScanId: scanResult?.externalScanId,
          scanJobStatus: scanResult?.scanJobStatus,
          scanAttempts: scanResult?.scanAttempts,
          scanTimeoutAt: scanResult?.scanTimeoutAt,
          nextRetryAt: scanResult?.nextRetryAt,
          scanRequestAdapter: scanResult?.requestAdapter,
          scanDispatchStatus: scanResult?.dispatchStatus,
          scanDispatchStatusCode: scanResult?.dispatchStatusCode,
          scanDispatchError: scanResult?.dispatchError,
          scanDispatchRequestedAt: scanResult?.dispatchRequestedAt,
          rejectionReason: scanResult?.reason ?? undefined,
          creativeReviewRequired: policyReviewRequired,
          creativeReviewReasons: payload.generation.safety?.reasons ?? [],
          completedAt: new Date().toISOString(),
        }),
        updatedAt: new Date().toISOString(),
      }
      mediaAssetsById.set(updated.id, updated)
      recordAudit(actor, 'media.generated_asset.created', 'media_asset', updated.id, {
        generationId: payload.generation.id,
        outputId: payload.output.id,
        workspace: payload.generation.workspace,
        providerId: payload.generation.provider.id,
        scanStatus: updated.metadata?.security?.scanStatus,
        creativeReviewRequired: policyReviewRequired,
      })
      if (policyReviewRequired) {
        recordAudit(actor, 'creative.generation.review_required', 'media_asset', updated.id, {
          generationId: payload.generation.id,
          outputId: payload.output.id,
          workspace: payload.generation.workspace,
          providerId: payload.generation.provider.id,
          reasons: payload.generation.safety?.reasons ?? [],
        })
        notifyMediaQueueReaders(actor, {
          type: 'creative.generation.review_required',
          title: `Creative generation review: ${payload.generation.workspace}`,
          body: `${actor.handle} generated an output that requires policy review.`,
          resourceType: 'media_asset',
          resourceId: updated.id,
          metadata: {
            generationId: payload.generation.id,
            workspace: payload.generation.workspace,
            providerId: payload.generation.provider.id,
            reasons: payload.generation.safety?.reasons ?? [],
            target: {
              page: 'admin',
              admin: {
                tab: 'Review and moderation',
                queue: 'media',
                mediaAssetId: updated.id,
              },
            },
          },
        })
      }
      return serializeMediaAsset(updated)
    },
    listReviewQueue: (options = {}) => {
      const filtered = [...mediaAssetsById.values()]
        .filter((asset) => !options.status || mediaAssetScanStatus(asset) === options.status)
        .filter((asset) => !options.purpose || asset.purpose === options.purpose)
        .filter((asset) => mediaMatchesSearch(asset, options.search))
        .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      return paginateByCursor(filtered.map(serializeMediaAsset), options)
    },
    listScanJobs: (options = {}) => {
      const filtered = [...mediaAssetsById.values()]
        .filter((asset) => mediaScanJobStatus(asset))
        .filter((asset) => {
          if (!options.status || options.status === 'active') {
            return ['queued', 'retrying', 'timed_out'].includes(mediaScanJobStatus(asset))
          }
          return mediaScanJobStatus(asset) === options.status
        })
        .filter((asset) => !options.purpose || asset.purpose === options.purpose)
        .filter((asset) => mediaMatchesSearch(asset, options.search))
        .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      return paginateByCursor(filtered.map(serializeMediaAsset), options)
    },
    exportScanJobArchive: (options = {}) => getSeedMediaScanJobArchiveManifest(options),
    archiveScanJobHistory: async (options = {}, actor = null) => {
      const manifest = getSeedMediaScanJobArchiveManifest(options)
      const storage = await writeJsonArchive(manifest)
      recordAudit(actor, 'media.scan.history_archived', 'media_scan_jobs', null, {
        storageKey: storage.storageKey,
        provider: storage.provider,
        count: manifest.count,
        totalCandidates: manifest.totalCandidates ?? manifest.count,
        bytes: storage.bytes,
      })
      return {
        ...manifest,
        storage,
      }
    },
    getGovernancePolicy: () => getSeedMediaGovernancePolicy(),
    updateGovernancePolicy: (patch, actor) => {
      const previous = getSeedMediaGovernancePolicy()
      const next = mergeMediaGovernancePolicy(previous, patch, buildDefaultMediaGovernancePolicy())
      const diff = diffMediaGovernancePolicy(previous, next, buildDefaultMediaGovernancePolicy())
      mediaGovernancePolicy = next
      const audit = recordAudit(actor, 'media.governance_policy.updated', 'media_governance_policy', 'default', {
        previous,
        next,
        diff,
        summary: summarizeMediaGovernancePolicyDiff(diff),
      })
      notifyPolicyManagers(actor, {
        type: 'media.governance_policy.updated',
        title: 'Media governance policy updated',
        body: `${actor.handle} updated the media governance policy.`,
        resourceType: 'media_governance_policy',
        resourceId: 'default',
        metadata: {
          auditEventId: audit.id,
          summary: summarizeMediaGovernancePolicyDiff(diff),
          target: {
            page: 'admin',
            admin: {
              tab: 'Audit log',
              auditEventId: audit.id,
            },
          },
        },
      })
      return next
    },
    listGovernancePolicyHistory: (options = {}) => {
      const filtered = auditEvents
        .filter((event) => ['media.governance_policy.updated', 'media.governance_policy.rolled_back'].includes(event.action))
        .map((event) => ({
          id: event.id,
          action: event.action,
          actorId: event.actorId,
          createdAt: event.createdAt,
          summary: event.metadata?.summary ?? summarizeMediaGovernancePolicyDiff(event.metadata?.diff ?? {}),
          previous: event.metadata?.previous ?? null,
          next: event.metadata?.next ?? null,
          diff: event.metadata?.diff ?? null,
        }))
      return paginateByCursor(filtered, options)
    },
    rollbackGovernancePolicy: (eventId, actor) => {
      const event = auditEvents.find((item) => item.id === String(eventId)) ?? null
      const previous = event?.metadata?.previous ?? null
      if (!previous) {
        return null
      }
      const fallback = buildDefaultMediaGovernancePolicy()
      const current = getSeedMediaGovernancePolicy()
      const rolledBack = normalizeMediaGovernancePolicy(previous, fallback)
      const diff = diffMediaGovernancePolicy(current, rolledBack, fallback)
      mediaGovernancePolicy = rolledBack
      const audit = recordAudit(actor, 'media.governance_policy.rolled_back', 'media_governance_policy', 'default', {
        rollbackEventId: eventId,
        previous: current,
        next: rolledBack,
        diff,
        summary: `rollback ${eventId}: ${summarizeMediaGovernancePolicyDiff(diff)}`,
      })
      notifyPolicyManagers(actor, {
        type: 'media.governance_policy.rolled_back',
        title: 'Media governance policy rolled back',
        body: `${actor.handle} rolled back the media governance policy.`,
        resourceType: 'media_governance_policy',
        resourceId: 'default',
        metadata: {
          rollbackEventId: eventId,
          auditEventId: audit.id,
          summary: `rollback ${eventId}: ${summarizeMediaGovernancePolicyDiff(diff)}`,
          target: {
            page: 'admin',
            admin: {
              tab: 'Audit log',
              auditEventId: audit.id,
            },
          },
        },
      })
      return rolledBack
    },
    listScanJobHistory: (id, options = {}) => {
      const asset = mediaAssetsById.get(String(id)) ?? null
      if (!asset) {
        return null
      }
      const job = buildSeedMediaScanJob(asset)
      return paginateByCursor(job ? [job] : [], options)
    },
    listScanAlerts: () => getSeedMediaScanAlerts(),
    listScanAlertEvents: (id, options = {}) => getSeedMediaScanAlertEvents(id, options.limit ?? 5),
    acknowledgeScanAlert: (id, payload, actor) => recordSeedMediaScanAlertDisposition(id, 'acknowledged', payload, actor),
    silenceScanAlert: (id, payload, actor) => recordSeedMediaScanAlertDisposition(id, 'silenced', payload, actor),
    unsilenceScanAlert: (id, payload, actor) => recordSeedMediaScanAlertDisposition(id, 'unsilenced', payload, actor),
    reviewUpload: (id, payload, actor) => {
      const asset = mediaAssetsById.get(String(id)) ?? null
      if (!asset) {
        return null
      }
      const now = new Date().toISOString()
      const updated = {
        ...asset,
        status: payload.decision === 'clean' ? 'uploaded' : 'rejected',
        metadata: mediaSecurityMetadata(asset, {
          scanStatus: payload.decision === 'clean' ? 'clean' : 'rejected',
          detectedContentType: payload.detectedContentType || asset.metadata?.security?.detectedContentType || asset.contentType,
          scanNote: payload.note,
          scannedBy: actor.handle,
          scannedAt: now,
          scanJobStatus: 'completed',
        }),
        updatedAt: now,
      }
      mediaAssetsById.set(updated.id, updated)
      recordAudit(actor, `media.scan.${payload.decision}`, 'media_asset', updated.id, {
        purpose: updated.purpose,
      })
      return serializeMediaAsset(updated)
    },
    recordScanCallback: (id, payload) => {
      const asset = mediaAssetsById.get(String(id)) ?? null
      if (!asset) {
        return null
      }
      const now = new Date().toISOString()
      const updated = {
        ...asset,
        status: payload.status === 'rejected' ? 'rejected' : 'uploaded',
        metadata: mediaSecurityMetadata(asset, {
          scanStatus: payload.status,
          detectedContentType: payload.detectedContentType || asset.metadata?.security?.detectedContentType || asset.contentType,
          scanNote: payload.note,
          rejectionReason: payload.status === 'rejected' ? payload.reason || asset.metadata?.security?.rejectionReason : undefined,
          externalScanId: payload.externalScanId || asset.metadata?.security?.externalScanId,
          callbackReceivedAt: now,
          scanJobStatus: payload.status === 'rejected' ? 'failed' : 'completed',
        }),
        updatedAt: now,
      }
      mediaAssetsById.set(updated.id, updated)
      recordAudit(null, 'media.scan.callback', 'media_asset', updated.id, {
        purpose: updated.purpose,
        scanStatus: payload.status,
        externalScanId: payload.externalScanId || asset.metadata?.security?.externalScanId,
      })
      if (payload.status === 'review' || payload.status === 'rejected') {
        notifyMediaQueueReaders(null, {
          type: payload.status === 'review' ? 'media.scan.review_required' : 'media.scan.rejected',
          title: payload.status === 'review' ? `Media review required: ${updated.fileName}` : `Media rejected: ${updated.fileName}`,
          body: payload.status === 'review'
            ? `External scanner requested manual review for ${updated.fileName}.`
            : `External scanner rejected ${updated.fileName}${payload.reason ? `: ${payload.reason}` : '.'}`,
          resourceType: 'media_asset',
          resourceId: updated.id,
          metadata: {
            assetId: updated.id,
            fileName: updated.fileName,
            purpose: updated.purpose,
            scanStatus: payload.status,
            externalScanId: payload.externalScanId || asset.metadata?.security?.externalScanId,
            target: {
              page: 'admin',
              admin: {
                tab: 'Task review',
                mediaStatus: payload.status,
                mediaAssetId: updated.id,
              },
            },
          },
        })
      }
      return serializeMediaAsset(updated)
    },
    recordScanCallbackFailure: async (id, payload) => {
      recordAudit(null, 'media.scan.callback_denied', 'media_asset', String(id), {
        reason: payload.reason,
        code: payload.code,
        statusCode: payload.statusCode,
        scanStatus: payload.scanStatus ?? null,
        externalScanId: payload.externalScanId ?? null,
        remoteAddress: payload.remoteAddress ?? null,
        headers: payload.headers ?? {},
      })
      await notifyMediaScanAlerts(null)
    },
    retryScan: async (id, actor) => {
      const asset = mediaAssetsById.get(String(id)) ?? null
      if (!asset) {
        return null
      }
      const scanResult = await retryMediaScanAsset(asset)
      const updated = {
        ...asset,
        status: 'uploaded',
        metadata: mediaSecurityMetadata(asset, {
          scanProvider: scanResult.provider,
          scanStatus: scanResult.status,
          scanNote: scanResult.note,
          scanRequestedAt: scanResult.requestedAt,
          externalScanId: scanResult.externalScanId,
          scanJobStatus: scanResult.scanJobStatus,
          scanAttempts: scanResult.scanAttempts,
          scanTimeoutAt: scanResult.scanTimeoutAt,
          nextRetryAt: scanResult.nextRetryAt,
          scanRequestAdapter: scanResult.requestAdapter,
          scanDispatchStatus: scanResult.dispatchStatus,
          scanDispatchStatusCode: scanResult.dispatchStatusCode,
          scanDispatchError: scanResult.dispatchError,
          scanDispatchRequestedAt: scanResult.dispatchRequestedAt,
          rejectionReason: undefined,
        }),
        updatedAt: new Date().toISOString(),
      }
      mediaAssetsById.set(updated.id, updated)
      recordAudit(actor, 'media.scan.retry', 'media_asset', updated.id, {
        purpose: updated.purpose,
        scanAttempts: updated.metadata?.security?.scanAttempts,
        externalScanId: updated.metadata?.security?.externalScanId,
      })
      notifyMediaQueueReaders(actor, {
        type: 'media.scan.retry_requested',
        title: `Media scan retry: ${updated.fileName}`,
        body: `${actor.handle} requeued ${updated.fileName} for external scanning.`,
        resourceType: 'media_asset',
        resourceId: updated.id,
        metadata: {
          assetId: updated.id,
          fileName: updated.fileName,
          purpose: updated.purpose,
          scanStatus: updated.metadata?.security?.scanStatus,
          scanAttempts: updated.metadata?.security?.scanAttempts,
          externalScanId: updated.metadata?.security?.externalScanId,
          target: {
            page: 'admin',
            admin: {
              tab: 'Task review',
              mediaStatus: 'scanning',
              mediaAssetId: updated.id,
            },
          },
        },
      })
      return serializeMediaAsset(updated)
    },
    sweepScanJobs: async ({ actor = null } = {}) => {
      const policy = getSeedMediaGovernancePolicy()
      const maxAttempts = policy.scanner.maxAttempts
      const timedOut = [...mediaAssetsById.values()].filter(mediaScanJobTimedOut)
      let retried = 0
      let failed = 0
      const updatedItems = []
      for (const asset of timedOut) {
        const security = asset.metadata?.security ?? {}
        const attempts = Number(security.scanAttempts ?? 0)
        if (attempts >= maxAttempts) {
          const now = new Date().toISOString()
          const updated = {
            ...asset,
            status: 'uploaded',
            metadata: mediaSecurityMetadata(asset, {
              scanStatus: 'review',
              scanJobStatus: 'failed',
              scanNote: 'External scan timed out after maximum attempts. Manual review required.',
              rejectionReason: 'scan_timeout',
              failedAt: now,
              nextRetryAt: null,
            }),
            updatedAt: now,
          }
          mediaAssetsById.set(updated.id, updated)
          recordAudit(actor, 'media.scan.timeout', 'media_asset', updated.id, {
            purpose: updated.purpose,
            scanAttempts: attempts,
            externalScanId: security.externalScanId,
          })
          notifyMediaQueueReaders(actor, {
            type: 'media.scan.timeout',
            title: `Media scan timed out: ${updated.fileName}`,
            body: `External scanner timed out after ${attempts} attempt${attempts === 1 ? '' : 's'} for ${updated.fileName}.`,
            resourceType: 'media_asset',
            resourceId: updated.id,
            metadata: {
              assetId: updated.id,
              fileName: updated.fileName,
              purpose: updated.purpose,
              scanStatus: 'review',
              scanAttempts: attempts,
              externalScanId: security.externalScanId,
              target: {
                page: 'admin',
                admin: {
                  tab: 'Task review',
                  mediaStatus: 'review',
                  mediaAssetId: updated.id,
                },
              },
            },
          })
          failed += 1
          updatedItems.push(serializeMediaAsset(updated))
          continue
        }
        const scanResult = await retryMediaScanAsset(asset)
        const updated = {
          ...asset,
          status: 'uploaded',
          metadata: mediaSecurityMetadata(asset, {
            scanProvider: scanResult.provider,
            scanStatus: scanResult.status,
            scanNote: 'External scan automatically retried after timeout.',
            scanRequestedAt: scanResult.requestedAt,
            externalScanId: scanResult.externalScanId,
            scanJobStatus: scanResult.scanJobStatus,
            scanAttempts: scanResult.scanAttempts,
            scanTimeoutAt: scanResult.scanTimeoutAt,
            nextRetryAt: scanResult.nextRetryAt,
            scanRequestAdapter: scanResult.requestAdapter,
            scanDispatchStatus: scanResult.dispatchStatus,
            scanDispatchStatusCode: scanResult.dispatchStatusCode,
            scanDispatchError: scanResult.dispatchError,
            scanDispatchRequestedAt: scanResult.dispatchRequestedAt,
          }),
          updatedAt: new Date().toISOString(),
        }
        mediaAssetsById.set(updated.id, updated)
        recordAudit(actor, 'media.scan.retry.auto', 'media_asset', updated.id, {
          purpose: updated.purpose,
          scanAttempts: updated.metadata?.security?.scanAttempts,
          externalScanId: updated.metadata?.security?.externalScanId,
        })
        retried += 1
        updatedItems.push(serializeMediaAsset(updated))
      }
      await notifyMediaScanAlerts(actor)
      return {
        inspected: timedOut.length,
        retried,
        failed,
        pruned: 0,
        retention: {
          days: policy.retention.historyRetentionDays,
          maxPerAsset: policy.retention.historyRetentionMaxPerAsset,
        },
        items: updatedItems,
      }
    },
    createDownload: (id, actor) => {
      const asset = mediaAssetsById.get(String(id)) ?? null
      if (!asset || !canAccessOwnedResource(asset.ownerHandle, actor) || asset.status !== 'uploaded' || asset.metadata?.security?.scanStatus !== 'clean') {
        return null
      }
      recordAudit(actor, 'media.download.signed', 'media_asset', asset.id, {
        purpose: asset.purpose,
      })
      return makeDownloadContract(asset)
    },
  },
  adminReviews: {
    find: (id) => {
      const current = adminReviewById.get(String(id)) ?? null
      return current ? serializeAdminReview(current) : null
    },
    list: (options = {}) => {
      const filtered = adminReviewQueue.filter((item) => {
        if (options.queue && item.queue !== options.queue) return false
        if (options.status && item.status !== options.status) return false
        return true
      })
      return paginateByCursor(filtered, options)
    },
    review: (id, action, actor) => {
      const current = adminReviewById.get(String(id)) ?? null
      if (!current) {
        return null
      }
      if (current.decision) {
        return serializeAdminReview(current)
      }
      const reviewed = {
        ...current,
        status: action.decision === 'approve' ? 'Approved' : 'Rejected',
        note: action.note || current.note,
        decision: action.decision,
        reviewedBy: actor.handle,
        reviewedAt: new Date().toISOString(),
      }
      if (action.decision === 'approve' && reviewed.metadata?.kind === 'point_adjustment') {
        const ledgerEntry = createManualPointAdjustment(
          {
            userHandle: reviewed.metadata.userHandle,
            delta: reviewed.metadata.delta,
            reason: reviewed.metadata.reason,
            reasonCode: reviewed.metadata.reasonCode ?? null,
          },
          actor,
          { sourceId: reviewed.id, reviewId: reviewed.id },
        )
        reviewed.metadata = {
          ...reviewed.metadata,
          ledgerEntryId: ledgerEntry?.id ?? null,
          approvedBy: actor.handle,
        }
      }
      if (reviewed.metadata?.kind === 'point_adjustment') {
        const decisionLabel = action.decision === 'approve' ? 'approved' : 'rejected'
        createNotificationsForHandles(uniqueHandles([reviewed.metadata.requestedBy, reviewed.metadata.userHandle]), {
          type: `points.adjustment.${decisionLabel}`,
          title: `Point adjustment ${decisionLabel}: @${reviewed.metadata.userHandle}`,
          body: `${actor.handle} ${decisionLabel} ${reviewed.metadata.delta > 0 ? '+' : ''}${reviewed.metadata.delta} points for @${reviewed.metadata.userHandle}.`,
          resourceType: 'admin_review',
          resourceId: reviewed.id,
          metadata: {
            ...reviewed.metadata,
            target: {
              page: 'admin',
              admin: {
                tab: 'Task review',
                queue: 'points',
                reviewId: reviewed.id,
              },
            },
          },
        })
      }
      adminReviewById.set(reviewed.id, reviewed)
      const index = adminReviewQueue.findIndex((item) => item.id === reviewed.id)
      if (index >= 0) {
        adminReviewQueue[index] = reviewed
      }
      recordAudit(actor, `admin.review.${action.decision}`, 'admin_review', reviewed.id, {
        queue: reviewed.queue,
      })
      return serializeAdminReview(reviewed)
    },
  },
  library: {
    list: (options = {}) => {
      const search = options.search ? options.search.toLowerCase() : null
      const filtered = seedLibraryItems.filter((item) => {
        if (options.type && item.type !== options.type) return false
        if (options.source && item.source !== options.source) return false
        if (options.sourceId && item.sourceId !== options.sourceId) return false
        if (search) {
          const haystack = `${item.title} ${item.text} ${item.type} ${item.source}`.toLowerCase()
          if (!haystack.includes(search)) return false
        }
        return true
      }).map(serializeLibraryItem)
      return paginateByCursor(filtered, options)
    },
    save: (payload, actor) => {
      const item = {
        id: `library-${Date.now()}`,
        type: payload.type,
        source: payload.source,
        sourceType: payload.sourceType ?? 'post',
        saves: '1',
        text: payload.text,
        title: payload.title,
        ownerHandle: actor.handle,
        sourceId: payload.sourceId ?? null,
        metadata: payload.metadata ?? null,
      }
      seedLibraryItems.unshift(item)
      libraryItemsById.set(item.id, item)
      recordAudit(actor, 'library.saved', 'library_item', item.id)
      return serializeLibraryItem(item)
    },
    findById: (id) => {
      const item = libraryItemsById.get(String(id)) ?? null
      return item ? serializeLibraryItem(item) : null
    },
    convertToTask: (id, payload, actor) => {
      const item = libraryItemsById.get(String(id)) ?? null
      if (!item) {
        return null
      }
      if (!canAccessOwnedResource(item.ownerHandle, actor)) {
        return null
      }
      const task = buildTaskViewModel({
        id: Number(seedStore.tasks.length + 1),
        title: item.title,
        category: payload.category ?? item.type,
        status: 'Open',
        budget: payload.rewardAmount ? `${payload.rewardAmount}` : `${payload.pointsReward} pts`,
        deadline: payload.deadlineAt ?? 'TBD',
        pointsReward: payload.pointsReward,
        proposals: 0,
        description: item.text,
        publisher: actor.handle,
        assignee: 'Unassigned',
        requirements: [payload.acceptanceRules],
        attachments: [],
        privateBrief: '',
        submission: 'No submission yet.',
        resultLinks: [],
        reviewNote: '',
        rights: '',
      })
      seedStore.tasks.push(task)
      seedStore.taskById.set(Number(task.id), task)
      recordAudit(actor, 'library.converted_to_task', 'library_item', item.id, { taskId: task.id })
      return serializeTask(task)
    },
    sendToWorkspace: (id, actor) => {
      const item = libraryItemsById.get(String(id)) ?? null
      if (!item) {
        return null
      }
      if (!canAccessOwnedResource(item.ownerHandle, actor)) {
        return null
      }
      recordAudit(actor, 'library.sent_to_workspace', 'library_item', item.id)
      return {
        item: serializeLibraryItem(item),
        workspaceDraft: {
          title: item.title,
          seed: item.text,
          owner: actor.handle,
        },
      }
    },
  },
})
