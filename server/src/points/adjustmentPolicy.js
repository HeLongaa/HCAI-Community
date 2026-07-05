const productRoles = ['member', 'creator', 'publisher', 'moderator', 'admin']

const parsePositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

const parseRoleDirectLimits = (value) => {
  const entries = String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return Object.fromEntries(entries.flatMap((entry) => {
    const [role, rawLimit] = entry.split(/[:=]/).map((item) => item.trim())
    const limit = Number.parseInt(rawLimit, 10)
    return productRoles.includes(role) && Number.isFinite(limit) && limit >= 0 ? [[role, limit]] : []
  }))
}

const reviewThreshold = parsePositiveInteger(process.env.POINT_ADJUSTMENT_REVIEW_THRESHOLD, 5000)
const roleDirectLimitOverrides = parseRoleDirectLimits(process.env.POINT_ADJUSTMENT_DIRECT_LIMITS)

export const defaultPointAdjustmentPolicy = Object.freeze({
  roleLimits: Object.freeze({
    member: 0,
    creator: 0,
    publisher: 0,
    moderator: Math.min(1000, reviewThreshold),
    admin: reviewThreshold,
    ...roleDirectLimitOverrides,
  }),
  reasonCodes: Object.freeze(['support_credit', 'fraud_correction', 'campaign_bonus', 'settlement_fix']),
  approvalTemplates: Object.freeze([
    'Verified request, account, and ledger impact.',
    'Approved after support ticket and balance review.',
    'Rejected: insufficient evidence for manual adjustment.',
  ]),
})

const cleanStringArray = (value, fallback) => {
  if (!Array.isArray(value)) {
    return [...fallback]
  }
  const cleaned = value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20)
  return cleaned.length > 0 ? cleaned : [...fallback]
}

export const normalizePointAdjustmentPolicy = (policy = {}, fallback = defaultPointAdjustmentPolicy) => {
  const sourceRoleLimits = policy.roleLimits && typeof policy.roleLimits === 'object' ? policy.roleLimits : {}
  const roleLimits = Object.fromEntries(productRoles.map((role) => [
    role,
    parsePositiveInteger(sourceRoleLimits[role], fallback.roleLimits[role] ?? 0),
  ]))
  return {
    roleLimits,
    reasonCodes: cleanStringArray(policy.reasonCodes, fallback.reasonCodes),
    approvalTemplates: cleanStringArray(policy.approvalTemplates, fallback.approvalTemplates),
  }
}

export const getDirectLimitForActor = (policy, actor) => {
  const normalized = normalizePointAdjustmentPolicy(policy)
  return normalized.roleLimits[actor?.role] ?? 0
}

export const diffPointAdjustmentPolicy = (previous, next) => {
  const before = normalizePointAdjustmentPolicy(previous)
  const after = normalizePointAdjustmentPolicy(next)
  const roleLimits = Object.fromEntries(Object.keys(after.roleLimits)
    .filter((role) => before.roleLimits[role] !== after.roleLimits[role])
    .map((role) => [role, { from: before.roleLimits[role], to: after.roleLimits[role] }]))
  const addedReasons = after.reasonCodes.filter((item) => !before.reasonCodes.includes(item))
  const removedReasons = before.reasonCodes.filter((item) => !after.reasonCodes.includes(item))
  const templatesChanged = before.approvalTemplates.join('\n') !== after.approvalTemplates.join('\n')
  return {
    roleLimits,
    addedReasons,
    removedReasons,
    templatesChanged,
  }
}

export const summarizePointPolicyDiff = (diff) => {
  const roleChanges = Object.entries(diff?.roleLimits ?? {}).map(([role, change]) => `${role}: ${change.from}->${change.to}`)
  const reasonChanges = [
    ...(diff?.addedReasons?.length ? [`+${diff.addedReasons.join('|')}`] : []),
    ...(diff?.removedReasons?.length ? [`-${diff.removedReasons.join('|')}`] : []),
  ]
  const templateChanges = diff?.templatesChanged ? ['templates changed'] : []
  return [...roleChanges, ...reasonChanges, ...templateChanges].join(', ') || 'no material changes'
}
