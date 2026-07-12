import { createHash } from 'node:crypto'

import { chatCapabilityContract } from '../creative/chatCapabilityContract.js'

const policyVersion = chatCapabilityContract.safety.policyVersion
const safeReasonPattern = /^[A-Z][A-Z0-9_]{2,63}$/

const blockedRules = [
  ['SAFETY_CHILD_SEXUAL', /\b(minor|underage|child)\b[\s\S]{0,80}\b(nude|sexual|explicit)\b|\b(nude|sexual|explicit)\b[\s\S]{0,80}\b(minor|underage|child)\b/i],
  ['SAFETY_CYBER_ABUSE', /\b(phishing|credential harvesting|steal passwords|malware payload)\b/i],
  ['SAFETY_VIOLENT_WRONGDOING', /\b(how to|instructions? to)\b[\s\S]{0,60}\b(kill|bomb|attack)\b/i],
  ['SAFETY_EXPLICIT_SEXUAL', /\b(pornographic|explicit sexual content)\b/i],
  ['SAFETY_TARGETED_ABUSE', /\b(doxx|credible threat|stalk this person)\b/i],
  ['SAFETY_NON_CONSENSUAL_INTIMATE', /\b(non-consensual intimate|intimate image without consent)\b/i],
  ['SAFETY_HATE_EXTREMISM', /\b(extremist recruitment|hate recruitment|targeted dehumanization)\b/i],
  ['SAFETY_SELF_HARM', /\b(instructions? for|encourage)\b[\s\S]{0,60}\b(suicide|self-harm)\b/i],
  ['SAFETY_FRAUD_DECEPTION', /\b(scam script|fraud scheme|deceptive impersonation)\b/i],
  ['SAFETY_POLITICAL_PERSUASION', /\b(targeted political persuasion|voting misinformation|election interference)\b/i],
]

const reviewRules = [
  ['SAFETY_PUBLIC_FIGURE', /\b(celebrity|public figure|politician|candidate|president|prime minister)\b/i],
  ['SAFETY_REGULATED_ADVICE', /\b(legal advice|medical diagnosis|investment advice|financial advice)\b/i],
  ['RIGHTS_IP_OR_LICENSE', /\b(trademark|brand logo|living artist|copyrighted lyrics)\b/i],
  ['SAFETY_CONTEXT_REQUIRED', /\b(medical|legal|journalistic|documentary) context\b/i],
  ['SAFETY_GRAPHIC_VIOLENCE', /\b(gore|dismemberment|graphic violence|torture scene)\b/i],
  ['SAFETY_REAL_PERSON_IDENTITY', /\b(real person likeness|biometric|clone this person)\b/i],
  ['SAFETY_PRIVACY_INFERENCE', /\b(infer sensitive|personal data|private address|health status)\b/i],
  ['SAFETY_REGULATED_GOODS', /\b(weapon|illicit drug|regulated goods)\b/i],
  ['SAFETY_MINOR_SENSITIVE', /\bminor in danger|exploitative child depiction\b/i],
]

const normalizeReasons = (values) => [...new Set((values ?? [])
  .map((value) => String(value ?? '').trim().toUpperCase())
  .filter((value) => safeReasonPattern.test(value)))]

export const classifyMockChatSafety = async ({ text }) => {
  const value = String(text ?? '')
  const blocked = blockedRules.filter(([, pattern]) => pattern.test(value)).map(([reason]) => reason)
  if (blocked.length > 0) return { classified: true, disposition: 'block', reasonCodes: blocked, source: 'mock_fixture' }
  const review = reviewRules.filter(([, pattern]) => pattern.test(value)).map(([reason]) => reason)
  if (review.length > 0) return { classified: true, disposition: 'review', reasonCodes: review, source: 'mock_fixture' }
  return { classified: true, disposition: 'allow', reasonCodes: ['SAFETY_ALLOWED_BASELINE'], source: 'mock_fixture' }
}

export const normalizeChatSafetyDecision = (decision) => {
  const disposition = ['allow', 'block', 'review', 'pending'].includes(decision?.disposition)
    ? decision.disposition
    : 'block'
  const classified = decision?.classified === true && disposition !== 'pending'
  return Object.freeze({
    classified,
    disposition: classified ? disposition : (disposition === 'pending' ? 'pending' : 'block'),
    reasonCodes: normalizeReasons(decision?.reasonCodes).length > 0
      ? normalizeReasons(decision.reasonCodes)
      : ['CHAT_SAFETY_UNCLASSIFIED'],
    source: decision?.source === 'mock_fixture' || decision?.source === 'injected_fixture'
      ? decision.source
      : 'unavailable',
  })
}

export const buildChatSafetyEvidence = (decision, { stage, text, classifiedAt = new Date() }) => {
  const normalized = normalizeChatSafetyDecision(decision)
  const contentHash = createHash('sha256').update(String(text ?? '')).digest('hex')
  const safetyId = createHash('sha256')
    .update([policyVersion, stage, normalized.disposition, normalized.reasonCodes.join(','), contentHash].join('|'))
    .digest('hex')
    .slice(0, 32)
  return Object.freeze({
    safetyId: `chat-safe-${safetyId}`,
    policyVersion,
    stage,
    disposition: normalized.disposition,
    classified: normalized.classified,
    reasonCodes: normalized.reasonCodes,
    source: normalized.source,
    characterCount: [...String(text ?? '')].length,
    classifiedAt: new Date(classifiedAt).toISOString(),
  })
}

export const classifyChatSafety = async (classifier, payload) => {
  try {
    return normalizeChatSafetyDecision(await classifier(payload))
  } catch {
    return normalizeChatSafetyDecision(null)
  }
}
