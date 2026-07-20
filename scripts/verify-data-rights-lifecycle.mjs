import fs from 'node:fs'
import path from 'node:path'

import { parseServerRoutes } from './route-contract-utils.mjs'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const json = (file) => JSON.parse(read(file))

const contract = json('config/data-rights-lifecycle-contract.json')
const schema = read('server/prisma/schema.prisma')
const migration = read('server/prisma/migrations/0091_data_rights_lifecycle/migration.sql')
const lifecycle = read('server/src/dataRights/dataRightsLifecycle.js')
const prisma = read('server/src/dataRights/prismaDataRightsRepository.js')
const seed = read('server/src/dataRights/seedDataRightsRepository.js')
const routes = new Set(parseServerRoutes(root, 'server/src/modules').map((route) => route.key))
const permissions = read('server/src/auth/permissions.js')
const openapi = read('server/src/docs/openapi.js')
const profileUi = read('src/features/profile/ProfileSettingsPanel.tsx')
const adminUi = read('src/features/admin/DataRightsAdminPanel.tsx')
const policies = json('config/entity-operation-policies.json')
const governance = json('config/v1-data-governance.json')
const mutations = json('config/admin-mutation-audit.json')
const packageJson = json('package.json')
const checks = []
const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })

add('contract is LEGAL-02 personal-account scope', contract.taskId === 'LEGAL-02' && contract.scope === 'personal_accounts_only')
add('dependencies are frozen', ['USER-02', 'MEDIA-03', 'AUDIT-01'].every((item) => contract.dependencies.includes(item)))
add('request and evidence models exist', contract.models.every((model) => schema.includes(`model ${model} {`)))
add('migration constrains request type status subject ref and package size', ['data_rights_requests_type_check', 'data_rights_requests_status_check', 'data_rights_requests_subject_ref_check', 'data_rights_export_artifacts_size_check'].every((marker) => migration.includes(marker)))
add('all evidence tables reject ordinary mutation', ['data_rights_events_immutable', 'data_rights_export_artifacts_immutable', 'data_rights_deletion_receipts_immutable', 'data_rights_backup_expiry_receipts_immutable'].every((marker) => migration.includes(marker)))
add('maintenance bypass is explicit and transaction scoped', migration.includes("current_setting('app.data_rights_maintenance', true) = 'on'") && contract.evidence.maintenanceBypassRequiresTransactionSetting === 'app.data_rights_maintenance=on')
add('identity requires recent session handle and account version', lifecycle.includes('DATA_RIGHTS_REAUTH_REQUIRED') && lifecycle.includes('DATA_RIGHTS_IDENTITY_MISMATCH') && lifecycle.includes('ACCOUNT_VERSION_CONFLICT'))
add('export is bounded and recursively strips credential material', lifecycle.includes('maximumPackageBytes') && lifecycle.includes('forbiddenExportKeys') && lifecycle.includes('DATA_EXPORT_TOO_LARGE'))
add('export includes decrypted owned chat content without encrypted fields', prisma.includes('requireChatMessageCodec(source)') && prisma.includes('content: codec.decrypt(message)') && !/messages\.map[\s\S]{0,500}ciphertext:/.test(prisma))
add('export download is fixed to 15 minutes', contract.export.downloadTtlSeconds === 900 && prisma.includes('dataRightsExportDownloadTtlSeconds'))
add('deletion covers every declared domain', contract.deletion.domains.length === 15 && lifecycle.includes('dataRightsDeletionDomains.map'))
add('deletion waits 30 days and backup expiry waits 35 days', contract.deletion.graceDays === 30 && contract.deletion.backupExpiryDaysAfterPrimary === 35 && prisma.includes('DATA_RIGHTS_GRACE_PERIOD_ACTIVE') && prisma.includes('DATA_RIGHTS_BACKUP_EXPIRY_PENDING'))
add('all required backup classes gate completion', contract.deletion.requiredBackupClasses.length === 3 && prisma.includes('dataRightsRequiredBackupClasses.every'))
add('seed cancellation clears the account deletion projection', seed.includes("request.requestType === 'account_deletion'") && seed.includes('await cancelDeletion(actor, request)'))
for (const route of contract.routes) add(`${route} is implemented`, routes.has(route), route)
for (const permission of contract.permissions) add(`${permission} is registered`, permissions.includes(`'${permission}'`), permission)
for (const route of contract.routes) {
  const [, rawPath] = route.split(' ')
  add(`${rawPath} is documented`, openapi.includes(`'${rawPath.replace('/api', '').replace(/:([A-Za-z]+)/g, '{$1}')}'`), rawPath)
}
const mutableAdminRoutes = contract.routes.filter((route) => route.startsWith('POST /api/admin/'))
add('Admin mutations are domain audited', mutableAdminRoutes.every((route) => {
  const [method, requestPath] = route.split(' ')
  return mutations.routes.some((item) => item.method === method && item.path === requestPath && item.mode === 'domain_audited')
}))
add('elevated reads and owner downloads are audited', ['admin.data_rights.listed', 'admin.data_rights.viewed', 'admin.data_rights.metrics_viewed', 'data_rights.export_downloaded'].every((action) => prisma.includes(action) && seed.includes(action)))
add('operation policies classify request state and immutable evidence', policies.entities.some((item) => item.model === 'DataRightsRequest' && item.policy === 'state_transition') && contract.models.slice(1).every((model) => policies.entities.some((item) => item.model === model && item.policy === 'immutable_evidence' && item.hardDelete === false)))
const identityAsset = governance.dataAssets.find((item) => item.id === 'identity_account_profile')
add('data governance inventories every lifecycle model', contract.models.every((model) => identityAsset?.prismaModels.includes(model)))
add('governance distinguishes implementation from production rehearsal', governance.runtimeStatus.accountExportImplemented === true && governance.runtimeStatus.accountDeletionImplemented === true && governance.runtimeStatus.backupDeletionRehearsed === false)
add('owner UI requires explicit handle confirmation and exposes history/download', ['Data rights identity confirmation', 'Request export', 'Download export', 'Cancel request'].every((label) => profileUi.includes(label)))
add('Admin UI exposes metrics processing and backup evidence', ['Data rights requests', 'Processing reason code', 'Backup object hash', 'Record evidence'].every((label) => adminUi.includes(label)))
add('runbook exists', fs.existsSync(path.join(root, 'docs/DATA_RIGHTS_LIFECYCLE.md')))
add('focused package gate exists', packageJson.scripts['test:data-rights-lifecycle']?.includes('verify-data-rights-lifecycle.mjs'))
add('integration package gate exists', packageJson.scripts['test:data-rights-lifecycle:integration']?.includes('prismaDataRights.integration.test.js'))
add('quick precheck includes LEGAL-02', packageJson.scripts['precheck:quick']?.includes('test:data-rights-lifecycle'))

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) {
  console.error(`Data rights lifecycle verification failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else {
  console.log(`Data rights lifecycle verified: ${checks.length} checks`)
}
