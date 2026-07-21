import { createHash, randomUUID } from 'node:crypto'
import { HttpError } from '../common/errors/httpError.js'
import { hasPermission, permissionRegistry, permissions, rolePermissions } from '../auth/permissions.js'
import { authorizeResource } from '../auth/resourcePolicy.js'
import { taskCreatedEvent } from '../events/domainEvents.js'
import { createSeedDomainEventRepository } from '../events/seedDomainEventRepository.js'
import { createSeedDomainEventConsumerRepository } from '../events/seedDomainEventConsumerRepository.js'
import { createSeedJobRepository } from '../jobs/seedJobRepository.js'
import { createSeedReleaseRepository } from '../releases/seedReleaseRepository.js'
import { createSeedSystemSettingsRepository } from '../settings/seedSystemSettingsRepository.js'
import { createSeedConfigResourcesRepository } from '../configResources/seedConfigResourcesRepository.js'
import { createSeedModelControlRepository } from '../modelControl/seedModelControlRepository.js'
import { createSeedModelRoutingRepository } from '../modelControl/seedModelRoutingRepository.js'
import { createSeedModelGovernanceRepository } from '../modelControl/seedModelGovernanceRepository.js'
import { createSeedProviderOperationsRepository } from '../modelControl/seedProviderOperationsRepository.js'
import { createSeedModelEvaluationRepository } from '../modelControl/seedModelEvaluationRepository.js'
import { createSeedProviderLegalRepository } from '../modelControl/seedProviderLegalRepository.js'
import { createSeedGenerationExecutionRepository } from '../creative/seedGenerationExecutionRepository.js'
import { createSeedObservabilityRepository } from '../observability/seedObservabilityRepository.js'
import { createSeedOAuthAdminRepository } from '../auth/seedOAuthAdminRepository.js'
import { createSeedAuthSessionAdminRepository } from '../auth/seedAuthSessionAdminRepository.js'
import { createSeedAuthRiskAdminRepository } from '../auth/seedAuthRiskAdminRepository.js'
import { createSeedRiskRepository } from '../risk/seedRiskRepository.js'
import { createSeedUserAdminRepository } from '../users/seedUserAdminRepository.js'
import { createSeedTaskAdminRepository } from '../tasks/seedTaskAdminRepository.js'
import { createSeedCommunityAdminRepository } from '../community/seedCommunityAdminRepository.js'
import { createSeedTaskLifecycleRecoveryRepository } from '../tasks/seedTaskLifecycleRecoveryRepository.js'
import { createSeedBillingAdminRepository } from '../accounting/seedBillingAdminRepository.js'
import { createSeedEntitlementRepository } from '../entitlements/seedEntitlementRepository.js'
import { createSeedNotificationManagementRepository, isSeedNotificationEnabled } from '../notifications/seedNotificationManagementRepository.js'
import { createSeedNotificationDeliveryRepository } from '../notifications/seedNotificationDeliveryRepository.js'
import { createSeedDeveloperAccessRepository } from '../developerAccess/seedDeveloperAccessRepository.js'
import { createSeedWebhookRepository } from '../webhooks/seedWebhookRepository.js'
import { createSeedSupportRepository } from '../support/seedSupportRepository.js'
import { createSeedDataRightsRepository } from '../dataRights/seedDataRightsRepository.js'
import { createSeedModerationCaseRepository } from '../trust/seedModerationCaseRepository.js'
import { createSeedSafetyOperationsRepository } from '../trust/seedSafetyOperationsRepository.js'
import { communityModerationTransition } from '../trust/communityModeration.js'
import { applyPublishedTaskRule } from '../tasks/taskRuleRuntime.js'
import {
  appendSeedAuditIntegrity,
  buildPortableAuditExport,
  createSeedArchiveManifest,
  verifySeedAuditChain,
} from '../audit/auditIntegrity.js'
import {
  buildAuditRetentionArtifact,
  buildAuditRetentionPreview,
  createRetentionDispositionId,
} from '../audit/auditRetention.js'
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
  serializeCreativeGenerationMutation,
  serializeCreativeOutputIngestion,
  serializeCreativeProviderOperation,
  serializeCreativeProviderCapEvidence,
  serializeCreativeProviderBudgetWindow,
  serializeCreativeProviderCircuitEvent,
  serializeCreativeProviderCircuitState,
  serializeCreativeProviderControlState,
  serializeCreativeProviderCostLedger,
  serializeCreativeProviderReplay,
  serializeCreativeProviderRetryState,
  serializeLedgerEntry,
  serializeLibraryItem,
  serializeMediaAsset,
  serializeNotification,
  serializePost,
  serializePostDetail,
  serializePortfolioAsset,
  serializeProfile,
  serializeSecurityAlertDispatchEvent,
  serializeTask,
  serializeTaskProposal,
  serializeTaskSubmission,
} from './serializers.js'
import { buildTaskViewModel } from './prismaTransforms.js'
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
import { buildMediaBusinessMetrics } from '../media/mediaBusinessMetrics.js'
import { writeJsonArchive } from '../storage/archiveWriter.js'
import { createSeedChatRepository } from '../chat/seedChatRepository.js'
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
import { sanitizeNotificationMetadata } from './notificationTargets.js'
import { safeCreativeCreditMetadata, safeErrorPreview, safeProviderJobIdEvidence, safeProviderOperationMetadata } from '../creative/generationRecords.js'
import { assetEligibleForWorkspace, assetMediaType, buildSafeAssetLibraryItem } from '../media/assetLibrary.js'
import { resolveCreativeDeliveryAssets } from '../creative/deliveryAssets.js'
import { buildGenerationBusinessMetrics } from '../creative/generationBusinessMetrics.js'
import { taskWorkflowDto } from '../tasks/taskLifecycle.js'
import {
  accountingOperationKey,
  accountingPayloadHash,
  reconcilePointLedgerRows,
  validateMovementGroup,
} from '../accounting/internalAccounting.js'
import {
  buildConsentStatus,
  compliancePolicyManifest,
} from '../compliance/policyManifest.js'
import {
  accountStatusDto,
  deletionSchedule,
  profilePrivacyDto,
  projectProfileForViewer,
} from '../profiles/profileLifecycle.js'
import { createSeedSearchRepository } from '../search/seedSearchRepository.js'
import { searchResourceTypes } from '../search/searchContract.js'

const sessionByRefreshToken = new Map()
const authSessionById = new Map()
const emailAccountByEmail = new Map()
const oauthAccountByProviderKey = new Map()
const oauthAccountMetadataByProviderKey = new Map()
const oauthAuthorizationRequestsByStateHash = new Map()
const oauthProviderControls = new Map()
const creativeGenerationsById = new Map()
const mediaAssetRelationsById = new Map()
const creativeGenerationMutationsById = new Map()
const creativeGenerationMutationsByIdempotencyKey = new Map()
const creativeProviderReplayLedgerById = new Map()
const creativeProviderReplayLedgerByIdempotencyKey = new Map()
const creativeProviderReplayLedgerByProviderEventKey = new Map()
const creativeProviderOperationsByGenerationId = new Map()
const creativeProviderOperationGenerationIdByJobKey = new Map()
const creativeOutputIngestionsById = new Map()
const creativeOutputIngestionsBySourceKey = new Map()
const creativeProviderBudgetWindowsById = new Map()
const creativeProviderBudgetWindowIdsByKey = new Map()
const creativeProviderCostLedgersById = new Map()
const creativeProviderCostLedgerIdsBySourceKey = new Map()
const creativeProviderControlsByScopeKey = new Map()
const creativeProviderCapEvidenceById = new Map()
const creativeProviderCapEvidenceIdsBySourceKey = new Map()
const creativeProviderCircuitsByScopeKey = new Map()
const creativeProviderCircuitEventsById = new Map()
const creativeProviderCircuitEventIdsBySourceKey = new Map()
const creativeProviderRetryStatesBySourceKey = new Map()
const creativeCreditLedgerById = new Map()
const creativeQuotaWindowsById = new Map()
const creativeQuotaReservationsById = new Map()
const portfolioAssetsById = new Map()
const internalPointAccountsByHandle = new Map()
const internalAccountingOperationsByKey = new Map()
const internalAccountingMovementsByOperationKey = new Map()
const accountingReconciliationIssuesByKey = new Map()
const profilePrivacyByHandle = new Map()
const accountLifecycleById = new Map()

const getAccountByHandle = (handle) => seedStore.demoAccountByHandle.get(handle) ?? null
const getAccountById = (id) => seedStore.demoAccounts.find((account) => account.id === id) ?? null
const getSeedProfilePrivacy = (handle) => {
  const current = profilePrivacyByHandle.get(handle)
  if (current) return current
  const created = { visibility: 'public', discoverable: true, showActivity: true, showPortfolio: true, version: 1, updatedAt: new Date().toISOString() }
  profilePrivacyByHandle.set(handle, created)
  return created
}
const getSeedAccountLifecycle = (account) => {
  const current = accountLifecycleById.get(account.id)
  if (current) return current
  const created = {
    status: account.status ?? 'active', accountVersion: 1,
    deletionRequestedAt: null, deletionScheduledAt: null, deletionReasonCode: null,
    suspendedAt: null, suspensionReasonCode: null, updatedAt: new Date().toISOString(),
  }
  accountLifecycleById.set(account.id, created)
  return created
}
const normalizeEmail = (email) => String(email ?? '').trim().toLowerCase()
const oauthKey = (provider, providerUserId) => `${provider}:${providerUserId}`
const oauthAuditResourceId = (provider, providerUserId) => (
  `${provider}:${createHash('sha256').update(`${provider}:${providerUserId}`).digest('hex').slice(0, 24)}`
)
const splitOAuthKey = (key) => {
  const [provider, ...rest] = String(key).split(':')
  return { provider, providerUserId: rest.join(':') }
}
const findOAuthAccountForProvider = (actor, provider) => {
  for (const [key, handle] of oauthAccountByProviderKey.entries()) {
    const account = splitOAuthKey(key)
    if (account.provider === provider && getAccountByHandle(handle)?.id === actor.id) {
      return account
    }
  }
  return null
}

const linkSeedOAuthAccount = (key, handle) => {
  const { provider, providerUserId } = splitOAuthKey(key)
  const now = new Date().toISOString()
  oauthAccountByProviderKey.set(key, handle)
  if (!oauthAccountMetadataByProviderKey.has(key)) {
    oauthAccountMetadataByProviderKey.set(key, {
      id: `oauth-account-${randomUUID()}`,
      provider,
      providerUserId,
      createdAt: now,
      updatedAt: now,
    })
  }
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

const canAccessOwnedResource = (ownerHandle, actor, _elevatedPermission = 'admin:access') => {
  if (!ownerHandle) {
    return true
  }
  return authorizeResource({ resourceType: 'library_item', action: 'read', actor, resource: { ownerHandle }, allowPublic: false }).allowed
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

const legacyLatestLedgerBalance = (userHandle) => {
  const latest = seedStore.pointsLedger.find((entry) => !userHandle || entry.userHandle === userHandle)
  return parsePointsAmount(latest?.balanceAfter)
}

const getSeedPointAccount = (userHandle) => {
  const handle = String(userHandle ?? '')
  const existing = internalPointAccountsByHandle.get(handle)
  if (existing) return existing
  const openingBalance = legacyLatestLedgerBalance(handle)
  const created = {
    id: `point-account-${handle}`,
    userHandle: handle,
    balance: openingBalance,
    openingBalance,
    version: 0,
    updatedAt: new Date().toISOString(),
  }
  internalPointAccountsByHandle.set(handle, created)
  return created
}

const latestLedgerBalance = (userHandle) => userHandle
  ? getSeedPointAccount(userHandle).balance
  : legacyLatestLedgerBalance(null)

const applySeedAccountingOperation = ({
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
  const mapKey = `${unit}:${operationKey}`
  const payloadHash = accountingPayloadHash(payload)
  const existing = internalAccountingOperationsByKey.get(mapKey)
  if (existing) {
    if (existing.payloadHash !== payloadHash) {
      throw new HttpError(409, 'ACCOUNTING_OPERATION_CONFLICT', 'Accounting operation already exists with a different payload')
    }
    return { operation: existing, movements: internalAccountingMovementsByOperationKey.get(mapKey) ?? [], recovered: true }
  }
  const validation = validateMovementGroup({ unit, movements })
  if (!validation.valid) {
    throw new HttpError(409, validation.code, 'Accounting movement group is invalid')
  }
  const appliedMovements = movements.map((movement, index) => {
    let balanceAfter = null
    if (unit === 'points' && movement.accountType === 'available' && movement.ownerHandle) {
      const account = getSeedPointAccount(movement.ownerHandle)
      const nextBalance = account.balance + movement.amount
      if (!allowNegative && nextBalance < 0) {
        throw new HttpError(409, 'POINTS_INSUFFICIENT_BALANCE', 'Available point balance is insufficient')
      }
      const updated = {
        ...account,
        balance: nextBalance,
        version: account.version + 1,
        updatedAt: new Date().toISOString(),
      }
      internalPointAccountsByHandle.set(movement.ownerHandle, updated)
      balanceAfter = nextBalance
    }
    return {
      id: `accounting-movement-${randomUUID()}`,
      unit,
      accountRef: movement.accountRef,
      accountType: movement.accountType,
      amount: movement.amount,
      balanceAfter,
      sequence: index + 1,
    }
  })
  const now = new Date().toISOString()
  const operation = {
    id: `accounting-operation-${randomUUID()}`,
    operationKey,
    unit,
    kind,
    status: 'applied',
    sourceType,
    sourceId: String(sourceId),
    payloadHash,
    reasonCode,
    originalOperationKey,
    reconciliationIssueId,
    actorRef: actor?.handle ?? actor?.id ?? 'system',
    appliedAt: now,
    createdAt: now,
    updatedAt: now,
  }
  internalAccountingOperationsByKey.set(mapKey, operation)
  internalAccountingMovementsByOperationKey.set(mapKey, appliedMovements)
  recordAudit(actor, 'accounting.operation.applied', 'internal_accounting_operation', operation.id, {
    operationKey,
    unit,
    kind,
    sourceType,
    sourceId: String(sourceId),
    reasonCode,
    movementCount: appliedMovements.length,
  })
  return { operation, movements: appliedMovements, recovered: false }
}

const serializeAccountingIssue = (issue) => ({
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
  detectedAt: issue.detectedAt,
  reviewedAt: issue.reviewedAt ?? null,
  resolvedAt: issue.resolvedAt ?? null,
})

const scanSeedAccounting = () => {
  const detected = new Map()
  const addIssue = (issue) => {
    const existing = accountingReconciliationIssuesByKey.get(issue.issueKey)
    const now = new Date().toISOString()
    const next = {
      id: existing?.id ?? `accounting-issue-${randomUUID()}`,
      status: existing?.status === 'ignored' ? 'ignored' : 'open',
      detectedAt: existing?.detectedAt ?? now,
      reviewedAt: existing?.reviewedAt ?? null,
      resolvedAt: null,
      ...existing,
      ...issue,
      updatedAt: now,
    }
    accountingReconciliationIssuesByKey.set(next.issueKey, next)
    detected.set(next.issueKey, next)
  }

  const rowsByHandle = new Map()
  for (const row of seedStore.pointsLedger) {
    const rows = rowsByHandle.get(row.userHandle) ?? []
    rows.push(row)
    rowsByHandle.set(row.userHandle, rows)
  }
  for (const [handle, rows] of rowsByHandle) {
    const report = reconcilePointLedgerRows(rows)
    for (const drift of report.issues) {
      addIssue({
        issueKey: `point_balance_drift:${handle}:${drift.ledgerId}`,
        type: 'point_balance_drift',
        unit: 'points',
        sourceType: 'point_ledger',
        sourceId: drift.ledgerId,
        expectedAmount: drift.expectedBalance,
        actualAmount: drift.actualBalance,
        differenceAmount: drift.difference,
        evidence: { userHandle: handle },
      })
    }
    const account = getSeedPointAccount(handle)
    if (account.balance !== report.actualBalance) {
      addIssue({
        issueKey: `point_balance_drift:${handle}:account`,
        type: 'point_balance_drift',
        unit: 'points',
        sourceType: 'internal_point_account',
        sourceId: account.id,
        expectedAmount: report.actualBalance,
        actualAmount: account.balance,
        differenceAmount: account.balance - report.actualBalance,
        evidence: { userHandle: handle, accountVersion: account.version },
      })
    }
  }

  for (const [mapKey, operation] of internalAccountingOperationsByKey) {
    const movements = internalAccountingMovementsByOperationKey.get(mapKey) ?? []
    const validation = validateMovementGroup({ unit: operation.unit, movements })
    if (!validation.valid) {
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
        evidence: { code: validation.code },
      })
    }
  }

  for (const ledger of creativeCreditLedgerById.values()) {
    const active = ledger.status === 'reserved' ? ledger.reservationAmount : 0
    const cancelled = ledger.status === 'cancelled' ? ledger.reservationAmount : 0
    const terminalTotal = ledger.settledAmount + ledger.refundedAmount + active + cancelled
    if (terminalTotal !== ledger.reservationAmount) {
      addIssue({
        issueKey: `credit_state_mismatch:${ledger.id}`,
        type: 'credit_state_mismatch',
        unit: 'creative_credit',
        sourceType: 'creative_credit_ledger',
        sourceId: ledger.id,
        expectedAmount: ledger.reservationAmount,
        actualAmount: terminalTotal,
        differenceAmount: terminalTotal - ledger.reservationAmount,
        evidence: { generationId: ledger.generationId, status: ledger.status },
      })
    }
  }

  for (const window of creativeQuotaWindowsById.values()) {
    const reservations = [...creativeQuotaReservationsById.values()].filter((reservation) => reservation.quotaWindowId === window.id)
    const expectedReserved = reservations.filter((reservation) => reservation.status === 'reserved').reduce((sum, reservation) => sum + reservation.units, 0)
    const expectedUsed = reservations.filter((reservation) => reservation.status === 'committed').reduce((sum, reservation) => sum + reservation.units, 0)
    const expectedReleased = reservations.filter((reservation) => reservation.status === 'released').reduce((sum, reservation) => sum + reservation.units, 0)
    const countersMatch = expectedReserved === window.reservedUnits && expectedUsed === window.usedUnits && expectedReleased === window.releasedUnits
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
  }
  for (const reservation of creativeQuotaReservationsById.values()) {
    if (!creativeQuotaWindowsById.has(reservation.quotaWindowId)) {
      addIssue({
        issueKey: `orphan_reservation:${reservation.id}`,
        type: 'orphan_reservation',
        unit: 'quota_unit',
        sourceType: 'creative_quota_reservation',
        sourceId: reservation.id,
        expectedAmount: reservation.units,
        actualAmount: 0,
        differenceAmount: -reservation.units,
        evidence: { generationId: reservation.generationId, quotaWindowId: reservation.quotaWindowId },
      })
    }
  }

  const now = new Date().toISOString()
  for (const [key, issue] of accountingReconciliationIssuesByKey) {
    if (!detected.has(key) && ['open', 'repair_pending'].includes(issue.status)) {
      accountingReconciliationIssuesByKey.set(key, { ...issue, status: 'resolved', resolvedAt: now, updatedAt: now })
    }
  }
  const issues = [...accountingReconciliationIssuesByKey.values()].map(serializeAccountingIssue)
  return {
    generatedAt: now,
    summary: {
      total: issues.length,
      open: issues.filter((issue) => issue.status === 'open').length,
      repairPending: issues.filter((issue) => issue.status === 'repair_pending').length,
      resolved: issues.filter((issue) => issue.status === 'resolved').length,
      ignored: issues.filter((issue) => issue.status === 'ignored').length,
    },
    issues,
  }
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
  familyId: session.id,
  clientLabel: session.clientLabel,
  networkHint: session.networkHash ? session.networkHash.slice(0, 8) : null,
  status: session.revokedAt ? 'revoked' : session.expiresAt <= new Date() ? 'expired' : 'active',
  riskStatus: session.riskStatus,
  riskReasonCode: session.riskReasonCode,
  riskDetectedAt: session.riskDetectedAt?.toISOString?.() ?? null,
  reviewedAt: session.reviewedAt?.toISOString?.() ?? null,
  revokeReasonCode: session.revokeReasonCode,
  version: session.version,
  createdAt: session.createdAt.toISOString(),
  lastSeenAt: session.lastSeenAt.toISOString(),
  expiresAt: session.expiresAt.toISOString(),
  revokedAt: session.revokedAt?.toISOString?.() ?? null,
  reuseDetectedAt: session.riskReasonCode === 'refresh_token_reuse' ? session.riskDetectedAt?.toISOString?.() ?? null : null,
  active: !session.revokedAt && session.expiresAt > new Date(),
  current: false,
})

const issueSession = (account, options = {}) => {
  const seededAccount = getAccountByHandle(account.handle) ?? account
  if (getSeedAccountLifecycle(seededAccount).status !== 'active') return null
  const now = new Date()
  const sessionId = options.sessionId ?? options.familyId ?? randomUUID()
  const expiresAt = futureDate(refreshTokenTtlMs)
  const existingSession = authSessionById.get(sessionId)
  const session = existingSession
    ? {
        ...existingSession,
        clientLabel: options.clientContext?.clientLabel ?? existingSession.clientLabel,
        networkHash: options.clientContext?.networkHash ?? existingSession.networkHash,
        lastSeenAt: now,
        expiresAt,
      }
    : {
        id: sessionId,
        handle: seededAccount.handle,
        clientLabel: options.clientContext?.clientLabel ?? 'Unknown client',
        networkHash: options.clientContext?.networkHash ?? null,
        riskStatus: 'normal',
        riskReasonCode: null,
        riskDetectedAt: null,
        reviewedAt: null,
        reviewedById: null,
        revokedAt: null,
        revokeReasonCode: null,
        version: 1,
        createdAt: now,
        lastSeenAt: now,
        expiresAt,
      }
  authSessionById.set(sessionId, session)
  const accessToken = createAccessToken(seededAccount.id, { handle: seededAccount.handle, sid: sessionId })
  const refreshToken = createOpaqueToken('hcai_refresh')
  sessionByRefreshToken.set(refreshToken, {
    id: randomUUID(),
    familyId: sessionId,
    handle: seededAccount.handle,
    expiresAt,
    revokedAt: null,
    replacedByToken: null,
    reuseDetectedAt: null,
    createdAt: now,
  })
  return {
    accessToken,
    refreshToken,
    user: seededAccount,
  }
}

const registerEmailAccount = async ({ email, password, displayName, handle }, consent = null, clientContext = null) => {
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
  if (consent) {
    const record = { ...consent, acceptedAt: new Date().toISOString() }
    policyConsentByUserId.set(account.id, record)
    recordAudit(
      account,
      compliancePolicyManifest.consentContract.recordAction,
      compliancePolicyManifest.consentContract.recordResourceType,
      account.id,
      record,
    )
  }
  return issueSession(account, { clientContext })
}

const verifyPasswordCredentials = async ({ email, password }) => {
  const account = emailAccountByEmail.get(normalizeEmail(email))
  if (!account || getSeedAccountLifecycle(account).status !== 'active' || !(await verifyPassword(password, account.passwordHash))) {
    return null
  }
  return account
}

const loginWithPassword = async (payload, clientContext = null) => {
  const account = await verifyPasswordCredentials(payload)
  return account ? issueSession(account, { clientContext }) : null
}

const createOAuthAuthorizationRequest = async ({ stateHash, provider, redirectTo, linkUserId = null, providerControlVersion = 0, expiresAt }) => {
  const retentionCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
  for (const [key, request] of oauthAuthorizationRequestsByStateHash.entries()) {
    if (new Date(request.expiresAt).getTime() <= retentionCutoff) oauthAuthorizationRequestsByStateHash.delete(key)
  }
  if (oauthAuthorizationRequestsByStateHash.has(stateHash)) {
    return false
  }
  const now = new Date().toISOString()
  oauthAuthorizationRequestsByStateHash.set(stateHash, {
    id: `oauth-request-${randomUUID()}`,
    stateHash,
    provider,
    redirectTo,
    linkUserId,
    providerControlVersion,
    expiresAt: new Date(expiresAt).toISOString(),
    consumedAt: null,
    revokedAt: null,
    revokeReasonCode: null,
    createdAt: now,
  })
  return true
}

const consumeOAuthAuthorizationRequest = async ({ stateHash, provider }) => {
  const request = oauthAuthorizationRequestsByStateHash.get(stateHash)
  if (
    !request ||
    request.provider !== provider ||
    request.consumedAt ||
    request.revokedAt ||
    new Date(request.expiresAt).getTime() <= Date.now()
  ) {
    return null
  }
  request.consumedAt = new Date().toISOString()
  return { ...request }
}

const completeOAuthLogin = async ({ profile, linkUserId = null, clientContext = null }) => {
  const key = oauthKey(profile.provider, profile.providerUserId)
  const linkedHandle = oauthAccountByProviderKey.get(key)
  if (linkUserId) {
    const actor = getAccountById(linkUserId)
    if (!actor || (linkedHandle && getAccountByHandle(linkedHandle)?.id !== linkUserId)) {
      return null
    }
    const existingProviderAccount = findOAuthAccountForProvider(actor, profile.provider)
    if (existingProviderAccount && existingProviderAccount.providerUserId !== profile.providerUserId) {
      return null
    }
    linkSeedOAuthAccount(key, actor.handle)
    recordAudit(actor, 'auth.oauth.linked', 'auth_account', oauthAuditResourceId(profile.provider, profile.providerUserId), { provider: profile.provider })
    return issueSession(actor, { clientContext })
  }

  if (linkedHandle) {
    const linkedAccount = getAccountByHandle(linkedHandle)
    return linkedAccount ? issueSession(linkedAccount, { clientContext }) : null
  }

  const normalizedEmail = normalizeEmail(profile.email)
  const existing = seedStore.demoAccounts.find((account) => normalizeEmail(account.email) === normalizedEmail) ?? null
  if (existing) {
    const existingProviderAccount = findOAuthAccountForProvider(existing, profile.provider)
    if (existingProviderAccount && existingProviderAccount.providerUserId !== profile.providerUserId) {
      return null
    }
    linkSeedOAuthAccount(key, existing.handle)
    recordAudit(existing, 'auth.oauth.linked', 'auth_account', oauthAuditResourceId(profile.provider, profile.providerUserId), { provider: profile.provider })
    return issueSession(existing, { clientContext })
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
  linkSeedOAuthAccount(key, account.handle)
  recordAudit(account, 'auth.oauth.registered', 'user', account.id, { provider: profile.provider })
  return issueSession(account, { clientContext })
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
  oauthAccountMetadataByProviderKey.delete(oauthKey(account.provider, account.providerUserId))
  recordAudit(actor, 'auth.oauth.unlinked', 'auth_account', oauthAuditResourceId(account.provider, account.providerUserId), { provider: account.provider })
  return { unlinked: true }
}

const getTaskById = (id) => seedStore.taskById.get(Number(id)) ?? null
const getActiveTaskById = (id) => {
  const task = getTaskById(id)
  return task && !task.archivedAt ? task : null
}

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
  const versionedNext = {
    ...next,
    version: (Number(current.version) || 1) + 1,
    updatedAt: new Date().toISOString(),
  }
  const index = seedStore.tasks.findIndex((task) => Number(task.id) === Number(id))
  if (index >= 0) {
    seedStore.tasks[index] = versionedNext
  }
  seedStore.taskById.set(Number(id), versionedNext)
  return versionedNext
}

const postCommentsByPostId = new Map()
const postLikeSetsByPostId = new Map()

const getPostById = (id) => seedStore.postById.get(Number(id)) ?? null

const setSeedPost = (post) => {
  const index = seedStore.posts.findIndex((entry) => Number(entry.id) === Number(post.id))
  if (index >= 0) seedStore.posts[index] = post
  seedStore.postById.set(Number(post.id), post)
}

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

const postStatus = (post) => post?.status ?? 'published'
const postModerationState = (post) => post?.moderationState ?? 'visible'
const postOwnerHandle = (post) => getHandle(post?.author)
const canViewPost = (post, viewer) => (postStatus(post) === 'published' && postModerationState(post) === 'visible')
  || Boolean(viewer && (postOwnerHandle(post) === viewer.handle || hasPermission(viewer, 'post:moderate')))

const buildViewerPermissions = (viewer, post = null) => ({
  canComment: Boolean(viewer),
  canLike: Boolean(viewer),
  canConvertToTask: Boolean(viewer),
  canModerate: hasPermission(viewer, 'post:moderate'),
  canEdit: Boolean(viewer && post && postOwnerHandle(post) === viewer.handle && postStatus(post) !== 'deleted'),
  canDelete: Boolean(viewer && post && postOwnerHandle(post) === viewer.handle && postStatus(post) !== 'deleted'),
  canPublish: Boolean(viewer && post && postOwnerHandle(post) === viewer.handle && postStatus(post) === 'draft'),
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
const auditArchiveManifests = []
const auditRetentionDispositions = []
const policyConsentByUserId = new Map()
const operationLeaseStore = new Map()
const stableHash = (value) =>
  createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex')

const recordAudit = (actor, action, resourceType, resourceId = null, metadata = null) => {
  const event = appendSeedAuditIntegrity({
    id: `audit-${auditEvents.length + 1}`,
    actorType: actor ? 'user' : 'system',
    actorId: actor?.id ?? null,
    action,
    resourceType,
    resourceId,
    metadata,
    createdAt: new Date().toISOString(),
  }, auditEvents[0] ?? null)
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
          (!definition.failedOnly || auditMetadata(event).status === 'failed') &&
          (!definition.metadataFilter ||
            auditMetadata(event)[definition.metadataFilter.key] === definition.metadataFilter.value)
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
  const publisherHandle = getHandle(task.publisher)
  applySeedAccountingOperation({
    unit: 'points',
    kind: 'task_escrow_transfer',
    sourceType: 'task',
    sourceId: task.id,
    reasonCode: 'task_completed',
    payload: { taskId: String(task.id), publisherHandle, recipientHandle, amount: pointsReward },
    movements: [
      { unit: 'points', accountRef: `task:${task.id}:points:escrow`, accountType: 'escrow', amount: -pointsReward },
      { unit: 'points', accountRef: `user:${recipientHandle}:points:available`, accountType: 'available', ownerHandle: recipientHandle, amount: pointsReward },
    ],
  })
  const entry = {
    id: `ledger-${randomUUID()}`,
    occurredAtLabel: 'Just now',
    description: `Task accepted: ${task.title}`,
    delta: pointsReward,
    balanceAfter: latestLedgerBalance(recipientHandle),
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
  applySeedAccountingOperation({
    unit: 'points',
    kind: 'task_escrow_reserve',
    sourceType: 'task',
    sourceId: task.id,
    reasonCode: 'task_published',
    payload: { taskId: String(task.id), publisherHandle, amount: pointsReward },
    movements: [
      { unit: 'points', accountRef: `user:${publisherHandle}:points:available`, accountType: 'available', ownerHandle: publisherHandle, amount: -pointsReward },
      { unit: 'points', accountRef: `task:${task.id}:points:escrow`, accountType: 'escrow', amount: pointsReward },
    ],
  })
  const entry = {
    id: `ledger-escrow-${task.id}-${publisherHandle}`,
    occurredAtLabel: 'Just now',
    description: `Task reward held: ${task.title}`,
    delta: -pointsReward,
    balanceAfter: latestLedgerBalance(publisherHandle),
    status: 'pending',
    sourceType: 'task_escrow',
    sourceId: String(task.id),
    userHandle: publisherHandle,
  }
  seedStore.pointsLedger.unshift(entry)
  return entry
}

const finalizeTaskEscrow = (task, publisherHandle, decision, reasonCode = 'task_dispute_rejected') => {
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
  applySeedAccountingOperation({
    unit: 'points',
    kind: 'task_escrow_release',
    sourceType: 'task',
    sourceId: task.id,
    reasonCode,
    payload: { taskId: String(task.id), publisherHandle, amount: pointsReward },
    movements: [
      { unit: 'points', accountRef: `task:${task.id}:points:escrow`, accountType: 'escrow', amount: -pointsReward },
      { unit: 'points', accountRef: `user:${publisherHandle}:points:available`, accountType: 'available', ownerHandle: publisherHandle, amount: pointsReward },
    ],
  })
  const release = {
    id: `ledger-escrow-release-${task.id}-${publisherHandle}`,
    occurredAtLabel: 'Just now',
    description: `Task reward released: ${task.title}`,
    delta: pointsReward,
    balanceAfter: latestLedgerBalance(publisherHandle),
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
  applySeedAccountingOperation({
    unit: 'points',
    kind: 'manual_adjustment',
    sourceType: 'point_adjustment',
    sourceId,
    reasonCode: 'admin_adjustment_approved',
    payload: {
      sourceId,
      userHandle: account.handle,
      delta: payload.delta,
      reasonCode: payload.reasonCode ?? null,
      reviewId: options.reviewId ?? null,
    },
    movements: [
      { unit: 'points', accountRef: 'system:adjustments:points:source', accountType: 'system_source', amount: -payload.delta },
      { unit: 'points', accountRef: `user:${account.handle}:points:available`, accountType: 'available', ownerHandle: account.handle, amount: payload.delta },
    ],
    actor,
    allowNegative: true,
  })
  const entry = {
    id: `ledger-adjust-${randomUUID()}`,
    occurredAtLabel: 'Just now',
    description: `Manual adjustment: ${payload.reason}`,
    delta: payload.delta,
    balanceAfter: latestLedgerBalance(account.handle),
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
let pointAdjustmentPolicyVersion = 0
let mediaGovernancePolicy = null
const getSeedMediaGovernancePolicy = () =>
  normalizeMediaGovernancePolicy(mediaGovernancePolicy ?? {}, buildDefaultMediaGovernancePolicy())
const taskProposals = []
const taskSubmissions = []
const mediaAssetsById = new Map()

const getSeedAssetLibraryItem = (asset, actor) => {
  if (!asset || asset.ownerHandle !== actor.handle) return null
  const generation = [...creativeGenerationsById.values()].find((item) => item.outputAssetIds?.includes(asset.id)) ?? null
  const relations = [...mediaAssetRelationsById.values()].filter((item) => item.sourceAssetId === asset.id || item.targetAssetId === asset.id)
  const referenced = Boolean(generation || [...creativeGenerationsById.values()].some((item) => item.inputAssetIds?.includes(asset.id)))
  return buildSafeAssetLibraryItem(asset, { generation, relations, referenced })
}
const getSeedAdminAsset = (asset) => asset ? {
  ...buildSafeAssetLibraryItem(asset, {
    relations: [...mediaAssetRelationsById.values()].filter((relation) => relation.sourceAssetId === asset.id || relation.targetAssetId === asset.id),
    referenced: [...portfolioAssetsById.values()].some((item) => item.assetId === asset.id),
  }),
  owner: { id: asset.ownerId ?? asset.ownerHandle, handle: asset.ownerHandle },
  portfolio: [...portfolioAssetsById.values()].filter((item) => item.assetId === asset.id).map((item) => serializePortfolioAsset(item, asset)),
} : null
const getSeedPublicPortfolio = (handle) => [...portfolioAssetsById.values()]
  .filter((item) => item.ownerHandle === handle && item.status === 'published')
  .filter((item) => {
    const asset = mediaAssetsById.get(item.assetId)
    return asset && !asset.archivedAt && !asset.deletedAt && asset.status === 'uploaded' && asset.metadata?.security?.scanStatus === 'clean'
  })
  .sort((left, right) => left.sortOrder - right.sortOrder || right.createdAt.localeCompare(left.createdAt))
  .map((item) => serializePortfolioAsset(item, mediaAssetsById.get(item.assetId)))
const notifications = []
let notificationDeliveryRepository = null

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
    .filter((recipient) => isSeedNotificationEnabled(recipient.id, payload.type))
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
      metadata: sanitizeNotificationMetadata(payload.metadata, payload),
      templateKey: payload.templateKey ?? null,
      templateVersion: payload.templateVersion ?? null,
      readAt: null,
      createdAt: now,
    }))
  notifications.unshift(...created)
  for (const notification of created) {
    notificationDeliveryRepository?.createForNotification(notification, getAccountById(notification.recipientId))
  }
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

function providerLifecycleRecipientHandles(actor, payload = {}, notificationPayload = null) {
  const audience = notificationPayload?.metadata?.audience
  const includeOwner = audience === 'owner' || audience === 'owner_and_operations'
  const includeOperations = audience === 'operations' || audience === 'owner_and_operations'
  return uniqueHandles([
    includeOwner ? payload.actorHandle : null,
    ...(includeOperations
      ? seedStore.demoAccounts
        .filter((account) => account.handle !== actor?.handle && hasPermission(account, 'admin:audit:read'))
        .map((account) => account.handle)
      : []),
  ])
}

function createProviderLifecycleNotifications(payload = {}, actor = null) {
  const notificationPayload = buildProviderLifecycleNotificationPayload(payload)
  if (!notificationPayload) return []
  const handles = providerLifecycleRecipientHandles(actor, payload, notificationPayload)
    .filter((handle) => !notifications.some((notification) =>
      notification.recipientHandle === handle &&
      notification.type === notificationPayload.type &&
      notification.resourceType === notificationPayload.resourceType &&
      notification.resourceId === notificationPayload.resourceId &&
      hasProviderLifecycleSourceKey(notification, notificationPayload.metadata.sourceKey),
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
    hasProviderLifecycleSourceKey(event, auditPayload.metadata.sourceKey),
  )
  const ensureOperationalNotification = () => {
    if (payload.action === 'creative.provider_lifecycle.side_effect_applied') return
    createProviderLifecycleNotifications({
      ...payload,
      sourceKey: `${payload.sourceKey}:notification`,
      type: payload.action,
    }, actor)
  }
  if (existing) {
    ensureOperationalNotification()
    return serializeAuditEvent(existing)
  }
  const event = serializeAuditEvent(recordAudit(
    auditPayload.actor,
    auditPayload.action,
    auditPayload.resourceType,
    auditPayload.resourceId,
    auditPayload.metadata,
  ))
  ensureOperationalNotification()
  return event
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
    upload: signMediaUpload({ ...asset, checksumSha256: asset.storage?.checksumSha256 ?? null }),
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

const transitionSeedStorage = (asset, state, now = new Date().toISOString(), patch = {}) => asset.storage ? {
  ...asset.storage,
  ...patch,
  state,
  quarantinedAt: state === 'available' ? null : (patch.quarantinedAt ?? asset.storage.quarantinedAt ?? now),
  version: Number(asset.storage.version ?? 1) + 1,
} : null

const activeSeedStorageState = (asset, { archivedAt = asset.archivedAt, deletedAt = asset.deletedAt } = {}) => {
  if (asset.storage?.deletedAt) return 'deleted'
  if (deletedAt) return 'cleanup_pending'
  if (archivedAt) return 'quarantined'
  return asset.metadata?.security?.scanStatus === 'clean' ? 'available' : 'quarantined'
}

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
    modelVersionId: payload.modelVersionId ?? null,
    modelDeploymentId: payload.modelDeploymentId ?? null,
    pricingVersionId: payload.pricingVersionId ?? null,
    retryOfId: payload.retryOfId ?? null,
    attemptNumber: Number(payload.attemptNumber ?? 1),
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

const makeCreativeGenerationMutationRecord = (payload, patch = {}) => {
  const now = new Date().toISOString()
  return {
    id: payload.id ?? `generation-mutation-${randomUUID()}`,
    generationId: String(payload.generationId),
    type: payload.type,
    status: payload.status ?? 'requested',
    idempotencyKey: payload.idempotencyKey,
    requestedById: payload.requestedById ?? null,
    requestedByHandle: payload.requestedByHandle ?? null,
    reasonCode: payload.reasonCode,
    notePreview: payload.notePreview ?? null,
    reviewId: payload.reviewId ?? null,
    targetGenerationId: payload.targetGenerationId ?? null,
    safeMetadata: payload.safeMetadata ?? null,
    result: payload.result ?? null,
    completedAt: payload.completedAt ?? null,
    createdAt: payload.createdAt ?? now,
    updatedAt: now,
    ...patch,
  }
}

const makeCreativeProviderOperationRecord = (payload, patch = {}) => {
  const now = new Date().toISOString()
  return {
    id: payload.id ?? `provider-operation-${randomUUID()}`,
    generationId: String(payload.generationId),
    providerId: payload.providerId,
    providerMode: payload.providerMode,
    providerJobId: safeProviderJobIdEvidence(payload.providerJobId),
    status: payload.status ?? 'queued',
    version: Number(payload.version ?? 1),
    pollAttempts: Number(payload.pollAttempts ?? 0),
    nextPollAt: payload.nextPollAt ?? null,
    timeoutAt: payload.timeoutAt,
    lastPayloadHash: payload.lastPayloadHash ?? null,
    outputDigest: payload.outputDigest ?? null,
    lastErrorCode: payload.lastErrorCode ?? null,
    sideEffectsComplete: Boolean(payload.sideEffectsComplete),
    safeMetadata: safeProviderOperationMetadata(payload.safeMetadata),
    terminalAt: payload.terminalAt ?? null,
    createdAt: payload.createdAt ?? now,
    updatedAt: now,
    ...patch,
  }
}

const providerOperationConflict = (reasonCode) => new HttpError(
  409,
  'CREATIVE_PROVIDER_OPERATION_CONFLICT',
  'Creative Provider operation state conflict',
  { reasonCode },
)

const makeCreativeProviderReplayRecord = (payload, patch = {}) => {
  const now = new Date().toISOString()
  return {
    id: payload.id ?? `provider-replay-${randomUUID()}`,
    generationId: String(payload.generationId ?? ''),
    providerId: payload.providerId,
    providerMode: payload.providerMode ?? null,
    providerJobId: safeProviderJobIdEvidence(payload.providerJobId),
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

const makeCreativeOutputIngestionRecord = (payload, patch = {}) => {
  const now = new Date().toISOString()
  return {
    id: payload.id ?? `output-ingestion-${randomUUID()}`,
    sourceKey: String(payload.sourceKey),
    generationId: String(payload.generationId),
    providerId: payload.providerId,
    providerJobId: safeProviderJobIdEvidence(payload.providerJobId),
    outputDigest: payload.outputDigest,
    outputIndex: Number(payload.outputIndex),
    status: payload.status ?? 'pending',
    mediaAssetId: payload.mediaAssetId ?? null,
    storageKey: payload.storageKey ?? null,
    detectedContentType: payload.detectedContentType ?? null,
    sizeBytes: payload.sizeBytes ?? null,
    sha256: payload.sha256 ?? null,
    errorCode: payload.errorCode ?? null,
    claimToken: payload.claimToken ?? null,
    claimedAt: payload.claimedAt ?? null,
    leaseExpiresAt: payload.leaseExpiresAt ?? null,
    completedAt: payload.completedAt ?? null,
    createdAt: payload.createdAt ?? now,
    updatedAt: now,
    ...patch,
  }
}

const providerBudgetWindowKey = ({ budgetScope, currency, windowStart, windowEnd }) =>
  [budgetScope, currency, windowStart, windowEnd].join(':')

const makeCreativeProviderBudgetWindow = (payload, patch = {}) => {
  const now = new Date().toISOString()
  return {
    id: payload.id ?? `provider-budget-${randomUUID()}`,
    budgetScope: payload.budgetScope,
    providerId: payload.providerId,
    providerAccountRef: payload.providerAccountRef,
    workspace: payload.workspace,
    currency: payload.currency,
    windowStart: payload.windowStart,
    windowEnd: payload.windowEnd,
    capMicros: BigInt(payload.capMicros),
    reservedMicros: BigInt(payload.reservedMicros ?? 0),
    spentMicros: BigInt(payload.spentMicros ?? payload.openingSpentMicros ?? 0),
    releasedMicros: BigInt(payload.releasedMicros ?? 0),
    createdAt: payload.createdAt ?? now,
    updatedAt: now,
    ...patch,
  }
}

const makeCreativeProviderCostLedger = (payload, patch = {}) => {
  const now = new Date().toISOString()
  return {
    id: payload.id ?? `provider-cost-${randomUUID()}`,
    sourceKey: payload.sourceKey,
    generationId: payload.generationId,
    budgetWindowId: payload.budgetWindowId,
    providerId: payload.providerId,
    providerAccountRef: payload.providerAccountRef,
    providerModelId: payload.providerModelId,
    providerJobId: payload.providerJobId ?? null,
    workspace: payload.workspace,
    mode: payload.mode,
    currency: payload.currency,
    pricingSnapshot: payload.pricingSnapshot,
    pricingSnapshotHash: payload.pricingSnapshotHash,
    estimateMicros: BigInt(payload.estimateMicros),
    reservedMicros: BigInt(payload.reservedMicros ?? payload.estimateMicros),
    actualMicros: payload.actualMicros == null ? null : BigInt(payload.actualMicros),
    status: payload.status ?? 'reserved',
    usage: payload.usage ?? null,
    risk: payload.risk ?? null,
    reasonCode: payload.reasonCode ?? null,
    reservedAt: payload.reservedAt ?? now,
    settledAt: payload.settledAt ?? null,
    releasedAt: payload.releasedAt ?? null,
    reconciliationAt: payload.reconciliationAt ?? null,
    createdAt: payload.createdAt ?? now,
    updatedAt: now,
    ...patch,
  }
}

const providerCostConflict = (reasonCode) => new HttpError(
  409,
  'CREATIVE_PROVIDER_COST_LEDGER_CONFLICT',
  'Creative Provider cost ledger conflict',
  { reasonCode },
)

const providerCostDto = (ledger) => serializeCreativeProviderCostLedger(
  ledger,
  creativeProviderBudgetWindowsById.get(ledger.budgetWindowId) ?? null,
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

const makeProviderRetryState = (payload, patch = {}) => {
  const now = new Date().toISOString()
  return {
    id: payload.id ?? `provider-retry-${randomUUID()}`,
    sourceKey: String(payload.sourceKey),
    generationId: String(payload.generationId),
    providerId: payload.providerId,
    workspace: payload.workspace,
    operationType: payload.operationType,
    status: payload.status,
    attempt: Number(payload.attempt),
    maxAttempts: Number(payload.maxAttempts),
    firstAttemptAt: payload.firstAttemptAt,
    lastAttemptAt: payload.lastAttemptAt,
    nextAttemptAt: payload.nextAttemptAt ?? null,
    lastFailureKeyHash: payload.lastFailureKeyHash,
    lastErrorCode: payload.lastErrorCode,
    lastErrorCategory: payload.lastErrorCategory,
    delaySource: payload.delaySource ?? null,
    policyHash: payload.policyHash,
    version: Number(payload.version ?? 1),
    createdAt: payload.createdAt ?? now,
    updatedAt: now,
    ...patch,
  }
}

const makeProviderControl = (payload, patch = {}) => {
  const now = new Date().toISOString()
  const enabled = payload.enabled === true
  const id = patch.id ?? payload.id ?? `provider-control-${randomUUID()}`
  return {
    id,
    scopeKey: payload.scopeKey,
    scopeType: payload.scopeType,
    providerId: payload.providerId ?? null,
    providerAccountRef: payload.providerAccountRef ?? null,
    workspace: payload.workspace ?? null,
    modelFamily: payload.modelFamily ?? null,
    enabled,
    version: Number(payload.version ?? 1),
    reasonCode: payload.reasonCode,
    changedByRef: payload.changedByRef ?? null,
    enabledAt: payload.enabledAt ?? (enabled ? now : null),
    disabledAt: payload.disabledAt ?? (enabled ? null : now),
    createdAt: payload.createdAt ?? now,
    updatedAt: now,
    ...patch,
    id,
  }
}

const makeProviderCapEvidence = (payload) => ({
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
  verifiedAt: payload.verifiedAt,
  expiresAt: payload.expiresAt,
  active: payload.active !== false,
  createdAt: payload.createdAt ?? new Date().toISOString(),
})

const makeProviderCircuit = (payload, patch = {}) => {
  const now = new Date().toISOString()
  return {
    id: payload.id ?? `provider-circuit-${randomUUID()}`,
    scopeKey: payload.scopeKey,
    providerId: payload.providerId,
    providerAccountRef: payload.providerAccountRef,
    workspace: payload.workspace,
    modelFamily: payload.modelFamily ?? null,
    status: payload.status ?? 'closed',
    version: Number(payload.version ?? 1),
    failureCount: Number(payload.failureCount ?? 0),
    windowStartedAt: payload.windowStartedAt ?? null,
    lastFailureAt: payload.lastFailureAt ?? null,
    openedAt: payload.openedAt ?? null,
    cooldownUntil: payload.cooldownUntil ?? null,
    probeLeaseTokenHash: payload.probeLeaseTokenHash ?? null,
    probeLeaseExpiresAt: payload.probeLeaseExpiresAt ?? null,
    reasonCode: payload.reasonCode ?? null,
    createdAt: payload.createdAt ?? now,
    updatedAt: now,
    ...patch,
  }
}

const providerControlAuditMetadata = (state) => ({
  scopeType: state.scopeType,
  providerId: state.providerId,
  workspace: state.workspace,
  modelFamily: state.modelFamily,
  enabled: state.enabled,
  version: state.version,
  reasonCode: state.reasonCode,
})

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

export const createSeedRepository = () => {
  const auditRecorder = ({ actor, action, resourceType, resourceId, metadata }) => recordAudit(actor, action, resourceType, resourceId, metadata)
  const domainEvents = createSeedDomainEventRepository({ recordAudit: auditRecorder })
  const domainEventConsumers = createSeedDomainEventConsumerRepository({ recordAudit: auditRecorder })
  const jobs = createSeedJobRepository({ recordAudit: auditRecorder })
  const creativeGenerationExecutions = createSeedGenerationExecutionRepository({ recordAudit: auditRecorder })
  const systemSettings = createSeedSystemSettingsRepository({ recordAudit: auditRecorder })
  const configResources = createSeedConfigResourcesRepository({ recordAudit: auditRecorder })
  const modelControl = createSeedModelControlRepository({ recordAudit: auditRecorder })
  const modelRouting = createSeedModelRoutingRepository({ modelControl, recordAudit: auditRecorder })
  const modelEvaluation = createSeedModelEvaluationRepository({ modelControl })
  const providerLegal = createSeedProviderLegalRepository({ modelControl })
  let modelGovernance
  const releaseChanges = createSeedReleaseRepository({
    onModelPromotionCreated: async (releaseChangeId, promotion) => modelGovernance?.recordPromotion(releaseChangeId, promotion),
    onModelPromotionTransition: async (promotion, patch, release) => {
      if (patch.status === 'deployed') await modelGovernance?.validatePromotion(promotion, release)
      return modelControl.setPromotionTrafficEligibility(
        promotion.modelDeploymentId,
        patch.status === 'deployed',
        patch.appliedByRef ?? patch.rolledBackByRef ?? 'release-control',
      )
    },
  })
  modelGovernance = createSeedModelGovernanceRepository({ modelControl, modelRouting, modelEvaluation, providerLegal, releaseChanges })
  const providerOperations = createSeedProviderOperationsRepository({ modelControl })
  const observability = createSeedObservabilityRepository({
    notifyOnCall: (handles, alert, eventType) => createNotificationsForHandles(handles, {
      type: `observability.alert_${eventType}`,
      title: eventType === 'escalated' ? 'Observability alert escalated' : 'SLO burn-rate alert firing',
      body: `${alert.sloId} is ${eventType === 'escalated' ? 'escalated for incident response' : 'outside its configured burn-rate threshold'}.`,
      resourceType: 'observability_alert',
      resourceId: alert.id,
      metadata: { status: alert.state, alertId: alert.id, severity: alert.severity, escalationLevel: alert.escalationLevel ?? 0, target: { page: 'admin', admin: { tab: 'Observability', observabilityAlertId: alert.id } } },
      dedupeUnread: true,
    }),
  })
  const search = createSeedSearchRepository({
    seedStore,
    mediaAssetsById,
    portfolioAssetsById,
    getProfilePrivacy: getSeedProfilePrivacy,
    getAccountLifecycle: getSeedAccountLifecycle,
    searchResourceTypes,
  })
  const moderationCaseTarget = (record, surface = 'support') => ({
    surface,
    intent: surface === 'admin' ? 'review' : 'view',
    caseId: record.id,
    ...(record.targetType === 'post' ? { postId: record.targetId } : {}),
    ...(record.targetType === 'comment' ? { commentId: record.targetId } : {}),
  })
  const notifyTrustReviewers = (actor, payload) => createNotificationsForHandles(
    seedStore.demoAccounts
      .filter((account) => hasPermission(account, 'admin:trust:read') && account.handle !== actor?.handle)
      .map((account) => account.handle),
    payload,
  )
  const notifyCommunityReportCreated = (record, reporter) => {
    if (!['post', 'comment'].includes(record.targetType)) return
    notifyTrustReviewers(reporter, {
      type: 'community.report_submitted', title: 'Community report requires review', body: `${record.targetType} report was added to the Trust and Safety queue.`,
      resourceType: 'moderation_case', resourceId: record.id,
      metadata: { status: 'open', caseId: record.id, reasonCode: 'community_report_submitted', target: moderationCaseTarget(record, 'admin') }, dedupeUnread: true,
    })
  }
  const notifyCommunityAppealCreated = (record, appeal, appellant) => {
    if (!['post', 'comment'].includes(record.targetType)) return
    notifyTrustReviewers(appellant, {
      type: 'community.appeal_submitted', title: 'Community moderation appeal requires review', body: `An affected community author appealed case ${record.id}.`,
      resourceType: 'moderation_case', resourceId: record.id,
      metadata: { status: 'appealed', caseId: record.id, reasonCode: appeal.reasonCode, target: moderationCaseTarget(record, 'admin') }, dedupeUnread: true,
    })
  }
  const applyCommunityModerationDecision = (record, decision, reviewer) => {
    if (!['post', 'comment'].includes(record.targetType)) return
    const target = record.targetType === 'post'
      ? getPostById(record.targetId)
      : [...postCommentsByPostId.values()].flat().find((item) => item.id === record.targetId)
    if (!target) throw new HttpError(409, 'COMMUNITY_MODERATION_TARGET_MISSING', 'Community moderation target no longer exists')
    const transition = communityModerationTransition({ targetType: record.targetType, currentState: target.moderationState ?? 'visible', stage: decision.stage, outcome: decision.outcome })
    const now = new Date().toISOString()
    target.moderationState = transition.toState
    target.moderationVersion = (target.moderationVersion ?? 0) + 1
    target.moderationUpdatedAt = now
    const action = {
      id: `community-moderation-${randomUUID()}`, caseId: record.id, decisionId: decision.id, targetType: record.targetType, targetId: record.targetId,
      action: transition.action, fromState: transition.fromState, toState: transition.toState, reasonCode: decision.reasonCode, actorId: reviewer.id, createdAt: now,
    }
    record.communityActions.push(action)
    recordAudit(reviewer, 'community.content.moderated', record.targetType, record.targetId, { caseId: record.id, decisionId: decision.id, moderationAction: action.action, fromState: action.fromState, toState: action.toState, reasonCode: action.reasonCode })
    createNotificationsForHandles([record.affectedUser?.handle, record.report?.reporter?.handle], {
      type: decision.stage === 'appeal' ? 'community.appeal_decided' : 'community.moderation_decided',
      title: decision.stage === 'appeal' ? 'Community appeal decided' : 'Community report decided',
      body: action.toState === 'hidden' ? 'Reported community content is no longer publicly visible.' : decision.stage === 'appeal' && action.action === 'restore' ? 'Community content was restored after independent appeal review.' : 'A Trust and Safety decision was recorded for the community report.',
      resourceType: 'moderation_case', resourceId: record.id,
      metadata: { status: decision.stage === 'appeal' ? 'closed' : 'resolved', caseId: record.id, reasonCode: decision.reasonCode, outcome: decision.outcome, moderationAction: action.action, target: moderationCaseTarget(record) }, dedupeUnread: true,
    })
  }
  const moderationCases = createSeedModerationCaseRepository({
    getUserById: getAccountById,
    recordAudit,
    onReportCreated: notifyCommunityReportCreated,
    onAppealCreated: notifyCommunityAppealCreated,
    onDecisionCreated: applyCommunityModerationDecision,
    resolveTarget: (targetType, targetId, actor) => {
      if (targetType === 'user') {
        const account = getAccountById(targetId) ?? getAccountByHandle(targetId)
        return account ? { affectedUser: account, contentHash: createHash('sha256').update(`user:${account.id}`).digest('hex') } : null
      }
      if (targetType === 'post') {
        const post = getPostById(targetId)
        const account = post ? getAccountByHandle(postOwnerHandle(post)) : null
        return post && account && canViewPost(post, actor) ? { affectedUser: account, contentHash: createHash('sha256').update(`post:${post.id}:${post.version ?? 1}`).digest('hex') } : null
      }
      if (targetType === 'comment') {
        const match = [...postCommentsByPostId.entries()].map(([postId, comments]) => ({ postId, comment: comments.find((item) => item.id === targetId) })).find((item) => item.comment)
        const comment = match?.comment ?? null
        const parentPost = match ? getPostById(match.postId) : null
        const account = comment ? getAccountByHandle(comment.author?.handle) : null
        const actorOwnsComment = account?.id === actor.id
        return comment && account && parentPost && (actorOwnsComment || (canViewPost(parentPost, actor) && comment.moderationState !== 'hidden')) ? { affectedUser: account, contentHash: createHash('sha256').update(`comment:${comment.id}:${comment.createdAt}`).digest('hex') } : null
      }
      if (targetType === 'media_asset') {
        const asset = mediaAssetsById.get(String(targetId)) ?? null
        const account = asset ? getAccountByHandle(asset.ownerHandle) : null
        return asset && account ? { affectedUser: account, contentHash: createHash('sha256').update(`media_asset:${asset.id}:${asset.updatedAt ?? asset.createdAt ?? ''}`).digest('hex') } : null
      }
      if (targetType === 'creative_generation') {
        const generation = creativeGenerationsById.get(String(targetId)) ?? null
        const account = generation ? getAccountByHandle(generation.ownerHandle ?? generation.userHandle) : null
        return generation && account ? { affectedUser: account, contentHash: createHash('sha256').update(`creative_generation:${generation.id}:${generation.updatedAt ?? generation.createdAt ?? ''}`).digest('hex') } : null
      }
      return null
    },
  })
  const safetyOperations = createSeedSafetyOperationsRepository({
    moderationCases,
    getUserById: getAccountById,
    recordAudit,
  })
  const oauthAdmin = createSeedOAuthAdminRepository({
    oauthAccountByProviderKey,
    oauthAccountMetadataByProviderKey,
    oauthAuthorizationRequestsByStateHash,
    oauthProviderControls,
    getAccountByHandle,
    countAuthMethods: countSeedAuthMethods,
    recordAudit,
  })
  const authSessionAdmin = createSeedAuthSessionAdminRepository({
    authSessionById,
    sessionByRefreshToken,
    getAccountByHandle,
    getAccountById,
    recordAudit,
  })
  const authRiskAdmin = createSeedAuthRiskAdminRepository({ authSessionById, recordAudit })
  const risk = createSeedRiskRepository({ getAccountById, creativeGenerationsById, authRiskAdmin, recordAudit })
  const userAdmin = createSeedUserAdminRepository({
    accounts: seedStore.demoAccounts,
    getLifecycle: getSeedAccountLifecycle,
    getPrivacy: getSeedProfilePrivacy,
    authSessionById,
    sessionByRefreshToken,
    recordAudit,
  })
  const taskAdmin = createSeedTaskAdminRepository({
    tasks: seedStore.tasks,
    getTask: getTaskById,
    updateTask,
    finalizeTaskEscrow,
    createTaskEscrow,
    recordAudit,
  })
  const communityAdmin = createSeedCommunityAdminRepository({
    posts: seedStore.posts,
    commentsByPostId: postCommentsByPostId,
    setPost: setSeedPost,
    recordAudit,
  })
  const taskLifecycleRecovery = createSeedTaskLifecycleRecoveryRepository({
    tasks: seedStore.tasks,
    getTask: getTaskById,
    updateTask,
    finalizeTaskEscrow,
    recordAudit,
  })
  const billingAdmin = createSeedBillingAdminRepository({
    operationsByKey: internalAccountingOperationsByKey,
    movementsByOperationKey: internalAccountingMovementsByOperationKey,
    issuesByKey: accountingReconciliationIssuesByKey,
    getPointPolicyState: (fallbackPolicy) => ({
      version: pointAdjustmentPolicyVersion,
      updatedAt: null,
      policy: normalizePointAdjustmentPolicy(pointAdjustmentPolicy ?? fallbackPolicy, fallbackPolicy),
    }),
  })
  const entitlements = createSeedEntitlementRepository({ getUserByHandle: getAccountByHandle, getUserById: getAccountById, recordAudit })
  const notificationManagement = createSeedNotificationManagementRepository({ getUserByHandle: getAccountByHandle, recordAudit: auditRecorder })
  notificationDeliveryRepository = createSeedNotificationDeliveryRepository({
    getNotificationById: (id) => notifications.find((item) => item.id === String(id)) ?? null,
    getRecipientById: getAccountById,
    recordAudit: ({ actor, action, resourceType, resourceId, metadata }) => recordAudit(actor, action, resourceType, resourceId, metadata),
  })
  const developerAccess = createSeedDeveloperAccessRepository({
    findOwnerById: getAccountById,
    recordAudit: ({ actor, action, resourceType, resourceId, metadata }) => recordAudit(actor, action, resourceType, resourceId, metadata),
  })
  const webhooks = createSeedWebhookRepository({
    findOwnerById: getAccountById,
    recordAudit: ({ actor, action, resourceType, resourceId, metadata }) => recordAudit(actor, action, resourceType, resourceId, metadata),
  })
  const support = createSeedSupportRepository({
    getUserById: getAccountById,
    recordAudit: ({ actor, action, resourceType, resourceId, metadata }) => recordAudit(actor, action, resourceType, resourceId, metadata),
    notifyRequester: (requester, ticket, type) => createNotificationsForHandles([requester.handle], {
      type,
      title: type === 'support.message_added' ? 'Support replied' : `Support ticket ${ticket.status.replaceAll('_', ' ')}`,
      body: type === 'support.message_added' ? `A support operator replied to "${ticket.subject}".` : `Your support request "${ticket.subject}" was updated.`,
      resourceType: 'support_ticket', resourceId: ticket.id,
      metadata: { status: ticket.status, ticketId: ticket.id, target: { page: 'support', supportTicketId: ticket.id } },
    }),
    caseExists: (caseType, caseId) => caseType === 'admin_review'
      ? adminReviewById.has(caseId)
      : Boolean(moderationCases.findAdmin(caseId)),
  })
  const dataRights = createSeedDataRightsRepository({
    accountForActor: async (actor) => {
      const account = getAccountById(actor.id) ?? getAccountByHandle(actor.handle)
      return account ? { ...account, ...getSeedAccountLifecycle(account) } : null
    },
    snapshotForActor: async (actor) => {
      const account = getAccountById(actor.id) ?? getAccountByHandle(actor.handle)
      const profile = account ? seedStore.profileByHandle.get(account.handle) ?? null : null
      return {
        account: account ? { id: account.id, handle: account.handle, displayName: account.displayName, role: account.role, status: getSeedAccountLifecycle(account).status } : null,
        profile: profile ? serializeProfile(profile) : null,
        tasks: seedStore.tasks.filter((item) => [item.publisher, item.assignee].includes(account?.handle)),
        posts: seedStore.posts.filter((item) => item.ownerHandle === account?.handle || item.authorHandle === account?.handle),
        library: seedLibraryItems.filter((item) => item.ownerHandle === account?.handle).map(serializeLibraryItem),
        points: seedStore.pointsLedger.filter((item) => item.userHandle === account?.handle).map(serializeLedgerEntry),
        notifications: notifications.filter((item) => item.recipientId === account?.id).map(serializeNotification),
      }
    },
    scheduleDeletion: async (actor, payload) => {
      const account = getAccountById(actor.id) ?? getAccountByHandle(actor.handle)
      const current = getSeedAccountLifecycle(account)
      accountLifecycleById.set(account.id, { ...current, accountVersion: current.accountVersion + 1, deletionRequestedAt: new Date().toISOString(), deletionScheduledAt: deletionSchedule(new Date()).toISOString(), deletionReasonCode: payload.reasonCode })
    },
    cancelDeletion: async (actor) => {
      const account = getAccountById(actor.id) ?? getAccountByHandle(actor.handle)
      const current = getSeedAccountLifecycle(account)
      accountLifecycleById.set(account.id, { ...current, accountVersion: current.accountVersion + 1, deletionRequestedAt: null, deletionScheduledAt: null, deletionReasonCode: null })
    },
    applyDeletion: async (request, _plan, now) => {
      const account = getAccountById(request.subjectId)
      const lifecycle = getSeedAccountLifecycle(account)
      accountLifecycleById.set(account.id, { ...lifecycle, status: 'deleted', accountVersion: lifecycle.accountVersion + 1, deletionRequestedAt: null, deletionScheduledAt: null, deletionReasonCode: request.reasonCode, updatedAt: now.toISOString() })
      const profile = seedStore.profileByHandle.get(account.handle)
      if (profile) seedStore.profileByHandle.set(account.handle, { ...profile, name: { en: 'Deleted user', zh: '已删除用户' }, bio: { en: '', zh: '' }, tags: [], zhTags: [], languages: [] })
      return { identity: 1, sessions: 1, profile: profile ? 1 : 0, tasks: seedStore.tasks.filter((item) => [item.publisher, item.assignee].includes(account.handle)).length, community: seedStore.posts.filter((item) => item.ownerHandle === account.handle || item.authorHandle === account.handle).length, notifications: notifications.filter((item) => item.recipientId === account.id).length, billing: seedStore.pointsLedger.filter((item) => item.userHandle === account.handle).length }
    },
    recordAudit: ({ actor, action, resourceType, resourceId, metadata }) => recordAudit(actor, action, resourceType, resourceId, metadata),
  })
  return {
  chat: createSeedChatRepository({
    recordAudit: ({ actor, action, resourceType, resourceId, metadata }) =>
      recordAudit(actor, action, resourceType, resourceId, metadata),
  }),
  releaseChanges,
  systemSettings,
  configResources,
  modelControl,
  modelRouting,
  modelGovernance,
  modelEvaluation,
  providerLegal,
  providerOperations,
  creativeGenerationExecutions,
  observability,
  search,
  oauthAdmin,
  authSessionAdmin,
  authRiskAdmin,
  risk,
  userAdmin,
  taskAdmin,
  communityAdmin,
  notificationManagement,
  notificationDeliveries: notificationDeliveryRepository,
  taskLifecycleRecovery,
  billingAdmin,
  entitlements,
  developerAccess,
  webhooks,
  support,
  dataRights,
  auth: {
    getCurrentUser: () => seedStore.me,
    findDemoAccountByAccessToken: (token) => {
      const payload = verifyAccessToken(token)
      if (payload) {
        const session = payload.sid ? authSessionById.get(payload.sid) : null
        if (!session || session.revokedAt || session.expiresAt <= new Date() || session.riskStatus === 'compromised') return null
        authSessionById.set(session.id, { ...session, lastSeenAt: new Date() })
        const account = getAccountById(payload.sub) ?? getAccountByHandle(payload.handle) ?? null
        return account && getSeedAccountLifecycle(account).status === 'active' ? account : null
      }
      const account = seedStore.demoAccountByAccessToken.get(token) ?? null
      return account && getSeedAccountLifecycle(account).status === 'active' ? account : null
    },
    findDemoAccountByRefreshToken: (token) => {
      const session = sessionByRefreshToken.get(token)
      const logicalSession = session ? authSessionById.get(session.familyId) : null
      if (session && logicalSession && !session.revokedAt && !logicalSession.revokedAt && logicalSession.riskStatus !== 'compromised' && session.expiresAt > new Date()) {
        const account = getAccountByHandle(session.handle)
        return account && getSeedAccountLifecycle(account).status === 'active' ? account : null
      }
      const account = seedStore.demoAccountByRefreshToken.get(token) ?? null
      return account && getSeedAccountLifecycle(account).status === 'active' ? account : null
    },
    findDemoAccountByHandle: (handle) => {
      const account = seedStore.demoAccountByHandle.get(handle) ?? null
      return account && getSeedAccountLifecycle(account).status === 'active' ? account : null
    },
    listDemoAccounts: () => seedStore.demoAccounts,
    issueSession: (account, clientContext) => issueSession(account, { clientContext }),
    registerEmailAccount,
    verifyPasswordCredentials,
    loginWithPassword,
    createOAuthAuthorizationRequest,
    consumeOAuthAuthorizationRequest,
    completeOAuthLogin,
    listOAuthAccounts,
    unlinkOAuthAccount,
    rotateSession: (token, clientContext) => {
      const session = sessionByRefreshToken.get(token)
      if (session?.revokedAt && session.replacedByToken) {
        const now = new Date()
        for (const [refreshToken, candidate] of sessionByRefreshToken.entries()) {
          if (candidate.familyId === session.familyId) {
            sessionByRefreshToken.set(refreshToken, { ...candidate, revokedAt: candidate.revokedAt ?? now, reuseDetectedAt: now })
          }
        }
        const logicalSession = authSessionById.get(session.familyId)
        if (logicalSession) {
          authSessionById.set(session.familyId, {
            ...logicalSession,
            riskStatus: 'compromised',
            riskReasonCode: 'refresh_token_reuse',
            riskDetectedAt: now,
            revokedAt: logicalSession.revokedAt ?? now,
            revokeReasonCode: logicalSession.revokeReasonCode ?? 'refresh_token_reuse',
            version: logicalSession.version + 1,
            lastSeenAt: now,
          })
        }
        recordAudit(getAccountByHandle(session.handle), 'auth.session.reuse_detected', 'auth_session', session.id, { familyId: session.familyId })
        return null
      }
      const logicalSession = session ? authSessionById.get(session.familyId) : null
      const handle = session && logicalSession && !session.revokedAt && !logicalSession.revokedAt && logicalSession.riskStatus !== 'compromised' && session.expiresAt > new Date() && logicalSession.expiresAt > new Date()
        ? session.handle
        : seedStore.demoAccountByRefreshToken.get(token)?.handle ?? null
      if (!handle) {
        return null
      }
      const account = getAccountByHandle(handle)
      const next = account ? issueSession(account, { sessionId: session?.familyId, clientContext }) : null
      if (session && next) {
        sessionByRefreshToken.set(token, { ...session, revokedAt: new Date(), replacedByToken: next.refreshToken })
      }
      return next
    },
    revokeSession: (token, reasonCode = 'user_logout') => {
      const session = sessionByRefreshToken.get(token)
      if (session) {
        const now = new Date()
        for (const [candidateToken, candidate] of sessionByRefreshToken.entries()) {
          if (candidate.familyId === session.familyId && !candidate.revokedAt) {
            sessionByRefreshToken.set(candidateToken, { ...candidate, revokedAt: now })
          }
        }
        const logicalSession = authSessionById.get(session.familyId)
        if (logicalSession && !logicalSession.revokedAt) {
          authSessionById.set(session.familyId, { ...logicalSession, revokedAt: now, revokeReasonCode: reasonCode, version: logicalSession.version + 1 })
        }
      }
      return true
    },
    listSessions: (actor, currentSessionId = null) =>
      [...authSessionById.values()]
        .filter((session) => getAccountByHandle(session.handle)?.id === actor.id)
        .sort((left, right) => right.lastSeenAt.getTime() - left.lastSeenAt.getTime())
        .map((session) => ({ ...getSessionDto(session), current: session.id === currentSessionId })),
    revokeSessionById: (id, actor) => {
      const logicalSession = authSessionById.get(id)
      if (logicalSession && getAccountByHandle(logicalSession.handle)?.id === actor.id && !logicalSession.revokedAt) {
        const now = new Date()
        for (const [token, session] of sessionByRefreshToken.entries()) {
          if (session.familyId === id && !session.revokedAt) sessionByRefreshToken.set(token, { ...session, revokedAt: now })
        }
        authSessionById.set(id, { ...logicalSession, revokedAt: now, revokeReasonCode: 'user_revoked', version: logicalSession.version + 1 })
        recordAudit(actor, 'auth.session.revoked', 'auth_session', id, { reasonCode: 'user_revoked' })
        return true
      }
      return false
    },
    revokeAllSessions: (actor) => {
      let revoked = 0
      const now = new Date()
      for (const [id, session] of authSessionById.entries()) {
        if (getAccountByHandle(session.handle)?.id === actor.id && !session.revokedAt) {
          authSessionById.set(id, { ...session, revokedAt: now, revokeReasonCode: 'user_revoked_all', version: session.version + 1 })
          revoked += 1
        }
      }
      for (const [token, session] of sessionByRefreshToken.entries()) {
        if (getAccountByHandle(session.handle)?.id === actor.id && !session.revokedAt) sessionByRefreshToken.set(token, { ...session, revokedAt: now })
      }
      recordAudit(actor, 'auth.sessions.revoked_all', 'user', actor.id, { reasonCode: 'user_revoked_all', revoked })
      return { revoked }
    },
  },
  compliance: {
    getConsentStatus: (actor) => buildConsentStatus(policyConsentByUserId.get(actor.id) ?? null),
    recordConsent: (actor, consent) => {
      const current = policyConsentByUserId.get(actor.id) ?? null
      const currentStatus = buildConsentStatus(current)
      if (currentStatus.current) {
        return currentStatus
      }
      const acceptedAt = new Date().toISOString()
      const record = { ...consent, acceptedAt }
      policyConsentByUserId.set(actor.id, record)
      recordAudit(
        actor,
        compliancePolicyManifest.consentContract.recordAction,
        compliancePolicyManifest.consentContract.recordResourceType,
        actor.id,
        record,
      )
      return buildConsentStatus(record)
    },
  },
  tasks: {
    workflow: (id, actor) => {
      const task = getActiveTaskById(id)
      if (!task) return null
      const proposals = taskProposals.filter((entry) => entry.taskId === String(task.id))
      const submissions = taskSubmissions.filter((entry) => entry.taskId === String(task.id))
      const latestSubmission = submissions[0] ?? null
      return taskWorkflowDto({
        taskId: task.id,
        status: task.status,
        disputeStatus: task.disputeStatus ?? null,
        actorHandle: actor.handle,
        publisherHandle: getHandle(task.publisher),
        assigneeHandle: getHandle(task.assignee),
        hasProposal: proposals.some((entry) => entry.proposerHandle === actor.handle),
        latestSubmissionStatus: latestSubmission?.status ?? null,
        latestSubmitterHandle: latestSubmission?.submitterHandle ?? null,
        version: task.version,
        cancelledAt: task.cancelledAt ?? null,
        expiredAt: task.expiredAt ?? null,
        terminalReasonCode: task.terminalReasonCode ?? null,
        admin: hasPermission(actor, 'admin:access'),
      })
    },
    listDeliveryTargets: (actor) => seedStore.tasks
      .filter((task) => !task.archivedAt)
      .filter((task) => getHandle(task.assignee) === actor.handle)
      .filter((task) => ['In Progress', 'Rejected'].includes(task.status))
      .map((task) => ({ id: String(task.id), title: task.title, status: task.status, category: task.category })),
    list: (options = {}) => {
      const search = options.search ? options.search.toLowerCase() : null
      const filtered = seedStore.tasks.filter((task) => {
        if (task.archivedAt) return false
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
      const task = getActiveTaskById(id)
      return task ? serializeTask(task) : null
    },
    findAccessibleChatContext: (id, actor) => {
      const task = getActiveTaskById(id)
      if (!task) return null
      const privateTask = task.visibility === 'private'
      const participant = [getHandle(task.publisher), getHandle(task.assignee)].includes(actor.handle)
      if (privateTask && !participant) return null
      return {
        title: task.title,
        content: [task.description, ...(task.requirements ?? [])].filter(Boolean).join('\n'),
      }
    },
    create: async (payload, actor) => {
      const governedPayload = await applyPublishedTaskRule({ payload, repository: configResources })
      const id = String(seedStore.tasks.length + 1)
      const task = buildTaskViewModel({
        id: Number(id),
        title: governedPayload.title,
        category: governedPayload.category,
        status: 'Open',
        budget: makeBudget(governedPayload),
        deadline: governedPayload.deadlineAt ?? 'TBD',
        pointsReward: governedPayload.pointsReward,
        proposals: 0,
        description: governedPayload.description,
        publisher: actor.handle,
        assignee: 'Unassigned',
        requirements: [governedPayload.acceptanceRules],
        attachments: governedPayload.attachmentIds ?? [],
        taskRule: governedPayload.taskRule,
        privateBrief: '',
        submission: 'No submission yet.',
        resultLinks: [],
        reviewNote: '',
        rights: '',
      })
      seedStore.tasks.push(task)
      seedStore.taskById.set(Number(id), task)
      createTaskEscrow(task, actor.handle)
      await domainEvents.enqueue(taskCreatedEvent({ task: { ...task, status: 'open', category: task.category }, publisherId: actor.id, correlationId: `task-create:${task.id}`, actor }))
      recordAudit(actor, 'task.created', 'task', task.id, { status: 'open', category: governedPayload.category, taskRule: governedPayload.taskRule })
      return serializeTask(task)
    },
    claim: (id, actor) => {
      const current = getActiveTaskById(id)
      if (!current) return null
      if (current.status !== 'Open' || getHandle(current.assignee) !== null) {
        if (getHandle(current.assignee) === actor.handle && current.status === 'In Progress') {
          return serializeTask(current)
        }
        throw new HttpError(409, 'TASK_NOT_CLAIMABLE', 'Task is not currently eligible to be claimed')
      }
      if (getHandle(current.publisher) === actor.handle) {
        throw new HttpError(409, 'TASK_SELF_ASSIGNMENT_NOT_ALLOWED', 'Publishers cannot claim their own tasks')
      }
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
      const currentTask = getActiveTaskById(id)
      if (!currentTask) return null
      if (currentTask.status !== 'Open') {
        throw new HttpError(409, 'TASK_NOT_OPEN_FOR_PROPOSALS', 'Task is not open for proposals')
      }
      if (getHandle(currentTask.publisher) === actor.handle) {
        throw new HttpError(409, 'TASK_SELF_PROPOSAL_NOT_ALLOWED', 'Publishers cannot propose on their own tasks')
      }
      const existingProposal = taskProposals.find((entry) =>
        entry.taskId === String(currentTask.id) && entry.proposerHandle === actor.handle,
      )
      if (existingProposal) {
        if (existingProposal.coverLetter === payload.coverLetter && existingProposal.estimate === payload.estimate) {
          return serializeTaskProposal(existingProposal)
        }
        throw new HttpError(409, 'TASK_PROPOSAL_ALREADY_EXISTS', 'A proposal already exists for this creator and task')
      }
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
      const task = getActiveTaskById(id)
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
      const expectedStatus = payload.decision === 'accept' ? 'accepted' : 'rejected'
      if (proposal.status !== 'pending') {
        if (proposal.status === expectedStatus) return serializeTaskProposal(proposal)
        throw new HttpError(409, 'TASK_PROPOSAL_ALREADY_DECIDED', 'Proposal already has a different decision')
      }
      const currentTask = getActiveTaskById(id)
      if (!currentTask || currentTask.status !== 'Open') {
        throw new HttpError(409, 'TASK_PROPOSAL_NOT_REVIEWABLE', 'Task is not open for proposal review')
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
      proposal.status = expectedStatus
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
      const currentTask = getActiveTaskById(id)
      if (currentTask && !canAccessOwnedResource(getHandle(currentTask.assignee), actor)) return null
      if (!currentTask) return null
      const latestSubmission = taskSubmissions.find((entry) =>
        entry.taskId === String(currentTask.id) && entry.submitterHandle === actor.handle,
      ) ?? null
      if (currentTask.status === 'Pending Review' && latestSubmission?.status === 'pending_review') {
        const samePayload = latestSubmission.content === payload.content &&
          latestSubmission.rightsNote === (payload.rightsNote ?? '') &&
          JSON.stringify(latestSubmission.assetIds ?? []) === JSON.stringify(payload.assetIds ?? [])
        if (samePayload) return serializeTask(currentTask)
        throw new HttpError(409, 'TASK_SUBMISSION_ALREADY_PENDING', 'A different submission is already pending review')
      }
      const directOpenSubmission = currentTask.status === 'Open' && !getHandle(currentTask.assignee) && getHandle(currentTask.publisher) !== actor.handle
      const disputeClosed = currentTask.disputeStatus === 'rejected'
      if ((!directOpenSubmission && !['In Progress', 'Rejected'].includes(currentTask.status)) || disputeClosed) {
        throw new HttpError(409, 'TASK_NOT_SUBMITTABLE', 'Task is not currently eligible for submission')
      }
      const resolvedAssets = resolveCreativeDeliveryAssets({
        assetIds: payload.assetIds,
        assets: (payload.assetIds ?? []).map((assetId) => mediaAssetsById.get(String(assetId))).filter(Boolean),
        generations: [...creativeGenerationsById.values()],
        actor,
        target: 'task_submission',
      })
      const task = updateTask(id, (task) => ({
        ...task,
        status: 'Pending Review',
        assignee: getHandle(task.assignee) ?? actor.handle,
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
          metadata: { assetEvidence: resolvedAssets.map((item) => item.evidence) },
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
      const task = getActiveTaskById(id)
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
      const task = getActiveTaskById(id)
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
        .sort((left, right) => {
          const createdDifference = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
          return createdDifference || right.id.localeCompare(left.id)
        })
        .map((event) => serializeTaskTimelineItem(event, task.id))
      return paginateByCursor(items, options)
    },
    createDispute: (id, payload, actor = null) => {
      const task = getActiveTaskById(id)
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
      if (submission.status === 'disputed') {
        if (submission.dispute?.reason === payload.reason) return serializeTask(task)
        throw new HttpError(409, 'TASK_DISPUTE_ALREADY_OPEN', 'A dispute is already open for this submission')
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
            createdAt <= cutoff &&
            (!payload.taskId || submission.taskId === String(payload.taskId))
        })
        .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
        .slice(0, payload.limit)
      for (const submission of staleRows) {
        const task = getActiveTaskById(submission.taskId)
        if (!task) continue
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
      if (!previousTask) return null
      const pendingSubmission = taskSubmissions.find((entry) => entry.taskId === String(previousTask.id) && entry.status === 'pending_review')
      if (!pendingSubmission) {
        const expectedTaskStatus = isApproval ? 'Completed' : isRevisionRequest ? 'In Progress' : 'Rejected'
        const sameDecision = previousTask.status === expectedTaskStatus &&
          previousTask.reviewNote === payload.reviewNote &&
          JSON.stringify(previousTask.acceptanceChecklist ?? []) === JSON.stringify(payload.acceptanceChecklist ?? [])
        if (sameDecision) return serializeTask(previousTask)
        throw new HttpError(409, 'TASK_NOT_REVIEWABLE', 'Task has no submission pending review')
      }
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
        if (postStatus(post) !== 'published' || postModerationState(post) === 'hidden') return false
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
      if (!post || !canViewPost(post, viewer)) {
        return null
      }
      return serializePostDetail({
        ...post,
        comments: getPostComments(id).filter((comment) => (!comment.deletedAt && comment.moderationState !== 'hidden') || hasPermission(viewer, 'post:moderate') || comment.author?.handle === viewer?.handle),
        relatedTasks: [],
        viewerPermissions: buildViewerPermissions(viewer, post),
      })
    },
    listMine: (options = {}, actor) => {
      const filtered = seedStore.posts.filter((post) => (
        postOwnerHandle(post) === actor.handle
        && (options.status === 'all' || postStatus(post) === options.status)
      ))
      const sorted = [...filtered]
        .sort((left, right) => String(right.updatedAt ?? right.createdAt ?? right.id).localeCompare(String(left.updatedAt ?? left.createdAt ?? left.id)))
        .map(serializePost)
      return paginateByCursor(sorted, options)
    },
    create: (payload, actor) => {
      const author = getAccountByHandle(actor.handle)
      if (!author) {
        return null
      }
      const id = String(seedStore.posts.length + 1)
      const now = new Date().toISOString()
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
        status: payload.status,
        version: 1,
        createdAt: now,
        updatedAt: now,
        publishedAt: payload.status === 'published' ? now : null,
        deletedAt: null,
        deletionReasonCode: null,
        moderationState: 'visible',
        moderationVersion: 0,
        moderationUpdatedAt: null,
      }
      seedStore.posts.push(post)
      seedStore.postById.set(Number(id), post)
      recordAudit(actor, payload.status === 'draft' ? 'post.draft_created' : 'post.published', 'post', post.id, { status: payload.status, version: 1 })
      return serializePost(post)
    },
    update: (id, payload, actor) => {
      const post = getPostById(id)
      if (!post || postOwnerHandle(post) !== actor.handle) return null
      if (postStatus(post) === 'deleted') return { deleted: true }
      if ((Number(post.version) || 1) !== payload.expectedVersion) return { conflict: true }
      const next = {
        ...post,
        ...Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'expectedVersion')),
        version: payload.expectedVersion + 1,
        updatedAt: new Date().toISOString(),
      }
      const index = seedStore.posts.findIndex((entry) => Number(entry.id) === Number(id))
      if (index >= 0) seedStore.posts[index] = next
      seedStore.postById.set(Number(id), next)
      recordAudit(actor, 'post.updated', 'post', post.id, { status: postStatus(next), version: next.version })
      return { post: serializePost(next) }
    },
    publish: (id, payload, actor) => {
      const post = getPostById(id)
      if (!post || postOwnerHandle(post) !== actor.handle) return null
      if ((Number(post.version) || 1) !== payload.expectedVersion) return { conflict: true }
      if (postStatus(post) !== 'draft') return { invalidStatus: true }
      const now = new Date().toISOString()
      const next = { ...post, status: 'published', version: payload.expectedVersion + 1, publishedAt: now, updatedAt: now }
      const index = seedStore.posts.findIndex((entry) => Number(entry.id) === Number(id))
      if (index >= 0) seedStore.posts[index] = next
      seedStore.postById.set(Number(id), next)
      recordAudit(actor, 'post.published', 'post', post.id, { version: next.version })
      return { post: serializePost(next) }
    },
    softDelete: (id, payload, actor) => {
      const post = getPostById(id)
      if (!post || postOwnerHandle(post) !== actor.handle) return null
      if ((Number(post.version) || 1) !== payload.expectedVersion) return { conflict: true }
      if (postStatus(post) === 'deleted') return { deleted: true }
      const now = new Date().toISOString()
      const next = {
        ...post,
        status: 'deleted',
        version: payload.expectedVersion + 1,
        deletedAt: now,
        updatedAt: now,
        deletionReasonCode: payload.reasonCode,
      }
      const index = seedStore.posts.findIndex((entry) => Number(entry.id) === Number(id))
      if (index >= 0) seedStore.posts[index] = next
      seedStore.postById.set(Number(id), next)
      recordAudit(actor, 'post.deleted', 'post', post.id, { version: next.version, reasonCode: payload.reasonCode })
      return { post: serializePost(next) }
    },
    restore: (id, payload, actor) => {
      const post = getPostById(id)
      if (!post || postOwnerHandle(post) !== actor.handle) return null
      if ((Number(post.version) || 1) !== payload.expectedVersion) return { conflict: true }
      if (postStatus(post) !== 'deleted') return { invalidStatus: true }
      const next = { ...post, status: 'published', version: payload.expectedVersion + 1, deletedAt: null, deletionReasonCode: null, updatedAt: new Date().toISOString() }
      setSeedPost(next)
      recordAudit(actor, 'post.restored', 'post', post.id, { version: next.version, reasonCode: payload.reasonCode })
      return { post: serializePost(next) }
    },
    comment: (id, payload, actor) => {
      const post = getPostById(id)
      if (!post || postStatus(post) !== 'published' || postModerationState(post) === 'hidden') {
        return null
      }
      const author = getAccountByHandle(actor.handle)
      if (!author) {
        return null
      }
      const comments = ensurePostComments(Number(id))
      const comment = {
        id: `comment-${randomUUID()}`,
        body: payload.body,
        author: {
          handle: author.handle,
          name: { en: author.displayName, zh: author.displayName },
          role: { en: author.role, zh: author.role },
          lane: author.profile?.lane ?? 'both',
          initials: author.displayName.slice(0, 2).toUpperCase(),
        },
        parentId: payload.parentId ?? null,
        moderationState: 'visible',
        moderationVersion: 0,
        moderationUpdatedAt: null,
        version: 1,
        updatedAt: new Date().toISOString(),
        deletedAt: null,
        deletionReasonCode: null,
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
    updateComment: (id, commentId, payload, actor) => {
      const comment = getPostComments(id).find((item) => String(item.id) === String(commentId))
      if (!comment || comment.author?.handle !== actor.handle) return null
      if ((Number(comment.version) || 1) !== payload.expectedVersion) return { conflict: true }
      if (comment.deletedAt) return { deleted: true }
      Object.assign(comment, { body: payload.body, version: payload.expectedVersion + 1, updatedAt: new Date().toISOString() })
      recordAudit(actor, 'comment.updated', 'comment', comment.id, { version: comment.version })
      return { comment }
    },
    deleteComment: (id, commentId, payload, actor) => {
      const comment = getPostComments(id).find((item) => String(item.id) === String(commentId))
      if (!comment || comment.author?.handle !== actor.handle) return null
      if ((Number(comment.version) || 1) !== payload.expectedVersion) return { conflict: true }
      if (comment.deletedAt) return { deleted: true }
      Object.assign(comment, { deletedAt: new Date().toISOString(), deletionReasonCode: payload.reasonCode, version: payload.expectedVersion + 1, updatedAt: new Date().toISOString() })
      recordAudit(actor, 'comment.deleted', 'comment', comment.id, { version: comment.version, reasonCode: payload.reasonCode })
      return { comment }
    },
    restoreComment: (id, commentId, payload, actor) => {
      const comment = getPostComments(id).find((item) => String(item.id) === String(commentId))
      if (!comment || comment.author?.handle !== actor.handle) return null
      if ((Number(comment.version) || 1) !== payload.expectedVersion) return { conflict: true }
      if (!comment.deletedAt) return { invalidStatus: true }
      Object.assign(comment, { deletedAt: null, deletionReasonCode: null, version: payload.expectedVersion + 1, updatedAt: new Date().toISOString() })
      recordAudit(actor, 'comment.restored', 'comment', comment.id, { version: comment.version, reasonCode: payload.reasonCode })
      return { comment }
    },
    like: (id, actor) => {
      const post = getPostById(id)
      if (!post || postStatus(post) !== 'published' || postModerationState(post) === 'hidden') {
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
      if (!post || postStatus(post) !== 'published' || postModerationState(post) === 'hidden') {
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
      if (!post || postStatus(post) !== 'published' || postModerationState(post) === 'hidden') {
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
        const privacy = getSeedProfilePrivacy(profile.handle)
        const account = getAccountByHandle(profile.handle)
        if (!account) return false
        const lifecycle = account ? getSeedAccountLifecycle(account) : null
        if (privacy.visibility !== 'public' || !privacy.discoverable || lifecycle?.deletionRequestedAt || (account?.status && account.status !== 'active')) return false
        if (options.lane && profile.lane !== options.lane) return false
        if (search) {
          const haystack = `${profile.handle} ${profile.name?.en ?? ''} ${profile.name?.zh ?? ''} ${profile.tags?.join(' ') ?? ''}`.toLowerCase()
          if (!haystack.includes(search)) return false
        }
        return true
      }).map((profile) => projectProfileForViewer({
        profile: { ...getSeedProfilePrivacy(profile.handle), userId: getAccountByHandle(profile.handle)?.id, handle: profile.handle, user: { status: getAccountByHandle(profile.handle)?.status ?? 'active', deletionRequestedAt: getSeedAccountLifecycle(getAccountByHandle(profile.handle)).deletionRequestedAt } },
        publicProfile: { ...serializeProfile(profile), portfolio: getSeedPublicPortfolio(profile.handle) },
      }))
      return paginateByCursor(filtered, { ...options, cursorKey: 'handle' })
    },
    findByHandle: (handle, viewer = null) => {
      const profile = seedStore.profileByHandle.get(handle) ?? null
      if (!profile) return null
      const account = getAccountByHandle(handle)
      const privacy = getSeedProfilePrivacy(handle)
      return projectProfileForViewer({
        profile: { ...privacy, userId: account?.id, handle, user: { status: account?.status ?? 'active', deletionRequestedAt: account ? getSeedAccountLifecycle(account).deletionRequestedAt : null } },
        publicProfile: { ...serializeProfile(profile), portfolio: getSeedPublicPortfolio(handle) },
        viewer,
      })
    },
    getOwn: (actor) => {
      const profile = seedStore.profileByHandle.get(actor.handle) ?? null
      const account = getAccountByHandle(actor.handle)
      if (!profile || !account) return null
      return {
        ...serializeProfile(profile),
        portfolio: getSeedPublicPortfolio(actor.handle),
        privacy: profilePrivacyDto(getSeedProfilePrivacy(actor.handle)),
        account: accountStatusDto(getSeedAccountLifecycle(account)),
      }
    },
    listOwnPortfolio: (actor) => [...portfolioAssetsById.values()]
      .filter((item) => item.ownerHandle === actor.handle)
      .sort((left, right) => left.sortOrder - right.sortOrder || right.createdAt.localeCompare(left.createdAt))
      .map((item) => serializePortfolioAsset(item, mediaAssetsById.get(item.assetId))),
    createPortfolioDraft: (assetId, payload, actor) => {
      const asset = mediaAssetsById.get(String(assetId)) ?? null
      const generation = [...creativeGenerationsById.values()].find((item) => item.outputAssetIds?.includes(String(assetId))) ?? null
      const [resolved] = resolveCreativeDeliveryAssets({ assetIds: [assetId], assets: asset ? [asset] : [], generations: generation ? [generation] : [], actor, target: 'profile_portfolio' })
      if (payload.sourceSubmissionId) {
        const source = taskSubmissions.find((item) => item.id === payload.sourceSubmissionId && item.submitterHandle === actor.handle && item.assetIds?.includes(String(assetId)))
        if (!source) throw new HttpError(409, 'PORTFOLIO_SOURCE_SUBMISSION_INVALID', 'Source submission does not contain this asset')
      }
      const existing = [...portfolioAssetsById.values()].find((item) => item.ownerHandle === actor.handle && item.assetId === String(assetId))
      if (existing) return serializePortfolioAsset(existing, asset)
      const now = new Date().toISOString()
      const item = {
        id: `portfolio-${randomUUID()}`, ownerHandle: actor.handle, assetId: String(assetId),
        sourceGenerationId: resolved.generation.id, sourceSubmissionId: payload.sourceSubmissionId ?? null,
        title: payload.title || asset.fileName, caption: payload.caption ?? '', status: 'draft', sortOrder: 0,
        publishedAt: null, withdrawnAt: null, archivedAt: null, createdAt: now, updatedAt: now,
      }
      portfolioAssetsById.set(item.id, item)
      recordAudit(actor, 'profile.portfolio.draft_created', 'profile_portfolio_asset', item.id, { assetId: item.assetId })
      return serializePortfolioAsset(item, asset)
    },
    updatePortfolioAsset: (id, payload, actor) => {
      const current = portfolioAssetsById.get(String(id)) ?? null
      if (!current || current.ownerHandle !== actor.handle) return null
      const allowed = { publish: ['draft', 'withdrawn'], withdraw: ['published'], archive: ['draft', 'published', 'withdrawn'], restore: ['archived'] }
      if (payload.action && !allowed[payload.action]?.includes(current.status)) {
        throw new HttpError(409, 'PORTFOLIO_TRANSITION_INVALID', `Cannot ${payload.action} a ${current.status} portfolio item`)
      }
      const now = new Date().toISOString()
      const actionState = payload.action === 'publish' ? { status: 'published', publishedAt: now, withdrawnAt: null, archivedAt: null }
        : payload.action === 'withdraw' ? { status: 'withdrawn', withdrawnAt: now }
          : payload.action === 'archive' ? { status: 'archived', archivedAt: now }
            : payload.action === 'restore' ? { status: 'draft', publishedAt: null, withdrawnAt: null, archivedAt: null }
              : {}
      if (payload.action === 'publish') {
        const asset = mediaAssetsById.get(current.assetId)
        const generation = [...creativeGenerationsById.values()].find((item) => item.outputAssetIds?.includes(current.assetId))
        resolveCreativeDeliveryAssets({ assetIds: [current.assetId], assets: asset ? [asset] : [], generations: generation ? [generation] : [], actor, target: 'profile_portfolio' })
      }
      const updated = { ...current, ...actionState, ...(payload.title !== undefined ? { title: payload.title } : {}), ...(payload.caption !== undefined ? { caption: payload.caption } : {}), ...(payload.sortOrder !== undefined ? { sortOrder: payload.sortOrder } : {}), updatedAt: now }
      portfolioAssetsById.set(updated.id, updated)
      recordAudit(actor, `profile.portfolio.${payload.action ?? 'updated'}`, 'profile_portfolio_asset', updated.id, { assetId: updated.assetId })
      return serializePortfolioAsset(updated, mediaAssetsById.get(updated.assetId))
    },
    listRankings: () =>
      seedStore.profiles
        .filter((profile) => {
          const privacy = getSeedProfilePrivacy(profile.handle)
          const account = getAccountByHandle(profile.handle)
          return Boolean(account) && privacy.visibility === 'public' && privacy.discoverable && !getSeedAccountLifecycle(account).deletionRequestedAt
        })
        .map(serializeProfile)
        .sort((left, right) => (right.stats?.score ?? 0) - (left.stats?.score ?? 0)),
    updateOwn: (user, patch) => {
      const current = seedStore.profileByHandle.get(user.handle) ?? null
      const account = getAccountByHandle(user.handle)
      if (!current || !account) {
        return null
      }
      const privacy = getSeedProfilePrivacy(current.handle)
      if (privacy.version !== patch.expectedVersion) throw new HttpError(409, 'PROFILE_VERSION_CONFLICT', 'Profile was updated by another request')
      const nextHandle = patch.handle ?? current.handle
      if (nextHandle !== current.handle && getAccountByHandle(nextHandle)) throw new HttpError(409, 'PROFILE_HANDLE_CONFLICT', 'Handle is already in use')
      const displayName = patch.displayName ?? account.displayName
      const updated = {
        ...current,
        handle: nextHandle,
        name: patch.displayName !== undefined ? { en: displayName, zh: displayName } : current.name,
        bio: patch.bio !== undefined ? { en: patch.bio, zh: patch.bio } : current.bio,
        tags: patch.skills ?? current.tags,
        zhTags: patch.skills ?? current.zhTags,
        languages: patch.languages ?? current.languages,
        lane: patch.lane ?? current.lane,
      }
      const nextPrivacy = {
        ...privacy,
        ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
        ...(patch.discoverable !== undefined ? { discoverable: patch.discoverable } : {}),
        ...(patch.showActivity !== undefined ? { showActivity: patch.showActivity } : {}),
        ...(patch.showPortfolio !== undefined ? { showPortfolio: patch.showPortfolio } : {}),
        version: privacy.version + 1,
        updatedAt: new Date().toISOString(),
      }
      if (nextHandle !== current.handle) {
        seedStore.profileByHandle.delete(current.handle)
        seedStore.demoAccountByHandle.delete(current.handle)
        profilePrivacyByHandle.delete(current.handle)
      }
      seedStore.profileByHandle.set(nextHandle, updated)
      profilePrivacyByHandle.set(nextHandle, nextPrivacy)
      account.handle = nextHandle
      account.displayName = displayName
      account.profile = { ...(account.profile ?? {}), handle: nextHandle, lane: updated.lane }
      seedStore.demoAccountByHandle.set(nextHandle, account)
      const index = seedStore.profiles.findIndex((entry) => entry.handle === current.handle)
      if (index >= 0) {
        seedStore.profiles[index] = updated
      }
      recordAudit(account, 'profile.updated', 'profile', account.id, { fields: Object.keys(patch).filter((key) => key !== 'expectedVersion' && patch[key] !== undefined).sort(), version: nextPrivacy.version })
      return {
        ...serializeProfile(updated), portfolio: getSeedPublicPortfolio(nextHandle),
        privacy: profilePrivacyDto(nextPrivacy), account: accountStatusDto(getSeedAccountLifecycle(account)),
      }
    },
    getAccountStatus: (actor) => {
      const account = getAccountByHandle(actor.handle)
      return account ? accountStatusDto(getSeedAccountLifecycle(account)) : null
    },
    requestDeletion: (actor, payload) => {
      const account = getAccountByHandle(actor.handle)
      if (!account) return null
      const current = getSeedAccountLifecycle(account)
      if (current.accountVersion !== payload.expectedVersion) throw new HttpError(409, 'ACCOUNT_VERSION_CONFLICT', 'Account status was updated by another request')
      if (current.deletionRequestedAt) throw new HttpError(409, 'ACCOUNT_DELETION_ALREADY_REQUESTED', 'Account deletion is already requested')
      const now = new Date()
      const updated = { ...current, accountVersion: current.accountVersion + 1, deletionRequestedAt: now.toISOString(), deletionScheduledAt: deletionSchedule(now).toISOString(), deletionReasonCode: payload.reasonCode }
      accountLifecycleById.set(account.id, updated)
      recordAudit(account, 'account.deletion_requested', 'user', account.id, { reasonCode: payload.reasonCode, scheduledAt: updated.deletionScheduledAt, version: updated.accountVersion })
      return accountStatusDto(updated)
    },
    cancelDeletion: (actor, payload) => {
      const account = getAccountByHandle(actor.handle)
      if (!account) return null
      const current = getSeedAccountLifecycle(account)
      if (current.accountVersion !== payload.expectedVersion) throw new HttpError(409, 'ACCOUNT_VERSION_CONFLICT', 'Account status was updated by another request')
      if (!current.deletionRequestedAt) throw new HttpError(409, 'ACCOUNT_DELETION_NOT_REQUESTED', 'Account deletion is not requested')
      const updated = { ...current, accountVersion: current.accountVersion + 1, deletionRequestedAt: null, deletionScheduledAt: null, deletionReasonCode: null }
      accountLifecycleById.set(account.id, updated)
      recordAudit(account, 'account.deletion_cancelled', 'user', account.id, { reasonCode: payload.reasonCode, version: updated.accountVersion })
      return accountStatusDto(updated)
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
      pointAdjustmentPolicyVersion += 1
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
      pointAdjustmentPolicyVersion += 1
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
  billing: {
    summary: (userHandle) => {
      const account = getAccountByHandle(userHandle)
      if (!account) return null
      const pointRows = seedStore.pointsLedger.filter((entry) => entry.userHandle === userHandle)
      const creditRows = [...creativeCreditLedgerById.values()].filter((entry) => entry.actorHandle === userHandle)
      const now = Date.now()
      const quotaByScope = new Map()
      for (const window of creativeQuotaWindowsById.values()) {
        if (window.actorHandle !== userHandle || new Date(window.windowEnd).getTime() < now) continue
        const key = `${window.workspace}:${window.windowType}`
        const current = quotaByScope.get(key)
        if (!current || new Date(window.windowEnd) > new Date(current.windowEnd)) quotaByScope.set(key, window)
      }
      const scopes = [...quotaByScope.values()].map((window) => ({
        id: window.id,
        workspace: window.workspace,
        windowType: window.windowType,
        limit: window.limitUnits,
        reserved: window.reservedUnits,
        used: window.usedUnits,
        released: window.releasedUnits,
        remaining: Math.max(0, window.limitUnits - window.reservedUnits - window.usedUnits),
        windowStart: new Date(window.windowStart).toISOString(),
        windowEnd: new Date(window.windowEnd).toISOString(),
        policyVersion: window.policyVersion,
      }))
      return {
        schemaVersion: 1,
        userHandle,
        points: buildPointSummary(pointRows, userHandle),
        creativeCredits: {
          reserved: creditRows.filter((row) => row.status === 'reserved').reduce((sum, row) => sum + row.reservationAmount, 0),
          settled: creditRows.reduce((sum, row) => sum + row.settledAmount, 0),
          refunded: creditRows.reduce((sum, row) => sum + row.refundedAmount, 0),
          transactions: creditRows.length,
        },
        quotas: {
          limit: scopes.reduce((sum, row) => sum + row.limit, 0),
          reserved: scopes.reduce((sum, row) => sum + row.reserved, 0),
          used: scopes.reduce((sum, row) => sum + row.used, 0),
          released: scopes.reduce((sum, row) => sum + row.released, 0),
          remaining: scopes.reduce((sum, row) => sum + row.remaining, 0),
          scopes,
        },
        generatedAt: new Date().toISOString(),
      }
    },
    listLedger: (userHandle) => {
      if (!getAccountByHandle(userHandle)) return null
      return [
        ...seedStore.pointsLedger.filter((row) => row.userHandle === userHandle).map((row) => ({
          id: `points:${row.id}`,
          unit: 'points', status: row.status, amount: Number(row.delta), balanceAfter: Number(row.balanceAfter),
          sourceType: row.sourceType ?? 'legacy_points', sourceId: row.sourceId ?? null, description: row.description ?? row.sourceType ?? 'Points entry',
          reasonCode: null, workspace: null, occurredAt: new Date(row.createdAt ?? 0).getTime() > 0 ? new Date(row.createdAt).toISOString() : new Date(0).toISOString(),
        })),
        ...[...creativeCreditLedgerById.values()].filter((row) => row.actorHandle === userHandle).map((row) => ({
          id: `creative_credit:${row.id}`,
          unit: 'creative_credit', status: row.status,
          amount: row.status === 'reserved' ? -row.reservationAmount : row.status === 'settled' ? -row.settledAmount : row.refundedAmount,
          balanceAfter: null, sourceType: 'generation', sourceId: row.generationId,
          description: `Creative ${row.workspace} ${row.mode}`, reasonCode: row.reasonCode ?? null, workspace: row.workspace,
          occurredAt: new Date(row.refundedAt ?? row.cancelledAt ?? row.settledAt ?? row.reservedAt).toISOString(),
        })),
        ...[...creativeQuotaReservationsById.values()].filter((row) => row.actorHandle === userHandle).map((row) => ({
          id: `quota_unit:${row.id}`,
          unit: 'quota_unit', status: row.status, amount: row.status === 'released' ? row.units : -row.units,
          balanceAfter: null, sourceType: 'generation', sourceId: row.generationId,
          description: `Creative ${row.workspace} quota`, reasonCode: row.reason ?? null, workspace: row.workspace,
          occurredAt: new Date(row.releasedAt ?? row.committedAt ?? row.reservedAt).toISOString(),
        })),
      ]
    },
  },
  accountingReconciliation: {
    scan: (_actor, options = {}) => {
      const report = scanSeedAccounting()
      const filtered = report.issues
        .filter((issue) => !options.status || issue.status === options.status)
        .filter((issue) => !options.unit || issue.unit === options.unit)
        .filter((issue) => !options.type || issue.type === options.type)
      return {
        ...report,
        issues: paginateByCursor(filtered, options),
      }
    },
    list: (options = {}) => {
      const report = scanSeedAccounting()
      const filtered = report.issues
        .filter((issue) => !options.status || issue.status === options.status)
        .filter((issue) => !options.unit || issue.unit === options.unit)
        .filter((issue) => !options.type || issue.type === options.type)
      return { ...paginateByCursor(filtered, options), summary: report.summary, generatedAt: report.generatedAt }
    },
    find: (id) => {
      scanSeedAccounting()
      const issue = [...accountingReconciliationIssuesByKey.values()].find((item) => item.id === String(id)) ?? null
      return issue ? serializeAccountingIssue(issue) : null
    },
    requestRepair: (id, payload, actor) => {
      scanSeedAccounting()
      const issue = [...accountingReconciliationIssuesByKey.values()].find((item) => item.id === String(id)) ?? null
      if (!issue) return null
      if (!['open', 'repair_pending'].includes(issue.status)) {
        throw new HttpError(409, 'ACCOUNTING_ISSUE_NOT_REPAIRABLE', 'Only open accounting issues can request repair')
      }
      const supported = (issue.type === 'point_balance_drift' && issue.sourceType === 'internal_point_account') ||
        (issue.type === 'quota_state_mismatch' && issue.sourceType === 'creative_quota_window')
      if (!supported) {
        throw new HttpError(409, 'ACCOUNTING_REPAIR_UNSUPPORTED', 'This issue requires manual investigation and cannot be compensated automatically')
      }
      const reviewId = `review-accounting-${issue.id}`
      const existingReview = adminReviewById.get(reviewId)
      if (existingReview) {
        return { issue: serializeAccountingIssue(issue), review: serializeAdminReview(existingReview) }
      }
      const now = new Date().toISOString()
      const review = {
        id: reviewId,
        queue: 'accounting_reconciliation',
        status: 'Pending review',
        title: `Accounting repair: ${issue.type}`,
        owner: actor.handle,
        note: safeErrorPreview(payload.reason),
        decision: undefined,
        reviewedBy: null,
        reviewedAt: null,
        metadata: {
          kind: 'accounting_compensation',
          issueId: issue.id,
          issueKey: issue.issueKey,
          repairKind: payload.repairKind,
          reasonCode: payload.reasonCode,
          requestedBy: actor.handle,
        },
        createdAt: now,
        updatedAt: now,
      }
      const updatedIssue = { ...issue, status: 'repair_pending', reviewedAt: now, updatedAt: now }
      accountingReconciliationIssuesByKey.set(issue.issueKey, updatedIssue)
      adminReviewQueue.unshift(review)
      adminReviewById.set(review.id, review)
      recordAudit(actor, 'accounting.repair.requested', 'accounting_reconciliation_issue', issue.id, {
        reviewId,
        issueKey: issue.issueKey,
        repairKind: payload.repairKind,
        reasonCode: payload.reasonCode,
      })
      return { issue: serializeAccountingIssue(updatedIssue), review: serializeAdminReview(review) }
    },
    reviewRepair: (reviewId, action, actor) => {
      const review = adminReviewById.get(String(reviewId)) ?? null
      const metadata = review?.metadata ?? {}
      if (!review || metadata.kind !== 'accounting_compensation') return null
      const issue = [...accountingReconciliationIssuesByKey.values()].find((item) => item.id === metadata.issueId) ?? null
      if (!issue) return null
      if (review.decision) {
        return { review: serializeAdminReview(review), issue: serializeAccountingIssue(issue), compensation: null }
      }
      const reviewedAt = new Date().toISOString()
      if (action.decision === 'reject') {
        const rejectedReview = {
          ...review,
          status: 'Rejected',
          decision: 'reject',
          note: action.note || review.note,
          reviewedBy: actor.handle,
          reviewedAt,
          updatedAt: reviewedAt,
        }
        const reopenedIssue = { ...issue, status: 'open', reviewedAt, updatedAt: reviewedAt }
        adminReviewById.set(review.id, rejectedReview)
        const reviewIndex = adminReviewQueue.findIndex((item) => item.id === review.id)
        if (reviewIndex >= 0) adminReviewQueue[reviewIndex] = rejectedReview
        accountingReconciliationIssuesByKey.set(issue.issueKey, reopenedIssue)
        recordAudit(actor, 'accounting.repair.rejected', 'accounting_reconciliation_issue', issue.id, { reviewId: review.id })
        return { review: serializeAdminReview(rejectedReview), issue: serializeAccountingIssue(reopenedIssue), compensation: null }
      }

      let movements
      let repairPayload
      let applySnapshot = () => {}
      if (issue.type === 'point_balance_drift' && issue.sourceType === 'internal_point_account') {
        const account = [...internalPointAccountsByHandle.values()].find((item) => item.id === issue.sourceId)
        if (!account || account.balance !== issue.actualAmount) {
          throw new HttpError(409, 'ACCOUNTING_REPAIR_STALE', 'Point account changed after the issue was detected; scan again')
        }
        const delta = Number(issue.expectedAmount) - account.balance
        if (!Number.isSafeInteger(delta) || delta === 0) {
          throw new HttpError(409, 'ACCOUNTING_REPAIR_STALE', 'Point account no longer requires compensation')
        }
        movements = [
          { unit: 'points', accountRef: 'system:reconciliation:points:source', accountType: 'system_source', amount: -delta },
          { unit: 'points', accountRef: `user:${account.userHandle}:points:available`, accountType: 'available', ownerHandle: account.userHandle, amount: delta },
        ]
        repairPayload = { issueId: issue.id, accountId: account.id, userHandle: account.userHandle, delta }
      } else if (issue.type === 'quota_state_mismatch' && issue.sourceType === 'creative_quota_window') {
        const window = creativeQuotaWindowsById.get(issue.sourceId)
        if (!window || window.reservedUnits + window.usedUnits !== issue.actualAmount) {
          throw new HttpError(409, 'ACCOUNTING_REPAIR_STALE', 'Quota window changed after the issue was detected; scan again')
        }
        const reservations = [...creativeQuotaReservationsById.values()].filter((reservation) => reservation.quotaWindowId === window.id)
        const expectedReserved = reservations.filter((reservation) => reservation.status === 'reserved').reduce((sum, reservation) => sum + reservation.units, 0)
        const expectedUsed = reservations.filter((reservation) => reservation.status === 'committed').reduce((sum, reservation) => sum + reservation.units, 0)
        const expectedReleased = reservations.filter((reservation) => reservation.status === 'released').reduce((sum, reservation) => sum + reservation.units, 0)
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
        repairPayload = { issueId: issue.id, windowId: window.id, reservedDelta, usedDelta, remainingDelta, expectedReleased }
        applySnapshot = () => creativeQuotaWindowsById.set(window.id, {
          ...window,
          reservedUnits: expectedReserved,
          usedUnits: expectedUsed,
          releasedUnits: expectedReleased,
          updatedAt: reviewedAt,
        })
      } else {
        throw new HttpError(409, 'ACCOUNTING_REPAIR_UNSUPPORTED', 'This issue cannot be compensated automatically')
      }
      const applied = applySeedAccountingOperation({
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
      applySnapshot()
      const repairOperationKey = applied.operation.operationKey
      const resolvedIssue = { ...issue, status: 'resolved', repairOperationKey, reviewedAt, resolvedAt: reviewedAt, updatedAt: reviewedAt }
      const approvedReview = {
        ...review,
        status: 'Approved',
        decision: 'approve',
        note: action.note || review.note,
        reviewedBy: actor.handle,
        reviewedAt,
        updatedAt: reviewedAt,
        metadata: { ...metadata, repairOperationKey, approvedBy: actor.handle },
      }
      accountingReconciliationIssuesByKey.set(issue.issueKey, resolvedIssue)
      adminReviewById.set(review.id, approvedReview)
      const reviewIndex = adminReviewQueue.findIndex((item) => item.id === review.id)
      if (reviewIndex >= 0) adminReviewQueue[reviewIndex] = approvedReview
      return {
        review: serializeAdminReview(approvedReview),
        issue: serializeAccountingIssue(resolvedIssue),
        compensation: {
          operationKey: repairOperationKey,
          unit: applied.operation.unit,
          kind: applied.operation.kind,
          status: applied.operation.status,
          reasonCode: applied.operation.reasonCode,
        },
      }
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
    recordAttempt: ({ actor, action, resourceType, resourceId, metadata }) =>
      serializeAuditEvent(recordAudit(actor, action, resourceType, resourceId, metadata)),
    find: (id) => {
      const event = auditEvents.find((item) => item.id === String(id)) ?? null
      return event ? serializeAuditEvent(event) : null
    },
    list: (options = {}) => {
      const filtered = auditEvents.filter((event) => {
        if (options.action && event.action !== options.action) return false
        if (options.resourceType && event.resourceType !== options.resourceType) return false
        if (options.resourceId && event.resourceId !== options.resourceId) return false
        if (options.actorType && event.actorType !== options.actorType) return false
        if (options.actorId && event.actorId !== options.actorId) return false
        if (options.dateFrom && Date.parse(event.createdAt) < Date.parse(options.dateFrom)) return false
        if (options.dateTo && Date.parse(event.createdAt) > Date.parse(options.dateTo)) return false
        return true
      })
      const ordered = options.direction === 'asc' ? [...filtered].reverse() : filtered
      return paginateByCursor(ordered.map(serializeAuditEvent), options)
    },
    verify: () => verifySeedAuditChain(auditEvents, { anchor: auditRetentionDispositions[0] ?? null }),
    export: (options = {}) => {
      const events = auditEvents
        .filter((event) => {
          if (options.action && event.action !== options.action) return false
          if (options.resourceType && event.resourceType !== options.resourceType) return false
          if (options.resourceId && event.resourceId !== options.resourceId) return false
          if (options.actorType && event.actorType !== options.actorType) return false
          if (options.actorId && event.actorId !== options.actorId) return false
          if (options.dateFrom && Date.parse(event.createdAt) < Date.parse(options.dateFrom)) return false
          if (options.dateTo && Date.parse(event.createdAt) > Date.parse(options.dateTo)) return false
          return true
        })
        .sort((left, right) => options.direction === 'asc'
          ? Number(left.sequence) - Number(right.sequence)
          : Number(right.sequence) - Number(left.sequence))
        .slice(0, options.limit ?? 100)
        .map(serializeAuditEvent)
      return buildPortableAuditExport({ events, query: options })
    },
    archive: ({ actor, objectRef = null } = {}) => {
      const result = createSeedArchiveManifest({ events: auditEvents, actor, objectRef, anchor: auditRetentionDispositions[0] ?? null })
      if (result.manifest) auditArchiveManifests.unshift(result.manifest)
      return result
    },
    listArchives: () => [...auditArchiveManifests],
    retentionPreview: (policy, now = new Date()) => {
      const result = buildAuditRetentionPreview({ events: auditEvents, policy, now })
      return { ...result, artifact: buildAuditRetentionArtifact(result) }
    },
    pruneRetention: ({ actor, policy, previewId, archive, now = new Date() }) => {
      const result = buildAuditRetentionPreview({ events: auditEvents, policy, now })
      if (!result.preview.executable) return { status: 'disabled', preview: result.preview, disposition: null }
      if (result.preview.previewId !== previewId) return { status: 'preview_mismatch', preview: result.preview, disposition: null }
      if (!archive?.persisted || !archive.storageKey || !archive.checksumSha256 || !archive.bytes) {
        return { status: 'archive_not_durable', preview: result.preview, disposition: null }
      }
      const candidateIds = new Set(result.candidates.map((event) => event.id))
      for (let index = auditEvents.length - 1; index >= 0; index -= 1) {
        if (candidateIds.has(auditEvents[index].id)) auditEvents.splice(index, 1)
      }
      const id = createRetentionDispositionId()
      const disposition = {
        id,
        policyVersion: policy.version,
        cutoffAt: result.preview.cutoffAt,
        fromSequence: result.preview.fromSequence,
        toSequence: result.preview.toSequence,
        eventCount: result.preview.candidateCount,
        rootHash: result.preview.rootHash,
        archiveRef: `audit-retention://${id}`,
        archiveChecksumSha256: archive.checksumSha256,
        archiveBytes: archive.bytes,
        archiveProvider: archive.provider,
        actorId: actor?.id ?? null,
        createdAt: now.toISOString(),
      }
      auditRetentionDispositions.unshift(disposition)
      return { status: 'complete', preview: result.preview, disposition }
    },
    listRetentionDispositions: () => [...auditRetentionDispositions].slice(0, 20),
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
  domainEvents,
  domainEventConsumers,
  jobs,
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
    listPermissions: () => permissionRegistry.map(({ defaultRoles: _defaultRoles, ...permission }) => ({ ...permission })),
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
      if (current) {
        for (const sourceAssetId of current.inputAssetIds ?? []) {
          for (const targetAssetId of assetIds.filter(Boolean)) {
            const source = mediaAssetsById.get(String(sourceAssetId))
            const target = mediaAssetsById.get(String(targetAssetId))
            if (!source || !target || source.ownerHandle !== target.ownerHandle) continue
            const relationTypes = current.workspace === 'image' && ['image_to_image', 'image_edit', 'image_variation'].includes(current.mode)
              ? ['reused_as_input', 'variant'] : ['reused_as_input']
            for (const relationType of relationTypes) {
              const exists = [...mediaAssetRelationsById.values()].some((relation) => relation.sourceAssetId === source.id && relation.targetAssetId === target.id && relation.relationType === relationType && relation.targetWorkspace === current.workspace)
              if (!exists) {
                const relationId = `asset-relation-${randomUUID()}`
                mediaAssetRelationsById.set(relationId, { id: relationId, ownerHandle: source.ownerHandle, sourceAssetId: source.id, targetAssetId: target.id, relationType, sourceGenerationId: current.id, targetWorkspace: current.workspace, role: relationType === 'variant' ? 'source' : 'input', createdAt: new Date().toISOString() })
              }
            }
          }
        }
      }
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
    listPollingCandidates: (options = {}) => {
      const limit = Math.max(1, options.limit ?? 10)
      const statuses = new Set((options.statuses ?? ['queued', 'running']).map(String))
      const providerIds = new Set((options.providerIds ?? []).map(String))
      const items = [...creativeGenerationsById.values()]
        .filter((record) => statuses.has(record.status))
        .filter((record) => !options.providerMode || record.providerMode === String(options.providerMode))
        .filter((record) => providerIds.size === 0 || providerIds.has(record.providerId))
        .sort((left, right) => {
          const createdDifference = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
          return createdDifference || left.id.localeCompare(right.id)
        })
        .slice(0, limit)
        .map(serializeCreativeGeneration)
      return { items, limit }
    },
    list: (options = {}) => {
      const filtered = [...creativeGenerationsById.values()]
        .filter((record) => (!options.actorHandle && !options.actorId) ||
          record.actorHandle === options.actorHandle || record.actorId === options.actorId)
        .filter((record) => !options.workspace || record.workspace === options.workspace)
        .filter((record) => !options.mode || record.mode === options.mode)
        .filter((record) => !options.providerId || record.providerId === options.providerId)
        .filter((record) => !options.status || record.status === options.status)
        .filter((record) => options.reviewRequired == null || Boolean(record.safety?.reviewRequired) === options.reviewRequired)
        .filter((record) => !options.mediaAssetId || (record.outputAssetIds ?? []).includes(options.mediaAssetId))
        .filter((record) => !options.dateFrom || new Date(record.createdAt).getTime() >= new Date(options.dateFrom).getTime())
        .filter((record) => !options.dateTo || new Date(record.createdAt).getTime() <= new Date(options.dateTo).getTime())
        .sort((left, right) => {
          const field = options.sort ?? 'createdAt'
          const direction = options.direction === 'asc' ? 1 : -1
          const leftValue = field === 'status' ? left.status : new Date(left[field] ?? left.createdAt).getTime()
          const rightValue = field === 'status' ? right.status : new Date(right[field] ?? right.createdAt).getTime()
          const comparison = typeof leftValue === 'string' ? leftValue.localeCompare(rightValue) : leftValue - rightValue
          return comparison * direction || left.id.localeCompare(right.id) * direction
        })
        .map(serializeCreativeGeneration)
      return paginateByCursor(filtered, options)
    },
    summarize: (options = {}) => {
      const rows = [...creativeGenerationsById.values()]
        .filter((record) => !options.actorHandle || record.actorHandle === options.actorHandle)
        .filter((record) => !options.workspace || record.workspace === options.workspace)
        .filter((record) => !options.mode || record.mode === options.mode)
        .filter((record) => !options.providerId || record.providerId === options.providerId)
        .filter((record) => !options.status || record.status === options.status)
        .filter((record) => options.reviewRequired == null || Boolean(record.safety?.reviewRequired) === options.reviewRequired)
        .filter((record) => !options.mediaAssetId || (record.outputAssetIds ?? []).includes(options.mediaAssetId))
        .filter((record) => !options.dateFrom || new Date(record.createdAt).getTime() >= new Date(options.dateFrom).getTime())
        .filter((record) => !options.dateTo || new Date(record.createdAt).getTime() <= new Date(options.dateTo).getTime())
      const countBy = (field) => Object.fromEntries([...new Set(rows.map((row) => row[field]))].sort().map((value) => [value, rows.filter((row) => row[field] === value).length]))
      return {
        total: rows.length,
        active: rows.filter((row) => ['queued', 'running'].includes(row.status)).length,
        failed: rows.filter((row) => row.status === 'failed').length,
        reviewRequired: rows.filter((row) => row.status === 'review_required' || row.safety?.reviewRequired).length,
        outputAssets: rows.reduce((sum, row) => sum + (row.outputAssetIds?.length ?? 0), 0),
        byStatus: countBy('status'),
        byWorkspace: countBy('workspace'),
        byProvider: countBy('providerId'),
      }
    },
    businessMetrics: (options = {}) => {
      const generations = [...creativeGenerationsById.values()]
        .filter((record) => !options.actorHandle || record.actorHandle === options.actorHandle)
        .filter((record) => !options.workspace || record.workspace === options.workspace)
        .filter((record) => !options.mode || record.mode === options.mode)
        .filter((record) => !options.providerId || record.providerId === options.providerId)
        .filter((record) => !options.status || record.status === options.status)
        .filter((record) => options.reviewRequired == null || Boolean(record.safety?.reviewRequired) === options.reviewRequired)
        .filter((record) => !options.mediaAssetId || (record.outputAssetIds ?? []).includes(options.mediaAssetId))
        .filter((record) => !options.dateFrom || new Date(record.createdAt).getTime() >= new Date(options.dateFrom).getTime())
        .filter((record) => !options.dateTo || new Date(record.createdAt).getTime() <= new Date(options.dateTo).getTime())
      const generationIds = new Set(generations.map((item) => item.id))
      const outputAssetIds = new Set(generations.flatMap((item) => item.outputAssetIds ?? []).map(String))
      return buildGenerationBusinessMetrics({
        generations,
        costLedgers: [...creativeProviderCostLedgersById.values()].filter((item) => generationIds.has(item.generationId)),
        reusedAssetIds: [...mediaAssetRelationsById.values()]
          .filter((item) => item.relationType === 'reused_as_input' && outputAssetIds.has(String(item.sourceAssetId)))
          .map((item) => item.sourceAssetId),
        libraryAssetIds: seedLibraryItems
          .filter((item) => item.sourceType === 'asset' && outputAssetIds.has(String(item.sourceId)))
          .map((item) => item.sourceId),
        portfolioAssetIds: [...portfolioAssetsById.values()]
          .filter((item) => outputAssetIds.has(String(item.assetId)))
          .map((item) => item.assetId),
        taskAssetIds: taskSubmissions.flatMap((item) => item.assetIds ?? []).filter((id) => outputAssetIds.has(String(id))),
        query: options,
      })
    },
  },
  creativeProviderOperations: {
    record: (payload, actor) => {
      const generationId = String(payload.generationId)
      const existing = creativeProviderOperationsByGenerationId.get(generationId) ?? null
      if (existing) {
        if (existing.providerId !== payload.providerId || existing.providerJobId !== safeProviderJobIdEvidence(payload.providerJobId)) {
          throw providerOperationConflict('operation_identity_mismatch')
        }
        return { created: false, operation: serializeCreativeProviderOperation(existing) }
      }
      if (!creativeGenerationsById.has(generationId)) throw providerOperationConflict('generation_missing')
      const jobKey = `${payload.providerId}:${safeProviderJobIdEvidence(payload.providerJobId)}`
      if (creativeProviderOperationGenerationIdByJobKey.has(jobKey)) throw providerOperationConflict('provider_job_already_recorded')
      const operation = makeCreativeProviderOperationRecord(payload)
      creativeProviderOperationsByGenerationId.set(generationId, operation)
      creativeProviderOperationGenerationIdByJobKey.set(jobKey, generationId)
      recordAudit(actor, 'creative.provider_operation.recorded', 'creative_provider_operation', operation.id, {
        generationId,
        providerId: operation.providerId,
        providerJobId: operation.providerJobId,
        status: operation.status,
      })
      return { created: true, operation: serializeCreativeProviderOperation(operation) }
    },
    findForGeneration: (generationId) => {
      const operation = creativeProviderOperationsByGenerationId.get(String(generationId)) ?? null
      return operation ? serializeCreativeProviderOperation(operation) : null
    },
    listDue: (options = {}) => {
      const dueBefore = new Date(options.dueBefore ?? new Date()).getTime()
      const limit = Math.max(1, options.limit ?? 10)
      const statuses = new Set((options.statuses ?? ['queued', 'running']).map(String))
      const items = [...creativeProviderOperationsByGenerationId.values()]
        .filter((operation) => !options.providerId || operation.providerId === options.providerId)
        .filter((operation) => statuses.has(operation.status) || !operation.sideEffectsComplete)
        .filter((operation) => operation.nextPollAt == null || new Date(operation.nextPollAt).getTime() <= dueBefore)
        .sort((left, right) => {
          const dueDifference = new Date(left.nextPollAt ?? left.createdAt).getTime() - new Date(right.nextPollAt ?? right.createdAt).getTime()
          return dueDifference || left.id.localeCompare(right.id)
        })
        .slice(0, limit)
        .map(serializeCreativeProviderOperation)
      return { items, limit }
    },
    update: (generationId, patch = {}, actor, options = {}) => {
      const current = creativeProviderOperationsByGenerationId.get(String(generationId)) ?? null
      if (!current) return null
      if (options.expectedVersion != null && Number(options.expectedVersion) !== current.version) {
        throw providerOperationConflict('operation_version_mismatch')
      }
      if (patch.providerJobId && safeProviderJobIdEvidence(patch.providerJobId) !== current.providerJobId) {
        throw providerOperationConflict('provider_job_mismatch')
      }
      const updated = makeCreativeProviderOperationRecord(current, {
        ...patch,
        providerJobId: current.providerJobId,
        safeMetadata: safeProviderOperationMetadata(patch.safeMetadata ?? current.safeMetadata),
        version: current.version + 1,
        updatedAt: new Date().toISOString(),
      })
      creativeProviderOperationsByGenerationId.set(updated.generationId, updated)
      recordAudit(actor, 'creative.provider_operation.updated', 'creative_provider_operation', updated.id, {
        generationId: updated.generationId,
        providerId: updated.providerId,
        providerJobId: updated.providerJobId,
        status: updated.status,
        version: updated.version,
        sideEffectsComplete: updated.sideEffectsComplete,
      })
      return serializeCreativeProviderOperation(updated)
    },
  },
  creativeGenerationMutations: {
    record: (payload, actor) => {
      const idempotencyKey = String(payload.idempotencyKey ?? '')
      const existing = creativeGenerationMutationsByIdempotencyKey.get(idempotencyKey) ?? null
      if (existing) {
        return { created: false, mutation: serializeCreativeGenerationMutation(existing) }
      }
      const mutation = makeCreativeGenerationMutationRecord({ ...payload, idempotencyKey })
      creativeGenerationMutationsById.set(mutation.id, mutation)
      creativeGenerationMutationsByIdempotencyKey.set(mutation.idempotencyKey, mutation)
      recordAudit(actor, 'creative.generation_mutation.requested', 'creative_generation_mutation', mutation.id, {
        generationId: mutation.generationId,
        mutationType: mutation.type,
        mutationStatus: mutation.status,
        reasonCode: mutation.reasonCode,
      })
      return { created: true, mutation: serializeCreativeGenerationMutation(mutation) }
    },
    find: (id) => {
      const mutation = creativeGenerationMutationsById.get(String(id)) ?? null
      return mutation ? serializeCreativeGenerationMutation(mutation) : null
    },
    findByIdempotencyKey: (key) => {
      const mutation = creativeGenerationMutationsByIdempotencyKey.get(String(key)) ?? null
      return mutation ? serializeCreativeGenerationMutation(mutation) : null
    },
    listForGeneration: (generationId) => ({
      items: [...creativeGenerationMutationsById.values()]
        .filter((mutation) => mutation.generationId === String(generationId))
        .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
        .map(serializeCreativeGenerationMutation),
    }),
    update: (id, patch = {}, actor) => {
      const current = creativeGenerationMutationsById.get(String(id)) ?? null
      if (!current) return null
      const updated = makeCreativeGenerationMutationRecord(current, {
        ...patch,
        updatedAt: new Date().toISOString(),
      })
      creativeGenerationMutationsById.set(updated.id, updated)
      creativeGenerationMutationsByIdempotencyKey.set(updated.idempotencyKey, updated)
      recordAudit(actor, 'creative.generation_mutation.updated', 'creative_generation_mutation', updated.id, {
        generationId: updated.generationId,
        mutationType: updated.type,
        mutationStatus: updated.status,
        reasonCode: updated.reasonCode,
      })
      return serializeCreativeGenerationMutation(updated)
    },
  },
  creativeProviderReplays: {
    record: (payload, actor) => {
      const idempotencyKey = String(payload.idempotencyKey ?? '')
      const providerEventKey = payload.providerEventId
        ? `${payload.providerId}:${payload.providerEventId}`
        : null
      const existingId = creativeProviderReplayLedgerByIdempotencyKey.get(idempotencyKey) ??
        (providerEventKey ? creativeProviderReplayLedgerByProviderEventKey.get(providerEventKey) : null)
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
      if (providerEventKey) {
        creativeProviderReplayLedgerByProviderEventKey.set(providerEventKey, record.id)
      }
      recordAudit(actor, 'creative.provider_replay.recorded', 'creative_provider_replay_ledger', record.id, {
        generationId: record.generationId,
        providerId: record.providerId,
        providerJobId: safeProviderJobIdEvidence(record.providerJobId),
        sourceType: record.sourceType,
        action: record.action,
        reasonCode: record.reasonCode,
      })
      return {
        created: true,
        replay: serializeCreativeProviderReplay(record),
      }
    },
    claimSideEffects: (id, payload = {}) => {
      const current = creativeProviderReplayLedgerById.get(String(id))
      if (!current) {
        return { claimed: false, replay: null }
      }
      const currentResult = current.sideEffectResult ?? null
      const expectedResult = payload.expectedSideEffectResult ?? null
      const activeLeaseExpiresAt = Date.parse(currentResult?.claim?.leaseExpiresAt ?? '')
      const claimedAt = Date.parse(payload.claimedAt ?? '')
      const hasActiveClaim = currentResult?.claim?.token &&
        Number.isFinite(activeLeaseExpiresAt) &&
        Number.isFinite(claimedAt) &&
        activeLeaseExpiresAt > claimedAt
      if (JSON.stringify(currentResult) !== JSON.stringify(expectedResult) || hasActiveClaim) {
        return {
          claimed: false,
          replay: serializeCreativeProviderReplay(current),
        }
      }
      const updated = {
        ...current,
        sideEffectResult: {
          ...(currentResult ?? {}),
          completed: false,
          claim: {
            token: String(payload.claimToken ?? ''),
            claimedAt: payload.claimedAt,
            leaseExpiresAt: payload.leaseExpiresAt,
          },
        },
        updatedAt: new Date().toISOString(),
      }
      creativeProviderReplayLedgerById.set(updated.id, updated)
      return {
        claimed: true,
        replay: serializeCreativeProviderReplay(updated),
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
        providerJobId: safeProviderJobIdEvidence(updated.providerJobId),
        sourceType: updated.sourceType,
      })
      return serializeCreativeProviderReplay(updated)
    },
    markSideEffectResult: (id, sideEffectResult = {}, actor, options = {}) => {
      const current = creativeProviderReplayLedgerById.get(String(id))
      if (!current) {
        return null
      }
      if (options.claimToken && current.sideEffectResult?.claim?.token !== options.claimToken) {
        return serializeCreativeProviderReplay(current)
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
        providerJobId: safeProviderJobIdEvidence(updated.providerJobId),
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
  creativeOutputIngestions: {
    record: (payload, actor) => {
      const sourceKey = String(payload.sourceKey ?? '')
      const existing = creativeOutputIngestionsBySourceKey.get(sourceKey) ?? null
      if (existing) {
        return { created: false, ingestion: serializeCreativeOutputIngestion(existing) }
      }
      const ingestion = makeCreativeOutputIngestionRecord({ ...payload, sourceKey })
      creativeOutputIngestionsById.set(ingestion.id, ingestion)
      creativeOutputIngestionsBySourceKey.set(sourceKey, ingestion)
      recordAudit(actor, 'creative.output_ingestion.recorded', 'creative_output_ingestion', ingestion.id, {
        generationId: ingestion.generationId,
        providerId: ingestion.providerId,
        providerJobId: ingestion.providerJobId,
        outputDigest: ingestion.outputDigest,
        outputIndex: ingestion.outputIndex,
        ingestionStatus: ingestion.status,
      })
      return { created: true, ingestion: serializeCreativeOutputIngestion(ingestion) }
    },
    find: (id) => {
      const ingestion = creativeOutputIngestionsById.get(String(id)) ?? null
      return ingestion ? serializeCreativeOutputIngestion(ingestion) : null
    },
    findBySourceKey: (sourceKey) => {
      const ingestion = creativeOutputIngestionsBySourceKey.get(String(sourceKey)) ?? null
      return ingestion ? serializeCreativeOutputIngestion(ingestion) : null
    },
    listForGeneration: (generationId) => ({
      items: [...creativeOutputIngestionsById.values()]
        .filter((ingestion) => ingestion.generationId === String(generationId))
        .sort((left, right) => left.outputIndex - right.outputIndex || left.createdAt.localeCompare(right.createdAt))
        .map(serializeCreativeOutputIngestion),
    }),
    claim: (sourceKey, payload = {}) => {
      const current = creativeOutputIngestionsBySourceKey.get(String(sourceKey)) ?? null
      if (!current) return { claimed: false, ingestion: null }
      const claimedAt = Date.parse(payload.claimedAt ?? '')
      const leaseExpiresAt = Date.parse(current.leaseExpiresAt ?? '')
      const hasActiveClaim = current.claimToken && Number.isFinite(claimedAt) &&
        Number.isFinite(leaseExpiresAt) && leaseExpiresAt > claimedAt
      if (current.status === 'completed' || hasActiveClaim) {
        return { claimed: false, ingestion: serializeCreativeOutputIngestion(current) }
      }
      const updated = makeCreativeOutputIngestionRecord(current, {
        status: 'claimed',
        claimToken: String(payload.claimToken ?? ''),
        claimedAt: payload.claimedAt,
        leaseExpiresAt: payload.leaseExpiresAt,
        errorCode: null,
      })
      creativeOutputIngestionsById.set(updated.id, updated)
      creativeOutputIngestionsBySourceKey.set(updated.sourceKey, updated)
      return { claimed: true, ingestion: serializeCreativeOutputIngestion(updated) }
    },
    update: (id, patch = {}, actor, options = {}) => {
      const current = creativeOutputIngestionsById.get(String(id)) ?? null
      if (!current) return null
      if (options.claimToken && current.claimToken !== options.claimToken) {
        return serializeCreativeOutputIngestion(current)
      }
      const updated = makeCreativeOutputIngestionRecord(current, patch)
      creativeOutputIngestionsById.set(updated.id, updated)
      creativeOutputIngestionsBySourceKey.set(updated.sourceKey, updated)
      recordAudit(actor, 'creative.output_ingestion.updated', 'creative_output_ingestion', updated.id, {
        generationId: updated.generationId,
        providerId: updated.providerId,
        outputDigest: updated.outputDigest,
        outputIndex: updated.outputIndex,
        ingestionStatus: updated.status,
        errorCode: updated.errorCode,
        mediaAssetId: updated.mediaAssetId,
      })
      createProviderLifecycleNotifications({
        sourceKey: `creative-provider-output-ingestion:${updated.id}:${updated.status}:${updated.errorCode ?? 'none'}`,
        generationId: updated.generationId,
        type: `creative.output_ingestion.${updated.status}`,
        metadata: {
          providerId: updated.providerId,
          sourceType: 'output_ingestion',
          nextStatus: updated.status,
          errorCode: updated.errorCode,
        },
      }, actor)
      return serializeCreativeOutputIngestion(updated)
    },
  },
  creativeProviderControls: {
    list: (options = {}) => {
      const rows = [...creativeProviderControlsByScopeKey.values()]
        .filter((item) => !options.providerId || item.providerId === options.providerId)
        .filter((item) => !options.workspace || item.workspace === options.workspace)
        .sort((left, right) => left.scopeKey.localeCompare(right.scopeKey))
        .map(serializeCreativeProviderControlState)
      return paginateByCursor(rows, options)
    },
    findControl: (scopeKey) => {
      const row = creativeProviderControlsByScopeKey.get(String(scopeKey)) ?? null
      return row ? serializeCreativeProviderControlState(row) : null
    },
    findControlById: (id) => {
      const row = [...creativeProviderControlsByScopeKey.values()].find((item) => item.id === String(id)) ?? null
      return row ? serializeCreativeProviderControlState(row) : null
    },
    setControl: (payload, actor) => {
      const current = creativeProviderControlsByScopeKey.get(String(payload.scopeKey)) ?? null
      if (current && Number(payload.expectedVersion) !== current.version) throw providerControlConflict('control_version_mismatch')
      if (!current && ![undefined, null, 0].includes(payload.expectedVersion)) throw providerControlConflict('control_create_version_mismatch')
      if (current && current.enabled === payload.enabled && current.reasonCode === payload.reasonCode) {
        return { changed: false, control: serializeCreativeProviderControlState(current) }
      }
      const now = new Date().toISOString()
      const updated = makeProviderControl(current ?? payload, {
        ...payload,
        id: current?.id ?? payload.id,
        version: current ? current.version + 1 : 1,
        changedByRef: actor?.handle ?? payload.changedByRef ?? null,
        enabledAt: payload.enabled ? now : current?.enabledAt ?? null,
        disabledAt: payload.enabled ? current?.disabledAt ?? null : now,
        createdAt: current?.createdAt ?? now,
      })
      creativeProviderControlsByScopeKey.set(updated.scopeKey, updated)
      recordAudit(actor, `creative.provider_control.${updated.enabled ? 'enabled' : 'disabled'}`, 'creative_provider_control', updated.id, providerControlAuditMetadata(updated))
      return { changed: true, control: serializeCreativeProviderControlState(updated) }
    },
    putCapEvidence: (payload, actor) => {
      const existingId = creativeProviderCapEvidenceIdsBySourceKey.get(String(payload.sourceKey))
      const existing = existingId ? creativeProviderCapEvidenceById.get(existingId) : null
      if (existing) {
        if (existing.evidenceHash !== payload.evidenceHash) throw providerControlConflict('cap_source_key_payload_mismatch')
        return { created: false, evidence: serializeCreativeProviderCapEvidence(existing) }
      }
      for (const [id, item] of creativeProviderCapEvidenceById) {
        if (item.scopeKey === payload.scopeKey && item.active) creativeProviderCapEvidenceById.set(id, { ...item, active: false })
      }
      const evidence = makeProviderCapEvidence(payload)
      creativeProviderCapEvidenceById.set(evidence.id, evidence)
      creativeProviderCapEvidenceIdsBySourceKey.set(evidence.sourceKey, evidence.id)
      recordAudit(actor, 'creative.provider_control.cap_evidence_recorded', 'creative_provider_cap_evidence', evidence.id, {
        providerId: evidence.providerId,
        currency: evidence.currency,
        sourceType: evidence.sourceType,
        evidenceHash: evidence.evidenceHash,
        verifiedAt: evidence.verifiedAt,
        expiresAt: evidence.expiresAt,
      })
      return { created: true, evidence: serializeCreativeProviderCapEvidence(evidence) }
    },
    findCapEvidence: (scopeKey) => {
      const evidence = [...creativeProviderCapEvidenceById.values()]
        .filter((item) => item.scopeKey === String(scopeKey) && item.active)
        .sort((left, right) => String(right.verifiedAt).localeCompare(String(left.verifiedAt)))[0] ?? null
      return evidence ? serializeCreativeProviderCapEvidence(evidence) : null
    },
    ensureCircuit: (payload, actor) => {
      const current = creativeProviderCircuitsByScopeKey.get(String(payload.scopeKey)) ?? null
      if (current) return { created: false, circuit: serializeCreativeProviderCircuitState(current) }
      const circuit = makeProviderCircuit(payload)
      creativeProviderCircuitsByScopeKey.set(circuit.scopeKey, circuit)
      recordAudit(actor, 'creative.provider_circuit.provisioned', 'creative_provider_circuit', circuit.id, {
        providerId: circuit.providerId,
        workspace: circuit.workspace,
        modelFamily: circuit.modelFamily,
        status: circuit.status,
      })
      return { created: true, circuit: serializeCreativeProviderCircuitState(circuit) }
    },
    findCircuit: (scopeKey) => {
      const circuit = creativeProviderCircuitsByScopeKey.get(String(scopeKey)) ?? null
      return circuit ? serializeCreativeProviderCircuitState(circuit) : null
    },
    findCircuitById: (id) => {
      const circuit = [...creativeProviderCircuitsByScopeKey.values()].find((item) => item.id === String(id)) ?? null
      return circuit ? serializeCreativeProviderCircuitState(circuit) : null
    },
    listCircuits: (options = {}) => {
      const rows = [...creativeProviderCircuitsByScopeKey.values()]
        .filter((item) => !options.providerId || item.providerId === options.providerId)
        .filter((item) => !options.workspace || item.workspace === options.workspace)
        .map(serializeCreativeProviderCircuitState)
      return paginateByCursor(rows, options)
    },
    recordCircuitEvent: (payload, actor) => {
      const existingId = creativeProviderCircuitEventIdsBySourceKey.get(String(payload.sourceKey))
      const existing = existingId ? creativeProviderCircuitEventsById.get(existingId) : null
      const current = creativeProviderCircuitsByScopeKey.get(String(payload.scopeKey)) ?? null
      if (existing) return { duplicate: true, event: serializeCreativeProviderCircuitEvent(existing), circuit: current ? serializeCreativeProviderCircuitState(current) : null }
      if (!current) return null
      const occurredAt = new Date(payload.occurredAt ?? Date.now()).toISOString()
      const retryable = payload.policy.retryableCategories.includes(payload.category)
      const outcome = payload.category === 'success' ? 'success' : retryable ? 'retryable_failure' : 'ignored_failure'
      let updated = current
      if (outcome === 'retryable_failure') {
        const windowExpired = !current.windowStartedAt || new Date(occurredAt).getTime() - new Date(current.windowStartedAt).getTime() >= payload.policy.windowSeconds * 1000
        const failureCount = windowExpired ? 1 : current.failureCount + 1
        const shouldOpen = payload.category === 'provider_incident' || failureCount >= payload.policy.failureThreshold
        updated = makeProviderCircuit(current, {
          failureCount,
          windowStartedAt: windowExpired ? occurredAt : current.windowStartedAt,
          lastFailureAt: occurredAt,
          status: shouldOpen ? 'open' : current.status,
          openedAt: shouldOpen ? occurredAt : current.openedAt,
          cooldownUntil: shouldOpen ? new Date(new Date(occurredAt).getTime() + payload.policy.cooldownSeconds * 1000).toISOString() : current.cooldownUntil,
          reasonCode: shouldOpen ? `circuit_${payload.category}` : `failure_${payload.category}`,
          version: current.version + 1,
        })
      } else if (outcome === 'success' && current.status === 'closed') {
        updated = makeProviderCircuit(current, {
          failureCount: 0,
          windowStartedAt: null,
          reasonCode: 'dispatch_succeeded',
          version: current.version + 1,
        })
      } else if (outcome === 'success' && current.status === 'half_open') {
        updated = makeProviderCircuit(current, {
          reasonCode: 'probe_succeeded_pending_recovery',
          version: current.version + 1,
        })
      }
      creativeProviderCircuitsByScopeKey.set(updated.scopeKey, updated)
      const event = {
        id: `provider-circuit-event-${randomUUID()}`,
        sourceKey: payload.sourceKey,
        circuitStateId: current.id,
        category: payload.category,
        outcome,
        occurredAt,
        createdAt: new Date().toISOString(),
      }
      creativeProviderCircuitEventsById.set(event.id, event)
      creativeProviderCircuitEventIdsBySourceKey.set(event.sourceKey, event.id)
      recordAudit(actor, `creative.provider_circuit.${outcome}`, 'creative_provider_circuit', current.id, {
        providerId: current.providerId,
        workspace: current.workspace,
        category: payload.category,
        outcome,
        status: updated.status,
        failureCount: updated.failureCount,
      })
      if (current.status !== 'open' && updated.status === 'open') {
        recordAudit(actor, 'creative.provider_circuit.opened', 'creative_provider_circuit', current.id, {
          providerId: current.providerId,
          workspace: current.workspace,
          category: payload.category,
          failureCount: updated.failureCount,
          reasonCode: updated.reasonCode,
        })
      }
      return { duplicate: false, event: serializeCreativeProviderCircuitEvent(event), circuit: serializeCreativeProviderCircuitState(updated) }
    },
    transitionCircuit: (scopeKey, payload, actor) => {
      const current = creativeProviderCircuitsByScopeKey.get(String(scopeKey)) ?? null
      if (!current) return null
      if (Number(payload.expectedVersion) !== current.version) throw providerControlConflict('circuit_version_mismatch')
      const now = new Date(payload.now ?? Date.now())
      let probeToken = null
      if (payload.status === 'half_open') {
        if (current.status !== 'open') throw providerControlConflict('circuit_not_open')
        if (current.cooldownUntil && new Date(current.cooldownUntil) > now) throw providerControlConflict('circuit_cooldown_active')
        probeToken = randomUUID()
      } else if (payload.status === 'closed') {
        if (current.status !== 'half_open') throw providerControlConflict('circuit_not_half_open')
        if (current.reasonCode !== 'probe_succeeded_pending_recovery') throw providerControlConflict('probe_success_required')
      } else if (payload.status !== 'open') {
        throw providerControlConflict('circuit_transition_invalid')
      }
      const updated = makeProviderCircuit(current, {
        status: payload.status,
        version: current.version + 1,
        failureCount: payload.status === 'closed' ? 0 : current.failureCount,
        windowStartedAt: payload.status === 'closed' ? null : current.windowStartedAt,
        probeLeaseTokenHash: probeToken ? createHash('sha256').update(probeToken).digest('hex') : null,
        probeLeaseExpiresAt: probeToken ? new Date(now.getTime() + Number(payload.probeTtlSeconds ?? 60) * 1000).toISOString() : null,
        reasonCode: payload.reasonCode,
        openedAt: payload.status === 'open' ? now.toISOString() : current.openedAt,
        cooldownUntil: payload.status === 'open' ? payload.cooldownUntil ?? current.cooldownUntil : current.cooldownUntil,
      })
      creativeProviderCircuitsByScopeKey.set(updated.scopeKey, updated)
      recordAudit(actor, `creative.provider_circuit.${payload.status}`, 'creative_provider_circuit', current.id, {
        providerId: current.providerId,
        workspace: current.workspace,
        status: payload.status,
        reasonCode: payload.reasonCode,
        version: updated.version,
      })
      return { circuit: serializeCreativeProviderCircuitState(updated), probeToken }
    },
    claimProbe: (scopeKey, probeToken, actor, now = new Date()) => {
      const current = creativeProviderCircuitsByScopeKey.get(String(scopeKey)) ?? null
      const tokenHash = createHash('sha256').update(String(probeToken ?? '')).digest('hex')
      if (!current || current.status !== 'half_open' || current.probeLeaseTokenHash !== tokenHash || !current.probeLeaseExpiresAt || new Date(current.probeLeaseExpiresAt) <= new Date(now)) {
        return { claimed: false, circuit: current ? serializeCreativeProviderCircuitState(current) : null }
      }
      const updated = makeProviderCircuit(current, {
        version: current.version + 1,
        probeLeaseTokenHash: null,
        probeLeaseExpiresAt: null,
        reasonCode: 'probe_claimed',
      })
      creativeProviderCircuitsByScopeKey.set(updated.scopeKey, updated)
      recordAudit(actor, 'creative.provider_circuit.probe_claimed', 'creative_provider_circuit', current.id, {
        providerId: current.providerId,
        workspace: current.workspace,
        status: updated.status,
      })
      return { claimed: true, circuit: serializeCreativeProviderCircuitState(updated) }
    },
    recordDispatchBlock: (payload, actor) => {
      recordAudit(actor, 'creative.provider_control.dispatch_blocked', 'creative_provider_control', payload.resourceId ?? payload.providerId, {
        providerId: payload.providerId,
        workspace: payload.workspace,
        modelFamily: payload.modelFamily ?? null,
        reasonCode: payload.reasonCode,
        blockedScopeType: payload.blockedScopeType ?? null,
      })
      return { recorded: true }
    },
    requestRecovery(payload, actor) {
      const sourceKey = `provider-control-recovery:${createHash('sha256').update(JSON.stringify({
        resourceId: payload.resourceId,
        target: payload.target,
        expectedVersion: payload.expectedVersion,
        requestedBy: actor.handle,
      })).digest('hex')}`
      const existing = adminReviewQueue.find((review) => review.metadata?.kind === 'provider_control_recovery' && review.metadata?.sourceKey === sourceKey)
      if (existing) return { duplicate: true, review: serializeAdminReview(existing) }
      const now = new Date().toISOString()
      const review = {
        id: `provider-control-review-${randomUUID()}`,
        queue: 'provider-controls',
        status: 'Pending review',
        title: `Provider control recovery: ${payload.target}`,
        owner: actor.handle,
        note: payload.reasonCode,
        decision: undefined,
        reviewedBy: null,
        reviewedAt: null,
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
        createdAt: now,
        updatedAt: now,
      }
      adminReviewQueue.unshift(review)
      adminReviewById.set(review.id, review)
      recordAudit(actor, 'creative.provider_control.recovery_requested', 'admin_review', review.id, {
        target: payload.target,
        reasonCode: payload.reasonCode,
      })
      return { duplicate: false, review: serializeAdminReview(review) }
    },
    reviewRecovery(reviewId, action, actor) {
      const current = adminReviewById.get(String(reviewId)) ?? null
      if (!current || current.metadata?.kind !== 'provider_control_recovery') return null
      if (current.decision) return { review: serializeAdminReview(current), result: null, probeToken: null }
      if (action.decision === 'approve' && current.metadata.requestedBy === actor.handle) {
        throw providerControlConflict('recovery_requires_different_approver')
      }
      let result = null
      let probeToken = null
      if (action.decision === 'approve') {
        const metadata = current.metadata
        if (metadata.target === 'enable') {
          const control = [...creativeProviderControlsByScopeKey.values()].find((item) => item.id === metadata.resourceId)
          if (!control) throw providerControlConflict('control_not_found')
          result = this.setControl({
            ...control,
            enabled: true,
            reasonCode: metadata.reasonCode,
            expectedVersion: metadata.expectedVersion,
          }, actor).control
        } else {
          const circuit = [...creativeProviderCircuitsByScopeKey.values()].find((item) => item.id === metadata.resourceId)
          if (!circuit) throw providerControlConflict('circuit_not_found')
          const transitioned = this.transitionCircuit(circuit.scopeKey, {
            status: metadata.target,
            expectedVersion: metadata.expectedVersion,
            reasonCode: metadata.reasonCode,
            probeTtlSeconds: metadata.probeTtlSeconds,
          }, actor)
          result = transitioned?.circuit ?? null
          probeToken = transitioned?.probeToken ?? null
        }
      }
      const reviewed = {
        ...current,
        status: action.decision === 'approve' ? 'Approved' : 'Rejected',
        note: action.note || current.note,
        decision: action.decision,
        reviewedBy: actor.handle,
        reviewedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: { ...current.metadata, approvedBy: action.decision === 'approve' ? actor.handle : null },
      }
      adminReviewById.set(reviewed.id, reviewed)
      const index = adminReviewQueue.findIndex((item) => item.id === reviewed.id)
      if (index >= 0) adminReviewQueue[index] = reviewed
      recordAudit(actor, `creative.provider_control.recovery_${action.decision}`, 'admin_review', reviewed.id, {
        target: reviewed.metadata.target,
        reasonCode: reviewed.metadata.reasonCode,
      })
      return { review: serializeAdminReview(reviewed), result, probeToken }
    },
  },
  creativeProviderRetries: {
    find: (sourceKey) => {
      const state = creativeProviderRetryStatesBySourceKey.get(String(sourceKey)) ?? null
      return state ? serializeCreativeProviderRetryState(state) : null
    },
    findForGeneration: (generationId, operationType = null) => {
      const state = [...creativeProviderRetryStatesBySourceKey.values()]
        .filter((item) => item.generationId === String(generationId))
        .filter((item) => !operationType || item.operationType === String(operationType))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
      return state ? serializeCreativeProviderRetryState(state) : null
    },
    list: (options = {}) => {
      const dueBefore = options.dueBefore ? new Date(options.dueBefore).getTime() : null
      const rows = [...creativeProviderRetryStatesBySourceKey.values()]
        .filter((item) => !options.status || item.status === options.status)
        .filter((item) => !options.providerId || item.providerId === options.providerId)
        .filter((item) => !options.workspace || item.workspace === options.workspace)
        .filter((item) => !Number.isFinite(dueBefore) || (item.nextAttemptAt && new Date(item.nextAttemptAt).getTime() <= dueBefore))
        .sort((left, right) => String(left.nextAttemptAt ?? left.updatedAt).localeCompare(String(right.nextAttemptAt ?? right.updatedAt)))
        .map(serializeCreativeProviderRetryState)
      return paginateByCursor(rows, options)
    },
    record: (payload, actor) => {
      const current = creativeProviderRetryStatesBySourceKey.get(String(payload.sourceKey)) ?? null
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
        ensureRetryNotification(current)
        return { changed: false, duplicate: true, state: serializeCreativeProviderRetryState(current) }
      }
      if (current && Number(payload.expectedVersion) !== current.version) throw providerRetryConflict('retry_version_mismatch')
      if (!current && ![undefined, null, 0].includes(payload.expectedVersion)) throw providerRetryConflict('retry_create_version_mismatch')
      const generationConflict = [...creativeProviderRetryStatesBySourceKey.values()].find((item) =>
        item.generationId === String(payload.generationId) &&
        item.operationType === String(payload.operationType) &&
        item.sourceKey !== String(payload.sourceKey))
      if (generationConflict) throw providerRetryConflict('retry_generation_operation_conflict')
      const state = makeProviderRetryState(current ?? payload, {
        ...payload,
        id: current?.id ?? payload.id,
        version: current ? current.version + 1 : 1,
        createdAt: current?.createdAt ?? payload.createdAt,
      })
      creativeProviderRetryStatesBySourceKey.set(state.sourceKey, state)
      const retryAction = `creative.provider_retry.${state.status}`
      recordAudit(actor, retryAction, 'creative_provider_retry_state', state.id, {
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
      })
      ensureRetryNotification(state)
      return { changed: true, duplicate: false, state: serializeCreativeProviderRetryState(state) }
    },
    clear: (sourceKey, payload = {}, actor) => {
      const current = creativeProviderRetryStatesBySourceKey.get(String(sourceKey)) ?? null
      if (!current) return { changed: false, state: null }
      if (current.status === 'cleared') return { changed: false, state: serializeCreativeProviderRetryState(current) }
      if (payload.expectedVersion != null && Number(payload.expectedVersion) !== current.version) throw providerRetryConflict('retry_version_mismatch')
      const state = makeProviderRetryState(current, {
        status: 'cleared',
        nextAttemptAt: null,
        delaySource: null,
        version: current.version + 1,
      })
      creativeProviderRetryStatesBySourceKey.set(state.sourceKey, state)
      recordAudit(actor, 'creative.provider_retry.cleared', 'creative_provider_retry_state', state.id, {
        generationId: state.generationId,
        providerId: state.providerId,
        workspace: state.workspace,
        operationType: state.operationType,
        attempt: state.attempt,
        version: state.version,
        reasonCode: payload.reasonCode ?? 'provider_operation_succeeded',
      })
      return { changed: true, state: serializeCreativeProviderRetryState(state) }
    },
  },
  creativeProviderCosts: {
    reserve: (payload, actor) => {
      const existingId = creativeProviderCostLedgerIdsBySourceKey.get(String(payload.sourceKey))
      const existing = existingId ? creativeProviderCostLedgersById.get(existingId) : null
      if (existing) {
        if (existing.pricingSnapshotHash !== payload.pricingSnapshotHash || String(existing.estimateMicros) !== String(payload.estimateMicros)) {
          throw providerCostConflict('source_key_payload_mismatch')
        }
        return {
          reserved: existing.status === 'reserved',
          duplicate: true,
          reasonCode: existing.status === 'reserved' ? null : `already_${existing.status}`,
          ledger: providerCostDto(existing),
        }
      }
      const key = providerBudgetWindowKey(payload)
      const windowId = creativeProviderBudgetWindowIdsByKey.get(key)
      let window = windowId ? creativeProviderBudgetWindowsById.get(windowId) : null
      if (!window) {
        window = makeCreativeProviderBudgetWindow(payload)
        creativeProviderBudgetWindowsById.set(window.id, window)
        creativeProviderBudgetWindowIdsByKey.set(key, window.id)
      } else if (
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
          budgetWindow: serializeCreativeProviderBudgetWindow(window),
        }
      }
      window = makeCreativeProviderBudgetWindow(window, {
        reservedMicros: window.reservedMicros + estimateMicros,
      })
      creativeProviderBudgetWindowsById.set(window.id, window)
      const ledger = makeCreativeProviderCostLedger({
        ...payload,
        budgetWindowId: window.id,
        reservedMicros: estimateMicros,
      })
      creativeProviderCostLedgersById.set(ledger.id, ledger)
      creativeProviderCostLedgerIdsBySourceKey.set(ledger.sourceKey, ledger.id)
      recordAudit(actor, 'creative.provider_cost.reserved', 'creative_provider_cost_ledger', ledger.id, {
        generationId: ledger.generationId,
        providerId: ledger.providerId,
        workspace: ledger.workspace,
        currency: ledger.currency,
        budgetScope: window.budgetScope,
        estimateMicros: String(ledger.estimateMicros),
        pricingSnapshotHash: ledger.pricingSnapshotHash,
      })
      return { reserved: true, duplicate: false, reasonCode: null, ledger: providerCostDto(ledger) }
    },
    findBySourceKey: (sourceKey) => {
      const id = creativeProviderCostLedgerIdsBySourceKey.get(String(sourceKey))
      const ledger = id ? creativeProviderCostLedgersById.get(id) : null
      return ledger ? providerCostDto(ledger) : null
    },
    findForGeneration: (generationId) => {
      const ledger = [...creativeProviderCostLedgersById.values()]
        .find((item) => item.generationId === String(generationId)) ?? null
      return ledger ? providerCostDto(ledger) : null
    },
    settle: (sourceKey, payload = {}, actor) => {
      const id = creativeProviderCostLedgerIdsBySourceKey.get(String(sourceKey))
      const current = id ? creativeProviderCostLedgersById.get(id) : null
      if (!current) return null
      const actualMicros = BigInt(payload.actualMicros)
      if (payload.actualCurrency !== current.currency) throw providerCostConflict('actual_currency_mismatch')
      if (current.status === 'settled') {
        if (current.actualMicros !== actualMicros) throw providerCostConflict('actual_cost_mismatch')
        return providerCostDto(current)
      }
      const window = creativeProviderBudgetWindowsById.get(current.budgetWindowId)
      if (!window) return null
      const heldMicros = ['reserved', 'reconciliation_required'].includes(current.status) ? current.reservedMicros : 0n
      const updatedWindow = makeCreativeProviderBudgetWindow(window, {
        reservedMicros: window.reservedMicros > heldMicros ? window.reservedMicros - heldMicros : 0n,
        spentMicros: window.spentMicros + actualMicros,
      })
      const updated = makeCreativeProviderCostLedger(current, {
        status: 'settled',
        actualMicros,
        providerJobId: payload.providerJobId ?? current.providerJobId,
        usage: payload.usage ?? current.usage,
        risk: payload.risk ?? current.risk,
        reasonCode: payload.reasonCode ?? 'provider_actual_settled',
        settledAt: payload.settledAt ?? new Date().toISOString(),
      })
      creativeProviderBudgetWindowsById.set(updatedWindow.id, updatedWindow)
      creativeProviderCostLedgersById.set(updated.id, updated)
      recordAudit(actor, 'creative.provider_cost.settled', 'creative_provider_cost_ledger', updated.id, {
        generationId: updated.generationId,
        providerId: updated.providerId,
        workspace: updated.workspace,
        currency: updated.currency,
        actualMicros: String(updated.actualMicros),
        estimateExceeded: updated.actualMicros > updated.estimateMicros,
      })
      return providerCostDto(updated)
    },
    release: (sourceKey, reasonCode = 'dispatch_not_billed', actor) => {
      const id = creativeProviderCostLedgerIdsBySourceKey.get(String(sourceKey))
      const current = id ? creativeProviderCostLedgersById.get(id) : null
      if (!current) return null
      if (current.status === 'released' || current.status === 'settled') return providerCostDto(current)
      const window = creativeProviderBudgetWindowsById.get(current.budgetWindowId)
      if (!window) return null
      const updatedWindow = makeCreativeProviderBudgetWindow(window, {
        reservedMicros: window.reservedMicros > current.reservedMicros ? window.reservedMicros - current.reservedMicros : 0n,
        releasedMicros: window.releasedMicros + current.reservedMicros,
      })
      const updated = makeCreativeProviderCostLedger(current, {
        status: 'released',
        reasonCode,
        releasedAt: new Date().toISOString(),
      })
      creativeProviderBudgetWindowsById.set(updatedWindow.id, updatedWindow)
      creativeProviderCostLedgersById.set(updated.id, updated)
      recordAudit(actor, 'creative.provider_cost.released', 'creative_provider_cost_ledger', updated.id, {
        generationId: updated.generationId,
        providerId: updated.providerId,
        workspace: updated.workspace,
        reasonCode,
      })
      return providerCostDto(updated)
    },
    reconcile: (sourceKey, payload = {}, actor) => {
      const id = creativeProviderCostLedgerIdsBySourceKey.get(String(sourceKey))
      const current = id ? creativeProviderCostLedgersById.get(id) : null
      if (!current) return null
      if (['settled', 'released', 'reconciliation_required'].includes(current.status)) return providerCostDto(current)
      const updated = makeCreativeProviderCostLedger(current, {
        status: 'reconciliation_required',
        providerJobId: payload.providerJobId ?? current.providerJobId,
        usage: payload.usage ?? current.usage,
        risk: payload.risk ?? current.risk,
        reasonCode: payload.reasonCode ?? 'actual_cost_missing',
        reconciliationAt: payload.reconciliationAt ?? new Date().toISOString(),
      })
      creativeProviderCostLedgersById.set(updated.id, updated)
      recordAudit(actor, 'creative.provider_cost.reconciliation_required', 'creative_provider_cost_ledger', updated.id, {
        generationId: updated.generationId,
        providerId: updated.providerId,
        workspace: updated.workspace,
        currency: updated.currency,
        reasonCode: updated.reasonCode,
      })
      return providerCostDto(updated)
    },
    getBudgetWindow: (payload) => {
      const id = creativeProviderBudgetWindowIdsByKey.get(providerBudgetWindowKey(payload))
      const window = id ? creativeProviderBudgetWindowsById.get(id) : null
      return window ? serializeCreativeProviderBudgetWindow(window) : null
    },
  },
  creativeCredits: {
    reserve: (payload, actor) => {
      const amount = Math.max(0, Number.parseInt(String(payload.amount ?? payload.estimatedCredits ?? 0), 10) || 0)
      if (amount <= 0) {
        throw new HttpError(409, 'CREATIVE_CREDIT_AMOUNT_INVALID', 'Creative credit reservation amount must be positive')
      }
      const existing = payload.quotaReservationId
        ? findCreativeCreditLedger(payload.quotaReservationId)
        : null
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

      const now = new Date().toISOString()
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
        reasonCode: safeErrorPreview(payload.reasonCode ?? 'generation_reserved'),
        metadata: safeCreativeCreditMetadata(payload.metadata),
        reservedAt: now,
        settledAt: null,
        refundedAt: null,
        cancelledAt: null,
        createdAt: now,
        updatedAt: now,
      }
      applySeedAccountingOperation({
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
        reasonCode: safeErrorPreview(payload.reasonCode ?? 'generation_completed'),
        metadata: safeCreativeCreditMetadata(payload.metadata) ?? ledger.metadata ?? null,
        settledAt: now,
        updatedAt: now,
      }
      applySeedAccountingOperation({
        unit: 'creative_credit',
        kind: 'credit_settle',
        sourceType: 'generation',
        sourceId: updated.generationId,
        reasonCode: payload.reasonCode === 'generation_review_required' ? 'generation_review_required' : 'generation_completed',
        payload: { generationId: updated.generationId, ledgerId: updated.id, amount: settledAmount },
        movements: [
          { unit: 'creative_credit', accountRef: `generation:${updated.generationId}:creative_credit:reserved`, accountType: 'reserved', amount: -settledAmount },
          { unit: 'creative_credit', accountRef: `system:creative_credit:consumed`, accountType: 'consumed', amount: settledAmount },
        ],
        actor,
      })
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
        reasonCode: safeErrorPreview(payload.reasonCode ?? 'generation_failed'),
        metadata: safeCreativeCreditMetadata(payload.metadata) ?? ledger.metadata ?? null,
        refundedAt: now,
        updatedAt: now,
      }
      applySeedAccountingOperation({
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
        reasonCode: safeErrorPreview(payload.reasonCode ?? 'no_charge'),
        metadata: safeCreativeCreditMetadata(payload.metadata) ?? ledger.metadata ?? null,
        cancelledAt: now,
        updatedAt: now,
      }
      applySeedAccountingOperation({
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
      const generationId = String(payload.generationId ?? '').trim()
      if (!generationId) {
        throw new HttpError(409, 'CREATIVE_QUOTA_GENERATION_INVALID', 'Creative quota reservations require a generation id')
      }
      const units = Math.max(1, Number.parseInt(String(payload.costUnits ?? 1), 10) || 1)
      const limitUnits = Math.max(0, Number.parseInt(String(payload.limit ?? 0), 10) || 0)
      const normalizedPayload = { ...payload, generationId, costUnits: units, limit: limitUnits }
      const idempotencyPayloadHash = accountingPayloadHash({
        generationId,
        actorId: payload.actorId ?? null,
        actorHandle: payload.actorHandle ?? null,
        workspace: payload.workspace,
        windowType: payload.windowType,
        windowStart: payload.windowStart,
        windowEnd: payload.windowEnd,
        limitUnits,
        units,
        policyVersion: payload.policyVersion,
      })
      const existing = [...creativeQuotaReservationsById.values()].find((reservation) => reservation.generationId === generationId)
      if (existing) {
        if (existing.idempotencyPayloadHash !== idempotencyPayloadHash) {
          throw new HttpError(409, 'ACCOUNTING_OPERATION_CONFLICT', 'Creative quota reservation already exists with a different payload')
        }
        const existingWindow = creativeQuotaWindowsById.get(existing.quotaWindowId)
        return {
          reserved: existing.status === 'reserved',
          reservationId: existing.id,
          quota: existingWindow ? getCreativeQuotaDto(existingWindow, existing.id) : null,
        }
      }
      const window = getOrCreateCreativeQuotaWindow(normalizedPayload)
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
        generationId,
        actorId: payload.actorId ?? null,
        actorHandle: payload.actorHandle ?? null,
        workspace: payload.workspace,
        units,
        idempotencyPayloadHash,
        status: 'reserved',
        reason: null,
        reservedAt: new Date().toISOString(),
        committedAt: null,
        releasedAt: null,
      }
      applySeedAccountingOperation({
        unit: 'quota_unit',
        kind: 'quota_reserve',
        sourceType: 'generation',
        sourceId: String(reservation.generationId),
        reasonCode: 'generation_reserved',
        payload: { generationId: reservation.generationId, reservationId, units, windowId: reservation.quotaWindowId },
        movements: [
          { unit: 'quota_unit', accountRef: `quota-window:${reservation.quotaWindowId}:remaining`, accountType: 'remaining', amount: -units },
          { unit: 'quota_unit', accountRef: `generation:${reservation.generationId}:quota_unit:reserved`, accountType: 'reserved', amount: units },
        ],
        actor,
      })
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
      applySeedAccountingOperation({
        unit: 'quota_unit',
        kind: 'quota_commit',
        sourceType: 'generation',
        sourceId: String(updatedReservation.generationId),
        reasonCode: 'generation_completed',
        payload: { generationId: updatedReservation.generationId, reservationId: updatedReservation.id, units: updatedReservation.units },
        movements: [
          { unit: 'quota_unit', accountRef: `generation:${updatedReservation.generationId}:quota_unit:reserved`, accountType: 'reserved', amount: -updatedReservation.units },
          { unit: 'quota_unit', accountRef: `quota-window:${updatedReservation.quotaWindowId}:used`, accountType: 'used', amount: updatedReservation.units },
        ],
        actor,
      })
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
      const safeReason = safeErrorPreview(reason)
      const updatedWindow = {
        ...window,
        reservedUnits: Math.max(window.reservedUnits - reservation.units, 0),
        releasedUnits: window.releasedUnits + reservation.units,
        updatedAt: new Date().toISOString(),
      }
      const updatedReservation = {
        ...reservation,
        status: 'released',
        reason: safeReason,
        releasedAt: new Date().toISOString(),
      }
      applySeedAccountingOperation({
        unit: 'quota_unit',
        kind: 'quota_release',
        sourceType: 'generation',
        sourceId: String(updatedReservation.generationId),
        reasonCode: String(safeReason).includes('cancel') ? 'generation_cancelled' : 'generation_failed',
        payload: { generationId: updatedReservation.generationId, reservationId: updatedReservation.id, units: updatedReservation.units },
        movements: [
          { unit: 'quota_unit', accountRef: `generation:${updatedReservation.generationId}:quota_unit:reserved`, accountType: 'reserved', amount: -updatedReservation.units },
          { unit: 'quota_unit', accountRef: `quota-window:${updatedReservation.quotaWindowId}:remaining`, accountType: 'remaining', amount: updatedReservation.units },
        ],
        actor,
      })
      creativeQuotaWindowsById.set(updatedWindow.id, updatedWindow)
      creativeQuotaReservationsById.set(updatedReservation.id, updatedReservation)
      recordAudit(actor, 'creative.quota.released', 'creative_quota_reservation', updatedReservation.id, {
        generationId: updatedReservation.generationId,
        workspace: updatedReservation.workspace,
        units: updatedReservation.units,
        reason: safeReason,
      })
      return getCreativeQuotaDto(updatedWindow, updatedReservation.id)
    },
    getQuotaWindow: (payload) => {
      const window = creativeQuotaWindowsById.get(creativeQuotaWindowId(payload))
      return window ? getCreativeQuotaDto(window) : null
    },
  },
  media: {
    find: (id) => {
      const asset = mediaAssetsById.get(String(id)) ?? null
      return asset ? serializeMediaAsset(asset) : null
    },
    findAccessibleCreativeInput: (id, actor) => {
      const asset = mediaAssetsById.get(String(id)) ?? null
      if (!asset || asset.archivedAt || asset.deletedAt || !canAccessOwnedResource(asset.ownerHandle, actor)) return null
      return serializeMediaAsset(asset)
    },
    findOwnedChatInput: (id, actor) => {
      const asset = mediaAssetsById.get(String(id)) ?? null
      return asset?.ownerHandle === actor.handle && !asset.archivedAt && !asset.deletedAt ? serializeMediaAsset(asset) : null
    },
    listChatInputs: (actor, options = {}) => {
      const allowedPurposes = new Set(['task_attachment', 'library_asset'])
      const allowedTypes = new Set(['text/plain', 'text/markdown', 'application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
      const filtered = [...mediaAssetsById.values()]
        .filter((asset) => asset.ownerHandle === actor.handle)
        .filter((asset) => !asset.archivedAt && !asset.deletedAt)
        .filter((asset) => asset.status === 'uploaded' && asset.metadata?.security?.scanStatus === 'clean')
        .filter((asset) => allowedPurposes.has(asset.purpose) && allowedTypes.has(asset.contentType))
        .filter((asset) => asset.sizeBytes <= 20 * 1024 * 1024)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
      return paginateByCursor(filtered.map(serializeMediaAsset), options)
    },
    listCreativeInputs: (actor, options = {}) => {
      const filtered = [...mediaAssetsById.values()]
        .filter((asset) => asset.ownerHandle === actor.handle)
        .filter((asset) => !asset.archivedAt && !asset.deletedAt)
        .filter((asset) => asset.status === 'uploaded' && asset.metadata?.security?.scanStatus === 'clean')
        .filter((asset) => ['submission_asset', 'profile_portfolio', 'library_asset'].includes(asset.purpose))
        .filter((asset) => ['image/png', 'image/jpeg', 'image/webp', 'audio/mpeg', 'audio/wav', 'audio/mp4'].includes(asset.contentType))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
      return paginateByCursor(filtered.map(serializeMediaAsset), options)
    },
    listAssetLibrary: (actor, options = {}) => {
      const search = String(options.search ?? '').trim().toLowerCase()
      const filtered = [...mediaAssetsById.values()]
        .filter((asset) => asset.ownerHandle === actor.handle)
        .filter((asset) => options.lifecycle === 'all' || (options.lifecycle === 'deleted' ? Boolean(asset.deletedAt) : options.lifecycle === 'archived' ? !asset.deletedAt && Boolean(asset.archivedAt) : !asset.deletedAt && !asset.archivedAt))
        .filter((asset) => !options.purpose || asset.purpose === options.purpose)
        .filter((asset) => !options.mediaType || assetMediaType(asset.contentType) === options.mediaType)
        .filter((asset) => !options.workspace || assetEligibleForWorkspace(asset, options.workspace))
        .filter((asset) => !options.dateFrom || asset.createdAt >= options.dateFrom)
        .filter((asset) => !options.dateTo || asset.createdAt <= options.dateTo)
        .filter((asset) => !search || asset.fileName.toLowerCase().includes(search))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
      return paginateByCursor(filtered.map((asset) => {
        return getSeedAssetLibraryItem(asset, actor)
      }), options)
    },
    getAssetLibraryItem: (id, actor) => {
      const asset = mediaAssetsById.get(String(id)) ?? null
      if (!asset || asset.ownerHandle !== actor.handle) return null
      return getSeedAssetLibraryItem(asset, actor)
    },
    saveAssetToLibrary: (id, actor) => {
      const asset = mediaAssetsById.get(String(id)) ?? null
      const generation = [...creativeGenerationsById.values()].find((item) => item.outputAssetIds?.includes(String(id))) ?? null
      const [resolved] = resolveCreativeDeliveryAssets({ assetIds: [id], assets: asset ? [asset] : [], generations: generation ? [generation] : [], actor, target: 'private_library' })
      const existing = seedLibraryItems.find((item) => item.ownerHandle === actor.handle && item.sourceType === 'asset' && item.sourceId === String(id))
      if (existing) return serializeLibraryItem(existing)
      const item = {
        id: `library-${randomUUID()}`, type: 'asset', source: 'Creative output', sourceType: 'asset', saves: '1',
        text: '', title: asset.fileName, ownerHandle: actor.handle, sourceId: String(id),
        metadata: { kind: 'media_asset', assetEvidence: resolved.evidence },
      }
      seedLibraryItems.unshift(item)
      libraryItemsById.set(item.id, item)
      recordAudit(actor, 'media.asset.saved_to_library', 'media_asset', asset.id, { libraryItemId: item.id })
      return serializeLibraryItem(item)
    },
    setAssetArchived: (id, archived, actor) => {
      const asset = mediaAssetsById.get(String(id)) ?? null
      if (!asset || asset.ownerHandle !== actor.handle) return null
      if (asset.deletedAt) throw new HttpError(409, 'ASSET_DELETED', 'Deleted assets must be recovered before archive changes')
      const now = new Date().toISOString()
      const archivedAt = archived ? (asset.archivedAt ?? now) : null
      const updated = {
        ...asset,
        archivedAt,
        storage: transitionSeedStorage(asset, activeSeedStorageState(asset, { archivedAt } ), now),
        updatedAt: now,
      }
      mediaAssetsById.set(updated.id, updated)
      if (archived) {
        for (const [portfolioId, item] of portfolioAssetsById.entries()) {
          if (item.assetId === updated.id && item.status === 'published') {
            portfolioAssetsById.set(portfolioId, { ...item, status: 'withdrawn', withdrawnAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
          }
        }
      }
      recordAudit(actor, archived ? 'media.asset.archived' : 'media.asset.restored', 'media_asset', updated.id, { referenced: [...creativeGenerationsById.values()].some((item) => item.inputAssetIds?.includes(updated.id) || item.outputAssetIds?.includes(updated.id)) })
      return getSeedAssetLibraryItem(updated, actor)
    },
    setAssetDeleted: (id, deleted, actor, payload = {}) => {
      const asset = mediaAssetsById.get(String(id)) ?? null
      if (!asset || asset.ownerHandle !== actor.handle) return null
      const now = new Date().toISOString()
      const deletedAt = deleted ? (asset.deletedAt ?? now) : null
      const nextStorageState = activeSeedStorageState(asset, { deletedAt })
      const updated = {
        ...asset,
        deletedAt,
        deletedByHandle: deleted ? actor.handle : null,
        deletionReason: deleted ? payload.reason ?? 'user_requested' : null,
        storage: transitionSeedStorage(asset, nextStorageState, now, {
          cleanupAfter: deleted ? new Date(Date.now() + getSeedMediaGovernancePolicy().retention.storageCleanupRetentionDays * 86400_000).toISOString() : null,
        }),
        updatedAt: now,
      }
      mediaAssetsById.set(updated.id, updated)
      if (deleted) {
        for (const [portfolioId, item] of portfolioAssetsById.entries()) if (item.assetId === updated.id && item.status === 'published') portfolioAssetsById.set(portfolioId, { ...item, status: 'withdrawn', withdrawnAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      }
      recordAudit(actor, deleted ? 'media.asset.deleted' : 'media.asset.recovered', 'media_asset', updated.id, { reason: deleted ? updated.deletionReason : 'owner_recovery' })
      return getSeedAssetLibraryItem(updated, actor)
    },
    listAdminAssets: (options = {}) => {
      const search = String(options.search ?? '').trim().toLowerCase()
      const rows = [...mediaAssetsById.values()]
        .filter((asset) => options.lifecycle === 'all' || (options.lifecycle === 'deleted' ? Boolean(asset.deletedAt) : options.lifecycle === 'archived' ? !asset.deletedAt && Boolean(asset.archivedAt) : !asset.deletedAt && !asset.archivedAt))
        .filter((asset) => !options.status || asset.status === options.status)
        .filter((asset) => !options.purpose || asset.purpose === options.purpose)
        .filter((asset) => !options.mediaType || assetMediaType(asset.contentType) === options.mediaType)
        .filter((asset) => !options.ownerHandle || asset.ownerHandle === options.ownerHandle)
        .filter((asset) => !options.storageState || asset.storage?.state === options.storageState)
        .filter((asset) => !search || [asset.id, asset.fileName, asset.ownerHandle].some((value) => String(value).toLowerCase().includes(search)))
        .sort((left, right) => options.sort === 'created_asc' ? left.createdAt.localeCompare(right.createdAt) : options.sort === 'name_asc' ? left.fileName.localeCompare(right.fileName) : options.sort === 'updated_desc' ? right.updatedAt.localeCompare(left.updatedAt) : right.createdAt.localeCompare(left.createdAt))
        .map(getSeedAdminAsset)
      return paginateByCursor(rows, options)
    },
    businessMetrics: (options = {}) => buildMediaBusinessMetrics({
      assets: [...mediaAssetsById.values()],
      jobs: [...mediaAssetsById.values()].map(buildSeedMediaScanJob).filter(Boolean),
      options,
    }),
    getAdminAsset: (id) => {
      const asset = mediaAssetsById.get(String(id)) ?? null
      if (!asset) return null
      return getSeedAdminAsset(asset)
    },
    setAdminAssetArchived: (id, archived, actor) => {
      const asset = mediaAssetsById.get(String(id)) ?? null
      if (!asset) return null
      if (asset.deletedAt) throw new HttpError(409, 'ASSET_DELETED', 'Deleted assets must be recovered before archive changes')
      const now = new Date().toISOString()
      const archivedAt = archived ? (asset.archivedAt ?? now) : null
      const updated = {
        ...asset,
        archivedAt,
        storage: transitionSeedStorage(asset, activeSeedStorageState(asset, { archivedAt }), now),
        updatedAt: now,
      }
      mediaAssetsById.set(updated.id, updated)
      if (archived) for (const [portfolioId, item] of portfolioAssetsById.entries()) if (item.assetId === updated.id && item.status === 'published') portfolioAssetsById.set(portfolioId, { ...item, status: 'withdrawn', withdrawnAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      recordAudit(actor, archived ? 'admin.media.asset.archived' : 'admin.media.asset.restored', 'media_asset', updated.id, { ownerHandle: updated.ownerHandle })
      return getSeedAdminAsset(updated)
    },
    setAdminAssetDeleted: (id, deleted, actor, payload = {}) => {
      const asset = mediaAssetsById.get(String(id)) ?? null
      if (!asset) return null
      const now = new Date().toISOString()
      const deletedAt = deleted ? (asset.deletedAt ?? now) : null
      const updated = {
        ...asset,
        deletedAt,
        deletedByHandle: deleted ? actor.handle : null,
        deletionReason: deleted ? payload.reason ?? 'admin_requested' : null,
        storage: transitionSeedStorage(asset, activeSeedStorageState(asset, { deletedAt }), now, {
          cleanupAfter: deleted ? new Date(Date.now() + getSeedMediaGovernancePolicy().retention.storageCleanupRetentionDays * 86400_000).toISOString() : null,
        }),
        updatedAt: now,
      }
      mediaAssetsById.set(updated.id, updated)
      if (deleted) for (const [portfolioId, item] of portfolioAssetsById.entries()) if (item.assetId === updated.id && item.status === 'published') portfolioAssetsById.set(portfolioId, { ...item, status: 'withdrawn', withdrawnAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      recordAudit(actor, deleted ? 'admin.media.asset.deleted' : 'admin.media.asset.recovered', 'media_asset', updated.id, { ownerHandle: updated.ownerHandle, reason: deleted ? updated.deletionReason : 'admin_recovery' })
      return getSeedAdminAsset(updated)
    },
    createAssetRelation: (sourceAssetId, payload, actor) => {
      const source = mediaAssetsById.get(String(sourceAssetId)) ?? null
      const target = mediaAssetsById.get(String(payload.targetAssetId)) ?? null
      if (!source || !target || source.ownerHandle !== actor.handle || target.ownerHandle !== actor.handle || source.deletedAt || target.deletedAt) return null
      if (source.id === target.id) throw new HttpError(409, 'ASSET_RELATION_CYCLE', 'An asset cannot relate to itself')
      if (payload.relationType === 'reused_as_input' && !assetEligibleForWorkspace(source, payload.targetWorkspace)) {
        throw new HttpError(409, 'ASSET_NOT_REUSABLE', 'Asset is not eligible for the target workspace')
      }
      const graphTypes = new Set(['parent', 'variant'])
      if (graphTypes.has(payload.relationType)) {
        const adjacency = new Map()
        for (const relation of mediaAssetRelationsById.values()) {
          if (!graphTypes.has(relation.relationType)) continue
          adjacency.set(relation.sourceAssetId, [...(adjacency.get(relation.sourceAssetId) ?? []), relation.targetAssetId])
        }
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
      const existing = [...mediaAssetRelationsById.values()].find((item) => item.sourceAssetId === source.id && item.targetAssetId === target.id && item.relationType === payload.relationType && item.targetWorkspace === payload.targetWorkspace && item.role === payload.role)
      if (!existing) {
        const generation = [...creativeGenerationsById.values()].find((item) => item.outputAssetIds?.includes(source.id)) ?? null
        const relation = { id: `asset-relation-${randomUUID()}`, ownerHandle: actor.handle, sourceAssetId: source.id, targetAssetId: target.id, relationType: payload.relationType, sourceGenerationId: generation?.id ?? null, targetWorkspace: payload.targetWorkspace ?? null, role: payload.role ?? null, createdAt: new Date().toISOString() }
        mediaAssetRelationsById.set(relation.id, relation)
        recordAudit(actor, 'media.asset.relation_created', 'media_asset', source.id, { targetAssetId: target.id, relationType: relation.relationType, targetWorkspace: relation.targetWorkspace, role: relation.role })
      }
      return getSeedAssetLibraryItem(source, actor)
    },
    createUpload: (payload, actor) => {
      const now = new Date().toISOString()
      const id = `media-${randomUUID()}`
      const storageConfig = buildStorageConfig()
      if (storageConfig.driver === 's3' && !payload.checksumSha256) {
        throw new HttpError(400, 'STORAGE_CHECKSUM_REQUIRED', 'checksumSha256 is required for S3 uploads')
      }
      const asset = {
        id,
        ownerHandle: actor.handle,
        fileName: payload.fileName,
        storageKey: makeStorageKey(actor, payload, id),
        contentType: payload.contentType,
        sizeBytes: payload.sizeBytes,
        purpose: payload.purpose,
        status: 'pending',
        storage: {
          provider: storageConfig.driver,
          state: 'pending_upload',
          checksumSha256: payload.checksumSha256 ? normalizeStorageChecksumSha256(payload.checksumSha256) : null,
          verifiedSizeBytes: null,
          verifiedContentType: null,
          verifiedAt: null,
          quarantinedAt: null,
          cleanupAfter: null,
          deletedAt: null,
          lastErrorCode: null,
          version: 1,
        },
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
      if (asset.status !== 'pending' && asset.storage && !['pending_upload', 'verification_failed', 'verifying'].includes(asset.storage.state)) {
        return serializeMediaAsset(asset)
      }
      if (!asset.storage) throw new HttpError(409, 'STORAGE_OBJECT_STATE_MISSING', 'Storage object lifecycle state is missing')
      if (asset.storage.state === 'verifying') throw new HttpError(409, 'UPLOAD_COMPLETION_IN_PROGRESS', 'Upload completion is already in progress')
      Object.assign(asset.storage, {
        state: 'verifying',
        lastErrorCode: null,
        version: asset.storage.version + 1,
      })
      let inspection
      try {
        inspection = await inspectStorageObject({ ...asset, checksumSha256: asset.storage.checksumSha256 })
      } catch (error) {
        const reasonCode = error instanceof StorageObjectError ? error.code : 'STORAGE_VERIFICATION_FAILED'
        Object.assign(asset.storage, { state: 'verification_failed', lastErrorCode: reasonCode, version: asset.storage.version + 1 })
        recordAudit(actor, 'media.upload.verification_failed', 'media_asset', asset.id, { purpose: asset.purpose, reasonCode })
        throw new HttpError(error instanceof StorageObjectError && error.retryable ? 503 : 409, 'MEDIA_STORAGE_VERIFICATION_FAILED', 'Uploaded object could not be verified', { reasonCode })
      }
      Object.assign(asset.storage, {
        state: 'verifying',
        etag: inspection.etag,
        checksumSha256: inspection.checksumSha256 ?? asset.storage.checksumSha256,
        verifiedSizeBytes: inspection.sizeBytes,
        verifiedContentType: inspection.contentType,
        verifiedAt: inspection.verifiedAt,
        lastErrorCode: null,
        version: asset.storage.version + 1,
      })
      const detectedContentType = payload.detectedContentType || asset.contentType
      const contentTypeMatches = detectedContentType.toLowerCase() === asset.contentType.toLowerCase()
      const scanResult = contentTypeMatches ? await scanMediaAsset(asset) : null
      const updated = {
        ...asset,
        status: contentTypeMatches && scanResult?.status !== 'rejected' ? 'uploaded' : 'rejected',
        storage: {
          ...asset.storage,
          state: contentTypeMatches && scanResult?.status === 'clean' ? 'available' : 'quarantined',
          quarantinedAt: contentTypeMatches && scanResult?.status === 'clean' ? null : new Date().toISOString(),
          version: asset.storage.version + 1,
        },
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
        storage: {
          provider: storage.provider,
          state: 'quarantined',
          checksumSha256: storage.checksumSha256,
          verifiedSizeBytes: storage.bytes,
          verifiedContentType: payload.artifact.contentType,
          verifiedAt: storage.writtenAt,
          quarantinedAt: storage.writtenAt,
          cleanupAfter: null,
          deletedAt: null,
          lastErrorCode: null,
          version: 1,
        },
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
        storage: transitionSeedStorage(asset, effectiveScanStatus === 'clean' ? 'available' : 'quarantined'),
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
    createIngestedAsset: async (payload, actor) => {
      const existing = [...mediaAssetsById.values()].find((asset) => asset.storageKey === payload.storageKey) ?? null
      if (existing) return serializeMediaAsset(existing)
      const now = new Date().toISOString()
      const storage = await writeStorageObject({
        body: payload.body,
        contentType: payload.contentType,
        storageKey: payload.storageKey,
      })
      const asset = {
        id: payload.assetId,
        ownerHandle: actor.handle,
        fileName: payload.fileName,
        storageKey: payload.storageKey,
        contentType: payload.contentType,
        sizeBytes: storage.bytes,
        purpose: 'library_asset',
        status: 'pending',
        storage: {
          provider: storage.provider,
          state: 'quarantined',
          checksumSha256: storage.checksumSha256,
          verifiedSizeBytes: storage.bytes,
          verifiedContentType: payload.contentType,
          verifiedAt: storage.writtenAt,
          quarantinedAt: storage.writtenAt,
          cleanupAfter: null,
          deletedAt: null,
          lastErrorCode: null,
          version: 1,
        },
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
        createdAt: now,
        updatedAt: now,
      }
      mediaAssetsById.set(asset.id, asset)
      const scanResult = await scanMediaAsset(asset)
      const policyReviewRequired = Boolean(payload.generation.safety?.reviewRequired)
      const effectiveScanStatus = policyReviewRequired ? 'review' : scanResult?.status ?? 'pending'
      const updated = {
        ...asset,
        status: effectiveScanStatus === 'rejected' ? 'rejected' : 'uploaded',
        storage: transitionSeedStorage(asset, effectiveScanStatus === 'clean' ? 'available' : 'quarantined'),
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
          completedAt: now,
        }),
        updatedAt: now,
      }
      mediaAssetsById.set(updated.id, updated)
      recordAudit(actor, 'media.provider_output_ingested', 'media_asset', updated.id, {
        generationId: payload.generation.id,
        outputId: payload.output.id,
        providerId: payload.generation.provider?.id ?? payload.generation.providerId,
        sourceKey: payload.sourceKey,
        contentType: payload.contentType,
        sizeBytes: payload.sizeBytes,
        sha256: payload.sha256,
        scanStatus: effectiveScanStatus,
      })
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
        storage: transitionSeedStorage(asset, payload.decision === 'clean' && !asset.archivedAt && !asset.deletedAt ? 'available' : 'quarantined', now),
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
      const expectedExternalScanId = String(asset.metadata?.security?.externalScanId ?? '')
      if (!payload.externalScanId || (expectedExternalScanId && payload.externalScanId !== expectedExternalScanId)) {
        recordAudit(null, 'media.scan.callback_conflict', 'media_asset', asset.id, { reasonCode: 'external_scan_id_mismatch' })
        throw new HttpError(409, 'MEDIA_SCAN_CALLBACK_MISMATCH', 'Scan callback does not match the active scan attempt')
      }
      if (asset.metadata?.security?.callbackReceivedAt) {
        if (asset.metadata.security.scanStatus !== payload.status) {
          recordAudit(null, 'media.scan.callback_conflict', 'media_asset', asset.id, { reasonCode: 'terminal_result_mismatch' })
          throw new HttpError(409, 'MEDIA_SCAN_CALLBACK_CONFLICT', 'Scan callback conflicts with the recorded result')
        }
        return serializeMediaAsset(asset)
      }
      const now = new Date().toISOString()
      const updated = {
        ...asset,
        status: payload.status === 'rejected' ? 'rejected' : 'uploaded',
        storage: transitionSeedStorage(asset, payload.status === 'clean' && !asset.archivedAt && !asset.deletedAt ? 'available' : 'quarantined', now),
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
        storage: transitionSeedStorage(asset, 'quarantined'),
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
    cleanupStorageObjects: async ({ actor = null, limit = 25, now = new Date() } = {}) => {
      const candidates = [...mediaAssetsById.values()]
        .filter((asset) => asset.storage?.state === 'cleanup_pending' && asset.storage.cleanupAfter && new Date(asset.storage.cleanupAfter) <= now)
        .sort((left, right) => left.storage.cleanupAfter.localeCompare(right.storage.cleanupAfter) || left.id.localeCompare(right.id))
        .slice(0, Math.min(Math.max(Number(limit), 1), 100))
      const items = []
      let deleted = 0
      let failed = 0
      for (const asset of candidates) {
        asset.storage = transitionSeedStorage(asset, 'deleting', now.toISOString())
        try {
          const result = await deleteStorageObject(asset)
          asset.storage = transitionSeedStorage(asset, 'deleted', result.deletedAt, {
            cleanupAfter: null,
            deletedAt: result.deletedAt,
            lastErrorCode: null,
          })
          recordAudit(actor, 'media.storage.deleted', 'media_asset', asset.id, { provider: result.provider, retentionDays: getSeedMediaGovernancePolicy().retention.storageCleanupRetentionDays })
          deleted += 1
          items.push({ assetId: asset.id, status: 'deleted', provider: result.provider })
        } catch (error) {
          const reasonCode = error instanceof StorageObjectError ? error.code : 'STORAGE_DELETE_FAILED'
          asset.storage = transitionSeedStorage(asset, 'cleanup_pending', now.toISOString(), { lastErrorCode: reasonCode })
          recordAudit(actor, 'media.storage.cleanup_failed', 'media_asset', asset.id, { provider: asset.storage.provider, reasonCode })
          failed += 1
          items.push({ assetId: asset.id, status: 'failed', reasonCode })
        }
      }
      const result = { inspected: candidates.length, deleted, failed, limit: Math.min(Math.max(Number(limit), 1), 100), items }
      if (failed > 0) throw new HttpError(503, 'MEDIA_STORAGE_CLEANUP_PARTIAL_FAILURE', 'One or more storage objects could not be cleaned up', result)
      return result
    },
    createDownload: (id, actor) => {
      const asset = mediaAssetsById.get(String(id)) ?? null
      if (!asset || !canAccessOwnedResource(asset.ownerHandle, actor) || asset.status !== 'uploaded' || asset.metadata?.security?.scanStatus !== 'clean' || (asset.storage && asset.storage.state !== 'available') || asset.archivedAt || asset.deletedAt) {
        return null
      }
      recordAudit(actor, 'media.download.signed', 'media_asset', asset.id, {
        purpose: asset.purpose,
      })
      return makeDownloadContract(asset)
    },
  },
  adminReviews: {
    create: (payload, actor) => {
      const review = {
        id: payload.id ?? `review-${randomUUID()}`,
        queue: payload.queue,
        status: payload.status ?? 'Pending review',
        title: payload.title,
        owner: payload.owner,
        note: payload.note ?? '',
        decision: undefined,
        reviewedBy: null,
        reviewedAt: null,
        metadata: payload.metadata ?? null,
        createdAt: payload.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      adminReviewQueue.unshift(review)
      adminReviewById.set(review.id, review)
      recordAudit(actor, 'admin.review.requested', 'admin_review', review.id, {
        queue: review.queue,
        kind: review.metadata?.kind ?? null,
      })
      return serializeAdminReview(review)
    },
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
      if (reviewed.metadata?.kind === 'task_dispute') {
        const task = getTaskById(reviewed.metadata.taskId)
        const submission = taskSubmissions.find((entry) => entry.id === reviewed.metadata.submissionId) ?? null
        if (!task || !submission || submission.status !== 'disputed') {
          throw new HttpError(409, 'TASK_DISPUTE_NOT_REVIEWABLE', 'Task dispute is no longer pending review')
        }
        const disputeApproved = action.decision === 'approve'
        submission.status = disputeApproved ? 'revision_requested' : 'rejected'
        submission.dispute = {
          ...(submission.dispute ?? reviewed.metadata),
          outcome: disputeApproved ? 'creator_revision_allowed' : 'publisher_rejection_upheld',
          resolvedBy: actor.handle,
          resolvedAt: reviewed.reviewedAt,
          resolutionNote: reviewed.note,
        }
        const resolvedTask = updateTask(task.id, (entry) => ({
          ...entry,
          status: disputeApproved ? 'In Progress' : 'Rejected',
          disputeStatus: disputeApproved ? 'approved' : 'rejected',
          disputeReason: reviewed.metadata.reason,
          disputeReviewId: reviewed.id,
          reviewNote: reviewed.note,
        }), () => true)
        if (!disputeApproved) finalizeTaskEscrow(task, getHandle(task.publisher), 'reject')
        reviewed.metadata = {
          ...reviewed.metadata,
          outcome: submission.dispute.outcome,
          resolvedTaskStatus: resolvedTask?.status ?? null,
          resolvedSubmissionStatus: submission.status,
          resolvedBy: actor.handle,
          resolvedAt: reviewed.reviewedAt,
        }
        createNotificationsForHandles(uniqueHandles([reviewed.metadata.creatorHandle, reviewed.metadata.publisherHandle]), {
          type: disputeApproved ? 'task.dispute_approved' : 'task.dispute_rejected',
          title: disputeApproved ? `Task dispute approved: ${task.title}` : `Task dispute rejected: ${task.title}`,
          body: disputeApproved
            ? `${task.title} was reopened for a revised submission.`
            : `${task.title} rejection was upheld and escrow was released.`,
          resourceType: 'task',
          resourceId: String(task.id),
          metadata: {
            taskId: String(task.id),
            submissionId: submission.id,
            adminReviewId: reviewed.id,
            outcome: submission.dispute.outcome,
            target: taskNotificationTarget('mine'),
          },
          dedupeUnread: true,
        })
        recordAudit(actor, 'task.dispute.resolved', 'task', task.id, {
          adminReviewId: reviewed.id,
          submissionId: submission.id,
          decision: action.decision,
          outcome: submission.dispute.outcome,
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
  moderationCases,
  safetyOperations,
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
    findAccessibleChatContext: (id, actor) => {
      const item = libraryItemsById.get(String(id)) ?? null
      if (!item || item.ownerHandle !== actor.handle) return null
      return { title: item.title, content: item.text }
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
  }
}
