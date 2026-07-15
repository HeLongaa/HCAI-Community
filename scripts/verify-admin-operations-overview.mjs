import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const contract = JSON.parse(read('config/admin-operations-overview-contract.json'))
const implementation = read(contract.implementationPath)
const routes = read('server/src/modules/admin/routes.js')
const parsers = read('server/src/contracts/requestParsers.js')
const frontend = read(contract.frontendPath)
const packageJson = JSON.parse(read('package.json'))
const checks = []
const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })

add('contract schema is supported', contract.schemaVersion === 1, `schemaVersion=${contract.schemaVersion}`)
add('contract is personal-account scoped', contract.scope === 'personal_accounts_only', contract.scope)
add('overview is read-only', contract.constraints.readOnly && !contract.constraints.newPersistenceModels, JSON.stringify(contract.constraints))
add('real Provider calls remain disabled', contract.constraints.realProviderCalls === false, 'realProviderCalls=false')
add('search covers at least eight resource types', contract.searchTypes.length >= 8, `${contract.searchTypes.length} type(s)`)
add('search types are unique', new Set(contract.searchTypes).size === contract.searchTypes.length, contract.searchTypes.join(','))
add('runtime search registry matches contract', contract.searchTypes.every((type) => implementation.includes(`'${type}'`)), 'search registry')
add('safe projection omits raw records', implementation.includes('safeLoad') && implementation.includes('project:'), 'safe projections')
add('overview route exists', routes.includes("'/api/admin/overview'"), contract.routes.overview)
add('search route exists', routes.includes("'/api/admin/search'"), contract.routes.search)
add('both routes require Admin access', (routes.match(/requirePermission\(context, 'admin:access'\)/g) ?? []).length >= 2, 'admin:access')
add('search query bounds are parsed', parsers.includes('q must be between 2 and 80 characters'), '2-80 characters')
add('search result limit is bounded', parsers.includes('limit must be an integer between 1 and 20'), '1-20 results')
add('frontend supports overview deep links', frontend.includes('overviewResourceType') && frontend.includes('overviewResourceId'), 'deep links')
add('policy document exists', fs.existsSync(path.join(root, contract.policyDocument)), contract.policyDocument)
add('package exposes ADMIN-03 gate', packageJson.scripts['test:admin-operations-overview']?.includes('verify-admin-operations-overview.mjs'), packageJson.scripts['test:admin-operations-overview'])
add('quick gate includes ADMIN-03 gate', packageJson.scripts['check:quick'].includes('npm run test:admin-operations-overview'), 'check:quick')

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) {
  console.error(`Admin operations overview verification failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else {
  console.log(`Admin operations overview verified: ${checks.length} checks, ${contract.searchTypes.length} search types`)
}
