import { env } from './config/env.js'
import { createProviderPollingStatusClients } from './creative/providerStatusClientRegistry.js'
import { startWorkerJobs } from './operations/worker.js'
import { createProductionWorkerJobDefinitions } from './operations/workerJobs.js'
import { repositories } from './repositories/index.js'
import { configureEnvironmentProxy } from './common/http/environmentProxy.js'
import { createGoogleVeoHttpClient } from './creative/googleVeoProvider.js'

configureEnvironmentProxy()

const providerStatusClients = createProviderPollingStatusClients()
const googleVeoClient = env.creativeGoogleVeoLifecycleWorkerEnabled
  ? createGoogleVeoHttpClient()
  : null
const worker = startWorkerJobs(createProductionWorkerJobDefinitions(repositories, env, {
  providerStatusClients,
  videoProviderStatusClient: googleVeoClient,
  providerOutputFetcher: googleVeoClient?.fetchOutput ?? null,
}), {
  logger: console,
  leaseManager: repositories.operationLeases,
  jobManager: repositories.jobs,
  unrefTimers: false,
})

const shutdown = () => {
  worker.stop()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
