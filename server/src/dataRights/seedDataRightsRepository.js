import { randomUUID } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'
import { writeJsonArchive } from '../storage/archiveWriter.js'
import {
  assertDataRightsIdentity,
  assertDataRightsTransition,
  buildDataExportPackage,
  buildDeletionPlan,
  dataRightsDueAt,
  dataRightsEvidenceHash,
  dataRightsRequiredBackupClasses,
  dataRightsSafeSubjectRef,
} from './dataRightsLifecycle.js'

const dayMs = 86400_000
const activeStatuses = new Set(['identity_verified', 'processing', 'primary_completed', 'blocked'])
const iso = (value) => value?.toISOString?.() ?? value ?? null

const actorRef = (actor) => `actor_${dataRightsEvidenceHash({ actorId: actor.id }).slice(0, 24)}`

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
  scheduleDeletion = async () => {},
  cancelDeletion = async () => {},
  recordAudit = () => {},
  archiveWriter = writeJsonArchive,
  source = {},
} = {}) => {
  const requests = []
  const events = []
  const artifacts = []
  const deletionReceipts = []
  const backupReceipts = []
  const exportPackages = new Map()

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
        const plan = buildDeletionPlan({ requestId: request.id, subjectRef: request.subjectRef, primaryCompletedAt: now })
        const counts = await applyDeletion(request, plan, now)
        for (const receipt of plan.receipts) {
          deletionReceipts.push({ id: randomUUID(), requestId: request.id, ...receipt, recordCount: Number(counts[receipt.domain] ?? 0), retentionExpiresAt: receipt.disposition === 'retained_minimal' ? new Date(now.getTime() + 7 * 365 * dayMs) : null, evidenceHash: dataRightsEvidenceHash({ requestId: request.id, ...receipt, recordCount: Number(counts[receipt.domain] ?? 0) }), createdAt: now })
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
