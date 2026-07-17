import assert from 'node:assert/strict'
import test from 'node:test'

import { createInjectedRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { createSeedRepository } from '../../repositories/seedRepository.js'
import { registerEntitlementRoutes } from './routes.js'

const admin = 'demo-access.opsplus'
const moderator = 'demo-access.legalpixel'
const member = 'demo-access.taskops'
const now = new Date('2026-07-17T08:00:00.000Z')

const createServer = async () => {
  const repository = createSeedRepository()
  const server = await createInjectedRouteTestServer(
    repository,
    (router) => registerEntitlementRoutes(router, { repositories: repository, now, source: { CREATIVE_DAILY_QUOTA: '12' } }),
  )
  return { repository, server }
}

const createActivePlan = async (server, overrides = {}) => {
  const created = await requestJson(server.url, '/api/admin/entitlements/plans', {
    token: admin,
    body: {
      key: overrides.key ?? 'personal.creator.pro',
      title: overrides.title ?? 'Creator Pro',
      description: 'Personal creative capability plan.',
    },
  })
  assert.equal(created.status, 200)

  const versioned = await requestJson(server.url, `/api/admin/entitlements/plans/${created.payload.data.id}/versions`, {
    token: admin,
    body: {
      expectedPlanVersion: 1,
      capabilities: overrides.capabilities ?? {
        'creative.image.text_to_image': true,
        'creative.video.text_to_video': false,
      },
      quotas: overrides.quotas ?? { 'creative.daily.image': 5 },
      effectiveAt: overrides.effectiveAt ?? '2026-07-01T00:00:00.000Z',
      expiresAt: overrides.expiresAt ?? null,
      reasonCode: 'initial_policy',
    },
  })
  assert.equal(versioned.status, 200)

  const activated = await requestJson(server.url, `/api/admin/entitlements/plans/${created.payload.data.id}/transitions`, {
    token: admin,
    body: {
      status: 'active',
      planVersionId: versioned.payload.data.planVersion.id,
      expectedVersion: 2,
      reasonCode: 'approved_release',
    },
  })
  assert.equal(activated.status, 200)
  return { plan: activated.payload.data, planVersion: versioned.payload.data.planVersion }
}

test('personal entitlement routes return a role-compatible actor-scoped fallback', async () => {
  const { server } = await createServer()
  try {
    const result = await requestJson(server.url, '/api/entitlements/me', { method: 'GET', token: member })
    assert.equal(result.status, 200)
    assert.equal(result.payload.data.source, 'role_fallback')
    assert.equal(result.payload.data.plan.key, 'personal.member')
    assert.equal(result.payload.data.quotas['creative.daily.image'], 12)
    assert.equal(result.payload.data.boundaries.personalAccountOnly, true)
    assert.equal(result.payload.data.boundaries.withdrawable, false)

    const ownEvaluation = await requestJson(server.url, '/api/entitlements/evaluate', {
      token: member,
      body: { capability: 'creative.image.text_to_image', quotaKey: 'creative.daily.image', units: 12 },
    })
    assert.equal(ownEvaluation.status, 200)
    assert.equal(ownEvaluation.payload.data.allowed, true)

    const crossAccount = await requestJson(server.url, '/api/entitlements/evaluate', {
      token: member,
      body: { userHandle: 'promptlin', capability: 'creative.image.text_to_image' },
    })
    assert.equal(crossAccount.status, 403)
  } finally {
    await server.close()
  }
})

test('entitlement routes isolate personal, read, manage, and transition permissions', async () => {
  const { server } = await createServer()
  try {
    const memberRead = await requestJson(server.url, '/api/admin/entitlements/plans', { method: 'GET', token: member })
    assert.equal(memberRead.status, 403)

    const moderatorRead = await requestJson(server.url, '/api/admin/entitlements/plans', { method: 'GET', token: moderator })
    assert.equal(moderatorRead.status, 200)

    const moderatorCreate = await requestJson(server.url, '/api/admin/entitlements/plans', {
      token: moderator,
      body: { key: 'personal.denied', title: 'Denied' },
    })
    assert.equal(moderatorCreate.status, 403)

    const { plan, planVersion } = await createActivePlan(server)
    const moderatorTransition = await requestJson(server.url, `/api/admin/entitlements/plans/${plan.id}/transitions`, {
      token: moderator,
      body: { status: 'retired', expectedVersion: plan.version, reasonCode: 'not_authorized' },
    })
    assert.equal(moderatorTransition.status, 403)

    const evaluated = await requestJson(server.url, '/api/admin/entitlements/evaluate', {
      token: moderator,
      body: { userHandle: 'promptlin', capability: 'creative.image.text_to_image' },
    })
    assert.equal(evaluated.status, 200)
    assert.equal(evaluated.payload.data.entitlement.planVersionId, null)
    assert.notEqual(planVersion.id, null)
  } finally {
    await server.close()
  }
})

test('plan and grant lifecycle drives unified evaluation with CAS protection', async () => {
  const { server } = await createServer()
  try {
    const { plan, planVersion } = await createActivePlan(server)
    assert.equal(plan.status, 'active')
    assert.equal(plan.activeVersion.id, planVersion.id)

    const staleTransition = await requestJson(server.url, `/api/admin/entitlements/plans/${plan.id}/transitions`, {
      token: admin,
      body: { status: 'retired', expectedVersion: 2, reasonCode: 'stale_edit' },
    })
    assert.equal(staleTransition.status, 409)
    assert.equal(staleTransition.payload.error.code, 'STATE_CONFLICT')

    const granted = await requestJson(server.url, '/api/admin/entitlements/grants', {
      token: admin,
      body: {
        userHandle: 'promptlin',
        planVersionId: planVersion.id,
        startsAt: '2026-07-10T00:00:00.000Z',
        endsAt: '2026-08-01T00:00:00.000Z',
        reasonCode: 'creator_access',
        sourceType: 'admin',
        sourceId: 'ent-01-test',
      },
    })
    assert.equal(granted.status, 200)
    assert.equal(granted.payload.data.status, 'active')
    assert.equal(granted.payload.data.events.length, 1)
    assert.equal(granted.payload.data.events[0].eventType, 'granted')

    const allowed = await requestJson(server.url, '/api/entitlements/evaluate', {
      token: 'demo-access.promptlin',
      body: { capability: 'creative.image.text_to_image', quotaKey: 'creative.daily.image', units: 5 },
    })
    assert.equal(allowed.status, 200)
    assert.equal(allowed.payload.data.allowed, true)
    assert.equal(allowed.payload.data.entitlement.source, 'personal_grant')
    assert.equal(allowed.payload.data.entitlement.policyVersion, 'personal.creator.pro-v1')

    const capabilityDenied = await requestJson(server.url, '/api/entitlements/evaluate', {
      token: 'demo-access.promptlin',
      body: { capability: 'creative.video.text_to_video' },
    })
    assert.equal(capabilityDenied.payload.data.allowed, false)
    assert.equal(capabilityDenied.payload.data.reasonCode, 'capability_not_entitled')

    const quotaDenied = await requestJson(server.url, '/api/entitlements/evaluate', {
      token: 'demo-access.promptlin',
      body: { capability: 'creative.image.text_to_image', quotaKey: 'creative.daily.image', units: 6 },
    })
    assert.equal(quotaDenied.payload.data.allowed, false)
    assert.equal(quotaDenied.payload.data.reasonCode, 'entitlement_quota_too_low')

    const staleGrant = await requestJson(server.url, `/api/admin/entitlements/grants/${granted.payload.data.id}/transitions`, {
      token: admin,
      body: { status: 'revoked', expectedVersion: 2, reasonCode: 'stale_edit' },
    })
    assert.equal(staleGrant.status, 409)

    const revoked = await requestJson(server.url, `/api/admin/entitlements/grants/${granted.payload.data.id}/transitions`, {
      token: admin,
      body: { status: 'revoked', expectedVersion: 1, reasonCode: 'access_removed' },
    })
    assert.equal(revoked.status, 200)
    assert.equal(revoked.payload.data.status, 'revoked')
    assert.equal(revoked.payload.data.events.length, 2)

    const fallback = await requestJson(server.url, '/api/entitlements/me', { method: 'GET', token: 'demo-access.promptlin' })
    assert.equal(fallback.payload.data.source, 'role_fallback')
  } finally {
    await server.close()
  }
})

test('expiry sweep, safe export, pagination, and audit evidence are bounded', async () => {
  const { repository, server } = await createServer()
  try {
    const { planVersion } = await createActivePlan(server, { key: 'personal.publisher.preview' })
    const expiredCandidate = await requestJson(server.url, '/api/admin/entitlements/grants', {
      token: admin,
      body: {
        userHandle: 'launchteam',
        planVersionId: planVersion.id,
        startsAt: '2026-07-01T00:00:00.000Z',
        endsAt: '2026-07-16T00:00:00.000Z',
        reasonCode: 'bounded_preview',
      },
    })
    assert.equal(expiredCandidate.status, 200)

    const swept = await requestJson(server.url, '/api/admin/entitlements/grants/expiry-sweep', {
      token: admin,
      body: { limit: 1, reasonCode: 'validity_window_elapsed' },
    })
    assert.equal(swept.status, 200)
    assert.equal(swept.payload.data.inspected, 1)
    assert.equal(swept.payload.data.expired, 1)
    assert.equal(swept.payload.data.items[0].status, 'expired')

    const grants = await requestJson(server.url, '/api/admin/entitlements/grants?status=expired&limit=1', { method: 'GET', token: moderator })
    assert.equal(grants.status, 200)
    assert.equal(grants.payload.data.length, 1)
    assert.equal(grants.payload.meta.pagination.limit, 1)

    const exported = await requestJson(server.url, '/api/admin/entitlements/plans/export', { method: 'GET', token: moderator })
    assert.equal(exported.status, 200)
    assert.equal(exported.payload.data.kind, 'personal-entitlements.snapshot')
    assert.equal(exported.payload.data.schemaVersion, 1)
    const exportJson = JSON.stringify(exported.payload.data)
    assert.equal(exportJson.includes('@example.com'), false)
    assert.equal(exportJson.includes('demo-access.'), false)

    const transitionAudits = repository.audit.list({ action: 'admin.entitlements.grant_transitioned', limit: 10 })
    assert.equal(transitionAudits.items.some((event) => event.resourceId === expiredCandidate.payload.data.id), true)
    const exportAudits = repository.audit.list({ action: 'admin.entitlements.exported', limit: 10 })
    assert.equal(exportAudits.items.some((event) => event.metadata?.plans === 1 && event.metadata?.grants === 1), true)
  } finally {
    await server.close()
  }
})
