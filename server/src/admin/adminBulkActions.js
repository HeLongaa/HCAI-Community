import { createHash } from 'node:crypto'
import { validationFailed } from '../common/http/validation.js'

export const adminBulkActionDefinitions = Object.freeze([
  Object.freeze({
    id: 'jobs.retry_dead_lettered',
    jobDefinitionId: 'admin.bulk.jobs.retry_dead_lettered',
    resourceType: 'job_run',
    requiredConfirmationText: 'RETRY DEAD LETTERED JOBS',
    maxTargets: 100,
  }),
])

export const adminBulkActionDefinitionById = Object.freeze(Object.fromEntries(adminBulkActionDefinitions.map((definition) => [definition.id, definition])))

const hashTargets = (targetIds) => createHash('sha256').update([...targetIds].sort().join('\n')).digest('hex')

export const previewAdminBulkAction = ({ actionId, targetIds, reasonCode }) => {
  const definition = adminBulkActionDefinitionById[actionId]
  if (!definition) throw validationFailed('bulk action is not registered')
  const uniqueTargetIds = [...new Set(targetIds.map(String))]
  if (!uniqueTargetIds.length || uniqueTargetIds.length > definition.maxTargets) {
    throw validationFailed(`targetIds must include 1-${definition.maxTargets} unique ids`)
  }
  return {
    actionId: definition.id,
    jobDefinitionId: definition.jobDefinitionId,
    resourceType: definition.resourceType,
    targetCount: uniqueTargetIds.length,
    targetHash: hashTargets(uniqueTargetIds),
    reasonCode,
    requiredConfirmationText: definition.requiredConfirmationText,
    destructive: false,
  }
}

export const confirmAdminBulkAction = async ({ repositories, actionId, targetIds, reasonCode, confirmationText, idempotencyKey, actor }) => {
  const preview = previewAdminBulkAction({ actionId, targetIds, reasonCode })
  if (confirmationText !== preview.requiredConfirmationText) {
    throw validationFailed('confirmationText does not match the registered confirmation phrase')
  }
  await repositories.jobs.ensureDefinition({
    id: preview.jobDefinitionId,
    type: 'admin_bulk_action',
    maxAttempts: 1,
    retryBackoffSeconds: 0,
    defaultTimeoutSeconds: 900,
    description: `Admin bulk action ${preview.actionId}`,
  })
  const run = await repositories.jobs.enqueue({
    definitionId: preview.jobDefinitionId,
    idempotencyKey: idempotencyKey ?? `admin-bulk:${preview.actionId}:${preview.targetHash}:${reasonCode}`,
    correlationId: `admin-bulk:${preview.actionId}:${preview.targetHash}`,
    requestedById: actor?.id,
    input: { actionId: preview.actionId, resourceType: preview.resourceType, targetIds: [...new Set(targetIds.map(String))], reasonCode, targetHash: preview.targetHash },
    priority: 50,
  })
  await repositories.audit?.record?.({
    actor,
    action: 'admin.bulk_action.confirmed',
    resourceType: 'admin_bulk_action',
    resourceId: preview.actionId,
    metadata: { jobRunId: run?.id ?? null, targetCount: preview.targetCount, targetHash: preview.targetHash, reasonCode },
  })
  return { ...preview, run }
}
