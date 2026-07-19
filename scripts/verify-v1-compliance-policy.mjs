import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const json = (relativePath) => JSON.parse(read(relativePath))
const manifest = json('config/v1-compliance-policy.json')
const providerMatrix = json('config/v1-provider-matrix.json')
const safetyPolicy = json('config/v1-content-safety-policy.json')
const governance = json('config/v1-data-governance.json')
const releaseScope = json('config/v1-release-scope.json')
const packageJson = json('package.json')
const checks = []

const addCheck = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })
const sorted = (values) => [...values].sort()
const sameMembers = (actual, expected) => JSON.stringify(sorted(actual)) === JSON.stringify(sorted(expected))
const unique = (values) => new Set(values).size === values.length
const nonEmptyLocalized = (value) => Boolean(value?.en?.trim() && value?.zh?.trim())

const expectedPolicyIds = ['acceptable-use', 'privacy', 'provider-disclosure', 'support', 'terms']
const expectedRequiredPolicyIds = ['acceptable-use', 'privacy', 'provider-disclosure', 'terms']
const expectedPolicyRoutes = ['aup', 'disclosures', 'privacy', 'support', 'terms']
const expectedSupportCategories = [
  'account_deletion',
  'content_report',
  'data_export',
  'general_support',
  'moderation_appeal',
  'privacy_request',
]
const expectedRelatedResources = [
  'account',
  'comment',
  'creative_generation',
  'media_asset',
  'moderation_decision',
  'none',
  'post',
  'task',
]
const expectedHandoffTasks = ['V1-48', 'V1-63', 'V1-67', 'V1-73']

addCheck('compliance schema version is supported', manifest.schemaVersion === 1, manifest.schemaVersion)
addCheck('compliance baseline is owned by V1-78', manifest.taskId === 'V1-78', manifest.taskId)
addCheck('compliance baseline has a stable date', /^\d{4}-\d{2}-\d{2}$/.test(manifest.asOf), manifest.asOf)
addCheck('policy set version is stable', /^v1-legal-support-\d{4}-\d{2}-\d{2}$/.test(manifest.policySetVersion), manifest.policySetVersion)
addCheck('policy status is explicit', manifest.policyStatus === 'engineering_draft_pending_legal_review', manifest.policyStatus)
addCheck('both product locales are supported', sameMembers(manifest.supportedLocales, ['en', 'zh']), manifest.supportedLocales?.join(', '))
addCheck('default locale is supported', manifest.supportedLocales.includes(manifest.defaultLocale), manifest.defaultLocale)
addCheck(
  'legal and production publication remain blocked',
  manifest.releaseReadiness.legalApproved === false &&
    manifest.releaseReadiness.policyPublicationApproved === false &&
    manifest.releaseReadiness.productionLaunchAllowed === false &&
    manifest.releaseReadiness.ordinaryContinuationIsLegalApproval === false,
  JSON.stringify(manifest.releaseReadiness),
)
addCheck('operator legal entity is not fabricated', manifest.operator.legalEntity === 'TO_BE_CONFIRMED_BEFORE_PUBLICATION', manifest.operator.legalEntity)
addCheck('operator jurisdiction is not fabricated', manifest.operator.jurisdiction === 'TO_BE_CONFIRMED_BEFORE_PUBLICATION', manifest.operator.jurisdiction)
addCheck('emergency notice is bilingual', nonEmptyLocalized(manifest.operator.emergencyNotice))

addCheck('all required policies exist', sameMembers(manifest.policies.map((policy) => policy.id), expectedPolicyIds), manifest.policies.map((policy) => policy.id).join(', '))
addCheck('policy ids are unique', unique(manifest.policies.map((policy) => policy.id)))
addCheck('policy routes are unique and complete', sameMembers(manifest.policies.map((policy) => policy.route), expectedPolicyRoutes))
addCheck('required consent policy ids are exact', sameMembers(manifest.consentContract.requiredPolicyIds, expectedRequiredPolicyIds))
addCheck('consent capture points cover registration and first use', ['email_registration', 'oauth_first_authenticated_use', 'existing_account_first_authenticated_use', 'material_policy_update'].every((item) => manifest.consentContract.capturePoints.includes(item)))
addCheck('consent requires exact versions and affirmative action', manifest.consentContract.exactVersionMatchRequired === true && manifest.consentContract.affirmativeActionRequired === true)
addCheck('prechecked bundled consent is forbidden', manifest.consentContract.bundledPrecheckedConsentForbidden === true)
addCheck('consent audit action is stable', manifest.consentContract.recordAction === 'compliance.policy_consent.recorded')
addCheck('consent audit resource type is stable', manifest.consentContract.recordResourceType === 'policy_consent')
addCheck('consent record has all minimum fields', ['userId', 'policySetVersion', 'policyVersions', 'acceptedAt', 'source', 'locale'].every((field) => manifest.consentContract.recordFields.includes(field)))

for (const policy of manifest.policies) {
  addCheck(`${policy.id} title is bilingual`, nonEmptyLocalized(policy.title))
  addCheck(`${policy.id} summary is bilingual`, nonEmptyLocalized(policy.summary))
  addCheck(`${policy.id} version is a V1 draft`, /^1\.0\.0-draft\.\d+$/.test(policy.version), policy.version)
  addCheck(`${policy.id} review status is explicit`, policy.status === 'draft_pending_legal_review', policy.status)
  addCheck(`${policy.id} has substantive sections`, Array.isArray(policy.sections) && policy.sections.length >= 4, policy.sections?.length)
  addCheck(`${policy.id} section ids are unique`, unique(policy.sections.map((section) => section.id)))
  for (const section of policy.sections) {
    addCheck(`${policy.id}/${section.id} heading is bilingual`, nonEmptyLocalized(section.title))
    addCheck(
      `${policy.id}/${section.id} body is bilingual`,
      Array.isArray(section.paragraphs?.en) && section.paragraphs.en.length > 0 &&
        Array.isArray(section.paragraphs?.zh) && section.paragraphs.zh.length === section.paragraphs.en.length &&
        section.paragraphs.en.every((item) => item.trim().length >= 40) &&
        section.paragraphs.zh.every((item) => item.trim().length >= 20),
      `${section.paragraphs?.en?.length ?? 0}/${section.paragraphs?.zh?.length ?? 0}`,
    )
  }
}

for (const policyId of expectedRequiredPolicyIds) {
  addCheck(`${policyId} requires consent`, manifest.policies.find((policy) => policy.id === policyId)?.requiredConsent === true)
}
addCheck('support policy is notice-only', manifest.policies.find((policy) => policy.id === 'support')?.requiredConsent === false)

const allPolicyText = JSON.stringify(manifest.policies)
addCheck('terms cover internal points and creative credits', allPolicyText.includes('internal points') && allPolicyText.includes('creative credits'))
addCheck('terms exclude real-money capabilities', allPolicyText.includes('real-money payment') && allPolicyText.includes('withdrawal') && allPolicyText.includes('KYC'))
addCheck('privacy policy preserves V1-67 handoff', allPolicyText.includes('V1-67') && allPolicyText.includes('export package builder'))
addCheck('AUP exposes appeal timing', allPolicyText.includes('within 30 days') && allPolicyText.includes('five business days'))
addCheck('Provider disclosure forbids mock misrepresentation', allPolicyText.includes('fixture or mock execution'))
addCheck('support policy does not claim downstream completion', allPolicyText.includes('A submitted request is not a claim that the requested action has completed'))

addCheck('Provider disclosure count matches decision matrix', manifest.providerDisclosures.length === providerMatrix.providers.length, manifest.providerDisclosures.length)
addCheck('Provider disclosure ids match decision matrix', sameMembers(manifest.providerDisclosures.map((item) => item.providerId), providerMatrix.providers.map((item) => item.id)))
addCheck('Provider disclosure ids are unique', unique(manifest.providerDisclosures.map((item) => item.providerId)))
addCheck('every Provider remains unapproved for production', manifest.providerDisclosures.every((item) => item.productionApproved === false))
for (const modality of ['image', 'chat', 'video', 'music']) {
  addCheck(`${modality} has primary and backup disclosures`, manifest.providerDisclosures.filter((item) => item.modality === modality).length === 2)
}

addCheck('support storage uses dedicated SupportTicket lifecycle', manifest.supportContract.recordModel === 'SupportTicket', manifest.supportContract.recordModel)
addCheck('support requests require authentication', manifest.supportContract.authenticationRequired === true)
addCheck('support queue and action are stable', manifest.supportContract.queue === 'support_tickets' && manifest.supportContract.requestAction === 'support.ticket.created')
addCheck('all support categories are present', sameMembers(manifest.supportContract.categories.map((item) => item.id), expectedSupportCategories))
addCheck('support category ids are unique', unique(manifest.supportContract.categories.map((item) => item.id)))
addCheck('related resource types are allowlisted', sameMembers(manifest.supportContract.allowedRelatedResourceTypes, expectedRelatedResources))
addCheck('sensitive support fields are forbidden', manifest.supportContract.forbiddenFields.length >= 9 && ['password', 'access token', 'API key', 'private signed URL', 'raw Provider payload'].every((item) => manifest.supportContract.forbiddenFields.includes(item)))
for (const category of manifest.supportContract.categories) {
  addCheck(`${category.id} label is bilingual`, nonEmptyLocalized(category.label))
  addCheck(`${category.id} has a response target`, /_(business|calendar)_days?$/.test(category.initialResponseTarget), category.initialResponseTarget)
  addCheck(`${category.id} has a V1 owner`, /^V1-\d+$/.test(category.implementationOwner), category.implementationOwner)
}

addCheck('all implementation handoffs are present', sameMembers(manifest.implementationHandoff.map((item) => item.taskId), expectedHandoffTasks))
addCheck('safety policy hands user-facing publication to V1-78', safetyPolicy.implementationHandoff?.some((item) => item.taskId === 'V1-78') ?? JSON.stringify(safetyPolicy).includes('V1-78'))

const moderationAsset = governance.dataAssets.find((asset) => asset.id === 'moderation_review_records')
const auditAsset = governance.dataAssets.find((asset) => asset.id === 'audit_event_records')
const supportAsset = governance.dataAssets.find((asset) => asset.id === 'support_ticket_records')
addCheck('support records have a dedicated governed asset', ['SupportTicket', 'SupportTicketMessage', 'SupportTicketCaseLink'].every((model) => supportAsset?.prismaModels.includes(model)) && supportAsset.ownerTasks.includes('V1-78'))
addCheck('consent records remain in the governed audit asset', auditAsset?.prismaModels.includes('AuditEvent') && auditAsset.ownerTasks.includes('V1-78'))
addCheck('governance records implemented policy consent', governance.runtimeStatus.policyConsentImplemented === true)
addCheck('governance records implemented support entry points', governance.runtimeStatus.supportEntryPointsImplemented === true)

const evidencePaths = [
  'config/v1-compliance-policy.json',
  'docs/V1_COMPLIANCE_AND_SUPPORT_BASELINE.md',
  'server/src/compliance/policyManifest.js',
  'server/src/modules/compliance/routes.js',
  'server/src/modules/compliance/routes.test.js',
  'src/services/complianceService.ts',
  'src/features/static-pages/StaticPages.tsx',
  'src/components/overlays/Overlays.tsx',
]
for (const evidencePath of evidencePaths) {
  addCheck(`evidence exists: ${evidencePath}`, fs.existsSync(path.join(root, evidencePath)), evidencePath)
}

const authRoutes = read('server/src/modules/auth/routes.js')
const complianceRoutes = read('server/src/modules/compliance/routes.js')
const supportOperations = read('server/src/support/supportOperations.js')
const policyLoader = read('server/src/compliance/policyManifest.js')
const seedRepository = read('server/src/repositories/seedRepository.js')
const prismaRepository = read('server/src/repositories/prismaRepository.js')
const openApi = read('server/src/docs/openapi.js')
const permissionMatrix = read('docs/PERMISSION_MATRIX.md')
const frontendTypes = read('src/domain/types.ts')
const staticPages = read('src/features/static-pages/StaticPages.tsx')
const overlays = read('src/components/overlays/Overlays.tsx')
const appShell = read('src/components/layout/AppShell.tsx')
const baselineDoc = read('docs/V1_COMPLIANCE_AND_SUPPORT_BASELINE.md')

addCheck('registration validates policy consent before account creation', authRoutes.includes("validatePolicyConsent(body.policyConsent, 'email_registration')"))
addCheck('current user response includes consent status', authRoutes.includes('repositories.compliance.getConsentStatus(actor)'))
addCheck('policy version mismatches fail explicitly', policyLoader.includes("'POLICY_VERSION_MISMATCH'"))
addCheck('consent status compares exact current versions', policyLoader.includes('missingPolicyIds') && policyLoader.includes('outdatedPolicyIds'))
addCheck('seed repository records immutable consent audits', seedRepository.includes('policyConsentByUserId') && seedRepository.includes('consentContract.recordAction'))
addCheck('Prisma repository reads consent from AuditEvent', prismaRepository.includes('client.auditEvent.findFirst') && prismaRepository.includes('consentContract.recordResourceType'))
addCheck('Prisma support creation is transactional', prismaRepository.includes('const support =') && prismaRepository.includes('transaction.adminReview.create') && prismaRepository.includes('transaction.auditEvent.create'))
addCheck('support free text is excluded from audit metadata', !/requestAction[\s\S]{0,500}metadata:\s*\{[\s\S]{0,300}(details|note)/.test(prismaRepository))
addCheck('support parser rejects credential-like content', supportOperations.includes('sensitiveSupportPattern') && supportOperations.includes("'SENSITIVE_SUPPORT_CONTENT'"))
addCheck('support routes enforce authentication', (complianceRoutes.match(/requireUser\(context\)/g) ?? []).length >= 5)

for (const route of ['/compliance/policies', '/compliance/consent', '/support/requests', '/support/requests/{id}']) {
  addCheck(`OpenAPI includes ${route}`, openApi.includes(`'${route}'`), route)
}
for (const route of ['GET /api/compliance/consent', 'POST /api/compliance/consent', 'GET /api/support/requests', 'POST /api/support/requests', 'GET /api/support/requests/:id']) {
  addCheck(`permission matrix includes ${route}`, permissionMatrix.includes(`\`${route}\``), route)
}

addCheck('frontend page contract includes AUP, disclosures, and support', ["| 'aup'", "| 'disclosures'", "| 'support'"].every((token) => frontendTypes.includes(token)))
addCheck('legal placeholder was removed', !staticPages.includes('static legal content placeholders') && !staticPages.includes('静态占位内容'))
addCheck('policy center renders versioned sections', staticPages.includes('legal-document-layout') && staticPages.includes('policy.sections.map'))
addCheck('support center exposes all six categories from the manifest', staticPages.includes('supportContract.categories.map') && staticPages.includes('createSupportRequest'))
addCheck('registration uses an unchecked explicit consent control', overlays.includes("useState(false)") && overlays.includes('policyConsentRequest') && overlays.includes("type=\"checkbox\""))
addCheck('first-use consent gate cannot be closed silently', overlays.includes('export function PolicyConsentModal') && !/policy-consent-modal[\s\S]{0,400}close-button/.test(overlays))
addCheck('shell exposes policy, privacy, and support navigation', appShell.includes("navigatePrimary('terms')") && appShell.includes("navigatePrimary('privacy')") && appShell.includes("navigatePrimary('support')"))
addCheck('shell activates first-use gate for missing consent', appShell.includes('policyConsent?.required') && appShell.includes('<PolicyConsentModal'))
addCheck('consent gate preserves policy and user-rights access', appShell.includes("page === 'privacy'") && appShell.includes("page === 'support'") && overlays.includes("openPage('support')"))

addCheck('release scope links the compliance manifest', releaseScope.compliancePolicy.policyManifest === 'config/v1-compliance-policy.json')
addCheck('release scope keeps legal approval false', releaseScope.compliancePolicy.legalReviewApproved === false && releaseScope.compliancePolicy.productionPublicationApproved === false)
addCheck('release scope compliance handoffs are exact', sameMembers(releaseScope.compliancePolicy.implementationTasks, ['V1-48', 'V1-63', 'V1-67', 'V1-73', 'V1-78']))
addCheck('compliance quality gate is required', releaseScope.requiredQualityGates.includes('compliance-policy-and-support'))
addCheck('baseline document preserves external legal gate', baselineDoc.includes('qualified legal review') && baselineDoc.includes('cannot substitute for legal approval'))
addCheck('baseline document names downstream owners', expectedHandoffTasks.every((taskId) => baselineDoc.includes(taskId)))
addCheck(
  'compliance verifier is wired into the quick gate',
  packageJson.scripts['test:v1-compliance'] === 'node scripts/verify-v1-compliance-policy.mjs' &&
    packageJson.scripts['check:quick']?.includes('npm run test:v1-compliance'),
  packageJson.scripts['check:quick'],
)

const failures = checks.filter((check) => !check.pass)

console.log('V1 compliance policy verification')
for (const check of checks) {
  console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
}

if (failures.length > 0) {
  console.error(`V1 compliance policy verification failed: ${failures.length} check(s)`)
  process.exit(1)
}

console.log(`V1 compliance policy verified: ${checks.length} checks`)
