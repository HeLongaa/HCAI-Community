import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const contract = JSON.parse(read('config/notification-email-staging-contract.json'))
const rehearsal = read(contract.rehearsalScript)
const verifier = read(contract.evidenceVerifier)
const delivery = read('server/src/notifications/notificationDeliveries.js')
const workflow = read('.github/workflows/quality-gates.yml')
const docs = read(contract.documentation)
const packageJson = JSON.parse(read('package.json'))
const checks = []
const add = (name, pass, evidence) => checks.push({ name, pass: Boolean(pass), evidence })

add('contract has stable schemas', contract.schemaVersion === 'notification-email-staging-contract-v1' && contract.evidenceSchemaVersion === 'notification-email-staging-evidence-v1', contract.schemaVersion)
add('production email requires HMAC signing and approved sender', ['WEBHOOK_SECRET with at least 32 characters', 'valid NOTIFICATION_EMAIL_FROM'].every((marker) => delivery.includes(marker)), 'production fail-closed config')
add('production email requires a Provider receipt', delivery.includes('PROVIDER_RECEIPT_MISSING') && delivery.includes('requires provider message receipts'), 'receipt gate')
add('rehearsal requires exact staging confirmation', rehearsal.includes('NOTIFICATION_EMAIL_STAGING_CONFIRMATION') && rehearsal.includes('contract.confirmation'), contract.confirmation)
add('rehearsal binds clean source and release artifact', ["['rev-parse', 'HEAD']", "git', ['status', '--porcelain']", 'RELEASE_ARTIFACT_SHA256', 'artifact_bound', 'source_clean'].every((marker) => rehearsal.includes(marker)), 'source/artifact binding')
add('rehearsal emits hash-only relay identity', ['hostSha256', 'senderDomainSha256', 'recipientDomainSha256'].every((marker) => rehearsal.includes(marker)) && !rehearsal.includes('recipientEmail:'), 'hashed relay evidence')
add('rehearsal preserves production limitations', Object.keys(contract.requiredLimitations).every((name) => rehearsal.includes(`${name}: false`)), Object.keys(contract.requiredLimitations).join(', '))
add('evidence has an independent verifier', verifier.includes('verifyEvidence') && verifier.includes('JSON.parse'), contract.evidenceVerifier)
add('deployment smoke receives the receipt requirement', workflow.includes('NOTIFICATION_EMAIL_REQUIRE_PROVIDER_RECEIPT: ${{ vars.NOTIFICATION_EMAIL_REQUIRE_PROVIDER_RECEIPT }}'), 'workflow variable')
add('runbook distinguishes relay acceptance from mailbox delivery', docs.includes('does not prove mailbox delivery') && docs.includes('bounce') && docs.includes('complaint'), contract.documentation)
add('package exposes focused and target commands', packageJson.scripts?.['test:notification-email-staging']?.includes('verify-notification-email-staging.mjs') && packageJson.scripts?.['notification-email:rehearse']?.includes('--mode=execute'), 'package scripts')

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}: ${check.evidence ?? ''}`)
const failed = checks.filter((check) => !check.pass)
console.log(`Notification email staging contract: ${checks.length - failed.length}/${checks.length} checks passed`)
if (failed.length) process.exit(1)
