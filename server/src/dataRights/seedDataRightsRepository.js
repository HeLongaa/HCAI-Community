import { randomUUID } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'
import { writeJsonArchive } from '../storage/archiveWriter.js'
import {
  assertDataRightsIdentity,
  assertDataRightsLegalHoldWindow,
  assertDataRightsTransition,
  buildDataExportPackage,
  buildDeletionPlan,
  dataRightsDueAt,
  dataRightsEvidenceHash,
  dataRightsRequiredBackupClasses,
  dataRightsSafeSubjectRef,
} from './dataRightsLifecycle.js'
import { buildProviderDeletionTargets, createProviderDeletionGateway, providerDeletionReceipt } from './providerDeletionGateway.js'
import { deleteDataRightsExportObject } from './exportArtifactRetention.js'

const dayMs = 86400_000
const activeStatuses = new Set(['identity_verified', 'processing', 'primary_completed', 'blocked'])
const iso = (value) => value?.toISOString?.() ?? value ?? null

const actorRef = (actor) => `actor_${dataRightsEvidenceHash({ actorId: actor.id }).slice(0, 24)}`
const legalHoldRef = (id) => `hold_${dataRightsEvidenceHash({ legalHoldId: id }).slice(0, 24)}`
const legalHoldCutoffStatuses = new Set(['processing', 'primary_completed', 'completed'])

const requestDto = (request, events, artifacts, deletionReceipts, backupReceipts) => ({
  id: request.id,
  subjectRef: request.subjectRef,
  requestType: request.requestType,
  status: request.status,
  reasonCode: request.reasonCode,
  identityMethod: request.identityMethod,
  identityVerifiedAt: iso(request.identityVerifiedAt),
  dueAt: iso(request.dueAt),
  primaryCompletedAt: iso(request.primaryCompletedAt),
  completedAt: iso(request.completedAt),
  cancelledAt: iso(request.cancelledAt),
  blockedReasonCode: request.blockedReasonCode,
  version: request.version,
  createdAt: iso(request.createdAt),
  updatedAt: iso(request.updatedAt),
  artifact: artifacts.find((item) => item.requestId === request.id) ?? null,
  events: events.filter((item) => item.requestId === request.id).map((item) => ({ ...item, createdAt: iso(item.createdAt) })),
  deletionReceipts: deletionReceipts.filter((item) => item.requestId === request.id).map((item) => ({ ...item, createdAt: iso(item.createdAt), retentionExpiresAt: iso(item.retentionExpiresAt) })),
  backupReceipts: backupReceipts.filter((item) => item.requestId === request.id).map((item) => ({ ...item, createdAt: iso(item.createdAt), expiredAt: iso(item.expiredAt) })),
})

export const createSeedDataRightsRepository = ({
  accountForActor = (actor) => ({ ...actor, accountVersion: Number(actor.accountVersion ?? 1) }),
  snapshotForActor = async (actor) => ({ account: { id: actor.id, handle: actor.handle, role: actor.role } }),
  applyDeletion = async () => ({}),
  listProviderDeletionRecords = async () => [],
  dispatchProviderDeletion = null,
  scheduleDeletion = async () => {},
  cancelDeletion = async () => {},
  recordAudit = () => {},
  archiveWriter = writeJsonArchive,
  exportObjectDeleter = null,
  source = {},
} = {}) => {
  const requests = []
  const events = []
  const artifacts = []
  const deletionReceipts = []
  const backupReceipts = []
  const legalHolds = []
  const legalHoldEvents = []
  const exportPackages = new Map()
  const providerDeletionGateway = dispatchProviderDeletion ?? createProviderDeletionGateway({ source })

  const legalHoldDto = (hold, now = new Date()) => ({
    id: hold.id,
    subjectRef: hold.subjectRef,
    scopeDomain: hold.scopeDomain,
    reasonCode: hold.reasonCode,
    authorityRole: hold.authorityRole,
    authorityReferenceHash: hold.authorityReferenceHash,
    ownerRef: hold.ownerRef,
    reviewAt: iso(hold.reviewAt),
    expiresAt: iso(hold.expiresAt),
    releasedAt: iso(hold.releasedAt),
    releaseReasonCode: hold.releaseReasonCode,
    releasedByRef: hold.releasedByRef,
    version: hold.version,
    status: hold.releasedAt ? 'released' : hold.expiresAt <= now ? 'expired' : 'active',
    createdAt: iso(hold.createdAt),
    updatedAt: iso(hold.updatedAt),
    events: legalHoldEvents.filter((item) => item.legalHoldId === hold.id).map((item) => ({ ...item, createdAt: iso(item.createdAt) })),
  })

  const appendLegalHoldEvent = (hold, actor, eventType, reasonCode, now) => {
    const sequence = legalHoldEvents.filter((item) => item.legalHoldId === hold.id).length + 1
    const evidence = { legalHoldId: hold.id, sequence, eventType, reasonCode }
    legalHoldEvents.push({ id: randomUUID(), legalHoldId: hold.id, sequence, eventType, actorRef: actorRef(actor), reasonCode, evidenceHash: dataRightsEvidenceHash(evidence), createdAt: now })
  }

  const activeLegalHolds = (subjectId, now) => legalHolds.filter((item) => item.subjectId === subjectId && item.releasedAt == null && item.expiresAt > now)

  const assertLegalHoldBeforeDeletionCutoff = (subject, scopeDomain) => {
    if (subject.status === 'deleted') {
      throw new HttpError(409, 'DATA_RIGHTS_LEGAL_HOLD_CUTOFF_PASSED', 'Account deletion has already passed the legal hold creation cutoff')
    }
    const deletion = requests
      .filter((item) => item.subjectId === subject.id && item.requestType === 'account_deletion' && item.status !== 'cancelled')
      .sort((left, right) => right.createdAt - left.createdAt)[0]
    if (!deletion) return
    const receipts = deletionReceipts.filter((item) => item.requestId === deletion.id)
    const scopeDeleted = receipts.some((receipt) => receipt.domain === scopeDomain)
      || (scopeDomain === 'creative' && receipts.some((receipt) => receipt.domain.startsWith('provider:')))
    const providerDispatchUncertain = deletion.status === 'blocked' && deletion.blockedReasonCode === 'provider_deletion_failed'
    if (legalHoldCutoffStatuses.has(deletion.status) || providerDispatchUncertain || scopeDeleted) {
      throw new HttpError(409, 'DATA_RIGHTS_LEGAL_HOLD_CUTOFF_PASSED', 'Account deletion has already passed the legal hold creation cutoff')
    }
  }

  const appendEvent = (request, actor, eventType, reasonCode, { fromStatus = null, toStatus = null, metadata = null, now = new Date() } = {}) => {
    const sequence = events.filter((item) => item.requestId === request.id).length + 1
    const evidence = { requestId: request.id, sequence, eventType, reasonCode, fromStatus, toStatus, metadata }
    const event = { id: randomUUID(), requestId: request.id, sequence, eventType, actorRef: actorRef(actor), reasonCode, fromStatus, toStatus, evidenceHash: dataRightsEvidenceHash(evidence), metadata, createdAt: now }
    events.push(event)
    return event
  }

  const detail = (request) => requestDto(request, events, artifacts, deletionReceipts, backupReceipts)
  const owned = (actor, id) => requests.find((item) => item.id === id && item.subjectId === actor.id) ?? null

  const transition = (request, actor, toStatus, reasonCode, now, metadata = null) => {
    assertDataRightsTransition(request.status, toStatus)
    const fromStatus = request.status
    request.status = toStatus
    request.version += 1
    request.updatedAt = now
    request.blockedReasonCode = toStatus === 'blocked' ? reasonCode : null
    if (toStatus === 'primary_completed') request.primaryCompletedAt = now
    if (toStatus === 'completed') request.completedAt = now
    if (toStatus === 'cancelled') request.cancelledAt = now
    appendEvent(request, actor, 'status_transitioned', reasonCode, { fromStatus, toStatus, metadata, now })
  }

  return {
    createLegalHold: async (operator, payload, now = new Date()) => {
      assertDataRightsLegalHoldWindow(payload, now)
      const subject = await accountForActor({ id: payload.subjectId })
      if (!subject) throw new HttpError(404, 'DATA_RIGHTS_LEGAL_HOLD_SUBJECT_NOT_FOUND', 'Legal hold subject was not found')
      assertLegalHoldBeforeDeletionCutoff(subject, payload.scopeDomain)
      const hold = {
        id: randomUUID(), subjectId: payload.subjectId, subjectRef: dataRightsSafeSubjectRef(payload.subjectId),
        scopeDomain: payload.scopeDomain, reasonCode: payload.reasonCode, authorityRole: payload.authorityRole,
        authorityReferenceHash: payload.authorityReferenceHash, ownerRef: actorRef(operator), reviewAt: payload.reviewAt,
        expiresAt: payload.expiresAt, releasedAt: null, releaseReasonCode: null, releasedByRef: null,
        version: 1, createdAt: now, updatedAt: now,
      }
      legalHolds.push(hold)
      appendLegalHoldEvent(hold, operator, 'legal_hold_created', payload.reasonCode, now)
      await recordAudit({ actor: operator, action: 'admin.data_rights.legal_hold_created', resourceType: 'data_rights_legal_hold', resourceId: hold.id, metadata: { subjectRef: hold.subjectRef, scopeDomain: hold.scopeDomain, reviewAt: hold.reviewAt, expiresAt: hold.expiresAt } })
      return legalHoldDto(hold, now)
    },
    listLegalHolds: async (query = {}, operator = null, now = new Date()) => {
      const rows = legalHolds
        .filter((item) => !query.subjectId || item.subjectId === query.subjectId)
        .filter((item) => query.status === 'all' || legalHoldDto(item, now).status === query.status)
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, query.limit ?? 50)
      await recordAudit({ actor: operator, action: 'admin.data_rights.legal_holds_listed', resourceType: 'data_rights_legal_hold', resourceId: 'registry', metadata: { status: query.status ?? 'active', limit: query.limit ?? 50 } })
      return rows.map((item) => legalHoldDto(item, now))
    },
    releaseLegalHold: async (operator, id, payload, now = new Date()) => {
      const hold = legalHolds.find((item) => item.id === id)
      if (!hold) return null
      if (hold.version !== payload.expectedVersion) throw new HttpError(409, 'DATA_RIGHTS_LEGAL_HOLD_VERSION_CONFLICT', 'Legal hold was updated by another operation')
      if (hold.releasedAt) throw new HttpError(409, 'DATA_RIGHTS_LEGAL_HOLD_RELEASED', 'Legal hold has already been released')
      hold.releasedAt = now
      hold.releaseReasonCode = payload.reasonCode
      hold.releasedByRef = actorRef(operator)
      hold.version += 1
      hold.updatedAt = now
      appendLegalHoldEvent(hold, operator, 'legal_hold_released', payload.reasonCode, now)
      await recordAudit({ actor: operator, action: 'admin.data_rights.legal_hold_released', resourceType: 'data_rights_legal_hold', resourceId: hold.id, metadata: { subjectRef: hold.subjectRef, scopeDomain: hold.scopeDomain, version: hold.version } })
      return legalHoldDto(hold, now)
    },
    create: async (actor, payload, { sessionIssuedAt, now = new Date() } = {}) => {
      const account = await accountForActor(actor)
      const identity = assertDataRightsIdentity({ actor, account, payload, sessionIssuedAt, now })
      const recent = requests.filter((item) => item.subjectId === actor.id && item.createdAt >= new Date(now.getTime() - 30 * dayMs))
      if (recent.length >= 3) throw new HttpError(429, 'DATA_RIGHTS_RATE_LIMITED', 'No more than three data rights requests are allowed per 30 days')
      if (recent.some((item) => item.requestType === payload.requestType && activeStatuses.has(item.status))) {
        throw new HttpError(409, 'DATA_RIGHTS_REQUEST_ACTIVE', 'An active request of this type already exists')
      }
      const request = {
        id: randomUUID(), subjectId: actor.id, subjectRef: dataRightsSafeSubjectRef(actor.id), requestType: payload.requestType,
        status: 'identity_verified', reasonCode: payload.reasonCode, identityMethod: identity.method,
        identityVerifiedAt: now, dueAt: dataRightsDueAt(payload.requestType, now), primaryCompletedAt: null,
        completedAt: null, cancelledAt: null, blockedReasonCode: null, version: 1, createdAt: now, updatedAt: now,
      }
      requests.push(request)
      appendEvent(request, actor, 'request_created', payload.reasonCode, { toStatus: request.status, metadata: { requestType: request.requestType, identityMethod: request.identityMethod }, now })
      if (payload.requestType === 'account_deletion') await scheduleDeletion(actor, payload, request)
      recordAudit({ actor, action: 'data_rights.request_created', resourceType: 'data_rights_request', resourceId: request.id, metadata: { requestType: request.requestType, status: request.status } })
      return detail(request)
    },
    listOwn: async (actor) => requests.filter((item) => item.subjectId === actor.id).sort((a, b) => b.createdAt - a.createdAt).map(detail),
    getOwn: async (actor, id) => {
      const request = owned(actor, id)
      return request ? detail(request) : null
    },
    cancelOwn: async (actor, id, { expectedVersion, reasonCode }, now = new Date()) => {
      const request = owned(actor, id)
      if (!request) return null
      if (request.version !== expectedVersion) throw new HttpError(409, 'DATA_RIGHTS_VERSION_CONFLICT', 'Data rights request was updated by another operation')
      transition(request, actor, 'cancelled', reasonCode, now)
      if (request.requestType === 'account_deletion') await cancelDeletion(actor, request)
      recordAudit({ actor, action: 'data_rights.request_cancelled', resourceType: 'data_rights_request', resourceId: request.id, metadata: { requestType: request.requestType, version: request.version } })
      return detail(request)
    },
    listAdmin: async (query = {}, actor = null) => {
      await recordAudit({ actor, action: 'admin.data_rights.listed', resourceType: 'data_rights_request', resourceId: 'queue', metadata: { status: query.status ?? null, requestType: query.requestType ?? null, limit: query.limit ?? 50 } })
      return requests
        .filter((item) => !query.status || item.status === query.status)
        .filter((item) => !query.requestType || item.requestType === query.requestType)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, query.limit ?? 50)
        .map(detail)
    },
    getAdmin: async (id, actor = null) => {
      const request = requests.find((item) => item.id === id)
      if (request) await recordAudit({ actor, action: 'admin.data_rights.viewed', resourceType: 'data_rights_request', resourceId: request.id, metadata: { requestType: request.requestType, status: request.status } })
      return request ? detail(request) : null
    },
    process: async (operator, id, { expectedVersion, reasonCode }, now = new Date()) => {
      const request = requests.find((item) => item.id === id)
      if (!request) return null
      if (request.version !== expectedVersion) throw new HttpError(409, 'DATA_RIGHTS_VERSION_CONFLICT', 'Data rights request was updated by another operation')
      if (request.requestType === 'account_deletion' && now < request.dueAt) throw new HttpError(409, 'DATA_RIGHTS_GRACE_PERIOD_ACTIVE', 'Account deletion grace period has not elapsed')
      if (request.status !== 'processing') transition(request, operator, 'processing', reasonCode, now)
      if (request.requestType === 'data_export') {
        const owner = await accountForActor({ id: request.subjectId })
        const built = buildDataExportPackage({ requestId: request.id, subjectRef: request.subjectRef, snapshot: await snapshotForActor(owner), generatedAt: now })
        const storageKey = `exports/data-rights/${request.subjectRef}/${request.id}.json`
        const storage = await archiveWriter(built.package, { now, source, storageKey })
        const artifact = { id: randomUUID(), requestId: request.id, storageKey, checksumSha256: built.checksumSha256, sizeBytes: built.sizeBytes, expiresAt: built.expiresAt, createdAt: now, persisted: storage.persisted }
        artifacts.push(artifact)
        exportPackages.set(request.id, built.package)
        transition(request, operator, 'completed', reasonCode, now, { checksumSha256: artifact.checksumSha256, sizeBytes: artifact.sizeBytes })
      } else {
        const holds = activeLegalHolds(request.subjectId, now)
        const heldScopes = new Set(holds.map((hold) => hold.scopeDomain))
        const completedScopes = new Set(deletionReceipts.filter((receipt) => receipt.requestId === request.id && !receipt.domain.startsWith('provider:')).map((receipt) => receipt.domain))
        const excludedScopes = new Set([...heldScopes, ...completedScopes])
        let externalReceipts = []
        try {
          const targets = heldScopes.has('creative') || completedScopes.has('creative') ? [] : buildProviderDeletionTargets(await listProviderDeletionRecords(request))
          externalReceipts = []
          for (const target of targets) {
            const result = await providerDeletionGateway({ requestId: request.id, subjectRef: request.subjectRef, target, now })
            externalReceipts.push(providerDeletionReceipt({ requestId: request.id, result, now }))
          }
        } catch (error) {
          transition(request, operator, 'blocked', 'provider_deletion_failed', now, { errorCode: String(error?.code ?? 'DATA_RIGHTS_PROVIDER_DELETION_FAILED').slice(0, 96) })
          recordAudit({ actor: operator, action: 'admin.data_rights.provider_deletion_blocked', resourceType: 'data_rights_request', resourceId: request.id, metadata: { status: request.status, errorCode: String(error?.code ?? 'DATA_RIGHTS_PROVIDER_DELETION_FAILED').slice(0, 96) } })
          throw error
        }
        const plan = buildDeletionPlan({ requestId: request.id, subjectRef: request.subjectRef, primaryCompletedAt: now })
        const eligibleReceipts = plan.receipts.filter((receipt) => !excludedScopes.has(receipt.domain))
        const partialPlan = { ...plan, receipts: eligibleReceipts }
        const counts = await applyDeletion(request, partialPlan, now)
        for (const receipt of eligibleReceipts.filter((candidate) => !deletionReceipts.some((existing) => existing.requestId === request.id && existing.domain === candidate.domain))) {
          deletionReceipts.push({ id: randomUUID(), requestId: request.id, ...receipt, recordCount: Number(counts[receipt.domain] ?? 0), retentionExpiresAt: receipt.disposition === 'retained_minimal' ? new Date(now.getTime() + 7 * 365 * dayMs) : null, evidenceHash: dataRightsEvidenceHash({ requestId: request.id, ...receipt, recordCount: Number(counts[receipt.domain] ?? 0) }), createdAt: now })
        }
        deletionReceipts.push(...externalReceipts.filter((candidate) => !deletionReceipts.some((existing) => existing.requestId === request.id && existing.domain === candidate.domain)).map((receipt) => ({ id: randomUUID(), requestId: request.id, ...receipt })))
        if (holds.length) {
          const metadata = {
            legalHoldRefs: holds.map((hold) => legalHoldRef(hold.id)),
            scopeDomains: [...heldScopes].sort(),
            nextExpiryAt: holds.map((hold) => hold.expiresAt).sort((left, right) => left - right)[0].toISOString(),
          }
          transition(request, operator, 'blocked', 'legal_hold_active', now, metadata)
          await recordAudit({ actor: operator, action: 'admin.data_rights.legal_hold_blocked_deletion', resourceType: 'data_rights_request', resourceId: request.id, metadata })
          throw new HttpError(409, 'DATA_RIGHTS_LEGAL_HOLD_ACTIVE', 'Account deletion retained scoped data while unrelated domains were processed', metadata)
        }
        transition(request, operator, 'primary_completed', reasonCode, now, { backupExpiryDueAt: plan.backupExpiryDueAt })
      }
      recordAudit({ actor: operator, action: 'admin.data_rights.processed', resourceType: 'data_rights_request', resourceId: request.id, metadata: { requestType: request.requestType, status: request.status, version: request.version } })
      return detail(request)
    },
    recordBackupReceipt: async (operator, id, payload, now = new Date()) => {
      const request = requests.find((item) => item.id === id)
      if (!request) return null
      if (request.status !== 'primary_completed') throw new HttpError(409, 'DATA_RIGHTS_PRIMARY_NOT_COMPLETED', 'Primary deletion must complete before backup evidence')
      if (!dataRightsRequiredBackupClasses.includes(payload.backupClass)) throw new HttpError(400, 'VALIDATION_FAILED', `backupClass must be one of: ${dataRightsRequiredBackupClasses.join(', ')}`)
      const dueAt = new Date(request.primaryCompletedAt.getTime() + 35 * dayMs)
      if (payload.expiredAt < dueAt || now < dueAt) throw new HttpError(409, 'DATA_RIGHTS_BACKUP_EXPIRY_PENDING', 'Backup expiry evidence is not yet due')
      if (backupReceipts.some((item) => item.requestId === request.id && item.backupClass === payload.backupClass)) throw new HttpError(409, 'DATA_RIGHTS_BACKUP_RECEIPT_EXISTS', 'Backup expiry receipt already exists')
      backupReceipts.push({ id: randomUUID(), requestId: request.id, ...payload, createdAt: now })
      appendEvent(request, operator, 'backup_expiry_recorded', 'backup_expiry_verified', { metadata: { backupClass: payload.backupClass, evidenceHash: payload.evidenceHash }, now })
      const completedClasses = new Set(backupReceipts.filter((item) => item.requestId === request.id).map((item) => item.backupClass))
      if (dataRightsRequiredBackupClasses.every((item) => completedClasses.has(item))) transition(request, operator, 'completed', 'all_backup_expiry_verified', now)
      recordAudit({ actor: operator, action: 'admin.data_rights.backup_expiry_recorded', resourceType: 'data_rights_request', resourceId: request.id, metadata: { backupClass: payload.backupClass, status: request.status } })
      return detail(request)
    },
    exportPackage: async (actor, id, now = new Date()) => {
      const request = owned(actor, id)
      const artifact = artifacts.find((item) => item.requestId === id)
      if (!request || !artifact || request.status !== 'completed') return null
      if (new Date(artifact.expiresAt) <= now) throw new HttpError(410, 'DATA_EXPORT_EXPIRED', 'Data export artifact has expired')
      await recordAudit({ actor, action: 'data_rights.export_downloaded', resourceType: 'data_rights_request', resourceId: request.id, metadata: { checksumSha256: artifact.checksumSha256, expiresAt: artifact.expiresAt } })
      return { artifact, package: structuredClone(exportPackages.get(id)) }
    },
    sweepExpiredExports: async ({ now = new Date(), limit = 25 } = {}) => {
      const boundedLimit = Math.max(1, Math.min(Number.parseInt(limit, 10) || 25, 100))
      const due = artifacts
        .filter((item) => new Date(item.expiresAt) <= now)
        .sort((left, right) => new Date(left.expiresAt) - new Date(right.expiresAt) || left.id.localeCompare(right.id))
        .slice(0, boundedLimit)
      const failures = []
      let deleted = 0
      for (const artifact of due) {
        try {
          const receipt = await deleteDataRightsExportObject(artifact, { now, source, deleteObject: exportObjectDeleter ?? undefined })
          const index = artifacts.findIndex((item) => item.id === artifact.id && new Date(item.expiresAt) <= now)
          if (index < 0) continue
          artifacts.splice(index, 1)
          exportPackages.delete(artifact.requestId)
          const request = requests.find((item) => item.id === artifact.requestId)
          if (request) appendEvent(request, { id: 'system-data-rights-retention' }, 'export_artifact_expired', 'export_retention_elapsed', {
            metadata: { artifactId: artifact.id, receiptHash: receipt.receiptHash },
            now,
          })
          await recordAudit({
            actor: null,
            action: 'data_rights.export_artifact_expired',
            resourceType: 'data_rights_request',
            resourceId: artifact.requestId,
            metadata: { artifactId: artifact.id, receiptHash: receipt.receiptHash },
          })
          deleted += 1
        } catch (error) {
          failures.push({ artifactId: artifact.id, errorCode: String(error?.code ?? 'DATA_EXPORT_RETENTION_DELETE_FAILED').slice(0, 96) })
        }
      }
      const result = { inspected: due.length, due: due.length, deleted, failed: failures.length, failures }
      if (failures.length > 0) throw new HttpError(503, 'DATA_EXPORT_RETENTION_PARTIAL_FAILURE', 'One or more expired data export artifacts could not be deleted', result)
      return result
    },
    metrics: async (actor = null) => {
      await recordAudit({ actor, action: 'admin.data_rights.metrics_viewed', resourceType: 'data_rights_request', resourceId: 'metrics', metadata: {} })
      return {
        total: requests.length,
        active: requests.filter((item) => activeStatuses.has(item.status)).length,
        completed: requests.filter((item) => item.status === 'completed').length,
        overdue: requests.filter((item) => activeStatuses.has(item.status) && item.dueAt < new Date()).length,
        byType: Object.fromEntries(['data_export', 'account_deletion'].map((type) => [type, requests.filter((item) => item.requestType === type).length])),
        byStatus: Object.fromEntries([...new Set(requests.map((item) => item.status))].map((status) => [status, requests.filter((item) => item.status === status).length])),
      }
    },
  }
}
