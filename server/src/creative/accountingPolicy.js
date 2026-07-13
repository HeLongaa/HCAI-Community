const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.values(value).forEach(deepFreeze)
  return Object.freeze(value)
}

const mode = (credits, quotaUnits = credits) => ({ credits, quotaUnits })

export const creativeAccountingPolicyV1 = deepFreeze({
  schema: 'CreativeAccountingPolicyV1',
  version: 'creative-policy-v1',
  effectiveAt: '2026-07-14T00:00:00.000Z',
  status: 'active',
  units: {
    credits: {
      code: 'creative_credits',
      purpose: 'Internal product consumption unit',
      convertibleToProviderCurrency: false,
    },
    quota: {
      code: 'quota_units',
      purpose: 'Usage limit counter',
      convertibleToCredits: false,
      window: 'user_workspace_daily',
    },
    providerCost: {
      code: 'provider_currency_micros',
      purpose: 'External Provider ledger currency',
      convertibleToCredits: false,
      source: 'provider_cost_ledger',
    },
  },
  quota: {
    defaultDailyLimit: 24,
    maximumConfiguredDailyLimit: 500,
    roleMultipliers: {
      admin: 4,
      moderator: 3,
      publisher: 2,
      creator: 2,
      member: 1,
    },
  },
  workspaces: {
    image: {
      text_to_image: mode(1),
      image_to_image: mode(2),
      image_edit: mode(2),
      image_variation: mode(2),
    },
    video: {
      text_to_video: mode(8),
      image_to_video: mode(10),
      music_video: mode(12),
    },
    music: {
      instrumental: mode(4),
      lyrics_to_song: mode(5),
    },
    chat: {
      assistant: mode(1),
      prompt_assist: mode(1),
      storyboard: mode(2),
    },
  },
  settlement: {
    queued: { credits: 'reserve', quota: 'reserve', providerCost: 'independent_ledger' },
    running: { credits: 'keep_reserved', quota: 'keep_reserved', providerCost: 'independent_ledger' },
    completed: { credits: 'settle', quota: 'commit', condition: 'persisted_output' },
    review_required: { credits: 'settle', quota: 'commit', condition: 'persisted_governed_output' },
    failed: { credits: 'refund', quota: 'release', condition: 'no_output_and_not_billed' },
    cancelled: { credits: 'refund', quota: 'release', condition: 'no_output_and_not_billed' },
    provider_cost_unknown: { credits: 'close_by_generation_fact', quota: 'close_by_generation_fact', providerCost: 'reconcile' },
  },
  retry: {
    accountingScope: 'attempt',
    policySnapshot: 'per_attempt',
  },
  history: {
    immutable: true,
    repriceHistoricalLedger: false,
    missingPolicyVersionLabel: 'legacy',
  },
})

export const creativeAccountingPolicyHistory = deepFreeze([
  creativeAccountingPolicyV1,
])

export const validateCreativeAccountingPolicy = (policy) => {
  if (policy?.schema !== 'CreativeAccountingPolicyV1') throw new Error('Invalid creative accounting policy schema')
  if (!policy.version || !policy.effectiveAt) throw new Error('Creative accounting policy identity is required')
  for (const [workspace, modes] of Object.entries(policy.workspaces ?? {})) {
    for (const [modeId, accounting] of Object.entries(modes ?? {})) {
      if (!Number.isInteger(accounting.credits) || accounting.credits < 0) {
        throw new Error(`Invalid credit weight: ${workspace}/${modeId}`)
      }
      if (!Number.isInteger(accounting.quotaUnits) || accounting.quotaUnits < 1) {
        throw new Error(`Invalid quota weight: ${workspace}/${modeId}`)
      }
    }
  }
  if (policy.units?.credits?.convertibleToProviderCurrency !== false) {
    throw new Error('Creative credits must not be convertible to Provider currency')
  }
  return true
}

validateCreativeAccountingPolicy(creativeAccountingPolicyV1)

export const accountingForCreativeMode = (workspace, modeId) =>
  creativeAccountingPolicyV1.workspaces?.[workspace]?.[modeId] ?? null

export const creativeQuotaLimitFor = ({ actor, source = process.env }) => {
  const configured = Number.parseInt(String(source.CREATIVE_DAILY_QUOTA ?? ''), 10)
  const base = Number.isFinite(configured) && configured >= 1
    ? Math.min(configured, creativeAccountingPolicyV1.quota.maximumConfiguredDailyLimit)
    : creativeAccountingPolicyV1.quota.defaultDailyLimit
  return base * (creativeAccountingPolicyV1.quota.roleMultipliers[actor?.role] ?? 1)
}

export const providerCostAvailability = (provider) => {
  if (!provider?.enabled || !provider?.configured) {
    return { availability: 'unavailable', reasonCode: 'provider_unavailable' }
  }
  if (!provider.safeMetadata?.costMetered) {
    return { availability: 'unavailable', reasonCode: 'provider_cost_not_metered' }
  }
  return { availability: 'available', reasonCode: null }
}

export const creativeSettlementSummary = () => ({
  success: 'settle credits and commit quota after output persistence',
  reviewRequired: 'settle credits and commit quota after governed output persistence',
  noOutputFailureOrCancellation: 'refund credits and release quota when not billed',
  providerCostUnknown: 'reconcile Provider ledger only; close internal ledgers from generation facts',
})
