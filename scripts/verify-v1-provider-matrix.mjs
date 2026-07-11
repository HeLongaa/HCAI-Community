import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const matrixPath = path.join(root, 'config/v1-provider-matrix.json')
const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'))
const checks = []

const addCheck = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail })
const sorted = (values) => [...values].sort()
const sameMembers = (actual, expected) =>
  JSON.stringify(sorted(actual)) === JSON.stringify(sorted(expected))
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const positiveNumber = (value) => Number.isFinite(value) && value > 0

const expectedModalities = ['chat', 'image', 'music', 'video']
const requiredProviderSections = [
  'api',
  'pricing',
  'rights',
  'data',
  'regions',
  'limits',
  'sla',
  'safety',
]

addCheck('matrix schema version is supported', matrix.schemaVersion === 1, `schemaVersion=${matrix.schemaVersion}`)
addCheck('matrix is owned by V1-04', matrix.taskId === 'V1-04', matrix.taskId)
addCheck('matrix has an access date', /^\d{4}-\d{2}-\d{2}$/.test(matrix.asOf), matrix.asOf)
addCheck(
  'decision is implementation planning only',
  matrix.decisionStatus === 'conditionally_approved_for_implementation_planning',
  matrix.decisionStatus,
)
addCheck(
  'real provider calls remain unapproved',
  matrix.runtimeStatus.realProviderCallsApproved === false,
  `realProviderCallsApproved=${matrix.runtimeStatus.realProviderCallsApproved}`,
)
addCheck(
  'production provider enablement remains unapproved',
  matrix.runtimeStatus.productionEnablementApproved === false,
  `productionEnablementApproved=${matrix.runtimeStatus.productionEnablementApproved}`,
)
addCheck(
  'network clients remain unimplemented',
  matrix.runtimeStatus.networkClientsImplemented === false,
  `networkClientsImplemented=${matrix.runtimeStatus.networkClientsImplemented}`,
)
addCheck(
  'ordinary continuation is not external-call approval',
  matrix.runtimeStatus.ordinaryContinuationIsApproval === false,
  `ordinaryContinuationIsApproval=${matrix.runtimeStatus.ordinaryContinuationIsApproval}`,
)
addCheck(
  'production fallback fails closed',
  matrix.guardrails.productionFallback === 'fail_closed',
  matrix.guardrails.productionFallback,
)
addCheck(
  'silent mock fallback is forbidden',
  matrix.guardrails.silentMockFallback === 'forbidden',
  matrix.guardrails.silentMockFallback,
)
addCheck(
  'provider spend remains separate from product credits',
  matrix.guardrails.providerSpendIsSeparateFromProductCredits === true,
  `providerSpendIsSeparateFromProductCredits=${matrix.guardrails.providerSpendIsSeparateFromProductCredits}`,
)
addCheck(
  'external-call approval document exists',
  fs.existsSync(path.join(root, matrix.guardrails.externalCallApprovalDocument)),
  matrix.guardrails.externalCallApprovalDocument,
)
addCheck(
  'human decision document exists',
  fs.existsSync(path.join(root, matrix.guardrails.decisionDocument)),
  matrix.guardrails.decisionDocument,
)

const modalityIds = matrix.modalities.map((modality) => modality.id)
addCheck(
  'all four V1 modalities have decisions',
  sameMembers(modalityIds, expectedModalities),
  modalityIds.join(', '),
)
addCheck('modality ids are unique', new Set(modalityIds).size === modalityIds.length, `${modalityIds.length} modalities`)

const providerIds = matrix.providers.map((provider) => provider.id)
const providersById = new Map(matrix.providers.map((provider) => [provider.id, provider]))
addCheck('provider ids are unique', new Set(providerIds).size === providerIds.length, `${providerIds.length} providers`)
addCheck('matrix has exactly eight provider decisions', matrix.providers.length === 8, `${matrix.providers.length} providers`)

for (const modality of matrix.modalities) {
  const primary = providersById.get(modality.primaryProviderId)
  const backup = providersById.get(modality.backupProviderId)

  addCheck(
    `${modality.id} primary and backup are distinct`,
    modality.primaryProviderId !== modality.backupProviderId,
    `${modality.primaryProviderId}/${modality.backupProviderId}`,
  )
  addCheck(`${modality.id} primary exists`, Boolean(primary), modality.primaryProviderId)
  addCheck(`${modality.id} backup exists`, Boolean(backup), modality.backupProviderId)
  addCheck(
    `${modality.id} primary reference is consistent`,
    primary?.modality === modality.id && primary?.role === 'primary',
    primary ? `${primary.modality}/${primary.role}` : 'missing',
  )
  addCheck(
    `${modality.id} backup reference is consistent`,
    backup?.modality === modality.id && backup?.role === 'backup',
    backup ? `${backup.modality}/${backup.role}` : 'missing',
  )
  addCheck(`${modality.id} remains conditional`, modality.decisionState === 'conditional', modality.decisionState)
  addCheck(
    `${modality.id} has a bounded concurrency cap`,
    positiveNumber(modality.appPolicy.maxConcurrentJobs),
    `maxConcurrentJobs=${modality.appPolicy.maxConcurrentJobs}`,
  )
  addCheck(
    `${modality.id} has bounded timeout and attempts`,
    positiveNumber(modality.appPolicy.timeoutSeconds) && positiveNumber(modality.appPolicy.maxAttempts),
    `${modality.appPolicy.timeoutSeconds}s/${modality.appPolicy.maxAttempts} attempt(s)`,
  )
  addCheck(
    `${modality.id} has daily and monthly budget caps`,
    positiveNumber(modality.appPolicy.dailyUsdCap) &&
      positiveNumber(modality.appPolicy.monthlyUsdCap) &&
      modality.appPolicy.monthlyUsdCap >= modality.appPolicy.dailyUsdCap,
    `USD ${modality.appPolicy.dailyUsdCap}/day, ${modality.appPolicy.monthlyUsdCap}/month`,
  )
  addCheck(
    `${modality.id} has per-job and volume caps`,
    positiveNumber(modality.appPolicy.perJobUsdCap) && positiveNumber(modality.appPolicy.maxJobsPerDay),
    `USD ${modality.appPolicy.perJobUsdCap}/job, ${modality.appPolicy.maxJobsPerDay}/day`,
  )
  addCheck(`${modality.id} has a cost example`, Boolean(modality.budgetExample), modality.budgetExample)
  addCheck(
    `${modality.id} failover is fail closed and approval gated`,
    modality.failover.productionBehavior === 'fail_closed' &&
      modality.failover.automaticFailoverAllowed === false &&
      Boolean(modality.failover.activation) &&
      Boolean(modality.failover.trigger),
    modality.failover.activation,
  )
  addCheck(
    `${modality.id} has replacement triggers`,
    modality.replacementTriggers.length >= 4,
    `${modality.replacementTriggers.length} trigger(s)`,
  )
}

const dailyTotal = matrix.modalities.reduce((total, modality) => total + modality.appPolicy.dailyUsdCap, 0)
const monthlyTotal = matrix.modalities.reduce((total, modality) => total + modality.appPolicy.monthlyUsdCap, 0)
addCheck(
  'global daily budget equals modality caps',
  dailyTotal === matrix.budgetPolicy.globalDailyUsdCap,
  `USD ${dailyTotal}`,
)
addCheck(
  'global monthly budget equals modality caps',
  monthlyTotal === matrix.budgetPolicy.globalMonthlyUsdCap,
  `USD ${monthlyTotal}`,
)
addCheck(
  'provider credit auto-reload is disabled',
  matrix.budgetPolicy.autoReloadProviderCredits === false,
  `autoReloadProviderCredits=${matrix.budgetPolicy.autoReloadProviderCredits}`,
)
addCheck(
  'provider decision review cadence is bounded',
  matrix.budgetPolicy.reviewCadenceDays === 30,
  `${matrix.budgetPolicy.reviewCadenceDays} day(s)`,
)

const sourceIds = matrix.sources.map((source) => source.id)
const sourceIdSet = new Set(sourceIds)
addCheck('source ids are unique', sourceIdSet.size === sourceIds.length, `${sourceIds.length} sources`)

for (const source of matrix.sources) {
  addCheck(`${source.id} is an official HTTPS source`, source.official === true && /^https:\/\//.test(source.url), source.url)
  addCheck(`${source.id} records the access date`, source.accessed === matrix.asOf, source.accessed)
  addCheck(
    `${source.id} identifies supported dimensions`,
    Array.isArray(source.dimensions) && source.dimensions.length > 0,
    source.dimensions?.join(', '),
  )
}

for (const provider of matrix.providers) {
  addCheck(`${provider.id} uses a known modality`, expectedModalities.includes(provider.modality), provider.modality)
  addCheck(`${provider.id} has a valid role`, ['primary', 'backup'].includes(provider.role), provider.role)
  addCheck(
    `${provider.id} is not production approved`,
    provider.decisionState !== 'approved' && provider.decisionState !== 'production_approved',
    provider.decisionState,
  )
  addCheck(`${provider.id} names a model`, Boolean(provider.model), provider.model)
  addCheck(
    `${provider.id} covers required decision dimensions`,
    requiredProviderSections.every((section) => provider[section] && typeof provider[section] === 'object'),
    requiredProviderSections.filter((section) => !provider[section]).join(', ') || 'all present',
  )
  addCheck(
    `${provider.id} defines lifecycle behavior`,
    Boolean(provider.api.family) &&
      Boolean(provider.api.requestMode) &&
      Boolean(provider.api.callback) &&
      Boolean(provider.api.polling) &&
      Boolean(provider.api.cancellation) &&
      Boolean(provider.api.artifactHandling),
    provider.api.requestMode,
  )
  addCheck(
    `${provider.id} defines price and example`,
    Boolean(provider.pricing.unit) && provider.pricing.rateUsd !== undefined && positiveNumber(provider.pricing.exampleUsd),
    `${provider.pricing.unit}: ${JSON.stringify(provider.pricing.rateUsd)}`,
  )
  addCheck(
    `${provider.id} defines commercial rights and training use`,
    typeof provider.rights.commercialUse === 'boolean' &&
      Boolean(provider.rights.outputOwnership) &&
      Boolean(provider.rights.trainingUse) &&
      provider.rights.restrictions.length > 0,
    provider.rights.status,
  )
  addCheck(
    `${provider.id} defines retention, residency, and training default`,
    Boolean(provider.data.defaultRetention) &&
      Boolean(provider.data.zeroRetention) &&
      Boolean(provider.data.residency) &&
      provider.data.trainingDefault !== undefined,
    provider.data.defaultRetention,
  )
  addCheck(
    `${provider.id} defines region eligibility`,
    provider.regions.documented.length > 0 &&
      Boolean(provider.regions.mainlandChina) &&
      Boolean(provider.regions.productionCondition),
    provider.regions.documented.join(', '),
  )
  addCheck(
    `${provider.id} defines provider and app limits`,
    Boolean(provider.limits.published) &&
      positiveNumber(provider.limits.appConcurrencyCap) &&
      provider.limits.accountCheckRequired === true,
    provider.limits.published,
  )
  addCheck(
    `${provider.id} defines SLA disposition`,
    Boolean(provider.sla.status) && Boolean(provider.sla.publicCommitment) && Boolean(provider.sla.productionCondition),
    provider.sla.status,
  )
  addCheck(
    `${provider.id} defines provider and app safety controls`,
    provider.safety.providerControls.length > 0 && provider.safety.appControls.length > 0,
    `${provider.safety.providerControls.length}/${provider.safety.appControls.length}`,
  )
  addCheck(
    `${provider.id} has explicit go-live conditions`,
    provider.goLiveConditions.length >= 4,
    `${provider.goLiveConditions.length} condition(s)`,
  )
  const missingSourceIds = provider.sourceIds.filter((sourceId) => !sourceIdSet.has(sourceId))
  addCheck(
    `${provider.id} references official evidence`,
    provider.sourceIds.length >= 5 && missingSourceIds.length === 0,
    missingSourceIds.join(', ') || `${provider.sourceIds.length} source(s)`,
  )
}

for (const modality of expectedModalities) {
  const providers = matrix.providers.filter((provider) => provider.modality === modality)
  addCheck(
    `${modality} has exactly one primary and one backup`,
    providers.length === 2 &&
      providers.filter((provider) => provider.role === 'primary').length === 1 &&
      providers.filter((provider) => provider.role === 'backup').length === 1,
    providers.map((provider) => `${provider.id}:${provider.role}`).join(', '),
  )
}

addCheck(
  'Sora 2 is explicitly rejected as a V1 backup',
  matrix.rejectedCandidates.some(
    (candidate) => candidate.id === 'openai-sora-2-video-backup' && candidate.reason.includes('2026-09-24'),
  ),
  matrix.rejectedCandidates.map((candidate) => candidate.id).join(', '),
)
addCheck(
  'unresolved legal and contract conditions stay explicit',
  matrix.blockingConditions.length >= 8,
  `${matrix.blockingConditions.length} condition(s)`,
)

const decisionDocument = read(matrix.guardrails.decisionDocument)
addCheck(
  'human decision document covers every provider',
  providerIds.every((providerId) => decisionDocument.includes(`\`${providerId}\``)),
  matrix.guardrails.decisionDocument,
)
addCheck(
  'human decision document keeps production disabled',
  decisionDocument.includes('No provider is production-approved') && decisionDocument.includes('fail closed'),
  matrix.guardrails.decisionDocument,
)

const packageJson = JSON.parse(read('package.json'))
addCheck(
  'provider verification is part of the quick gate',
  packageJson.scripts['test:v1-providers'] === 'node scripts/verify-v1-provider-matrix.mjs' &&
    packageJson.scripts['check:quick']?.includes('npm run test:v1-providers'),
  packageJson.scripts['check:quick'],
)

const releaseScope = JSON.parse(read('config/v1-release-scope.json'))
addCheck(
  'release scope references the provider decision artifacts',
  releaseScope.creativeProviderPolicy.decisionMatrix === 'config/v1-provider-matrix.json' &&
    releaseScope.creativeProviderPolicy.decisionDocument === matrix.guardrails.decisionDocument &&
    releaseScope.creativeProviderPolicy.verificationCommand === 'npm run test:v1-providers',
  JSON.stringify(releaseScope.creativeProviderPolicy),
)
addCheck(
  'release scope requires the provider decision gate',
  releaseScope.requiredQualityGates.includes('provider-decision-matrix'),
  releaseScope.requiredQualityGates.join(', '),
)

const failed = checks.filter((item) => !item.pass)

console.log('V1 provider decision matrix verification')
for (const item of checks) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` (${item.detail})` : ''}`)
}

if (failed.length > 0) {
  console.error(`V1 provider decision matrix verification failed: ${failed.length} check(s)`)
  process.exit(1)
}

console.log(
  `V1 provider decision matrix verified: ${checks.length} checks across ${matrix.modalities.length} modalities, ${matrix.providers.length} providers, and ${matrix.sources.length} official sources`,
)
