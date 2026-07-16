import { randomUUID } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'

const iso = (value) => value?.toISOString?.() ?? value ?? null
const snapshotFields = ['name', 'modality', 'operation', 'environment', 'region', 'audienceRoles', 'rolloutPercentage', 'rolloutSeed', 'fallbackMode', 'priority']
const deploymentInclude = { modelVersion: { include: { model: { include: { provider: true } }, capabilities: true } } }
const policyInclude = { targets: { include: { deployment: { include: deploymentInclude } }, orderBy: [{ role: 'asc' }, { priority: 'asc' }, { id: 'asc' }] }, _count: { select: { revisions: true } } }
const dto = (row) => row ? ({
  ...row,
  revisionCount: row._count?.revisions ?? row.revisionCount ?? 0,
  _count: undefined,
  archivedAt: iso(row.archivedAt), createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt),
  targets: row.targets?.map((target) => ({ ...target, createdAt: iso(target.createdAt), updatedAt: iso(target.updatedAt) })),
}) : null
const snapshot = (policy) => ({
  schemaVersion: 1,
  policy: Object.fromEntries(snapshotFields.map((field) => [field, policy[field]])),
  targets: (policy.targets ?? []).map((target) => Object.fromEntries(['modelDeploymentId', 'role', 'priority', 'enabled'].map((field) => [field, target[field]]))),
})
const revisionData = async (db, policy, reasonCode, actorRef) => ({
  id: `model-route-revision-${randomUUID()}`,
  policyId: policy.id,
  revisionNumber: (await db.modelRoutePolicyRevision.count({ where: { policyId: policy.id } })) + 1,
  snapshot: snapshot(policy), reasonCode, createdByRef: actorRef,
})
const conflict = (error) => {
  if (error?.code === 'P2002') throw new HttpError(409, 'RESOURCE_CONFLICT', 'route policy key or target priority already exists')
  if (error?.code === 'P2003') throw new HttpError(422, 'REFERENCE_NOT_FOUND', 'referenced route resource does not exist')
  throw error
}

export const createPrismaModelRoutingRepository = (client, { recordAudit } = {}) => {
  const find = async (id, db = client) => dto(await db.modelRoutePolicy.findUnique({ where: { id: String(id) }, include: policyInclude }))
  const audit = (action, policy, metadata = {}, db = client) => recordAudit?.({ actor: null, action, resourceType: 'model_route_policy', resourceId: policy.id, metadata: { version: policy.version, status: policy.status, ...metadata } }, db)
  return {
    list: async (options) => {
      const cursor = options.cursor ? await client.modelRoutePolicy.findUnique({ where: { id: options.cursor }, select: { id: true } }) : null
      const rows = await client.modelRoutePolicy.findMany({
        where: {
          ...(options.status ? { status: options.status } : {}), ...(options.modality ? { modality: options.modality } : {}), ...(options.environment ? { environment: options.environment } : {}),
          ...(options.search ? { OR: [{ key: { contains: options.search, mode: 'insensitive' } }, { name: { contains: options.search, mode: 'insensitive' } }, { operation: { contains: options.search, mode: 'insensitive' } }] } : {}),
        }, include: policyInclude, orderBy: [{ [options.sort]: options.order }, { id: options.order }], take: options.limit + 1,
        ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
      })
      const selected = rows.slice(0, options.limit)
      return { items: selected.map(dto), limit: options.limit, nextCursor: rows.length > options.limit ? selected.at(-1)?.id ?? null : null }
    },
    find,
    create: async (input) => {
      try {
        const policy = await client.$transaction(async (db) => {
          const created = await db.modelRoutePolicy.create({ data: input, include: policyInclude })
          await db.modelRoutePolicyRevision.create({ data: await revisionData(db, created, 'policy_created', input.createdByRef) })
          const current = await find(created.id, db)
          await audit('admin.model_route.policy_created', current, {}, db)
          return current
        })
        return policy
      } catch (error) { return conflict(error) }
    },
    update: async (id, expectedVersion, data) => {
      try {
        const policy = await client.$transaction(async (db) => {
          const updated = await db.modelRoutePolicy.updateMany({ where: { id: String(id), version: expectedVersion, status: { in: ['draft', 'disabled', 'deprecated'] } }, data: { ...data, version: { increment: 1 } } })
          if (!updated.count) return null
          const current = await find(id, db)
          await db.modelRoutePolicyRevision.create({ data: await revisionData(db, current, 'policy_updated', data.updatedByRef) })
          const result = await find(id, db)
          await audit('admin.model_route.policy_updated', result, {}, db)
          return result
        })
        return policy
      } catch (error) { return conflict(error) }
    },
    replaceTargets: async (id, input) => {
      try {
        const policy = await client.$transaction(async (db) => {
          const current = await db.modelRoutePolicy.findFirst({ where: { id: String(id), version: input.expectedVersion, status: { in: ['draft', 'disabled', 'deprecated'] } } })
          if (!current) return null
          const deployments = await db.modelDeployment.findMany({ where: { id: { in: input.targets.map((target) => target.modelDeploymentId) } }, select: { id: true, environment: true } })
          if (deployments.length !== input.targets.length) throw new HttpError(422, 'MODEL_DEPLOYMENT_NOT_FOUND', 'model deployment does not exist')
          if (deployments.some((deployment) => deployment.environment !== current.environment)) throw new HttpError(422, 'ROUTE_TARGET_ENVIRONMENT_MISMATCH', 'route targets must use the policy environment')
          await db.modelRouteTarget.deleteMany({ where: { policyId: current.id } })
          await db.modelRouteTarget.createMany({ data: input.targets })
          await db.modelRoutePolicy.update({ where: { id: current.id }, data: { version: { increment: 1 }, updatedByRef: input.actorRef } })
          const changed = await find(id, db)
          await db.modelRoutePolicyRevision.create({ data: await revisionData(db, changed, input.reasonCode, input.actorRef) })
          const result = await find(id, db)
          await audit('admin.model_route.targets_replaced', result, { targetCount: input.targets.length }, db)
          return result
        })
        return policy
      } catch (error) { return conflict(error) }
    },
    transition: async (id, transition) => {
      try {
        const policy = await client.$transaction(async (db) => {
          if (transition.status === 'active') {
            const primaryCount = await db.modelRouteTarget.count({ where: { policyId: String(id), role: 'primary', enabled: true } })
            if (!primaryCount) throw new HttpError(409, 'ROUTE_PRIMARY_REQUIRED', 'an enabled primary target is required before activation')
          }
          const updated = await db.modelRoutePolicy.updateMany({ where: { id: String(id), version: transition.expectedVersion }, data: { status: transition.status, version: { increment: 1 }, updatedByRef: transition.actorRef, ...(transition.status === 'archived' ? { archivedByRef: transition.actorRef, archivedAt: new Date() } : {}) } })
          if (!updated.count) return null
          const changed = await find(id, db)
          await db.modelRoutePolicyRevision.create({ data: await revisionData(db, changed, transition.reasonCode, transition.actorRef) })
          const result = await find(id, db)
          await audit('admin.model_route.status_transitioned', result, {}, db)
          return result
        })
        return policy
      } catch (error) { return conflict(error) }
    },
    listRevisions: async (policyId) => (await client.modelRoutePolicyRevision.findMany({ where: { policyId: String(policyId) }, orderBy: { revisionNumber: 'desc' }, take: 100 })).map((row) => ({ ...row, createdAt: iso(row.createdAt) })),
    rollback: async (id, input) => {
      try {
        const policy = await client.$transaction(async (db) => {
          const current = await db.modelRoutePolicy.findFirst({ where: { id: String(id), version: input.expectedVersion, status: { in: ['draft', 'disabled', 'deprecated'] } } })
          if (!current) return null
          const revision = await db.modelRoutePolicyRevision.findUnique({ where: { policyId_revisionNumber: { policyId: current.id, revisionNumber: input.revisionNumber } } })
          if (!revision) throw new HttpError(404, 'REVISION_NOT_FOUND', 'model route policy revision was not found')
          const source = revision.snapshot
          await db.modelRouteTarget.deleteMany({ where: { policyId: current.id } })
          await db.modelRouteTarget.createMany({ data: (source.targets ?? []).map((target) => ({ ...target, id: `model-route-target-${randomUUID()}`, policyId: current.id })) })
          await db.modelRoutePolicy.update({ where: { id: current.id }, data: { ...source.policy, version: { increment: 1 }, updatedByRef: input.actorRef } })
          const changed = await find(id, db)
          await db.modelRoutePolicyRevision.create({ data: await revisionData(db, changed, input.reasonCode, input.actorRef) })
          const result = await find(id, db)
          await audit('admin.model_route.policy_rolled_back', result, { sourceRevisionNumber: input.revisionNumber }, db)
          return result
        })
        return policy
      } catch (error) { return conflict(error) }
    },
    match: async (context) => (await client.modelRoutePolicy.findMany({
      where: { status: 'active', modality: context.modality, operation: context.operation, environment: context.environment, OR: [{ region: null }, { region: context.region }] },
      include: policyInclude, orderBy: [{ priority: 'asc' }, { key: 'asc' }], take: 100,
    })).map(dto),
    exportAll: async () => {
      const policies = (await client.modelRoutePolicy.findMany({ include: policyInclude, orderBy: { key: 'asc' }, take: 1000 })).map(dto)
      return {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        providerTrafficEnabled: policies.some((policy) => policy.targets?.some((target) => target.deployment?.environment === 'production' && target.deployment?.trafficEligible)),
        policies,
        revisions: (await client.modelRoutePolicyRevision.findMany({ orderBy: [{ policyId: 'asc' }, { revisionNumber: 'asc' }], take: 10000 })).map((row) => ({ ...row, createdAt: iso(row.createdAt) })),
      }
    },
  }
}
