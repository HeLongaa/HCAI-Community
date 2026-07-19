import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const json = (file) => JSON.parse(read(file))
const contract = json('config/account-generation-risk-contract.json')
const schema = read('server/prisma/schema.prisma')
const migration = read('server/prisma/migrations/0090_account_generation_risk_controls/migration.sql')
const operations = read('server/src/risk/riskOperations.js')
const prisma = read('server/src/risk/prismaRiskRepository.js')
const seed = read('server/src/risk/seedRiskRepository.js')
const routes = read('server/src/modules/risk/routes.js')
const authRoutes = read('server/src/modules/auth/routes.js')
const creativeRoutes = read('server/src/modules/creative/routes.js')
const permissions = read('server/src/auth/permissions.js')
const openapi = read('server/src/docs/openapi.js')
const policies = json('config/entity-operation-policies.json')
const governance = json('config/v1-data-governance.json')
const audit = json('config/admin-mutation-audit.json')
const listQueries = json('config/list-query-contract.json')
const adminResources = json('config/admin-resource-framework-contract.json')
const maturity = json('config/module-maturity-baseline.json')
const packageJson = json('package.json')
const adminPanel = read('src/features/admin/RiskAdminPanel.tsx')
const ownerPanel = read('src/features/profile/RiskCasePanel.tsx')
const documentationPath = 'docs/ACCOUNT_GENERATION_RISK_CONTROLS.md'
const documentation = read(documentationPath)

const checks = []
const add = (name, pass) => checks.push({ name, pass: Boolean(pass) })
add('contract is RISK-01 personal account scope', contract.task === 'RISK-01' && contract.scope === 'personal_accounts_only')
for (const model of Object.values(contract.models).filter((value) => !value.startsWith('0090_'))) add(`${model} model exists`, schema.includes(`model ${model} {`))
add('migration creates policy, signals, cases, events, appeals, indexes, and permissions', ['risk_policies', 'risk_signals', 'risk_cases', 'risk_disposition_events', 'risk_appeals', 'admin:risk:read'].every((value) => migration.includes(value)))
add('signals and dispositions are closed sets', contract.signals.every((value) => operations.includes(`'${value}'`)) && contract.dispositions.every((value) => operations.includes(`'${value}'`)))
add('cases use explicit state transition validation', operations.includes('assertRiskTransition') && operations.includes('transitionTargets'))
add('signals are deduplicated and source references are hashed', prisma.includes('dedupeKey') && prisma.includes('sourceRefHash') && prisma.includes("createHash('sha256')"))
add('active cases only escalate dispositions and retain system evidence', [prisma, seed].every((source) => source.includes('dispositionPriority') && source.includes('strongerValue') && source.includes('escalated')))
add('appeals persist hash without raw statement', operations.includes('statementHash') && operations.includes('statementPreview: null') && !schema.includes('rawStatement'))
add('login path evaluates and blocks account restrictions', authRoutes.includes('evaluateLogin') && authRoutes.includes('throwRiskRestriction') && authRoutes.includes("capability: 'login'"))
add('refresh path revokes rotated sessions when account restriction is active', authRoutes.includes('const refreshedAccount = session?.user ?? account') && authRoutes.includes("revokeSession?.(session.refreshToken, 'risk_account_restricted')"))
const generationPost = creativeRoutes.slice(creativeRoutes.indexOf("router.add('POST', '/api/creative/generations'"))
add('generation path evaluates before request parsing and Provider dispatch', generationPost.indexOf('evaluateGeneration') >= 0 && generationPost.indexOf('evaluateGeneration') < generationPost.indexOf('parseCreateCreativeGenerationRequest') && generationPost.includes('restriction.code'))
add('Prisma and Seed repositories expose policy, detection, cases, appeals, transitions, metrics', ['getPolicy', 'updatePolicy', 'evaluateLogin', 'evaluateGeneration', 'restrictionFor', 'appeal', 'transition', 'metrics'].every((value) => prisma.includes(`${value}:`) && seed.includes(`${value}:`)))
for (const route of contract.routes) {
  add(`${route.method} ${route.path} implemented`, routes.includes(`router.add('${route.method}', '${route.path}'`))
  add(`${route.method} ${route.path} documented`, openapi.includes(`'${route.path.replace('/api', '').replaceAll(':id', '{id}')}'`))
}
for (const permission of contract.permissions) add(`${permission} is registered`, permissions.includes(`'${permission}'`))
const expectedPolicies = { RiskPolicy: 'mutable_crud', RiskSignal: 'append_only', RiskCase: 'state_transition', RiskCaseSignal: 'append_only', RiskDispositionEvent: 'append_only', RiskAppeal: 'append_only' }
add('all risk entities have operation policies', Object.entries(expectedPolicies).every(([model, policy]) => policies.entities.some((entry) => entry.model === model && entry.policy === policy)))
add('risk data governance is restricted and complete', governance.dataAssets.some((asset) => asset.id === 'account_generation_risk_records' && Object.keys(expectedPolicies).every((model) => asset.prismaModels.includes(model))))
add('risk policy and transition mutations are domain audited', ['/api/admin/risk/policy', '/api/admin/risk/cases/:id/transitions'].every((route) => audit.routes.some((item) => item.path === route && item.mode === 'domain_audited')))
add('user and Admin case lists are cursor registered', ['personalRiskCases', 'adminRiskCases'].every((id) => listQueries.resources.some((resource) => resource.id === id && resource.cursor)))
add('risk policy, cases, and signals are registered Admin resources', ['RiskPolicy', 'RiskCase', 'RiskSignal'].every((model) => adminResources.resources.some((resource) => resource.model === model && resource.routeGroup === 'risk')))
add('owner and Admin UI expose risk operations', ownerPanel.includes('data-testid="profile-risk-cases"') && ownerPanel.includes('riskService.appeal') && adminPanel.includes('data-testid="risk-admin-panel"') && adminPanel.includes('transitionRiskCase') && adminPanel.includes('exportRiskCases'))
add('risk control documentation covers enforcement, privacy, and operations', documentation.includes('## Enforcement Points') && documentation.includes('## Privacy Boundary') && documentation.includes('## Operations And Recovery'))
add('module maturity records RISK-01 evidence without an open RISK-01 gap', maturity.modules.some((module) => module.id === 'trust-safety-risk' && module.evidence.includes(documentationPath) && !module.gapTasks.includes('RISK-01')))
add('package exposes focused and integration gates', packageJson.scripts['test:account-generation-risk']?.includes('verify-account-generation-risk.mjs') && packageJson.scripts['test:account-generation-risk:integration']?.includes('prismaAccountGenerationRisk.integration.test.js'))
add('quick gate includes RISK-01', packageJson.scripts['check:quick']?.includes('npm run test:account-generation-risk'))

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) {
  console.error(`Account and generation risk verification failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else {
  console.log(`Account and generation risk verified: ${checks.length} checks`)
}
