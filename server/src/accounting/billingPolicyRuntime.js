import { diffPointAdjustmentPolicy, normalizePointAdjustmentPolicy, summarizePointPolicyDiff } from '../points/adjustmentPolicy.js'

export const buildBillingPolicyPreview = ({ current, candidate, creativePolicy }) => {
  const normalizedCurrent = normalizePointAdjustmentPolicy(current)
  const normalizedCandidate = normalizePointAdjustmentPolicy(candidate)
  const diff = diffPointAdjustmentPolicy(normalizedCurrent, normalizedCandidate)
  const roles = Object.keys(normalizedCandidate.roleLimits).map((role) => ({
    role,
    currentLimit: normalizedCurrent.roleLimits[role],
    candidateLimit: normalizedCandidate.roleLimits[role],
    delta: normalizedCandidate.roleLimits[role] - normalizedCurrent.roleLimits[role],
    routingChanged: normalizedCandidate.roleLimits[role] !== normalizedCurrent.roleLimits[role],
  }))
  return {
    current: normalizedCurrent,
    candidate: normalizedCandidate,
    diff,
    summary: summarizePointPolicyDiff(diff),
    impact: {
      roles,
      rolesChanged: roles.filter((item) => item.routingChanged).length,
      reasonCodesAdded: diff.addedReasons.length,
      reasonCodesRemoved: diff.removedReasons.length,
      approvalTemplatesChanged: diff.templatesChanged,
      creativeRuntimeChanged: false,
      creativePolicyVersion: creativePolicy.version,
    },
  }
}
