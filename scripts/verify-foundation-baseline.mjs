import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const manifestPath = path.join(root, 'config/module-maturity-baseline.json')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const checks = []

const addCheck = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail })
const unique = (values) => new Set(values).size === values.length
const nonEmptyStrings = (values) => Array.isArray(values) && values.length > 0 && values.every((value) => typeof value === 'string' && value.trim())

addCheck('baseline schema is supported', manifest.schemaVersion === 1, `schemaVersion=${manifest.schemaVersion}`)
addCheck('baseline is personal-account scoped', manifest.scope === 'personal_accounts_only', manifest.scope)
addCheck('baseline ids are unique', unique(manifest.modules.map((module) => module.id)), `${manifest.modules.length} module(s)`)
addCheck('all maturity levels are closed', manifest.maturityLevels.length === 4 && unique(manifest.maturityLevels), manifest.maturityLevels.join(', '))
addCheck('all operation policies are closed', manifest.operationPolicies.length === 6 && unique(manifest.operationPolicies), manifest.operationPolicies.join(', '))
addCheck('human baseline exists', fs.existsSync(path.join(root, manifest.policyDocument)), manifest.policyDocument)

for (const module of manifest.modules) {
  addCheck(`${module.id} has a known maturity`, manifest.maturityLevels.includes(module.maturity), module.maturity)
  addCheck(`${module.id} has a task owner`, typeof module.ownerTask === 'string' && module.ownerTask.length > 0, module.ownerTask)
  addCheck(`${module.id} has user capability truth`, nonEmptyStrings(module.userCapabilities), `${module.userCapabilities?.length ?? 0} item(s)`)
  addCheck(`${module.id} has Admin capability truth`, nonEmptyStrings(module.adminCapabilities), `${module.adminCapabilities?.length ?? 0} item(s)`)
  addCheck(
    `${module.id} has valid operation policies`,
    nonEmptyStrings(module.operationPolicies) && module.operationPolicies.every((policy) => manifest.operationPolicies.includes(policy)),
    module.operationPolicies?.join(', '),
  )
  addCheck(`${module.id} has owned gaps`, nonEmptyStrings(module.gapTasks), module.gapTasks?.join(', '))
  addCheck(`${module.id} evidence exists`, nonEmptyStrings(module.evidence) && module.evidence.every((file) => fs.existsSync(path.join(root, file))), module.evidence?.join(', '))
}

const forbiddenScopeTokens = ['tenant', 'organization', 'membership', 'invitation']
const serialized = JSON.stringify(manifest).toLowerCase()
const forbiddenHits = forbiddenScopeTokens.filter((token) => serialized.includes(token))
addCheck('baseline introduces no shared-account model', forbiddenHits.length === 0, forbiddenHits.join(', ') || 'personal accounts only')
addCheck(
  'package exposes the foundation baseline gate',
  packageJson.scripts['test:foundation-baseline'] === 'node scripts/verify-foundation-baseline.mjs',
  packageJson.scripts['test:foundation-baseline'],
)
addCheck(
  'quick gate includes the foundation baseline',
  packageJson.scripts['check:quick'].includes('npm run test:foundation-baseline'),
  packageJson.scripts['check:quick'],
)

for (const check of checks) {
  console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
}

const failures = checks.filter((check) => !check.pass)
if (failures.length > 0) {
  console.error(`Foundation baseline verification failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else {
  console.log(`Foundation baseline verified: ${checks.length} checks across ${manifest.modules.length} modules`)
}
