import { HttpError } from '../common/errors/httpError.js'

const iso = (value) => value?.toISOString?.() ?? value ?? null
const providerDto = (row) => row ? ({ ...row, archivedAt: iso(row.archivedAt), createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) }) : null
const modelDto = (row) => row ? ({ ...row, provider: providerDto(row.provider), archivedAt: iso(row.archivedAt), createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) }) : null
const capabilityDto = (row) => row ? ({ ...row, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) }) : null
const deploymentDto = (row) => row ? ({ ...row, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) }) : null
const pricingDto = (row) => row ? ({ ...row, effectiveFrom: iso(row.effectiveFrom), effectiveTo: iso(row.effectiveTo), createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) }) : null
const versionDto = (row) => row ? ({
  ...row,
  model: modelDto(row.model),
  capabilities: row.capabilities?.map(capabilityDto),
  deployments: row.deployments?.map(deploymentDto),
  prices: row.prices?.map(pricingDto),
  releaseDate: iso(row.releaseDate),
  deprecationDate: iso(row.deprecationDate),
  archivedAt: iso(row.archivedAt),
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
}) : null
const conflict = (error, message) => {
  if (error?.code === 'P2002') throw new HttpError(409, 'RESOURCE_CONFLICT', message)
  if (error?.code === 'P2003') throw new HttpError(422, 'REFERENCE_NOT_FOUND', 'referenced model control resource does not exist')
  throw error
}
const dateFields = (input, fields) => Object.fromEntries(Object.entries(input).map(([key, value]) => [key, fields.includes(key) && value ? new Date(value) : value]))

export const createPrismaModelControlRepository = (client, { recordAudit } = {}) => {
  const find = async (type, id, db = client) => {
    if (type === 'provider') {
      const row = await db.provider.findUnique({ where: { id: String(id) }, include: { _count: { select: { models: true } } } })
      return row ? providerDto({ ...row, modelCount: row._count.models, _count: undefined }) : null
    }
    if (type === 'model') {
      const row = await db.model.findUnique({ where: { id: String(id) }, include: { provider: true, _count: { select: { versions: true } } } })
      return row ? modelDto({ ...row, versionCount: row._count.versions, _count: undefined }) : null
    }
    if (type === 'version') return versionDto(await db.modelVersion.findUnique({
      where: { id: String(id) },
      include: { model: { include: { provider: true } }, capabilities: { orderBy: { modality: 'asc' } }, deployments: { orderBy: [{ environment: 'asc' }, { key: 'asc' }] }, prices: { orderBy: [{ effectiveFrom: 'desc' }, { versionKey: 'desc' }] } },
    }))
    if (type === 'deployment') return deploymentDto(await db.modelDeployment.findUnique({ where: { id: String(id) } }))
    if (type === 'pricing') return pricingDto(await db.pricingVersion.findUnique({ where: { id: String(id) } }))
    return null
  }
  const create = async (type, input) => {
    try {
      if (type === 'provider') return providerDto(await client.provider.create({ data: input }))
      if (type === 'model') return modelDto(await client.model.create({ data: input, include: { provider: true } }))
      if (type === 'version') return versionDto(await client.modelVersion.create({ data: dateFields(input, ['releaseDate']), include: { model: { include: { provider: true } }, capabilities: true, deployments: true, prices: true } }))
      if (type === 'deployment') return deploymentDto(await client.modelDeployment.create({ data: input }))
      if (type === 'pricing') return pricingDto(await client.pricingVersion.create({ data: dateFields(input, ['effectiveFrom', 'effectiveTo']) }))
      throw new Error(`Unsupported model control resource type: ${type}`)
    } catch (error) {
      return conflict(error, `${type} key already exists`)
    }
  }

  return {
    listProviders: async (options) => {
      const cursor = options.cursor ? await client.provider.findUnique({ where: { id: options.cursor }, select: { id: true } }) : null
      const rows = await client.provider.findMany({
        where: {
          ...(options.status ? { status: options.status } : {}),
          ...(options.search ? { OR: [{ key: { contains: options.search, mode: 'insensitive' } }, { name: { contains: options.search, mode: 'insensitive' } }] } : {}),
        },
        include: { _count: { select: { models: true } } },
        orderBy: [{ [options.sort]: options.order }, { id: options.order }], take: options.limit + 1,
        ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
      })
      const selected = rows.slice(0, options.limit)
      return { items: selected.map((row) => providerDto({ ...row, modelCount: row._count.models, _count: undefined })), limit: options.limit, nextCursor: rows.length > options.limit ? selected.at(-1)?.id ?? null : null }
    },
    listModels: async (options) => {
      const cursor = options.cursor ? await client.model.findUnique({ where: { id: options.cursor }, select: { id: true } }) : null
      const rows = await client.model.findMany({
        where: {
          ...(options.status ? { status: options.status } : {}), ...(options.providerId ? { providerId: options.providerId } : {}),
          ...(options.search ? { OR: [{ key: { contains: options.search, mode: 'insensitive' } }, { name: { contains: options.search, mode: 'insensitive' } }, { family: { contains: options.search, mode: 'insensitive' } }] } : {}),
        },
        include: { provider: true, _count: { select: { versions: true } } },
        orderBy: [{ [options.sort]: options.order }, { id: options.order }], take: options.limit + 1,
        ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
      })
      const selected = rows.slice(0, options.limit)
      return { items: selected.map((row) => modelDto({ ...row, versionCount: row._count.versions, _count: undefined })), limit: options.limit, nextCursor: rows.length > options.limit ? selected.at(-1)?.id ?? null : null }
    },
    listVersions: async (options) => {
      const cursor = options.cursor ? await client.modelVersion.findUnique({ where: { id: options.cursor }, select: { id: true } }) : null
      const sort = options.sort === 'name' || options.sort === 'key' ? 'versionKey' : options.sort
      const rows = await client.modelVersion.findMany({
        where: { ...(options.status ? { status: options.status } : {}), ...(options.modelId ? { modelId: options.modelId } : {}), ...(options.search ? { versionKey: { contains: options.search, mode: 'insensitive' } } : {}) },
        include: { model: { include: { provider: true } }, capabilities: true, deployments: true, prices: true },
        orderBy: [{ [sort]: options.order }, { id: options.order }], take: options.limit + 1,
        ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
      })
      const selected = rows.slice(0, options.limit)
      return { items: selected.map(versionDto), limit: options.limit, nextCursor: rows.length > options.limit ? selected.at(-1)?.id ?? null : null }
    },
    listDeployments: async (options) => {
      const cursor = options.cursor ? await client.modelDeployment.findUnique({ where: { id: options.cursor }, select: { id: true } }) : null
      const sort = options.sort === 'name' ? 'key' : options.sort
      const rows = await client.modelDeployment.findMany({
        where: { ...(options.status ? { status: options.status } : {}), ...(options.modelId ? { modelVersionId: options.modelId } : {}), ...(options.environment ? { environment: options.environment } : {}), ...(options.search ? { OR: [{ key: { contains: options.search, mode: 'insensitive' } }, { region: { contains: options.search, mode: 'insensitive' } }] } : {}) },
        orderBy: [{ [sort]: options.order }, { id: options.order }], take: options.limit + 1,
        ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
      })
      const selected = rows.slice(0, options.limit)
      return { items: selected.map(deploymentDto), limit: options.limit, nextCursor: rows.length > options.limit ? selected.at(-1)?.id ?? null : null }
    },
    find,
    findRoutingDeployment: async (id) => deploymentDto(await client.modelDeployment.findUnique({
      where: { id: String(id) },
      include: { modelVersion: { include: { model: { include: { provider: true } }, capabilities: true } } },
    })),
    setPromotionTrafficEligibility: async (id, eligible, actor) => {
      const updated = await client.modelDeployment.updateMany({
        where: { id: String(id), environment: 'production', ...(eligible ? { status: 'active' } : {}) },
        data: { trafficEligible: Boolean(eligible), updatedByRef: actor, version: { increment: 1 } },
      })
      if (!updated.count) throw new HttpError(409, 'PROMOTION_DEPLOYMENT_INELIGIBLE', 'production deployment is not eligible for promotion')
      return find('deployment', id)
    },
    createProvider: async (input) => create('provider', input),
    updateProvider: async (id, expectedVersion, data) => {
      const updated = await client.provider.updateMany({ where: { id: String(id), version: expectedVersion, status: { not: 'archived' } }, data: { ...data, version: { increment: 1 } } })
      return updated.count ? find('provider', id) : null
    },
    createModel: async (input) => create('model', input),
    createVersion: async (input) => create('version', input),
    upsertCapability: async (input) => client.$transaction(async (transaction) => {
      const version = await transaction.modelVersion.findUnique({ where: { id: input.modelVersionId }, select: { status: true } })
      if (!version) throw new HttpError(422, 'MODEL_VERSION_NOT_FOUND', 'model version does not exist')
      if (version.status !== 'draft') throw new HttpError(409, 'IMMUTABLE_VERSION', 'capabilities can only change while the model version is draft')
      return capabilityDto(await transaction.modelCapability.upsert({
        where: { modelVersionId_modality: { modelVersionId: input.modelVersionId, modality: input.modality } },
        create: input,
        update: { operations: input.operations, inputMimeTypes: input.inputMimeTypes, outputMimeTypes: input.outputMimeTypes, constraints: input.constraints, constraintsSchemaVersion: 1 },
      }))
    }),
    createDeployment: async (input) => create('deployment', input),
    createPricing: async (input) => create('pricing', input),
    transition: async (type, id, transition) => {
      const delegate = { provider: client.provider, model: client.model, version: client.modelVersion, deployment: client.modelDeployment, pricing: client.pricingVersion }[type]
      if (!delegate) return null
      const data = {
        status: transition.status, updatedByRef: transition.actorRef, version: { increment: 1 },
        ...(transition.status === 'archived' && ['provider', 'model', 'version'].includes(type) ? { archivedByRef: transition.actorRef, archivedAt: new Date() } : {}),
        ...(transition.status === 'deprecated' && type === 'version' ? { deprecationDate: new Date() } : {}),
      }
      const updated = await delegate.updateMany({ where: { id: String(id), version: transition.expectedVersion }, data })
      if (!updated.count) return null
      const resource = await find(type, id)
      await recordAudit?.({ actor: null, action: `admin.model_control.${type}.transitioned`, resourceType: `model_${type}`, resourceId: String(id), metadata: { status: transition.status, reasonCode: transition.reasonCode } })
      return resource
    },
    exportCatalog: async () => {
      const [providers, models, versions, capabilities, deployments, pricingVersions] = await Promise.all([
        client.provider.findMany({ orderBy: { key: 'asc' }, take: 1000 }), client.model.findMany({ orderBy: [{ providerId: 'asc' }, { key: 'asc' }], take: 5000 }),
        client.modelVersion.findMany({ orderBy: [{ modelId: 'asc' }, { versionKey: 'asc' }], take: 10000 }), client.modelCapability.findMany({ orderBy: [{ modelVersionId: 'asc' }, { modality: 'asc' }], take: 10000 }),
        client.modelDeployment.findMany({ orderBy: [{ environment: 'asc' }, { key: 'asc' }], take: 10000 }), client.pricingVersion.findMany({ orderBy: [{ modelVersionId: 'asc' }, { effectiveFrom: 'desc' }], take: 10000 }),
      ])
      return {
        schemaVersion: 1, exportedAt: new Date().toISOString(), providerTrafficEnabled: deployments.some((deployment) => deployment.environment === 'production' && deployment.trafficEligible),
        providers: providers.map(providerDto), models: models.map(modelDto), versions: versions.map(versionDto), capabilities: capabilities.map(capabilityDto), deployments: deployments.map(deploymentDto), pricingVersions: pricingVersions.map(pricingDto),
      }
    },
  }
}
