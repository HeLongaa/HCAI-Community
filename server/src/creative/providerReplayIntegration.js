import {
  buildProviderSideEffectPlan,
  executeProviderSideEffectPlan,
} from './providerSideEffectPlan.js'

const compactObject = (value) =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))

const safePlanOperation = (operation) => ({
  type: operation.type,
  key: operation.key,
  required: operation.required,
  reasonCode: operation.reasonCode,
  metadata: operation.metadata,
})

const buildLedgerSideEffectPlan = (plan, replay) => ({
  actions: replay?.actions ?? replay?.sideEffectPlan ?? null,
  operations: plan.operations.map(safePlanOperation),
  summary: plan.safeSummary,
})

const generationIdFor = (replay) => replay?.generation?.id ?? replay?.generationId ?? null
const providerJobIdFor = (replay) => replay?.generation?.providerJobId ?? replay?.providerJobId ?? null
const providerIdFor = (replay) => replay?.providerId ?? replay?.generation?.provider?.id ?? null
const providerModeFor = (replay) => replay?.providerMode ?? replay?.generation?.provider?.mode ?? null

const replayActionFor = (replay, plan) => {
  if (replay?.ignored) return 'noop'
  if (plan.operations.length === 0) return 'noop'
  return 'applied'
}

const persistSideEffectResult = async ({ replayLedger, replayRecord, execution, actor }) => {
  if (replayLedger?.markSideEffectResult) {
    return replayLedger.markSideEffectResult(replayRecord.id, {
      completed: execution.completed,
      failedOperationType: execution.failedOperation?.type ?? null,
      completedOperationKeys: execution.sideEffectResult.completedOperationKeys,
      operations: execution.sideEffectResult.operations,
    }, actor)
  }
  if (execution.completed && replayLedger?.markApplied) {
    return replayLedger.markApplied(replayRecord.id, {
      completed: true,
      completedOperationKeys: execution.sideEffectResult.completedOperationKeys,
      operations: execution.sideEffectResult.operations,
    }, actor)
  }
  return replayRecord
}

export const applyProviderReplayThroughLedger = async ({
  replay,
  repositories = {},
  sideEffectRepositories = repositories,
  actor = null,
  providerEventId = null,
  payloadHash = null,
  receivedAt = undefined,
} = {}) => {
  const replayLedger = repositories.creativeProviderReplays
  if (!replayLedger?.record) {
    throw new Error('creativeProviderReplays.record repository is required')
  }

  const initialPlan = buildProviderSideEffectPlan({ replay })
  const recorded = await replayLedger.record(compactObject({
    generationId: generationIdFor(replay),
    providerId: providerIdFor(replay),
    providerMode: providerModeFor(replay),
    providerJobId: providerJobIdFor(replay),
    providerEventId,
    sourceType: replay?.sourceType ?? 'fixture',
    idempotencyKey: replay?.idempotencyKey,
    payloadHash,
    previousStatus: replay?.previousStatus ?? null,
    normalizedStatus: replay?.nextStatus ?? replay?.generation?.status ?? null,
    action: replayActionFor(replay, initialPlan),
    reasonCode: replay?.reason ?? replay?.reasonCode ?? null,
    sideEffectPlan: buildLedgerSideEffectPlan(initialPlan, replay),
    receivedAt,
  }), actor)

  const existingResult = recorded.created ? null : recorded.replay?.sideEffectResult ?? null
  if (!recorded.created && existingResult?.completed) {
    return {
      recorded,
      replayRecord: recorded.replay,
      duplicate: true,
      executed: false,
      execution: null,
      sideEffectPlan: buildProviderSideEffectPlan({ replay, sideEffectResult: existingResult }),
    }
  }

  const sideEffectPlan = buildProviderSideEffectPlan({
    replay,
    sideEffectResult: existingResult ?? {},
  })

  if (sideEffectPlan.operations.length === 0) {
    return {
      recorded,
      replayRecord: recorded.replay,
      duplicate: !recorded.created,
      executed: false,
      execution: null,
      sideEffectPlan,
    }
  }

  const execution = await executeProviderSideEffectPlan({
    replay,
    repositories: sideEffectRepositories,
    actor,
    sideEffectResult: existingResult ?? {},
  })
  const replayRecord = await persistSideEffectResult({
    replayLedger,
    replayRecord: recorded.replay,
    execution,
    actor,
  })

  return {
    recorded,
    replayRecord,
    duplicate: !recorded.created,
    executed: true,
    execution,
    sideEffectPlan,
  }
}
