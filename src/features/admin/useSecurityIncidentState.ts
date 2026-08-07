import { useMemo, useState } from 'react'

import type {
  AdminSecurityAlertDto,
  AdminSecurityEventDto,
  AdminSecurityEventListQuery,
  AdminSecurityIncidentDto,
} from '../../services/contracts'

export function useSecurityIncidentState() {
  const [alerts, setAlerts] = useState<AdminSecurityAlertDto[]>([])
  const [events, setEvents] = useState<AdminSecurityEventDto[]>([])
  const [sourceFilter, setSourceFilter] = useState<AdminSecurityEventListQuery['source']>(null)
  const [severityFilter, setSeverityFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [incidents, setIncidents] = useState<AdminSecurityIncidentDto[]>([])
  const [selectedOpenIncidentId, setSelectedOpenIncidentId] = useState('')

  const query = useMemo<AdminSecurityEventListQuery>(() => ({
    source: sourceFilter,
    severity: severityFilter || null,
    type: typeFilter || null,
    limit: 12,
  }), [severityFilter, sourceFilter, typeFilter])

  return {
    state: {
      alerts,
      events,
      sourceFilter,
      severityFilter,
      typeFilter,
      nextCursor,
      incidents,
      selectedOpenIncidentId,
      query,
    },
    setters: {
      setAlerts,
      setEvents,
      setSourceFilter,
      setSeverityFilter,
      setTypeFilter,
      setNextCursor,
      setIncidents,
      setSelectedOpenIncidentId,
    },
  }
}
