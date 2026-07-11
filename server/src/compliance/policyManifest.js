import fs from 'node:fs'

import { HttpError } from '../common/errors/httpError.js'

const manifestUrl = new URL('../../../config/v1-compliance-policy.json', import.meta.url)

export const compliancePolicyManifest = JSON.parse(fs.readFileSync(manifestUrl, 'utf8'))

const policyById = new Map(compliancePolicyManifest.policies.map((policy) => [policy.id, policy]))
const requiredPolicies = compliancePolicyManifest.consentContract.requiredPolicyIds.map((policyId) => policyById.get(policyId))

export const currentRequiredPolicyVersions = () => Object.fromEntries(
  requiredPolicies.map((policy) => [policy.id, policy.version]),
)

export const publicComplianceManifest = () => ({
  schemaVersion: compliancePolicyManifest.schemaVersion,
  release: compliancePolicyManifest.release,
  asOf: compliancePolicyManifest.asOf,
  policySetVersion: compliancePolicyManifest.policySetVersion,
  policyStatus: compliancePolicyManifest.policyStatus,
  defaultLocale: compliancePolicyManifest.defaultLocale,
  supportedLocales: compliancePolicyManifest.supportedLocales,
  releaseReadiness: compliancePolicyManifest.releaseReadiness,
  operator: compliancePolicyManifest.operator,
  consentContract: compliancePolicyManifest.consentContract,
  policies: compliancePolicyManifest.policies,
  providerDisclosures: compliancePolicyManifest.providerDisclosures,
  supportContract: compliancePolicyManifest.supportContract,
})

export const consentPolicySummaries = () => requiredPolicies.map((policy) => ({
  id: policy.id,
  route: policy.route,
  version: policy.version,
  title: policy.title,
  summary: policy.summary,
}))

export const validatePolicyConsent = (value, source) => {
  if (!value || value.accepted !== true) {
    throw new HttpError(400, 'POLICY_CONSENT_REQUIRED', 'Affirmative policy consent is required')
  }
  if (!compliancePolicyManifest.consentContract.allowedSources.includes(source)) {
    throw new HttpError(400, 'POLICY_CONSENT_SOURCE_INVALID', 'Policy consent source is not allowed')
  }
  const submittedVersions = value.policyVersions
  if (!submittedVersions || typeof submittedVersions !== 'object' || Array.isArray(submittedVersions)) {
    throw new HttpError(400, 'POLICY_VERSION_REQUIRED', 'Current required policy versions are required')
  }

  const requiredVersions = currentRequiredPolicyVersions()
  const submittedKeys = Object.keys(submittedVersions).sort()
  const requiredKeys = Object.keys(requiredVersions).sort()
  const exactKeys = JSON.stringify(submittedKeys) === JSON.stringify(requiredKeys)
  const exactVersions = requiredKeys.every((policyId) => submittedVersions[policyId] === requiredVersions[policyId])
  if (!exactKeys || !exactVersions) {
    throw new HttpError(409, 'POLICY_VERSION_MISMATCH', 'Policy versions changed; review the current policies and consent again', {
      policySetVersion: compliancePolicyManifest.policySetVersion,
      requiredPolicyVersions: requiredVersions,
    })
  }

  const locale = compliancePolicyManifest.supportedLocales.includes(value.locale)
    ? value.locale
    : compliancePolicyManifest.defaultLocale
  return {
    accepted: true,
    policySetVersion: compliancePolicyManifest.policySetVersion,
    policyVersions: requiredVersions,
    source,
    locale,
  }
}

export const buildConsentStatus = (record = null) => {
  const requiredVersions = currentRequiredPolicyVersions()
  const acceptedVersions = record?.policyVersions && typeof record.policyVersions === 'object'
    ? record.policyVersions
    : {}
  const missingPolicyIds = Object.keys(requiredVersions).filter((policyId) => !acceptedVersions[policyId])
  const outdatedPolicyIds = Object.keys(requiredVersions).filter((policyId) => (
    acceptedVersions[policyId] && acceptedVersions[policyId] !== requiredVersions[policyId]
  ))
  const current = record?.policySetVersion === compliancePolicyManifest.policySetVersion &&
    missingPolicyIds.length === 0 && outdatedPolicyIds.length === 0

  return {
    required: !current,
    current,
    policySetVersion: compliancePolicyManifest.policySetVersion,
    requiredPolicyVersions: requiredVersions,
    requiredPolicies: consentPolicySummaries(),
    acceptedAt: record?.acceptedAt ?? null,
    acceptedSource: record?.source ?? null,
    acceptedPolicyVersions: acceptedVersions,
    missingPolicyIds,
    outdatedPolicyIds,
  }
}

export const getSupportCategory = (categoryId) => (
  compliancePolicyManifest.supportContract.categories.find((category) => category.id === categoryId) ?? null
)
