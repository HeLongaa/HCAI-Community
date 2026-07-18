const DEFAULT_AUTH_FAILURE_WINDOW_MS = 300_000

const positiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

const boolFlag = (value, fallback = true) => {
  if (value == null || value === '') {
    return fallback
  }
  return String(value).trim().toLowerCase() === 'true'
}

const headerValue = (headers, key) => {
  const value = headers?.[key]
  return Array.isArray(value) ? value[0] : value
}

const requestPathname = (request) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  return url.pathname.replace(/\/+$/, '') || '/'
}

const requestClientKey = (request) => {
  const forwardedFor = String(headerValue(request.headers, 'x-forwarded-for') ?? '').split(',')[0]?.trim()
  return forwardedFor || request.socket?.remoteAddress || 'unknown'
}

export const authFailureMonitorConfig = (source = process.env) => ({
  enabled: boolFlag(source.AUTH_FAILURE_MONITOR_ENABLED, true),
  windowMs: positiveInteger(source.AUTH_FAILURE_WINDOW_MS, DEFAULT_AUTH_FAILURE_WINDOW_MS),
  ipAccountThreshold: positiveInteger(source.AUTH_FAILURE_IP_ACCOUNT_THRESHOLD, 5),
  accountIpThreshold: positiveInteger(source.AUTH_FAILURE_ACCOUNT_IP_THRESHOLD, 5),
})

export const createMemoryAuthFailureMonitor = () => {
  const events = []
  return {
    record(event, { windowMs, now = Date.now() }) {
      const since = now - windowMs
      while (events.length > 0 && events[0].occurredAtMs < since) {
        events.shift()
      }
      events.push(event)
      return events.filter((item) => item.occurredAtMs >= since)
    },
    reset() {
      events.length = 0
    },
  }
}

const defaultAuthFailureMonitor = createMemoryAuthFailureMonitor()

export const resetAuthFailureMonitorState = () => defaultAuthFailureMonitor.reset()

const uniqueCount = (items, pick) => new Set(items.map(pick).filter(Boolean)).size

const buildAnomalies = (event, recentEvents, config) => {
  const sameClient = recentEvents.filter((item) => item.clientKey === event.clientKey)
  const sameIdentity = recentEvents.filter((item) => item.identity === event.identity)
  const identityCount = uniqueCount(sameClient, (item) => item.identity)
  const clientCount = uniqueCount(sameIdentity, (item) => item.clientKey)
  const common = {
    method: event.method,
    pathname: event.pathname,
    occurredAt: event.occurredAt,
    windowMs: config.windowMs,
    reason: event.reason,
  }
  return [
    ...(identityCount >= config.ipAccountThreshold ? [{
      type: 'auth.failed_login.ip_accounts',
      severity: 'warning',
      clientKey: event.clientKey,
      identity: event.identity,
      distinctIdentityCount: identityCount,
      threshold: config.ipAccountThreshold,
      ...common,
    }] : []),
    ...(clientCount >= config.accountIpThreshold ? [{
      type: 'auth.failed_login.account_ips',
      severity: 'warning',
      clientKey: event.clientKey,
      identity: event.identity,
      distinctClientCount: clientCount,
      threshold: config.accountIpThreshold,
      ...common,
    }] : []),
  ]
}

export const recordAuthFailure = async (request, failure, options = {}) => {
  const config = options.config ?? authFailureMonitorConfig(options.source ?? process.env)
  if (!config.enabled) return []

  const monitor = options.monitor ?? defaultAuthFailureMonitor
  const now = options.now ?? Date.now()
  const event = {
    clientKey: requestClientKey(request),
    identity: String(failure.identity ?? 'unknown').trim().toLowerCase() || 'unknown',
    reason: String(failure.reason ?? 'auth_failed'),
    method: String(request.method ?? '').toUpperCase(),
    pathname: requestPathname(request),
    occurredAt: new Date(now).toISOString(),
    occurredAtMs: now,
  }
  const recentEvents = monitor.record(event, { windowMs: config.windowMs, now })
  const anomalies = buildAnomalies(event, recentEvents, config)
  for (const anomaly of anomalies) {
    try {
      await options.onAnomaly?.(anomaly)
    } catch {
      // Observability hooks must not change the client-facing auth contract.
    }
  }
  return anomalies
}
