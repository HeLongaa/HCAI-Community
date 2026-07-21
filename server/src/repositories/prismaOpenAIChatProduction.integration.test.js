import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { buildProviderControlScopes, createProviderCapEvidence, providerCircuitScope } from '../creative/providerControlContract.js'
import { parseEvaluationPolicyCreate, parseEvaluationRunCreate, parseEvaluationSuiteCreate } from '../modelControl/modelEvaluationRuntime.js'
import { resolveModelRuntimeDeployment, resolveModelRuntimeReadiness } from '../modelControl/modelRuntimeResolver.js'
import { acquireProviderOperationalLease } from '../modelControl/providerOperationsService.js'
import { parseProviderLegalReviewCreate } from '../modelControl/providerLegalRuntime.js'
import { applyReleaseChange, approveReleaseChange, requestReleaseChange, rollbackReleaseChange } from '../releases/releaseControl.js'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL ??
  (process.env.CHAT_DATABASE_INTEGRATION_ENABLED === 'true' ? process.env.DATABASE_URL : null)

test('Prisma production Chat approval, operations, rotation, and rollback fail closed', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const runId = `chat-production-${Date.now()}-${randomUUID().slice(0, 8)}`
  const actor = { id: `${runId}-actor`, handle: `${runId}-operator`, role: 'admin' }
  const ids = {}
  const envNameV1 = `${runId}-token-v1`
  const envNameV2 = `${runId}-token-v2`
  const envKey = (value) => value.replaceAll('-', '_').toUpperCase()
  const now = new Date()
  const baseSource = {
    NODE_ENV: 'production',
    CREATIVE_PROVIDER_RUNTIME_ENV: 'production',
    [envKey(envNameV1)]: 'production-chat-token-v1',
    [envKey(envNameV2)]: 'production-chat-token-v2',
  }
  let priorGlobalControl = null

  try {
    const provider = await repository.modelControl.createProvider({ id: `${runId}-provider`, key: `${runId}-provider`, name: 'Production Chat Router', websiteUrl: 'https://router.example', regions: ['us'], dataProcessingRegions: ['us'], createdByRef: actor.handle, updatedByRef: actor.handle })
    ids.provider = provider.id
    const model = await repository.modelControl.createModel({ id: `${runId}-model`, providerId: provider.id, key: `${runId}-model`, name: 'Production Terra Chat', family: 'chat', createdByRef: actor.handle, updatedByRef: actor.handle })
    ids.model = model.id
    const version = await repository.modelControl.createVersion({ id: `${runId}-version`, modelId: model.id, versionKey: 'v1', releaseDate: null, contextWindow: 131072, maxOutputUnits: 8192, parameterSchema: null, createdByRef: actor.handle, updatedByRef: actor.handle })
    ids.version = version.id
    ids.capability = `${runId}-capability`
    await repository.modelControl.upsertCapability({ id: ids.capability, modelVersionId: version.id, modality: 'chat', operations: ['generate'], inputMimeTypes: ['text/plain'], outputMimeTypes: ['text/plain'], constraints: null })
    const deployment = await repository.modelControl.createDeployment({
      id: `${runId}-deployment`, modelVersionId: version.id, key: `${runId}-production`, environment: 'production', region: 'us', deploymentRef: `${runId}-deployment-ref`,
      adapterType: 'openai_chat', providerModelId: 'gpt-5.6-terra', endpointUrl: 'https://router.example/v1', secretPurpose: 'chat-inference',
      runtimeConfig: { apiDialect: 'chat_completions', safetyResponseFormat: 'text', providerAccountRef: 'production' }, runtimeConfigSchemaVersion: 1, runtimeEnabled: true,
      createdByRef: actor.handle, updatedByRef: actor.handle,
    })
    ids.deployment = deployment.id
    for (const [type, resource] of [['provider', provider], ['model', model], ['version', version], ['deployment', deployment]]) {
      await repository.modelControl.transition(type, resource.id, { expectedVersion: resource.version, status: 'active', reasonCode: 'chat_production_integration', actorRef: actor.handle })
    }

    const route = await repository.modelRouting.create({ id: `${runId}-route`, key: `${runId}-route`, name: 'Production Chat route', modality: 'chat', operation: 'generate', environment: 'production', region: 'us', audienceRoles: [], rolloutPercentage: 100, rolloutSeed: 'v1', fallbackMode: 'fail_closed', priority: 1, createdByRef: actor.handle, updatedByRef: actor.handle })
    ids.route = route.id
    const targeted = await repository.modelRouting.replaceTargets(route.id, { expectedVersion: route.version, actorRef: actor.handle, reasonCode: 'chat_production_target', targets: [{ id: `${runId}-target`, policyId: route.id, modelDeploymentId: deployment.id, role: 'primary', priority: 1, enabled: true }] })
    await repository.modelRouting.transition(route.id, { expectedVersion: targeted.version, status: 'active', reasonCode: 'chat_production_route_active', actorRef: actor.handle })
    const revision = (await repository.modelRouting.listRevisions(route.id))[0]

    const secretV1 = await repository.modelGovernance.createSecretRef({ id: `${runId}-secret-v1`, providerId: provider.id, environment: 'production', purpose: 'chat-inference', secretRef: `secret://env/${envNameV1}`, externalVersion: 'v1', ownerRef: actor.handle, checksumSha256: 'a'.repeat(64), expiresAt: new Date(now.getTime() + 86_400_000).toISOString(), rotatedFromId: null, reasonCode: 'chat_production_secret', createdByRef: actor.handle })
    ids.secretV1 = secretV1.id

    const operations = await repository.providerOperations.createProfile({ id: `${runId}-operations`, providerId: provider.id, scopeKey: `${provider.id}:production:production:chat-inference:chat:chat`, environment: 'production', providerAccountRef: 'production', secretPurpose: 'chat-inference', workspace: 'chat', modelFamily: 'chat', currency: 'USD', perRequestBudgetMicros: '250000', maxRequestsPerMinute: 5, maxConcurrentRequests: 1, healthTtlSeconds: 300, reasonCode: 'chat_production_operations', createdByRef: actor.handle, updatedByRef: actor.handle })
    ids.operations = operations.id
    const scopes = buildProviderControlScopes({ providerId: provider.key, providerAccountRef: 'production', workspace: 'chat', modelFamily: 'chat' })
    priorGlobalControl = await repository.client.creativeProviderControlState.findUnique({ where: { scopeKey: 'global' } })
    for (const scope of scopes.filter((item) => ['global', 'provider'].includes(item.scopeType))) {
      const current = await repository.creativeProviderControls.findControl(scope.scopeKey)
      await repository.creativeProviderControls.setControl({ ...scope, enabled: true, reasonCode: 'chat_production_operations_ready', expectedVersion: current?.version ?? 0 }, actor)
    }
    const providerScope = scopes.find((item) => item.scopeType === 'provider')
    await repository.creativeProviderControls.putCapEvidence(createProviderCapEvidence({ sourceKey: `${runId}-cap`, scopeKey: providerScope.scopeKey, providerId: provider.key, providerAccountRef: 'production', currency: 'USD', capAmount: '10', remainingAmount: '9', sourceType: 'fixture_config', sourceRef: `${runId}:cap`, verifiedAt: new Date(now.getTime() - 60_000).toISOString(), expiresAt: new Date(now.getTime() + 3_600_000).toISOString() }), actor)
    await repository.creativeProviderControls.ensureCircuit(providerCircuitScope(scopes), actor)
    await repository.providerOperations.recordHealth({ id: `${runId}-health`, policyId: operations.id, sourceKey: `${runId}-health`, status: 'healthy', checkedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 300_000).toISOString(), latencyMs: 100, successRateBps: 9990, sourceType: 'fixture_probe', sourceRefHash: 'b'.repeat(64), evidenceHash: 'c'.repeat(64), details: { region: 'us' }, detailsSchemaVersion: 1, createdByRef: actor.handle })
    await repository.providerOperations.transitionProfile(operations.id, { expectedVersion: operations.version, status: 'active', reasonCode: 'chat_production_operations_active', updatedByRef: actor.handle })

    await assert.rejects(
      resolveModelRuntimeDeployment({ repositories: repository, modality: 'chat', environment: 'production', region: 'us', actor, baseSource, now }),
      (error) => error.code === 'MODEL_RUNTIME_ROUTE_UNAVAILABLE',
    )

    const evaluationActor = { id: actor.id, handle: actor.handle }
    const suite = await repository.modelEvaluation.createSuite(parseEvaluationSuiteCreate({
      suiteKey: `${runId}-suite`, name: 'Production Chat suite', version: 1, modality: 'chat', operation: 'generate', reasonCode: 'chat_production_suite',
      cases: [
        { caseKey: 'quality', category: 'quality', scoringType: 'semantic', inputHash: '1'.repeat(64), expectedHash: '2'.repeat(64), weight: 1 },
        { caseKey: 'safety', category: 'safety', scoringType: 'policy', inputHash: '3'.repeat(64), expectedHash: '4'.repeat(64), weight: 1 },
      ],
    }, evaluationActor))
    ids.suite = suite.id
    const evaluationPolicy = await repository.modelEvaluation.createPolicy(parseEvaluationPolicyCreate({ policyKey: `${runId}-evaluation`, version: 1, suiteId: suite.id, modality: 'chat', operation: 'generate', environment: 'production', qualityThresholdBps: 8000, safetyThresholdBps: 10000, maxRegressionBps: 250, minimumCases: 2, evidenceTtlSeconds: 3600, reviewedByRef: `${runId}-reviewer`, reasonCode: 'chat_production_evaluation_policy' }, evaluationActor))
    const runInput = (sourceKey, baselineRunId, scoreBps) => parseEvaluationRunCreate({ sourceKey, suiteId: suite.id, policyId: evaluationPolicy.id, modelVersionId: version.id, modelDeploymentId: deployment.id, baselineRunId, executorRef: `${runId}-runner`, results: suite.cases.map((item) => ({ caseId: item.id, scoreBps, safetyPassed: true, outputHash: '5'.repeat(64) })) }, evaluationActor)
    const baseline = await repository.modelEvaluation.createRun(runInput(`${runId}-baseline`, null, 9000))
    const evaluation = await repository.modelEvaluation.createRun(runInput(`${runId}-candidate`, baseline.id, 8900))
    const legal = await repository.providerLegal.createReview(parseProviderLegalReviewCreate({ sourceKey: `${runId}-legal`, version: 1, providerId: provider.id, modelVersionId: version.id, environment: 'production', decision: 'approved', allowedRegions: ['us'], geographyStatus: 'approved', dpaStatus: 'executed', retentionStatus: 'approved', retentionDays: 30, trainingStatus: 'contractual_no_training', copyrightStatus: 'approved', slaStatus: 'approved', sourceEvidenceHash: '6'.repeat(64), counselRef: `${runId}-counsel`, productOwnerRef: `${runId}-owner`, reviewedAt: new Date(now.getTime() - 60_000).toISOString(), validFrom: new Date(now.getTime() - 30_000).toISOString(), expiresAt: new Date(now.getTime() + 86_400_000).toISOString(), reasonCode: 'chat_production_legal' }, evaluationActor))

    const promotionInput = { id: `${runId}-promotion`, modelDeploymentId: deployment.id, routePolicyId: route.id, routePolicyRevisionId: revision.id, providerSecretRefId: secretV1.id, evaluationRunId: evaluation.id, legalReviewId: legal.id, createdByRef: actor.handle }
    await repository.modelGovernance.validatePromotion(promotionInput, { artifactVersion: 'v1' })
    const requested = await requestReleaseChange({ payload: { changeType: 'promotion', sourceEnvironment: 'staging', targetEnvironment: 'production', artifactVersion: 'v1', rollbackVersion: 'v0', secretRef: null, secretVersion: null, summary: 'Production Chat integration promotion', reasonCode: 'chat_production_request', modelPromotion: promotionInput }, actor, repository: repository.releaseChanges })
    ids.release = requested.id
    const approved = await approveReleaseChange({ change: requested, payload: { reasonCode: 'chat_production_approved', note: '' }, actor: { handle: `${runId}-approver` }, repository: repository.releaseChanges })
    const deployed = await applyReleaseChange({ change: approved, payload: { outcome: 'deployed', deploymentId: deployment.id, evidenceUrl: 'https://ci.example/chat-production-integration', reasonCode: 'chat_production_deployed', note: '' }, actor, repository: repository.releaseChanges })
    assert.equal(deployed.status, 'deployed')

    const resolved = await resolveModelRuntimeDeployment({ repositories: repository, modality: 'chat', environment: 'production', region: 'us', actor, baseSource, now })
    assert.equal(resolved.providerOperationsPolicyId, operations.id)
    assert.equal(resolved.runtimeSource.CHAT_PROVIDER_MODE, 'openai_production')
    assert.equal(JSON.stringify(resolved).includes('production-chat-token-v1'), false)
    assert.equal((await resolveModelRuntimeReadiness({ repositories: repository, region: 'us', baseSource, now })).decision, 'ready')
    const leased = await acquireProviderOperationalLease({ repositories: repository, sourceKey: `${runId}-dispatch`, estimateMicros: '1000', now, provider, deployment, secretRef: secretV1, workspace: 'chat', modelFamily: 'chat' })
    assert.equal(leased.duplicate, false)
    await repository.providerOperations.releaseLease({ id: leased.lease.id, reasonCode: 'integration_complete', now })

    const secretV2 = await repository.modelGovernance.createSecretRef({ id: `${runId}-secret-v2`, providerId: provider.id, environment: 'production', purpose: 'chat-inference', secretRef: `secret://env/${envNameV2}`, externalVersion: 'v2', ownerRef: actor.handle, checksumSha256: 'd'.repeat(64), expiresAt: new Date(now.getTime() + 86_400_000).toISOString(), rotatedFromId: secretV1.id, reasonCode: 'chat_production_rotation', createdByRef: actor.handle })
    ids.secretV2 = secretV2.id
    await assert.rejects(
      resolveModelRuntimeDeployment({ repositories: repository, modality: 'chat', environment: 'production', region: 'us', actor, baseSource, now }),
      (error) => error.code === 'MODEL_RUNTIME_ROUTE_UNAVAILABLE',
    )

    const rolledBack = await rollbackReleaseChange({ change: deployed, payload: { deploymentId: deployment.id, evidenceUrl: 'https://ci.example/chat-production-rollback', reasonCode: 'chat_production_rollback', note: '' }, actor: { handle: `${runId}-approver` }, repository: repository.releaseChanges })
    assert.equal(rolledBack.status, 'rolled_back')
    assert.equal((await repository.modelControl.find('deployment', deployment.id)).trafficEligible, false)
    await assert.rejects(
      resolveModelRuntimeDeployment({ repositories: repository, modality: 'chat', environment: 'production', region: 'us', actor, baseSource, now }),
      (error) => error.code === 'MODEL_RUNTIME_ROUTE_UNAVAILABLE',
    )
  } finally {
    await repository.client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL app.model_control_maintenance = 'on'")
      await tx.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await tx.$executeRawUnsafe("SET LOCAL app.provider_legal_maintenance = 'on'")
      await tx.$executeRawUnsafe("SET LOCAL app.ai_evaluation_maintenance = 'on'")
      if (ids.release) {
        await tx.releaseEvidence.deleteMany({ where: { releaseChangeId: ids.release } })
        await tx.modelPromotion.deleteMany({ where: { releaseChangeId: ids.release } })
        await tx.releaseChange.deleteMany({ where: { id: ids.release } })
      }
      if (ids.route) await tx.modelRouteDecision.deleteMany({ where: { policyId: ids.route } })
      if (ids.operations) {
        await tx.providerDispatchLease.deleteMany({ where: { policyId: ids.operations } })
        await tx.providerRateLimitWindow.deleteMany({ where: { policyId: ids.operations } })
        await tx.providerHealthEvidence.deleteMany({ where: { policyId: ids.operations } })
        await tx.providerOperationalPolicy.deleteMany({ where: { id: ids.operations } })
      }
      if (ids.suite) {
        await tx.aiEvaluationCaseResult.deleteMany({ where: { run: { suiteId: ids.suite } } })
        await tx.aiEvaluationRun.deleteMany({ where: { suiteId: ids.suite } })
        await tx.aiEvaluationPolicy.deleteMany({ where: { suiteId: ids.suite } })
        await tx.aiEvaluationCase.deleteMany({ where: { suiteId: ids.suite } })
        await tx.aiEvaluationSuite.deleteMany({ where: { id: ids.suite } })
      }
      if (ids.provider) {
        await tx.providerSecretRef.deleteMany({ where: { providerId: ids.provider } })
        await tx.providerLegalReview.deleteMany({ where: { providerId: ids.provider } })
      }
      if (ids.route) {
        await tx.modelRoutePolicyRevision.deleteMany({ where: { policyId: ids.route } })
        await tx.modelRouteTarget.deleteMany({ where: { policyId: ids.route } })
        await tx.modelRoutePolicy.deleteMany({ where: { id: ids.route } })
      }
      await tx.creativeProviderCircuitEvent.deleteMany({ where: { circuitState: { providerId: { startsWith: runId }, providerAccountRef: 'production', workspace: 'chat' } } })
      await tx.creativeProviderCircuitState.deleteMany({ where: { providerId: { startsWith: runId }, providerAccountRef: 'production', workspace: 'chat' } })
      await tx.creativeProviderCapEvidence.deleteMany({ where: { providerId: { startsWith: runId }, providerAccountRef: 'production' } })
      await tx.creativeProviderControlState.deleteMany({ where: { providerId: { startsWith: runId }, providerAccountRef: 'production' } })
      if (priorGlobalControl) {
        await tx.creativeProviderControlState.update({ where: { scopeKey: 'global' }, data: { enabled: priorGlobalControl.enabled, version: priorGlobalControl.version, reasonCode: priorGlobalControl.reasonCode, changedByRef: priorGlobalControl.changedByRef, enabledAt: priorGlobalControl.enabledAt, disabledAt: priorGlobalControl.disabledAt } })
      } else {
        await tx.creativeProviderControlState.deleteMany({ where: { scopeKey: 'global', changedByRef: actor.handle } })
      }
      if (ids.deployment) await tx.modelDeployment.deleteMany({ where: { id: ids.deployment } })
      if (ids.capability) await tx.modelCapability.deleteMany({ where: { id: ids.capability } })
      if (ids.version) await tx.modelVersion.deleteMany({ where: { id: ids.version } })
      if (ids.model) await tx.model.deleteMany({ where: { id: ids.model } })
      if (ids.provider) await tx.provider.deleteMany({ where: { id: ids.provider } })
      await tx.auditEvent.deleteMany({ where: { OR: [{ actorId: actor.id }, { resourceId: { in: Object.values(ids) } }] } })
    })
    await repository.client.$disconnect()
  }
})
