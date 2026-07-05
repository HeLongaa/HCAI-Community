export const createProductionWorkerJobDefinitions = (repositories, env) => {
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
  return jobs
}
