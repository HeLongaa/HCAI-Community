import assert from 'node:assert/strict'
import test from 'node:test'

import { buildEvidence, receiptHash, verifyEvidence } from './lib/oauth-staging-evidence.mjs'

const passingChecks = [
  'provider_supported',
  'staging_environment',
  'staging_confirmation',
  'api_origin_https_exact',
  'browser_origin_https_exact',
  'provider_secret_present',
  'artifact_bound',
  'source_clean',
  'public_status_reachable',
  'trusted_browser_cors',
  'external_provider_ready',
  'callback_origin_exact',
  'browser_return_origin_exact',
  'provider_authorization_opened',
  'browser_returned_to_product',
  'refresh_cookie_secure_httponly',
  'csrf_cookie_secure_readable',
  'cookie_refresh_succeeded',
  'authenticated_profile_loaded',
  'provider_link_observed',
  'logout_succeeded',
].map((id) => ({ id, pass: true }))

const fixture = () => buildEvidence({
  provider: 'google',
  run: { id: 'oauth-20260808100000-1234abcd', startedAt: '2026-08-08T10:00:00.000Z', completedAt: '2026-08-08T10:01:00.000Z', durationMs: 60_000 },
  source: { gitCommit: '1'.repeat(40), artifactSha256: '2'.repeat(64) },
  deployment: { apiOriginSha256: '3'.repeat(64), browserOriginSha256: '4'.repeat(64), providerHostSha256: '5'.repeat(64) },
  flow: { authorizationMode: 'external', providerAuthorizationOpened: true, returnedToProduct: true, refreshSucceeded: true, profileLoaded: true, providerLinkObserved: true, logoutSucceeded: true },
  cookies: { refreshHttpOnly: true, refreshSecure: true, csrfHttpOnly: false, csrfSecure: true, csrfReadable: true, sameSite: 'None' },
  limitations: { accountLinkingVerified: false, accountConflictVerified: false, accountUnlinkVerified: false, providerCancellationVerified: false, configurationChangeVerified: false, targetProductionEnvironmentVerified: false },
  checks: passingChecks,
})

test('OAuth staging evidence is hash-bound, secret-free, and staging-only', () => {
  const evidence = fixture()
  assert.deepEqual(verifyEvidence(evidence), { valid: true, failures: [] })
  assert.equal(receiptHash(evidence), evidence.receiptHash)
  assert.deepEqual(verifyEvidence({ ...evidence, receiptHash: '0'.repeat(64) }).failures, ['receipt_hash'])
})

test('OAuth staging evidence rejects missing browser controls and production overclaims', () => {
  const evidence = fixture()
  const insecure = buildEvidence({ ...evidence, cookies: { ...evidence.cookies, refreshSecure: false } })
  assert.ok(verifyEvidence(insecure).failures.includes('result'))
  assert.ok(verifyEvidence(insecure).failures.includes('objectives'))
  const wrongSameSite = buildEvidence({ ...evidence, cookies: { ...evidence.cookies, sameSite: 'Lax' } })
  assert.ok(verifyEvidence(wrongSameSite).failures.includes('objectives'))
  const overstated = buildEvidence({ ...evidence, limitations: { ...evidence.limitations, accountLinkingVerified: true } })
  assert.deepEqual(verifyEvidence(overstated).failures, ['production_limitations'])
})

test('OAuth staging evidence rejects identity and credential-shaped fields', () => {
  const evidence = fixture()
  const unsafe = buildEvidence({ ...evidence, flow: { ...evidence.flow, email: 'private@example.com', accessToken: 'not-allowed' } })
  assert.ok(verifyEvidence(unsafe).failures.includes('forbidden_fields'))
})

test('OAuth staging evidence rejects URLs, unknown checks, and failed checks after re-signing', () => {
  const evidence = fixture()
  const withUrl = buildEvidence({ ...evidence, deployment: { ...evidence.deployment, callbackUrl: 'https://api.example.com/callback' } })
  assert.ok(verifyEvidence(withUrl).failures.includes('forbidden_fields'))
  const unknownCheck = buildEvidence({ ...evidence, checks: [...evidence.checks.slice(1), { id: 'looks_safe', pass: true }] })
  assert.ok(verifyEvidence(unknownCheck).failures.includes('checks'))
  const failedCheck = buildEvidence({ ...evidence, checks: evidence.checks.map((check) => check.id === 'logout_succeeded' ? { ...check, pass: false } : check) })
  assert.ok(verifyEvidence(failedCheck).failures.includes('checks'))
  assert.ok(verifyEvidence(failedCheck).failures.includes('result'))
  const nestedSecret = buildEvidence({ ...evidence, cookies: { ...evidence.cookies, sameSite: { secret: 'hidden' } } })
  assert.ok(verifyEvidence(nestedSecret).failures.includes('forbidden_fields'))
})
