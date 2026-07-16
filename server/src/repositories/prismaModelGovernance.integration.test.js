import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { createModelRouteDecision } from '../modelControl/modelGovernanceRuntime.js'
import { parseEvaluationPolicyCreate, parseEvaluationRunCreate, parseEvaluationSuiteCreate } from '../modelControl/modelEvaluationRuntime.js'
import { parseProviderLegalReviewCreate } from '../modelControl/providerLegalRuntime.js'
import { applyReleaseChange, approveReleaseChange, requestReleaseChange, rollbackReleaseChange } from '../releases/releaseControl.js'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma model governance preserves immutable facts and atomically gates promotion traffic', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  assert.ok(repository)
  const runId = `model-governance-${Date.now()}-${randomUUID().slice(0, 8)}`
  const actorRef = `${runId}-requester`
  const ids = {}

  try {
    const provider = await repository.modelControl.createProvider({ id: `${runId}-provider`, key: `${runId}-provider`, name: 'Governance Provider', websiteUrl: null, regions: ['us'], dataProcessingRegions: ['us'], createdByRef: actorRef, updatedByRef: actorRef })
    ids.provider = provider.id
    const model = await repository.modelControl.createModel({ id: `${runId}-model`, providerId: provider.id, key: `${runId}-model`, name: 'Governance Model', family: 'image', createdByRef: actorRef, updatedByRef: actorRef })
    ids.model = model.id
    const version = await repository.modelControl.createVersion({ id: `${runId}-version`, modelId: model.id, versionKey: 'v1', releaseDate: null, contextWindow: null, maxOutputUnits: 1, parameterSchema: null, createdByRef: actorRef, updatedByRef: actorRef })
    ids.version = version.id
    ids.capability = `${runId}-capability`
    await repository.modelControl.upsertCapability({ id: ids.capability, modelVersionId: version.id, modality: 'image', operations: ['generate'], inputMimeTypes: [], outputMimeTypes: ['image/png'], constraints: null })
    const deployment = await repository.modelControl.createDeployment({ id: `${runId}-deployment`, modelVersionId: version.id, key: `${runId}-production`, environment: 'production', region: 'us', deploymentRef: `${runId}-deployment-ref`, createdByRef: actorRef, updatedByRef: actorRef })
    ids.deployment = deployment.id
    for (const [type, resource] of [['provider', provider], ['model', model], ['version', version], ['deployment', deployment]]) {
      await repository.modelControl.transition(type, resource.id, { expectedVersion: resource.version, status: 'active', reasonCode: 'integration_reviewed', actorRef })
    }

    const policy = await repository.modelRouting.create({ id: `${runId}-policy`, key: `${runId}-policy`, name: 'Production image route', modality: 'image', operation: 'generate', environment: 'production', region: 'us', audienceRoles: [], rolloutPercentage: 100, rolloutSeed: 'v1', fallbackMode: 'fail_closed', priority: 10, createdByRef: actorRef, updatedByRef: actorRef })
    ids.policy = policy.id
    const targeted = await repository.modelRouting.replaceTargets(policy.id, { expectedVersion: policy.version, actorRef, reasonCode: 'integration_target', targets: [{ id: `${runId}-target`, policyId: policy.id, modelDeploymentId: deployment.id, role: 'primary', priority: 10, enabled: true }] })
    await repository.modelRouting.transition(policy.id, { expectedVersion: targeted.version, status: 'active', reasonCode: 'integration_reviewed', actorRef })
    const revision = (await repository.modelRouting.listRevisions(policy.id))[0]

    const secretRef = await repository.modelGovernance.createSecretRef({
      id: `${runId}-secret-ref`, providerId: provider.id, environment: 'production', purpose: 'inference', secretRef: `secret://integration/${runId}`,
      externalVersion: 'v1', ownerRef: actorRef, checksumSha256: 'b'.repeat(64), expiresAt: new Date(Date.now() + 86_400_000).toISOString(), rotatedFromId: null, reasonCode: 'integration_create', createdByRef: actorRef,
    })
    ids.secretRef = secretRef.id
    await assert.rejects(repository.client.providerSecretRef.update({ where: { id: secretRef.id }, data: { ownerRef: 'tampered' } }), /model governance facts are immutable/)
    const rotations = await Promise.allSettled(['a', 'b'].map((suffix) => repository.modelGovernance.createSecretRef({
      id: `${runId}-secret-ref-${suffix}`, providerId: provider.id, environment: 'production', purpose: 'inference', secretRef: `secret://integration/${runId}/${suffix}`,
      externalVersion: `v2-${suffix}`, ownerRef: actorRef, checksumSha256: suffix.repeat(64), expiresAt: new Date(Date.now() + 86_400_000).toISOString(), rotatedFromId: secretRef.id, reasonCode: 'integration_rotation', createdByRef: actorRef,
    })))
    assert.equal(rotations.filter((result) => result.status === 'fulfilled').length, 1)
    const currentSecretRef = rotations.find((result) => result.status === 'fulfilled').value

    const context = { modality: 'image', operation: 'generate', environment: 'production', region: 'us', subjectKey: `${runId}-private-subject` }
    const decision = await repository.modelGovernance.createDecision(createModelRouteDecision({
      source: 'dispatch', context, actor: { handle: actorRef }, policies: [],
      result: { status: 'unavailable', reasonCode: 'no_active_route_policy', policy: null, selected: null, attempts: [], consideredPolicies: [] },
    }))
    ids.decision = decision.id
    assert.equal(JSON.stringify(decision).includes(context.subjectKey), false)
    await assert.rejects(repository.client.modelRouteDecision.delete({ where: { id: decision.id } }), /model governance facts are immutable/)

    const evaluationActor = { id: actorRef, handle: actorRef }
    const suite = await repository.modelEvaluation.createSuite(parseEvaluationSuiteCreate({
      suiteKey: `${runId}-suite`, name: 'Governance promotion suite', version: 1, modality: 'image', operation: 'generate', reasonCode: 'integration_suite',
      cases: [
        { caseKey: 'quality', category: 'quality', scoringType: 'semantic', inputHash: '1'.repeat(64), expectedHash: '2'.repeat(64), weight: 1 },
        { caseKey: 'safety', category: 'safety', scoringType: 'policy', inputHash: '3'.repeat(64), expectedHash: '4'.repeat(64), weight: 1 },
      ],
    }, evaluationActor))
    ids.evaluationSuite = suite.id
    const evaluationPolicy = await repository.modelEvaluation.createPolicy(parseEvaluationPolicyCreate({
      policyKey: `${runId}-policy`, version: 1, suiteId: suite.id, modality: 'image', operation: 'generate', environment: 'production', qualityThresholdBps: 8000, safetyThresholdBps: 10000, maxRegressionBps: 250, minimumCases: 2, evidenceTtlSeconds: 3600, reviewedByRef: `${runId}-reviewer`, reasonCode: 'integration_policy',
    }, evaluationActor))
    const evaluationInput = (sourceKey, baselineRunId, scoreBps) => parseEvaluationRunCreate({
      sourceKey, suiteId: suite.id, policyId: evaluationPolicy.id, modelVersionId: version.id, modelDeploymentId: deployment.id, baselineRunId, executorRef: `${runId}-runner`,
      results: suite.cases.map((item) => ({ caseId: item.id, scoreBps, safetyPassed: true, outputHash: '5'.repeat(64) })),
    }, evaluationActor)
    const baselineRun = await repository.modelEvaluation.createRun(evaluationInput(`${runId}-baseline`, null, 9000))
    const evaluationRun = await repository.modelEvaluation.createRun(evaluationInput(`${runId}-candidate`, baselineRun.id, 8900))
    const legalReview = await repository.providerLegal.createReview(parseProviderLegalReviewCreate({
      sourceKey: `${runId}-legal`, version: 1, providerId: provider.id, modelVersionId: version.id, environment: 'production', decision: 'approved', allowedRegions: ['us'],
      geographyStatus: 'approved', dpaStatus: 'executed', retentionStatus: 'approved', retentionDays: 30, trainingStatus: 'contractual_no_training', copyrightStatus: 'approved', slaStatus: 'approved',
      sourceEvidenceHash: '6'.repeat(64), counselRef: `${runId}-counsel`, productOwnerRef: `${runId}-product-owner`, reviewedAt: new Date(Date.now() - 60_000).toISOString(), validFrom: new Date(Date.now() - 30_000).toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString(), reasonCode: 'integration_legal_reviewed',
    }, evaluationActor))
    ids.legalReview = legalReview.id

    const promotion = {
      id: `${runId}-promotion`, modelDeploymentId: deployment.id, routePolicyId: policy.id, routePolicyRevisionId: revision.id,
      providerSecretRefId: currentSecretRef.id, evaluationRunId: evaluationRun.id, legalReviewId: legalReview.id, createdByRef: actorRef,
    }
    ids.promotion = promotion.id
    await repository.modelGovernance.validatePromotion(promotion, { artifactVersion: 'v1' })
    const promotionRequests = await Promise.allSettled([promotion, { ...promotion, id: `${runId}-promotion-conflict` }].map((modelPromotion) => requestReleaseChange({
      payload: { changeType: 'promotion', sourceEnvironment: 'staging', targetEnvironment: 'production', artifactVersion: 'v1', rollbackVersion: 'v0', secretRef: null, secretVersion: null, summary: 'Integration promotion', reasonCode: 'integration_request', modelPromotion },
      actor: { handle: actorRef }, repository: repository.releaseChanges,
    })))
    assert.equal(promotionRequests.filter((result) => result.status === 'fulfilled').length, 1)
    const requested = promotionRequests.find((result) => result.status === 'fulfilled').value
    ids.promotion = requested.modelPromotion.id
    ids.release = requested.id
    const approved = await approveReleaseChange({ change: requested, payload: { reasonCode: 'integration_approved', note: '' }, actor: { handle: `${runId}-approver` }, repository: repository.releaseChanges })
    const deployed = await applyReleaseChange({ change: approved, payload: { outcome: 'deployed', deploymentId: deployment.id, evidenceUrl: 'https://ci.example/integration-promotion', reasonCode: 'integration_applied', note: '' }, actor: { handle: actorRef }, repository: repository.releaseChanges })
    assert.equal(deployed.status, 'deployed')
    assert.equal((await repository.modelControl.find('deployment', deployment.id)).trafficEligible, true)
    const rolledBack = await rollbackReleaseChange({ change: deployed, payload: { deploymentId: deployment.id, evidenceUrl: 'https://ci.example/integration-rollback', reasonCode: 'integration_rollback', note: '' }, actor: { handle: `${runId}-approver` }, repository: repository.releaseChanges })
    assert.equal(rolledBack.status, 'rolled_back')
    assert.equal((await repository.modelControl.find('deployment', deployment.id)).trafficEligible, false)
    await assert.rejects(repository.client.modelPromotion.delete({ where: { id: ids.promotion } }), /model governance facts are immutable/)
  } finally {
    await repository.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.model_control_maintenance = 'on'")
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await transaction.$executeRawUnsafe("SET LOCAL app.provider_legal_maintenance = 'on'")
      if (ids.release) {
        await transaction.releaseEvidence.deleteMany({ where: { releaseChangeId: ids.release } })
        await transaction.modelPromotion.deleteMany({ where: { releaseChangeId: ids.release } })
        await transaction.releaseChange.deleteMany({ where: { id: ids.release } })
      }
      if (ids.decision) await transaction.modelRouteDecision.deleteMany({ where: { id: ids.decision } })
      if (ids.evaluationSuite) {
        await transaction.$executeRawUnsafe("SET LOCAL app.ai_evaluation_maintenance = 'on'")
        await transaction.aiEvaluationCaseResult.deleteMany({ where: { run: { suiteId: ids.evaluationSuite } } })
        await transaction.aiEvaluationRun.deleteMany({ where: { suiteId: ids.evaluationSuite } })
        await transaction.aiEvaluationPolicy.deleteMany({ where: { suiteId: ids.evaluationSuite } })
        await transaction.aiEvaluationCase.deleteMany({ where: { suiteId: ids.evaluationSuite } })
        await transaction.aiEvaluationSuite.deleteMany({ where: { id: ids.evaluationSuite } })
      }
      if (ids.provider) await transaction.providerSecretRef.deleteMany({ where: { providerId: ids.provider } })
      if (ids.provider) await transaction.providerLegalReview.deleteMany({ where: { providerId: ids.provider } })
      if (ids.policy) {
        await transaction.modelRoutePolicyRevision.deleteMany({ where: { policyId: ids.policy } })
        await transaction.modelRouteTarget.deleteMany({ where: { policyId: ids.policy } })
        await transaction.modelRoutePolicy.deleteMany({ where: { id: ids.policy } })
      }
      if (ids.deployment) await transaction.modelDeployment.deleteMany({ where: { id: ids.deployment } })
      if (ids.capability) await transaction.modelCapability.deleteMany({ where: { id: ids.capability } })
      if (ids.version) await transaction.modelVersion.deleteMany({ where: { id: ids.version } })
      if (ids.model) await transaction.model.deleteMany({ where: { id: ids.model } })
      if (ids.provider) await transaction.provider.deleteMany({ where: { id: ids.provider } })
      await transaction.auditEvent.deleteMany({ where: { resourceId: { in: Object.values(ids) } } })
    })
    await repository.client.$disconnect()
  }
})
