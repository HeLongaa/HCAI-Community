import { buildCreativeGenerationRetryEligibility } from './generationMutationService.js'
import { safeErrorPreview } from './generationRecords.js'

const activeStatuses = new Set(['queued', 'running'])
const reusableImageContentTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])

const action = (available, reasonCode = null, extras = {}) => ({
  available,
  reasonCode: available ? null : reasonCode,
  ...extras,
})

const scanStatusForAsset = (asset) => {
  const metadata = asset?.metadata && typeof asset.metadata === 'object' ? asset.metadata : {}
  const security = metadata.security && typeof metadata.security === 'object' ? metadata.security : {}
  return security.scanStatus ?? 'pending'
}

const safeOutputRelation = (relation) => ({
  sourceAssetId: String(relation.sourceAssetId),
  targetAssetId: String(relation.targetAssetId),
  relationType: String(relation.relationType),
  sourceGenerationId: relation.sourceGenerationId ? String(relation.sourceGenerationId) : null,
  targetWorkspace: relation.targetWorkspace ? String(relation.targetWorkspace) : null,
  role: relation.role ? String(relation.role) : null,
})

const serializeOutputAsset = (asset) => asset
  ? {
      assetId: String(asset.id ?? asset.assetId),
      fileName: String(asset.fileName ?? ''),
      contentType: String(asset.contentType ?? 'application/octet-stream'),
      status: String(asset.status ?? 'pending'),
      scanStatus: String(asset.scanStatus ?? scanStatusForAsset(asset)),
      lineage: (asset.relations ?? []).map(safeOutputRelation),
      reuse: asset.actions?.reuse ?? null,
      createdAt: asset.createdAt ?? null,
    }
  : null

const outputAssetsForGeneration = async (generation, mediaRepository, actor) => {
  const ids = [...new Set((generation.outputAssetIds ?? []).map(String).filter(Boolean))]
  const assets = await Promise.all(ids.map(async (id) =>
    await mediaRepository?.getAssetLibraryItem?.(id, actor)
      ?? await mediaRepository?.findAccessibleCreativeInput?.(id, actor)
      ?? null))
  return assets.map(serializeOutputAsset).filter(Boolean)
}

const availableActions = (generation, outputs) => {
  const active = activeStatuses.has(generation.status)
  const retry = buildCreativeGenerationRetryEligibility(generation)
  const cleanOutputs = outputs.filter((output) => output.status === 'uploaded' && output.scanStatus === 'clean')
  return {
    poll: action(active, `generation_${generation.status}_is_terminal`),
    cancel: action(active, `generation_status_${generation.status}_not_cancellable`),
    retry: action(retry.eligible, retry.reasonCode, {
      userConfirmationRequired: retry.userConfirmationRequired,
      requiresOriginalRequest: true,
    }),
    download: action(cleanOutputs.length > 0, 'no_clean_output'),
    reuse: action(cleanOutputs.some((output) => reusableImageContentTypes.has(output.contentType)), 'no_clean_supported_image_output'),
  }
}

export const generationBelongsToActor = (generation, actor) => Boolean(
  generation && actor && (
    generation.actorHandle === actor.handle ||
    (generation.actorId && actor.id && generation.actorId === actor.id)
  ),
)

export const serializeUserCreativeGeneration = async (generation, { mediaRepository, actor }) => {
  const outputs = await outputAssetsForGeneration(generation, mediaRepository, actor)
  return {
    id: String(generation.id),
    workspace: String(generation.workspace),
    mode: String(generation.mode),
    status: String(generation.status),
    promptPreview: generation.promptPreview ? safeErrorPreview(generation.promptPreview).slice(0, 160) : null,
    inputAssetIds: (generation.inputAssetIds ?? []).map(String),
    parameterKeys: (generation.parameterKeys ?? []).map(String),
    provider: {
      id: String(generation.providerId ?? 'unknown'),
      mode: generation.providerMode ? String(generation.providerMode) : null,
    },
    attempt: {
      number: Number(generation.attemptNumber ?? 1),
      retryOfId: generation.retryOfId ? String(generation.retryOfId) : null,
    },
    usage: {
      estimatedCredits: Number(generation.usage?.estimatedCredits ?? 0),
      metered: generation.usage?.metered === true,
    },
    accounting: {
      policyVersion: generation.policy?.version ? String(generation.policy.version) : 'legacy',
      legacy: !generation.policy?.version,
      quotaUnits: Number(generation.usage?.quotaUnits ?? generation.usage?.estimatedCredits ?? 0),
      providerCost: generation.usage?.providerCost?.ledger
        ? { availability: 'available', ledgerStatus: String(generation.usage.providerCost.ledger.status ?? 'unknown') }
        : { availability: 'unavailable', ledgerStatus: null },
    },
    safety: {
      reviewRequired: generation.safety?.reviewRequired === true || generation.status === 'review_required',
    },
    error: generation.errorCode || generation.errorMessagePreview
      ? {
          code: generation.errorCode ? String(generation.errorCode) : 'CREATIVE_GENERATION_FAILED',
          message: generation.errorMessagePreview ? safeErrorPreview(generation.errorMessagePreview) : null,
        }
      : null,
    outputs,
    actions: availableActions(generation, outputs),
    startedAt: generation.startedAt ?? null,
    completedAt: generation.completedAt ?? null,
    failedAt: generation.failedAt ?? null,
    createdAt: generation.createdAt ?? null,
    updatedAt: generation.updatedAt ?? generation.createdAt ?? null,
  }
}

export const serializeUserCreativeGenerationPage = async (items, context) =>
  Promise.all((items ?? []).map((item) => serializeUserCreativeGeneration(item, context)))

const generationCenterActions = (generation, actions) => ({
  view: action(true),
  cancel: generation.workspace === 'chat'
    ? action(false, 'chat_turn_managed_in_chat_workspace')
    : actions.cancel,
  retry: actions.retry,
  download: actions.download,
  reuse: actions.reuse,
})

export const serializeUserGenerationTask = async (generation, context) => {
  const serialized = await serializeUserCreativeGeneration(generation, context)
  return {
    id: serialized.id,
    workspace: serialized.workspace,
    mode: serialized.mode,
    status: serialized.status,
    summary: serialized.workspace === 'chat' ? null : serialized.promptPreview,
    attempt: serialized.attempt,
    usage: serialized.usage,
    accounting: serialized.accounting,
    review: {
      required: serialized.safety.reviewRequired,
    },
    error: serialized.error,
    outputs: serialized.outputs,
    actions: generationCenterActions(generation, serialized.actions),
    deepLink: {
      page: 'playground',
      workspace: serialized.workspace,
    },
    startedAt: serialized.startedAt,
    completedAt: serialized.completedAt,
    failedAt: serialized.failedAt,
    createdAt: serialized.createdAt,
    updatedAt: serialized.updatedAt,
  }
}

export const serializeUserGenerationTaskPage = async (items, context) =>
  Promise.all((items ?? []).map((item) => serializeUserGenerationTask(item, context)))

export const serializeUserGenerationCenterSummary = (summary = {}) => ({
  total: Number(summary.total ?? 0),
  active: Number(summary.active ?? 0),
  failed: Number(summary.failed ?? 0),
  reviewRequired: Number(summary.reviewRequired ?? 0),
  outputAssets: Number(summary.outputAssets ?? 0),
  byStatus: summary.byStatus ?? {},
  byWorkspace: summary.byWorkspace ?? {},
})

const csvValue = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`

export const buildUserGenerationCenterExport = ({ items, query, truncated = false, exportedAt = new Date().toISOString() }) => {
  if (query.format === 'csv') {
    return [
      ['id', 'workspace', 'mode', 'status', 'attempt', 'outputs', 'estimatedCredits', 'reviewRequired', 'createdAt', 'updatedAt'],
      ...items.map((item) => [item.id, item.workspace, item.mode, item.status, item.attempt.number, item.outputs.length, item.usage.estimatedCredits, item.review.required, item.createdAt, item.updatedAt]),
    ].map((row) => row.map(csvValue).join(',')).join('\n')
  }
  return JSON.stringify({
    kind: 'creative.generation-center.export',
    schemaVersion: 1,
    exportedAt,
    filters: {
      workspace: query.workspace,
      status: query.status,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      sort: query.sort,
      direction: query.direction,
    },
    truncated: Boolean(truncated),
    items,
  })
}
