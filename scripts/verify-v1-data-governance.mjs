import fs from 'node:fs'
import path from 'node:path'

import { chatCapabilityContract } from '../server/src/creative/chatCapabilityContract.js'

const root = process.cwd()
const governancePath = path.join(root, 'config/v1-data-governance.json')
const governance = JSON.parse(fs.readFileSync(governancePath, 'utf8'))
const providerMatrix = JSON.parse(fs.readFileSync(path.join(root, governance.guardrails.providerDecisionMatrix), 'utf8'))
const releaseScope = JSON.parse(fs.readFileSync(path.join(root, 'config/v1-release-scope.json'), 'utf8'))
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const checks = []

const addCheck = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail })
const sorted = (values) => [...values].sort()
const sameMembers = (actual, expected) =>
  JSON.stringify(sorted(actual)) === JSON.stringify(sorted(expected))
const includesMembers = (actual, expected) => expected.every((item) => actual.includes(item))
const unique = (values) => new Set(values).size === values.length
const nonEmptyArray = (value) => Array.isArray(value) && value.length > 0
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const providerHttpClientSource = read('server/src/creative/providerHttpClient.js')
const providerEnvSource = read('server/src/config/env.js')
const generationServiceSource = read('server/src/creative/generationService.js')
const providerPollingWorkerSource = read('server/src/creative/providerPollingWorker.js')
const providerStatusClientRegistrySource = read('server/src/creative/providerStatusClientRegistry.js')
const providerDeletionGatewaySource = read('server/src/dataRights/providerDeletionGateway.js')
const exportArtifactRetentionSource = read('server/src/dataRights/exportArtifactRetention.js')
const prismaDataRightsSource = read('server/src/dataRights/prismaDataRightsRepository.js')
const dataRightsRoutesSource = read('server/src/modules/dataRights/routes.js')
const workerJobsSource = read('server/src/operations/workerJobs.js')
const observabilityRetentionSource = read('server/src/observability/observabilityRetention.js')
const prismaObservabilitySource = read('server/src/observability/prismaObservabilityRepository.js')
const seedObservabilitySource = read('server/src/observability/seedObservabilityRepository.js')
const observabilityRetentionMigration = read('server/prisma/migrations/0102_observability_bounded_retention/migration.sql')
const notificationRetentionSource = read('server/src/notifications/notificationRetention.js')
const prismaRepositorySource = read('server/src/repositories/prismaRepository.js')
const seedRepositorySource = read('server/src/repositories/seedRepository.js')
const internalAccountingSource = read('server/src/accounting/internalAccounting.js')
const notificationRetentionMigration = read('server/prisma/migrations/0103_notification_retention/migration.sql')
const providerAlertRetentionMigration = read('server/prisma/migrations/0120_provider_alert_retention/migration.sql')
const notificationEmailProviderEventMigration = read('server/prisma/migrations/0122_notification_email_provider_events/migration.sql')
const operationLeaseRetentionSource = read('server/src/operations/operationLeaseRetention.js')
const operationLeaseRetentionMigration = read('server/prisma/migrations/0104_operation_lease_retention/migration.sql')
const privateLibraryRetentionSource = read('server/src/library/libraryRetention.js')
const privateLibraryRetentionMigration = read('server/prisma/migrations/0105_private_library_retention/migration.sql')
const authCredentialRetentionSource = read('server/src/auth/authCredentialRetention.js')
const authCredentialRetentionMigration = read('server/prisma/migrations/0106_auth_credential_retention/migration.sql')
const communityRetentionSource = read('server/src/community/communityRetention.js')
const prismaCommunityRetentionSource = read('server/src/community/prismaCommunityRetentionRepository.js')
const communityRetentionMigration = read('server/prisma/migrations/0107_community_content_retention/migration.sql')
const securityRetentionSource = read('server/src/security/securityRetention.js')
const prismaSecurityRetentionSource = read('server/src/security/prismaSecurityRetentionRepository.js')
const securityRetentionMigration = read('server/prisma/migrations/0108_security_event_retention/migration.sql')
const riskRetentionSource = read('server/src/risk/riskOperations.js')
const prismaRiskRetentionSource = read('server/src/risk/prismaRiskRetentionRepository.js')
const riskRetentionMigration = read('server/prisma/migrations/0109_risk_record_retention/migration.sql')
const moderationRetentionSource = read('server/src/trust/moderationRetention.js')
const prismaModerationRetentionSource = read('server/src/trust/prismaModerationRetentionRepository.js')
const moderationRetentionMigration = read('server/prisma/migrations/0110_moderation_case_retention/migration.sql')
const moderationOperationalRetentionSource = read('server/src/trust/moderationOperationalRetention.js')
const prismaModerationOperationalRetentionSource = read('server/src/trust/prismaModerationOperationalRetentionRepository.js')
const moderationOperationalRetentionMigration = read('server/prisma/migrations/0111_moderation_operational_retention/migration.sql')
const generationRetentionSource = read('server/src/creative/generationRetention.js')
const prismaGenerationRetentionSource = read('server/src/creative/prismaGenerationRetentionRepository.js')
const generationRetentionMigration = read('server/prisma/migrations/0112_generation_retention/migration.sql')
const providerLifecycleRetentionSource = read('server/src/creative/providerLifecycleRetention.js')
const prismaProviderLifecycleRetentionSource = read('server/src/creative/prismaProviderLifecycleRetentionRepository.js')
const providerLifecycleRetentionMigration = read('server/prisma/migrations/0116_provider_lifecycle_retention/migration.sql')
const configurationRetentionSource = read('server/src/config/configurationRetention.js')
const prismaConfigurationRetentionSource = read('server/src/config/prismaConfigurationRetentionRepository.js')
const configurationRetentionMigration = read('server/prisma/migrations/0117_configuration_revision_retention/migration.sql')
const mediaAssetRetentionSource = read('server/src/media/mediaAssetRetention.js')
const prismaMediaAssetRetentionSource = read('server/src/media/prismaMediaAssetRetentionRepository.js')
const mediaAssetRetentionMigration = read('server/prisma/migrations/0118_media_asset_retention/migration.sql')
const marketplaceRetentionSource = read('server/src/tasks/marketplaceRetention.js')
const prismaMarketplaceRetentionSource = read('server/src/tasks/prismaMarketplaceRetentionRepository.js')
const marketplaceRetentionMigration = read('server/prisma/migrations/0113_marketplace_retention/migration.sql')
const providerSecretRetentionSource = read('server/src/modelControl/providerSecretRetention.js')
const prismaModelGovernanceSource = read('server/src/modelControl/prismaModelGovernanceRepository.js')
const providerSecretRetentionMigration = read('server/prisma/migrations/0114_provider_secret_retention/migration.sql')
const supportRetentionSource = read('server/src/support/supportRetention.js')
const prismaSupportRetentionSource = read('server/src/support/prismaSupportRetentionRepository.js')
const prismaSupportSource = read('server/src/support/prismaSupportRepository.js')
const supportRetentionMigration = read('server/prisma/migrations/0115_support_ticket_retention/migration.sql')
const prismaSafetyOperationsSource = read('server/src/trust/prismaSafetyOperationsRepository.js')
const adminRoutesSource = read('server/src/modules/admin/routes.js')
const auditRetentionWorkerSource = read('server/src/audit/auditRetentionWorker.js')
const auditRetentionSource = read('server/src/audit/auditRetention.js')
const archiveWriterSource = read('server/src/storage/archiveWriter.js')
const structuredLoggingSource = read('server/src/observability/structuredLogging.js')
const releaseInfrastructureContract = JSON.parse(read('config/release-infrastructure-rehearsal-contract.json'))
const releaseInfrastructureRunnerSource = read('scripts/rehearse-release-infrastructure.mjs')

const expectedClassifications = ['confidential', 'internal', 'public', 'restricted', 'secret']
const expectedPurposes = [
  'account_service',
  'auth_security',
  'community_participation',
  'creative_generation',
  'internal_accounting',
  'legal_compliance',
  'marketplace_delivery',
  'media_delivery',
  'safety_moderation',
  'support_operations',
]
const expectedAssets = [
  'account_generation_risk_records',
  'ai_evaluation_records',
  'audit_event_records',
  'authentication_credentials_sessions',
  'backup_archive_copies',
  'chat_conversation_messages',
  'community_content_interactions',
  'creative_accounting_records',
  'creative_generation_records',
  'deployment_secrets',
  'developer_credentials',
  'governance_configuration',
  'identity_account_profile',
  'internal_accounting_invariant_records',
  'internal_points_ledger',
  'marketplace_records',
  'media_asset_metadata',
  'media_object_bytes',
  'media_scan_safety_records',
  'moderation_review_records',
  'notification_records',
  'observability_logs_traces_metrics',
  'operation_leases',
  'private_library_items',
  'provider_cost_budget_records',
  'provider_control_records',
  'provider_legal_review_records',
  'provider_lifecycle_records',
  'raw_generation_inputs',
  'raw_provider_payloads',
  'search_index_records',
  'security_event_records',
  'support_ticket_records',
  'user_export_packages',
]
const expectedNodes = [
  'admin_console',
  'api_memory',
  'backup_archive',
  'browser',
  'creative_provider',
  'export_storage',
  'media_scanner',
  'notification_channel',
  'oauth_provider',
  'object_storage',
  'observability',
  'postgres',
  'secret_store',
  'worker_memory',
]
const expectedFlows = [
  'api_to_admin_console',
  'api_to_notification_channel',
  'api_to_oauth_provider',
  'api_to_postgres',
  'browser_to_api',
  'browser_to_object_storage',
  'creative_provider_callback_to_api',
  'creative_provider_to_runtime',
  'export_storage_to_browser',
  'object_storage_to_scanner',
  'object_storage_to_backup',
  'object_storage_to_export_storage',
  'primary_data_to_export_storage',
  'primary_stores_to_backup',
  'runtime_to_creative_provider',
  'runtime_to_object_storage',
  'runtime_to_observability',
  'runtime_to_postgres_normalized_provider_evidence',
  'scanner_to_api',
  'secret_store_to_runtime',
  'secret_store_to_worker',
  'worker_to_observability',
  'worker_to_postgres_coordination',
  'worker_auth_to_creative_provider',
]
const expectedForbiddenFlows = [
  'cross_user_export',
  'private_url_to_secondary_surfaces',
  'production_data_to_fixture_or_mock',
  'raw_generation_input_to_admin_or_logs',
  'raw_provider_payload_to_persistence',
  'secret_to_logs_or_database',
  'unredacted_identity_to_metrics',
  'unsupported_region_or_processor',
]
const expectedServiceClasses = ['media_scanner', 'notification_delivery', 'oauth_provider', 'object_storage_cdn']
const expectedHandoffTasks = [
  'V1-05',
  'V1-06',
  'V1-07',
  'V1-08',
  'V1-09',
  'V1-10',
  'V1-11',
  'V1-20',
  'V1-21',
  'V1-22',
  'V1-24',
  'V1-48',
  'V1-49',
  'V1-50',
  'V1-51',
  'V1-53',
  'V1-54',
  'V1-59',
  'V1-60',
  'V1-61',
  'V1-62',
  'V1-63',
  'V1-67',
  'V1-69',
  'V1-73',
  'V1-78',
]

addCheck('data governance schema version is supported', governance.schemaVersion === 1, `schemaVersion=${governance.schemaVersion}`)
addCheck('data governance baseline is owned by V1-45', governance.taskId === 'V1-45', governance.taskId)
addCheck('data governance baseline has an access date', /^\d{4}-\d{2}-\d{2}$/.test(governance.asOf), governance.asOf)
addCheck(
  'data governance policy version is stable',
  /^v1-data-governance-\d{4}-\d{2}-\d{2}$/.test(governance.policyVersion),
  governance.policyVersion,
)
addCheck(
  'data governance policy is frozen for implementation',
  governance.policyStatus === 'frozen_for_implementation',
  governance.policyStatus,
)
addCheck(
  'inventory tracks implemented account rights without claiming production completion',
  governance.runtimeStatus.inventoryComplete === true &&
    governance.runtimeStatus.retentionAutomationComplete === false &&
    governance.runtimeStatus.accountExportImplemented === true &&
    governance.runtimeStatus.accountDeletionImplemented === true &&
    governance.runtimeStatus.providerDeletionAutomationImplemented === true &&
    governance.runtimeStatus.backupDeletionRehearsed === false,
  JSON.stringify(governance.runtimeStatus),
)
addCheck(
  'production and real Provider calls remain unapproved',
  governance.runtimeStatus.productionApproved === false &&
    governance.runtimeStatus.realProviderCallsApproved === false &&
    governance.runtimeStatus.ordinaryContinuationIsApproval === false,
  JSON.stringify(governance.runtimeStatus),
)
addCheck(
  'unknown data, flows, and processors fail closed',
  governance.guardrails.unknownDataClassification === 'restricted' &&
    governance.guardrails.unknownDataFlow === 'deny' &&
    governance.guardrails.unknownExternalProcessor === 'deny' &&
    governance.guardrails.highestApplicableRestrictionWins === true,
  JSON.stringify(governance.guardrails),
)
addCheck(
  'minimization and purpose limitation are mandatory',
  governance.guardrails.dataMinimizationRequired === true &&
    governance.guardrails.purposeLimitationRequired === true,
  JSON.stringify(governance.guardrails),
)
addCheck(
  'unsafe persistence and production fixtures are forbidden',
  governance.guardrails.productionDataInFixtures === 'forbidden' &&
    governance.guardrails.rawProviderPayloadPersistence === 'forbidden' &&
    governance.guardrails.secretPersistenceOutsideSecretStore === 'forbidden' &&
    governance.guardrails.privateUrlPersistenceOutsideOwningRecord === 'forbidden',
  JSON.stringify(governance.guardrails),
)
addCheck(
  'governance source documents exist',
  fs.existsSync(path.join(root, governance.guardrails.policyDocument)) &&
    fs.existsSync(path.join(root, governance.guardrails.contentSafetyPolicy)) &&
    fs.existsSync(path.join(root, governance.guardrails.providerDecisionMatrix)),
  `${governance.guardrails.policyDocument}, ${governance.guardrails.contentSafetyPolicy}`,
)
addCheck(
  'legal approval remains required',
  governance.guardrails.legalApprovalStatus === 'required_before_production',
  governance.guardrails.legalApprovalStatus,
)

const classificationIds = governance.classifications.map((item) => item.id)
const classificationsById = new Map(governance.classifications.map((item) => [item.id, item]))
addCheck(
  'all five data classifications are defined',
  sameMembers(classificationIds, expectedClassifications),
  classificationIds.join(', '),
)
addCheck('classification ids are unique', unique(classificationIds), `${classificationIds.length} classifications`)
addCheck(
  'classification ranks are unique and ordered',
  sameMembers(governance.classifications.map((item) => item.rank), [1, 2, 3, 4, 5]),
  governance.classifications.map((item) => `${item.id}:${item.rank}`).join(', '),
)
for (const classification of governance.classifications) {
  addCheck(
    `${classification.id} classification has meaning and controls`,
    Boolean(classification.meaning) && classification.requiredControls.length >= 2,
    `${classification.requiredControls.length} controls`,
  )
}
addCheck(
  'secret classification requires managed storage and never-log controls',
  includesMembers(classificationsById.get('secret').requiredControls, ['managed secret store only', 'never log or export']),
  classificationsById.get('secret').requiredControls.join(', '),
)

const purposeIds = governance.purposes.map((purpose) => purpose.id)
const purposesById = new Map(governance.purposes.map((purpose) => [purpose.id, purpose]))
addCheck('all approved purposes are defined', sameMembers(purposeIds, expectedPurposes), purposeIds.join(', '))
addCheck('purpose ids are unique', unique(purposeIds), `${purposeIds.length} purposes`)
for (const purpose of governance.purposes) {
  addCheck(`${purpose.id} purpose is explained`, Boolean(purpose.meaning), purpose.meaning)
}

const retentionIds = governance.retentionPolicies.map((policy) => policy.id)
const retentionById = new Map(governance.retentionPolicies.map((policy) => [policy.id, policy]))
const retentionAutomationInventory = governance.retentionAutomationInventory ?? {}
addCheck('retention policy ids are unique', unique(retentionIds), `${retentionIds.length} policies`)
addCheck('retention policy set is comprehensive', governance.retentionPolicies.length >= 20, `${governance.retentionPolicies.length} policies`)
addCheck(
  'retention automation inventory covers every policy exactly once',
  sameMembers(Object.keys(retentionAutomationInventory), retentionIds),
  `${Object.keys(retentionAutomationInventory).length}/${retentionIds.length} statuses`,
)
for (const policy of governance.retentionPolicies) {
  addCheck(
    `${policy.id} has a bounded trigger and action`,
    Boolean(policy.trigger) &&
      Number.isInteger(policy.maximumDaysAfterTrigger) &&
      policy.maximumDaysAfterTrigger >= 0 &&
      Boolean(policy.action),
    `${policy.trigger}/${policy.maximumDaysAfterTrigger}d/${policy.action}`,
  )
  addCheck(
    `${policy.id} has field overrides and explicit exceptions`,
    policy.fieldOverrides && typeof policy.fieldOverrides === 'object' &&
      !Array.isArray(policy.fieldOverrides) &&
      Array.isArray(policy.exceptions),
    `${Object.keys(policy.fieldOverrides ?? {}).length}/${policy.exceptions?.length ?? 0}`,
  )
  addCheck(
    `${policy.id} has an explicit runtime automation status`,
    typeof retentionAutomationInventory[policy.id] === 'string' && retentionAutomationInventory[policy.id].length > 0,
    retentionAutomationInventory[policy.id],
  )
}

addCheck(
  'known retention policy conflicts and pending target acceptance remain explicit without claiming global completion',
  retentionAutomationInventory.provider_lifecycle_terminal_180d === 'implemented_pending_target_environment_acceptance' &&
    retentionAutomationInventory.configuration_superseded_plus_365d === 'implemented_pending_target_environment_acceptance' &&
    retentionAutomationInventory.media_asset_delete_plus_30d === 'implemented_pending_target_environment_acceptance' &&
    retentionAutomationInventory.support_close_plus_730d === 'implemented_pending_target_environment_acceptance' &&
    retentionAutomationInventory.private_library_delete_plus_30d === 'implemented_pending_target_environment_acceptance' &&
    retentionAutomationInventory.community_delete_plus_30d === 'implemented_pending_target_environment_acceptance' &&
    retentionAutomationInventory.marketplace_close_plus_730d === 'partial_mutable_task_redaction_implemented_immutable_lifecycle_event_ledger_and_asset_evidence_contract_required' &&
    retentionAutomationInventory.internal_ledger_plus_730d === 'partial_new_writes_pseudonymized_historical_immutable_fact_anonymization_contract_pending' &&
    retentionAutomationInventory.security_event_365d === 'implemented_pending_target_environment_acceptance' &&
    retentionAutomationInventory.moderation_close_plus_730d === 'implemented_pending_target_environment_acceptance' &&
    retentionAutomationInventory.retired_secret_30d === 'implemented_pending_target_environment_acceptance' &&
    governance.runtimeStatus.retentionAutomationComplete === false,
  JSON.stringify({
    providerLifecycle: retentionAutomationInventory.provider_lifecycle_terminal_180d,
    configurationHistory: retentionAutomationInventory.configuration_superseded_plus_365d,
    mediaAsset: retentionAutomationInventory.media_asset_delete_plus_30d,
    supportTicket: retentionAutomationInventory.support_close_plus_730d,
    privateLibrary: retentionAutomationInventory.private_library_delete_plus_30d,
    community: retentionAutomationInventory.community_delete_plus_30d,
    marketplace: retentionAutomationInventory.marketplace_close_plus_730d,
    internalLedger: retentionAutomationInventory.internal_ledger_plus_730d,
    securityEvent: retentionAutomationInventory.security_event_365d,
    moderation: retentionAutomationInventory.moderation_close_plus_730d,
    providerSecret: retentionAutomationInventory.retired_secret_30d,
    complete: governance.runtimeStatus.retentionAutomationComplete,
  }),
)

addCheck(
  'runtime media asset retention minimizes governed relations and creates an irreversible structural tombstone',
  retentionAutomationInventory.media_asset_delete_plus_30d === 'implemented_pending_target_environment_acceptance' &&
    mediaAssetRetentionSource.includes("policyId: 'media_asset_delete_plus_30d'") &&
    mediaAssetRetentionSource.includes('deletedRetentionDays: 30') &&
    mediaAssetRetentionSource.includes('abandonedPendingRetentionDays: 1') &&
    mediaAssetRetentionSource.includes("legalHoldScopeDomains: Object.freeze(['media', 'audit', 'safety'])") &&
    prismaMediaAssetRetentionSource.includes("storage_row.state = 'deleted'") &&
    prismaMediaAssetRetentionSource.includes("scope_domain IN ('media', 'audit', 'safety')") &&
    prismaDataRightsSource.includes("['media', 'audit', 'safety'].includes(payload.scopeDomain)") &&
    prismaMediaAssetRetentionSource.includes('profilePortfolioAsset.updateMany') &&
    prismaMediaAssetRetentionSource.includes('taskSubmissionAsset.updateMany') &&
    prismaMediaAssetRetentionSource.includes('libraryItem.deleteMany') &&
    prismaMediaAssetRetentionSource.includes('creativeGenerationAsset.updateMany') &&
    prismaMediaAssetRetentionSource.includes('chatTurnInputAsset.updateMany') &&
    prismaMediaAssetRetentionSource.includes('mediaAssetRelation.updateMany') &&
    prismaMediaAssetRetentionSource.includes('mediaScanJob.updateMany') &&
    prismaMediaAssetRetentionSource.includes('ownerId: null') &&
    prismaMediaAssetRetentionSource.includes('array_remove(input_asset_ids, $1)') &&
    prismaMediaAssetRetentionSource.includes('array_remove(asset_ids, $1)') &&
    prismaMediaAssetRetentionSource.includes("set_config('app.media_asset_retention_maintenance', 'on', true)") &&
    workerJobsSource.includes("id: 'media-asset-retention-sweep'") &&
    workerJobsSource.includes("lease: lease('media-asset-retention-sweep')") &&
    providerEnvSource.includes("mediaAssetRetentionWorkerEnabled: boolFlag(source, 'MEDIA_ASSET_RETENTION_WORKER_ENABLED', false)") &&
    mediaAssetRetentionMigration.includes('MEDIA_ASSET_RETENTION_REDACTED') &&
    mediaAssetRetentionMigration.includes('media_asset_relations_media_guard') &&
    mediaAssetRetentionMigration.includes('library_items_media_guard'),
  'object-first eligibility, media/audit/safety holds, bounded leased worker, governed relation minimization, legacy array cleanup, shared database locks, and irreversible tombstones',
)

addCheck(
  'runtime configuration retention irreversibly minimizes superseded values after 365 days',
  retentionAutomationInventory.configuration_superseded_plus_365d === 'implemented_pending_target_environment_acceptance' &&
    retentionById.get('configuration_superseded_plus_365d').maximumDaysAfterTrigger === 365 &&
    retentionById.get('configuration_superseded_plus_365d').exceptions.includes('active_configuration') &&
    retentionById.get('configuration_superseded_plus_365d').exceptions.includes('pending_or_approved_rollback_target') &&
    configurationRetentionSource.includes('maximumPaths = 128') &&
    configurationRetentionSource.includes('maximumDepth = 8') &&
    configurationRetentionSource.includes("createHash('sha256')") &&
    prismaConfigurationRetentionSource.includes('configuration-system-setting') &&
    prismaConfigurationRetentionSource.includes('configuration-resource') &&
    prismaConfigurationRetentionSource.includes("status IN ('pending_approval', 'approved')") &&
    prismaConfigurationRetentionSource.includes("set_config('app.configuration_retention_maintenance', 'on', true)") &&
    workerJobsSource.includes("id: 'configuration-retention-sweep'") &&
    workerJobsSource.includes("lease: lease('configuration-retention-sweep')") &&
    workerJobsSource.includes('maxAttempts: 3') &&
    providerEnvSource.includes("configurationRetentionWorkerEnabled: boolFlag(source, 'CONFIGURATION_RETENTION_WORKER_ENABLED', false)") &&
    configurationRetentionMigration.includes('configuration_retention_summary_valid') &&
    configurationRetentionMigration.includes('retention-minimized system setting revision is immutable') &&
    configurationRetentionMigration.includes('retention-minimized config resource revision is immutable'),
  '365-day successor cutoff, current and rollback-target exclusions, bounded SHA-256-only summaries, shared publication locks, irreversible database guards, and default-disabled leased worker',
)

addCheck(
  'runtime Provider lifecycle retention minimizes terminal evidence after reconciliation, review, and legal-hold closeout',
  retentionAutomationInventory.provider_lifecycle_terminal_180d === 'implemented_pending_target_environment_acceptance' &&
    providerLifecycleRetentionSource.includes("policyId: 'provider_lifecycle_terminal_180d'") &&
    providerLifecycleRetentionSource.includes('retentionDays: 180') &&
    prismaProviderLifecycleRetentionSource.includes("row.status IN ('open', 'repair_pending')") &&
    prismaProviderLifecycleRetentionSource.includes("scope_domain IN ('audit', 'safety')") &&
    prismaProviderLifecycleRetentionSource.includes("SET LOCAL app.provider_lifecycle_retention_maintenance = 'on'") &&
    prismaProviderLifecycleRetentionSource.includes('providerJobId: null') &&
    prismaProviderLifecycleRetentionSource.includes('mediaAssetId: null') &&
    prismaProviderLifecycleRetentionSource.includes('requestedById: null') &&
    workerJobsSource.includes("id: 'provider-lifecycle-retention-sweep'") &&
    workerJobsSource.includes("lease: lease('provider-lifecycle-retention-sweep')") &&
    providerLifecycleRetentionMigration.includes("'creative-generation:' || NEW.generation_id") &&
    providerLifecycleRetentionMigration.includes('PROVIDER_LIFECYCLE_RETENTION_REDACTED'),
  '180-day terminal-only minimization, reconciliation/review/legal-hold blockers, deterministic evidence hashes, shared generation locks, irreversible triggers, indexes, and leased worker',
)

addCheck(
  'account deletion is bounded to 30 days with immediate access removal',
  retentionById.get('account_deletion_plus_30d').maximumDaysAfterTrigger === 30 &&
    retentionById.get('account_deletion_plus_30d').fieldOverrides.session_access === 0 &&
    retentionById.get('account_deletion_plus_30d').fieldOverrides.public_profile_visibility === 0,
  JSON.stringify(retentionById.get('account_deletion_plus_30d')),
)
addCheck(
  'media scan retention preserves the existing 180-day and 50-record baseline',
  retentionById.get('media_scan_history_180d').maximumDaysAfterTrigger === 180 &&
    retentionById.get('media_scan_history_180d').fieldOverrides.maximum_records_per_asset === 50,
  JSON.stringify(retentionById.get('media_scan_history_180d')),
)
addCheck(
  'generation retention excludes raw prompts and expires previews early',
  retentionById.get('generation_terminal_365d').maximumDaysAfterTrigger === 365 &&
    retentionById.get('generation_terminal_365d').fieldOverrides.safe_prompt_preview === 30 &&
    retentionById.get('generation_terminal_365d').fieldOverrides.raw_prompt === 0 &&
    retentionById.get('generation_terminal_365d').fieldOverrides.private_output_url === 0,
  JSON.stringify(retentionById.get('generation_terminal_365d')),
)
addCheck(
  'chat retention matches the frozen capability contract',
  retentionById.get(chatCapabilityContract.persistence.retentionPolicyId)?.maximumDaysAfterTrigger ===
      chatCapabilityContract.persistence.inactiveConversationMaximumDays &&
    retentionById.get(chatCapabilityContract.persistence.retentionPolicyId)?.fieldOverrides.accepted_deletion_request ===
      chatCapabilityContract.persistence.deletionMaximumDays &&
    retentionById.get(chatCapabilityContract.persistence.retentionPolicyId)?.fieldOverrides.access_after_deletion_request === 0 &&
    retentionById.get(chatCapabilityContract.persistence.retentionPolicyId)?.fieldOverrides.backup_expiry_after_primary_purge ===
      chatCapabilityContract.persistence.backupExpiryDaysAfterPrimaryPurge,
  JSON.stringify(retentionById.get(chatCapabilityContract.persistence.retentionPolicyId)),
)
addCheck(
  'observability retention is split by logs traces and aggregates',
  retentionById.get('observability_bounded').maximumDaysAfterTrigger === 30 &&
    retentionById.get('observability_bounded').fieldOverrides.trace === 7 &&
    retentionById.get('observability_bounded').fieldOverrides.aggregate_metric === 90,
  JSON.stringify(retentionById.get('observability_bounded')),
)
addCheck(
  'backup and export retention are bounded',
  retentionById.get('rolling_backup_35d').maximumDaysAfterTrigger === 35 &&
    retentionById.get('export_package_7d').maximumDaysAfterTrigger === 7 &&
    retentionById.get('export_package_7d').fieldOverrides.private_signed_download === 1,
  'backup=35d export=7d link=1d',
)
addCheck(
  'backup expiry has local restore-negative evidence without claiming target schedule or KMS acceptance',
  retentionAutomationInventory.rolling_backup_35d === 'local_restore_negative_expiry_rehearsal_implemented_pending_target_environment_schedule_and_kms_acceptance' &&
    releaseInfrastructureContract.objectives.backupRetentionDays === 35 &&
    releaseInfrastructureContract.evidence.requiredSections.includes('backupExpiry') &&
    ['database_backup_expired', 'database_backup_restore_denied', 'object_backup_expired', 'object_backup_restore_denied', 'local_restore_copy_expired'].every((marker) => releaseInfrastructureRunnerSource.includes(marker)) &&
    releaseInfrastructureRunnerSource.includes('targetScheduleVerified: false') &&
    releaseInfrastructureRunnerSource.includes('managedKeyDestructionVerified: false') &&
    governance.runtimeStatus.backupDeletionRehearsed === false &&
    governance.runtimeStatus.retentionAutomationComplete === false,
  retentionAutomationInventory.rolling_backup_35d,
)
addCheck(
  'raw request and Provider payload retention is zero',
  retentionById.get('transient_request_zero').maximumDaysAfterTrigger === 0,
  JSON.stringify(retentionById.get('transient_request_zero')),
)

const assetIds = governance.dataAssets.map((asset) => asset.id)
const assetsById = new Map(governance.dataAssets.map((asset) => [asset.id, asset]))
addCheck('the complete V1 data asset inventory is frozen', sameMembers(assetIds, expectedAssets), `${assetIds.length} assets`)
addCheck('data asset ids are unique', unique(assetIds), `${assetIds.length} assets`)
addCheck(
  'chat messages are a distinct encrypted owner-scoped governed asset',
  assetsById.get(chatCapabilityContract.persistence.governanceAssetId)?.classification === 'restricted' &&
    assetsById.get(chatCapabilityContract.persistence.governanceAssetId)?.retentionPolicyId ===
      chatCapabilityContract.persistence.retentionPolicyId &&
    assetsById.get(chatCapabilityContract.persistence.governanceAssetId)?.locations.includes('postgres') &&
    assetsById.get(chatCapabilityContract.persistence.governanceAssetId)?.locations.includes('backup_archive') &&
    assetsById.get(chatCapabilityContract.persistence.governanceAssetId)?.exampleFields.includes('encrypted user message') &&
    sameMembers(assetsById.get(chatCapabilityContract.persistence.governanceAssetId)?.prismaModels ?? [], [
      'ChatConversation',
      'ChatTurn',
      'ChatMessage',
      'ChatDeletionTombstone',
    ]) &&
    assetsById.get(chatCapabilityContract.persistence.governanceAssetId)?.ownerTasks.includes('V1-21') &&
    assetsById.get(chatCapabilityContract.persistence.governanceAssetId)?.ownerTasks.includes('V1-22') &&
    assetsById.get(chatCapabilityContract.persistence.governanceAssetId)?.ownerTasks.includes('V1-67'),
  chatCapabilityContract.persistence.governanceAssetId,
)

const schemaSource = read(governance.currentRuntimeBaseline.schemaFile)
const schemaModels = [...schemaSource.matchAll(/^model\s+(\w+)\s*\{/gm)].map((match) => match[1])
const mappedModels = governance.dataAssets.flatMap((asset) => asset.prismaModels)
addCheck(
  'every Prisma model is governed exactly once',
  unique(mappedModels) && sameMembers(mappedModels, schemaModels),
  `${mappedModels.length}/${schemaModels.length} mapped`,
)
addCheck(
  'runtime model count matches the governance inventory',
  governance.currentRuntimeBaseline.modelCount === schemaModels.length,
  `${governance.currentRuntimeBaseline.modelCount}/${schemaModels.length}`,
)

const nodeIds = governance.flowNodes.map((node) => node.id)
const nodesById = new Map(governance.flowNodes.map((node) => [node.id, node]))
addCheck('all governed flow nodes are defined', sameMembers(nodeIds, expectedNodes), nodeIds.join(', '))
addCheck('flow node ids are unique', unique(nodeIds), `${nodeIds.length} nodes`)
for (const node of governance.flowNodes) {
  addCheck(
    `${node.id} flow node has a type and persistence decision`,
    Boolean(node.type) && typeof node.persistent === 'boolean',
    `${node.type}/persistent=${node.persistent}`,
  )
}

for (const asset of governance.dataAssets) {
  addCheck(`${asset.id} uses a valid classification`, classificationsById.has(asset.classification), asset.classification)
  addCheck(
    `${asset.id} uses valid locations`,
    nonEmptyArray(asset.locations) && asset.locations.every((location) => nodesById.has(location)),
    asset.locations.join(', '),
  )
  addCheck(
    `${asset.id} has subjects, purposes, examples, and access roles`,
    nonEmptyArray(asset.dataSubjects) &&
      nonEmptyArray(asset.purposes) &&
      asset.purposes.every((purposeId) => purposesById.has(purposeId)) &&
      nonEmptyArray(asset.exampleFields) &&
      nonEmptyArray(asset.accessRoles),
    `${asset.dataSubjects.length}/${asset.purposes.length}/${asset.exampleFields.length}/${asset.accessRoles.length}`,
  )
  addCheck(
    `${asset.id} has retention, export, deletion, and implementation owners`,
    retentionById.has(asset.retentionPolicyId) &&
      Boolean(asset.exportPolicy) &&
      Boolean(asset.deletionPolicy) &&
      nonEmptyArray(asset.ownerTasks) &&
      asset.ownerTasks.every((taskId) => /^(?:V1|LEGAL)-\d+$/.test(taskId)),
    `${asset.retentionPolicyId}/${asset.exportPolicy}/${asset.deletionPolicy}`,
  )
  addCheck(
    `${asset.id} references only real Prisma models`,
    asset.prismaModels.every((model) => schemaModels.includes(model)),
    asset.prismaModels.join(', ') || 'non-Prisma asset',
  )
}

addCheck(
  'deployment secrets stay in the secret store and runtime memory only',
  assetsById.get('deployment_secrets').classification === 'secret' &&
    sameMembers(assetsById.get('deployment_secrets').locations, ['api_memory', 'secret_store', 'worker_memory']) &&
    assetsById.get('deployment_secrets').exportPolicy === 'never_export',
  JSON.stringify(assetsById.get('deployment_secrets').locations),
)
addCheck(
  'raw inputs and Provider payloads are memory-only transient assets',
  assetsById.get('raw_generation_inputs').retentionPolicyId === 'transient_request_zero' &&
    assetsById.get('raw_provider_payloads').retentionPolicyId === 'transient_request_zero' &&
    assetsById.get('raw_provider_payloads').locations.every((location) => ['api_memory', 'worker_memory'].includes(location)),
  `${assetsById.get('raw_generation_inputs').locations.join(', ')}/${assetsById.get('raw_provider_payloads').locations.join(', ')}`,
)
addCheck(
  'account and shared ledgers distinguish deletion from anonymization',
  assetsById.get('identity_account_profile').deletionPolicy.includes('tombstone') &&
    assetsById.get('marketplace_records').deletionPolicy.includes('anonymize') &&
    assetsById.get('internal_points_ledger').deletionPolicy.includes('anonymize') &&
    assetsById.get('creative_accounting_records').deletionPolicy.includes('anonymize'),
  'identity, marketplace, points, creative accounting',
)

const flowIds = governance.dataFlows.map((flow) => flow.id)
const flowsById = new Map(governance.dataFlows.map((flow) => [flow.id, flow]))
addCheck('the complete V1 data flow set is frozen', sameMembers(flowIds, expectedFlows), `${flowIds.length} flows`)
addCheck('data flow ids are unique', unique(flowIds), `${flowIds.length} flows`)
addCheck(
  'every governed data asset participates in an allowed flow',
  governance.dataAssets.every((asset) => governance.dataFlows.some((flow) => flow.dataAssetIds.includes(asset.id))),
  `${new Set(governance.dataFlows.flatMap((flow) => flow.dataAssetIds)).size}/${governance.dataAssets.length} assets`,
)
for (const flow of governance.dataFlows) {
  addCheck(
    `${flow.id} connects valid nodes`,
    nodesById.has(flow.from) && nodesById.has(flow.to) && flow.from !== flow.to,
    `${flow.from}->${flow.to}`,
  )
  addCheck(
    `${flow.id} references governed assets`,
    nonEmptyArray(flow.dataAssetIds) && flow.dataAssetIds.every((assetId) => assetsById.has(assetId)),
    flow.dataAssetIds.join(', '),
  )
  addCheck(
    `${flow.id} has controls and a persistence decision`,
    flow.requiredControls.length >= 3 && Boolean(flow.destinationPersistence),
    `${flow.requiredControls.length}/${flow.destinationPersistence}`,
  )
}

addCheck(
  'creative Provider dispatch requires approval, region, policy, retention, and budget controls',
  includesMembers(flowsById.get('runtime_to_creative_provider').requiredControls, [
    'explicit real-call approval',
    'region eligibility',
    'content policy',
    'minimum payload',
    'retention/training contract',
    'budget gate',
  ]),
  flowsById.get('runtime_to_creative_provider').requiredControls.join(', '),
)
addCheck(
  'Provider credentials use a header-only non-persistent transport flow',
  flowsById.get('worker_auth_to_creative_provider').dataAssetIds.length === 1 &&
    flowsById.get('worker_auth_to_creative_provider').dataAssetIds[0] === 'deployment_secrets' &&
    flowsById.get('worker_auth_to_creative_provider').requiredControls.includes('TLS Authorization header only') &&
    flowsById.get('worker_auth_to_creative_provider').requiredControls.includes('never URL/body/log') &&
    flowsById.get('worker_auth_to_creative_provider').destinationPersistence === 'transport_authentication_only_no_provider_storage',
  JSON.stringify(flowsById.get('worker_auth_to_creative_provider')),
)
addCheck(
  'Provider responses are memory-only until normalized',
  flowsById.get('creative_provider_to_runtime').destinationPersistence === 'memory_only_until_normalized' &&
    includesMembers(flowsById.get('creative_provider_to_runtime').requiredControls, ['allowlisted normalization', 'raw payload discard']),
  JSON.stringify(flowsById.get('creative_provider_to_runtime')),
)
addCheck(
  'Admin and observability have independent allowlists',
  flowsById.get('api_to_admin_console').requiredControls.includes('purpose-specific allowlist') &&
    flowsById.get('runtime_to_observability').requiredControls.includes('structured allowlist'),
  'admin and observability controls',
)
addCheck(
  'export flow requires subject verification and short-lived delivery',
  flowsById.get('primary_data_to_export_storage').requiredControls.includes('verified subject request') &&
    flowsById.get('export_storage_to_browser').requiredControls.includes('one-day private signed link'),
  'export build and delivery controls',
)
addCheck(
  'chat persistence is covered by the PostgreSQL flow and per-asset export and deletion contracts',
  flowsById.get('api_to_postgres').dataAssetIds.includes(chatCapabilityContract.persistence.governanceAssetId) &&
    assetsById.get(chatCapabilityContract.persistence.governanceAssetId).exportPolicy.includes('conversations_and_messages') &&
    assetsById.get(chatCapabilityContract.persistence.governanceAssetId).deletionPolicy.includes('delete_primary_within_30d') &&
    assetsById.get(chatCapabilityContract.persistence.governanceAssetId).deletionPolicy.includes('expire_backup_within_35d'),
  chatCapabilityContract.persistence.governanceAssetId,
)

const forbiddenFlowIds = governance.forbiddenFlows.map((flow) => flow.id)
addCheck(
  'the complete forbidden-flow set is frozen',
  sameMembers(forbiddenFlowIds, expectedForbiddenFlows),
  forbiddenFlowIds.join(', '),
)
addCheck('forbidden flow ids are unique', unique(forbiddenFlowIds), `${forbiddenFlowIds.length} forbidden flows`)
for (const flow of governance.forbiddenFlows) {
  addCheck(
    `${flow.id} has an asset scope and destinations`,
    Boolean(flow.dataAssetId) && nonEmptyArray(flow.forbiddenDestinations),
    `${flow.dataAssetId}/${flow.forbiddenDestinations.join(', ')}`,
  )
}
const secretForbidden = governance.forbiddenFlows.find((flow) => flow.id === 'secret_to_logs_or_database')
addCheck(
  'secrets are forbidden from every secondary and user surface',
  includesMembers(secretForbidden.forbiddenDestinations, [
    'postgres',
    'observability',
    'backup_archive',
    'export_storage',
    'admin_console',
    'notification_channel',
    'browser',
  ]),
  secretForbidden.forbiddenDestinations.join(', '),
)

addCheck(
  'export implementation remains explicit and bounded',
  governance.subjectRights.export.implementationTaskId === 'V1-67' &&
    governance.subjectRights.export.implementationStatus === 'implemented_pending_production_storage_acceptance' &&
    governance.subjectRights.export.targetDays === 30 &&
    governance.subjectRights.export.packageRetentionDays === 7 &&
    governance.subjectRights.export.downloadLinkHours === 24 &&
    governance.subjectRights.export.requiredEvidence.length >= 7,
  JSON.stringify(governance.subjectRights.export),
)
addCheck(
  'deletion implementation remains explicit and bounded',
  governance.subjectRights.deletion.implementationTaskId === 'V1-67' &&
    governance.subjectRights.deletion.implementationStatus === 'implemented_pending_backup_expiry_rehearsal' &&
    governance.subjectRights.deletion.primaryStoreTargetDays === 30 &&
    governance.subjectRights.deletion.privateObjectTargetHours === 24 &&
    governance.subjectRights.deletion.cacheSearchTargetHours === 24 &&
    governance.subjectRights.deletion.externalProcessorRequestHours === 24 &&
    governance.subjectRights.deletion.externalProcessorConfirmationDays === 30 &&
    governance.subjectRights.deletion.backupExpiryDaysAfterPrimaryPurge === 35,
  JSON.stringify(governance.subjectRights.deletion),
)
addCheck(
  'account export and deletion routes are backed by persistent runtime processing',
  dataRightsRoutesSource.includes("'/api/users/me/data-rights/requests/:id/export'") &&
    dataRightsRoutesSource.includes("'/api/admin/data-rights/requests/:id/process'") &&
    prismaDataRightsSource.includes('buildDataExportPackage') &&
    prismaDataRightsSource.includes('applyPrimaryDeletion'),
  'server/src/modules/dataRights/routes.js',
)
addCheck(
  'deletion has immediate access revocation and closeout evidence',
  includesMembers(governance.subjectRights.deletion.immediateActions, [
    'disable account',
    'revoke sessions and OAuth tokens',
    'revoke private downloads',
    'block new jobs and notifications',
  ]) && governance.subjectRights.deletion.requiredEvidence.length >= 7,
  governance.subjectRights.deletion.immediateActions.join(', '),
)
addCheck(
  'legal holds are scoped, reviewed, and finite',
  governance.subjectRights.legalHold.implementationStatus === 'implemented_pending_target_environment_migration_acceptance' &&
    governance.subjectRights.legalHold.authorizedRoles.length >= 2 &&
    governance.subjectRights.legalHold.requiredFields.length >= 8 &&
    governance.subjectRights.legalHold.reviewIntervalDays === 90 &&
    governance.subjectRights.legalHold.indefiniteHoldAllowed === false &&
    governance.subjectRights.legalHold.behavior.includes('scoped') &&
    schemaSource.includes('model DataRightsLegalHold {') &&
    schemaSource.includes('model DataRightsLegalHoldEvent {') &&
    dataRightsRoutesSource.includes("'/api/admin/data-rights/legal-holds'") &&
    prismaDataRightsSource.includes('eligibleReceipts') &&
    prismaDataRightsSource.includes("heldBeforeProvider.has('creative')"),
  JSON.stringify(governance.subjectRights.legalHold),
)

const providerMappings = governance.externalProcessors.creativeProviders
const providerIds = providerMappings.map((processor) => processor.providerId)
const providerMatrixById = new Map(providerMatrix.providers.map((provider) => [provider.id, provider]))
addCheck(
  'all selected creative Providers have data-governance mappings',
  sameMembers(providerIds, providerMatrix.providers.map((provider) => provider.id)),
  providerIds.join(', '),
)
addCheck('creative Provider processor ids are unique', unique(providerIds), `${providerIds.length} Providers`)
for (const processor of providerMappings) {
  const provider = providerMatrixById.get(processor.providerId)
  addCheck(`${processor.providerId} exists in the Provider decision matrix`, Boolean(provider), processor.providerId)
  addCheck(
    `${processor.providerId} modality and training posture match the Provider decision`,
    provider?.modality === processor.modality && provider?.data?.trainingDefault === processor.trainingDefault,
    `${processor.modality}/${String(processor.trainingDefault)}`,
  )
  addCheck(
    `${processor.providerId} remains unapproved`,
    processor.approvalStatus === 'not_approved',
    processor.approvalStatus,
  )
  addCheck(
    `${processor.providerId} has bounded asset, retention, region, and deletion evidence`,
    nonEmptyArray(processor.allowedDataAssetIds) &&
      processor.allowedDataAssetIds.every((assetId) => assetsById.has(assetId)) &&
      Boolean(processor.defaultRetention) &&
      Boolean(processor.regionCondition) &&
      Boolean(processor.deletionEvidence),
    processor.allowedDataAssetIds.join(', '),
  )
}

const serviceClasses = governance.externalProcessors.serviceClasses
const serviceClassIds = serviceClasses.map((service) => service.id)
addCheck('external service classes are complete', sameMembers(serviceClassIds, expectedServiceClasses), serviceClassIds.join(', '))
addCheck('external service class ids are unique', unique(serviceClassIds), `${serviceClassIds.length} classes`)
for (const service of serviceClasses) {
  addCheck(
    `${service.id} has an owner, governed assets, and contract requirements`,
    /^V1-\d+$/.test(service.approvalOwnerTask) &&
      nonEmptyArray(service.allowedDataAssetIds) &&
      service.allowedDataAssetIds.every((assetId) => assetsById.has(assetId)) &&
      service.requiredContract.length >= 4,
    `${service.approvalOwnerTask}/${service.allowedDataAssetIds.join(', ')}`,
  )
}

const requiredForbiddenKeys = [
  'authorization',
  'cookie',
  'password',
  'passwordHash',
  'token',
  'tokenHash',
  'secret',
  'privateKey',
  'apiKey',
  'rawPrompt',
  'rawConversation',
  'rawProviderRequest',
  'rawProviderResponse',
  'privateDownloadUrl',
]
addCheck(
  'redaction preview bounds match runtime contracts',
  governance.redactionPolicy.promptPreviewMaxChars === 160 &&
    governance.redactionPolicy.errorPreviewMaxChars === 240,
  `${governance.redactionPolicy.promptPreviewMaxChars}/${governance.redactionPolicy.errorPreviewMaxChars}`,
)
addCheck(
  'redaction policy forbids secret and raw payload keys',
  includesMembers(governance.redactionPolicy.forbiddenKeys, requiredForbiddenKeys),
  governance.redactionPolicy.forbiddenKeys.join(', '),
)
addCheck(
  'redaction policy has purpose-specific secondary-surface rules',
  governance.redactionPolicy.observabilityAllowlist.length >= 8 &&
    governance.redactionPolicy.adminRules.length >= 5 &&
    governance.redactionPolicy.notificationRules.length >= 5 &&
    governance.redactionPolicy.exportRules.length >= 5,
  `${governance.redactionPolicy.observabilityAllowlist.length}/${governance.redactionPolicy.adminRules.length}/${governance.redactionPolicy.notificationRules.length}/${governance.redactionPolicy.exportRules.length}`,
)
addCheck(
  'redaction replacements are stable and non-revealing',
  includesMembers(governance.redactionPolicy.replacementTokens, ['<redacted>', '<redacted-url>', 'redacted_<stable-hash>']),
  governance.redactionPolicy.replacementTokens.join(', '),
)

addCheck(
  'implementation handoff covers every downstream owner',
  sameMembers(governance.implementationHandoff.map((item) => item.taskId), expectedHandoffTasks),
  governance.implementationHandoff.map((item) => item.taskId).join(', '),
)
addCheck(
  'every implementation handoff has concrete scope',
  governance.implementationHandoff.every((item) => Boolean(item.scope)),
  `${governance.implementationHandoff.length} tasks`,
)

addCheck(
  'current runtime strengths and gaps remain explicit',
  governance.currentRuntimeBaseline.availableCapabilities.length >= 7 &&
    governance.currentRuntimeBaseline.knownGaps.length >= 8,
  `${governance.currentRuntimeBaseline.availableCapabilities.length}/${governance.currentRuntimeBaseline.knownGaps.length}`,
)
addCheck(
  'current runtime evidence files exist',
  governance.currentRuntimeBaseline.evidenceFiles.every((file) => fs.existsSync(path.join(root, file))),
  governance.currentRuntimeBaseline.evidenceFiles.join(', '),
)
addCheck(
  'Provider deletion is fail-closed, idempotent, and persists bounded receipts',
  providerDeletionGatewaySource.includes("'idempotency-key'") &&
    providerDeletionGatewaySource.includes('receiptHash') &&
    providerDeletionGatewaySource.includes("payload?.status !== 'completed'") &&
    prismaDataRightsSource.includes('providerDeletionGateway'),
  'server/src/dataRights/providerDeletionGateway.js',
)
addCheck(
  'runtime Provider HTTP client keeps secrets in the deployment boundary',
  providerHttpClientSource.includes("secretEnvKey: 'CREATIVE_STAGING_PROVIDER_API_TOKEN'") &&
    providerHttpClientSource.includes('source[definition.secretEnvKey]') &&
    providerHttpClientSource.includes('authorization: `Bearer ${apiToken}`') &&
    !providerHttpClientSource.includes('apiToken,'),
  'server/src/creative/providerHttpClient.js',
)
addCheck(
  'runtime Provider HTTP client uses fixed destination and minimum payload',
  providerHttpClientSource.includes("baseUrl: 'https://api.replicate.com/v1'") &&
    providerHttpClientSource.includes("modelId: 'black-forest-labs/flux-1.1-pro'") &&
    providerHttpClientSource.includes("const allowedKeys = ['prompt', 'aspect_ratio', 'seed', 'style_preset']"),
  'fixed Replicate endpoint and four allowlisted input fields',
)
addCheck(
  'runtime Provider HTTP client is staging-only and not registered by default',
  providerEnvSource.includes("strictBoolFlag(source, 'CREATIVE_PROVIDER_HTTP_CLIENT_ENABLED', false)") &&
    providerEnvSource.includes("CREATIVE_PROVIDER_HTTP_CLIENT_ENABLED requires NODE_ENV=production") &&
    providerEnvSource.includes("CREATIVE_PROVIDER_HTTP_CLIENT_ENABLED requires CREATIVE_PROVIDER_RUNTIME_ENV=staging") &&
    !generationServiceSource.includes('createCreativeProviderHttpClient'),
  'explicit env gate with no default generation-service registration',
)
addCheck(
  'runtime Provider status reads use a fixed path and strict response projection',
  providerHttpClientSource.includes('buildReplicatePredictionStatusRequest') &&
    providerHttpClientSource.includes("pathname: `/predictions/${normalized}`") &&
    providerHttpClientSource.includes('replicateResponseProjectionKeys') &&
    providerHttpClientSource.includes('projectReplicatePredictionResponse'),
  'fixed Replicate status path and allowlisted in-memory projection',
)
addCheck(
  'runtime Provider polling has independent default-off staging and worker gates',
  providerEnvSource.includes("strictBoolFlag(source, 'CREATIVE_PROVIDER_POLLING_ENABLED', false)") &&
    providerEnvSource.includes("strictBoolFlag(source, 'CREATIVE_PROVIDER_POLLING_WORKER_ENABLED', false)") &&
    providerEnvSource.includes('CREATIVE_PROVIDER_POLLING_ENABLED requires CREATIVE_PROVIDER_HTTP_CLIENT_ENABLED=true') &&
    providerStatusClientRegistrySource.includes('createCreativeProviderStatusClient') &&
    providerStatusClientRegistrySource.includes('!config.polling.enabled || !config.polling.workerEnabled'),
  'dedicated worker status client remains disabled without both polling switches',
)
addCheck(
  'runtime Provider polling redacts worker results and closes timeouts through replay',
  providerPollingWorkerSource.includes('const safePollingStatusResult') &&
    providerPollingWorkerSource.includes("'creative.provider_polling.retry_scheduled'") &&
    providerPollingWorkerSource.includes("'creative.provider_polling.timed_out'") &&
    providerPollingWorkerSource.includes('applyProviderReplayThroughLedger') &&
    !providerPollingWorkerSource.includes('errorPreview: failure.messagePreview'),
  'safe polling summaries, retry audit, and idempotent timeout replay',
)

const authRoutes = read('server/src/modules/auth/routes.js')
const scanProvider = read('server/src/media/scanProvider.js')
const generationRecords = read('server/src/creative/generationRecords.js')
const providerAdapter = read('server/src/creative/providerAdapterContract.js')
const adminRoutes = read('server/src/modules/admin/routes.js')

addCheck(
  'runtime schema has an explicit deleted account state',
  /enum UserStatus\s*\{[\s\S]*?deleted[\s\S]*?\}/.test(schemaSource),
  governance.currentRuntimeBaseline.schemaFile,
)
addCheck(
  'runtime supports session listing and revocation',
  authRoutes.includes("'/api/auth/sessions'") && authRoutes.includes("'/api/auth/sessions/:id'"),
  'server/src/modules/auth/routes.js',
)
addCheck(
  'runtime media scan retention matches the frozen baseline',
  scanProvider.includes('MEDIA_SCAN_HISTORY_RETENTION_DAYS, 180') &&
    scanProvider.includes('MEDIA_SCAN_HISTORY_RETENTION_MAX_PER_ASSET, 50'),
  'server/src/media/scanProvider.js',
)
addCheck(
  'runtime creative records use hashes and bounded previews',
  generationRecords.includes("digest('hex')") &&
    generationRecords.includes('.slice(0, 160)') &&
    generationRecords.includes('.slice(0, 240)') &&
    !schemaSource.includes('rawPrompt'),
  'server/src/creative/generationRecords.js',
)
addCheck(
  'runtime Provider adapter rejects secret-like keys',
  providerAdapter.includes('secretKeyPattern') &&
    providerAdapter.includes('Provider adapter exposed unsafe metadata key'),
  'server/src/creative/providerAdapterContract.js',
)
addCheck(
  'runtime Admin creative views apply safe serializers',
  adminRoutes.includes('safeErrorPreview') &&
    adminRoutes.includes('safeProviderJobIdEvidence'),
  'server/src/modules/admin/routes.js',
)
addCheck(
  'runtime data export retention deletes namespace-constrained objects before locators',
  exportArtifactRetentionSource.includes('exportStorageKeyPattern') &&
    exportArtifactRetentionSource.includes('deleteStorageObject') &&
    exportArtifactRetentionSource.includes('receiptHash') &&
    prismaDataRightsSource.indexOf('deleteDataRightsExportObject') < prismaDataRightsSource.indexOf('dataRightsExportArtifact.deleteMany') &&
    prismaDataRightsSource.includes("SET LOCAL app.data_rights_maintenance = 'on'") &&
    prismaDataRightsSource.includes("'export_artifact_expired'") &&
    workerJobsSource.includes("id: 'data-rights-export-retention-sweep'") &&
    workerJobsSource.includes('dataRightsExportRetentionSweepLimit'),
  'dedicated object boundary, transactional locator removal, immutable evidence, and leased bounded worker',
)
addCheck(
  'runtime observability retention aggregates then deletes bounded raw telemetry',
  observabilityRetentionSource.includes("policyId: 'observability_bounded'") &&
    observabilityRetentionSource.includes('rawLogDays: 30') &&
    observabilityRetentionSource.includes('traceDays: 7') &&
    observabilityRetentionSource.includes('aggregateDays: 90') &&
    prismaObservabilitySource.indexOf('observabilityRetentionAggregate.upsert') < prismaObservabilitySource.indexOf('observabilityLog.deleteMany') &&
    prismaObservabilitySource.includes('traceSpan.deleteMany') &&
    prismaObservabilitySource.includes('observabilityRetentionAggregate.deleteMany') &&
    workerJobsSource.includes("id: 'observability-retention-sweep'") &&
    workerJobsSource.includes('observabilityRetentionSweepLimit') &&
    observabilityRetentionMigration.includes('observability_retention_aggregates'),
  'anonymous daily aggregates, transactional raw deletion, aggregate expiry, and leased bounded worker',
)
addCheck(
  'runtime observability persistence rejects non-allowlisted structured log data globally',
  structuredLoggingSource.includes('projectPersistedObservabilityLog') &&
    structuredLoggingSource.includes('rejectUnsupportedKeys') &&
    structuredLoggingSource.includes('projectLogAttributes') &&
    structuredLoggingSource.includes('must be a bounded scalar') &&
    prismaObservabilitySource.includes('projectPersistedObservabilityLog(log)') &&
    seedObservabilitySource.includes('projectPersistedObservabilityLog(log)'),
  'shared root and event-attribute allowlist before Prisma/Seed writes',
)
addCheck(
  'runtime notification retention deletes bounded notification, email Provider event, and terminal Provider alert families after 180 days',
  notificationRetentionSource.includes("policyId: 'notification_created_plus_180d'") &&
    notificationRetentionSource.includes('retentionDays: 180') &&
    notificationRetentionSource.includes('maximumSweepLimit: 1000') &&
    prismaRepositorySource.includes("orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]") &&
    prismaRepositorySource.includes('notificationDeliveryAttempt.count') &&
    prismaRepositorySource.includes('notification.deleteMany') &&
    prismaRepositorySource.includes('notificationEmailProviderEvent.deleteMany') &&
    prismaRepositorySource.includes('providerAlertDeliveryAttempt.deleteMany') &&
    prismaRepositorySource.includes('providerAlertDeliveryReplay.deleteMany') &&
    prismaRepositorySource.includes('providerAlertDelivery.deleteMany') &&
    notificationRetentionSource.includes("providerAlertTerminalStatuses: Object.freeze(['succeeded', 'dead_lettered', 'cancelled'])") &&
    workerJobsSource.includes("id: 'notification-retention-sweep'") &&
    workerJobsSource.includes('notificationRetentionSweepLimit') &&
    notificationRetentionMigration.includes('notifications_retention_idx') &&
    providerAlertRetentionMigration.includes('provider_alert_deliveries_status_updated_at_id_idx') &&
    notificationEmailProviderEventMigration.includes('notification_email_provider_events_recipient_fingerprint_received_at_idx') &&
    notificationEmailProviderEventMigration.includes('notification_deliveries_provider_receipt_hash_idx'),
  'global oldest-first bounded deletion, active recipient suppression and Provider alert exclusion, child evidence cleanup, indexes, and leased worker',
)
addCheck(
  'runtime operation lease retention deletes bounded expired or released coordination rows after seven days',
  operationLeaseRetentionSource.includes("policyId: 'lease_expiry_plus_7d'") &&
    operationLeaseRetentionSource.includes('retentionDays: 7') &&
    operationLeaseRetentionSource.includes('maximumSweepLimit: 1000') &&
    prismaRepositorySource.includes("orderBy: [{ releasedAt: 'asc' }, { key: 'asc' }]") &&
    prismaRepositorySource.includes("orderBy: [{ expiresAt: 'asc' }, { key: 'asc' }]") &&
    prismaRepositorySource.includes('operationLease.deleteMany') &&
    workerJobsSource.includes("id: 'operation-lease-retention-sweep'") &&
    workerJobsSource.includes('operationLeaseRetentionSweepLimit') &&
    operationLeaseRetentionMigration.includes('operation_leases_released_retention_idx'),
  'seven-day cutoff, released/expired ordering, bounded rechecked deletion, index, and leased worker',
)
addCheck(
  'runtime private Library retention provides owner recovery then bounded hard deletion after 30 days',
  privateLibraryRetentionSource.includes("policyId: 'private_library_delete_plus_30d'") &&
    privateLibraryRetentionSource.includes('retentionDays: 30') &&
    privateLibraryRetentionSource.includes('maximumSweepLimit: 1000') &&
    prismaRepositorySource.includes("action: 'library.deleted'") &&
    prismaRepositorySource.includes("action: 'library.restored'") &&
    prismaRepositorySource.includes("orderBy: [{ deletedAt: 'asc' }, { id: 'asc' }]") &&
    prismaRepositorySource.includes('libraryItem.deleteMany') &&
    workerJobsSource.includes("id: 'private-library-retention-sweep'") &&
    workerJobsSource.includes('privateLibraryRetentionSweepLimit') &&
    privateLibraryRetentionMigration.includes('library_items_deleted_at_id_idx'),
  'owner-scoped soft delete, optimistic restore, 30-day cutoff, bounded rechecked deletion, index, and leased worker',
)
addCheck(
  'runtime auth credential retention deletes bounded credential material while retaining session evidence',
  authCredentialRetentionSource.includes("policyId: 'auth_expiry_plus_30d'") &&
    authCredentialRetentionSource.includes('retentionDays: 30') &&
    authCredentialRetentionSource.includes('maximumSweepLimit: 1000') &&
    prismaRepositorySource.includes('oAuthAuthorizationRequest.deleteMany') &&
    prismaRepositorySource.includes('refreshToken.deleteMany') &&
    prismaRepositorySource.includes('apiKeyCredential.deleteMany') &&
    workerJobsSource.includes("id: 'auth-credential-retention-sweep'") &&
    workerJobsSource.includes('authCredentialRetentionSweepLimit') &&
    authCredentialRetentionMigration.includes('refresh_tokens_retention_idx') &&
    schemaSource.includes('model AuthEmailAction') &&
    authCredentialRetentionSource.includes('consumedAt') &&
    prismaRepositorySource.includes('authEmailAction.deleteMany'),
  'OAuth requests, email actions, refresh tokens, and API key material use a 30-day bounded worker; AuthSession remains security evidence',
)
addCheck(
  'runtime community retention irreversibly anonymizes expired content while preserving active review and legal holds',
  retentionAutomationInventory.community_delete_plus_30d === 'implemented_pending_target_environment_acceptance' &&
    communityRetentionSource.includes("policyId: 'community_delete_plus_30d'") &&
    communityRetentionSource.includes('retentionDays: 30') &&
    communityRetentionSource.includes('moderationAppealWindowDays: 30') &&
    prismaCommunityRetentionSource.includes("scopeDomain: 'community'") &&
    prismaCommunityRetentionSource.includes('moderationCaseBlocksCommunityRetention(row, now)') &&
    prismaCommunityRetentionSource.includes('data-rights-subject:') &&
    prismaCommunityRetentionSource.includes('moderation-target:') &&
    prismaCommunityRetentionSource.includes("isolationLevel: 'ReadCommitted'") &&
    prismaCommunityRetentionSource.includes('postLike.deleteMany') &&
    prismaCommunityRetentionSource.includes('metadata: null') &&
    prismaCommunityRetentionSource.includes("deletionReasonCode: 'retention_expired'") &&
    workerJobsSource.includes("id: 'community-retention-sweep'") &&
    workerJobsSource.includes("lease: lease('community-retention-sweep')") &&
    communityRetentionMigration.includes('posts_deleted_at_id_idx') &&
    communityRetentionMigration.includes('comments_deleted_at_id_idx'),
  '30-day cutoff, tombstone identity, private content and likes removal, shared subject/target locks, review/appeal and legal-hold exclusions, indexes, and leased worker',
)
addCheck(
  'runtime security event retention preserves open incidents and legal holds before bounded 365 or 730 day deletion',
  retentionAutomationInventory.security_event_365d === 'implemented_pending_target_environment_acceptance' &&
    securityRetentionSource.includes("policyId: 'security_event_365d'") &&
    securityRetentionSource.includes('standardRetentionDays: 365') &&
    securityRetentionSource.includes('confirmedCriticalRetentionDays: 730') &&
    prismaSecurityRetentionSource.includes("status: 'resolved', criticalConfirmed: true") &&
    prismaSecurityRetentionSource.includes("'security-retention-legal-holds'") &&
    prismaSecurityRetentionSource.includes('data-rights-subject-ref:') &&
    prismaSecurityRetentionSource.includes("isolationLevel: 'ReadCommitted'") &&
    prismaSecurityRetentionSource.includes('securityEvent.deleteMany') &&
    workerJobsSource.includes("id: 'security-event-retention-sweep'") &&
    workerJobsSource.includes("lease: lease('security-event-retention-sweep')") &&
    adminRoutesSource.includes("'/api/admin/security/incidents'") &&
    adminRoutesSource.includes("'/api/admin/security/incidents/:id/resolve'") &&
    securityRetentionMigration.includes('security_incidents_resolution_check') &&
    securityRetentionMigration.includes('security_events_subject_ref_occurred_at_idx'),
  'persistent incident state, explicit hashed subject reference, legal-hold fail-closed behavior, Admin CAS workflow, indexes, and leased worker',
)
addCheck(
  'runtime risk retention redacts terminal subject links after 365 days while preserving decision evidence under legal hold',
  retentionAutomationInventory.security_event_365d === 'implemented_pending_target_environment_acceptance' &&
    riskRetentionSource.includes("policyId: 'security_event_365d'") &&
    riskRetentionSource.includes('retentionDays: 365') &&
    riskRetentionSource.includes("riskCase?.status === 'recovered'") &&
    riskRetentionSource.includes("riskCase?.status === 'closed'") &&
    prismaRiskRetentionSource.includes("'security-retention-legal-holds'") &&
    prismaRiskRetentionSource.includes('data-rights-subject-ref:') &&
    prismaRiskRetentionSource.includes("isolationLevel: 'ReadCommitted'") &&
    prismaRiskRetentionSource.includes('retentionRedactedAt: now') &&
    prismaRiskRetentionSource.includes('appellantId: null') &&
    prismaRiskRetentionSource.includes('actorId: null') &&
    prismaRiskRetentionSource.includes("dedupe_key = 'retained:'") &&
    workerJobsSource.includes("id: 'risk-record-retention-sweep'") &&
    workerJobsSource.includes("lease: lease('risk-record-retention-sweep')") &&
    riskRetentionMigration.includes('risk_cases_subject_ref_retention_redacted_at_idx') &&
    riskRetentionMigration.includes('risk_appeals_appellant_id_fkey'),
  'terminal-only 365-day cutoff, explicit temporary subject reference, legal-hold lock and recheck, irreversible field redaction, CAS, indexes, and leased worker',
)
addCheck(
  'runtime moderation case retention redacts closed case subjects after 730 days while preserving bounded decision evidence',
  retentionAutomationInventory.moderation_close_plus_730d === 'implemented_pending_target_environment_acceptance' &&
    moderationRetentionSource.includes("policyId: 'moderation_close_plus_730d'") &&
    moderationRetentionSource.includes('retentionDays: 730') &&
    moderationRetentionSource.includes('moderationAppealWindowMs') &&
    prismaModerationRetentionSource.includes("INTERVAL '30 days'") &&
    prismaModerationRetentionSource.includes("'security-retention-legal-holds'") &&
    prismaModerationRetentionSource.includes('data-rights-subject-ref:') &&
    prismaModerationRetentionSource.includes("isolationLevel: 'ReadCommitted'") &&
    prismaModerationRetentionSource.includes("SET LOCAL app.moderation_retention_maintenance = 'on'") &&
    prismaModerationRetentionSource.includes('affectedUserId: null') &&
    prismaModerationRetentionSource.includes('reporterId: null') &&
    prismaModerationRetentionSource.includes("statement: '[redacted after retention]'") &&
    prismaModerationRetentionSource.includes('reviewerId: null') &&
    prismaModerationRetentionSource.includes('appellantId: null') &&
    prismaModerationRetentionSource.includes('assigneeId: null, actorId: null') &&
    workerJobsSource.includes("id: 'moderation-case-retention-sweep'") &&
    workerJobsSource.includes("lease: lease('moderation-case-retention-sweep')") &&
    moderationRetentionMigration.includes('app.moderation_retention_maintenance') &&
    moderationRetentionMigration.includes('moderation_cases_affected_subject_ref_retention_redacted_at_idx') &&
    moderationRetentionMigration.includes('moderation_queue_events_shape_check'),
  'case-family 730-day cutoff, 30-day appeal window, legal-hold locks and recheck, dedicated maintenance mode, irreversible subject/text redaction, indexes, and leased worker',
)
addCheck(
  'runtime moderation operational retention permanently retires expired rules and minimizes completed bulk evidence',
  retentionAutomationInventory.moderation_close_plus_730d === 'implemented_pending_target_environment_acceptance' &&
    moderationOperationalRetentionSource.includes("latest?.toState === 'retired'") &&
    moderationOperationalRetentionSource.includes('!record.retentionRedactedAt') &&
    prismaModerationOperationalRetentionSource.includes("latest.to_state = 'retired'") &&
    prismaModerationOperationalRetentionSource.includes("scope_domain IN ('audit', 'safety')") &&
    prismaModerationOperationalRetentionSource.includes("'security-retention-legal-holds'") &&
    prismaModerationOperationalRetentionSource.includes('data-rights-subject-ref:') &&
    prismaModerationOperationalRetentionSource.includes('safety-rule-key:') &&
    prismaModerationOperationalRetentionSource.includes('moderation-bulk-idempotency:') &&
    prismaModerationOperationalRetentionSource.includes("SET LOCAL app.moderation_retention_maintenance = 'on'") &&
    prismaModerationOperationalRetentionSource.includes('createdById: null') &&
    prismaModerationOperationalRetentionSource.includes('actorSubjectRef: null') &&
    prismaModerationOperationalRetentionSource.includes('idempotencyKey: `retained:') &&
    prismaSafetyOperationsSource.includes('moderationBulkIdempotencyHash') &&
    prismaSafetyOperationsSource.includes("SAFETY_RULE_RETENTION_REDACTED") &&
    prismaSafetyOperationsSource.includes('moderation-case:') &&
    workerJobsSource.includes("id: 'moderation-operational-retention-sweep'") &&
    workerJobsSource.includes("lease: lease('moderation-operational-retention-sweep')") &&
    moderationOperationalRetentionMigration.includes('moderation_bulk_operations_idempotency_hash_key') &&
    moderationOperationalRetentionMigration.includes('safety_rule_versions_created_by_subject_ref_retention_redacted_at_idx'),
  'retired-rule and completed-bulk 730-day cutoff, legal-hold fail-closed behavior, shared write locks, permanent retirement, hash-only replay protection, aggregate result retention, migration indexes, and leased worker',
)
addCheck(
  'runtime marketplace retention deletes abandoned drafts and minimizes closed transaction evidence',
  retentionAutomationInventory.marketplace_close_plus_730d === 'partial_mutable_task_redaction_implemented_immutable_lifecycle_event_ledger_and_asset_evidence_contract_required' &&
    marketplaceRetentionSource.includes("policyId: 'marketplace_close_plus_730d'") &&
    marketplaceRetentionSource.includes('abandonedDraftDays: 30') &&
    marketplaceRetentionSource.includes('terminalRetentionDays: 730') &&
    prismaMarketplaceRetentionSource.includes("scopeDomain: marketplaceRetentionContract.legalHoldScopeDomain") &&
    prismaMarketplaceRetentionSource.includes("'security-retention-legal-holds'") &&
    prismaMarketplaceRetentionSource.includes('activeSubmissionStatuses') &&
    prismaMarketplaceRetentionSource.includes("status IN ('pending', 'failed')") &&
    prismaMarketplaceRetentionSource.includes("SET LOCAL app.marketplace_retention_maintenance = 'on'") &&
    prismaMarketplaceRetentionSource.includes('searchDocument.deleteMany') &&
    prismaMarketplaceRetentionSource.includes('notification.deleteMany') &&
    prismaMarketplaceRetentionSource.includes('publisherId: null, assigneeId: null') &&
    workerJobsSource.includes("id: 'marketplace-retention-sweep'") &&
    workerJobsSource.includes("lease: lease('marketplace-retention-sweep')") &&
    marketplaceRetentionMigration.includes("'task:' || task_id_value") &&
    marketplaceRetentionMigration.includes('MARKETPLACE_RETENTION_REDACTED') &&
    marketplaceRetentionMigration.includes('tasks_publisher_subject_ref_retention_redacted_at_idx'),
  'partial 30-day abandoned-draft deletion and 730-day mutable task-family minimization with immutable lifecycle, event, ledger, and asset evidence explicitly left pending contract approval',
)
addCheck(
  'runtime support retention performs two-stage minimization while preserving bounded case evidence',
  retentionAutomationInventory.support_close_plus_730d === 'implemented_pending_target_environment_acceptance' &&
    supportRetentionSource.includes("policyId: 'support_close_plus_730d'") &&
    supportRetentionSource.includes('messageBodyDays: 365') &&
    supportRetentionSource.includes('minimalEvidenceDays: 730') &&
    supportRetentionSource.includes("legalHoldScopeDomains: Object.freeze(['support', 'audit'])") &&
    prismaSupportRetentionSource.includes("'security-retention-legal-holds'") &&
    prismaSupportRetentionSource.includes('data-rights-subject-ref:') &&
    prismaSupportRetentionSource.includes("status: { in: supportRetentionContract.openDataRightsStatuses }") &&
    prismaSupportRetentionSource.includes('supportTicketMessage.updateMany') &&
    prismaSupportRetentionSource.includes('supportTicketCaseLink.updateMany') &&
    prismaSupportRetentionSource.includes('requesterId: null') &&
    prismaSupportRetentionSource.includes('createdBySubjectRef: null') &&
    prismaSupportSource.includes('support-ticket:') &&
    prismaSupportSource.includes("'SUPPORT_TICKET_RETAINED'") &&
    workerJobsSource.includes("id: 'support-retention-sweep'") &&
    workerJobsSource.includes("lease: lease('support-retention-sweep')") &&
    supportRetentionMigration.includes('requester_subject_ref') &&
    supportRetentionMigration.includes('retention_message_redacted_at') &&
    supportRetentionMigration.includes('retention_redacted_at') &&
    supportRetentionMigration.includes('ON DELETE SET NULL'),
  '365-day message-body redaction, 730-day identity/text/resource minimization, immutable case evidence, legal/data-rights blockers, stable subject refs, shared write locks, migration indexes, and leased worker',
)
addCheck(
  'runtime generation retention minimizes terminal generation metadata after review, lifecycle, accounting, and legal-hold closeout',
  retentionAutomationInventory.generation_terminal_365d === 'implemented_pending_target_environment_acceptance' &&
    generationRetentionSource.includes("policyId: 'generation_terminal_365d'") &&
    generationRetentionSource.includes('previewDays: 30') &&
    generationRetentionSource.includes('retentionDays: 365') &&
    prismaGenerationRetentionSource.includes("scope_domain IN ('audit', 'safety')") &&
    prismaGenerationRetentionSource.includes("row.status IN ('reserved', 'reconciliation_required')") &&
    prismaGenerationRetentionSource.includes("row.status = 'scheduled'") &&
    prismaGenerationRetentionSource.includes("SET LOCAL app.generation_retention_maintenance = 'on'") &&
    prismaGenerationRetentionSource.includes('actorId: null, actorHandle: null, subjectRef: null') &&
    prismaGenerationRetentionSource.includes('providerRequestId: null, providerJobId: null') &&
    workerJobsSource.includes("id: 'generation-retention-sweep'") &&
    workerJobsSource.includes("lease: lease('generation-retention-sweep')") &&
    generationRetentionMigration.includes("'creative-generation:' || NEW.id") &&
    generationRetentionMigration.includes('creative_generations_subject_ref_retention_redacted_at_idx'),
  '30/365-day two-stage minimization, review/appeal, legal-hold and unsettled lifecycle exclusions, shared database write lock, irreversible redaction, indexes, and leased worker',
)
addCheck(
  'new internal accounting facts pseudonymize subjects without claiming historical retention completion',
  retentionAutomationInventory.internal_ledger_plus_730d === 'partial_new_writes_pseudonymized_historical_immutable_fact_anonymization_contract_pending' &&
    internalAccountingSource.includes('export const accountingSubjectRef') &&
    internalAccountingSource.includes('export const accountingAvailableAccountRef') &&
    internalAccountingSource.includes('export const accountingActorRef') &&
    prismaRepositorySource.includes('const actorRef = accountingActorRef(actor)') &&
    prismaRepositorySource.includes('evidence: { subjectRef, accountVersion: account?.version ?? null }') &&
    seedRepositorySource.includes('actorRef: accountingActorRef(actor)') &&
    seedRepositorySource.includes('evidence: { subjectRef, accountVersion: account.version }') &&
    !prismaRepositorySource.includes('accountRef: `user:') &&
    !seedRepositorySource.includes('accountRef: `user:') &&
    governance.runtimeStatus.retentionAutomationComplete === false,
  'stable subject refs for new movement, operation, and reconciliation facts; historical immutable rows remain pending contract approval',
)
addCheck(
  'runtime Provider secret retention disables rotated inference credentials before 30-day managed-version deletion',
  retentionAutomationInventory.retired_secret_30d === 'implemented_pending_target_environment_acceptance' &&
    providerSecretRetentionSource.includes("policyId: 'retired_secret_30d'") &&
    providerSecretRetentionSource.includes('retentionDays: 30') &&
    providerSecretRetentionSource.includes("actions: Object.freeze(['disable', 'delete'])") &&
    providerSecretRetentionSource.includes('managed-secret-lifecycle-enabled') &&
    providerSecretRetentionSource.includes("'idempotency-key': `secret-lifecycle:${action}:${targetHash}`") &&
    prismaModelGovernanceSource.includes("receipt.action === 'disable'") &&
    prismaModelGovernanceSource.includes("action === 'delete'") &&
    prismaModelGovernanceSource.includes("findFirst({ where: { rotatedFromId: fresh.id } })") &&
    prismaModelGovernanceSource.includes("findMany({ where: { secretRefId: fresh.id } })") &&
    prismaModelGovernanceSource.includes('rotatedTo.createdAt > cutoff') &&
    workerJobsSource.includes("id: 'provider-secret-retention-sweep'") &&
    workerJobsSource.includes("lease: lease('provider-secret-retention-sweep')") &&
    providerEnvSource.includes('PROVIDER_SECRET_RETENTION_WORKER_ENABLED requires the managed secret lifecycle gateway') &&
    providerSecretRetentionMigration.includes('provider_secret_lifecycle_receipts_immutable_guard') &&
    providerSecretRetentionMigration.includes('provider_secret_lifecycle_receipts_secret_ref_id_action_key'),
  'closed inference-purpose allowlist, immediate disable, 30-day delete, fixed HTTPS gateway, hash-only immutable receipts, idempotent retry, and leased worker',
)
addCheck(
  'runtime audit retention archives a bounded expired prefix before leased automatic prune',
  retentionAutomationInventory.audit_event_plus_730d === 'implemented_pending_target_environment_acceptance' &&
    auditRetentionSource.includes('Math.min(policy.batchSize, maximumCandidates)') &&
    auditRetentionSource.includes('policy.minimumRetainedEvents') &&
    auditRetentionWorkerSource.indexOf('archiveWriter(prepared.artifact') < auditRetentionWorkerSource.indexOf('repository.pruneRetention') &&
    auditRetentionWorkerSource.includes("archive.provider === 'mock'") &&
    auditRetentionWorkerSource.includes("action: 'system.audit.retention_executed'") &&
    archiveWriterSource.includes('persisted: false') &&
    prismaRepositorySource.includes("SELECT pg_advisory_xact_lock(hashtext('audit_event_chain_v1'))") &&
    prismaRepositorySource.indexOf('auditRetentionDisposition.create') < prismaRepositorySource.indexOf('auditEvent.deleteMany') &&
    workerJobsSource.includes("id: 'audit-retention-sweep'") &&
    workerJobsSource.includes("lease: lease('audit-retention-sweep')"),
  '730-day bounded prefix, durable non-mock archive, transactional snapshot recheck, immutable disposition, and leased worker',
)

const humanDocument = read(governance.guardrails.policyDocument)
const scopeDocument = read(releaseScope.scopeDocument)
const qualityDocument = read('docs/QUALITY_GATES.md')
const currentStateDocument = read('docs/V1_CURRENT_STATE_AUDIT.md')
const providerStatusDocument = read('docs/REAL_PROVIDER_CURRENT_STATUS.md')
const readme = read('README.md')

addCheck(
  'human document covers inventory flow export deletion and processors',
  ['## Data Inventory', '## Data Flow', '## Export Contract', '## Account Deletion Contract', '## External Processors'].every((heading) => humanDocument.includes(heading)),
  governance.guardrails.policyDocument,
)
addCheck(
  'human document names every data asset',
  governance.dataAssets.every((asset) => humanDocument.includes(`\`${asset.id}\``)),
  `${governance.dataAssets.length} assets`,
)
addCheck(
  'release scope references the data governance artifacts',
  releaseScope.dataGovernancePolicy.inventory === 'config/v1-data-governance.json' &&
    releaseScope.dataGovernancePolicy.policyDocument === governance.guardrails.policyDocument &&
    releaseScope.dataGovernancePolicy.verificationCommand === 'npm run test:v1-data-governance',
  JSON.stringify(releaseScope.dataGovernancePolicy),
)
addCheck(
  'release scope requires the data governance gate',
  releaseScope.requiredQualityGates.includes('data-governance-baseline'),
  releaseScope.requiredQualityGates.join(', '),
)
addCheck(
  'data governance verification is part of the quick gate',
  packageJson.scripts['test:v1-data-governance'] === 'node scripts/verify-v1-data-governance.mjs' &&
    packageJson.scripts['check:quick']?.includes('npm run test:v1-data-governance'),
  packageJson.scripts['check:quick'],
)
addCheck(
  'project documentation exposes the data governance gate',
  readme.includes('V1_DATA_GOVERNANCE_BASELINE.md') &&
    readme.includes('test:v1-data-governance') &&
    scopeDocument.includes('V1_DATA_GOVERNANCE_BASELINE.md') &&
    qualityDocument.includes('test:v1-data-governance') &&
    currentStateDocument.includes('V1_DATA_GOVERNANCE_BASELINE.md') &&
    providerStatusDocument.includes('V1_DATA_GOVERNANCE_BASELINE.md'),
  'README, scope, quality, audit, and provider status',
)

const failed = checks.filter((item) => !item.pass)

console.log('V1 data governance verification')
for (const item of checks) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` (${item.detail})` : ''}`)
}

if (failed.length > 0) {
  console.error(`V1 data governance verification failed: ${failed.length} check(s)`)
  process.exit(1)
}

console.log(
  `V1 data governance verified: ${checks.length} checks across ${governance.dataAssets.length} assets, ` +
    `${schemaModels.length} Prisma models, ${governance.dataFlows.length} flows, ` +
    `${governance.retentionPolicies.length} retention policies, and ${providerMappings.length} creative Providers`,
)
