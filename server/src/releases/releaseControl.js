import { createHash, randomUUID } from 'node:crypto'
import { HttpError } from '../common/errors/httpError.js'
import {
  readProductionReleasePublicKeys,
  summarizeProductionReleaseEvidence,
  verifyProductionReleaseEvidenceBundle,
} from './productionReleaseEvidence.js'

export const releaseEnvironments = Object.freeze(['development', 'staging', 'production'])
export const releaseChangeTypes = Object.freeze(['promotion', 'secret_rotation', 'configuration'])
export const releaseStatuses = Object.freeze(['pending_approval', 'approved', 'rejected', 'deployed', 'failed', 'rolled_back'])

const actorRef = (actor) => actor?.handle ?? actor?.id ?? 'unknown'
const hashEvidence = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const hashText = (value) => createHash('sha256').update(String(value ?? '')).digest('hex')
const safeNoteEvidence = (note) => ({ notePresent: Boolean(note), noteSha256: hashText(note) })
const safeUrlEvidence = (value) => {
  const url = new URL(value)
  return { evidenceUrlSha256: hashText(url.toString()), evidenceHostSha256: hashText(url.hostname.toLowerCase()) }
}

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

const assertProductionEvidenceBinding = (payload) => {
  const fields = [
    payload.sourceCommit,
    payload.releaseArtifactSha256,
    payload.rollbackArtifactSha256,
    payload.productionEvidenceReceiptSha256,
  ]
  if (payload.targetEnvironment !== 'production') {
    if (fields.some((value) => value != null)) {
      throw new HttpError(422, 'PRODUCTION_RELEASE_EVIDENCE_BINDING_INVALID', 'production release evidence binding is only allowed for production changes')
    }
    return
  }
  if (
    !/^[a-f0-9]{40}$/.test(payload.sourceCommit ?? '') ||
    !/^[a-f0-9]{64}$/.test(payload.releaseArtifactSha256 ?? '') ||
    !/^[a-f0-9]{64}$/.test(payload.rollbackArtifactSha256 ?? '') ||
    !/^[a-f0-9]{64}$/.test(payload.productionEvidenceReceiptSha256 ?? '') ||
    payload.releaseArtifactSha256 === payload.rollbackArtifactSha256
  ) {
    throw new HttpError(422, 'PRODUCTION_RELEASE_EVIDENCE_BINDING_INVALID', 'production release request requires source, candidate, rollback, and evidence receipt hashes')
  }
}

export const requestReleaseChange = async ({ payload, actor, repository }) => {
  assertProductionEvidenceBinding(payload)
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
        modelPromotion: payload.modelPromotion ? {
          id: payload.modelPromotion.id,
          modelDeploymentId: payload.modelPromotion.modelDeploymentId,
          routePolicyId: payload.modelPromotion.routePolicyId,
          routePolicyRevisionId: payload.modelPromotion.routePolicyRevisionId,
          providerSecretRefId: payload.modelPromotion.providerSecretRefId,
          evaluationRunId: payload.modelPromotion.evaluationRunId,
          legalReviewId: payload.modelPromotion.legalReviewId,
        } : null,
        productionEvidenceBinding: payload.targetEnvironment === 'production' ? {
          sourceCommit: payload.sourceCommit,
          releaseArtifactSha256: payload.releaseArtifactSha256,
          rollbackArtifactSha256: payload.rollbackArtifactSha256,
          receiptSha256: payload.productionEvidenceReceiptSha256,
        } : null,
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
    evidence: evidenceFor({ eventType: 'approved', actor, reasonCode: payload.reasonCode, details: safeNoteEvidence(payload.note) }),
  })
}

export const rejectReleaseChange = async ({ change, payload, actor, repository }) => {
  assertStatus(change, ['pending_approval'], 'reject')
  assertDifferentApprover(change, actor)
  return repository.transition(change.id, change.version, {
    status: 'rejected',
    approvedByRef: actorRef(actor),
    approvedAt: new Date().toISOString(),
    evidence: evidenceFor({ eventType: 'rejected', actor, reasonCode: payload.reasonCode, details: safeNoteEvidence(payload.note) }),
  })
}

const requestedProductionBinding = (change) => change.evidence
  ?.find((item) => item.eventType === 'requested')
  ?.evidence?.productionEvidenceBinding ?? null

export const applyReleaseChange = async ({ change, payload, actor, repository, source = process.env, now = new Date() }) => {
  assertStatus(change, ['approved'], 'apply')
  if (!['deployed', 'failed'].includes(payload.outcome)) {
    throw new HttpError(422, 'VALIDATION_FAILED', 'release outcome must be deployed or failed')
  }
  if (change.targetEnvironment === 'production' && !change.approvedByRef) {
    throw new HttpError(409, 'STATE_CONFLICT', 'production changes require recorded approval')
  }
  let productionEvidence = null
  if (change.targetEnvironment === 'production' && payload.outcome === 'deployed') {
    const binding = requestedProductionBinding(change)
    if (!binding || !payload.evidenceBundle) {
      throw new HttpError(409, 'PRODUCTION_RELEASE_EVIDENCE_REQUIRED', 'production deployment requires the approved evidence bundle')
    }
    const expectedSource = {
      gitCommit: binding.sourceCommit,
      artifactSha256: binding.releaseArtifactSha256,
      rollbackArtifactSha256: binding.rollbackArtifactSha256,
    }
    const verification = verifyProductionReleaseEvidenceBundle(payload.evidenceBundle, {
      publicKeys: readProductionReleasePublicKeys(source),
      expectedSource,
      now,
    })
    if (!verification.valid || payload.evidenceBundle.receiptHash !== binding.receiptSha256) {
      throw new HttpError(409, 'PRODUCTION_RELEASE_EVIDENCE_INVALID', 'production release evidence is missing, stale, untrusted, or does not match the approved candidate', {
        failures: [...verification.failures, ...(payload.evidenceBundle?.receiptHash === binding.receiptSha256 ? [] : ['receipt_binding'])],
      })
    }
    productionEvidence = summarizeProductionReleaseEvidence(payload.evidenceBundle)
  }
  return repository.transition(change.id, change.version, {
    status: payload.outcome === 'failed' ? 'failed' : 'deployed',
    appliedByRef: actorRef(actor),
    appliedAt: new Date().toISOString(),
    evidence: evidenceFor({
      eventType: payload.outcome === 'failed' ? 'deployment_failed' : 'deployed',
      actor,
      reasonCode: payload.reasonCode,
      details: {
        deploymentId: payload.deploymentId,
        ...safeUrlEvidence(payload.evidenceUrl),
        ...safeNoteEvidence(payload.note),
        productionEvidence,
      },
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
      details: {
        restoredVersion: change.rollbackVersion,
        deploymentId: payload.deploymentId,
        ...safeUrlEvidence(payload.evidenceUrl),
        ...safeNoteEvidence(payload.note),
      },
    }),
  })
}
