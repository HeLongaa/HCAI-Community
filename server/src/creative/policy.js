import { HttpError } from '../common/errors/httpError.js'

const quotaCounters = new Map()

const policyVersion = 'creative-policy-v1'
const defaultDailyQuota = 24

const roleQuotaMultipliers = {
  admin: 4,
  moderator: 3,
  publisher: 2,
  creator: 2,
  member: 1,
}

const creditCosts = {
  image: {
    text_to_image: 1,
    image_to_image: 2,
  },
  video: {
    text_to_video: 8,
    image_to_video: 10,
    music_video: 12,
  },
  music: {
    text_to_music: 4,
    remix: 5,
  },
  chat: {
    prompt_assist: 1,
    storyboard: 2,
  },
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

const clampDailyQuota = (value) => {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed < 1) {
    return defaultDailyQuota
  }
  return Math.min(parsed, 500)
}

const quotaWindowFor = (now) => {
  const date = now.toISOString().slice(0, 10)
  return {
    id: date,
    resetsAt: `${date}T23:59:59.999Z`,
  }
}

const quotaKeyFor = ({ actor, request, now }) =>
  `${quotaWindowFor(now).id}:${actor.id}:${request.workspace}`

const quotaLimitFor = ({ actor, source }) => {
  const base = clampDailyQuota(source.CREATIVE_DAILY_QUOTA)
  const multiplier = roleQuotaMultipliers[actor.role] ?? 1
  return base * multiplier
}

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

export const reserveCreativeQuota = ({ request, actor, source = process.env, now = new Date() }) => {
  const limit = quotaLimitFor({ actor, source })
  const window = quotaWindowFor(now)
  const key = quotaKeyFor({ actor, request, now })
  const used = quotaCounters.get(key) ?? 0
  if (used >= limit) {
    throw new HttpError(429, 'CREATIVE_QUOTA_EXCEEDED', 'Creative generation quota exceeded', {
      policyVersion,
      workspace: request.workspace,
      limit,
      used,
      remaining: 0,
      window,
    })
  }

  const nextUsed = used + 1
  quotaCounters.set(key, nextUsed)
  return {
    policyVersion,
    scope: 'user_workspace_daily',
    workspace: request.workspace,
    limit,
    used: nextUsed,
    remaining: Math.max(limit - nextUsed, 0),
    window,
  }
}

export const estimateCreativeUsage = ({ request, provider }) => {
  const estimatedCredits = creditCosts[request.workspace]?.[request.mode] ?? 1
  return {
    estimatedCredits,
    providerCostCents: provider.safeMetadata?.costMetered ? estimatedCredits : 0,
    metered: Boolean(provider.safeMetadata?.costMetered),
    costModel: provider.safeMetadata?.costMetered ? 'provider_metered_placeholder' : 'mock_unmetered',
    currency: 'credits',
  }
}

export const applyCreativeGenerationPolicy = ({ request, actor, provider, source = process.env, now = new Date() }) => {
  const safety = moderateCreativePrompt(request.prompt)
  const quota = reserveCreativeQuota({ request, actor, source, now })
  const usage = estimateCreativeUsage({ request, provider })

  return {
    policy: {
      version: policyVersion,
      enforcedAt: now.toISOString(),
      gates: {
        quota: true,
        moderation: true,
        review: safety.reviewRequired,
      },
    },
    quota,
    usage,
    safety,
  }
}
