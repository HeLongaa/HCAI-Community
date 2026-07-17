import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/audit-integrity-contract.json'), 'utf8'))
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const checks = []
const add = (name, pass, evidence) => checks.push({ name, pass: Boolean(pass), evidence })
const migration = read(contract.migration)
const implementation = read(contract.implementation)
const retentionImplementation = read(contract.retentionImplementation)
const retentionMigration = read(contract.retentionMigration)
const routes = read('server/src/modules/admin/routes.js')
const permissions = read('server/src/auth/permissions.js')
const policies = read('config/entity-operation-policies.json')
const openapi = read('server/src/docs/openapi.js')

add('scope remains personal accounts only', contract.scope === 'personal_accounts_only', contract.scope)
add('database chain uses sha256 and an advisory lock', migration.includes("digest(audit_event_canonical_payload") && migration.includes('pg_advisory_xact_lock'), contract.migration)
add('audit facts and archive manifests reject mutation', migration.includes('audit_events_immutable') && migration.includes('audit_archive_manifests_immutable'), contract.migration)
add('retention dispositions reject mutation', retentionMigration.includes('audit_retention_dispositions_immutable'), contract.retentionMigration)
add('retention defaults fail closed', retentionImplementation.includes('AUDIT_RETENTION_LEGAL_HOLD') && retentionImplementation.includes('AUDIT_RETENTION_PRUNE_ENABLED') && contract.retentionPolicy.legalHoldDefault && !contract.retentionPolicy.pruneEnabledDefault, contract.retentionImplementation)
add('retention requires archive before prune', routes.indexOf('auditArchiveWriter(prepared.artifact') < routes.indexOf('pruneRetention({ actor'), 'server/src/modules/admin/routes.js')
add('retention persists checksummed immutable disposition evidence', retentionMigration.includes('archive_checksum_sha256') && retentionMigration.includes('archive_object_ref'), contract.retentionMigration)
add('chain verification supports a retained prefix anchor', read('server/src/repositories/prismaRepository.js').includes('audit_retention_dispositions') && read('server/src/repositories/prismaRepository.js').includes('expected_previous_hash'), 'server/src/repositories/prismaRepository.js')
add('portable exports expose an offline verifier', implementation.includes('buildPortableAuditExport') && fs.existsSync(path.join(root, contract.offlineVerifier)), contract.offlineVerifier)
add('dedicated permissions are registered', contract.permissions.every((id) => permissions.includes(`'${id}'`)), contract.permissions.join(', '))
add('all audit access operations write audit actions', contract.accessAuditActions.every((action) => routes.includes(`'${action}'`)), contract.accessAuditActions.join(', '))
add('retention snapshots are not invalidated by automatic mutation attempts', read('config/admin-mutation-audit.json').includes('"/api/admin/audit/retention/execute"') && read('config/admin-mutation-audit.json').includes('"automaticAttempt": false'), 'config/admin-mutation-audit.json')
add('archive manifests are immutable evidence', policies.includes('AuditArchiveManifest') && policies.includes('immutable_evidence'), 'config/entity-operation-policies.json')
add('OpenAPI publishes verification, archive, and retention routes', openapi.includes("'/admin/audit/verify'") && openapi.includes("'/admin/audit/archives'") && openapi.includes("'/admin/audit/retention/execute'"), 'server/src/docs/openapi.js')

const failures = checks.filter((check) => !check.pass)
for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}: ${check.evidence}`)
if (failures.length > 0) {
  console.error(`Audit integrity contract failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else {
  console.log(`Audit integrity contract verified: ${checks.length} checks`)
}
