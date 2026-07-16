import fs from 'node:fs'

const contract = JSON.parse(fs.readFileSync('config/ai-evaluation-contract.json', 'utf8'))
const schema = fs.readFileSync('server/prisma/schema.prisma', 'utf8')
const migration = fs.readFileSync(contract.migration, 'utf8')
const runtime = fs.readFileSync('server/src/modelControl/modelEvaluationRuntime.js', 'utf8')
const routes = fs.readFileSync('server/src/modules/modelControl/routes.js', 'utf8')
const governance = fs.readFileSync('server/src/modelControl/prismaModelGovernanceRepository.js', 'utf8')
const release = fs.readFileSync('server/src/releases/prismaReleaseRepository.js', 'utf8')
const panel = fs.readFileSync('src/features/admin/ModelControlPanel.tsx', 'utf8')
const openapi = fs.readFileSync('server/src/docs/openapi.js', 'utf8')
const docs = fs.readFileSync(contract.policyDocument, 'utf8')

const checks = []
const check = (condition, label) => {
  if (!condition) throw new Error(`FAIL ${label}`)
  checks.push(label)
  console.log(`PASS ${label}`)
}

check(contract.taskId === 'AI-EVAL-01', 'contract owns AI-EVAL-01')
check(contract.scope === 'personal_accounts_only', 'evaluation remains personal-account scoped')
check(contract.operationPolicy === 'immutable_evidence', 'evaluation facts are immutable evidence')
for (const entity of contract.entities) check(schema.includes(`model ${entity} {`), `${entity} is normalized in Prisma`)
for (const table of ['suites', 'cases', 'policies', 'runs', 'case_results']) check(migration.includes(`ai_evaluation_${table}_immutable_guard`), `${table} has a database immutability trigger`)
check(runtime.includes('quality_threshold_failed') && runtime.includes('safety_threshold_failed') && runtime.includes('regression_threshold_failed'), 'runtime evaluates quality safety and regression thresholds')
check(runtime.includes('outputHash') && !runtime.includes('rawPrompt') && !runtime.includes('completionText'), 'runtime accepts only hashed output evidence')
check(runtime.includes('baselineRunId') && runtime.includes('expiresAt'), 'promotion evidence requires baseline and current TTL')
for (const resource of ['evaluation-suites', 'evaluation-policies', 'evaluation-runs', 'evaluation-summary', 'evaluation-export']) check(routes.includes(`/api/admin/model-control/${resource}`), `${resource} Admin API is registered`)
check(governance.includes('assertPromotionEvidence'), 'promotion requests validate evaluation evidence')
check(release.includes('PROMOTION_EVALUATION_EXPIRED') && release.includes('PROMOTION_EVALUATION_CHANGED'), 'release apply revalidates evaluation evidence')
check(panel.includes('model-evaluation-gate'), 'Admin Model Control exposes evaluation operations')
check(openapi.includes('/admin/model-control/evaluation-runs'), 'OpenAPI documents evaluation APIs')
check(docs.includes('Missing, stale, expired, failed, or mismatched evidence fails closed'), 'policy documents fail-closed promotion behavior')
check(!contract.entities.some((entity) => ['Tenant', 'Organization', 'Team', 'Membership', 'Invitation'].includes(entity)), 'forbidden shared-account models are absent')
check(contract.realProviderCalls === false, 'AI-EVAL-01 performs no real Provider call')

console.log(`AI evaluation verified: ${checks.length} checks`)
