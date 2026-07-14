import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const manifest = JSON.parse(read('config/v1-internal-accounting-invariants.json'))
const packageJson = JSON.parse(read('package.json'))
const moduleSource = read('server/src/accounting/internalAccounting.js')
const prismaSchema = read('server/prisma/schema.prisma')
const seedRepository = read('server/src/repositories/seedRepository.js')
const prismaRepository = read('server/src/repositories/prismaRepository.js')
const releaseScope = JSON.parse(read('config/v1-release-scope.json'))

const checks = []
const add = (name, passed) => checks.push({ name, passed: Boolean(passed) })

add('manifest version is frozen', manifest.version === 'internal-accounting-invariants-v1')
add('all internal units are distinct', ['points', 'creative_credit', 'quota_unit'].every((unit) => manifest.units[unit]))
add('Provider currency is evidence-only', manifest.units.provider_currency?.separateEvidenceOnly === true)
add('real-money capabilities remain excluded', ['rmb_payment', 'withdrawal', 'kyc', 'invoice', 'merchant_settlement'].every((item) => manifest.scope.excluded.includes(item)))
add('required accounting operations are cataloged', [
  'task_escrow_reserve', 'task_escrow_transfer', 'task_escrow_release', 'manual_adjustment',
  'credit_reserve', 'credit_settle', 'credit_refund', 'quota_reserve', 'quota_commit',
  'quota_release', 'compensation',
].every((kind) => manifest.operationKinds.includes(kind)))
add('all movement templates are balanced pairs', Object.values(manifest.movementTemplates).every((template) => Array.isArray(template) && template.length === 2))
add('shared invariant helper exists', moduleSource.includes('validateMovementGroup') && moduleSource.includes('reconcilePointLedgerRows'))
add('Prisma accounting models are wired', ['model InternalPointAccount', 'model InternalAccountingOperation', 'model InternalAccountingMovement', 'model AccountingReconciliationIssue'].every((token) => prismaSchema.includes(token)))
add('Seed repository exposes reconciliation', seedRepository.includes('accountingReconciliation'))
add('Prisma repository exposes reconciliation', prismaRepository.includes('accountingReconciliation'))
add('Prisma quota uses transaction locking and conditional terminal claims', prismaRepository.includes('pg_advisory_xact_lock') && prismaRepository.includes("where: { id: reservation.id, status: 'reserved' }"))
add('Prisma quota records all accounting movements', ['quota_reserve', 'quota_commit', 'quota_release'].every((kind) => prismaRepository.includes(`kind: '${kind}'`)))
add('quota reservations persist idempotency payload hashes', prismaSchema.includes('idempotencyPayloadHash') && seedRepository.includes('idempotencyPayloadHash'))
add('package exposes V1-65 verifier', packageJson.scripts['test:v1-accounting']?.includes('verify-v1-internal-accounting.mjs'))
add('quick gate includes V1-65 verifier', packageJson.scripts['check:quick']?.includes('npm run test:v1-accounting'))
const pointsDomain = releaseScope.includedDomains.find((domain) => domain.id === 'internal-points')
add('release scope points to the V1-65 gate', pointsDomain?.verificationCommand === 'npm run test:v1-accounting')

for (const check of checks) console.log(`${check.passed ? 'PASS' : 'FAIL'} ${check.name}`)
const failures = checks.filter((check) => !check.passed)
console.log(`\n${checks.length - failures.length}/${checks.length} V1 internal accounting checks passed.`)
if (failures.length > 0) process.exitCode = 1
