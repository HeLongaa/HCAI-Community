import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { validationFailed } from '../common/http/validation.js'
import { sanitizeLogPayload } from './structuredLogging.js'

export const observabilityLevels = Object.freeze(['debug', 'info', 'warn', 'error'])
export const observabilityOutcomes = Object.freeze(['success', 'client_error', 'server_error'])
export const observabilityAlertStates = Object.freeze(['firing', 'acknowledged', 'silenced', 'resolved'])
export const observabilityRetentionDays = 30
export const observabilityPageLimit = 100
export const observabilityExportLimit = 1000
export const observabilitySloIds = Object.freeze(['api-availability', 'api-latency'])

export const defaultObservabilitySloControls = Object.freeze([
  Object.freeze({ sloId: 'api-availability', target: 0.999, shortWindowBurnThreshold: 14.4, longWindowBurnThreshold: 6, latencyThresholdMs: 750, severity: 'critical', owner: 'platform-operations', runbook: 'docs/OBSERVABILITY_INCIDENT_RESPONSE.md', primaryOnCallHandle: 'opsplus', secondaryOnCallHandle: 'legalpixel', escalationMinutes: 15, enabled: true, version: 0, reasonCode: 'contract_default' }),
  Object.freeze({ sloId: 'api-latency', target: 0.99, shortWindowBurnThreshold: 14.4, longWindowBurnThreshold: 6, latencyThresholdMs: 750, severity: 'critical', owner: 'platform-operations', runbook: 'docs/OBSERVABILITY_INCIDENT_RESPONSE.md', primaryOnCallHandle: 'opsplus', secondaryOnCallHandle: 'legalpixel', escalationMinutes: 15, enabled: true, version: 0, reasonCode: 'contract_default' }),
])

const safeIdentifierPattern = /^[a-z0-9][a-z0-9:._/-]{0,191}$/i
const traceIdPattern = /^[a-f0-9]{32}$/
const spanIdPattern = /^[a-f0-9]{16}$/

const safeIdentifier = (value, fallback = null) => {
  const normalized = String(value ?? '').trim()
  return normalized && safeIdentifierPattern.test(normalized) ? normalized : fallback
}

const parseDate = (value, name) => {
  if (value == null || value === '') return null
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) throw validationFailed(`${name} must be an ISO-8601 timestamp`)
  return date
}

const parseLimit = (value, maximum = observabilityPageLimit, defaultValue = 20) => {
  if (value == null || value === '') return Math.min(defaultValue, maximum)
  const limit = Number.parseInt(String(value), 10)
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) throw validationFailed(`limit must be an integer between 1 and ${maximum}`)
  return limit
}

export const parseObservabilityQuery = (query = {}, { exportMode = false } = {}) => {
  const dateFrom = parseDate(query.dateFrom, 'dateFrom')
  const dateTo = parseDate(query.dateTo, 'dateTo')
  const now = new Date()
  const earliest = new Date(now.getTime() - observabilityRetentionDays * 24 * 60 * 60 * 1000)
  const from = dateFrom ?? earliest
  const to = dateTo ?? now
  if (from > to) throw validationFailed('dateFrom must be before dateTo')
  if (to.getTime() - from.getTime() > observabilityRetentionDays * 24 * 60 * 60 * 1000) throw validationFailed(`date range cannot exceed ${observabilityRetentionDays} days`)
  const level = query.level ? String(query.level) : null
  const outcome = query.outcome ? String(query.outcome) : null
  if (level && !observabilityLevels.includes(level)) throw validationFailed(`level must be one of: ${observabilityLevels.join(', ')}`)
  if (outcome && !observabilityOutcomes.includes(outcome)) throw validationFailed(`outcome must be one of: ${observabilityOutcomes.join(', ')}`)
  const traceId = query.traceId ? String(query.traceId).toLowerCase() : null
  if (traceId && !traceIdPattern.test(traceId)) throw validationFailed('traceId must be 32 lowercase hexadecimal characters')
  return {
    level,
    service: safeIdentifier(query.service),
    module: safeIdentifier(query.module),
    operation: safeIdentifier(query.operation),
    outcome,
    errorCode: safeIdentifier(query.errorCode),
    requestId: safeIdentifier(query.requestId),
    traceId,
    resourceType: safeIdentifier(query.resourceType),
    resourceId: safeIdentifier(query.resourceId),
    dateFrom: from,
    dateTo: to,
    cursor: query.cursor ? String(query.cursor) : null,
    limit: parseLimit(query.limit, exportMode ? observabilityExportLimit : observabilityPageLimit, exportMode ? observabilityExportLimit : 20),
  }
}

const moduleFromRoute = (routeTemplate = '') => {
  const parts = String(routeTemplate).split('/').filter(Boolean)
  if (parts[0] === 'api') parts.shift()
  if (parts[0] === 'admin') return parts[1] === 'observability' ? 'observability' : 'admin'
  return safeIdentifier(parts[0], 'platform')
}

const resourceFromRoute = (routeTemplate, params = {}) => {
  const id = params.id ?? params.traceId ?? null
  if (!id) return { resourceType: null, resourceId: null, jobId: null, eventId: null }
  const type = routeTemplate.includes('/jobs/') ? 'job_run'
    : routeTemplate.includes('/domain-events/') ? 'domain_event'
      : routeTemplate.includes('/audit/') ? 'audit_event'
        : safeIdentifier(routeTemplate.split('/:')[0].split('/').filter(Boolean).at(-1), 'resource')
  return {
    resourceType: type,
    resourceId: safeIdentifier(id),
    jobId: type === 'job_run' ? safeIdentifier(id) : null,
    eventId: type === 'domain_event' ? safeIdentifier(id) : null,
  }
}

export const buildHttpTelemetry = ({ request, response, correlation, routeTemplate = null, params = {}, startedAt, endedAt = new Date() }) => {
  const statusCode = Number(response.statusCode || 500)
  const outcome = statusCode >= 500 ? 'server_error' : statusCode >= 400 ? 'client_error' : 'success'
  const resource = resourceFromRoute(routeTemplate ?? '', params)
  const durationMs = Math.max(0, endedAt.getTime() - startedAt.getTime())
  const module = moduleFromRoute(routeTemplate)
  const operation = `${String(request.method ?? 'GET').toUpperCase()} ${routeTemplate ?? 'unmatched'}`
  const errorCode = statusCode >= 500 ? 'INTERNAL_ERROR' : statusCode >= 400 ? `HTTP_${statusCode}` : null
  const traceId = traceIdPattern.test(String(correlation.traceId ?? '')) ? correlation.traceId : randomBytes(16).toString('hex')
  const spanId = spanIdPattern.test(String(correlation.spanId ?? '')) ? correlation.spanId : randomBytes(8).toString('hex')
  const log = sanitizeLogPayload({
    id: `obs-log-${randomUUID()}`,
    timestamp: endedAt,
    level: statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info',
    service: 'newchat-api',
    environment: process.env.NODE_ENV ?? 'development',
    event: 'http.request.completed',
    requestId: correlation.requestId,
    traceId,
    spanId,
    parentSpanId: correlation.parentSpanId ?? null,
    module,
    operation,
    outcome,
    durationMs,
    errorCode,
    method: request.method ?? null,
    routeTemplate: routeTemplate ?? null,
    statusCode,
    resourceType: resource.resourceType,
    resourceId: resource.resourceId,
    attributes: { statusClass: `${Math.floor(statusCode / 100)}xx`, sampled: Boolean(correlation.sampled) },
  })
  const span = {
    id: `trace-span-${randomUUID()}`,
    traceId,
    spanId,
    parentSpanId: correlation.parentSpanId ?? null,
    requestId: correlation.requestId,
    service: log.service,
    module,
    operation,
    outcome,
    startedAt,
    endedAt,
    durationMs,
    errorCode,
    resourceType: resource.resourceType,
    resourceId: resource.resourceId,
    jobId: resource.jobId,
    eventId: resource.eventId,
  }
  return { log, span }
}

const statsForWindow = (logs, since, { latencyThresholdMs = 750 } = {}) => {
  const eligible = logs.filter((item) => new Date(item.timestamp) >= since && item.event === 'http.request.completed')
  const serverErrors = eligible.filter((item) => Number(item.statusCode) >= 500).length
  const latencyEligible = eligible.filter((item) => Number(item.statusCode) < 500)
  const latencyViolations = latencyEligible.filter((item) => Number(item.durationMs) > latencyThresholdMs).length
  return {
    requests: eligible.length,
    availability: eligible.length ? 1 - serverErrors / eligible.length : null,
    serverErrors,
    latencyEligible: latencyEligible.length,
    latencyWithinTarget: latencyEligible.length ? 1 - latencyViolations / latencyEligible.length : null,
    latencyViolations,
  }
}

const burnRate = (actual, target) => actual == null ? 0 : Math.max(0, (1 - actual) / (1 - target))

export const buildSloSummary = (logs, now = new Date(), controls = defaultObservabilitySloControls) => {
  const activeControls = controls.filter((item) => item.enabled !== false && observabilitySloIds.includes(item.sloId))
  const latencyThresholdMs = activeControls.find((item) => item.sloId === 'api-latency')?.latencyThresholdMs ?? 750
  const windows = {
    fiveMinutes: statsForWindow(logs, new Date(now.getTime() - 5 * 60 * 1000), { latencyThresholdMs }),
    sixtyMinutes: statsForWindow(logs, new Date(now.getTime() - 60 * 60 * 1000), { latencyThresholdMs }),
    thirtyDays: statsForWindow(logs, new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), { latencyThresholdMs }),
  }
  const definitions = activeControls.map((control) => ({
    ...control,
    id: control.sloId,
    selector: control.sloId === 'api-availability' ? (stats) => stats.availability : (stats) => stats.latencyWithinTarget,
  }))
  const slos = definitions.map((definition) => {
    const shortWindowBurn = burnRate(definition.selector(windows.fiveMinutes), definition.target)
    const longWindowBurn = burnRate(definition.selector(windows.sixtyMinutes), definition.target)
    return {
      id: definition.id,
      target: definition.target,
      shortWindowBurn,
      longWindowBurn,
      firing: windows.sixtyMinutes.requests > 0 && shortWindowBurn >= definition.shortWindowBurnThreshold && longWindowBurn >= definition.longWindowBurnThreshold,
      current: definition.selector(windows.thirtyDays),
      severity: definition.severity,
      owner: definition.owner,
      runbook: definition.runbook,
      primaryOnCallHandle: definition.primaryOnCallHandle,
      secondaryOnCallHandle: definition.secondaryOnCallHandle ?? null,
      escalationMinutes: definition.escalationMinutes,
      controlVersion: definition.version,
      shortWindowBurnThreshold: definition.shortWindowBurnThreshold,
      longWindowBurnThreshold: definition.longWindowBurnThreshold,
    }
  })
  return { generatedAt: now.toISOString(), windows, slos }
}

const canonical = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

export const buildObservabilityExport = ({ logs, query, exportedAt = new Date().toISOString() }) => {
  const records = logs.map((log) => sanitizeLogPayload(log))
  const manifest = {
    schema: 'observability.log-export.v1',
    exportedAt,
    query: { ...query, dateFrom: query.dateFrom.toISOString(), dateTo: query.dateTo.toISOString(), cursor: null },
    count: records.length,
    contentHash: sha256(JSON.stringify(records)),
  }
  return { manifest: { ...manifest, manifestHash: sha256(canonical(manifest)) }, logs: records }
}

export const verifyObservabilityExport = (artifact) => {
  const logs = Array.isArray(artifact?.logs) ? artifact.logs : []
  const { manifestHash, ...manifest } = artifact?.manifest ?? {}
  const failures = []
  if (manifest.schema !== 'observability.log-export.v1') failures.push('schema_mismatch')
  if (manifest.count !== logs.length) failures.push('count_mismatch')
  if (manifest.contentHash !== sha256(JSON.stringify(logs))) failures.push('content_hash_mismatch')
  if (manifestHash !== sha256(canonical(manifest))) failures.push('manifest_hash_mismatch')
  return { verified: failures.length === 0, status: failures.length ? 'broken' : 'complete', count: logs.length, failures }
}

export const parseAlertAction = (payload = {}) => {
  const expectedVersion = Number.parseInt(String(payload.expectedVersion ?? ''), 10)
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw validationFailed('expectedVersion must be a positive integer')
  const note = String(payload.note ?? '').trim()
  if (note.length > 500) throw validationFailed('note cannot exceed 500 characters')
  const until = payload.until ? parseDate(payload.until, 'until') : null
  if (until && (until <= new Date() || until.getTime() > Date.now() + 7 * 24 * 60 * 60 * 1000)) throw validationFailed('until must be in the future and within 7 days')
  return { expectedVersion, note, until }
}

const boundedText = (value, name, minimum, maximum) => {
  const normalized = String(value ?? '').trim()
  if (normalized.length < minimum || normalized.length > maximum) throw validationFailed(`${name} must contain between ${minimum} and ${maximum} characters`)
  if (/[\u0000-\u001f\u007f]/.test(normalized)) throw validationFailed(`${name} contains invalid characters`)
  return normalized
}

const stableReason = (value) => {
  const reasonCode = boundedText(value, 'reasonCode', 1, 80)
  if (!/^[a-z0-9][a-z0-9._:-]{0,79}$/.test(reasonCode)) throw validationFailed('reasonCode must be a stable lowercase identifier')
  return reasonCode
}

const boundedNumber = (value, name, minimum, maximum) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) throw validationFailed(`${name} must be between ${minimum} and ${maximum}`)
  return parsed
}

export const parseSloControlRequest = (sloId, payload = {}) => {
  if (!observabilitySloIds.includes(sloId)) throw validationFailed(`sloId must be one of: ${observabilitySloIds.join(', ')}`)
  const expectedVersion = Number(payload.expectedVersion)
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw validationFailed('expectedVersion must be a non-negative integer')
  const handle = (value, name, optional = false) => {
    if (optional && (value == null || value === '')) return null
    const normalized = boundedText(value, name, 2, 32).toLowerCase()
    if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(normalized)) throw validationFailed(`${name} must be a valid account handle`)
    return normalized
  }
  const severity = String(payload.severity ?? '')
  if (!['warning', 'high', 'critical'].includes(severity)) throw validationFailed('severity is invalid')
  if (typeof payload.enabled !== 'boolean') throw validationFailed('enabled must be a boolean')
  return {
    sloId,
    target: boundedNumber(payload.target, 'target', 0.9, 0.99999),
    shortWindowBurnThreshold: boundedNumber(payload.shortWindowBurnThreshold, 'shortWindowBurnThreshold', 0.1, 1000),
    longWindowBurnThreshold: boundedNumber(payload.longWindowBurnThreshold, 'longWindowBurnThreshold', 0.1, 1000),
    latencyThresholdMs: Math.trunc(boundedNumber(payload.latencyThresholdMs, 'latencyThresholdMs', 1, 60_000)),
    severity,
    owner: boundedText(payload.owner, 'owner', 2, 120),
    runbook: boundedText(payload.runbook, 'runbook', 2, 240),
    primaryOnCallHandle: handle(payload.primaryOnCallHandle, 'primaryOnCallHandle'),
    secondaryOnCallHandle: handle(payload.secondaryOnCallHandle, 'secondaryOnCallHandle', true),
    escalationMinutes: Math.trunc(boundedNumber(payload.escalationMinutes, 'escalationMinutes', 1, 1440)),
    enabled: payload.enabled,
    expectedVersion,
    reasonCode: stableReason(payload.reasonCode),
  }
}

export const parseAlertEscalationRequest = (payload = {}) => {
  const expectedVersion = Number(payload.expectedVersion)
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw validationFailed('expectedVersion must be a positive integer')
  return { expectedVersion, reasonCode: stableReason(payload.reasonCode) }
}

export const parseIncidentReviewRequest = (payload = {}) => {
  if (Number(payload.expectedVersion) < 1 || !Number.isSafeInteger(Number(payload.expectedVersion))) throw validationFailed('expectedVersion must be a positive integer')
  if (!Array.isArray(payload.correctiveActions) || payload.correctiveActions.length < 1 || payload.correctiveActions.length > 20) throw validationFailed('correctiveActions must contain between 1 and 20 entries')
  const correctiveActions = payload.correctiveActions.map((item, index) => boundedText(item, `correctiveActions[${index}]`, 3, 240))
  return {
    expectedVersion: Number(payload.expectedVersion),
    summary: boundedText(payload.summary, 'summary', 10, 1000),
    rootCause: boundedText(payload.rootCause, 'rootCause', 10, 2000),
    impact: boundedText(payload.impact, 'impact', 10, 2000),
    correctiveActions,
    reasonCode: stableReason(payload.reasonCode),
  }
}

export const buildIncidentMetrics = (alerts = [], events = [], reviews = [], now = new Date()) => {
  const active = alerts.filter((item) => item.state !== 'resolved')
  const durationMinutes = (from, to) => Math.max(0, (new Date(to).getTime() - new Date(from).getTime()) / 60_000)
  const acknowledged = alerts.filter((item) => item.acknowledgedAt)
  const resolved = alerts.filter((item) => item.resolvedAt)
  const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
  return {
    generatedAt: now.toISOString(),
    total: alerts.length,
    active: active.length,
    criticalActive: active.filter((item) => item.severity === 'critical').length,
    acknowledged: active.filter((item) => item.state === 'acknowledged').length,
    silenced: active.filter((item) => item.state === 'silenced').length,
    escalated: active.filter((item) => Number(item.escalationLevel) > 0).length,
    reviewCoverage: resolved.length ? reviews.length / resolved.length : null,
    meanTimeToAcknowledgeMinutes: average(acknowledged.map((item) => durationMinutes(item.startedAt, item.acknowledgedAt))),
    meanTimeToRecoveryMinutes: average(resolved.map((item) => durationMinutes(item.startedAt, item.resolvedAt))),
    eventCount: events.length,
  }
}
