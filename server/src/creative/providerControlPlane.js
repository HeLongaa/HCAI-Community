import providerMatrix from '../../../config/v1-provider-matrix.json' with { type: 'json' }

import {
  assertProviderDispatchAllowed,
  buildProviderControlScopes,
  classifyProviderFailure,
  evaluateProviderControlSnapshot,
  providerCircuitPolicyFor,
  providerCircuitScope,
} from './providerControlContract.js'

export const createProviderControlPlane = ({ repository, matrix = providerMatrix } = {}) => {
  if (!repository) throw new Error('Provider control repository is required')

  const readSnapshot = async ({ providerId, providerAccountRef, workspace, modelFamily }) => {
    const scopes = buildProviderControlScopes({ providerId, providerAccountRef, workspace, modelFamily })
    const providerScope = scopes.find((scope) => scope.scopeType === 'provider')
    const circuitScope = providerCircuitScope(scopes)
    const [controls, capEvidence, circuit] = await Promise.all([
      Promise.all(scopes.map((scope) => repository.findControl(scope.scopeKey))),
      repository.findCapEvidence(providerScope.scopeKey),
      repository.findCircuit(circuitScope.scopeKey),
    ])
    return { scopes, controls: controls.filter(Boolean), capEvidence, circuit, circuitScope }
  }

  return {
    readSnapshot,
    assertDispatchAllowed: async ({
      providerId,
      providerAccountRef,
      workspace,
      modelFamily = null,
      estimateMicros,
      currency,
      probeToken = null,
      actor = null,
      now = new Date(),
    }) => {
      const snapshot = await readSnapshot({ providerId, providerAccountRef, workspace, modelFamily })
      let probeClaimed = false
      if (snapshot.circuit?.status === 'half_open' && probeToken) {
        const claim = await repository.claimProbe(snapshot.circuitScope.scopeKey, probeToken, actor, now)
        probeClaimed = claim?.claimed === true
        snapshot.circuit = claim?.circuit ?? snapshot.circuit
      }
      const evaluation = evaluateProviderControlSnapshot({
        ...snapshot,
        estimateMicros,
        currency,
        now,
        probeClaimed,
      })
      if (!evaluation.allowed) {
        const blockedScope = snapshot.scopes.find((scope) => scope.scopeKey === evaluation.blockedScopeKey)
        await repository.recordDispatchBlock?.({
          resourceId: snapshot.circuit?.id ?? providerId,
          providerId,
          workspace,
          modelFamily,
          reasonCode: evaluation.reasonCode,
          blockedScopeType: blockedScope?.scopeType ?? null,
        }, actor)
      }
      assertProviderDispatchAllowed(evaluation)
      return { ...snapshot, evaluation, probeClaimed }
    },
    recordResult: async ({
      sourceKey,
      providerId,
      providerAccountRef,
      workspace,
      modelFamily = null,
      error = null,
      actor = null,
      now = new Date(),
    }) => {
      const scopes = buildProviderControlScopes({ providerId, providerAccountRef, workspace, modelFamily })
      const scope = providerCircuitScope(scopes)
      const policy = providerCircuitPolicyFor({ matrix, workspace })
      return repository.recordCircuitEvent({
        sourceKey,
        scopeKey: scope.scopeKey,
        category: error ? classifyProviderFailure(error) : 'success',
        occurredAt: now instanceof Date ? now.toISOString() : now,
        policy,
      }, actor)
    },
  }
}
