import { HttpError, notFound } from '../../common/errors/httpError.js'
import { requirePermission } from '../../common/http/auth.js'
import { readJsonBody } from '../../common/http/request.js'
import { created, ok } from '../../common/http/responses.js'
import {
  assertStatusTransition,
  parseCapabilityUpsert,
  parseDeploymentCreate,
  parseModelControlListQuery,
  parseModelCreate,
  parseModelVersionCreate,
  parsePricingCreate,
  parseProviderCreate,
  parseProviderUpdate,
  parseStatusTransition,
  transitionModelControlResource,
} from '../../modelControl/modelControlRuntime.js'
import {
  assertModelRoutePolicyEditable,
  parseModelRouteListQuery,
  parseModelRoutePolicyCreate,
  parseModelRoutePolicyUpdate,
  parseModelRoutePreview,
  parseModelRouteRollback,
  parseModelRouteTargets,
} from '../../modelControl/modelRoutingRuntime.js'
import {
  parseModelPromotionListQuery,
  parseModelPromotionRequest,
  parseModelRouteDecisionListQuery,
  parseProviderSecretRefCreate,
  parseProviderSecretRefListQuery,
  resolveAndRecordModelRoute,
} from '../../modelControl/modelGovernanceRuntime.js'
import { buildProviderControlScopes, providerCircuitScope } from '../../creative/providerControlContract.js'
import {
  evaluateProviderOperationalReadiness,
  parseProviderHealthEvidenceCreate,
  parseProviderHealthEvidenceListQuery,
  parseProviderOperationalPolicyCreate,
  parseProviderOperationalPolicyListQuery,
  parseProviderOperationalPolicyTransition,
  parseProviderOperationalPolicyUpdate,
} from '../../modelControl/providerOperationsRuntime.js'
import { requestReleaseChange } from '../../releases/releaseControl.js'
import {
  parseEvaluationPolicyCreate,
  parseEvaluationPolicyListQuery,
  parseEvaluationRunCreate,
  parseEvaluationRunListQuery,
  parseEvaluationSuiteCreate,
  parseEvaluationSuiteListQuery,
} from '../../modelControl/modelEvaluationRuntime.js'
import { parseProviderLegalReviewCreate, parseProviderLegalReviewListQuery } from '../../modelControl/providerLegalRuntime.js'
import { resolveModelRuntimeReadiness } from '../../modelControl/modelRuntimeResolver.js'
import { repositories } from '../../repositories/index.js'

const permissions = Object.freeze({
  read: 'admin:model-control:read',
  manage: 'admin:model-control:manage',
  transition: 'admin:model-control:transition',
})

export const registerModelControlRoutes = (router, options = {}) => {
  const routeRepositories = options.repositories ?? repositories
  const repository = routeRepositories.modelControl
  const routingRepository = routeRepositories.modelRouting
  const governanceRepository = routeRepositories.modelGovernance
  const evaluationRepository = routeRepositories.modelEvaluation
  const providerLegalRepository = routeRepositories.providerLegal
  const providerOperationsRepository = routeRepositories.providerOperations
  const find = async (type, id, path) => {
    const resource = await repository.find(type, id)
    if (!resource) throw notFound(path)
    return resource
  }
  const audit = (actor, action, type, resource, metadata = {}) => routeRepositories.audit.recordAttempt({
    actor, action, resourceType: `model_${type}`, resourceId: resource?.id ?? null,
    metadata: { version: resource?.version ?? null, status: resource?.status ?? null, providerTrafficEnabled: false, ...metadata },
  })
  const transition = (type) => async (request, response, context) => {
    const actor = requirePermission(context, permissions.transition)
    const path = `/api/admin/model-control/${type}s/${context.params.id}/status`
    const resource = await find(type, context.params.id, path)
    const updated = await transitionModelControlResource({ type, resource, payload: (await readJsonBody(request)) ?? {}, actor, repository })
    await audit(actor, 'admin.model_control.status_transitioned', type, updated, { previousStatus: resource.status })
    ok(response, updated)
  }
  const findRoutePolicy = async (id, path) => {
    const resource = await routingRepository.find(id)
    if (!resource) throw notFound(path)
    return resource
  }
  const findProviderOperationsProfile = async (id, path = `/api/admin/model-control/provider-operations/${id}`) => {
    const profile = await providerOperationsRepository.findProfile(id)
    if (!profile) throw notFound(path)
    return profile
  }
  const operationalSnapshot = async (profile, { ignorePolicyStatus = false } = {}) => {
    const provider = profile.provider ?? await repository.find('provider', profile.providerId)
    if (!provider) throw new HttpError(422, 'REFERENCE_NOT_FOUND', 'Provider operations profile references a missing Provider')
    const controlScopes = buildProviderControlScopes({ providerId: provider.key, providerAccountRef: profile.providerAccountRef, workspace: profile.workspace, modelFamily: profile.modelFamily })
    const providerScope = controlScopes.find((scope) => scope.scopeType === 'provider')
    const circuitScope = providerCircuitScope(controlScopes)
    const [controls, capEvidence, circuit, secretPage, health, rate, cost] = await Promise.all([
      Promise.all(controlScopes.map((scope) => routeRepositories.creativeProviderControls.findControl(scope.scopeKey))),
      routeRepositories.creativeProviderControls.findCapEvidence(providerScope.scopeKey),
      routeRepositories.creativeProviderControls.findCircuit(circuitScope.scopeKey),
      governanceRepository.listSecretRefs({ providerId: profile.providerId, environment: profile.environment, purpose: profile.secretPurpose, search: null, cursor: null, sort: 'createdAt', order: 'desc', limit: 100 }),
      providerOperationsRepository.findCurrentHealth(profile.id),
      providerOperationsRepository.getRateState(profile.id),
      providerOperationsRepository.getCostSummary({ providerKey: provider.key, workspace: profile.workspace, currency: profile.currency }),
    ])
    const secretRef = secretPage.items.find((item) => !secretPage.items.some((candidate) => candidate.rotatedFromId === item.id)) ?? null
    const enriched = { ...profile, provider, controlScopes }
    return { profile: enriched, secretRef, controls: controls.filter(Boolean), budget: capEvidence ? { currency: capEvidence.currency, capMicros: capEvidence.capMicros, remainingMicros: capEvidence.remainingMicros, expiresAt: capEvidence.expiresAt } : null, circuit, health, rate, cost, readiness: evaluateProviderOperationalReadiness({ profile: enriched, secretRef, controls: controls.filter(Boolean), capEvidence, circuit, health, rate, estimateMicros: profile.perRequestBudgetMicros, ignorePolicyStatus }) }
  }
  const evaluateCandidate = async (target, policy) => {
    const model = target.deployment?.modelVersion?.model
    const provider = model?.provider
    if (!provider) return { allowed: false, reasonCode: 'provider_metadata_missing' }
    const profilePage = await providerOperationsRepository.listProfiles({
      providerId: provider.id, environment: policy.environment, workspace: policy.modality, status: null,
      search: null, cursor: null, sort: 'updatedAt', order: 'desc', limit: 100,
    })
    const modelFamily = model.family ?? model.key
    const profile = profilePage.items.find((item) => item.modelFamily === modelFamily)
      ?? profilePage.items.find((item) => item.modelFamily == null)
    if (!profile) return { allowed: false, reasonCode: 'provider_operational_policy_missing' }
    const snapshot = await operationalSnapshot(profile)
    return { allowed: snapshot.readiness.ready, reasonCode: snapshot.readiness.reasonCode }
  }

  router.add('GET', '/api/admin/model-control/provider-legal-reviews', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:provider-legal:read')
    const page = await providerLegalRepository.listReviews(parseProviderLegalReviewListQuery(context.query))
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.provider_legal.reviews_queried', resourceType: 'provider_legal_review', resourceId: null, metadata: { resultCount: page.items.length, limit: page.limit } })
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('POST', '/api/admin/model-control/provider-legal-reviews', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:provider-legal:manage')
    const review = await providerLegalRepository.createReview(parseProviderLegalReviewCreate((await readJsonBody(request)) ?? {}, actor))
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.provider_legal.review_recorded', resourceType: 'provider_legal_review', resourceId: review.id, metadata: { scopeKey: review.scopeKey, version: review.version, decision: review.decision, providerId: review.providerId, modelVersionId: review.modelVersionId, environment: review.environment, evidenceHash: review.evidenceHash, expiresAt: review.expiresAt } })
    created(response, review)
  })

  router.add('GET', '/api/admin/model-control/provider-legal-reviews/:id', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:provider-legal:read')
    const review = await providerLegalRepository.findReview(context.params.id)
    if (!review) throw notFound(`/api/admin/model-control/provider-legal-reviews/${context.params.id}`)
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.provider_legal.review_read', resourceType: 'provider_legal_review', resourceId: review.id, metadata: { version: review.version, decision: review.decision, evidenceHash: review.evidenceHash } })
    ok(response, review)
  })

  router.add('GET', '/api/admin/model-control/provider-legal-summary', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:provider-legal:read')
    const exported = await providerLegalRepository.exportAll()
    const latestByScope = new Map()
    for (const item of exported.reviews) if (!latestByScope.has(item.scopeKey) || latestByScope.get(item.scopeKey).version < item.version) latestByScope.set(item.scopeKey, item)
    const current = [...latestByScope.values()]
    const approvedCount = current.filter((item) => item.decision === 'approved' && Date.parse(item.validFrom) <= Date.now() && Date.parse(item.expiresAt) > Date.now()).length
    const blockedCount = current.length - approvedCount
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.provider_legal.summary_read', resourceType: 'provider_legal_review', resourceId: null, metadata: { reviewCount: exported.reviews.length, scopeCount: current.length, approvedCount, blockedCount } })
    ok(response, { reviewCount: exported.reviews.length, scopeCount: current.length, approvedCount, blockedCount })
  })

  router.add('GET', '/api/admin/model-control/provider-legal-export', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:provider-legal:read')
    const exported = await providerLegalRepository.exportAll()
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.provider_legal.exported', resourceType: 'provider_legal_review', resourceId: null, metadata: { reviewCount: exported.reviews.length } })
    ok(response, exported)
  })

  router.add('GET', '/api/admin/model-control/evaluation-suites', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:model-evaluations:read')
    const page = await evaluationRepository.listSuites(parseEvaluationSuiteListQuery(context.query))
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_evaluation.suites_queried', resourceType: 'ai_evaluation_suite', resourceId: null, metadata: { resultCount: page.items.length, limit: page.limit } })
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('POST', '/api/admin/model-control/evaluation-suites', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:model-evaluations:manage')
    const suite = await evaluationRepository.createSuite(parseEvaluationSuiteCreate((await readJsonBody(request)) ?? {}, actor))
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_evaluation.suite_created', resourceType: 'ai_evaluation_suite', resourceId: suite.id, metadata: { suiteKey: suite.suiteKey, version: suite.version, modality: suite.modality, caseCount: suite.cases.length, contentHash: suite.contentHash } })
    created(response, suite)
  })

  router.add('GET', '/api/admin/model-control/evaluation-suites/:id', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:model-evaluations:read')
    const suite = await evaluationRepository.findSuite(context.params.id)
    if (!suite) throw notFound(`/api/admin/model-control/evaluation-suites/${context.params.id}`)
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_evaluation.suite_read', resourceType: 'ai_evaluation_suite', resourceId: suite.id, metadata: { version: suite.version, caseCount: suite.cases.length } })
    ok(response, suite)
  })

  router.add('GET', '/api/admin/model-control/evaluation-policies', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:model-evaluations:read')
    const page = await evaluationRepository.listPolicies(parseEvaluationPolicyListQuery(context.query))
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_evaluation.policies_queried', resourceType: 'ai_evaluation_policy', resourceId: null, metadata: { resultCount: page.items.length, limit: page.limit } })
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('POST', '/api/admin/model-control/evaluation-policies', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:model-evaluations:manage')
    const policy = await evaluationRepository.createPolicy(parseEvaluationPolicyCreate((await readJsonBody(request)) ?? {}, actor))
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_evaluation.policy_created', resourceType: 'ai_evaluation_policy', resourceId: policy.id, metadata: { policyKey: policy.policyKey, version: policy.version, environment: policy.environment, policyHash: policy.policyHash } })
    created(response, policy)
  })

  router.add('GET', '/api/admin/model-control/evaluation-policies/:id', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:model-evaluations:read')
    const policy = await evaluationRepository.findPolicy(context.params.id)
    if (!policy) throw notFound(`/api/admin/model-control/evaluation-policies/${context.params.id}`)
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_evaluation.policy_read', resourceType: 'ai_evaluation_policy', resourceId: policy.id, metadata: { version: policy.version, environment: policy.environment } })
    ok(response, policy)
  })

  router.add('GET', '/api/admin/model-control/evaluation-runs', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:model-evaluations:read')
    const page = await evaluationRepository.listRuns(parseEvaluationRunListQuery(context.query))
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_evaluation.runs_queried', resourceType: 'ai_evaluation_run', resourceId: null, metadata: { resultCount: page.items.length, limit: page.limit } })
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('POST', '/api/admin/model-control/evaluation-runs', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:model-evaluations:execute')
    const run = await evaluationRepository.createRun(parseEvaluationRunCreate((await readJsonBody(request)) ?? {}, actor))
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_evaluation.run_recorded', resourceType: 'ai_evaluation_run', resourceId: run.id, metadata: { status: run.status, suiteId: run.suiteId, policyId: run.policyId, modelVersionId: run.modelVersionId, reportHash: run.reportHash, qualityScoreBps: run.qualityScoreBps, safetyScoreBps: run.safetyScoreBps } })
    created(response, run)
  })

  router.add('GET', '/api/admin/model-control/evaluation-runs/:id', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:model-evaluations:read')
    const run = await evaluationRepository.findRun(context.params.id)
    if (!run) throw notFound(`/api/admin/model-control/evaluation-runs/${context.params.id}`)
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_evaluation.run_read', resourceType: 'ai_evaluation_run', resourceId: run.id, metadata: { status: run.status, reportHash: run.reportHash } })
    ok(response, run)
  })

  router.add('GET', '/api/admin/model-control/evaluation-summary', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:model-evaluations:read')
    const exported = await evaluationRepository.exportAll()
    const statusCounts = exported.runs.reduce((counts, item) => ({ ...counts, [item.status]: (counts[item.status] ?? 0) + 1 }), {})
    const currentPassingCount = exported.runs.filter((item) => item.status === 'passed' && item.baselineRunId && Date.parse(item.expiresAt) > Date.now()).length
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_evaluation.summary_read', resourceType: 'ai_evaluation', resourceId: null, metadata: { suiteCount: exported.suites.length, policyCount: exported.policies.length, runCount: exported.runs.length, currentPassingCount } })
    ok(response, { suiteCount: exported.suites.length, policyCount: exported.policies.length, runCount: exported.runs.length, currentPassingCount, statusCounts })
  })

  router.add('GET', '/api/admin/model-control/evaluation-export', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:model-evaluations:read')
    const exported = await evaluationRepository.exportAll()
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_evaluation.exported', resourceType: 'ai_evaluation', resourceId: null, metadata: { suiteCount: exported.suites.length, policyCount: exported.policies.length, runCount: exported.runs.length } })
    ok(response, exported)
  })

  router.add('GET', '/api/admin/model-control/routing-summary', async (_request, response, context) => {
    const actor = requirePermission(context, permissions.read)
    const exported = await routingRepository.exportAll()
    const statusCounts = exported.policies.reduce((summary, policy) => ({ ...summary, [policy.status]: (summary[policy.status] ?? 0) + 1 }), {})
    const targetCounts = exported.policies.flatMap((policy) => policy.targets ?? []).reduce((summary, target) => ({ ...summary, [target.role]: (summary[target.role] ?? 0) + 1 }), {})
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_route.summary_read', resourceType: 'model_route_policy', resourceId: null, metadata: { policyCount: exported.policies.length, providerTrafficEnabled: exported.providerTrafficEnabled } })
    ok(response, { policyCount: exported.policies.length, revisionCount: exported.revisions.length, statusCounts, targetCounts, providerTrafficEnabled: exported.providerTrafficEnabled, automaticFallbackDefault: 'fail_closed' })
  })

  router.add('GET', '/api/admin/model-control/provider-operations', async (_request, response, context) => {
    const actor = requirePermission(context, permissions.read)
    const page = await providerOperationsRepository.listProfiles(parseProviderOperationalPolicyListQuery(context.query))
    const items = await Promise.all(page.items.map(async (profile) => { const snapshot = await operationalSnapshot(profile); return { ...profile, readiness: snapshot.readiness, budget: snapshot.budget, health: snapshot.health, rate: snapshot.rate, cost: snapshot.cost } }))
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_control.provider_operations_queried', resourceType: 'provider_operational_policy', resourceId: null, metadata: { resultCount: items.length, limit: page.limit } })
    ok(response, items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('POST', '/api/admin/model-control/provider-operations', async (request, response, context) => {
    const actor = requirePermission(context, permissions.manage)
    const profile = await providerOperationsRepository.createProfile(parseProviderOperationalPolicyCreate((await readJsonBody(request)) ?? {}, actor))
    await audit(actor, 'admin.model_control.provider_operations_created', 'provider_operational_policy', profile, { environment: profile.environment, workspace: profile.workspace })
    created(response, { ...profile, readiness: (await operationalSnapshot(profile)).readiness })
  })

  router.add('GET', '/api/admin/model-control/provider-operations/:id', async (_request, response, context) => {
    const actor = requirePermission(context, permissions.read)
    const profile = await findProviderOperationsProfile(context.params.id)
    const snapshot = await operationalSnapshot(profile)
    await audit(actor, 'admin.model_control.provider_operations_read', 'provider_operational_policy', profile)
    ok(response, snapshot)
  })

  router.add('PATCH', '/api/admin/model-control/provider-operations/:id', async (request, response, context) => {
    const actor = requirePermission(context, permissions.manage)
    const current = await findProviderOperationsProfile(context.params.id)
    if (current.status === 'active') throw new HttpError(409, 'IMMUTABLE_ACTIVE_POLICY', 'disable Provider operations policy before editing it')
    const input = parseProviderOperationalPolicyUpdate((await readJsonBody(request)) ?? {}, actor)
    const profile = await providerOperationsRepository.updateProfile(current.id, input.expectedVersion, input.data)
    if (!profile) throw new HttpError(409, 'STATE_CONFLICT', 'Provider operations policy changed before update')
    await audit(actor, 'admin.model_control.provider_operations_updated', 'provider_operational_policy', profile, { previousVersion: current.version })
    ok(response, { ...profile, readiness: (await operationalSnapshot(profile)).readiness })
  })

  router.add('POST', '/api/admin/model-control/provider-operations/:id/status', async (request, response, context) => {
    const actor = requirePermission(context, permissions.transition)
    const current = await findProviderOperationsProfile(context.params.id)
    const input = parseProviderOperationalPolicyTransition((await readJsonBody(request)) ?? {}, actor)
    if (current.version !== input.expectedVersion) throw new HttpError(409, 'STATE_CONFLICT', 'Provider operations policy changed before transition')
    if (current.status === input.status) throw new HttpError(409, 'INVALID_STATE_TRANSITION', `Provider operations policy is already ${input.status}`)
    if (!(['draft', 'disabled'].includes(current.status) && input.status === 'active') && !(current.status === 'active' && input.status === 'disabled') && !(current.status === 'draft' && input.status === 'disabled')) {
      throw new HttpError(409, 'INVALID_STATE_TRANSITION', `cannot transition Provider operations policy from ${current.status} to ${input.status}`)
    }
    if (input.status === 'active') {
      const snapshot = await operationalSnapshot(current, { ignorePolicyStatus: true })
      if (!snapshot.readiness.ready) throw new HttpError(409, 'PROVIDER_OPERATIONAL_NOT_READY', 'Provider operations policy cannot activate until all external gates pass', { reasonCode: snapshot.readiness.reasonCode, gates: snapshot.readiness.gates })
    }
    const profile = await providerOperationsRepository.transitionProfile(current.id, input)
    if (!profile) throw new HttpError(409, 'STATE_CONFLICT', 'Provider operations policy changed before transition')
    await audit(actor, 'admin.model_control.provider_operations_transitioned', 'provider_operational_policy', profile, { previousStatus: current.status, reasonCode: input.reasonCode })
    ok(response, { ...profile, readiness: (await operationalSnapshot(profile)).readiness })
  })

  router.add('GET', '/api/admin/model-control/provider-operations/:id/health', async (_request, response, context) => {
    const actor = requirePermission(context, permissions.read)
    const profile = await findProviderOperationsProfile(context.params.id)
    const page = await providerOperationsRepository.listHealth(profile.id, parseProviderHealthEvidenceListQuery(context.query))
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_control.provider_health_queried', resourceType: 'provider_health_evidence', resourceId: profile.id, metadata: { resultCount: page.items.length, limit: page.limit } })
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('POST', '/api/admin/model-control/provider-operations/:id/health', async (request, response, context) => {
    const actor = requirePermission(context, permissions.manage)
    const profile = await findProviderOperationsProfile(context.params.id)
    const evidence = await providerOperationsRepository.recordHealth(parseProviderHealthEvidenceCreate(profile, (await readJsonBody(request)) ?? {}, actor))
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_control.provider_health_recorded', resourceType: 'provider_health_evidence', resourceId: evidence.id, metadata: { policyId: profile.id, status: evidence.status, sourceType: evidence.sourceType, evidenceHash: evidence.evidenceHash } })
    created(response, evidence)
  })

  router.add('GET', '/api/admin/model-control/provider-operations-summary', async (_request, response, context) => {
    const actor = requirePermission(context, permissions.read)
    const exported = await providerOperationsRepository.exportAll()
    const readiness = await Promise.all(exported.profiles.map((profile) => operationalSnapshot(profile)))
    const statusCounts = exported.profiles.reduce((counts, item) => ({ ...counts, [item.status]: (counts[item.status] ?? 0) + 1 }), {})
    const healthCounts = exported.healthEvidence.reduce((counts, item) => ({ ...counts, [item.status]: (counts[item.status] ?? 0) + 1 }), {})
    const readyCount = readiness.filter((item) => item.readiness.ready).length
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_control.provider_operations_summary_read', resourceType: 'provider_operations', resourceId: null, metadata: { profileCount: exported.profiles.length, readyCount } })
    ok(response, { profileCount: exported.profiles.length, healthEvidenceCount: exported.healthEvidence.length, activeLeaseCount: exported.leases.filter((item) => item.status === 'active' && Date.parse(item.leaseExpiresAt) > Date.now()).length, readyCount, blockedCount: exported.profiles.length - readyCount, totalActualMicros: readiness.reduce((total, item) => total + BigInt(item.cost.actualMicros), 0n).toString(), statusCounts, healthCounts })
  })

  router.add('GET', '/api/admin/model-control/provider-operations-export', async (_request, response, context) => {
    const actor = requirePermission(context, permissions.read)
    const exported = await providerOperationsRepository.exportAll()
    const operations = await Promise.all(exported.profiles.map(async (profile) => {
      const snapshot = await operationalSnapshot(profile)
      return { profileId: profile.id, readiness: snapshot.readiness, budget: snapshot.budget, health: snapshot.health, rate: snapshot.rate, cost: snapshot.cost }
    }))
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_control.provider_operations_exported', resourceType: 'provider_operations', resourceId: null, metadata: { profileCount: exported.profiles.length, healthEvidenceCount: exported.healthEvidence.length } })
    ok(response, { ...exported, operations })
  })

  router.add('GET', '/api/admin/model-control/routing-export', async (_request, response, context) => {
    const actor = requirePermission(context, permissions.read)
    const exported = await routingRepository.exportAll()
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_route.exported', resourceType: 'model_route_policy', resourceId: null, metadata: { policyCount: exported.policies.length, revisionCount: exported.revisions.length, providerTrafficEnabled: exported.providerTrafficEnabled } })
    ok(response, exported)
  })

  router.add('GET', '/api/admin/model-control/routing-policies', async (_request, response, context) => {
    const actor = requirePermission(context, permissions.read)
    const page = await routingRepository.list(parseModelRouteListQuery(context.query))
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_route.policies_queried', resourceType: 'model_route_policy', resourceId: null, metadata: { resultCount: page.items.length, limit: page.limit } })
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('POST', '/api/admin/model-control/routing-policies', async (request, response, context) => {
    const actor = requirePermission(context, permissions.manage)
    const policy = await routingRepository.create(parseModelRoutePolicyCreate((await readJsonBody(request)) ?? {}, actor))
    await audit(actor, 'admin.model_route.policy_created', 'route_policy', policy, { modality: policy.modality, environment: policy.environment })
    created(response, policy)
  })

  router.add('GET', '/api/admin/model-control/routing-policies/:id', async (_request, response, context) => {
    const actor = requirePermission(context, permissions.read)
    const policy = await findRoutePolicy(context.params.id, `/api/admin/model-control/routing-policies/${context.params.id}`)
    await audit(actor, 'admin.model_route.policy_read', 'route_policy', policy)
    ok(response, policy)
  })

  router.add('PATCH', '/api/admin/model-control/routing-policies/:id', async (request, response, context) => {
    const actor = requirePermission(context, permissions.manage)
    const current = await findRoutePolicy(context.params.id, `/api/admin/model-control/routing-policies/${context.params.id}`)
    const input = parseModelRoutePolicyUpdate((await readJsonBody(request)) ?? {}, actor)
    assertModelRoutePolicyEditable(current, input.expectedVersion)
    const policy = await routingRepository.update(current.id, input.expectedVersion, input.data)
    if (!policy) throw new HttpError(409, 'STATE_CONFLICT', 'model route policy changed before update')
    await audit(actor, 'admin.model_route.policy_updated', 'route_policy', policy)
    ok(response, policy)
  })

  router.add('PUT', '/api/admin/model-control/routing-policies/:id/targets', async (request, response, context) => {
    const actor = requirePermission(context, permissions.manage)
    const current = await findRoutePolicy(context.params.id, `/api/admin/model-control/routing-policies/${context.params.id}/targets`)
    const input = parseModelRouteTargets(current.id, (await readJsonBody(request)) ?? {}, actor)
    assertModelRoutePolicyEditable(current, input.expectedVersion)
    const policy = await routingRepository.replaceTargets(current.id, input)
    if (!policy) throw new HttpError(409, 'STATE_CONFLICT', 'model route policy changed before targets were replaced')
    await audit(actor, 'admin.model_route.targets_replaced', 'route_policy', policy, { targetCount: policy.targets.length })
    ok(response, policy)
  })

  router.add('GET', '/api/admin/model-control/routing-policies/:id/revisions', async (_request, response, context) => {
    requirePermission(context, permissions.read)
    await findRoutePolicy(context.params.id, `/api/admin/model-control/routing-policies/${context.params.id}/revisions`)
    ok(response, await routingRepository.listRevisions(context.params.id))
  })

  router.add('POST', '/api/admin/model-control/routing-policies/:id/rollback', async (request, response, context) => {
    const actor = requirePermission(context, permissions.transition)
    const current = await findRoutePolicy(context.params.id, `/api/admin/model-control/routing-policies/${context.params.id}/rollback`)
    const input = parseModelRouteRollback((await readJsonBody(request)) ?? {}, actor)
    assertModelRoutePolicyEditable(current, input.expectedVersion)
    const policy = await routingRepository.rollback(current.id, input)
    if (!policy) throw new HttpError(409, 'STATE_CONFLICT', 'model route policy changed before rollback')
    await audit(actor, 'admin.model_route.policy_rolled_back', 'route_policy', policy, { sourceRevisionNumber: input.revisionNumber })
    ok(response, policy)
  })

  router.add('POST', '/api/admin/model-control/routing-policies/:id/status', async (request, response, context) => {
    const actor = requirePermission(context, permissions.transition)
    const current = await findRoutePolicy(context.params.id, `/api/admin/model-control/routing-policies/${context.params.id}/status`)
    const transitionInput = assertStatusTransition(current, parseStatusTransition((await readJsonBody(request)) ?? {}, actor))
    const policy = await routingRepository.transition(current.id, transitionInput)
    if (!policy) throw new HttpError(409, 'STATE_CONFLICT', 'model route policy changed before transition')
    await audit(actor, 'admin.model_route.status_transitioned', 'route_policy', policy, { previousStatus: current.status })
    ok(response, policy)
  })

  router.add('POST', '/api/admin/model-control/route-preview', async (request, response, context) => {
    const actor = requirePermission(context, permissions.read)
    const input = parseModelRoutePreview((await readJsonBody(request)) ?? {})
    const result = await resolveAndRecordModelRoute({ source: 'preview', context: input, actor, routingRepository, governanceRepository, evaluateCandidate })
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_route.previewed', resourceType: 'model_route_policy', resourceId: result.policy?.id ?? null, metadata: { modality: input.modality, operation: input.operation, environment: input.environment, status: result.status, reasonCode: result.reasonCode, attemptedCount: result.attempts.length, providerTrafficEnabled: result.providerTrafficEnabled } })
    ok(response, result)
  })

  router.add('GET', '/api/admin/model-control/route-decisions', async (_request, response, context) => {
    const actor = requirePermission(context, permissions.read)
    const page = await governanceRepository.listDecisions(parseModelRouteDecisionListQuery(context.query))
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_route.decisions_queried', resourceType: 'model_route_decision', resourceId: null, metadata: { resultCount: page.items.length, limit: page.limit } })
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('GET', '/api/admin/model-control/route-decisions/:id', async (_request, response, context) => {
    const actor = requirePermission(context, permissions.read)
    const decision = await governanceRepository.findDecision(context.params.id)
    if (!decision) throw notFound(`/api/admin/model-control/route-decisions/${context.params.id}`)
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_route.decision_read', resourceType: 'model_route_decision', resourceId: decision.id, metadata: { status: decision.status, reasonCode: decision.reasonCode } })
    ok(response, decision)
  })

  router.add('GET', '/api/admin/model-control/secret-refs', async (_request, response, context) => {
    const actor = requirePermission(context, permissions.read)
    const page = await governanceRepository.listSecretRefs(parseProviderSecretRefListQuery(context.query))
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_control.secret_refs_queried', resourceType: 'provider_secret_ref', resourceId: null, metadata: { resultCount: page.items.length, limit: page.limit } })
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('POST', '/api/admin/model-control/secret-refs', async (request, response, context) => {
    const actor = requirePermission(context, permissions.manage)
    const secretRef = await governanceRepository.createSecretRef(parseProviderSecretRefCreate((await readJsonBody(request)) ?? {}, actor))
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_control.secret_ref_created', resourceType: 'provider_secret_ref', resourceId: secretRef.id, metadata: { providerId: secretRef.providerId, environment: secretRef.environment, purpose: secretRef.purpose, externalVersion: secretRef.externalVersion } })
    created(response, secretRef)
  })

  router.add('GET', '/api/admin/model-control/secret-refs/:id', async (_request, response, context) => {
    const actor = requirePermission(context, permissions.read)
    const secretRef = await governanceRepository.findSecretRef(context.params.id)
    if (!secretRef) throw notFound(`/api/admin/model-control/secret-refs/${context.params.id}`)
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_control.secret_ref_read', resourceType: 'provider_secret_ref', resourceId: secretRef.id, metadata: { providerId: secretRef.providerId, environment: secretRef.environment, purpose: secretRef.purpose } })
    ok(response, secretRef)
  })

  router.add('GET', '/api/admin/model-control/promotions', async (_request, response, context) => {
    const actor = requirePermission(context, permissions.read)
    const page = await governanceRepository.listPromotions(parseModelPromotionListQuery(context.query))
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_control.promotions_queried', resourceType: 'model_promotion', resourceId: null, metadata: { resultCount: page.items.length, limit: page.limit } })
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('GET', '/api/admin/model-control/promotions/:id', async (_request, response, context) => {
    const actor = requirePermission(context, permissions.read)
    const promotion = await governanceRepository.findPromotion(context.params.id)
    if (!promotion) throw notFound(`/api/admin/model-control/promotions/${context.params.id}`)
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_control.promotion_read', resourceType: 'model_promotion', resourceId: promotion.id, metadata: { releaseChangeId: promotion.releaseChangeId, status: promotion.releaseChange?.status } })
    ok(response, promotion)
  })

  router.add('POST', '/api/admin/model-control/promotions', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:releases:manage')
    const input = parseModelPromotionRequest((await readJsonBody(request)) ?? {}, actor)
    await governanceRepository.validatePromotion(input.promotion, input.release)
    const release = await requestReleaseChange({ payload: { ...input.release, modelPromotion: input.promotion }, actor, repository: routeRepositories.releaseChanges })
    const promotion = await governanceRepository.findPromotionByReleaseChange(release.id)
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_control.promotion_requested', resourceType: 'model_promotion', resourceId: promotion?.id ?? input.promotion.id, metadata: { releaseChangeId: release.id, modelDeploymentId: input.promotion.modelDeploymentId, routePolicyId: input.promotion.routePolicyId } })
    created(response, promotion ?? { ...input.promotion, releaseChangeId: release.id, releaseChange: release })
  })

  router.add('GET', '/api/admin/model-control/governance-export', async (_request, response, context) => {
    const actor = requirePermission(context, permissions.read)
    const exported = await governanceRepository.exportAll()
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_control.governance_exported', resourceType: 'model_governance', resourceId: null, metadata: { decisionCount: exported.decisions.length, secretRefCount: exported.secretRefs.length, promotionCount: exported.promotions.length } })
    ok(response, exported)
  })

  router.add('GET', '/api/admin/model-control/governance-summary', async (_request, response, context) => {
    const actor = requirePermission(context, permissions.read)
    const exported = await governanceRepository.exportAll()
    const decisionStatusCounts = exported.decisions.reduce((counts, item) => ({ ...counts, [item.status]: (counts[item.status] ?? 0) + 1 }), {})
    const decisionSourceCounts = exported.decisions.reduce((counts, item) => ({ ...counts, [item.source]: (counts[item.source] ?? 0) + 1 }), {})
    const promotionStatusCounts = exported.promotions.reduce((counts, item) => ({ ...counts, [item.releaseChange?.status ?? 'unknown']: (counts[item.releaseChange?.status ?? 'unknown'] ?? 0) + 1 }), {})
    const expiresBefore = Date.now() + 30 * 86_400_000
    const expiringSecretRefCount = exported.secretRefs.filter((item) => item.expiresAt && Date.parse(item.expiresAt) <= expiresBefore).length
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_control.governance_summary_read', resourceType: 'model_governance', resourceId: null, metadata: { decisionCount: exported.decisions.length, secretRefCount: exported.secretRefs.length, promotionCount: exported.promotions.length, expiringSecretRefCount } })
    ok(response, { decisionCount: exported.decisions.length, secretRefCount: exported.secretRefs.length, promotionCount: exported.promotions.length, decisionStatusCounts, decisionSourceCounts, promotionStatusCounts, expiringSecretRefCount })
  })

  router.add('GET', '/api/admin/model-control/summary', async (_request, response, context) => {
    const actor = requirePermission(context, permissions.read)
    const catalog = await repository.exportCatalog()
    const counts = Object.fromEntries(['providers', 'models', 'versions', 'capabilities', 'deployments', 'pricingVersions'].map((key) => [key, catalog[key].length]))
    const statusCounts = catalog.providers.concat(catalog.models, catalog.versions, catalog.deployments, catalog.pricingVersions).reduce((summary, item) => ({ ...summary, [item.status]: (summary[item.status] ?? 0) + 1 }), {})
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_control.summary_read', resourceType: 'model_control_catalog', resourceId: null, metadata: { counts, providerTrafficEnabled: catalog.providerTrafficEnabled } })
    ok(response, { counts, statusCounts, providerTrafficEnabled: catalog.providerTrafficEnabled, realProviderApprovalRequired: true })
  })

  router.add('GET', '/api/admin/model-control/chat-production-readiness', async (_request, response, context) => {
    const actor = requirePermission(context, permissions.read)
    const readiness = await resolveModelRuntimeReadiness({
      repositories: routeRepositories,
      modality: 'chat',
      operation: 'generate',
      environment: 'production',
      region: context.query.region || null,
      role: 'member',
    })
    await routeRepositories.audit.recordAttempt({
      actor,
      action: 'admin.model_control.chat_production_readiness_read',
      resourceType: 'model_runtime_readiness',
      resourceId: readiness.checks?.deployment?.id ?? null,
      metadata: { decision: readiness.decision, reasonCode: readiness.reasonCode, blockerCodes: readiness.blockerCodes },
    })
    ok(response, readiness)
  })

  router.add('GET', '/api/admin/model-control/export', async (_request, response, context) => {
    const actor = requirePermission(context, permissions.read)
    const catalog = await repository.exportCatalog()
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_control.exported', resourceType: 'model_control_catalog', resourceId: null, metadata: { schemaVersion: catalog.schemaVersion, providerCount: catalog.providers.length, providerTrafficEnabled: catalog.providerTrafficEnabled } })
    ok(response, catalog)
  })

  router.add('GET', '/api/admin/model-control/providers', async (_request, response, context) => {
    const actor = requirePermission(context, permissions.read)
    const page = await repository.listProviders(parseModelControlListQuery(context.query))
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_control.providers_queried', resourceType: 'model_provider', resourceId: null, metadata: { resultCount: page.items.length, limit: page.limit } })
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })
  router.add('POST', '/api/admin/model-control/providers', async (request, response, context) => {
    const actor = requirePermission(context, permissions.manage)
    const provider = await repository.createProvider(parseProviderCreate((await readJsonBody(request)) ?? {}, actor))
    await audit(actor, 'admin.model_control.provider_created', 'provider', provider)
    created(response, provider)
  })
  router.add('GET', '/api/admin/model-control/providers/:id', async (_request, response, context) => {
    const actor = requirePermission(context, permissions.read)
    const provider = await find('provider', context.params.id, `/api/admin/model-control/providers/${context.params.id}`)
    await audit(actor, 'admin.model_control.provider_read', 'provider', provider)
    ok(response, provider)
  })
  router.add('PATCH', '/api/admin/model-control/providers/:id', async (request, response, context) => {
    const actor = requirePermission(context, permissions.manage)
    const current = await find('provider', context.params.id, `/api/admin/model-control/providers/${context.params.id}`)
    if (current.status === 'archived') throw new HttpError(409, 'IMMUTABLE_ARCHIVE', 'archived providers cannot be edited')
    const update = parseProviderUpdate((await readJsonBody(request)) ?? {}, actor)
    const provider = await repository.updateProvider(current.id, update.expectedVersion, update.data)
    if (!provider) throw new HttpError(409, 'STATE_CONFLICT', 'provider changed before update')
    await audit(actor, 'admin.model_control.provider_updated', 'provider', provider)
    ok(response, provider)
  })
  router.add('POST', '/api/admin/model-control/providers/:id/status', transition('provider'))

  router.add('GET', '/api/admin/model-control/models', async (_request, response, context) => {
    const actor = requirePermission(context, permissions.read)
    const page = await repository.listModels(parseModelControlListQuery(context.query))
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_control.models_queried', resourceType: 'model', resourceId: null, metadata: { resultCount: page.items.length, limit: page.limit } })
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })
  router.add('POST', '/api/admin/model-control/models', async (request, response, context) => {
    const actor = requirePermission(context, permissions.manage)
    const model = await repository.createModel(parseModelCreate((await readJsonBody(request)) ?? {}, actor))
    await audit(actor, 'admin.model_control.model_created', 'model', model)
    created(response, model)
  })
  router.add('GET', '/api/admin/model-control/models/:id', async (_request, response, context) => {
    const actor = requirePermission(context, permissions.read)
    const model = await find('model', context.params.id, `/api/admin/model-control/models/${context.params.id}`)
    await audit(actor, 'admin.model_control.model_read', 'model', model)
    ok(response, model)
  })
  router.add('POST', '/api/admin/model-control/models/:id/status', transition('model'))

  router.add('GET', '/api/admin/model-control/versions', async (_request, response, context) => {
    const actor = requirePermission(context, permissions.read)
    const page = await repository.listVersions(parseModelControlListQuery(context.query))
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_control.versions_queried', resourceType: 'model_version', resourceId: null, metadata: { resultCount: page.items.length, limit: page.limit } })
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })
  router.add('POST', '/api/admin/model-control/versions', async (request, response, context) => {
    const actor = requirePermission(context, permissions.manage)
    const version = await repository.createVersion(parseModelVersionCreate((await readJsonBody(request)) ?? {}, actor))
    await audit(actor, 'admin.model_control.version_created', 'version', version)
    created(response, version)
  })
  router.add('GET', '/api/admin/model-control/versions/:id', async (_request, response, context) => {
    const actor = requirePermission(context, permissions.read)
    const version = await find('version', context.params.id, `/api/admin/model-control/versions/${context.params.id}`)
    await audit(actor, 'admin.model_control.version_read', 'version', version)
    ok(response, version)
  })
  router.add('POST', '/api/admin/model-control/versions/:id/status', transition('version'))
  router.add('PUT', '/api/admin/model-control/versions/:id/capabilities', async (request, response, context) => {
    const actor = requirePermission(context, permissions.manage)
    await find('version', context.params.id, `/api/admin/model-control/versions/${context.params.id}/capabilities`)
    const capability = await repository.upsertCapability(parseCapabilityUpsert(context.params.id, (await readJsonBody(request)) ?? {}))
    await audit(actor, 'admin.model_control.capability_upserted', 'capability', capability, { modality: capability.modality })
    ok(response, capability)
  })

  router.add('POST', '/api/admin/model-control/deployments', async (request, response, context) => {
    const actor = requirePermission(context, permissions.manage)
    const deployment = await repository.createDeployment(parseDeploymentCreate((await readJsonBody(request)) ?? {}, actor))
    await audit(actor, 'admin.model_control.deployment_created', 'deployment', deployment, { environment: deployment.environment })
    created(response, deployment)
  })
  router.add('GET', '/api/admin/model-control/deployments', async (_request, response, context) => {
    const actor = requirePermission(context, permissions.read)
    const page = await repository.listDeployments(parseModelControlListQuery(context.query))
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.model_control.deployments_queried', resourceType: 'model_deployment', resourceId: null, metadata: { resultCount: page.items.length, limit: page.limit } })
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })
  router.add('GET', '/api/admin/model-control/deployments/:id', async (_request, response, context) => {
    requirePermission(context, permissions.read)
    ok(response, await find('deployment', context.params.id, `/api/admin/model-control/deployments/${context.params.id}`))
  })
  router.add('POST', '/api/admin/model-control/deployments/:id/status', transition('deployment'))

  router.add('POST', '/api/admin/model-control/pricing', async (request, response, context) => {
    const actor = requirePermission(context, permissions.manage)
    const pricing = await repository.createPricing(parsePricingCreate((await readJsonBody(request)) ?? {}, actor))
    await audit(actor, 'admin.model_control.pricing_created', 'pricing', pricing, { currency: pricing.currency, unit: pricing.unit })
    created(response, pricing)
  })
  router.add('GET', '/api/admin/model-control/pricing/:id', async (_request, response, context) => {
    requirePermission(context, permissions.read)
    ok(response, await find('pricing', context.params.id, `/api/admin/model-control/pricing/${context.params.id}`))
  })
  router.add('POST', '/api/admin/model-control/pricing/:id/status', transition('pricing'))
}
