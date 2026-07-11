import { env } from './config/env.js'
import { createProviderPollingStatusClients } from './creative/providerStatusClientRegistry.js'
import { startWorkerJobs } from './operations/worker.js'
import { createProductionWorkerJobDefinitions } from './operations/workerJobs.js'
import { repositories } from './repositories/index.js'

const providerStatusClients = createProviderPollingStatusClients()
const worker = startWorkerJobs(createProductionWorkerJobDefinitions(repositories, env, {
  providerStatusClients,
}), {
  logger: console,
  leaseManager: repositories.operationLeases,
  unrefTimers: false,
})

const shutdown = () => {
  worker.stop()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
