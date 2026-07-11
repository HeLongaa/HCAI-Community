import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const policyPath = path.join(root, 'config/v1-content-safety-policy.json')
const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'))
const providerMatrix = JSON.parse(fs.readFileSync(path.join(root, policy.guardrails.providerDecisionMatrix), 'utf8'))
const releaseScope = JSON.parse(fs.readFileSync(path.join(root, 'config/v1-release-scope.json'), 'utf8'))
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const checks = []

const addCheck = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail })
const sorted = (values) => [...values].sort()
const sameMembers = (actual, expected) =>
  JSON.stringify(sorted(actual)) === JSON.stringify(sorted(expected))
const includesMembers = (actual, expected) => expected.every((item) => actual.includes(item))
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const nonEmptyArray = (value) => Array.isArray(value) && value.length > 0
const unique = (values) => new Set(values).size === values.length

const expectedModalities = ['chat', 'image', 'music', 'video']
const expectedDispositions = ['allow', 'block', 'prohibited', 'review']
const expectedStages = ['pre_dispatch', 'provider_native', 'post_output', 'human_review', 'appeal']
const expectedCategories = [
  'adult_explicit_sexual_content',
  'benign_original_or_authorized_creation',
  'child_sexual_exploitation',
  'copyright_trademark_artist_style_or_lyrics',
  'credential_theft_malware_or_cyber_abuse',
  'election_or_political_persuasion',
  'fraud_impersonation_or_deceptive_media',
  'graphic_violence_or_gore',
  'hate_extremist_praise_or_recruitment',
  'medical_legal_newsworthy_or_educational_sensitive_context',
  'minor_nonsexual_sensitive_depiction',
  'non_consensual_intimate_content',
  'personal_data_or_sensitive_attribute_inference',
  'public_figure_sensitive_context',
  'real_person_likeness_voice_or_biometrics',
  'regulated_advice_or_high_impact_decision',
  'self_harm_instructions_or_encouragement',
  'targeted_harassment_threats_or_doxxing',
  'violent_wrongdoing_instructions',
  'weapons_drugs_or_regulated_goods',
]
const expectedProviderIds = providerMatrix.providers.map((provider) => provider.id)
const expectedImplementationTasks = ['V1-45', 'V1-59', 'V1-60', 'V1-61', 'V1-62', 'V1-63', 'V1-78']
const expectedMessageCodes = [
  'APPEAL_DECIDED',
  'APPEAL_RECEIVED',
  'CONTENT_NOT_ALLOWED',
  'OUTPUT_NEEDS_REVIEW',
  'PROVIDER_SAFETY_REFUSAL',
  'REGION_UNAVAILABLE',
  'REQUEST_NEEDS_REVIEW',
  'RIGHTS_ATTESTATION_REQUIRED',
]

addCheck('content safety schema version is supported', policy.schemaVersion === 1, `schemaVersion=${policy.schemaVersion}`)
addCheck('content safety policy is owned by V1-44', policy.taskId === 'V1-44', policy.taskId)
addCheck('content safety policy has an access date', /^\d{4}-\d{2}-\d{2}$/.test(policy.asOf), policy.asOf)
addCheck(
  'content safety policy version is stable',
  /^v1-content-safety-\d{4}-\d{2}-\d{2}$/.test(policy.policyVersion),
  policy.policyVersion,
)
addCheck(
  'content safety policy is frozen for implementation',
  policy.policyStatus === 'frozen_for_implementation',
  policy.policyStatus,
)

addCheck(
  'runtime enforcement remains incomplete',
  policy.runtimeStatus.enforcementComplete === false &&
    policy.runtimeStatus.providerNativeSafety === 'not_integrated' &&
    policy.runtimeStatus.appealWorkflow === 'not_implemented',
  JSON.stringify(policy.runtimeStatus),
)
addCheck(
  'real provider calls remain unapproved',
  policy.runtimeStatus.realProviderCallsApproved === false &&
    policy.runtimeStatus.productionApproved === false &&
    policy.runtimeStatus.ordinaryContinuationIsApproval === false,
  JSON.stringify(policy.runtimeStatus),
)
addCheck(
  'unknown and unclassified content fails closed',
  policy.guardrails.defaultDisposition === 'block' &&
    policy.guardrails.unclassifiedContentDisposition === 'block' &&
    policy.guardrails.unknownProviderSafetyResponse === 'block' &&
    policy.guardrails.unsupportedRegionDisposition === 'block',
  JSON.stringify(policy.guardrails),
)
addCheck(
  'provider safety remains defense in depth',
  policy.guardrails.providerNativeSafetyIsDefenseInDepth === true &&
    policy.guardrails.providerSafetyWeakeningAllowed === false,
  JSON.stringify(policy.guardrails),
)
addCheck(
  'sensitive prompt and provider payload persistence is forbidden',
  policy.guardrails.rawSensitivePromptPersistence === 'forbidden' &&
    policy.guardrails.rawProviderPayloadPersistence === 'forbidden',
  JSON.stringify(policy.guardrails),
)
addCheck(
  'silent mock fallback remains forbidden',
  policy.guardrails.silentMockFallback === 'forbidden',
  policy.guardrails.silentMockFallback,
)
addCheck(
  'content safety decision documents exist',
  fs.existsSync(path.join(root, policy.guardrails.policyDocument)) &&
    fs.existsSync(path.join(root, policy.guardrails.providerDecisionMatrix)) &&
    fs.existsSync(path.join(root, policy.guardrails.externalCallApprovalDocument)),
  `${policy.guardrails.policyDocument}, ${policy.guardrails.providerDecisionMatrix}`,
)

const dispositionIds = policy.dispositions.map((item) => item.id)
addCheck(
  'all four policy dispositions are defined',
  sameMembers(dispositionIds, expectedDispositions),
  dispositionIds.join(', '),
)
addCheck('disposition ids are unique', unique(dispositionIds), `${dispositionIds.length} dispositions`)

for (const disposition of policy.dispositions) {
  addCheck(`${disposition.id} has operational meaning`, Boolean(disposition.meaning), disposition.meaning)
  addCheck(
    `${disposition.id} has request and output actions`,
    Boolean(disposition.requestAction) && Boolean(disposition.outputAction),
    `${disposition.requestAction}/${disposition.outputAction}`,
  )
  addCheck(
    `${disposition.id} declares dispatch and release behavior`,
    typeof disposition.providerDispatchAllowed === 'boolean' &&
      typeof disposition.providerDispatchAfterReviewAllowed === 'boolean' &&
      typeof disposition.outputReleaseAllowed === 'boolean',
    JSON.stringify(disposition),
  )
}

const prohibitedDisposition = policy.dispositions.find((item) => item.id === 'prohibited')
const blockDisposition = policy.dispositions.find((item) => item.id === 'block')
const reviewDisposition = policy.dispositions.find((item) => item.id === 'review')
const allowDisposition = policy.dispositions.find((item) => item.id === 'allow')

addCheck(
  'prohibited content can never dispatch or release',
  prohibitedDisposition.providerDispatchAllowed === false &&
    prohibitedDisposition.providerDispatchAfterReviewAllowed === false &&
    prohibitedDisposition.outputReleaseAllowed === false &&
    prohibitedDisposition.terminal === true,
  JSON.stringify(prohibitedDisposition),
)
addCheck(
  'blocked content can never dispatch or release',
  blockDisposition.providerDispatchAllowed === false &&
    blockDisposition.providerDispatchAfterReviewAllowed === false &&
    blockDisposition.outputReleaseAllowed === false,
  JSON.stringify(blockDisposition),
)
addCheck(
  'review content requires approval before dispatch and release',
  reviewDisposition.providerDispatchAllowed === false &&
    reviewDisposition.providerDispatchAfterReviewAllowed === true &&
    reviewDisposition.outputReleaseAllowed === false,
  JSON.stringify(reviewDisposition),
)
addCheck(
  'allowed content still declares bounded dispatch and release',
  allowDisposition.providerDispatchAllowed === true &&
    allowDisposition.outputReleaseAllowed === true &&
    allowDisposition.requestAction === 'continue' &&
    allowDisposition.outputAction === 'release_after_checks',
  JSON.stringify(allowDisposition),
)

const categoryIds = policy.riskCategories.map((category) => category.id)
const categoriesById = new Map(policy.riskCategories.map((category) => [category.id, category]))
addCheck(
  'the complete V1 risk taxonomy is frozen',
  sameMembers(categoryIds, expectedCategories),
  `${categoryIds.length} categories`,
)
addCheck('risk category ids are unique', unique(categoryIds), `${categoryIds.length} categories`)

for (const category of policy.riskCategories) {
  addCheck(
    `${category.id} has severity, definition, and escalation`,
    ['critical', 'high', 'medium', 'low'].includes(category.severity) &&
      Boolean(category.definition) &&
      Boolean(category.escalation),
    `${category.severity}/${category.escalation}`,
  )
  addCheck(
    `${category.id} has a stable reason code`,
    /^[A-Z][A-Z0-9_]+$/.test(category.reasonCode),
    category.reasonCode,
  )
  addCheck(
    `${category.id} applies to valid modalities`,
    nonEmptyArray(category.appliesTo) &&
      unique(category.appliesTo) &&
      category.appliesTo.every((modality) => expectedModalities.includes(modality)),
    category.appliesTo.join(', '),
  )
}

const modalityIds = policy.modalities.map((modality) => modality.id)
addCheck('all four modalities have a policy', sameMembers(modalityIds, expectedModalities), modalityIds.join(', '))
addCheck('modality ids are unique', unique(modalityIds), `${modalityIds.length} modalities`)

for (const modality of policy.modalities) {
  const decisionIds = Object.keys(modality.decisions)
  const assigned = Object.values(modality.decisions).flat()
  const applicable = policy.riskCategories
    .filter((category) => category.appliesTo.includes(modality.id))
    .map((category) => category.id)

  addCheck(
    `${modality.id} defines every disposition bucket`,
    sameMembers(decisionIds, expectedDispositions) &&
      expectedDispositions.every((disposition) => nonEmptyArray(modality.decisions[disposition])),
    decisionIds.join(', '),
  )
  addCheck(
    `${modality.id} partitions every applicable category exactly once`,
    unique(assigned) && sameMembers(assigned, applicable),
    `${assigned.length}/${applicable.length} assigned`,
  )
  addCheck(
    `${modality.id} prohibits every applicable critical harm`,
    policy.riskCategories
      .filter((category) => category.severity === 'critical' && category.appliesTo.includes(modality.id))
      .every((category) => modality.decisions.prohibited.includes(category.id)),
    modality.decisions.prohibited.join(', '),
  )
  addCheck(
    `${modality.id} allows only the benign baseline category`,
    sameMembers(modality.decisions.allow, ['benign_original_or_authorized_creation']),
    modality.decisions.allow.join(', '),
  )
  addCheck(
    `${modality.id} has layered controls`,
    modality.preDispatchControls.length >= 3 &&
      modality.providerNativeControls.length >= 2 &&
      modality.postOutputControls.length >= 3 &&
      modality.specialRules.length >= 2,
    `${modality.preDispatchControls.length}/${modality.providerNativeControls.length}/${modality.postOutputControls.length}`,
  )
  addCheck(
    `${modality.id} has a downstream implementation owner`,
    /^V1-\d+$/.test(modality.implementationTaskId),
    modality.implementationTaskId,
  )
}

addCheck(
  'chat applies the stricter cyber and self-harm decision',
  policy.modalities.find((item) => item.id === 'chat').decisions.prohibited.includes('credential_theft_malware_or_cyber_abuse') &&
    policy.modalities.find((item) => item.id === 'chat').decisions.prohibited.includes('self_harm_instructions_or_encouragement'),
  'chat prohibited categories',
)

const stageIds = policy.responsibilityStages.map((stage) => stage.id)
addCheck('the complete responsibility chain is defined', sameMembers(stageIds, expectedStages), stageIds.join(', '))
addCheck('responsibility stage ids are unique', unique(stageIds), `${stageIds.length} stages`)
addCheck(
  'responsibility stages have deterministic order',
  policy.responsibilityStages.every((stage, index) => stage.order === index + 1),
  policy.responsibilityStages.map((stage) => `${stage.id}:${stage.order}`).join(', '),
)

for (const stage of policy.responsibilityStages) {
  addCheck(
    `${stage.id} has owner, boundary, inputs, outcomes, and failure decision`,
    Boolean(stage.owner) &&
      Boolean(stage.mustCompleteBefore) &&
      nonEmptyArray(stage.requiredInputs) &&
      nonEmptyArray(stage.allowedOutcomes) &&
      Boolean(stage.failureDisposition),
    `${stage.owner}/${stage.failureDisposition}`,
  )
}

const providerMappingsById = new Map(policy.providerMappings.map((mapping) => [mapping.providerId, mapping]))
const providerIds = policy.providerMappings.map((mapping) => mapping.providerId)
const providerMatrixById = new Map(providerMatrix.providers.map((provider) => [provider.id, provider]))
const providerMatrixSourceIds = new Set(providerMatrix.sources.map((source) => source.id))
const policySourceIds = policy.sources.map((source) => source.id)
const policySourcesById = new Map(policy.sources.map((source) => [source.id, source]))

addCheck('all selected Providers have safety mappings', sameMembers(providerIds, expectedProviderIds), providerIds.join(', '))
addCheck('Provider safety mapping ids are unique', unique(providerIds), `${providerIds.length} Providers`)

for (const mapping of policy.providerMappings) {
  const provider = providerMatrixById.get(mapping.providerId)
  addCheck(`${mapping.providerId} exists in the Provider decision matrix`, Boolean(provider), mapping.providerId)
  addCheck(
    `${mapping.providerId} modality and role match the Provider decision`,
    provider?.modality === mapping.modality && provider?.role === mapping.role,
    `${mapping.modality}/${mapping.role}`,
  )
  addCheck(
    `${mapping.providerId} references official policy evidence`,
    nonEmptyArray(mapping.policySourceIds) &&
      mapping.policySourceIds.every((sourceId) => policySourcesById.has(sourceId)),
    mapping.policySourceIds.join(', '),
  )
  addCheck(
    `${mapping.providerId} references Provider decision evidence`,
    nonEmptyArray(mapping.providerMatrixSourceIds) &&
      mapping.providerMatrixSourceIds.every((sourceId) => providerMatrixSourceIds.has(sourceId)),
    mapping.providerMatrixSourceIds.join(', '),
  )
  addCheck(
    `${mapping.providerId} retains application controls beyond native safety`,
    mapping.nativeControls.length >= 2 && mapping.mandatoryAppControls.length >= 4,
    `${mapping.nativeControls.length}/${mapping.mandatoryAppControls.length}`,
  )
  addCheck(
    `${mapping.providerId} fails closed on refusal, unknown safety, and region`,
    mapping.providerRefusalBehavior.includes('reject') &&
      mapping.unknownSafetyResponse === 'block' &&
      mapping.regionBehavior === 'block_without_bypass',
    `${mapping.providerRefusalBehavior}/${mapping.unknownSafetyResponse}/${mapping.regionBehavior}`,
  )
}

addCheck('policy source ids are unique', unique(policySourceIds), `${policySourceIds.length} sources`)
for (const source of policy.sources) {
  addCheck(
    `${source.id} is a dated official HTTPS source`,
    source.official === true && source.accessed === policy.asOf && /^https:\/\//.test(source.url),
    source.url,
  )
  addCheck(
    `${source.id} maps valid Providers and dimensions`,
    nonEmptyArray(source.providerIds) &&
      source.providerIds.every((providerId) => providerMappingsById.has(providerId)) &&
      source.dimensions.length >= 3,
    `${source.providerIds.join(', ')}/${source.dimensions.join(', ')}`,
  )
  addCheck(
    `${source.id} is referenced by every mapped Provider it claims`,
    source.providerIds.every((providerId) => providerMappingsById.get(providerId).policySourceIds.includes(source.id)),
    source.providerIds.join(', '),
  )
}

addCheck(
  'review states include required release and rejection boundaries',
  sameMembers(policy.reviewPolicy.queueStates, ['in_review', 'rejected', 'released', 'review_required']),
  policy.reviewPolicy.queueStates.join(', '),
)
addCheck(
  'review release and reject decisions are auditable',
  policy.reviewPolicy.releaseRequirements.length >= 5 &&
    policy.reviewPolicy.rejectRequirements.length >= 5 &&
    policy.reviewPolicy.timeoutBehavior === 'remain_quarantined_and_alert',
  `${policy.reviewPolicy.releaseRequirements.length}/${policy.reviewPolicy.rejectRequirements.length}`,
)
addCheck(
  'review targets and separation of duties are defined',
  policy.reviewPolicy.criticalTargetHours > 0 &&
    policy.reviewPolicy.standardTargetHours >= policy.reviewPolicy.criticalTargetHours &&
    /must not/.test(policy.reviewPolicy.separationOfDuties),
  policy.reviewPolicy.separationOfDuties,
)

addCheck(
  'appeals are required but remain unimplemented',
  policy.appealPolicy.requiredForV1 === true &&
    policy.appealPolicy.implementationStatus === 'not_implemented' &&
    policy.appealPolicy.entryPointRequired === true,
  JSON.stringify(policy.appealPolicy),
)
addCheck(
  'appeals never release content automatically',
  policy.appealPolicy.automaticReleaseAllowed === false &&
    policy.appealPolicy.submissionWindowDays > 0 &&
    policy.appealPolicy.targetBusinessDays > 0,
  `${policy.appealPolicy.submissionWindowDays}d/${policy.appealPolicy.targetBusinessDays}bd`,
)
addCheck(
  'appeal inputs and outcomes are complete',
  policy.appealPolicy.requiredFields.length >= 8 &&
    sameMembers(policy.appealPolicy.outcomes, ['needs_more_information', 'overturned', 'partially_overturned', 'upheld']) &&
    policy.appealPolicy.closeoutFields.length >= 6,
  `${policy.appealPolicy.requiredFields.length}/${policy.appealPolicy.outcomes.length}/${policy.appealPolicy.closeoutFields.length}`,
)

const requiredAuditFields = [
  'eventId',
  'idempotencyKey',
  'generationId',
  'modality',
  'providerId',
  'policyVersion',
  'stage',
  'categoryIds',
  'decision',
  'reasonCodes',
  'promptHash',
  'safePromptPreview',
  'inputAssetIds',
  'outputAssetIds',
  'region',
  'providerSafetyCode',
  'reviewerId',
  'appealId',
  'createdAt',
]
const forbiddenAuditFields = [
  'rawPrompt',
  'rawConversation',
  'rawProviderRequest',
  'rawProviderResponse',
  'providerCredential',
  'authorizationHeader',
  'privateDownloadUrl',
  'unredactedPersonalData',
]

addCheck(
  'audit contract includes minimum safety evidence',
  includesMembers(policy.auditContract.requiredFields, requiredAuditFields),
  `${policy.auditContract.requiredFields.length} fields`,
)
addCheck(
  'audit contract forbids sensitive raw fields',
  includesMembers(policy.auditContract.forbiddenFields, forbiddenAuditFields),
  policy.auditContract.forbiddenFields.join(', '),
)
addCheck(
  'audit contract has redaction and lifecycle events',
  policy.auditContract.redactionRules.length >= 4 &&
    policy.auditContract.requiredEventTypes.length >= 8 &&
    policy.auditContract.retentionScheduleStatus === 'owned_by_V1-45_not_yet_frozen',
  `${policy.auditContract.redactionRules.length}/${policy.auditContract.requiredEventTypes.length}`,
)

const messageCodes = policy.userMessageContract.map((message) => message.code)
addCheck('public safety message codes are complete', sameMembers(messageCodes, expectedMessageCodes), messageCodes.join(', '))
addCheck('public safety message codes are unique', unique(messageCodes), `${messageCodes.length} message codes`)
for (const message of policy.userMessageContract) {
  addCheck(
    `${message.code} has safe public copy`,
    Boolean(message.publicText) &&
      typeof message.appealEligible === 'boolean' &&
      !/classifier|threshold|secret|internal category/i.test(message.publicText),
    message.publicText,
  )
}

addCheck(
  'regional policy applies the highest restriction',
  policy.regionalPolicy.highestRestrictionWins === true,
  `highestRestrictionWins=${policy.regionalPolicy.highestRestrictionWins}`,
)
addCheck(
  'regional policy blocks bypass and unapproved processing',
  policy.regionalPolicy.rules.length >= 4 &&
    policy.regionalPolicy.rules.some((rule) => rule.id === 'geography_controls_must_not_be_bypassed' && rule.behavior === 'reject_and_audit') &&
    policy.regionalPolicy.rules.some((rule) => rule.id === 'deployment_and_processing_region_must_be_approved' && rule.behavior === 'block_until_approved'),
  policy.regionalPolicy.rules.map((rule) => rule.id).join(', '),
)

addCheck(
  'implementation handoff covers data, modality, review, and AUP owners',
  sameMembers(policy.implementationHandoff.map((item) => item.taskId), expectedImplementationTasks),
  policy.implementationHandoff.map((item) => item.taskId).join(', '),
)
addCheck(
  'every implementation handoff has a concrete scope',
  policy.implementationHandoff.every((item) => Boolean(item.scope)),
  `${policy.implementationHandoff.length} owners`,
)

const runtimePolicy = read(policy.currentRuntimeBaseline.policyFile)
const generationRecords = read(policy.currentRuntimeBaseline.generationRecordFile)
addCheck(
  'current runtime policy files exist',
  fs.existsSync(path.join(root, policy.currentRuntimeBaseline.policyFile)) &&
    fs.existsSync(path.join(root, policy.currentRuntimeBaseline.generationRecordFile)),
  `${policy.currentRuntimeBaseline.policyFile}, ${policy.currentRuntimeBaseline.generationRecordFile}`,
)
addCheck(
  'current limited policy version is recorded accurately',
  runtimePolicy.includes(`'${policy.currentRuntimeBaseline.policyVersion}'`),
  policy.currentRuntimeBaseline.policyVersion,
)
for (const ruleId of [
  ...policy.currentRuntimeBaseline.blockedRuleIds,
  ...policy.currentRuntimeBaseline.reviewRuleIds,
]) {
  addCheck(`current runtime moderation rule is inventoried: ${ruleId}`, runtimePolicy.includes(`'${ruleId}'`), ruleId)
}
addCheck(
  'current mapped risk categories exist',
  policy.currentRuntimeBaseline.mappedRiskCategoryIds.every((categoryId) => categoriesById.has(categoryId)),
  policy.currentRuntimeBaseline.mappedRiskCategoryIds.join(', '),
)
addCheck(
  'current runtime strengths and gaps remain explicit',
  policy.currentRuntimeBaseline.strengths.length >= 5 &&
    policy.currentRuntimeBaseline.knownGaps.length >= 6,
  `${policy.currentRuntimeBaseline.strengths.length}/${policy.currentRuntimeBaseline.knownGaps.length}`,
)
addCheck(
  'generation records retain review and safe evidence primitives',
  generationRecords.includes("'review_required'") &&
    generationRecords.includes('promptHash') &&
    generationRecords.includes('promptPreview') &&
    generationRecords.includes('safeErrorPreview'),
  policy.currentRuntimeBaseline.generationRecordFile,
)

const humanDocument = read(policy.guardrails.policyDocument)
const qualityDocument = read('docs/QUALITY_GATES.md')
const providerStatusDocument = read('docs/REAL_PROVIDER_CURRENT_STATUS.md')
const scopeDocument = read(releaseScope.scopeDocument)
const readme = read('README.md')

addCheck(
  'human document covers all four dispositions and modalities',
  expectedDispositions.every((item) => humanDocument.includes(`\`${item}\``)) &&
    ['Image', 'Chat', 'Video', 'Music'].every((item) => humanDocument.includes(`### ${item}`)),
  policy.guardrails.policyDocument,
)
addCheck(
  'human document records review, appeal, audit, and Provider mappings',
  ['## Provider Mapping', '## Review And Appeal', '## Audit Contract', '## Implementation Handoff'].every((heading) => humanDocument.includes(heading)),
  policy.guardrails.policyDocument,
)
addCheck(
  'release scope references the safety policy artifacts',
  releaseScope.creativeSafetyPolicy.policyMatrix === 'config/v1-content-safety-policy.json' &&
    releaseScope.creativeSafetyPolicy.policyDocument === policy.guardrails.policyDocument &&
    releaseScope.creativeSafetyPolicy.verificationCommand === 'npm run test:v1-safety-policy',
  JSON.stringify(releaseScope.creativeSafetyPolicy),
)
addCheck(
  'release scope requires the content safety gate',
  releaseScope.requiredQualityGates.includes('content-safety-policy-matrix'),
  releaseScope.requiredQualityGates.join(', '),
)
addCheck(
  'content safety verification is part of the quick gate',
  packageJson.scripts['test:v1-safety-policy'] === 'node scripts/verify-v1-content-safety-policy.mjs' &&
    packageJson.scripts['check:quick']?.includes('npm run test:v1-safety-policy'),
  packageJson.scripts['check:quick'],
)
addCheck(
  'project documentation exposes the safety policy gate',
  readme.includes('V1_CONTENT_SAFETY_POLICY_MATRIX.md') &&
    readme.includes('test:v1-safety-policy') &&
    qualityDocument.includes('test:v1-safety-policy') &&
    scopeDocument.includes('V1_CONTENT_SAFETY_POLICY_MATRIX.md') &&
    providerStatusDocument.includes('V1_CONTENT_SAFETY_POLICY_MATRIX.md'),
  'README, scope, quality gates, and provider status',
)

const failed = checks.filter((item) => !item.pass)

console.log('V1 content safety policy verification')
for (const item of checks) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` (${item.detail})` : ''}`)
}

if (failed.length > 0) {
  console.error(`V1 content safety policy verification failed: ${failed.length} check(s)`)
  process.exit(1)
}

console.log(
  `V1 content safety policy verified: ${checks.length} checks across ${policy.modalities.length} modalities, ` +
    `${policy.riskCategories.length} categories, ${policy.providerMappings.length} Providers, and ${policy.sources.length} official sources`,
)
