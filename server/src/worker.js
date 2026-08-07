import { env } from './config/env.js'
import { createProviderPollingStatusClients } from './creative/providerStatusClientRegistry.js'
import { startWorkerJobs } from './operations/worker.js'
import { createProductionWorkerJobDefinitions } from './operations/workerJobs.js'
import { repositories } from './repositories/index.js'
import { configureEnvironmentProxy } from './common/http/environmentProxy.js'
import { createRouterVideoHttpClient } from './creative/routerVideoProvider.js'
import { createMiniMaxVideoHttpClient } from './creative/minimaxVideoProvider.js'
import { createGracefulShutdown } from './common/process/gracefulShutdown.js'

configureEnvironmentProxy()

const providerStatusClients = createProviderPollingStatusClients()
const routerVideoClient = env.creativeRouterVideoLifecycleWorkerEnabled && env.creativeRouterVideoHttpClientEnabled
  ? createRouterVideoHttpClient() : null
const minimaxVideoClient = env.creativeRouterVideoLifecycleWorkerEnabled && env.creativeRouterMiniMaxVideoHttpClientEnabled
  ? createMiniMaxVideoHttpClient() : null
const videoProviderStatusClients = {
  ...(routerVideoClient ? { 'hcai-router-seedance-2-fast': routerVideoClient } : {}),
  ...(minimaxVideoClient ? { 'hcai-router-minimax-hailuo-2-3': minimaxVideoClient } : {}),
}
const videoProviderOutputFetchers = {
  ...(routerVideoClient ? { 'hcai-router-seedance-2-fast': routerVideoClient.fetchOutput } : {}),
  ...(minimaxVideoClient ? { 'hcai-router-minimax-hailuo-2-3': minimaxVideoClient.fetchOutput } : {}),
}
const worker = startWorkerJobs(createProductionWorkerJobDefinitions(repositories, env, {
  providerStatusClients,
  videoProviderStatusClient: videoProviderStatusClients,
  providerOutputFetcher: videoProviderOutputFetchers,
  executionSource: process.env,
}), {
  logger: console,
  leaseManager: repositories.operationLeases,
  jobManager: repositories.jobs,
  unrefTimers: false,
})

const shutdown = createGracefulShutdown({
  serviceName: 'worker',
  workers: [worker],
  disconnect: () => repositories.client?.$disconnect(),
  timeoutMs: env.processShutdownTimeoutSeconds * 1000,
})

process.once('SIGINT', () => { void shutdown('SIGINT') })
process.once('SIGTERM', () => { void shutdown('SIGTERM') })
