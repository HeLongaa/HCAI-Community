import { HttpError } from '../common/errors/httpError.js'
import { attachProductionRuntimeApproval } from '../common/runtime/productionApproval.js'
import { resolveAndRecordModelRoute } from './modelGovernanceRuntime.js'
import { assertPromotionEvaluation } from './modelEvaluationRuntime.js'
import { resolveModelRoute } from './modelRoutingRuntime.js'
import { assertProviderLegalApproval } from './providerLegalRuntime.js'
import { readProviderOperationalSnapshot } from './providerOperationsService.js'

const adapterForModality = Object.freeze({
  image: 'openai_image',
  chat: 'openai_chat',
  video: 'google_video',
  music: 'elevenlabs_music',
})
const providerIdForAdapter = Object.freeze({
  openai_image: 'openai-gpt-image-2',
  openai_chat: 'openai-gpt-5-6-terra',
  google_video: 'google-veo-3-1-fast',
  elevenlabs_music: 'elevenlabs-music-v2-enterprise',
})
const secretEnvPattern = /^secret:\/\/env\/([a-z0-9][a-z0-9-]{2,120})$/
const envKeyFor = (name) => name.replaceAll('-', '_').toUpperCase()
const unavailable = (reasonCode, details = {}) => new HttpError(503, 'MODEL_RUNTIME_ROUTE_UNAVAILABLE', 'No approved AI runtime deployment is available', { reasonCode, ...details })

const safeEndpoint = (value) => {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null
    return url.toString().replace(/\/+$/, '')
  } catch { return null }
}

const validateDeployment = (target, context) => {
  const deployment = target.deployment
  const provider = deployment?.modelVersion?.model?.provider
  if (!deployment || !provider) return { allowed: false, reasonCode: 'deployment_metadata_missing' }
  if (provider.status !== 'active') return { allowed: false, reasonCode: 'provider_inactive' }
  if (deployment.modelVersion?.model?.status !== 'active') return { allowed: false, reasonCode: 'model_inactive' }
  if (deployment.modelVersion?.status !== 'active') return { allowed: false, reasonCode: 'model_version_inactive' }
  if (deployment.status !== 'active') return { allowed: false, reasonCode: 'deployment_inactive' }
  if (!deployment.runtimeEnabled) return { allowed: false, reasonCode: 'deployment_runtime_disabled' }
  if (deployment.environment !== context.environment) return { allowed: false, reasonCode: 'deployment_environment_mismatch' }
  if (deployment.adapterType !== adapterForModality[context.modality]) return { allowed: false, reasonCode: 'deployment_adapter_mismatch' }
  if (!providerIdForAdapter[deployment.adapterType]) return { allowed: false, reasonCode: 'deployment_adapter_unsupported' }
  if (!deployment.providerModelId || !deployment.secretPurpose) return { allowed: false, reasonCode: 'deployment_runtime_config_incomplete' }
  const capability = deployment.modelVersion?.capabilities?.find((item) => item.modality === context.modality)
  if (!capability?.operations?.includes(context.operation)) return { allowed: false, reasonCode: 'deployment_capability_missing' }
  if (['openai_image', 'openai_chat', 'elevenlabs_music'].includes(deployment.adapterType) && !safeEndpoint(deployment.endpointUrl)) return { allowed: false, reasonCode: 'deployment_endpoint_invalid' }
  return { allowed: true, reasonCode: null, deployment, provider }
}

const resolveCredential = ({ secretRef, baseSource }) => {
  const match = secretRef?.secretRef?.match(secretEnvPattern)
  if (!match) return null
  const value = String(baseSource[envKeyFor(match[1])] ?? '').trim()
  return value || null
}

const safeRuntimeSnapshot = ({ target, policy, secretRef = null, promotion = null, latestLegalReview = null, operational = null }) => {
  const deployment = target?.deployment ?? null
  const modelVersion = deployment?.modelVersion ?? null
  const model = modelVersion?.model ?? null
  const provider = model?.provider ?? null
  return {
    route: policy ? { id: policy.id, key: policy.key, status: policy.status, version: policy.version, region: policy.region } : null,
    deployment: deployment ? {
      id: deployment.id, key: deployment.key, status: deployment.status, environment: deployment.environment,
      runtimeEnabled: Boolean(deployment.runtimeEnabled), trafficEligible: Boolean(deployment.trafficEligible),
      adapterType: deployment.adapterType ?? null, providerModelId: deployment.providerModelId ?? null,
    } : null,
    provider: provider ? { id: provider.id, key: provider.key, status: provider.status } : null,
    model: model ? { id: model.id, key: model.key, status: model.status } : null,
    modelVersion: modelVersion ? { id: modelVersion.id, versionKey: modelVersion.versionKey ?? null, status: modelVersion.status } : null,
    secretRef: secretRef ? { id: secretRef.id, externalVersion: secretRef.externalVersion ?? null, ownerRef: secretRef.ownerRef ?? null, expiresAt: secretRef.expiresAt ?? null } : null,
    promotion: promotion ? { id: promotion.id, releaseChangeId: promotion.releaseChangeId, status: promotion.releaseChange?.status ?? null, providerSecretRefId: promotion.providerSecretRefId } : null,
    evaluation: promotion?.evaluationRun ? { id: promotion.evaluationRun.id, status: promotion.evaluationRun.status, expiresAt: promotion.evaluationRun.expiresAt ?? null } : null,
    legal: promotion?.legalReview ? { id: promotion.legalReview.id, decision: promotion.legalReview.decision, expiresAt: promotion.legalReview.expiresAt ?? null, current: promotion.legalReview.id === latestLegalReview?.id } : null,
    operational,
  }
}

const evaluateRuntimeCandidate = async ({ target, policy, context, repositories, now, baseSource, snapshots }) => {
  const validation = validateDeployment(target, context)
  if (!validation.allowed) return validation
  const secretRef = await repositories.modelGovernance.findCurrentSecretRef?.({ providerId: validation.provider.id, environment: context.environment, purpose: validation.deployment.secretPurpose, now })
  let promotion = null
  let latestLegalReview = null
  let operationalSnapshot = null
  if (!secretRef) {
    snapshots?.set(target.id, safeRuntimeSnapshot({ target, policy }))
    return { allowed: false, reasonCode: 'provider_secret_ref_missing' }
  }
  if (context.environment === 'production') {
    promotion = await repositories.modelGovernance.findDeployedPromotionForDeployment?.(validation.deployment.id)
    if (!promotion) {
      snapshots?.set(target.id, safeRuntimeSnapshot({ target, policy, secretRef }))
      return { allowed: false, reasonCode: 'production_promotion_missing' }
    }
    if (promotion.routePolicyId !== policy.id) {
      snapshots?.set(target.id, safeRuntimeSnapshot({ target, policy, secretRef, promotion }))
      return { allowed: false, reasonCode: 'production_promotion_route_mismatch' }
    }
    if (promotion.providerSecretRefId !== secretRef.id) {
      snapshots?.set(target.id, safeRuntimeSnapshot({ target, policy, secretRef, promotion }))
      return { allowed: false, reasonCode: 'production_secret_unapproved' }
    }
    try {
      assertPromotionEvaluation({ evaluationRun: promotion.evaluationRun, modelDeploymentId: validation.deployment.id, modelVersionId: validation.deployment.modelVersion.id, now })
    } catch {
      snapshots?.set(target.id, safeRuntimeSnapshot({ target, policy, secretRef, promotion }))
      return { allowed: false, reasonCode: 'production_evaluation_invalid' }
    }
    latestLegalReview = await repositories.providerLegal?.findLatestForScope?.({ providerId: validation.provider.id, modelVersionId: validation.deployment.modelVersion.id, environment: context.environment })
    try {
      assertProviderLegalApproval({ review: promotion.legalReview, latestReview: latestLegalReview, deployment: validation.deployment, providerId: validation.provider.id, now })
    } catch {
      snapshots?.set(target.id, safeRuntimeSnapshot({ target, policy, secretRef, promotion, latestLegalReview }))
      return { allowed: false, reasonCode: 'production_legal_invalid' }
    }
    operationalSnapshot = await readProviderOperationalSnapshot({
      repositories,
      provider: validation.provider,
      deployment: validation.deployment,
      secretRef,
      workspace: context.modality,
      modelFamily: validation.deployment.modelVersion?.model?.family ?? validation.deployment.modelVersion?.model?.key ?? null,
      now,
    })
    if (!operationalSnapshot.readiness.ready) {
      snapshots?.set(target.id, safeRuntimeSnapshot({ target, policy, secretRef, promotion, latestLegalReview, operational: operationalSnapshot }))
      return { allowed: false, reasonCode: operationalSnapshot.readiness.reasonCode ?? 'provider_operational_not_ready' }
    }
  }
  const credential = resolveCredential({ secretRef, baseSource })
  snapshots?.set(target.id, safeRuntimeSnapshot({ target, policy, secretRef, promotion, latestLegalReview, operational: operationalSnapshot }))
  if (!credential) return { allowed: false, reasonCode: 'provider_secret_unresolved' }
  return { allowed: true, reasonCode: null, ...validation, secretRef, credential, operationalSnapshot }
}

export const resolveModelRuntimeReadiness = async ({ repositories, modality = 'chat', operation = 'generate', environment = 'production', region = null, role = 'member', baseSource = process.env, now = new Date() }) => {
  const context = { modality, operation, environment, region, subjectKey: 'admin-readiness', role }
  const policies = region == null && repositories.modelRouting.list
    ? (await repositories.modelRouting.list({ status: 'active', modality, environment, search: null, cursor: null, sort: 'priority', order: 'asc', limit: 100 })).items.filter((policy) => policy.operation === operation)
    : await repositories.modelRouting.match(context)
  const snapshots = new Map()
  for (const policy of policies) for (const target of policy.targets ?? []) snapshots.set(target.id, safeRuntimeSnapshot({ target, policy }))
  const result = await resolveModelRoute({
    policies,
    context,
    evaluateCandidate: (target, policy) => evaluateRuntimeCandidate({ target, policy, context, repositories, now, baseSource, snapshots }),
  })
  const selectedAttempt = result.attempts.find((attempt) => attempt.selected) ?? result.attempts[0] ?? null
  const blockerCodes = [...new Set(result.attempts.filter((attempt) => !attempt.selected).map((attempt) => attempt.reasonCode))]
  if (!blockerCodes.length && result.status !== 'selected') blockerCodes.push(result.reasonCode)
  return {
    checkedAt: now.toISOString(), modality, operation, environment, region,
    decision: result.status === 'selected' ? 'ready' : 'no_go', ready: result.status === 'selected',
    reasonCode: result.status === 'selected' ? null : blockerCodes[0] ?? result.reasonCode,
    blockerCodes,
    checks: selectedAttempt ? snapshots.get(selectedAttempt.targetId) ?? null : null,
    attempts: result.attempts,
    consideredPolicies: result.consideredPolicies,
  }
}

const sourceFor = ({ deployment, credential, baseSource, approvalEvidence }) => {
  const source = { ...baseSource }
  const enabled = deployment.runtimeEnabled ? 'true' : 'false'
  if (deployment.adapterType === 'openai_image') Object.assign(source, {
    CREATIVE_OPENAI_IMAGE_PROVIDER_TYPE: 'openai-compatible', CREATIVE_OPENAI_IMAGE_BASE_URL: deployment.endpointUrl,
    CREATIVE_OPENAI_IMAGE_MODEL: deployment.providerModelId, CREATIVE_OPENAI_IMAGE_API_TOKEN: credential,
    CREATIVE_OPENAI_IMAGE_HTTP_CLIENT_ENABLED: enabled, CREATIVE_OPENAI_IMAGE_NETWORK_CALLS_ENABLED: enabled,
    CREATIVE_OPENAI_IMAGE_CONFIRMATION: deployment.runtimeEnabled ? 'staging-only' : '',
  })
  if (deployment.adapterType === 'openai_chat') Object.assign(source, {
    CHAT_PROVIDER_TYPE: 'openai-compatible', CHAT_PROVIDER_MODE: deployment.runtimeEnabled ? (deployment.environment === 'production' ? 'openai_production' : 'openai_staging') : 'disabled',
    CHAT_OPENAI_BASE_URL: deployment.endpointUrl, CHAT_OPENAI_MODEL: deployment.providerModelId, CHAT_OPENAI_API_TOKEN: credential,
    CHAT_OPENAI_HTTP_CLIENT_ENABLED: enabled, CHAT_OPENAI_NETWORK_CALLS_ENABLED: enabled, CHAT_OPENAI_SAFETY_CLASSIFIER_ENABLED: enabled,
    CHAT_OPENAI_API_DIALECT: deployment.runtimeConfig?.apiDialect ?? 'responses',
    CHAT_OPENAI_SAFETY_RESPONSE_FORMAT: deployment.runtimeConfig?.safetyResponseFormat ?? 'json_schema',
    CHAT_OPENAI_CONFIRMATION: deployment.runtimeEnabled ? (deployment.environment === 'production' ? 'database-approved' : 'staging-only') : '',
  })
  if (deployment.adapterType === 'google_video') Object.assign(source, {
    CREATIVE_GOOGLE_VEO_PROVIDER_TYPE: 'google-vertex', CREATIVE_GOOGLE_VEO_MODEL: deployment.providerModelId,
    CREATIVE_GOOGLE_VEO_ACCESS_TOKEN: credential, CREATIVE_GOOGLE_VEO_HTTP_CLIENT_ENABLED: enabled,
    CREATIVE_GOOGLE_VEO_NETWORK_CALLS_ENABLED: enabled, CREATIVE_GOOGLE_VEO_LIFECYCLE_ENABLED: enabled,
    CREATIVE_GOOGLE_VEO_CONFIRMATION: deployment.runtimeEnabled ? 'staging-only' : '',
    CREATIVE_GOOGLE_VEO_PROJECT_ID: deployment.runtimeConfig?.projectId ?? '', CREATIVE_GOOGLE_VEO_LOCATION: deployment.runtimeConfig?.location ?? '',
    CREATIVE_GOOGLE_VEO_OUTPUT_GCS_URI: deployment.runtimeConfig?.outputGcsUri ?? '',
  })
  if (deployment.adapterType === 'elevenlabs_music') Object.assign(source, {
    CREATIVE_ELEVENLABS_MUSIC_PROVIDER_TYPE: 'elevenlabs', CREATIVE_ELEVENLABS_MUSIC_BASE_URL: deployment.endpointUrl,
    CREATIVE_ELEVENLABS_MUSIC_MODEL: deployment.providerModelId, CREATIVE_ELEVENLABS_MUSIC_API_KEY: credential,
    CREATIVE_ELEVENLABS_MUSIC_HTTP_CLIENT_ENABLED: enabled, CREATIVE_ELEVENLABS_MUSIC_NETWORK_CALLS_ENABLED: enabled,
    CREATIVE_ELEVENLABS_MUSIC_CONFIRMATION: deployment.runtimeEnabled ? 'staging-only' : '',
    CREATIVE_ELEVENLABS_MUSIC_ENTERPRISE_RIGHTS_CONFIRMED: String(Boolean(deployment.runtimeConfig?.enterpriseRightsConfirmed)),
    CREATIVE_ELEVENLABS_MUSIC_TRAINING_OPT_OUT_CONFIRMED: String(Boolean(deployment.runtimeConfig?.trainingOptOutConfirmed)),
    CREATIVE_ELEVENLABS_MUSIC_LICENSE_ID: deployment.runtimeConfig?.licenseId ?? '', CREATIVE_ELEVENLABS_MUSIC_TERMS_VERSION: deployment.runtimeConfig?.termsVersion ?? '',
  })
  if (deployment.adapterType === 'openai_chat' && deployment.environment === 'production') {
    attachProductionRuntimeApproval(source, approvalEvidence)
  }
  return Object.freeze(source)
}

export const resolveModelRuntimeDeployment = async ({ repositories, modality, operation = 'generate', environment = 'staging', region = null, actor, baseSource = process.env, now = new Date() }) => {
  if (!repositories?.modelRouting?.match || !repositories?.modelGovernance?.createDecision) return null
  const context = { modality, operation, environment, region, subjectKey: actor?.id ?? actor?.handle ?? 'anonymous', role: actor?.role ?? 'member' }
  const candidates = new Map()
  const result = await resolveAndRecordModelRoute({
    source: 'dispatch', context, actor, routingRepository: repositories.modelRouting, governanceRepository: repositories.modelGovernance,
    evaluateCandidate: async (target, policy) => {
      const evaluated = await evaluateRuntimeCandidate({ target, policy, context, repositories, now, baseSource })
      if (!evaluated.allowed) return evaluated
      candidates.set(target.id, evaluated)
      return { allowed: true, reasonCode: null }
    },
  })
  if (result.reasonCode === 'no_active_route_policy') return null
  if (result.status !== 'selected') throw unavailable(result.reasonCode, { decisionId: result.decisionId })
  const selected = candidates.get(result.selected.targetId)
  if (!selected) throw unavailable('selected_deployment_unresolved', { decisionId: result.decisionId })
  const pricing = await repositories.modelControl?.findRuntimePricing?.({ modelVersionId: selected.deployment.modelVersion.id, modelDeploymentId: selected.deployment.id, now }) ?? null
  const resolved = {
    source: 'model_control', decisionId: result.decisionId, routePolicyId: result.policy.id,
    deploymentId: selected.deployment.id, deploymentVersion: selected.deployment.version,
    providerId: providerIdForAdapter[selected.deployment.adapterType], providerKey: selected.provider.key,
    modelProviderId: selected.provider.id,
    modelVersionId: selected.deployment.modelVersion.id, providerModelId: selected.deployment.providerModelId,
    modelFamily: selected.deployment.modelVersion?.model?.family ?? selected.deployment.modelVersion?.model?.key ?? null,
    environment: selected.deployment.environment, secretPurpose: selected.deployment.secretPurpose,
    providerOperationsPolicyId: selected.operationalSnapshot?.profile?.id ?? null,
    pricingVersionId: pricing?.id ?? null,
    adapterType: selected.deployment.adapterType, secretRefId: selected.secretRef.id,
  }
  Object.defineProperty(resolved, 'runtimeSource', { value: sourceFor({
    deployment: selected.deployment,
    credential: selected.credential,
    baseSource,
    approvalEvidence: {
      environment,
      decisionId: result.decisionId,
      routePolicyId: result.policy.id,
      deploymentId: selected.deployment.id,
      secretRefId: selected.secretRef.id,
    },
  }), enumerable: false })
  return Object.freeze(resolved)
}
