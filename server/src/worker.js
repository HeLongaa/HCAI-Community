import { env } from './config/env.js'
import { createProviderPollingStatusClients } from './creative/providerStatusClientRegistry.js'
import { startWorkerJobs } from './operations/worker.js'
import { createProductionWorkerJobDefinitions } from './operations/workerJobs.js'
import { repositories } from './repositories/index.js'
import { configureEnvironmentProxy } from './common/http/environmentProxy.js'

configureEnvironmentProxy()

const providerStatusClients = createProviderPollingStatusClients()
const worker = startWorkerJobs(createProductionWorkerJobDefinitions(repositories, env, {
  providerStatusClients,
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
