import { HttpError, notFound } from '../../common/errors/httpError.js'
import { requirePermission } from '../../common/http/auth.js'
import { readJsonBody } from '../../common/http/request.js'
import { created, ok } from '../../common/http/responses.js'
import {
  parseCapabilityUpsert,
  parseDeploymentCreate,
  parseModelControlListQuery,
  parseModelCreate,
  parseModelVersionCreate,
  parsePricingCreate,
  parseProviderCreate,
  parseProviderUpdate,
  transitionModelControlResource,
} from '../../modelControl/modelControlRuntime.js'
import { repositories } from '../../repositories/index.js'

const permissions = Object.freeze({
  read: 'admin:model-control:read',
  manage: 'admin:model-control:manage',
  transition: 'admin:model-control:transition',
})

export const registerModelControlRoutes = (router, options = {}) => {
  const routeRepositories = options.repositories ?? repositories
  const repository = routeRepositories.modelControl
  const find = async (type, id, path) => {
    const resource = await repository.find(type, id)
    if (!resource) throw notFound(path)
    return resource
  }
  const audit = (actor, action, type, resource, metadata = {}) => routeRepositories.audit.recordAttempt({
    actor, action, resourceType: `model_${type}`, resourceId: resource?.id ?? null,
    metadata: { version: resource?.version ?? null, status: resource?.status ?? null, providerTrafficEnabled: false, ...metadata },
  })
  const transition = (type) => async (request, response, context) => {
    const actor = requirePermission(context, permissions.transition)
    const path = `/api/admin/model-control/${type}s/${context.params.id}/status`
    const resource = await find(type, context.params.id, path)
    const updated = await transitionModelControlResource({ type, resource, payload: (await readJsonBody(request)) ?? {}, actor, repository })
    await audit(actor, 'admin.model_control.status_transitioned', type, updated, { previousStatus: resource.status })
    ok(response, updated)
  }

  router.add('GET', '/api/admin/model-control/summary', async (_request, response, context) => {
    const actor = requirePermission(context, permissions.read)
    const catalog = await repository.exportCatalog()
    const counts = Object.fromEntries(['providers', 'models', 'versions', 'capabilities', 'deployments', 'pricingVersions'].map((key) => [key, catalog[key].length]))
    const statusCounts = catalog.providers.concat(catalog.models, catalog.versions, catalog.deployments, catalog.pricingVersions).reduce((summary, item) => ({ ...summary, [item.status]: (summary[item.status] ?? 0) + 1 }), {})
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_control.summary_read', resourceType: 'model_control_catalog', resourceId: null, metadata: { counts, providerTrafficEnabled: false } })
    ok(response, { counts, statusCounts, providerTrafficEnabled: false, realProviderApprovalRequired: true })
  })

  router.add('GET', '/api/admin/model-control/export', async (_request, response, context) => {
    const actor = requirePermission(context, permissions.read)
    const catalog = await repository.exportCatalog()
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_control.exported', resourceType: 'model_control_catalog', resourceId: null, metadata: { schemaVersion: catalog.schemaVersion, providerCount: catalog.providers.length, providerTrafficEnabled: false } })
    ok(response, catalog)
  })

  router.add('GET', '/api/admin/model-control/providers', async (_request, response, context) => {
    const actor = requirePermission(context, permissions.read)
    const page = await repository.listProviders(parseModelControlListQuery(context.query))
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_control.providers_queried', resourceType: 'model_provider', resourceId: null, metadata: { resultCount: page.items.length, limit: page.limit } })
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })
  router.add('POST', '/api/admin/model-control/providers', async (request, response, context) => {
    const actor = requirePermission(context, permissions.manage)
    const provider = await repository.createProvider(parseProviderCreate((await readJsonBody(request)) ?? {}, actor))
    await audit(actor, 'admin.model_control.provider_created', 'provider', provider)
    created(response, provider)
  })
  router.add('GET', '/api/admin/model-control/providers/:id', async (_request, response, context) => {
    const actor = requirePermission(context, permissions.read)
    const provider = await find('provider', context.params.id, `/api/admin/model-control/providers/${context.params.id}`)
    await audit(actor, 'admin.model_control.provider_read', 'provider', provider)
    ok(response, provider)
  })
  router.add('PATCH', '/api/admin/model-control/providers/:id', async (request, response, context) => {
    const actor = requirePermission(context, permissions.manage)
    const current = await find('provider', context.params.id, `/api/admin/model-control/providers/${context.params.id}`)
    if (current.status === 'archived') throw new HttpError(409, 'IMMUTABLE_ARCHIVE', 'archived providers cannot be edited')
    const update = parseProviderUpdate((await readJsonBody(request)) ?? {}, actor)
    const provider = await repository.updateProvider(current.id, update.expectedVersion, update.data)
    if (!provider) throw new HttpError(409, 'STATE_CONFLICT', 'provider changed before update')
    await audit(actor, 'admin.model_control.provider_updated', 'provider', provider)
    ok(response, provider)
  })
  router.add('POST', '/api/admin/model-control/providers/:id/status', transition('provider'))

  router.add('GET', '/api/admin/model-control/models', async (_request, response, context) => {
    const actor = requirePermission(context, permissions.read)
    const page = await repository.listModels(parseModelControlListQuery(context.query))
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_control.models_queried', resourceType: 'model', resourceId: null, metadata: { resultCount: page.items.length, limit: page.limit } })
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })
  router.add('POST', '/api/admin/model-control/models', async (request, response, context) => {
    const actor = requirePermission(context, permissions.manage)
    const model = await repository.createModel(parseModelCreate((await readJsonBody(request)) ?? {}, actor))
    await audit(actor, 'admin.model_control.model_created', 'model', model)
    created(response, model)
  })
  router.add('GET', '/api/admin/model-control/models/:id', async (_request, response, context) => {
    const actor = requirePermission(context, permissions.read)
    const model = await find('model', context.params.id, `/api/admin/model-control/models/${context.params.id}`)
    await audit(actor, 'admin.model_control.model_read', 'model', model)
    ok(response, model)
  })
  router.add('POST', '/api/admin/model-control/models/:id/status', transition('model'))

  router.add('GET', '/api/admin/model-control/versions', async (_request, response, context) => {
    const actor = requirePermission(context, permissions.read)
    const page = await repository.listVersions(parseModelControlListQuery(context.query))
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_control.versions_queried', resourceType: 'model_version', resourceId: null, metadata: { resultCount: page.items.length, limit: page.limit } })
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })
  router.add('POST', '/api/admin/model-control/versions', async (request, response, context) => {
    const actor = requirePermission(context, permissions.manage)
    const version = await repository.createVersion(parseModelVersionCreate((await readJsonBody(request)) ?? {}, actor))
    await audit(actor, 'admin.model_control.version_created', 'version', version)
    created(response, version)
  })
  router.add('GET', '/api/admin/model-control/versions/:id', async (_request, response, context) => {
    const actor = requirePermission(context, permissions.read)
    const version = await find('version', context.params.id, `/api/admin/model-control/versions/${context.params.id}`)
    await audit(actor, 'admin.model_control.version_read', 'version', version)
    ok(response, version)
  })
  router.add('POST', '/api/admin/model-control/versions/:id/status', transition('version'))
  router.add('PUT', '/api/admin/model-control/versions/:id/capabilities', async (request, response, context) => {
    const actor = requirePermission(context, permissions.manage)
    await find('version', context.params.id, `/api/admin/model-control/versions/${context.params.id}/capabilities`)
    const capability = await repository.upsertCapability(parseCapabilityUpsert(context.params.id, (await readJsonBody(request)) ?? {}))
    await audit(actor, 'admin.model_control.capability_upserted', 'capability', capability, { modality: capability.modality })
    ok(response, capability)
  })

  router.add('POST', '/api/admin/model-control/deployments', async (request, response, context) => {
    const actor = requirePermission(context, permissions.manage)
    const deployment = await repository.createDeployment(parseDeploymentCreate((await readJsonBody(request)) ?? {}, actor))
    await audit(actor, 'admin.model_control.deployment_created', 'deployment', deployment, { environment: deployment.environment })
    created(response, deployment)
  })
  router.add('GET', '/api/admin/model-control/deployments/:id', async (_request, response, context) => {
    requirePermission(context, permissions.read)
    ok(response, await find('deployment', context.params.id, `/api/admin/model-control/deployments/${context.params.id}`))
  })
  router.add('POST', '/api/admin/model-control/deployments/:id/status', transition('deployment'))

  router.add('POST', '/api/admin/model-control/pricing', async (request, response, context) => {
    const actor = requirePermission(context, permissions.manage)
    const pricing = await repository.createPricing(parsePricingCreate((await readJsonBody(request)) ?? {}, actor))
    await audit(actor, 'admin.model_control.pricing_created', 'pricing', pricing, { currency: pricing.currency, unit: pricing.unit })
    created(response, pricing)
  })
  router.add('GET', '/api/admin/model-control/pricing/:id', async (_request, response, context) => {
    requirePermission(context, permissions.read)
    ok(response, await find('pricing', context.params.id, `/api/admin/model-control/pricing/${context.params.id}`))
  })
  router.add('POST', '/api/admin/model-control/pricing/:id/status', transition('pricing'))
}
