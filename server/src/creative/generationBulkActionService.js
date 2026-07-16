import { createHash } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'
import { validationFailed } from '../common/http/validation.js'
import {
  buildCreativeGenerationRetryEligibility,
  cancelCreativeGeneration,
  createAdminRetryAuthorization,
} from './generationMutationService.js'

const maxTargets = 50

export const generationBulkActionDefinitions = Object.freeze({
  cancel: Object.freeze({ permission: 'admin:creative:cancel', requiredConfirmationText: 'CANCEL GENERATIONS' }),
  authorize_retry: Object.freeze({ permission: 'admin:creative:retry', requiredConfirmationText: 'AUTHORIZE GENERATION RETRIES' }),
})

const uniqueTargets = (targetIds) => {
  const ids = [...new Set(targetIds.map((targetId) => String(targetId).trim()).filter(Boolean))]
  if (!ids.length || ids.length > maxTargets) throw validationFailed(`targetIds must include 1-${maxTargets} unique ids`)
  return ids
}

export const generationBulkTargetHash = (targetIds) =>
  createHash('sha256').update([...targetIds].sort().join('\n')).digest('hex')

const eligibilityFor = (action, generation) => {
  if (!generation) return { eligible: false, reasonCode: 'generation_not_found' }
  if (action === 'cancel') {
    return ['queued', 'running'].includes(generation.status)
      ? { eligible: true, reasonCode: 'generation_cancellable' }
      : { eligible: false, reasonCode: 'generation_status_not_cancellable' }
  }
  const retry = buildCreativeGenerationRetryEligibility(generation)
  return { eligible: retry.eligible, reasonCode: retry.reasonCode }
}

export const previewCreativeGenerationBulkAction = async ({ repositories, action, targetIds }) => {
  const definition = generationBulkActionDefinitions[action]
  if (!definition) throw validationFailed('action must be one of: cancel, authorize_retry')
  const ids = uniqueTargets(targetIds)
  const targets = await Promise.all(ids.map(async (id) => {
    const generation = await repositories.creativeGenerations.find(id)
    const eligibility = eligibilityFor(action, generation)
    return { id, status: generation?.status ?? null, ...eligibility }
  }))
  const eligibleCount = targets.filter((target) => target.eligible).length
  const missingCount = targets.filter((target) => target.reasonCode === 'generation_not_found').length
  return {
    action,
    targetCount: ids.length,
    targetHash: generationBulkTargetHash(ids),
    requiredConfirmationText: definition.requiredConfirmationText,
    eligibleCount,
    blockedCount: targets.length - eligibleCount - missingCount,
    missingCount,
    targets,
  }
}

const resultFromError = (id, error) => ({
  id,
  outcome: error?.status === 404 ? 'missing' : 'blocked',
  code: error?.code ?? 'CREATIVE_GENERATION_BULK_TARGET_FAILED',
})

export const executeCreativeGenerationBulkAction = async ({ repositories, providerMutationAdapters, actor, request }) => {
  const preview = await previewCreativeGenerationBulkAction({ repositories, action: request.action, targetIds: request.targetIds })
  if (request.targetHash !== preview.targetHash) {
    throw new HttpError(409, 'CREATIVE_GENERATION_BULK_TARGET_CHANGED', 'targetHash does not match the selected generation ids')
  }
  if (request.confirmationText !== preview.requiredConfirmationText) {
    throw validationFailed('confirmationText does not match the required confirmation phrase')
  }

  const results = []
  for (const target of preview.targets) {
    const derivedKey = createHash('sha256').update(`${request.idempotencyKey}\n${request.action}\n${target.id}`).digest('hex')
    const mutationKey = `generation-bulk:${derivedKey}`
    const existing = await repositories.creativeGenerationMutations.findByIdempotencyKey?.(mutationKey)
    const expectedMutationType = request.action === 'cancel' ? 'cancel' : 'retry'
    if (existing) {
      if (existing.generationId !== target.id || existing.type !== expectedMutationType) {
        results.push({ id: target.id, outcome: 'blocked', code: 'CREATIVE_MUTATION_IDEMPOTENCY_CONFLICT' })
      } else {
        results.push({ id: target.id, outcome: 'duplicate', code: existing.status })
      }
      continue
    }
    if (!target.eligible) {
      results.push({ id: target.id, outcome: target.reasonCode === 'generation_not_found' ? 'missing' : 'blocked', code: target.reasonCode })
      continue
    }
    try {
      const current = await repositories.creativeGenerations.find(target.id)
      const currentEligibility = eligibilityFor(request.action, current)
      if (!currentEligibility.eligible) {
        results.push({ id: target.id, outcome: current ? 'blocked' : 'missing', code: currentEligibility.reasonCode })
        continue
      }
      const mutationRequest = {
        idempotencyKey: mutationKey,
        reasonCode: request.reasonCode,
        note: request.note,
      }
      const result = request.action === 'cancel'
        ? await cancelCreativeGeneration({ generationId: target.id, actor, repositories, request: mutationRequest, providerMutationAdapters, admin: true })
        : await createAdminRetryAuthorization({ generationId: target.id, actor, repositories, request: mutationRequest })
      results.push({ id: target.id, outcome: result.duplicate ? 'duplicate' : 'succeeded', code: result.mutation?.status ?? 'completed' })
    } catch (error) {
      results.push(resultFromError(target.id, error))
    }
  }

  const counts = results.reduce((summary, result) => {
    summary[result.outcome] += 1
    return summary
  }, { succeeded: 0, duplicate: 0, blocked: 0, missing: 0 })
  await repositories.audit?.recordAttempt?.({
    actor,
    action: 'admin.creative.generation_bulk_action.executed',
    resourceType: 'creative_generation_bulk_action',
    resourceId: request.action,
    metadata: { action: request.action, targetCount: preview.targetCount, targetHash: preview.targetHash, reasonCode: request.reasonCode, counts },
  })
  return { action: request.action, targetCount: preview.targetCount, targetHash: preview.targetHash, counts, results }
}
