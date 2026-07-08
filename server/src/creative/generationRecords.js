import { createHash } from 'node:crypto'

export const creativeGenerationStatuses = ['queued', 'running', 'completed', 'failed', 'cancelled', 'review_required']

export const promptPreview = (prompt) => String(prompt ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)

export const sha256 = (value) => createHash('sha256').update(String(value ?? '')).digest('hex')

const redactSensitiveText = (value) => String(value ?? '')
  .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, '<redacted>')
  .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gi, '<redacted>')
  .replace(/\b(api[_-]?key|token|secret|password)=([^&\s]+)/gi, '$1=<redacted>')
  .replace(/https?:\/\/[^\s)]+/gi, '<redacted-url>')

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
