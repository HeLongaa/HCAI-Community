import { createHash, randomUUID } from 'node:crypto'
import { HttpError } from '../common/errors/httpError.js'

export const releaseEnvironments = Object.freeze(['development', 'staging', 'production'])
export const releaseChangeTypes = Object.freeze(['promotion', 'secret_rotation', 'configuration'])
export const releaseStatuses = Object.freeze(['pending_approval', 'approved', 'rejected', 'deployed', 'failed', 'rolled_back'])

const actorRef = (actor) => actor?.handle ?? actor?.id ?? 'unknown'
const hashEvidence = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

const evidenceFor = ({ eventType, actor, reasonCode, details = {} }) => ({
  id: `release-evidence-${randomUUID()}`,
  eventType,
  actorRef: actorRef(actor),
  reasonCode,
  evidence: details,
  evidenceHash: hashEvidence({ eventType, actorRef: actorRef(actor), reasonCode, details }),
})

const assertDifferentApprover = (change, actor) => {
  if (change.requestedByRef === actorRef(actor)) {
    throw new HttpError(400, 'VALIDATION_FAILED', 'release approval requires a different approver')
  }
}

const assertStatus = (change, expected, action) => {
  if (!expected.includes(change.status)) {
    throw new HttpError(409, 'STATE_CONFLICT', `${action} is not allowed from ${change.status}`)
  }
}

export const requestReleaseChange = async ({ payload, actor, repository }) => {
  const requestedByRef = actorRef(actor)
  return repository.create({
    id: `release-${randomUUID()}`,
    ...payload,
    status: 'pending_approval',
    requestedByRef,
    evidence: evidenceFor({
      eventType: 'requested',
      actor,
      reasonCode: payload.reasonCode,
      details: {
        changeType: payload.changeType,
        sourceEnvironment: payload.sourceEnvironment,
        targetEnvironment: payload.targetEnvironment,
        artifactVersion: payload.artifactVersion,
        rollbackVersion: payload.rollbackVersion,
        secretRef: payload.secretRef,
        secretVersion: payload.secretVersion,
      },
    }),
  })
}

export const approveReleaseChange = async ({ change, payload, actor, repository }) => {
  assertStatus(change, ['pending_approval'], 'approve')
  assertDifferentApprover(change, actor)
  return repository.transition(change.id, change.version, {
    status: 'approved',
    approvedByRef: actorRef(actor),
    approvedAt: new Date().toISOString(),
    evidence: evidenceFor({ eventType: 'approved', actor, reasonCode: payload.reasonCode, details: { note: payload.note } }),
  })
}

export const rejectReleaseChange = async ({ change, payload, actor, repository }) => {
  assertStatus(change, ['pending_approval'], 'reject')
  assertDifferentApprover(change, actor)
  return repository.transition(change.id, change.version, {
    status: 'rejected',
    approvedByRef: actorRef(actor),
    approvedAt: new Date().toISOString(),
    evidence: evidenceFor({ eventType: 'rejected', actor, reasonCode: payload.reasonCode, details: { note: payload.note } }),
  })
}

export const applyReleaseChange = async ({ change, payload, actor, repository }) => {
  assertStatus(change, ['approved'], 'apply')
  if (change.targetEnvironment === 'production' && !change.approvedByRef) {
    throw new HttpError(409, 'STATE_CONFLICT', 'production changes require recorded approval')
  }
  return repository.transition(change.id, change.version, {
    status: payload.outcome === 'failed' ? 'failed' : 'deployed',
    appliedByRef: actorRef(actor),
    appliedAt: new Date().toISOString(),
    evidence: evidenceFor({
      eventType: payload.outcome === 'failed' ? 'deployment_failed' : 'deployed',
      actor,
      reasonCode: payload.reasonCode,
      details: { deploymentId: payload.deploymentId, evidenceUrl: payload.evidenceUrl, note: payload.note },
    }),
  })
}

export const rollbackReleaseChange = async ({ change, payload, actor, repository }) => {
  assertStatus(change, ['deployed', 'failed'], 'rollback')
  return repository.transition(change.id, change.version, {
    status: 'rolled_back',
    rolledBackByRef: actorRef(actor),
    rolledBackAt: new Date().toISOString(),
    evidence: evidenceFor({
      eventType: 'rolled_back',
      actor,
      reasonCode: payload.reasonCode,
      details: { restoredVersion: change.rollbackVersion, deploymentId: payload.deploymentId, evidenceUrl: payload.evidenceUrl, note: payload.note },
    }),
  })
}
