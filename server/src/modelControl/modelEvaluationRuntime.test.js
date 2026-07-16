import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertPromotionEvaluation,
  buildEvaluationEvidence,
  parseEvaluationPolicyCreate,
  parseEvaluationRunCreate,
  parseEvaluationSuiteCreate,
} from './modelEvaluationRuntime.js'

const actor = { id: 'admin-id', handle: 'opsplus' }
const digest = (character) => character.repeat(64)
const suiteInput = () => parseEvaluationSuiteCreate({
  suiteKey: 'chat-regression', name: 'Chat regression', version: 1, modality: 'chat', operation: 'generate', reasonCode: 'initial_review',
  cases: [
    { caseKey: 'quality-1', category: 'quality', scoringType: 'semantic', inputHash: digest('a'), expectedHash: digest('b'), weight: 2 },
    { caseKey: 'safety-1', category: 'safety', scoringType: 'policy', inputHash: digest('c'), expectedHash: digest('d'), weight: 1 },
  ],
}, actor)
const policyPayload = (suiteId) => ({
  policyKey: 'chat-production', version: 1, suiteId, modality: 'chat', operation: 'generate', environment: 'production',
  qualityThresholdBps: 8000, safetyThresholdBps: 10000, maxRegressionBps: 250, minimumCases: 2, evidenceTtlSeconds: 3600,
  reviewedByRef: 'reviewer-two', reasonCode: 'threshold_reviewed',
})
const policyInput = (suiteId) => parseEvaluationPolicyCreate(policyPayload(suiteId), actor)
const runInput = (suite, policy, options = {}) => parseEvaluationRunCreate({
  sourceKey: options.sourceKey ?? 'run-1', suiteId: suite.id, policyId: policy.id, modelVersionId: 'version-1', modelDeploymentId: 'deployment-1',
  baselineRunId: options.baselineRunId ?? null, executorRef: 'fixture-runner',
  results: suite.cases.map((item) => ({ caseId: item.id, scoreBps: options.scoreBps ?? 9000, safetyPassed: options.safetyPassed ?? true, latencyMs: 10, outputHash: digest('e') })),
}, actor)

test('evaluation parsers accept only hash evidence and independent policy review', () => {
  const parsed = suiteInput()
  assert.equal(parsed.cases.length, 2)
  assert.match(parsed.suite.contentHash, /^[a-f0-9]{64}$/)
  assert.throws(() => parseEvaluationSuiteCreate({ suiteKey: 'unsafe', name: 'Unsafe', version: 1, modality: 'chat', operation: 'generate', reasonCode: 'unsafe', rawPrompt: 'secret', cases: [] }, actor), /unsupported fields/)
  assert.throws(() => parseEvaluationPolicyCreate({ ...policyPayload(parsed.suite.id), reviewedByRef: actor.handle }, actor), /different reviewer/)
})

test('evaluation evidence scores quality safety coverage and regression deterministically', () => {
  const parsedSuite = suiteInput()
  const suite = { ...parsedSuite.suite, cases: parsedSuite.cases }
  const policy = policyInput(suite.id)
  const baseline = buildEvaluationEvidence({ input: runInput(suite, policy, { sourceKey: 'baseline', scoreBps: 9000 }), suite, policy, baseline: null }).run
  const candidate = buildEvaluationEvidence({ input: runInput(suite, policy, { sourceKey: 'candidate', baselineRunId: baseline.id, scoreBps: 8850 }), suite, policy, baseline })
  assert.equal(baseline.status, 'passed')
  assert.equal(candidate.run.status, 'passed')
  assert.equal(candidate.run.regressionDeltaBps, -150)
  assert.match(candidate.run.reportHash, /^[a-f0-9]{64}$/)

  const unsafe = buildEvaluationEvidence({ input: runInput(suite, policy, { sourceKey: 'unsafe', baselineRunId: baseline.id, safetyPassed: false }), suite, policy, baseline })
  assert.equal(unsafe.run.status, 'failed')
  assert.ok(unsafe.run.reasonCodes.includes('safety_threshold_failed'))

  const incompleteInput = runInput(suite, policy, { sourceKey: 'incomplete' })
  incompleteInput.results.pop()
  const incomplete = buildEvaluationEvidence({ input: incompleteInput, suite, policy, baseline: null })
  assert.equal(incomplete.run.status, 'unverifiable')
})

test('promotion requires a passing current baseline comparison for the exact production deployment', () => {
  const parsedSuite = suiteInput()
  const suite = { ...parsedSuite.suite, cases: parsedSuite.cases }
  const policy = policyInput(suite.id)
  const baseline = buildEvaluationEvidence({ input: runInput(suite, policy, { sourceKey: 'baseline' }), suite, policy, baseline: null }).run
  const candidate = buildEvaluationEvidence({ input: runInput(suite, policy, { sourceKey: 'candidate', baselineRunId: baseline.id }), suite, policy, baseline }).run
  const evaluationRun = { ...candidate, policy }
  assert.equal(assertPromotionEvaluation({ evaluationRun, modelDeploymentId: 'deployment-1', modelVersionId: 'version-1' }), true)
  assert.throws(() => assertPromotionEvaluation({ evaluationRun: { ...evaluationRun, status: 'failed' }, modelDeploymentId: 'deployment-1', modelVersionId: 'version-1' }), /did not pass/)
  assert.throws(() => assertPromotionEvaluation({ evaluationRun: { ...evaluationRun, expiresAt: new Date(0).toISOString() }, modelDeploymentId: 'deployment-1', modelVersionId: 'version-1' }), /expired/)
  assert.throws(() => assertPromotionEvaluation({ evaluationRun, modelDeploymentId: 'deployment-other', modelVersionId: 'version-1' }), /does not match/)
})
