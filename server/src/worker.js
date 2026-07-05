import { env } from './config/env.js'
import { startWorkerJobs } from './operations/worker.js'
import { createProductionWorkerJobDefinitions } from './operations/workerJobs.js'
import { repositories } from './repositories/index.js'

const worker = startWorkerJobs(createProductionWorkerJobDefinitions(repositories, env), {
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
