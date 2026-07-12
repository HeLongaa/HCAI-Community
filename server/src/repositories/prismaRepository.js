import { createHash, randomUUID } from 'node:crypto'
import { HttpError } from '../common/errors/httpError.js'
import prismaClientPkg from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { getPermissionsForRole, hasPermission } from '../auth/permissions.js'
import { hashPassword, verifyPassword } from '../auth/passwords.js'
import { createAccessToken, createOpaqueToken, futureDate, hashToken, refreshTokenTtlMs, verifyAccessToken } from '../auth/sessionTokens.js'
import {
  getAdminReviewDto,
  buildUserSummary,
  buildPostCommentRecord,
  buildLibraryItemRecord,
  buildAuditRecord,
  buildPostLikeRecord,
  buildTaskRecord,
  getLedgerDto,
  getCommentDto,
  getCreativeGenerationDto,
  getCreativeGenerationMutationDto,
  getCreativeOutputIngestionDto,
  getCreativeProviderCapEvidenceDto,
  getCreativeProviderBudgetWindowDto,
  getCreativeProviderCircuitEventDto,
  getCreativeProviderCircuitStateDto,
  getCreativeProviderControlStateDto,
  getCreativeProviderCostLedgerDto,
  getCreativeProviderReplayDto,
  getCreativeProviderRetryStateDto,
  getMediaAssetDto,
  getMediaScanJobDto,
  getNotificationDto,
  getPostDto,
  getPostDetailDto,
  getProfileDto,
  getTaskProposalDto,
  getTaskSubmissionDto,
  getTaskDto,
  parseTaskStatus,
  taskStatusFromLabel,
} from './prismaTransforms.js'
import { serializeAuditEvent, serializeSecurityAlertDispatchEvent, serializeSecurityEvent } from './serializers.js'
import { seedPrismaDatabase } from './prismaSeed.js'
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
import { writeStorageObject } from '../storage/objectWriter.js'
import { writeJsonArchive } from '../storage/archiveWriter.js'

const { Prisma, PrismaClient } = prismaClientPkg
const safeProviderJobIdPattern = /^[a-z0-9][a-z0-9:_-]{0,96}$/i

const stableHash = (value) =>
  createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex')

const safeProviderJobIdEvidence = (value) => {
  if (value == null || value === '') return null
  const normalized = String(value).trim()
  return safeProviderJobIdPattern.test(normalized)
    ? normalized
    : `redacted_${stableHash(value).slice(0, 16)}`
}

import {
  applySecurityAlertDispositions,
  buildSecurityAlertPolicy,
  buildSecurityEventAlerts,
  securityAlertDispositionActions,
  securityAlertSource,
} from '../security/alertPolicy.js'
import { dispatchSecurityAlert } from '../security/alertDispatcher.js'
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
import { safeCreativeCreditMetadata, safeErrorPreview } from '../creative/generationRecords.js'
import {
  buildConsentStatus,
  compliancePolicyManifest,
} from '../compliance/policyManifest.js'

const getHandleFromToken = (token, prefix) => {
  if (typeof token !== 'string' || !token.startsWith(prefix)) {
    return null
  }
  return token.slice(prefix.length)
}

const tokenForHandle = (prefix, handle) => `${prefix}${handle}`
const normalizeEmail = (email) => String(email ?? '').trim().toLowerCase()
const oauthKey = (provider, providerUserId) => ({ provider, providerUserId })

const asObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : null)

const getSupportRequestDto = (review) => {
  const metadata = asObject(review?.metadata) ?? {}
  return {
    id: String(review.id),
    status: review.status,
    category: metadata.category,
    categoryLabel: metadata.categoryLabel,
    subject: review.title,
    details: review.note,
    relatedResourceType: metadata.relatedResourceType,
    relatedResourceId: metadata.relatedResourceId ?? null,
    initialResponseTarget: metadata.initialResponseTarget,
    implementationOwner: metadata.implementationOwner,
    submittedAt: metadata.submittedAt ?? review.createdAt?.toISOString?.() ?? null,
  }
}

const createClient = async () => {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    return null
  }
  const pool = new Pool({ connectionString })
  const adapter = new PrismaPg(pool)
  return new PrismaClient({ adapter })
}

const createPrismaRepository = async (fallbackRepository) => {
  const client = await createClient()
  if (!client) {
    return null
  }

  await seedPrismaDatabase(client)

  const loadRolePermissionMap = async () => {
    const rows = await client.rolePermission.findMany({
      orderBy: [{ role: 'asc' }, { permissionId: 'asc' }],
    })
    const map = new Map()
    for (const row of rows) {
      if (!map.has(row.role)) {
        map.set(row.role, [])
      }
      map.get(row.role).push(row.permissionId)
    }
    return map
  }

  let rolePermissionMap = await loadRolePermissionMap()

  const getDatabasePermissionsForRole = (role) => {
    const databasePermissions = rolePermissionMap.get(role)
    return databasePermissions?.length ? databasePermissions : getPermissionsForRole(role)
  }

  const recordAudit = async ({ actor = null, action, resourceType, resourceId = null, metadata = null }) => {
    await client.auditEvent.create({
      data: buildAuditRecord({
        actorType: actor ? 'user' : 'system',
        actorId: actor?.id ?? null,
        action,
        resourceType,
        resourceId,
        metadata,
      }),
    })
  }

  const leaseExpiry = (ttlSeconds) => new Date(Date.now() + Math.max(1, Number(ttlSeconds ?? 300)) * 1000)

  const getOperationLeaseDto = (lease) => lease ? {
    key: lease.key,
    ownerId: lease.ownerId,
    token: lease.token,
    metadata: asObject(lease.metadata) ?? null,
    acquiredAt: lease.acquiredAt?.toISOString?.() ?? null,
    renewedAt: lease.renewedAt?.toISOString?.() ?? null,
    expiresAt: lease.expiresAt?.toISOString?.() ?? null,
    releasedAt: lease.releasedAt?.toISOString?.() ?? null,
  } : null

  const recordOperationLeaseAudit = async (action, leaseKey, metadata = {}) => {
    await recordAudit({
      action,
      resourceType: 'operation_lease',
      resourceId: leaseKey,
      metadata,
    })
  }

  const operationLeases = {
    acquire: async ({ key, ownerId, ttlSeconds = 300, metadata = null } = {}) => {
      const leaseKey = String(key ?? '').trim()
      if (!leaseKey) {
        throw new Error('Operation lease key is required')
      }
      const holder = String(ownerId ?? '').trim() || `worker-${randomUUID()}`
      const now = new Date()
      const expiresAt = leaseExpiry(ttlSeconds)
      const token = randomUUID()
      const existing = await client.operationLease.findUnique({ where: { key: leaseKey } })
      const recoveredExpired = Boolean(existing && !existing.releasedAt && existing.expiresAt <= now)
      const leaseData = {
        ownerId: holder,
        token,
        metadata,
        acquiredAt: now,
        renewedAt: now,
        expiresAt,
        releasedAt: null,
      }
      const updated = await client.operationLease.updateMany({
        where: {
          key: leaseKey,
          OR: [
            { expiresAt: { lte: now } },
            { releasedAt: { not: null } },
          ],
        },
        data: leaseData,
      })
      if (updated.count === 1) {
        await recordOperationLeaseAudit(recoveredExpired ? 'operations.lease.recovered' : 'operations.lease.acquired', leaseKey, {
          ownerId: holder,
          ttlSeconds,
          expiresAt: expiresAt.toISOString(),
          recoveredExpired,
        })
        return {
          acquired: true,
          recoveredExpired,
          ...getOperationLeaseDto({ key: leaseKey, ...leaseData }),
        }
      }
      if (!existing) {
        try {
          await client.operationLease.create({
            data: {
              key: leaseKey,
              ...leaseData,
            },
          })
          await recordOperationLeaseAudit('operations.lease.acquired', leaseKey, {
            ownerId: holder,
            ttlSeconds,
            expiresAt: expiresAt.toISOString(),
            recoveredExpired: false,
          })
          return {
            acquired: true,
            recoveredExpired: false,
            ...getOperationLeaseDto({ key: leaseKey, ...leaseData }),
          }
        } catch (error) {
          if (error?.code !== 'P2002') {
            throw error
          }
        }
      }
      const current = await client.operationLease.findUnique({ where: { key: leaseKey } })
      await recordOperationLeaseAudit('operations.lease.skipped', leaseKey, {
        ownerId: holder,
        heldBy: current?.ownerId ?? null,
        expiresAt: current?.expiresAt?.toISOString?.() ?? null,
      })
      return {
        acquired: false,
        reason: 'active_lease',
        ownerId: current?.ownerId ?? null,
        expiresAt: current?.expiresAt?.toISOString?.() ?? null,
      }
    },
    renew: async ({ key, token, ttlSeconds = 300 } = {}) => {
      const leaseKey = String(key ?? '').trim()
      const now = new Date()
      const expiresAt = leaseExpiry(ttlSeconds)
      const result = await client.operationLease.updateMany({
        where: {
          key: leaseKey,
          token: String(token ?? ''),
          releasedAt: null,
          expiresAt: { gt: now },
        },
        data: {
          renewedAt: now,
          expiresAt,
        },
      })
      const renewed = result.count === 1
      await recordOperationLeaseAudit(renewed ? 'operations.lease.renewed' : 'operations.lease.renew_failed', leaseKey, {
        ttlSeconds,
        expiresAt: expiresAt.toISOString(),
      })
      return { renewed, key: leaseKey, expiresAt: renewed ? expiresAt.toISOString() : null }
    },
    release: async ({ key, token } = {}) => {
      const leaseKey = String(key ?? '').trim()
      const now = new Date()
      const result = await client.operationLease.updateMany({
        where: {
          key: leaseKey,
          token: String(token ?? ''),
          releasedAt: null,
        },
        data: {
          releasedAt: now,
          expiresAt: now,
        },
      })
      const released = result.count === 1
      await recordOperationLeaseAudit(released ? 'operations.lease.released' : 'operations.lease.release_failed', leaseKey, {
        releasedAt: now.toISOString(),
      })
      return { released, key: leaseKey, releasedAt: released ? now.toISOString() : null }
    },
  }

  const securityEventRecord = (event) => {
    const occurredAt = new Date(event.occurredAt ?? Date.now())
    return {
      id: event.id,
      type: event.type,
      severity: event.severity,
      source: event.source,
      clientKey: event.clientKey ?? null,
      identity: event.identity ?? null,
      method: event.method ?? null,
      pathname: event.pathname ?? null,
      occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
      details: event.details ?? null,
    }
  }

  const settleTaskReward = async (transaction, task, recipientId) => {
    const pointsReward = Number(task.pointsReward) || 0
    if (!recipientId || pointsReward <= 0) {
      return null
    }
    const existing = await transaction.pointLedger.findFirst({
      where: {
        userId: recipientId,
        sourceType: 'task_completion',
        sourceId: String(task.id),
      },
    })
    if (existing) {
      return existing
    }
    const latest = await transaction.pointLedger.findFirst({
      where: { userId: recipientId },
      orderBy: { createdAt: 'desc' },
    })
    return transaction.pointLedger.create({
      data: {
        id: `ledger-task-${task.id}-${recipientId}`,
        userId: recipientId,
        sourceType: 'task_completion',
        sourceId: String(task.id),
        delta: pointsReward,
        balanceAfter: (latest?.balanceAfter ?? 0) + pointsReward,
        status: 'settled',
        description: `Task accepted: ${task.title}`,
        occurredAtLabel: 'Just now',
      },
    })
  }

  const incrementProfileStat = (stats, key, delta) => {
    const current = stats[key]
    if (current === undefined || current === null) {
      return delta
    }
    const numeric = Number(current)
    return Number.isFinite(numeric) ? numeric + delta : current
  }

  const buildProfileStatsUpdate = (stats, deltas) => {
    const nextStats = { ...(asObject(stats) ?? {}) }
    for (const [key, delta] of Object.entries(deltas)) {
      nextStats[key] = incrementProfileStat(nextStats, key, delta)
    }
    return nextStats
  }

  const applyTaskCompletionReputation = async (transaction, task, creatorId) => {
    const updates = [
      { userId: creatorId, deltas: { completed: 1, score: 10 } },
      { userId: task.publisherId, deltas: { completed: 1, score: 6 } },
    ].filter((entry) => entry.userId)

    for (const update of updates) {
      const profile = await transaction.profile.findUnique({
        where: { userId: update.userId },
        select: { userId: true, stats: true },
      })
      if (!profile) {
        continue
      }
      await transaction.profile.update({
        where: { userId: update.userId },
        data: { stats: buildProfileStatsUpdate(profile.stats, update.deltas) },
      })
    }
  }

  const getLatestLedgerBalance = async (transaction, userId) => {
    const latest = await transaction.pointLedger.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })
    return latest?.balanceAfter ?? 0
  }

  const createTaskEscrow = async (transaction, task, publisherId) => {
    const pointsReward = Number(task.pointsReward) || 0
    if (!publisherId || pointsReward <= 0) {
      return null
    }
    const existing = await transaction.pointLedger.findFirst({
      where: {
        userId: publisherId,
        sourceType: 'task_escrow',
        sourceId: String(task.id),
      },
    })
    if (existing) {
      return existing
    }
    const latestBalance = await getLatestLedgerBalance(transaction, publisherId)
    return transaction.pointLedger.create({
      data: {
        id: `ledger-task-escrow-${task.id}-${publisherId}`,
        userId: publisherId,
        sourceType: 'task_escrow',
        sourceId: String(task.id),
        delta: -pointsReward,
        balanceAfter: latestBalance - pointsReward,
        status: 'pending',
        description: `Task reward held: ${task.title}`,
        occurredAtLabel: 'Just now',
      },
    })
  }

  const finalizeTaskEscrow = async (transaction, task, publisherId, decision) => {
    const pointsReward = Number(task.pointsReward) || 0
    if (!publisherId || pointsReward <= 0) {
      return null
    }
    const escrow = await transaction.pointLedger.findFirst({
      where: {
        userId: publisherId,
        sourceType: 'task_escrow',
        sourceId: String(task.id),
      },
    })
    if (!escrow) {
      return null
    }
    await transaction.pointLedger.update({
      where: { id: escrow.id },
      data: { status: decision === 'approve' ? 'settled' : 'cancelled' },
    })
    if (decision === 'approve') {
      return escrow
    }
    const existingRelease = await transaction.pointLedger.findFirst({
      where: {
        userId: publisherId,
        sourceType: 'task_escrow_release',
        sourceId: String(task.id),
      },
    })
    if (existingRelease) {
      return existingRelease
    }
    const latestBalance = await getLatestLedgerBalance(transaction, publisherId)
    return transaction.pointLedger.create({
      data: {
        id: `ledger-task-escrow-release-${task.id}-${publisherId}`,
        userId: publisherId,
        sourceType: 'task_escrow_release',
        sourceId: String(task.id),
        delta: pointsReward,
        balanceAfter: latestBalance + pointsReward,
        status: 'settled',
        description: `Task reward released: ${task.title}`,
        occurredAtLabel: 'Just now',
      },
    })
  }

  const mapAccount = (user) => {
    const profile = buildUserSummary(user)
    return {
      id: user.id,
      handle: profile?.handle ?? user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      permissions: getDatabasePermissionsForRole(user.role),
      profile,
      tokens: {
        accessToken: tokenForHandle('demo-access.', profile?.handle ?? user.id),
        refreshToken: tokenForHandle('demo-refresh.', profile?.handle ?? user.id),
      },
    }
  }

  const getActiveAccessAccount = async (token) => {
    const payload = verifyAccessToken(token)
    if (!payload) {
      return null
    }
    const user = await client.user.findUnique({
      where: { id: payload.sub },
      include: { profile: true },
    })
    return user ? mapAccount(user) : null
  }

  const getSessionDto = (row) => ({
    id: row.id,
    familyId: row.familyId,
    createdAt: row.createdAt?.toISOString?.() ?? null,
    expiresAt: row.expiresAt?.toISOString?.() ?? null,
    revokedAt: row.revokedAt?.toISOString?.() ?? null,
    reuseDetectedAt: row.reuseDetectedAt?.toISOString?.() ?? null,
    active: !row.revokedAt && row.expiresAt > new Date(),
  })

  const createSessionForUser = async (user, reason = 'auth.session.created', options = {}) => {
    const accessToken = createAccessToken(user.id)
    const refreshToken = createOpaqueToken('hcai_refresh')
    await client.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        familyId: options.familyId ?? randomUUID(),
        expiresAt: futureDate(refreshTokenTtlMs),
        revokedAt: null,
      },
    })
    await recordAudit({
      actor: mapAccount(user),
      action: reason,
      resourceType: 'auth_session',
      resourceId: user.id,
      metadata: { refreshTokenStoredAsHash: true },
    })
    return {
      accessToken,
      refreshToken,
      user: mapAccount(user),
    }
  }

  const findUserByHandle = (handle) =>
    client.user.findFirst({
      where: { profile: { handle } },
      include: { profile: true },
    })

  const asDateOrNull = (value) => value ? new Date(value) : null

  const buildCreativeGenerationData = (payload, actorUser = null) => ({
    id: String(payload.id),
    actorId: actorUser?.id ?? null,
    actorHandle: payload.actorHandle ?? actorUser?.profile?.handle ?? null,
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
    usage: payload.usage ?? undefined,
    credit: payload.credit ?? undefined,
    quota: payload.quota ?? undefined,
    safety: payload.safety ?? undefined,
    policy: payload.policy ?? undefined,
    providerRequestId: payload.providerRequestId ?? null,
    providerJobId: payload.providerJobId ?? null,
    retryOfId: payload.retryOfId ?? null,
    attemptNumber: Number(payload.attemptNumber ?? 1),
    errorCode: payload.errorCode ?? null,
    errorMessagePreview: payload.errorMessagePreview ?? null,
    startedAt: asDateOrNull(payload.startedAt),
    completedAt: asDateOrNull(payload.completedAt),
    failedAt: asDateOrNull(payload.failedAt),
    createdAt: payload.createdAt ? new Date(payload.createdAt) : undefined,
  })

  const creativeQuotaWindowId = ({ actorHandle, workspace, windowType, windowStart }) =>
    `${actorHandle ?? 'unknown'}:${workspace}:${windowType}:${windowStart}`

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
      id: window.windowStart.toISOString().slice(0, 10),
      type: window.windowType,
      start: window.windowStart.toISOString(),
      end: window.windowEnd.toISOString(),
      resetsAt: window.windowEnd.toISOString(),
    },
  })

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
    reservedAt: ledger.reservedAt ? ledger.reservedAt.toISOString() : null,
    settledAt: ledger.settledAt ? ledger.settledAt.toISOString() : null,
    refundedAt: ledger.refundedAt ? ledger.refundedAt.toISOString() : null,
    cancelledAt: ledger.cancelledAt ? ledger.cancelledAt.toISOString() : null,
  }) : null

  const findCreativeCreditLedger = (db, reference) => {
    const key = String(reference ?? '')
    if (!key) {
      return null
    }
    return db.creativeCreditLedger.findFirst({
      where: {
        OR: [
          { id: key },
          { generationId: key },
          { quotaReservationId: key },
        ],
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  const uniqueHandles = (handles) => [...new Set(handles.filter(Boolean))]

  const userHandle = (user) => user?.profile?.handle ?? user?.id ?? null

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

  const taskTimelineItem = (event, taskId, actorById = new Map()) => {
    const copy = taskTimelineCopy[event.action] ?? {
      type: event.action.replace(/^task\./, '').replaceAll('.', '_'),
      title: 'Task activity',
      body: event.action,
    }
    const metadata = event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
      ? event.metadata
      : {}
    return {
      id: event.id,
      taskId: String(taskId),
      type: copy.type,
      title: copy.title,
      body: metadata.reviewNote ?? metadata.note ?? copy.body,
      actor: event.actorId ? actorById.get(event.actorId) ?? null : null,
      resourceType: event.resourceType,
      resourceId: event.resourceId ?? null,
      metadata,
      occurredAt: event.createdAt?.toISOString?.() ?? '',
    }
  }

  const createNotificationsForUsers = async (db, users, payload) => {
    const uniqueUsers = [...new Map(users.filter(Boolean).map((user) => [user.id, user])).values()]
    return (await Promise.all(uniqueUsers.map(async (recipient) => {
      if (payload.dedupeUnread) {
        const existing = await db.notification.findFirst({
          where: {
            recipientId: recipient.id,
            type: payload.type,
            resourceType: payload.resourceType,
            resourceId: payload.resourceId ?? null,
            readAt: null,
          },
          select: { id: true },
        })
        if (existing) {
          return null
        }
      }
      return db.notification.create({
        data: {
          id: `notification-${Date.now()}-${Math.random().toString(16).slice(2, 8)}-${recipient.id}`,
          recipientId: recipient.id,
          type: payload.type,
          title: payload.title,
          body: payload.body,
          resourceType: payload.resourceType,
          resourceId: payload.resourceId ?? null,
          metadata: payload.metadata ?? null,
        },
      })
    }))).filter(Boolean)
  }

  const createNotificationsForHandles = async (handles, payload, db = client) => {
    const normalizedHandles = uniqueHandles(handles)
    if (normalizedHandles.length === 0) {
      return []
    }
    const users = await db.user.findMany({
      where: { profile: { handle: { in: normalizedHandles } } },
      include: { profile: true },
    })
    const rows = await createNotificationsForUsers(db, users, payload)
    return rows.map(getNotificationDto)
  }

  const findUsersByPermissions = async (db, requiredPermissions, options = {}) => {
    const rows = await db.user.findMany({
      include: { profile: true },
    })
    return rows.filter((user) => {
      const handle = userHandle(user)
      if (options.excludeHandle && handle === options.excludeHandle) return false
      const account = mapAccount(user)
      return requiredPermissions.every((permission) => hasPermission(account, permission))
    })
  }

  const notifyPointApprovers = async (db, actor, payload) => {
    const users = await findUsersByPermissions(db, ['admin:queue:review', 'points:adjust'], {
      excludeHandle: actor?.handle ?? null,
    })
    return createNotificationsForUsers(db, users, payload)
  }

  const notifyPolicyManagers = async (db, actor, payload) => {
    const users = await findUsersByPermissions(db, ['admin:permissions:manage'], {
      excludeHandle: actor?.handle ?? null,
    })
    return createNotificationsForUsers(db, users, payload)
  }

  const notifyAdminQueueReaders = async (db, actor, payload) => {
    const users = await findUsersByPermissions(db, ['admin:queue:read'], {
      excludeHandle: actor?.handle ?? null,
    })
    return createNotificationsForUsers(db, users, payload)
  }

  const notifyMediaQueueReaders = notifyAdminQueueReaders

  const notifyAuditReaders = async (db, actor, payload) => {
    const users = await findUsersByPermissions(db, ['admin:audit:read'], {
      excludeHandle: actor?.handle ?? null,
    })
    return createNotificationsForUsers(db, users, payload)
  }

  const providerLifecycleRecipientUsers = async (db, actor, payload = {}, notificationPayload = null) => {
    const audience = notificationPayload?.metadata?.audience
    const includeOwner = audience === 'owner' || audience === 'owner_and_operations'
    const includeOperations = audience === 'operations' || audience === 'owner_and_operations'
    const [owner, auditReaders] = await Promise.all([
      includeOwner && payload.actorHandle
        ? db.user.findFirst({ where: { profile: { handle: payload.actorHandle } }, include: { profile: true } })
        : null,
      includeOperations
        ? findUsersByPermissions(db, ['admin:audit:read'], {
          excludeHandle: actor?.handle ?? null,
        })
        : [],
    ])
    return [...new Map([owner, ...auditReaders].filter(Boolean).map((user) => [user.id, user])).values()]
  }

  const createProviderLifecycleNotifications = async (payload = {}, actor = null, db = client) => {
    const notificationPayload = buildProviderLifecycleNotificationPayload(payload)
    if (!notificationPayload) return []
    const recipients = await providerLifecycleRecipientUsers(db, actor, payload, notificationPayload)
    if (recipients.length === 0) {
      return []
    }
    const existing = await db.notification.findMany({
      where: {
        recipientId: { in: recipients.map((recipient) => recipient.id) },
        type: notificationPayload.type,
        resourceType: notificationPayload.resourceType,
        resourceId: notificationPayload.resourceId,
      },
    })
    const existingRecipientIds = new Set(existing
      .filter((notification) => hasProviderLifecycleSourceKey(notification, notificationPayload.metadata.sourceKey))
      .map((notification) => notification.recipientId))
    const missingRecipients = recipients.filter((recipient) => !existingRecipientIds.has(recipient.id))
    return createNotificationsForUsers(db, missingRecipients, notificationPayload)
  }

  const recordProviderLifecycleAudit = async (payload = {}, actor = null, db = client) => {
    const auditPayload = buildProviderLifecycleAuditPayload(payload, actor)
    const existing = await db.auditEvent.findMany({
      where: {
        action: auditPayload.action,
        resourceType: auditPayload.resourceType,
        resourceId: auditPayload.resourceId,
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
    })
    const existingEvent = existing.find((event) => hasProviderLifecycleSourceKey(event, auditPayload.metadata.sourceKey))
    const ensureOperationalNotification = () => {
      if (payload.action === 'creative.provider_lifecycle.side_effect_applied') return Promise.resolve([])
      return createProviderLifecycleNotifications({
        ...payload,
        sourceKey: `${payload.sourceKey}:notification`,
        type: payload.action,
      }, actor, db)
    }
    if (existingEvent) {
      await ensureOperationalNotification()
      return serializeAuditEvent(existingEvent)
    }
    const row = await db.auditEvent.create({
      data: buildAuditRecord({
        actorType: actor ? 'user' : 'system',
        actorId: actor?.id ?? null,
        action: auditPayload.action,
        resourceType: auditPayload.resourceType,
        resourceId: auditPayload.resourceId,
        metadata: auditPayload.metadata,
      }),
    })
    await ensureOperationalNotification()
    return serializeAuditEvent(row)
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

  const makeUniqueProfileHandle = async (email, fallback = 'oauth') => {
    const base = String(email?.split('@')[0] ?? fallback).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || fallback
    let handle = base.length >= 3 ? base : `user_${base}`
    let suffix = 1
    while (await client.profile.findUnique({ where: { handle }, select: { userId: true } })) {
      handle = `${base.slice(0, 24)}${suffix}`
      suffix += 1
    }
    return handle
  }

  const makeStorageKey = (actor, payload, id) =>
    `${actor.handle}/${payload.purpose}/${id}-${payload.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`

  const makeGeneratedStorageKey = (actor, payload, id) =>
    `${actor.handle}/generated/${payload.generation.workspace}/${id}-${payload.artifact.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`

  const makeUploadContract = (asset) => {
    return {
      asset: getMediaAssetDto(asset),
      upload: signMediaUpload(asset),
    }
  }

  const createManualPointAdjustment = async (transaction, user, payload, actor, options = {}) => {
    const sourceId = options.sourceId ?? `adjustment-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    const existing = await transaction.pointLedger.findFirst({
      where: {
        userId: user.id,
        sourceType: 'manual_adjustment',
        sourceId,
      },
      include: { user: { include: { profile: true } } },
    })
    if (existing) {
      return existing
    }
    const latest = await transaction.pointLedger.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    })
    const ledgerEntry = await transaction.pointLedger.create({
      data: {
        id: `ledger-${sourceId}`,
        userId: user.id,
        sourceType: 'manual_adjustment',
        sourceId,
        delta: payload.delta,
        balanceAfter: (latest?.balanceAfter ?? 0) + payload.delta,
        status: 'settled',
        description: `Manual adjustment: ${payload.reason}`,
        occurredAtLabel: 'Just now',
      },
      include: { user: { include: { profile: true } } },
    })
    await transaction.auditEvent.create({
      data: buildAuditRecord({
        actorType: actor ? 'user' : 'system',
        actorId: actor?.id ?? null,
        action: 'points.adjusted',
        resourceType: 'point_ledger',
        resourceId: ledgerEntry.id,
        metadata: {
          userHandle: payload.userHandle,
          delta: payload.delta,
          reason: payload.reason,
          reasonCode: payload.reasonCode ?? null,
          reviewId: options.reviewId ?? null,
        },
      }),
    })
    return ledgerEntry
  }

  const makeDownloadContract = (asset) => ({
    asset: getMediaAssetDto(asset),
    download: signMediaDownload(asset),
  })

  const compactObject = (value) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''))

  const mediaSecurityMetadata = (asset, patch = {}) => {
    const metadata = asObject(asset.metadata) ?? {}
    return {
      ...metadata,
      security: compactObject({
        ...(asObject(metadata.security) ?? {}),
        ...patch,
      }),
    }
  }

  const dateOrNull = (value) => {
    if (!value) return null
    const date = value instanceof Date ? value : new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }

  const assignIfPresent = (target, source, key, transform = (value) => value) => {
    if (Object.hasOwn(source, key)) {
      target[key] = transform(source[key])
    }
  }

  const mediaScanJobStatusFromRow = (job) => {
    if (!job) return null
    if ((job.status === 'queued' || job.status === 'retrying') && job.timeoutAt && job.timeoutAt.getTime() < Date.now()) {
      return 'timed_out'
    }
    return job.status
  }

  const mediaAssetWithScanJob = (asset, job = null) => {
    if (!job) return asset
    return {
      ...asset,
      metadata: mediaSecurityMetadata(asset, {
        scanProvider: job.provider,
        scanStatus: job.scanStatus,
        scanNote: job.note,
        scanRequestedAt: job.requestedAt?.toISOString?.(),
        externalScanId: job.externalScanId,
        scanJobStatus: mediaScanJobStatusFromRow(job),
        scanAttempts: job.attempts,
        scanTimeoutAt: job.timeoutAt?.toISOString?.(),
        nextRetryAt: job.nextRetryAt?.toISOString?.(),
        callbackReceivedAt: job.callbackAt?.toISOString?.(),
        failedAt: job.failedAt?.toISOString?.(),
        rejectionReason: job.rejectionReason,
        scanRequestAdapter: asObject(job.metadata)?.requestAdapter,
        scanDispatchStatus: asObject(job.metadata)?.dispatchStatus,
        scanDispatchStatusCode: asObject(job.metadata)?.dispatchStatusCode,
        scanDispatchError: asObject(job.metadata)?.dispatchError,
        scanDispatchRequestedAt: asObject(job.metadata)?.dispatchRequestedAt,
      }),
    }
  }

  const latestMediaScanJob = async (assetId) => client.mediaScanJob.findFirst({
    where: { assetId },
    orderBy: { createdAt: 'desc' },
  })

  const createMediaScanJob = async (asset, scanResult, overrides = {}) => {
    if (!scanResult?.scanJobStatus) {
      return null
    }
    return client.mediaScanJob.create({
      data: {
        id: `media-scan-job-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        assetId: asset.id,
        provider: overrides.provider ?? scanResult.provider ?? 'webhook',
        status: overrides.status ?? scanResult.scanJobStatus,
        scanStatus: overrides.scanStatus ?? scanResult.status ?? 'scanning',
        externalScanId: overrides.externalScanId ?? scanResult.externalScanId ?? null,
        attempts: overrides.attempts ?? scanResult.scanAttempts ?? 1,
        requestedAt: dateOrNull(overrides.requestedAt ?? scanResult.requestedAt),
        timeoutAt: dateOrNull(overrides.timeoutAt ?? scanResult.scanTimeoutAt),
        nextRetryAt: dateOrNull(overrides.nextRetryAt ?? scanResult.nextRetryAt),
        note: overrides.note ?? scanResult.note ?? null,
        rejectionReason: overrides.rejectionReason ?? scanResult.reason ?? null,
        metadata: overrides.metadata ?? compactObject({
          requestAdapter: scanResult.requestAdapter,
          dispatchStatus: scanResult.dispatchStatus,
          dispatchStatusCode: scanResult.dispatchStatusCode,
          dispatchError: scanResult.dispatchError,
          dispatchRequestedAt: scanResult.dispatchRequestedAt,
        }),
      },
    })
  }

  const updateLatestMediaScanJob = async (asset, patch = {}) => {
    const job = patch.externalScanId
      ? await client.mediaScanJob.findFirst({
          where: {
            assetId: asset.id,
            externalScanId: String(patch.externalScanId),
          },
          orderBy: { createdAt: 'desc' },
        })
      : await latestMediaScanJob(asset.id)
    if (!job) {
      return null
    }
    const data = {}
    assignIfPresent(data, patch, 'provider')
    assignIfPresent(data, patch, 'status')
    assignIfPresent(data, patch, 'scanStatus')
    assignIfPresent(data, patch, 'externalScanId')
    assignIfPresent(data, patch, 'attempts')
    assignIfPresent(data, patch, 'requestedAt', dateOrNull)
    assignIfPresent(data, patch, 'timeoutAt', dateOrNull)
    assignIfPresent(data, patch, 'nextRetryAt', dateOrNull)
    assignIfPresent(data, patch, 'callbackAt', dateOrNull)
    assignIfPresent(data, patch, 'failedAt', dateOrNull)
    assignIfPresent(data, patch, 'reviewedById')
    assignIfPresent(data, patch, 'reviewedAt', dateOrNull)
    assignIfPresent(data, patch, 'note')
    assignIfPresent(data, patch, 'rejectionReason')
    assignIfPresent(data, patch, 'metadata')
    return client.mediaScanJob.update({
      where: { id: job.id },
      data,
    })
  }

  const updateMediaScanJob = async (jobId, patch = {}) => {
    const data = {}
    assignIfPresent(data, patch, 'provider')
    assignIfPresent(data, patch, 'status')
    assignIfPresent(data, patch, 'scanStatus')
    assignIfPresent(data, patch, 'externalScanId')
    assignIfPresent(data, patch, 'attempts')
    assignIfPresent(data, patch, 'requestedAt', dateOrNull)
    assignIfPresent(data, patch, 'timeoutAt', dateOrNull)
    assignIfPresent(data, patch, 'nextRetryAt', dateOrNull)
    assignIfPresent(data, patch, 'callbackAt', dateOrNull)
    assignIfPresent(data, patch, 'failedAt', dateOrNull)
    assignIfPresent(data, patch, 'reviewedById')
    assignIfPresent(data, patch, 'reviewedAt', dateOrNull)
    assignIfPresent(data, patch, 'note')
    assignIfPresent(data, patch, 'rejectionReason')
    assignIfPresent(data, patch, 'metadata')
    return client.mediaScanJob.update({
      where: { id: jobId },
      data,
    })
  }

  const mediaScanAlertDispositionActions = [
    'media.scan.alert.acknowledged',
    'media.scan.alert.silenced',
    'media.scan.alert.unsilenced',
  ]

  const applyMediaScanAlertDispositions = (alerts, dispositionEvents = []) => {
    const now = Date.now()
    return alerts.map((alert) => {
      const events = dispositionEvents
        .filter((event) => event.resourceId === alert.id)
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      const acknowledged = events.find((event) => event.action === 'media.scan.alert.acknowledged') ?? null
      const silenced = events.find((event) => event.action === 'media.scan.alert.silenced') ?? null
      const unsilenced = events.find((event) => event.action === 'media.scan.alert.unsilenced') ?? null
      const acknowledgedMetadata = asObject(acknowledged?.metadata) ?? {}
      const silenceMetadata = asObject(silenced?.metadata) ?? {}
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
        acknowledgedAt: acknowledged?.createdAt?.toISOString?.() ?? null,
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
    policy,
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
        recentResourceIds: dispatchFailures.map((job) => job.assetId).filter(Boolean).slice(0, 5),
        recentExternalScanIds: dispatchFailures.map((job) => job.externalScanId).filter(Boolean).slice(0, 5),
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
        recentChannels: [...new Set(alertDeliveryFailures.map((event) => asObject(event.metadata)?.channel).filter(Boolean))].slice(0, 5),
      },
    })
    return alerts
  }

  const getPrismaMediaScanAlerts = async () => {
    const policy = await getMediaGovernancePolicy()
    const since = new Date(Date.now() - policy.alerts.windowMinutes * 60 * 1000)
    const [callbackDeniedEvents, timeoutEvents, alertDeliveryFailures, dispositionEvents, recentJobs] = await Promise.all([
      client.auditEvent.findMany({
        where: {
          action: 'media.scan.callback_denied',
          createdAt: { gte: since },
        },
        orderBy: { createdAt: 'desc' },
      }),
      client.auditEvent.findMany({
        where: {
          action: 'media.scan.timeout',
          createdAt: { gte: since },
        },
        orderBy: { createdAt: 'desc' },
      }),
      client.auditEvent.findMany({
        where: {
          action: 'media.scan.alert.dispatch',
          createdAt: { gte: since },
        },
        orderBy: { createdAt: 'desc' },
      }),
      client.auditEvent.findMany({
        where: {
          resourceType: 'media_scan_alert',
          action: { in: mediaScanAlertDispositionActions },
        },
        orderBy: { createdAt: 'desc' },
      }),
      client.mediaScanJob.findMany({
        where: { updatedAt: { gte: since } },
        orderBy: { updatedAt: 'desc' },
      }),
    ])
    return applyMediaScanAlertDispositions(buildMediaScanAlerts({
      callbackDeniedEvents,
      timeoutEvents,
      dispatchFailures: recentJobs.filter((job) => asObject(job.metadata)?.dispatchStatus === 'failed'),
      alertDeliveryFailures: alertDeliveryFailures.filter((event) => asObject(event.metadata)?.status === 'failed'),
      policy,
    }), dispositionEvents)
  }

  const recordMediaScanAlertDisposition = async (id, disposition, payload, actor) => {
    const alert = (await getPrismaMediaScanAlerts()).find((item) => item.id === String(id))
    if (!alert) {
      return null
    }
    await recordAudit({
      actor,
      action: `media.scan.alert.${disposition}`,
      resourceType: 'media_scan_alert',
      resourceId: alert.id,
      metadata: {
        alertType: alert.type,
        severity: alert.severity,
        note: payload.note ?? '',
        actorHandle: actor?.handle ?? null,
        ...(payload.silencedUntil ? { silencedUntil: payload.silencedUntil } : {}),
      },
    })
    return (await getPrismaMediaScanAlerts()).find((item) => item.id === alert.id) ?? null
  }

  const auditEventDto = (event) => ({
    id: event.id,
    actorType: event.actorType,
    actorId: event.actorId ?? null,
    action: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId ?? null,
    metadata: event.metadata ?? null,
    createdAt: event.createdAt?.toISOString?.() ?? '',
  })

  const getPrismaMediaScanAlertEvents = async (id, options = {}) => {
    const alert = (await getPrismaMediaScanAlerts()).find((item) => item.id === String(id))
    if (!alert) {
      return null
    }
    const limit = Math.min(Math.max(Number.parseInt(options.limit ?? 5, 10) || 5, 1), 20)
    const policy = await getMediaGovernancePolicy()
    const since = new Date(Date.now() - policy.alerts.windowMinutes * 60 * 1000)
    if (alert.type === 'media.scan.callback_denied.spike') {
      const rows = await client.auditEvent.findMany({
        where: { action: 'media.scan.callback_denied', createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: limit,
      })
      return rows.map(auditEventDto)
    }
    if (alert.type === 'media.scan.timeout.spike') {
      const rows = await client.auditEvent.findMany({
        where: { action: 'media.scan.timeout', createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: limit,
      })
      return rows.map(auditEventDto)
    }
    if (alert.type === 'media.scan.alert_delivery_failed.spike') {
      const rows = await client.auditEvent.findMany({
        where: { action: 'media.scan.alert.dispatch', createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
      return rows
        .filter((event) => asObject(event.metadata)?.status === 'failed')
        .slice(0, limit)
        .map(auditEventDto)
    }
    if (alert.type === 'media.scan.dispatch_failed.spike') {
      const rows = await client.mediaScanJob.findMany({
        where: { updatedAt: { gte: since } },
        orderBy: { updatedAt: 'desc' },
        take: 50,
      })
      return rows
        .filter((job) => asObject(job.metadata)?.dispatchStatus === 'failed')
        .slice(0, limit)
        .map((job) => {
          const metadata = asObject(job.metadata) ?? {}
          return {
            id: `media-scan-dispatch-failure-${job.id}`,
            actorType: 'system',
            actorId: null,
            action: 'media.scan.dispatch_failed',
            resourceType: 'media_asset',
            resourceId: job.assetId,
            metadata: {
              jobId: job.id,
              externalScanId: job.externalScanId ?? null,
              provider: job.provider,
              attempts: job.attempts,
              dispatchStatus: metadata.dispatchStatus ?? null,
              dispatchStatusCode: metadata.dispatchStatusCode ?? null,
              dispatchError: metadata.dispatchError ?? null,
            },
            createdAt: job.updatedAt?.toISOString?.() ?? '',
          }
        })
    }
    return []
  }

  const notifyMediaScanAlerts = async (db, actor) => {
    const alerts = await getPrismaMediaScanAlerts()
    const created = []
    for (const alert of alerts) {
      if (alert.state === 'silenced') {
        continue
      }
      const notificationsCreated = await notifyMediaQueueReaders(db, actor, mediaScanAlertNotification(alert))
      created.push(...notificationsCreated)
      if (notificationsCreated.length > 0) {
        const dispatches = await dispatchMediaScanAlert(alert)
        for (const dispatch of dispatches) {
          await recordAudit({
            actor,
            action: 'media.scan.alert.dispatch',
            resourceType: 'media_scan_alert',
            resourceId: alert.id,
            metadata: {
              alertType: alert.type,
              severity: alert.severity,
              channel: dispatch.channel,
              status: dispatch.status,
              statusCode: dispatch.statusCode ?? null,
              error: dispatch.error ?? null,
            },
          })
        }
      }
    }
    return created
  }

  const pruneMediaScanJobHistory = async (actor = null, policy = null) => {
    const effectivePolicy = policy ?? await getMediaGovernancePolicy()
    const retentionDays = effectivePolicy.retention.historyRetentionDays
    const maxPerAsset = effectivePolicy.retention.historyRetentionMaxPerAsset
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
    const inactiveWhere = { status: { notIn: ['queued', 'retrying'] } }
    const idsToDelete = new Set()
    const oldRows = await client.mediaScanJob.findMany({
      where: {
        ...inactiveWhere,
        createdAt: { lt: cutoff },
      },
      select: { id: true },
    })
    oldRows.forEach((row) => idsToDelete.add(row.id))
    const historyRows = await client.mediaScanJob.findMany({
      where: inactiveWhere,
      select: { id: true, assetId: true },
      orderBy: [{ assetId: 'asc' }, { createdAt: 'desc' }],
    })
    const seenByAsset = new Map()
    for (const row of historyRows) {
      const seen = seenByAsset.get(row.assetId) ?? 0
      if (seen >= maxPerAsset) {
        idsToDelete.add(row.id)
      }
      seenByAsset.set(row.assetId, seen + 1)
    }
    const retention = {
      days: retentionDays,
      maxPerAsset,
      cutoff: cutoff.toISOString(),
    }
    if (idsToDelete.size === 0) {
      return { pruned: 0, retention }
    }
    const result = await client.mediaScanJob.deleteMany({
      where: { id: { in: [...idsToDelete] } },
    })
    await recordAudit({
      actor,
      action: 'media.scan.history_pruned',
      resourceType: 'media_scan_jobs',
      metadata: {
        pruned: result.count,
        retentionDays,
        maxPerAsset,
        cutoff: retention.cutoff,
      },
    })
    return { pruned: result.count, retention }
  }

  const exportMediaScanJobArchive = async (options = {}) => {
    const policy = await getMediaGovernancePolicy()
    const retentionDays = policy.retention.historyRetentionDays
    const maxPerAsset = policy.retention.historyRetentionMaxPerAsset
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
    const inactiveWhere = { status: { notIn: ['queued', 'retrying'] } }
    const limit = options.limit ?? 100
    const cursor = options.cursor
      ? await client.mediaScanJob.findUnique({ where: { id: String(options.cursor) }, select: { id: true } })
      : null
    const oldRows = await client.mediaScanJob.findMany({
      where: {
        ...inactiveWhere,
        createdAt: { lt: cutoff },
      },
      select: { id: true },
    })
    const candidateReasons = new Map(oldRows.map((row) => [row.id, ['age']]))
    const historyRows = await client.mediaScanJob.findMany({
      where: inactiveWhere,
      select: { id: true, assetId: true },
      orderBy: [{ assetId: 'asc' }, { createdAt: 'desc' }],
    })
    const seenByAsset = new Map()
    for (const row of historyRows) {
      const seen = seenByAsset.get(row.assetId) ?? 0
      if (seen >= maxPerAsset) {
        candidateReasons.set(row.id, [...(candidateReasons.get(row.id) ?? []), 'count'])
      }
      seenByAsset.set(row.assetId, seen + 1)
    }
    const candidateIds = [...candidateReasons.keys()]
    const rows = candidateIds.length > 0
      ? await client.mediaScanJob.findMany({
          where: { id: { in: candidateIds } },
          include: {
            asset: {
              select: {
                id: true,
                fileName: true,
                storageKey: true,
                contentType: true,
                purpose: true,
                status: true,
                ownerId: true,
              },
            },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: limit + 1,
          ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
        })
      : []
    const pageRows = rows.slice(0, limit)
    return {
      exportedAt: new Date().toISOString(),
      mode: 'candidate_manifest',
      retention: {
        days: retentionDays,
        maxPerAsset,
        cutoff: cutoff.toISOString(),
      },
      deleteBoundary: {
        inactiveStatuses: ['completed', 'failed'],
        activeStatusesRetained: ['queued', 'retrying', 'timed_out'],
        prunedByAge: `createdAt older than ${retentionDays} days`,
        prunedByCount: `inactive jobs beyond newest ${maxPerAsset} per asset`,
      },
      count: pageRows.length,
      totalCandidates: candidateIds.length,
      limit,
      nextCursor: rows.length > limit && pageRows.length > 0 ? pageRows[pageRows.length - 1].id : null,
      items: pageRows.map((job) => ({
        ...getMediaScanJobDto(job),
        archiveReasons: candidateReasons.get(job.id) ?? [],
        asset: job.asset,
      })),
    }
  }

  const archiveMediaScanJobHistory = async (options = {}, actor = null) => {
    const manifest = await exportMediaScanJobArchive(options)
    const storage = await writeJsonArchive(manifest)
    await recordAudit({
      actor,
      action: 'media.scan.history_archived',
      resourceType: 'media_scan_jobs',
      metadata: {
        storageKey: storage.storageKey,
        provider: storage.provider,
        count: manifest.count,
        totalCandidates: manifest.totalCandidates ?? manifest.count,
        bytes: storage.bytes,
        statusCode: storage.statusCode ?? null,
      },
    })
    return {
      ...manifest,
      storage,
    }
  }

  const mediaAssetScanStatus = (asset) => asObject(asObject(asset.metadata)?.security)?.scanStatus ?? 'pending'

  const auth = {
    getCurrentUser: async () => {
      const user = await client.user.findFirst({
        orderBy: { createdAt: 'asc' },
        include: { profile: true },
      })
      return user ? mapAccount(user) : fallbackRepository.auth.getCurrentUser()
    },
    findDemoAccountByAccessToken: async (token) => {
      const activeAccount = await getActiveAccessAccount(token)
      if (activeAccount) {
        return activeAccount
      }
      const fallback = fallbackRepository.auth.findDemoAccountByAccessToken(token)
      if (fallback) {
        return fallback
      }
      const handle = getHandleFromToken(token, 'demo-access.')
      if (!handle) {
        return null
      }
      const user = await client.user.findFirst({
        where: { profile: { handle } },
        include: { profile: true },
      })
      return user ? mapAccount(user) : null
    },
    findDemoAccountByRefreshToken: async (token) => {
      const fallback = fallbackRepository.auth.findDemoAccountByRefreshToken(token)
      if (fallback) {
        return fallback
      }
      const tokenHash = hashToken(token)
      const refreshToken = await client.refreshToken.findFirst({
        where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
        include: { user: { include: { profile: true } } },
      })
      return refreshToken ? mapAccount(refreshToken.user) : null
    },
    findDemoAccountByHandle: async (handle) => {
      const fallback = fallbackRepository.auth.findDemoAccountByHandle(handle)
      if (fallback) {
        return fallback
      }
      const user = await client.user.findFirst({
        where: { profile: { handle } },
        include: { profile: true },
      })
      return user ? mapAccount(user) : null
    },
    listDemoAccounts: async () => {
      const users = await client.user.findMany({
        include: { profile: true },
        orderBy: { createdAt: 'asc' },
      })
      return users.map(mapAccount)
    },
    issueSession: async (account) => {
      const user = await client.user.findFirst({
        where: { profile: { handle: account.handle } },
        include: { profile: true },
      })
      if (!user) {
        return null
      }
      return createSessionForUser(user, 'auth.session.created')
    },
    registerEmailAccount: async ({ email, password, displayName, handle }, consent = null) => {
      const normalizedEmail = normalizeEmail(email)
      const existing = await client.user.findFirst({
        where: {
          OR: [
            { email: normalizedEmail },
            { profile: { handle } },
            { authAccounts: { some: { provider: 'email', providerUserId: normalizedEmail } } },
          ],
        },
        select: { id: true },
      })
      if (existing) {
        return null
      }

      const passwordHash = await hashPassword(password)
      const user = await client.$transaction(async (transaction) => {
        const createdUser = await transaction.user.create({
          data: {
            email: normalizedEmail,
            displayName,
            role: 'member',
            status: 'active',
            profile: {
              create: {
                handle,
                lane: 'both',
                skills: [],
                languages: [],
                portfolio: {},
                stats: {},
                metadata: {},
              },
            },
            authAccounts: {
              create: {
                provider: 'email',
                providerUserId: normalizedEmail,
                passwordHash,
              },
            },
          },
          include: { profile: true },
        })
        await transaction.auditEvent.create({
          data: buildAuditRecord({
            actorType: 'user',
            actorId: createdUser.id,
            action: 'auth.account.registered',
            resourceType: 'user',
            resourceId: createdUser.id,
            metadata: { provider: 'email' },
          }),
        })
        if (consent) {
          const record = { ...consent, acceptedAt: new Date().toISOString() }
          await transaction.auditEvent.create({
            data: buildAuditRecord({
              actorType: 'user',
              actorId: createdUser.id,
              action: compliancePolicyManifest.consentContract.recordAction,
              resourceType: compliancePolicyManifest.consentContract.recordResourceType,
              resourceId: createdUser.id,
              metadata: record,
            }),
          })
        }
        return createdUser
      })
      return createSessionForUser(user, 'auth.session.created')
    },
    loginWithPassword: async ({ email, password }) => {
      const authAccount = await client.authAccount.findUnique({
        where: { provider_providerUserId: { provider: 'email', providerUserId: normalizeEmail(email) } },
        include: { user: { include: { profile: true } } },
      })
      if (
        !authAccount?.passwordHash ||
        authAccount.user?.status !== 'active' ||
        !(await verifyPassword(password, authAccount.passwordHash))
      ) {
        return null
      }
      return createSessionForUser(authAccount.user, 'auth.session.created')
    },
    completeOAuthLogin: async ({ profile, linkUserId = null }) => {
      const normalizedEmail = normalizeEmail(profile.email)
      const providerWhere = {
        provider_providerUserId: oauthKey(profile.provider, profile.providerUserId),
      }
      const linkedAccount = await client.authAccount.findUnique({
        where: providerWhere,
        include: { user: { include: { profile: true } } },
      })

      if (linkUserId) {
        if (linkedAccount && linkedAccount.userId !== linkUserId) {
          return null
        }
        const user = await client.user.findUnique({
          where: { id: linkUserId },
          include: { profile: true },
        })
        if (!user) {
          return null
        }
        if (!linkedAccount) {
          await client.authAccount.create({
            data: {
              userId: user.id,
              provider: profile.provider,
              providerUserId: profile.providerUserId,
              passwordHash: null,
            },
          })
        }
        await recordAudit({
          actor: mapAccount(user),
          action: 'auth.oauth.linked',
          resourceType: 'auth_account',
          resourceId: `${profile.provider}:${profile.providerUserId}`,
          metadata: { provider: profile.provider },
        })
        return createSessionForUser(user, 'auth.session.created')
      }

      if (linkedAccount) {
        return linkedAccount.user?.status === 'active' ? createSessionForUser(linkedAccount.user, 'auth.session.created') : null
      }

      const existingUser = await client.user.findUnique({
        where: { email: normalizedEmail },
        include: { profile: true },
      })
      if (existingUser) {
        await client.authAccount.create({
          data: {
            userId: existingUser.id,
            provider: profile.provider,
            providerUserId: profile.providerUserId,
            passwordHash: null,
          },
        })
        await recordAudit({
          actor: mapAccount(existingUser),
          action: 'auth.oauth.linked',
          resourceType: 'auth_account',
          resourceId: `${profile.provider}:${profile.providerUserId}`,
          metadata: { provider: profile.provider },
        })
        return createSessionForUser(existingUser, 'auth.session.created')
      }

      const handle = await makeUniqueProfileHandle(normalizedEmail, profile.provider)
      const user = await client.user.create({
        data: {
          email: normalizedEmail,
          displayName: profile.displayName,
          role: 'member',
          status: 'active',
          profile: {
            create: {
              handle,
              lane: 'both',
              skills: [],
              languages: [],
              portfolio: {},
              stats: {},
              metadata: {},
            },
          },
          authAccounts: {
            create: {
              provider: profile.provider,
              providerUserId: profile.providerUserId,
              passwordHash: null,
            },
          },
        },
        include: { profile: true },
      })
      await recordAudit({
        actor: mapAccount(user),
        action: 'auth.oauth.registered',
        resourceType: 'user',
        resourceId: user.id,
        metadata: { provider: profile.provider },
      })
      return createSessionForUser(user, 'auth.session.created')
    },
    listOAuthAccounts: async (actor) => {
      const accounts = await client.authAccount.findMany({
        where: {
          userId: actor.id,
          provider: { not: 'email' },
        },
        orderBy: { provider: 'asc' },
      })
      return accounts.map((account) => ({
        provider: account.provider,
        providerUserId: account.providerUserId,
      }))
    },
    unlinkOAuthAccount: async (provider, actor) => {
      const account = await client.authAccount.findFirst({
        where: {
          userId: actor.id,
          provider,
          NOT: { provider: 'email' },
        },
      })
      if (!account) {
        return null
      }
      const authMethodCount = await client.authAccount.count({
        where: { userId: actor.id },
      })
      if (authMethodCount <= 1) {
        return { blocked: true }
      }
      await client.authAccount.delete({ where: { id: account.id } })
      await recordAudit({
        actor,
        action: 'auth.oauth.unlinked',
        resourceType: 'auth_account',
        resourceId: `${account.provider}:${account.providerUserId}`,
        metadata: { provider: account.provider },
      })
      return { unlinked: true }
    },
    rotateSession: async (token) => {
      const tokenHash = hashToken(token)
      const refreshToken = await client.refreshToken.findFirst({
        where: { tokenHash },
        include: { user: { include: { profile: true } } },
      })
      if (!refreshToken) {
        return null
      }
      if (refreshToken.revokedAt || refreshToken.expiresAt <= new Date()) {
        if (refreshToken.revokedAt && refreshToken.replacedByTokenHash) {
          const now = new Date()
          await client.refreshToken.updateMany({
            where: { userId: refreshToken.userId, familyId: refreshToken.familyId, revokedAt: null },
            data: { revokedAt: now, reuseDetectedAt: now },
          })
          await recordAudit({
            actor: mapAccount(refreshToken.user),
            action: 'auth.session.reuse_detected',
            resourceType: 'auth_session',
            resourceId: refreshToken.id,
            metadata: { familyId: refreshToken.familyId },
          })
        }
        return null
      }
      const user = refreshToken.user
      const session = user ? await createSessionForUser(user, 'auth.session.rotated', { familyId: refreshToken.familyId }) : null
      if (!session) {
        return null
      }
      await client.refreshToken.update({
        where: { id: refreshToken.id },
        data: {
          revokedAt: new Date(),
          replacedByTokenHash: hashToken(session.refreshToken),
        },
      })
      return session
    },
    revokeSession: async (token) => {
      const refreshToken = await client.refreshToken.findFirst({
        where: { tokenHash: hashToken(token), revokedAt: null },
      })
      if (!refreshToken) {
        return false
      }
      await client.refreshToken.update({
        where: { id: refreshToken.id },
        data: { revokedAt: new Date() },
      })
      return true
    },
    listSessions: async (actor) => {
      const rows = await client.refreshToken.findMany({
        where: { userId: actor.id },
        orderBy: { createdAt: 'desc' },
      })
      return rows.map(getSessionDto)
    },
    revokeSessionById: async (id, actor) => {
      const result = await client.refreshToken.updateMany({
        where: { id, userId: actor.id, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      return result.count > 0
    },
    revokeAllSessions: async (actor) => {
      const result = await client.refreshToken.updateMany({
        where: { userId: actor.id, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      return { revoked: result.count }
    },
  }

  const compliance = {
    getConsentStatus: async (actor) => {
      const event = await client.auditEvent.findFirst({
        where: {
          actorId: actor.id,
          action: compliancePolicyManifest.consentContract.recordAction,
          resourceType: compliancePolicyManifest.consentContract.recordResourceType,
        },
        orderBy: { createdAt: 'desc' },
      })
      const metadata = asObject(event?.metadata)
      return buildConsentStatus(metadata ? {
        ...metadata,
        acceptedAt: metadata.acceptedAt ?? event.createdAt.toISOString(),
      } : null)
    },
    recordConsent: async (actor, consent) => {
      const current = await compliance.getConsentStatus(actor)
      if (current.current) {
        return current
      }
      const acceptedAt = new Date().toISOString()
      const record = { ...consent, acceptedAt }
      await client.auditEvent.create({
        data: buildAuditRecord({
          actorType: 'user',
          actorId: actor.id,
          action: compliancePolicyManifest.consentContract.recordAction,
          resourceType: compliancePolicyManifest.consentContract.recordResourceType,
          resourceId: actor.id,
          metadata: record,
        }),
      })
      return buildConsentStatus(record)
    },
  }

  const tasks = {
    list: async (options = {}) => {
      const limit = options.limit ?? 20
      const cursor = options.cursor
        ? await client.task.findUnique({ where: { id: String(options.cursor) }, select: { id: true } })
        : null
      const rows = await client.task.findMany({
        where: {
          ...(options.status ? { status: parseTaskStatus(options.status) } : {}),
          ...(options.category ? { category: options.category } : {}),
          ...(options.search ? {
            OR: [
              { title: { contains: options.search, mode: 'insensitive' } },
              { description: { contains: options.search, mode: 'insensitive' } },
              { category: { contains: options.search, mode: 'insensitive' } },
            ],
          } : {}),
        },
        include: {
          publisher: { include: { profile: true } },
          assignee: { include: { profile: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
      })
      const pageRows = rows.slice(0, limit)
      return {
        items: pageRows.map(getTaskDto),
        nextCursor: rows.length > limit && pageRows.length > 0 ? pageRows[pageRows.length - 1].id : null,
        limit,
      }
    },
    findById: async (id) => {
      const row = await client.task.findUnique({
        where: { id: String(id) },
        include: {
          publisher: { include: { profile: true } },
          assignee: { include: { profile: true } },
        },
      })
      return row ? getTaskDto(row) : null
    },
    create: async (payload, actor) => {
      const publisher = await client.user.findFirst({
        where: { profile: { handle: actor.handle } },
        include: { profile: true },
      })
      if (!publisher) {
        return null
      }
      const taskId = `task-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
      const row = await client.$transaction(async (transaction) => {
        const createdTask = await transaction.task.create({
          data: buildTaskRecord(
            {
              id: taskId,
              title: payload.title,
              category: payload.category,
              status: 'Open',
              budget: payload.rewardAmount ? `${payload.rewardCurrency ?? '$'}${payload.rewardAmount}` : `${payload.pointsReward} pts`,
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
            },
            { id: publisher.id },
            null,
          ),
        })
        await createTaskEscrow(transaction, createdTask, publisher.id)
        return createdTask
      })
      await recordAudit({
        actor,
        action: 'task.created',
        resourceType: 'task',
        resourceId: row.id,
        metadata: { status: 'open', category: payload.category },
      })
      const reloaded = await client.task.findUnique({
        where: { id: row.id },
        include: {
          publisher: { include: { profile: true } },
          assignee: { include: { profile: true } },
        },
      })
      return reloaded ? getTaskDto(reloaded) : null
    },
    claim: async (id, actor) => {
      const assignee = await findUserByHandle(actor.handle)
      if (!assignee) {
        return null
      }
      const row = await client.task.update({
        where: { id: String(id) },
        data: {
          status: taskStatusFromLabel('In Progress'),
          assigneeId: assignee.id,
        },
        include: {
          publisher: { include: { profile: true } },
          assignee: { include: { profile: true } },
        },
      })
      await recordAudit({
        actor,
        action: 'task.claimed',
        resourceType: 'task',
        resourceId: row.id,
        metadata: { status: row.status },
      })
      return getTaskDto(row)
    },
    createProposal: async (id, payload, actor) => {
      const task = await client.task.findUnique({
        where: { id: String(id) },
        include: {
          publisher: { include: { profile: true } },
          assignee: { include: { profile: true } },
        },
      })
      if (!task) {
        return null
      }
      const proposer = await findUserByHandle(actor.handle)
      if (!proposer) {
        return null
      }
      const proposal = await client.taskProposal.create({
        data: {
          id: `proposal-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
          taskId: String(id),
          proposerId: proposer.id,
          coverLetter: payload.coverLetter,
          estimate: payload.estimate,
          status: 'pending',
        },
        include: { proposer: { include: { profile: true } } },
      })
      const taskDto = getTaskDto(task)
      await client.task.update({
        where: { id: String(id) },
        data: {
          metadata: {
            ...taskDto,
            proposals: (Number(taskDto.proposals) || 0) + 1,
          },
        },
      })
      await recordAudit({
        actor,
        action: 'task.proposal.created',
        resourceType: 'task',
        resourceId: String(id),
        metadata: { proposalId: proposal.id },
      })
      await createNotificationsForHandles([task.publisher?.profile?.handle ?? task.publisher?.id ?? null], {
        type: 'task.proposal_submitted',
        title: `Proposal submitted: ${task.title}`,
        body: `${actor.handle} submitted a proposal for ${task.title}.`,
        resourceType: 'task',
        resourceId: String(id),
        metadata: { taskId: String(id), proposalId: proposal.id, proposerHandle: actor.handle, target: taskNotificationTarget('mine') },
      })
      return getTaskProposalDto(proposal)
    },
    listProposals: async (id, actor, options = {}) => {
      const task = await client.task.findUnique({
        where: { id: String(id) },
        include: { publisher: { include: { profile: true } } },
      })
      if (!task) {
        return null
      }
      const publisherHandle = task.publisher?.profile?.handle ?? task.publisher?.id ?? null
      const canViewAll = publisherHandle === actor.handle || hasPermission(actor, 'admin:access')
      const viewer = canViewAll ? null : await findUserByHandle(actor.handle)
      if (!canViewAll && !viewer) {
        return null
      }
      const limit = options.limit ?? 20
      const cursor = options.cursor
        ? await client.taskProposal.findUnique({ where: { id: String(options.cursor) }, select: { id: true } })
        : null
      const rows = await client.taskProposal.findMany({
        where: {
          taskId: String(id),
          ...(canViewAll ? {} : { proposerId: viewer.id }),
        },
        include: { proposer: { include: { profile: true } } },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
      })
      const pageRows = rows.slice(0, limit)
      return {
        items: pageRows.map(getTaskProposalDto),
        nextCursor: rows.length > limit && pageRows.length > 0 ? pageRows[pageRows.length - 1].id : null,
        limit,
      }
    },
    reviewProposal: async (id, proposalId, payload, actor) => {
      const proposal = await client.taskProposal.findUnique({
        where: { id: String(proposalId) },
        include: {
          task: {
            include: {
              publisher: { include: { profile: true } },
              assignee: { include: { profile: true } },
            },
          },
          proposer: { include: { profile: true } },
        },
      })
      if (!proposal || proposal.taskId !== String(id)) {
        return null
      }
      const publisherHandle = proposal.task.publisher?.profile?.handle ?? proposal.task.publisher?.id ?? null
      if (publisherHandle && publisherHandle !== actor.handle && !hasPermission(actor, 'admin:access')) {
        return null
      }
      const proposalStatus = payload.decision === 'accept' ? 'accepted' : 'rejected'
      let autoRejectedProposerHandles = []
      const updatedProposal = await client.$transaction(async (transaction) => {
        const updated = await transaction.taskProposal.update({
          where: { id: proposal.id },
          data: {
            status: proposalStatus,
            metadata: {
              ...(asObject(proposal.metadata) ?? {}),
              decisionNote: payload.note ?? '',
            },
          },
          include: { proposer: { include: { profile: true } } },
        })
        if (payload.decision === 'accept') {
          const autoRejectedProposals = await transaction.taskProposal.findMany({
            where: {
              taskId: String(id),
              id: { not: proposal.id },
              status: 'pending',
            },
            include: { proposer: { include: { profile: true } } },
          })
          autoRejectedProposerHandles = autoRejectedProposals.map((entry) => userHandle(entry.proposer))
          const taskDto = getTaskDto(proposal.task)
          await transaction.task.update({
            where: { id: String(id) },
            data: {
              status: taskStatusFromLabel('In Progress'),
              assigneeId: proposal.proposerId,
              metadata: {
                ...taskDto,
                status: 'In Progress',
                assignee: proposal.proposer.profile?.handle ?? proposal.proposer.id,
              },
            },
          })
          await transaction.taskProposal.updateMany({
            where: {
              taskId: String(id),
              id: { not: proposal.id },
              status: 'pending',
            },
            data: {
              status: 'rejected',
              metadata: {
                decisionNote: 'Auto-rejected after another proposal was accepted.',
              },
            },
          })
        }
        return updated
      })
      await recordAudit({
        actor,
        action: payload.decision === 'accept' ? 'task.proposal.accepted' : 'task.proposal.rejected',
        resourceType: 'task_proposal',
        resourceId: proposal.id,
        metadata: {
          taskId: String(id),
          proposerId: proposal.proposerId,
        },
      })
      const proposerHandle = userHandle(proposal.proposer)
      await createNotificationsForHandles([proposerHandle], {
        type: payload.decision === 'accept' ? 'task.proposal_accepted' : 'task.proposal_rejected',
        title: payload.decision === 'accept' ? `Proposal accepted: ${proposal.task.title}` : `Proposal rejected: ${proposal.task.title}`,
        body: payload.decision === 'accept'
          ? `${proposal.task.title} is ready for delivery.`
          : `${proposal.task.title} proposal was not selected.`,
        resourceType: 'task',
        resourceId: String(id),
        metadata: { taskId: String(id), proposalId: proposal.id, reviewNote: payload.note ?? '', target: taskNotificationTarget('mine') },
      })
      if (autoRejectedProposerHandles.length > 0) {
        await createNotificationsForHandles(autoRejectedProposerHandles, {
          type: 'task.proposal_rejected',
          title: `Proposal not selected: ${proposal.task.title}`,
          body: `${proposal.task.title} moved forward with another proposal.`,
          resourceType: 'task',
          resourceId: String(id),
          metadata: { taskId: String(id), selectedProposalId: proposal.id, target: taskNotificationTarget('mine') },
          dedupeUnread: true,
        })
      }
      return getTaskProposalDto(updatedProposal)
    },
    submit: async (id, payload, actor = null) => {
      const task = await client.task.findUnique({
        where: { id: String(id) },
        include: {
          publisher: { include: { profile: true } },
          assignee: { include: { profile: true } },
        },
      })
      if (!task) {
        return null
      }
      const assigneeHandle = task.assignee?.profile?.handle ?? task.assignee?.id ?? null
      if (assigneeHandle && actor && assigneeHandle !== actor.handle && !hasPermission(actor, 'admin:access')) {
        return null
      }
      const submitter = await findUserByHandle(actor.handle)
      if (!submitter) {
        return null
      }
      const previousSubmission = await client.taskSubmission.findFirst({
        where: { taskId: String(id), submitterId: submitter.id },
        orderBy: { createdAt: 'desc' },
      })
      const isResubmission = previousSubmission?.status === 'revision_requested'
      const taskDto = getTaskDto(task)
      const row = await client.task.update({
        where: { id: String(id) },
        data: {
          status: taskStatusFromLabel('Pending Review'),
          metadata: {
            ...taskDto,
            submission: payload.content,
            resultLinks: payload.assetIds?.length ? payload.assetIds : taskDto.resultLinks,
            rights: payload.rightsNote ?? taskDto.rights,
          },
        },
        include: {
          publisher: { include: { profile: true } },
          assignee: { include: { profile: true } },
        },
      })
      const submission = await client.taskSubmission.create({
        data: {
          id: `submission-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
          taskId: String(id),
          submitterId: submitter.id,
          content: payload.content,
          assetIds: payload.assetIds ?? [],
          rightsNote: payload.rightsNote ?? '',
          status: 'pending_review',
        },
      })
      await recordAudit({
        actor,
        action: 'task.submitted',
        resourceType: 'task',
        resourceId: row.id,
        metadata: { status: row.status, submissionId: submission.id },
      })
      await createNotificationsForHandles([publisherHandle], {
        type: isResubmission ? 'task.submission_resubmitted' : 'task.submission_submitted',
        title: isResubmission ? 'Task revision ready for review' : 'Task submission ready for review',
        body: isResubmission
          ? `${submitter.profile?.handle ?? submitter.id} resubmitted work for ${row.title}.`
          : `${submitter.profile?.handle ?? submitter.id} submitted work for ${row.title}.`,
        resourceType: 'task',
        resourceId: row.id,
        metadata: { taskId: row.id, submissionId: submission.id, status: submission.status, previousSubmissionStatus: previousSubmission?.status ?? null, target: taskNotificationTarget('mine') },
      })
      return getTaskDto(row)
    },
    listSubmissions: async (id, actor, options = {}) => {
      const task = await client.task.findUnique({
        where: { id: String(id) },
        include: {
          publisher: { include: { profile: true } },
          assignee: { include: { profile: true } },
        },
      })
      if (!task) {
        return null
      }
      const publisherHandle = task.publisher?.profile?.handle ?? task.publisher?.id ?? null
      const assigneeHandle = task.assignee?.profile?.handle ?? task.assignee?.id ?? null
      if (
        publisherHandle !== actor.handle &&
        assigneeHandle !== actor.handle &&
        !hasPermission(actor, 'admin:access')
      ) {
        return null
      }
      const limit = options.limit ?? 20
      const cursor = options.cursor
        ? await client.taskSubmission.findUnique({ where: { id: String(options.cursor) }, select: { id: true } })
        : null
      const rows = await client.taskSubmission.findMany({
        where: { taskId: String(id) },
        include: {
          submitter: { include: { profile: true } },
          reviewedBy: { include: { profile: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
      })
      const pageRows = rows.slice(0, limit)
      return {
        items: pageRows.map(getTaskSubmissionDto),
        nextCursor: rows.length > limit && pageRows.length > 0 ? pageRows[pageRows.length - 1].id : null,
        limit,
      }
    },
    listTimeline: async (id, actor, options = {}) => {
      const task = await client.task.findUnique({
        where: { id: String(id) },
        include: {
          publisher: { include: { profile: true } },
          assignee: { include: { profile: true } },
          proposals: {
            include: { proposer: { include: { profile: true } } },
            orderBy: { createdAt: 'desc' },
          },
          submissions: {
            include: {
              submitter: { include: { profile: true } },
              reviewedBy: { include: { profile: true } },
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      })
      if (!task) {
        return null
      }
      const participantHandles = uniqueHandles([
        userHandle(task.publisher),
        userHandle(task.assignee),
        ...task.proposals.map((proposal) => userHandle(proposal.proposer)),
        ...task.submissions.map((submission) => userHandle(submission.submitter)),
      ])
      if (!participantHandles.includes(actor.handle) && !hasPermission(actor, 'admin:access')) {
        return null
      }

      const proposalIds = task.proposals.map((proposal) => proposal.id)
      const limit = options.limit ?? 50
      const cursor = options.cursor
        ? await client.auditEvent.findUnique({ where: { id: String(options.cursor) }, select: { id: true } })
        : null
      const rows = await client.auditEvent.findMany({
        where: {
          OR: [
            { resourceType: 'task', resourceId: String(id) },
            ...(proposalIds.length > 0 ? [{ resourceType: 'task_proposal', resourceId: { in: proposalIds } }] : []),
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
      })
      const hasCreatedEvent = rows.some((row) => row.action === 'task.created')
      const syntheticCreated = hasCreatedEvent || cursor
        ? []
        : [{
            id: `task-${task.id}-created`,
            actorId: task.publisherId,
            action: 'task.created',
            resourceType: 'task',
            resourceId: task.id,
            metadata: { status: task.status, category: task.category },
            createdAt: task.createdAt,
          }]
      const timelineRows = [...rows, ...syntheticCreated]
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      const actorIds = [...new Set(timelineRows.map((row) => row.actorId).filter(Boolean))]
      const actors = actorIds.length > 0
        ? await client.user.findMany({
          where: { id: { in: actorIds } },
          include: { profile: true },
        })
        : []
      const actorById = new Map(actors.map((user) => [user.id, buildUserSummary(user)]))
      const pageRows = timelineRows.slice(0, limit)
      return {
        items: pageRows.map((row) => taskTimelineItem(row, id, actorById)),
        nextCursor: rows.length > limit && rows.slice(0, limit).length > 0 ? rows.slice(0, limit)[rows.slice(0, limit).length - 1].id : null,
        limit,
      }
    },
    createDispute: async (id, payload, actor = null) => {
      const task = await client.task.findUnique({
        where: { id: String(id) },
        include: {
          publisher: { include: { profile: true } },
          assignee: { include: { profile: true } },
        },
      })
      if (!task) {
        return null
      }
      const taskDto = getTaskDto(task)
      const row = await client.$transaction(async (transaction) => {
        const submission = await transaction.taskSubmission.findFirst({
          where: {
            taskId: String(id),
            status: { in: ['rejected', 'stale', 'disputed'] },
          },
          include: {
            submitter: { include: { profile: true } },
            reviewedBy: { include: { profile: true } },
          },
          orderBy: { createdAt: 'desc' },
        })
        if (!submission) {
          return null
        }
        const creatorHandle = userHandle(submission.submitter)
        const publisherHandle = userHandle(task.publisher)
        if (actor && actor.handle !== creatorHandle && !hasPermission(actor, 'admin:access')) {
          return null
        }
        const submissionMetadata = asObject(submission.metadata) ?? {}
        const existingDisputeId = submissionMetadata.dispute?.adminReviewId ?? null
        const reviewId = existingDisputeId ?? `review-task-dispute-${task.id}-${submission.id}`
        const disputeMetadata = {
          kind: 'task_dispute',
          taskId: String(task.id),
          submissionId: submission.id,
          creatorHandle,
          publisherHandle,
          reason: payload.reason,
          previousSubmissionStatus: submission.status,
          openedBy: actor?.handle ?? creatorHandle,
          openedAt: new Date().toISOString(),
        }
        await transaction.adminReview.upsert({
          where: { id: reviewId },
          create: {
            id: reviewId,
            queue: 'task_disputes',
            status: 'Task dispute',
            title: `Task dispute: ${task.title}`,
            owner: creatorHandle ?? actor?.handle ?? 'unknown',
            note: payload.reason,
            metadata: disputeMetadata,
          },
          update: {
            note: payload.reason,
            metadata: disputeMetadata,
          },
        })
        await transaction.taskSubmission.update({
          where: { id: submission.id },
          data: {
            status: 'disputed',
            metadata: {
              ...submissionMetadata,
              dispute: {
                ...disputeMetadata,
                adminReviewId: reviewId,
              },
            },
          },
        })
        const updatedTask = await transaction.task.update({
          where: { id: String(task.id) },
          data: {
            status: 'disputed',
            metadata: {
              ...taskDto,
              status: 'Disputed',
              disputeStatus: 'open',
              disputeReason: payload.reason,
              disputeReviewId: reviewId,
            },
          },
          include: {
            publisher: { include: { profile: true } },
            assignee: { include: { profile: true } },
          },
        })
        await transaction.auditEvent.create({
          data: buildAuditRecord({
            actorType: actor ? 'user' : 'system',
            actorId: actor?.id ?? null,
            action: 'task.dispute.opened',
            resourceType: 'task',
            resourceId: String(task.id),
            metadata: {
              note: payload.reason,
              submissionId: submission.id,
              adminReviewId: reviewId,
              previousSubmissionStatus: submission.status,
            },
          }),
        })
        const notificationPayload = {
          type: 'task.dispute_opened',
          title: `Task dispute opened: ${task.title}`,
          body: `${actor?.handle ?? creatorHandle} opened a dispute: ${payload.reason}`,
          resourceType: 'task',
          resourceId: String(task.id),
          metadata: { taskId: String(task.id), submissionId: submission.id, adminReviewId: reviewId, target: taskNotificationTarget('mine') },
          dedupeUnread: true,
        }
        await createNotificationsForHandles([publisherHandle], notificationPayload, transaction)
        await createNotificationsForHandles([creatorHandle], {
          type: 'task.dispute_received',
          title: `Dispute opened: ${task.title}`,
          body: `Your dispute for ${task.title} is now in the task dispute queue.`,
          resourceType: 'task',
          resourceId: String(task.id),
          metadata: { taskId: String(task.id), submissionId: submission.id, adminReviewId: reviewId, target: taskNotificationTarget('mine') },
          dedupeUnread: true,
        }, transaction)
        await notifyAdminQueueReaders(transaction, actor, {
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
        return updatedTask
      })
      return row ? getTaskDto(row) : null
    },
    sweepStaleSubmissions: async (payload, actor = null) => {
      const cutoff = new Date(Date.now() - payload.olderThanHours * 60 * 60 * 1000)
      const rows = await client.$transaction(async (transaction) => {
        const submissions = await transaction.taskSubmission.findMany({
          where: {
            status: 'pending_review',
            createdAt: { lt: cutoff },
            ...(payload.taskId ? { taskId: String(payload.taskId) } : {}),
          },
          include: {
            submitter: { include: { profile: true } },
            task: {
              include: {
                publisher: { include: { profile: true } },
                assignee: { include: { profile: true } },
              },
            },
            reviewedBy: { include: { profile: true } },
          },
          orderBy: { createdAt: 'asc' },
          take: payload.limit,
        })
        const updated = []
        for (const submission of submissions) {
          const metadata = asObject(submission.metadata) ?? {}
          const staleMetadata = {
            staleAt: new Date().toISOString(),
            olderThanHours: payload.olderThanHours,
            previousSubmissionStatus: submission.status,
          }
          const row = await transaction.taskSubmission.update({
            where: { id: submission.id },
            data: {
              status: 'stale',
              metadata: {
                ...metadata,
                stale: staleMetadata,
              },
            },
            include: {
              submitter: { include: { profile: true } },
              reviewedBy: { include: { profile: true } },
            },
          })
          await transaction.auditEvent.create({
            data: buildAuditRecord({
              actorType: actor ? 'user' : 'system',
              actorId: actor?.id ?? null,
              action: 'task.submission.stale',
              resourceType: 'task',
              resourceId: String(submission.taskId),
              metadata: {
                submissionId: submission.id,
                olderThanHours: payload.olderThanHours,
                note: `Submission has been pending review for more than ${payload.olderThanHours} hours.`,
              },
            }),
          })
          await createNotificationsForHandles(
            uniqueHandles([userHandle(submission.task.publisher), userHandle(submission.submitter)]),
            {
              type: 'task.submission_stale',
              title: `Task review overdue: ${submission.task.title}`,
              body: `A submission has been pending review for more than ${payload.olderThanHours} hours.`,
              resourceType: 'task',
              resourceId: String(submission.taskId),
              metadata: { taskId: String(submission.taskId), submissionId: submission.id, olderThanHours: payload.olderThanHours, target: taskNotificationTarget('mine') },
              dedupeUnread: true,
            },
            transaction,
          )
          updated.push(row)
        }
        return updated
      })
      return {
        marked: rows.length,
        items: rows.map(getTaskSubmissionDto),
      }
    },
    review: async (id, payload, actor = null) => {
      const task = await client.task.findUnique({
        where: { id: String(id) },
        include: {
          publisher: { include: { profile: true } },
          assignee: { include: { profile: true } },
        },
      })
      if (!task) {
        return null
      }
      const publisherHandle = task.publisher?.profile?.handle ?? task.publisher?.id ?? null
      if (publisherHandle && actor && publisherHandle !== actor.handle && !hasPermission(actor, 'admin:access')) {
        return null
      }
      const reviewer = actor ? await findUserByHandle(actor.handle) : null
      let submissionRecipientHandle = null
      const row = await client.$transaction(async (transaction) => {
        const pendingSubmission = await transaction.taskSubmission.findFirst({
          where: { taskId: String(id), status: 'pending_review' },
          include: { submitter: { include: { profile: true } } },
          orderBy: { createdAt: 'desc' },
        })
        submissionRecipientHandle = pendingSubmission?.submitter?.profile?.handle ?? pendingSubmission?.submitter?.id ?? null
        const taskDto = getTaskDto(task)
        const isApproval = payload.decision === 'approve'
        const isRevisionRequest = payload.decision === 'request_changes'
        const nextTaskStatus = isApproval ? 'Completed' : isRevisionRequest ? 'In Progress' : 'Rejected'
        const nextSubmissionStatus = isApproval ? 'approved' : isRevisionRequest ? 'revision_requested' : 'rejected'
        const acceptanceChecklist = payload.acceptanceChecklist ?? []
        const reviewTaskData = {
          status: taskStatusFromLabel(nextTaskStatus),
          metadata: {
            ...taskDto,
            reviewNote: payload.reviewNote,
            acceptanceChecklist,
            status: nextTaskStatus,
          },
        }
        let shouldApplyCompletionReputation = false
        let updatedTask = null
        if (isApproval) {
          const completionTransition = await transaction.task.updateMany({
            where: { id: String(id), status: { not: 'completed' } },
            data: reviewTaskData,
          })
          shouldApplyCompletionReputation = completionTransition.count > 0
          updatedTask = shouldApplyCompletionReputation
            ? await transaction.task.findUnique({
              where: { id: String(id) },
              include: {
                publisher: { include: { profile: true } },
                assignee: { include: { profile: true } },
              },
            })
            : await transaction.task.update({
              where: { id: String(id) },
              data: reviewTaskData,
              include: {
                publisher: { include: { profile: true } },
                assignee: { include: { profile: true } },
              },
            })
        } else {
          updatedTask = await transaction.task.update({
            where: { id: String(id) },
            data: reviewTaskData,
            include: {
              publisher: { include: { profile: true } },
              assignee: { include: { profile: true } },
            },
          })
        }
        if (!updatedTask) {
          throw new Error(`Task review update failed for ${id}`)
        }
        if (pendingSubmission) {
          await transaction.taskSubmission.update({
            where: { id: pendingSubmission.id },
            data: {
              status: nextSubmissionStatus,
              reviewNote: payload.reviewNote,
              metadata: {
                ...(
                  pendingSubmission.metadata && typeof pendingSubmission.metadata === 'object' && !Array.isArray(pendingSubmission.metadata)
                    ? pendingSubmission.metadata
                    : {}
                ),
                acceptanceChecklist,
              },
              reviewedById: reviewer?.id ?? null,
              reviewedAt: new Date(),
            },
          })
        }
        if (isApproval) {
          await finalizeTaskEscrow(transaction, task, task.publisherId, 'approve')
          await settleTaskReward(transaction, task, task.assigneeId ?? pendingSubmission?.submitterId ?? null)
          if (shouldApplyCompletionReputation) {
            await applyTaskCompletionReputation(transaction, task, task.assigneeId ?? pendingSubmission?.submitterId ?? null)
          }
        } else if (!isRevisionRequest) {
          await finalizeTaskEscrow(transaction, task, task.publisherId, 'reject')
        }
        return updatedTask
      })
      const assigneeHandle = task.assignee?.profile?.handle ?? task.assignee?.id ?? submissionRecipientHandle
      const notificationCopy = {
        approve: {
          type: 'task.submission_approved',
          title: 'Task submission approved',
          body: `${row.title} was approved and points were released.`,
        },
        reject: {
          type: 'task.submission_rejected',
          title: 'Task submission rejected',
          body: `${row.title} was rejected.`,
        },
        request_changes: {
          type: 'task.revision_requested',
          title: 'Task changes requested',
          body: `${row.title} needs revisions before acceptance.`,
        },
      }[payload.decision]
      await createNotificationsForHandles([assigneeHandle], {
        ...notificationCopy,
        resourceType: 'task',
        resourceId: row.id,
        metadata: { taskId: row.id, status: row.status, reviewNote: payload.reviewNote, acceptanceChecklist: payload.acceptanceChecklist ?? [], target: taskNotificationTarget('mine') },
      })
      if (payload.decision === 'approve') {
        await createNotificationsForHandles([assigneeHandle], {
          type: 'task.reward_settled',
          title: 'Task reward settled',
          body: `${row.title} reward points were released to your ledger.`,
          resourceType: 'task',
          resourceId: row.id,
          metadata: { taskId: row.id, status: row.status, target: { page: 'points' } },
          dedupeUnread: true,
        })
      }
      await recordAudit({
        actor,
        action: payload.decision === 'approve' ? 'task.approved' : payload.decision === 'request_changes' ? 'task.revision_requested' : 'task.rejected',
        resourceType: 'task',
        resourceId: row.id,
        metadata: { status: row.status, reviewNote: payload.reviewNote, acceptanceChecklist: payload.acceptanceChecklist ?? [] },
      })
      return getTaskDto(row)
    },
  }

  const posts = {
    list: async (options = {}) => {
      const limit = options.limit ?? 20
      const cursor = options.cursor
        ? await client.post.findUnique({ where: { id: String(options.cursor) }, select: { id: true } })
        : null
      const rows = await client.post.findMany({
        where: {
          ...(options.category ? { category: options.category } : {}),
          ...(options.tag ? { tag: options.tag } : {}),
        },
        include: { author: { include: { profile: true } } },
        orderBy: options.sort === 'hot' ? [{ likesCount: 'desc' }, { createdAt: 'desc' }] : { createdAt: 'desc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
      })
      const pageRows = rows.slice(0, limit)
      return {
        items: pageRows.map(getPostDto),
        nextCursor: rows.length > limit && pageRows.length > 0 ? pageRows[pageRows.length - 1].id : null,
        limit,
      }
    },
    findById: async (id, viewer = null) => {
      const row = await client.post.findUnique({
        where: { id: String(id) },
        include: {
          author: { include: { profile: true } },
          comments: {
            include: {
              author: { include: { profile: true } },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      })
      return row ? getPostDetailDto(row, viewer) : null
    },
    create: async (payload, actor) => {
      const author = await client.user.findFirst({
        where: { profile: { handle: actor.handle } },
        include: { profile: true },
      })
      if (!author) {
        return null
      }
      const row = await client.post.create({
        data: {
          authorId: author.id,
          title: payload.title,
          body: payload.body,
          category: payload.category,
          tag: payload.tag ?? '',
          solved: false,
          viewsCount: 0,
          likesCount: 0,
          metadata: {
            id: `post-${Date.now()}`,
            title: payload.title,
            category: payload.category,
            author: {
              handle: actor.handle,
              name: { en: author.displayName, zh: author.displayName },
              role: { en: String(author.role), zh: String(author.role) },
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
            relatedTasks: [],
          },
        },
        include: { author: { include: { profile: true } } },
      })
      await recordAudit({
        actor,
        action: 'post.created',
        resourceType: 'post',
        resourceId: row.id,
      })
      return getPostDto(row)
    },
    comment: async (id, payload, actor) => {
      const post = await client.post.findUnique({
        where: { id: String(id) },
        include: { author: { include: { profile: true } } },
      })
      if (!post) {
        return null
      }
      const author = await client.user.findFirst({
        where: { profile: { handle: actor.handle } },
        include: { profile: true },
      })
      if (!author) {
        return null
      }
      const commentId = `comment-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
      const row = await client.comment.create({
        data: buildPostCommentRecord(
          {
            id: commentId,
            body: payload.body,
          },
          post,
          author,
          payload.parentId ? { id: payload.parentId } : null,
        ),
        include: {
          author: { include: { profile: true } },
        },
      })
      await client.post.update({
        where: { id: String(id) },
        data: {
          metadata: {
            ...(asObject(post.metadata) ?? {}),
            replies: ((asObject(post.metadata)?.replies ?? 0) + 1),
          },
        },
      })
      await recordAudit({
        actor,
        action: 'post.commented',
        resourceType: 'post',
        resourceId: String(id),
        metadata: { parentId: payload.parentId ?? null },
      })
      return getCommentDto(row)
    },
    like: async (id, actor) => {
      const post = await client.post.findUnique({
        where: { id: String(id) },
      })
      if (!post) {
        return null
      }
      const user = await client.user.findFirst({
        where: { profile: { handle: actor.handle } },
      })
      if (!user) {
        return null
      }
      const existing = await client.postLike.findUnique({
        where: { postId_userId: { postId: String(id), userId: user.id } },
      })
      if (!existing) {
        await client.postLike.create({
          data: buildPostLikeRecord(post, user, `postlike-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
        })
      }
      const row = existing
        ? await client.post.findUnique({
            where: { id: String(id) },
            include: { author: { include: { profile: true } } },
          })
        : await client.post.update({
            where: { id: String(id) },
            data: { likesCount: { increment: 1 } },
            include: { author: { include: { profile: true } } },
          })
      if (!existing) {
        await recordAudit({
          actor,
          action: 'post.liked',
          resourceType: 'post',
          resourceId: String(id),
        })
      }
      return { liked: true, post: getPostDto(row) }
    },
    unlike: async (id, actor) => {
      const post = await client.post.findUnique({
        where: { id: String(id) },
      })
      if (!post) {
        return null
      }
      const user = await client.user.findFirst({
        where: { profile: { handle: actor.handle } },
      })
      if (!user) {
        return null
      }
      const result = await client.postLike.deleteMany({
        where: { postId: String(id), userId: user.id },
      })
      const row = result.count > 0
        ? await client.post.update({
            where: { id: String(id) },
            data: { likesCount: { decrement: 1 } },
            include: { author: { include: { profile: true } } },
          })
        : await client.post.findUnique({
            where: { id: String(id) },
            include: { author: { include: { profile: true } } },
          })
      if (result.count > 0) {
        await recordAudit({
          actor,
          action: 'post.unliked',
          resourceType: 'post',
          resourceId: String(id),
        })
      }
      return { liked: false, post: getPostDto(row) }
    },
    convertToTask: async (id, payload, actor) => {
      const post = await client.post.findUnique({
        where: { id: String(id) },
        include: { author: { include: { profile: true } } },
      })
      if (!post) {
        return null
      }
      const ownerHandle = post.author?.profile?.handle ?? post.author?.id ?? null
      if (ownerHandle && ownerHandle !== actor.handle && !hasPermission(actor, 'post:moderate') && !hasPermission(actor, 'admin:access')) {
        return null
      }
      const publisher = await client.user.findFirst({
        where: { profile: { handle: actor.handle } },
        include: { profile: true },
      })
      if (!publisher) {
        return null
      }
      const taskId = `task-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
      const task = await client.task.create({
        data: buildTaskRecord(
          {
            id: taskId,
            title: post.title,
            category: post.category,
            status: 'Open',
            budget: payload.rewardAmount ? String(payload.rewardAmount) : `${payload.pointsReward} pts`,
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
          },
          publisher,
          null,
        ),
        include: {
          publisher: { include: { profile: true } },
          assignee: { include: { profile: true } },
        },
      })
      await recordAudit({
        actor,
        action: 'post.converted_to_task',
        resourceType: 'post',
        resourceId: String(id),
        metadata: { taskId: task.id },
      })
      const reloaded = await client.task.findUnique({
        where: { id: task.id },
        include: {
          publisher: { include: { profile: true } },
          assignee: { include: { profile: true } },
        },
      })
      return reloaded ? getTaskDto(reloaded) : null
    },
  }

  const profiles = {
    list: async (options = {}) => {
      const limit = options.limit ?? 20
      const cursor = options.cursor
        ? await client.profile.findUnique({ where: { handle: String(options.cursor) }, select: { handle: true } })
        : null
      const rows = await client.profile.findMany({
        where: {
          ...(options.lane ? { lane: options.lane } : {}),
          ...(options.search ? {
            OR: [
              { handle: { contains: options.search, mode: 'insensitive' } },
              { bio: { contains: options.search, mode: 'insensitive' } },
            ],
          } : {}),
        },
        include: { user: true },
        orderBy: { handle: 'asc' },
        take: limit + 1,
        ...(cursor ? { cursor: { handle: cursor.handle }, skip: 1 } : {}),
      })
      const pageRows = rows.slice(0, limit)
      return {
        items: pageRows.map(getProfileDto),
        nextCursor: rows.length > limit && pageRows.length > 0 ? pageRows[pageRows.length - 1].handle : null,
        limit,
      }
    },
    findByHandle: async (handle) => {
      const row = await client.profile.findUnique({
        where: { handle },
        include: { user: true },
      })
      return row ? getProfileDto(row) : null
    },
    listRankings: async () => {
      const rows = await client.profile.findMany({
        include: { user: true },
        orderBy: { handle: 'asc' },
      })
      return rows
        .map(getProfileDto)
        .sort((left, right) => (right.stats?.score ?? 0) - (left.stats?.score ?? 0))
    },
    updateCurrent: async (user, patch) => {
      const row = await client.profile.update({
        where: { handle: user.handle },
        data: {
          handle: patch.handle ?? undefined,
          bio: patch.bio ?? undefined,
          lane: patch.lane ?? undefined,
          skills: patch.tags ?? undefined,
          languages: patch.languages ?? undefined,
          portfolio: patch.portfolio ?? undefined,
          stats: patch.stats ?? undefined,
          metadata: patch,
        },
        include: { user: true },
      })
      return getProfileDto(row)
    },
  }

  const buildPointSummary = (rows, userHandle) => {
    const balance = rows[0]?.balanceAfter ?? 0
    const frozen = rows
      .filter((entry) => entry.status === 'pending' && entry.delta < 0)
      .reduce((total, entry) => total + Math.abs(entry.delta), 0)
    const pendingSettlement = rows
      .filter((entry) => entry.status === 'pending' && entry.delta > 0)
      .reduce((total, entry) => total + entry.delta, 0)
    const lifetimeEarned = rows
      .filter((entry) => entry.status === 'settled' && entry.delta > 0)
      .reduce((total, entry) => total + entry.delta, 0)
    const lifetimeSpent = rows
      .filter((entry) => entry.status === 'settled' && entry.delta < 0)
      .reduce((total, entry) => total + Math.abs(entry.delta), 0)
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

  const points = {
    listLedger: async (options = {}) => {
      const limit = options.limit ?? 20
      const user = options.userHandle ? await findUserByHandle(options.userHandle) : null
      const userId = user?.id ?? null
      if (options.userHandle && !userId) {
        return {
          items: [],
          nextCursor: null,
          limit,
          summary: buildPointSummary([], options.userHandle),
        }
      }
      const cursor = options.cursor
        ? await client.pointLedger.findUnique({ where: { id: String(options.cursor) }, select: { id: true } })
        : null
      const where = {
        ...(userId ? { userId } : {}),
        ...(options.status ? { status: options.status } : {}),
        ...(options.search
          ? {
              OR: [
                { description: { contains: options.search } },
                { sourceType: { contains: options.search } },
                { sourceId: { contains: options.search } },
              ],
            }
          : {}),
      }
      const rows = await client.pointLedger.findMany({
        where,
        include: { user: { include: { profile: true } } },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
      })
      const summaryRows = await client.pointLedger.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      })
      const pageRows = rows.slice(0, limit)
      return {
        items: pageRows.map(getLedgerDto),
        nextCursor: rows.length > limit && pageRows.length > 0 ? pageRows[pageRows.length - 1].id : null,
        limit,
        summary: buildPointSummary(summaryRows, options.userHandle ?? null),
      }
    },
    adjust: async (payload, actor) => {
      const user = await findUserByHandle(payload.userHandle)
      if (!user) {
        return null
      }
      const entry = await client.$transaction(async (transaction) => {
        return createManualPointAdjustment(transaction, user, payload, actor)
      })
      return getLedgerDto(entry)
    },
    requestAdjustment: async (payload, actor, threshold) => {
      const user = await findUserByHandle(payload.userHandle)
      if (!user) {
        return null
      }
      if (Math.abs(payload.delta) > threshold) {
        const latest = await client.pointLedger.findFirst({
          where: { userId: user.id },
          orderBy: { createdAt: 'desc' },
        })
        const balanceBefore = latest?.balanceAfter ?? 0
        const review = await client.$transaction(async (transaction) => {
          const row = await transaction.adminReview.create({
            data: {
              id: `review-points-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
              queue: 'points',
              status: 'Pending review',
              title: `Point adjustment for @${payload.userHandle}: ${payload.delta > 0 ? '+' : ''}${payload.delta}`,
              owner: payload.userHandle,
              note: payload.reason,
              metadata: {
                kind: 'point_adjustment',
                userHandle: payload.userHandle,
                delta: payload.delta,
                reason: payload.reason,
                reasonCode: payload.reasonCode ?? null,
                requestedBy: actor.handle,
                threshold,
                balanceBefore,
                projectedBalance: balanceBefore + payload.delta,
              },
            },
          })
          await transaction.auditEvent.create({
            data: buildAuditRecord({
              actorType: actor ? 'user' : 'system',
              actorId: actor?.id ?? null,
              action: 'points.adjustment_requested',
              resourceType: 'admin_review',
              resourceId: row.id,
              metadata: {
                userHandle: payload.userHandle,
                delta: payload.delta,
                reason: payload.reason,
                reasonCode: payload.reasonCode ?? null,
                threshold,
                balanceBefore,
                projectedBalance: balanceBefore + payload.delta,
              },
            }),
          })
          await notifyPointApprovers(transaction, actor, {
            type: 'points.adjustment.requested',
            title: `Point adjustment review: @${payload.userHandle}`,
            body: `${actor.handle} requested ${payload.delta > 0 ? '+' : ''}${payload.delta} points for @${payload.userHandle}.`,
            resourceType: 'admin_review',
            resourceId: row.id,
            metadata: {
              ...(asObject(row.metadata) ?? {}),
              target: {
                page: 'admin',
                admin: {
                  tab: 'Task review',
                  queue: 'points',
                  reviewId: row.id,
                },
              },
            },
          })
          return row
        })
        return {
          status: 'pending_review',
          threshold,
          review: getAdminReviewDto(review),
          entry: null,
        }
      }
      const entry = await client.$transaction(async (transaction) => {
        return createManualPointAdjustment(transaction, user, payload, actor)
      })
      return {
        status: 'applied',
        threshold,
        entry: getLedgerDto(entry),
        review: null,
      }
    },
    getAdjustmentPolicy: async (fallbackPolicy) => {
      const row = await client.systemSetting.findUnique({
        where: { key: 'point_adjustment_policy' },
      })
      return normalizePointAdjustmentPolicy(row?.value ?? fallbackPolicy, fallbackPolicy)
    },
    updateAdjustmentPolicy: async (policy, actor, fallbackPolicy) => {
      const current = await client.systemSetting.findUnique({
        where: { key: 'point_adjustment_policy' },
      })
      const previous = normalizePointAdjustmentPolicy(current?.value ?? fallbackPolicy, fallbackPolicy)
      const normalized = normalizePointAdjustmentPolicy(policy, fallbackPolicy)
      const diff = diffPointAdjustmentPolicy(previous, normalized)
      await client.$transaction(async (transaction) => {
        await transaction.systemSetting.upsert({
          where: { key: 'point_adjustment_policy' },
          create: { key: 'point_adjustment_policy', value: normalized },
          update: { value: normalized },
        })
        const audit = await transaction.auditEvent.create({
          data: buildAuditRecord({
            actorType: actor ? 'user' : 'system',
            actorId: actor?.id ?? null,
            action: 'points.policy.updated',
            resourceType: 'point_adjustment_policy',
            resourceId: 'default',
            metadata: {
              previous,
              next: normalized,
              diff,
              summary: summarizePointPolicyDiff(diff),
            },
          }),
        })
        await notifyPolicyManagers(transaction, actor, {
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
      })
      return normalized
    },
    listAdjustmentPolicyHistory: async (options = {}) => {
      const limit = options.limit ?? 20
      const cursor = options.cursor
        ? await client.auditEvent.findUnique({ where: { id: String(options.cursor) }, select: { id: true } })
        : null
      const rows = await client.auditEvent.findMany({
        where: { action: { in: ['points.policy.updated', 'points.policy.rolled_back'] } },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
      })
      const pageRows = rows.slice(0, limit)
      return {
        items: pageRows.map((row) => ({
          id: row.id,
          action: row.action,
          actorId: row.actorId,
          createdAt: row.createdAt.toISOString(),
          summary: row.metadata?.summary ?? summarizePointPolicyDiff(row.metadata?.diff ?? {}),
          previous: row.metadata?.previous ?? null,
          next: row.metadata?.next ?? null,
          diff: row.metadata?.diff ?? null,
        })),
        nextCursor: rows.length > limit && pageRows.length > 0 ? pageRows[pageRows.length - 1].id : null,
        limit,
      }
    },
    rollbackAdjustmentPolicy: async (eventId, actor, fallbackPolicy) => {
      const event = await client.auditEvent.findUnique({ where: { id: String(eventId) } })
      const previous = event?.metadata?.previous ?? null
      if (!previous) {
        return null
      }
      const current = await client.systemSetting.findUnique({
        where: { key: 'point_adjustment_policy' },
      })
      const currentPolicy = normalizePointAdjustmentPolicy(current?.value ?? fallbackPolicy, fallbackPolicy)
      const rolledBack = normalizePointAdjustmentPolicy(previous, fallbackPolicy)
      const diff = diffPointAdjustmentPolicy(currentPolicy, rolledBack)
      await client.$transaction(async (transaction) => {
        await transaction.systemSetting.upsert({
          where: { key: 'point_adjustment_policy' },
          create: { key: 'point_adjustment_policy', value: rolledBack },
          update: { value: rolledBack },
        })
        const audit = await transaction.auditEvent.create({
          data: buildAuditRecord({
            actorType: actor ? 'user' : 'system',
            actorId: actor?.id ?? null,
            action: 'points.policy.rolled_back',
            resourceType: 'point_adjustment_policy',
            resourceId: 'default',
            metadata: {
              rollbackEventId: eventId,
              previous: currentPolicy,
              next: rolledBack,
              diff,
              summary: `rollback ${eventId}: ${summarizePointPolicyDiff(diff)}`,
            },
          }),
        })
        await notifyPolicyManagers(transaction, actor, {
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
      })
      return rolledBack
    },
  }

  const notifications = {
    list: async (actor, options = {}) => {
      const limit = options.limit ?? 20
      const recipient = await findUserByHandle(actor.handle)
      if (!recipient) {
        return { items: [], nextCursor: null, limit }
      }
      const cursor = options.cursor
        ? await client.notification.findUnique({ where: { id: String(options.cursor) }, select: { id: true } })
        : null
      const rows = await client.notification.findMany({
        where: {
          recipientId: recipient.id,
          ...(options.readState === 'read' ? { readAt: { not: null } } : {}),
          ...(options.readState === 'all' ? {} : options.readState === 'read' ? {} : { readAt: null }),
          ...(options.type ? { type: options.type } : {}),
          ...(options.resourceType ? { resourceType: options.resourceType } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
      })
      const pageRows = rows.slice(0, limit)
      return {
        items: pageRows.map(getNotificationDto),
        nextCursor: rows.length > limit && pageRows.length > 0 ? pageRows[pageRows.length - 1].id : null,
        limit,
      }
    },
    markRead: async (id, actor) => {
      const recipient = await findUserByHandle(actor.handle)
      if (!recipient) {
        return null
      }
      const row = await client.notification.findFirst({
        where: {
          id: String(id),
          recipientId: recipient.id,
        },
      })
      if (!row) {
        return null
      }
      if (row.readAt) {
        return getNotificationDto(row)
      }
      const updated = await client.notification.update({
        where: { id: row.id },
        data: { readAt: new Date() },
      })
      return getNotificationDto(updated)
    },
    markAllRead: async (actor) => {
      const recipient = await findUserByHandle(actor.handle)
      if (!recipient) {
        return { updated: 0 }
      }
      const result = await client.notification.updateMany({
        where: {
          recipientId: recipient.id,
          readAt: null,
        },
        data: { readAt: new Date() },
      })
      return { updated: result.count }
    },
    createForHandles: createNotificationsForHandles,
  }

  const providerLifecycleNotifications = {
    create: (payload, actor = null) => createProviderLifecycleNotifications(payload, actor),
  }

  const providerBudgetRecipientUsers = (db, actor) => findUsersByPermissions(db, ['admin:audit:read'], {
    excludeHandle: actor?.handle ?? null,
  })

  const createProviderBudgetNotificationsFromAuditEvents = async (auditEventsToNotify = [], actor = null, db = client) => {
    const recipients = await providerBudgetRecipientUsers(db, actor)
    if (recipients.length === 0) {
      return []
    }
    const created = []
    for (const auditEvent of auditEventsToNotify) {
      const notificationPayload = buildProviderBudgetNotificationPayload(auditEvent)
      if (!notificationPayload) {
        continue
      }
      const existing = await db.notification.findMany({
        where: {
          recipientId: { in: recipients.map((recipient) => recipient.id) },
          type: notificationPayload.type,
          resourceType: notificationPayload.resourceType,
          resourceId: notificationPayload.resourceId,
        },
      })
      const existingRecipientIds = new Set(existing
        .filter((notification) => hasProviderBudgetNotificationSourceKey(
          notification,
          notificationPayload.metadata.sourceKey,
        ))
        .map((notification) => notification.recipientId))
      const missingRecipients = recipients.filter((recipient) => !existingRecipientIds.has(recipient.id))
      const rows = await createNotificationsForUsers(db, missingRecipients, notificationPayload)
      created.push(...rows.map(getNotificationDto))
    }
    return created
  }

  const providerBudgetNotifications = {
    createFromAuditEvents: (auditEventsToNotify, actor = null) =>
      createProviderBudgetNotificationsFromAuditEvents(auditEventsToNotify, actor),
  }

  const providerLifecycleAudit = {
    record: (payload, actor = null) => recordProviderLifecycleAudit(payload, actor),
  }

  const recordProviderBudgetAuditEvents = async (payloads = [], actor = null, db = client) => {
    const results = []
    for (const payload of payloads) {
      const metadata = asObject(payload.metadata) ?? {}
      const sourceKey = metadata.sourceKey
      const resourceId = payload.resourceId ?? null
      const existing = await db.auditEvent.findMany({
        where: {
          action: payload.action,
          resourceType: payload.resourceType,
          resourceId,
        },
        orderBy: { createdAt: 'desc' },
        take: 25,
      })
      const existingEvent = existing.find((event) =>
        Boolean(sourceKey) && asObject(event.metadata)?.sourceKey === sourceKey)
      if (existingEvent) {
        results.push({
          created: false,
          event: serializeAuditEvent(existingEvent),
        })
        continue
      }
      const row = await db.auditEvent.create({
        data: buildAuditRecord({
          actorType: actor ? 'user' : 'system',
          actorId: actor?.id ?? null,
          action: payload.action,
          resourceType: payload.resourceType,
          resourceId,
          metadata,
        }),
      })
      results.push({
        created: true,
        event: serializeAuditEvent(row),
      })
    }
    return results
  }

  const providerBudgetAudit = {
    recordMany: (payloads, actor = null) => recordProviderBudgetAuditEvents(payloads, actor),
  }

  const getMediaGovernancePolicy = async () => {
    const row = await client.systemSetting.findUnique({ where: { key: 'media_governance_policy' } })
    return normalizeMediaGovernancePolicy(row?.value ?? {}, buildDefaultMediaGovernancePolicy())
  }

  const updateMediaGovernancePolicy = async (patch, actor) => {
    const previous = await getMediaGovernancePolicy()
    const next = mergeMediaGovernancePolicy(previous, patch, buildDefaultMediaGovernancePolicy())
    const diff = diffMediaGovernancePolicy(previous, next, buildDefaultMediaGovernancePolicy())
    await client.$transaction(async (transaction) => {
      await transaction.systemSetting.upsert({
        where: { key: 'media_governance_policy' },
        create: { key: 'media_governance_policy', value: next },
        update: { value: next },
      })
      const audit = await transaction.auditEvent.create({
        data: buildAuditRecord({
          actorType: actor ? 'user' : 'system',
          actorId: actor?.id ?? null,
          action: 'media.governance_policy.updated',
          resourceType: 'media_governance_policy',
          resourceId: 'default',
          metadata: {
            previous,
            next,
            diff,
            summary: summarizeMediaGovernancePolicyDiff(diff),
          },
        }),
      })
      await notifyPolicyManagers(transaction, actor, {
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
    })
    return next
  }

  const listMediaGovernancePolicyHistory = async (options = {}) => {
    const limit = options.limit ?? 20
    const cursor = options.cursor
      ? await client.auditEvent.findUnique({ where: { id: String(options.cursor) }, select: { id: true } })
      : null
    const rows = await client.auditEvent.findMany({
      where: { action: { in: ['media.governance_policy.updated', 'media.governance_policy.rolled_back'] } },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
    })
    const pageRows = rows.slice(0, limit)
    return {
      items: pageRows.map((row) => ({
        id: row.id,
        action: row.action,
        actorId: row.actorId,
        createdAt: row.createdAt.toISOString(),
        summary: row.metadata?.summary ?? summarizeMediaGovernancePolicyDiff(row.metadata?.diff ?? {}),
        previous: row.metadata?.previous ?? null,
        next: row.metadata?.next ?? null,
        diff: row.metadata?.diff ?? null,
      })),
      nextCursor: rows.length > limit && pageRows.length > 0 ? pageRows[pageRows.length - 1].id : null,
      limit,
    }
  }

  const rollbackMediaGovernancePolicy = async (eventId, actor) => {
    const event = await client.auditEvent.findUnique({ where: { id: String(eventId) } })
    const previous = event?.metadata?.previous ?? null
    if (!previous) {
      return null
    }
    const fallback = buildDefaultMediaGovernancePolicy()
    const current = await getMediaGovernancePolicy()
    const rolledBack = normalizeMediaGovernancePolicy(previous, fallback)
    const diff = diffMediaGovernancePolicy(current, rolledBack, fallback)
    await client.$transaction(async (transaction) => {
      await transaction.systemSetting.upsert({
        where: { key: 'media_governance_policy' },
        create: { key: 'media_governance_policy', value: rolledBack },
        update: { value: rolledBack },
      })
      const audit = await transaction.auditEvent.create({
        data: buildAuditRecord({
          actorType: actor ? 'user' : 'system',
          actorId: actor?.id ?? null,
          action: 'media.governance_policy.rolled_back',
          resourceType: 'media_governance_policy',
          resourceId: 'default',
          metadata: {
            rollbackEventId: eventId,
            previous: current,
            next: rolledBack,
            diff,
            summary: `rollback ${eventId}: ${summarizeMediaGovernancePolicyDiff(diff)}`,
          },
        }),
      })
      await notifyPolicyManagers(transaction, actor, {
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
    })
    return rolledBack
  }

  const creativeGenerations = {
    create: async (payload, actor) => {
      const actorUser = payload.actorHandle || actor?.handle ? await findUserByHandle(payload.actorHandle ?? actor.handle) : null
      const data = buildCreativeGenerationData(payload, actorUser)
      const row = await client.creativeGeneration.upsert({
        where: { id: data.id },
        create: data,
        update: {},
      })
      await recordAudit({
        actor,
        action: 'creative.generation.created',
        resourceType: 'creative_generation',
        resourceId: row.id,
        metadata: {
          workspace: row.workspace,
          mode: row.mode,
          providerId: row.providerId,
          status: row.status,
        },
      })
      return getCreativeGenerationDto(row)
    },
    markRunning: async (id, patch = {}, actor) => {
      const row = await client.creativeGeneration.update({
        where: { id: String(id) },
        data: {
          ...compactObject(patch),
          status: 'running',
          startedAt: patch.startedAt ? new Date(patch.startedAt) : new Date(),
        },
      })
      await recordAudit({
        actor,
        action: 'creative.generation.running',
        resourceType: 'creative_generation',
        resourceId: row.id,
        metadata: { status: row.status },
      })
      return getCreativeGenerationDto(row)
    },
    linkOutputAssets: async (id, assetIds = [], actor) => {
      const current = await client.creativeGeneration.findUnique({ where: { id: String(id) } })
      if (!current) {
        return null
      }
      const outputAssetIds = [...new Set([...(current.outputAssetIds ?? []), ...assetIds.filter(Boolean)])]
      const row = await client.creativeGeneration.update({
        where: { id: current.id },
        data: { outputAssetIds },
      })
      await recordAudit({
        actor,
        action: 'creative.generation.outputs_linked',
        resourceType: 'creative_generation',
        resourceId: row.id,
        metadata: { status: row.status, outputAssetIds },
      })
      return getCreativeGenerationDto(row)
    },
    complete: async (id, patch = {}, actor) => {
      const row = await client.creativeGeneration.update({
        where: { id: String(id) },
        data: {
          ...compactObject(patch),
          status: patch.status ?? 'completed',
          completedAt: patch.completedAt ? new Date(patch.completedAt) : new Date(),
        },
      })
      await recordAudit({
        actor,
        action: 'creative.generation.completed',
        resourceType: 'creative_generation',
        resourceId: row.id,
        metadata: { status: row.status, outputAssetIds: row.outputAssetIds },
      })
      return getCreativeGenerationDto(row)
    },
    fail: async (id, patch = {}, actor) => {
      const row = await client.creativeGeneration.update({
        where: { id: String(id) },
        data: {
          ...compactObject(patch),
          status: 'failed',
          failedAt: patch.failedAt ? new Date(patch.failedAt) : new Date(),
        },
      })
      await recordAudit({
        actor,
        action: 'creative.generation.failed',
        resourceType: 'creative_generation',
        resourceId: row.id,
        metadata: { status: row.status, errorCode: row.errorCode },
      })
      return getCreativeGenerationDto(row)
    },
    cancel: async (id, patch = {}, actor) => {
      const row = await client.creativeGeneration.update({
        where: { id: String(id) },
        data: {
          ...compactObject(patch),
          status: 'cancelled',
        },
      })
      await recordAudit({
        actor,
        action: 'creative.generation.cancelled',
        resourceType: 'creative_generation',
        resourceId: row.id,
        metadata: { status: row.status, reasonCode: patch.reasonCode ?? null },
      })
      return getCreativeGenerationDto(row)
    },
    find: async (id) => {
      const row = await client.creativeGeneration.findUnique({ where: { id: String(id) } })
      return row ? getCreativeGenerationDto(row) : null
    },
    listPollingCandidates: async (options = {}) => {
      const limit = Math.max(1, options.limit ?? 10)
      const rows = await client.creativeGeneration.findMany({
        where: {
          status: { in: (options.statuses ?? ['queued', 'running']).map(String) },
          ...(options.providerMode ? { providerMode: String(options.providerMode) } : {}),
          ...(options.providerIds?.length > 0 ? { providerId: { in: options.providerIds.map(String) } } : {}),
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit,
      })
      return {
        items: rows.map(getCreativeGenerationDto),
        limit,
      }
    },
    list: async (options = {}) => {
      const limit = options.limit ?? 20
      const cursor = options.cursor
        ? await client.creativeGeneration.findUnique({ where: { id: String(options.cursor) }, select: { id: true } })
        : null
      const rows = await client.creativeGeneration.findMany({
        where: {
          ...((options.actorHandle || options.actorId) ? {
            OR: [
              ...(options.actorHandle ? [{ actorHandle: String(options.actorHandle) }] : []),
              ...(options.actorId ? [{ actorId: String(options.actorId) }] : []),
            ],
          } : {}),
          ...(options.workspace ? { workspace: String(options.workspace) } : {}),
          ...(options.mode ? { mode: String(options.mode) } : {}),
          ...(options.providerId ? { providerId: String(options.providerId) } : {}),
          ...(options.status ? { status: String(options.status) } : {}),
          ...(options.reviewRequired == null ? {} : { safety: { path: ['reviewRequired'], equals: Boolean(options.reviewRequired) } }),
          ...(options.mediaAssetId ? { outputAssetIds: { has: String(options.mediaAssetId) } } : {}),
          ...((options.dateFrom || options.dateTo) ? {
            createdAt: {
              ...(options.dateFrom ? { gte: new Date(options.dateFrom) } : {}),
              ...(options.dateTo ? { lte: new Date(options.dateTo) } : {}),
            },
          } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
      })
      const pageRows = rows.slice(0, limit)
      return {
        items: pageRows.map(getCreativeGenerationDto),
        nextCursor: rows.length > limit && pageRows.length > 0 ? pageRows[pageRows.length - 1].id : null,
        limit,
      }
    },
  }

  const creativeGenerationMutations = {
    record: async (payload, actor) => {
      const idempotencyKey = String(payload.idempotencyKey ?? '')
      const existing = await client.creativeGenerationMutation.findUnique({
        where: { idempotencyKey },
      })
      if (existing) {
        return {
          created: false,
          mutation: getCreativeGenerationMutationDto(existing),
        }
      }

      let row
      try {
        row = await client.creativeGenerationMutation.create({
          data: {
            id: payload.id ?? `generation-mutation-${randomUUID()}`,
            generationId: String(payload.generationId),
            type: payload.type,
            status: payload.status ?? 'requested',
            idempotencyKey,
            requestedById: payload.requestedById ?? actor?.id ?? null,
            requestedByHandle: payload.requestedByHandle ?? actor?.handle ?? null,
            reasonCode: payload.reasonCode,
            notePreview: payload.notePreview ?? null,
            reviewId: payload.reviewId ?? null,
            targetGenerationId: payload.targetGenerationId ?? null,
            safeMetadata: payload.safeMetadata ?? undefined,
            result: payload.result ?? undefined,
            completedAt: asDateOrNull(payload.completedAt),
            createdAt: payload.createdAt ? new Date(payload.createdAt) : undefined,
          },
        })
      } catch (error) {
        if (error?.code !== 'P2002') throw error
        const duplicate = await client.creativeGenerationMutation.findUnique({ where: { idempotencyKey } })
        if (!duplicate) throw error
        return {
          created: false,
          mutation: getCreativeGenerationMutationDto(duplicate),
        }
      }

      await recordAudit({
        actor,
        action: 'creative.generation_mutation.requested',
        resourceType: 'creative_generation_mutation',
        resourceId: row.id,
        metadata: {
          generationId: row.generationId,
          mutationType: row.type,
          mutationStatus: row.status,
          reasonCode: row.reasonCode,
        },
      })
      return {
        created: true,
        mutation: getCreativeGenerationMutationDto(row),
      }
    },
    find: async (id) => {
      const row = await client.creativeGenerationMutation.findUnique({ where: { id: String(id) } })
      return row ? getCreativeGenerationMutationDto(row) : null
    },
    findByIdempotencyKey: async (key) => {
      const row = await client.creativeGenerationMutation.findUnique({
        where: { idempotencyKey: String(key) },
      })
      return row ? getCreativeGenerationMutationDto(row) : null
    },
    listForGeneration: async (generationId) => {
      const rows = await client.creativeGenerationMutation.findMany({
        where: { generationId: String(generationId) },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
      return { items: rows.map(getCreativeGenerationMutationDto) }
    },
    update: async (id, patch = {}, actor) => {
      const row = await client.creativeGenerationMutation.update({
        where: { id: String(id) },
        data: {
          ...compactObject({
            status: patch.status,
            reasonCode: patch.reasonCode,
            notePreview: patch.notePreview,
            reviewId: patch.reviewId,
            targetGenerationId: patch.targetGenerationId,
            safeMetadata: patch.safeMetadata,
            result: patch.result,
          }),
          ...(patch.completedAt === undefined ? {} : { completedAt: asDateOrNull(patch.completedAt) }),
        },
      })
      await recordAudit({
        actor,
        action: 'creative.generation_mutation.updated',
        resourceType: 'creative_generation_mutation',
        resourceId: row.id,
        metadata: {
          generationId: row.generationId,
          mutationType: row.type,
          mutationStatus: row.status,
          reasonCode: row.reasonCode,
        },
      })
      return getCreativeGenerationMutationDto(row)
    },
  }

  const creativeProviderReplays = {
    record: async (payload, actor) => {
      const idempotencyKey = String(payload.idempotencyKey ?? '')
      const existing = await client.creativeProviderReplayLedger.findUnique({
        where: { idempotencyKey },
      })
      if (existing) {
        return {
          created: false,
          replay: getCreativeProviderReplayDto(existing),
        }
      }

      let row
      try {
        row = await client.creativeProviderReplayLedger.create({
          data: {
            id: payload.id ?? `provider-replay-${randomUUID()}`,
            generationId: String(payload.generationId ?? ''),
            providerId: payload.providerId,
            providerMode: payload.providerMode ?? null,
            providerJobId: payload.providerJobId ?? null,
            providerEventId: payload.providerEventId ?? null,
            sourceType: payload.sourceType,
            idempotencyKey,
            payloadHash: payload.payloadHash ?? null,
            previousStatus: payload.previousStatus ?? null,
            normalizedStatus: payload.normalizedStatus ?? null,
            action: payload.action ?? 'noop',
            reasonCode: payload.reasonCode ?? null,
            sideEffectPlan: payload.sideEffectPlan ?? undefined,
            sideEffectResult: payload.sideEffectResult ?? undefined,
            errorPreview: payload.errorPreview ?? null,
            receivedAt: payload.receivedAt ? new Date(payload.receivedAt) : undefined,
            appliedAt: payload.appliedAt ? new Date(payload.appliedAt) : null,
          },
        })
      } catch (error) {
        if (error?.code !== 'P2002') throw error
        const duplicate = await client.creativeProviderReplayLedger.findUnique({ where: { idempotencyKey } }) ??
          (payload.providerEventId
            ? await client.creativeProviderReplayLedger.findUnique({
              where: {
                providerId_providerEventId: {
                  providerId: payload.providerId,
                  providerEventId: payload.providerEventId,
                },
              },
            })
            : null)
        if (!duplicate) throw error
        return {
          created: false,
          replay: getCreativeProviderReplayDto(duplicate),
        }
      }
      await recordAudit({
        actor,
        action: 'creative.provider_replay.recorded',
        resourceType: 'creative_provider_replay_ledger',
        resourceId: row.id,
        metadata: {
          generationId: row.generationId,
          providerId: row.providerId,
          providerJobId: safeProviderJobIdEvidence(row.providerJobId),
          sourceType: row.sourceType,
          action: row.action,
          reasonCode: row.reasonCode,
        },
      })
      return {
        created: true,
        replay: getCreativeProviderReplayDto(row),
      }
    },
    claimSideEffects: async (id, payload = {}) => {
      const current = await client.creativeProviderReplayLedger.findUnique({ where: { id: String(id) } })
      if (!current) return { claimed: false, replay: null }
      const currentResult = current.sideEffectResult ?? null
      const expectedResult = payload.expectedSideEffectResult ?? null
      const activeLeaseExpiresAt = Date.parse(currentResult?.claim?.leaseExpiresAt ?? '')
      const claimedAt = Date.parse(payload.claimedAt ?? '')
      const hasActiveClaim = currentResult?.claim?.token &&
        Number.isFinite(activeLeaseExpiresAt) &&
        Number.isFinite(claimedAt) &&
        activeLeaseExpiresAt > claimedAt
      if (JSON.stringify(currentResult) !== JSON.stringify(expectedResult) || hasActiveClaim) {
        return { claimed: false, replay: getCreativeProviderReplayDto(current) }
      }
      const sideEffectResult = {
        ...(currentResult ?? {}),
        completed: false,
        claim: {
          token: String(payload.claimToken ?? ''),
          claimedAt: payload.claimedAt,
          leaseExpiresAt: payload.leaseExpiresAt,
        },
      }
      const claimed = await client.creativeProviderReplayLedger.updateMany({
        where: {
          id: current.id,
          sideEffectResult: {
            equals: expectedResult == null ? Prisma.DbNull : expectedResult,
          },
        },
        data: { sideEffectResult },
      })
      const replay = await client.creativeProviderReplayLedger.findUnique({ where: { id: current.id } })
      return {
        claimed: claimed.count === 1,
        replay: replay ? getCreativeProviderReplayDto(replay) : null,
      }
    },
    markApplied: async (id, sideEffectResult = {}, actor) => {
      const row = await client.creativeProviderReplayLedger.update({
        where: { id: String(id) },
        data: {
          action: 'applied',
          sideEffectResult,
          appliedAt: new Date(),
        },
      })
      await recordAudit({
        actor,
        action: 'creative.provider_replay.applied',
        resourceType: 'creative_provider_replay_ledger',
        resourceId: row.id,
        metadata: {
          generationId: row.generationId,
          providerId: row.providerId,
          providerJobId: safeProviderJobIdEvidence(row.providerJobId),
          sourceType: row.sourceType,
        },
      })
      return getCreativeProviderReplayDto(row)
    },
    markSideEffectResult: async (id, sideEffectResult = {}, actor, options = {}) => {
      const completed = Boolean(sideEffectResult.completed)
      const failed = sideEffectResult.operations?.find?.((operation) => operation.status === 'failed') ?? null
      let row
      if (options.claimToken) {
        const current = await client.creativeProviderReplayLedger.findUnique({ where: { id: String(id) } })
        if (!current) return null
        if (current.sideEffectResult?.claim?.token !== options.claimToken) {
          return getCreativeProviderReplayDto(current)
        }
        const updated = await client.creativeProviderReplayLedger.updateMany({
          where: {
            id: current.id,
            sideEffectResult: { equals: current.sideEffectResult },
          },
          data: {
            action: completed ? 'applied' : 'rejected',
            sideEffectResult,
            errorPreview: completed ? null : failed?.errorPreview ?? null,
            appliedAt: completed ? new Date() : undefined,
          },
        })
        row = await client.creativeProviderReplayLedger.findUnique({ where: { id: current.id } })
        if (updated.count !== 1 || !row) {
          return row ? getCreativeProviderReplayDto(row) : null
        }
      } else {
        row = await client.creativeProviderReplayLedger.update({
          where: { id: String(id) },
          data: {
            action: completed ? 'applied' : 'rejected',
            sideEffectResult,
            errorPreview: completed ? null : failed?.errorPreview ?? null,
            appliedAt: completed ? new Date() : undefined,
          },
        })
      }
      await recordAudit({
        actor,
        action: 'creative.provider_replay.side_effect_result_recorded',
        resourceType: 'creative_provider_replay_ledger',
        resourceId: row.id,
        metadata: {
          generationId: row.generationId,
          providerId: row.providerId,
          providerJobId: safeProviderJobIdEvidence(row.providerJobId),
          sourceType: row.sourceType,
          action: row.action,
        },
      })
      return getCreativeProviderReplayDto(row)
    },
    findByIdempotencyKey: async (idempotencyKey) => {
      const row = await client.creativeProviderReplayLedger.findUnique({
        where: { idempotencyKey: String(idempotencyKey ?? '') },
      })
      return row ? getCreativeProviderReplayDto(row) : null
    },
    listForGeneration: async (generationId, options = {}) => {
      const limit = options.limit ?? 20
      const cursor = options.cursor
        ? await client.creativeProviderReplayLedger.findUnique({ where: { id: String(options.cursor) }, select: { id: true } })
        : null
      const rows = await client.creativeProviderReplayLedger.findMany({
        where: { generationId: String(generationId) },
        orderBy: { receivedAt: 'desc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
      })
      const pageRows = rows.slice(0, limit)
      return {
        items: pageRows.map(getCreativeProviderReplayDto),
        nextCursor: rows.length > limit && pageRows.length > 0 ? pageRows[pageRows.length - 1].id : null,
        limit,
      }
    },
  }

  const creativeOutputIngestions = {
    record: async (payload, actor) => {
      const sourceKey = String(payload.sourceKey ?? '')
      const existing = await client.creativeOutputIngestion.findUnique({ where: { sourceKey } })
      if (existing) {
        return { created: false, ingestion: getCreativeOutputIngestionDto(existing) }
      }
      let row
      try {
        row = await client.creativeOutputIngestion.create({
          data: {
            id: payload.id ?? `output-ingestion-${randomUUID()}`,
            sourceKey,
            generationId: String(payload.generationId),
            providerId: payload.providerId,
            providerJobId: payload.providerJobId ?? null,
            outputDigest: payload.outputDigest,
            outputIndex: Number(payload.outputIndex),
            status: payload.status ?? 'pending',
            mediaAssetId: payload.mediaAssetId ?? null,
            storageKey: payload.storageKey ?? null,
            detectedContentType: payload.detectedContentType ?? null,
            sizeBytes: payload.sizeBytes ?? null,
            sha256: payload.sha256 ?? null,
            errorCode: payload.errorCode ?? null,
            completedAt: asDateOrNull(payload.completedAt),
          },
        })
      } catch (error) {
        if (error?.code !== 'P2002') throw error
        const duplicate = await client.creativeOutputIngestion.findUnique({ where: { sourceKey } })
        if (!duplicate) throw error
        return { created: false, ingestion: getCreativeOutputIngestionDto(duplicate) }
      }
      await recordAudit({
        actor,
        action: 'creative.output_ingestion.recorded',
        resourceType: 'creative_output_ingestion',
        resourceId: row.id,
        metadata: {
          generationId: row.generationId,
          providerId: row.providerId,
          providerJobId: safeProviderJobIdEvidence(row.providerJobId),
          outputDigest: row.outputDigest,
          outputIndex: row.outputIndex,
          ingestionStatus: row.status,
        },
      })
      return { created: true, ingestion: getCreativeOutputIngestionDto(row) }
    },
    find: async (id) => {
      const row = await client.creativeOutputIngestion.findUnique({ where: { id: String(id) } })
      return row ? getCreativeOutputIngestionDto(row) : null
    },
    findBySourceKey: async (sourceKey) => {
      const row = await client.creativeOutputIngestion.findUnique({ where: { sourceKey: String(sourceKey) } })
      return row ? getCreativeOutputIngestionDto(row) : null
    },
    listForGeneration: async (generationId) => {
      const rows = await client.creativeOutputIngestion.findMany({
        where: { generationId: String(generationId) },
        orderBy: [{ outputIndex: 'asc' }, { createdAt: 'asc' }],
      })
      return { items: rows.map(getCreativeOutputIngestionDto) }
    },
    claim: async (sourceKey, payload = {}) => {
      const current = await client.creativeOutputIngestion.findUnique({ where: { sourceKey: String(sourceKey) } })
      if (!current) return { claimed: false, ingestion: null }
      const claimedAt = new Date(payload.claimedAt)
      const hasActiveClaim = current.claimToken && current.leaseExpiresAt && current.leaseExpiresAt > claimedAt
      if (current.status === 'completed' || hasActiveClaim) {
        return { claimed: false, ingestion: getCreativeOutputIngestionDto(current) }
      }
      const updated = await client.creativeOutputIngestion.updateMany({
        where: {
          id: current.id,
          updatedAt: current.updatedAt,
          status: { not: 'completed' },
        },
        data: {
          status: 'claimed',
          claimToken: String(payload.claimToken ?? ''),
          claimedAt,
          leaseExpiresAt: new Date(payload.leaseExpiresAt),
          errorCode: null,
        },
      })
      const row = await client.creativeOutputIngestion.findUnique({ where: { id: current.id } })
      return { claimed: updated.count === 1, ingestion: row ? getCreativeOutputIngestionDto(row) : null }
    },
    update: async (id, patch = {}, actor, options = {}) => {
      const data = {
        ...compactObject({
          status: patch.status,
          sizeBytes: patch.sizeBytes,
        }),
        ...(patch.mediaAssetId === undefined ? {} : { mediaAssetId: patch.mediaAssetId }),
        ...(patch.storageKey === undefined ? {} : { storageKey: patch.storageKey }),
        ...(patch.detectedContentType === undefined ? {} : { detectedContentType: patch.detectedContentType }),
        ...(patch.sha256 === undefined ? {} : { sha256: patch.sha256 }),
        ...(patch.errorCode === undefined ? {} : { errorCode: patch.errorCode }),
        ...(patch.claimToken === undefined ? {} : { claimToken: patch.claimToken }),
        ...(patch.claimedAt === undefined ? {} : { claimedAt: asDateOrNull(patch.claimedAt) }),
        ...(patch.leaseExpiresAt === undefined ? {} : { leaseExpiresAt: asDateOrNull(patch.leaseExpiresAt) }),
        ...(patch.completedAt === undefined ? {} : { completedAt: asDateOrNull(patch.completedAt) }),
      }
      let row
      if (options.claimToken) {
        const updated = await client.creativeOutputIngestion.updateMany({
          where: { id: String(id), claimToken: String(options.claimToken) },
          data,
        })
        row = await client.creativeOutputIngestion.findUnique({ where: { id: String(id) } })
        if (updated.count !== 1 || !row) return row ? getCreativeOutputIngestionDto(row) : null
      } else {
        row = await client.creativeOutputIngestion.update({ where: { id: String(id) }, data })
      }
      await recordAudit({
        actor,
        action: 'creative.output_ingestion.updated',
        resourceType: 'creative_output_ingestion',
        resourceId: row.id,
        metadata: {
          generationId: row.generationId,
          providerId: row.providerId,
          outputDigest: row.outputDigest,
          outputIndex: row.outputIndex,
          ingestionStatus: row.status,
          errorCode: row.errorCode,
          mediaAssetId: row.mediaAssetId,
        },
      })
      await createProviderLifecycleNotifications({
        sourceKey: `creative-provider-output-ingestion:${row.id}:${row.status}:${row.errorCode ?? 'none'}`,
        generationId: row.generationId,
        type: `creative.output_ingestion.${row.status}`,
        metadata: {
          providerId: row.providerId,
          sourceType: 'output_ingestion',
          nextStatus: row.status,
          errorCode: row.errorCode,
        },
      }, actor)
      return getCreativeOutputIngestionDto(row)
    },
  }

  const providerCostConflict = (reasonCode) => new HttpError(
    409,
    'CREATIVE_PROVIDER_COST_LEDGER_CONFLICT',
    'Creative Provider cost ledger conflict',
    { reasonCode },
  )

  const providerControlConflict = (reasonCode) => new HttpError(
    409,
    'CREATIVE_PROVIDER_CONTROL_CONFLICT',
    'Creative Provider control state conflict',
    { reasonCode },
  )

  const providerRetryConflict = (reasonCode) => new HttpError(
    409,
    'CREATIVE_PROVIDER_RETRY_STATE_CONFLICT',
    'Creative Provider retry state conflict',
    { reasonCode },
  )

  const creativeProviderControls = {
    list: async (options = {}) => {
      const limit = options.limit ?? 50
      const rows = await client.creativeProviderControlState.findMany({
        where: {
          ...(options.providerId ? { providerId: options.providerId } : {}),
          ...(options.workspace ? { workspace: options.workspace } : {}),
        },
        orderBy: { scopeKey: 'asc' },
        take: limit + 1,
        ...(options.cursor ? { cursor: { scopeKey: String(options.cursor) }, skip: 1 } : {}),
      })
      const pageRows = rows.slice(0, limit)
      return {
        items: pageRows.map(getCreativeProviderControlStateDto),
        nextCursor: rows.length > limit && pageRows.length ? pageRows[pageRows.length - 1].scopeKey : null,
        limit,
      }
    },
    findControl: async (scopeKey) => {
      const row = await client.creativeProviderControlState.findUnique({ where: { scopeKey: String(scopeKey) } })
      return row ? getCreativeProviderControlStateDto(row) : null
    },
    findControlById: async (id) => {
      const row = await client.creativeProviderControlState.findUnique({ where: { id: String(id) } })
      return row ? getCreativeProviderControlStateDto(row) : null
    },
    setControl: async (payload, actor) => {
      const current = await client.creativeProviderControlState.findUnique({ where: { scopeKey: payload.scopeKey } })
      if (current && Number(payload.expectedVersion) !== current.version) throw providerControlConflict('control_version_mismatch')
      if (!current && ![undefined, null, 0].includes(payload.expectedVersion)) throw providerControlConflict('control_create_version_mismatch')
      if (current && current.enabled === payload.enabled && current.reasonCode === payload.reasonCode) {
        return { changed: false, control: getCreativeProviderControlStateDto(current) }
      }
      const now = new Date()
      let row
      if (!current) {
        row = await client.creativeProviderControlState.create({
          data: {
            id: payload.id ?? `provider-control-${randomUUID()}`,
            scopeKey: payload.scopeKey,
            scopeType: payload.scopeType,
            providerId: payload.providerId ?? null,
            providerAccountRef: payload.providerAccountRef ?? null,
            workspace: payload.workspace ?? null,
            modelFamily: payload.modelFamily ?? null,
            enabled: payload.enabled === true,
            reasonCode: payload.reasonCode,
            changedByRef: actor?.handle ?? payload.changedByRef ?? null,
            enabledAt: payload.enabled ? now : null,
            disabledAt: payload.enabled ? null : now,
          },
        })
      } else {
        const changed = await client.creativeProviderControlState.updateMany({
          where: { id: current.id, version: current.version },
          data: {
            enabled: payload.enabled === true,
            version: { increment: 1 },
            reasonCode: payload.reasonCode,
            changedByRef: actor?.handle ?? payload.changedByRef ?? null,
            ...(payload.enabled ? { enabledAt: now } : { disabledAt: now }),
          },
        })
        if (changed.count !== 1) throw providerControlConflict('control_concurrent_change')
        row = await client.creativeProviderControlState.findUnique({ where: { id: current.id } })
      }
      const dto = getCreativeProviderControlStateDto(row)
      await recordAudit({
        actor,
        action: `creative.provider_control.${dto.enabled ? 'enabled' : 'disabled'}`,
        resourceType: 'creative_provider_control',
        resourceId: dto.id,
        metadata: {
          scopeType: dto.scopeType,
          providerId: dto.providerId,
          workspace: dto.workspace,
          modelFamily: dto.modelFamily,
          enabled: dto.enabled,
          version: dto.version,
          reasonCode: dto.reasonCode,
        },
      })
      return { changed: true, control: dto }
    },
    putCapEvidence: async (payload, actor) => {
      const existing = await client.creativeProviderCapEvidence.findUnique({ where: { sourceKey: payload.sourceKey } })
      if (existing) {
        if (existing.evidenceHash !== payload.evidenceHash) throw providerControlConflict('cap_source_key_payload_mismatch')
        return { created: false, evidence: getCreativeProviderCapEvidenceDto(existing) }
      }
      const row = await client.$transaction(async (tx) => {
        await tx.creativeProviderCapEvidence.updateMany({
          where: { scopeKey: payload.scopeKey, active: true },
          data: { active: false },
        })
        return tx.creativeProviderCapEvidence.create({
          data: {
            id: payload.id ?? `provider-cap-${randomUUID()}`,
            sourceKey: payload.sourceKey,
            scopeKey: payload.scopeKey,
            providerId: payload.providerId,
            providerAccountRef: payload.providerAccountRef,
            currency: payload.currency,
            capMicros: BigInt(payload.capMicros),
            remainingMicros: payload.remainingMicros == null ? null : BigInt(payload.remainingMicros),
            sourceType: payload.sourceType,
            sourceRefHash: payload.sourceRefHash,
            evidenceHash: payload.evidenceHash,
            verifiedAt: new Date(payload.verifiedAt),
            expiresAt: new Date(payload.expiresAt),
            active: payload.active !== false,
          },
        })
      })
      const dto = getCreativeProviderCapEvidenceDto(row)
      await recordAudit({
        actor,
        action: 'creative.provider_control.cap_evidence_recorded',
        resourceType: 'creative_provider_cap_evidence',
        resourceId: dto.id,
        metadata: {
          providerId: dto.providerId,
          currency: dto.currency,
          sourceType: dto.sourceType,
          evidenceHash: dto.evidenceHash,
          verifiedAt: dto.verifiedAt,
          expiresAt: dto.expiresAt,
        },
      })
      return { created: true, evidence: dto }
    },
    findCapEvidence: async (scopeKey) => {
      const row = await client.creativeProviderCapEvidence.findFirst({
        where: { scopeKey: String(scopeKey), active: true },
        orderBy: { verifiedAt: 'desc' },
      })
      return row ? getCreativeProviderCapEvidenceDto(row) : null
    },
    ensureCircuit: async (payload, actor) => {
      const existing = await client.creativeProviderCircuitState.findUnique({ where: { scopeKey: payload.scopeKey } })
      if (existing) return { created: false, circuit: getCreativeProviderCircuitStateDto(existing) }
      const row = await client.creativeProviderCircuitState.create({
        data: {
          id: payload.id ?? `provider-circuit-${randomUUID()}`,
          scopeKey: payload.scopeKey,
          providerId: payload.providerId,
          providerAccountRef: payload.providerAccountRef,
          workspace: payload.workspace,
          modelFamily: payload.modelFamily ?? null,
        },
      })
      const dto = getCreativeProviderCircuitStateDto(row)
      await recordAudit({
        actor,
        action: 'creative.provider_circuit.provisioned',
        resourceType: 'creative_provider_circuit',
        resourceId: dto.id,
        metadata: { providerId: dto.providerId, workspace: dto.workspace, modelFamily: dto.modelFamily, status: dto.status },
      })
      return { created: true, circuit: dto }
    },
    findCircuit: async (scopeKey) => {
      const row = await client.creativeProviderCircuitState.findUnique({ where: { scopeKey: String(scopeKey) } })
      return row ? getCreativeProviderCircuitStateDto(row) : null
    },
    findCircuitById: async (id) => {
      const row = await client.creativeProviderCircuitState.findUnique({ where: { id: String(id) } })
      return row ? getCreativeProviderCircuitStateDto(row) : null
    },
    listCircuits: async (options = {}) => {
      const limit = options.limit ?? 50
      const rows = await client.creativeProviderCircuitState.findMany({
        where: {
          ...(options.providerId ? { providerId: options.providerId } : {}),
          ...(options.workspace ? { workspace: options.workspace } : {}),
        },
        orderBy: { scopeKey: 'asc' },
        take: limit + 1,
        ...(options.cursor ? { cursor: { scopeKey: String(options.cursor) }, skip: 1 } : {}),
      })
      const pageRows = rows.slice(0, limit)
      return {
        items: pageRows.map(getCreativeProviderCircuitStateDto),
        nextCursor: rows.length > limit && pageRows.length ? pageRows[pageRows.length - 1].scopeKey : null,
        limit,
      }
    },
    recordCircuitEvent: async (payload, actor) => {
      let outcome = null
      for (let attempt = 0; attempt < 5 && !outcome; attempt += 1) {
        try {
          outcome = await client.$transaction(async (tx) => {
            const duplicate = await tx.creativeProviderCircuitEvent.findUnique({ where: { sourceKey: String(payload.sourceKey) } })
            const current = await tx.creativeProviderCircuitState.findUnique({ where: { scopeKey: String(payload.scopeKey) } })
            if (duplicate) return { duplicate: true, event: duplicate, current, row: current, opened: false }
            if (!current) return null
            const occurredAt = new Date(payload.occurredAt ?? Date.now())
            const retryable = payload.policy.retryableCategories.includes(payload.category)
            const eventOutcome = payload.category === 'success' ? 'success' : retryable ? 'retryable_failure' : 'ignored_failure'
            const event = await tx.creativeProviderCircuitEvent.create({
              data: {
                id: `provider-circuit-event-${randomUUID()}`,
                sourceKey: payload.sourceKey,
                circuitStateId: current.id,
                category: payload.category,
                outcome: eventOutcome,
                occurredAt,
              },
            })
            let data = null
            let opened = false
            if (eventOutcome === 'retryable_failure') {
              const windowExpired = !current.windowStartedAt || occurredAt.getTime() - current.windowStartedAt.getTime() >= payload.policy.windowSeconds * 1000
              const failureCount = windowExpired ? 1 : current.failureCount + 1
              opened = current.status !== 'open' && (payload.category === 'provider_incident' || failureCount >= payload.policy.failureThreshold)
              const shouldOpen = current.status === 'open' || opened
              data = {
                failureCount,
                windowStartedAt: windowExpired ? occurredAt : current.windowStartedAt,
                lastFailureAt: occurredAt,
                status: shouldOpen ? 'open' : current.status,
                openedAt: opened ? occurredAt : current.openedAt,
                cooldownUntil: opened ? new Date(occurredAt.getTime() + payload.policy.cooldownSeconds * 1000) : current.cooldownUntil,
                reasonCode: shouldOpen ? `circuit_${payload.category}` : `failure_${payload.category}`,
                version: { increment: 1 },
              }
            } else if (eventOutcome === 'success' && current.status === 'closed') {
              data = { failureCount: 0, windowStartedAt: null, reasonCode: 'dispatch_succeeded', version: { increment: 1 } }
            } else if (eventOutcome === 'success' && current.status === 'half_open') {
              data = { reasonCode: 'probe_succeeded_pending_recovery', version: { increment: 1 } }
            }
            if (data) {
              const changed = await tx.creativeProviderCircuitState.updateMany({ where: { id: current.id, version: current.version }, data })
              if (changed.count !== 1) {
                const retry = new Error('Provider circuit changed concurrently')
                retry.code = 'PROVIDER_CIRCUIT_CONCURRENT_RETRY'
                throw retry
              }
            }
            const row = await tx.creativeProviderCircuitState.findUnique({ where: { id: current.id } })
            return { duplicate: false, event, current, row, opened }
          })
        } catch (error) {
          if (error?.code === 'PROVIDER_CIRCUIT_CONCURRENT_RETRY' || error?.code === 'P2002') continue
          throw error
        }
      }
      if (!outcome) throw new HttpError(503, 'CREATIVE_PROVIDER_CIRCUIT_BUSY', 'Creative Provider circuit update retry exhausted')
      if (!outcome.row) return null
      const result = {
        duplicate: outcome.duplicate,
        event: getCreativeProviderCircuitEventDto(outcome.event),
        circuit: getCreativeProviderCircuitStateDto(outcome.row),
      }
      if (!outcome.duplicate) {
        await recordAudit({
          actor,
          action: `creative.provider_circuit.${result.event.outcome}`,
          resourceType: 'creative_provider_circuit',
          resourceId: result.circuit.id,
          metadata: {
            providerId: result.circuit.providerId,
            workspace: result.circuit.workspace,
            category: result.event.category,
            outcome: result.event.outcome,
            status: result.circuit.status,
            failureCount: result.circuit.failureCount,
          },
        })
        if (outcome.opened) await recordAudit({
          actor,
          action: 'creative.provider_circuit.opened',
          resourceType: 'creative_provider_circuit',
          resourceId: result.circuit.id,
          metadata: {
            providerId: result.circuit.providerId,
            workspace: result.circuit.workspace,
            category: result.event.category,
            failureCount: result.circuit.failureCount,
            reasonCode: result.circuit.reasonCode,
          },
        })
      }
      return result
    },
    transitionCircuit: async (scopeKey, payload, actor) => {
      const outcome = await client.$transaction(async (tx) => {
        const current = await tx.creativeProviderCircuitState.findUnique({ where: { scopeKey: String(scopeKey) } })
        if (!current) return null
        if (Number(payload.expectedVersion) !== current.version) throw providerControlConflict('circuit_version_mismatch')
        const now = new Date(payload.now ?? Date.now())
        let probeToken = null
        if (payload.status === 'half_open') {
          if (current.status !== 'open') throw providerControlConflict('circuit_not_open')
          if (current.cooldownUntil && current.cooldownUntil > now) throw providerControlConflict('circuit_cooldown_active')
          probeToken = randomUUID()
        } else if (payload.status === 'closed') {
          if (current.status !== 'half_open') throw providerControlConflict('circuit_not_half_open')
          if (current.reasonCode !== 'probe_succeeded_pending_recovery') throw providerControlConflict('probe_success_required')
        } else if (payload.status !== 'open') throw providerControlConflict('circuit_transition_invalid')
        const changed = await tx.creativeProviderCircuitState.updateMany({
          where: { id: current.id, version: current.version },
          data: {
            status: payload.status,
            version: { increment: 1 },
            ...(payload.status === 'closed' ? { failureCount: 0, windowStartedAt: null } : {}),
            probeLeaseTokenHash: probeToken ? createHash('sha256').update(probeToken).digest('hex') : null,
            probeLeaseExpiresAt: probeToken ? new Date(now.getTime() + Number(payload.probeTtlSeconds ?? 60) * 1000) : null,
            reasonCode: payload.reasonCode,
            ...(payload.status === 'open' ? { openedAt: now, cooldownUntil: payload.cooldownUntil ? new Date(payload.cooldownUntil) : current.cooldownUntil } : {}),
          },
        })
        if (changed.count !== 1) throw providerControlConflict('circuit_concurrent_change')
        const row = await tx.creativeProviderCircuitState.findUnique({ where: { id: current.id } })
        return { row, probeToken }
      })
      if (!outcome) return null
      const dto = getCreativeProviderCircuitStateDto(outcome.row)
      await recordAudit({
        actor,
        action: `creative.provider_circuit.${payload.status}`,
        resourceType: 'creative_provider_circuit',
        resourceId: dto.id,
        metadata: { providerId: dto.providerId, workspace: dto.workspace, status: dto.status, reasonCode: payload.reasonCode, version: dto.version },
      })
      return { circuit: dto, probeToken: outcome.probeToken }
    },
    claimProbe: async (scopeKey, probeToken, actor, now = new Date()) => {
      const tokenHash = createHash('sha256').update(String(probeToken ?? '')).digest('hex')
      const current = await client.creativeProviderCircuitState.findUnique({ where: { scopeKey: String(scopeKey) } })
      if (!current) return { claimed: false, circuit: null }
      const changed = await client.creativeProviderCircuitState.updateMany({
        where: {
          id: current.id,
          status: 'half_open',
          probeLeaseTokenHash: tokenHash,
          probeLeaseExpiresAt: { gt: new Date(now) },
        },
        data: {
          version: { increment: 1 },
          probeLeaseTokenHash: null,
          probeLeaseExpiresAt: null,
          reasonCode: 'probe_claimed',
        },
      })
      const row = await client.creativeProviderCircuitState.findUnique({ where: { id: current.id } })
      if (changed.count === 1) await recordAudit({
        actor,
        action: 'creative.provider_circuit.probe_claimed',
        resourceType: 'creative_provider_circuit',
        resourceId: row.id,
        metadata: { providerId: row.providerId, workspace: row.workspace, status: row.status },
      })
      return { claimed: changed.count === 1, circuit: getCreativeProviderCircuitStateDto(row) }
    },
    recordDispatchBlock: async (payload, actor) => {
      await recordAudit({
        actor,
        action: 'creative.provider_control.dispatch_blocked',
        resourceType: 'creative_provider_control',
        resourceId: payload.resourceId ?? payload.providerId,
        metadata: {
          providerId: payload.providerId,
          workspace: payload.workspace,
          modelFamily: payload.modelFamily ?? null,
          reasonCode: payload.reasonCode,
          blockedScopeType: payload.blockedScopeType ?? null,
        },
      })
      return { recorded: true }
    },
    requestRecovery: async (payload, actor) => {
      const sourceKey = `provider-control-recovery:${createHash('sha256').update(JSON.stringify({
        resourceId: payload.resourceId,
        target: payload.target,
        expectedVersion: payload.expectedVersion,
        requestedBy: actor.handle,
      })).digest('hex')}`
      const existing = await client.adminReview.findFirst({
        where: {
          queue: 'provider-controls',
          metadata: { path: ['sourceKey'], equals: sourceKey },
        },
        include: { reviewedBy: { include: { profile: true } } },
      })
      if (existing) return { duplicate: true, review: getAdminReviewDto(existing) }
      const row = await client.$transaction(async (tx) => {
        const review = await tx.adminReview.create({
          data: {
            id: `provider-control-review-${randomUUID()}`,
            queue: 'provider-controls',
            status: 'Pending review',
            title: `Provider control recovery: ${payload.target}`,
            owner: actor.handle,
            note: payload.reasonCode,
            metadata: {
              kind: 'provider_control_recovery',
              sourceKey,
              resourceId: payload.resourceId,
              target: payload.target,
              expectedVersion: payload.expectedVersion,
              reasonCode: payload.reasonCode,
              probeTtlSeconds: payload.probeTtlSeconds,
              requestedBy: actor.handle,
            },
          },
          include: { reviewedBy: { include: { profile: true } } },
        })
        await tx.auditEvent.create({
          data: buildAuditRecord({
            actorType: actor ? 'user' : 'system',
            actorId: actor?.id ?? null,
            action: 'creative.provider_control.recovery_requested',
            resourceType: 'admin_review',
            resourceId: review.id,
            metadata: { target: payload.target, reasonCode: payload.reasonCode },
          }),
        })
        return review
      })
      return { duplicate: false, review: getAdminReviewDto(row) }
    },
    reviewRecovery: async (reviewId, action, actor) => {
      const current = await client.adminReview.findUnique({
        where: { id: String(reviewId) },
        include: { reviewedBy: { include: { profile: true } } },
      })
      const metadata = asObject(current?.metadata)
      if (!current || metadata?.kind !== 'provider_control_recovery') return null
      if (current.decision) return { review: getAdminReviewDto(current), result: null, probeToken: null }
      if (action.decision === 'approve' && metadata.requestedBy === actor.handle) {
        throw providerControlConflict('recovery_requires_different_approver')
      }
      const reviewer = await client.user.findFirst({ where: { profile: { handle: actor.handle } } })
      if (!reviewer) return null
      const outcome = await client.$transaction(async (tx) => {
        let resultRow = null
        let resultType = null
        let probeToken = null
        if (action.decision === 'approve' && metadata.target === 'enable') {
          const control = await tx.creativeProviderControlState.findUnique({ where: { id: String(metadata.resourceId) } })
          if (!control) throw providerControlConflict('control_not_found')
          if (control.version !== Number(metadata.expectedVersion)) throw providerControlConflict('control_version_mismatch')
          const changed = await tx.creativeProviderControlState.updateMany({
            where: { id: control.id, version: control.version },
            data: {
              enabled: true,
              version: { increment: 1 },
              reasonCode: String(metadata.reasonCode),
              changedByRef: actor.handle,
              enabledAt: new Date(),
            },
          })
          if (changed.count !== 1) throw providerControlConflict('control_concurrent_change')
          resultRow = await tx.creativeProviderControlState.findUnique({ where: { id: control.id } })
          resultType = 'control'
        } else if (action.decision === 'approve') {
          const circuit = await tx.creativeProviderCircuitState.findUnique({ where: { id: String(metadata.resourceId) } })
          if (!circuit) throw providerControlConflict('circuit_not_found')
          if (circuit.version !== Number(metadata.expectedVersion)) throw providerControlConflict('circuit_version_mismatch')
          const now = new Date()
          if (metadata.target === 'half_open') {
            if (circuit.status !== 'open') throw providerControlConflict('circuit_not_open')
            if (circuit.cooldownUntil && circuit.cooldownUntil > now) throw providerControlConflict('circuit_cooldown_active')
            probeToken = randomUUID()
          } else if (metadata.target === 'closed') {
            if (circuit.status !== 'half_open') throw providerControlConflict('circuit_not_half_open')
            if (circuit.reasonCode !== 'probe_succeeded_pending_recovery') throw providerControlConflict('probe_success_required')
          } else throw providerControlConflict('circuit_transition_invalid')
          const changed = await tx.creativeProviderCircuitState.updateMany({
            where: { id: circuit.id, version: circuit.version },
            data: {
              status: metadata.target,
              version: { increment: 1 },
              ...(metadata.target === 'closed' ? { failureCount: 0, windowStartedAt: null } : {}),
              probeLeaseTokenHash: probeToken ? createHash('sha256').update(probeToken).digest('hex') : null,
              probeLeaseExpiresAt: probeToken ? new Date(now.getTime() + Number(metadata.probeTtlSeconds ?? 60) * 1000) : null,
              reasonCode: String(metadata.reasonCode),
            },
          })
          if (changed.count !== 1) throw providerControlConflict('circuit_concurrent_change')
          resultRow = await tx.creativeProviderCircuitState.findUnique({ where: { id: circuit.id } })
          resultType = 'circuit'
        }
        const review = await tx.adminReview.update({
          where: { id: current.id },
          data: {
            status: action.decision === 'approve' ? 'Approved' : 'Rejected',
            note: action.note || current.note,
            decision: action.decision,
            reviewedById: reviewer.id,
            reviewedAt: new Date(),
            metadata: { ...metadata, approvedBy: action.decision === 'approve' ? actor.handle : null },
          },
          include: { reviewedBy: { include: { profile: true } } },
        })
        if (resultRow) await tx.auditEvent.create({
          data: buildAuditRecord({
            actorType: 'user',
            actorId: actor.id,
            action: resultType === 'control' ? 'creative.provider_control.enabled' : `creative.provider_circuit.${metadata.target}`,
            resourceType: resultType === 'control' ? 'creative_provider_control' : 'creative_provider_circuit',
            resourceId: resultRow.id,
            metadata: {
              providerId: resultRow.providerId ?? null,
              workspace: resultRow.workspace ?? null,
              status: resultRow.status ?? null,
              enabled: resultRow.enabled ?? null,
              reasonCode: metadata.reasonCode,
              version: resultRow.version,
            },
          }),
        })
        await tx.auditEvent.create({
          data: buildAuditRecord({
            actorType: 'user',
            actorId: actor.id,
            action: `creative.provider_control.recovery_${action.decision}`,
            resourceType: 'admin_review',
            resourceId: review.id,
            metadata: { target: metadata.target, reasonCode: metadata.reasonCode },
          }),
        })
        return { review, resultRow, resultType, probeToken }
      })
      return {
        review: getAdminReviewDto(outcome.review),
        result: outcome.resultType === 'control'
          ? getCreativeProviderControlStateDto(outcome.resultRow)
          : outcome.resultType === 'circuit'
            ? getCreativeProviderCircuitStateDto(outcome.resultRow)
            : null,
        probeToken: outcome.probeToken,
      }
    },
  }

  const creativeProviderRetries = {
    find: async (sourceKey) => {
      const row = await client.creativeProviderRetryState.findUnique({ where: { sourceKey: String(sourceKey) } })
      return row ? getCreativeProviderRetryStateDto(row) : null
    },
    findForGeneration: async (generationId, operationType = null) => {
      const row = await client.creativeProviderRetryState.findFirst({
        where: {
          generationId: String(generationId),
          ...(operationType ? { operationType: String(operationType) } : {}),
        },
        orderBy: { updatedAt: 'desc' },
      })
      return row ? getCreativeProviderRetryStateDto(row) : null
    },
    list: async (options = {}) => {
      const limit = options.limit ?? 50
      const rows = await client.creativeProviderRetryState.findMany({
        where: {
          ...(options.status ? { status: options.status } : {}),
          ...(options.providerId ? { providerId: options.providerId } : {}),
          ...(options.workspace ? { workspace: options.workspace } : {}),
          ...(options.dueBefore ? { nextAttemptAt: { lte: new Date(options.dueBefore) } } : {}),
        },
        orderBy: { id: 'asc' },
        take: limit + 1,
        ...(options.cursor ? { cursor: { id: String(options.cursor) }, skip: 1 } : {}),
      })
      const pageRows = rows.slice(0, limit)
      return {
        items: pageRows.map(getCreativeProviderRetryStateDto),
        nextCursor: rows.length > limit && pageRows.length ? pageRows[pageRows.length - 1].id : null,
        limit,
      }
    },
    record: async (payload, actor) => {
      const current = await client.creativeProviderRetryState.findUnique({ where: { sourceKey: String(payload.sourceKey) } })
      const ensureRetryNotification = (state) => createProviderLifecycleNotifications({
        sourceKey: `creative-provider-retry:${state.id}:${state.status}:${state.version}`,
        generationId: state.generationId,
        type: `creative.provider_retry.${state.status}`,
        metadata: {
          providerId: state.providerId,
          sourceType: 'retry',
          nextStatus: state.status,
          errorCode: state.lastErrorCode,
          reasonCode: state.lastErrorCategory,
        },
      }, actor)
      if (current?.lastFailureKeyHash === payload.lastFailureKeyHash) {
        await ensureRetryNotification(getCreativeProviderRetryStateDto(current))
        return { changed: false, duplicate: true, state: getCreativeProviderRetryStateDto(current) }
      }
      if (current && Number(payload.expectedVersion) !== current.version) throw providerRetryConflict('retry_version_mismatch')
      if (!current && ![undefined, null, 0].includes(payload.expectedVersion)) throw providerRetryConflict('retry_create_version_mismatch')
      let row
      if (!current) {
        try {
          row = await client.creativeProviderRetryState.create({
            data: {
              id: payload.id ?? `provider-retry-${randomUUID()}`,
              sourceKey: String(payload.sourceKey),
              generationId: String(payload.generationId),
              providerId: payload.providerId,
              workspace: payload.workspace,
              operationType: payload.operationType,
              status: payload.status,
              attempt: Number(payload.attempt),
              maxAttempts: Number(payload.maxAttempts),
              firstAttemptAt: new Date(payload.firstAttemptAt),
              lastAttemptAt: new Date(payload.lastAttemptAt),
              nextAttemptAt: asDateOrNull(payload.nextAttemptAt),
              lastFailureKeyHash: payload.lastFailureKeyHash,
              lastErrorCode: payload.lastErrorCode,
              lastErrorCategory: payload.lastErrorCategory,
              delaySource: payload.delaySource ?? null,
              policyHash: payload.policyHash,
            },
          })
        } catch (error) {
          if (error?.code !== 'P2002') throw error
          const duplicate = await client.creativeProviderRetryState.findUnique({ where: { sourceKey: String(payload.sourceKey) } })
          if (duplicate?.lastFailureKeyHash === payload.lastFailureKeyHash) {
            const state = getCreativeProviderRetryStateDto(duplicate)
            await ensureRetryNotification(state)
            return { changed: false, duplicate: true, state }
          }
          throw providerRetryConflict('retry_concurrent_create')
        }
      } else {
        const changed = await client.creativeProviderRetryState.updateMany({
          where: { id: current.id, version: current.version },
          data: {
            status: payload.status,
            attempt: Number(payload.attempt),
            maxAttempts: Number(payload.maxAttempts),
            firstAttemptAt: new Date(payload.firstAttemptAt),
            lastAttemptAt: new Date(payload.lastAttemptAt),
            nextAttemptAt: asDateOrNull(payload.nextAttemptAt),
            lastFailureKeyHash: payload.lastFailureKeyHash,
            lastErrorCode: payload.lastErrorCode,
            lastErrorCategory: payload.lastErrorCategory,
            delaySource: payload.delaySource ?? null,
            policyHash: payload.policyHash,
            version: { increment: 1 },
          },
        })
        if (changed.count !== 1) throw providerRetryConflict('retry_concurrent_change')
        row = await client.creativeProviderRetryState.findUnique({ where: { id: current.id } })
      }
      const state = getCreativeProviderRetryStateDto(row)
      await recordAudit({
        actor,
        action: `creative.provider_retry.${state.status}`,
        resourceType: 'creative_provider_retry_state',
        resourceId: state.id,
        metadata: {
          generationId: state.generationId,
          providerId: state.providerId,
          workspace: state.workspace,
          operationType: state.operationType,
          status: state.status,
          attempt: state.attempt,
          maxAttempts: state.maxAttempts,
          nextAttemptAt: state.nextAttemptAt,
          errorCode: state.lastErrorCode,
          errorCategory: state.lastErrorCategory,
          delaySource: state.delaySource,
          version: state.version,
        },
      })
      await ensureRetryNotification(state)
      return { changed: true, duplicate: false, state }
    },
    clear: async (sourceKey, payload = {}, actor) => {
      const current = await client.creativeProviderRetryState.findUnique({ where: { sourceKey: String(sourceKey) } })
      if (!current) return { changed: false, state: null }
      if (current.status === 'cleared') return { changed: false, state: getCreativeProviderRetryStateDto(current) }
      if (payload.expectedVersion != null && Number(payload.expectedVersion) !== current.version) throw providerRetryConflict('retry_version_mismatch')
      const changed = await client.creativeProviderRetryState.updateMany({
        where: { id: current.id, version: current.version },
        data: { status: 'cleared', nextAttemptAt: null, delaySource: null, version: { increment: 1 } },
      })
      if (changed.count !== 1) throw providerRetryConflict('retry_concurrent_change')
      const row = await client.creativeProviderRetryState.findUnique({ where: { id: current.id } })
      const state = getCreativeProviderRetryStateDto(row)
      await recordAudit({
        actor,
        action: 'creative.provider_retry.cleared',
        resourceType: 'creative_provider_retry_state',
        resourceId: state.id,
        metadata: {
          generationId: state.generationId,
          providerId: state.providerId,
          workspace: state.workspace,
          operationType: state.operationType,
          attempt: state.attempt,
          version: state.version,
          reasonCode: payload.reasonCode ?? 'provider_operation_succeeded',
        },
      })
      return { changed: true, state }
    },
  }

  const creativeProviderCosts = {
    reserve: async (payload, actor) => {
      const existing = await client.creativeProviderCostLedger.findUnique({
        where: { sourceKey: String(payload.sourceKey) },
        include: { budgetWindow: true },
      })
      if (existing) {
        if (existing.pricingSnapshotHash !== payload.pricingSnapshotHash || String(existing.estimateMicros) !== String(payload.estimateMicros)) {
          throw providerCostConflict('source_key_payload_mismatch')
        }
        return {
          reserved: existing.status === 'reserved',
          duplicate: true,
          reasonCode: existing.status === 'reserved' ? null : `already_${existing.status}`,
          ledger: getCreativeProviderCostLedgerDto(existing),
        }
      }

      const windowIdentity = {
        budgetScope: payload.budgetScope,
        currency: payload.currency,
        windowStart: new Date(payload.windowStart),
        windowEnd: new Date(payload.windowEnd),
      }
      let outcome = null
      for (let attempt = 0; attempt < 5 && outcome == null; attempt += 1) {
        try {
          outcome = await client.$transaction(async (tx) => {
            const duplicate = await tx.creativeProviderCostLedger.findUnique({
              where: { sourceKey: String(payload.sourceKey) },
              include: { budgetWindow: true },
            })
            if (duplicate) {
              if (duplicate.pricingSnapshotHash !== payload.pricingSnapshotHash || String(duplicate.estimateMicros) !== String(payload.estimateMicros)) {
                throw providerCostConflict('source_key_payload_mismatch')
              }
              return {
                reserved: duplicate.status === 'reserved',
                duplicate: true,
                reasonCode: duplicate.status === 'reserved' ? null : `already_${duplicate.status}`,
                ledger: getCreativeProviderCostLedgerDto(duplicate),
              }
            }
            const window = await tx.creativeProviderBudgetWindow.upsert({
              where: { budgetScope_currency_windowStart_windowEnd: windowIdentity },
              create: {
                ...windowIdentity,
                id: `provider-budget-${randomUUID()}`,
                providerId: payload.providerId,
                providerAccountRef: payload.providerAccountRef,
                workspace: payload.workspace,
                capMicros: BigInt(payload.capMicros),
                spentMicros: BigInt(payload.openingSpentMicros ?? 0),
              },
              update: {},
            })
            if (
              String(window.capMicros) !== String(payload.capMicros) ||
              window.providerId !== payload.providerId ||
              window.providerAccountRef !== payload.providerAccountRef ||
              window.workspace !== payload.workspace
            ) {
              throw providerCostConflict('budget_window_policy_mismatch')
            }
            const estimateMicros = BigInt(payload.estimateMicros)
            if (window.spentMicros + window.reservedMicros + estimateMicros > window.capMicros) {
              return {
                reserved: false,
                duplicate: false,
                reasonCode: 'budget_cap_exceeded',
                ledger: null,
                budgetWindow: getCreativeProviderBudgetWindowDto(window),
              }
            }
            const updatedWindow = await tx.creativeProviderBudgetWindow.updateMany({
              where: { id: window.id, updatedAt: window.updatedAt },
              data: { reservedMicros: { increment: estimateMicros } },
            })
            if (updatedWindow.count !== 1) {
              const retry = new Error('Provider budget window changed concurrently')
              retry.code = 'PROVIDER_BUDGET_CONCURRENT_RETRY'
              throw retry
            }
            const ledger = await tx.creativeProviderCostLedger.create({
              data: {
                id: `provider-cost-${randomUUID()}`,
                sourceKey: payload.sourceKey,
                generationId: payload.generationId,
                budgetWindowId: window.id,
                providerId: payload.providerId,
                providerAccountRef: payload.providerAccountRef,
                providerModelId: payload.providerModelId,
                providerJobId: payload.providerJobId ?? null,
                workspace: payload.workspace,
                mode: payload.mode,
                currency: payload.currency,
                pricingSnapshot: payload.pricingSnapshot,
                pricingSnapshotHash: payload.pricingSnapshotHash,
                estimateMicros,
                reservedMicros: estimateMicros,
                status: 'reserved',
              },
              include: { budgetWindow: true },
            })
            return { reserved: true, duplicate: false, reasonCode: null, ledger: getCreativeProviderCostLedgerDto(ledger) }
          })
        } catch (error) {
          if (error?.code === 'PROVIDER_BUDGET_CONCURRENT_RETRY') continue
          if (error?.code === 'P2002') {
            const duplicate = await client.creativeProviderCostLedger.findUnique({
              where: { sourceKey: String(payload.sourceKey) },
              include: { budgetWindow: true },
            })
            if (duplicate) {
              outcome = {
                reserved: duplicate.status === 'reserved',
                duplicate: true,
                reasonCode: duplicate.status === 'reserved' ? null : `already_${duplicate.status}`,
                ledger: getCreativeProviderCostLedgerDto(duplicate),
              }
              break
            }
          }
          throw error
        }
      }
      if (!outcome) {
        throw new HttpError(503, 'CREATIVE_PROVIDER_BUDGET_BUSY', 'Creative Provider budget could not be reserved', {
          reasonCode: 'concurrent_reservation_retry_exhausted',
        })
      }
      if (outcome.reserved && !outcome.duplicate) {
        await recordAudit({
          actor,
          action: 'creative.provider_cost.reserved',
          resourceType: 'creative_provider_cost_ledger',
          resourceId: outcome.ledger.id,
          metadata: {
            generationId: outcome.ledger.generationId,
            providerId: outcome.ledger.providerId,
            workspace: outcome.ledger.workspace,
            currency: outcome.ledger.currency,
            budgetScope: outcome.ledger.budgetWindow?.budgetScope,
            estimateMicros: outcome.ledger.estimateMicros,
            pricingSnapshotHash: outcome.ledger.pricingSnapshotHash,
          },
        })
      }
      return outcome
    },
    findBySourceKey: async (sourceKey) => {
      const row = await client.creativeProviderCostLedger.findUnique({
        where: { sourceKey: String(sourceKey) },
        include: { budgetWindow: true },
      })
      return row ? getCreativeProviderCostLedgerDto(row) : null
    },
    findForGeneration: async (generationId) => {
      const row = await client.creativeProviderCostLedger.findFirst({
        where: { generationId: String(generationId) },
        orderBy: { createdAt: 'desc' },
        include: { budgetWindow: true },
      })
      return row ? getCreativeProviderCostLedgerDto(row) : null
    },
    settle: async (sourceKey, payload = {}, actor) => {
      const actualMicros = BigInt(payload.actualMicros)
      const outcome = await client.$transaction(async (tx) => {
        const current = await tx.creativeProviderCostLedger.findUnique({
          where: { sourceKey: String(sourceKey) },
          include: { budgetWindow: true },
        })
        if (!current) return null
        if (payload.actualCurrency !== current.currency) throw providerCostConflict('actual_currency_mismatch')
        if (current.status === 'settled') {
          if (current.actualMicros !== actualMicros) throw providerCostConflict('actual_cost_mismatch')
          return { changed: false, row: current }
        }
        const heldMicros = ['reserved', 'reconciliation_required'].includes(current.status) ? current.reservedMicros : 0n
        const settled = await tx.creativeProviderCostLedger.updateMany({
          where: { id: current.id, status: current.status },
          data: {
            status: 'settled',
            actualMicros,
            providerJobId: payload.providerJobId ?? current.providerJobId,
            usage: payload.usage ?? current.usage ?? undefined,
            risk: payload.risk ?? current.risk ?? undefined,
            reasonCode: payload.reasonCode ?? 'provider_actual_settled',
            settledAt: payload.settledAt ? new Date(payload.settledAt) : new Date(),
          },
        })
        if (settled.count !== 1) {
          const duplicate = await tx.creativeProviderCostLedger.findUnique({
            where: { id: current.id },
            include: { budgetWindow: true },
          })
          if (duplicate?.status === 'settled' && duplicate.actualMicros === actualMicros) {
            return { changed: false, row: duplicate }
          }
          throw providerCostConflict('concurrent_lifecycle_change')
        }
        await tx.creativeProviderBudgetWindow.update({
          where: { id: current.budgetWindowId },
          data: {
            ...(heldMicros > 0n ? { reservedMicros: { decrement: heldMicros } } : {}),
            spentMicros: { increment: actualMicros },
          },
        })
        const row = await tx.creativeProviderCostLedger.findUnique({
          where: { id: current.id },
          include: { budgetWindow: true },
        })
        return { changed: true, row }
      })
      if (!outcome) return null
      const dto = getCreativeProviderCostLedgerDto(outcome.row)
      if (outcome.changed) await recordAudit({
        actor,
        action: 'creative.provider_cost.settled',
        resourceType: 'creative_provider_cost_ledger',
        resourceId: dto.id,
        metadata: {
          generationId: dto.generationId,
          providerId: dto.providerId,
          workspace: dto.workspace,
          currency: dto.currency,
          actualMicros: dto.actualMicros,
          estimateExceeded: BigInt(dto.actualMicros) > BigInt(dto.estimateMicros),
        },
      })
      return dto
    },
    release: async (sourceKey, reasonCode = 'dispatch_not_billed', actor) => {
      const outcome = await client.$transaction(async (tx) => {
        const current = await tx.creativeProviderCostLedger.findUnique({
          where: { sourceKey: String(sourceKey) },
          include: { budgetWindow: true },
        })
        if (!current) return null
        if (current.status === 'released' || current.status === 'settled') return { changed: false, row: current }
        const released = await tx.creativeProviderCostLedger.updateMany({
          where: { id: current.id, status: current.status },
          data: { status: 'released', reasonCode, releasedAt: new Date() },
        })
        if (released.count !== 1) {
          const duplicate = await tx.creativeProviderCostLedger.findUnique({
            where: { id: current.id },
            include: { budgetWindow: true },
          })
          if (duplicate?.status === 'released' || duplicate?.status === 'settled') {
            return { changed: false, row: duplicate }
          }
          throw providerCostConflict('concurrent_lifecycle_change')
        }
        await tx.creativeProviderBudgetWindow.update({
          where: { id: current.budgetWindowId },
          data: {
            reservedMicros: { decrement: current.reservedMicros },
            releasedMicros: { increment: current.reservedMicros },
          },
        })
        const row = await tx.creativeProviderCostLedger.findUnique({
          where: { id: current.id },
          include: { budgetWindow: true },
        })
        return { changed: true, row }
      })
      if (!outcome) return null
      const dto = getCreativeProviderCostLedgerDto(outcome.row)
      if (outcome.changed) await recordAudit({
        actor,
        action: 'creative.provider_cost.released',
        resourceType: 'creative_provider_cost_ledger',
        resourceId: dto.id,
        metadata: { generationId: dto.generationId, providerId: dto.providerId, workspace: dto.workspace, reasonCode },
      })
      return dto
    },
    reconcile: async (sourceKey, payload = {}, actor) => {
      const outcome = await client.$transaction(async (tx) => {
        const current = await tx.creativeProviderCostLedger.findUnique({
          where: { sourceKey: String(sourceKey) },
          include: { budgetWindow: true },
        })
        if (!current) return null
        if (['settled', 'released', 'reconciliation_required'].includes(current.status)) {
          return { changed: false, row: current }
        }
        const reconciled = await tx.creativeProviderCostLedger.updateMany({
          where: { id: current.id, status: current.status },
          data: {
            status: 'reconciliation_required',
            providerJobId: payload.providerJobId ?? current.providerJobId,
            usage: payload.usage ?? current.usage ?? undefined,
            risk: payload.risk ?? current.risk ?? undefined,
            reasonCode: payload.reasonCode ?? 'actual_cost_missing',
            reconciliationAt: payload.reconciliationAt ? new Date(payload.reconciliationAt) : new Date(),
          },
        })
        if (reconciled.count !== 1) {
          const duplicate = await tx.creativeProviderCostLedger.findUnique({
            where: { id: current.id },
            include: { budgetWindow: true },
          })
          if (['settled', 'released', 'reconciliation_required'].includes(duplicate?.status)) {
            return { changed: false, row: duplicate }
          }
          throw providerCostConflict('concurrent_lifecycle_change')
        }
        const row = await tx.creativeProviderCostLedger.findUnique({
          where: { id: current.id },
          include: { budgetWindow: true },
        })
        return { changed: true, row }
      })
      if (!outcome) return null
      const dto = getCreativeProviderCostLedgerDto(outcome.row)
      if (outcome.changed) await recordAudit({
        actor,
        action: 'creative.provider_cost.reconciliation_required',
        resourceType: 'creative_provider_cost_ledger',
        resourceId: dto.id,
        metadata: {
          generationId: dto.generationId,
          providerId: dto.providerId,
          workspace: dto.workspace,
          currency: dto.currency,
          reasonCode: dto.reasonCode,
        },
      })
      return dto
    },
    getBudgetWindow: async (payload) => {
      const row = await client.creativeProviderBudgetWindow.findUnique({
        where: {
          budgetScope_currency_windowStart_windowEnd: {
            budgetScope: payload.budgetScope,
            currency: payload.currency,
            windowStart: new Date(payload.windowStart),
            windowEnd: new Date(payload.windowEnd),
          },
        },
      })
      return row ? getCreativeProviderBudgetWindowDto(row) : null
    },
  }

  const creativeCredits = {
    reserve: async (payload, actor) => {
      const actorUser = payload.actorHandle || actor?.handle ? await findUserByHandle(payload.actorHandle ?? actor.handle) : null
      const amount = Math.max(0, Number.parseInt(String(payload.amount ?? payload.estimatedCredits ?? 0), 10) || 0)
      const existing = payload.quotaReservationId
        ? await client.creativeCreditLedger.findUnique({ where: { quotaReservationId: String(payload.quotaReservationId) } })
        : null
      if (existing) {
        return {
          reserved: existing.status === 'reserved',
          credit: getCreativeCreditDto(existing),
        }
      }
      const ledger = await client.creativeCreditLedger.create({
        data: {
          id: `credit-${randomUUID()}`,
          generationId: String(payload.generationId ?? ''),
          quotaReservationId: payload.quotaReservationId ?? null,
          actorId: actorUser?.id ?? null,
          actorHandle: payload.actorHandle ?? actorUser?.profile?.handle ?? null,
          workspace: payload.workspace,
          mode: payload.mode,
          reservationAmount: amount,
          settledAmount: 0,
          refundedAmount: 0,
          status: 'reserved',
          reasonCode: safeErrorPreview(payload.reasonCode ?? 'generation_reserved'),
          metadata: safeCreativeCreditMetadata(payload.metadata) ?? undefined,
        },
      })
      await client.auditEvent.create({
        data: buildAuditRecord({
          actorType: actor ? 'user' : 'system',
          actorId: actor?.id ?? null,
          action: 'creative.credit.reserved',
          resourceType: 'creative_credit_ledger',
          resourceId: ledger.id,
          metadata: {
            generationId: ledger.generationId,
            quotaReservationId: ledger.quotaReservationId,
            workspace: ledger.workspace,
            mode: ledger.mode,
            amount,
          },
        }),
      })
      return {
        reserved: true,
        credit: getCreativeCreditDto(ledger),
      }
    },
    settle: async (reference, payload = {}, actor) => {
      return client.$transaction(async (transaction) => {
        const ledger = await findCreativeCreditLedger(transaction, reference)
        if (!ledger) {
          return null
        }
        if (ledger.status !== 'reserved') {
          return getCreativeCreditDto(ledger)
        }
        const settledAmount = Math.max(0, Number.parseInt(String(payload.settledAmount ?? ledger.reservationAmount), 10) || 0)
        const updated = await transaction.creativeCreditLedger.update({
          where: { id: ledger.id },
          data: {
            status: 'settled',
            settledAmount,
            refundedAmount: 0,
            reasonCode: safeErrorPreview(payload.reasonCode ?? 'generation_completed'),
            metadata: safeCreativeCreditMetadata(payload.metadata) ?? ledger.metadata ?? undefined,
            settledAt: new Date(),
          },
        })
        await transaction.auditEvent.create({
          data: buildAuditRecord({
            actorType: actor ? 'user' : 'system',
            actorId: actor?.id ?? null,
            action: 'creative.credit.settled',
            resourceType: 'creative_credit_ledger',
            resourceId: updated.id,
            metadata: {
              generationId: updated.generationId,
              quotaReservationId: updated.quotaReservationId,
              workspace: updated.workspace,
              mode: updated.mode,
              settledAmount,
            },
          }),
        })
        return getCreativeCreditDto(updated)
      })
    },
    refund: async (reference, payload = {}, actor) => {
      return client.$transaction(async (transaction) => {
        const ledger = await findCreativeCreditLedger(transaction, reference)
        if (!ledger) {
          return null
        }
        if (ledger.status !== 'reserved') {
          return getCreativeCreditDto(ledger)
        }
        const refundedAmount = Math.max(0, Number.parseInt(String(payload.refundedAmount ?? ledger.reservationAmount), 10) || 0)
        const updated = await transaction.creativeCreditLedger.update({
          where: { id: ledger.id },
          data: {
            status: 'refunded',
            settledAmount: 0,
            refundedAmount,
            reasonCode: safeErrorPreview(payload.reasonCode ?? 'generation_failed'),
            metadata: safeCreativeCreditMetadata(payload.metadata) ?? ledger.metadata ?? undefined,
            refundedAt: new Date(),
          },
        })
        await transaction.auditEvent.create({
          data: buildAuditRecord({
            actorType: actor ? 'user' : 'system',
            actorId: actor?.id ?? null,
            action: 'creative.credit.refunded',
            resourceType: 'creative_credit_ledger',
            resourceId: updated.id,
            metadata: {
              generationId: updated.generationId,
              quotaReservationId: updated.quotaReservationId,
              workspace: updated.workspace,
              mode: updated.mode,
              refundedAmount,
              reasonCode: updated.reasonCode,
            },
          }),
        })
        return getCreativeCreditDto(updated)
      })
    },
    cancel: async (reference, payload = {}, actor) => {
      return client.$transaction(async (transaction) => {
        const ledger = await findCreativeCreditLedger(transaction, reference)
        if (!ledger) {
          return null
        }
        if (ledger.status !== 'reserved') {
          return getCreativeCreditDto(ledger)
        }
        const updated = await transaction.creativeCreditLedger.update({
          where: { id: ledger.id },
          data: {
            status: 'cancelled',
            settledAmount: 0,
            refundedAmount: 0,
            reasonCode: safeErrorPreview(payload.reasonCode ?? 'no_charge'),
            metadata: safeCreativeCreditMetadata(payload.metadata) ?? ledger.metadata ?? undefined,
            cancelledAt: new Date(),
          },
        })
        await transaction.auditEvent.create({
          data: buildAuditRecord({
            actorType: actor ? 'user' : 'system',
            actorId: actor?.id ?? null,
            action: 'creative.credit.cancelled',
            resourceType: 'creative_credit_ledger',
            resourceId: updated.id,
            metadata: {
              generationId: updated.generationId,
              quotaReservationId: updated.quotaReservationId,
              workspace: updated.workspace,
              mode: updated.mode,
              reasonCode: updated.reasonCode,
            },
          }),
        })
        return getCreativeCreditDto(updated)
      })
    },
  }

  const creativeQuota = {
    reserve: async (payload, actor) => {
      const units = Math.max(1, Number(payload.costUnits) || 1)
      const actorUser = payload.actorHandle || actor?.handle ? await findUserByHandle(payload.actorHandle ?? actor.handle) : null
      const windowId = creativeQuotaWindowId(payload)
      return client.$transaction(async (transaction) => {
        await transaction.creativeQuotaWindow.upsert({
          where: { id: windowId },
          create: {
            id: windowId,
            actorId: actorUser?.id ?? null,
            actorHandle: payload.actorHandle ?? actorUser?.profile?.handle ?? null,
            workspace: payload.workspace,
            windowType: payload.windowType,
            windowStart: new Date(payload.windowStart),
            windowEnd: new Date(payload.windowEnd),
            limitUnits: payload.limit,
            reservedUnits: 0,
            usedUnits: 0,
            releasedUnits: 0,
            policyVersion: payload.policyVersion,
          },
          update: {
            limitUnits: payload.limit,
            policyVersion: payload.policyVersion,
          },
        })
        const updatedCount = await transaction.$executeRaw`
          UPDATE "creative_quota_windows"
          SET "reserved_units" = "reserved_units" + ${units}, "updated_at" = NOW()
          WHERE "id" = ${windowId}
            AND ("used_units" + "reserved_units" + ${units}) <= "limit_units"
        `
        const reserved = Number(updatedCount) === 1
        const window = await transaction.creativeQuotaWindow.findUnique({ where: { id: windowId } })
        if (!reserved) {
          return {
            reserved: false,
            quota: window ? getCreativeQuotaDto(window) : null,
          }
        }
        const reservation = await transaction.creativeQuotaReservation.create({
          data: {
            id: `quota-${randomUUID()}`,
            quotaWindowId: windowId,
            generationId: String(payload.generationId ?? ''),
            actorId: actorUser?.id ?? null,
            actorHandle: payload.actorHandle ?? actorUser?.profile?.handle ?? null,
            workspace: payload.workspace,
            units,
            status: 'reserved',
          },
        })
        await transaction.auditEvent.create({
          data: buildAuditRecord({
            actorType: actor ? 'user' : 'system',
            actorId: actor?.id ?? null,
            action: 'creative.quota.reserved',
            resourceType: 'creative_quota_reservation',
            resourceId: reservation.id,
            metadata: {
              generationId: reservation.generationId,
              workspace: reservation.workspace,
              units,
              quotaWindowId: windowId,
            },
          }),
        })
        const reservedWindow = await transaction.creativeQuotaWindow.findUnique({ where: { id: windowId } })
        return {
          reserved: true,
          reservationId: reservation.id,
          quota: getCreativeQuotaDto(reservedWindow, reservation.id),
        }
      })
    },
    commit: async (reservationId, actor) => {
      return client.$transaction(async (transaction) => {
        const reservation = await transaction.creativeQuotaReservation.findUnique({
          where: { id: String(reservationId) },
          include: { quotaWindow: true },
        })
        if (!reservation) {
          return null
        }
        if (reservation.status !== 'reserved') {
          return getCreativeQuotaDto(reservation.quotaWindow, reservation.id)
        }
        await transaction.creativeQuotaWindow.update({
          where: { id: reservation.quotaWindowId },
          data: {
            reservedUnits: { decrement: reservation.units },
            usedUnits: { increment: reservation.units },
          },
        })
        const updatedReservation = await transaction.creativeQuotaReservation.update({
          where: { id: reservation.id },
          data: {
            status: 'committed',
            committedAt: new Date(),
          },
        })
        await transaction.auditEvent.create({
          data: buildAuditRecord({
            actorType: actor ? 'user' : 'system',
            actorId: actor?.id ?? null,
            action: 'creative.quota.committed',
            resourceType: 'creative_quota_reservation',
            resourceId: updatedReservation.id,
            metadata: {
              generationId: updatedReservation.generationId,
              workspace: updatedReservation.workspace,
              units: updatedReservation.units,
            },
          }),
        })
        const window = await transaction.creativeQuotaWindow.findUnique({ where: { id: reservation.quotaWindowId } })
        return getCreativeQuotaDto(window, updatedReservation.id)
      })
    },
    release: async (reservationId, reason = 'released', actor) => {
      return client.$transaction(async (transaction) => {
        const reservation = await transaction.creativeQuotaReservation.findUnique({
          where: { id: String(reservationId) },
          include: { quotaWindow: true },
        })
        if (!reservation) {
          return null
        }
        if (reservation.status !== 'reserved') {
          return getCreativeQuotaDto(reservation.quotaWindow, reservation.id)
        }
        const safeReason = safeErrorPreview(reason)
        await transaction.creativeQuotaWindow.update({
          where: { id: reservation.quotaWindowId },
          data: {
            reservedUnits: { decrement: reservation.units },
            releasedUnits: { increment: reservation.units },
          },
        })
        const updatedReservation = await transaction.creativeQuotaReservation.update({
          where: { id: reservation.id },
          data: {
            status: 'released',
            reason: safeReason,
            releasedAt: new Date(),
          },
        })
        await transaction.auditEvent.create({
          data: buildAuditRecord({
            actorType: actor ? 'user' : 'system',
            actorId: actor?.id ?? null,
            action: 'creative.quota.released',
            resourceType: 'creative_quota_reservation',
            resourceId: updatedReservation.id,
            metadata: {
              generationId: updatedReservation.generationId,
              workspace: updatedReservation.workspace,
              units: updatedReservation.units,
              reason: safeReason,
            },
          }),
        })
        const window = await transaction.creativeQuotaWindow.findUnique({ where: { id: reservation.quotaWindowId } })
        return getCreativeQuotaDto(window, updatedReservation.id)
      })
    },
    getQuotaWindow: async (payload) => {
      const window = await client.creativeQuotaWindow.findUnique({ where: { id: creativeQuotaWindowId(payload) } })
      return window ? getCreativeQuotaDto(window) : null
    },
  }

  const media = {
    find: async (id) => {
      const asset = await client.mediaAsset.findUnique({ where: { id: String(id) } })
      return asset ? getMediaAssetDto(asset) : null
    },
    findAccessibleCreativeInput: async (id, actor) => {
      const asset = await client.mediaAsset.findUnique({
        where: { id: String(id) },
        include: { owner: { include: { profile: true } } },
      })
      if (!asset) return null
      const ownerHandle = asset.owner?.profile?.handle ?? asset.owner?.id ?? null
      if (ownerHandle !== actor.handle && !hasPermission(actor, 'admin:access')) return null
      return getMediaAssetDto(asset)
    },
    listCreativeInputs: async (actor, options = {}) => {
      const owner = await findUserByHandle(actor.handle)
      if (!owner) return { items: [], limit: options.limit ?? 24, nextCursor: null }
      const limit = Math.min(Math.max(Number(options.limit ?? 24), 1), 100)
      const assets = await client.mediaAsset.findMany({
        where: {
          ownerId: owner.id,
          status: 'uploaded',
          purpose: { in: ['submission_asset', 'profile_portfolio', 'library_asset'] },
          contentType: { in: ['image/png', 'image/jpeg', 'image/webp'] },
          metadata: { path: ['security', 'scanStatus'], equals: 'clean' },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(options.cursor ? { cursor: { id: String(options.cursor) }, skip: 1 } : {}),
      })
      const page = assets.slice(0, limit)
      return {
        items: page.map(getMediaAssetDto),
        limit,
        nextCursor: assets.length > limit ? page.at(-1)?.id ?? null : null,
      }
    },
    getGovernancePolicy: async () => getMediaGovernancePolicy(),
    updateGovernancePolicy: async (patch, actor) => updateMediaGovernancePolicy(patch, actor),
    listGovernancePolicyHistory: async (options = {}) => listMediaGovernancePolicyHistory(options),
    rollbackGovernancePolicy: async (eventId, actor) => rollbackMediaGovernancePolicy(eventId, actor),
    createUpload: async (payload, actor) => {
      const owner = await findUserByHandle(actor.handle)
      if (!owner) {
        return null
      }
      const id = `media-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
      const asset = await client.mediaAsset.create({
        data: {
          id,
          ownerId: owner.id,
          fileName: payload.fileName,
          storageKey: makeStorageKey(actor, payload, id),
          contentType: payload.contentType,
          sizeBytes: payload.sizeBytes,
          purpose: payload.purpose,
          status: 'pending',
          metadata: payload.metadata ?? null,
        },
      })
      await recordAudit({
        actor,
        action: 'media.upload.created',
        resourceType: 'media_asset',
        resourceId: asset.id,
        metadata: {
          purpose: asset.purpose,
          sizeBytes: asset.sizeBytes,
        },
      })
      return makeUploadContract(asset)
    },
    completeUpload: async (id, payload, actor) => {
      const asset = await client.mediaAsset.findUnique({
        where: { id: String(id) },
        include: { owner: { include: { profile: true } } },
      })
      if (!asset) {
        return null
      }
      const ownerHandle = asset.owner?.profile?.handle ?? asset.owner?.id ?? null
      if (ownerHandle !== actor.handle && !hasPermission(actor, 'admin:access')) {
        return null
      }
      const detectedContentType = payload.detectedContentType || asset.contentType
      const contentTypeMatches = detectedContentType.toLowerCase() === asset.contentType.toLowerCase()
      const scanResult = contentTypeMatches ? await scanMediaAsset(asset) : null
      const scanJob = contentTypeMatches ? await createMediaScanJob(asset, scanResult) : null
      const updated = await client.mediaAsset.update({
        where: { id: asset.id },
        data: {
          status: contentTypeMatches && scanResult?.status !== 'rejected' ? 'uploaded' : 'rejected',
          metadata: compactObject({
            ...mediaSecurityMetadata(asset, {
              checksum: payload.checksum,
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
            checksum: payload.checksum,
          }),
        },
      })
      const updatedWithJob = mediaAssetWithScanJob(updated, scanJob)
      await recordAudit({
        actor,
        action: 'media.upload.completed',
        resourceType: 'media_asset',
        resourceId: updated.id,
        metadata: {
          purpose: updated.purpose,
          scanStatus: asObject(asObject(updatedWithJob.metadata)?.security)?.scanStatus,
        },
      })
      return getMediaAssetDto(updatedWithJob)
    },
    createGeneratedAsset: async (payload, actor) => {
      const owner = await findUserByHandle(actor.handle)
      if (!owner) {
        return null
      }
      const id = `media-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
      const storageKey = makeGeneratedStorageKey(actor, payload, id)
      const storage = await writeStorageObject({
        body: payload.artifact.body,
        contentType: payload.artifact.contentType,
        storageKey,
      })
      const asset = await client.mediaAsset.create({
        data: {
          id,
          ownerId: owner.id,
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
        },
      })
      const scanResult = await scanMediaAsset(asset)
      const scanJob = await createMediaScanJob(asset, scanResult)
      const policyReviewRequired = Boolean(payload.generation.safety?.reviewRequired)
      const effectiveScanStatus = policyReviewRequired ? 'review' : scanResult?.status ?? 'pending'
      const updated = await client.mediaAsset.update({
        where: { id: asset.id },
        data: {
          status: effectiveScanStatus === 'rejected' ? 'rejected' : 'uploaded',
          metadata: compactObject({
            ...mediaSecurityMetadata(asset, {
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
          }),
        },
      })
      const updatedWithJob = mediaAssetWithScanJob(updated, scanJob)
      await recordAudit({
        actor,
        action: 'media.generated_asset.created',
        resourceType: 'media_asset',
        resourceId: updated.id,
        metadata: {
          generationId: payload.generation.id,
          outputId: payload.output.id,
          workspace: payload.generation.workspace,
          providerId: payload.generation.provider.id,
          scanStatus: asObject(asObject(updatedWithJob.metadata)?.security)?.scanStatus,
          creativeReviewRequired: policyReviewRequired,
        },
      })
      if (policyReviewRequired) {
        await recordAudit({
          actor,
          action: 'creative.generation.review_required',
          resourceType: 'media_asset',
          resourceId: updated.id,
          metadata: {
            generationId: payload.generation.id,
            outputId: payload.output.id,
            workspace: payload.generation.workspace,
            providerId: payload.generation.provider.id,
            reasons: payload.generation.safety?.reasons ?? [],
          },
        })
        await notifyMediaQueueReaders(client, actor, {
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
      return getMediaAssetDto(updatedWithJob)
    },
    createIngestedAsset: async (payload, actor) => {
      const existing = await client.mediaAsset.findUnique({ where: { storageKey: payload.storageKey } })
      if (existing) return getMediaAssetDto(existing)
      const owner = await findUserByHandle(actor.handle)
      if (!owner) return null
      const storage = await writeStorageObject({
        body: payload.body,
        contentType: payload.contentType,
        storageKey: payload.storageKey,
      })
      let asset
      try {
        asset = await client.mediaAsset.create({
          data: {
            id: payload.assetId,
            ownerId: owner.id,
            fileName: payload.fileName,
            storageKey: payload.storageKey,
            contentType: payload.contentType,
            sizeBytes: storage.bytes,
            purpose: 'library_asset',
            status: 'pending',
            metadata: {
              creative: payload.metadata,
              ingestion: {
                sourceKey: payload.sourceKey,
                sha256: payload.sha256,
                sizeBytes: payload.sizeBytes,
                detectedContentType: payload.contentType,
              },
              storage: {
                provider: storage.provider,
                writtenAt: storage.writtenAt,
              },
            },
          },
        })
      } catch (error) {
        if (error?.code !== 'P2002') throw error
        const duplicate = await client.mediaAsset.findUnique({ where: { storageKey: payload.storageKey } })
        if (!duplicate) throw error
        return getMediaAssetDto(duplicate)
      }
      const scanResult = await scanMediaAsset(asset)
      const scanJob = await createMediaScanJob(asset, scanResult)
      const policyReviewRequired = Boolean(payload.generation.safety?.reviewRequired)
      const effectiveScanStatus = policyReviewRequired ? 'review' : scanResult?.status ?? 'pending'
      const updated = await client.mediaAsset.update({
        where: { id: asset.id },
        data: {
          status: effectiveScanStatus === 'rejected' ? 'rejected' : 'uploaded',
          metadata: mediaSecurityMetadata(asset, {
            checksum: `sha256:${payload.sha256}`,
            declaredContentType: payload.contentType,
            detectedContentType: payload.contentType,
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
        },
      })
      const updatedWithJob = mediaAssetWithScanJob(updated, scanJob)
      await recordAudit({
        actor,
        action: 'media.provider_output_ingested',
        resourceType: 'media_asset',
        resourceId: updated.id,
        metadata: {
          generationId: payload.generation.id,
          outputId: payload.output.id,
          providerId: payload.generation.provider?.id ?? payload.generation.providerId,
          sourceKey: payload.sourceKey,
          contentType: payload.contentType,
          sizeBytes: payload.sizeBytes,
          sha256: payload.sha256,
          scanStatus: effectiveScanStatus,
        },
      })
      return getMediaAssetDto(updatedWithJob)
    },
    listReviewQueue: async (options = {}) => {
      const limit = options.limit ?? 20
      const cursor = options.cursor
        ? await client.mediaAsset.findUnique({ where: { id: String(options.cursor) }, select: { id: true } })
        : null
      const rows = await client.mediaAsset.findMany({
        where: {
          ...(options.purpose ? { purpose: options.purpose } : {}),
          ...(options.search
            ? {
                OR: [
                  { fileName: { contains: options.search, mode: 'insensitive' } },
                  { id: { contains: options.search, mode: 'insensitive' } },
                  { storageKey: { contains: options.search, mode: 'insensitive' } },
                  { contentType: { contains: options.search, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        orderBy: { updatedAt: 'desc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
      })
      const filteredRows = options.status ? rows.filter((asset) => mediaAssetScanStatus(asset) === options.status) : rows
      const pageRows = filteredRows.slice(0, limit)
      return {
        items: pageRows.map(getMediaAssetDto),
        nextCursor: filteredRows.length > limit && pageRows.length > 0 ? pageRows[pageRows.length - 1].id : null,
        limit,
      }
    },
    listScanJobs: async (options = {}) => {
      const limit = options.limit ?? 20
      const cursor = options.cursor
        ? await client.mediaScanJob.findUnique({ where: { id: String(options.cursor) }, select: { id: true } })
        : null
      const rows = await client.mediaScanJob.findMany({
        where: {
          ...(options.purpose ? { asset: { purpose: options.purpose } } : {}),
          ...(options.search
            ? {
                OR: [
                  { id: { contains: options.search, mode: 'insensitive' } },
                  { externalScanId: { contains: options.search, mode: 'insensitive' } },
                  { assetId: { contains: options.search, mode: 'insensitive' } },
                  { asset: { fileName: { contains: options.search, mode: 'insensitive' } } },
                  { asset: { storageKey: { contains: options.search, mode: 'insensitive' } } },
                  { asset: { contentType: { contains: options.search, mode: 'insensitive' } } },
                ],
              }
            : {}),
        },
        include: { asset: true },
        orderBy: { updatedAt: 'desc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
      })
      const filteredRows = rows.filter((job) => {
        const status = mediaScanJobStatusFromRow(job)
        if (!status) return false
        if (!options.status || options.status === 'active') {
          return ['queued', 'retrying', 'timed_out'].includes(status)
        }
        return status === options.status
      })
      const pageRows = filteredRows.slice(0, limit)
      return {
        items: pageRows.map((job) => getMediaAssetDto(mediaAssetWithScanJob(job.asset, job))),
        nextCursor: filteredRows.length > limit && pageRows.length > 0 ? pageRows[pageRows.length - 1].id : null,
        limit,
      }
    },
    exportScanJobArchive: async (options = {}) => exportMediaScanJobArchive(options),
    archiveScanJobHistory: async (options = {}, actor = null) => archiveMediaScanJobHistory(options, actor),
    listScanJobHistory: async (id, options = {}) => {
      const asset = await client.mediaAsset.findUnique({
        where: { id: String(id) },
        select: { id: true },
      })
      if (!asset) {
        return null
      }
      const limit = options.limit ?? 10
      const cursor = options.cursor
        ? await client.mediaScanJob.findFirst({
            where: { id: String(options.cursor), assetId: asset.id },
            select: { id: true },
          })
        : null
      const rows = await client.mediaScanJob.findMany({
        where: { assetId: asset.id },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
      })
      const pageRows = rows.slice(0, limit)
      return {
        items: pageRows.map(getMediaScanJobDto),
        nextCursor: rows.length > limit && pageRows.length > 0 ? pageRows[pageRows.length - 1].id : null,
        limit,
      }
    },
    listScanAlerts: async () => getPrismaMediaScanAlerts(),
    listScanAlertEvents: async (id, options = {}) => getPrismaMediaScanAlertEvents(id, options),
    acknowledgeScanAlert: async (id, payload, actor) => recordMediaScanAlertDisposition(id, 'acknowledged', payload, actor),
    silenceScanAlert: async (id, payload, actor) => recordMediaScanAlertDisposition(id, 'silenced', payload, actor),
    unsilenceScanAlert: async (id, payload, actor) => recordMediaScanAlertDisposition(id, 'unsilenced', payload, actor),
    reviewUpload: async (id, payload, actor) => {
      const asset = await client.mediaAsset.findUnique({
        where: { id: String(id) },
      })
      if (!asset) {
        return null
      }
      const metadata = asObject(asset.metadata) ?? {}
      const security = asObject(metadata.security) ?? {}
      const reviewedAt = new Date()
      const updated = await client.mediaAsset.update({
        where: { id: asset.id },
        data: {
          status: payload.decision === 'clean' ? 'uploaded' : 'rejected',
          metadata: mediaSecurityMetadata(asset, {
            scanStatus: payload.decision === 'clean' ? 'clean' : 'rejected',
            detectedContentType: payload.detectedContentType || security.detectedContentType || asset.contentType,
            scanNote: payload.note,
            scannedBy: actor.handle,
            scannedAt: reviewedAt.toISOString(),
            scanJobStatus: 'completed',
          }),
        },
      })
      const job = await updateLatestMediaScanJob(asset, {
        status: 'completed',
        scanStatus: payload.decision === 'clean' ? 'clean' : 'rejected',
        note: payload.note,
        rejectionReason: payload.decision === 'clean' ? undefined : 'manual_rejection',
        reviewedById: actor.id,
        reviewedAt,
      })
      await recordAudit({
        actor,
        action: `media.scan.${payload.decision}`,
        resourceType: 'media_asset',
        resourceId: updated.id,
        metadata: {
          purpose: updated.purpose,
        },
      })
      return getMediaAssetDto(mediaAssetWithScanJob(updated, job))
    },
    recordScanCallback: async (id, payload) => {
      const asset = await client.mediaAsset.findUnique({
        where: { id: String(id) },
      })
      if (!asset) {
        return null
      }
      const metadata = asObject(asset.metadata) ?? {}
      const security = asObject(metadata.security) ?? {}
      const callbackAt = new Date()
      const updated = await client.mediaAsset.update({
        where: { id: asset.id },
        data: {
          status: payload.status === 'rejected' ? 'rejected' : 'uploaded',
          metadata: mediaSecurityMetadata(asset, {
            scanStatus: payload.status,
            detectedContentType: payload.detectedContentType || security.detectedContentType || asset.contentType,
            scanNote: payload.note,
            rejectionReason: payload.status === 'rejected' ? payload.reason || security.rejectionReason : undefined,
            externalScanId: payload.externalScanId || security.externalScanId,
            callbackReceivedAt: callbackAt.toISOString(),
            scanJobStatus: payload.status === 'rejected' ? 'failed' : 'completed',
          }),
        },
      })
      const job = await updateLatestMediaScanJob(asset, {
        externalScanId: payload.externalScanId || security.externalScanId,
        status: payload.status === 'rejected' ? 'failed' : 'completed',
        scanStatus: payload.status,
        note: payload.note,
        rejectionReason: payload.status === 'rejected' ? payload.reason || security.rejectionReason : undefined,
        callbackAt,
      })
      await recordAudit({
        actor: null,
        action: 'media.scan.callback',
        resourceType: 'media_asset',
        resourceId: updated.id,
        metadata: {
          purpose: updated.purpose,
          scanStatus: payload.status,
          externalScanId: payload.externalScanId || security.externalScanId,
        },
      })
      if (payload.status === 'review' || payload.status === 'rejected') {
        await notifyMediaQueueReaders(client, null, {
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
            externalScanId: payload.externalScanId || security.externalScanId,
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
      return getMediaAssetDto(mediaAssetWithScanJob(updated, job))
    },
    recordScanCallbackFailure: async (id, payload) => {
      await recordAudit({
        actor: null,
        action: 'media.scan.callback_denied',
        resourceType: 'media_asset',
        resourceId: String(id),
        metadata: {
          reason: payload.reason,
          code: payload.code,
          statusCode: payload.statusCode,
          scanStatus: payload.scanStatus ?? null,
          externalScanId: payload.externalScanId ?? null,
          remoteAddress: payload.remoteAddress ?? null,
          headers: payload.headers ?? {},
        },
      })
      await notifyMediaScanAlerts(client, null)
    },
    retryScan: async (id, actor) => {
      const asset = await client.mediaAsset.findUnique({
        where: { id: String(id) },
      })
      if (!asset) {
        return null
      }
      const scanResult = await retryMediaScanAsset(asset)
      const scanJob = await createMediaScanJob(asset, scanResult)
      const updated = await client.mediaAsset.update({
        where: { id: asset.id },
        data: {
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
        },
      })
      const updatedWithJob = mediaAssetWithScanJob(updated, scanJob)
      await recordAudit({
        actor,
        action: 'media.scan.retry',
        resourceType: 'media_asset',
        resourceId: updated.id,
        metadata: {
          purpose: updated.purpose,
          scanAttempts: asObject(asObject(updatedWithJob.metadata)?.security)?.scanAttempts,
          externalScanId: asObject(asObject(updatedWithJob.metadata)?.security)?.externalScanId,
        },
      })
      const updatedSecurity = asObject(asObject(updatedWithJob.metadata)?.security) ?? {}
      await notifyMediaQueueReaders(client, actor, {
        type: 'media.scan.retry_requested',
        title: `Media scan retry: ${updated.fileName}`,
        body: `${actor.handle} requeued ${updated.fileName} for external scanning.`,
        resourceType: 'media_asset',
        resourceId: updated.id,
        metadata: {
          assetId: updated.id,
          fileName: updated.fileName,
          purpose: updated.purpose,
          scanStatus: updatedSecurity.scanStatus,
          scanAttempts: updatedSecurity.scanAttempts,
          externalScanId: updatedSecurity.externalScanId,
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
      return getMediaAssetDto(updatedWithJob)
    },
    sweepScanJobs: async ({ actor = null } = {}) => {
      const policy = await getMediaGovernancePolicy()
      const maxAttempts = policy.scanner.maxAttempts
      const timedOut = await client.mediaScanJob.findMany({
        where: {
          status: { in: ['queued', 'retrying'] },
          timeoutAt: { lt: new Date() },
        },
        include: { asset: true },
        orderBy: { updatedAt: 'desc' },
      })
      let retried = 0
      let failed = 0
      const items = []
      for (const job of timedOut) {
        const asset = mediaAssetWithScanJob(job.asset, job)
        const security = asObject(asObject(asset.metadata)?.security) ?? {}
        const attempts = Number(job.attempts ?? security.scanAttempts ?? 0)
        if (attempts >= maxAttempts) {
          const failedAt = new Date()
          const updated = await client.mediaAsset.update({
            where: { id: asset.id },
            data: {
              status: 'uploaded',
              metadata: mediaSecurityMetadata(asset, {
                scanStatus: 'review',
                scanJobStatus: 'failed',
                scanNote: 'External scan timed out after maximum attempts. Manual review required.',
                rejectionReason: 'scan_timeout',
                failedAt: failedAt.toISOString(),
                nextRetryAt: null,
              }),
            },
          })
          const failedJob = await updateMediaScanJob(job.id, {
            status: 'failed',
            scanStatus: 'review',
            note: 'External scan timed out after maximum attempts. Manual review required.',
            rejectionReason: 'scan_timeout',
            failedAt,
            nextRetryAt: null,
          })
          await recordAudit({
            actor,
            action: 'media.scan.timeout',
            resourceType: 'media_asset',
            resourceId: updated.id,
            metadata: {
              purpose: updated.purpose,
              scanAttempts: attempts,
              externalScanId: security.externalScanId,
            },
          })
          await notifyMediaQueueReaders(client, actor, {
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
          items.push(getMediaAssetDto(mediaAssetWithScanJob(updated, failedJob)))
          continue
        }
        const scanResult = await retryMediaScanAsset(asset)
        const scanJob = await createMediaScanJob(asset, scanResult, {
          note: 'External scan automatically retried after timeout.',
        })
        const updated = await client.mediaAsset.update({
          where: { id: asset.id },
          data: {
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
          },
        })
        await recordAudit({
          actor,
          action: 'media.scan.retry.auto',
          resourceType: 'media_asset',
          resourceId: updated.id,
          metadata: {
            purpose: updated.purpose,
            scanAttempts: asObject(asObject(updated.metadata)?.security)?.scanAttempts,
            externalScanId: asObject(asObject(updated.metadata)?.security)?.externalScanId,
          },
        })
        retried += 1
        items.push(getMediaAssetDto(mediaAssetWithScanJob(updated, scanJob)))
      }
      const pruneResult = await pruneMediaScanJobHistory(actor, policy)
      await notifyMediaScanAlerts(client, actor)
      return {
        inspected: timedOut.length,
        retried,
        failed,
        pruned: pruneResult.pruned,
        retention: pruneResult.retention,
        items,
      }
    },
    createDownload: async (id, actor) => {
      const asset = await client.mediaAsset.findUnique({
        where: { id: String(id) },
        include: { owner: { include: { profile: true } } },
      })
      if (!asset) {
        return null
      }
      const ownerHandle = asset.owner?.profile?.handle ?? asset.owner?.id ?? null
      const scanStatus = asObject(asObject(asset.metadata)?.security)?.scanStatus
      if (ownerHandle !== actor.handle && !hasPermission(actor, 'admin:access')) {
        return null
      }
      if (asset.status !== 'uploaded' || scanStatus !== 'clean') {
        return null
      }
      await recordAudit({
        actor,
        action: 'media.download.signed',
        resourceType: 'media_asset',
        resourceId: asset.id,
        metadata: {
          purpose: asset.purpose,
        },
      })
      return makeDownloadContract(asset)
    },
  }

  const library = {
    list: async (options = {}) => {
      const limit = options.limit ?? 20
      const cursor = options.cursor
        ? await client.libraryItem.findUnique({ where: { id: String(options.cursor) }, select: { id: true } })
        : null
      const rows = await client.libraryItem.findMany({
        where: {
          ...(options.type ? { sourceType: options.type } : {}),
          ...(options.sourceId ? { sourceId: options.sourceId } : {}),
          ...(options.search ? {
            OR: [
              { title: { contains: options.search, mode: 'insensitive' } },
              { content: { contains: options.search, mode: 'insensitive' } },
            ],
          } : {}),
        },
        include: { user: { include: { profile: true } } },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
      })
      const pageRows = rows.slice(0, limit)
      return {
        items: pageRows.map((row) => ({
        id: row.id,
        title: row.title,
        type: row.metadata?.type ?? row.sourceType,
        source: row.metadata?.source ?? row.sourceType,
        saves: String(row.metadata?.saves ?? 1),
        text: row.content,
        sourceId: row.sourceId ?? null,
        metadata: row.metadata ?? null,
        })),
        nextCursor: rows.length > limit && pageRows.length > 0 ? pageRows[pageRows.length - 1].id : null,
        limit,
      }
    },
    save: async (payload, actor) => {
      const user = await client.user.findFirst({
        where: { profile: { handle: actor.handle } },
      })
      if (!user) {
        return null
      }
      const row = await client.libraryItem.create({
        data: buildLibraryItemRecord({
          title: payload.title,
          content: payload.text,
          sourceType: payload.sourceType ?? 'post',
          sourceId: payload.sourceId ?? null,
          metadata: payload.metadata ?? null,
        }, user),
      })
      await recordAudit({
        actor,
        action: 'library.saved',
        resourceType: 'library_item',
        resourceId: row.id,
      })
      return {
        id: row.id,
        title: row.title,
        type: row.metadata?.type ?? row.sourceType,
        source: row.metadata?.source ?? row.sourceType,
        saves: String(row.metadata?.saves ?? 1),
        text: row.content,
        sourceId: row.sourceId ?? null,
        metadata: row.metadata ?? null,
      }
    },
    findById: async (id) => {
      const row = await client.libraryItem.findUnique({
        where: { id: String(id) },
      })
      if (!row) {
        return null
      }
      return {
        id: row.id,
        title: row.title,
        type: row.metadata?.type ?? row.sourceType,
        source: row.metadata?.source ?? row.sourceType,
        saves: String(row.metadata?.saves ?? 1),
        text: row.content,
        sourceId: row.sourceId ?? null,
        metadata: row.metadata ?? null,
      }
    },
    convertToTask: async (id, payload, actor) => {
      const item = await client.libraryItem.findUnique({
        where: { id: String(id) },
        include: { user: { include: { profile: true } } },
      })
      if (!item) {
        return null
      }
      if (!hasPermission(actor, 'task:create')) {
        return null
      }
      const ownerHandle = item.user?.profile?.handle ?? item.user?.id ?? null
      if (ownerHandle && ownerHandle !== actor.handle && !hasPermission(actor, 'admin:access')) {
        return null
      }
      const publisher = await client.user.findFirst({
        where: { profile: { handle: actor.handle } },
        include: { profile: true },
      })
      if (!publisher) {
        return null
      }
      const task = await client.task.create({
        data: buildTaskRecord(
          {
            id: `task-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
            title: item.title,
            category: payload.category ?? item.sourceType,
            status: 'Open',
            budget: payload.rewardAmount ? String(payload.rewardAmount) : `${payload.pointsReward} pts`,
            deadline: payload.deadlineAt ?? 'TBD',
            pointsReward: payload.pointsReward,
            proposals: 0,
            description: item.content,
            publisher: actor.handle,
            assignee: 'Unassigned',
            requirements: [payload.acceptanceRules],
            attachments: [],
            privateBrief: '',
            submission: 'No submission yet.',
            resultLinks: [],
            reviewNote: '',
            rights: '',
          },
          publisher,
          null,
        ),
        include: {
          publisher: { include: { profile: true } },
          assignee: { include: { profile: true } },
        },
      })
      await recordAudit({
        actor,
        action: 'library.converted_to_task',
        resourceType: 'library_item',
        resourceId: item.id,
        metadata: { taskId: task.id },
      })
      const reloaded = await client.task.findUnique({
        where: { id: task.id },
        include: {
          publisher: { include: { profile: true } },
          assignee: { include: { profile: true } },
        },
      })
      return reloaded ? getTaskDto(reloaded) : null
    },
    sendToWorkspace: async (id, actor) => {
      const item = await client.libraryItem.findUnique({
        where: { id: String(id) },
        include: { user: { include: { profile: true } } },
      })
      if (!item) {
        return null
      }
      const ownerHandle = item.user?.profile?.handle ?? item.user?.id ?? null
      if (ownerHandle && ownerHandle !== actor.handle && !hasPermission(actor, 'admin:access')) {
        return null
      }
      await recordAudit({
        actor,
        action: 'library.sent_to_workspace',
        resourceType: 'library_item',
        resourceId: item.id,
      })
      return {
        item: {
          id: item.id,
          title: item.title,
          type: item.metadata?.type ?? item.sourceType,
          source: item.metadata?.source ?? item.sourceType,
          saves: String(item.metadata?.saves ?? 1),
          text: item.content,
          sourceId: item.sourceId ?? null,
          metadata: item.metadata ?? null,
        },
        workspaceDraft: {
          title: item.title,
          seed: item.content,
          owner: actor.handle,
        },
      }
    },
  }

  const audit = {
    find: async (id) => {
      const row = await client.auditEvent.findUnique({ where: { id: String(id) } })
      return row ? serializeAuditEvent(row) : null
    },
    list: async (options = {}) => {
      const limit = options.limit ?? 20
      const cursor = options.cursor
        ? await client.auditEvent.findUnique({ where: { id: String(options.cursor) }, select: { id: true } })
        : null
      const rows = await client.auditEvent.findMany({
        where: {
          ...(options.action ? { action: options.action } : {}),
          ...(options.resourceType ? { resourceType: options.resourceType } : {}),
          ...(options.actorId ? { actorId: options.actorId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
      })
      const pageRows = rows.slice(0, limit)
      return {
        items: pageRows.map(serializeAuditEvent),
        nextCursor: rows.length > limit && pageRows.length > 0 ? pageRows[pageRows.length - 1].id : null,
        limit,
      }
    },
  }

  const getPrismaSecurityEventAlerts = async () => {
    const policy = buildSecurityAlertPolicy()
    const since = new Date(Date.now() - policy.windowMinutes * 60 * 1000)
    const rows = await client.securityEvent.findMany({
      where: { occurredAt: { gte: since } },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: 500,
    })
    const alertDeliveryFailureRows = await client.auditEvent.findMany({
      where: {
        action: 'security.alert.dispatch',
        createdAt: { gte: since },
        metadata: {
          path: ['status'],
          equals: 'failed',
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    })
    const events = rows.map(serializeSecurityEvent)
    const dispositionEvents = await client.auditEvent.findMany({
      where: {
        resourceType: 'security_alert',
        action: { in: securityAlertDispositionActions },
      },
      orderBy: { createdAt: 'desc' },
    })
    return applySecurityAlertDispositions(buildSecurityEventAlerts({
      rateLimitEvents: events.filter((event) => event.source === 'rate_limit'),
      bodyRejectedEvents: events.filter((event) => event.source === 'body_size'),
      authFailureEvents: events.filter((event) => event.source === 'auth_failure'),
      alertDeliveryFailureEvents: alertDeliveryFailureRows,
      policy,
    }), dispositionEvents)
  }

  const recordSecurityAlertDisposition = async (id, disposition, payload, actor) => {
    const alert = (await getPrismaSecurityEventAlerts()).find((item) => item.id === String(id))
    if (!alert) {
      return null
    }
    await recordAudit({
      actor,
      action: `security.alert.${disposition}`,
      resourceType: 'security_alert',
      resourceId: alert.id,
      metadata: {
        alertType: alert.type,
        severity: alert.severity,
        note: payload.note ?? '',
        actorHandle: actor?.handle ?? null,
        ...(payload.silencedUntil ? { silencedUntil: payload.silencedUntil } : {}),
      },
    })
    return (await getPrismaSecurityEventAlerts()).find((item) => item.id === alert.id) ?? null
  }

  const getPrismaSecurityAlertEvents = async (id, options = {}) => {
    const alert = (await getPrismaSecurityEventAlerts()).find((item) => item.id === String(id))
    if (!alert) {
      return null
    }
    const limit = Math.min(Math.max(Number.parseInt(options.limit ?? 5, 10) || 5, 1), 20)
    const policy = buildSecurityAlertPolicy()
    const since = new Date(Date.now() - policy.windowMinutes * 60 * 1000)
    const source = securityAlertSource(alert)
    if (source === 'alert_dispatch') {
      const rows = await client.auditEvent.findMany({
        where: {
          action: 'security.alert.dispatch',
          createdAt: { gte: since },
          metadata: {
            path: ['status'],
            equals: 'failed',
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      })
      return rows.map(serializeSecurityAlertDispatchEvent)
    }
    const rows = await client.securityEvent.findMany({
      where: {
        occurredAt: { gte: since },
        ...(source ? { source } : {}),
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit,
    })
    return rows.map(serializeSecurityEvent)
  }

  const getPrismaSecurityAlertExport = async (id) => {
    const alert = (await getPrismaSecurityEventAlerts()).find((item) => item.id === String(id))
    if (!alert) {
      return null
    }
    const relatedAuditIds = Array.isArray(alert.metadata?.recentEventIds) ? alert.metadata.recentEventIds.map(String) : []
    const [events, auditRows] = await Promise.all([
      getPrismaSecurityAlertEvents(alert.id, { limit: 20 }),
      client.auditEvent.findMany({
        where: {
          OR: [
            {
              resourceType: 'security_alert',
              resourceId: alert.id,
            },
            ...(securityAlertSource(alert) === 'alert_dispatch' && relatedAuditIds.length > 0
              ? [{ id: { in: relatedAuditIds } }]
              : []),
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ])
    return {
      exportedAt: new Date().toISOString(),
      alert,
      events: events ?? [],
      auditEvents: auditRows.map(serializeAuditEvent),
    }
  }

  const notifySecurityEventAlerts = async (db = client, actor = null) => {
    const alerts = await getPrismaSecurityEventAlerts()
    const created = []
    for (const alert of alerts) {
      if (alert.state === 'silenced') {
        continue
      }
      const notificationsCreated = await notifyAuditReaders(db, actor, securityAlertNotification(alert))
      created.push(...notificationsCreated)
      if (notificationsCreated.length > 0) {
        const dispatches = await dispatchSecurityAlert(alert)
        for (const dispatch of dispatches) {
          await recordAudit({
            actor,
            action: 'security.alert.dispatch',
            resourceType: 'security_alert',
            resourceId: alert.id,
            metadata: {
              alertType: alert.type,
              severity: alert.severity,
              channel: dispatch.channel,
              status: dispatch.status,
              statusCode: dispatch.statusCode ?? null,
              error: dispatch.error ?? null,
            },
          })
        }
      }
    }
    return created
  }

  const securityEvents = {
    record: async (event) => {
      await client.securityEvent.create({
        data: securityEventRecord(event),
      })
      await notifySecurityEventAlerts(client, null)
    },
    list: async (options = {}) => {
      const limit = options.limit ?? 20
      const cursor = options.cursor
        ? await client.securityEvent.findUnique({ where: { id: String(options.cursor) }, select: { id: true } })
        : null
      const rows = await client.securityEvent.findMany({
        where: {
          ...(options.type ? { type: options.type } : {}),
          ...(options.source ? { source: options.source } : {}),
          ...(options.severity ? { severity: options.severity } : {}),
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
      })
      const pageRows = rows.slice(0, limit)
      return {
        items: pageRows.map(serializeSecurityEvent),
        nextCursor: rows.length > limit && pageRows.length > 0 ? pageRows[pageRows.length - 1].id : null,
        limit,
      }
    },
    listAlerts: async () => getPrismaSecurityEventAlerts(),
    listAlertEvents: async (id, options = {}) => getPrismaSecurityAlertEvents(id, options),
    exportAlert: async (id) => getPrismaSecurityAlertExport(id),
    acknowledgeAlert: async (id, payload, actor) => recordSecurityAlertDisposition(id, 'acknowledged', payload, actor),
    silenceAlert: async (id, payload, actor) => recordSecurityAlertDisposition(id, 'silenced', payload, actor),
    unsilenceAlert: async (id, payload, actor) => recordSecurityAlertDisposition(id, 'unsilenced', payload, actor),
    notifyAlerts: async (actor = null) => notifySecurityEventAlerts(client, actor),
  }

  const buildPrismaOperationsMetrics = async (options = {}, generatedAt = new Date()) => {
    const windowMinutes = options.windowMinutes ?? 60
    const until = generatedAt instanceof Date ? generatedAt : new Date(generatedAt)
    const since = new Date(until.getTime() - windowMinutes * 60 * 1000)
    const [securityRows, auditRows, securityAlerts, archiveManifest] = await Promise.all([
      client.securityEvent.findMany({
        where: { occurredAt: { gte: since, lte: until } },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      }),
      client.auditEvent.findMany({
        where: {
          createdAt: { gte: since, lte: until },
          action: {
            in: [
              'security.alert.acknowledged',
              'security.alert.silenced',
              'security.alert.unsilenced',
              'security.alert.dispatch',
              'media.scan.alert.dispatch',
              'media.scan.history_archived',
              'media.scan.history_pruned',
              'operations.lease.skipped',
              'operations.lease.renew_failed',
              'creative.provider_budget.threshold_crossed',
              'creative.provider_budget.dispatch_blocked',
              'creative.provider_cost.anomaly_detected',
              'creative.provider_alert.dispatch',
            ],
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      getPrismaSecurityEventAlerts(),
      exportMediaScanJobArchive({ limit: 1 }),
    ])
    return buildOperationsMetrics({
      windowMinutes,
      generatedAt: until,
      securityEvents: securityRows.map(serializeSecurityEvent),
      auditEvents: auditRows.map(serializeAuditEvent),
      securityAlerts,
      mediaScanArchiveManifest: archiveManifest,
      providerAlertDispatchFailureThreshold: Number.parseInt(process.env.CREATIVE_PROVIDER_ALERT_DELIVERY_FAILED_ALERT_THRESHOLD ?? '2', 10) || 2,
    })
  }

  const getPrismaOperationsMetricSamples = async (options = {}, generatedAt = new Date()) => {
    const windowMinutes = options.windowMinutes ?? 60
    const until = generatedAt instanceof Date ? generatedAt : new Date(generatedAt)
    const since = new Date(until.getTime() - windowMinutes * 60 * 1000)
    const sampleEntries = await Promise.all(
      Object.entries(operationsMetricsSampleDefinitions).map(async ([key, definition]) => {
        const rows = await client.auditEvent.findMany({
          where: {
            action: definition.action,
            resourceType: definition.resourceType,
            createdAt: { gte: since, lte: until },
            ...(definition.failedOnly ? {
              metadata: {
                path: ['status'],
                equals: 'failed',
              },
            } : definition.metadataFilter ? {
              metadata: {
                path: [definition.metadataFilter.key],
                equals: definition.metadataFilter.value,
              },
            } : {}),
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
        })
        return [key, rows.map(serializeAuditEvent)]
      }),
    )
    return buildOperationsMetricSamples(Object.fromEntries(sampleEntries))
  }

  const operationsMetrics = {
    summary: async (options = {}) => buildPrismaOperationsMetrics(options),
    exportSnapshot: async (options = {}, actor = null) => {
      const exportedAt = new Date()
      const [metrics, samples] = await Promise.all([
        buildPrismaOperationsMetrics(options, exportedAt),
        getPrismaOperationsMetricSamples(options, exportedAt),
      ])
      const snapshot = buildOperationsMetricsSnapshot({ metrics, samples, actor, exportedAt })
      const snapshotId = `operations-metrics-${exportedAt.getTime()}`
      await recordAudit({
        actor,
        action: 'admin.operations.metrics_exported',
        resourceType: 'operations_metrics',
        resourceId: snapshotId,
        metadata: {
          windowMinutes: metrics.window.minutes,
          sampleCounts: Object.fromEntries(Object.entries(samples).map(([key, sample]) => [key, sample.count])),
          hintCount: snapshot.handoff.remediationHints.length,
          exportedAt: snapshot.exportedAt,
        },
      })
      return {
        ...snapshot,
        id: snapshotId,
      }
    },
  }

  const authorization = {
    listPermissions: async () => {
      const rows = await client.permission.findMany({
        orderBy: { id: 'asc' },
      })
      return rows.map((row) => ({
        id: row.id,
        description: row.description,
      }))
    },
    listRolePermissions: async () => {
      rolePermissionMap = await loadRolePermissionMap()
      const roles = ['member', 'creator', 'publisher', 'moderator', 'admin']
      return roles.map((role) => ({
        role,
        permissions: getDatabasePermissionsForRole(role),
      }))
    },
    updateRolePermissions: async (role, permissionIds, actor) => {
      const roles = ['member', 'creator', 'publisher', 'moderator', 'admin']
      if (!roles.includes(role)) {
        return null
      }
      const updated = await client.$transaction(async (transaction) => {
        await transaction.rolePermission.deleteMany({
          where: { role },
        })
        if (permissionIds.length > 0) {
          await transaction.rolePermission.createMany({
            data: permissionIds.map((permissionId) => ({ role, permissionId })),
            skipDuplicates: true,
          })
        }
        const rows = await transaction.rolePermission.findMany({
          where: { role },
          orderBy: { permissionId: 'asc' },
        })
        await transaction.auditEvent.create({
          data: buildAuditRecord({
            actorType: actor ? 'user' : 'system',
            actorId: actor?.id ?? null,
            action: 'admin.role_permissions.updated',
            resourceType: 'role',
            resourceId: role,
            metadata: { permissions: rows.map((row) => row.permissionId) },
          }),
        })
        return {
          role,
          permissions: rows.map((row) => row.permissionId),
        }
      })
      rolePermissionMap = await loadRolePermissionMap()
      return updated
    },
  }

  const adminReviews = {
    create: async (payload, actor) => {
      const row = await client.adminReview.create({
        data: {
          id: payload.id,
          queue: payload.queue,
          status: payload.status ?? 'Pending review',
          title: payload.title,
          owner: payload.owner,
          note: payload.note ?? '',
          metadata: payload.metadata ?? undefined,
        },
        include: {
          reviewedBy: { include: { profile: true } },
        },
      })
      await recordAudit({
        actor,
        action: 'admin.review.requested',
        resourceType: 'admin_review',
        resourceId: row.id,
        metadata: {
          queue: row.queue,
          kind: asObject(row.metadata)?.kind ?? null,
        },
      })
      return getAdminReviewDto(row)
    },
    find: async (id) => {
      const row = await client.adminReview.findUnique({
        where: { id: String(id) },
        include: {
          reviewedBy: { include: { profile: true } },
        },
      })
      return row ? getAdminReviewDto(row) : null
    },
    list: async (options = {}) => {
      const limit = options.limit ?? 20
      const cursor = options.cursor
        ? await client.adminReview.findUnique({ where: { id: String(options.cursor) }, select: { id: true } })
        : null
      const rows = await client.adminReview.findMany({
        where: {
          ...(options.queue ? { queue: options.queue } : {}),
          ...(options.status ? { status: options.status } : {}),
        },
        include: {
          reviewedBy: { include: { profile: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
      })
      const pageRows = rows.slice(0, limit)
      return {
        items: pageRows.map(getAdminReviewDto),
        nextCursor: rows.length > limit && pageRows.length > 0 ? pageRows[pageRows.length - 1].id : null,
        limit,
      }
    },
    review: async (id, action, actor) => {
      const current = await client.adminReview.findUnique({
        where: { id: String(id) },
        include: {
          reviewedBy: { include: { profile: true } },
        },
      })
      if (!current) {
        return null
      }
      if (current.decision) {
        return getAdminReviewDto(current)
      }
      const reviewer = await client.user.findFirst({
        where: { profile: { handle: actor.handle } },
      })
      if (!reviewer) {
        return null
      }
      const row = await client.$transaction(async (transaction) => {
        const metadata = asObject(current.metadata) ?? {}
        let nextMetadata = metadata
        if (action.decision === 'approve' && metadata.kind === 'point_adjustment') {
          const adjustmentUser = await transaction.user.findFirst({
            where: { profile: { handle: metadata.userHandle } },
            include: { profile: true },
          })
          if (adjustmentUser) {
            const ledgerEntry = await createManualPointAdjustment(
              transaction,
              adjustmentUser,
              {
                userHandle: metadata.userHandle,
                delta: Number(metadata.delta),
                reason: String(metadata.reason ?? current.note),
              },
              actor,
              { sourceId: current.id, reviewId: current.id },
            )
            nextMetadata = {
              ...metadata,
              ledgerEntryId: ledgerEntry.id,
              approvedBy: actor.handle,
            }
          }
        }
        const updated = await transaction.adminReview.update({
          where: { id: current.id },
          data: {
            status: action.decision === 'approve' ? 'Approved' : 'Rejected',
            note: action.note || current.note,
            decision: action.decision,
            reviewedById: reviewer.id,
            reviewedAt: new Date(),
            metadata: nextMetadata,
          },
          include: {
            reviewedBy: { include: { profile: true } },
          },
        })
        await transaction.auditEvent.create({
          data: buildAuditRecord({
            actorType: actor ? 'user' : 'system',
            actorId: actor?.id ?? null,
            action: `admin.review.${action.decision}`,
            resourceType: 'admin_review',
            resourceId: updated.id,
            metadata: { queue: updated.queue },
          }),
        })
        if (nextMetadata.kind === 'point_adjustment') {
          const decisionLabel = action.decision === 'approve' ? 'approved' : 'rejected'
          await createNotificationsForHandles(
            [nextMetadata.requestedBy, nextMetadata.userHandle],
            {
              type: `points.adjustment.${decisionLabel}`,
              title: `Point adjustment ${decisionLabel}: @${nextMetadata.userHandle}`,
              body: `${actor.handle} ${decisionLabel} ${Number(nextMetadata.delta) > 0 ? '+' : ''}${nextMetadata.delta} points for @${nextMetadata.userHandle}.`,
              resourceType: 'admin_review',
              resourceId: updated.id,
              metadata: {
                ...nextMetadata,
                target: {
                  page: 'admin',
                  admin: {
                    tab: 'Task review',
                    queue: 'points',
                    reviewId: updated.id,
                  },
                },
              },
            },
            transaction,
          )
        }
        return updated
      })
      return getAdminReviewDto(row)
    },
  }

  const support = {
    create: async (payload, actor) => {
      const submittedAt = new Date().toISOString()
      const review = await client.$transaction(async (transaction) => {
        const row = await transaction.adminReview.create({
          data: {
            queue: compliancePolicyManifest.supportContract.queue,
            status: compliancePolicyManifest.supportContract.requestStatus,
            title: payload.subject,
            owner: actor.handle,
            note: payload.details,
            metadata: {
              kind: 'support_request',
              category: payload.category,
              categoryLabel: payload.categoryLabel,
              relatedResourceType: payload.relatedResourceType,
              relatedResourceId: payload.relatedResourceId,
              initialResponseTarget: payload.initialResponseTarget,
              implementationOwner: payload.implementationOwner,
              locale: payload.locale,
              submittedAt,
            },
          },
        })
        await transaction.auditEvent.create({
          data: buildAuditRecord({
            actorType: 'user',
            actorId: actor.id,
            action: compliancePolicyManifest.supportContract.requestAction,
            resourceType: 'support_request',
            resourceId: row.id,
            metadata: {
              category: payload.category,
              relatedResourceType: payload.relatedResourceType,
              relatedResourceId: payload.relatedResourceId,
              implementationOwner: payload.implementationOwner,
            },
          }),
        })
        return row
      })
      return getSupportRequestDto(review)
    },
    find: async (id, actor) => {
      const row = await client.adminReview.findFirst({
        where: {
          id: String(id),
          queue: compliancePolicyManifest.supportContract.queue,
          owner: actor.handle,
        },
      })
      return row ? getSupportRequestDto(row) : null
    },
    list: async (actor, options = {}) => {
      const limit = options.limit ?? 20
      const cursor = options.cursor
        ? await client.adminReview.findFirst({
          where: {
            id: String(options.cursor),
            queue: compliancePolicyManifest.supportContract.queue,
            owner: actor.handle,
          },
          select: { id: true },
        })
        : null
      const rows = await client.adminReview.findMany({
        where: {
          queue: compliancePolicyManifest.supportContract.queue,
          owner: actor.handle,
        },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
      })
      const pageRows = rows.slice(0, limit)
      return {
        items: pageRows.map(getSupportRequestDto),
        nextCursor: rows.length > limit && pageRows.length > 0 ? pageRows[pageRows.length - 1].id : null,
        limit,
      }
    },
  }

  return {
    ...fallbackRepository,
    client,
    auth,
    tasks,
    posts,
    profiles,
    points,
    notifications,
    providerLifecycleNotifications,
    providerBudgetNotifications,
    providerLifecycleAudit,
    providerBudgetAudit,
    creativeGenerations,
    creativeGenerationMutations,
    creativeProviderReplays,
    creativeOutputIngestions,
    creativeProviderControls,
    creativeProviderRetries,
    creativeProviderCosts,
    creativeCredits,
    creativeQuota,
    media,
    library,
    audit,
    securityEvents,
    operationLeases,
    operationsMetrics,
    authorization,
    adminReviews,
    compliance,
    support,
    source: 'prisma',
  }
}

export { createPrismaRepository }
