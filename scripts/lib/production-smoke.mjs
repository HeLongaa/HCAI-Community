export const productionWorkerRequirements = Object.freeze([
  Object.freeze({ group: 'core', key: 'domainEventWorkerEnabled', name: 'domain event delivery', variable: 'DOMAIN_EVENT_WORKER_ENABLED' }),
  Object.freeze({ group: 'core', key: 'searchIndexWorkerEnabled', name: 'search index synchronization', variable: 'SEARCH_INDEX_WORKER_ENABLED' }),
  Object.freeze({ group: 'core', key: 'mediaScanWorkerEnabled', name: 'media scan sweep', variable: 'MEDIA_SCAN_WORKER_ENABLED', requiredWhen: Object.freeze({ key: 'mediaScanProvider', equals: 'webhook' }) }),
  Object.freeze({ group: 'core', key: 'mediaStorageCleanupWorkerEnabled', name: 'media storage cleanup', variable: 'MEDIA_STORAGE_CLEANUP_WORKER_ENABLED' }),
  Object.freeze({ group: 'core', key: 'taskStaleSubmissionWorkerEnabled', name: 'stale submission sweep', variable: 'TASK_STALE_SUBMISSION_WORKER_ENABLED' }),
  Object.freeze({ group: 'core', key: 'taskExpiryWorkerEnabled', name: 'task expiry sweep', variable: 'TASK_EXPIRY_WORKER_ENABLED' }),
  Object.freeze({ group: 'core', key: 'notificationDeliveryWorkerEnabled', name: 'notification delivery', variable: 'NOTIFICATION_DELIVERY_WORKER_ENABLED', requiredWhen: 'notificationEmailDeliveryEnabled' }),
  Object.freeze({ group: 'core', key: 'webhookDeliveryWorkerEnabled', name: 'webhook delivery', variable: 'WEBHOOK_DELIVERY_WORKER_ENABLED' }),
  Object.freeze({ group: 'core', key: 'creativeProviderAlertDeliveryWorkerEnabled', name: 'Provider alert delivery', variable: 'CREATIVE_PROVIDER_ALERT_DELIVERY_WORKER_ENABLED', requiredWhen: 'creativeProviderAlertsEnabled' }),
  Object.freeze({ group: 'retention', key: 'chatRetentionWorkerEnabled', name: 'Chat history', variable: 'CHAT_RETENTION_WORKER_ENABLED' }),
  Object.freeze({ group: 'retention', key: 'dataRightsDeletionWorkerEnabled', name: 'account deletion', variable: 'DATA_RIGHTS_DELETION_WORKER_ENABLED' }),
  Object.freeze({ group: 'retention', key: 'dataRightsExportRetentionWorkerEnabled', name: 'export artifact', variable: 'DATA_RIGHTS_EXPORT_RETENTION_WORKER_ENABLED' }),
  Object.freeze({ group: 'retention', key: 'observabilityRetentionWorkerEnabled', name: 'observability', variable: 'OBSERVABILITY_RETENTION_WORKER_ENABLED' }),
  Object.freeze({ group: 'retention', key: 'notificationRetentionWorkerEnabled', name: 'notification', variable: 'NOTIFICATION_RETENTION_WORKER_ENABLED' }),
  Object.freeze({ group: 'retention', key: 'operationLeaseRetentionWorkerEnabled', name: 'operation lease', variable: 'OPERATION_LEASE_RETENTION_WORKER_ENABLED' }),
  Object.freeze({ group: 'retention', key: 'privateLibraryRetentionWorkerEnabled', name: 'private Library', variable: 'PRIVATE_LIBRARY_RETENTION_WORKER_ENABLED' }),
  Object.freeze({ group: 'retention', key: 'authCredentialRetentionWorkerEnabled', name: 'auth credential', variable: 'AUTH_CREDENTIAL_RETENTION_WORKER_ENABLED' }),
  Object.freeze({ group: 'retention', key: 'auditRetentionWorkerEnabled', name: 'audit archive/prune', variable: 'AUDIT_RETENTION_WORKER_ENABLED' }),
  Object.freeze({ group: 'retention', key: 'communityRetentionWorkerEnabled', name: 'community', variable: 'COMMUNITY_RETENTION_WORKER_ENABLED' }),
  Object.freeze({ group: 'retention', key: 'securityEventRetentionWorkerEnabled', name: 'security event', variable: 'SECURITY_EVENT_RETENTION_WORKER_ENABLED' }),
  Object.freeze({ group: 'retention', key: 'riskRetentionWorkerEnabled', name: 'risk record', variable: 'RISK_RETENTION_WORKER_ENABLED' }),
  Object.freeze({ group: 'retention', key: 'moderationRetentionWorkerEnabled', name: 'moderation', variable: 'MODERATION_RETENTION_WORKER_ENABLED' }),
  Object.freeze({ group: 'retention', key: 'generationRetentionWorkerEnabled', name: 'generation', variable: 'GENERATION_RETENTION_WORKER_ENABLED' }),
  Object.freeze({ group: 'retention', key: 'mediaAssetRetentionWorkerEnabled', name: 'media asset metadata', variable: 'MEDIA_ASSET_RETENTION_WORKER_ENABLED' }),
  Object.freeze({ group: 'retention', key: 'providerLifecycleRetentionWorkerEnabled', name: 'Provider lifecycle', variable: 'PROVIDER_LIFECYCLE_RETENTION_WORKER_ENABLED' }),
  Object.freeze({ group: 'retention', key: 'configurationRetentionWorkerEnabled', name: 'configuration history', variable: 'CONFIGURATION_RETENTION_WORKER_ENABLED' }),
  Object.freeze({ group: 'retention', key: 'marketplaceRetentionWorkerEnabled', name: 'marketplace', variable: 'MARKETPLACE_RETENTION_WORKER_ENABLED' }),
  Object.freeze({ group: 'retention', key: 'supportRetentionWorkerEnabled', name: 'support', variable: 'SUPPORT_RETENTION_WORKER_ENABLED' }),
  Object.freeze({ group: 'retention', key: 'providerSecretRetentionWorkerEnabled', name: 'Provider secret', variable: 'PROVIDER_SECRET_RETENTION_WORKER_ENABLED' }),
])

export const inspectProductionWorkers = (env) => productionWorkerRequirements.map((requirement) => {
  const condition = requirement.requiredWhen
  const required = !condition || (typeof condition === 'string'
    ? env?.[condition] === true
    : env?.[condition.key] === condition.equals)
  return { ...requirement, required, enabled: !required || env?.[requirement.key] === true }
})

export const inspectDurableSecurityAlertDelivery = (env) => {
  const emailEnabled = env?.notificationEmailDeliveryEnabled === true
  const emailEndpointConfigured = env?.hasNotificationEmailWebhookUrl === true
  const emailSigningConfigured = env?.hasNotificationEmailWebhookSecret === true
  const emailSenderConfigured = env?.hasNotificationEmailFrom === true
  const providerReceiptRequired = env?.notificationEmailProviderReceiptRequired === true
  const workerEnabled = env?.notificationDeliveryWorkerEnabled === true
  return Object.freeze({
    ready: emailEnabled && emailEndpointConfigured && emailSigningConfigured && emailSenderConfigured && providerReceiptRequired && workerEnabled,
    emailEnabled,
    emailEndpointConfigured,
    emailSigningConfigured,
    emailSenderConfigured,
    providerReceiptRequired,
    workerEnabled,
  })
}
