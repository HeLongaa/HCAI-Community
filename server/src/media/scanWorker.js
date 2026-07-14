import { startIntervalWorkerJob } from '../operations/worker.js'

export const startMediaScanWorker = (repositories, options = {}) => startIntervalWorkerJob({
  id: 'media-scan-sweep',
  enabled: options.enabled && Boolean(repositories.media?.sweepScanJobs),
  intervalSeconds: options.intervalSeconds,
  jobManager: repositories.jobs,
  run: () => repositories.media.sweepScanJobs({ source: 'worker' }),
})
