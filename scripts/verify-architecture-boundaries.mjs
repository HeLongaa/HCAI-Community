import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/domain-boundaries.json'), 'utf8'))
const baseline = JSON.parse(fs.readFileSync(path.join(root, 'config/module-maturity-baseline.json'), 'utf8'))
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const moduleIndex = fs.readFileSync(path.join(root, 'server/src/modules/index.js'), 'utf8')
const checks = []
const add = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail })
const unique = (values) => new Set(values).size === values.length

add('contract schema is supported', contract.schemaVersion === 1, `schemaVersion=${contract.schemaVersion}`)
add('contract is personal-account scoped', contract.scope === 'personal_accounts_only', contract.scope)
add('layer ids are unique', unique(contract.layers), contract.layers.join(', '))
add('every layer has one dependency rule', unique(contract.dependencyRules.map((rule) => rule.from)) && contract.dependencyRules.length === contract.layers.length, `${contract.dependencyRules.length} rule(s)`)
add('domain layer is dependency free', contract.dependencyRules.find((rule) => rule.from === 'domain')?.mayDependOn.length === 0, 'domain')
add('decision document exists', fs.existsSync(path.join(root, contract.decisionDocument)), contract.decisionDocument)
add('route module ids are unique', unique(contract.routeModules.map((module) => module.id)), `${contract.routeModules.length} module(s)`)

const knownDomains = new Set(baseline.modules.map((module) => module.id))
for (const module of contract.routeModules) {
  add(`${module.id} maps to a known domain`, knownDomains.has(module.domain), module.domain)
  add(`${module.id} uses a known layer`, contract.layers.includes(module.layer), module.layer)
  add(`${module.id} registration exists`, moduleIndex.includes(module.registration), module.registration)
}

const registrations = [...moduleIndex.matchAll(/\b(register[A-Z][A-Za-z]+Routes)\(router\)/g)].map((match) => match[1])
add('all registered route modules are inventoried', registrations.every((name) => contract.routeModules.some((module) => module.registration === name)), registrations.join(', '))
add('all ownership domains are known', contract.ownership.every((entry) => knownDomains.has(entry.domain)), contract.ownership.map((entry) => entry.domain).join(', '))
add('ownership domains are unique', unique(contract.ownership.map((entry) => entry.domain)), `${contract.ownership.length} owner(s)`)
add('cross-module rules are complete', ['synchronous', 'asynchronous', 'reads', 'writes', 'shared'].every((key) => contract.crossModuleRules[key]), Object.keys(contract.crossModuleRules).join(', '))
add('package exposes architecture gate', packageJson.scripts['test:architecture-boundaries'] === 'node scripts/verify-architecture-boundaries.mjs', packageJson.scripts['test:architecture-boundaries'])
add('quick gate includes architecture gate', packageJson.scripts['check:quick'].includes('npm run test:architecture-boundaries'), packageJson.scripts['check:quick'])

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) {
  console.error(`Architecture boundary verification failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else {
  console.log(`Architecture boundaries verified: ${checks.length} checks across ${contract.routeModules.length} route modules`)
}
