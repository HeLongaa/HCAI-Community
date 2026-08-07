type ClientErrorEventType = 'react_error_boundary' | 'window_error' | 'unhandled_rejection'

type ClientErrorContext = {
  eventType: ClientErrorEventType
  componentStack?: string | null
}

const endpoint = `${(import.meta.env.VITE_API_BASE_URL?.trim() || '/api').replace(/\/+$/, '')}/observability/client-errors`
const release = String(import.meta.env.VITE_APP_RELEASE ?? 'development').replace(/[^a-z0-9:._/-]/gi, '').slice(0, 191) || 'development'
const recentFingerprints = new Map<string, number>()

const sha256 = async (value: string | null | undefined) => {
  if (!value || !globalThis.crypto?.subtle) return null
  const bytes = new TextEncoder().encode(value)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const safeIdentifier = (value: unknown, fallback: string) => {
  const normalized = String(value ?? '').trim().replace(/[^a-z0-9:._/-]/gi, '_').slice(0, 191)
  return normalized || fallback
}

const normalizedError = (value: unknown) => {
  if (value instanceof Error) return value
  return new Error(typeof value === 'string' ? value : 'Non-error rejection')
}

const currentRoute = () => safeIdentifier(window.location.hash.replace(/^#\/?/, '').split(/[?]/)[0], 'landing')

const sendReport = async (payload: Record<string, unknown>) => {
  await fetch(endpoint, {
    method: 'POST',
    credentials: 'include',
    keepalive: true,
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {})
}

const reportRouteView = () => sendReport({
  eventType: 'route_view',
  errorName: 'None',
  errorCode: 'NONE',
  route: currentRoute(),
  release,
  occurredAt: new Date().toISOString(),
})

export const reportClientError = async (value: unknown, context: ClientErrorContext) => {
  const error = normalizedError(value)
  const [messageHash, stackHash, componentStackHash] = await Promise.all([
    sha256(error.message),
    sha256(error.stack),
    sha256(context.componentStack),
  ])
  const fingerprint = [context.eventType, messageHash, stackHash, componentStackHash].filter(Boolean).join(':')
  const now = Date.now()
  if (fingerprint && now - (recentFingerprints.get(fingerprint) ?? 0) < 60_000) return
  if (fingerprint) recentFingerprints.set(fingerprint, now)

  const payload = {
    eventType: context.eventType,
    errorName: safeIdentifier(error.name, 'Error'),
    errorCode: safeIdentifier((error as Error & { code?: string }).code, 'CLIENT_RUNTIME_ERROR'),
    route: currentRoute(),
    release,
    messageHash,
    stackHash,
    componentStackHash,
    occurredAt: new Date(now).toISOString(),
  }
  await sendReport(payload)
}

export const installGlobalClientErrorReporting = () => {
  const onError = (event: ErrorEvent) => void reportClientError(event.error ?? new Error(event.message), { eventType: 'window_error' })
  const onUnhandledRejection = (event: PromiseRejectionEvent) => void reportClientError(event.reason, { eventType: 'unhandled_rejection' })
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onUnhandledRejection)
  window.addEventListener('hashchange', reportRouteView)
  void reportRouteView()
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onUnhandledRejection)
    window.removeEventListener('hashchange', reportRouteView)
  }
}
