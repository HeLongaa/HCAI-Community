import { createHash } from 'node:crypto'
import { hasPermission } from '../auth/permissions.js'
import { HttpError } from '../common/errors/httpError.js'
import {
  optionalText,
  requireOneOf,
  requireText,
  validationFailed,
} from '../common/http/validation.js'
import { terminalGenerationStatuses } from './providerLifecycleReplay.js'

const supportedManualReplayStatuses = ['queued', 'running', 'completed', 'failed', 'cancelled']
const requiredManualReplayPermissions = ['admin:audit:read', 'admin:queue:review']
const unsafeManualReplayFields = [
  'output',
  'outputs',
  'payload',
  'prompt',
  'providerPayload',
  'providerResponse',
  'rawPayload',
  'rawPrompt',
]

const stableHash = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')

const providerIdFor = (record) => record?.providerId ?? record?.provider?.id ?? null
const providerModeFor = (record) => record?.providerMode ?? record?.provider?.mode ?? null

const redactPreview = (value, maxLength = 160) =>
  String(value ?? '')
    .replace(/(bearer\s+)[^\s]+/gi, '$1[redacted]')
    .replace(/(api[_-]?key=)[^\s&]+/gi, '$1[redacted]')
    .replace(/(token=)[^\s&]+/gi, '$1[redacted]')
    .slice(0, maxLength)

const requireSafeIdentifier = (body, field, options = {}) => {
  const value = requireText(body, field)
  const maxLength = options.maxLength ?? 160
  if (value.length > maxLength || !/^[a-zA-Z0-9:_.-]+$/.test(value)) {
    throw validationFailed(`${field} must be ${maxLength} or fewer safe identifier characters`)
  }
  return value
}

const optionalIsoText = (body, field) => {
  const value = optionalText(body, field, null)
  if (value == null) {
    return null
  }
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    throw validationFailed(`${field} must be an ISO timestamp`)
  }
  return new Date(timestamp).toISOString()
}

const rejectUnsafeManualReplayFields = (body = {}) => {
  const present = unsafeManualReplayFields.filter((field) => body[field] != null)
  if (present.length > 0) {
    throw validationFailed(`manual replay request cannot include unsafe provider fields: ${present.join(', ')}`)
  }
}

export const authorizeManualProviderReplay = (actor) => {
  if (!actor) {
    throw new HttpError(401, 'AUTH_REQUIRED', 'Authentication is required')
  }
  const missing = requiredManualReplayPermissions.filter((permission) => !hasPermission(actor, permission))
  if (missing.length > 0) {
    throw new HttpError(403, 'PERMISSION_DENIED', `Missing permission: ${missing[0]}`, {
      missingPermissions: missing,
      requiredPermissions: requiredManualReplayPermissions,
      reasonCode: 'manual_replay_permission_denied',
    })
  }
  return actor
}

export const parseManualProviderReplayRequest = (body = {}) => {
  rejectUnsafeManualReplayFields(body)
  const reasonCode = requireSafeIdentifier(body, 'reasonCode', { maxLength: 64 })
  const note = optionalText(body, 'note', '')
  if (note.length > 500) {
    throw validationFailed('note must be 500 characters or fewer')
  }
  const parsed = {
    sourceType: 'manual_replay',
    generationId: requireSafeIdentifier(body, 'generationId'),
    providerId: requireSafeIdentifier(body, 'providerId', { maxLength: 64 }),
    providerMode: requireSafeIdentifier(body, 'providerMode', { maxLength: 64 }),
    providerJobId: requireSafeIdentifier(body, 'providerJobId'),
    normalizedStatus: requireOneOf(body, 'normalizedStatus', supportedManualReplayStatuses),
    reasonCode,
    providerEventId: optionalText(body, 'providerEventId', null),
    occurredAt: optionalIsoText(body, 'occurredAt'),
    idempotencyKey: optionalText(body, 'idempotencyKey', null),
    notePreview: redactPreview(note),
  }
  if (parsed.idempotencyKey && (parsed.idempotencyKey.length > 220 || !/^[a-zA-Z0-9:_.-]+$/.test(parsed.idempotencyKey))) {
    throw validationFailed('idempotencyKey must be 220 or fewer safe identifier characters')
  }
  return {
    ...parsed,
    payloadHash: stableHash({
      sourceType: parsed.sourceType,
      generationId: parsed.generationId,
      providerId: parsed.providerId,
      providerMode: parsed.providerMode,
      providerJobId: parsed.providerJobId,
      normalizedStatus: parsed.normalizedStatus,
      reasonCode: parsed.reasonCode,
      providerEventId: parsed.providerEventId,
      occurredAt: parsed.occurredAt,
    }),
    idempotencyKey: parsed.idempotencyKey ?? [
      'manual-replay',
      parsed.providerId,
      parsed.providerJobId,
      parsed.normalizedStatus,
      parsed.reasonCode,
    ].join(':'),
  }
}

export const buildManualProviderReplayEnvelope = ({
  body,
  currentRecord,
  actor,
  now = new Date(),
} = {}) => {
  const authorizedActor = authorizeManualProviderReplay(actor)
  const request = parseManualProviderReplayRequest(body)

  if (!currentRecord) {
    throw new HttpError(404, 'CREATIVE_PROVIDER_GENERATION_NOT_FOUND', 'Manual provider replay target generation was not found', {
      generationId: request.generationId,
      reasonCode: 'generation_missing',
    })
  }
  if (String(currentRecord.id ?? '') !== request.generationId) {
    throw new HttpError(409, 'CREATIVE_PROVIDER_GENERATION_MISMATCH', 'Manual provider replay targeted a different generation', {
      currentGenerationId: currentRecord.id ?? null,
      incomingGenerationId: request.generationId,
      reasonCode: 'generation_mismatch',
    })
  }
  if (providerIdFor(currentRecord) && providerIdFor(currentRecord) !== request.providerId) {
    throw new HttpError(409, 'CREATIVE_PROVIDER_MISMATCH', 'Manual provider replay targeted a different provider', {
      currentProviderId: providerIdFor(currentRecord),
      incomingProviderId: request.providerId,
      reasonCode: 'provider_mismatch',
    })
  }
  if (providerModeFor(currentRecord) && providerModeFor(currentRecord) !== request.providerMode) {
    throw new HttpError(409, 'CREATIVE_PROVIDER_MODE_MISMATCH', 'Manual provider replay targeted a different provider mode', {
      currentProviderMode: providerModeFor(currentRecord),
      incomingProviderMode: request.providerMode,
      reasonCode: 'provider_mode_mismatch',
    })
  }
  if (currentRecord.providerJobId && currentRecord.providerJobId !== request.providerJobId) {
    throw new HttpError(409, 'CREATIVE_PROVIDER_JOB_MISMATCH', 'Manual provider replay targeted a different provider job', {
      currentProviderJobId: currentRecord.providerJobId,
      incomingProviderJobId: request.providerJobId,
      providerId: request.providerId,
      reasonCode: 'provider_job_mismatch',
    })
  }
  if (terminalGenerationStatuses.includes(currentRecord.status) && currentRecord.status !== request.normalizedStatus) {
    throw new HttpError(409, 'CREATIVE_PROVIDER_TERMINAL_REPLAY_REJECTED', 'Manual provider replay cannot reopen terminal generation state', {
      currentStatus: currentRecord.status,
      incomingStatus: request.normalizedStatus,
      reasonCode: 'terminal_reopen_rejected',
    })
  }

  return {
    ok: true,
    shouldReplay: true,
    sourceType: 'manual_replay',
    generationId: request.generationId,
    providerId: request.providerId,
    providerMode: request.providerMode,
    providerJobId: request.providerJobId,
    providerEventId: request.providerEventId,
    providerStatus: request.normalizedStatus,
    normalizedStatus: request.normalizedStatus,
    occurredAt: request.occurredAt,
    receivedAt: now.toISOString(),
    idempotencyKey: request.idempotencyKey,
    payloadHash: request.payloadHash,
    actor: {
      id: authorizedActor.id ?? null,
      handle: authorizedActor.handle ?? null,
    },
    safeMetadata: {
      reasonCode: request.reasonCode,
      notePreview: request.notePreview,
      currentStatus: currentRecord.status ?? null,
      terminalReplay: terminalGenerationStatuses.includes(currentRecord.status),
    },
  }
}
