import { useEffect, useMemo, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { textFor } from '../../domain/utils'
import { notificationService } from '../../services/notificationService'
import type { ApiNotification, NotificationPreference } from '../../services/contracts'

const commonTypes = [
  'task.proposal_submitted', 'task.proposal_accepted', 'task.proposal_rejected',
  'task.submission_submitted', 'task.revision_requested', 'task.submission_approved',
  'points.adjustment.requested', 'media.scan.review_required', 'security.event.alert',
]

export function NotificationPreferences({ t, notifications }: { t: Record<string, string>; notifications: ApiNotification[] }) {
  const [preferences, setPreferences] = useState<NotificationPreference[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    notificationService.listPreferences()
      .then((items) => { if (active) setPreferences(items) })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const types = useMemo(() => [...new Set([
    ...commonTypes,
    ...notifications.map((item) => item.type),
    ...preferences.map((item) => item.notificationType),
  ])].sort(), [notifications, preferences])

  const toggle = async (type: string) => {
    const current = preferences.find((item) => item.notificationType === type)
    setSaving(type)
    setError(null)
    try {
      const updated = await notificationService.setPreference(type, current?.inAppEnabled === false, current?.version)
      setPreferences((items) => [updated, ...items.filter((item) => item.notificationType !== type)])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(null)
    }
  }

  if (loading) return <div className="notification-preferences-state"><LoaderCircle className="spin" size={17} /></div>

  return (
    <div className="notification-preferences" data-testid="notification-preferences">
      {error && <div className="inline-error" role="alert">{error}</div>}
      {types.map((type) => {
        const current = preferences.find((item) => item.notificationType === type)
        return (
          <label className="notification-preference-row" key={type}>
            <span>{type}</span>
            <input
              type="checkbox"
              checked={current?.inAppEnabled !== false}
              disabled={saving === type}
              aria-label={textFor(t, `In-app ${type}`, `站内 ${type}`)}
              onChange={() => void toggle(type)}
            />
          </label>
        )
      })}
    </div>
  )
}
