import { createHash } from 'node:crypto'

import { safeProviderFailure } from './providerAdapterContract.js'
import { fetchReplicateStagingPredictionStatus } from './replicateStagingProvider.js'
import { buildProviderLifecycleReplay, terminalGenerationStatuses } from './providerLifecycleReplay.js'
import { applyProviderReplayThroughLedger } from './providerReplayIntegration.js'

const defaultPollingMaxAgeSeconds = 60 * 60
const defaultPollingLeaseTtlSeconds = 300
const defaultPollingIntervalSeconds = 60
const defaultPollingSweepLimit = 10
const supportedPollingProviderIds = ['replicate']
const supportedPollingProviderModes = ['replicate_staging']
const supportedPollingRuntimeEnvs = ['staging']
const pollingCandidateStatuses = ['queued', 'running']
const safeEvidenceIdentifierPattern = /^[a-z0-9][a-z0-9:_-]{0,96}$/i
const providerIdAliases = {
  'replicate-staging': 'replicate',
}
const envKeyToCamel = (key) =>
  String(key).toLowerCase().replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())

const normalizeSegment = (value, fallback = 'unknown') => {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!normalized) return fallback
  return normalized.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || fallback
}

const stableHash = (value) =>
  createHash('sha256')
    .update(JSON.stringify(value ?? null))
    .digest('hex')

const safeEvidenceIdentifier = (value) => {
  if (value == null || value === '') return null
  const normalized = String(value).trim()
  return safeEvidenceIdentifierPattern.test(normalized)
    ? normalized
    : `redacted_${stableHash(value).slice(0, 16)}`
}

const normalizeProviderId = (value, fallback = 'replicate') => {
  const normalized = normalizeSegment(value, fallback)
  return providerIdAliases[normalized] ?? normalized
}

const boolFlag = (source, key, fallback = false) => {
  const camelKey = envKeyToCamel(key)
  const raw = source?.[key] ?? source?.[camelKey]
  if (raw == null || raw === '') return fallback
  if (typeof raw === 'boolean') return raw
  return String(raw).trim().toLowerCase() === 'true'
}

const positiveInteger = (source, key, fallback) => {
  const camelKey = envKeyToCamel(key)
  const raw = source?.[key] ?? source?.[camelKey]
  if (raw == null || raw === '') return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

const toIso = (value) => {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

const firstGenerationTimestamp = (generation) =>
  toIso(generation?.startedAt) ?? toIso(generation?.createdAt) ?? toIso(generation?.requestedAt) ?? null

export const buildProviderPollingLeaseKey = ({ providerId, providerMode, shard = 'default' }) =>
  [
    'creative-provider-polling',
    normalizeSegment(providerId),
    normalizeSegment(providerMode),
    normalizeSegment(shard, 'default'),
  ].join(':')

export const providerPollingConfig = (source = process.env) => ({
  enabled: boolFlag(source, 'CREATIVE_PROVIDER_POLLING_ENABLED', false),
  workerEnabled: boolFlag(source, 'CREATIVE_PROVIDER_POLLING_WORKER_ENABLED', false),
  runtimeEnv: normalizeSegment(source.CREATIVE_PROVIDER_RUNTIME_ENV ?? source.creativeProviderRuntimeEnv ?? source.DEPLOYMENT_ENV ?? source.NODE_ENV, 'development'),
  providerMode: normalizeSegment(source.CREATIVE_PROVIDER_MODE ?? source.creativeProviderMode, 'mock'),
  providerId: normalizeProviderId(source.CREATIVE_STAGING_IMAGE_PROVIDER ?? source.creativeStagingImageProvider, 'replicate'),
  maxAgeSeconds: positiveInteger(source, 'CREATIVE_PROVIDER_POLLING_MAX_AGE_SECONDS', defaultPollingMaxAgeSeconds),
  leaseTtlSeconds: positiveInteger(source, 'CREATIVE_PROVIDER_POLLING_LEASE_TTL_SECONDS', defaultPollingLeaseTtlSeconds),
  intervalSeconds: positiveInteger(source, 'CREATIVE_PROVIDER_POLLING_INTERVAL_SECONDS', defaultPollingIntervalSeconds),
  sweepLimit: positiveInteger(source, 'CREATIVE_PROVIDER_POLLING_SWEEP_LIMIT', defaultPollingSweepLimit),
  requireCreditReservation: boolFlag(source, 'CREATIVE_PROVIDER_POLLING_REQUIRE_CREDIT_RESERVATION', false),
})

const buildDecision = ({
  shouldPoll,
  action,
  reasonCode,
  generation,
  providerId,
  providerMode,
  providerJobId,
  expectedProviderJobId,
  config,
  leaseKey,
  generationTimestamp,
}) => ({
  shouldPoll,
  action,
  reasonCode,
  sourceType: 'polling',
  generationId: safeEvidenceIdentifier(generation?.id),
  providerId,
  providerMode,
  providerJobId: safeEvidenceIdentifier(providerJobId),
  expectedProviderJobId: safeEvidenceIdentifier(expectedProviderJobId),
  lease: {
    key: leaseKey,
    ttlSeconds: config.leaseTtlSeconds,
  },
  safeMetadata: {
    pollingEnabled: config.enabled,
    runtimeEnv: config.runtimeEnv,
    generationStatus: generation?.status ?? null,
    generationTimestamp,
    maxAgeSeconds: config.maxAgeSeconds,
    terminalGeneration: terminalGenerationStatuses.includes(generation?.status),
    providerJobIdPresent: Boolean(providerJobId),
    expectedProviderJobIdPresent: Boolean(expectedProviderJobId),
    creditReservationRequired: config.requireCreditReservation,
    creditReservationPresent: Boolean(generation?.creditReservationId),
  },
})

export const buildProviderPollingPlan = ({
  generation = null,
  providerId = null,
  providerMode = null,
  expectedProviderJobId = generation?.providerJobId ?? null,
  shard = 'default',
  source = process.env,
  now = new Date(),
} = {}) => {
  const config = providerPollingConfig(source)
  const effectiveProviderId = normalizeProviderId(providerId ?? config.providerId, 'replicate')
  const effectiveProviderMode = normalizeSegment(providerMode ?? config.providerMode, 'mock')
  const providerJobId = generation?.providerJobId ?? null
  const leaseKey = buildProviderPollingLeaseKey({
    providerId: effectiveProviderId,
    providerMode: effectiveProviderMode,
    shard,
  })
  const generationTimestamp = firstGenerationTimestamp(generation)
  const base = {
    generation,
    providerId: effectiveProviderId,
    providerMode: effectiveProviderMode,
    providerJobId,
    expectedProviderJobId,
    config,
    leaseKey,
    generationTimestamp,
  }
  const noop = (reasonCode) => buildDecision({ ...base, shouldPoll: false, action: 'noop', reasonCode })
  const reject = (reasonCode) => buildDecision({ ...base, shouldPoll: false, action: 'reject', reasonCode })
  const timeout = (reasonCode) => buildDecision({ ...base, shouldPoll: false, action: 'timeout', reasonCode })

  if (!config.enabled) return noop('polling_disabled')
  if (!supportedPollingRuntimeEnvs.includes(config.runtimeEnv)) return noop('unsupported_runtime')
  if (!supportedPollingProviderModes.includes(effectiveProviderMode)) return noop('unsupported_provider_mode')
  if (!supportedPollingProviderIds.includes(effectiveProviderId)) return noop('unsupported_provider_id')
  if (!generation) return reject('generation_missing')
  if (terminalGenerationStatuses.includes(generation.status)) return noop('terminal_generation')
  if (!providerJobId) return reject('provider_job_missing')
  if (!safeEvidenceIdentifierPattern.test(String(providerJobId))) return reject('provider_job_invalid')
  if (expectedProviderJobId && expectedProviderJobId !== providerJobId) return reject('provider_job_mismatch')
  if (!generationTimestamp) return reject('generation_timestamp_missing')

  const ageMs = now.getTime() - new Date(generationTimestamp).getTime()
  if (ageMs < 0) return reject('generation_timestamp_future')
  if (ageMs > config.maxAgeSeconds * 1000) return timeout('polling_window_expired')
  if (config.requireCreditReservation && !generation.creditReservationId) return noop('credit_reservation_missing')

  return buildDecision({ ...base, shouldPoll: true, action: 'poll', reasonCode: 'ready' })
}

const actorForGeneration = (generation) => ({
  id: generation?.actorId ?? null,
  handle: generation?.actorHandle ?? null,
})

const requestForGeneration = (generation) => ({
  workspace: generation.workspace,
  mode: generation.mode,
  prompt: generation.promptPreview ?? 'Provider polling fixture prompt',
  inputAssetIds: generation.inputAssetIds ?? [],
  parameters: {},
})

const providerForPlan = (plan) => ({
  id: plan.providerId,
  mode: plan.providerMode,
  label: plan.providerId === 'replicate' ? 'Replicate Image Staging Provider' : plan.providerId,
})

const statusClientForPlan = (providerStatusClients = {}, plan) =>
  providerStatusClients?.[plan.providerId]?.[plan.providerMode] ??
  providerStatusClients?.[plan.providerId] ??
  providerStatusClients?.replicate?.[plan.providerMode] ??
  providerStatusClients?.replicate ??
  null

const mergeLifecycleGeneration = ({ currentRecord, providerGeneration, plan }) => ({
  ...currentRecord,
  ...providerGeneration,
  id: currentRecord.id,
  actorId: currentRecord.actorId ?? providerGeneration.actorId ?? null,
  actorHandle: currentRecord.actorHandle ?? providerGeneration.actorHandle ?? null,
  createdBy: {
    id: currentRecord.actorId ?? providerGeneration.createdBy?.id ?? null,
    handle: currentRecord.actorHandle ?? providerGeneration.createdBy?.handle ?? null,
  },
  provider: {
    id: plan.providerId,
    mode: plan.providerMode,
    label: providerGeneration.provider?.label ?? providerForPlan(plan).label,
  },
  providerId: currentRecord.providerId ?? providerGeneration.providerId ?? plan.providerId,
  providerMode: currentRecord.providerMode ?? providerGeneration.providerMode ?? plan.providerMode,
  providerRequestId: currentRecord.providerRequestId ?? providerGeneration.providerRequestId ?? plan.providerJobId,
  providerJobId: currentRecord.providerJobId ?? providerGeneration.providerJobId ?? plan.providerJobId,
  promptPreview: currentRecord.promptPreview ?? null,
  promptHash: currentRecord.promptHash ?? null,
  inputAssetIds: currentRecord.inputAssetIds ?? [],
  parameterKeys: currentRecord.parameterKeys ?? [],
  quota: currentRecord.quota ?? providerGeneration.quota ?? null,
  credit: currentRecord.credit ?? providerGeneration.credit ?? null,
  safety: providerGeneration.safety ?? currentRecord.safety ?? null,
  policy: currentRecord.policy ?? providerGeneration.policy ?? null,
})

const replayPayloadDigest = (statusResult) =>
  statusResult.outputDigest ?? statusResult.payloadHash ?? null

const pollingReplayDigest = (statusResult) =>
  terminalGenerationStatuses.includes(statusResult.normalizedStatus)
    ? replayPayloadDigest(statusResult) ?? 'no-payload'
    : 'non-terminal'

const pollingEvidenceProviderJobId = (plan) =>
  safeEvidenceIdentifier(plan?.providerJobId) ?? 'provider-job-missing'

const pollingIdempotencyKey = ({ plan, generation, statusResult }) =>
  [
    'polling',
    plan.providerId,
    plan.providerMode,
    safeEvidenceIdentifier(generation.id) ?? 'generation-missing',
    pollingEvidenceProviderJobId(plan),
    statusResult.normalizedStatus ?? 'unknown',
    pollingReplayDigest(statusResult),
  ].map((part) => normalizeSegment(part)).join(':')

const pollingProviderEventId = ({ plan, statusResult }) =>
  [
    'polling',
    plan.providerId,
    plan.providerMode,
    pollingEvidenceProviderJobId(plan),
    statusResult.normalizedStatus ?? 'unknown',
  ].map((part) => normalizeSegment(part)).join(':')

const safeReplayEvidence = ({ replay, plan }) => {
  const providerJobId = pollingEvidenceProviderJobId(plan)
  return {
    ...replay,
    providerJobId,
    generation: {
      ...replay.generation,
      providerRequestId: providerJobId,
      providerJobId,
    },
  }
}

const safePollingStatusResult = ({ statusResult, plan }) => {
  if (!statusResult) return statusResult
  const providerJobId = pollingEvidenceProviderJobId(plan)
  return {
    ok: Boolean(statusResult.ok),
    shouldReplay: Boolean(statusResult.shouldReplay),
    action: safeEvidenceIdentifier(statusResult.action),
    sourceType: 'polling',
    providerId: safeEvidenceIdentifier(statusResult.providerId) ?? plan.providerId,
    providerMode: safeEvidenceIdentifier(statusResult.providerMode) ?? plan.providerMode,
    providerJobId,
    providerStatus: safeEvidenceIdentifier(statusResult.providerStatus),
    normalizedStatus: safeEvidenceIdentifier(statusResult.normalizedStatus),
    receivedAt: toIso(statusResult.receivedAt),
    payloadHash: safeEvidenceIdentifier(statusResult.payloadHash),
    outputDigest: safeEvidenceIdentifier(statusResult.outputDigest),
    reasonCode: safeEvidenceIdentifier(statusResult.reasonCode),
    safeMetadata: statusResult.safeMetadata
      ? {
          providerStatus: safeEvidenceIdentifier(statusResult.safeMetadata.providerStatus),
          normalizedStatus: safeEvidenceIdentifier(statusResult.safeMetadata.normalizedStatus),
          errorCode: safeEvidenceIdentifier(statusResult.safeMetadata.errorCode),
          outputCount: Number.isFinite(statusResult.safeMetadata.outputCount) ? statusResult.safeMetadata.outputCount : undefined,
          statusCode: Number.isInteger(statusResult.safeMetadata.statusCode) ? statusResult.safeMetadata.statusCode : undefined,
          hasProviderError: statusResult.safeMetadata.hasProviderError == null ? undefined : Boolean(statusResult.safeMetadata.hasProviderError),
          usageReported: statusResult.safeMetadata.usageReported == null ? undefined : Boolean(statusResult.safeMetadata.usageReported),
          retryable: statusResult.safeMetadata.retryable == null ? undefined : Boolean(statusResult.safeMetadata.retryable),
        }
      : null,
  }
}

const providerPollingAuditSourceKey = ({ generationId, action, discriminator }) => [
  'creative-provider-polling',
  safeEvidenceIdentifier(generationId) ?? 'unknown-generation',
  normalizeSegment(action, 'updated'),
  stableHash(discriminator).slice(0, 24),
].join(':')

const recordProviderPollingAudit = async ({
  repositories,
  action,
  generation,
  plan,
  statusResult = null,
  reasonCode,
  discriminator,
  metadata = {},
} = {}) => {
  try {
    return await repositories.providerLifecycleAudit?.record?.({
      sourceKey: providerPollingAuditSourceKey({
        generationId: generation?.id,
        action,
        discriminator,
      }),
      generationId: generation?.id,
      action,
      metadata: {
        sourceType: 'polling',
        providerId: plan?.providerId ?? generation?.providerId ?? null,
        providerMode: plan?.providerMode ?? generation?.providerMode ?? null,
        providerJobId: plan?.providerJobId ?? generation?.providerJobId ?? null,
        providerStatus: statusResult?.providerStatus ?? null,
        nextStatus: statusResult?.normalizedStatus ?? null,
        reasonCode,
        payloadHash: statusResult?.payloadHash ?? null,
        ...metadata,
      },
    }, null)
  } catch {
    return null
  }
}

const timeoutReplayFor = ({ generation, plan, now }) => {
  const timeoutGeneration = {
    ...generation,
    status: 'failed',
    outputs: [],
    errorCode: 'PROVIDER_TIMEOUT',
    errorMessagePreview: 'Creative Provider polling deadline exceeded',
    failedAt: now.toISOString(),
  }
  const idempotencyKey = [
    'polling-timeout',
    plan.providerId,
    plan.providerMode,
    safeEvidenceIdentifier(generation.id) ?? 'generation-missing',
    pollingEvidenceProviderJobId(plan),
    plan.safeMetadata.maxAgeSeconds,
  ].map((part) => normalizeSegment(part)).join(':')
  return buildProviderLifecycleReplay({
    currentRecord: generation,
    generation: timeoutGeneration,
    providerId: plan.providerId,
    providerJobId: plan.providerJobId,
    idempotencyKey,
    outputDigest: null,
  })
}

const applyProviderPollingTimeout = async ({ generation, plan, repositories, actor, now }) => {
  const payloadHash = stableHash({
    event: 'polling_timeout',
    generationId: safeEvidenceIdentifier(generation.id),
    providerId: plan.providerId,
    providerMode: plan.providerMode,
    providerJobId: pollingEvidenceProviderJobId(plan),
    maxAgeSeconds: plan.safeMetadata.maxAgeSeconds,
  })
  const replay = timeoutReplayFor({ generation, plan, now })
  const applied = await applyProviderReplayThroughLedger({
    replay: {
      ...safeReplayEvidence({ replay, plan }),
      providerId: plan.providerId,
      providerMode: plan.providerMode,
      sourceType: 'polling',
      reasonCode: 'polling_window_expired',
    },
    repositories,
    actor,
    providerEventId: [
      'polling',
      plan.providerId,
      pollingEvidenceProviderJobId(plan),
      'timed-out',
    ].map((part) => normalizeSegment(part)).join(':'),
    payloadHash,
    receivedAt: now.toISOString(),
    now,
  })

  await recordProviderPollingAudit({
    repositories,
    action: 'creative.provider_polling.timed_out',
    generation,
    plan,
    reasonCode: 'polling_window_expired',
    discriminator: { payloadHash },
    metadata: {
      nextStatus: 'failed',
      errorCode: 'PROVIDER_TIMEOUT',
      duplicate: Boolean(applied.duplicate),
      executed: Boolean(applied.executed),
      timedOut: true,
    },
  })

  return {
    generationId: safeEvidenceIdentifier(generation.id),
    polled: false,
    replayed: true,
    timedOut: true,
    retryScheduled: false,
    failed: Boolean(applied.conflict || (applied.execution && !applied.execution.completed)),
    plan,
    applied,
  }
}

const classifyProviderPollingFailure = (error) => {
  const failure = safeProviderFailure(error)
  const errorCode = safeEvidenceIdentifier(error?.code) ?? failure.code
  const reasonCode = error?.code === 'CREATIVE_PROVIDER_JOB_MISMATCH'
    ? 'provider_job_mismatch'
    : error?.code === 'CREATIVE_PROVIDER_JOB_NOT_FOUND'
      ? 'provider_job_not_found'
      : failure.code === 'PROVIDER_RATE_LIMITED'
        ? 'provider_status_rate_limited'
        : failure.code === 'PROVIDER_TIMEOUT'
          ? 'provider_status_timeout'
          : 'provider_polling_failed'
  return {
    errorCode,
    reasonCode,
    retryable: Boolean(error?.details?.retryable ?? failure.retryable),
    statusCode: failure.statusCode,
  }
}

export const pollProviderGenerationOnce = async ({
  generation,
  repositories = {},
  providerStatusClients = {},
  source = process.env,
  now = new Date(),
  actor = actorForGeneration(generation),
  fetchOutput = null,
} = {}) => {
  const plan = buildProviderPollingPlan({
    generation,
    providerId: generation?.providerId,
    providerMode: generation?.providerMode,
    expectedProviderJobId: generation?.providerJobId ?? null,
    source,
    now,
  })

  if (plan.action === 'timeout') {
    return applyProviderPollingTimeout({ generation, plan, repositories, actor, now })
  }

  if (!plan.shouldPoll) {
    return {
      generationId: safeEvidenceIdentifier(generation?.id),
      polled: false,
      replayed: false,
      timedOut: false,
      retryScheduled: false,
      failed: false,
      plan,
    }
  }

  const client = statusClientForPlan(providerStatusClients, plan)
  if (!client?.getPrediction) {
    await recordProviderPollingAudit({
      repositories,
      action: 'creative.provider_polling.rejected',
      generation,
      plan,
      reasonCode: 'status_client_missing',
      discriminator: { generationId: generation.id, reasonCode: 'status_client_missing' },
      metadata: {
        errorCode: 'PROVIDER_STATUS_CLIENT_MISSING',
        retryable: false,
        statusClientConfigured: false,
      },
    })
    return {
      generationId: safeEvidenceIdentifier(generation.id),
      polled: false,
      replayed: false,
      timedOut: false,
      retryScheduled: false,
      failed: true,
      plan: {
        ...plan,
        shouldPoll: false,
        action: 'noop',
        reasonCode: 'status_client_missing',
        safeMetadata: {
          ...plan.safeMetadata,
          statusClientInjected: false,
        },
      },
    }
  }

  const statusResult = await fetchReplicateStagingPredictionStatus({
    providerJobId: plan.providerJobId,
    expectedProviderJobId: plan.expectedProviderJobId,
    request: requestForGeneration(generation),
    provider: providerForPlan(plan),
    actor,
    client,
    source,
    now,
  })
  const safeStatusResult = safePollingStatusResult({ statusResult, plan })

  if (!statusResult.ok || !statusResult.shouldReplay) {
    const retryScheduled = Boolean(statusResult.safeMetadata?.retryable)
    const auditAction = retryScheduled
      ? 'creative.provider_polling.retry_scheduled'
      : 'creative.provider_polling.rejected'
    await recordProviderPollingAudit({
      repositories,
      action: auditAction,
      generation,
      plan,
      statusResult: safeStatusResult,
      reasonCode: safeStatusResult.reasonCode ?? 'provider_status_fetch_failed',
      discriminator: {
        receivedAt: safeStatusResult.receivedAt,
        reasonCode: safeStatusResult.reasonCode,
        statusCode: safeStatusResult.safeMetadata?.statusCode,
      },
      metadata: {
        errorCode: safeStatusResult.safeMetadata?.errorCode,
        retryable: retryScheduled,
        statusCode: safeStatusResult.safeMetadata?.statusCode,
      },
    })
    return {
      generationId: safeEvidenceIdentifier(generation.id),
      polled: true,
      replayed: false,
      timedOut: false,
      retryScheduled,
      failed: !retryScheduled,
      plan,
      statusResult: safeStatusResult,
    }
  }

  const replayGeneration = mergeLifecycleGeneration({
    currentRecord: generation,
    providerGeneration: statusResult.generation,
    plan,
  })
  const replay = buildProviderLifecycleReplay({
    currentRecord: generation,
    generation: replayGeneration,
    providerId: plan.providerId,
    providerJobId: plan.providerJobId,
    idempotencyKey: pollingIdempotencyKey({ plan, generation, statusResult }),
    outputDigest: replayPayloadDigest(statusResult),
  })
  const applied = await applyProviderReplayThroughLedger({
    replay: {
      ...safeReplayEvidence({ replay, plan }),
      providerId: plan.providerId,
      providerMode: plan.providerMode,
      sourceType: 'polling',
      reasonCode: statusResult.reasonCode ?? replay.reason ?? null,
    },
    repositories,
    actor,
    providerEventId: pollingProviderEventId({ plan, statusResult }),
    payloadHash: statusResult.payloadHash,
    receivedAt: statusResult.receivedAt,
    now,
    fetchOutput,
  })

  await recordProviderPollingAudit({
    repositories,
    action: 'creative.provider_polling.status_fetched',
    generation,
    plan,
    statusResult: safeStatusResult,
    reasonCode: applied.conflict ? 'provider_event_replay_conflict' : 'status_fetched',
    discriminator: {
      payloadHash: safeStatusResult.payloadHash,
      outcome: applied.conflict ? 'conflict' : applied.executed ? 'executed' : 'suppressed',
    },
    metadata: {
      duplicate: Boolean(applied.duplicate),
      executed: Boolean(applied.executed),
      retryable: false,
    },
  })

  return {
    generationId: safeEvidenceIdentifier(generation.id),
    polled: true,
    replayed: true,
    timedOut: false,
    retryScheduled: false,
    failed: Boolean(applied.conflict || (applied.execution && !applied.execution.completed)),
    plan,
    statusResult: safeStatusResult,
    applied,
  }
}

const listPollingCandidatesForStatus = async ({ repositories, status, limit }) => {
  const listed = await repositories.creativeGenerations?.list?.({ status, limit })
  return listed?.items ?? []
}

const pollingCandidateTimestamp = (generation) =>
  new Date(firstGenerationTimestamp(generation) ?? 0).getTime()

export const listProviderPollingCandidates = async ({
  repositories = {},
  source = process.env,
  limit,
} = {}) => {
  if (!repositories.creativeGenerations?.list && !repositories.creativeGenerations?.listPollingCandidates) {
    return []
  }
  const config = providerPollingConfig(source)
  const maxItems = Math.max(1, limit ?? config.sweepLimit)
  if (repositories.creativeGenerations.listPollingCandidates) {
    const listed = await repositories.creativeGenerations.listPollingCandidates({
      statuses: pollingCandidateStatuses,
      providerMode: config.providerMode,
      providerIds: config.providerId === 'replicate' ? ['replicate', 'replicate-staging'] : [config.providerId],
      limit: maxItems,
    })
    return (listed?.items ?? listed ?? []).slice(0, maxItems)
  }
  const batches = await Promise.all(pollingCandidateStatuses.map((status) =>
    listPollingCandidatesForStatus({ repositories, status, limit: maxItems })))
  return batches
    .flat()
    .filter((generation) => normalizeSegment(generation.providerMode, 'mock') === config.providerMode)
    .filter((generation) => normalizeProviderId(generation.providerId, config.providerId) === config.providerId)
    .sort((left, right) => pollingCandidateTimestamp(left) - pollingCandidateTimestamp(right))
    .slice(0, maxItems)
}

export const runProviderPollingWorkerOnce = async ({
  repositories = {},
  providerStatusClients = {},
  source = process.env,
  now = new Date(),
  limit,
  actor = null,
  fetchOutput = null,
} = {}) => {
  const config = providerPollingConfig(source)
  if (!config.enabled) {
    return {
      enabled: false,
      reasonCode: 'polling_disabled',
      candidates: 0,
      polled: 0,
      replayed: 0,
      timedOut: 0,
      retryScheduled: 0,
      failed: 0,
      results: [],
    }
  }
  if (!config.workerEnabled) {
    return {
      enabled: false,
      reasonCode: 'polling_worker_disabled',
      candidates: 0,
      polled: 0,
      replayed: 0,
      timedOut: 0,
      retryScheduled: 0,
      failed: 0,
      results: [],
    }
  }
  const candidates = await listProviderPollingCandidates({ repositories, source, limit })
  const results = []
  for (const generation of candidates) {
    try {
      results.push(await pollProviderGenerationOnce({
        generation,
        repositories,
        providerStatusClients,
        source,
        now,
        actor: actor ?? actorForGeneration(generation),
        fetchOutput,
      }))
    } catch (error) {
      const failure = classifyProviderPollingFailure(error)
      const plan = buildProviderPollingPlan({
        generation,
        providerId: generation?.providerId,
        providerMode: generation?.providerMode,
        expectedProviderJobId: generation?.providerJobId ?? null,
        source,
        now,
      })
      await recordProviderPollingAudit({
        repositories,
        action: failure.retryable
          ? 'creative.provider_polling.retry_scheduled'
          : 'creative.provider_polling.rejected',
        generation,
        plan,
        reasonCode: failure.reasonCode,
        discriminator: {
          generationId: generation.id,
          receivedAt: now.toISOString(),
          reasonCode: failure.reasonCode,
        },
        metadata: {
          errorCode: failure.errorCode,
          retryable: failure.retryable,
          statusCode: failure.statusCode,
        },
      })
      results.push({
        generationId: safeEvidenceIdentifier(generation.id),
        polled: false,
        replayed: false,
        timedOut: false,
        retryScheduled: failure.retryable,
        failed: !failure.retryable,
        reasonCode: failure.reasonCode,
        safeMetadata: {
          errorCode: failure.errorCode,
          retryable: failure.retryable,
          statusCode: failure.statusCode,
        },
      })
    }
  }
  return {
    enabled: true,
    candidates: candidates.length,
    polled: results.filter((result) => result.polled).length,
    replayed: results.filter((result) => result.replayed).length,
    timedOut: results.filter((result) => result.timedOut).length,
    retryScheduled: results.filter((result) => result.retryScheduled).length,
    failed: results.filter((result) => result.failed).length,
    results,
  }
}
