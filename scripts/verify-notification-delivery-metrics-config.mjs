import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const json = (file) => JSON.parse(read(file))
const contract = json('config/notification-delivery-metrics-config-contract.json')
const schema = read('server/prisma/schema.prisma')
const migration = read('server/prisma/migrations/0084_notification_delivery_metrics_config/migration.sql')
const domain = read('server/src/notifications/notificationDeliveries.js')
const seed = read('server/src/notifications/seedNotificationDeliveryRepository.js')
const prisma = read('server/src/notifications/prismaNotificationDeliveryRepository.js')
const routes = read('server/src/modules/notifications/routes.js')
const openapi = read('server/src/docs/openapi.js')
const permissions = read('server/src/auth/permissions.js')
const ui = read('src/features/admin/NotificationDeliveryAdminPanel.tsx')
const services = read('src/services/adminService.ts')
const policies = json('config/entity-operation-policies.json')
const governance = json('config/v1-data-governance.json')
const mutations = json('config/admin-mutation-audit.json')
const packageJson = json('package.json')

const checks = []
const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })
add('contract is NOTIFY-03 personal-account scope', contract.task === 'NOTIFY-03' && contract.scope === 'personal_accounts_only')
for (const model of ['NotificationChannelConfig', 'NotificationChannelConfigRevision']) add(`${model} is modeled`, schema.includes(`model ${model}`))
add('migration installs bounded channel controls and revisions', migration.includes('notification_channel_configs_threshold_check') && migration.includes('notification_channel_config_revisions_values_check'))
add('database keeps in-app enabled and revision facts immutable', migration.includes('notification_channel_configs_core_check') && migration.includes('notification_channel_config_revisions_immutable_update') && migration.includes('notification_channel_config_revisions_immutable_delete'))
add('metric query is bounded to 366 days', domain.includes('metrics window cannot exceed 366 days') && contract.invariants.maximumWindowDays === 366)
add('metrics calculate basis-point rates and P50/P95 latency', domain.includes('deliveryRateBps') && domain.includes('failureRateBps') && domain.includes('p50Ms') && domain.includes('p95Ms'))
add('Prisma metrics use server-side aggregate SQL', prisma.includes('PERCENTILE_CONT(0.95)') && prisma.includes('COUNT(*) FILTER'))
add('seed and Prisma runtime consult persisted channel controls', seed.includes("channelConfigs.get('email')") && prisma.includes('notificationChannelConfig.findMany'))
add('email enablement remains environment gated', domain.includes('environmentAvailable') && seed.includes('emailConfig.available') && contract.invariants.emailRequiresEnvironmentAvailability)
add('configuration uses CAS and immutable append-only revisions', seed.includes('activeRevisionNumber + 1') && prisma.includes('notificationChannelConfig.updateMany') && prisma.includes('notificationChannelConfigRevision.create'))
add('rollback appends a new revision', seed.includes('rollbackChannelConfig') && prisma.includes('rollbackChannelConfig') && contract.invariants.rollbackAppendsRevision)
for (const route of contract.routes) {
  add(`${route.method} ${route.path} is implemented`, routes.includes(`router.add('${route.method}', '${route.path}'`))
  add(`${route.method} ${route.path} is documented`, openapi.includes(`'${route.path.replace('/api', '').replaceAll(':channel', '{channel}')}'`))
}
add('notification permissions protect reads and mutations', permissions.includes(`'${contract.permissions.read}'`) && permissions.includes(`'${contract.permissions.manage}'`))
add('channel mutations are centrally audit classified', mutations.routes.some((entry) => entry.path === '/api/admin/notifications/channels/:channel') && mutations.routes.some((entry) => entry.path.endsWith('/channels/:channel/rollback')))
add('operation policies cover mutable controls and immutable revisions', policies.entities.some((entry) => entry.model === 'NotificationChannelConfig' && entry.policy === 'mutable_crud') && policies.entities.some((entry) => entry.model === 'NotificationChannelConfigRevision' && entry.policy === 'immutable_evidence'))
add('data governance covers channel configuration evidence', governance.dataAssets.some((entry) => entry.prismaModels?.includes('NotificationChannelConfigRevision')))
add('Admin UI covers queue metrics channels thresholds and rollback', ['Metrics', 'Channels', 'deliveryRateTargetBps', 'failureRateAlertThresholdBps', 'rollbackNotificationChannelConfig'].every((marker) => ui.includes(marker) || services.includes(marker)))
add('policy document exists', fs.existsSync(path.join(root, 'docs/NOTIFICATION_DELIVERY_METRICS_CONFIG.md')))
add('focused and integration gates exist', packageJson.scripts['test:notification-delivery-metrics-config']?.includes('verify-notification-delivery-metrics-config.mjs') && packageJson.scripts['test:notification-delivery-metrics-config:integration']?.includes('prismaNotificationDeliveryMetrics.integration.test.js'))
add('quick gate includes NOTIFY-03', packageJson.scripts['precheck:quick']?.includes('npm run test:notification-delivery-metrics-config'))

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) {
  console.error(`Notification delivery metrics/config verification failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else {
  console.log(`Notification delivery metrics/config verified: ${checks.length} checks`)
}
