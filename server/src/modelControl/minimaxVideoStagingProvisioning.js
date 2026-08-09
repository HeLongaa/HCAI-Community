import { createHash } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'
import { buildProviderControlScopes, createProviderCapEvidence, providerCircuitScope } from '../creative/providerControlContract.js'
import {
  parseCapabilityUpsert,
  parseDeploymentCreate,
  parseModelControlListQuery,
  parseModelCreate,
  parseModelVersionCreate,
  parsePricingCreate,
  parseProviderCreate,
  transitionModelControlResource,
} from './modelControlRuntime.js'
import { parseProviderSecretRefCreate } from './modelGovernanceRuntime.js'
import { parseModelRouteListQuery, parseModelRoutePolicyCreate, parseModelRouteTargets } from './modelRoutingRuntime.js'

export const minimaxVideoStagingSpec = Object.freeze({
  providerKey: 'hcai-router-minimax-hailuo-2-3',
  modelKey: 'minimax-hailuo-video',
  versionKey: 'minimax-hailuo-2.3',
  deploymentKey: 'minimax-hailuo-2-3-staging-us',
  routeKey: 'staging-video-minimax-hailuo-2-3',
  pricingVersionKey: 'usd-generated-seconds-v1',
  providerModelId: 'MiniMax-Hailuo-2.3',
  endpointUrl: 'https://router.hctopup.com',
  environment: 'staging',
  region: 'us',
  secretPurpose: 'minimax-video-inference',
  secretRef: 'secret://env/CREATIVE_ROUTER_MINIMAX_VIDEO_API_KEY',
  unitPriceMicros: 46667,
})

const listOptions = (overrides = {}) => parseModelControlListQuery({ limit: 100, sort: 'key', order: 'asc', ...overrides })
const conflict = (resource, detail) => {
  throw new HttpError(409, 'MINIMAX_STAGING_CONFIGURATION_CONFLICT', `${resource} exists with incompatible ${detail}`)
}
const assertEqual = (resource, field, actual, expected) => {
  if (actual !== expected) conflict(resource, field)
}
const activate = async (repository, type, resource, actor) => {
  if (resource.status === 'active') return resource
  if (!['draft', 'disabled'].includes(resource.status)) conflict(type, 'status')
  return transitionModelControlResource({
    type,
    resource,
    payload: { expectedVersion: resource.version, status: 'active', reasonCode: 'minimax_staging_provisioned' },
    actor,
    repository,
  })
}
const exactItem = (items, field, expected) => items.find((item) => item[field] === expected) ?? null

const ensureProvider = async ({ repository, actor, spec }) => {
  const existing = exactItem((await repository.listProviders(listOptions({ search: spec.providerKey }))).items, 'key', spec.providerKey)
  if (existing) return activate(repository, 'provider', existing, actor)
  const created = await repository.createProvider(parseProviderCreate({
    key: spec.providerKey,
    name: 'HCAI Router MiniMax Hailuo 2.3',
    websiteUrl: spec.endpointUrl,
    regions: [spec.region],
    dataProcessingRegions: [spec.region],
  }, actor))
  return activate(repository, 'provider', created, actor)
}

const ensureModel = async ({ repository, actor, spec, provider }) => {
  const existing = exactItem((await repository.listModels(listOptions({ providerId: provider.id, search: spec.modelKey }))).items, 'key', spec.modelKey)
  if (existing) {
    assertEqual('model', 'provider', existing.providerId, provider.id)
    return activate(repository, 'model', existing, actor)
  }
  const created = await repository.createModel(parseModelCreate({ providerId: provider.id, key: spec.modelKey, name: 'MiniMax Hailuo Video', family: 'video' }, actor))
  return activate(repository, 'model', created, actor)
}

const ensureVersion = async ({ repository, actor, spec, model }) => {
  let version = exactItem((await repository.listVersions(listOptions({ modelId: model.id, search: spec.versionKey }))).items, 'versionKey', spec.versionKey)
  if (!version) {
    version = await repository.createVersion(parseModelVersionCreate({
      modelId: model.id,
      versionKey: spec.versionKey,
      maxOutputUnits: 10,
      parameterSchema: { type: 'object', properties: { prompt: { type: 'string' }, duration: { enum: [6, 10] } }, required: ['prompt'] },
    }, actor))
    await repository.upsertCapability(parseCapabilityUpsert(version.id, {
      modality: 'video',
      operations: ['generate'],
      inputMimeTypes: ['text/plain', 'image/jpeg', 'image/png', 'image/webp'],
      outputMimeTypes: ['video/mp4'],
      constraints: { durationsSeconds: [6, 10] },
    }))
    version = await repository.find('version', version.id)
  } else {
    version = await repository.find('version', version.id)
    assertEqual('model version', 'model', version.modelId, model.id)
    const capability = version.capabilities?.find((item) => item.modality === 'video')
    if (!capability?.operations?.includes('generate')) conflict('model version', 'video generation capability')
  }
  return activate(repository, 'version', version, actor)
}

const ensureDeployment = async ({ repository, actor, spec, version }) => {
  const existing = exactItem((await repository.listDeployments(listOptions({ environment: spec.environment, modelId: version.id, search: spec.deploymentKey }))).items, 'key', spec.deploymentKey)
  if (existing) {
    assertEqual('deployment', 'modelVersionId', existing.modelVersionId, version.id)
    assertEqual('deployment', 'adapterType', existing.adapterType, 'router_minimax_video')
    assertEqual('deployment', 'providerModelId', existing.providerModelId, spec.providerModelId)
    assertEqual('deployment', 'endpointUrl', existing.endpointUrl, spec.endpointUrl)
    assertEqual('deployment', 'secretPurpose', existing.secretPurpose, spec.secretPurpose)
    assertEqual('deployment', 'runtimeEnabled', existing.runtimeEnabled, true)
    return activate(repository, 'deployment', existing, actor)
  }
  const created = await repository.createDeployment(parseDeploymentCreate({
    modelVersionId: version.id,
    key: spec.deploymentKey,
    environment: spec.environment,
    region: spec.region,
    deploymentRef: `${spec.providerKey}/${spec.providerModelId}/${spec.environment}/${spec.region}`,
    adapterType: 'router_minimax_video',
    providerModelId: spec.providerModelId,
    endpointUrl: spec.endpointUrl,
    secretPurpose: spec.secretPurpose,
    runtimeConfig: { providerAccountRef: 'staging', dailyBudgetUsd: '1.20' },
    runtimeEnabled: true,
  }, actor))
  return activate(repository, 'deployment', created, actor)
}

const ensurePricing = async ({ repository, actor, spec, version, deployment }) => {
  const catalog = await repository.exportCatalog()
  const existing = catalog.pricingVersions.find((item) => item.modelVersionId === version.id && item.versionKey === spec.pricingVersionKey)
  if (existing) {
    assertEqual('pricing', 'deployment', existing.modelDeploymentId, deployment.id)
    assertEqual('pricing', 'unit', existing.unit, 'generated_seconds')
    assertEqual('pricing', 'unitPriceMicros', Number(existing.unitPriceMicros), spec.unitPriceMicros)
    return activate(repository, 'pricing', existing, actor)
  }
  const created = await repository.createPricing(parsePricingCreate({
    modelVersionId: version.id,
    modelDeploymentId: deployment.id,
    versionKey: spec.pricingVersionKey,
    currency: 'USD',
    unit: 'generated_seconds',
    unitPriceMicros: spec.unitPriceMicros,
    effectiveFrom: '2026-08-01T00:00:00.000Z',
    effectiveTo: null,
  }, actor))
  return activate(repository, 'pricing', created, actor)
}

const ensureRoute = async ({ repository, actor, spec, deployment }) => {
  const options = parseModelRouteListQuery({ search: spec.routeKey, environment: spec.environment, modality: 'video', limit: 100, sort: 'priority', order: 'asc' })
  let policy = exactItem((await repository.list(options)).items, 'key', spec.routeKey)
  if (!policy) {
    policy = await repository.create(parseModelRoutePolicyCreate({
      key: spec.routeKey,
      name: 'MiniMax Hailuo 2.3 Staging Video',
      modality: 'video',
      operation: 'generate',
      environment: spec.environment,
      region: spec.region,
      audienceRoles: [],
      rolloutPercentage: 100,
      rolloutSeed: 'v1',
      fallbackMode: 'fail_closed',
      priority: 0,
    }, actor))
    policy = await repository.replaceTargets(policy.id, parseModelRouteTargets(policy.id, {
      expectedVersion: policy.version,
      reasonCode: 'minimax_staging_primary',
      targets: [{ modelDeploymentId: deployment.id, role: 'primary', priority: 0, enabled: true }],
    }, actor))
  } else {
    assertEqual('route', 'operation', policy.operation, 'generate')
    assertEqual('route', 'region', policy.region, spec.region)
    assertEqual('route', 'priority', policy.priority, 0)
    const target = policy.targets?.find((item) => item.role === 'primary' && item.enabled)
    assertEqual('route', 'primary target', target?.modelDeploymentId, deployment.id)
  }
  if (policy.status === 'active') return policy
  if (!['draft', 'disabled'].includes(policy.status)) conflict('route', 'status')
  return repository.transition(policy.id, { expectedVersion: policy.version, status: 'active', reasonCode: 'minimax_staging_provisioned', actorRef: actor?.handle ?? actor?.id ?? 'unknown' })
}

const ensureSecretRef = async ({ repository, actor, spec, credential, secretExternalVersion, secretExpiresAt }) => {
  if (!credential) return null
  const checksumSha256 = createHash('sha256').update(credential).digest('hex')
  const current = await repository.findCurrentSecretRef({ providerId: spec.providerId, environment: spec.environment, purpose: spec.secretPurpose })
  if (current?.checksumSha256 === checksumSha256) return current
  return repository.createSecretRef(parseProviderSecretRefCreate({
    providerId: spec.providerId,
    environment: spec.environment,
    purpose: spec.secretPurpose,
    secretRef: spec.secretRef,
    externalVersion: secretExternalVersion,
    ownerRef: actor?.handle ?? actor?.id ?? 'unknown',
    checksumSha256,
    expiresAt: secretExpiresAt ?? null,
    rotatedFromId: current?.id ?? null,
    reasonCode: current ? 'minimax_staging_key_rotated' : 'minimax_staging_key_created',
  }, actor))
}

const ensureProviderControls = async ({ repository, actor, provider, credential, secretExternalVersion, secretExpiresAt, now }) => {
  if (!credential) return null
  if (!repository) throw new TypeError('creative Provider controls repository is required with a credential')
  const providerAccountRef = 'staging'
  const scopes = buildProviderControlScopes({ providerId: provider.key, providerAccountRef, workspace: 'video', modelFamily: 'video' })
  const requiredControls = scopes.filter((scope) => ['global', 'provider'].includes(scope.scopeType))
  const controls = await Promise.all(requiredControls.map(async (scope) => {
    const current = await repository.findControl(scope.scopeKey)
    const result = await repository.setControl({
      ...scope,
      enabled: true,
      expectedVersion: current?.version ?? 0,
      reasonCode: 'minimax_video_staging_uat',
    }, actor)
    return result.control
  }))
  const providerScope = scopes.find((scope) => scope.scopeType === 'provider')
  const circuitScope = providerCircuitScope(scopes)
  const capExpiresAt = secretExpiresAt ?? new Date(now.getTime() + 86_400_000).toISOString()
  let capEvidence = await repository.findCapEvidence(providerScope.scopeKey)
  if (
    !capEvidence || capEvidence.active !== true || capEvidence.currency !== 'USD' ||
    capEvidence.capMicros !== '1200000' || capEvidence.remainingMicros !== '1200000' ||
    capEvidence.expiresAt !== capExpiresAt
  ) {
    const versionHash = createHash('sha256').update(String(secretExternalVersion)).digest('hex').slice(0, 16)
    const result = await repository.putCapEvidence(createProviderCapEvidence({
      sourceKey: `minimax-video-staging-cap-${versionHash}-${now.getTime()}`,
      scopeKey: providerScope.scopeKey,
      providerId: provider.key,
      providerAccountRef,
      currency: 'USD',
      capAmount: '1.2',
      remainingAmount: '1.2',
      sourceType: 'manual_attestation',
      sourceRef: `router-console-attestation-${versionHash}`,
      verifiedAt: now.toISOString(),
      expiresAt: capExpiresAt,
    }), actor)
    capEvidence = result.evidence
  }
  const circuit = (await repository.ensureCircuit(circuitScope, actor)).circuit
  return { controls, capEvidence, circuit }
}

export const provisionMiniMaxVideoStaging = async ({ repositories, actor, credential = null, secretExternalVersion = 'temporary-v1', secretExpiresAt = null, now = new Date(), spec = minimaxVideoStagingSpec } = {}) => {
  if (!repositories?.modelControl || !repositories?.modelRouting || !repositories?.modelGovernance) throw new TypeError('model control, routing, and governance repositories are required')
  const provider = await ensureProvider({ repository: repositories.modelControl, actor, spec })
  const model = await ensureModel({ repository: repositories.modelControl, actor, spec, provider })
  const version = await ensureVersion({ repository: repositories.modelControl, actor, spec, model })
  const deployment = await ensureDeployment({ repository: repositories.modelControl, actor, spec, version })
  const pricing = await ensurePricing({ repository: repositories.modelControl, actor, spec, version, deployment })
  const route = await ensureRoute({ repository: repositories.modelRouting, actor, spec, deployment })
  const secretRef = await ensureSecretRef({
    repository: repositories.modelGovernance,
    actor,
    spec: { ...spec, providerId: provider.id },
    credential,
    secretExternalVersion,
    secretExpiresAt,
  })
  const providerControls = await ensureProviderControls({
    repository: repositories.creativeProviderControls,
    actor,
    provider,
    credential,
    secretExternalVersion,
    secretExpiresAt,
    now,
  })
  return { provider, model, version, deployment, pricing, route, secretRef, providerControls }
}

export const summarizeMiniMaxVideoStagingProvisioning = (result, { requireSecret = true } = {}) => ({
  decision: result?.secretRef || !requireSecret ? 'configured' : 'no_go',
  resources: Object.fromEntries(Object.entries(result ?? {}).map(([name, resource]) => {
    if (resource?.controls && resource?.capEvidence && resource?.circuit) return [name, {
      controlIds: resource.controls.map((item) => item.id),
      capEvidenceId: resource.capEvidence.id,
      circuitId: resource.circuit.id,
      circuitStatus: resource.circuit.status,
    }]
    return [name, resource ? {
      id: resource.id,
      key: resource.key ?? resource.versionKey ?? null,
      status: resource.status ?? 'configured',
    } : null]
  })),
})
