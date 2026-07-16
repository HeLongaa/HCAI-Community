import { createHash, randomUUID } from 'node:crypto'
import { HttpError } from '../common/errors/httpError.js'
import prismaClientPkg from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { getPermissionsForRole, hasPermission, permissionById } from '../auth/permissions.js'
import { authorizeResource } from '../auth/resourcePolicy.js'
import { taskCreatedEvent } from '../events/domainEvents.js'
import { createPrismaDomainEventRepository, enqueueDomainEvent } from '../events/prismaDomainEventRepository.js'
import { createPrismaDomainEventConsumerRepository } from '../events/prismaDomainEventConsumerRepository.js'
import { createPrismaJobRepository } from '../jobs/prismaJobRepository.js'
import { createPrismaReleaseRepository } from '../releases/prismaReleaseRepository.js'
import { createPrismaSystemSettingsRepository } from '../settings/prismaSystemSettingsRepository.js'
import { createPrismaConfigResourcesRepository } from '../configResources/prismaConfigResourcesRepository.js'
import { createPrismaModelControlRepository } from '../modelControl/prismaModelControlRepository.js'
import { createPrismaModelRoutingRepository } from '../modelControl/prismaModelRoutingRepository.js'
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
  getCreativeProviderOperationDto,
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
  getPortfolioAssetDto,
  getProfileDto,
  getTaskProposalDto,
  getTaskSubmissionDto,
  getTaskDto,
  parseTaskStatus,
  taskStatusFromLabel,
} from './prismaTransforms.js'
import { serializeAuditEvent, serializeSecurityAlertDispatchEvent, serializeSecurityEvent } from './serializers.js'
import { shouldAutoSeedPrisma } from './runtimePolicy.js'
import { buildStorageConfig, normalizeStorageChecksumSha256, signMediaDownload, signMediaUpload } from '../storage/uploadSigner.js'
import { deleteStorageObject, inspectStorageObject, StorageObjectError } from '../storage/objectStore.js'
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
import { createPrismaChatRepository } from '../chat/prismaChatRepository.js'
import { safeProviderOperationMetadata } from '../creative/generationRecords.js'
import { assetEligibleForWorkspace, assetMediaType, buildSafeAssetLibraryItem } from '../media/assetLibrary.js'
import { resolveCreativeDeliveryAssets } from '../creative/deliveryAssets.js'
import { taskWorkflowDto } from '../tasks/taskLifecycle.js'
import {
  accountingOperationKey,
  accountingPayloadHash,
  reconcilePointLedgerRows,
  validateMovementGroup,
} from '../accounting/internalAccounting.js'

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
import { sanitizeNotificationMetadata } from './notificationTargets.js'
import { safeCreativeCreditMetadata, safeErrorPreview } from '../creative/generationRecords.js'
import { buildPortableAuditExport } from '../audit/auditIntegrity.js'
import { createPrismaObservabilityRepository } from '../observability/prismaObservabilityRepository.js'
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
const oauthAuditResourceId = (provider, providerUserId) => (
  `${provider}:${createHash('sha256').update(`${provider}:${providerUserId}`).digest('hex').slice(0, 24)}`
)

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

const createPrismaRepository = async (fallbackRepository = {}) => {
  const client = await createClient()
  if (!client) {
    return null
  }

  if (shouldAutoSeedPrisma()) {
    const { seedPrismaDatabase } = await import('./prismaSeed.js')
    await seedPrismaDatabase(client)
  }

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

  const recordAudit = async ({ actor = null, action, resourceType, resourceId = null, metadata = null }, db = client) => {
    const row = await db.auditEvent.create({
      data: buildAuditRecord({
        actorType: actor ? 'user' : 'system',
        actorId: actor?.id ?? null,
        action,
        resourceType,
        resourceId,
        metadata,
      }),
    })
    return serializeAuditEvent(row)
  }

  const chat = createPrismaChatRepository(client, { recordAudit })
  const domainEvents = createPrismaDomainEventRepository(client, { recordAudit })
  const domainEventConsumers = createPrismaDomainEventConsumerRepository(client, { recordAudit })
  const jobs = createPrismaJobRepository(client, { recordAudit })
  const releaseChanges = createPrismaReleaseRepository(client)
  const systemSettings = createPrismaSystemSettingsRepository(client, { recordAudit })
  const configResources = createPrismaConfigResourcesRepository(client, { recordAudit })
  const modelControl = createPrismaModelControlRepository(client, { recordAudit })
  const modelRouting = createPrismaModelRoutingRepository(client, { recordAudit })
  const observability = createPrismaObservabilityRepository(client)

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

  const getOrCreatePointAccount = async (transaction, userId) => {
    const existing = await transaction.internalPointAccount.findUnique({ where: { userId } })
    if (existing) return existing
    const latest = await transaction.pointLedger.findFirst({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    const openingBalance = latest?.balanceAfter ?? 0
    const id = `point-account-${userId}`
    await transaction.$executeRaw`
      INSERT INTO "internal_point_accounts" (
        "id", "user_id", "balance", "opening_balance", "version", "created_at", "updated_at"
      ) VALUES (
        ${id}, ${userId}, ${openingBalance}, ${openingBalance}, 0, NOW(), NOW()
      )
      ON CONFLICT ("user_id") DO NOTHING
    `
    return transaction.internalPointAccount.findUnique({ where: { userId } })
  }

  const applyPrismaAccountingOperation = async (transaction, {
    unit,
    kind,
    sourceType,
    sourceId,
    reasonCode,
    phase = 'apply',
    payload = {},
    movements,
    actor,
    allowNegative = false,
    originalOperationKey = null,
    reconciliationIssueId = null,
  }) => {
    const operationKey = accountingOperationKey({ kind, sourceType, sourceId, phase })
    const payloadHash = accountingPayloadHash(payload)
    const validation = validateMovementGroup({ unit, movements })
    if (!validation.valid) {
      throw new HttpError(409, validation.code, 'Accounting movement group is invalid')
    }
    const operationId = `accounting-operation-${randomUUID()}`
    const actorRef = actor?.handle ?? actor?.id ?? 'system'
    const inserted = await transaction.$queryRaw`
      INSERT INTO "internal_accounting_operations" (
        "id", "operation_key", "unit", "kind", "status", "source_type", "source_id",
        "payload_hash", "reason_code", "original_operation_key", "reconciliation_issue_id",
        "actor_ref", "created_at", "updated_at"
      ) VALUES (
        ${operationId}, ${operationKey}, CAST(${unit} AS "InternalAccountingUnit"), ${kind},
        'pending', ${sourceType}, ${String(sourceId)}, ${payloadHash}, ${reasonCode},
        ${originalOperationKey}, ${reconciliationIssueId}, ${actorRef}, NOW(), NOW()
      )
      ON CONFLICT ("operation_key", "unit") DO NOTHING
      RETURNING "id"
    `
    if (!Array.isArray(inserted) || inserted.length === 0) {
      const existing = await transaction.internalAccountingOperation.findUnique({
        where: { operationKey_unit: { operationKey, unit } },
        include: { movements: { orderBy: { sequence: 'asc' } } },
      })
      if (!existing || existing.payloadHash !== payloadHash) {
        throw new HttpError(409, 'ACCOUNTING_OPERATION_CONFLICT', 'Accounting operation already exists with a different payload')
      }
      return { operation: existing, movements: existing.movements, recovered: true }
    }

    const balancesBySequence = new Map()
    const pointMovements = movements
      .map((movement, index) => ({ ...movement, sequence: index + 1 }))
      .filter((movement) => unit === 'points' && movement.accountType === 'available' && movement.ownerUserId)
      .sort((left, right) => String(left.ownerUserId).localeCompare(String(right.ownerUserId)))
    for (const movement of pointMovements) {
      await getOrCreatePointAccount(transaction, movement.ownerUserId)
      const updated = await transaction.$queryRaw`
        UPDATE "internal_point_accounts"
        SET
          "balance" = "balance" + ${movement.amount},
          "version" = "version" + 1,
          "updated_at" = NOW()
        WHERE "user_id" = ${movement.ownerUserId}
          AND (${allowNegative} OR ("balance" + ${movement.amount}) >= 0)
        RETURNING "balance", "version"
      `
      if (!Array.isArray(updated) || updated.length !== 1) {
        throw new HttpError(409, 'POINTS_INSUFFICIENT_BALANCE', 'Available point balance is insufficient')
      }
      balancesBySequence.set(movement.sequence, Number(updated[0].balance))
    }

    await transaction.internalAccountingMovement.createMany({
      data: movements.map((movement, index) => ({
        id: `accounting-movement-${randomUUID()}`,
        operationId,
        unit,
        accountRef: movement.accountRef,
        accountType: movement.accountType,
        amount: movement.amount,
        balanceAfter: balancesBySequence.get(index + 1) ?? null,
        sequence: index + 1,
      })),
    })
    const operation = await transaction.internalAccountingOperation.update({
      where: { id: operationId },
      data: { status: 'applied', appliedAt: new Date() },
      include: { movements: { orderBy: { sequence: 'asc' } } },
    })
    await transaction.auditEvent.create({
      data: buildAuditRecord({
        actorType: actor ? 'user' : 'system',
        actorId: actor?.id ?? null,
        action: 'accounting.operation.applied',
        resourceType: 'internal_accounting_operation',
        resourceId: operation.id,
        metadata: {
          operationKey,
          unit,
          kind,
          sourceType,
          sourceId: String(sourceId),
          reasonCode,
          movementCount: movements.length,
        },
      }),
    })
    return { operation, movements: operation.movements, recovered: false }
  }

  const serializeAccountingIssue = (issue) => issue ? ({
    id: issue.id,
    issueKey: issue.issueKey,
    type: issue.type,
    unit: issue.unit,
    status: issue.status,
    sourceType: issue.sourceType,
    sourceId: issue.sourceId,
    expectedAmount: issue.expectedAmount ?? null,
    actualAmount: issue.actualAmount ?? null,
    differenceAmount: issue.differenceAmount ?? null,
    operationKey: issue.operationKey ?? null,
    repairOperationKey: issue.repairOperationKey ?? null,
    evidence: issue.evidence ?? null,
    detectedAt: issue.detectedAt.toISOString(),
    reviewedAt: issue.reviewedAt?.toISOString() ?? null,
    resolvedAt: issue.resolvedAt?.toISOString() ?? null,
  }) : null

  const accountingIssueSummary = (issues) => ({
    total: issues.length,
    open: issues.filter((issue) => issue.status === 'open').length,
    repairPending: issues.filter((issue) => issue.status === 'repair_pending').length,
    resolved: issues.filter((issue) => issue.status === 'resolved').length,
    ignored: issues.filter((issue) => issue.status === 'ignored').length,
  })

  const paginateAccountingIssues = (issues, options = {}) => {
    const limit = Math.min(Math.max(Number(options.limit ?? 20), 1), 100)
    const cursorIndex = options.cursor
      ? issues.findIndex((issue) => issue.id === String(options.cursor))
      : -1
    const start = cursorIndex >= 0 ? cursorIndex + 1 : 0
    const items = issues.slice(start, start + limit)
    return {
      items: items.map(serializeAccountingIssue),
      nextCursor: start + limit < issues.length && items.length > 0 ? items.at(-1).id : null,
      limit,
    }
  }

  const filterAccountingIssues = (issues, options = {}) => issues
    .filter((issue) => !options.status || issue.status === options.status)
    .filter((issue) => !options.unit || issue.unit === options.unit)
    .filter((issue) => !options.type || issue.type === options.type)

  const scanPrismaAccounting = async (actor = null, options = {}) => {
    const generatedAt = new Date()
    const result = await client.$transaction(async (transaction) => {
      const [ledgerRows, pointAccounts, operations, creditLedgers, quotaWindows, tasks, existingIssues] = await Promise.all([
        transaction.pointLedger.findMany({ orderBy: [{ userId: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] }),
        transaction.internalPointAccount.findMany(),
        transaction.internalAccountingOperation.findMany({ include: { movements: { orderBy: { sequence: 'asc' } } } }),
        transaction.creativeCreditLedger.findMany(),
        transaction.creativeQuotaWindow.findMany({ include: { reservations: true } }),
        transaction.task.findMany({ where: { pointsReward: { gt: 0 } } }),
        transaction.accountingReconciliationIssue.findMany(),
      ])
      const detected = new Map()
      const addIssue = (issue) => detected.set(issue.issueKey, issue)
      const operationsByIdentity = new Map(operations.map((operation) => [
        `${operation.unit}:${operation.operationKey}`,
        operation,
      ]))
      const hasOperation = (unit, kind, sourceType, sourceId, phase = 'apply') => operationsByIdentity.has(
        `${unit}:${accountingOperationKey({ kind, sourceType, sourceId, phase })}`,
      )

      const rowsByUser = new Map()
      for (const row of ledgerRows) {
        const rows = rowsByUser.get(row.userId) ?? []
        rows.push(row)
        rowsByUser.set(row.userId, rows)
      }
      const accountByUser = new Map(pointAccounts.map((account) => [account.userId, account]))
      for (const [userId, rows] of rowsByUser) {
        const report = reconcilePointLedgerRows(rows)
        for (const drift of report.issues) {
          addIssue({
            issueKey: `point_balance_drift:${userId}:${drift.ledgerId}`,
            type: 'point_balance_drift',
            unit: 'points',
            sourceType: 'point_ledger',
            sourceId: drift.ledgerId,
            expectedAmount: drift.expectedBalance,
            actualAmount: drift.actualBalance,
            differenceAmount: drift.difference,
            evidence: { userId },
          })
        }
        const account = accountByUser.get(userId)
        const latestBalance = report.actualBalance
        if (!account || account.balance !== latestBalance) {
          addIssue({
            issueKey: `point_balance_drift:${userId}:account`,
            type: 'point_balance_drift',
            unit: 'points',
            sourceType: 'internal_point_account',
            sourceId: account?.id ?? `missing:${userId}`,
            expectedAmount: latestBalance,
            actualAmount: account?.balance ?? 0,
            differenceAmount: (account?.balance ?? 0) - latestBalance,
            evidence: { userId, accountVersion: account?.version ?? null },
          })
        }
      }

      for (const operation of operations) {
        const validation = validateMovementGroup({ unit: operation.unit, movements: operation.movements })
        if (!validation.valid || !['applied', 'compensated'].includes(operation.status)) {
          addIssue({
            issueKey: `unbalanced_operation:${operation.unit}:${operation.operationKey}`,
            type: 'unbalanced_operation',
            unit: operation.unit,
            sourceType: 'internal_accounting_operation',
            sourceId: operation.id,
            expectedAmount: 0,
            actualAmount: validation.total,
            differenceAmount: validation.total,
            operationKey: operation.operationKey,
            evidence: { code: validation.code, status: operation.status },
          })
        }
      }

      for (const ledger of creditLedgers) {
        const active = ledger.status === 'reserved' ? ledger.reservationAmount : 0
        const cancelled = ledger.status === 'cancelled' ? ledger.reservationAmount : 0
        const actual = ledger.settledAmount + ledger.refundedAmount + active + cancelled
        const reservePresent = hasOperation('creative_credit', 'credit_reserve', 'generation', ledger.generationId)
        const terminalPresent = ledger.status === 'settled'
          ? hasOperation('creative_credit', 'credit_settle', 'generation', ledger.generationId)
          : ledger.status === 'refunded'
            ? hasOperation('creative_credit', 'credit_refund', 'generation', ledger.generationId)
            : ledger.status === 'cancelled'
              ? hasOperation('creative_credit', 'credit_refund', 'generation', ledger.generationId, 'cancel')
              : true
        if (actual !== ledger.reservationAmount || !reservePresent || !terminalPresent) {
          addIssue({
            issueKey: `credit_state_mismatch:${ledger.id}`,
            type: 'credit_state_mismatch',
            unit: 'creative_credit',
            sourceType: 'creative_credit_ledger',
            sourceId: ledger.id,
            expectedAmount: ledger.reservationAmount,
            actualAmount: actual,
            differenceAmount: actual - ledger.reservationAmount,
            evidence: { generationId: ledger.generationId, status: ledger.status, reservePresent, terminalPresent },
          })
        }
      }

      for (const window of quotaWindows) {
        const expectedReserved = window.reservations
          .filter((reservation) => reservation.status === 'reserved')
          .reduce((total, reservation) => total + reservation.units, 0)
        const expectedUsed = window.reservations
          .filter((reservation) => reservation.status === 'committed')
          .reduce((total, reservation) => total + reservation.units, 0)
        const expectedReleased = window.reservations
          .filter((reservation) => reservation.status === 'released')
          .reduce((total, reservation) => total + reservation.units, 0)
        const countersMatch = expectedReserved === window.reservedUnits &&
          expectedUsed === window.usedUnits &&
          expectedReleased === window.releasedUnits
        const withinLimit = window.reservedUnits + window.usedUnits <= window.limitUnits
        if (!countersMatch || !withinLimit) {
          addIssue({
            issueKey: `quota_state_mismatch:${window.id}`,
            type: 'quota_state_mismatch',
            unit: 'quota_unit',
            sourceType: 'creative_quota_window',
            sourceId: window.id,
            expectedAmount: expectedReserved + expectedUsed,
            actualAmount: window.reservedUnits + window.usedUnits,
            differenceAmount: (window.reservedUnits + window.usedUnits) - (expectedReserved + expectedUsed),
            evidence: {
              workspace: window.workspace,
              limitUnits: window.limitUnits,
              expectedReserved,
              expectedUsed,
              expectedReleased,
              actualReleased: window.releasedUnits,
              withinLimit,
            },
          })
        }
        for (const reservation of window.reservations) {
          const reservePresent = hasOperation('quota_unit', 'quota_reserve', 'generation', reservation.generationId)
          const terminalPresent = reservation.status === 'committed'
            ? hasOperation('quota_unit', 'quota_commit', 'generation', reservation.generationId)
            : reservation.status === 'released'
              ? hasOperation('quota_unit', 'quota_release', 'generation', reservation.generationId)
              : true
          if (!reservePresent || !terminalPresent) {
            addIssue({
              issueKey: `quota_state_mismatch:${reservation.id}`,
              type: 'quota_state_mismatch',
              unit: 'quota_unit',
              sourceType: 'creative_quota_reservation',
              sourceId: reservation.id,
              expectedAmount: reservation.units,
              actualAmount: reservePresent && terminalPresent ? reservation.units : 0,
              differenceAmount: reservePresent && terminalPresent ? 0 : -reservation.units,
              evidence: { generationId: reservation.generationId, status: reservation.status, reservePresent, terminalPresent },
            })
          }
        }
      }

      const escrowRowsByTask = new Map(ledgerRows
        .filter((row) => row.sourceType === 'task_escrow' && row.sourceId)
        .map((row) => [row.sourceId, row]))
      for (const task of tasks) {
        const reservePresent = hasOperation('points', 'task_escrow_reserve', 'task', task.id)
        const transferPresent = hasOperation('points', 'task_escrow_transfer', 'task', task.id)
        const releasePresent = hasOperation('points', 'task_escrow_release', 'task', task.id)
        const escrow = escrowRowsByTask.get(task.id)
        const terminalCount = Number(transferPresent) + Number(releasePresent)
        const stateMatches = reservePresent && terminalCount <= 1 &&
          (task.status !== 'completed' || transferPresent) &&
          (!escrow || escrow.status !== 'settled' || transferPresent) &&
          (!escrow || escrow.status !== 'cancelled' || releasePresent)
        if (!stateMatches) {
          addIssue({
            issueKey: `escrow_state_mismatch:${task.id}`,
            type: 'escrow_state_mismatch',
            unit: 'points',
            sourceType: 'task',
            sourceId: task.id,
            expectedAmount: task.pointsReward,
            actualAmount: reservePresent ? task.pointsReward : 0,
            differenceAmount: reservePresent ? 0 : -task.pointsReward,
            evidence: { taskStatus: task.status, escrowStatus: escrow?.status ?? null, reservePresent, transferPresent, releasePresent },
          })
        }
      }

      const existingByKey = new Map(existingIssues.map((issue) => [issue.issueKey, issue]))
      for (const issue of detected.values()) {
        const existing = existingByKey.get(issue.issueKey)
        const status = ['ignored', 'repair_pending'].includes(existing?.status)
          ? existing.status
          : 'open'
        await transaction.accountingReconciliationIssue.upsert({
          where: { issueKey: issue.issueKey },
          create: {
            id: `accounting-issue-${randomUUID()}`,
            ...issue,
            status,
            detectedAt: generatedAt,
          },
          update: {
            ...issue,
            status,
            resolvedAt: null,
          },
        })
      }
      const resolvedIds = existingIssues
        .filter((issue) => !detected.has(issue.issueKey) && ['open', 'repair_pending'].includes(issue.status))
        .map((issue) => issue.id)
      if (resolvedIds.length > 0) {
        await transaction.accountingReconciliationIssue.updateMany({
          where: { id: { in: resolvedIds } },
          data: { status: 'resolved', resolvedAt: generatedAt },
        })
      }
      return transaction.accountingReconciliationIssue.findMany({
        orderBy: [{ detectedAt: 'desc' }, { id: 'desc' }],
      })
    })
    const filtered = filterAccountingIssues(result, options)
    return {
      generatedAt: generatedAt.toISOString(),
      summary: accountingIssueSummary(result),
      issues: paginateAccountingIssues(filtered, options),
    }
  }

  const settleTaskReward = async (transaction, task, recipientId, actor = null) => {
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
    await applyPrismaAccountingOperation(transaction, {
      unit: 'points',
      kind: 'task_escrow_transfer',
      sourceType: 'task',
      sourceId: task.id,
      reasonCode: 'task_completed',
      payload: { taskId: String(task.id), publisherId: task.publisherId, recipientId, amount: pointsReward },
      movements: [
        { unit: 'points', accountRef: `task:${task.id}:points:escrow`, accountType: 'escrow', amount: -pointsReward },
        { unit: 'points', accountRef: `user:${recipientId}:points:available`, accountType: 'available', ownerUserId: recipientId, amount: pointsReward },
      ],
      actor,
    })
    const account = await getOrCreatePointAccount(transaction, recipientId)
    return transaction.pointLedger.create({
      data: {
        id: `ledger-task-${task.id}-${recipientId}`,
        userId: recipientId,
        sourceType: 'task_completion',
        sourceId: String(task.id),
        delta: pointsReward,
        balanceAfter: account.balance,
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

  const createTaskEscrow = async (transaction, task, publisherId, actor = null) => {
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
    await applyPrismaAccountingOperation(transaction, {
      unit: 'points',
      kind: 'task_escrow_reserve',
      sourceType: 'task',
      sourceId: task.id,
      reasonCode: 'task_published',
      payload: { taskId: String(task.id), publisherId, amount: pointsReward },
      movements: [
        { unit: 'points', accountRef: `user:${publisherId}:points:available`, accountType: 'available', ownerUserId: publisherId, amount: -pointsReward },
        { unit: 'points', accountRef: `task:${task.id}:points:escrow`, accountType: 'escrow', amount: pointsReward },
      ],
      actor,
    })
    const account = await getOrCreatePointAccount(transaction, publisherId)
    return transaction.pointLedger.create({
      data: {
        id: `ledger-task-escrow-${task.id}-${publisherId}`,
        userId: publisherId,
        sourceType: 'task_escrow',
        sourceId: String(task.id),
        delta: -pointsReward,
        balanceAfter: account.balance,
        status: 'pending',
        description: `Task reward held: ${task.title}`,
        occurredAtLabel: 'Just now',
      },
    })
  }

  const finalizeTaskEscrow = async (transaction, task, publisherId, decision, actor = null) => {
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
    await applyPrismaAccountingOperation(transaction, {
      unit: 'points',
      kind: 'task_escrow_release',
      sourceType: 'task',
      sourceId: task.id,
      reasonCode: 'task_dispute_rejected',
      payload: { taskId: String(task.id), publisherId, amount: pointsReward },
      movements: [
        { unit: 'points', accountRef: `task:${task.id}:points:escrow`, accountType: 'escrow', amount: -pointsReward },
        { unit: 'points', accountRef: `user:${publisherId}:points:available`, accountType: 'available', ownerUserId: publisherId, amount: pointsReward },
      ],
      actor,
    })
    const account = await getOrCreatePointAccount(transaction, publisherId)
    return transaction.pointLedger.create({
      data: {
        id: `ledger-task-escrow-release-${task.id}-${publisherId}`,
        userId: publisherId,
        sourceType: 'task_escrow_release',
        sourceId: String(task.id),
        delta: pointsReward,
        balanceAfter: account.balance,
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

  const runSerializableTransaction = async (operation, maxAttempts = 3) => {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await client.$transaction(operation, { isolationLevel: 'Serializable' })
      } catch (error) {
        if (error?.code !== 'P2034' || attempt === maxAttempts) {
          throw error
        }
      }
    }
    return null
  }

  const createSessionForUser = async (user, reason = 'auth.session.created', options = {}) => {
    const accessToken = createAccessToken(user.id)
    const refreshToken = createOpaqueToken('hcai_refresh')
    const persist = async (db) => {
      await db.refreshToken.create({
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
      }, db)
      return {
        accessToken,
        refreshToken,
        user: mapAccount(user),
      }
    }
    return options.db ? persist(options.db) : client.$transaction(persist)
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
          metadata: sanitizeNotificationMetadata(payload.metadata, payload),
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

  const makeUniqueProfileHandle = async (email, fallback = 'oauth', db = client) => {
    const base = String(email?.split('@')[0] ?? fallback).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || fallback
    let handle = base.length >= 3 ? base : `user_${base}`
    let suffix = 1
    while (await db.profile.findUnique({ where: { handle }, select: { userId: true } })) {
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
    const checksumSha256 = asset.storageObject?.checksumSha256 ?? asset.checksumSha256 ?? null
    return {
      asset: getMediaAssetDto(asset),
      upload: signMediaUpload({ ...asset, checksumSha256 }),
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
    await applyPrismaAccountingOperation(transaction, {
      unit: 'points',
      kind: 'manual_adjustment',
      sourceType: 'point_adjustment',
      sourceId,
      reasonCode: 'admin_adjustment_approved',
      payload: {
        sourceId,
        userId: user.id,
        delta: payload.delta,
        reasonCode: payload.reasonCode ?? null,
        reviewId: options.reviewId ?? null,
      },
      movements: [
        { unit: 'points', accountRef: 'system:adjustments:points:source', accountType: 'system_source', amount: -payload.delta },
        { unit: 'points', accountRef: `user:${user.id}:points:available`, accountType: 'available', ownerUserId: user.id, amount: payload.delta },
      ],
      actor,
      allowNegative: true,
    })
    const account = await getOrCreatePointAccount(transaction, user.id)
    const ledgerEntry = await transaction.pointLedger.create({
      data: {
        id: `ledger-${sourceId}`,
        userId: user.id,
        sourceType: 'manual_adjustment',
        sourceId,
        delta: payload.delta,
        balanceAfter: account.balance,
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

  const mediaStorageCleanupRetentionDays = () => {
    const parsed = Number.parseInt(process.env.MEDIA_STORAGE_CLEANUP_RETENTION_DAYS ?? '', 10)
    return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, 3650) : 30
  }

  const mediaStorageCleanupAfter = (now = new Date(), retentionDays = mediaStorageCleanupRetentionDays()) =>
    new Date(now.getTime() + retentionDays * 86400_000)

  const activePrismaStorageState = (asset, { archivedAt = asset.archivedAt, deletedAt = asset.deletedAt } = {}) => {
    if (asset.storageObject?.deletedAt) return 'deleted'
    if (deletedAt) return 'cleanup_pending'
    if (archivedAt) return 'quarantined'
    return asObject(asObject(asset.metadata)?.security)?.scanStatus === 'clean' ? 'available' : 'quarantined'
  }

  const transitionPrismaStorageObject = async (transaction, asset, state, now = new Date(), patch = {}) => {
    if (!asset.storageObject) return
    const changed = await transaction.mediaStorageObject.updateMany({
      where: { assetId: asset.id, version: asset.storageObject.version },
      data: {
        ...patch,
        state,
        quarantinedAt: state === 'available' ? null : (patch.quarantinedAt ?? asset.storageObject.quarantinedAt ?? now),
        version: { increment: 1 },
      },
    })
    if (changed.count !== 1) throw new HttpError(409, 'MEDIA_STORAGE_CONFLICT', 'Media storage state changed concurrently')
  }

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
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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
      return user ? mapAccount(user) : fallbackRepository.auth?.getCurrentUser?.() ?? null
    },
    findDemoAccountByAccessToken: async (token) => {
      const activeAccount = await getActiveAccessAccount(token)
      if (activeAccount) {
        return activeAccount
      }
      const fallback = fallbackRepository.auth?.findDemoAccountByAccessToken?.(token)
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
      const fallback = fallbackRepository.auth?.findDemoAccountByRefreshToken?.(token)
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
      const fallback = fallbackRepository.auth?.findDemoAccountByHandle?.(handle)
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
    createOAuthAuthorizationRequest: async ({ stateHash, provider, redirectTo, linkUserId = null, expiresAt }) => {
      try {
        await client.$transaction(async (transaction) => {
          await transaction.oAuthAuthorizationRequest.deleteMany({
            where: { expiresAt: { lte: new Date() } },
          })
          await transaction.oAuthAuthorizationRequest.create({
            data: {
              stateHash,
              provider,
              redirectTo,
              linkUserId,
              expiresAt: new Date(expiresAt),
            },
          })
        })
        return true
      } catch (error) {
        if (error?.code === 'P2002') {
          return false
        }
        throw error
      }
    },
    consumeOAuthAuthorizationRequest: async ({ stateHash, provider }) => {
      return client.$transaction(async (transaction) => {
        const result = await transaction.oAuthAuthorizationRequest.updateMany({
          where: {
            stateHash,
            provider,
            consumedAt: null,
            expiresAt: { gt: new Date() },
          },
          data: { consumedAt: new Date() },
        })
        if (result.count !== 1) {
          return null
        }
        return transaction.oAuthAuthorizationRequest.findUnique({ where: { stateHash } })
      })
    },
    completeOAuthLogin: async ({ profile, linkUserId = null }) => {
      const normalizedEmail = normalizeEmail(profile.email)
      const providerWhere = {
        provider_providerUserId: oauthKey(profile.provider, profile.providerUserId),
      }
      try {
        return await runSerializableTransaction(async (transaction) => {
        const linkedAccount = await transaction.authAccount.findUnique({
          where: providerWhere,
          include: { user: { include: { profile: true } } },
        })

        if (linkUserId) {
          if (linkedAccount && linkedAccount.userId !== linkUserId) {
            return null
          }
          const user = await transaction.user.findUnique({
            where: { id: linkUserId },
            include: { profile: true },
          })
          if (!user || user.status !== 'active') {
            return null
          }
          if (!linkedAccount) {
            await transaction.authAccount.create({
              data: {
                userId: user.id,
                provider: profile.provider,
                providerUserId: profile.providerUserId,
                passwordHash: null,
              },
            })
            await recordAudit({
              actor: mapAccount(user),
              action: 'auth.oauth.linked',
              resourceType: 'auth_account',
              resourceId: oauthAuditResourceId(profile.provider, profile.providerUserId),
              metadata: { provider: profile.provider },
            }, transaction)
          }
          return createSessionForUser(user, 'auth.session.created', { db: transaction })
        }

        if (linkedAccount) {
          return linkedAccount.user?.status === 'active'
            ? createSessionForUser(linkedAccount.user, 'auth.session.created', { db: transaction })
            : null
        }

        const existingUser = await transaction.user.findUnique({
          where: { email: normalizedEmail },
          include: { profile: true },
        })
        if (existingUser) {
          if (existingUser.status !== 'active') {
            return null
          }
          await transaction.authAccount.create({
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
            resourceId: oauthAuditResourceId(profile.provider, profile.providerUserId),
            metadata: { provider: profile.provider },
          }, transaction)
          return createSessionForUser(existingUser, 'auth.session.created', { db: transaction })
        }

        const handle = await makeUniqueProfileHandle(normalizedEmail, profile.provider, transaction)
        const user = await transaction.user.create({
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
        }, transaction)
          return createSessionForUser(user, 'auth.session.created', { db: transaction })
        })
      } catch (error) {
        if (error?.code === 'P2002') {
          return null
        }
        throw error
      }
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
      return runSerializableTransaction(async (transaction) => {
        const account = await transaction.authAccount.findFirst({
          where: {
            userId: actor.id,
            provider,
            NOT: { provider: 'email' },
          },
        })
        if (!account) {
          return null
        }
        const authMethodCount = await transaction.authAccount.count({
          where: { userId: actor.id },
        })
        if (authMethodCount <= 1) {
          return { blocked: true }
        }
        await transaction.authAccount.delete({ where: { id: account.id } })
        await recordAudit({
          actor,
          action: 'auth.oauth.unlinked',
          resourceType: 'auth_account',
          resourceId: oauthAuditResourceId(account.provider, account.providerUserId),
          metadata: { provider: account.provider },
        }, transaction)
        return { unlinked: true }
      })
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
    workflow: async (id, actor) => {
      const task = await client.task.findUnique({
        where: { id: String(id) },
        include: {
          publisher: { include: { profile: true } },
          assignee: { include: { profile: true } },
          proposals: { where: { proposer: { profile: { handle: actor.handle } } }, take: 1 },
          submissions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: { submitter: { include: { profile: true } } },
          },
        },
      })
      if (!task) return null
      const taskDto = getTaskDto(task)
      const latestSubmission = task.submissions[0] ?? null
      return taskWorkflowDto({
        taskId: task.id,
        status: taskDto.status,
        disputeStatus: taskDto.disputeStatus ?? null,
        actorHandle: actor.handle,
        publisherHandle: userHandle(task.publisher),
        assigneeHandle: userHandle(task.assignee),
        hasProposal: task.proposals.length > 0,
        latestSubmissionStatus: latestSubmission?.status ?? null,
        latestSubmitterHandle: userHandle(latestSubmission?.submitter),
        admin: hasPermission(actor, 'admin:access'),
      })
    },
    listDeliveryTargets: async (actor) => {
      const owner = await findUserByHandle(actor.handle)
      if (!owner) return []
      const rows = await client.task.findMany({
        where: { assigneeId: owner.id, status: { in: ['in_progress', 'rejected'] } },
        select: { id: true, title: true, status: true, category: true },
        orderBy: { updatedAt: 'desc' },
      })
      return rows.map((task) => ({ ...task, status: task.status === 'rejected' ? 'Rejected' : 'In Progress' }))
    },
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
    findAccessibleChatContext: async (id, actor) => {
      const user = await findUserByHandle(actor.handle)
      if (!user) return null
      const row = await client.task.findFirst({
        where: {
          id: String(id),
          OR: [
            { visibility: 'public' },
            { publisherId: user.id },
            { assigneeId: user.id },
            { proposals: { some: { proposerId: user.id } } },
            { submissions: { some: { submitterId: user.id } } },
          ],
        },
        select: { title: true, description: true, acceptanceRules: true },
      })
      return row ? { title: row.title, content: [row.description, row.acceptanceRules].filter(Boolean).join('\n') } : null
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
        await createTaskEscrow(transaction, createdTask, publisher.id, actor)
        await enqueueDomainEvent(transaction, taskCreatedEvent({
          task: createdTask,
          publisherId: publisher.id,
          correlationId: `task-create:${createdTask.id}`,
          actor,
        }))
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
      const claimed = await client.task.updateMany({
        where: {
          id: String(id),
          status: 'open',
          assigneeId: null,
          publisherId: { not: assignee.id },
        },
        data: { status: 'in_progress', assigneeId: assignee.id },
      })
      const row = await client.task.findUnique({
        where: { id: String(id) },
        include: {
          publisher: { include: { profile: true } },
          assignee: { include: { profile: true } },
        },
      })
      if (!row) return null
      if (claimed.count === 0) {
        if (row.status === 'in_progress' && row.assigneeId === assignee.id) return getTaskDto(row)
        if (row.publisherId === assignee.id) {
          throw new HttpError(409, 'TASK_SELF_ASSIGNMENT_NOT_ALLOWED', 'Publishers cannot claim their own tasks')
        }
        throw new HttpError(409, 'TASK_NOT_CLAIMABLE', 'Task is not currently eligible to be claimed')
      }
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
      if (task.status !== 'open') {
        throw new HttpError(409, 'TASK_NOT_OPEN_FOR_PROPOSALS', 'Task is not open for proposals')
      }
      if (task.publisherId === proposer.id) {
        throw new HttpError(409, 'TASK_SELF_PROPOSAL_NOT_ALLOWED', 'Publishers cannot propose on their own tasks')
      }
      const existingProposal = await client.taskProposal.findFirst({
        where: { taskId: String(id), proposerId: proposer.id },
        include: { proposer: { include: { profile: true } } },
      })
      if (existingProposal) {
        if (existingProposal.coverLetter === payload.coverLetter && (existingProposal.estimate ?? '') === (payload.estimate ?? '')) {
          return getTaskProposalDto(existingProposal)
        }
        throw new HttpError(409, 'TASK_PROPOSAL_ALREADY_EXISTS', 'A proposal already exists for this creator and task')
      }
      let proposal
      try {
        proposal = await client.$transaction(async (transaction) => {
          const created = await transaction.taskProposal.create({
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
          const proposalCount = await transaction.taskProposal.count({ where: { taskId: String(id) } })
          const taskDto = getTaskDto(task)
          await transaction.task.update({
            where: { id: String(id) },
            data: { metadata: { ...taskDto, proposals: proposalCount } },
          })
          return created
        })
      } catch (error) {
        if (error?.code !== 'P2002') throw error
        const concurrent = await client.taskProposal.findFirst({
          where: { taskId: String(id), proposerId: proposer.id },
          include: { proposer: { include: { profile: true } } },
        })
        if (concurrent && concurrent.coverLetter === payload.coverLetter && (concurrent.estimate ?? '') === (payload.estimate ?? '')) {
          return getTaskProposalDto(concurrent)
        }
        throw new HttpError(409, 'TASK_PROPOSAL_ALREADY_EXISTS', 'A proposal already exists for this creator and task')
      }
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
      if (proposal.status !== 'pending') {
        if (proposal.status === proposalStatus) return getTaskProposalDto(proposal)
        throw new HttpError(409, 'TASK_PROPOSAL_ALREADY_DECIDED', 'Proposal already has a different decision')
      }
      if (proposal.task.status !== 'open') {
        throw new HttpError(409, 'TASK_PROPOSAL_NOT_REVIEWABLE', 'Task is not open for proposal review')
      }
      let autoRejectedProposerHandles = []
      const updatedProposal = await client.$transaction(async (transaction) => {
        if (payload.decision === 'accept') {
          const assigned = await transaction.task.updateMany({
            where: { id: String(id), status: 'open', assigneeId: null },
            data: { status: 'in_progress', assigneeId: proposal.proposerId },
          })
          if (assigned.count !== 1) {
            throw new HttpError(409, 'TASK_PROPOSAL_NOT_REVIEWABLE', 'Task is not open for proposal review')
          }
        }
        const decided = await transaction.taskProposal.updateMany({
          where: { id: proposal.id, status: 'pending' },
          data: {
            status: proposalStatus,
            metadata: { ...(asObject(proposal.metadata) ?? {}), decisionNote: payload.note ?? '' },
          },
        })
        if (decided.count !== 1) {
          throw new HttpError(409, 'TASK_PROPOSAL_ALREADY_DECIDED', 'Proposal was decided concurrently')
        }
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
            data: { metadata: { ...taskDto, status: 'In Progress', assignee: proposal.proposer.profile?.handle ?? proposal.proposer.id } },
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
        return transaction.taskProposal.findUnique({
          where: { id: proposal.id },
          include: { proposer: { include: { profile: true } } },
        })
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
      const publisherHandle = task.publisher?.profile?.handle ?? task.publisher?.id ?? null
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
      if (task.status === 'pending_review' && previousSubmission?.status === 'pending_review') {
        const samePayload = previousSubmission.content === payload.content &&
          previousSubmission.rightsNote === (payload.rightsNote ?? '') &&
          JSON.stringify(previousSubmission.assetIds ?? []) === JSON.stringify(payload.assetIds ?? [])
        if (samePayload) return getTaskDto(task)
        throw new HttpError(409, 'TASK_SUBMISSION_ALREADY_PENDING', 'A different submission is already pending review')
      }
      const taskDto = getTaskDto(task)
      const directOpenSubmission = task.status === 'open' && !task.assigneeId && task.publisherId !== submitter.id
      if ((!directOpenSubmission && !['in_progress', 'rejected'].includes(task.status)) || taskDto.disputeStatus === 'rejected') {
        throw new HttpError(409, 'TASK_NOT_SUBMITTABLE', 'Task is not currently eligible for submission')
      }
      const [assets, generations] = await Promise.all([
        client.mediaAsset.findMany({ where: { id: { in: payload.assetIds ?? [] } } }),
        client.creativeGeneration.findMany({ where: { outputAssetIds: { hasSome: payload.assetIds ?? [] } } }),
      ])
      const resolvedAssets = resolveCreativeDeliveryAssets({ assetIds: payload.assetIds, assets, generations, actor: { ...actor, id: submitter.id }, target: 'task_submission' })
      const isResubmission = previousSubmission?.status === 'revision_requested'
      const { row, submission } = await client.$transaction(async (transaction) => {
        const transitioned = await transaction.task.updateMany({
          where: {
            id: String(id),
            status: { in: ['open', 'in_progress', 'rejected'] },
            OR: [{ assigneeId: submitter.id }, { assigneeId: null, publisherId: { not: submitter.id } }],
          },
          data: {
            status: 'pending_review',
            assigneeId: submitter.id,
            metadata: {
              ...taskDto,
              status: 'Pending Review',
              submission: payload.content,
              resultLinks: payload.assetIds?.length ? payload.assetIds : taskDto.resultLinks,
              rights: payload.rightsNote ?? taskDto.rights,
              disputeStatus: null,
              disputeReason: '',
              disputeReviewId: null,
            },
          },
        })
        if (transitioned.count !== 1) {
          throw new HttpError(409, 'TASK_SUBMISSION_ALREADY_PENDING', 'Task received another submission concurrently')
        }
        const createdSubmission = await transaction.taskSubmission.create({
          data: {
            id: `submission-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
            taskId: String(id),
            submitterId: submitter.id,
            content: payload.content,
            assetIds: payload.assetIds ?? [],
            rightsNote: payload.rightsNote ?? '',
            status: 'pending_review',
            metadata: { assetEvidence: resolvedAssets.map((item) => item.evidence) },
            assets: {
              create: resolvedAssets.map((item, position) => ({
                assetId: item.asset.id,
                ownerId: submitter.id,
                position,
              })),
            },
          },
        })
        const updatedTask = await transaction.task.findUnique({
          where: { id: String(id) },
          include: {
            publisher: { include: { profile: true } },
            assignee: { include: { profile: true } },
          },
        })
        return { row: updatedTask, submission: createdSubmission }
      })
      if (!row) throw new Error(`Task submission update failed for ${id}`)
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
      if (task.status === 'disputed' || taskDto.disputeStatus === 'open') {
        if (taskDto.disputeReason === payload.reason) return taskDto
        throw new HttpError(409, 'TASK_DISPUTE_ALREADY_OPEN', 'A dispute is already open for this submission')
      }
      const row = await client.$transaction(async (transaction) => {
        const submission = await transaction.taskSubmission.findFirst({
          where: {
            taskId: String(id),
            status: { in: ['rejected', 'stale'] },
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
        const reviewId = `review-task-dispute-${task.id}-${submission.id}`
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
        const claimedSubmission = await transaction.taskSubmission.updateMany({
          where: { id: submission.id, status: { in: ['rejected', 'stale'] } },
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
        if (claimedSubmission.count !== 1) {
          throw new HttpError(409, 'TASK_DISPUTE_ALREADY_OPEN', 'A dispute was opened concurrently')
        }
        const claimedTask = await transaction.task.updateMany({
          where: { id: String(task.id), status: { in: ['rejected', 'pending_review'] } },
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
        })
        if (claimedTask.count !== 1) {
          throw new HttpError(409, 'TASK_DISPUTE_ALREADY_OPEN', 'Task dispute state changed concurrently')
        }
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
        return transaction.task.findUnique({
          where: { id: String(task.id) },
          include: {
            publisher: { include: { profile: true } },
            assignee: { include: { profile: true } },
          },
        })
      })
      return row ? getTaskDto(row) : null
    },
    sweepStaleSubmissions: async (payload, actor = null) => {
      const cutoff = new Date(Date.now() - payload.olderThanHours * 60 * 60 * 1000)
      const rows = await client.$transaction(async (transaction) => {
        const submissions = await transaction.taskSubmission.findMany({
          where: {
            status: 'pending_review',
            createdAt: { lte: cutoff },
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
          const claimed = await transaction.taskSubmission.updateMany({
            where: { id: submission.id, status: 'pending_review' },
            data: {
              status: 'stale',
              metadata: {
                ...metadata,
                stale: staleMetadata,
              },
            },
          })
          if (claimed.count !== 1) continue
          const row = await transaction.taskSubmission.findUnique({
            where: { id: submission.id },
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
          if (row) updated.push(row)
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
      const isApproval = payload.decision === 'approve'
      const isRevisionRequest = payload.decision === 'request_changes'
      const nextTaskStatus = isApproval ? 'Completed' : isRevisionRequest ? 'In Progress' : 'Rejected'
      const nextSubmissionStatus = isApproval ? 'approved' : isRevisionRequest ? 'revision_requested' : 'rejected'
      if (task.status !== 'pending_review') {
        const latestSubmission = await client.taskSubmission.findFirst({
          where: { taskId: String(id) },
          orderBy: { createdAt: 'desc' },
        })
        const metadata = asObject(latestSubmission?.metadata) ?? {}
        const sameDecision = taskStatusFromLabel(nextTaskStatus) === task.status &&
          latestSubmission?.status === nextSubmissionStatus &&
          (latestSubmission.reviewNote ?? '') === payload.reviewNote &&
          JSON.stringify(metadata.acceptanceChecklist ?? []) === JSON.stringify(payload.acceptanceChecklist ?? [])
        if (sameDecision) return getTaskDto(task)
        throw new HttpError(409, 'TASK_NOT_REVIEWABLE', 'Task has no submission pending review')
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
        const transitioned = await transaction.task.updateMany({
          where: { id: String(id), status: 'pending_review' },
          data: reviewTaskData,
        })
        if (transitioned.count !== 1) {
          throw new HttpError(409, 'TASK_REVIEW_CONFLICT', 'Task was reviewed concurrently')
        }
        const updatedTask = await transaction.task.findUnique({
          where: { id: String(id) },
          include: {
            publisher: { include: { profile: true } },
            assignee: { include: { profile: true } },
          },
        })
        if (!updatedTask) {
          throw new Error(`Task review update failed for ${id}`)
        }
        if (pendingSubmission) {
          const reviewedSubmission = await transaction.taskSubmission.updateMany({
            where: { id: pendingSubmission.id, status: 'pending_review' },
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
          if (reviewedSubmission.count !== 1) {
            throw new HttpError(409, 'TASK_REVIEW_CONFLICT', 'Submission was reviewed concurrently')
          }
        }
        if (isApproval) {
          await finalizeTaskEscrow(transaction, task, task.publisherId, 'approve', actor)
          await settleTaskReward(transaction, task, task.assigneeId ?? pendingSubmission?.submitterId ?? null, actor)
          await applyTaskCompletionReputation(transaction, task, task.assigneeId ?? pendingSubmission?.submitterId ?? null)
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

  const publicPortfolioWhere = {
    status: 'published',
    asset: { is: { archivedAt: null, deletedAt: null, status: 'uploaded', metadata: { path: ['security', 'scanStatus'], equals: 'clean' } } },
  }
  const publicProfileDto = (row) => ({
    ...getProfileDto(row),
    portfolio: (row.portfolioAssets ?? []).map(getPortfolioAssetDto),
  })

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
        include: { user: true, portfolioAssets: { where: publicPortfolioWhere, include: { asset: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }] } },
        orderBy: { handle: 'asc' },
        take: limit + 1,
        ...(cursor ? { cursor: { handle: cursor.handle }, skip: 1 } : {}),
      })
      const pageRows = rows.slice(0, limit)
      return {
        items: pageRows.map(publicProfileDto),
        nextCursor: rows.length > limit && pageRows.length > 0 ? pageRows[pageRows.length - 1].handle : null,
        limit,
      }
    },
    findByHandle: async (handle) => {
      const row = await client.profile.findUnique({
        where: { handle },
        include: { user: true, portfolioAssets: { where: publicPortfolioWhere, include: { asset: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }] } },
      })
      return row ? publicProfileDto(row) : null
    },
    listOwnPortfolio: async (actor) => {
      const owner = await findUserByHandle(actor.handle)
      if (!owner) return []
      const rows = await client.profilePortfolioAsset.findMany({
        where: { ownerId: owner.id }, include: { asset: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      })
      return rows.map(getPortfolioAssetDto)
    },
    createPortfolioDraft: async (assetId, payload, actor) => {
      const owner = await findUserByHandle(actor.handle)
      if (!owner) return null
      const [asset, generation] = await Promise.all([
        client.mediaAsset.findUnique({ where: { id: String(assetId) } }),
        client.creativeGeneration.findFirst({ where: { outputAssetIds: { has: String(assetId) } } }),
      ])
      const [resolved] = resolveCreativeDeliveryAssets({ assetIds: [assetId], assets: asset ? [asset] : [], generations: generation ? [generation] : [], actor: { ...actor, id: owner.id }, target: 'profile_portfolio' })
      if (payload.sourceSubmissionId) {
        const source = await client.taskSubmission.findFirst({ where: { id: payload.sourceSubmissionId, submitterId: owner.id, assetIds: { has: String(assetId) } } })
        if (!source) throw new HttpError(409, 'PORTFOLIO_SOURCE_SUBMISSION_INVALID', 'Source submission does not contain this asset')
      }
      const row = await client.profilePortfolioAsset.upsert({
        where: { ownerId_assetId: { ownerId: owner.id, assetId: String(assetId) } },
        create: {
          ownerId: owner.id, assetId: String(assetId), sourceGenerationId: resolved.generation.id,
          sourceSubmissionId: payload.sourceSubmissionId ?? null, title: payload.title || asset.fileName, caption: payload.caption ?? '',
        },
        update: {},
        include: { asset: { include: { storageObject: true } } },
      })
      await recordAudit({ actor, action: 'profile.portfolio.draft_created', resourceType: 'profile_portfolio_asset', resourceId: row.id, metadata: { assetId: row.assetId } })
      return getPortfolioAssetDto(row)
    },
    updatePortfolioAsset: async (id, payload, actor) => {
      const owner = await findUserByHandle(actor.handle)
      if (!owner) return null
      const current = await client.profilePortfolioAsset.findFirst({ where: { id: String(id), ownerId: owner.id }, include: { asset: true, sourceGeneration: true } })
      if (!current) return null
      const allowed = {
        publish: ['draft', 'withdrawn'], withdraw: ['published'], archive: ['draft', 'published', 'withdrawn'], restore: ['archived'],
      }
      if (payload.action && !allowed[payload.action]?.includes(current.status)) {
        throw new HttpError(409, 'PORTFOLIO_TRANSITION_INVALID', `Cannot ${payload.action} a ${current.status} portfolio item`)
      }
      if (payload.action === 'publish') {
        resolveCreativeDeliveryAssets({ assetIds: [current.assetId], assets: [current.asset], generations: current.sourceGeneration ? [current.sourceGeneration] : [], actor: { ...actor, id: owner.id }, target: 'profile_portfolio' })
      }
      const now = new Date()
      const actionData = payload.action === 'publish' ? { status: 'published', publishedAt: now, withdrawnAt: null, archivedAt: null }
        : payload.action === 'withdraw' ? { status: 'withdrawn', withdrawnAt: now }
          : payload.action === 'archive' ? { status: 'archived', archivedAt: now }
            : payload.action === 'restore' ? { status: 'draft', publishedAt: null, withdrawnAt: null, archivedAt: null }
              : {}
      const row = await client.profilePortfolioAsset.update({
        where: { id: current.id },
        data: { ...actionData, title: payload.title, caption: payload.caption, sortOrder: payload.sortOrder },
        include: { asset: { include: { storageObject: true } } },
      })
      await recordAudit({ actor, action: `profile.portfolio.${payload.action ?? 'updated'}`, resourceType: 'profile_portfolio_asset', resourceId: row.id, metadata: { assetId: row.assetId } })
      return getPortfolioAssetDto(row)
    },
    listRankings: async () => {
      const rows = await client.profile.findMany({
        include: { user: true, portfolioAssets: { where: publicPortfolioWhere, include: { asset: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }] } },
        orderBy: { handle: 'asc' },
      })
      return rows
        .map(publicProfileDto)
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
      const row = await client.$transaction(async (transaction) => {
        const generation = await transaction.creativeGeneration.upsert({
          where: { id: data.id },
          create: data,
          update: {},
        })
        if (generation.actorId) {
          const requested = [...new Set([...(generation.inputAssetIds ?? []), ...(generation.outputAssetIds ?? [])])]
          const existingAssets = await transaction.mediaAsset.findMany({
            where: { id: { in: requested }, ownerId: generation.actorId },
            select: { id: true },
          })
          const existing = new Set(existingAssets.map((asset) => asset.id))
          const relations = [
            ...(generation.inputAssetIds ?? []).map((assetId, position) => ({ assetId, direction: 'input', position })),
            ...(generation.outputAssetIds ?? []).map((assetId, position) => ({ assetId, direction: 'output', position })),
          ].filter((relation) => existing.has(relation.assetId))
          if (relations.length) {
            await transaction.creativeGenerationAsset.createMany({
              data: relations.map((relation) => ({ ...relation, generationId: generation.id, ownerId: generation.actorId })),
              skipDuplicates: true,
            })
          }
        }
        return generation
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
      const row = await client.$transaction(async (transaction) => {
        const generation = await transaction.creativeGeneration.update({
          where: { id: current.id },
          data: { outputAssetIds },
        })
        if (generation.actorId) {
          const assets = await transaction.mediaAsset.findMany({
            where: { id: { in: assetIds.filter(Boolean) }, ownerId: generation.actorId },
            select: { id: true },
          })
          const positions = new Map(outputAssetIds.map((assetId, position) => [assetId, position]))
          if (assets.length) {
            await transaction.creativeGenerationAsset.createMany({
              data: assets.map((asset) => ({
                generationId: generation.id,
                assetId: asset.id,
                ownerId: generation.actorId,
                direction: 'output',
                position: positions.get(asset.id),
              })),
              skipDuplicates: true,
            })
          }
        }
        return generation
      })
      if ((current.inputAssetIds?.length ?? 0) > 0 && assetIds.filter(Boolean).length > 0 && current.actorId) {
        for (const sourceAssetId of current.inputAssetIds) {
          for (const targetAssetId of assetIds.filter(Boolean)) {
            const relationTypes = current.workspace === 'image' && ['image_to_image', 'image_edit', 'image_variation'].includes(current.mode)
              ? ['reused_as_input', 'variant'] : ['reused_as_input']
            for (const relationType of relationTypes) {
              const data = { ownerId: current.actorId, sourceAssetId, targetAssetId, relationType, sourceGenerationId: current.id, targetWorkspace: current.workspace, role: relationType === 'variant' ? 'source' : 'input' }
              const existing = await client.mediaAssetRelation.findFirst({ where: data })
              if (!existing) await client.mediaAssetRelation.create({ data })
            }
          }
        }
      }
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

  const creativeProviderOperations = {
    record: async (payload, actor) => {
      const generationId = String(payload.generationId)
      const providerJobId = safeProviderJobIdEvidence(payload.providerJobId)
      const existing = await client.creativeProviderOperation.findUnique({ where: { generationId } })
      if (existing) {
        if (existing.providerId !== payload.providerId || existing.providerJobId !== providerJobId) {
          throw new HttpError(409, 'CREATIVE_PROVIDER_OPERATION_CONFLICT', 'Creative Provider operation state conflict', {
            reasonCode: 'operation_identity_mismatch',
          })
        }
        return { created: false, operation: getCreativeProviderOperationDto(existing) }
      }
      let row
      try {
        row = await client.creativeProviderOperation.create({
          data: {
            id: payload.id ?? `provider-operation-${randomUUID()}`,
            generationId,
            providerId: payload.providerId,
            providerMode: payload.providerMode,
            providerJobId,
            status: payload.status ?? 'queued',
            pollAttempts: Number(payload.pollAttempts ?? 0),
            nextPollAt: asDateOrNull(payload.nextPollAt),
            timeoutAt: new Date(payload.timeoutAt),
            lastPayloadHash: payload.lastPayloadHash ?? null,
            outputDigest: payload.outputDigest ?? null,
            lastErrorCode: payload.lastErrorCode ?? null,
            sideEffectsComplete: Boolean(payload.sideEffectsComplete),
            safeMetadata: safeProviderOperationMetadata(payload.safeMetadata) ?? undefined,
            terminalAt: asDateOrNull(payload.terminalAt),
          },
        })
      } catch (error) {
        if (error?.code !== 'P2002') throw error
        const duplicate = await client.creativeProviderOperation.findUnique({ where: { generationId } })
        if (duplicate?.providerId === payload.providerId && duplicate.providerJobId === providerJobId) {
          return { created: false, operation: getCreativeProviderOperationDto(duplicate) }
        }
        throw new HttpError(409, 'CREATIVE_PROVIDER_OPERATION_CONFLICT', 'Creative Provider operation state conflict', {
          reasonCode: 'provider_job_already_recorded',
        })
      }
      await recordAudit({
        actor,
        action: 'creative.provider_operation.recorded',
        resourceType: 'creative_provider_operation',
        resourceId: row.id,
        metadata: {
          generationId: row.generationId,
          providerId: row.providerId,
          providerJobId: safeProviderJobIdEvidence(row.providerJobId),
          status: row.status,
        },
      })
      return { created: true, operation: getCreativeProviderOperationDto(row) }
    },
    findForGeneration: async (generationId) => {
      const row = await client.creativeProviderOperation.findUnique({ where: { generationId: String(generationId) } })
      return row ? getCreativeProviderOperationDto(row) : null
    },
    listDue: async (options = {}) => {
      const limit = Math.max(1, options.limit ?? 10)
      const rows = await client.creativeProviderOperation.findMany({
        where: {
          ...(options.providerId ? { providerId: String(options.providerId) } : {}),
          AND: [
            {
              OR: [
                { status: { in: (options.statuses ?? ['queued', 'running']).map(String) } },
                { sideEffectsComplete: false },
              ],
            },
            {
              OR: [
                { nextPollAt: null },
                { nextPollAt: { lte: new Date(options.dueBefore ?? new Date()) } },
              ],
            },
          ],
        },
        orderBy: [{ nextPollAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        take: limit,
      })
      return { items: rows.map(getCreativeProviderOperationDto), limit }
    },
    update: async (generationId, patch = {}, actor, options = {}) => {
      const current = await client.creativeProviderOperation.findUnique({ where: { generationId: String(generationId) } })
      if (!current) return null
      if (options.expectedVersion != null && Number(options.expectedVersion) !== current.version) {
        throw new HttpError(409, 'CREATIVE_PROVIDER_OPERATION_CONFLICT', 'Creative Provider operation state conflict', {
          reasonCode: 'operation_version_mismatch',
        })
      }
      if (patch.providerJobId && safeProviderJobIdEvidence(patch.providerJobId) !== current.providerJobId) {
        throw new HttpError(409, 'CREATIVE_PROVIDER_OPERATION_CONFLICT', 'Creative Provider operation state conflict', {
          reasonCode: 'provider_job_mismatch',
        })
      }
      const changed = await client.creativeProviderOperation.updateMany({
        where: { id: current.id, version: current.version },
        data: {
          ...compactObject({
            status: patch.status,
            pollAttempts: patch.pollAttempts == null ? undefined : Number(patch.pollAttempts),
            nextPollAt: patch.nextPollAt === undefined ? undefined : asDateOrNull(patch.nextPollAt),
            timeoutAt: patch.timeoutAt == null ? undefined : new Date(patch.timeoutAt),
            lastPayloadHash: patch.lastPayloadHash,
            outputDigest: patch.outputDigest,
            lastErrorCode: patch.lastErrorCode,
            sideEffectsComplete: patch.sideEffectsComplete,
            safeMetadata: patch.safeMetadata === undefined
              ? undefined
              : safeProviderOperationMetadata(patch.safeMetadata) ?? undefined,
            terminalAt: patch.terminalAt === undefined ? undefined : asDateOrNull(patch.terminalAt),
          }),
          version: { increment: 1 },
        },
      })
      if (changed.count !== 1) {
        throw new HttpError(409, 'CREATIVE_PROVIDER_OPERATION_CONFLICT', 'Creative Provider operation state conflict', {
          reasonCode: 'operation_version_mismatch',
        })
      }
      const row = await client.creativeProviderOperation.findUnique({ where: { id: current.id } })
      await recordAudit({
        actor,
        action: 'creative.provider_operation.updated',
        resourceType: 'creative_provider_operation',
        resourceId: row.id,
        metadata: {
          generationId: row.generationId,
          providerId: row.providerId,
          providerJobId: safeProviderJobIdEvidence(row.providerJobId),
          status: row.status,
          version: row.version,
          sideEffectsComplete: row.sideEffectsComplete,
        },
      })
      return getCreativeProviderOperationDto(row)
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
      if (amount <= 0) {
        throw new HttpError(409, 'CREATIVE_CREDIT_AMOUNT_INVALID', 'Creative credit reservation amount must be positive')
      }
      return client.$transaction(async (transaction) => {
        const lockKey = `creative-credit:${payload.quotaReservationId ?? payload.generationId ?? ''}`
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`
        const existing = await findCreativeCreditLedger(transaction, payload.quotaReservationId ?? payload.generationId)
        if (existing) {
          const samePayload = existing.generationId === String(payload.generationId ?? '') &&
            existing.reservationAmount === amount &&
            existing.workspace === payload.workspace &&
            existing.mode === payload.mode
          if (!samePayload) {
            throw new HttpError(409, 'ACCOUNTING_OPERATION_CONFLICT', 'Creative credit reservation already exists with a different payload')
          }
          return {
            reserved: existing.status === 'reserved',
            credit: getCreativeCreditDto(existing),
          }
        }
        const ledger = await transaction.creativeCreditLedger.create({
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
        await applyPrismaAccountingOperation(transaction, {
          unit: 'creative_credit',
          kind: 'credit_reserve',
          sourceType: 'generation',
          sourceId: ledger.generationId,
          reasonCode: 'generation_reserved',
          payload: { generationId: ledger.generationId, actorHandle: ledger.actorHandle, amount },
          movements: [
            { unit: 'creative_credit', accountRef: `user:${ledger.actorHandle}:creative_credit:available`, accountType: 'available', amount: -amount },
            { unit: 'creative_credit', accountRef: `generation:${ledger.generationId}:creative_credit:reserved`, accountType: 'reserved', amount },
          ],
          actor,
        })
        await transaction.auditEvent.create({
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
      })
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
        if (settledAmount !== ledger.reservationAmount) {
          throw new HttpError(409, 'CREATIVE_CREDIT_CLOSEOUT_MISMATCH', 'Settled credits must equal the reservation amount')
        }
        const claimed = await transaction.creativeCreditLedger.updateMany({
          where: { id: ledger.id, status: 'reserved' },
          data: {
            status: 'settled',
            settledAmount,
            refundedAmount: 0,
            reasonCode: safeErrorPreview(payload.reasonCode ?? 'generation_completed'),
            metadata: safeCreativeCreditMetadata(payload.metadata) ?? ledger.metadata ?? undefined,
            settledAt: new Date(),
          },
        })
        if (claimed.count !== 1) {
          const concurrent = await findCreativeCreditLedger(transaction, ledger.id)
          return getCreativeCreditDto(concurrent)
        }
        const updated = await findCreativeCreditLedger(transaction, ledger.id)
        await applyPrismaAccountingOperation(transaction, {
          unit: 'creative_credit',
          kind: 'credit_settle',
          sourceType: 'generation',
          sourceId: updated.generationId,
          reasonCode: payload.reasonCode === 'generation_review_required' ? 'generation_review_required' : 'generation_completed',
          payload: { generationId: updated.generationId, ledgerId: updated.id, amount: settledAmount },
          movements: [
            { unit: 'creative_credit', accountRef: `generation:${updated.generationId}:creative_credit:reserved`, accountType: 'reserved', amount: -settledAmount },
            { unit: 'creative_credit', accountRef: 'system:creative_credit:consumed', accountType: 'consumed', amount: settledAmount },
          ],
          actor,
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
        if (refundedAmount !== ledger.reservationAmount) {
          throw new HttpError(409, 'CREATIVE_CREDIT_CLOSEOUT_MISMATCH', 'Refunded credits must equal the reservation amount')
        }
        const claimed = await transaction.creativeCreditLedger.updateMany({
          where: { id: ledger.id, status: 'reserved' },
          data: {
            status: 'refunded',
            settledAmount: 0,
            refundedAmount,
            reasonCode: safeErrorPreview(payload.reasonCode ?? 'generation_failed'),
            metadata: safeCreativeCreditMetadata(payload.metadata) ?? ledger.metadata ?? undefined,
            refundedAt: new Date(),
          },
        })
        if (claimed.count !== 1) {
          const concurrent = await findCreativeCreditLedger(transaction, ledger.id)
          return getCreativeCreditDto(concurrent)
        }
        const updated = await findCreativeCreditLedger(transaction, ledger.id)
        await applyPrismaAccountingOperation(transaction, {
          unit: 'creative_credit',
          kind: 'credit_refund',
          sourceType: 'generation',
          sourceId: updated.generationId,
          reasonCode: String(payload.reasonCode ?? '').includes('cancel') ? 'generation_cancelled' : 'generation_failed',
          payload: { generationId: updated.generationId, ledgerId: updated.id, amount: refundedAmount },
          movements: [
            { unit: 'creative_credit', accountRef: `generation:${updated.generationId}:creative_credit:reserved`, accountType: 'reserved', amount: -refundedAmount },
            { unit: 'creative_credit', accountRef: `user:${updated.actorHandle}:creative_credit:available`, accountType: 'available', amount: refundedAmount },
          ],
          actor,
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
        const claimed = await transaction.creativeCreditLedger.updateMany({
          where: { id: ledger.id, status: 'reserved' },
          data: {
            status: 'cancelled',
            settledAmount: 0,
            refundedAmount: 0,
            reasonCode: safeErrorPreview(payload.reasonCode ?? 'no_charge'),
            metadata: safeCreativeCreditMetadata(payload.metadata) ?? ledger.metadata ?? undefined,
            cancelledAt: new Date(),
          },
        })
        if (claimed.count !== 1) {
          const concurrent = await findCreativeCreditLedger(transaction, ledger.id)
          return getCreativeCreditDto(concurrent)
        }
        const updated = await findCreativeCreditLedger(transaction, ledger.id)
        await applyPrismaAccountingOperation(transaction, {
          unit: 'creative_credit',
          kind: 'credit_refund',
          sourceType: 'generation',
          sourceId: updated.generationId,
          phase: 'cancel',
          reasonCode: 'generation_cancelled',
          payload: { generationId: updated.generationId, ledgerId: updated.id, amount: updated.reservationAmount },
          movements: [
            { unit: 'creative_credit', accountRef: `generation:${updated.generationId}:creative_credit:reserved`, accountType: 'reserved', amount: -updated.reservationAmount },
            { unit: 'creative_credit', accountRef: `user:${updated.actorHandle}:creative_credit:available`, accountType: 'available', amount: updated.reservationAmount },
          ],
          actor,
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
      const generationId = String(payload.generationId ?? '').trim()
      if (!generationId) {
        throw new HttpError(409, 'CREATIVE_QUOTA_GENERATION_INVALID', 'Creative quota reservations require a generation id')
      }
      const units = Math.max(1, Number.parseInt(String(payload.costUnits ?? 1), 10) || 1)
      const limitUnits = Math.max(0, Number.parseInt(String(payload.limit ?? 0), 10) || 0)
      const actorUser = payload.actorHandle || actor?.handle ? await findUserByHandle(payload.actorHandle ?? actor.handle) : null
      const windowId = creativeQuotaWindowId(payload)
      const actorHandle = payload.actorHandle ?? actorUser?.profile?.handle ?? null
      const idempotencyPayloadHash = accountingPayloadHash({
        generationId,
        actorId: actorUser?.id ?? null,
        actorHandle,
        workspace: payload.workspace,
        windowType: payload.windowType,
        windowStart: payload.windowStart,
        windowEnd: payload.windowEnd,
        limitUnits,
        units,
        policyVersion: payload.policyVersion,
      })
      return client.$transaction(async (transaction) => {
        const lockKey = `creative-quota:${generationId}`
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`
        const existing = await transaction.creativeQuotaReservation.findFirst({
          where: { generationId },
          include: { quotaWindow: true },
          orderBy: { createdAt: 'asc' },
        })
        if (existing) {
          const sameLegacyPayload = existing.quotaWindowId === windowId &&
            existing.actorId === (actorUser?.id ?? null) &&
            existing.actorHandle === actorHandle &&
            existing.workspace === payload.workspace &&
            existing.units === units
          const samePayload = existing.idempotencyPayloadHash
            ? existing.idempotencyPayloadHash === idempotencyPayloadHash
            : sameLegacyPayload
          if (!samePayload) {
            throw new HttpError(409, 'ACCOUNTING_OPERATION_CONFLICT', 'Creative quota reservation already exists with a different payload')
          }
          return {
            reserved: existing.status === 'reserved',
            reservationId: existing.id,
            quota: getCreativeQuotaDto(existing.quotaWindow, existing.id),
          }
        }
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
            limitUnits,
            reservedUnits: 0,
            usedUnits: 0,
            releasedUnits: 0,
            policyVersion: payload.policyVersion,
          },
          update: {
            limitUnits,
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
            generationId,
            actorId: actorUser?.id ?? null,
            actorHandle,
            workspace: payload.workspace,
            units,
            idempotencyPayloadHash,
            status: 'reserved',
          },
        })
        await applyPrismaAccountingOperation(transaction, {
          unit: 'quota_unit',
          kind: 'quota_reserve',
          sourceType: 'generation',
          sourceId: reservation.generationId,
          reasonCode: 'generation_reserved',
          payload: { generationId: reservation.generationId, reservationId: reservation.id, units, windowId },
          movements: [
            { unit: 'quota_unit', accountRef: `quota-window:${windowId}:remaining`, accountType: 'remaining', amount: -units },
            { unit: 'quota_unit', accountRef: `generation:${reservation.generationId}:quota_unit:reserved`, accountType: 'reserved', amount: units },
          ],
          actor,
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
        const claimed = await transaction.creativeQuotaReservation.updateMany({
          where: { id: reservation.id, status: 'reserved' },
          data: {
            status: 'committed',
            committedAt: new Date(),
          },
        })
        if (claimed.count !== 1) {
          const concurrent = await transaction.creativeQuotaReservation.findUnique({
            where: { id: reservation.id },
            include: { quotaWindow: true },
          })
          return concurrent ? getCreativeQuotaDto(concurrent.quotaWindow, concurrent.id) : null
        }
        const updatedWindowCount = await transaction.$executeRaw`
          UPDATE "creative_quota_windows"
          SET
            "reserved_units" = "reserved_units" - ${reservation.units},
            "used_units" = "used_units" + ${reservation.units},
            "updated_at" = NOW()
          WHERE "id" = ${reservation.quotaWindowId}
            AND "reserved_units" >= ${reservation.units}
        `
        if (Number(updatedWindowCount) !== 1) {
          throw new HttpError(409, 'CREATIVE_QUOTA_STATE_CONFLICT', 'Creative quota reservation does not match the quota window')
        }
        const updatedReservation = await transaction.creativeQuotaReservation.findUnique({ where: { id: reservation.id } })
        await applyPrismaAccountingOperation(transaction, {
          unit: 'quota_unit',
          kind: 'quota_commit',
          sourceType: 'generation',
          sourceId: updatedReservation.generationId,
          reasonCode: 'generation_completed',
          payload: { generationId: updatedReservation.generationId, reservationId: updatedReservation.id, units: updatedReservation.units },
          movements: [
            { unit: 'quota_unit', accountRef: `generation:${updatedReservation.generationId}:quota_unit:reserved`, accountType: 'reserved', amount: -updatedReservation.units },
            { unit: 'quota_unit', accountRef: `quota-window:${updatedReservation.quotaWindowId}:used`, accountType: 'used', amount: updatedReservation.units },
          ],
          actor,
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
        const claimed = await transaction.creativeQuotaReservation.updateMany({
          where: { id: reservation.id, status: 'reserved' },
          data: {
            status: 'released',
            reason: safeReason,
            releasedAt: new Date(),
          },
        })
        if (claimed.count !== 1) {
          const concurrent = await transaction.creativeQuotaReservation.findUnique({
            where: { id: reservation.id },
            include: { quotaWindow: true },
          })
          return concurrent ? getCreativeQuotaDto(concurrent.quotaWindow, concurrent.id) : null
        }
        const updatedWindowCount = await transaction.$executeRaw`
          UPDATE "creative_quota_windows"
          SET
            "reserved_units" = "reserved_units" - ${reservation.units},
            "released_units" = "released_units" + ${reservation.units},
            "updated_at" = NOW()
          WHERE "id" = ${reservation.quotaWindowId}
            AND "reserved_units" >= ${reservation.units}
        `
        if (Number(updatedWindowCount) !== 1) {
          throw new HttpError(409, 'CREATIVE_QUOTA_STATE_CONFLICT', 'Creative quota reservation does not match the quota window')
        }
        const updatedReservation = await transaction.creativeQuotaReservation.findUnique({ where: { id: reservation.id } })
        await applyPrismaAccountingOperation(transaction, {
          unit: 'quota_unit',
          kind: 'quota_release',
          sourceType: 'generation',
          sourceId: updatedReservation.generationId,
          reasonCode: String(safeReason).includes('cancel') ? 'generation_cancelled' : 'generation_failed',
          payload: { generationId: updatedReservation.generationId, reservationId: updatedReservation.id, units: updatedReservation.units },
          movements: [
            { unit: 'quota_unit', accountRef: `generation:${updatedReservation.generationId}:quota_unit:reserved`, accountType: 'reserved', amount: -updatedReservation.units },
            { unit: 'quota_unit', accountRef: `quota-window:${updatedReservation.quotaWindowId}:remaining`, accountType: 'remaining', amount: updatedReservation.units },
          ],
          actor,
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

  const accountingReconciliation = {
    scan: async (actor, options = {}) => scanPrismaAccounting(actor, options),
    list: async (options = {}) => {
      const issues = await client.accountingReconciliationIssue.findMany({
        orderBy: [{ detectedAt: 'desc' }, { id: 'desc' }],
      })
      return {
        ...paginateAccountingIssues(filterAccountingIssues(issues, options), options),
        summary: accountingIssueSummary(issues),
        generatedAt: new Date().toISOString(),
      }
    },
    find: async (id) => {
      const issue = await client.accountingReconciliationIssue.findUnique({ where: { id: String(id) } })
      return serializeAccountingIssue(issue)
    },
    requestRepair: async (id, payload, actor) => {
      const reviewId = `review-accounting-${String(id)}`
      const result = await client.$transaction(async (transaction) => {
        const issue = await transaction.accountingReconciliationIssue.findUnique({ where: { id: String(id) } })
        if (!issue) return null
        if (!['open', 'repair_pending'].includes(issue.status)) {
          throw new HttpError(409, 'ACCOUNTING_ISSUE_NOT_REPAIRABLE', 'Only open accounting issues can request repair')
        }
        const supported = (issue.type === 'point_balance_drift' && issue.sourceType === 'internal_point_account') ||
          (issue.type === 'quota_state_mismatch' && issue.sourceType === 'creative_quota_window')
        if (!supported) {
          throw new HttpError(409, 'ACCOUNTING_REPAIR_UNSUPPORTED', 'This issue requires manual investigation and cannot be compensated automatically')
        }
        const existingReview = await transaction.adminReview.findUnique({
          where: { id: reviewId },
          include: { reviewedBy: { include: { profile: true } } },
        })
        if (existingReview) return { issue, review: existingReview }
        const review = await transaction.adminReview.create({
          data: {
            id: reviewId,
            queue: 'accounting_reconciliation',
            status: 'Pending review',
            title: `Accounting repair: ${issue.type}`,
            owner: actor.handle,
            note: safeErrorPreview(payload.reason),
            metadata: {
              kind: 'accounting_compensation',
              issueId: issue.id,
              issueKey: issue.issueKey,
              repairKind: payload.repairKind,
              reasonCode: payload.reasonCode,
              requestedBy: actor.handle,
            },
          },
          include: { reviewedBy: { include: { profile: true } } },
        })
        const updatedIssue = await transaction.accountingReconciliationIssue.update({
          where: { id: issue.id },
          data: { status: 'repair_pending' },
        })
        await transaction.auditEvent.create({
          data: buildAuditRecord({
            actorType: 'user',
            actorId: actor.id ?? null,
            action: 'accounting.repair.requested',
            resourceType: 'accounting_reconciliation_issue',
            resourceId: issue.id,
            metadata: {
              reviewId,
              issueKey: issue.issueKey,
              repairKind: payload.repairKind,
              reasonCode: payload.reasonCode,
            },
          }),
        })
        return { issue: updatedIssue, review }
      })
      return result ? {
        issue: serializeAccountingIssue(result.issue),
        review: getAdminReviewDto(result.review),
      } : null
    },
    reviewRepair: async (reviewId, action, actor) => {
      const reviewer = await client.user.findFirst({ where: { profile: { handle: actor.handle } } })
      if (!reviewer) return null
      const result = await client.$transaction(async (transaction) => {
        const review = await transaction.adminReview.findUnique({
          where: { id: String(reviewId) },
          include: { reviewedBy: { include: { profile: true } } },
        })
        const metadata = asObject(review?.metadata) ?? {}
        if (!review || metadata.kind !== 'accounting_compensation') return null
        const issue = await transaction.accountingReconciliationIssue.findUnique({ where: { id: String(metadata.issueId) } })
        if (!issue) return null
        if (review.decision) return { review, issue, operation: null }
        if (action.decision === 'reject') {
          const rejectedAt = new Date()
          const [updatedReview, updatedIssue] = await Promise.all([
            transaction.adminReview.update({
              where: { id: review.id },
              data: {
                status: 'Rejected',
                decision: 'reject',
                note: action.note || review.note,
                reviewedById: reviewer.id,
                reviewedAt: rejectedAt,
              },
              include: { reviewedBy: { include: { profile: true } } },
            }),
            transaction.accountingReconciliationIssue.update({
              where: { id: issue.id },
              data: { status: 'open', reviewedById: reviewer.id, reviewedAt: rejectedAt },
            }),
          ])
          await transaction.auditEvent.create({
            data: buildAuditRecord({
              actorType: 'user',
              actorId: reviewer.id,
              action: 'accounting.repair.rejected',
              resourceType: 'accounting_reconciliation_issue',
              resourceId: issue.id,
              metadata: { reviewId: review.id, issueKey: issue.issueKey },
            }),
          })
          return { review: updatedReview, issue: updatedIssue, operation: null }
        }

        let movements
        let repairPayload
        let applySnapshot
        if (issue.type === 'point_balance_drift' && issue.sourceType === 'internal_point_account') {
          const account = await transaction.internalPointAccount.findUnique({ where: { id: issue.sourceId } })
          if (!account || account.balance !== issue.actualAmount) {
            throw new HttpError(409, 'ACCOUNTING_REPAIR_STALE', 'Point account changed after the issue was detected; scan again')
          }
          const delta = Number(issue.expectedAmount) - account.balance
          if (!Number.isSafeInteger(delta) || delta === 0) {
            throw new HttpError(409, 'ACCOUNTING_REPAIR_STALE', 'Point account no longer requires compensation')
          }
          movements = [
            { unit: 'points', accountRef: 'system:reconciliation:points:source', accountType: 'system_source', amount: -delta },
            { unit: 'points', accountRef: `user:${account.userId}:points:available`, accountType: 'available', ownerUserId: account.userId, amount: delta },
          ]
          repairPayload = { issueId: issue.id, accountId: account.id, userId: account.userId, delta }
          applySnapshot = async () => {}
        } else if (issue.type === 'quota_state_mismatch' && issue.sourceType === 'creative_quota_window') {
          const window = await transaction.creativeQuotaWindow.findUnique({
            where: { id: issue.sourceId },
            include: { reservations: true },
          })
          if (!window || window.reservedUnits + window.usedUnits !== issue.actualAmount) {
            throw new HttpError(409, 'ACCOUNTING_REPAIR_STALE', 'Quota window changed after the issue was detected; scan again')
          }
          const expectedReserved = window.reservations.filter((row) => row.status === 'reserved').reduce((sum, row) => sum + row.units, 0)
          const expectedUsed = window.reservations.filter((row) => row.status === 'committed').reduce((sum, row) => sum + row.units, 0)
          const expectedReleased = window.reservations.filter((row) => row.status === 'released').reduce((sum, row) => sum + row.units, 0)
          const reservedDelta = expectedReserved - window.reservedUnits
          const usedDelta = expectedUsed - window.usedUnits
          const remainingDelta = -(reservedDelta + usedDelta)
          movements = [
            { unit: 'quota_unit', accountRef: `quota-window:${window.id}:remaining`, accountType: 'remaining', amount: remainingDelta },
            { unit: 'quota_unit', accountRef: `quota-window:${window.id}:reserved`, accountType: 'reserved', amount: reservedDelta },
            { unit: 'quota_unit', accountRef: `quota-window:${window.id}:used`, accountType: 'used', amount: usedDelta },
          ].filter((movement) => movement.amount !== 0)
          if (movements.length < 2) {
            throw new HttpError(409, 'ACCOUNTING_REPAIR_UNSUPPORTED', 'Released-only quota drift requires manual investigation')
          }
          repairPayload = {
            issueId: issue.id,
            windowId: window.id,
            reservedDelta,
            usedDelta,
            remainingDelta,
            expectedReleased,
          }
          applySnapshot = () => transaction.creativeQuotaWindow.update({
            where: { id: window.id },
            data: {
              reservedUnits: expectedReserved,
              usedUnits: expectedUsed,
              releasedUnits: expectedReleased,
            },
          })
        } else {
          throw new HttpError(409, 'ACCOUNTING_REPAIR_UNSUPPORTED', 'This issue cannot be compensated automatically')
        }

        const applied = await applyPrismaAccountingOperation(transaction, {
          unit: issue.unit,
          kind: 'compensation',
          sourceType: 'accounting_reconciliation_issue',
          sourceId: issue.id,
          phase: 'approve',
          reasonCode: metadata.reasonCode,
          payload: repairPayload,
          movements,
          actor,
          allowNegative: true,
          originalOperationKey: issue.operationKey,
          reconciliationIssueId: issue.id,
        })
        await applySnapshot()
        const repairedAt = new Date()
        const repairOperationKey = applied.operation.operationKey
        const updatedIssue = await transaction.accountingReconciliationIssue.update({
          where: { id: issue.id },
          data: {
            status: 'resolved',
            repairOperationKey,
            reviewedById: reviewer.id,
            reviewedAt: repairedAt,
            resolvedAt: repairedAt,
          },
        })
        const updatedReview = await transaction.adminReview.update({
          where: { id: review.id },
          data: {
            status: 'Approved',
            decision: 'approve',
            note: action.note || review.note,
            reviewedById: reviewer.id,
            reviewedAt: repairedAt,
            metadata: { ...metadata, repairOperationKey, approvedBy: actor.handle },
          },
          include: { reviewedBy: { include: { profile: true } } },
        })
        await transaction.auditEvent.create({
          data: buildAuditRecord({
            actorType: 'user',
            actorId: reviewer.id,
            action: 'accounting.repair.approved',
            resourceType: 'accounting_reconciliation_issue',
            resourceId: issue.id,
            metadata: { reviewId: review.id, issueKey: issue.issueKey, repairOperationKey },
          }),
        })
        return { review: updatedReview, issue: updatedIssue, operation: applied.operation }
      })
      return result ? {
        review: getAdminReviewDto(result.review),
        issue: serializeAccountingIssue(result.issue),
        compensation: result.operation ? {
          operationKey: result.operation.operationKey,
          unit: result.operation.unit,
          kind: result.operation.kind,
          status: result.operation.status,
          reasonCode: result.operation.reasonCode,
        } : null,
      } : null
    },
  }

  const media = {
    find: async (id) => {
      const asset = await client.mediaAsset.findUnique({ where: { id: String(id) }, include: { storageObject: true } })
      return asset ? getMediaAssetDto(asset) : null
    },
    findAccessibleCreativeInput: async (id, actor) => {
      const asset = await client.mediaAsset.findUnique({
        where: { id: String(id) },
        include: { owner: { include: { profile: true } }, storageObject: true },
      })
      if (!asset || asset.archivedAt || asset.deletedAt) return null
      const ownerHandle = asset.owner?.profile?.handle ?? asset.owner?.id ?? null
      if (!authorizeResource({ resourceType: 'media_asset', action: 'read', actor, resource: { ownerId: asset.ownerId, ownerHandle }, allowPublic: false }).allowed) return null
      return getMediaAssetDto(asset)
    },
    findOwnedChatInput: async (id, actor) => {
      const asset = await client.mediaAsset.findFirst({
        where: { id: String(id), ownerId: String(actor.id), archivedAt: null, deletedAt: null },
        include: { storageObject: true },
      })
      return asset ? getMediaAssetDto(asset) : null
    },
    listChatInputs: async (actor, options = {}) => {
      const owner = await findUserByHandle(actor.handle)
      if (!owner) return { items: [], limit: options.limit ?? 24, nextCursor: null }
      const limit = Math.min(Math.max(Number(options.limit ?? 24), 1), 100)
      const assets = await client.mediaAsset.findMany({
        where: {
          ownerId: owner.id,
          archivedAt: null,
          deletedAt: null,
          status: 'uploaded',
          purpose: { in: ['task_attachment', 'library_asset'] },
          contentType: { in: ['text/plain', 'text/markdown', 'application/pdf', 'image/png', 'image/jpeg', 'image/webp'] },
          sizeBytes: { lte: 20 * 1024 * 1024 },
          metadata: { path: ['security', 'scanStatus'], equals: 'clean' },
          storageObject: { is: { state: 'available' } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        include: { storageObject: true },
        ...(options.cursor ? { cursor: { id: String(options.cursor) }, skip: 1 } : {}),
      })
      const page = assets.slice(0, limit)
      return {
        items: page.map(getMediaAssetDto),
        limit,
        nextCursor: assets.length > limit ? page.at(-1)?.id ?? null : null,
      }
    },
    listCreativeInputs: async (actor, options = {}) => {
      const owner = await findUserByHandle(actor.handle)
      if (!owner) return { items: [], limit: options.limit ?? 24, nextCursor: null }
      const limit = Math.min(Math.max(Number(options.limit ?? 24), 1), 100)
      const assets = await client.mediaAsset.findMany({
        where: {
          ownerId: owner.id,
          archivedAt: null,
          deletedAt: null,
          status: 'uploaded',
          purpose: { in: ['submission_asset', 'profile_portfolio', 'library_asset'] },
          contentType: { in: ['image/png', 'image/jpeg', 'image/webp', 'audio/mpeg', 'audio/wav', 'audio/mp4'] },
          metadata: { path: ['security', 'scanStatus'], equals: 'clean' },
          storageObject: { is: { state: 'available' } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        include: { storageObject: true },
        ...(options.cursor ? { cursor: { id: String(options.cursor) }, skip: 1 } : {}),
      })
      const page = assets.slice(0, limit)
      return {
        items: page.map(getMediaAssetDto),
        limit,
        nextCursor: assets.length > limit ? page.at(-1)?.id ?? null : null,
      }
    },
    listAssetLibrary: async (actor, options = {}) => {
      const owner = await findUserByHandle(actor.handle)
      if (!owner) return { items: [], limit: options.limit ?? 24, nextCursor: null }
      const limit = Math.min(Math.max(Number(options.limit ?? 24), 1), 100)
      const lifecycleWhere = options.lifecycle === 'all' ? {}
        : options.lifecycle === 'deleted' ? { deletedAt: { not: null } }
          : options.lifecycle === 'archived' ? { deletedAt: null, archivedAt: { not: null } }
            : { deletedAt: null, archivedAt: null }
      const contentTypeWhere = options.mediaType === 'image' ? { startsWith: 'image/' }
        : options.mediaType === 'video' ? { startsWith: 'video/' }
          : options.mediaType === 'audio' ? { startsWith: 'audio/' }
            : options.mediaType === 'document' ? { notIn: ['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/wav', 'audio/mp4'] }
              : undefined
      const workspaceWhere = options.workspace === 'image' || options.workspace === 'video' ? {
        archivedAt: null,
        status: 'uploaded',
        storageObject: { is: { state: 'available' } },
        purpose: { in: ['submission_asset', 'profile_portfolio', 'library_asset'] },
        contentType: { in: ['image/png', 'image/jpeg', 'image/webp'] },
        metadata: { path: ['security', 'scanStatus'], equals: 'clean' },
      } : options.workspace === 'chat' ? {
        archivedAt: null,
        status: 'uploaded',
        storageObject: { is: { state: 'available' } },
        purpose: { in: ['task_attachment', 'library_asset'] },
        contentType: { in: ['text/plain', 'text/markdown', 'application/pdf', 'image/png', 'image/jpeg', 'image/webp'] },
        sizeBytes: { lte: 20 * 1024 * 1024 },
        metadata: { path: ['security', 'scanStatus'], equals: 'clean' },
      } : options.workspace === 'music' ? { id: { equals: '__no_music_inputs__' } } : {}
      const rows = await client.mediaAsset.findMany({
        where: {
          ownerId: owner.id,
          AND: [
            lifecycleWhere,
            options.purpose ? { purpose: options.purpose } : {},
            contentTypeWhere ? { contentType: contentTypeWhere } : {},
            options.search ? { fileName: { contains: options.search, mode: 'insensitive' } } : {},
            (options.dateFrom || options.dateTo) ? { createdAt: { ...(options.dateFrom ? { gte: new Date(options.dateFrom) } : {}), ...(options.dateTo ? { lte: new Date(options.dateTo) } : {}) } } : {},
            workspaceWhere,
          ],
        },
        include: { outgoingRelations: true, incomingRelations: true, storageObject: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(options.cursor ? { cursor: { id: String(options.cursor) }, skip: 1 } : {}),
      })
      const page = rows.slice(0, limit)
      const items = await Promise.all(page.map(async (asset) => {
        const [generation, inputReference, submissionReference] = await Promise.all([
          client.creativeGeneration.findFirst({ where: { outputAssetIds: { has: asset.id } } }),
          client.creativeGeneration.count({ where: { inputAssetIds: { has: asset.id } } }),
          client.taskSubmission.count({ where: { assetIds: { has: asset.id } } }),
        ])
        return buildSafeAssetLibraryItem(asset, { generation, relations: [...asset.outgoingRelations, ...asset.incomingRelations], referenced: Boolean(generation || inputReference || submissionReference) })
      }))
      return { items, limit, nextCursor: rows.length > limit ? page.at(-1)?.id ?? null : null }
    },
    getAssetLibraryItem: async (id, actor) => {
      const owner = await findUserByHandle(actor.handle)
      if (!owner) return null
      const asset = await client.mediaAsset.findFirst({ where: { id: String(id), ownerId: owner.id }, include: { outgoingRelations: true, incomingRelations: true, storageObject: true } })
      if (!asset) return null
      const [generation, inputReference, submissionReference] = await Promise.all([
        client.creativeGeneration.findFirst({ where: { outputAssetIds: { has: asset.id } } }),
        client.creativeGeneration.count({ where: { inputAssetIds: { has: asset.id } } }),
        client.taskSubmission.count({ where: { assetIds: { has: asset.id } } }),
      ])
      return buildSafeAssetLibraryItem(asset, { generation, relations: [...asset.outgoingRelations, ...asset.incomingRelations], referenced: Boolean(generation || inputReference || submissionReference) })
    },
    saveAssetToLibrary: async (id, actor) => {
      const owner = await findUserByHandle(actor.handle)
      if (!owner) return null
      const [asset, generation] = await Promise.all([
        client.mediaAsset.findUnique({ where: { id: String(id) } }),
        client.creativeGeneration.findFirst({ where: { outputAssetIds: { has: String(id) } } }),
      ])
      const [resolved] = resolveCreativeDeliveryAssets({
        assetIds: [id], assets: asset ? [asset] : [], generations: generation ? [generation] : [],
        actor: { ...actor, id: owner.id }, target: 'private_library',
      })
      const referenceWhere = { userId: owner.id, sourceType: 'asset', sourceId: String(id) }
      let row = await client.libraryItem.findFirst({ where: referenceWhere })
      if (!row) {
        try {
          row = await client.libraryItem.create({
            data: {
              ...referenceWhere, title: asset.fileName, content: '',
              metadata: { kind: 'media_asset', type: 'asset', source: 'Creative output', assetEvidence: resolved.evidence },
            },
          })
        } catch (error) {
          if (error?.code !== 'P2002') throw error
          row = await client.libraryItem.findFirst({ where: referenceWhere })
          if (!row) throw error
        }
      }
      await recordAudit({ actor, action: 'media.asset.saved_to_library', resourceType: 'media_asset', resourceId: asset.id, metadata: { libraryItemId: row.id } })
      return {
        id: row.id, title: row.title, type: 'asset', source: 'Creative output', saves: '1', text: row.content,
        sourceId: row.sourceId, metadata: row.metadata,
      }
    },
    setAssetArchived: async (id, archived, actor) => {
      const owner = await findUserByHandle(actor.handle)
      if (!owner) return null
      const current = await client.mediaAsset.findFirst({ where: { id: String(id), ownerId: owner.id }, include: { storageObject: true } })
      if (!current) return null
      if (current.deletedAt) throw new HttpError(409, 'ASSET_DELETED', 'Deleted assets must be recovered before archive changes')
      const now = new Date()
      const asset = await client.$transaction(async (transaction) => {
        const archivedAt = archived ? (current.archivedAt ?? now) : null
        const updated = await transaction.mediaAsset.update({ where: { id: current.id }, data: { archivedAt } })
        await transitionPrismaStorageObject(transaction, current, activePrismaStorageState(current, { archivedAt }), now)
        if (archived) {
          await transaction.profilePortfolioAsset.updateMany({ where: { assetId: current.id, status: 'published' }, data: { status: 'withdrawn', withdrawnAt: now } })
        }
        return updated
      })
      await recordAudit({ actor, action: archived ? 'media.asset.archived' : 'media.asset.restored', resourceType: 'media_asset', resourceId: asset.id, metadata: {} })
      return media.getAssetLibraryItem(asset.id, actor)
    },
    setAssetDeleted: async (id, deleted, actor, payload = {}) => {
      const owner = await findUserByHandle(actor.handle)
      if (!owner) return null
      const current = await client.mediaAsset.findFirst({ where: { id: String(id), ownerId: owner.id }, include: { storageObject: true } })
      if (!current) return null
      const now = new Date()
      const cleanupRetentionDays = deleted ? (await getMediaGovernancePolicy()).retention.storageCleanupRetentionDays : null
      await client.$transaction(async (transaction) => {
        const deletedAt = deleted ? (current.deletedAt ?? now) : null
        await transaction.mediaAsset.update({
          where: { id: current.id },
          data: deleted
            ? { deletedAt, deletedByHandle: actor.handle, deletionReason: payload.reason ?? 'user_requested' }
            : { deletedAt: null, deletedByHandle: null, deletionReason: null },
        })
        await transitionPrismaStorageObject(transaction, current, activePrismaStorageState(current, { deletedAt }), now, {
          cleanupAfter: deleted ? mediaStorageCleanupAfter(now, cleanupRetentionDays) : null,
        })
        if (deleted) {
          await transaction.profilePortfolioAsset.updateMany({ where: { assetId: current.id, status: 'published' }, data: { status: 'withdrawn', withdrawnAt: now } })
        }
      })
      await recordAudit({ actor, action: deleted ? 'media.asset.deleted' : 'media.asset.recovered', resourceType: 'media_asset', resourceId: current.id, metadata: { reason: deleted ? payload.reason ?? 'user_requested' : 'owner_recovery' } })
      return media.getAssetLibraryItem(current.id, actor)
    },
    listAdminAssets: async (options = {}) => {
      const limit = Math.min(Math.max(Number(options.limit ?? 24), 1), 100)
      const lifecycleWhere = options.lifecycle === 'all' ? {}
        : options.lifecycle === 'deleted' ? { deletedAt: { not: null } }
          : options.lifecycle === 'archived' ? { deletedAt: null, archivedAt: { not: null } }
            : { deletedAt: null, archivedAt: null }
      const contentTypeWhere = options.mediaType === 'image' ? { startsWith: 'image/' }
        : options.mediaType === 'video' ? { startsWith: 'video/' }
          : options.mediaType === 'audio' ? { startsWith: 'audio/' }
            : options.mediaType === 'document' ? { not: { startsWith: 'image/' } } : undefined
      const orderBy = options.sort === 'created_asc' ? [{ createdAt: 'asc' }, { id: 'asc' }]
        : options.sort === 'updated_desc' ? [{ updatedAt: 'desc' }, { id: 'desc' }]
          : options.sort === 'name_asc' ? [{ fileName: 'asc' }, { id: 'asc' }]
            : [{ createdAt: 'desc' }, { id: 'desc' }]
      const rows = await client.mediaAsset.findMany({
        where: {
          AND: [
            lifecycleWhere,
            options.status ? { status: options.status } : {},
            options.purpose ? { purpose: options.purpose } : {},
            contentTypeWhere ? { contentType: contentTypeWhere } : {},
            options.search ? { OR: [{ id: { contains: options.search, mode: 'insensitive' } }, { fileName: { contains: options.search, mode: 'insensitive' } }, { owner: { profile: { is: { handle: { contains: options.search, mode: 'insensitive' } } } } }] } : {},
            options.ownerHandle ? { owner: { profile: { is: { handle: { equals: options.ownerHandle, mode: 'insensitive' } } } } } : {},
            options.storageState ? { storageObject: { is: { state: options.storageState } } } : {},
          ],
        },
        include: { owner: { select: { id: true, profile: { select: { handle: true } } } }, outgoingRelations: true, incomingRelations: true, portfolioAssets: true, storageObject: true },
        orderBy,
        take: limit + 1,
        ...(options.cursor ? { cursor: { id: String(options.cursor) }, skip: 1 } : {}),
      })
      const page = rows.slice(0, limit)
      const items = await Promise.all(page.map(async (asset) => {
        const generation = await client.creativeGeneration.findFirst({ where: { outputAssetIds: { has: asset.id } } })
        return {
          ...buildSafeAssetLibraryItem(asset, { generation, relations: [...asset.outgoingRelations, ...asset.incomingRelations], referenced: Boolean(generation || asset.portfolioAssets.length) }),
          owner: { id: asset.owner.id, handle: asset.owner.profile?.handle ?? asset.owner.id },
          portfolio: asset.portfolioAssets.map(getPortfolioAssetDto),
        }
      }))
      return { items, limit, nextCursor: rows.length > limit ? page.at(-1)?.id ?? null : null }
    },
    getAdminAsset: async (id) => {
      const page = await media.listAdminAssets({ lifecycle: 'all', search: String(id), limit: 100, sort: 'created_desc' })
      return page.items.find((item) => item.id === String(id)) ?? null
    },
    setAdminAssetArchived: async (id, archived, actor) => {
      const current = await client.mediaAsset.findUnique({ where: { id: String(id) }, include: { owner: { include: { profile: true } }, storageObject: true } })
      if (!current) return null
      if (current.deletedAt) throw new HttpError(409, 'ASSET_DELETED', 'Deleted assets must be recovered before archive changes')
      const now = new Date()
      await client.$transaction(async (transaction) => {
        const archivedAt = archived ? (current.archivedAt ?? now) : null
        await transaction.mediaAsset.update({ where: { id: current.id }, data: { archivedAt } })
        await transitionPrismaStorageObject(transaction, current, activePrismaStorageState(current, { archivedAt }), now)
        if (archived) await transaction.profilePortfolioAsset.updateMany({ where: { assetId: current.id, status: 'published' }, data: { status: 'withdrawn', withdrawnAt: now } })
      })
      await recordAudit({ actor, action: archived ? 'admin.media.asset.archived' : 'admin.media.asset.restored', resourceType: 'media_asset', resourceId: current.id, metadata: { ownerHandle: current.owner.profile?.handle ?? current.owner.id } })
      return media.getAdminAsset(current.id)
    },
    setAdminAssetDeleted: async (id, deleted, actor, payload = {}) => {
      const current = await client.mediaAsset.findUnique({ where: { id: String(id) }, include: { owner: { include: { profile: true } }, storageObject: true } })
      if (!current) return null
      const now = new Date()
      const cleanupRetentionDays = deleted ? (await getMediaGovernancePolicy()).retention.storageCleanupRetentionDays : null
      await client.$transaction(async (transaction) => {
        const deletedAt = deleted ? (current.deletedAt ?? now) : null
        await transaction.mediaAsset.update({ where: { id: current.id }, data: deleted ? { deletedAt, deletedByHandle: actor.handle, deletionReason: payload.reason ?? 'admin_requested' } : { deletedAt: null, deletedByHandle: null, deletionReason: null } })
        await transitionPrismaStorageObject(transaction, current, activePrismaStorageState(current, { deletedAt }), now, {
          cleanupAfter: deleted ? mediaStorageCleanupAfter(now, cleanupRetentionDays) : null,
        })
        if (deleted) await transaction.profilePortfolioAsset.updateMany({ where: { assetId: current.id, status: 'published' }, data: { status: 'withdrawn', withdrawnAt: now } })
      })
      await recordAudit({ actor, action: deleted ? 'admin.media.asset.deleted' : 'admin.media.asset.recovered', resourceType: 'media_asset', resourceId: current.id, metadata: { ownerHandle: current.owner.profile?.handle ?? current.owner.id, reason: deleted ? payload.reason ?? 'admin_requested' : 'admin_recovery' } })
      return media.getAdminAsset(current.id)
    },
    createAssetRelation: async (sourceAssetId, payload, actor) => {
      const owner = await findUserByHandle(actor.handle)
      if (!owner) return null
      const [source, target] = await Promise.all([
        client.mediaAsset.findFirst({ where: { id: String(sourceAssetId), ownerId: owner.id } }),
        client.mediaAsset.findFirst({ where: { id: String(payload.targetAssetId), ownerId: owner.id } }),
      ])
      if (!source || !target || source.deletedAt || target.deletedAt) return null
      if (source.id === target.id) throw new HttpError(409, 'ASSET_RELATION_CYCLE', 'An asset cannot relate to itself')
      if (payload.relationType === 'reused_as_input' && !assetEligibleForWorkspace(source, payload.targetWorkspace)) throw new HttpError(409, 'ASSET_NOT_REUSABLE', 'Asset is not eligible for the target workspace')
      if (['parent', 'variant'].includes(payload.relationType)) {
        const relations = await client.mediaAssetRelation.findMany({ where: { ownerId: owner.id, relationType: { in: ['parent', 'variant'] } } })
        const adjacency = new Map()
        for (const relation of relations) adjacency.set(relation.sourceAssetId, [...(adjacency.get(relation.sourceAssetId) ?? []), relation.targetAssetId])
        const stack = [target.id]
        const visited = new Set()
        while (stack.length) {
          const current = stack.pop()
          if (current === source.id) throw new HttpError(409, 'ASSET_RELATION_CYCLE', 'Asset relation would create a cycle')
          if (visited.has(current)) continue
          visited.add(current)
          stack.push(...(adjacency.get(current) ?? []))
        }
      }
      const generation = await client.creativeGeneration.findFirst({ where: { outputAssetIds: { has: source.id } } })
      const duplicate = await client.mediaAssetRelation.findFirst({ where: { sourceAssetId: source.id, targetAssetId: target.id, relationType: payload.relationType, targetWorkspace: payload.targetWorkspace ?? null, role: payload.role ?? null } })
      if (!duplicate) await client.mediaAssetRelation.create({ data: { ownerId: owner.id, sourceAssetId: source.id, targetAssetId: target.id, relationType: payload.relationType, sourceGenerationId: generation?.id ?? null, targetWorkspace: payload.targetWorkspace ?? null, role: payload.role ?? null } })
      await recordAudit({ actor, action: 'media.asset.relation_created', resourceType: 'media_asset', resourceId: source.id, metadata: { targetAssetId: target.id, relationType: payload.relationType, targetWorkspace: payload.targetWorkspace ?? null, role: payload.role ?? null } })
      return media.getAssetLibraryItem(source.id, actor)
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
      const storageConfig = buildStorageConfig()
      if (storageConfig.driver === 's3' && !payload.checksumSha256) {
        throw new HttpError(400, 'STORAGE_CHECKSUM_REQUIRED', 'checksumSha256 is required for S3 uploads')
      }
      const checksumSha256 = payload.checksumSha256 ? normalizeStorageChecksumSha256(payload.checksumSha256) : null
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
          storageObject: {
            create: {
              provider: storageConfig.driver,
              state: 'pending_upload',
              checksumSha256,
            },
          },
        },
        include: { storageObject: true },
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
        include: { owner: { include: { profile: true } }, storageObject: true },
      })
      if (!asset) {
        return null
      }
      const ownerHandle = asset.owner?.profile?.handle ?? asset.owner?.id ?? null
      if (!authorizeResource({ resourceType: 'media_asset', action: 'write', actor, resource: { ownerId: asset.ownerId, ownerHandle } }).allowed) {
        return null
      }
      if (asset.status !== 'pending' && asset.storageObject && !['pending_upload', 'verification_failed', 'verifying'].includes(asset.storageObject.state)) {
        return getMediaAssetDto(asset)
      }
      if (!asset.storageObject) {
        throw new HttpError(409, 'STORAGE_OBJECT_STATE_MISSING', 'Storage object lifecycle state is missing')
      }
      if (asset.storageObject.state === 'verifying') {
        throw new HttpError(409, 'UPLOAD_COMPLETION_IN_PROGRESS', 'Upload completion is already in progress')
      }
      let inspection
      try {
        inspection = await inspectStorageObject({ ...asset, checksumSha256: asset.storageObject.checksumSha256 })
      } catch (error) {
        const reasonCode = error instanceof StorageObjectError ? error.code : 'STORAGE_VERIFICATION_FAILED'
        await client.mediaStorageObject.updateMany({
          where: { assetId: asset.id, version: asset.storageObject.version },
          data: { state: 'verification_failed', lastErrorCode: reasonCode, version: { increment: 1 } },
        })
        await recordAudit({ actor, action: 'media.upload.verification_failed', resourceType: 'media_asset', resourceId: asset.id, metadata: { purpose: asset.purpose, reasonCode } })
        throw new HttpError(error instanceof StorageObjectError && error.retryable ? 503 : 409, 'MEDIA_STORAGE_VERIFICATION_FAILED', 'Uploaded object could not be verified', { reasonCode })
      }
      const claimed = await client.mediaStorageObject.updateMany({
        where: { assetId: asset.id, version: asset.storageObject.version, state: { in: ['pending_upload', 'verification_failed'] } },
        data: {
          state: 'verifying',
          etag: inspection.etag,
          checksumSha256: inspection.checksumSha256 ?? asset.storageObject.checksumSha256,
          verifiedSizeBytes: inspection.sizeBytes,
          verifiedContentType: inspection.contentType,
          verifiedAt: new Date(inspection.verifiedAt),
          lastErrorCode: null,
          version: { increment: 1 },
        },
      })
      if (claimed.count !== 1) throw new HttpError(409, 'UPLOAD_COMPLETION_CONFLICT', 'Upload completion state changed concurrently')
      const detectedContentType = payload.detectedContentType || asset.contentType
      const contentTypeMatches = detectedContentType.toLowerCase() === asset.contentType.toLowerCase()
      const scanResult = contentTypeMatches ? await scanMediaAsset(asset) : null
      const scanJob = contentTypeMatches ? await createMediaScanJob(asset, scanResult) : null
      const finalStorageState = contentTypeMatches && scanResult?.status === 'clean' ? 'available' : 'quarantined'
      const updated = await client.$transaction(async (transaction) => {
        const nextAsset = await transaction.mediaAsset.update({
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
          include: { storageObject: true },
        })
        const storageUpdate = await transaction.mediaStorageObject.updateMany({
          where: { assetId: asset.id, state: 'verifying', version: asset.storageObject.version + 1 },
          data: {
            state: finalStorageState,
            quarantinedAt: finalStorageState === 'quarantined' ? new Date() : null,
            lastErrorCode: null,
            version: { increment: 1 },
          },
        })
        if (storageUpdate.count !== 1) throw new HttpError(409, 'UPLOAD_COMPLETION_CONFLICT', 'Upload completion state changed concurrently')
        return transaction.mediaAsset.findUnique({ where: { id: nextAsset.id }, include: { storageObject: true } })
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
          storageObject: {
            create: {
              provider: storage.provider,
              state: 'quarantined',
              checksumSha256: storage.checksumSha256,
              verifiedSizeBytes: storage.bytes,
              verifiedContentType: payload.artifact.contentType,
              verifiedAt: new Date(storage.writtenAt),
              quarantinedAt: new Date(storage.writtenAt),
            },
          },
        },
        include: { storageObject: true },
      })
      const scanResult = await scanMediaAsset(asset)
      const scanJob = await createMediaScanJob(asset, scanResult)
      const policyReviewRequired = Boolean(payload.generation.safety?.reviewRequired)
      const effectiveScanStatus = policyReviewRequired ? 'review' : scanResult?.status ?? 'pending'
      const updated = await client.$transaction(async (transaction) => {
        const nextAsset = await transaction.mediaAsset.update({
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
        await transitionPrismaStorageObject(transaction, asset, effectiveScanStatus === 'clean' ? 'available' : 'quarantined')
        return transaction.mediaAsset.findUnique({ where: { id: nextAsset.id }, include: { storageObject: true } })
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
      const existing = await client.mediaAsset.findUnique({ where: { storageKey: payload.storageKey }, include: { storageObject: true } })
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
            storageObject: {
              create: {
                provider: storage.provider,
                state: 'quarantined',
                checksumSha256: storage.checksumSha256,
                verifiedSizeBytes: storage.bytes,
                verifiedContentType: payload.contentType,
                verifiedAt: new Date(storage.writtenAt),
                quarantinedAt: new Date(storage.writtenAt),
              },
            },
          },
          include: { storageObject: true },
        })
      } catch (error) {
        if (error?.code !== 'P2002') throw error
        const duplicate = await client.mediaAsset.findUnique({ where: { storageKey: payload.storageKey }, include: { storageObject: true } })
        if (!duplicate) throw error
        return getMediaAssetDto(duplicate)
      }
      const scanResult = await scanMediaAsset(asset)
      const scanJob = await createMediaScanJob(asset, scanResult)
      const policyReviewRequired = Boolean(payload.generation.safety?.reviewRequired)
      const effectiveScanStatus = policyReviewRequired ? 'review' : scanResult?.status ?? 'pending'
      const updated = await client.$transaction(async (transaction) => {
        const nextAsset = await transaction.mediaAsset.update({
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
        await transitionPrismaStorageObject(transaction, asset, effectiveScanStatus === 'clean' ? 'available' : 'quarantined')
        return transaction.mediaAsset.findUnique({ where: { id: nextAsset.id }, include: { storageObject: true } })
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
        include: { storageObject: true },
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
        include: { asset: { include: { storageObject: true } } },
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
        include: { storageObject: true },
      })
      if (!asset) {
        return null
      }
      const metadata = asObject(asset.metadata) ?? {}
      const security = asObject(metadata.security) ?? {}
      const reviewedAt = new Date()
      const updated = await client.$transaction(async (transaction) => {
        const nextAsset = await transaction.mediaAsset.update({
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
        await transitionPrismaStorageObject(
          transaction,
          asset,
          payload.decision === 'clean' && !asset.archivedAt && !asset.deletedAt ? 'available' : 'quarantined',
          reviewedAt,
        )
        return transaction.mediaAsset.findUnique({ where: { id: nextAsset.id }, include: { storageObject: true } })
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
        include: { storageObject: true },
      })
      if (!asset) {
        return null
      }
      const metadata = asObject(asset.metadata) ?? {}
      const security = asObject(metadata.security) ?? {}
      const expectedExternalScanId = String(security.externalScanId ?? '')
      if (!payload.externalScanId || (expectedExternalScanId && payload.externalScanId !== expectedExternalScanId)) {
        await recordAudit({ actor: null, action: 'media.scan.callback_conflict', resourceType: 'media_asset', resourceId: asset.id, metadata: { reasonCode: 'external_scan_id_mismatch' } })
        throw new HttpError(409, 'MEDIA_SCAN_CALLBACK_MISMATCH', 'Scan callback does not match the active scan attempt')
      }
      const currentJob = await client.mediaScanJob.findFirst({
        where: { assetId: asset.id, externalScanId: payload.externalScanId },
        orderBy: { createdAt: 'desc' },
      })
      if (!currentJob) {
        await recordAudit({ actor: null, action: 'media.scan.callback_conflict', resourceType: 'media_asset', resourceId: asset.id, metadata: { reasonCode: 'scan_job_not_found' } })
        throw new HttpError(409, 'MEDIA_SCAN_CALLBACK_MISMATCH', 'Scan callback does not match a durable scan job')
      }
      if (['completed', 'failed'].includes(currentJob.status)) {
        if (currentJob.scanStatus !== payload.status) {
          await recordAudit({ actor: null, action: 'media.scan.callback_conflict', resourceType: 'media_asset', resourceId: asset.id, metadata: { reasonCode: 'terminal_result_mismatch' } })
          throw new HttpError(409, 'MEDIA_SCAN_CALLBACK_CONFLICT', 'Scan callback conflicts with the recorded result')
        }
        return getMediaAssetDto(mediaAssetWithScanJob(asset, currentJob))
      }
      const callbackAt = new Date()
      const result = await client.$transaction(async (transaction) => {
        const jobUpdate = await transaction.mediaScanJob.updateMany({
          where: { id: currentJob.id, status: { in: ['queued', 'retrying'] } },
          data: {
            status: payload.status === 'rejected' ? 'failed' : 'completed',
            scanStatus: payload.status,
            note: payload.note,
            rejectionReason: payload.status === 'rejected' ? payload.reason || security.rejectionReason : null,
            callbackAt,
          },
        })
        if (jobUpdate.count !== 1) throw new HttpError(409, 'MEDIA_SCAN_CALLBACK_CONFLICT', 'Scan callback state changed concurrently')
        const updated = await transaction.mediaAsset.update({
          where: { id: asset.id },
          data: {
            status: payload.status === 'rejected' ? 'rejected' : 'uploaded',
            metadata: mediaSecurityMetadata(asset, {
              scanStatus: payload.status,
              detectedContentType: payload.detectedContentType || security.detectedContentType || asset.contentType,
              scanNote: payload.note,
              rejectionReason: payload.status === 'rejected' ? payload.reason || security.rejectionReason : undefined,
              externalScanId: payload.externalScanId,
              callbackReceivedAt: callbackAt.toISOString(),
              scanJobStatus: payload.status === 'rejected' ? 'failed' : 'completed',
            }),
          },
        })
        await transitionPrismaStorageObject(
          transaction,
          asset,
          payload.status === 'clean' && !asset.archivedAt && !asset.deletedAt ? 'available' : 'quarantined',
          callbackAt,
        )
        const [nextAsset, nextJob] = await Promise.all([
          transaction.mediaAsset.findUnique({ where: { id: updated.id }, include: { storageObject: true } }),
          transaction.mediaScanJob.findUnique({ where: { id: currentJob.id } }),
        ])
        return { asset: nextAsset, job: nextJob }
      })
      const updated = result.asset
      const job = result.job
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
        include: { storageObject: true },
      })
      if (!asset) {
        return null
      }
      const scanResult = await retryMediaScanAsset(asset)
      const scanJob = await createMediaScanJob(asset, scanResult)
      const updated = await client.$transaction(async (transaction) => {
        const nextAsset = await transaction.mediaAsset.update({
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
        await transitionPrismaStorageObject(transaction, asset, 'quarantined')
        return transaction.mediaAsset.findUnique({ where: { id: nextAsset.id }, include: { storageObject: true } })
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
        include: { asset: { include: { storageObject: true } } },
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
    cleanupStorageObjects: async ({ actor = null, limit = null, now = new Date() } = {}) => {
      const policy = await getMediaGovernancePolicy()
      const batchSize = Math.min(Math.max(Number(limit ?? process.env.MEDIA_STORAGE_CLEANUP_BATCH_SIZE ?? 25), 1), 100)
      const candidates = await client.mediaStorageObject.findMany({
        where: { state: 'cleanup_pending', cleanupAfter: { lte: now } },
        include: { asset: true },
        orderBy: [{ cleanupAfter: 'asc' }, { assetId: 'asc' }],
        take: batchSize,
      })
      const items = []
      let deleted = 0
      let failed = 0
      for (const candidate of candidates) {
        const claimed = await client.mediaStorageObject.updateMany({
          where: { assetId: candidate.assetId, state: 'cleanup_pending', version: candidate.version },
          data: { state: 'deleting', lastErrorCode: null, version: { increment: 1 } },
        })
        if (claimed.count !== 1) {
          items.push({ assetId: candidate.assetId, status: 'skipped', reasonCode: 'concurrent_change' })
          continue
        }
        try {
          const result = await deleteStorageObject(candidate.asset)
          const finalized = await client.mediaStorageObject.updateMany({
            where: { assetId: candidate.assetId, state: 'deleting', version: candidate.version + 1 },
            data: {
              state: 'deleted',
              deletedAt: new Date(result.deletedAt),
              cleanupAfter: null,
              lastErrorCode: null,
              version: { increment: 1 },
            },
          })
          if (finalized.count !== 1) throw new StorageObjectError('STORAGE_DELETE_CONFLICT', 'Storage cleanup state changed concurrently', { retryable: true })
          await recordAudit({ actor, action: 'media.storage.deleted', resourceType: 'media_asset', resourceId: candidate.assetId, metadata: { provider: result.provider, retentionDays: policy.retention.storageCleanupRetentionDays } })
          deleted += 1
          items.push({ assetId: candidate.assetId, status: 'deleted', provider: result.provider })
        } catch (error) {
          const reasonCode = error instanceof StorageObjectError ? error.code : 'STORAGE_DELETE_FAILED'
          await client.mediaStorageObject.updateMany({
            where: { assetId: candidate.assetId, state: 'deleting', version: candidate.version + 1 },
            data: { state: 'cleanup_pending', lastErrorCode: reasonCode, version: { increment: 1 } },
          })
          await recordAudit({ actor, action: 'media.storage.cleanup_failed', resourceType: 'media_asset', resourceId: candidate.assetId, metadata: { provider: candidate.provider, reasonCode } })
          failed += 1
          items.push({ assetId: candidate.assetId, status: 'failed', reasonCode })
        }
      }
      const result = { inspected: candidates.length, deleted, failed, limit: batchSize, items }
      if (failed > 0) throw new HttpError(503, 'MEDIA_STORAGE_CLEANUP_PARTIAL_FAILURE', 'One or more storage objects could not be cleaned up', result)
      return result
    },
    createDownload: async (id, actor) => {
      const asset = await client.mediaAsset.findUnique({
        where: { id: String(id) },
        include: { owner: { include: { profile: true } }, storageObject: true },
      })
      if (!asset) {
        return null
      }
      const ownerHandle = asset.owner?.profile?.handle ?? asset.owner?.id ?? null
      const scanStatus = asObject(asObject(asset.metadata)?.security)?.scanStatus
      if (ownerHandle !== actor.handle && !hasPermission(actor, 'admin:access')) {
        return null
      }
      if (asset.status !== 'uploaded' || scanStatus !== 'clean' || asset.storageObject?.state !== 'available' || asset.archivedAt || asset.deletedAt) {
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
    findAccessibleChatContext: async (id, actor) => {
      const row = await client.libraryItem.findFirst({
        where: { id: String(id), userId: String(actor.id) },
        select: { title: true, content: true },
      })
      return row ? { title: row.title, content: row.content } : null
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
      if (!authorizeResource({ resourceType: 'library_item', action: 'write', actor, resource: { userId: item.userId, ownerHandle } }).allowed) {
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
      if (!authorizeResource({ resourceType: 'library_item', action: 'read', actor, resource: { userId: item.userId, ownerHandle }, allowPublic: false }).allowed) {
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

  const verifyPersistedAuditChain = async (db) => {
    const rows = await db.$queryRawUnsafe(`
      SELECT sequence, previous_hash, content_hash,
        audit_event_content_hash(audit_events.*) AS expected_hash,
        lag(content_hash) OVER (ORDER BY sequence) AS expected_previous_hash,
        row_number() OVER (ORDER BY sequence) AS expected_sequence
      FROM audit_events
      ORDER BY sequence
    `)
    const failures = []
    for (const row of rows) {
      const sequence = Number(row.sequence)
      if (sequence !== Number(row.expected_sequence)) failures.push({ sequence, reason: 'sequence_mismatch' })
      if ((row.previous_hash ?? null) !== (row.expected_previous_hash ?? null)) failures.push({ sequence, reason: 'previous_hash_mismatch' })
      if (row.content_hash !== row.expected_hash) failures.push({ sequence, reason: 'content_hash_mismatch' })
    }
    return {
      status: failures.length === 0 ? 'complete' : 'broken',
      verified: failures.length === 0,
      count: rows.length,
      firstSequence: rows[0] ? String(rows[0].sequence) : null,
      lastSequence: rows.at(-1) ? String(rows.at(-1).sequence) : null,
      rootHash: rows.at(-1)?.content_hash ?? null,
      failures,
    }
  }

  const audit = {
    recordAttempt: async ({ actor, action, resourceType, resourceId, metadata }) => recordAudit({
      actor,
      action,
      resourceType,
      resourceId,
      metadata,
    }),
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
    export: async (options = {}) => {
      const page = await audit.list(options)
      return buildPortableAuditExport({ events: page.items, query: options })
    },
    verify: async () => client.$transaction((transaction) => verifyPersistedAuditChain(transaction), { isolationLevel: 'RepeatableRead' }),
    archive: async ({ actor, objectRef = null } = {}) => {
      return client.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext('audit_event_chain_v1'))")
        const integrity = await verifyPersistedAuditChain(transaction)
        if (!integrity.verified || integrity.count === 0) {
          return {
            integrity: integrity.count === 0 ? { ...integrity, status: 'unverifiable', verified: false, failures: [{ reason: 'empty_chain' }] } : integrity,
            manifest: null,
          }
        }
        const [first, last] = await Promise.all([
          transaction.auditEvent.findFirst({ orderBy: { sequence: 'asc' } }),
          transaction.auditEvent.findFirst({ orderBy: { sequence: 'desc' } }),
        ])
        const id = `audit-archive-${randomUUID()}`
        const manifest = await transaction.auditArchiveManifest.create({
          data: {
            id,
            fromSequence: first.sequence,
            toSequence: last.sequence,
            eventCount: integrity.count,
            rootHash: last.contentHash,
            objectRef: objectRef || `audit-archive://${id}`,
            actorId: actor?.id ?? null,
          },
        })
        return {
          integrity,
          manifest: {
            ...manifest,
            fromSequence: String(manifest.fromSequence),
            toSequence: String(manifest.toSequence),
            createdAt: manifest.createdAt.toISOString(),
          },
        }
      }, { isolationLevel: 'RepeatableRead' })
    },
    listArchives: async () => (await client.auditArchiveManifest.findMany({ orderBy: { createdAt: 'desc' }, take: 20 })).map((manifest) => ({
      ...manifest,
      fromSequence: String(manifest.fromSequence),
      toSequence: String(manifest.toSequence),
      createdAt: manifest.createdAt.toISOString(),
    })),
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
        module: row.module,
        resource: row.resource,
        action: row.action,
        riskLevel: row.riskLevel,
        protected: row.isProtected,
        resourceAuthorization: row.resourceAuthorization,
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
      if (permissionIds.some((permissionId) => !permissionById[permissionId])) {
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
        if (metadata.kind === 'task_dispute') {
          const [disputeTask, disputeSubmission] = await Promise.all([
            transaction.task.findUnique({
              where: { id: String(metadata.taskId) },
              include: {
                publisher: { include: { profile: true } },
                assignee: { include: { profile: true } },
              },
            }),
            transaction.taskSubmission.findUnique({ where: { id: String(metadata.submissionId) } }),
          ])
          if (!disputeTask || !disputeSubmission || disputeSubmission.status !== 'disputed') {
            throw new HttpError(409, 'TASK_DISPUTE_NOT_REVIEWABLE', 'Task dispute is no longer pending review')
          }
          const disputeApproved = action.decision === 'approve'
          const resolvedAt = new Date()
          const outcome = disputeApproved ? 'creator_revision_allowed' : 'publisher_rejection_upheld'
          const submissionMetadata = asObject(disputeSubmission.metadata) ?? {}
          await transaction.taskSubmission.update({
            where: { id: disputeSubmission.id },
            data: {
              status: disputeApproved ? 'revision_requested' : 'rejected',
              metadata: {
                ...submissionMetadata,
                dispute: {
                  ...(asObject(submissionMetadata.dispute) ?? metadata),
                  outcome,
                  resolvedBy: actor.handle,
                  resolvedAt: resolvedAt.toISOString(),
                  resolutionNote: action.note || current.note,
                },
              },
            },
          })
          const disputeTaskDto = getTaskDto(disputeTask)
          const resolvedTaskStatus = disputeApproved ? 'In Progress' : 'Rejected'
          await transaction.task.update({
            where: { id: disputeTask.id },
            data: {
              status: taskStatusFromLabel(resolvedTaskStatus),
              metadata: {
                ...disputeTaskDto,
                status: resolvedTaskStatus,
                disputeStatus: disputeApproved ? 'approved' : 'rejected',
                disputeReason: metadata.reason,
                disputeReviewId: current.id,
                reviewNote: action.note || current.note,
              },
            },
          })
          if (!disputeApproved) {
            await finalizeTaskEscrow(transaction, disputeTask, disputeTask.publisherId, 'reject', actor)
          }
          nextMetadata = {
            ...metadata,
            outcome,
            resolvedTaskStatus,
            resolvedSubmissionStatus: disputeApproved ? 'revision_requested' : 'rejected',
            resolvedBy: actor.handle,
            resolvedAt: resolvedAt.toISOString(),
          }
          await createNotificationsForHandles(
            [metadata.creatorHandle, metadata.publisherHandle],
            {
              type: disputeApproved ? 'task.dispute_approved' : 'task.dispute_rejected',
              title: disputeApproved ? `Task dispute approved: ${disputeTask.title}` : `Task dispute rejected: ${disputeTask.title}`,
              body: disputeApproved
                ? `${disputeTask.title} was reopened for a revised submission.`
                : `${disputeTask.title} rejection was upheld and escrow was released.`,
              resourceType: 'task',
              resourceId: disputeTask.id,
              metadata: {
                taskId: disputeTask.id,
                submissionId: disputeSubmission.id,
                adminReviewId: current.id,
                outcome,
                target: taskNotificationTarget('mine'),
              },
              dedupeUnread: true,
            },
            transaction,
          )
          await transaction.auditEvent.create({
            data: buildAuditRecord({
              actorType: 'user',
              actorId: actor.id ?? reviewer.id,
              action: 'task.dispute.resolved',
              resourceType: 'task',
              resourceId: disputeTask.id,
              metadata: {
                adminReviewId: current.id,
                submissionId: disputeSubmission.id,
                decision: action.decision,
                outcome,
              },
            }),
          })
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
    ...(process.env.NODE_ENV === 'production' ? {} : fallbackRepository),
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
    chat,
    creativeGenerations,
    creativeProviderOperations,
    creativeGenerationMutations,
    creativeProviderReplays,
    creativeOutputIngestions,
    creativeProviderControls,
    creativeProviderRetries,
    creativeProviderCosts,
    creativeCredits,
    creativeQuota,
    accountingReconciliation,
    media,
    library,
    audit,
    securityEvents,
    operationLeases,
    domainEvents,
    domainEventConsumers,
    jobs,
    releaseChanges,
    systemSettings,
    configResources,
    modelControl,
    modelRouting,
    observability,
    operationsMetrics,
    authorization,
    adminReviews,
    compliance,
    support,
    source: 'prisma',
  }
}

export { createPrismaRepository }
