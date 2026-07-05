import { randomUUID } from 'node:crypto'

const DEFAULT_MAX_EVENTS = 500
const events = []
const pendingWrites = new Set()
let persistentStore = null

const securityEventLimit = (source = process.env) => {
  const parsed = Number.parseInt(source.SECURITY_EVENT_MAX_ITEMS ?? '', 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_EVENTS
}

const eventDetails = (event) => {
  const { id, type, severity, source, clientKey, identity, method, pathname, occurredAt, ...details } = event
  return details
}

export const recordSecurityEvent = (event, source = process.env) => {
  const recorded = {
    id: `security-${Date.now()}-${randomUUID()}`,
    type: String(event.type ?? 'security.event'),
    severity: String(event.severity ?? 'info'),
    source: String(event.source ?? 'system'),
    clientKey: event.clientKey ?? null,
    identity: event.identity ?? null,
    method: event.method ?? null,
    pathname: event.pathname ?? null,
    occurredAt: event.occurredAt ?? new Date().toISOString(),
    details: event.details ?? eventDetails(event),
  }
  events.unshift(recorded)
  events.length = Math.min(events.length, securityEventLimit(source))
  if (persistentStore?.record) {
    const write = Promise.resolve()
      .then(() => persistentStore.record(recorded))
      .catch(() => null)
      .finally(() => pendingWrites.delete(write))
    pendingWrites.add(write)
  }
  return recorded
}

export const listSecurityEvents = (options = {}) => {
  const limit = options.limit ?? 20
  const filtered = events
    .filter((event) => !options.type || event.type === options.type)
    .filter((event) => !options.source || event.source === options.source)
    .filter((event) => !options.severity || event.severity === options.severity)
  const startIndex = options.cursor
    ? Math.max(0, filtered.findIndex((event) => event.id === options.cursor) + 1)
    : 0
  const rows = filtered.slice(startIndex, startIndex + limit + 1)
  const page = rows.slice(0, limit)
  return {
    items: page,
    limit,
    nextCursor: rows.length > limit && page.length > 0 ? page[page.length - 1].id : null,
  }
}

export const flushSecurityEvents = async () => {
  if (pendingWrites.size === 0) {
    return
  }
  await Promise.allSettled([...pendingWrites])
}

export const configureSecurityEventStore = (store = null) => {
  persistentStore = store
}

export const resetSecurityEvents = () => {
  events.length = 0
  pendingWrites.clear()
}
