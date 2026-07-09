import { createHash } from 'node:crypto'

export const creativeGenerationStatuses = ['queued', 'running', 'completed', 'failed', 'cancelled', 'review_required']

export const promptPreview = (prompt) => String(prompt ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)

export const sha256 = (value) => createHash('sha256').update(String(value ?? '')).digest('hex')

const safeProviderJobIdPattern = /^[a-z0-9][a-z0-9:_-]{0,96}$/i

const stableEvidenceHash = (value) =>
  createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex')

export const safeProviderJobIdEvidence = (value) => {
  if (value == null || value === '') return null
  const normalized = String(value).trim()
  return safeProviderJobIdPattern.test(normalized)
    ? normalized
    : `redacted_${stableEvidenceHash(value).slice(0, 16)}`
}

const redactSensitiveText = (value) => String(value ?? '')
  .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, '<redacted>')
  .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gi, '<redacted>')
  .replace(/\b(api[_-]?key|token|secret|password)=([^&\s]+)/gi, '$1=<redacted>')
  .replace(/https?:\/\/[^\s)]+/gi, '<redacted-url>')

const safeMetadataText = (value) =>
  redactSensitiveText(value).replace(/\s+/g, ' ').trim().slice(0, 160)

const safeMetadataStringArray = (value) =>
  Array.isArray(value)
    ? value.map(safeMetadataText).filter(Boolean).slice(0, 20)
    : []

export const safeCreativeCreditMetadata = (metadata) => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null
  }
  const safe = {}
  if (metadata.providerId != null) safe.providerId = safeMetadataText(metadata.providerId)
  if (metadata.providerMode != null) safe.providerMode = safeMetadataText(metadata.providerMode)
  if (metadata.costModel != null) safe.costModel = safeMetadataText(metadata.costModel)
  if (metadata.metered != null) safe.metered = Boolean(metadata.metered)
  if (metadata.reviewRequired != null) safe.reviewRequired = Boolean(metadata.reviewRequired)
  const outputAssetIds = safeMetadataStringArray(metadata.outputAssetIds)
  if (outputAssetIds.length > 0) safe.outputAssetIds = outputAssetIds
  return Object.keys(safe).length > 0 ? safe : null
}

export const buildCreativeGenerationRecordPayload = (generation, actor, overrides = {}) => ({
  id: generation.id,
  actorId: actor?.id ?? generation.createdBy?.id ?? null,
  actorHandle: actor?.handle ?? generation.createdBy?.handle ?? null,
  workspace: generation.workspace,
  mode: generation.mode,
  providerId: generation.provider?.id ?? null,
  providerMode: generation.provider?.mode ?? null,
  status: overrides.status ?? 'queued',
  promptHash: sha256(generation.prompt),
  promptPreview: promptPreview(generation.prompt),
  inputAssetIds: generation.inputAssetIds ?? [],
  parameterKeys: Object.keys(generation.parameters ?? {}).sort(),
  outputAssetIds: overrides.outputAssetIds ?? [],
  usage: generation.usage ?? null,
  credit: generation.credit ?? null,
  quota: generation.quota ?? null,
  safety: generation.safety ?? null,
  policy: generation.policy ?? null,
  providerRequestId: generation.providerRequestId ?? null,
  providerJobId: generation.providerJobId ?? null,
  errorCode: overrides.errorCode ?? null,
  errorMessagePreview: overrides.errorMessagePreview ?? null,
  createdAt: overrides.createdAt ?? generation.createdAt ?? new Date().toISOString(),
  startedAt: overrides.startedAt ?? null,
  completedAt: overrides.completedAt ?? null,
  failedAt: overrides.failedAt ?? null,
})

export const getOutputAssetIds = (generation) =>
  (generation.outputs ?? [])
    .map((output) => output.storage?.mediaAssetId ?? output.source?.persistedMediaAssetId ?? output.mediaAsset?.id ?? null)
    .filter(Boolean)

export const statusForPersistedGeneration = (generation) => {
  if (generation.safety?.reviewRequired) {
    return 'review_required'
  }
  if ((generation.outputs ?? []).some((output) => output.mediaAsset?.scanStatus === 'review' || output.storage?.scanStatus === 'review')) {
    return 'review_required'
  }
  return 'completed'
}

export const safeErrorPreview = (error) =>
  redactSensitiveText(error?.message ?? error ?? 'Generation failed').replace(/\s+/g, ' ').trim().slice(0, 240)
