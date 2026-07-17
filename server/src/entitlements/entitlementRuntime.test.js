import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertEntitlementGrantTransition,
  assertEntitlementPlanTransition,
  entitlementPlanVersionHash,
  evaluatePersonalEntitlement,
  fallbackPersonalEntitlement,
  parseEntitlementPlanVersionCreate,
  projectEffectiveEntitlement,
} from './entitlementRuntime.js'

const actor = { id: 'user-1', handle: 'personal-user', role: 'creator' }

test('entitlement plan versions validate bounded capabilities, quotas, windows, and stable hashes', () => {
  const value = parseEntitlementPlanVersionCreate({
    expectedPlanVersion: 1,
    capabilities: { 'creative.image.text_to_image': true },
    quotas: { 'creative.daily.image': 40 },
    effectiveAt: '2026-07-17T00:00:00.000Z',
    expiresAt: '2026-08-17T00:00:00.000Z',
    reasonCode: 'beta_plan',
  })
  assert.equal(value.quotas['creative.daily.image'], 40)
  assert.equal(entitlementPlanVersionHash(value).length, 64)
  assert.throws(() => parseEntitlementPlanVersionCreate({ ...value, quotas: { 'creative.daily.image': -1 } }), /integer from 0/)
  assert.throws(() => parseEntitlementPlanVersionCreate({ ...value, expiresAt: '2026-07-16T00:00:00.000Z' }), /after effectiveAt/)
})

test('entitlement state machines reject skipped and terminal transitions', () => {
  assert.doesNotThrow(() => assertEntitlementPlanTransition('draft', 'active'))
  assert.doesNotThrow(() => assertEntitlementPlanTransition('retired', 'active'))
  assert.throws(() => assertEntitlementPlanTransition('draft', 'draft'), /Cannot transition/)
  assert.doesNotThrow(() => assertEntitlementGrantTransition('scheduled', 'active'))
  assert.throws(() => assertEntitlementGrantTransition('revoked', 'active'), /Cannot transition/)
})

test('effective personal grant overrides fallback capability and quota decisions', () => {
  const now = new Date('2026-07-17T12:00:00.000Z')
  const fallback = fallbackPersonalEntitlement({ actor, baseQuotaLimit: 48, now })
  assert.equal(evaluatePersonalEntitlement({ entitlement: fallback, capability: 'creative.image.text_to_image', quotaKey: 'creative.daily.image', units: 2 }).allowed, true)

  const entitlement = projectEffectiveEntitlement({
    actor,
    baseQuotaLimit: 48,
    now,
    grant: {
      id: 'grant-1', status: 'active', startsAt: '2026-07-16T00:00:00.000Z', endsAt: null, version: 1,
      planVersion: {
        id: 'plan-version-1', version: 2, effectiveAt: '2026-07-16T00:00:00.000Z', expiresAt: null,
        capabilities: { 'creative.image.text_to_image': true, 'creative.video.text_to_video': false },
        quotas: { 'creative.daily.image': 3 },
        plan: { id: 'plan-1', key: 'personal.beta', title: 'Personal Beta', status: 'active' },
      },
    },
  })
  assert.equal(entitlement.source, 'personal_grant')
  assert.equal(evaluatePersonalEntitlement({ entitlement, capability: 'creative.image.text_to_image', quotaKey: 'creative.daily.image', units: 3 }).allowed, true)
  assert.equal(evaluatePersonalEntitlement({ entitlement, capability: 'creative.image.text_to_image', quotaKey: 'creative.daily.image', units: 4 }).reasonCode, 'entitlement_quota_too_low')
  assert.equal(evaluatePersonalEntitlement({ entitlement, capability: 'creative.video.text_to_video' }).reasonCode, 'capability_not_entitled')
})

test('expired grants fall back to the role-compatible personal entitlement', () => {
  const entitlement = projectEffectiveEntitlement({
    actor,
    baseQuotaLimit: 48,
    now: new Date('2026-07-18T00:00:00.000Z'),
    grant: {
      id: 'grant-expired', status: 'active', startsAt: '2026-07-16T00:00:00.000Z', endsAt: '2026-07-17T00:00:00.000Z', version: 1,
      planVersion: { id: 'version-1', version: 1, effectiveAt: '2026-07-16T00:00:00.000Z', expiresAt: null, capabilities: { 'creative.image.text_to_image': false }, quotas: {}, plan: { id: 'plan-1', key: 'personal.expired', title: 'Expired', status: 'active' } },
    },
  })
  assert.equal(entitlement.source, 'role_fallback')
  assert.equal(entitlement.capabilities['creative.image.text_to_image'], true)
})
