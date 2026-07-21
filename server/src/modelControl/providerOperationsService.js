import { HttpError } from '../common/errors/httpError.js'
import { buildProviderControlScopes, providerCircuitScope } from '../creative/providerControlContract.js'
import { evaluateProviderOperationalReadiness } from './providerOperationsRuntime.js'

const listOptions = ({ providerId, environment, workspace }) => ({
  providerId, environment, workspace, status: null, search: null, cursor: null,
  sort: 'updatedAt', order: 'desc', limit: 100,
})

const unavailable = (reasonCode) => ({
  ready: false,
  reasonCode,
  gates: [{ id: 'policy', allowed: false, reasonCode }],
  checkedAt: new Date().toISOString(),
})

const safeProfile = (profile) => profile ? {
  id: profile.id,
  status: profile.status,
  environment: profile.environment,
  providerAccountRef: profile.providerAccountRef,
  workspace: profile.workspace,
  modelFamily: profile.modelFamily,
  currency: profile.currency,
  perRequestBudgetMicros: profile.perRequestBudgetMicros,
  maxRequestsPerMinute: profile.maxRequestsPerMinute,
  maxConcurrentRequests: profile.maxConcurrentRequests,
  healthTtlSeconds: profile.healthTtlSeconds,
  version: profile.version,
} : null

export const readProviderOperationalSnapshot = async ({
  repositories,
  provider,
  deployment,
  secretRef,
  workspace = 'chat',
  modelFamily = null,
  estimateMicros = null,
  now = new Date(),
}) => {
  if (!repositories?.providerOperations?.listProfiles || !repositories?.creativeProviderControls) {
    return { profile: null, budget: null, circuit: null, health: null, rate: null, cost: null, readiness: unavailable('provider_operational_repository_missing') }
  }
  const page = await repositories.providerOperations.listProfiles(listOptions({ providerId: provider.id, environment: deployment.environment, workspace }))
  const profile = page.items.find((item) => item.modelFamily === modelFamily)
    ?? page.items.find((item) => item.modelFamily == null)
    ?? null
  if (!profile) return { profile: null, budget: null, circuit: null, health: null, rate: null, cost: null, readiness: unavailable('provider_operational_policy_missing') }
  const controlScopes = buildProviderControlScopes({ providerId: provider.key, providerAccountRef: profile.providerAccountRef, workspace, modelFamily: profile.modelFamily })
  const providerScope = controlScopes.find((scope) => scope.scopeType === 'provider')
  const circuitScope = providerCircuitScope(controlScopes)
  const [controls, capEvidence, circuit, health, rate, cost] = await Promise.all([
    Promise.all(controlScopes.map((scope) => repositories.creativeProviderControls.findControl(scope.scopeKey))),
    repositories.creativeProviderControls.findCapEvidence(providerScope.scopeKey),
    repositories.creativeProviderControls.findCircuit(circuitScope.scopeKey),
    repositories.providerOperations.findCurrentHealth(profile.id),
    repositories.providerOperations.getRateState(profile.id, now),
    repositories.providerOperations.getCostSummary({ providerKey: provider.key, workspace, currency: profile.currency }),
  ])
  const enriched = { ...profile, provider, controlScopes }
  const readiness = evaluateProviderOperationalReadiness({
    profile: enriched,
    secretRef,
    controls: controls.filter(Boolean),
    capEvidence,
    circuit,
    health,
    rate,
    estimateMicros: String(estimateMicros ?? profile.perRequestBudgetMicros),
    now,
  })
  return {
    profile: safeProfile(profile),
    budget: capEvidence ? { currency: capEvidence.currency, capMicros: capEvidence.capMicros, remainingMicros: capEvidence.remainingMicros, expiresAt: capEvidence.expiresAt } : null,
    circuit: circuit ? { id: circuit.id, status: circuit.status, version: circuit.version, openedAt: circuit.openedAt ?? null } : null,
    health: health ? { id: health.id, status: health.status, checkedAt: health.checkedAt, expiresAt: health.expiresAt } : null,
    rate,
    cost,
    readiness,
  }
}

export const acquireProviderOperationalLease = async ({ repositories, sourceKey, estimateMicros, leaseTtlSeconds = 300, ...scope }) => {
  const snapshot = await readProviderOperationalSnapshot({ repositories, estimateMicros, ...scope })
  if (!snapshot.readiness.ready || !snapshot.profile) {
    throw new HttpError(503, 'PROVIDER_OPERATIONAL_NOT_READY', 'Provider operational readiness blocked dispatch', { reasonCode: snapshot.readiness.reasonCode })
  }
  const acquired = await repositories.providerOperations.acquireLease({
    policyId: snapshot.profile.id,
    sourceKey,
    estimateMicros: String(estimateMicros),
    leaseTtlSeconds,
    now: scope.now,
  })
  return { snapshot, ...acquired }
}
