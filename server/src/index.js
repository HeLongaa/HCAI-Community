import { createRouter } from './common/http/router.js'
import { createServer } from './common/http/server.js'
import { createRateLimitStore } from './common/http/rateLimit.js'
import { buildEnv } from './config/env.js'
import { applyRuntimeConfigToProcess, loadDatabaseRuntimeConfig } from './config/databaseRuntimeConfig.js'
import { startMediaScanWorker } from './media/scanWorker.js'
import { repositories } from './repositories/index.js'
import { createAdminMutationAuditHook } from './audit/adminMutationAudit.js'
import { resolveApiKeyClientIp } from './common/http/clientIp.js'
import { configureEnvironmentProxy } from './common/http/environmentProxy.js'

configureEnvironmentProxy()

const main = async () => {
  const runtimeConfig = await loadDatabaseRuntimeConfig({ repository: repositories.systemSettings })
  const runtimeSource = runtimeConfig.source
  applyRuntimeConfigToProcess(runtimeConfig)
  const env = buildEnv(runtimeSource)
  const { registerModules } = await import('./modules/index.js')
  const router = createRouter()
  registerModules(router, { source: runtimeSource, repositories })

  const server = createServer(router, {
    resolveUser: async (token, request) => (await repositories.developerAccess.authenticateApiKey(token, {
      clientIp: resolveApiKeyClientIp(request),
    })) ?? repositories.auth.findDemoAccountByAccessToken(token),
    auditAdminMutation: createAdminMutationAuditHook(repositories.audit),
    onRequestFinished: (input) => repositories.observability.recordHttp(input),
    rateLimitStore: createRateLimitStore(runtimeSource),
    onRateLimitExceeded: (event) => {
      console.warn('[rate-limit]', JSON.stringify(event))
    },
    onRateLimitStoreUnavailable: (event) => {
      console.warn('[rate-limit-store]', JSON.stringify(event))
    },
    onRequestBodyRejected: (event) => {
      console.warn('[body-size]', JSON.stringify(event))
    },
    onAuthFailureAnomaly: (event) => {
      console.warn('[auth-anomaly]', JSON.stringify(event))
    },
  })

  server.listen(env.port, () => {
    console.log(`HCAI Community server listening on http://127.0.0.1:${env.port}`)
    if (runtimeConfig.appliedKeys.length) console.log(`Applied ${runtimeConfig.appliedKeys.length} database runtime setting overrides`)
  })

  startMediaScanWorker(repositories, {
    enabled: env.apiEmbeddedWorkersEnabled && env.mediaScanWorkerEnabled,
    intervalSeconds: env.mediaScanWorkerIntervalSeconds,
  })
}

await main()
