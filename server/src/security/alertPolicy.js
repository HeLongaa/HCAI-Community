const positiveInteger = (source, key, fallback) => {
  const parsed = Number.parseInt(source[key] ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const buildSecurityAlertPolicy = (source = process.env) => ({
  windowMinutes: positiveInteger(source, 'SECURITY_ALERT_WINDOW_MINUTES', 15),
  thresholds: {
    rateLimit: positiveInteger(source, 'SECURITY_ALERT_RATE_LIMIT_THRESHOLD', 10),
    bodyRejected: positiveInteger(source, 'SECURITY_ALERT_BODY_REJECTED_THRESHOLD', 5),
    authFailure: positiveInteger(source, 'SECURITY_ALERT_AUTH_FAILURE_THRESHOLD', 1),
    deliveryFailure: positiveInteger(source, 'SECURITY_ALERT_DELIVERY_FAILURE_THRESHOLD', 3),
  },
})

const recentValues = (events, selector) =>
  [...new Set(events.map(selector).filter(Boolean))].slice(0, 5)

const objectMetadata = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {}

export const securityAlertDispositionActions = [
  'security.alert.acknowledged',
  'security.alert.silenced',
  'security.alert.unsilenced',
]

export const applySecurityAlertDispositions = (alerts, dispositionEvents = [], now = new Date()) => {
  const nowMs = now.getTime()
  return alerts.map((alert) => {
    const events = dispositionEvents
      .filter((event) => event.resourceId === alert.id)
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    const acknowledged = events.find((event) => event.action === 'security.alert.acknowledged') ?? null
    const silenced = events.find((event) => event.action === 'security.alert.silenced') ?? null
    const unsilenced = events.find((event) => event.action === 'security.alert.unsilenced') ?? null
    const acknowledgedMetadata = objectMetadata(acknowledged?.metadata)
    const silenceMetadata = objectMetadata(silenced?.metadata)
    const silenceUntil = silenceMetadata.silencedUntil ? String(silenceMetadata.silencedUntil) : null
    const silenceUntilMs = Date.parse(silenceUntil ?? '')
    const silenceCreatedMs = Date.parse(silenced?.createdAt ?? '')
    const unsilenceCreatedMs = Date.parse(unsilenced?.createdAt ?? '')
    const silenceIsCurrent = Boolean(
      silenced &&
      Number.isFinite(silenceUntilMs) &&
      silenceUntilMs > nowMs &&
      (!unsilenced || silenceCreatedMs > unsilenceCreatedMs),
    )
    return {
      ...alert,
      state: silenceIsCurrent ? 'silenced' : acknowledged ? 'acknowledged' : 'active',
      acknowledgedAt: acknowledged?.createdAt?.toISOString?.() ?? acknowledged?.createdAt ?? null,
      acknowledgedBy: acknowledgedMetadata.actorHandle ?? null,
      acknowledgementNote: acknowledgedMetadata.note ?? null,
      silencedUntil: silenceIsCurrent ? silenceUntil : null,
      silencedBy: silenceIsCurrent ? silenceMetadata.actorHandle ?? null : null,
      silenceNote: silenceIsCurrent ? silenceMetadata.note ?? null : null,
    }
  })
}

export const securityAlertSource = (alert) => {
  const metadata = objectMetadata(alert?.metadata)
  return typeof metadata.source === 'string' ? metadata.source : null
}

export const buildSecurityEventAlerts = ({
  rateLimitEvents = [],
  bodyRejectedEvents = [],
  authFailureEvents = [],
  alertDeliveryFailureEvents = [],
  policy = buildSecurityAlertPolicy(),
  now = new Date(),
} = {}) => {
  const { windowMinutes, thresholds } = policy
  const alerts = []
  const pushAlert = ({ type, severity, title, summary, count, threshold, source, events }) => {
    if (count < threshold) return
    alerts.push({
      id: `security-alert-${type}`,
      type,
      severity,
      title,
      summary,
      count,
      threshold,
      windowMinutes,
      resourceType: 'security_event',
      resourceId: null,
      metadata: {
        source,
        recentEventIds: recentValues(events, (event) => event.id),
        recentClientKeys: recentValues(events, (event) => event.clientKey),
        recentIdentities: recentValues(events, (event) => event.identity),
        recentPaths: recentValues(events, (event) => event.pathname),
      },
      createdAt: now.toISOString(),
    })
  }

  pushAlert({
    type: 'security.event.rate_limit.spike',
    severity: 'warning',
    title: 'Rate-limit spike detected',
    summary: `${rateLimitEvents.length} rate-limit events in the last ${windowMinutes} minutes.`,
    count: rateLimitEvents.length,
    threshold: thresholds.rateLimit,
    source: 'rate_limit',
    events: rateLimitEvents,
  })
  pushAlert({
    type: 'security.event.body_rejected.spike',
    severity: 'warning',
    title: 'Oversized request spike detected',
    summary: `${bodyRejectedEvents.length} oversized request rejections in the last ${windowMinutes} minutes.`,
    count: bodyRejectedEvents.length,
    threshold: thresholds.bodyRejected,
    source: 'body_size',
    events: bodyRejectedEvents,
  })
  pushAlert({
    type: 'security.event.auth_failure_anomaly.spike',
    severity: 'critical',
    title: 'Failed-login anomaly spike detected',
    summary: `${authFailureEvents.length} failed-login anomaly events in the last ${windowMinutes} minutes.`,
    count: authFailureEvents.length,
    threshold: thresholds.authFailure,
    source: 'auth_failure',
    events: authFailureEvents,
  })
  pushAlert({
    type: 'security.alert.delivery_failed.spike',
    severity: 'critical',
    title: 'Security alert delivery failures detected',
    summary: `${alertDeliveryFailureEvents.length} security alert delivery failures in the last ${windowMinutes} minutes.`,
    count: alertDeliveryFailureEvents.length,
    threshold: thresholds.deliveryFailure,
    source: 'alert_dispatch',
    events: alertDeliveryFailureEvents,
  })
  const deliveryAlert = alerts.find((alert) => alert.type === 'security.alert.delivery_failed.spike')
  if (deliveryAlert) {
    deliveryAlert.resourceType = 'security_alert_dispatch'
    deliveryAlert.metadata.recentChannels = recentValues(alertDeliveryFailureEvents, (event) => objectMetadata(event.metadata).channel)
    deliveryAlert.metadata.recentStatuses = recentValues(alertDeliveryFailureEvents, (event) => objectMetadata(event.metadata).status)
    deliveryAlert.metadata.recentAlertTypes = recentValues(alertDeliveryFailureEvents, (event) => objectMetadata(event.metadata).alertType)
    deliveryAlert.metadata.recentErrors = recentValues(alertDeliveryFailureEvents, (event) => objectMetadata(event.metadata).error)
  }
  return alerts
}
