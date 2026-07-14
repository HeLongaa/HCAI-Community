import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const manifest = JSON.parse(read('config/v1-task-marketplace-lifecycle.json'))
const packageJson = JSON.parse(read('package.json'))
const taskRoutes = read('server/src/modules/tasks/routes.js')
const seedRepository = read('server/src/repositories/seedRepository.js')
const prismaRepository = read('server/src/repositories/prismaRepository.js')
const lifecycle = read('server/src/tasks/taskLifecycle.js')
const taskPage = read('src/features/tasks/TaskPages.tsx')
const adminPage = read('src/features/admin/AdminPage.tsx')
const releaseScope = JSON.parse(read('config/v1-release-scope.json'))

const checks = []
const add = (name, passed, detail = '') => checks.push({ name, passed: Boolean(passed), detail })

add('manifest version is frozen', manifest.version === 'task-marketplace-lifecycle-v1')
add('RMB payment and withdrawal remain excluded', manifest.scope.excluded.includes('rmb_payment') && manifest.scope.excluded.includes('withdrawal'))
add('all required lifecycle operations are cataloged', [
  'claim', 'propose', 'accept_proposal', 'submit', 'request_changes', 'approve_submission',
  'reject_submission', 'mark_stale', 'open_dispute', 'approve_dispute', 'reject_dispute',
].every((operation) => manifest.transitions.some((item) => item.operation === operation)))
add('task workflow endpoint exists', taskRoutes.includes("'/api/tasks/:id/workflow'"))
add('server action eligibility is centralized', lifecycle.includes('taskLifecycleActions') && seedRepository.includes('taskWorkflowDto') && prismaRepository.includes('taskWorkflowDto'))
add('Seed repository has explicit lifecycle conflicts', ['TASK_PROPOSAL_ALREADY_EXISTS', 'TASK_SUBMISSION_ALREADY_PENDING', 'TASK_DISPUTE_ALREADY_OPEN', 'TASK_NOT_REVIEWABLE'].every((code) => seedRepository.includes(code)))
add('Prisma repository has conditional concurrency guards', prismaRepository.includes('updateMany') && prismaRepository.includes('TASK_REVIEW_CONFLICT') && prismaRepository.includes('TASK_DISPUTE_ALREADY_OPEN'))
add('Admin task dispute resolution is wired in both repositories', seedRepository.includes("reviewed.metadata?.kind === 'task_dispute'") && prismaRepository.includes("metadata.kind === 'task_dispute'"))
add('task UI has no demo proposal or submission records', !taskPage.includes('demo-proposal-') && !taskPage.includes('demo-submission-'))
add('Admin review queue has no fallback review records', !adminPage.includes('fallback-review-'))
add('package exposes V1-64 verifier', packageJson.scripts['test:v1-task-marketplace'] === 'node scripts/verify-v1-task-marketplace-lifecycle.mjs')
add('quick gate includes V1-64 verifier', packageJson.scripts['check:quick']?.includes('npm run test:v1-task-marketplace'))
const taskDomain = releaseScope.includedDomains.find((domain) => domain.id === 'task-marketplace')
add('release scope points to the V1-64 gate', taskDomain?.verificationCommand === 'npm run test:v1-task-marketplace')

for (const check of checks) {
  console.log(`${check.passed ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? `: ${check.detail}` : ''}`)
}

const failures = checks.filter((check) => !check.passed)
console.log(`\n${checks.length - failures.length}/${checks.length} V1 task marketplace lifecycle checks passed.`)
if (failures.length > 0) process.exitCode = 1
