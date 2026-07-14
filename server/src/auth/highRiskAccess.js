import { randomUUID } from 'node:crypto'
import { HttpError } from '../common/errors/httpError.js'

const defaultTtlMinutes = 30
const maxTtlMinutes = 240
const temporaryAuthorizations = new Map()
const breakGlassAccessById = new Map()

const nowIso = () => new Date().toISOString()
const expiresAtFor = (ttlMinutes = defaultTtlMinutes) =>
  new Date(Date.now() + Math.min(maxTtlMinutes, Math.max(1, Number(ttlMinutes ?? defaultTtlMinutes))) * 60 * 1000).toISOString()

const actorHandle = (actor) => actor?.handle ?? actor?.id ?? null

export const isHighRiskAccessReview = (review) => review?.metadata?.kind === 'high_risk_access'

export const requestHighRiskApproval = async ({ payload, actor, repositories }) => {
  const review = await repositories.adminReviews.create({
    id: payload.id ?? `high-risk-review-${randomUUID()}`,
    queue: 'high_risk_access',
    title: `High-risk access: ${payload.action}`,
    owner: actorHandle(actor),
    note: payload.reason,
    metadata: {
      kind: 'high_risk_access',
      requestedBy: actorHandle(actor),
      action: payload.action,
      resourceType: payload.resourceType,
      resourceId: payload.resourceId,
      permissionId: payload.permissionId,
      reasonCode: payload.reasonCode,
      temporaryAuthorizationTtlMinutes: payload.temporaryAuthorizationTtlMinutes ?? defaultTtlMinutes,
      requestedAt: nowIso(),
    },
  }, actor)
  return { review }
}

export const resolveHighRiskApproval = async ({ review, action, actor, repositories }) => {
  if (!isHighRiskAccessReview(review)) {
    return null
  }
  if (action.decision === 'approve' && review.metadata?.requestedBy === actorHandle(actor)) {
    throw new HttpError(400, 'VALIDATION_FAILED', 'high-risk access requires a different approver')
  }
  const reviewed = await repositories.adminReviews.review(review.id, action, actor)
  if (!reviewed) return null
  if (action.decision !== 'approve') {
    return { review: reviewed, temporaryAuthorization: null }
  }
  const authorization = {
    id: `temporary-auth-${randomUUID()}`,
    status: 'active',
    subject: review.metadata.requestedBy,
    permissionId: review.metadata.permissionId,
    resourceType: review.metadata.resourceType,
    resourceId: review.metadata.resourceId,
    approvalId: review.id,
    grantedBy: actorHandle(actor),
    reasonCode: review.metadata.reasonCode,
    grantedAt: nowIso(),
    expiresAt: expiresAtFor(review.metadata.temporaryAuthorizationTtlMinutes),
    revokedAt: null,
  }
  temporaryAuthorizations.set(authorization.id, authorization)
  return { review: reviewed, temporaryAuthorization: authorization }
}

export const listTemporaryAuthorizations = () => [...temporaryAuthorizations.values()].map((authorization) => {
  if (authorization.status === 'active' && new Date(authorization.expiresAt).getTime() <= Date.now()) {
    return { ...authorization, status: 'expired' }
  }
  return authorization
})

export const revokeTemporaryAuthorization = ({ id, actor, reasonCode }) => {
  const current = temporaryAuthorizations.get(String(id))
  if (!current) return null
  const revoked = {
    ...current,
    status: 'revoked',
    revokedBy: actorHandle(actor),
    revokedAt: nowIso(),
    revokeReasonCode: reasonCode,
  }
  temporaryAuthorizations.set(revoked.id, revoked)
  return revoked
}

export const startBreakGlassAccess = ({ payload, actor }) => {
  const access = {
    id: payload.id ?? `break-glass-${randomUUID()}`,
    status: 'active',
    actor: actorHandle(actor),
    permissionId: payload.permissionId,
    resourceType: payload.resourceType,
    resourceId: payload.resourceId,
    reasonCode: payload.reasonCode,
    reason: payload.reason,
    startedAt: nowIso(),
    expiresAt: expiresAtFor(payload.ttlMinutes ?? 15),
    reviewedBy: null,
    reviewedAt: null,
    reviewDecision: null,
    reviewNote: null,
  }
  breakGlassAccessById.set(access.id, access)
  return access
}

export const reviewBreakGlassAccess = ({ id, action, actor }) => {
  const current = breakGlassAccessById.get(String(id))
  if (!current) return null
  if (current.actor === actorHandle(actor)) {
    throw new HttpError(400, 'VALIDATION_FAILED', 'break-glass post-review requires a different reviewer')
  }
  const reviewed = {
    ...current,
    status: 'reviewed',
    reviewedBy: actorHandle(actor),
    reviewedAt: nowIso(),
    reviewDecision: action.decision,
    reviewNote: action.note,
  }
  breakGlassAccessById.set(reviewed.id, reviewed)
  return reviewed
}

export const listBreakGlassAccess = () => [...breakGlassAccessById.values()].map((access) => {
  if (access.status === 'active' && new Date(access.expiresAt).getTime() <= Date.now()) {
    return { ...access, status: 'expired' }
  }
  return access
})
