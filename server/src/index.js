import { createRouter } from './common/http/router.js'
import { createServer } from './common/http/server.js'
import { createRateLimitStore } from './common/http/rateLimit.js'
import { env } from './config/env.js'
import { registerModules } from './modules/index.js'
import { startMediaScanWorker } from './media/scanWorker.js'
import { repositories } from './repositories/index.js'

const main = async () => {
  const router = createRouter()
  registerModules(router)

  const server = createServer(router, {
    resolveUser: (token) => repositories.auth.findDemoAccountByAccessToken(token),
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
