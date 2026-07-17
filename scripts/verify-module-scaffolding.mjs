import fs from 'node:fs'
import path from 'node:path'

import { generateModule, loadScaffoldingContract, readModuleSpec } from './lib/module-scaffolding.mjs'

const root = process.cwd()
const contract = loadScaffoldingContract(root)
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const checks = []
const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })

add('DX-01 schema is supported', contract.schemaVersion === 1, `schemaVersion=${contract.schemaVersion}`)
add('scaffolding remains personal-account scoped', contract.scope === 'personal_accounts_only', contract.scope)
add('template ids are unique', new Set(contract.templates).size === contract.templates.length, `${contract.templates.length} template(s)`)
add('operation policies are closed', contract.operationPolicies.length === 6 && new Set(contract.operationPolicies).size === 6, contract.operationPolicies.join(', '))
add('all shared-account model names are denied', ['tenant', 'organization', 'team', 'workspace', 'membership', 'invitation'].every((token) => contract.forbiddenScopeTokens.includes(token)), contract.forbiddenScopeTokens.join(', '))
for (const template of contract.templates) add(`template exists: ${template}`, fs.existsSync(path.join(root, contract.templateRoot, template)), template)
for (const artifact of [contract.exampleSpec, contract.policyDocument, 'scripts/scaffold-module.mjs', 'scripts/check-module-completion.mjs', 'scripts/lib/module-scaffolding.mjs']) {
  add(`DX-01 artifact exists: ${artifact}`, fs.existsSync(path.join(root, artifact)), artifact)
}

try {
  const plan = generateModule({ repositoryRoot: root, spec: readModuleSpec(path.join(root, contract.exampleSpec)), dryRun: true })
  add('example spec plans a complete skeleton', plan.artifacts.length === contract.templates.length + 1, `${plan.artifacts.length} artifact(s)`)
  add('dry run includes a machine-readable module definition', plan.artifacts.includes(plan.manifestPath), plan.manifestPath)
} catch (error) {
  add('example spec passes generator validation', false, error instanceof Error ? error.message : String(error))
}

add('package exposes module generator', packageJson.scripts['scaffold:module'] === contract.generatorCommand, packageJson.scripts['scaffold:module'])
add('package exposes module completion checker', packageJson.scripts['check:module'] === contract.completionCommand, packageJson.scripts['check:module'])
add('package exposes DX-01 gate', packageJson.scripts['test:module-scaffolding'] === 'node scripts/verify-module-scaffolding.mjs && node --test scripts/module-scaffolding.test.mjs', packageJson.scripts['test:module-scaffolding'])
add('quick gate includes DX-01', packageJson.scripts['check:quick'].includes('npm run test:module-scaffolding'), 'check:quick')

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) {
  console.error(`Module scaffolding verification failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else {
  console.log(`Module scaffolding verified: ${checks.length} checks, ${contract.templates.length} templates`)
}
