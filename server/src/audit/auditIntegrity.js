import { createHash, randomUUID } from 'node:crypto'

export const AUDIT_CHAIN_VERSION = 1
export const AUDIT_GENESIS_HASH = null

const jsonKeyCompare = (left, right) => left.length - right.length || left.localeCompare(right)

export const canonicalJson = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value).sort(jsonKeyCompare).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

export const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex')

export const portableAuditEvent = (event) => ({
  id: String(event.id),
  actorType: event.actorType,
  actorId: event.actorId ?? null,
  action: event.action,
  resourceType: event.resourceType,
  resourceId: event.resourceId ?? null,
  metadata: event.metadata ?? null,
  createdAt: event.createdAt,
})

export const buildPortableAuditExport = ({ events, query = {}, exportedAt = new Date().toISOString() }) => {
  let previousHash = AUDIT_GENESIS_HASH
  const chainedEvents = events.map((event, index) => {
    const content = portableAuditEvent(event)
    const sequence = index + 1
    const eventPreviousHash = previousHash
    const contentHash = sha256(canonicalJson({ chainVersion: AUDIT_CHAIN_VERSION, sequence, previousHash: eventPreviousHash, event: content }))
    previousHash = contentHash
    return { ...content, sequence, previousHash: eventPreviousHash, contentHash }
  })
  const manifest = {
    schema: 'audit.portable-export.v1',
    chainVersion: AUDIT_CHAIN_VERSION,
    exportedAt,
    query: {
      action: query.action ?? null,
      resourceType: query.resourceType ?? null,
      resourceId: query.resourceId ?? null,
      actorType: query.actorType ?? null,
      actorId: query.actorId ?? null,
      dateFrom: query.dateFrom ?? null,
      dateTo: query.dateTo ?? null,
      direction: query.direction ?? 'desc',
      limit: query.limit ?? events.length,
    },
    count: chainedEvents.length,
    firstEventId: chainedEvents[0]?.id ?? null,
    lastEventId: chainedEvents.at(-1)?.id ?? null,
    rootHash: chainedEvents.at(-1)?.contentHash ?? sha256('audit.portable-export.v1:empty'),
  }
  manifest.manifestHash = sha256(canonicalJson(manifest))
  return {
    manifest,
    exportedAt: manifest.exportedAt,
    query: manifest.query,
    count: manifest.count,
    events: chainedEvents,
  }
}

export const verifyPortableAuditExport = (artifact) => {
  const failures = []
  const events = Array.isArray(artifact?.events) ? artifact.events : []
  let previousHash = AUDIT_GENESIS_HASH
  for (let index = 0; index < events.length; index += 1) {
    const item = events[index]
    const expectedSequence = index + 1
    if (item.sequence !== expectedSequence) failures.push({ sequence: expectedSequence, reason: 'sequence_mismatch' })
    if ((item.previousHash ?? null) !== previousHash) failures.push({ sequence: expectedSequence, reason: 'previous_hash_mismatch' })
    const expectedHash = sha256(canonicalJson({
      chainVersion: AUDIT_CHAIN_VERSION,
      sequence: expectedSequence,
      previousHash,
      event: portableAuditEvent(item ?? {}),
    }))
    if (item.contentHash !== expectedHash) failures.push({ sequence: expectedSequence, reason: 'content_hash_mismatch' })
    previousHash = item.contentHash ?? null
  }
  if (artifact?.manifest?.count !== events.length) failures.push({ reason: 'count_mismatch' })
  const { manifestHash, ...manifestContent } = artifact?.manifest ?? {}
  if (manifestHash !== sha256(canonicalJson(manifestContent))) failures.push({ reason: 'manifest_hash_mismatch' })
  if (artifact?.manifest?.schema !== 'audit.portable-export.v1' || artifact?.manifest?.chainVersion !== AUDIT_CHAIN_VERSION) failures.push({ reason: 'manifest_version_mismatch' })
  if ((artifact?.manifest?.firstEventId ?? null) !== (events[0]?.id ?? null)) failures.push({ reason: 'first_event_mismatch' })
  if ((artifact?.manifest?.lastEventId ?? null) !== (events.at(-1)?.id ?? null)) failures.push({ reason: 'last_event_mismatch' })
  const expectedRoot = events.at(-1)?.contentHash ?? sha256('audit.portable-export.v1:empty')
  if (artifact?.manifest?.rootHash !== expectedRoot) failures.push({ reason: 'root_hash_mismatch' })
  return {
    status: failures.length === 0 ? 'complete' : 'broken',
    verified: failures.length === 0,
    count: events.length,
    rootHash: expectedRoot,
    failures,
  }
}

export const appendSeedAuditIntegrity = (event, previous = null) => {
  const sequence = Number(previous?.sequence ?? 0) + 1
  const previousHash = previous?.contentHash ?? AUDIT_GENESIS_HASH
  return {
    ...event,
    sequence,
    previousHash,
    chainVersion: AUDIT_CHAIN_VERSION,
    contentHash: sha256(canonicalJson({
      chainVersion: AUDIT_CHAIN_VERSION,
      sequence,
      previousHash,
      event: portableAuditEvent(event),
    })),
  }
}

export const verifySeedAuditChain = (events, options = {}) => {
  const ordered = [...events].sort((left, right) => Number(left.sequence) - Number(right.sequence))
  const failures = []
  const anchor = options.anchor ?? null
  let previousHash = anchor?.rootHash ?? AUDIT_GENESIS_HASH
  const firstExpectedSequence = Number(anchor?.toSequence ?? 0) + 1
  for (let index = 0; index < ordered.length; index += 1) {
    const event = ordered[index]
    const expectedSequence = firstExpectedSequence + index
    if (Number(event.sequence) !== expectedSequence) failures.push({ sequence: expectedSequence, reason: 'sequence_mismatch' })
    if ((event.previousHash ?? null) !== previousHash) failures.push({ sequence: expectedSequence, reason: 'previous_hash_mismatch' })
    const expectedHash = sha256(canonicalJson({
      chainVersion: AUDIT_CHAIN_VERSION,
      sequence: expectedSequence,
      previousHash,
      event: portableAuditEvent(event),
    }))
    if (event.contentHash !== expectedHash) failures.push({ sequence: expectedSequence, reason: 'content_hash_mismatch' })
    previousHash = event.contentHash
  }
  return {
    status: failures.length === 0 ? 'complete' : 'broken',
    verified: failures.length === 0,
    count: ordered.length,
    firstSequence: ordered[0]?.sequence ?? null,
    lastSequence: ordered.at(-1)?.sequence ?? null,
    rootHash: ordered.at(-1)?.contentHash ?? null,
    failures,
  }
}

export const createSeedArchiveManifest = ({ events, actor, objectRef = null, anchor = null }) => {
  const integrity = verifySeedAuditChain(events, { anchor })
  if (!integrity.verified) return { integrity, manifest: null }
  const id = `audit-archive-${randomUUID()}`
  return {
    integrity,
    manifest: {
      id,
      fromSequence: integrity.firstSequence,
      toSequence: integrity.lastSequence,
      eventCount: integrity.count,
      rootHash: integrity.rootHash,
      objectRef: objectRef || `audit-archive://${id}`,
      actorId: actor?.id ?? null,
      createdAt: new Date().toISOString(),
    },
  }
}
