import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { buildEvidence, receiptHash, verifyEvidence } from './lib/notification-email-staging-evidence.mjs'

const fixture = () => buildEvidence({
  run: { id: 'nemail-20260808070000-1234abcd', startedAt: '2026-08-08T07:00:00.000Z', completedAt: '2026-08-08T07:00:01.000Z', durationMs: 1000 },
  source: { gitCommit: '1'.repeat(40), artifactSha256: '2'.repeat(64) },
  relay: { hostSha256: '3'.repeat(64), senderDomainSha256: '4'.repeat(64), recipientDomainSha256: '5'.repeat(64) },
  delivery: { outcome: 'sent', statusCode: 202, receiptHeader: 'x-message-id', providerReceiptSha256: '6'.repeat(64) },
  controls: { https: true, hmacSha256: true, senderConfigured: true, providerReceiptRequired: true },
  limitations: { mailboxDeliveryVerified: false, bounceHandlingVerified: false, complaintHandlingVerified: false, targetProductionEnvironmentVerified: false },
  checks: [{ id: 'relay_accepted_with_receipt', pass: true }],
})

test('notification email evidence is hash-bound, secret-free, and staging-only', () => {
  const evidence = fixture()
  assert.deepEqual(verifyEvidence(evidence), { valid: true, failures: [] })
  assert.equal(receiptHash(evidence), evidence.receiptHash)
  assert.deepEqual(verifyEvidence({ ...evidence, receiptHash: '0'.repeat(64) }).failures, ['receipt_hash'])
})

test('notification email evidence rejects missing receipts and production overclaims', () => {
  const evidence = fixture()
  const noReceipt = buildEvidence({ ...evidence, delivery: { ...evidence.delivery, providerReceiptSha256: null } })
  assert.ok(verifyEvidence(noReceipt).failures.includes('result'))
  assert.ok(verifyEvidence(noReceipt).failures.includes('objectives'))
  const overstated = buildEvidence({ ...evidence, limitations: { ...evidence.limitations, mailboxDeliveryVerified: true } })
  assert.deepEqual(verifyEvidence(overstated).failures, ['production_limitations'])
})

test('notification email evidence rejects recipient and credential-shaped fields', () => {
  const evidence = fixture()
  const unsafe = buildEvidence({ ...evidence, relay: { ...evidence.relay, recipientEmail: 'private@example.com', apiToken: 'not-allowed' } })
  assert.ok(verifyEvidence(unsafe).failures.includes('forbidden_fields'))
})

test('notification email preflight reports partial configuration without throwing', () => {
  const result = spawnSync(process.execPath, ['scripts/rehearse-notification-email-staging.mjs', '--mode=preflight'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      NOTIFICATION_EMAIL_DELIVERY_ENABLED: 'true',
    },
  })
  assert.equal(result.status, 1)
  assert.equal(result.stderr, '')
  const output = JSON.parse(result.stdout)
  assert.equal(output.configurationValid, false)
  assert.equal(output.pass, false)
  assert.equal(JSON.stringify(output).includes('NOTIFICATION_EMAIL_'), false)
})
