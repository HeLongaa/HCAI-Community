import { createHash } from 'node:crypto'

import { fileTypeFromBuffer } from 'file-type'

import { HttpError } from '../common/errors/httpError.js'
import { safeProviderFailure } from './providerAdapterContract.js'
import { assertMusicGenerationRequest, musicCapabilityContract } from './musicCapabilityContract.js'

const providerId = 'elevenlabs-music-v2-enterprise'
const providerMode = 'elevenlabs_music'
const modelId = 'music_v2'
const providerAccountRef = 'fixture'
const budgetScope = 'fixture:elevenlabs:music'
const unitPriceUsd = musicCapabilityContract.cost.primaryPublicBaselineUsdPerMinute
const perJobCapUsd = musicCapabilityContract.cost.perJobUsdCap
const dailyCapUsd = musicCapabilityContract.cost.dailyUsdCap
const monthlyCapUsd = musicCapabilityContract.cost.monthlyUsdCap
const maximumJobsPerDay = musicCapabilityContract.cost.maximumJobsPerDay
const outputMaxBytes = 16 * 1024 * 1024
const thresholdPercentDefault = 80
const musicBytesByOutput = new WeakMap()
const safeIdentifierPattern = /^[a-z0-9][a-z0-9:._-]{0,127}$/i
const responseKeys = new Set(['requestId', 'body', 'contentType', 'usage', 'license'])
const usageKeys = new Set(['generatedSeconds', 'actualCostUsd'])
const licenseKeys = new Set([
  'licenseId',
  'termsVersion',
  'rightsBasis',
  'commercialUseAllowed',
  'resaleAndStreamingAllowed',
  'attributionRequired',
  'trainingOptOutApplied',
  'evidenceStatus',
])

const providerRequestError = (reasonCode) => new HttpError(
  422,
  'CREATIVE_MUSIC_PROVIDER_REQUEST_INVALID',
  'Music Provider request failed validation',
  { providerId, reasonCode },
)

const providerResponseError = (reasonCode) => new HttpError(
  502,
  'CREATIVE_MUSIC_PROVIDER_RESPONSE_INVALID',
  'Music Provider response failed validation',
  { providerId, reasonCode },
)

const exactKeys = (value, allowed, error, reasonCode) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw error(reasonCode)
  if (Object.keys(value).some((key) => !allowed.has(key))) throw error(reasonCode)
}

const amountOrNull = (value) => {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

const boundedPercent = (value) => {
  const parsed = amountOrNull(value)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : null
}

const safeFailurePreview = (value) => String(value ?? '')
  .replace(/https?:\/\/[^\s)]+/gi, '<redacted-url>')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 240)

const safeParameters = (request) => Object.fromEntries(
  ['durationSeconds', 'genre', 'mood', 'tempoBpm', 'lyrics', 'language', 'outputFormat']
    .filter((key) => request.parameters?.[key] != null)
    .map((key) => [key, request.parameters[key]]),
)

const compiledPrompt = (request, parameters) => {
  const brief = String(request.prompt ?? '').trim()
  if (!brief) throw providerRequestError('prompt_required')
  const direction = [
    brief,
    `Genre: ${parameters.genre}.`,
    `Mood: ${parameters.mood}.`,
    `Tempo: ${parameters.tempoBpm} BPM.`,
  ]
  if (request.mode === 'instrumental') {
    direction.push('Instrumental only. Do not generate sung or spoken vocals.')
  } else {
    direction.push(`Lyrics language: ${parameters.language}.`, `Lyrics:\n${parameters.lyrics}`)
  }
  return direction.join('\n')
}

export const buildElevenLabsMusicRequest = (request) => {
  try {
    assertMusicGenerationRequest(request)
  } catch (error) {
    if (error instanceof HttpError) throw providerRequestError('application_contract_invalid')
    throw error
  }
  if (request?.workspace !== 'music' || !['instrumental', 'lyrics_to_song'].includes(request.mode)) {
    throw providerRequestError('mode_unsupported')
  }
  const parameters = {
    durationSeconds: request.parameters?.durationSeconds ?? 60,
    genre: request.parameters?.genre ?? 'cinematic',
    mood: request.parameters?.mood ?? 'calm',
    tempoBpm: request.parameters?.tempoBpm ?? 100,
    outputFormat: request.parameters?.outputFormat ?? 'mp3',
    ...(request.mode === 'lyrics_to_song'
      ? {
          lyrics: request.parameters?.lyrics,
          language: request.parameters?.language,
        }
      : {}),
  }
  if (parameters.outputFormat !== 'mp3') throw providerRequestError('output_format_unsupported')
  const body = Object.freeze({
    model_id: modelId,
    prompt: compiledPrompt(request, parameters),
    music_length_ms: parameters.durationSeconds * 1000,
    force_instrumental: request.mode === 'instrumental',
  })
  return Object.freeze({
    body,
    outputFormat: 'mp3_44100_128',
    safeFields: Object.freeze({
      model: modelId,
      mode: request.mode,
      durationSeconds: parameters.durationSeconds,
      genre: parameters.genre,
      mood: parameters.mood,
      tempoBpm: parameters.tempoBpm,
      language: parameters.language ?? null,
      outputFormat: 'mp3',
      outputCount: 1,
      inputAssetCount: 0,
    }),
  })
}

const projectUsage = (value, expectedDurationSeconds) => {
  exactKeys(value, usageKeys, providerResponseError, 'usage_invalid')
  if (!Number.isInteger(value.generatedSeconds) || value.generatedSeconds !== expectedDurationSeconds) {
    throw providerResponseError('usage_duration_invalid')
  }
  const actualCostUsd = amountOrNull(value.actualCostUsd)
  if (value.actualCostUsd != null && actualCostUsd == null) throw providerResponseError('usage_cost_invalid')
  return Object.freeze({ generatedSeconds: value.generatedSeconds, actualCostUsd })
}

const projectLicense = (value) => {
  exactKeys(value, licenseKeys, providerResponseError, 'license_invalid')
  if (!safeIdentifierPattern.test(String(value.licenseId ?? ''))) throw providerResponseError('license_id_invalid')
  if (!safeIdentifierPattern.test(String(value.termsVersion ?? ''))) throw providerResponseError('license_terms_invalid')
  if (value.rightsBasis !== 'enterprise_music_contract') throw providerResponseError('license_rights_basis_invalid')
  if (value.commercialUseAllowed !== true || value.resaleAndStreamingAllowed !== true) {
    throw providerResponseError('license_media_rights_missing')
  }
  if (value.attributionRequired !== false) throw providerResponseError('license_attribution_invalid')
  if (value.trainingOptOutApplied !== true) throw providerResponseError('license_training_opt_out_missing')
  if (value.evidenceStatus !== 'fixture_only') throw providerResponseError('license_evidence_status_invalid')
  return Object.freeze({
    schemaVersion: 'music-license-v1',
    providerId,
    licenseId: value.licenseId,
    termsVersion: value.termsVersion,
    rightsBasis: value.rightsBasis,
    commercialUseAllowed: true,
    resaleAndStreamingAllowed: true,
    attributionRequired: false,
    trainingOptOutApplied: true,
    evidenceStatus: 'fixture_only',
  })
}

export const projectElevenLabsMusicResponse = async (payload, { expectedDurationSeconds } = {}) => {
  exactKeys(payload, responseKeys, providerResponseError, 'response_invalid')
  const requestId = String(payload.requestId ?? '').trim()
  if (!safeIdentifierPattern.test(requestId)) throw providerResponseError('request_id_invalid')
  if (payload.contentType !== 'audio/mpeg') throw providerResponseError('output_content_type_invalid')
  if (!Buffer.isBuffer(payload.body) && !(payload.body instanceof Uint8Array)) {
    throw providerResponseError('output_body_invalid')
  }
  const body = Buffer.from(payload.body)
  if (body.byteLength === 0) throw providerResponseError('output_bytes_empty')
  if (body.byteLength > outputMaxBytes) throw providerResponseError('output_bytes_too_large')
  const detected = await fileTypeFromBuffer(body)
  if (detected?.mime !== 'audio/mpeg' || detected.ext !== 'mp3') {
    throw providerResponseError('output_magic_type_invalid')
  }
  return Object.freeze({
    requestId,
    output: Object.freeze({
      body,
      contentType: 'audio/mpeg',
      extension: 'mp3',
      sizeBytes: body.byteLength,
      sha256: createHash('sha256').update(body).digest('hex'),
    }),
    usage: projectUsage(payload.usage, expectedDurationSeconds),
    license: projectLicense(payload.license),
  })
}

const budgetStatus = ({ estimateAmount, spentAmount, thresholdPercent }) => {
  const projectedSpend = spentAmount + estimateAmount
  if (projectedSpend > dailyCapUsd) return 'over_budget'
  return projectedSpend >= dailyCapUsd * (thresholdPercent / 100) ? 'threshold_exceeded' : 'within_budget'
}

export const buildElevenLabsMusicCostMetadata = ({
  request,
  response = null,
  source = process.env,
  now = new Date(),
} = {}) => {
  const estimatedMinutes = (request.parameters?.durationSeconds ?? 60) / 60
  const generatedMinutes = response?.usage?.generatedSeconds == null ? null : response.usage.generatedSeconds / 60
  const estimateAmount = Number((estimatedMinutes * unitPriceUsd).toFixed(6))
  const spentAmount = amountOrNull(source.CREATIVE_ELEVENLABS_MUSIC_DAILY_SPEND_USD) ?? 0
  const configuredThreshold = source.CREATIVE_ELEVENLABS_MUSIC_BUDGET_THRESHOLD_PERCENT
  const thresholdPercent = configuredThreshold == null || configuredThreshold === ''
    ? thresholdPercentDefault
    : boundedPercent(configuredThreshold)
  const actualAmount = response?.usage?.actualCostUsd ?? null
  const nowIso = now.toISOString()
  return Object.freeze({
    schemaVersion: 'provider-cost-v1',
    providerId,
    providerAccountRef,
    model: Object.freeze({
      providerModelId: modelId,
      providerModelVersion: null,
      displayName: 'ElevenLabs Music v2 Enterprise',
      family: 'music',
      pricingSource: 'v1_public_baseline',
      pricingSnapshotAt: nowIso,
    }),
    job: Object.freeze({
      providerRequestId: response?.requestId ?? null,
      providerJobId: response?.requestId ?? null,
      region: null,
      startedAt: null,
      completedAt: response ? nowIso : null,
    }),
    usage: Object.freeze({
      unit: 'generated_minutes',
      quantity: generatedMinutes,
      outputCount: response ? 1 : null,
      rawProviderUsageHash: response?.usage
        ? createHash('sha256').update(JSON.stringify(response.usage)).digest('hex')
        : null,
    }),
    estimate: Object.freeze({
      currency: 'USD',
      amount: estimateAmount,
      billingUnit: 'generated_minutes',
      quantity: estimatedMinutes,
      unitPrice: unitPriceUsd,
      source: 'duration_price_table',
      confidence: 'estimated',
      calculatedAt: nowIso,
    }),
    actual: Object.freeze({
      currency: 'USD',
      amount: actualAmount,
      source: actualAmount == null ? 'not_reported' : 'provider_result_metadata',
      confidence: actualAmount == null ? 'unknown' : 'provider_reported',
      settledAt: actualAmount == null ? null : nowIso,
    }),
    budget: Object.freeze({
      budgetScope,
      dailyCapCurrency: 'USD',
      dailyCapAmount: dailyCapUsd,
      monthlyCapCurrency: 'USD',
      monthlyCapAmount: monthlyCapUsd,
      perJobCapAmount: perJobCapUsd,
      maximumJobsPerDay,
      spentAmount,
      thresholdPercent,
      projectedSpendAmount: spentAmount + estimateAmount,
      status: thresholdPercent == null
        ? 'invalid_threshold'
        : budgetStatus({ estimateAmount, spentAmount, thresholdPercent }),
    }),
    risk: Object.freeze({
      reconciliationRequired: Boolean(response) && actualAmount == null,
      reasonCodes: Boolean(response) && actualAmount == null ? ['actual_cost_pending'] : [],
    }),
  })
}

export const assertElevenLabsMusicBudgetAllowsDispatch = (providerCost) => {
  const estimateAmount = providerCost?.estimate?.amount
  const budget = providerCost?.budget
  let reason = null
  if (estimateAmount == null) reason = 'missing_cost_estimate'
  else if (estimateAmount > perJobCapUsd) reason = 'per_job_cap_exceeded'
  else if (budget?.dailyCapAmount !== dailyCapUsd) reason = 'daily_cap_invalid'
  else if (budget?.monthlyCapAmount !== monthlyCapUsd) reason = 'monthly_cap_invalid'
  else if (budget?.maximumJobsPerDay !== maximumJobsPerDay) reason = 'job_cap_invalid'
  else if (budget?.thresholdPercent == null) reason = 'invalid_budget_threshold'
  if (reason) {
    throw new HttpError(503, 'CREATIVE_PROVIDER_BUDGET_BLOCKED', 'Provider budget guard blocked dispatch', {
      providerId,
      budgetScope,
      reason,
    })
  }
  if (budget.status === 'over_budget') {
    throw new HttpError(429, 'CREATIVE_PROVIDER_BUDGET_EXCEEDED', 'Provider budget cap exceeded', {
      providerId,
      budgetScope,
    })
  }
}

const generationIdFor = (request, actor, response) => `gen_elevenlabs_music_${createHash('sha256')
  .update(JSON.stringify({ actorId: actor.id, mode: request.mode, prompt: request.prompt, requestId: response?.requestId ?? null }))
  .digest('hex')
  .slice(0, 16)}`

const baseGeneration = ({ request, provider, actor, source, now, response = null, generationId }) => {
  const cost = buildElevenLabsMusicCostMetadata({ request, response, source, now })
  return {
    id: generationId ?? generationIdFor(request, actor, response),
    workspace: 'music',
    mode: request.mode,
    provider: { id: provider.id, mode: provider.mode, label: provider.label },
    prompt: request.prompt,
    inputAssetIds: [],
    parameters: safeParameters(request),
    usage: {
      estimatedCredits: request.parameters?.durationSeconds ?? 60,
      providerCostCents: Math.ceil(cost.estimate.amount * 100),
      metered: true,
      providerUsageUnit: 'generated_minutes',
      providerCost: cost,
    },
    safety: { moderationRequired: true, reviewRequired: false },
    createdBy: { id: actor.id, handle: actor.handle },
    createdAt: now.toISOString(),
  }
}

const completedGeneration = ({ request, provider, actor, response, source, now, generationId }) => {
  const base = baseGeneration({ request, provider, actor, response, source, now, generationId })
  const output = {
    id: `out_elevenlabs_music_${response.output.sha256.slice(0, 16)}`,
    type: 'audio',
    label: 'ElevenLabs Music output',
    contentType: 'audio/mpeg',
    url: `inline://creative-output/${response.output.sha256}`,
    storage: {
      persisted: false,
      provider: 'elevenlabs-music-fixture',
      sizeBytes: response.output.sizeBytes,
      sha256: response.output.sha256,
    },
    source: {
      kind: 'elevenlabs_music_fixture_response',
      modelId,
      providerRequestId: response.requestId,
      outputIndex: 0,
      workspace: 'music',
    },
    license: response.license,
  }
  musicBytesByOutput.set(output, response.output)
  return {
    ...base,
    status: 'completed',
    providerRequestId: response.requestId,
    providerJobId: response.requestId,
    outputs: [output],
    completedAt: now.toISOString(),
  }
}

const failedGeneration = ({ request, provider, actor, error, source, now, generationId }) => {
  const base = baseGeneration({ request, provider, actor, source, now, generationId })
  const failure = safeProviderFailure(error)
  return {
    ...base,
    status: 'failed',
    providerRequestId: null,
    providerJobId: null,
    outputs: [],
    errorCode: failure.code,
    errorMessagePreview: safeFailurePreview(failure.messagePreview),
    failedAt: now.toISOString(),
  }
}

export const createElevenLabsMusicGeneration = async ({
  request,
  provider,
  actor,
  client,
  source = process.env,
  now = new Date(),
  generationId,
}) => {
  if (typeof client?.compose !== 'function') {
    throw new Error('ElevenLabs Music client must be injected; no default network client is registered')
  }
  const providerCost = buildElevenLabsMusicCostMetadata({ request, source, now })
  assertElevenLabsMusicBudgetAllowsDispatch(providerCost)
  const providerRequest = buildElevenLabsMusicRequest(request)
  try {
    const response = await projectElevenLabsMusicResponse(await client.compose(providerRequest), {
      expectedDurationSeconds: request.parameters?.durationSeconds ?? 60,
    })
    return completedGeneration({ request, provider, actor, response, source, now, generationId })
  } catch (error) {
    return failedGeneration({ request, provider, actor, error, source, now, generationId })
  }
}

export const readElevenLabsMusicOutputBytes = (output) => musicBytesByOutput.get(output) ?? null

export const elevenLabsMusicProviderContract = Object.freeze({
  schemaVersion: 'elevenlabs-music-fixture-boundary-v1',
  providerId,
  providerMode,
  modelId,
  fixtureOnly: true,
  providerAdapterImplemented: true,
  providerAdapterRegistered: false,
  httpClientImplemented: false,
  credentialsImplemented: false,
  networkCallsEnabled: false,
  lifecycleRegistered: false,
  outputIngestionImplemented: false,
  productionEnablementApproved: false,
})
