import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma personal entitlements preserve CAS, uniqueness, immutable evidence, evaluation, and expiry', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const actor = { id: `ent-actor-${suffix}`, handle: `entadmin${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-12)}`, role: 'admin' }
  const target = { id: `ent-target-${suffix}`, handle: `entuser${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-12)}`, role: 'creator' }
  const expiring = { id: `ent-expiring-${suffix}`, handle: `entexp${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-12)}`, role: 'member' }
  const now = new Date()
  const repositoryNow = new Date(now.getTime())
  const planIds = []
  const userIds = [actor.id, target.id, expiring.id]

  try {
    for (const user of [actor, target, expiring]) {
      await repository.client.user.create({
        data: {
          id: user.id,
          email: `${user.handle}@example.test`,
          displayName: user.handle,
          role: user.role,
          profile: { create: { handle: user.handle, lane: 'both', skills: [], languages: ['en'] } },
        },
      })
    }

    const plan = await repository.entitlements.createPlan({ key: `personal.creator.integration-${suffix}`.toLowerCase(), title: 'Integration Creator', description: null }, actor)
    planIds.push(plan.id)
    const versioned = await repository.entitlements.appendPlanVersion(plan.id, {
      expectedPlanVersion: 1,
      capabilities: { 'creative.image.text_to_image': true, 'creative.video.text_to_video': false },
      quotas: { 'creative.daily.image': 3, 'creative.daily.video': 1 },
      effectiveAt: new Date(now.getTime() - 60_000),
      expiresAt: null,
      reasonCode: 'integration_policy',
    }, actor)
    assert.equal(versioned.plan.version, 2)
    assert.equal(versioned.planVersion.contentHash.length, 64)

    const activated = await repository.entitlements.transitionPlan(plan.id, {
      status: 'active', planVersionId: versioned.planVersion.id, expectedVersion: 2, reasonCode: 'integration_activate',
    }, actor)
    assert.equal(activated.version, 3)
    await assert.rejects(
      repository.entitlements.transitionPlan(plan.id, { status: 'retired', expectedVersion: 2, reasonCode: 'stale_transition' }, actor),
      (error) => error.statusCode === 409 && error.code === 'STATE_CONFLICT',
    )

    const grant = await repository.entitlements.createGrant({
      userHandle: target.handle,
      planVersionId: versioned.planVersion.id,
      startsAt: new Date(now.getTime() - 60_000),
      endsAt: new Date(now.getTime() + 86_400_000),
      reasonCode: 'integration_grant',
      sourceType: 'admin',
      sourceId: suffix,
    }, actor)
    assert.equal(grant.status, 'active')
    assert.equal(grant.events.length, 1)

    const allowed = await repository.entitlements.evaluateForActor(target, {
      capability: 'creative.image.text_to_image', quotaKey: 'creative.daily.image', units: 3, baseQuotaLimit: 48, at: repositoryNow,
    })
    assert.equal(allowed.allowed, true)
    assert.equal(allowed.entitlement.source, 'personal_grant')
    assert.equal(allowed.entitlement.policyVersion, `${plan.key}-v1`)
    const capabilityDenied = await repository.entitlements.evaluateForActor(target, {
      capability: 'creative.video.text_to_video', quotaKey: 'creative.daily.video', units: 1, baseQuotaLimit: 48, at: repositoryNow,
    })
    assert.equal(capabilityDenied.reasonCode, 'capability_not_entitled')
    const quotaDenied = await repository.entitlements.evaluateForActor(target, {
      capability: 'creative.image.text_to_image', quotaKey: 'creative.daily.image', units: 4, baseQuotaLimit: 48, at: repositoryNow,
    })
    assert.equal(quotaDenied.reasonCode, 'entitlement_quota_too_low')

    await assert.rejects(
      repository.client.personalEntitlementGrant.create({ data: {
        id: `ent-grant-conflict-${suffix}`,
        userId: target.id,
        planVersionId: versioned.planVersion.id,
        status: 'active',
        startsAt: new Date(now.getTime() - 30_000),
        endsAt: new Date(now.getTime() + 86_400_000),
        reasonCode: 'unique_constraint',
        sourceType: 'integration',
        grantedByRef: actor.id,
      } }),
      (error) => error.code === 'P2002',
    )

    await assert.rejects(
      repository.client.entitlementPlanVersion.update({ where: { id: versioned.planVersion.id }, data: { reasonCode: 'tampered' } }),
      /immutable/,
    )
    await assert.rejects(
      repository.client.entitlementGrantEvent.delete({ where: { id: grant.events[0].id } }),
      /immutable/,
    )

    const expiringGrant = await repository.entitlements.createGrant({
      userHandle: expiring.handle,
      planVersionId: versioned.planVersion.id,
      startsAt: new Date(now.getTime() - 120_000),
      endsAt: new Date(now.getTime() - 60_000),
      reasonCode: 'integration_expiring',
      sourceType: 'admin',
      sourceId: suffix,
    }, actor)
    assert.equal(expiringGrant.status, 'active')
    const swept = await repository.entitlements.sweepExpired({ limit: 10, reasonCode: 'validity_window_elapsed' }, actor)
    assert.equal(swept.items.some((item) => item.id === expiringGrant.id && item.status === 'expired'), true)

    await assert.rejects(
      repository.entitlements.transitionGrant(grant.id, { status: 'revoked', expectedVersion: 2, reasonCode: 'stale_grant' }, actor),
      (error) => error.statusCode === 409 && error.code === 'STATE_CONFLICT',
    )
    const revoked = await repository.entitlements.transitionGrant(grant.id, { status: 'revoked', expectedVersion: 1, reasonCode: 'integration_revoke' }, actor)
    assert.equal(revoked.status, 'revoked')
    assert.equal(revoked.events.length, 2)
    const fallback = await repository.entitlements.effectiveForActor(target, { baseQuotaLimit: 48, at: repositoryNow })
    assert.equal(fallback.source, 'role_fallback')

    const audits = await repository.client.auditEvent.findMany({ where: { actorId: actor.id, action: { startsWith: 'admin.entitlements.' } } })
    assert.equal(audits.length >= 6, true)
  } finally {
    await repository.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.entitlement_maintenance = 'on'")
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await transaction.entitlementPlan.updateMany({ where: { id: { in: planIds } }, data: { activeVersionId: null } })
      await transaction.entitlementGrantEvent.deleteMany({ where: { grant: { planVersion: { planId: { in: planIds } } } } })
      await transaction.personalEntitlementGrant.deleteMany({ where: { planVersion: { planId: { in: planIds } } } })
      await transaction.entitlementPlanVersion.deleteMany({ where: { planId: { in: planIds } } })
      await transaction.entitlementPlan.deleteMany({ where: { id: { in: planIds } } })
      await transaction.auditEvent.deleteMany({ where: { actorId: actor.id } })
      await transaction.user.deleteMany({ where: { id: { in: userIds } } })
    })
    await repository.client.$disconnect()
  }
})
