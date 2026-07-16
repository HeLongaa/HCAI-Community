import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { parseEvaluationPolicyCreate, parseEvaluationRunCreate, parseEvaluationSuiteCreate } from '../modelControl/modelEvaluationRuntime.js'
import { parseProviderLegalReviewCreate } from '../modelControl/providerLegalRuntime.js'
import { applyReleaseChange, approveReleaseChange, requestReleaseChange } from '../releases/releaseControl.js'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma Provider legal evidence is append-only and atomically gates Release apply', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  assert.ok(repository)

  const runId = `provider-legal-${Date.now()}-${randomUUID().slice(0, 8)}`
  const actor = { id: `${runId}-actor`, handle: `${runId}-actor` }
  const ids = {}
  const now = Date.now()
  const reviewPayload = ({ sourceKey, version, providerId, modelVersionId, environment = 'production', decision = 'approved', allowedRegions = ['us'], reviewedAt = new Date(now - 120_000).toISOString(), validFrom = new Date(now - 60_000).toISOString(), expiresAt = new Date(now + 86_400_000).toISOString(), sourceEvidenceHash = 'a'.repeat(64) }) => parseProviderLegalReviewCreate({
    sourceKey, version, providerId, modelVersionId, environment, decision, allowedRegions,
    geographyStatus: decision === 'approved' ? 'approved' : 'blocked', dpaStatus: 'executed', retentionStatus: 'approved', retentionDays: 30,
    trainingStatus: 'contractual_no_training', copyrightStatus: 'approved', slaStatus: 'approved', sourceEvidenceHash,
    counselRef: `${runId}-counsel`, productOwnerRef: `${runId}-product-owner`, reviewedAt, validFrom, expiresAt, reasonCode: 'integration_legal_review',
  }, actor)

  try {
    const provider = await repository.modelControl.createProvider({ id: `${runId}-provider`, key: `${runId}-provider`, name: 'Provider Legal Integration', websiteUrl: null, regions: ['us', 'eu'], dataProcessingRegions: ['us', 'eu'], createdByRef: actor.handle, updatedByRef: actor.handle })
    ids.provider = provider.id
    const otherProvider = await repository.modelControl.createProvider({ id: `${runId}-other-provider`, key: `${runId}-other-provider`, name: 'Other Provider', websiteUrl: null, regions: ['us'], dataProcessingRegions: ['us'], createdByRef: actor.handle, updatedByRef: actor.handle })
    ids.otherProvider = otherProvider.id
    const model = await repository.modelControl.createModel({ id: `${runId}-model`, providerId: provider.id, key: `${runId}-model`, name: 'Provider Legal Model', family: 'image', createdByRef: actor.handle, updatedByRef: actor.handle })
    ids.model = model.id
    const version = await repository.modelControl.createVersion({ id: `${runId}-version`, modelId: model.id, versionKey: 'v1', releaseDate: null, contextWindow: null, maxOutputUnits: 1, parameterSchema: null, createdByRef: actor.handle, updatedByRef: actor.handle })
    ids.version = version.id
    ids.capability = `${runId}-capability`
    await repository.modelControl.upsertCapability({ id: ids.capability, modelVersionId: version.id, modality: 'image', operations: ['generate'], inputMimeTypes: [], outputMimeTypes: ['image/png'], constraints: null })
    const deployment = await repository.modelControl.createDeployment({ id: `${runId}-deployment`, modelVersionId: version.id, key: `${runId}-production`, environment: 'production', region: 'us', deploymentRef: `${runId}-deployment-ref`, createdByRef: actor.handle, updatedByRef: actor.handle })
    ids.deployment = deployment.id
    for (const [type, resource] of [['provider', provider], ['model', model], ['version', version], ['deployment', deployment]]) {
      await repository.modelControl.transition(type, resource.id, { expectedVersion: resource.version, status: 'active', reasonCode: 'integration_reviewed', actorRef: actor.handle })
    }

    const firstInputs = ['a', 'b'].map((suffix) => reviewPayload({ sourceKey: `${runId}-concurrent-${suffix}`, version: 1, providerId: provider.id, modelVersionId: version.id, sourceEvidenceHash: suffix.repeat(64) }))
    const firstResults = await Promise.allSettled(firstInputs.map((input) => repository.providerLegal.createReview(input)))
    assert.equal(firstResults.filter((result) => result.status === 'fulfilled').length, 1)
    assert.equal(firstResults.filter((result) => result.status === 'rejected').length, 1)
    const firstInput = firstInputs[firstResults.findIndex((result) => result.status === 'fulfilled')]
    const firstReview = firstResults.find((result) => result.status === 'fulfilled').value
    ids.firstReview = firstReview.id

    const duplicate = await repository.providerLegal.createReview(firstInput)
    assert.equal(duplicate.id, firstReview.id)
    await assert.rejects(repository.providerLegal.createReview(reviewPayload({ ...firstInput, sourceKey: firstInput.sourceKey, version: 1, providerId: provider.id, modelVersionId: version.id, sourceEvidenceHash: 'c'.repeat(64) })), (error) => error.code === 'LEGAL_REVIEW_SOURCE_CONFLICT')
    await assert.rejects(repository.providerLegal.createReview(reviewPayload({ sourceKey: `${runId}-provider-mismatch`, version: 1, providerId: otherProvider.id, modelVersionId: version.id })), (error) => error.code === 'LEGAL_REVIEW_PROVIDER_MISMATCH')
    await assert.rejects(repository.client.providerLegalReview.update({ where: { id: firstReview.id }, data: { reasonCode: 'tampered' } }), /Provider legal review evidence is immutable/)
    await assert.rejects(repository.client.providerLegalReview.delete({ where: { id: firstReview.id } }), /Provider legal review evidence is immutable/)
    await repository.providerLegal.assertPromotionEvidence(firstReview.id, deployment)

    const blocked = await repository.providerLegal.createReview(reviewPayload({ sourceKey: `${runId}-blocked`, version: 2, providerId: provider.id, modelVersionId: version.id, decision: 'blocked', sourceEvidenceHash: 'd'.repeat(64) }))
    ids.blockedReview = blocked.id
    await assert.rejects(repository.providerLegal.assertPromotionEvidence(firstReview.id, deployment), (error) => error.code === 'PROMOTION_LEGAL_BLOCKED' && /current scope version/.test(error.message))

    const expired = await repository.providerLegal.createReview(reviewPayload({ sourceKey: `${runId}-expired`, version: 3, providerId: provider.id, modelVersionId: version.id, reviewedAt: new Date(now - 3 * 86_400_000).toISOString(), validFrom: new Date(now - 2 * 86_400_000).toISOString(), expiresAt: new Date(now - 86_400_000).toISOString(), sourceEvidenceHash: 'e'.repeat(64) }))
    await assert.rejects(repository.providerLegal.assertPromotionEvidence(expired.id, deployment), (error) => error.code === 'PROMOTION_LEGAL_BLOCKED' && /not currently valid/.test(error.message))
    const future = await repository.providerLegal.createReview(reviewPayload({ sourceKey: `${runId}-future`, version: 4, providerId: provider.id, modelVersionId: version.id, reviewedAt: new Date(now).toISOString(), validFrom: new Date(now + 3_600_000).toISOString(), expiresAt: new Date(now + 2 * 86_400_000).toISOString(), sourceEvidenceHash: 'f'.repeat(64) }))
    await assert.rejects(repository.providerLegal.assertPromotionEvidence(future.id, deployment), (error) => error.code === 'PROMOTION_LEGAL_BLOCKED' && /not currently valid/.test(error.message))
    const wrongRegion = await repository.providerLegal.createReview(reviewPayload({ sourceKey: `${runId}-region`, version: 5, providerId: provider.id, modelVersionId: version.id, allowedRegions: ['eu'], sourceEvidenceHash: '1'.repeat(64) }))
    await assert.rejects(repository.providerLegal.assertPromotionEvidence(wrongRegion.id, deployment), (error) => error.code === 'PROMOTION_LEGAL_BLOCKED' && /deployment region/.test(error.message))
    const staging = await repository.providerLegal.createReview(reviewPayload({ sourceKey: `${runId}-staging`, version: 1, providerId: provider.id, modelVersionId: version.id, environment: 'staging', sourceEvidenceHash: '2'.repeat(64) }))
    await assert.rejects(repository.providerLegal.assertPromotionEvidence(staging.id, deployment), (error) => error.code === 'PROMOTION_LEGAL_BLOCKED' && /does not match/.test(error.message))

    const approved = await repository.providerLegal.createReview(reviewPayload({ sourceKey: `${runId}-approved`, version: 6, providerId: provider.id, modelVersionId: version.id, sourceEvidenceHash: '3'.repeat(64) }))
    ids.approvedReview = approved.id
    await repository.providerLegal.assertPromotionEvidence(approved.id, deployment)

    const policy = await repository.modelRouting.create({ id: `${runId}-policy`, key: `${runId}-policy`, name: 'Provider legal production route', modality: 'image', operation: 'generate', environment: 'production', region: 'us', audienceRoles: [], rolloutPercentage: 100, rolloutSeed: 'v1', fallbackMode: 'fail_closed', priority: 10, createdByRef: actor.handle, updatedByRef: actor.handle })
    ids.policy = policy.id
    const targeted = await repository.modelRouting.replaceTargets(policy.id, { expectedVersion: policy.version, actorRef: actor.handle, reasonCode: 'integration_target', targets: [{ id: `${runId}-target`, policyId: policy.id, modelDeploymentId: deployment.id, role: 'primary', priority: 10, enabled: true }] })
    await repository.modelRouting.transition(policy.id, { expectedVersion: targeted.version, status: 'active', reasonCode: 'integration_reviewed', actorRef: actor.handle })
    const revision = (await repository.modelRouting.listRevisions(policy.id))[0]
    const secretRef = await repository.modelGovernance.createSecretRef({ id: `${runId}-secret-ref`, providerId: provider.id, environment: 'production', purpose: 'inference', secretRef: `secret://integration/${runId}`, externalVersion: 'v1', ownerRef: actor.handle, checksumSha256: '4'.repeat(64), expiresAt: new Date(now + 86_400_000).toISOString(), rotatedFromId: null, reasonCode: 'integration_create', createdByRef: actor.handle })

    const suite = await repository.modelEvaluation.createSuite(parseEvaluationSuiteCreate({
      suiteKey: `${runId}-suite`, name: 'Provider legal promotion suite', version: 1, modality: 'image', operation: 'generate', reasonCode: 'integration_suite',
      cases: [
        { caseKey: 'quality', category: 'quality', scoringType: 'semantic', inputHash: '5'.repeat(64), expectedHash: '6'.repeat(64), weight: 1 },
        { caseKey: 'safety', category: 'safety', scoringType: 'policy', inputHash: '7'.repeat(64), expectedHash: '8'.repeat(64), weight: 1 },
      ],
    }, actor))
    ids.evaluationSuite = suite.id
    const evaluationPolicy = await repository.modelEvaluation.createPolicy(parseEvaluationPolicyCreate({ policyKey: `${runId}-evaluation-policy`, version: 1, suiteId: suite.id, modality: 'image', operation: 'generate', environment: 'production', qualityThresholdBps: 8000, safetyThresholdBps: 10000, maxRegressionBps: 250, minimumCases: 2, evidenceTtlSeconds: 3600, reviewedByRef: `${runId}-evaluation-reviewer`, reasonCode: 'integration_policy' }, actor))
    const runInput = (sourceKey, baselineRunId, scoreBps) => parseEvaluationRunCreate({ sourceKey, suiteId: suite.id, policyId: evaluationPolicy.id, modelVersionId: version.id, modelDeploymentId: deployment.id, baselineRunId, executorRef: `${runId}-runner`, results: suite.cases.map((item) => ({ caseId: item.id, scoreBps, safetyPassed: true, outputHash: '9'.repeat(64) })) }, actor)
    const baselineRun = await repository.modelEvaluation.createRun(runInput(`${runId}-baseline`, null, 9000))
    const evaluationRun = await repository.modelEvaluation.createRun(runInput(`${runId}-candidate`, baselineRun.id, 8900))

    const requested = await requestReleaseChange({
      payload: { changeType: 'promotion', sourceEnvironment: 'staging', targetEnvironment: 'production', artifactVersion: 'v1', rollbackVersion: 'v0', secretRef: null, secretVersion: null, summary: 'Provider legal atomic apply', reasonCode: 'integration_request', modelPromotion: { id: `${runId}-promotion`, modelDeploymentId: deployment.id, routePolicyId: policy.id, routePolicyRevisionId: revision.id, providerSecretRefId: secretRef.id, evaluationRunId: evaluationRun.id, legalReviewId: approved.id, createdByRef: actor.handle } },
      actor, repository: repository.releaseChanges,
    })
    ids.release = requested.id
    const releaseApproved = await approveReleaseChange({ change: requested, payload: { reasonCode: 'integration_approved', note: '' }, actor: { handle: `${runId}-approver` }, repository: repository.releaseChanges })
    const supersedingBlock = await repository.providerLegal.createReview(reviewPayload({ sourceKey: `${runId}-superseding-block`, version: 7, providerId: provider.id, modelVersionId: version.id, decision: 'blocked', sourceEvidenceHash: '0'.repeat(64) }))
    ids.supersedingBlock = supersedingBlock.id
    await assert.rejects(applyReleaseChange({ change: releaseApproved, payload: { outcome: 'deployed', deploymentId: deployment.id, evidenceUrl: 'https://ci.example/provider-legal', reasonCode: 'integration_applied', note: '' }, actor, repository: repository.releaseChanges }), (error) => error.code === 'PROMOTION_LEGAL_CHANGED')
    assert.equal((await repository.releaseChanges.find(requested.id)).status, 'approved')
    assert.equal((await repository.modelControl.find('deployment', deployment.id)).trafficEligible, false)
  } finally {
    await repository.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.model_control_maintenance = 'on'")
      await transaction.$executeRawUnsafe("SET LOCAL app.ai_evaluation_maintenance = 'on'")
      await transaction.$executeRawUnsafe("SET LOCAL app.provider_legal_maintenance = 'on'")
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      if (ids.release) {
        await transaction.releaseEvidence.deleteMany({ where: { releaseChangeId: ids.release } })
        await transaction.modelPromotion.deleteMany({ where: { releaseChangeId: ids.release } })
        await transaction.releaseChange.deleteMany({ where: { id: ids.release } })
      }
      if (ids.evaluationSuite) {
        await transaction.aiEvaluationCaseResult.deleteMany({ where: { run: { suiteId: ids.evaluationSuite } } })
        await transaction.aiEvaluationRun.deleteMany({ where: { suiteId: ids.evaluationSuite } })
        await transaction.aiEvaluationPolicy.deleteMany({ where: { suiteId: ids.evaluationSuite } })
        await transaction.aiEvaluationCase.deleteMany({ where: { suiteId: ids.evaluationSuite } })
        await transaction.aiEvaluationSuite.deleteMany({ where: { id: ids.evaluationSuite } })
      }
      if (ids.provider) {
        await transaction.providerSecretRef.deleteMany({ where: { providerId: ids.provider } })
        await transaction.providerLegalReview.deleteMany({ where: { providerId: ids.provider } })
      }
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
      if (ids.otherProvider) await transaction.provider.deleteMany({ where: { id: ids.otherProvider } })
      await transaction.auditEvent.deleteMany({ where: { resourceId: { in: Object.values(ids) } } })
    })
    await repository.client.$disconnect()
  }
})
