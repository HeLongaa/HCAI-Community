import assert from 'node:assert/strict'
import test from 'node:test'

import { assertProviderLegalApproval, parseProviderLegalReviewCreate, providerLegalScopeKey } from './providerLegalRuntime.js'

const actor = { id: 'admin-1', handle: 'opsplus' }
const body = (overrides = {}) => ({
  sourceKey: 'openai-image-production-1', version: 1, providerId: 'provider-1', modelVersionId: 'version-1', environment: 'production', decision: 'approved',
  allowedRegions: ['us'], geographyStatus: 'approved', dpaStatus: 'executed', retentionStatus: 'approved', retentionDays: 30,
  trainingStatus: 'contractual_no_training', copyrightStatus: 'approved', slaStatus: 'approved', sourceEvidenceHash: 'a'.repeat(64),
  counselRef: 'qualified-counsel', productOwnerRef: 'product-owner', reviewedAt: '2026-07-01T00:00:00.000Z', validFrom: '2026-07-01T00:00:00.000Z', expiresAt: '2026-12-31T00:00:00.000Z', reasonCode: 'provider_reviewed',
  ...overrides,
})

test('Provider legal parser accepts only complete independently reviewed hash evidence', () => {
  const parsed = parseProviderLegalReviewCreate(body(), actor)
  assert.match(parsed.evidenceHash, /^[a-f0-9]{64}$/)
  assert.deepEqual(parsed.allowedRegions, ['us'])
  assert.equal(providerLegalScopeKey(parsed), 'provider-1:version-1:production')
  assert.throws(() => parseProviderLegalReviewCreate(body({ rawContract: 'secret contract body' }), actor), /unsupported fields/)
  assert.throws(() => parseProviderLegalReviewCreate(body({ counselRef: 'https://counsel.example/review' }), actor), /safe internal reference/)
  assert.throws(() => parseProviderLegalReviewCreate(body({ counselRef: 'Jane Counsel' }), actor), /stable non-personal internal reference/)
  assert.throws(() => parseProviderLegalReviewCreate(body({ counselRef: 'jane@example.com' }), actor), /stable non-personal internal reference/)
  assert.throws(() => parseProviderLegalReviewCreate(body({ productOwnerRef: 'qualified-counsel' }), actor), /different reviewers/)
  assert.throws(() => parseProviderLegalReviewCreate(body({ trainingStatus: 'blocked' }), actor), /every legal and data-processing gate/)
})

test('Provider legal approval must be current, valid, and match exact deployment scope', () => {
  const review = parseProviderLegalReviewCreate(body(), actor)
  const deployment = { id: 'deployment-1', modelVersionId: 'version-1', environment: 'production', region: 'us' }
  assert.equal(assertProviderLegalApproval({ review, latestReview: review, deployment, providerId: 'provider-1', now: new Date('2026-08-01T00:00:00.000Z') }), true)
  assert.throws(() => assertProviderLegalApproval({ review, latestReview: { ...review, id: 'newer' }, deployment, providerId: 'provider-1', now: new Date('2026-08-01T00:00:00.000Z') }), /current scope version/)
  assert.throws(() => assertProviderLegalApproval({ review, latestReview: review, deployment: { ...deployment, region: 'eu' }, providerId: 'provider-1', now: new Date('2026-08-01T00:00:00.000Z') }), /deployment region/)
  assert.throws(() => assertProviderLegalApproval({ review, latestReview: review, deployment, providerId: 'provider-1', now: new Date('2027-01-01T00:00:00.000Z') }), /currently valid/)
})
