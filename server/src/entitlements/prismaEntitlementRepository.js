import { randomUUID } from 'node:crypto'
import { HttpError } from '../common/errors/httpError.js'
import { buildAuditRecord } from '../repositories/prismaTransforms.js'
import {
  assertEntitlementGrantTransition,
  assertEntitlementPlanTransition,
  buildEntitlementGrantEvent,
  entitlementPlanVersionHash,
  evaluatePersonalEntitlement,
  projectEffectiveEntitlement,
} from './entitlementRuntime.js'

const dateIso = (value) => value?.toISOString?.() ?? value ?? null
const versionDto = (row) => row ? { ...row, effectiveAt: dateIso(row.effectiveAt), expiresAt: dateIso(row.expiresAt), createdAt: dateIso(row.createdAt) } : null
const planDto = (row) => row ? {
  ...row,
  activatedAt: dateIso(row.activatedAt), retiredAt: dateIso(row.retiredAt), createdAt: dateIso(row.createdAt), updatedAt: dateIso(row.updatedAt),
  activeVersion: versionDto(row.activeVersion),
  versionCount: row._count?.versions ?? row.versionCount ?? undefined,
  ...(row.versions ? { versions: row.versions.map(versionDto) } : {}),
  _count: undefined,
} : null
const eventDto = (row) => ({ ...row, createdAt: dateIso(row.createdAt) })
const grantDto = (row) => row ? {
  ...row,
  startsAt: dateIso(row.startsAt), endsAt: dateIso(row.endsAt), revokedAt: dateIso(row.revokedAt), createdAt: dateIso(row.createdAt), updatedAt: dateIso(row.updatedAt),
  user: row.user ? { id: row.user.id, handle: row.user.profile?.handle ?? null, displayName: row.user.displayName } : undefined,
  planVersion: row.planVersion ? { ...versionDto(row.planVersion), plan: row.planVersion.plan ? { id: row.planVersion.plan.id, key: row.planVersion.plan.key, title: row.planVersion.plan.title, status: row.planVersion.plan.status } : undefined } : undefined,
  events: row.events?.map(eventDto),
} : null

const planInclude = { activeVersion: true, _count: { select: { versions: true } } }
const grantInclude = { user: { include: { profile: true } }, planVersion: { include: { plan: true } }, events: { orderBy: { createdAt: 'desc' } } }
const auditData = (actor, action, resourceType, resourceId, metadata) => buildAuditRecord({ actorType: 'user', actorId: actor.id, action, resourceType, resourceId, metadata })

export const createPrismaEntitlementRepository = (client, { now = () => new Date() } = {}) => {
  const repository = {
    findActorByHandle: async (handle) => {
      const user = await client.user.findFirst({ where: { profile: { handle: String(handle) } }, include: { profile: true } })
      return user ? { id: user.id, handle: user.profile?.handle ?? null, role: user.role, displayName: user.displayName } : null
    },
    listPlans: async (options) => {
      const where = {
        ...(options.status ? { status: options.status } : {}),
        ...(options.search ? { OR: [{ key: { contains: options.search, mode: 'insensitive' } }, { title: { contains: options.search, mode: 'insensitive' } }] } : {}),
      }
      const orderBy = options.sort === 'updated_asc' ? [{ updatedAt: 'asc' }, { id: 'asc' }]
        : options.sort === 'key_asc' ? [{ key: 'asc' }]
          : [{ updatedAt: 'desc' }, { id: 'asc' }]
      const rows = await client.entitlementPlan.findMany({ where, orderBy, take: options.limit + 1, ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}), include: planInclude })
      const page = rows.slice(0, options.limit)
      const grouped = await client.entitlementPlan.groupBy({ by: ['status'], _count: { _all: true } })
      const counts = Object.fromEntries(grouped.map((row) => [row.status, row._count._all]))
      return { items: page.map(planDto), limit: options.limit, nextCursor: rows.length > options.limit ? page.at(-1)?.id ?? null : null, summary: { total: grouped.reduce((total, row) => total + row._count._all, 0), draft: counts.draft ?? 0, active: counts.active ?? 0, retired: counts.retired ?? 0 } }
    },
    findPlan: async (id) => planDto(await client.entitlementPlan.findUnique({ where: { id: String(id) }, include: { ...planInclude, versions: { orderBy: { version: 'desc' } } } })),
    createPlan: async (payload, actor) => client.$transaction(async (transaction) => {
      const plan = await transaction.entitlementPlan.create({ data: { id: `ent-plan-${randomUUID()}`, ...payload, createdByRef: actor.id, updatedByRef: actor.id }, include: planInclude })
      await transaction.auditEvent.create({ data: auditData(actor, 'admin.entitlements.plan_created', 'entitlement_plan', plan.id, { key: plan.key, version: plan.version }) })
      return planDto(plan)
    }),
    appendPlanVersion: async (id, payload, actor) => client.$transaction(async (transaction) => {
      const plan = await transaction.entitlementPlan.findUnique({ where: { id: String(id) } })
      if (!plan) return null
      if (plan.version !== payload.expectedPlanVersion) throw new HttpError(409, 'STATE_CONFLICT', 'Entitlement plan changed after this edit started')
      const latest = await transaction.entitlementPlanVersion.aggregate({ where: { planId: plan.id }, _max: { version: true } })
      const number = (latest._max.version ?? 0) + 1
      const updated = await transaction.entitlementPlan.updateMany({ where: { id: plan.id, version: payload.expectedPlanVersion }, data: { version: { increment: 1 }, updatedByRef: actor.id } })
      if (updated.count !== 1) throw new HttpError(409, 'STATE_CONFLICT', 'Entitlement plan changed after this edit started')
      const version = await transaction.entitlementPlanVersion.create({ data: { id: `ent-version-${randomUUID()}`, planId: plan.id, version: number, capabilities: payload.capabilities, quotas: payload.quotas, effectiveAt: payload.effectiveAt, expiresAt: payload.expiresAt, contentHash: entitlementPlanVersionHash(payload), actorRef: actor.id, reasonCode: payload.reasonCode } })
      await transaction.auditEvent.create({ data: auditData(actor, 'admin.entitlements.plan_version_appended', 'entitlement_plan', plan.id, { planVersionId: version.id, planVersion: number, contentHash: version.contentHash, reasonCode: payload.reasonCode }) })
      return { plan: planDto(await transaction.entitlementPlan.findUnique({ where: { id: plan.id }, include: planInclude })), planVersion: versionDto(version) }
    }),
    transitionPlan: async (id, payload, actor) => client.$transaction(async (transaction) => {
      const plan = await transaction.entitlementPlan.findUnique({ where: { id: String(id) } })
      if (!plan) return null
      if (plan.version !== payload.expectedVersion) throw new HttpError(409, 'STATE_CONFLICT', 'Entitlement plan changed after this transition started')
      assertEntitlementPlanTransition(plan.status, payload.status)
      let activeVersionId = plan.activeVersionId
      if (payload.status === 'active') {
        const version = await transaction.entitlementPlanVersion.findFirst({ where: { id: payload.planVersionId, planId: plan.id } })
        if (!version) throw new HttpError(409, 'ENTITLEMENT_VERSION_INVALID', 'An entitlement plan version owned by this plan is required')
        activeVersionId = version.id
      }
      const timestamp = now()
      const updated = await transaction.entitlementPlan.updateMany({ where: { id: plan.id, version: payload.expectedVersion }, data: { status: payload.status, activeVersionId, version: { increment: 1 }, updatedByRef: actor.id, activatedAt: payload.status === 'active' ? timestamp : plan.activatedAt, retiredAt: payload.status === 'retired' ? timestamp : null } })
      if (updated.count !== 1) throw new HttpError(409, 'STATE_CONFLICT', 'Entitlement plan changed after this transition started')
      const result = await transaction.entitlementPlan.findUnique({ where: { id: plan.id }, include: planInclude })
      await transaction.auditEvent.create({ data: auditData(actor, 'admin.entitlements.plan_transitioned', 'entitlement_plan', plan.id, { fromStatus: plan.status, toStatus: payload.status, planVersionId: activeVersionId, version: result.version, reasonCode: payload.reasonCode }) })
      return planDto(result)
    }),
    listGrants: async (options) => {
      const where = {
        ...(options.status ? { status: options.status } : {}),
        ...(options.userHandle ? { user: { profile: { handle: options.userHandle } } } : {}),
        ...(options.search ? { OR: [{ user: { profile: { handle: { contains: options.search, mode: 'insensitive' } } } }, { planVersion: { plan: { key: { contains: options.search, mode: 'insensitive' } } } }] } : {}),
      }
      const rows = await client.personalEntitlementGrant.findMany({ where, orderBy: options.sort === 'starts_desc' ? [{ startsAt: 'desc' }, { id: 'asc' }] : [{ updatedAt: 'desc' }, { id: 'asc' }], take: options.limit + 1, ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}), include: grantInclude })
      const page = rows.slice(0, options.limit)
      const grouped = await client.personalEntitlementGrant.groupBy({ by: ['status'], _count: { _all: true } })
      return { items: page.map(grantDto), limit: options.limit, nextCursor: rows.length > options.limit ? page.at(-1)?.id ?? null : null, summary: Object.fromEntries(['scheduled', 'active', 'revoked', 'expired'].map((status) => [status, grouped.find((row) => row.status === status)?._count._all ?? 0])) }
    },
    findGrant: async (id) => grantDto(await client.personalEntitlementGrant.findUnique({ where: { id: String(id) }, include: grantInclude })),
    createGrant: async (payload, actor) => client.$transaction(async (transaction) => {
      const user = await transaction.user.findFirst({ where: { profile: { handle: payload.userHandle } }, include: { profile: true } })
      if (!user) return null
      const planVersion = await transaction.entitlementPlanVersion.findUnique({ where: { id: payload.planVersionId }, include: { plan: true } })
      if (!planVersion || planVersion.plan.status !== 'active' || planVersion.plan.activeVersionId !== planVersion.id) throw new HttpError(409, 'ENTITLEMENT_VERSION_INACTIVE', 'Only the active version of an active entitlement plan can be granted')
      const status = payload.startsAt > now() ? 'scheduled' : 'active'
      const existing = await transaction.personalEntitlementGrant.findFirst({ where: { userId: user.id, status } })
      if (existing) throw new HttpError(409, 'ENTITLEMENT_GRANT_CONFLICT', `User already has a ${status} entitlement grant`)
      const grantId = `ent-grant-${randomUUID()}`
      const grant = await transaction.personalEntitlementGrant.create({ data: { id: grantId, userId: user.id, planVersionId: planVersion.id, status, startsAt: payload.startsAt, endsAt: payload.endsAt, reasonCode: payload.reasonCode, sourceType: payload.sourceType, sourceId: payload.sourceId, grantedByRef: actor.id } })
      const event = buildEntitlementGrantEvent({ grantId, eventType: 'granted', toStatus: status, actorRef: actor.id, reasonCode: payload.reasonCode, evidence: { planVersionId: planVersion.id, startsAt: dateIso(grant.startsAt), endsAt: dateIso(grant.endsAt) } })
      await transaction.entitlementGrantEvent.create({ data: event })
      await transaction.auditEvent.create({ data: auditData(actor, 'admin.entitlements.grant_created', 'personal_entitlement_grant', grant.id, { userId: user.id, planVersionId: planVersion.id, status, startsAt: dateIso(grant.startsAt), endsAt: dateIso(grant.endsAt), reasonCode: payload.reasonCode }) })
      return grantDto(await transaction.personalEntitlementGrant.findUnique({ where: { id: grant.id }, include: grantInclude }))
    }),
    transitionGrant: async (id, payload, actor) => client.$transaction(async (transaction) => {
      const grant = await transaction.personalEntitlementGrant.findUnique({ where: { id: String(id) } })
      if (!grant) return null
      if (grant.version !== payload.expectedVersion) throw new HttpError(409, 'STATE_CONFLICT', 'Entitlement grant changed after this transition started')
      assertEntitlementGrantTransition(grant.status, payload.status)
      if (payload.status === 'active') {
        const existing = await transaction.personalEntitlementGrant.findFirst({ where: { userId: grant.userId, status: 'active', id: { not: grant.id } } })
        if (existing) throw new HttpError(409, 'ENTITLEMENT_GRANT_CONFLICT', 'User already has an active entitlement grant')
      }
      const timestamp = now()
      const updated = await transaction.personalEntitlementGrant.updateMany({ where: { id: grant.id, version: payload.expectedVersion }, data: { status: payload.status, version: { increment: 1 }, revokedByRef: payload.status === 'revoked' ? actor.id : null, revokedAt: payload.status === 'revoked' ? timestamp : null } })
      if (updated.count !== 1) throw new HttpError(409, 'STATE_CONFLICT', 'Entitlement grant changed after this transition started')
      const result = await transaction.personalEntitlementGrant.findUnique({ where: { id: grant.id } })
      const event = buildEntitlementGrantEvent({ grantId: grant.id, eventType: `grant_${payload.status}`, fromStatus: grant.status, toStatus: payload.status, actorRef: actor.id, reasonCode: payload.reasonCode, evidence: { grantVersion: result.version } })
      await transaction.entitlementGrantEvent.create({ data: event })
      await transaction.auditEvent.create({ data: auditData(actor, 'admin.entitlements.grant_transitioned', 'personal_entitlement_grant', grant.id, { fromStatus: grant.status, toStatus: payload.status, version: result.version, reasonCode: payload.reasonCode }) })
      return grantDto(await transaction.personalEntitlementGrant.findUnique({ where: { id: grant.id }, include: grantInclude }))
    }),
    sweepExpired: async ({ limit = 50, reasonCode = 'validity_window_elapsed' }, actor) => {
      const due = await client.personalEntitlementGrant.findMany({ where: { status: { in: ['scheduled', 'active'] }, endsAt: { lte: now() } }, orderBy: { endsAt: 'asc' }, take: limit })
      const items = []
      for (const grant of due) items.push(await repository.transitionGrant(grant.id, { status: 'expired', expectedVersion: grant.version, reasonCode }, actor))
      return { inspected: due.length, expired: items.length, items }
    },
    effectiveForActor: async (actor, { baseQuotaLimit, at = now() } = {}) => {
      const grant = await client.personalEntitlementGrant.findFirst({ where: { userId: actor.id, status: 'active', startsAt: { lte: at }, OR: [{ endsAt: null }, { endsAt: { gt: at } }] }, orderBy: { startsAt: 'desc' }, include: grantInclude })
      return projectEffectiveEntitlement({ actor, grant: grant ? grantDto(grant) : null, baseQuotaLimit, now: at })
    },
    evaluateForActor: async (actor, input) => evaluatePersonalEntitlement({ entitlement: await repository.effectiveForActor(actor, { baseQuotaLimit: input.baseQuotaLimit, at: input.at }), capability: input.capability, quotaKey: input.quotaKey, units: input.units }),
    exportSnapshot: async (options) => {
      const [plans, grants] = await Promise.all([repository.listPlans({ ...options, limit: 100 }), repository.listGrants({ ...options, limit: 100 })])
      return { kind: 'personal-entitlements.snapshot', schemaVersion: 1, exportedAt: now().toISOString(), plans: plans.items, grants: grants.items }
    },
  }
  return repository
}
