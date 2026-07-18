import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const json = (file) => JSON.parse(read(file))
const contract = json('config/notification-templates-preferences-contract.json')
const packageJson = json('package.json')
const schema = read('server/prisma/schema.prisma')
const migration = read(`server/prisma/migrations/${contract.migration}/migration.sql`)
const routes = read('server/src/modules/notifications/routes.js')
const domain = read('server/src/notifications/notificationTemplates.js')
const seed = read('server/src/notifications/seedNotificationManagementRepository.js')
const prisma = read('server/src/notifications/prismaNotificationManagementRepository.js')
const prismaRepository = read('server/src/repositories/prismaRepository.js')
const openapi = read('server/src/docs/openapi.js')
const adminUi = read('src/features/admin/NotificationAdminPanel.tsx')
const preferenceUi = read('src/components/ui/NotificationPreferences.tsx')
const permissions = read('server/src/auth/permissions.js')

const checks = []
const add = (name, pass) => checks.push({ name, pass: Boolean(pass) })
add('contract is NOTIFY-01 personal-account scope', contract.task === 'NOTIFY-01' && contract.scope === 'personal_accounts_only')
for (const model of ['NotificationTemplate', 'NotificationTemplateVersion', 'NotificationPreference']) add(`${model} is modeled`, schema.includes(`model ${model}`))
add('notification rendering evidence is modeled', schema.includes('templateKey') && schema.includes('templateVersion'))
add('migration creates template and preference storage', ['notification_templates', 'notification_template_versions', 'notification_preferences'].every((marker) => migration.includes(marker)))
add('closed typed variable validation is enforced', domain.includes('additionalProperties: false') && domain.includes('INVALID_NOTIFICATION_VARIABLES'))
add('seed and Prisma support publish and rollback', [seed, prisma].every((source) => source.includes('publishTemplate') && source.includes('rollbackTemplate')))
add('all Prisma notification creation checks preferences', prismaRepository.includes('disabledUserIds') && prismaRepository.includes('notificationPreference.findMany'))
add('Admin UI supports lifecycle operations', ['Save draft', 'publishNotificationTemplate', 'rollbackNotificationTemplate', 'archiveNotificationTemplate', 'exportNotificationTemplates'].every((marker) => adminUi.includes(marker)))
add('user UI supports in-app toggles', preferenceUi.includes('setPreference') && preferenceUi.includes('inAppEnabled'))
for (const route of [...contract.userRoutes, ...contract.adminRoutes]) {
  add(`${route.method} ${route.path} is implemented`, routes.includes(`router.add('${route.method}', '${route.path}'`))
  const documented = route.path.replace('/api', '').replace(/:([A-Za-z]+)/g, '{$1}')
  add(`${route.method} ${route.path} is documented`, openapi.includes(`'${documented}'`))
}
for (const permission of Object.values(contract.permissions)) add(`${permission} is registered`, permissions.includes(`'${permission}'`))
add('runbook exists', fs.existsSync(path.join(root, 'docs/NOTIFICATION_TEMPLATES_AND_PREFERENCES.md')))
add('focused package gate exists', packageJson.scripts['test:notification-templates-preferences']?.includes('verify-notification-templates-preferences.mjs'))
add('integration package gate exists', packageJson.scripts['test:notification-templates-preferences:integration']?.includes('prismaNotificationManagement.integration.test.js'))
add('quick gate includes NOTIFY-01', packageJson.scripts['check:quick']?.includes('npm run test:notification-templates-preferences'))

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) {
  console.error(`Notification templates/preferences verification failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else console.log(`Notification templates/preferences verified: ${checks.length} checks`)
