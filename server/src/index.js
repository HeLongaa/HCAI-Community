import { createRouter } from './common/http/router.js'
import { createServer } from './common/http/server.js'
import { createRateLimitStore } from './common/http/rateLimit.js'
import { env } from './config/env.js'
import { registerModules } from './modules/index.js'
import { startMediaScanWorker } from './media/scanWorker.js'
import { repositories } from './repositories/index.js'
import { createAdminMutationAuditHook } from './audit/adminMutationAudit.js'
import { resolveApiKeyClientIp } from './common/http/clientIp.js'
import { configureEnvironmentProxy } from './common/http/environmentProxy.js'

configureEnvironmentProxy()

const main = async () => {
  const router = createRouter()
  registerModules(router)

  const server = createServer(router, {
    resolveUser: async (token, request) => (await repositories.developerAccess.authenticateApiKey(token, {
      clientIp: resolveApiKeyClientIp(request),
    })) ?? repositories.auth.findDemoAccountByAccessToken(token),
    auditAdminMutation: createAdminMutationAuditHook(repositories.audit),
    onRequestFinished: (input) => repositories.observability.recordHttp(input),
    rateLimitStore: createRateLimitStore(process.env),
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
  })

  startMediaScanWorker(repositories, {
    enabled: env.apiEmbeddedWorkersEnabled && env.mediaScanWorkerEnabled,
    intervalSeconds: env.mediaScanWorkerIntervalSeconds,
  })
}

await main()
