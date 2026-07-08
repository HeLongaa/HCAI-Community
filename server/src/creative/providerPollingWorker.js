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
  generationId: generation?.id ?? null,
  providerId,
  providerMode,
  providerJobId: providerJobId ?? null,
  expectedProviderJobId: expectedProviderJobId ?? null,
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

  if (!config.enabled) return noop('polling_disabled')
  if (!supportedPollingRuntimeEnvs.includes(config.runtimeEnv)) return noop('unsupported_runtime')
  if (!supportedPollingProviderModes.includes(effectiveProviderMode)) return noop('unsupported_provider_mode')
  if (!supportedPollingProviderIds.includes(effectiveProviderId)) return noop('unsupported_provider_id')
  if (!generation) return reject('generation_missing')
  if (terminalGenerationStatuses.includes(generation.status)) return noop('terminal_generation')
  if (!providerJobId) return reject('provider_job_missing')
  if (expectedProviderJobId && expectedProviderJobId !== providerJobId) return reject('provider_job_mismatch')
  if (!generationTimestamp) return reject('generation_timestamp_missing')

  const ageMs = now.getTime() - new Date(generationTimestamp).getTime()
  if (ageMs < 0) return reject('generation_timestamp_future')
  if (ageMs > config.maxAgeSeconds * 1000) return noop('polling_window_expired')
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

const pollingIdempotencyKey = ({ plan, generation, statusResult }) =>
  [
    'polling',
    plan.providerId,
    plan.providerMode,
    generation.id,
    plan.providerJobId,
    statusResult.normalizedStatus ?? 'unknown',
    replayPayloadDigest(statusResult) ?? 'no-payload',
  ].map((part) => normalizeSegment(part)).join(':')

const pollingProviderEventId = ({ plan, statusResult }) =>
  [
    'polling',
    plan.providerId,
    plan.providerMode,
    plan.providerJobId,
    statusResult.normalizedStatus ?? 'unknown',
  ].map((part) => normalizeSegment(part)).join(':')

export const pollProviderGenerationOnce = async ({
  generation,
  repositories = {},
  providerStatusClients = {},
  source = process.env,
  now = new Date(),
  actor = actorForGeneration(generation),
} = {}) => {
  const plan = buildProviderPollingPlan({
    generation,
    providerId: generation?.providerId,
    providerMode: generation?.providerMode,
    expectedProviderJobId: generation?.providerJobId ?? null,
    source,
    now,
  })

  if (!plan.shouldPoll) {
    return { generationId: generation?.id ?? null, polled: false, replayed: false, plan }
  }

  const client = statusClientForPlan(providerStatusClients, plan)
  if (!client?.getPrediction) {
    return {
      generationId: generation.id,
      polled: false,
      replayed: false,
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

  if (!statusResult.ok || !statusResult.shouldReplay) {
    return {
      generationId: generation.id,
      polled: true,
      replayed: false,
      plan,
      statusResult,
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
      ...replay,
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
  })

  return {
    generationId: generation.id,
    polled: true,
    replayed: true,
    plan,
    statusResult,
    applied,
  }
}

const listPollingCandidatesForStatus = async ({ repositories, status, limit }) => {
  const listed = await repositories.creativeGenerations?.list?.({ status, limit })
  return listed?.items ?? []
}

export const listProviderPollingCandidates = async ({
  repositories = {},
  source = process.env,
  limit,
} = {}) => {
  if (!repositories.creativeGenerations?.list) {
    return []
  }
  const config = providerPollingConfig(source)
  const maxItems = Math.max(1, limit ?? config.sweepLimit)
  const batches = await Promise.all(pollingCandidateStatuses.map((status) =>
    listPollingCandidatesForStatus({ repositories, status, limit: maxItems })))
  return batches
    .flat()
    .filter((generation) => normalizeSegment(generation.providerMode, 'mock') === config.providerMode)
    .filter((generation) => normalizeProviderId(generation.providerId, config.providerId) === config.providerId)
    .slice(0, maxItems)
}

export const runProviderPollingWorkerOnce = async ({
  repositories = {},
  providerStatusClients = {},
  source = process.env,
  now = new Date(),
  limit,
  actor = null,
} = {}) => {
  const config = providerPollingConfig(source)
  if (!config.enabled) {
    return {
      enabled: false,
      reasonCode: 'polling_disabled',
      candidates: 0,
      polled: 0,
      replayed: 0,
      results: [],
    }
  }
  const candidates = await listProviderPollingCandidates({ repositories, source, limit })
  const results = []
  for (const generation of candidates) {
    results.push(await pollProviderGenerationOnce({
      generation,
      repositories,
      providerStatusClients,
      source,
      now,
      actor: actor ?? actorForGeneration(generation),
    }))
  }
  return {
    enabled: true,
    candidates: candidates.length,
    polled: results.filter((result) => result.polled).length,
    replayed: results.filter((result) => result.replayed).length,
    results,
  }
}
