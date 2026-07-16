import { HttpError } from '../common/errors/httpError.js'

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value))
const nowIso = () => new Date().toISOString()
const collectionFor = (collections, type) => ({
  provider: collections.providers,
  model: collections.models,
  version: collections.versions,
  deployment: collections.deployments,
  pricing: collections.prices,
})[type]
const compare = (field, order) => (left, right) => {
  const result = String(left[field] ?? '').localeCompare(String(right[field] ?? ''), undefined, { numeric: true }) || left.id.localeCompare(right.id)
  return order === 'asc' ? result : -result
}
const page = (items, options) => {
  const start = options.cursor ? Math.max(0, items.findIndex((item) => item.id === options.cursor) + 1) : 0
  const selected = items.slice(start, start + options.limit)
  return { items: selected.map(clone), limit: options.limit, nextCursor: start + options.limit < items.length ? selected.at(-1)?.id ?? null : null }
}

export const createSeedModelControlRepository = ({ recordAudit } = {}) => {
  const collections = {
    providers: new Map(), models: new Map(), versions: new Map(), capabilities: new Map(), deployments: new Map(), prices: new Map(),
  }
  const detail = (type, id) => {
    const item = collectionFor(collections, type)?.get(String(id)) ?? null
    if (!item) return null
    if (type === 'provider') return clone({ ...item, modelCount: [...collections.models.values()].filter((model) => model.providerId === item.id).length })
    if (type === 'model') return clone({ ...item, provider: collections.providers.get(item.providerId) ?? null, versionCount: [...collections.versions.values()].filter((version) => version.modelId === item.id).length })
    if (type === 'version') return clone({
      ...item,
      model: collections.models.get(item.modelId) ?? null,
      capabilities: [...collections.capabilities.values()].filter((capability) => capability.modelVersionId === item.id),
      deployments: [...collections.deployments.values()].filter((deployment) => deployment.modelVersionId === item.id),
      prices: [...collections.prices.values()].filter((price) => price.modelVersionId === item.id),
    })
    return clone(item)
  }
  const create = (type, input) => {
    const map = collectionFor(collections, type)
    const timestamp = nowIso()
    const row = { ...clone(input), status: 'draft', version: 1, createdAt: timestamp, updatedAt: timestamp }
    if (type === 'provider' && [...map.values()].some((item) => item.key === row.key)) throw new HttpError(409, 'RESOURCE_CONFLICT', 'provider key already exists')
    if (type === 'model' && [...map.values()].some((item) => item.providerId === row.providerId && item.key === row.key)) throw new HttpError(409, 'RESOURCE_CONFLICT', 'model key already exists for provider')
    if (type === 'version' && [...map.values()].some((item) => item.modelId === row.modelId && item.versionKey === row.versionKey)) throw new HttpError(409, 'RESOURCE_CONFLICT', 'model version already exists')
    if (type === 'deployment' && [...map.values()].some((item) => item.environment === row.environment && item.key === row.key)) throw new HttpError(409, 'RESOURCE_CONFLICT', 'deployment key already exists in environment')
    if (type === 'pricing' && [...map.values()].some((item) => item.modelVersionId === row.modelVersionId && item.versionKey === row.versionKey)) throw new HttpError(409, 'RESOURCE_CONFLICT', 'pricing version already exists')
    if (type === 'deployment') row.trafficEligible = false
    map.set(row.id, row)
    return detail(type, row.id)
  }

  return {
    listProviders: async (options) => page([...collections.providers.values()]
      .filter((item) => !options.status || item.status === options.status)
      .filter((item) => !options.search || `${item.key} ${item.name}`.toLowerCase().includes(options.search.toLowerCase()))
      .sort(compare(options.sort, options.order)), options),
    listModels: async (options) => page([...collections.models.values()]
      .filter((item) => !options.status || item.status === options.status)
      .filter((item) => !options.providerId || item.providerId === options.providerId)
      .filter((item) => !options.search || `${item.key} ${item.name} ${item.family ?? ''}`.toLowerCase().includes(options.search.toLowerCase()))
      .sort(compare(options.sort, options.order)), options),
    listVersions: async (options) => page([...collections.versions.values()]
      .filter((item) => !options.status || item.status === options.status)
      .filter((item) => !options.modelId || item.modelId === options.modelId)
      .filter((item) => !options.search || item.versionKey.toLowerCase().includes(options.search.toLowerCase()))
      .sort(compare(options.sort === 'name' || options.sort === 'key' ? 'versionKey' : options.sort, options.order)), options),
    find: async (type, id) => detail(type, id),
    createProvider: async (input) => create('provider', input),
    updateProvider: async (id, expectedVersion, data) => {
      const row = collections.providers.get(String(id))
      if (!row || row.version !== expectedVersion || row.status === 'archived') return null
      Object.assign(row, clone(data), { version: row.version + 1, updatedAt: nowIso() })
      return detail('provider', row.id)
    },
    createModel: async (input) => {
      if (!collections.providers.has(input.providerId)) throw new HttpError(422, 'PROVIDER_NOT_FOUND', 'provider does not exist')
      return create('model', input)
    },
    createVersion: async (input) => {
      if (!collections.models.has(input.modelId)) throw new HttpError(422, 'MODEL_NOT_FOUND', 'model does not exist')
      return create('version', input)
    },
    upsertCapability: async (input) => {
      const version = collections.versions.get(input.modelVersionId)
      if (!version) throw new HttpError(422, 'MODEL_VERSION_NOT_FOUND', 'model version does not exist')
      if (version.status !== 'draft') throw new HttpError(409, 'IMMUTABLE_VERSION', 'capabilities can only change while the model version is draft')
      const current = [...collections.capabilities.values()].find((item) => item.modelVersionId === input.modelVersionId && item.modality === input.modality)
      const timestamp = nowIso()
      const row = { ...clone(input), id: current?.id ?? input.id, createdAt: current?.createdAt ?? timestamp, updatedAt: timestamp }
      collections.capabilities.set(row.id, row)
      return clone(row)
    },
    createDeployment: async (input) => {
      if (!collections.versions.has(input.modelVersionId)) throw new HttpError(422, 'MODEL_VERSION_NOT_FOUND', 'model version does not exist')
      return create('deployment', input)
    },
    createPricing: async (input) => {
      if (!collections.versions.has(input.modelVersionId)) throw new HttpError(422, 'MODEL_VERSION_NOT_FOUND', 'model version does not exist')
      if (input.modelDeploymentId && !collections.deployments.has(input.modelDeploymentId)) throw new HttpError(422, 'MODEL_DEPLOYMENT_NOT_FOUND', 'model deployment does not exist')
      return create('pricing', input)
    },
    transition: async (type, id, transition) => {
      const map = collectionFor(collections, type)
      const row = map?.get(String(id))
      if (!row || row.version !== transition.expectedVersion) return null
      Object.assign(row, {
        status: transition.status,
        updatedByRef: transition.actorRef,
        version: row.version + 1,
        updatedAt: nowIso(),
        ...(transition.status === 'archived' ? { archivedByRef: transition.actorRef, archivedAt: nowIso() } : {}),
        ...(transition.status === 'deprecated' && type === 'version' ? { deprecationDate: nowIso() } : {}),
      })
      await recordAudit?.({ actor: null, action: `admin.model_control.${type}.transitioned`, resourceType: `model_${type}`, resourceId: row.id, metadata: { status: row.status, reasonCode: transition.reasonCode } })
      return detail(type, row.id)
    },
    exportCatalog: async () => clone({
      schemaVersion: 1,
      exportedAt: nowIso(),
      providers: [...collections.providers.values()],
      models: [...collections.models.values()],
      versions: [...collections.versions.values()],
      capabilities: [...collections.capabilities.values()],
      deployments: [...collections.deployments.values()],
      pricingVersions: [...collections.prices.values()],
      providerTrafficEnabled: false,
    }),
  }
}
