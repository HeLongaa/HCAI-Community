import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { buildNotificationDeliveryConfig, createNotificationEmailClient } from '../server/src/notifications/notificationDeliveries.js'
import { buildEvidence, verifyEvidence } from './lib/notification-email-staging-evidence.mjs'

const root = process.cwd()
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/notification-email-staging-contract.json'), 'utf8'))
const mode = process.argv.find((argument) => argument.startsWith('--mode='))?.slice('--mode='.length) ?? 'preflight'
if (!['preflight', 'execute'].includes(mode)) throw new Error('Mode must be preflight or execute')

const source = { ...process.env, NODE_ENV: 'production' }
let configurationValid = true
let config
try {
  config = buildNotificationDeliveryConfig(source)
} catch {
  configurationValid = false
  config = {
    email: { available: false, webhookUrl: null, secret: null, from: null, requireProviderReceipt: false },
  }
}
const recipient = String(source.NOTIFICATION_EMAIL_TEST_RECIPIENT ?? '').trim().toLowerCase()
const artifactSha256 = String(source.RELEASE_ARTIFACT_SHA256 ?? '').trim()
const environment = String(source.NOTIFICATION_EMAIL_ACCEPTANCE_ENVIRONMENT ?? '').trim().toLowerCase()
const confirmation = String(source.NOTIFICATION_EMAIL_STAGING_CONFIRMATION ?? '').trim().toLowerCase()
const emailPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/
const gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const sourceDirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0
const relayUrl = config.email.webhookUrl ? new URL(config.email.webhookUrl) : null

const checks = [
  { id: 'configuration_valid', pass: configurationValid },
  { id: 'staging_environment', pass: environment === 'staging' },
  { id: 'email_channel_available', pass: config.email.available === true },
  { id: 'https_relay', pass: relayUrl?.protocol === 'https:' },
  { id: 'hmac_configured', pass: Boolean(config.email.secret) },
  { id: 'sender_configured', pass: Boolean(config.email.from) },
  { id: 'provider_receipt_required', pass: config.email.requireProviderReceipt === true },
  { id: 'test_recipient_valid', pass: emailPattern.test(recipient) && recipient.length <= 254 },
  { id: 'artifact_bound', pass: /^[a-f0-9]{64}$/.test(artifactSha256) && /^[a-f0-9]{40}$/.test(gitCommit) },
  { id: 'source_clean', pass: sourceDirty === false },
]

const safePreflight = {
  mode,
  environment,
  gitCommit,
  configurationValid,
  artifactBound: checks.find((check) => check.id === 'artifact_bound').pass,
  sourceClean: !sourceDirty,
  relayHttps: checks.find((check) => check.id === 'https_relay').pass,
  hmacConfigured: checks.find((check) => check.id === 'hmac_configured').pass,
  senderConfigured: checks.find((check) => check.id === 'sender_configured').pass,
  providerReceiptRequired: config.email.requireProviderReceipt,
  recipientConfigured: checks.find((check) => check.id === 'test_recipient_valid').pass,
}

if (mode === 'preflight') {
  console.log(JSON.stringify({ ...safePreflight, pass: checks.every((check) => check.pass) }))
  if (checks.some((check) => !check.pass)) process.exitCode = 1
} else {
  if (confirmation !== contract.confirmation) throw new Error('Notification email staging confirmation is missing or invalid')
  const failedPreflight = checks.filter((check) => !check.pass)
  if (failedPreflight.length) throw new Error(`Notification email staging preflight failed: ${failedPreflight.map((check) => check.id).join(', ')}`)

  const startedAt = new Date()
  const runId = `nemail-${startedAt.toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${randomBytes(4).toString('hex')}`
  const client = createNotificationEmailClient({ source })
  const result = await client.send({
    delivery: { id: runId },
    notification: {
      id: `${runId}-notification`,
      type: 'system.staging_email_acceptance',
      title: 'HCAI staging email delivery check',
      body: `Staging relay acceptance run ${runId}. No action is required.`,
    },
    recipient: { email: recipient },
  })
  if (result.outcome !== 'sent' || !/^[a-f0-9]{64}$/.test(result.receiptHash ?? '')) {
    throw new Error(`Notification email relay acceptance failed: ${result.errorCode ?? result.outcome}`)
  }
  const completedAt = new Date()
  const hash = (value) => createHash('sha256').update(value).digest('hex')
  const domain = (value) => value.slice(value.lastIndexOf('@') + 1)
  const evidence = buildEvidence({
    run: { id: runId, startedAt: startedAt.toISOString(), completedAt: completedAt.toISOString(), durationMs: completedAt.getTime() - startedAt.getTime() },
    source: { gitCommit, artifactSha256 },
    relay: {
      hostSha256: hash(relayUrl.hostname.toLowerCase()),
      senderDomainSha256: hash(domain(config.email.from).toLowerCase()),
      recipientDomainSha256: hash(domain(recipient)),
    },
    delivery: { outcome: result.outcome, statusCode: result.statusCode, receiptHeader: result.receiptHeader, providerReceiptSha256: result.receiptHash },
    controls: { https: true, hmacSha256: true, senderConfigured: true, providerReceiptRequired: true },
    limitations: { mailboxDeliveryVerified: false, bounceHandlingVerified: false, complaintHandlingVerified: false, targetProductionEnvironmentVerified: false },
    checks: [...checks, { id: 'relay_accepted_with_receipt', pass: true }],
  })
  const verification = verifyEvidence(evidence)
  if (!verification.valid) throw new Error(`Notification email evidence is invalid: ${verification.failures.join(', ')}`)
  const evidenceDir = path.resolve(root, source.NOTIFICATION_EMAIL_EVIDENCE_DIR ?? '.artifacts/notification-email')
  fs.mkdirSync(evidenceDir, { recursive: true, mode: 0o700 })
  const evidencePath = path.join(evidenceDir, `${runId}.json`)
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
  console.log(`status=passed\nrun_id=${runId}\nrelay_receipt_sha256=${result.receiptHash}\nevidence_receipt_sha256=${evidence.receiptHash}\nevidence=${evidencePath}`)
}
