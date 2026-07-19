import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const contract = JSON.parse(read('config/oauth-admin-operations-contract.json'))
const packageJson = JSON.parse(read('package.json'))
const schema = read('server/prisma/schema.prisma')
const migration = read('server/prisma/migrations/0063_oauth_admin_operations/migration.sql')
const configurationMigration = read('server/prisma/migrations/0070_google_github_oauth_configuration/migration.sql')
const permissionMigration = read('server/prisma/migrations/0064_oauth_admin_permission_grants/migration.sql')
const routes = read('server/src/modules/oauthAdmin/routes.js')
const publicRoutes = read('server/src/modules/auth/routes.js')
const runtime = read('server/src/auth/oauthAdminOperations.js')
const permissions = read('server/src/auth/permissions.js')
const openapi = read('server/src/docs/openapi.js')
const preflight = read('scripts/check-oauth-provider-readiness.mjs')

const checks = []
const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })

add('contract schema is supported', contract.schemaVersion === 1, `schemaVersion=${contract.schemaVersion}`)
add('scope is limited to supported personal OAuth providers', contract.providers.join(',') === 'google,github,apple,discord', contract.providers.join(','))
add('read and manage permissions are dedicated', permissions.includes(`'${contract.permissions.read}'`) && permissions.includes(`'${contract.permissions.manage}'`))
add('provider control stores only non-secret config and SecretRef metadata', /model OAuthProviderControl[\s\S]*?clientId[\s\S]*?redirectUri[\s\S]*?scopes[\s\S]*?clientSecretRef/.test(schema) && !/model OAuthProviderControl[\s\S]*?(clientSecret\s|privateKey|accessToken)/.test(schema))
add('authorization requests support revocation without exposing state', /revokedAt[\s\S]*?revokeReasonCode/.test(schema) && runtime.includes('serializeOAuthAuthorizationRequest'))
add('account timestamps support deterministic paging', /model AuthAccount[\s\S]*?createdAt[\s\S]*?updatedAt/.test(schema))
add('migration installs control and revocation constraints', migration.includes('oauth_provider_controls_provider_check') && migration.includes('oauth_authorization_requests_revoke_reason_check'))
add('configuration migration adds GitHub, bounded settings, and pinned authorization version', configurationMigration.includes("'github'") && configurationMigration.includes('oauth_provider_controls_configuration_check') && configurationMigration.includes('provider_control_version'))
add('migration installs default OAuth Admin grants', permissionMigration.includes("'moderator', 'admin:auth:read'") && permissionMigration.includes("'admin', 'admin:auth:manage'"))
for (const route of contract.routes) {
  add(`${route.method} ${route.path} is implemented`, routes.includes(`router.add('${route.method}', '${route.path}'`), route.permission)
  add(`${route.method} ${route.path} enforces its permission`, routes.includes(`'${route.permission}'`), route.permission)
  const documentedPath = route.path.replace('/api', '').replace(/:([a-zA-Z]+)/g, '{$1}')
  add(`${route.method} ${route.path} is documented`, openapi.includes(`'${documentedPath}'`), route.path)
}
add('public OAuth metadata reads provider controls', publicRoutes.includes('listProviderControls') && publicRoutes.includes("mode: 'unavailable'"))
add('public OAuth metadata exposes the effective callback without secret material', openapi.includes('callbackUrl') && preflight.includes('status.callbackUrl'))
add('public OAuth start blocks disabled providers', publicRoutes.includes('getOAuthProviderControl') && publicRoutes.includes('OAUTH_PROVIDER_DISABLED'))
add('provider status uses optimistic versioning', runtime.includes('expectedVersion must be a non-negative integer') && contract.providerControl.optimisticVersioning)
add('Provider config validates redirect, scopes, and SecretRef', runtime.includes('parseOAuthProviderConfigurationRequest') && runtime.includes('clientSecretRef must be a secret:// reference') && contract.providerConfiguration.inFlightAuthorizationPinsVersion)
add('Provider SecretRefs resolve only allowlisted environment variables', runtime.includes('isAllowedOAuthProviderSecretReference') && contract.secretBoundary.runtimeSecretRefResolution === 'allowlisted_environment_variable')
add('Google and GitHub login scopes cannot be removed', runtime.includes('requiredProviderScopes') && contract.providerConfiguration.requiredLoginScopes.google.includes('openid') && contract.providerConfiguration.requiredLoginScopes.github.includes('user:email'))
add('deployment preflight validates both real Provider credentials without printing secrets', contract.deploymentPreflight.secretsArePresenceCheckedOnly && preflight.includes("id: 'google'") && preflight.includes("id: 'github'") && !preflight.includes('console.log(process.env'))
add('deployment preflight validates exact effective callbacks and public external availability', contract.deploymentPreflight.requiresExactProviderCallbacks && contract.deploymentPreflight.requiresPublicExternalAvailability && preflight.includes('/api/auth/oauth/${provider}/callback') && preflight.includes("status.mode !== 'external'") && preflight.includes('status.callbackUrl !== expectedCallback(provider.id)'))
add('deployment preflight loads the server environment when present', packageJson.scripts['oauth:preflight']?.includes('--env-file-if-exists=server/.env'), 'oauth:preflight environment')
add('account unlink preserves final sign-in method', contract.accountUnlink.preserveFinalSignInMethod && routes.includes('AUTH_ACCOUNT_REQUIRED'))
add('authorization revocation is pending-only', contract.authorizationRequest.pendingOnlyRevocation && routes.includes('OAUTH_AUTHORIZATION_NOT_PENDING'))
add('safe projection omits internal authorization context', !/serializeOAuthAuthorizationRequest[\s\S]{0,900}(stateHash|redirectTo|linkUserId)/.test(runtime))
add('Admin routes never read credential environment keys', !/OAUTH_.*(CLIENT_SECRET|PRIVATE_KEY|ACCESS_TOKEN)/.test(routes))
add('policy document exists', fs.existsSync(path.join(root, 'docs/OAUTH_ADMIN_OPERATIONS.md')))
add('package exposes AUTH-01 Admin gate', packageJson.scripts['test:oauth-admin-operations']?.includes('verify-oauth-admin-operations.mjs'))
add('quick gate includes AUTH-01 Admin gate', packageJson.scripts['check:quick'].includes('npm run test:oauth-admin-operations'))

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) {
  console.error(`OAuth Admin operations verification failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else {
  console.log(`OAuth Admin operations verified: ${checks.length} checks`)
}
