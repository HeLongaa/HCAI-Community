import assert from 'node:assert/strict'
import test from 'node:test'

import { modelRouteBucket, parseModelRoutePolicyCreate, parseModelRouteTargets, resolveModelRoute } from './modelRoutingRuntime.js'

const actor = { id: 'admin-1', handle: 'ops' }
const candidate = ({ id, role, priority, trafficEligible = true }) => ({
  id: `target-${id}`, modelDeploymentId: `deployment-${id}`, role, priority, enabled: true,
  deployment: {
    id: `deployment-${id}`, key: `${id}-staging`, status: 'active', trafficEligible, environment: 'staging', region: 'us',
    modelVersion: {
      id: `version-${id}`, status: 'active', capabilities: [{ modality: 'image', operations: ['generate'] }],
      model: { key: `model-${id}`, family: 'image', status: 'active', provider: { key: `provider-${id}`, status: 'active' } },
    },
  },
})
const policy = (overrides = {}) => ({
  id: 'policy-1', key: 'image-staging', status: 'active', modality: 'image', operation: 'generate', environment: 'staging', region: 'us',
  audienceRoles: [], rolloutPercentage: 100, rolloutSeed: 'v1', fallbackMode: 'ordered', priority: 10,
  targets: [candidate({ id: 'primary', role: 'primary', priority: 10 }), candidate({ id: 'backup', role: 'backup', priority: 20 })],
  ...overrides,
})
const context = { modality: 'image', operation: 'generate', environment: 'staging', region: 'us', subjectKey: 'user-1', role: 'member' }

test('route policy parser rejects credentials and validates primary targets', () => {
  assert.throws(() => parseModelRoutePolicyCreate({ key: 'route', name: 'Route', modality: 'image', operation: 'generate', environment: 'staging', credential: 'secret' }, actor), /unsupported fields/)
  assert.throws(() => parseModelRouteTargets('policy-1', { expectedVersion: 1, reasonCode: 'targets', targets: [{ modelDeploymentId: 'deployment-1', role: 'backup', priority: 1 }] }, actor), /primary target/)
  assert.equal(parseModelRoutePolicyCreate({ key: 'route', name: 'Route', modality: 'image', operation: 'generate', environment: 'staging', rolloutPercentage: 25 }, actor).fallbackMode, 'fail_closed')
})

test('route bucket is deterministic and bounded without exposing the subject', () => {
  const first = modelRouteBucket({ policyKey: 'route', rolloutSeed: 'v1', subjectKey: 'private-user' })
  assert.equal(first, modelRouteBucket({ policyKey: 'route', rolloutSeed: 'v1', subjectKey: 'private-user' }))
  assert.equal(first >= 0 && first < 100, true)
})

test('ordered routing selects a backup only after the primary is blocked', async () => {
  const result = await resolveModelRoute({ policies: [policy()], context, evaluateCandidate: async (target) => target.role === 'primary' ? { allowed: false, reasonCode: 'provider_circuit_open' } : { allowed: true } })
  assert.equal(result.status, 'selected')
  assert.equal(result.reasonCode, 'fallback_selected')
  assert.equal(result.selected.role, 'backup')
  assert.deepEqual(result.attempts.map((attempt) => attempt.reasonCode), ['provider_circuit_open', 'fallback_selected'])
})

test('fail-closed policy never silently tries a backup', async () => {
  const result = await resolveModelRoute({ policies: [policy({ fallbackMode: 'fail_closed' })], context, evaluateCandidate: async () => ({ allowed: false, reasonCode: 'provider_kill_switch_active' }) })
  assert.equal(result.status, 'unavailable')
  assert.equal(result.attempts.length, 1)
  assert.equal(result.attempts[0].role, 'primary')
})

test('traffic eligibility and audience rollout fail closed before Provider evaluation', async () => {
  let gateCalls = 0
  const ineligible = await resolveModelRoute({
    policies: [policy({ targets: [candidate({ id: 'primary', role: 'primary', priority: 1, trafficEligible: false })] })], context,
    evaluateCandidate: async () => { gateCalls += 1; return { allowed: true } },
  })
  assert.equal(ineligible.attempts[0].reasonCode, 'provider_approval_required')
  assert.equal(gateCalls, 0)
  const audienceMiss = await resolveModelRoute({ policies: [policy({ audienceRoles: ['admin'] })], context })
  assert.equal(audienceMiss.reasonCode, 'no_audience_match')
  assert.equal(audienceMiss.consideredPolicies[0].reasonCode, 'audience_role_miss')
})
