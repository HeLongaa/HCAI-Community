import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createModelRouteDecision,
  modelRouteSubjectHash,
  parseModelPromotionRequest,
  parseProviderSecretRefCreate,
} from './modelGovernanceRuntime.js'
import { createProductionReleaseEvidenceFixture } from '../releases/productionReleaseEvidence.fixtures.js'

const actor = { id: 'admin-1', handle: 'ops' }

test('route decision retains explainability without retaining the raw subject', () => {
  const context = { modality: 'image', operation: 'generate', environment: 'staging', region: 'us', subjectKey: 'private-user-id' }
  const result = { status: 'unavailable', reasonCode: 'no_active_route_policy', policy: null, selected: null, attempts: [], consideredPolicies: [] }
  const decision = createModelRouteDecision({ source: 'dispatch', context, result, policies: [], actor })
  assert.match(decision.subjectHash, /^[a-f0-9]{64}$/)
  assert.equal(decision.subjectHash, modelRouteSubjectHash(context.subjectKey))
  assert.equal(JSON.stringify(decision).includes(context.subjectKey), false)
})

test('SecretRef parser accepts only metadata references and rejects plaintext material', () => {
  const valid = {
    providerId: 'provider-1', environment: 'production', purpose: 'inference', secretRef: 'secret://vault/provider/key', externalVersion: 'v3',
    ownerRef: 'ops', checksumSha256: 'a'.repeat(64), expiresAt: new Date(Date.now() + 86_400_000).toISOString(), rotatedFromId: null, reasonCode: 'rotation',
  }
  assert.equal(parseProviderSecretRefCreate(valid, actor).secretRef, valid.secretRef)
  assert.throws(() => parseProviderSecretRefCreate({ ...valid, secretRef: 'https://vault.example/key' }, actor), /secret:\/\/ reference/)
  assert.throws(() => parseProviderSecretRefCreate({ ...valid, apiKey: 'plaintext' }, actor), /unsupported fields/)
  assert.throws(() => parseProviderSecretRefCreate({ ...valid, checksumSha256: 'secret-value' }, actor), /SHA-256/)
})

test('model promotion parser fixes the environment boundary and rejects extra secret fields', () => {
  const productionEvidence = createProductionReleaseEvidenceFixture()
  const payload = {
    modelDeploymentId: 'deployment-1', routePolicyId: 'policy-1', routePolicyRevisionId: 'revision-1', providerSecretRefId: 'secret-ref-1', evaluationRunId: 'evaluation-run-1', legalReviewId: 'legal-review-1',
    artifactVersion: 'v2', rollbackVersion: 'v1', summary: 'Promote image route', reasonCode: 'reviewed',
    ...productionEvidence.binding,
  }
  const parsed = parseModelPromotionRequest(payload, actor)
  assert.equal(parsed.release.sourceEnvironment, 'staging')
  assert.equal(parsed.release.targetEnvironment, 'production')
  assert.equal(parsed.promotion.evaluationRunId, 'evaluation-run-1')
  assert.equal(parsed.promotion.legalReviewId, 'legal-review-1')
  assert.deepEqual({
    sourceCommit: parsed.release.sourceCommit,
    releaseArtifactSha256: parsed.release.releaseArtifactSha256,
    rollbackArtifactSha256: parsed.release.rollbackArtifactSha256,
    productionEvidenceReceiptSha256: parsed.release.productionEvidenceReceiptSha256,
  }, productionEvidence.binding)
  assert.throws(() => parseModelPromotionRequest({ ...payload, token: 'plaintext' }, actor), /unsupported fields/)
  assert.throws(() => parseModelPromotionRequest({ ...payload, sourceCommit: '' }, actor), /sourceCommit is required/)
  assert.throws(() => parseModelPromotionRequest({ ...payload, releaseArtifactSha256: payload.rollbackArtifactSha256 }, actor), /must differ/)
})
