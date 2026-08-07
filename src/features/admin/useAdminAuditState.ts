import { useMemo, useState } from 'react'

import type { AuditEvent } from '../../domain/types'
import type { AdminAuditArchiveManifestDto, AdminAuditIntegrityDto, AdminAuditListQuery } from '../../services/contracts'
import type { AdminActionFeedbackMessage } from './AdminActionFeedback'

export function useAdminAuditState() {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [expandedEventIds, setExpandedEventIds] = useState<Record<string, boolean>>({})
  const [exporting, setExporting] = useState(false)
  const [integrity, setIntegrity] = useState<AdminAuditIntegrityDto | null>(null)
  const [archives, setArchives] = useState<AdminAuditArchiveManifestDto[]>([])
  const [verifying, setVerifying] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [actionFilter, setActionFilter] = useState('')
  const [resourceTypeFilter, setResourceTypeFilter] = useState('')
  const [resourceIdFilter, setResourceIdFilter] = useState('')
  const [actorTypeFilter, setActorTypeFilter] = useState<'all' | 'user' | 'system'>('all')
  const [actorIdFilter, setActorIdFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc')
  const [feedback, setFeedback] = useState<AdminActionFeedbackMessage | null>(null)

  const query = useMemo<AdminAuditListQuery>(() => ({
    action: actionFilter || null,
    resourceType: resourceTypeFilter || null,
    resourceId: resourceIdFilter || null,
    actorType: actorTypeFilter === 'all' ? null : actorTypeFilter,
    actorId: actorIdFilter || null,
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
    direction,
    limit: 20,
  }), [actionFilter, actorIdFilter, actorTypeFilter, dateFrom, dateTo, direction, resourceIdFilter, resourceTypeFilter])

  return {
    state: { events, expandedEventIds, exporting, integrity, archives, verifying, archiving,
      actionFilter, resourceTypeFilter, resourceIdFilter, actorTypeFilter, actorIdFilter,
      dateFrom, dateTo, direction, feedback, query },
    setters: { setEvents, setExpandedEventIds, setExporting, setIntegrity, setArchives, setVerifying,
      setArchiving, setActionFilter, setResourceTypeFilter, setResourceIdFilter, setActorTypeFilter,
      setActorIdFilter, setDateFrom, setDateTo, setDirection, setFeedback },
  }
}
