import fs from 'node:fs'
import path from 'node:path'

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
  'audit_event_records',
  'authentication_credentials_sessions',
  'backup_archive_copies',
  'community_content_interactions',
  'creative_accounting_records',
  'creative_generation_records',
  'deployment_secrets',
  'governance_configuration',
  'identity_account_profile',
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
  'provider_lifecycle_records',
  'raw_generation_inputs',
  'raw_provider_payloads',
  'security_event_records',
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
  'inventory is complete without claiming runtime completion',
  governance.runtimeStatus.inventoryComplete === true &&
    governance.runtimeStatus.retentionAutomationComplete === false &&
    governance.runtimeStatus.accountExportImplemented === false &&
    governance.runtimeStatus.accountDeletionImplemented === false &&
    governance.runtimeStatus.providerDeletionAutomationImplemented === false &&
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
addCheck('retention policy ids are unique', unique(retentionIds), `${retentionIds.length} policies`)
addCheck('retention policy set is comprehensive', governance.retentionPolicies.length >= 20, `${governance.retentionPolicies.length} policies`)
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
}

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
  'raw request and Provider payload retention is zero',
  retentionById.get('transient_request_zero').maximumDaysAfterTrigger === 0,
  JSON.stringify(retentionById.get('transient_request_zero')),
)

const assetIds = governance.dataAssets.map((asset) => asset.id)
const assetsById = new Map(governance.dataAssets.map((asset) => [asset.id, asset]))
addCheck('the complete V1 data asset inventory is frozen', sameMembers(assetIds, expectedAssets), `${assetIds.length} assets`)
addCheck('data asset ids are unique', unique(assetIds), `${assetIds.length} assets`)

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
      asset.ownerTasks.every((taskId) => /^V1-\d+$/.test(taskId)),
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
    governance.subjectRights.export.implementationStatus === 'not_implemented' &&
    governance.subjectRights.export.targetDays === 30 &&
    governance.subjectRights.export.packageRetentionDays === 7 &&
    governance.subjectRights.export.downloadLinkHours === 24 &&
    governance.subjectRights.export.requiredEvidence.length >= 7,
  JSON.stringify(governance.subjectRights.export),
)
addCheck(
  'deletion implementation remains explicit and bounded',
  governance.subjectRights.deletion.implementationTaskId === 'V1-67' &&
    governance.subjectRights.deletion.implementationStatus === 'not_implemented' &&
    governance.subjectRights.deletion.primaryStoreTargetDays === 30 &&
    governance.subjectRights.deletion.privateObjectTargetHours === 24 &&
    governance.subjectRights.deletion.cacheSearchTargetHours === 24 &&
    governance.subjectRights.deletion.externalProcessorRequestHours === 24 &&
    governance.subjectRights.deletion.externalProcessorConfirmationDays === 30 &&
    governance.subjectRights.deletion.backupExpiryDaysAfterPrimaryPurge === 35,
  JSON.stringify(governance.subjectRights.deletion),
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
  governance.subjectRights.legalHold.implementationStatus === 'not_implemented' &&
    governance.subjectRights.legalHold.authorizedRoles.length >= 2 &&
    governance.subjectRights.legalHold.requiredFields.length >= 8 &&
    governance.subjectRights.legalHold.reviewIntervalDays === 90 &&
    governance.subjectRights.legalHold.indefiniteHoldAllowed === false &&
    governance.subjectRights.legalHold.behavior.includes('scoped'),
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
