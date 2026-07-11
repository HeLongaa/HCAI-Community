import { getOutputAssetIds, safeErrorPreview, statusForPersistedGeneration } from './generationRecords.js'
import { persistCreativeGenerationOutputs } from './generationService.js'
import { safeProviderFailure } from './providerAdapterContract.js'
import { emptyLifecycleReplayActions } from './providerLifecycleReplay.js'

const lifecycleOperations = Object.freeze({
  markRunning: 'mark_running',
  persistOutputs: 'persist_outputs',
  linkOutputAssets: 'link_output_assets',
  settleCredits: 'settle_credits',
  refundCredits: 'refund_credits',
  commitQuota: 'commit_quota',
  releaseQuota: 'release_quota',
  complete: 'complete_generation',
  fail: 'fail_generation',
  cancel: 'cancel_generation',
  notify: 'notify_lifecycle',
  audit: 'audit_lifecycle',
})

const compactObject = (value) =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))

const normalizeActions = (actions = {}) => ({
  ...emptyLifecycleReplayActions,
  ...actions,
})

const generationIdFor = (replay) => replay?.generation?.id ?? replay?.generationId ?? null
const providerJobIdFor = (replay) => replay?.generation?.providerJobId ?? replay?.providerJobId ?? null
const statusForReplay = (replay) => replay?.nextStatus ?? replay?.generation?.status ?? null
const operationKey = (replay, type) =>
  [
    'creative-provider-lifecycle',
    replay?.idempotencyKey ?? generationIdFor(replay) ?? 'unknown-generation',
    type,
  ].join(':')

const completedSet = (sideEffectResult = {}) => new Set([
  ...(sideEffectResult.completedOperationKeys ?? []),
  ...(sideEffectResult.operations ?? [])
    .filter((operation) => operation?.status === 'succeeded' || operation?.status === 'skipped')
    .map((operation) => operation.key),
])

const baseOperation = ({ replay, type, reasonCode = null, required = true, metadata = {} }) => ({
  type,
  key: operationKey(replay, type),
  required,
  reasonCode,
  metadata: compactObject({
    generationId: generationIdFor(replay),
    providerId: replay?.providerId ?? null,
    providerMode: replay?.providerMode ?? replay?.generation?.provider?.mode ?? null,
    providerJobId: providerJobIdFor(replay),
    sourceType: replay?.sourceType ?? null,
    nextStatus: statusForReplay(replay),
    ...metadata,
  }),
})

const safeGenerationOperationResult = (generation) => {
  if (!generation || typeof generation !== 'object' || Array.isArray(generation)) return generation ?? null
  return compactObject({
    id: generation.id ?? null,
    status: statusForPersistedGeneration(generation),
    outputAssetIds: Array.isArray(generation.outputAssetIds) ? generation.outputAssetIds : undefined,
    credit: generation.credit
      ? compactObject({
          ledgerId: generation.credit.ledgerId ?? null,
          status: generation.credit.status ?? null,
          reserved: generation.credit.reserved ?? undefined,
          settled: generation.credit.settled ?? undefined,
          refunded: generation.credit.refunded ?? undefined,
        })
      : undefined,
    quota: generation.quota
      ? compactObject({
          reservationId: generation.quota.reservationId ?? null,
          used: generation.quota.used ?? undefined,
          released: generation.quota.released ?? undefined,
        })
      : undefined,
  })
}

const ledgerOperationResult = (operation, result) => {
  if ([
    lifecycleOperations.markRunning,
    lifecycleOperations.linkOutputAssets,
    lifecycleOperations.complete,
    lifecycleOperations.fail,
    lifecycleOperations.cancel,
  ].includes(operation.type)) {
    return safeGenerationOperationResult(result)
  }
  return result ?? null
}

export const buildProviderSideEffectPlan = ({
  replay,
  sideEffectResult = replay?.sideEffectResult ?? {},
} = {}) => {
  const actions = normalizeActions(replay?.actions ?? replay?.sideEffectPlan)
  const generation = replay?.generation ?? null
  const completed = completedSet(sideEffectResult)
  const operations = []
  const push = (operation) => {
    operations.push({
      ...operation,
      alreadyCompleted: completed.has(operation.key),
    })
  }

  if (!replay || replay.ignored || replay.action === 'noop') {
    return {
      generationId: generationIdFor(replay),
      idempotencyKey: replay?.idempotencyKey ?? null,
      sourceType: replay?.sourceType ?? null,
      reasonCode: replay?.reason ?? replay?.reasonCode ?? 'noop',
      operations: [],
      pendingOperations: [],
      safeSummary: {
        total: 0,
        pending: 0,
        alreadyCompleted: 0,
      },
    }
  }

  if (actions.markRunning) {
    push(baseOperation({ replay, type: lifecycleOperations.markRunning }))
  }
  if (actions.persistOutputs) {
    push(baseOperation({
      replay,
      type: lifecycleOperations.persistOutputs,
      metadata: { outputCount: generation?.outputs?.length ?? 0 },
    }))
  }
  if (actions.linkOutputAssets) {
    push(baseOperation({ replay, type: lifecycleOperations.linkOutputAssets }))
  }
  if (actions.settleCredits) {
    push(baseOperation({
      replay,
      type: lifecycleOperations.settleCredits,
      metadata: {
        creditLedgerId: generation?.credit?.ledgerId ?? null,
        reservedCredits: generation?.credit?.reserved ?? generation?.usage?.estimatedCredits ?? null,
      },
    }))
    push(baseOperation({
      replay,
      type: lifecycleOperations.commitQuota,
      metadata: { quotaReservationId: generation?.quota?.reservationId ?? null },
    }))
  }
  if (actions.refundCredits) {
    push(baseOperation({
      replay,
      type: lifecycleOperations.refundCredits,
      reasonCode: statusForReplay(replay) === 'cancelled' ? 'provider_cancelled' : 'provider_failed',
      metadata: {
        creditLedgerId: generation?.credit?.ledgerId ?? null,
        reservedCredits: generation?.credit?.reserved ?? generation?.usage?.estimatedCredits ?? null,
      },
    }))
    push(baseOperation({
      replay,
      type: lifecycleOperations.releaseQuota,
      reasonCode: statusForReplay(replay) === 'cancelled' ? 'provider_cancelled' : 'provider_failed',
      metadata: { quotaReservationId: generation?.quota?.reservationId ?? null },
    }))
  }
  if (actions.complete) {
    push(baseOperation({ replay, type: lifecycleOperations.complete }))
  }
  if (actions.fail) {
    push(baseOperation({
      replay,
      type: lifecycleOperations.fail,
      reasonCode: generation?.errorCode ?? 'provider_failed',
    }))
  }
  if (actions.cancel) {
    push(baseOperation({
      replay,
      type: lifecycleOperations.cancel,
      reasonCode: 'provider_cancelled',
    }))
  }
  if (operations.length > 0) {
    push(baseOperation({
      replay,
      type: lifecycleOperations.notify,
      required: false,
      metadata: { notificationType: `creative.provider_lifecycle.${statusForReplay(replay) ?? 'updated'}` },
    }))
    push(baseOperation({
      replay,
      type: lifecycleOperations.audit,
      required: false,
      metadata: { auditAction: 'creative.provider_lifecycle.side_effect_applied' },
    }))
  }

  const pendingOperations = operations.filter((operation) => !operation.alreadyCompleted)
  return {
    generationId: generationIdFor(replay),
    idempotencyKey: replay?.idempotencyKey ?? null,
    sourceType: replay?.sourceType ?? null,
    reasonCode: replay?.reason ?? replay?.reasonCode ?? null,
    operations,
    pendingOperations,
    safeSummary: {
      total: operations.length,
      pending: pendingOperations.length,
      alreadyCompleted: operations.length - pendingOperations.length,
    },
  }
}

const executeOperation = async ({ operation, replay, repositories, actor, state, fetchOutput }) => {
  const generation = state.generation ?? replay.generation
  const generationId = generationIdFor(replay)
  switch (operation.type) {
    case lifecycleOperations.markRunning:
      return repositories.creativeGenerations?.markRunning?.(generationId, { sourceKey: operation.key }, actor)
    case lifecycleOperations.persistOutputs: {
      const persisted = await persistCreativeGenerationOutputs(generation, {
        actor,
        mediaRepository: repositories.media,
        repositories,
        outputDigest: replay.outputDigest,
        fetchOutput,
      })
      state.generation = persisted
      state.outputAssetIds = getOutputAssetIds(persisted)
      return { outputAssetIds: state.outputAssetIds, status: statusForPersistedGeneration(persisted) }
    }
    case lifecycleOperations.linkOutputAssets: {
      const outputAssetIds = state.outputAssetIds ?? getOutputAssetIds(state.generation ?? generation)
      return repositories.creativeGenerations?.linkOutputAssets?.(generationId, outputAssetIds, actor)
    }
    case lifecycleOperations.settleCredits: {
      const settled = generation?.credit?.ledgerId && repositories.creativeCredits?.settle
        ? await repositories.creativeCredits.settle(generation.credit.ledgerId, {
          settledAmount: generation.credit.reserved ?? generation.usage?.estimatedCredits ?? 0,
          reasonCode: statusForReplay(replay) === 'review_required' ? 'generation_review_required' : 'generation_completed',
          metadata: { outputAssetIds: state.outputAssetIds ?? getOutputAssetIds(state.generation ?? generation) },
        }, actor)
        : null
      state.credit = settled ?? state.credit ?? generation?.credit ?? null
      return settled
    }
    case lifecycleOperations.refundCredits: {
      const refunded = generation?.credit?.ledgerId && repositories.creativeCredits?.refund
        ? await repositories.creativeCredits.refund(generation.credit.ledgerId, {
          refundedAmount: generation.credit.reserved ?? generation.usage?.estimatedCredits ?? 0,
          reasonCode: operation.reasonCode ?? 'provider_failed',
        }, actor)
        : null
      state.credit = refunded ?? state.credit ?? generation?.credit ?? null
      return refunded
    }
    case lifecycleOperations.commitQuota: {
      const committed = generation?.quota?.reservationId && repositories.creativeQuota?.commit
        ? await repositories.creativeQuota.commit(generation.quota.reservationId, actor)
        : null
      state.quota = committed ?? state.quota ?? generation?.quota ?? null
      return committed
    }
    case lifecycleOperations.releaseQuota: {
      const released = generation?.quota?.reservationId && repositories.creativeQuota?.release
        ? await repositories.creativeQuota.release(generation.quota.reservationId, operation.reasonCode ?? 'provider_failed', actor)
        : null
      state.quota = released ?? state.quota ?? generation?.quota ?? null
      return released
    }
    case lifecycleOperations.complete:
      return repositories.creativeGenerations?.complete?.(generationId, {
        status: statusForPersistedGeneration(state.generation ?? generation),
        outputAssetIds: state.outputAssetIds ?? getOutputAssetIds(state.generation ?? generation),
        usage: generation?.usage ?? null,
        credit: state.credit ?? generation?.credit ?? null,
        quota: state.quota ?? generation?.quota ?? null,
        safety: generation?.safety ?? null,
        policy: generation?.policy ?? null,
      }, actor)
    case lifecycleOperations.fail:
      return repositories.creativeGenerations?.fail?.(generationId, {
        errorCode: generation?.errorCode ?? 'CREATIVE_PROVIDER_FAILED',
        errorMessagePreview: generation?.errorMessagePreview ?? safeErrorPreview(generation?.error ?? 'Provider failed'),
        credit: state.credit ?? generation?.credit ?? null,
        quota: state.quota ?? generation?.quota ?? null,
      }, actor)
    case lifecycleOperations.cancel:
      return repositories.creativeGenerations?.cancel?.(generationId, {
        reasonCode: operation.reasonCode ?? 'provider_cancelled',
        credit: state.credit ?? generation?.credit ?? null,
        quota: state.quota ?? generation?.quota ?? null,
      }, actor)
    case lifecycleOperations.notify:
      return repositories.providerLifecycleNotifications?.create?.({
        sourceKey: operation.key,
        generationId,
        actorHandle: generation?.actorHandle ?? replay?.generation?.actorHandle ?? actor?.handle ?? null,
        type: operation.metadata.notificationType,
        metadata: operation.metadata,
      }, actor) ?? null
    case lifecycleOperations.audit:
      return repositories.providerLifecycleAudit?.record?.({
        sourceKey: operation.key,
        generationId,
        action: operation.metadata.auditAction,
        metadata: operation.metadata,
      }, actor) ?? null
    default:
      return null
  }
}

export const executeProviderSideEffectPlan = async ({
  replay,
  repositories = {},
  actor = null,
  sideEffectResult = replay?.sideEffectResult ?? {},
  fetchOutput = null,
} = {}) => {
  const plan = buildProviderSideEffectPlan({ replay, sideEffectResult })
  const previousOperations = new Map((sideEffectResult?.operations ?? []).map((operation) => [operation.key, operation]))
  const state = {
    generation: replay?.generation ?? null,
    outputAssetIds: null,
    credit: null,
    quota: null,
  }
  const operations = []

  for (const operation of plan.operations) {
    if (operation.alreadyCompleted) {
      const previous = previousOperations.get(operation.key)
      if (operation.type === lifecycleOperations.persistOutputs && previous?.result?.outputAssetIds) {
        state.outputAssetIds = previous.result.outputAssetIds
      }
      if ([lifecycleOperations.settleCredits, lifecycleOperations.refundCredits].includes(operation.type) && previous?.result) {
        state.credit = previous.result
      }
      if ([lifecycleOperations.commitQuota, lifecycleOperations.releaseQuota].includes(operation.type) && previous?.result) {
        state.quota = previous.result
      }
      operations.push({ key: operation.key, type: operation.type, status: 'skipped', result: previous?.result ?? null })
      continue
    }
    try {
      const result = await executeOperation({ operation, replay, repositories, actor, state, fetchOutput })
      operations.push({ key: operation.key, type: operation.type, status: 'succeeded', result: ledgerOperationResult(operation, result) })
    } catch (error) {
      const failure = safeProviderFailure(error)
      operations.push({
        key: operation.key,
        type: operation.type,
        status: 'failed',
        errorPreview: failure.messagePreview,
      })
      return {
        plan,
        completed: false,
        failedOperation: operation,
        operations,
        sideEffectResult: {
          completedOperationKeys: operations
            .filter((item) => item.status === 'succeeded' || item.status === 'skipped')
            .map((item) => item.key),
          operations,
        },
      }
    }
  }

  return {
    plan,
    completed: true,
    failedOperation: null,
    operations,
    sideEffectResult: {
      completedOperationKeys: operations
        .filter((item) => item.status === 'succeeded' || item.status === 'skipped')
        .map((item) => item.key),
      operations,
    },
  }
}
