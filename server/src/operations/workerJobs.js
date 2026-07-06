import { buildProviderPollingLeaseKey, runProviderPollingWorkerOnce } from '../creative/providerPollingWorker.js'

export const createProductionWorkerJobDefinitions = (repositories, env, options = {}) => {
  const jobs = []
  const lease = (key) => ({
    key,
    ttlSeconds: env.workerLeaseTtlSeconds,
    renewIntervalSeconds: env.workerLeaseRenewIntervalSeconds,
  })
  if (repositories.media?.sweepScanJobs) {
    jobs.push({
      id: 'media-scan-sweep',
      enabled: env.mediaScanWorkerEnabled,
      intervalSeconds: env.mediaScanWorkerIntervalSeconds,
      lease: lease('media-scan-sweep'),
      run: () => repositories.media.sweepScanJobs({ source: 'worker' }),
    })
  }
  if (repositories.tasks?.sweepStaleSubmissions) {
    jobs.push({
      id: 'task-stale-submission-sweep',
      enabled: env.taskStaleSubmissionWorkerEnabled,
      intervalSeconds: env.taskStaleSubmissionWorkerIntervalSeconds,
      lease: lease('task-stale-submission-sweep'),
      run: () => repositories.tasks.sweepStaleSubmissions({
        olderThanHours: env.taskStaleSubmissionOlderThanHours,
        limit: env.taskStaleSubmissionSweepLimit,
      }),
    })
  }
  if (repositories.creativeGenerations?.list && repositories.creativeProviderReplays?.record) {
    jobs.push({
      id: 'creative-provider-polling',
      enabled: env.creativeProviderPollingWorkerEnabled,
      intervalSeconds: env.creativeProviderPollingIntervalSeconds,
      lease: {
        key: buildProviderPollingLeaseKey({
          providerId: env.creativeStagingImageProvider || 'replicate',
          providerMode: env.creativeProviderMode,
        }),
        ttlSeconds: env.creativeProviderPollingLeaseTtlSeconds ?? env.workerLeaseTtlSeconds,
        renewIntervalSeconds: env.workerLeaseRenewIntervalSeconds,
      },
      run: () => runProviderPollingWorkerOnce({
        repositories,
        providerStatusClients: options.providerStatusClients ?? {},
        source: env,
        limit: env.creativeProviderPollingSweepLimit,
      }),
    })
  }
  return jobs
}
