export const createProductionWorkerJobDefinitions = (repositories, env) => {
  const jobs = []
  if (repositories.media?.sweepScanJobs) {
    jobs.push({
      id: 'media-scan-sweep',
      enabled: env.mediaScanWorkerEnabled,
      intervalSeconds: env.mediaScanWorkerIntervalSeconds,
      run: () => repositories.media.sweepScanJobs({ source: 'worker' }),
    })
  }
  if (repositories.tasks?.sweepStaleSubmissions) {
    jobs.push({
      id: 'task-stale-submission-sweep',
      enabled: env.taskStaleSubmissionWorkerEnabled,
      intervalSeconds: env.taskStaleSubmissionWorkerIntervalSeconds,
      run: () => repositories.tasks.sweepStaleSubmissions({
        olderThanHours: env.taskStaleSubmissionOlderThanHours,
        limit: env.taskStaleSubmissionSweepLimit,
      }),
    })
  }
  return jobs
}
