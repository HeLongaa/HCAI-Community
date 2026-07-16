import { createHash, randomUUID } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'

export const generationExecutionStatuses = ['claimed', 'succeeded', 'failed', 'recovery_required']

export const generationExecutionPayloadHash = (request) => createHash('sha256')
  .update(JSON.stringify({
    workspace: request.workspace,
    mode: request.mode,
    prompt: request.prompt,
    inputAssetIds: request.inputAssetIds ?? [],
    parameters: request.parameters ?? {},
    providerId: request.providerId ?? null,
  }))
  .digest('hex')

export const generationExecutionIdempotencyKey = (value) => {
  const normalized = String(value ?? '').trim()
  return normalized || `auto:${randomUUID()}`
}

export const generationExecutionGenerationId = (request, actor) => {
  if (!request.providerId || request.providerId === 'mock') {
    const digest = createHash('sha256').update(JSON.stringify({ actorId: actor?.id, request })).digest('hex').slice(0, 24)
    return `gen_mock_${digest}`
  }
  return `gen_${randomUUID().replaceAll('-', '')}`
}

export const assertGenerationExecutionClaim = (claim) => {
  if (claim.claimed) return claim
  const execution = claim.execution
  if (claim.reasonCode === 'payload_mismatch') {
    throw new HttpError(409, 'CREATIVE_GENERATION_IDEMPOTENCY_CONFLICT', 'Idempotency key was already used with a different generation request', {
      executionId: execution.id,
    })
  }
  if (claim.reasonCode === 'in_progress') {
    throw new HttpError(409, 'CREATIVE_GENERATION_IN_PROGRESS', 'Generation request is already being processed', {
      executionId: execution.id,
      generationId: execution.generationId,
      retryAfterSeconds: claim.retryAfterSeconds,
    })
  }
  if (claim.reasonCode === 'recovery_required') {
    throw new HttpError(409, 'CREATIVE_GENERATION_RECOVERY_REQUIRED', 'Generation request lease expired and requires operator recovery before retry', {
      executionId: execution.id,
      generationId: execution.generationId,
    })
  }
  if (claim.reasonCode === 'failed') {
    throw new HttpError(409, 'CREATIVE_GENERATION_REQUEST_FAILED', 'Generation request already failed; use Retry with a new idempotency key', {
      executionId: execution.id,
      generationId: execution.generationId,
      errorCode: execution.errorCode,
    })
  }
  return claim
}

export const safeGenerationExecution = (execution) => execution ? {
  id: execution.id,
  generationId: execution.generationId,
  status: execution.status,
  workspace: execution.workspace,
  mode: execution.mode,
  actorId: execution.actorId,
  actorHandle: execution.actorHandle,
  attempt: execution.attempt,
  errorCode: execution.errorCode,
  leaseExpiresAt: execution.leaseExpiresAt,
  completedAt: execution.completedAt,
  createdAt: execution.createdAt,
  updatedAt: execution.updatedAt,
} : null
