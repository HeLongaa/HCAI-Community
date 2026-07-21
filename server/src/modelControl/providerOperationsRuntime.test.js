import assert from 'node:assert/strict'
import test from 'node:test'

import { buildProviderControlScopes, createProviderCapEvidence, providerCircuitScope } from '../creative/providerControlContract.js'
import { evaluateProviderOperationalReadiness } from './providerOperationsRuntime.js'

test('Provider operational readiness enforces the database per-request amount limit', () => {
  const now = new Date('2026-07-21T00:00:00.000Z')
  const scopes = buildProviderControlScopes({ providerId: 'hc-router', providerAccountRef: 'production', workspace: 'chat', modelFamily: 'chat' })
  const providerScope = scopes.find((scope) => scope.scopeType === 'provider')
  const profile = {
    id: 'operations-production-chat', status: 'active', currency: 'USD', perRequestBudgetMicros: '1000',
    maxRequestsPerMinute: 10, maxConcurrentRequests: 2, controlScopes: scopes,
  }
  const capEvidence = createProviderCapEvidence({
    sourceKey: 'production-chat-cap', scopeKey: providerScope.scopeKey, providerId: 'hc-router', providerAccountRef: 'production', currency: 'USD',
    capAmount: '10', remainingAmount: '9', sourceType: 'fixture_config', sourceRef: 'fixture:production-chat-cap',
    verifiedAt: '2026-07-20T00:00:00.000Z', expiresAt: '2026-07-22T00:00:00.000Z',
  })
  const common = {
    profile,
    secretRef: { id: 'secret-production' },
    controls: scopes.filter((scope) => ['global', 'provider'].includes(scope.scopeType)).map((scope) => ({ ...scope, enabled: true })),
    capEvidence,
    circuit: { ...providerCircuitScope(scopes), status: 'closed' },
    health: { status: 'healthy', expiresAt: '2026-07-21T00:05:00.000Z' },
    rate: { requestCount: 0, inFlightCount: 0 },
    now,
  }
  assert.equal(evaluateProviderOperationalReadiness({ ...common, estimateMicros: '1000' }).ready, true)
  const blocked = evaluateProviderOperationalReadiness({ ...common, estimateMicros: '1001' })
  assert.equal(blocked.ready, false)
  assert.equal(blocked.reasonCode, 'provider_per_request_budget_exceeded')
})
