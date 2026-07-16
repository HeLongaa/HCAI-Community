import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { parseEvaluationPolicyCreate, parseEvaluationRunCreate, parseEvaluationSuiteCreate } from '../modelControl/modelEvaluationRuntime.js'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma AI evaluation evidence is immutable, idempotent, regression-aware, and promotion-gating', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const runId = `ai-evaluation-${Date.now()}-${randomUUID().slice(0, 8)}`
  const actor = { id: `${runId}-actor`, handle: `${runId}-author` }
  const ids = {}
  const digest = (character) => character.repeat(64)
  try {
    const provider = await repository.modelControl.createProvider({ id: `${runId}-provider`, key: `${runId}-provider`, name: 'Evaluation Provider', websiteUrl: null, regions: ['us'], dataProcessingRegions: ['us'], createdByRef: actor.handle, updatedByRef: actor.handle })
    ids.provider = provider.id
    const model = await repository.modelControl.createModel({ id: `${runId}-model`, providerId: provider.id, key: `${runId}-model`, name: 'Evaluation Model', family: 'chat', createdByRef: actor.handle, updatedByRef: actor.handle })
    ids.model = model.id
    const version = await repository.modelControl.createVersion({ id: `${runId}-version`, modelId: model.id, versionKey: 'v1', releaseDate: null, contextWindow: 8192, maxOutputUnits: 2048, parameterSchema: null, createdByRef: actor.handle, updatedByRef: actor.handle })
    ids.version = version.id
    ids.capability = `${runId}-capability`
    await repository.modelControl.upsertCapability({ id: ids.capability, modelVersionId: version.id, modality: 'chat', operations: ['generate'], inputMimeTypes: [], outputMimeTypes: [], constraints: null })
    const deployment = await repository.modelControl.createDeployment({ id: `${runId}-deployment`, modelVersionId: version.id, key: `${runId}-production`, environment: 'production', region: 'us', deploymentRef: `${runId}-ref`, createdByRef: actor.handle, updatedByRef: actor.handle })
    ids.deployment = deployment.id

    const suite = await repository.modelEvaluation.createSuite(parseEvaluationSuiteCreate({
      suiteKey: `${runId}-suite`, name: 'Integration suite', version: 1, modality: 'chat', operation: 'generate', reasonCode: 'integration_suite',
      cases: [
        { caseKey: 'quality', category: 'quality', scoringType: 'semantic', inputHash: digest('a'), expectedHash: digest('b'), weight: 1 },
        { caseKey: 'safety', category: 'safety', scoringType: 'policy', inputHash: digest('c'), expectedHash: digest('d'), weight: 1 },
      ],
    }, actor))
    ids.suite = suite.id
    const policy = await repository.modelEvaluation.createPolicy(parseEvaluationPolicyCreate({
      policyKey: `${runId}-policy`, version: 1, suiteId: suite.id, modality: 'chat', operation: 'generate', environment: 'production', qualityThresholdBps: 8000, safetyThresholdBps: 10000, maxRegressionBps: 250, minimumCases: 2, evidenceTtlSeconds: 3600, reviewedByRef: `${runId}-reviewer`, reasonCode: 'integration_policy',
    }, actor))
    ids.policy = policy.id
    const runInput = (sourceKey, baselineRunId, scoreBps = 9000) => parseEvaluationRunCreate({
      sourceKey, suiteId: suite.id, policyId: policy.id, modelVersionId: version.id, modelDeploymentId: deployment.id, baselineRunId, executorRef: `${runId}-runner`,
      results: suite.cases.map((item) => ({ caseId: item.id, scoreBps, safetyPassed: true, latencyMs: 10, outputHash: digest('e') })),
    }, actor)
    const baseline = await repository.modelEvaluation.createRun(runInput(`${runId}-baseline`, null))
    ids.baseline = baseline.id
    const candidateInput = runInput(`${runId}-candidate`, baseline.id, 8850)
    const candidate = await repository.modelEvaluation.createRun(candidateInput)
    ids.candidate = candidate.id
    assert.equal(candidate.status, 'passed')
    assert.equal(candidate.regressionDeltaBps, -150)
    assert.equal(await repository.modelEvaluation.assertPromotionEvidence(candidate.id, deployment), true)
    assert.equal((await repository.modelEvaluation.createRun(candidateInput)).id, candidate.id)
    const conflicting = runInput(`${runId}-candidate`, baseline.id, 8000)
    await assert.rejects(repository.modelEvaluation.createRun(conflicting), { code: 'EVALUATION_SOURCE_CONFLICT' })
    await assert.rejects(repository.client.aiEvaluationRun.update({ where: { id: candidate.id }, data: { status: 'failed' } }), /immutable/)
  } finally {
    await repository.client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL app.ai_evaluation_maintenance = 'on'")
      await tx.$executeRawUnsafe("SET LOCAL app.model_control_maintenance = 'on'")
      if (ids.suite) {
        await tx.aiEvaluationCaseResult.deleteMany({ where: { run: { suiteId: ids.suite } } })
        await tx.aiEvaluationRun.deleteMany({ where: { suiteId: ids.suite } })
        await tx.aiEvaluationPolicy.deleteMany({ where: { suiteId: ids.suite } })
        await tx.aiEvaluationCase.deleteMany({ where: { suiteId: ids.suite } })
        await tx.aiEvaluationSuite.deleteMany({ where: { id: ids.suite } })
      }
      if (ids.deployment) await tx.modelDeployment.deleteMany({ where: { id: ids.deployment } })
      if (ids.capability) await tx.modelCapability.deleteMany({ where: { id: ids.capability } })
      if (ids.version) await tx.modelVersion.deleteMany({ where: { id: ids.version } })
      if (ids.model) await tx.model.deleteMany({ where: { id: ids.model } })
      if (ids.provider) await tx.provider.deleteMany({ where: { id: ids.provider } })
    })
    await repository.client.$disconnect()
  }
})
