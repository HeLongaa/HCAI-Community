import { terminalGenerationStatuses } from './providerLifecycleReplay.js'

const defaultPollingMaxAgeSeconds = 60 * 60
const defaultPollingLeaseTtlSeconds = 300
const supportedPollingProviderIds = ['replicate']
const supportedPollingProviderModes = ['replicate_staging']
const supportedPollingRuntimeEnvs = ['staging']

const normalizeSegment = (value, fallback = 'unknown') => {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!normalized) return fallback
  return normalized.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || fallback
}

const boolFlag = (source, key, fallback = false) => {
  const raw = source?.[key]
  if (raw == null || raw === '') return fallback
  return String(raw).trim().toLowerCase() === 'true'
}

const positiveInteger = (source, key, fallback) => {
  const raw = source?.[key]
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
  runtimeEnv: normalizeSegment(source.CREATIVE_PROVIDER_RUNTIME_ENV ?? source.DEPLOYMENT_ENV ?? source.NODE_ENV, 'development'),
  providerMode: normalizeSegment(source.CREATIVE_PROVIDER_MODE, 'mock'),
  providerId: normalizeSegment(source.CREATIVE_STAGING_IMAGE_PROVIDER, 'replicate'),
  maxAgeSeconds: positiveInteger(source, 'CREATIVE_PROVIDER_POLLING_MAX_AGE_SECONDS', defaultPollingMaxAgeSeconds),
  leaseTtlSeconds: positiveInteger(source, 'CREATIVE_PROVIDER_POLLING_LEASE_TTL_SECONDS', defaultPollingLeaseTtlSeconds),
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
  const effectiveProviderId = normalizeSegment(providerId ?? config.providerId, 'replicate')
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
