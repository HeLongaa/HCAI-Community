import { randomUUID } from 'node:crypto'
import { HttpError } from '../common/errors/httpError.js'
import {
  assertEntitlementGrantTransition,
  assertEntitlementPlanTransition,
  buildEntitlementGrantEvent,
  entitlementPlanVersionHash,
  evaluatePersonalEntitlement,
  projectEffectiveEntitlement,
} from './entitlementRuntime.js'

const clone = (value) => value == null ? value : structuredClone(value)
const iso = (value) => value instanceof Date ? value.toISOString() : value

const paginate = (rows, options = {}) => {
  const start = options.cursor ? Math.max(rows.findIndex((row) => row.id === options.cursor) + 1, 0) : 0
  const items = rows.slice(start, start + options.limit)
  return { items: clone(items), limit: options.limit, nextCursor: rows.length > start + options.limit ? items.at(-1)?.id ?? null : null }
}

export const createSeedEntitlementRepository = ({ getUserByHandle, getUserById, recordAudit, now = () => new Date() }) => {
  const plans = new Map()
  const versions = new Map()
  const grants = new Map()
  const events = new Map()

  const planDto = (plan) => ({
    ...clone(plan),
    activeVersion: plan.activeVersionId ? clone(versions.get(plan.activeVersionId) ?? null) : null,
    versionCount: [...versions.values()].filter((version) => version.planId === plan.id).length,
  })
  const grantDto = (grant) => {
    const user = getUserById(grant.userId)
    const planVersion = versions.get(grant.planVersionId)
    const plan = planVersion ? plans.get(planVersion.planId) : null
    return {
      ...clone(grant),
      user: user ? { id: user.id, handle: user.handle ?? user.profileHandle, displayName: user.displayName } : null,
      planVersion: planVersion ? { ...clone(planVersion), plan: plan ? { id: plan.id, key: plan.key, title: plan.title, status: plan.status } : null } : null,
      events: [...events.values()].filter((event) => event.grantId === grant.id).sort((left, right) => right.createdAt.localeCompare(left.createdAt)).map(clone),
    }
  }
  const audit = (actor, action, resourceType, resourceId, metadata) => recordAudit?.(actor, action, resourceType, resourceId, metadata)

  const repository = {
    findActorByHandle: async (handle) => clone(getUserByHandle(handle)),
    listPlans: async (options) => {
      let rows = [...plans.values()]
      if (options.status) rows = rows.filter((row) => row.status === options.status)
      if (options.search) {
        const search = options.search.toLowerCase()
        rows = rows.filter((row) => `${row.key} ${row.title}`.toLowerCase().includes(search))
      }
      rows.sort(options.sort === 'updated_asc'
        ? (left, right) => left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id)
        : options.sort === 'key_asc'
          ? (left, right) => left.key.localeCompare(right.key)
          : (left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
      const page = paginate(rows.map(planDto), options)
      return { ...page, summary: { total: plans.size, draft: [...plans.values()].filter((row) => row.status === 'draft').length, active: [...plans.values()].filter((row) => row.status === 'active').length, retired: [...plans.values()].filter((row) => row.status === 'retired').length } }
    },
    findPlan: async (id) => {
      const plan = plans.get(String(id))
      if (!plan) return null
      return { ...planDto(plan), versions: [...versions.values()].filter((version) => version.planId === plan.id).sort((left, right) => right.version - left.version).map(clone) }
    },
    createPlan: async (payload, actor) => {
      if ([...plans.values()].some((plan) => plan.key === payload.key)) throw new HttpError(409, 'ENTITLEMENT_PLAN_CONFLICT', 'Entitlement plan key already exists')
      const timestamp = now().toISOString()
      const plan = { id: `ent-plan-${randomUUID()}`, ...payload, status: 'draft', activeVersionId: null, version: 1, createdByRef: actor.id, updatedByRef: actor.id, activatedAt: null, retiredAt: null, createdAt: timestamp, updatedAt: timestamp }
      plans.set(plan.id, plan)
      audit(actor, 'admin.entitlements.plan_created', 'entitlement_plan', plan.id, { key: plan.key, version: plan.version })
      return planDto(plan)
    },
    appendPlanVersion: async (id, payload, actor) => {
      const plan = plans.get(String(id))
      if (!plan) return null
      if (plan.version !== payload.expectedPlanVersion) throw new HttpError(409, 'STATE_CONFLICT', 'Entitlement plan changed after this edit started')
      const number = [...versions.values()].filter((version) => version.planId === plan.id).reduce((maximum, version) => Math.max(maximum, version.version), 0) + 1
      const version = { id: `ent-version-${randomUUID()}`, planId: plan.id, version: number, capabilities: clone(payload.capabilities), quotas: clone(payload.quotas), effectiveAt: iso(payload.effectiveAt), expiresAt: iso(payload.expiresAt), contentHash: entitlementPlanVersionHash(payload), actorRef: actor.id, reasonCode: payload.reasonCode, createdAt: now().toISOString() }
      versions.set(version.id, version)
      Object.assign(plan, { version: plan.version + 1, updatedByRef: actor.id, updatedAt: now().toISOString() })
      audit(actor, 'admin.entitlements.plan_version_appended', 'entitlement_plan', plan.id, { planVersionId: version.id, planVersion: version.version, contentHash: version.contentHash, reasonCode: payload.reasonCode })
      return { plan: planDto(plan), planVersion: clone(version) }
    },
    transitionPlan: async (id, payload, actor) => {
      const plan = plans.get(String(id))
      if (!plan) return null
      if (plan.version !== payload.expectedVersion) throw new HttpError(409, 'STATE_CONFLICT', 'Entitlement plan changed after this transition started')
      assertEntitlementPlanTransition(plan.status, payload.status)
      let activeVersionId = plan.activeVersionId
      if (payload.status === 'active') {
        const version = versions.get(payload.planVersionId)
        if (!version || version.planId !== plan.id) throw new HttpError(409, 'ENTITLEMENT_VERSION_INVALID', 'An entitlement plan version owned by this plan is required')
        activeVersionId = version.id
      }
      const previousStatus = plan.status
      Object.assign(plan, { status: payload.status, activeVersionId, version: plan.version + 1, updatedByRef: actor.id, activatedAt: payload.status === 'active' ? now().toISOString() : plan.activatedAt, retiredAt: payload.status === 'retired' ? now().toISOString() : null, updatedAt: now().toISOString() })
      audit(actor, 'admin.entitlements.plan_transitioned', 'entitlement_plan', plan.id, { fromStatus: previousStatus, toStatus: plan.status, planVersionId: activeVersionId, version: plan.version, reasonCode: payload.reasonCode })
      return planDto(plan)
    },
    listGrants: async (options) => {
      let rows = [...grants.values()].map(grantDto)
      if (options.status) rows = rows.filter((row) => row.status === options.status)
      if (options.userHandle) rows = rows.filter((row) => row.user?.handle === options.userHandle)
      if (options.search) {
        const search = options.search.toLowerCase()
        rows = rows.filter((row) => `${row.user?.handle ?? ''} ${row.planVersion?.plan?.key ?? ''}`.toLowerCase().includes(search))
      }
      rows.sort((left, right) => options.sort === 'starts_desc' ? right.startsAt.localeCompare(left.startsAt) : right.updatedAt.localeCompare(left.updatedAt))
      const page = paginate(rows, options)
      return { ...page, summary: Object.fromEntries(['scheduled', 'active', 'revoked', 'expired'].map((status) => [status, [...grants.values()].filter((grant) => grant.status === status).length])) }
    },
    findGrant: async (id) => grants.has(String(id)) ? grantDto(grants.get(String(id))) : null,
    createGrant: async (payload, actor) => {
      const user = getUserByHandle(payload.userHandle)
      if (!user) return null
      const planVersion = versions.get(payload.planVersionId)
      const plan = planVersion ? plans.get(planVersion.planId) : null
      if (!planVersion || !plan || plan.status !== 'active' || plan.activeVersionId !== planVersion.id) throw new HttpError(409, 'ENTITLEMENT_VERSION_INACTIVE', 'Only the active version of an active entitlement plan can be granted')
      const status = payload.startsAt > now() ? 'scheduled' : 'active'
      if ([...grants.values()].some((grant) => grant.userId === user.id && grant.status === status)) throw new HttpError(409, 'ENTITLEMENT_GRANT_CONFLICT', `User already has a ${status} entitlement grant`)
      const timestamp = now().toISOString()
      const grant = { id: `ent-grant-${randomUUID()}`, userId: user.id, planVersionId: planVersion.id, status, startsAt: iso(payload.startsAt), endsAt: iso(payload.endsAt), version: 1, reasonCode: payload.reasonCode, sourceType: payload.sourceType, sourceId: payload.sourceId, grantedByRef: actor.id, revokedByRef: null, revokedAt: null, createdAt: timestamp, updatedAt: timestamp }
      const event = buildEntitlementGrantEvent({ grantId: grant.id, eventType: 'granted', toStatus: status, actorRef: actor.id, reasonCode: payload.reasonCode, evidence: { planVersionId: planVersion.id, startsAt: grant.startsAt, endsAt: grant.endsAt } })
      event.createdAt = timestamp
      grants.set(grant.id, grant)
      events.set(event.id, event)
      audit(actor, 'admin.entitlements.grant_created', 'personal_entitlement_grant', grant.id, { userId: user.id, planVersionId: planVersion.id, status, startsAt: grant.startsAt, endsAt: grant.endsAt, reasonCode: payload.reasonCode })
      return grantDto(grant)
    },
    transitionGrant: async (id, payload, actor) => {
      const grant = grants.get(String(id))
      if (!grant) return null
      if (grant.version !== payload.expectedVersion) throw new HttpError(409, 'STATE_CONFLICT', 'Entitlement grant changed after this transition started')
      assertEntitlementGrantTransition(grant.status, payload.status)
      if (payload.status === 'active' && [...grants.values()].some((candidate) => candidate.id !== grant.id && candidate.userId === grant.userId && candidate.status === 'active')) throw new HttpError(409, 'ENTITLEMENT_GRANT_CONFLICT', 'User already has an active entitlement grant')
      const previousStatus = grant.status
      Object.assign(grant, { status: payload.status, version: grant.version + 1, revokedByRef: payload.status === 'revoked' ? actor.id : null, revokedAt: payload.status === 'revoked' ? now().toISOString() : null, updatedAt: now().toISOString() })
      const event = buildEntitlementGrantEvent({ grantId: grant.id, eventType: `grant_${payload.status}`, fromStatus: previousStatus, toStatus: payload.status, actorRef: actor.id, reasonCode: payload.reasonCode, evidence: { grantVersion: grant.version } })
      event.createdAt = now().toISOString()
      events.set(event.id, event)
      audit(actor, 'admin.entitlements.grant_transitioned', 'personal_entitlement_grant', grant.id, { fromStatus: previousStatus, toStatus: payload.status, version: grant.version, reasonCode: payload.reasonCode })
      return grantDto(grant)
    },
    sweepExpired: async ({ limit = 50, reasonCode = 'validity_window_elapsed' }, actor) => {
      const current = now()
      const due = [...grants.values()].filter((grant) => ['scheduled', 'active'].includes(grant.status) && grant.endsAt && new Date(grant.endsAt) <= current).slice(0, limit)
      const items = []
      for (const grant of due) items.push(await repository.transitionGrant(grant.id, { status: 'expired', expectedVersion: grant.version, reasonCode }, actor))
      return { inspected: due.length, expired: items.length, items }
    },
    effectiveForActor: async (actor, { baseQuotaLimit, at = now() } = {}) => {
      const grant = [...grants.values()].filter((candidate) => candidate.userId === actor.id && candidate.status === 'active').sort((left, right) => right.startsAt.localeCompare(left.startsAt))[0]
      return projectEffectiveEntitlement({ actor, grant: grant ? grantDto(grant) : null, baseQuotaLimit, now: at })
    },
    evaluateForActor: async (actor, input) => {
      const entitlement = await repository.effectiveForActor(actor, { baseQuotaLimit: input.baseQuotaLimit, at: input.at })
      return evaluatePersonalEntitlement({ entitlement, capability: input.capability, quotaKey: input.quotaKey, units: input.units })
    },
    exportSnapshot: async (options) => {
      const [planPage, grantPage] = await Promise.all([repository.listPlans({ ...options, limit: 100 }), repository.listGrants({ ...options, limit: 100 })])
      return { kind: 'personal-entitlements.snapshot', schemaVersion: 1, exportedAt: now().toISOString(), plans: planPage.items, grants: grantPage.items }
    },
  }
  return repository
}
