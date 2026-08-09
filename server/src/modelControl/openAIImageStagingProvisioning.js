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

const outputPricing = [
  ['1024x1024', 'low', 3_424],
  ['1024x1024', 'medium', 3_424],
  ['1024x1024', 'high', 3_424],
  ['1024x1536', 'low', 3_424],
  ['1024x1536', 'medium', 3_424],
  ['1024x1536', 'high', 3_424],
  ['1536x1024', 'low', 3_424],
  ['1536x1024', 'medium', 3_424],
  ['1536x1024', 'high', 3_424],
].map(([size, quality, unitPriceMicros]) => ({
  versionKey: `usd-image-output-${size}-${quality}-v2`,
  supersededVersionKey: `usd-image-output-${size}-${quality}-v1`,
  unit: `image_output_${size}_${quality}`,
  unitPriceMicros,
}))

export const openAIImageStagingSpec = Object.freeze({
  providerKey: 'hcai-router-minimax-image-01-live',
  providerName: 'HCAI Router MiniMax Image 01 Live',
  modelKey: 'image-01-live',
  modelName: 'MiniMax Image 01 Live',
  versionKey: 'image-01-live',
  deploymentKey: 'image-01-live-staging-us',
  routeKey: 'staging-image-minimax-image-01-live',
  routeName: 'MiniMax Image 01 Live Staging',
  legacyRouteKeys: Object.freeze(['staging-image-gpt-image-2']),
  providerModelId: 'image-01-live',
  endpointUrl: 'https://router.hctopup.com/v1',
  environment: 'staging',
  region: 'us',
  secretPurpose: 'image-01-live-inference',
  secretRef: 'secret://env/CREATIVE_OPENAI_IMAGE_API_TOKEN',
  pricing: Object.freeze([
    ...outputPricing,
  ].map(Object.freeze)),
})

const listOptions = (overrides = {}) => parseModelControlListQuery({ limit: 100, sort: 'key', order: 'asc', ...overrides })
const conflict = (resource, detail) => {
  throw new HttpError(409, 'OPENAI_IMAGE_STAGING_CONFIGURATION_CONFLICT', `${resource} exists with incompatible ${detail}`)
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
    payload: { expectedVersion: resource.version, status: 'active', reasonCode: 'openai_image_staging_provisioned' },
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
    name: spec.providerName,
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
  const created = await repository.createModel(parseModelCreate({
    providerId: provider.id,
    key: spec.modelKey,
    name: spec.modelName,
    family: 'image',
  }, actor))
  return activate(repository, 'model', created, actor)
}

const ensureVersion = async ({ repository, actor, spec, model }) => {
  let version = exactItem((await repository.listVersions(listOptions({ modelId: model.id, search: spec.versionKey }))).items, 'versionKey', spec.versionKey)
  if (!version) {
    version = await repository.createVersion(parseModelVersionCreate({
      modelId: model.id,
      versionKey: spec.versionKey,
      maxOutputUnits: 1,
      parameterSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', minLength: 1, maxLength: 2000 },
          aspectRatio: { enum: ['1:1', '3:2', '2:3'] },
          quality: { enum: ['low', 'medium', 'high'] },
        },
        required: ['prompt'],
      },
    }, actor))
    await repository.upsertCapability(parseCapabilityUpsert(version.id, {
      modality: 'image',
      operations: ['generate', 'edit'],
      inputMimeTypes: ['text/plain', 'image/jpeg', 'image/png', 'image/webp'],
      outputMimeTypes: ['image/png'],
      constraints: { aspectRatios: ['1:1', '3:2', '2:3'], qualities: ['low', 'medium', 'high'], outputCount: 1 },
    }))
    version = await repository.find('version', version.id)
  } else {
    version = await repository.find('version', version.id)
    assertEqual('model version', 'model', version.modelId, model.id)
    const capability = version.capabilities?.find((item) => item.modality === 'image')
    if (!capability?.operations?.includes('generate')) conflict('model version', 'image generation capability')
  }
  return activate(repository, 'version', version, actor)
}

const ensureDeployment = async ({ repository, actor, spec, version }) => {
  const existing = exactItem((await repository.listDeployments(listOptions({ environment: spec.environment, modelId: version.id, search: spec.deploymentKey }))).items, 'key', spec.deploymentKey)
  if (existing) {
    assertEqual('deployment', 'modelVersionId', existing.modelVersionId, version.id)
    assertEqual('deployment', 'adapterType', existing.adapterType, 'openai_image')
    assertEqual('deployment', 'providerModelId', existing.providerModelId, spec.providerModelId)
    assertEqual('deployment', 'endpointUrl', existing.endpointUrl, spec.endpointUrl)
    assertEqual('deployment', 'secretPurpose', existing.secretPurpose, spec.secretPurpose)
    assertEqual('deployment', 'runtimeEnabled', existing.runtimeEnabled, true)
    assertEqual('deployment', 'providerAccountRef', existing.runtimeConfig?.providerAccountRef, 'museflow-image-staging')
    assertEqual('deployment', 'displayName', existing.runtimeConfig?.displayName, spec.providerName)
    assertEqual('deployment', 'costProviderId', existing.runtimeConfig?.costProviderId, spec.providerKey)
    assertEqual('deployment', 'dailyBudgetUsd', existing.runtimeConfig?.dailyBudgetUsd, 10)
    assertEqual('deployment', 'budgetThresholdPercent', existing.runtimeConfig?.budgetThresholdPercent, 80)
    return activate(repository, 'deployment', existing, actor)
  }
  const created = await repository.createDeployment(parseDeploymentCreate({
    modelVersionId: version.id,
    key: spec.deploymentKey,
    environment: spec.environment,
    region: spec.region,
    deploymentRef: `${spec.providerKey}/${spec.providerModelId}/${spec.environment}/${spec.region}`,
    adapterType: 'openai_image',
    providerModelId: spec.providerModelId,
    endpointUrl: spec.endpointUrl,
    secretPurpose: spec.secretPurpose,
    runtimeConfig: {
      providerAccountRef: 'museflow-image-staging',
      displayName: spec.providerName,
      costProviderId: spec.providerKey,
      dailyBudgetUsd: 10,
      budgetThresholdPercent: 80,
    },
    runtimeEnabled: true,
  }, actor))
  return activate(repository, 'deployment', created, actor)
}

const ensurePricings = async ({ repository, actor, spec, version, deployment }) => {
  const catalog = await repository.exportCatalog()
  const resources = []
  for (const price of spec.pricing) {
    const existing = catalog.pricingVersions.find((item) => item.modelVersionId === version.id && item.versionKey === price.versionKey)
    if (existing) {
      assertEqual('pricing', 'deployment', existing.modelDeploymentId, deployment.id)
      assertEqual('pricing', 'unit', existing.unit, price.unit)
      assertEqual('pricing', 'unitPriceMicros', Number(existing.unitPriceMicros), price.unitPriceMicros)
      resources.push(await activate(repository, 'pricing', existing, actor))
      continue
    }
    const created = await repository.createPricing(parsePricingCreate({
      modelVersionId: version.id,
      modelDeploymentId: deployment.id,
      versionKey: price.versionKey,
      currency: 'USD',
      unit: price.unit,
      unitPriceMicros: price.unitPriceMicros,
      effectiveFrom: '2026-08-08T15:05:37.000Z',
      effectiveTo: null,
    }, actor))
    resources.push(await activate(repository, 'pricing', created, actor))
  }

  for (const price of spec.pricing) {
    if (!price.supersededVersionKey) continue
    const superseded = catalog.pricingVersions.find((item) => (
      item.modelVersionId === version.id &&
      item.versionKey === price.supersededVersionKey
    ))
    if (!superseded || superseded.status !== 'active') continue
    assertEqual('superseded pricing', 'deployment', superseded.modelDeploymentId, deployment.id)
    assertEqual('superseded pricing', 'unit', superseded.unit, price.unit)
    await transitionModelControlResource({
      type: 'pricing',
      resource: superseded,
      payload: {
        expectedVersion: superseded.version,
        status: 'disabled',
        reasonCode: 'minimax_image_price_superseded',
      },
      actor,
      repository,
    })
  }
  return resources
}

const ensureRoute = async ({ repository, actor, spec, deployment }) => {
  const options = parseModelRouteListQuery({ search: spec.routeKey, environment: spec.environment, modality: 'image', limit: 100, sort: 'priority', order: 'asc' })
  let policy = exactItem((await repository.list(options)).items, 'key', spec.routeKey)
  if (!policy) {
    policy = await repository.create(parseModelRoutePolicyCreate({
      key: spec.routeKey,
      name: spec.routeName,
      modality: 'image',
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
      reasonCode: 'openai_image_staging_primary',
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
  return repository.transition(policy.id, { expectedVersion: policy.version, status: 'active', reasonCode: 'openai_image_staging_provisioned', actorRef: actor?.handle ?? actor?.id ?? 'unknown' })
}

const disableLegacyRoutes = async ({ repository, actor, spec }) => {
  const disabled = []
  for (const routeKey of spec.legacyRouteKeys ?? []) {
    const options = parseModelRouteListQuery({ search: routeKey, environment: spec.environment, modality: 'image', limit: 100, sort: 'priority', order: 'asc' })
    const policy = exactItem((await repository.list(options)).items, 'key', routeKey)
    if (!policy) continue
    if (policy.status !== 'active') {
      disabled.push(policy)
      continue
    }
    disabled.push(await repository.transition(policy.id, {
      expectedVersion: policy.version,
      status: 'disabled',
      reasonCode: 'image_staging_route_replaced',
      actorRef: actor?.handle ?? actor?.id ?? 'unknown',
    }))
  }
  return disabled
}

const ensureSecretRef = async ({ repository, actor, spec, provider, credential, secretExternalVersion, secretExpiresAt }) => {
  if (!credential) return null
  const checksumSha256 = createHash('sha256').update(credential).digest('hex')
  const current = await repository.findCurrentSecretRef({ providerId: provider.id, environment: spec.environment, purpose: spec.secretPurpose })
  if (current?.checksumSha256 === checksumSha256) return current
  return repository.createSecretRef(parseProviderSecretRefCreate({
    providerId: provider.id,
    environment: spec.environment,
    purpose: spec.secretPurpose,
    secretRef: spec.secretRef,
    externalVersion: secretExternalVersion,
    ownerRef: actor?.handle ?? actor?.id ?? 'unknown',
    checksumSha256,
    expiresAt: secretExpiresAt ?? null,
    rotatedFromId: current?.id ?? null,
    reasonCode: current ? 'openai_image_staging_key_rotated' : 'openai_image_staging_key_created',
  }, actor))
}

const ensureProviderControls = async ({ repository, actor, provider, credential, secretExternalVersion, secretExpiresAt, now }) => {
  if (!credential) return null
  if (!repository) throw new TypeError('creative Provider controls repository is required with a credential')
  const providerAccountRef = 'museflow-image-staging'
  const scopes = buildProviderControlScopes({ providerId: provider.key, providerAccountRef, workspace: 'image', modelFamily: 'image' })
  const requiredControls = scopes.filter((scope) => ['global', 'provider'].includes(scope.scopeType))
  const controls = await Promise.all(requiredControls.map(async (scope) => {
    const current = await repository.findControl(scope.scopeKey)
    const result = await repository.setControl({
      ...scope,
      enabled: true,
      expectedVersion: current?.version ?? 0,
      reasonCode: 'openai_image_staging_uat',
    }, actor)
    return result.control
  }))
  const providerScope = scopes.find((scope) => scope.scopeType === 'provider')
  const circuitScope = providerCircuitScope(scopes)
  const capExpiresAt = secretExpiresAt ?? new Date(now.getTime() + 86_400_000).toISOString()
  let capEvidence = await repository.findCapEvidence(providerScope.scopeKey)
  if (
    !capEvidence || capEvidence.active !== true || capEvidence.currency !== 'USD' ||
    capEvidence.capMicros !== '10000000' || capEvidence.remainingMicros !== '10000000' ||
    capEvidence.expiresAt !== capExpiresAt
  ) {
    const versionHash = createHash('sha256').update(String(secretExternalVersion)).digest('hex').slice(0, 16)
    const result = await repository.putCapEvidence(createProviderCapEvidence({
      sourceKey: `image-staging-cap-${versionHash}-${now.getTime()}`,
      scopeKey: providerScope.scopeKey,
      providerId: provider.key,
      providerAccountRef,
      currency: 'USD',
      capAmount: '10',
      remainingAmount: '10',
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

export const provisionOpenAIImageStaging = async ({ repositories, actor, credential = null, secretExternalVersion = 'temporary-v1', secretExpiresAt = null, now = new Date(), spec = openAIImageStagingSpec } = {}) => {
  if (!repositories?.modelControl || !repositories?.modelRouting || !repositories?.modelGovernance) throw new TypeError('model control, routing, and governance repositories are required')
  const provider = await ensureProvider({ repository: repositories.modelControl, actor, spec })
  const model = await ensureModel({ repository: repositories.modelControl, actor, spec, provider })
  const version = await ensureVersion({ repository: repositories.modelControl, actor, spec, model })
  const deployment = await ensureDeployment({ repository: repositories.modelControl, actor, spec, version })
  const pricing = await ensurePricings({ repository: repositories.modelControl, actor, spec, version, deployment })
  const route = await ensureRoute({ repository: repositories.modelRouting, actor, spec, deployment })
  const legacyRoutes = await disableLegacyRoutes({ repository: repositories.modelRouting, actor, spec })
  const secretRef = await ensureSecretRef({ repository: repositories.modelGovernance, actor, spec, provider, credential, secretExternalVersion, secretExpiresAt })
  const providerControls = await ensureProviderControls({
    repository: repositories.creativeProviderControls,
    actor,
    provider,
    credential,
    secretExternalVersion,
    secretExpiresAt,
    now,
  })
  return { provider, model, version, deployment, pricing, route, legacyRoutes, secretRef, providerControls }
}
