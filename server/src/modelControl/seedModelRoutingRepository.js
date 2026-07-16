import { randomUUID } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value))
const nowIso = () => new Date().toISOString()
const policySnapshot = (policy, targets) => ({
  schemaVersion: 1,
  policy: Object.fromEntries(['name', 'modality', 'operation', 'environment', 'region', 'audienceRoles', 'rolloutPercentage', 'rolloutSeed', 'fallbackMode', 'priority'].map((field) => [field, clone(policy[field])])),
  targets: targets.map((target) => Object.fromEntries(['modelDeploymentId', 'role', 'priority', 'enabled'].map((field) => [field, clone(target[field])]))),
})

export const createSeedModelRoutingRepository = ({ modelControl, recordAudit } = {}) => {
  const policies = new Map()
  const targets = new Map()
  const revisions = new Map()
  const policyTargets = (policyId) => [...targets.values()].filter((target) => target.policyId === policyId).sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))
  const addRevision = async (policy, reasonCode, actorRef) => {
    const existing = [...revisions.values()].filter((revision) => revision.policyId === policy.id)
    const revision = {
      id: `model-route-revision-${randomUUID()}`,
      policyId: policy.id,
      revisionNumber: existing.length + 1,
      snapshot: policySnapshot(policy, policyTargets(policy.id)),
      reasonCode,
      createdByRef: actorRef,
      createdAt: nowIso(),
    }
    revisions.set(revision.id, revision)
    return clone(revision)
  }
  const hydrate = async (policy) => {
    if (!policy) return null
    const hydratedTargets = await Promise.all(policyTargets(policy.id).map(async (target) => ({ ...clone(target), deployment: await modelControl.findRoutingDeployment(target.modelDeploymentId) })))
    return clone({ ...policy, targets: hydratedTargets, revisionCount: [...revisions.values()].filter((revision) => revision.policyId === policy.id).length })
  }
  const audit = (action, policy, metadata = {}) => recordAudit?.({ actor: null, action, resourceType: 'model_route_policy', resourceId: policy.id, metadata: { version: policy.version, status: policy.status, ...metadata } })

  return {
    list: async (options) => {
      let rows = [...policies.values()]
        .filter((policy) => !options.status || policy.status === options.status)
        .filter((policy) => !options.modality || policy.modality === options.modality)
        .filter((policy) => !options.environment || policy.environment === options.environment)
        .filter((policy) => !options.search || `${policy.key} ${policy.name} ${policy.operation}`.toLowerCase().includes(options.search.toLowerCase()))
        .sort((left, right) => {
          const result = String(left[options.sort] ?? '').localeCompare(String(right[options.sort] ?? ''), undefined, { numeric: true }) || left.id.localeCompare(right.id)
          return options.order === 'asc' ? result : -result
        })
      const start = options.cursor ? Math.max(0, rows.findIndex((row) => row.id === options.cursor) + 1) : 0
      rows = rows.slice(start, start + options.limit + 1)
      const selected = rows.slice(0, options.limit)
      return { items: await Promise.all(selected.map(hydrate)), limit: options.limit, nextCursor: rows.length > options.limit ? selected.at(-1)?.id ?? null : null }
    },
    find: async (id) => hydrate(policies.get(String(id)) ?? null),
    create: async (input) => {
      if ([...policies.values()].some((policy) => policy.key === input.key)) throw new HttpError(409, 'RESOURCE_CONFLICT', 'route policy key already exists')
      const timestamp = nowIso()
      const policy = { ...clone(input), status: 'draft', version: 1, archivedAt: null, archivedByRef: null, createdAt: timestamp, updatedAt: timestamp }
      policies.set(policy.id, policy)
      await addRevision(policy, 'policy_created', policy.createdByRef)
      await audit('admin.model_route.policy_created', policy)
      return hydrate(policy)
    },
    update: async (id, expectedVersion, data) => {
      const policy = policies.get(String(id))
      if (!policy || policy.version !== expectedVersion || ['active', 'archived'].includes(policy.status)) return null
      Object.assign(policy, clone(data), { version: policy.version + 1, updatedAt: nowIso() })
      await addRevision(policy, 'policy_updated', data.updatedByRef)
      await audit('admin.model_route.policy_updated', policy)
      return hydrate(policy)
    },
    replaceTargets: async (id, input) => {
      const policy = policies.get(String(id))
      if (!policy || policy.version !== input.expectedVersion || ['active', 'archived'].includes(policy.status)) return null
      for (const target of input.targets) {
        const deployment = await modelControl.findRoutingDeployment(target.modelDeploymentId)
        if (!deployment) throw new HttpError(422, 'MODEL_DEPLOYMENT_NOT_FOUND', 'model deployment does not exist')
        if (deployment.environment !== policy.environment) throw new HttpError(422, 'ROUTE_TARGET_ENVIRONMENT_MISMATCH', 'route targets must use the policy environment')
      }
      for (const target of policyTargets(policy.id)) targets.delete(target.id)
      const timestamp = nowIso()
      for (const target of input.targets) targets.set(target.id, { ...clone(target), createdAt: timestamp, updatedAt: timestamp })
      Object.assign(policy, { version: policy.version + 1, updatedByRef: input.actorRef, updatedAt: timestamp })
      await addRevision(policy, input.reasonCode, input.actorRef)
      await audit('admin.model_route.targets_replaced', policy, { targetCount: input.targets.length })
      return hydrate(policy)
    },
    transition: async (id, transition) => {
      const policy = policies.get(String(id))
      if (!policy || policy.version !== transition.expectedVersion) return null
      if (transition.status === 'active' && !policyTargets(policy.id).some((target) => target.role === 'primary' && target.enabled)) throw new HttpError(409, 'ROUTE_PRIMARY_REQUIRED', 'an enabled primary target is required before activation')
      Object.assign(policy, {
        status: transition.status, version: policy.version + 1, updatedByRef: transition.actorRef, updatedAt: nowIso(),
        ...(transition.status === 'archived' ? { archivedByRef: transition.actorRef, archivedAt: nowIso() } : {}),
      })
      await addRevision(policy, transition.reasonCode, transition.actorRef)
      await audit('admin.model_route.status_transitioned', policy)
      return hydrate(policy)
    },
    listRevisions: async (policyId) => clone([...revisions.values()].filter((revision) => revision.policyId === String(policyId)).sort((left, right) => right.revisionNumber - left.revisionNumber)),
    rollback: async (id, input) => {
      const policy = policies.get(String(id))
      if (!policy || policy.version !== input.expectedVersion || ['active', 'archived'].includes(policy.status)) return null
      const revision = [...revisions.values()].find((item) => item.policyId === policy.id && item.revisionNumber === input.revisionNumber)
      if (!revision) throw new HttpError(404, 'REVISION_NOT_FOUND', 'model route policy revision was not found')
      Object.assign(policy, clone(revision.snapshot.policy), { version: policy.version + 1, updatedByRef: input.actorRef, updatedAt: nowIso() })
      for (const target of policyTargets(policy.id)) targets.delete(target.id)
      for (const target of revision.snapshot.targets) {
        const row = { ...clone(target), id: `model-route-target-${randomUUID()}`, policyId: policy.id, createdAt: nowIso(), updatedAt: nowIso() }
        targets.set(row.id, row)
      }
      await addRevision(policy, input.reasonCode, input.actorRef)
      await audit('admin.model_route.policy_rolled_back', policy, { sourceRevisionNumber: input.revisionNumber })
      return hydrate(policy)
    },
    match: async (context) => Promise.all([...policies.values()]
      .filter((policy) => policy.status === 'active' && policy.modality === context.modality && policy.operation === context.operation && policy.environment === context.environment && (!policy.region || policy.region === context.region))
      .sort((left, right) => left.priority - right.priority || left.key.localeCompare(right.key))
      .map(hydrate)),
    exportAll: async () => {
      const exportedPolicies = await Promise.all([...policies.values()].sort((left, right) => left.key.localeCompare(right.key)).map(hydrate))
      return { schemaVersion: 1, exportedAt: nowIso(), providerTrafficEnabled: exportedPolicies.some((policy) => policy.targets?.some((target) => target.deployment?.environment === 'production' && target.deployment?.trafficEligible)), policies: exportedPolicies, revisions: clone([...revisions.values()]) }
    },
  }
}
