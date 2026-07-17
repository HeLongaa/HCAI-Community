import { createHash, randomUUID } from 'node:crypto'

const DAY_MS = 24 * 60 * 60 * 1000
const sensitiveKeyPattern = /(authorization|cookie|credential|password|secret|token|api.?key|private.?key|signature|prompt|provider(?:.?id)?|storage.?key|object.?ref|url|uri)/i
const metadataSensitiveKeyPattern = /(authorization|cookie|credential|password|secret|token|api.?key|private.?key|raw.?prompt|provider.?id)/i
const urlPattern = /(?:https?:\/\/|s3:\/\/|gs:\/\/|file:\/\/)[^\s]+/gi

const boundedInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback
}

const enabled = (value, fallback) => {
  if (value == null || value === '') return fallback
  return String(value).trim().toLowerCase() === 'true'
}

export const buildAuditRetentionPolicy = (source = process.env) => {
  const retentionDays = boundedInteger(source.AUDIT_RETENTION_DAYS, 730, 30, 3650)
  const batchSize = boundedInteger(source.AUDIT_RETENTION_BATCH_SIZE, 100, 1, 1000)
  const minimumRetainedEvents = boundedInteger(source.AUDIT_RETENTION_MIN_RETAINED, 1000, 1, 100000)
  const legalHold = enabled(source.AUDIT_RETENTION_LEGAL_HOLD, true)
  const pruneEnabled = enabled(source.AUDIT_RETENTION_PRUNE_ENABLED, false)
  return Object.freeze({
    schema: 'audit.retention-policy.v1',
    version: `audit-retention-v1-${retentionDays}d`,
    retentionDays,
    batchSize,
    minimumRetainedEvents,
    legalHold,
    pruneEnabled,
    executable: pruneEnabled && !legalHold,
  })
}

const safeScalar = (value) => {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value
  const text = String(value).replace(urlPattern, '<redacted-url>')
  return text.length <= 200 ? text : `${text.slice(0, 197)}...`
}

export const safeAuditValue = (value, options = {}, depth = 0) => {
  const maxDepth = options.maxDepth ?? 5
  const maxEntries = options.maxEntries ?? 50
  if (value == null || typeof value !== 'object') return safeScalar(value)
  if (depth >= maxDepth) return '<bounded>'
  if (Array.isArray(value)) {
    return value.slice(0, maxEntries).map((item) => safeAuditValue(item, options, depth + 1))
  }
  return Object.fromEntries(Object.entries(value).slice(0, maxEntries).map(([key, entry]) => [
    key,
    sensitiveKeyPattern.test(key) ? '<redacted>' : safeAuditValue(entry, options, depth + 1),
  ]))
}

export const safeAuditMetadata = (value, depth = 0) => {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return value.length <= 500 ? value : `${value.slice(0, 497)}...`
  if (depth >= 5) return '<bounded>'
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => safeAuditMetadata(item, depth + 1))
  return Object.fromEntries(Object.entries(value).slice(0, 50).map(([key, entry]) => [
    key,
    metadataSensitiveKeyPattern.test(key) && typeof entry !== 'boolean' ? '<redacted>' : safeAuditMetadata(entry, depth + 1),
  ]))
}

const isRecord = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value))

const flatten = (value, prefix = '', output = new Map(), depth = 0) => {
  if (!isRecord(value) || depth >= 3) {
    output.set(prefix || '$', safeAuditValue(value))
    return output
  }
  for (const [key, entry] of Object.entries(value).slice(0, 50)) {
    if (sensitiveKeyPattern.test(key)) continue
    const path = prefix ? `${prefix}.${key}` : key
    if (isRecord(entry)) flatten(entry, path, output, depth + 1)
    else output.set(path, safeAuditValue(entry))
  }
  return output
}

export const projectAuditDiff = (metadata) => {
  if (!isRecord(metadata)) return null
  const before = metadata.previous ?? metadata.before ?? null
  const after = metadata.next ?? metadata.after ?? null
  if (isRecord(before) || isRecord(after)) {
    const left = flatten(before ?? {})
    const right = flatten(after ?? {})
    const paths = [...new Set([...left.keys(), ...right.keys()])].sort().slice(0, 50)
    const changes = paths
      .filter((path) => JSON.stringify(left.get(path)) !== JSON.stringify(right.get(path)))
      .map((path) => ({ path, before: left.get(path) ?? null, after: right.get(path) ?? null }))
    return changes.length ? { source: metadata.previous !== undefined ? 'previous_next' : 'before_after', changes } : null
  }
  if (metadata.diff != null) {
    return { source: 'explicit', value: safeAuditValue(metadata.diff) }
  }
  return null
}

const previewHash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

const eventSequence = (event) => Number(event.sequence ?? event.integrity?.sequence)

export const buildAuditRetentionPreview = ({ events, policy, now = new Date() }) => {
  const ordered = [...events].sort((left, right) => eventSequence(left) - eventSequence(right))
  const cutoff = new Date(now.getTime() - policy.retentionDays * DAY_MS)
  cutoff.setUTCHours(0, 0, 0, 0)
  const cutoffAt = cutoff.toISOString()
  const maximumCandidates = Math.max(0, ordered.length - policy.minimumRetainedEvents)
  const candidates = []
  for (const event of ordered) {
    if (candidates.length >= Math.min(policy.batchSize, maximumCandidates)) break
    if (Date.parse(event.createdAt) >= Date.parse(cutoffAt)) break
    candidates.push(event)
  }
  const first = candidates[0] ?? null
  const last = candidates.at(-1) ?? null
  const snapshot = {
    policyVersion: policy.version,
    cutoffAt,
    totalEvents: ordered.length,
    candidateCount: candidates.length,
    fromSequence: first ? String(eventSequence(first)) : null,
    toSequence: last ? String(eventSequence(last)) : null,
    rootHash: last?.contentHash ?? last?.integrity?.contentHash ?? null,
    currentRootHash: ordered.at(-1)?.contentHash ?? ordered.at(-1)?.integrity?.contentHash ?? null,
  }
  const previewId = previewHash(snapshot)
  const confirmation = candidates.length ? `PRUNE ${candidates.length} EVENTS THROUGH ${snapshot.toSequence}` : null
  return {
    preview: {
      schema: 'audit.retention-preview.v1',
      previewId,
      ...snapshot,
      legalHold: policy.legalHold,
      pruneEnabled: policy.pruneEnabled,
      executable: policy.executable && candidates.length > 0,
      confirmation,
    },
    candidates,
  }
}

export const buildAuditRetentionArtifact = ({ preview, candidates, exportedAt = new Date().toISOString() }) => ({
  schema: 'audit.retention-archive.v1',
  exportedAt,
  preview: {
    previewId: preview.previewId,
    policyVersion: preview.policyVersion,
    cutoffAt: preview.cutoffAt,
    fromSequence: preview.fromSequence,
    toSequence: preview.toSequence,
    eventCount: preview.candidateCount,
    rootHash: preview.rootHash,
  },
  events: candidates.map((event) => ({
    id: String(event.id),
    actorType: event.actorType,
    actorId: event.actorId ?? null,
    action: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId ?? null,
    metadata: event.metadata ?? null,
    metadataSchemaVersion: event.metadataSchemaVersion ?? 1,
    createdAt: event.createdAt?.toISOString?.() ?? event.createdAt,
    sequence: String(event.sequence ?? event.integrity?.sequence),
    previousHash: event.previousHash ?? event.integrity?.previousHash ?? null,
    contentHash: event.contentHash ?? event.integrity?.contentHash,
    chainVersion: event.chainVersion ?? event.integrity?.chainVersion ?? 1,
  })),
})

export const createRetentionDispositionId = () => `audit-retention-${randomUUID()}`
