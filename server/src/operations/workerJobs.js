import { buildProviderPollingLeaseKey, runProviderPollingWorkerOnce } from '../creative/providerPollingWorker.js'
import { runVideoProviderLifecycleWorkerOnce } from '../creative/videoProviderLifecycle.js'
import { runDomainEventPipelineOnce } from '../events/domainEventPipeline.js'

export const createProductionWorkerJobDefinitions = (repositories, env, options = {}) => {
  const jobs = []
  const lease = (key) => ({
    key,
    ttlSeconds: env.workerLeaseTtlSeconds,
    renewIntervalSeconds: env.workerLeaseRenewIntervalSeconds,
  })
  if (repositories.domainEvents && repositories.domainEventConsumers) {
    jobs.push({
      id: 'domain-event-pipeline',
      enabled: env.domainEventWorkerEnabled,
      intervalSeconds: env.domainEventWorkerIntervalSeconds,
      lease: lease('domain-event-pipeline'),
      run: () => runDomainEventPipelineOnce({ repositories, limit: env.domainEventWorkerBatchSize }),
    })
  }
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
        fetchOutput: options.providerOutputFetcher ?? null,
      }),
    })
  }
  if (repositories.creativeProviderOperations?.listDue && repositories.creativeProviderReplays?.record) {
    jobs.push({
      id: 'creative-video-lifecycle',
      enabled: Boolean(env.creativeGoogleVeoLifecycleWorkerEnabled),
      intervalSeconds: env.creativeGoogleVeoPollIntervalSeconds ?? 15,
      lease: lease('creative-video-lifecycle'),
      run: () => runVideoProviderLifecycleWorkerOnce({
        repositories,
        statusClient: options.videoProviderStatusClient ?? null,
        source: env,
        limit: env.creativeGoogleVeoSweepLimit,
        fetchOutput: options.providerOutputFetcher ?? null,
      }),
    })
  }
  if (repositories.chat?.sweepExpired && repositories.chat?.replayDeletionTombstones) {
    jobs.push({
      id: 'chat-retention-sweep',
      enabled: env.chatRetentionWorkerEnabled,
      intervalSeconds: env.chatRetentionWorkerIntervalSeconds,
      lease: lease('chat-retention-sweep'),
      run: async () => {
        const expired = await repositories.chat.sweepExpired({ limit: env.chatRetentionSweepLimit })
        const replayed = await repositories.chat.replayDeletionTombstones({ limit: env.chatRetentionSweepLimit })
        return { expired: expired.length, replayed: replayed.length }
      },
    })
  }
  return jobs
}
