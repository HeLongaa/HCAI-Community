import { createHash } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'

export const riskCaseStatuses = Object.freeze(['open', 'restricted', 'appealed', 'recovered', 'closed'])
export const riskDispositions = Object.freeze(['monitor', 'generation_throttled', 'generation_blocked', 'account_restricted', 'cleared'])
export const riskLevels = Object.freeze(['low', 'medium', 'high', 'critical'])
export const riskSignalTypes = Object.freeze(['auth_spray', 'account_takeover', 'generation_burst', 'safety_rejection_burst', 'generation_cost_spike'])

export const defaultRiskPolicy = Object.freeze({
  id: 'default',
  enabled: true,
  generationWindowSeconds: 300,
  generationCountThreshold: 20,
  safetyRejectionThreshold: 3,
  generationCostMicrosThreshold: 5_000_000,
  restrictionSeconds: 3_600,
  version: 0,
  reasonCode: 'risk_01_default',
  updatedByRef: 'system',
  createdAt: null,
  updatedAt: null,
})

const validationFailed = (message) => new HttpError(400, 'VALIDATION_FAILED', message)

const stableText = (value, name, maximum = 80) => {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!normalized || normalized.length > maximum || !/^[a-z0-9][a-z0-9._:-]*$/.test(normalized)) {
    throw validationFailed(`${name} is invalid`)
  }
  return normalized
}

const boundedInteger = (value, name, minimum, maximum) => {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw validationFailed(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return parsed
}

const enumValue = (value, name, allowed) => {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!allowed.includes(normalized)) throw validationFailed(`${name} is invalid`)
  return normalized
}

const dateValue = (value, name) => {
  const parsed = new Date(String(value ?? ''))
  if (!Number.isFinite(parsed.getTime())) throw validationFailed(`${name} is invalid`)
  return parsed
}

export const parseRiskPolicyUpdate = (raw = {}) => {
  const allowed = ['enabled', 'generationWindowSeconds', 'generationCountThreshold', 'safetyRejectionThreshold', 'generationCostMicrosThreshold', 'restrictionSeconds', 'expectedVersion', 'reasonCode']
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw validationFailed('payload must be an object')
  const unsupported = Object.keys(raw).filter((key) => !allowed.includes(key))
  if (unsupported.length) throw validationFailed(`payload contains unsupported fields: ${unsupported.join(', ')}`)
  if (typeof raw.enabled !== 'boolean') throw validationFailed('enabled must be a boolean')
  return {
    enabled: raw.enabled,
    generationWindowSeconds: boundedInteger(raw.generationWindowSeconds, 'generationWindowSeconds', 60, 86_400),
    generationCountThreshold: boundedInteger(raw.generationCountThreshold, 'generationCountThreshold', 2, 10_000),
    safetyRejectionThreshold: boundedInteger(raw.safetyRejectionThreshold, 'safetyRejectionThreshold', 1, 1_000),
    generationCostMicrosThreshold: boundedInteger(raw.generationCostMicrosThreshold, 'generationCostMicrosThreshold', 1, 2_147_483_647),
    restrictionSeconds: boundedInteger(raw.restrictionSeconds, 'restrictionSeconds', 60, 2_592_000),
    expectedVersion: boundedInteger(raw.expectedVersion, 'expectedVersion', 0, 2_147_483_647),
    reasonCode: stableText(raw.reasonCode, 'reasonCode'),
  }
}

export const parseRiskCaseListQuery = (query = {}, { admin = false } = {}) => {
  const allowed = admin
    ? ['status', 'disposition', 'riskLevel', 'userId', 'dateFrom', 'dateTo', 'cursor', 'limit']
    : ['status', 'cursor', 'limit']
  const unsupported = Object.keys(query).filter((key) => !allowed.includes(key))
  if (unsupported.length) throw validationFailed(`query contains unsupported fields: ${unsupported.join(', ')}`)
  const limit = boundedInteger(query.limit ?? 20, 'limit', 1, admin ? 100 : 50)
  const dateFrom = query.dateFrom ? dateValue(query.dateFrom, 'dateFrom') : null
  const dateTo = query.dateTo ? dateValue(query.dateTo, 'dateTo') : null
  if (dateFrom && dateTo && dateFrom >= dateTo) throw validationFailed('dateFrom must be before dateTo')
  return {
    status: query.status ? enumValue(query.status, 'status', riskCaseStatuses) : null,
    disposition: admin && query.disposition ? enumValue(query.disposition, 'disposition', riskDispositions) : null,
    riskLevel: admin && query.riskLevel ? enumValue(query.riskLevel, 'riskLevel', riskLevels) : null,
    userId: admin && query.userId ? stableText(query.userId, 'userId', 128) : null,
    dateFrom,
    dateTo,
    cursor: query.cursor ? String(query.cursor) : null,
    limit,
  }
}

export const parseRiskMetricsQuery = (query = {}) => {
  const unsupported = Object.keys(query).filter((key) => !['dateFrom', 'dateTo'].includes(key))
  if (unsupported.length) throw validationFailed(`query contains unsupported fields: ${unsupported.join(', ')}`)
  const dateTo = query.dateTo ? dateValue(query.dateTo, 'dateTo') : new Date()
  const dateFrom = query.dateFrom ? dateValue(query.dateFrom, 'dateFrom') : new Date(dateTo.getTime() - 30 * 24 * 60 * 60 * 1000)
  if (dateFrom >= dateTo) throw validationFailed('dateFrom must be before dateTo')
  if (dateTo.getTime() - dateFrom.getTime() > 366 * 24 * 60 * 60 * 1000) throw validationFailed('metrics window cannot exceed 366 days')
  return { dateFrom, dateTo }
}

export const parseRiskCaseTransition = (raw = {}) => {
  const allowed = ['toStatus', 'disposition', 'riskLevel', 'reasonCode', 'expectedVersion', 'restrictionSeconds', 'appealDecision']
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw validationFailed('payload must be an object')
  const unsupported = Object.keys(raw).filter((key) => !allowed.includes(key))
  if (unsupported.length) throw validationFailed(`payload contains unsupported fields: ${unsupported.join(', ')}`)
  return {
    toStatus: enumValue(raw.toStatus, 'toStatus', riskCaseStatuses),
    disposition: enumValue(raw.disposition, 'disposition', riskDispositions),
    riskLevel: enumValue(raw.riskLevel, 'riskLevel', riskLevels),
    reasonCode: stableText(raw.reasonCode, 'reasonCode'),
    expectedVersion: boundedInteger(raw.expectedVersion, 'expectedVersion', 1, 2_147_483_647),
    restrictionSeconds: raw.restrictionSeconds == null ? null : boundedInteger(raw.restrictionSeconds, 'restrictionSeconds', 60, 2_592_000),
    appealDecision: raw.appealDecision == null ? null : enumValue(raw.appealDecision, 'appealDecision', ['approved', 'rejected']),
  }
}

export const parseRiskAppealRequest = (raw = {}) => {
  const allowed = ['reasonCode', 'statement']
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw validationFailed('payload must be an object')
  const unsupported = Object.keys(raw).filter((key) => !allowed.includes(key))
  if (unsupported.length) throw validationFailed(`payload contains unsupported fields: ${unsupported.join(', ')}`)
  const statement = String(raw.statement ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (statement.length < 10 || statement.length > 2_000) throw validationFailed('statement must be between 10 and 2000 characters')
  return {
    reasonCode: stableText(raw.reasonCode, 'reasonCode'),
    statementHash: createHash('sha256').update(statement).digest('hex'),
    statementPreview: null,
  }
}

const transitionTargets = Object.freeze({
  open: ['restricted', 'closed'],
  restricted: ['appealed', 'recovered'],
  appealed: ['restricted', 'recovered'],
  recovered: ['restricted', 'closed'],
  closed: [],
})

export const assertRiskTransition = (current, transition) => {
  if (!current || !transitionTargets[current.status]?.includes(transition.toStatus)) {
    throw new HttpError(409, 'RISK_STATE_TRANSITION_INVALID', `Risk case cannot transition from ${current?.status ?? 'missing'} to ${transition.toStatus}`)
  }
  if (['recovered', 'closed'].includes(transition.toStatus) && transition.disposition !== 'cleared') {
    throw validationFailed('recovered and closed cases require the cleared disposition')
  }
  if (transition.toStatus === 'restricted' && !['generation_throttled', 'generation_blocked', 'account_restricted'].includes(transition.disposition)) {
    throw validationFailed('restricted cases require a blocking disposition')
  }
  if (transition.toStatus === 'appealed' && transition.disposition !== current.disposition) {
    throw validationFailed('appeal submission cannot change the active disposition')
  }
  return transition
}

export const serializeRiskPolicy = (policy = defaultRiskPolicy) => ({
  id: policy.id ?? 'default',
  enabled: Boolean(policy.enabled),
  generationWindowSeconds: Number(policy.generationWindowSeconds),
  generationCountThreshold: Number(policy.generationCountThreshold),
  safetyRejectionThreshold: Number(policy.safetyRejectionThreshold),
  generationCostMicrosThreshold: Number(policy.generationCostMicrosThreshold),
  restrictionSeconds: Number(policy.restrictionSeconds),
  version: Number(policy.version ?? 0),
  reasonCode: policy.reasonCode ?? 'risk_01_default',
  updatedByRef: policy.updatedByRef ?? 'system',
  createdAt: policy.createdAt ? new Date(policy.createdAt).toISOString() : null,
  updatedAt: policy.updatedAt ? new Date(policy.updatedAt).toISOString() : null,
})

export const serializeRiskSignal = (signal) => ({
  id: signal.id,
  signalType: signal.signalType,
  severity: signal.severity,
  score: signal.score,
  reasonCode: signal.reasonCode,
  sourceType: signal.sourceType,
  evidence: signal.evidence,
  occurredAt: new Date(signal.occurredAt).toISOString(),
})

export const serializeRiskAppeal = (appeal) => ({
  id: appeal.id,
  status: appeal.status,
  reasonCode: appeal.reasonCode,
  statementPreview: appeal.statementPreview ?? null,
  decisionReasonCode: appeal.decisionReasonCode ?? null,
  decidedAt: appeal.decidedAt ? new Date(appeal.decidedAt).toISOString() : null,
  createdAt: new Date(appeal.createdAt).toISOString(),
})

export const serializeRiskCase = (riskCase, { includeUser = false } = {}) => ({
  id: riskCase.id,
  status: riskCase.status,
  disposition: riskCase.disposition,
  riskLevel: riskCase.riskLevel,
  reasonCode: riskCase.reasonCode,
  version: riskCase.version,
  openedAt: new Date(riskCase.openedAt).toISOString(),
  expiresAt: riskCase.expiresAt ? new Date(riskCase.expiresAt).toISOString() : null,
  recoveredAt: riskCase.recoveredAt ? new Date(riskCase.recoveredAt).toISOString() : null,
  closedAt: riskCase.closedAt ? new Date(riskCase.closedAt).toISOString() : null,
  updatedAt: new Date(riskCase.updatedAt).toISOString(),
  ...(includeUser ? { user: riskCase.user ? { id: riskCase.user.id, handle: riskCase.user.profile?.handle ?? null, displayName: riskCase.user.displayName } : null } : {}),
  signals: (riskCase.signals ?? []).map((link) => serializeRiskSignal(link.signal ?? link)),
  appeals: (riskCase.appeals ?? []).map(serializeRiskAppeal),
  events: (riskCase.events ?? []).map((event) => ({
    id: event.id,
    fromStatus: event.fromStatus ?? null,
    toStatus: event.toStatus,
    disposition: event.disposition,
    reasonCode: event.reasonCode,
    actorType: event.actorType,
    createdAt: new Date(event.createdAt).toISOString(),
  })),
})

export const encodeRiskCursor = (riskCase) => Buffer.from(JSON.stringify({
  v: 1,
  updatedAt: new Date(riskCase.updatedAt).toISOString(),
  id: riskCase.id,
})).toString('base64url')

export const decodeRiskCursor = (cursor) => {
  if (!cursor) return null
  try {
    const decoded = Buffer.from(cursor, 'base64url')
    if (decoded.toString('base64url') !== cursor) throw new Error('non-canonical')
    const parsed = JSON.parse(decoded.toString('utf8'))
    if (parsed?.v !== 1 || typeof parsed.id !== 'string' || !Number.isFinite(new Date(parsed.updatedAt).getTime())) throw new Error('invalid')
    return parsed
  } catch {
    throw validationFailed('cursor is invalid for this query')
  }
}

export const riskBlockForCapability = (riskCase, capability, now = new Date()) => {
  if (!riskCase || !['restricted', 'appealed'].includes(riskCase.status)) return null
  if (riskCase.expiresAt && new Date(riskCase.expiresAt) <= now) return null
  if (riskCase.disposition === 'account_restricted') return { code: 'ACCOUNT_RISK_RESTRICTED', statusCode: 403 }
  if (capability === 'generation' && riskCase.disposition === 'generation_blocked') return { code: 'GENERATION_RISK_BLOCKED', statusCode: 403 }
  if (capability === 'generation' && riskCase.disposition === 'generation_throttled') return { code: 'GENERATION_RISK_THROTTLED', statusCode: 429 }
  return null
}
