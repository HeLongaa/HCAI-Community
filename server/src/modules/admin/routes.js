import { ok, text } from '../../common/http/responses.js'
import { requirePermission } from '../../common/http/auth.js'
import { notFound } from '../../common/errors/httpError.js'
import { validationFailed } from '../../common/http/validation.js'
import { readJsonBody } from '../../common/http/request.js'
import {
  parseAdminAuditListQuery,
  parseAdminCreativeGenerationListQuery,
  parseAdminCreativeGenerationMutationRequest,
  parseAdminOperationsMetricsQuery,
  parseAdminPointsLedgerQuery,
  parseAdminReviewActionRequest,
  parseAdminReviewListQuery,
  parseAdminSecurityAlertActionRequest,
  parseAdminSecurityAlertSilenceRequest,
  parseAdminSecurityEventListQuery,
  parsePointAdjustmentPolicyRequest,
  parsePointAdjustmentPolicyRollbackRequest,
  parsePointAdjustmentRequest,
  parseProviderCapEvidenceRequest,
  parseProviderControlDisableRequest,
  parseProviderControlListQuery,
  parseProviderControlRecoveryRequest,
  parseUpdateRolePermissionsRequest,
} from '../../contracts/requestParsers.js'
import { repositories } from '../../repositories/index.js'
import { getProtectedRolePermissions } from '../../auth/permissions.js'
import { defaultPointAdjustmentPolicy, getDirectLimitForActor } from '../../points/adjustmentPolicy.js'
import { safeCreativeCreditMetadata, safeErrorPreview, safeProviderJobIdEvidence } from '../../creative/generationRecords.js'
import { providerMoneyAmount } from '../../creative/providerCostContract.js'
import { createProviderCapEvidence } from '../../creative/providerControlContract.js'
import { safeProviderLifecycleEvidenceIdentifier } from '../../repositories/providerLifecycleWiring.js'
import {
  cancelCreativeGeneration,
  createAdminRetryAuthorization,
} from '../../creative/generationMutationService.js'
import {
  requestManualProviderReplay,
  resolveManualProviderReplayReview,
} from '../../creative/manualReplayRequestService.js'
import { creativeAccountingPolicyHistory } from '../../creative/accountingPolicy.js'

const isPointAdjustmentReview = (review) => review?.queue === 'points' || review?.metadata?.kind === 'point_adjustment'
const isManualProviderReplayReview = (review) => review?.metadata?.kind === 'manual_provider_replay'
const isProviderControlRecoveryReview = (review) => review?.metadata?.kind === 'provider_control_recovery'

const safeProviderControlBundle = ({ controls, circuits, capEvidence, retries = [] }) => ({
  controls: controls.map((control) => ({
    id: control.id,
    scopeKey: null,
    scopeType: control.scopeType,
    providerId: safeProviderJobIdEvidence(control.providerId),
    workspace: control.workspace,
    modelFamily: safeProviderJobIdEvidence(control.modelFamily),
    enabled: control.enabled,
    version: control.version,
    reasonCode: control.reasonCode,
    enabledAt: control.enabledAt,
    disabledAt: control.disabledAt,
    updatedAt: control.updatedAt,
  })),
  circuits: circuits.map((circuit) => ({
    id: circuit.id,
    scopeKey: null,
    providerId: safeProviderJobIdEvidence(circuit.providerId),
    workspace: circuit.workspace,
    modelFamily: safeProviderJobIdEvidence(circuit.modelFamily),
    status: circuit.status,
    version: circuit.version,
    failureCount: circuit.failureCount,
    windowStartedAt: circuit.windowStartedAt,
    lastFailureAt: circuit.lastFailureAt,
    openedAt: circuit.openedAt,
    cooldownUntil: circuit.cooldownUntil,
    probeLeaseActive: circuit.probeLeaseActive,
    probeLeaseExpiresAt: circuit.probeLeaseExpiresAt,
    reasonCode: circuit.reasonCode,
  })),
  capEvidence: capEvidence.filter(Boolean).map((evidence) => ({
    id: safeProviderJobIdEvidence(evidence.id),
    providerId: safeProviderJobIdEvidence(evidence.providerId),
    currency: evidence.currency,
    capAmount: providerMoneyAmount(evidence.capMicros),
    remainingAmount: providerMoneyAmount(evidence.remainingMicros),
    sourceType: evidence.sourceType,
    evidenceHashPresent: Boolean(evidence.evidenceHash),
    evidenceHashPreview: evidence.evidenceHash ? evidence.evidenceHash.slice(0, 12) : null,
    verifiedAt: evidence.verifiedAt,
    expiresAt: evidence.expiresAt,
    active: evidence.active,
  })),
  retries: retries.map((state) => ({
    id: safeProviderJobIdEvidence(state.id),
    generationId: safeProviderJobIdEvidence(state.generationId),
    providerId: safeProviderJobIdEvidence(state.providerId),
    workspace: state.workspace,
    operationType: state.operationType,
    status: state.status,
    attempt: state.attempt,
    maxAttempts: state.maxAttempts,
    firstAttemptAt: state.firstAttemptAt,
    lastAttemptAt: state.lastAttemptAt,
    nextAttemptAt: state.nextAttemptAt,
    errorCode: safeProviderJobIdEvidence(state.lastErrorCode),
    errorCategory: state.lastErrorCategory,
    delaySource: state.delaySource,
    version: state.version,
    updatedAt: state.updatedAt,
  })),
})

const replaySideEffectCompleted = (replay) =>
  replay?.sideEffectResult?.completed === true

const replaySideEffectOutcome = (replay) => {
  if (replay?.sideEffectResult?.outcome) return replay.sideEffectResult.outcome
  if (replay?.action === 'noop' || replay?.action === 'ignored') return 'noop'
  if (replay?.action === 'rejected') return 'failed'
  return replaySideEffectCompleted(replay) ? 'completed' : 'pending'
}

const replayCompletedOperationCount = (replay) =>
  Array.isArray(replay?.sideEffectResult?.completedOperationKeys)
    ? replay.sideEffectResult.completedOperationKeys.length
    : 0

const replayFailedOperationType = (replay) =>
  replay?.sideEffectResult?.failedOperationType ??
  replay?.sideEffectResult?.operations?.find?.((operation) => operation?.status === 'failed')?.type ??
  null

const asRecord = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}

const safeNumber = (value) => {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const safeString = (value) => value == null ? null : safeErrorPreview(value)
const safeProviderCostEvidence = (value) => safeProviderJobIdEvidence(value)

const safeBoolean = (value) => typeof value === 'boolean' ? value : null

const safeProviderCost = (providerCost) => {
  const source = asRecord(providerCost)
  if (!source.schemaVersion && !source.providerId && !source.budget && !source.estimate && !source.actual) {
    return null
  }
  const model = asRecord(source.model)
  const job = asRecord(source.job)
  const usage = asRecord(source.usage)
  const estimate = asRecord(source.estimate)
  const actual = asRecord(source.actual)
  const budget = asRecord(source.budget)
  const risk = asRecord(source.risk)
  const pricingSnapshot = asRecord(source.pricingSnapshot)
  const ledger = asRecord(source.ledger)

  return {
    schemaVersion: safeString(source.schemaVersion),
    providerId: safeProviderCostEvidence(source.providerId),
    providerAccountRef: safeProviderCostEvidence(source.providerAccountRef),
    model: {
      providerModelId: safeProviderCostEvidence(model.providerModelId),
      providerModelVersion: safeString(model.providerModelVersion),
      displayName: safeString(model.displayName),
      family: safeString(model.family),
      pricingSource: safeString(model.pricingSource),
      pricingSnapshotAt: safeString(model.pricingSnapshotAt),
    },
    job: {
      providerRequestId: safeProviderCostEvidence(job.providerRequestId),
      providerJobId: safeProviderJobIdEvidence(job.providerJobId),
      region: safeString(job.region),
      startedAt: safeString(job.startedAt),
      completedAt: safeString(job.completedAt),
    },
    usage: {
      unit: safeString(usage.unit),
      quantity: safeNumber(usage.quantity),
      hardwareClass: safeString(usage.hardwareClass),
      outputCount: safeNumber(usage.outputCount),
      inputTokenCount: safeNumber(usage.inputTokenCount),
      outputTokenCount: safeNumber(usage.outputTokenCount),
      rawProviderUsageHash: safeString(usage.rawProviderUsageHash),
    },
    estimate: {
      currency: safeString(estimate.currency),
      amount: safeNumber(estimate.amount),
      source: safeString(estimate.source),
      confidence: safeString(estimate.confidence),
      calculatedAt: safeString(estimate.calculatedAt),
    },
    actual: {
      currency: safeString(actual.currency),
      amount: safeNumber(actual.amount),
      source: safeString(actual.source),
      confidence: safeString(actual.confidence),
      settledAt: safeString(actual.settledAt),
    },
    budget: {
      budgetScope: safeProviderCostEvidence(budget.budgetScope),
      dailyCapCurrency: safeString(budget.dailyCapCurrency),
      dailyCapAmount: safeNumber(budget.dailyCapAmount),
      spentAmount: safeNumber(budget.spentAmount),
      projectedSpendAmount: safeNumber(budget.projectedSpendAmount),
      remainingAfterEstimateAmount: safeNumber(budget.remainingAfterEstimateAmount),
      thresholdPercent: safeNumber(budget.thresholdPercent),
      status: safeString(budget.status),
    },
    risk: {
      costKnown: safeBoolean(risk.costKnown),
      costExceededEstimate: safeBoolean(risk.costExceededEstimate),
      providerUsageMissing: safeBoolean(risk.providerUsageMissing),
      billingReconciliationRequired: safeBoolean(risk.billingReconciliationRequired),
    },
    pricingSnapshot: Object.keys(pricingSnapshot).length > 0
      ? {
          schemaVersion: safeString(pricingSnapshot.schemaVersion),
          snapshotHash: safeString(pricingSnapshot.snapshotHash),
          currency: safeString(pricingSnapshot.currency),
          billingUnit: safeString(pricingSnapshot.billingUnit),
          unitPriceMicros: safeString(pricingSnapshot.unitPriceMicros),
          sourceType: safeString(pricingSnapshot.sourceType),
          calculatorVersion: safeString(pricingSnapshot.calculatorVersion),
          effectiveAt: safeString(pricingSnapshot.effectiveAt),
          capturedAt: safeString(pricingSnapshot.capturedAt),
          expiresAt: safeString(pricingSnapshot.expiresAt),
        }
      : null,
    ledger: Object.keys(ledger).length > 0
      ? {
          id: safeProviderCostEvidence(ledger.id),
          status: safeString(ledger.status),
          estimateMicros: safeString(ledger.estimateMicros),
          actualMicros: safeString(ledger.actualMicros),
          currency: safeString(ledger.currency),
          reasonCode: safeString(ledger.reasonCode),
        }
      : null,
  }
}

const safeGenerationUsage = (usage) => {
  const source = asRecord(usage)
  if (Object.keys(source).length === 0) return null
  return {
    estimatedCredits: safeNumber(source.estimatedCredits),
    quotaUnits: safeNumber(source.quotaUnits),
    creditEstimateKind: safeString(source.creditEstimateKind),
    providerCostAvailability: (() => {
      const availability = asRecord(source.providerCostAvailability)
      return Object.keys(availability).length > 0 ? {
        availability: safeString(availability.availability),
        reasonCode: safeString(availability.reasonCode),
      } : null
    })(),
    metered: safeBoolean(source.metered),
    costModel: safeString(source.costModel),
    currency: safeString(source.currency),
    providerUsageUnit: safeString(source.providerUsageUnit),
    providerCost: safeProviderCost(source.providerCost),
  }
}

const safeGenerationCredit = (credit) => {
  const source = asRecord(credit)
  if (Object.keys(source).length === 0) return null
  return {
    ledgerId: safeString(source.ledgerId),
    generationId: safeString(source.generationId),
    quotaReservationId: safeString(source.quotaReservationId),
    status: safeString(source.status),
    currency: safeString(source.currency),
    reserved: safeNumber(source.reserved),
    settled: safeNumber(source.settled),
    refunded: safeNumber(source.refunded),
    amount: safeNumber(source.amount),
    reasonCode: safeString(source.reasonCode),
    metadata: safeCreativeCreditMetadata(source.metadata),
    reservedAt: safeString(source.reservedAt),
    settledAt: safeString(source.settledAt),
    refundedAt: safeString(source.refundedAt),
    cancelledAt: safeString(source.cancelledAt),
  }
}

const safeGenerationQuota = (quota) => {
  const source = asRecord(quota)
  if (Object.keys(source).length === 0) return null
  const window = asRecord(source.window)
  return {
    policyVersion: safeString(source.policyVersion),
    scope: safeString(source.scope),
    workspace: safeString(source.workspace),
    limit: safeNumber(source.limit),
    reserved: safeNumber(source.reserved),
    used: safeNumber(source.used),
    released: safeNumber(source.released),
    remaining: safeNumber(source.remaining),
    reservationId: safeString(source.reservationId),
    window: Object.keys(window).length > 0
      ? {
          id: safeString(window.id),
          type: safeString(window.type),
          start: safeString(window.start),
          end: safeString(window.end),
          resetsAt: safeString(window.resetsAt),
        }
      : null,
  }
}

const safeGenerationSafety = (safety) => {
  const source = asRecord(safety)
  if (Object.keys(source).length === 0) return null
  return {
    moderationRequired: safeBoolean(source.moderationRequired),
    reviewRequired: safeBoolean(source.reviewRequired),
    reviewReason: safeString(source.reviewReason),
  }
}

const safeGenerationPolicy = (policy) => {
  const source = asRecord(policy)
  if (Object.keys(source).length === 0) return null
  const gates = asRecord(source.gates)
  return {
    version: safeString(source.version),
    action: safeString(source.action),
    reasonCode: safeString(source.reasonCode),
    gates: Object.keys(gates).length > 0
      ? {
          quota: safeBoolean(gates.quota),
          credit: safeBoolean(gates.credit),
          moderation: safeBoolean(gates.moderation),
          review: safeBoolean(gates.review),
        }
      : null,
  }
}

const sanitizeCreativeGenerationHistory = (generation) => ({
  ...generation,
  usage: safeGenerationUsage(generation.usage),
  credit: safeGenerationCredit(generation.credit),
  quota: safeGenerationQuota(generation.quota),
  safety: safeGenerationSafety(generation.safety),
  policy: safeGenerationPolicy(generation.policy),
  providerRequestId: safeString(generation.providerRequestId),
  providerJobId: safeProviderJobIdEvidence(generation.providerJobId),
  errorMessagePreview: generation.errorMessagePreview ? safeErrorPreview(generation.errorMessagePreview) : null,
})

const summarizeProviderReplay = (replay) => replay
  ? {
      id: safeProviderLifecycleEvidenceIdentifier(replay.id),
      sourceType: safeProviderLifecycleEvidenceIdentifier(replay.sourceType),
      action: safeProviderLifecycleEvidenceIdentifier(replay.action),
      previousStatus: safeProviderLifecycleEvidenceIdentifier(replay.previousStatus),
      normalizedStatus: safeProviderLifecycleEvidenceIdentifier(replay.normalizedStatus),
      reasonCode: safeProviderLifecycleEvidenceIdentifier(replay.reasonCode),
      providerEventIdPresent: Boolean(replay.providerEventId),
      payloadHashPresent: Boolean(replay.payloadHash),
      payloadHashPreview: replay.payloadHash
        ? safeProviderLifecycleEvidenceIdentifier(String(replay.payloadHash).slice(0, 12))
        : null,
      sideEffectOutcome: safeProviderLifecycleEvidenceIdentifier(replaySideEffectOutcome(replay)),
      sideEffectCompleted: replaySideEffectCompleted(replay),
      completedOperationCount: replayCompletedOperationCount(replay),
      failedOperationType: safeProviderLifecycleEvidenceIdentifier(replayFailedOperationType(replay)),
      errorPreviewPresent: Boolean(replay.errorPreview),
      receivedAt: replay.receivedAt ?? null,
      appliedAt: replay.appliedAt ?? null,
    }
  : null

const buildProviderReplayEvidence = async (generation, replayLedger) => {
  if (!replayLedger?.listForGeneration) {
    return {
      available: false,
      count: 0,
      appliedCount: 0,
      rejectedCount: 0,
      noopCount: 0,
      latest: null,
    }
  }
  const page = await replayLedger.listForGeneration(generation.id, { limit: 20 })
  const replays = page?.items ?? []
  return {
    available: true,
    count: replays.length,
    appliedCount: replays.filter((replay) => replay.action === 'applied').length,
    rejectedCount: replays.filter((replay) => replay.action === 'rejected').length,
    noopCount: replays.filter((replay) => replay.action === 'noop' || replay.action === 'ignored').length,
    latest: summarizeProviderReplay(replays[0] ?? null),
  }
}

const summarizeGenerationMutation = (mutation) => mutation
  ? {
      id: safeProviderLifecycleEvidenceIdentifier(mutation.id),
      type: safeProviderLifecycleEvidenceIdentifier(mutation.type),
      status: safeProviderLifecycleEvidenceIdentifier(mutation.status),
      reasonCode: safeProviderLifecycleEvidenceIdentifier(mutation.reasonCode),
      requestedByHandle: safeProviderLifecycleEvidenceIdentifier(mutation.requestedByHandle),
      reviewId: safeProviderLifecycleEvidenceIdentifier(mutation.reviewId),
      targetGenerationId: safeProviderLifecycleEvidenceIdentifier(mutation.targetGenerationId),
      completedAt: mutation.completedAt ?? null,
      createdAt: mutation.createdAt ?? null,
    }
  : null

const buildGenerationMutationEvidence = async (generation, mutationRepository) => {
  if (!mutationRepository?.listForGeneration) {
    return { available: false, count: 0, latest: null }
  }
  const page = await mutationRepository.listForGeneration(generation.id)
  const mutations = page?.items ?? []
  return {
    available: true,
    count: mutations.length,
    latest: summarizeGenerationMutation(mutations.at(-1) ?? null),
  }
}

const summarizeOutputIngestion = (ingestion) => ingestion
  ? {
      id: safeProviderLifecycleEvidenceIdentifier(ingestion.id),
      status: safeProviderLifecycleEvidenceIdentifier(ingestion.status),
      outputIndex: safeNumber(ingestion.outputIndex),
      mediaAssetId: safeProviderLifecycleEvidenceIdentifier(ingestion.mediaAssetId),
      detectedContentType: safeString(ingestion.detectedContentType),
      sizeBytes: safeNumber(ingestion.sizeBytes),
      sha256Present: Boolean(ingestion.sha256),
      sha256Preview: ingestion.sha256
        ? safeProviderLifecycleEvidenceIdentifier(String(ingestion.sha256).slice(0, 12))
        : null,
      errorCode: safeProviderLifecycleEvidenceIdentifier(ingestion.errorCode),
      claimedAt: ingestion.claimedAt ?? null,
      completedAt: ingestion.completedAt ?? null,
    }
  : null

const buildOutputIngestionEvidence = async (generation, ingestionRepository) => {
  if (!ingestionRepository?.listForGeneration) {
    return { available: false, count: 0, completedCount: 0, failedCount: 0, latest: null }
  }
  const page = await ingestionRepository.listForGeneration(generation.id)
  const ingestions = page?.items ?? []
  const latest = [...ingestions].sort((left, right) =>
    String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')))[0] ?? null
  return {
    available: true,
    count: ingestions.length,
    completedCount: ingestions.filter((ingestion) => ingestion.status === 'completed').length,
    failedCount: ingestions.filter((ingestion) => ingestion.status === 'failed').length,
    latest: summarizeOutputIngestion(latest),
  }
}

const buildProviderCostLedgerEvidence = async (generation, costRepository) => {
  if (!costRepository?.findForGeneration) {
    return { available: false, status: null }
  }
  const ledger = await costRepository.findForGeneration(generation.id)
  if (!ledger) return { available: true, status: null }
  const budget = ledger.budgetWindow ?? {}
  return {
    available: true,
    status: safeString(ledger.status),
    providerId: safeProviderCostEvidence(ledger.providerId),
    workspace: safeString(ledger.workspace),
    currency: safeString(ledger.currency),
    estimateAmount: providerMoneyAmount(ledger.estimateMicros),
    actualAmount: providerMoneyAmount(ledger.actualMicros),
    reservedAmount: providerMoneyAmount(ledger.reservedMicros),
    reasonCode: safeString(ledger.reasonCode),
    pricingSnapshotHashPresent: Boolean(ledger.pricingSnapshotHash),
    pricingSnapshotHashPreview: ledger.pricingSnapshotHash
      ? safeString(String(ledger.pricingSnapshotHash).slice(0, 12))
      : null,
    budget: {
      scope: safeProviderCostEvidence(budget.budgetScope),
      capAmount: providerMoneyAmount(budget.capMicros),
      reservedAmount: providerMoneyAmount(budget.reservedMicros),
      spentAmount: providerMoneyAmount(budget.spentMicros),
      releasedAmount: providerMoneyAmount(budget.releasedMicros),
      windowStart: safeString(budget.windowStart),
      windowEnd: safeString(budget.windowEnd),
    },
  }
}

const attachProviderReplayEvidence = async (
  generation,
  replayLedger,
  mutationRepository,
  ingestionRepository,
  costRepository,
) => ({
  ...sanitizeCreativeGenerationHistory(generation),
  providerReplayEvidence: await buildProviderReplayEvidence(generation, replayLedger),
  mutationEvidence: await buildGenerationMutationEvidence(generation, mutationRepository),
  outputIngestionEvidence: await buildOutputIngestionEvidence(generation, ingestionRepository),
  providerCostLedgerEvidence: await buildProviderCostLedgerEvidence(generation, costRepository),
})

const attachProviderReplayEvidenceToPage = async (
  items,
  replayLedger,
  mutationRepository,
  ingestionRepository,
  costRepository,
) =>
  Promise.all(items.map((generation) => attachProviderReplayEvidence(
    generation,
    replayLedger,
    mutationRepository,
    ingestionRepository,
    costRepository,
  )))

const csvCell = (value) => {
  const textValue = String(value ?? '')
  return /[",\n]/.test(textValue) ? `"${textValue.replace(/"/g, '""')}"` : textValue
}

const ledgerCsv = (items) => [
  ['id', 'userHandle', 'occurredAt', 'description', 'delta', 'balanceAfter', 'status', 'sourceType', 'sourceId'].join(','),
  ...items.map((item) => [
    item.id,
    item.userHandle,
    item.occurredAtLabel,
    item.description,
    item.delta,
    item.balanceAfter,
    item.status,
    item.sourceType,
    item.sourceId,
  ].map(csvCell).join(',')),
].join('\n')

const auditExportJson = (events, query) => JSON.stringify({
  exportedAt: new Date().toISOString(),
  query: {
    action: query.action ?? null,
    resourceType: query.resourceType ?? null,
    actorId: query.actorId ?? null,
    limit: query.limit,
  },
  count: events.length,
  events,
}, null, 2)

const securityAlertExportJson = (artifact) => JSON.stringify(artifact, null, 2)

const operationsMetricsExportJson = (artifact) => JSON.stringify(artifact, null, 2)

export const registerAdminRoutes = (router, options = {}) => {
  const routeRepositories = options.repositories ?? repositories
  const providerMutationAdapters = options.providerMutationAdapters ?? {}
  router.add('GET', '/api/admin/creative/accounting-policy/history', async (_request, response, context) => {
    requirePermission(context, 'admin:audit:read')
    ok(response, creativeAccountingPolicyHistory.map((policy) => ({
      schema: policy.schema,
      version: policy.version,
      effectiveAt: policy.effectiveAt,
      status: policy.status,
      immutable: policy.history.immutable,
      policy,
    })), {
      pagination: { limit: creativeAccountingPolicyHistory.length, nextCursor: null },
    })
  })
  router.add('GET', '/api/admin/creative/provider-controls', async (_request, response, context) => {
    requirePermission(context, 'admin:creative:provider-control:read')
    const query = parseProviderControlListQuery(context.query)
    const [controlPage, circuitPage, retryPage] = await Promise.all([
      routeRepositories.creativeProviderControls.list(query),
      routeRepositories.creativeProviderControls.listCircuits(query),
      routeRepositories.creativeProviderRetries?.list?.(query) ?? { items: [], nextCursor: null },
    ])
    const providerControls = controlPage.items.filter((control) => control.scopeType === 'provider')
    const capEvidence = await Promise.all(providerControls.map((control) =>
      routeRepositories.creativeProviderControls.findCapEvidence(control.scopeKey)))
    ok(response, safeProviderControlBundle({
      controls: controlPage.items,
      circuits: circuitPage.items,
      capEvidence,
      retries: retryPage.items,
    }), {
      pagination: {
        limit: query.limit,
        nextCursor: controlPage.nextCursor ?? circuitPage.nextCursor ?? retryPage.nextCursor,
      },
    })
  })

  router.add('POST', '/api/admin/creative/provider-controls/disable', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:creative:provider-control:manage')
    const payload = parseProviderControlDisableRequest((await readJsonBody(request)) ?? {})
    const current = await routeRepositories.creativeProviderControls.findControlById(payload.resourceId)
    if (!current) throw notFound('/api/admin/creative/provider-controls/disable')
    const result = await routeRepositories.creativeProviderControls.setControl({
      ...current,
      enabled: false,
      expectedVersion: payload.expectedVersion,
      reasonCode: payload.reasonCode,
    }, actor)
    ok(response, {
      changed: result.changed,
      control: safeProviderControlBundle({ controls: [result.control], circuits: [], capEvidence: [], retries: [] }).controls[0],
    })
  })

  router.add('POST', '/api/admin/creative/provider-controls/cap-evidence', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:creative:provider-control:manage')
    const payload = parseProviderCapEvidenceRequest((await readJsonBody(request)) ?? {})
    const evidence = createProviderCapEvidence(payload)
    const result = await routeRepositories.creativeProviderControls.putCapEvidence(evidence, actor)
    ok(response, {
      created: result.created,
      evidence: safeProviderControlBundle({ controls: [], circuits: [], capEvidence: [result.evidence], retries: [] }).capEvidence[0],
    })
  })

  router.add('POST', '/api/admin/creative/provider-controls/recovery-requests', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:creative:provider-control:recover')
    const payload = parseProviderControlRecoveryRequest((await readJsonBody(request)) ?? {})
    const resource = payload.target === 'enable'
      ? await routeRepositories.creativeProviderControls.findControlById(payload.resourceId)
      : await routeRepositories.creativeProviderControls.findCircuitById(payload.resourceId)
    if (!resource) throw notFound('/api/admin/creative/provider-controls/recovery-requests')
    const result = await routeRepositories.creativeProviderControls.requestRecovery(payload, actor)
    ok(response, result)
  })

  router.add('GET', '/api/admin/permissions', async (_request, response, context) => {
    requirePermission(context, 'admin:audit:read')
    const permissions = await repositories.authorization.listPermissions()
    ok(response, permissions, {
      pagination: {
        limit: permissions.length,
        nextCursor: null,
      },
    })
  })

  router.add('GET', '/api/admin/roles', async (_request, response, context) => {
    requirePermission(context, 'admin:audit:read')
    const roles = await repositories.authorization.listRolePermissions()
    ok(response, roles, {
      pagination: {
        limit: roles.length,
        nextCursor: null,
      },
    })
  })

  router.add('PUT', '/api/admin/roles/:role/permissions', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:permissions:manage')
    const body = (await readJsonBody(request)) ?? {}
    const payload = parseUpdateRolePermissionsRequest(body)
    const missingProtectedPermissions = getProtectedRolePermissions(context.params.role).filter(
      (permission) => !payload.permissions.includes(permission),
    )
    if (missingProtectedPermissions.length > 0) {
      throw validationFailed(`cannot remove protected permissions: ${missingProtectedPermissions.join(', ')}`)
    }
    const updated = await repositories.authorization.updateRolePermissions(context.params.role, payload.permissions, actor)
    if (!updated) {
      throw notFound(`/api/admin/roles/${context.params.role}/permissions`)
    }
    ok(response, updated)
  })

  router.add('GET', '/api/admin/reviews', async (_request, response, context) => {
    requirePermission(context, 'admin:queue:read')
    const page = await repositories.adminReviews.list(parseAdminReviewListQuery(context.query))
    ok(response, page.items, {
      pagination: {
        limit: page.limit,
        nextCursor: page.nextCursor,
      },
    })
  })

  router.add('POST', '/api/admin/reviews/:id/actions', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:queue:review')
    const body = (await readJsonBody(request)) ?? {}
    const action = parseAdminReviewActionRequest(body)
    const current = await routeRepositories.adminReviews.find(context.params.id)
    if (!current) {
      throw notFound(`/api/admin/reviews/${context.params.id}`)
    }
    if (!current.decision && isPointAdjustmentReview(current)) {
      requirePermission(context, 'points:adjust')
      if (action.decision === 'approve' && current.metadata?.requestedBy === actor.handle) {
        throw validationFailed('point adjustment reviews require a different approver')
      }
    }
    if (!current.decision && isManualProviderReplayReview(current)) {
      requirePermission(context, 'admin:creative:replay')
      if (action.decision === 'approve' && current.metadata?.requestedBy === actor.handle) {
        throw validationFailed('manual Provider replay requires a different approver')
      }
    }
    if (!current.decision && isProviderControlRecoveryReview(current)) {
      requirePermission(context, 'admin:creative:provider-control:recover')
      if (action.decision === 'approve' && current.metadata?.requestedBy === actor.handle) {
        throw validationFailed('Provider control recovery requires a different approver')
      }
      const recovered = await routeRepositories.creativeProviderControls.reviewRecovery(current.id, action, actor)
      if (!recovered) throw notFound(`/api/admin/reviews/${context.params.id}`)
      ok(response, {
        review: recovered.review,
        result: recovered.result?.enabled !== undefined
          ? safeProviderControlBundle({ controls: [recovered.result], circuits: [], capEvidence: [], retries: [] }).controls[0]
          : recovered.result
            ? safeProviderControlBundle({ controls: [], circuits: [recovered.result], capEvidence: [], retries: [] }).circuits[0]
            : null,
        probeAuthorized: Boolean(recovered.probeToken),
      })
      return
    }
    const reviewed = await routeRepositories.adminReviews.review(context.params.id, action, actor)
    if (!reviewed) {
      throw notFound(`/api/admin/reviews/${context.params.id}`)
    }
    if (isManualProviderReplayReview(current) && !current.decision) {
      const mutation = await resolveManualProviderReplayReview({
        review: current,
        decision: action.decision,
        actor,
        repositories: routeRepositories,
      })
      ok(response, { ...reviewed, mutation })
      return
    }
    ok(response, reviewed)
  })

  router.add('GET', '/api/admin/audit', async (_request, response, context) => {
    requirePermission(context, 'admin:audit:read')
    const page = await repositories.audit.list(parseAdminAuditListQuery(context.query))
    ok(response, page.items, {
      pagination: {
        limit: page.limit,
        nextCursor: page.nextCursor,
      },
    })
  })

  router.add('GET', '/api/admin/audit/export', async (_request, response, context) => {
    requirePermission(context, 'admin:audit:read')
    const query = parseAdminAuditListQuery({ ...context.query, limit: context.query.limit ?? '100' })
    const page = await repositories.audit.list(query)
    text(response, 200, auditExportJson(page.items, query), 'application/json; charset=utf-8')
  })

  router.add('GET', '/api/admin/audit/:id', async (_request, response, context) => {
    requirePermission(context, 'admin:audit:read')
    const event = await repositories.audit.find(context.params.id)
    if (!event) {
      throw notFound(`/api/admin/audit/${context.params.id}`)
    }
    ok(response, event)
  })

  router.add('GET', '/api/admin/creative/generations', async (_request, response, context) => {
    requirePermission(context, 'admin:audit:read')
    const page = await routeRepositories.creativeGenerations.list(parseAdminCreativeGenerationListQuery(context.query))
    const items = await attachProviderReplayEvidenceToPage(
      page.items,
      routeRepositories.creativeProviderReplays,
      routeRepositories.creativeGenerationMutations,
      routeRepositories.creativeOutputIngestions,
      routeRepositories.creativeProviderCosts,
    )
    ok(response, items, {
      pagination: {
        limit: page.limit,
        nextCursor: page.nextCursor,
      },
    })
  })

  router.add('GET', '/api/admin/creative/generations/:id', async (_request, response, context) => {
    requirePermission(context, 'admin:audit:read')
    const generation = await routeRepositories.creativeGenerations.find(context.params.id)
    if (!generation) {
      throw notFound(`/api/admin/creative/generations/${context.params.id}`)
    }
    ok(response, await attachProviderReplayEvidence(
      generation,
      routeRepositories.creativeProviderReplays,
      routeRepositories.creativeGenerationMutations,
      routeRepositories.creativeOutputIngestions,
      routeRepositories.creativeProviderCosts,
    ))
  })

  router.add('POST', '/api/admin/creative/generations/:id/cancel', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:creative:cancel')
    const payload = parseAdminCreativeGenerationMutationRequest((await readJsonBody(request)) ?? {})
    ok(response, await cancelCreativeGeneration({
      generationId: context.params.id,
      actor,
      repositories: routeRepositories,
      request: payload,
      providerMutationAdapters,
      admin: true,
    }))
  })

  router.add('POST', '/api/admin/creative/generations/:id/retry-requests', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:creative:retry')
    const payload = parseAdminCreativeGenerationMutationRequest((await readJsonBody(request)) ?? {})
    ok(response, await createAdminRetryAuthorization({
      generationId: context.params.id,
      actor,
      repositories: routeRepositories,
      request: payload,
    }))
  })

  router.add('POST', '/api/admin/creative/generations/:id/manual-replay-requests', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:creative:replay')
    const body = (await readJsonBody(request)) ?? {}
    ok(response, await requestManualProviderReplay({
      generationId: context.params.id,
      actor,
      repositories: routeRepositories,
      body,
    }))
  })

  router.add('GET', '/api/admin/security/events', async (_request, response, context) => {
    requirePermission(context, 'admin:audit:read')
    await repositories.securityEvents.flushPending?.()
    const page = await repositories.securityEvents.list(parseAdminSecurityEventListQuery(context.query))
    ok(response, page.items, {
      pagination: {
        limit: page.limit,
        nextCursor: page.nextCursor,
      },
    })
  })

  router.add('GET', '/api/admin/security/alerts', async (_request, response, context) => {
    requirePermission(context, 'admin:audit:read')
    await repositories.securityEvents.flushPending?.()
    const alerts = await repositories.securityEvents.listAlerts()
    ok(response, alerts, {
      pagination: {
        limit: alerts.length,
        nextCursor: null,
      },
    })
  })

  router.add('GET', '/api/admin/security/alerts/:id/events', async (_request, response, context) => {
    requirePermission(context, 'admin:audit:read')
    await repositories.securityEvents.flushPending?.()
    const events = await repositories.securityEvents.listAlertEvents?.(context.params.id, { limit: 5 })
    if (!events) {
      throw notFound(`/api/admin/security/alerts/${context.params.id}/events`)
    }
    ok(response, events)
  })

  router.add('GET', '/api/admin/security/alerts/:id/export', async (_request, response, context) => {
    requirePermission(context, 'admin:audit:read')
    await repositories.securityEvents.flushPending?.()
    const artifact = await repositories.securityEvents.exportAlert?.(context.params.id)
    if (!artifact) {
      throw notFound(`/api/admin/security/alerts/${context.params.id}/export`)
    }
    text(response, 200, securityAlertExportJson(artifact), 'application/json; charset=utf-8')
  })

  router.add('POST', '/api/admin/security/alerts/:id/acknowledge', async (request, response, context) => {
    const actor = requirePermission(context, 'security:alerts:manage')
    const alert = await repositories.securityEvents.acknowledgeAlert?.(
      context.params.id,
      parseAdminSecurityAlertActionRequest((await readJsonBody(request)) ?? {}),
      actor,
    )
    if (!alert) {
      throw notFound(`/api/admin/security/alerts/${context.params.id}`)
    }
    ok(response, alert)
  })

  router.add('POST', '/api/admin/security/alerts/:id/silence', async (request, response, context) => {
    const actor = requirePermission(context, 'security:alerts:manage')
    const alert = await repositories.securityEvents.silenceAlert?.(
      context.params.id,
      parseAdminSecurityAlertSilenceRequest((await readJsonBody(request)) ?? {}),
      actor,
    )
    if (!alert) {
      throw notFound(`/api/admin/security/alerts/${context.params.id}`)
    }
    ok(response, alert)
  })

  router.add('POST', '/api/admin/security/alerts/:id/unsilence', async (request, response, context) => {
    const actor = requirePermission(context, 'security:alerts:manage')
    const alert = await repositories.securityEvents.unsilenceAlert?.(
      context.params.id,
      parseAdminSecurityAlertActionRequest((await readJsonBody(request)) ?? {}),
      actor,
    )
    if (!alert) {
      throw notFound(`/api/admin/security/alerts/${context.params.id}`)
    }
    ok(response, alert)
  })

  router.add('GET', '/api/admin/operations/metrics', async (_request, response, context) => {
    requirePermission(context, 'admin:audit:read')
    await repositories.securityEvents.flushPending?.()
    ok(response, await repositories.operationsMetrics.summary(parseAdminOperationsMetricsQuery(context.query)))
  })

  router.add('GET', '/api/admin/operations/metrics/export', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:audit:read')
    await repositories.securityEvents.flushPending?.()
    const artifact = await repositories.operationsMetrics.exportSnapshot(parseAdminOperationsMetricsQuery(context.query), actor)
    text(response, 200, operationsMetricsExportJson(artifact), 'application/json; charset=utf-8')
  })

  router.add('GET', '/api/admin/points/ledger', async (_request, response, context) => {
    requirePermission(context, 'points:adjust')
    const page = await repositories.points.listLedger(parseAdminPointsLedgerQuery(context.query))
    ok(response, page.items, {
      pagination: {
        limit: page.limit,
        nextCursor: page.nextCursor,
      },
      summary: page.summary,
    })
  })

  router.add('GET', '/api/admin/points/ledger.csv', async (_request, response, context) => {
    requirePermission(context, 'points:adjust')
    const query = parseAdminPointsLedgerQuery({ ...context.query, limit: context.query.limit ?? '100' })
    const page = await repositories.points.listLedger(query)
    text(response, 200, ledgerCsv(page.items), 'text/csv; charset=utf-8')
  })

  router.add('GET', '/api/admin/points/policy', async (_request, response, context) => {
    requirePermission(context, 'points:adjust')
    const policy = await repositories.points.getAdjustmentPolicy(defaultPointAdjustmentPolicy)
    ok(response, policy)
  })

  router.add('GET', '/api/admin/points/policy/history', async (_request, response, context) => {
    requirePermission(context, 'points:adjust')
    const page = await repositories.points.listAdjustmentPolicyHistory(parseAdminReviewListQuery(context.query))
    ok(response, page.items, {
      pagination: {
        limit: page.limit,
        nextCursor: page.nextCursor,
      },
    })
  })

  router.add('PUT', '/api/admin/points/policy', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:permissions:manage')
    const payload = parsePointAdjustmentPolicyRequest((await readJsonBody(request)) ?? {})
    const policy = await repositories.points.updateAdjustmentPolicy(payload, actor, defaultPointAdjustmentPolicy)
    ok(response, policy)
  })

  router.add('POST', '/api/admin/points/policy/rollback', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:permissions:manage')
    const payload = parsePointAdjustmentPolicyRollbackRequest((await readJsonBody(request)) ?? {})
    const policy = await repositories.points.rollbackAdjustmentPolicy(payload.eventId, actor, defaultPointAdjustmentPolicy)
    if (!policy) {
      throw notFound(`/api/admin/points/policy/history/${payload.eventId}`)
    }
    ok(response, policy)
  })

  router.add('POST', '/api/admin/points/adjustments', async (request, response, context) => {
    const actor = requirePermission(context, 'points:adjust')
    const payload = parsePointAdjustmentRequest((await readJsonBody(request)) ?? {})
    const policy = await repositories.points.getAdjustmentPolicy(defaultPointAdjustmentPolicy)
    const result = await repositories.points.requestAdjustment(payload, actor, getDirectLimitForActor(policy, actor))
    if (!result) {
      throw notFound(`/api/admin/points/users/${payload.userHandle}`)
    }
    ok(response, result)
  })
}
