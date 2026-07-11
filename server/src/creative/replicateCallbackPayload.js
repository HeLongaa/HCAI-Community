import { HttpError } from '../common/errors/httpError.js'

const allowedPayloadKeys = new Set([
  'id',
  'status',
  'output',
  'error',
  'logs',
  'metrics',
  'created_at',
  'started_at',
  'completed_at',
  'event_id',
  'cost_usd',
])

const allowedMetricKeys = new Set(['predict_time', 'total_time'])
const supportedStatuses = new Set(['starting', 'processing', 'succeeded', 'failed', 'canceled', 'cancelled'])
const safeIdentifierPattern = /^[a-z0-9][a-z0-9:_-]{0,127}$/i
const maxTextCharacters = 4096
const maxOutputCount = 8

const payloadError = (reasonCode, details = {}) =>
  new HttpError(400, 'CREATIVE_PROVIDER_CALLBACK_PAYLOAD_INVALID', 'Invalid creative provider callback payload', {
    reasonCode,
    ...details,
  })

const optionalText = (value, field) => {
  if (value == null) return null
  if (typeof value !== 'string' || value.length > maxTextCharacters) {
    throw payloadError('field_invalid', { field })
  }
  return value
}

const optionalTimestamp = (value, field) => {
  if (value == null) return null
  if (typeof value !== 'string' || value.length > 64 || Number.isNaN(Date.parse(value))) {
    throw payloadError('timestamp_invalid', { field })
  }
  return value
}

const normalizeOutputs = (value, status) => {
  if (value == null) {
    if (status === 'succeeded') {
      throw payloadError('completed_output_missing')
    }
    return []
  }
  const outputs = Array.isArray(value) ? value : [value]
  if (outputs.length === 0 || outputs.length > maxOutputCount) {
    throw payloadError('output_count_invalid', { outputCount: outputs.length })
  }
  return outputs.map((output) => {
    if (typeof output !== 'string' || output.length > 2048) {
      throw payloadError('output_invalid')
    }
    try {
      const url = new URL(output)
      if (url.protocol !== 'https:') throw new Error('unsupported protocol')
      return url.toString()
    } catch {
      throw payloadError('output_invalid')
    }
  })
}

const normalizeMetrics = (value) => {
  if (value == null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw payloadError('metrics_invalid')
  }
  const unknownMetricCount = Object.keys(value).filter((key) => !allowedMetricKeys.has(key)).length
  if (unknownMetricCount > 0) {
    throw payloadError('metrics_field_unsupported', { unknownMetricCount })
  }
  const metrics = {}
  for (const key of allowedMetricKeys) {
    if (value[key] == null) continue
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0) {
      throw payloadError('metrics_value_invalid', { field: key })
    }
    metrics[key] = value[key]
  }
  return metrics
}

const optionalAmount = (value) => {
  if (value == null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw payloadError('cost_invalid')
  }
  return value
}

export const parseReplicateCallbackPayload = (payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw payloadError('object_required')
  }

  const unknownFieldCount = Object.keys(payload).filter((key) => !allowedPayloadKeys.has(key)).length
  if (unknownFieldCount > 0) {
    throw payloadError('field_unsupported', { unknownFieldCount })
  }

  const id = String(payload.id ?? '').trim()
  if (!safeIdentifierPattern.test(id)) {
    throw payloadError('provider_job_id_invalid')
  }
  const status = String(payload.status ?? '').trim().toLowerCase()
  if (!supportedStatuses.has(status)) {
    throw payloadError('status_unsupported')
  }
  const eventId = payload.event_id == null ? null : String(payload.event_id).trim()
  if (eventId && !safeIdentifierPattern.test(eventId)) {
    throw payloadError('provider_event_id_invalid')
  }

  return {
    id,
    status,
    output: normalizeOutputs(payload.output, status),
    error: optionalText(payload.error, 'error'),
    logs: optionalText(payload.logs, 'logs'),
    metrics: normalizeMetrics(payload.metrics),
    created_at: optionalTimestamp(payload.created_at, 'created_at'),
    started_at: optionalTimestamp(payload.started_at, 'started_at'),
    completed_at: optionalTimestamp(payload.completed_at, 'completed_at'),
    eventId,
    costUsd: optionalAmount(payload.cost_usd),
  }
}
