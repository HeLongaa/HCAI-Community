import fs from 'node:fs'
import path from 'node:path'
import { parseServerRoutes } from './route-contract-utils.mjs'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const contract = JSON.parse(read('config/support-ticket-operations-contract.json'))
const schema = read('server/prisma/schema.prisma')
const migration = read('server/prisma/migrations/0087_support_ticket_sla_operations/migration.sql')
const runtime = read('server/src/support/supportOperations.js')
const prismaRepo = read('server/src/support/prismaSupportRepository.js')
const routes = new Set(parseServerRoutes(root, 'server/src/modules').map((route) => route.key))
const permissions = read('server/src/auth/permissions.js')
const openapi = read('server/src/docs/openapi.js')
const ui = read('src/features/admin/SupportAdminPanel.tsx')
const checks = []
const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })

add('contract is personal-account scoped', contract.scope === 'personal_accounts_only', contract.scope)
for (const model of contract.models) add(`${model} has a dedicated Prisma model`, schema.includes(`model ${model} {`), model)
add('support migration removes legacy support AdminReview rows after transfer', migration.includes('INSERT INTO "support_tickets"') && migration.includes('DELETE FROM "admin_reviews"') && migration.indexOf('DELETE FROM "admin_reviews"') > migration.indexOf('INSERT INTO "support_tickets"'))
add('support ticket owns assignment version and SLA timestamps', ['assignedToId', 'firstResponseDueAt', 'resolutionDueAt', 'firstRespondedAt', 'version'].every((field) => schema.includes(field)))
add('messages and case links are append-only relations', schema.includes('messages   SupportTicketMessage[]') && schema.includes('caseLinks  SupportTicketCaseLink[]'))
for (const route of [...contract.userRoutes, ...contract.adminRoutes]) add(`${route} exists`, routes.has(route), route)
for (const permission of contract.permissions) add(`${permission} is registered`, permissions.includes(`'${permission}'`), permission)
add('owner isolation is enforced in Prisma reads and writes', prismaRepo.includes('requesterId: actor.id') && prismaRepo.includes('requesterId: actor.id, version: payload.expectedVersion'))
add('all mutable operations use optimistic versions', (prismaRepo.match(/payload\.expectedVersion/g) ?? []).length >= 5)
add('support state transitions are explicit and fail closed', runtime.includes('allowedTransitions') && runtime.includes('SUPPORT_TRANSITION_NOT_ALLOWED'))
add('sensitive support content is rejected', runtime.includes('sensitiveSupportPattern') && runtime.includes('SENSITIVE_SUPPORT_CONTENT'))
add('audit payloads omit free-form request and message bodies', !/recordAudit\([\s\S]{0,500}details/.test(prismaRepo) && !/recordAudit\([\s\S]{0,500}payload\.message/.test(prismaRepo))
add('Admin list supports all declared filters and sorts', contract.listQuery.filters.every((filter) => runtime.includes(filter)) && contract.listQuery.sorts.every((sort) => runtime.includes(sort)))
add('SLA states and urgent targets are derived', contract.slaStates.every((state) => runtime.includes(`'${state}'`)) && runtime.includes('firstResponseHours: 4'))
add('OpenAPI documents user and Admin support operations', ['/support/requests/{id}/messages', '/admin/support/tickets', '/admin/support/metrics'].every((route) => openapi.includes(`'${route}'`)))
add('Admin UI covers search assignment SLA reply lifecycle and case links', ['Search tickets', 'Assignee user ID', 'Due soon', 'Reply to requester', 'Case ID'].every((label) => ui.includes(label)))

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) { console.error(`Support ticket operations failed: ${failures.length} check(s)`); process.exitCode = 1 }
else console.log(`Support ticket operations verified: ${checks.length} checks`)
