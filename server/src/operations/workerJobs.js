import { buildProviderPollingLeaseKey, runProviderPollingWorkerOnce } from '../creative/providerPollingWorker.js'
import { runVideoProviderLifecycleWorkerOnce } from '../creative/videoProviderLifecycle.js'
import { runDomainEventPipelineOnce } from '../events/domainEventPipeline.js'
import { runNotificationDeliveryWorkerOnce } from '../notifications/notificationDeliveryWorker.js'
import { runWebhookDeliveryWorkerOnce } from '../webhooks/webhookDeliveryWorker.js'
import { runProviderAlertDeliveryWorkerOnce } from '../creative/providerAlertDeliveryWorker.js'
import { runAuditRetentionWorkerOnce } from '../audit/auditRetentionWorker.js'
import { createSecretManagerLifecycleGateway } from '../modelControl/providerSecretRetention.js'

export const createProductionWorkerJobDefinitions = (repositories, env, options = {}) => {
  const jobs = []
  const executionSource = options.executionSource ?? env
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
  if (repositories.search?.processQueue) {
    jobs.push({
      id: 'search-index-sync',
      enabled: env.searchIndexWorkerEnabled,
      intervalSeconds: env.searchIndexWorkerIntervalSeconds,
      lease: lease('search-index-sync'),
      run: () => repositories.search.processQueue({ limit: env.searchIndexWorkerBatchSize, workerId: 'search-index-worker' }),
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
  if (repositories.media?.cleanupStorageObjects) {
    jobs.push({
      id: 'media-storage-cleanup',
      enabled: env.mediaStorageCleanupWorkerEnabled,
      intervalSeconds: env.mediaStorageCleanupWorkerIntervalSeconds,
      maxAttempts: 3,
      retryBackoffSeconds: env.mediaStorageCleanupWorkerIntervalSeconds,
      lease: lease('media-storage-cleanup'),
      run: () => repositories.media.cleanupStorageObjects({ limit: env.mediaStorageCleanupBatchSize }),
    })
  }
  if (repositories.mediaAssetRetention?.sweepRetention) {
    jobs.push({
      id: 'media-asset-retention-sweep',
      enabled: env.mediaAssetRetentionWorkerEnabled,
      intervalSeconds: env.mediaAssetRetentionWorkerIntervalSeconds,
      maxAttempts: 3,
      retryBackoffSeconds: env.mediaAssetRetentionWorkerIntervalSeconds,
      lease: lease('media-asset-retention-sweep'),
      run: () => repositories.mediaAssetRetention.sweepRetention({
        now: options.now?.() ?? new Date(),
        limit: env.mediaAssetRetentionSweepLimit,
      }),
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
  if (repositories.taskLifecycleRecovery?.sweepExpired) {
    jobs.push({
      id: 'task-expiry-sweep',
      enabled: env.taskExpiryWorkerEnabled,
      intervalSeconds: env.taskExpiryWorkerIntervalSeconds,
      maxAttempts: 3,
      retryBackoffSeconds: env.taskExpiryWorkerIntervalSeconds,
      lease: lease('task-expiry-sweep'),
      run: () => repositories.taskLifecycleRecovery.sweepExpired({
        limit: env.taskExpirySweepLimit,
        source: 'worker',
        reasonCode: 'deadline_elapsed',
      }),
    })
  }
  if (repositories.notificationDeliveries?.claim) {
    jobs.push({
      id: 'notification-delivery',
      enabled: env.notificationDeliveryWorkerEnabled,
      intervalSeconds: env.notificationDeliveryWorkerIntervalSeconds,
      maxAttempts: 3,
      retryBackoffSeconds: env.notificationDeliveryWorkerIntervalSeconds,
      lease: lease('notification-delivery'),
      run: () => runNotificationDeliveryWorkerOnce({
        repositories,
        source: process.env,
        limit: env.notificationDeliveryWorkerBatchSize,
        leaseSeconds: env.notificationDeliveryLeaseSeconds,
      }),
    })
  }
  if (repositories.webhooks?.claim) {
    jobs.push({
      id: 'webhook-delivery',
      enabled: env.webhookDeliveryWorkerEnabled,
      intervalSeconds: env.webhookDeliveryWorkerIntervalSeconds,
      maxAttempts: 3,
      retryBackoffSeconds: env.webhookDeliveryWorkerIntervalSeconds,
      lease: lease('webhook-delivery'),
      run: () => runWebhookDeliveryWorkerOnce({
        repositories,
        source: process.env,
        limit: env.webhookDeliveryWorkerBatchSize,
        leaseSeconds: env.webhookDeliveryLeaseSeconds,
      }),
    })
  }
  if (repositories.providerAlertDeliveries?.claim) {
    jobs.push({
      id: 'provider-alert-delivery',
      enabled: env.creativeProviderAlertDeliveryWorkerEnabled,
      intervalSeconds: env.creativeProviderAlertDeliveryWorkerIntervalSeconds,
      maxAttempts: 3,
      retryBackoffSeconds: env.creativeProviderAlertDeliveryWorkerIntervalSeconds,
      lease: lease('provider-alert-delivery'),
      run: () => runProviderAlertDeliveryWorkerOnce({
        repositories,
        source: process.env,
        limit: env.creativeProviderAlertDeliveryWorkerBatchSize,
        leaseSeconds: env.creativeProviderAlertDeliveryLeaseSeconds,
        baseRetrySeconds: env.creativeProviderAlertDeliveryRetryBaseSeconds,
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
        source: executionSource,
        limit: env.creativeProviderPollingSweepLimit,
        fetchOutput: options.providerOutputFetcher ?? null,
      }),
    })
  }
  if (repositories.creativeProviderOperations?.listDue && repositories.creativeProviderReplays?.record) {
    jobs.push({
      id: 'creative-video-lifecycle',
      enabled: Boolean(env.creativeRouterVideoLifecycleWorkerEnabled),
      intervalSeconds: env.creativeRouterVideoPollIntervalSeconds ?? 15,
      lease: lease('creative-video-lifecycle'),
      run: () => runVideoProviderLifecycleWorkerOnce({
        repositories,
        statusClient: options.videoProviderStatusClient ?? null,
        source: executionSource,
        limit: env.creativeRouterVideoSweepLimit,
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
  if (repositories.dataRights?.listAdmin && repositories.dataRights?.process) {
    jobs.push({
      id: 'data-rights-deletion-sweep',
      enabled: env.dataRightsDeletionWorkerEnabled,
      intervalSeconds: env.dataRightsDeletionWorkerIntervalSeconds,
      maxAttempts: 3,
      retryBackoffSeconds: env.dataRightsDeletionWorkerIntervalSeconds,
      lease: lease('data-rights-deletion-sweep'),
      run: async () => {
        const now = options.now?.() ?? new Date()
        const operator = {
          id: 'system-data-rights-retention',
          handle: 'data-rights-worker',
          role: 'system',
        }
        const pages = await Promise.all(['identity_verified', 'blocked', 'processing'].map((status) => repositories.dataRights.listAdmin({
          status,
          requestType: 'account_deletion',
          limit: env.dataRightsDeletionSweepLimit,
        }, operator)))
        const processingRecoveryCutoff = now.getTime() - (env.dataRightsDeletionProcessingRecoverySeconds ?? 300) * 1000
        const page = pages.flat()
          .filter((request) => {
            if (request.status !== 'processing') return true
            const updatedAt = new Date(request.updatedAt).getTime()
            return Number.isFinite(updatedAt) && updatedAt <= processingRecoveryCutoff
          })
          .sort((left, right) => new Date(left.dueAt) - new Date(right.dueAt) || left.id.localeCompare(right.id))
          .slice(0, env.dataRightsDeletionSweepLimit)
        const due = page
          .filter((request) => new Date(request.dueAt) <= now)
          .slice(0, env.dataRightsDeletionSweepLimit)
        const failures = []
        let processed = 0
        for (const request of due) {
          try {
            await repositories.dataRights.process(operator, request.id, {
              expectedVersion: request.version,
              reasonCode: 'retention_due',
            }, now)
            processed += 1
          } catch (error) {
            failures.push({ requestId: request.id, errorCode: error?.code ?? 'DATA_RIGHTS_DELETION_FAILED' })
          }
        }
        return { inspected: page.length, due: due.length, processed, failed: failures.length, failures }
      },
    })
  }
  if (repositories.dataRights?.sweepExpiredExports) {
    jobs.push({
      id: 'data-rights-export-retention-sweep',
      enabled: env.dataRightsExportRetentionWorkerEnabled,
      intervalSeconds: env.dataRightsExportRetentionWorkerIntervalSeconds,
      maxAttempts: 3,
      retryBackoffSeconds: env.dataRightsExportRetentionWorkerIntervalSeconds,
      lease: lease('data-rights-export-retention-sweep'),
      run: () => repositories.dataRights.sweepExpiredExports({
        now: options.now?.() ?? new Date(),
        limit: env.dataRightsExportRetentionSweepLimit,
      }),
    })
  }
  if (repositories.observability?.sweepRetention) {
    jobs.push({
      id: 'observability-retention-sweep',
      enabled: env.observabilityRetentionWorkerEnabled,
      intervalSeconds: env.observabilityRetentionWorkerIntervalSeconds,
      maxAttempts: 3,
      retryBackoffSeconds: env.observabilityRetentionWorkerIntervalSeconds,
      lease: lease('observability-retention-sweep'),
      run: () => repositories.observability.sweepRetention({
        now: options.now?.() ?? new Date(),
        limit: env.observabilityRetentionSweepLimit,
      }),
    })
  }
  if (repositories.notifications?.sweepRetention) {
    jobs.push({
      id: 'notification-retention-sweep',
      enabled: env.notificationRetentionWorkerEnabled,
      intervalSeconds: env.notificationRetentionWorkerIntervalSeconds,
      maxAttempts: 3,
      retryBackoffSeconds: env.notificationRetentionWorkerIntervalSeconds,
      lease: lease('notification-retention-sweep'),
      run: () => repositories.notifications.sweepRetention({
        now: options.now?.() ?? new Date(),
        limit: env.notificationRetentionSweepLimit,
      }),
    })
  }
  if (repositories.operationLeases?.sweepRetention) {
    jobs.push({
      id: 'operation-lease-retention-sweep',
      enabled: env.operationLeaseRetentionWorkerEnabled,
      intervalSeconds: env.operationLeaseRetentionWorkerIntervalSeconds,
      maxAttempts: 3,
      retryBackoffSeconds: env.operationLeaseRetentionWorkerIntervalSeconds,
      lease: lease('operation-lease-retention-sweep'),
      run: () => repositories.operationLeases.sweepRetention({
        now: options.now?.() ?? new Date(),
        limit: env.operationLeaseRetentionSweepLimit,
      }),
    })
  }
  if (repositories.library?.sweepRetention) {
    jobs.push({
      id: 'private-library-retention-sweep',
      enabled: env.privateLibraryRetentionWorkerEnabled,
      intervalSeconds: env.privateLibraryRetentionWorkerIntervalSeconds,
      maxAttempts: 3,
      retryBackoffSeconds: env.privateLibraryRetentionWorkerIntervalSeconds,
      lease: lease('private-library-retention-sweep'),
      run: () => repositories.library.sweepRetention({
        now: options.now?.() ?? new Date(),
        limit: env.privateLibraryRetentionSweepLimit,
      }),
    })
  }
  if (repositories.authCredentialRetention?.sweepRetention) {
    jobs.push({
      id: 'auth-credential-retention-sweep',
      enabled: env.authCredentialRetentionWorkerEnabled,
      intervalSeconds: env.authCredentialRetentionWorkerIntervalSeconds,
      maxAttempts: 3,
      retryBackoffSeconds: env.authCredentialRetentionWorkerIntervalSeconds,
      lease: lease('auth-credential-retention-sweep'),
      run: () => repositories.authCredentialRetention.sweepRetention({
        now: options.now?.() ?? new Date(),
        limit: env.authCredentialRetentionSweepLimit,
      }),
    })
  }
  if (repositories.audit?.retentionPreview && repositories.audit?.pruneRetention && repositories.audit?.recordAttempt) {
    jobs.push({
      id: 'audit-retention-sweep',
      enabled: env.auditRetentionWorkerEnabled,
      intervalSeconds: env.auditRetentionWorkerIntervalSeconds,
      maxAttempts: 3,
      retryBackoffSeconds: env.auditRetentionWorkerIntervalSeconds,
      lease: lease('audit-retention-sweep'),
      run: () => runAuditRetentionWorkerOnce({
        repository: repositories.audit,
        source: options.auditRetentionSource ?? process.env,
        now: options.now?.() ?? new Date(),
        archiveWriter: options.auditArchiveWriter,
      }),
    })
  }
  if (repositories.communityRetention?.sweepRetention) {
    jobs.push({
      id: 'community-retention-sweep',
      enabled: env.communityRetentionWorkerEnabled,
      intervalSeconds: env.communityRetentionWorkerIntervalSeconds,
      maxAttempts: 3,
      retryBackoffSeconds: env.communityRetentionWorkerIntervalSeconds,
      lease: lease('community-retention-sweep'),
      run: () => repositories.communityRetention.sweepRetention({
        now: options.now?.() ?? new Date(),
        limit: env.communityRetentionSweepLimit,
      }),
    })
  }
  if (repositories.securityRetention?.sweepRetention) {
    jobs.push({
      id: 'security-event-retention-sweep',
      enabled: env.securityEventRetentionWorkerEnabled,
      intervalSeconds: env.securityEventRetentionWorkerIntervalSeconds,
      maxAttempts: 3,
      retryBackoffSeconds: env.securityEventRetentionWorkerIntervalSeconds,
      lease: lease('security-event-retention-sweep'),
      run: () => repositories.securityRetention.sweepRetention({
        now: options.now?.() ?? new Date(),
        limit: env.securityEventRetentionSweepLimit,
      }),
    })
  }
  if (repositories.riskRetention?.sweepRetention) {
    jobs.push({
      id: 'risk-record-retention-sweep',
      enabled: env.riskRetentionWorkerEnabled,
      intervalSeconds: env.riskRetentionWorkerIntervalSeconds,
      maxAttempts: 3,
      retryBackoffSeconds: env.riskRetentionWorkerIntervalSeconds,
      lease: lease('risk-record-retention-sweep'),
      run: () => repositories.riskRetention.sweepRetention({
        now: options.now?.() ?? new Date(),
        limit: env.riskRetentionSweepLimit,
      }),
    })
  }
  if (repositories.moderationRetention?.sweepRetention) {
    jobs.push({
      id: 'moderation-case-retention-sweep',
      enabled: env.moderationRetentionWorkerEnabled,
      intervalSeconds: env.moderationRetentionWorkerIntervalSeconds,
      maxAttempts: 3,
      retryBackoffSeconds: env.moderationRetentionWorkerIntervalSeconds,
      lease: lease('moderation-case-retention-sweep'),
      run: () => repositories.moderationRetention.sweepRetention({
        now: options.now?.() ?? new Date(),
        limit: env.moderationRetentionSweepLimit,
      }),
    })
  }
  if (repositories.moderationOperationalRetention?.sweepRetention) {
    jobs.push({
      id: 'moderation-operational-retention-sweep',
      enabled: env.moderationRetentionWorkerEnabled,
      intervalSeconds: env.moderationRetentionWorkerIntervalSeconds,
      maxAttempts: 3,
      retryBackoffSeconds: env.moderationRetentionWorkerIntervalSeconds,
      lease: lease('moderation-operational-retention-sweep'),
      run: () => repositories.moderationOperationalRetention.sweepRetention({
        now: options.now?.() ?? new Date(),
        limit: env.moderationRetentionSweepLimit,
      }),
    })
  }
  if (repositories.generationRetention?.sweepRetention) {
    jobs.push({
      id: 'generation-retention-sweep',
      enabled: env.generationRetentionWorkerEnabled,
      intervalSeconds: env.generationRetentionWorkerIntervalSeconds,
      maxAttempts: 3,
      retryBackoffSeconds: env.generationRetentionWorkerIntervalSeconds,
      lease: lease('generation-retention-sweep'),
      run: () => repositories.generationRetention.sweepRetention({ now: options.now?.() ?? new Date(), limit: env.generationRetentionSweepLimit }),
    })
  }
  if (repositories.providerLifecycleRetention?.sweepRetention) {
    jobs.push({
      id: 'provider-lifecycle-retention-sweep',
      enabled: env.providerLifecycleRetentionWorkerEnabled,
      intervalSeconds: env.providerLifecycleRetentionWorkerIntervalSeconds,
      maxAttempts: 3,
      retryBackoffSeconds: env.providerLifecycleRetentionWorkerIntervalSeconds,
      lease: lease('provider-lifecycle-retention-sweep'),
      run: () => repositories.providerLifecycleRetention.sweepRetention({ now: options.now?.() ?? new Date(), limit: env.providerLifecycleRetentionSweepLimit }),
    })
  }
  if (repositories.configurationRetention?.sweepRetention) {
    jobs.push({
      id: 'configuration-retention-sweep',
      enabled: env.configurationRetentionWorkerEnabled,
      intervalSeconds: env.configurationRetentionWorkerIntervalSeconds,
      maxAttempts: 3,
      retryBackoffSeconds: env.configurationRetentionWorkerIntervalSeconds,
      lease: lease('configuration-retention-sweep'),
      run: () => repositories.configurationRetention.sweepRetention({ now: options.now?.() ?? new Date(), limit: env.configurationRetentionSweepLimit }),
    })
  }
  if (repositories.marketplaceRetention?.sweepRetention) {
    jobs.push({
      id: 'marketplace-retention-sweep',
      enabled: env.marketplaceRetentionWorkerEnabled,
      intervalSeconds: env.marketplaceRetentionWorkerIntervalSeconds,
      maxAttempts: 3,
      retryBackoffSeconds: env.marketplaceRetentionWorkerIntervalSeconds,
      lease: lease('marketplace-retention-sweep'),
      run: () => repositories.marketplaceRetention.sweepRetention({ now: options.now?.() ?? new Date(), limit: env.marketplaceRetentionSweepLimit }),
    })
  }
  if (repositories.supportRetention?.sweepRetention) {
    jobs.push({
      id: 'support-retention-sweep',
      enabled: env.supportRetentionWorkerEnabled,
      intervalSeconds: env.supportRetentionWorkerIntervalSeconds,
      maxAttempts: 3,
      retryBackoffSeconds: env.supportRetentionWorkerIntervalSeconds,
      lease: lease('support-retention-sweep'),
      run: () => repositories.supportRetention.sweepRetention({ now: options.now?.() ?? new Date(), limit: env.supportRetentionSweepLimit }),
    })
  }
  if (repositories.modelGovernance?.sweepSecretRetention) {
    jobs.push({
      id: 'provider-secret-retention-sweep',
      enabled: env.providerSecretRetentionWorkerEnabled,
      intervalSeconds: env.providerSecretRetentionWorkerIntervalSeconds,
      maxAttempts: 3,
      retryBackoffSeconds: env.providerSecretRetentionWorkerIntervalSeconds,
      lease: lease('provider-secret-retention-sweep'),
      run: () => repositories.modelGovernance.sweepSecretRetention({
        now: options.now?.() ?? new Date(),
        limit: env.providerSecretRetentionSweepLimit,
        gateway: options.secretManagerLifecycleGateway ?? createSecretManagerLifecycleGateway({
          source: options.secretManagerLifecycleSource ?? process.env,
          fetchImpl: options.secretManagerLifecycleFetchImpl ?? globalThis.fetch,
        }),
      }),
    })
  }
  return jobs
}
