import { HttpError } from '../common/errors/httpError.js'
import {
  accountingForCreativeMode,
  creativeAccountingPolicyV1,
  creativeQuotaLimitFor,
  providerCostAvailability,
} from './accountingPolicy.js'

const quotaCounters = new Map()

const policyVersion = creativeAccountingPolicyV1.version
if (policyVersion !== 'creative-policy-v1') {
  throw new Error('Creative accounting and content-safety policy versions must stay aligned')
}

const blockedModerationRules = [
  {
    id: 'sexual_minor_content',
    label: 'Sexual content involving minors is not allowed.',
    pattern: /\b(minor|underage|child|kid|teen)\b[\s\S]{0,80}\b(nude|sexual|erotic|explicit)\b|\b(nude|sexual|erotic|explicit)\b[\s\S]{0,80}\b(minor|underage|child|kid|teen)\b/i,
  },
  {
    id: 'graphic_violence',
    label: 'Graphic violence is not allowed for provider-backed generation.',
    pattern: /\b(gore|dismember|beheading|graphic violence|torture scene)\b/i,
  },
  {
    id: 'credential_abuse',
    label: 'Credential theft or phishing assistance is not allowed.',
    pattern: /\b(phishing|steal passwords|credential harvesting|fake login page)\b/i,
  },
]

const reviewModerationRules = [
  {
    id: 'public_figure_or_celebrity',
    label: 'Public figure or celebrity likeness requests require review.',
    pattern: /\b(celebrity|public figure|politician|candidate|president|prime minister)\b/i,
  },
  {
    id: 'regulated_advice',
    label: 'Regulated legal, medical, or financial advice requires review.',
    pattern: /\b(legal advice|medical diagnosis|investment advice|financial advice)\b/i,
  },
  {
    id: 'brand_or_weapon_sensitive',
    label: 'Brand, logo, weapon, or manual-review requests require review.',
    pattern: /\b(trademark|brand logo|weapon|manual review)\b/i,
  },
]

export const quotaWindowFor = (now) => {
  const date = now.toISOString().slice(0, 10)
  return {
    id: date,
    type: 'daily',
    start: `${date}T00:00:00.000Z`,
    resetsAt: `${date}T23:59:59.999Z`,
    end: `${date}T23:59:59.999Z`,
  }
}

const quotaKeyFor = ({ actor, request, now }) =>
  `${quotaWindowFor(now).id}:${actor.id}:${request.workspace}`

export const resetCreativePolicyState = () => {
  quotaCounters.clear()
}

export const moderateCreativePrompt = (prompt) => {
  const text = String(prompt ?? '')
  const blockedReasons = blockedModerationRules.filter((rule) => rule.pattern.test(text))
  if (blockedReasons.length > 0) {
    throw new HttpError(422, 'CREATIVE_MODERATION_BLOCKED', 'Creative prompt failed moderation policy', {
      policyVersion,
      reasons: blockedReasons.map((rule) => ({
        id: rule.id,
        label: rule.label,
      })),
    })
  }

  const reviewReasons = reviewModerationRules.filter((rule) => rule.pattern.test(text))
  return {
    moderationRequired: reviewReasons.length > 0,
    reviewRequired: reviewReasons.length > 0,
    reasons: reviewReasons.map((rule) => ({
      id: rule.id,
      label: rule.label,
    })),
    policyVersion,
  }
}

export const reserveCreativeQuota = async ({
  request,
  actor,
  source = process.env,
  now = new Date(),
  generationId = null,
  costUnits = 1,
  quotaRepository = null,
}) => {
  const limit = creativeQuotaLimitFor({ actor, source })
  const window = quotaWindowFor(now)
  const units = Math.max(1, Number.parseInt(String(costUnits ?? 1), 10) || 1)
  if (quotaRepository?.reserve) {
    const result = await quotaRepository.reserve({
      generationId,
      actorId: actor.id,
      actorHandle: actor.handle,
      workspace: request.workspace,
      windowType: window.type,
      windowStart: window.start,
      windowEnd: window.end,
      limit,
      costUnits: units,
      policyVersion,
    }, actor)
    if (!result?.reserved) {
      const quota = result?.quota ?? {}
      throw new HttpError(429, 'CREATIVE_QUOTA_EXCEEDED', 'Creative generation quota exceeded', {
        policyVersion,
        workspace: request.workspace,
        limit,
        used: quota.used ?? 0,
        reserved: quota.reserved ?? 0,
        released: quota.released ?? 0,
        remaining: quota.remaining ?? 0,
        window,
      })
    }
    return result.quota
  }

  const key = quotaKeyFor({ actor, request, now })
  const used = quotaCounters.get(key) ?? 0
  if (used + units > limit) {
    throw new HttpError(429, 'CREATIVE_QUOTA_EXCEEDED', 'Creative generation quota exceeded', {
      policyVersion,
      workspace: request.workspace,
      limit,
      used,
      remaining: 0,
      window,
    })
  }

  const nextUsed = used + units
  quotaCounters.set(key, nextUsed)
  return {
    policyVersion,
    scope: 'user_workspace_daily',
    workspace: request.workspace,
    limit,
    reserved: 0,
    used: nextUsed,
    released: 0,
    remaining: Math.max(limit - nextUsed, 0),
    window,
  }
}

export const estimateCreativeUsage = ({ request, provider }) => {
  const accounting = accountingForCreativeMode(request.workspace, request.mode) ?? { credits: 1, quotaUnits: 1 }
  return {
    estimatedCredits: accounting.credits,
    quotaUnits: accounting.quotaUnits,
    creditEstimateKind: 'policy_estimate',
    providerCostAvailability: providerCostAvailability(provider),
    metered: Boolean(provider?.safeMetadata?.costMetered),
    costModel: 'creative_accounting_policy',
    currency: 'credits',
  }
}

export const applyCreativeGenerationPolicy = async ({
  request,
  actor,
  provider,
  source = process.env,
  now = new Date(),
  generationId = null,
  quotaRepository = null,
}) => {
  const safety = moderateCreativePrompt(request.prompt)
  const usage = estimateCreativeUsage({ request, provider })
  const quota = await reserveCreativeQuota({
    request,
    actor,
    source,
    now,
    generationId,
    costUnits: usage.quotaUnits,
    quotaRepository,
  })

  return {
    policy: {
      version: policyVersion,
      enforcedAt: now.toISOString(),
      gates: {
        quota: true,
        credit: true,
        moderation: true,
        review: safety.reviewRequired,
      },
    },
    quota,
    usage,
    safety,
  }
}
