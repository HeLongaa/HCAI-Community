import { useCallback, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import { adminService } from '../../services/adminService'
import type {
  AdminSecurityAlertDto,
  AdminSecurityAlertEventDto,
  AdminSecurityEventDto,
  AdminSecurityEventListQuery,
  AdminSecurityIncidentDto,
} from '../../services/contracts'
import type { AdminActionFeedbackMessage } from './AdminActionFeedback'
import { downloadTextArtifact } from './downloadAdminArtifact'

type Options = {
  isZh: boolean
  canReadAudit: boolean
  incidents: AdminSecurityIncidentDto[]
  selectedOpenIncidentId: string
  nextCursor: string | null
  query: AdminSecurityEventListQuery
  setAlerts: Dispatch<SetStateAction<AdminSecurityAlertDto[]>>
  setEvents: Dispatch<SetStateAction<AdminSecurityEventDto[]>>
  setNextCursor: Dispatch<SetStateAction<string | null>>
  setIncidents: Dispatch<SetStateAction<AdminSecurityIncidentDto[]>>
  setSelectedOpenIncidentId: Dispatch<SetStateAction<string>>
  setFeedback: Dispatch<SetStateAction<AdminActionFeedbackMessage | null>>
  refreshAudit: () => Promise<void>
  refreshMetrics: () => Promise<void>
  refreshAlerts: () => Promise<void>
  refreshEvents: () => Promise<void>
  refreshIncidents: () => Promise<void>
  onOperationComplete: () => void
}

const downloadJson = (contents: string, fileName: string) => {
  downloadTextArtifact({
    content: contents,
    fileName,
    mimeType: 'application/json;charset=utf-8',
  })
}

export function useSecurityIncidentOperations({
  isZh,
  canReadAudit,
  incidents,
  selectedOpenIncidentId,
  nextCursor,
  query,
  setAlerts,
  setEvents,
  setNextCursor,
  setIncidents,
  setSelectedOpenIncidentId,
  setFeedback,
  refreshAudit,
  refreshMetrics,
  refreshAlerts,
  refreshEvents,
  refreshIncidents,
  onOperationComplete,
}: Options) {
  const [handlingAlertId, setHandlingAlertId] = useState<string | null>(null)
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null)
  const [exportingAlertId, setExportingAlertId] = useState<string | null>(null)
  const [alertEvents, setAlertEvents] = useState<AdminSecurityAlertEventDto[]>([])
  const [alertEventsLoading, setAlertEventsLoading] = useState(false)
  const [alertEventsError, setAlertEventsError] = useState<string | null>(null)
  const [loadingMoreEvents, setLoadingMoreEvents] = useState(false)
  const [handlingIncidentId, setHandlingIncidentId] = useState<string | null>(null)

  const refreshWorkspace = () => Promise.all([refreshAlerts(), refreshEvents(), refreshIncidents()]).then(() => undefined)

  const createIncident = async (event: AdminSecurityEventDto, reasonCode: string, criticalConfirmed: boolean) => {
    setHandlingIncidentId(event.id)
    try {
      const incident = await adminService.createSecurityIncident([event.id], criticalConfirmed, reasonCode)
      setIncidents((current) => [incident, ...current])
      setEvents((current) => current.map((item) => item.id === event.id ? { ...item, incidentId: incident.id } : item))
      setSelectedOpenIncidentId(incident.id)
      void refreshAudit()
      onOperationComplete()
      setFeedback({ kind: 'success', text: isZh ? `已创建安全事故：${incident.id}` : `Security incident created: ${incident.id}` })
    } catch (error) {
      console.info('[admin-service]', error)
      setFeedback({ kind: 'error', text: isZh ? '创建安全事故失败。' : 'Could not create security incident.' })
    } finally {
      setHandlingIncidentId(null)
    }
  }

  const attachEvent = async (event: AdminSecurityEventDto) => {
    const incident = incidents.find((item) => item.id === selectedOpenIncidentId && item.status === 'open')
    if (!incident) return
    setHandlingIncidentId(event.id)
    try {
      const updated = await adminService.attachSecurityIncidentEvents(incident.id, [event.id], incident.version, 'related_event_attached')
      setIncidents((current) => current.map((item) => item.id === updated.id ? updated : item))
      setEvents((current) => current.map((item) => item.id === event.id ? { ...item, incidentId: updated.id } : item))
      void refreshAudit()
      setFeedback({ kind: 'success', text: isZh ? `事件已关联到事故：${updated.id}` : `Event attached to incident: ${updated.id}` })
    } catch (error) {
      console.info('[admin-service]', error)
      void refreshIncidents()
      setFeedback({ kind: 'error', text: isZh ? '关联安全事故失败，请刷新后重试。' : 'Could not attach the event. Refresh and retry.' })
    } finally {
      setHandlingIncidentId(null)
    }
  }

  const resolveIncident = async (incident: AdminSecurityIncidentDto, reasonCode: string) => {
    setHandlingIncidentId(incident.id)
    try {
      const updated = await adminService.resolveSecurityIncident(incident.id, incident.version, reasonCode)
      setIncidents((current) => current.map((item) => item.id === updated.id ? updated : item))
      if (selectedOpenIncidentId === updated.id) {
        setSelectedOpenIncidentId(incidents.find((item) => item.status === 'open' && item.id !== updated.id)?.id ?? '')
      }
      void refreshAudit()
      onOperationComplete()
      setFeedback({ kind: 'success', text: isZh ? `安全事故已关闭：${updated.id}` : `Security incident resolved: ${updated.id}` })
    } catch (error) {
      console.info('[admin-service]', error)
      void refreshIncidents()
      setFeedback({ kind: 'error', text: isZh ? '关闭安全事故失败，请刷新后重试。' : 'Could not resolve the incident. Refresh and retry.' })
    } finally {
      setHandlingIncidentId(null)
    }
  }

  const updateAlert = (updated: AdminSecurityAlertDto) => {
    setAlerts((current) => current.map((item) => item.id === updated.id ? updated : item))
    void refreshAudit()
    void refreshMetrics()
  }

  const acknowledgeAlert = async (alert: AdminSecurityAlertDto) => {
    setHandlingAlertId(alert.id)
    try {
      updateAlert(await adminService.acknowledgeSecurityAlert(alert.id, isZh ? '已在管理中心确认安全告警。' : 'Acknowledged from Admin Center.'))
      setFeedback({ kind: 'success', text: isZh ? `已确认安全告警：${alert.title}` : `Security alert acknowledged: ${alert.title}` })
    } catch (error) {
      console.info('[admin-service]', error)
      setFeedback({ kind: 'error', text: isZh ? '安全告警确认失败。' : 'Could not acknowledge security alert.' })
    } finally {
      setHandlingAlertId(null)
    }
  }

  const silenceAlert = async (alert: AdminSecurityAlertDto, reason: string) => {
    setHandlingAlertId(alert.id)
    try {
      const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      updateAlert(await adminService.silenceSecurityAlert(alert.id, until, reason))
      onOperationComplete()
      setFeedback({ kind: 'success', text: isZh ? `已静默安全告警：${alert.title}` : `Security alert silenced: ${alert.title}` })
    } catch (error) {
      console.info('[admin-service]', error)
      setFeedback({ kind: 'error', text: isZh ? '安全告警静默失败。' : 'Could not silence security alert.' })
    } finally {
      setHandlingAlertId(null)
    }
  }

  const unsilenceAlert = async (alert: AdminSecurityAlertDto) => {
    setHandlingAlertId(alert.id)
    try {
      updateAlert(await adminService.unsilenceSecurityAlert(alert.id, isZh ? '管理中心解除静默。' : 'Unsilenced from Admin Center.'))
      setFeedback({ kind: 'success', text: isZh ? `已解除安全告警静默：${alert.title}` : `Security alert unsilenced: ${alert.title}` })
    } catch (error) {
      console.info('[admin-service]', error)
      setFeedback({ kind: 'error', text: isZh ? '解除安全告警静默失败。' : 'Could not unsilence security alert.' })
    } finally {
      setHandlingAlertId(null)
    }
  }

  const openAlertEvents = useCallback(async (alertId: string) => {
    setSelectedAlertId(alertId)
    setAlertEvents([])
    setAlertEventsError(null)
    setAlertEventsLoading(true)
    try {
      setAlertEvents(await adminService.securityAlertEvents(alertId))
    } catch (error) {
      console.info('[admin-service]', error)
      setAlertEventsError(isZh ? '无法读取安全告警样本。' : 'Could not load security alert events.')
    } finally {
      setAlertEventsLoading(false)
    }
  }, [isZh])

  const toggleAlertEvents = async (alert: AdminSecurityAlertDto) => {
    if (selectedAlertId === alert.id) {
      setSelectedAlertId(null)
      setAlertEvents([])
      setAlertEventsError(null)
      return
    }
    await openAlertEvents(alert.id)
  }

  const exportAlert = async (alert: AdminSecurityAlertDto) => {
    setExportingAlertId(alert.id)
    try {
      downloadJson(await adminService.exportSecurityAlertJson(alert.id), `security-alert-${alert.id}.json`)
      setFeedback({ kind: 'success', text: isZh ? `已导出安全告警：${alert.title}` : `Exported security alert: ${alert.title}` })
    } catch (error) {
      console.info('[admin-service]', error)
      setFeedback({ kind: 'error', text: isZh ? '导出安全告警失败。' : 'Could not export security alert.' })
    } finally {
      setExportingAlertId(null)
    }
  }

  const loadMoreEvents = async () => {
    if (!nextCursor || loadingMoreEvents || !canReadAudit) return
    setLoadingMoreEvents(true)
    try {
      const page = await adminService.securityEvents({ ...query, cursor: nextCursor })
      setEvents((current) => [...current, ...page.events.filter((event) => !current.some((item) => item.id === event.id))])
      setNextCursor(page.nextCursor)
      setFeedback({ kind: 'success', text: isZh ? '已加载更多安全事件。' : 'Loaded more security events.' })
    } catch (error) {
      console.info('[admin-service]', error)
      setFeedback({ kind: 'error', text: isZh ? '加载更多安全事件失败。' : 'Could not load more security events.' })
    } finally {
      setLoadingMoreEvents(false)
    }
  }

  return {
    state: {
      handlingAlertId,
      selectedAlertId,
      exportingAlertId,
      alertEvents,
      alertEventsLoading,
      alertEventsError,
      loadingMoreEvents,
      handlingIncidentId,
    },
    actions: {
      refreshWorkspace,
      createIncident,
      attachEvent,
      resolveIncident,
      acknowledgeAlert,
      silenceAlert,
      unsilenceAlert,
      openAlertEvents,
      toggleAlertEvents,
      exportAlert,
      loadMoreEvents,
    },
  }
}
