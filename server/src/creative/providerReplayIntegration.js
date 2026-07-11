import { randomUUID } from 'node:crypto'

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

const buildNoopSideEffectResult = ({ replay, plan }) => ({
  completed: true,
  outcome: 'noop',
  reasonCode: replay?.reason ?? replay?.reasonCode ?? plan.reasonCode ?? 'noop',
  completedOperationKeys: [],
  operations: [],
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

const persistSideEffectResult = async ({ replayLedger, replayRecord, execution, actor, claimToken = null }) => {
  if (replayLedger?.markSideEffectResult) {
    return replayLedger.markSideEffectResult(replayRecord.id, {
      completed: execution.completed,
      failedOperationType: execution.failedOperation?.type ?? null,
      completedOperationKeys: execution.sideEffectResult.completedOperationKeys,
      operations: execution.sideEffectResult.operations,
    }, actor, { claimToken })
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
  now = new Date(),
  sideEffectLeaseSeconds = 60,
} = {}) => {
  const replayLedger = repositories.creativeProviderReplays
  if (!replayLedger?.record) {
    throw new Error('creativeProviderReplays.record repository is required')
  }

  const initialPlan = buildProviderSideEffectPlan({ replay })
  const initialAction = replayActionFor(replay, initialPlan)
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
    action: initialAction,
    reasonCode: replay?.reason ?? replay?.reasonCode ?? null,
    sideEffectPlan: buildLedgerSideEffectPlan(initialPlan, replay),
    sideEffectResult: initialAction === 'noop'
      ? buildNoopSideEffectResult({ replay, plan: initialPlan })
      : undefined,
    receivedAt,
  }), actor)

  if (!recorded.created && recorded.replay?.idempotencyKey !== replay?.idempotencyKey) {
    return {
      recorded,
      replayRecord: recorded.replay,
      duplicate: true,
      conflict: true,
      reasonCode: 'provider_event_replay_conflict',
      executed: false,
      inProgress: false,
      execution: null,
      sideEffectPlan: buildProviderSideEffectPlan({
        replay,
        sideEffectResult: recorded.replay?.sideEffectResult ?? {},
      }),
    }
  }

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

  const claimToken = `provider-side-effect-${randomUUID()}`
  const claimNow = now instanceof Date ? now : new Date(now)
  const claim = replayLedger.claimSideEffects
    ? await replayLedger.claimSideEffects(recorded.replay.id, {
      expectedSideEffectResult: existingResult,
      claimToken,
      claimedAt: claimNow.toISOString(),
      leaseExpiresAt: new Date(claimNow.getTime() + sideEffectLeaseSeconds * 1000).toISOString(),
    })
    : { claimed: true, replay: recorded.replay }

  if (!claim.claimed) {
    const claimedResult = claim.replay?.sideEffectResult ?? existingResult ?? {}
    return {
      recorded,
      replayRecord: claim.replay ?? recorded.replay,
      duplicate: true,
      executed: false,
      inProgress: Boolean(claimedResult?.claim),
      execution: null,
      sideEffectPlan: buildProviderSideEffectPlan({ replay, sideEffectResult: claimedResult }),
    }
  }

  const claimedSideEffectResult = claim.replay?.sideEffectResult ?? existingResult ?? {}

  const execution = await executeProviderSideEffectPlan({
    replay,
    repositories: sideEffectRepositories,
    actor,
    sideEffectResult: claimedSideEffectResult,
  })
  const replayRecord = await persistSideEffectResult({
    replayLedger,
    replayRecord: claim.replay ?? recorded.replay,
    execution,
    actor,
    claimToken,
  })

  return {
    recorded,
    replayRecord,
    duplicate: !recorded.created,
    executed: true,
    inProgress: false,
    execution,
    sideEffectPlan,
  }
}
