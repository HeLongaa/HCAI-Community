import { createHash, randomUUID } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'
import {
  isSecurityEventRetentionEligible,
  securityRetentionContract,
  securityRetentionCutoffs,
  securityRetentionSweepLimit,
  validateSecurityIncidentEventIds,
  validateSecurityIncidentReasonCode,
} from './securityRetention.js'

const actorRef = (actor) => `actor_${createHash('sha256').update(`security-incident:${actor?.id ?? 'system'}`).digest('hex').slice(0, 24)}`

const incidentInclude = { _count: { select: { events: true } } }

const incidentDto = (row) => ({
  id: row.id,
  status: row.status,
  criticalConfirmed: row.criticalConfirmed,
  reasonCode: row.reasonCode,
  resolvedReasonCode: row.resolvedReasonCode ?? null,
  openedAt: row.openedAt.toISOString(),
  resolvedAt: row.resolvedAt?.toISOString() ?? null,
  version: row.version,
  eventCount: row._count?.events ?? 0,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

const lock = (db, key) => db.$queryRawUnsafe(
  'SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))',
  key,
)

const retentionCandidateWhere = (cutoffs, ids = null) => ({
  ...(ids ? { id: { in: ids } } : {}),
  OR: [
    { incidentId: null, occurredAt: { lte: cutoffs.standard } },
    { incident: { is: { status: 'resolved', criticalConfirmed: false } }, occurredAt: { lte: cutoffs.standard } },
    { incident: { is: { status: 'resolved', criticalConfirmed: true } }, occurredAt: { lte: cutoffs.confirmedCritical } },
  ],
})

const loadCandidates = (db, cutoffs, take, ids = null) => db.securityEvent.findMany({
  where: retentionCandidateWhere(cutoffs, ids),
  include: { incident: { select: { id: true, status: true, criticalConfirmed: true } } },
  orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
  take,
})

const discoverEligibleCandidates = async (db, cutoffs, now, take) => {
  const rows = await db.$queryRawUnsafe(`
    SELECT se.id
    FROM security_events se
    LEFT JOIN security_incidents si ON si.id = se.incident_id
    WHERE (
      (se.occurred_at <= $1 AND (si.id IS NULL OR (si.status = 'resolved' AND si.critical_confirmed = false)))
      OR
      (se.occurred_at <= $2 AND si.status = 'resolved' AND si.critical_confirmed = true)
    )
    AND (
      (se.subject_ref IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM data_rights_legal_holds hold_row
        WHERE hold_row.subject_ref = se.subject_ref
          AND hold_row.scope_domain IN ('audit', 'safety')
          AND hold_row.released_at IS NULL
          AND hold_row.expires_at > $3
      ))
      OR
      (se.subject_ref IS NULL AND NOT EXISTS (
        SELECT 1 FROM data_rights_legal_holds hold_row
        WHERE hold_row.scope_domain IN ('audit', 'safety')
          AND hold_row.released_at IS NULL
          AND hold_row.expires_at > $3
      ))
    )
    ORDER BY se.occurred_at ASC, se.id ASC
    LIMIT $4
  `, cutoffs.standard, cutoffs.confirmedCritical, now, take)
  return loadCandidates(db, cutoffs, take, rows.map((row) => row.id))
}

export const createPrismaSecurityRetentionRepository = (client, { recordAudit }) => ({
  listIncidents: async ({ status = null, limit = 50 } = {}) => {
    const rows = await client.securityIncident.findMany({
      where: status ? { status } : {},
      include: incidentInclude,
      orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(Number(limit) || 50, 1), 100),
    })
    return rows.map(incidentDto)
  },

  createIncident: async (actor, payload, now = new Date()) => {
    const eventIds = validateSecurityIncidentEventIds(payload.eventIds)
    const reasonCode = validateSecurityIncidentReasonCode(payload.reasonCode)
    return client.$transaction(async (db) => {
      for (const eventId of [...eventIds].sort()) await lock(db, `security-event:${eventId}`)
      const events = await db.securityEvent.findMany({ where: { id: { in: eventIds } }, select: { id: true, incidentId: true } })
      if (events.length !== eventIds.length) throw new HttpError(404, 'SECURITY_EVENT_NOT_FOUND', 'One or more security events were not found')
      if (events.some((event) => event.incidentId)) throw new HttpError(409, 'SECURITY_EVENT_ALREADY_ASSIGNED', 'One or more security events already belong to an incident')
      const row = await db.securityIncident.create({
        data: {
          id: `security-incident-${randomUUID()}`,
          status: 'open',
          criticalConfirmed: payload.criticalConfirmed === true,
          reasonCode,
          openedByRef: actorRef(actor),
          openedAt: now,
          events: { connect: eventIds.map((id) => ({ id })) },
        },
        include: incidentInclude,
      })
      await recordAudit({ actor, action: 'admin.security.incident_created', resourceType: 'security_incident', resourceId: row.id, metadata: { criticalConfirmed: row.criticalConfirmed, reasonCode, eventCount: eventIds.length } }, db)
      return incidentDto(row)
    }, { isolationLevel: 'ReadCommitted' })
  },

  attachEvents: async (actor, id, payload) => {
    const eventIds = validateSecurityIncidentEventIds(payload.eventIds)
    const reasonCode = validateSecurityIncidentReasonCode(payload.reasonCode)
    return client.$transaction(async (db) => {
      await lock(db, `security-incident:${id}`)
      for (const eventId of [...eventIds].sort()) await lock(db, `security-event:${eventId}`)
      const incident = await db.securityIncident.findUnique({ where: { id: String(id) } })
      if (!incident) return null
      if (incident.status !== 'open') throw new HttpError(409, 'SECURITY_INCIDENT_RESOLVED', 'Resolved incidents cannot accept events')
      if (incident.version !== payload.expectedVersion) throw new HttpError(409, 'SECURITY_INCIDENT_VERSION_CONFLICT', 'Security incident was updated by another operation')
      const events = await db.securityEvent.findMany({ where: { id: { in: eventIds } }, select: { id: true, incidentId: true } })
      if (events.length !== eventIds.length) throw new HttpError(404, 'SECURITY_EVENT_NOT_FOUND', 'One or more security events were not found')
      if (events.some((event) => event.incidentId && event.incidentId !== incident.id)) throw new HttpError(409, 'SECURITY_EVENT_ALREADY_ASSIGNED', 'One or more security events already belong to another incident')
      await db.securityEvent.updateMany({ where: { id: { in: eventIds }, incidentId: null }, data: { incidentId: incident.id } })
      const changed = await db.securityIncident.updateMany({ where: { id: incident.id, version: incident.version, status: 'open' }, data: { version: { increment: 1 } } })
      if (changed.count !== 1) throw new HttpError(409, 'SECURITY_INCIDENT_VERSION_CONFLICT', 'Security incident was updated by another operation')
      await recordAudit({ actor, action: 'admin.security.incident_events_attached', resourceType: 'security_incident', resourceId: incident.id, metadata: { reasonCode, eventCount: eventIds.length, version: incident.version + 1 } }, db)
      return incidentDto(await db.securityIncident.findUnique({ where: { id: incident.id }, include: incidentInclude }))
    }, { isolationLevel: 'ReadCommitted' })
  },

  resolveIncident: async (actor, id, payload, now = new Date()) => {
    const reasonCode = validateSecurityIncidentReasonCode(payload.reasonCode)
    return client.$transaction(async (db) => {
      await lock(db, `security-incident:${id}`)
      const incident = await db.securityIncident.findUnique({ where: { id: String(id) } })
      if (!incident) return null
      if (incident.status === 'resolved') throw new HttpError(409, 'SECURITY_INCIDENT_RESOLVED', 'Security incident is already resolved')
      if (incident.version !== payload.expectedVersion) throw new HttpError(409, 'SECURITY_INCIDENT_VERSION_CONFLICT', 'Security incident was updated by another operation')
      const changed = await db.securityIncident.updateMany({
        where: { id: incident.id, version: incident.version, status: 'open' },
        data: { status: 'resolved', resolvedAt: now, resolvedReasonCode: reasonCode, resolvedByRef: actorRef(actor), version: { increment: 1 } },
      })
      if (changed.count !== 1) throw new HttpError(409, 'SECURITY_INCIDENT_VERSION_CONFLICT', 'Security incident was updated by another operation')
      await recordAudit({ actor, action: 'admin.security.incident_resolved', resourceType: 'security_incident', resourceId: incident.id, metadata: { reasonCode, version: incident.version + 1 } }, db)
      return incidentDto(await db.securityIncident.findUnique({ where: { id: incident.id }, include: incidentInclude }))
    }, { isolationLevel: 'ReadCommitted' })
  },

  sweepRetention: async ({ now = new Date(), limit } = {}) => {
    const cutoffs = securityRetentionCutoffs(now)
    const take = securityRetentionSweepLimit(limit)
    const discovered = await discoverEligibleCandidates(client, cutoffs, now, take)
    if (discovered.length === 0) return { policyId: securityRetentionContract.policyId, inspected: 0, deleted: 0, blocked: 0 }
    return client.$transaction(async (db) => {
      await lock(db, 'security-retention-legal-holds')
      for (const event of discovered) await lock(db, `security-event:${event.id}`)
      const subjectRefs = [...new Set(discovered.map((event) => event.subjectRef).filter(Boolean))].sort()
      for (const subjectRef of subjectRefs) await lock(db, `data-rights-subject-ref:${subjectRef}`)
      const candidates = await loadCandidates(db, cutoffs, take, discovered.map((event) => event.id))
      const [matchingHolds, activeHoldCount] = await Promise.all([
        subjectRefs.length === 0 ? [] : db.dataRightsLegalHold.findMany({
          where: { subjectRef: { in: subjectRefs }, scopeDomain: { in: securityRetentionContract.legalHoldScopeDomains }, releasedAt: null, expiresAt: { gt: now } },
          select: { subjectRef: true },
        }),
        candidates.some((event) => !event.subjectRef) ? db.dataRightsLegalHold.count({
          where: { scopeDomain: { in: securityRetentionContract.legalHoldScopeDomains }, releasedAt: null, expiresAt: { gt: now } },
        }) : 0,
      ])
      const heldSubjectRefs = new Set(matchingHolds.map((hold) => hold.subjectRef))
      const eligible = candidates.filter((event) => (
        isSecurityEventRetentionEligible(event, cutoffs)
        && (event.subjectRef ? !heldSubjectRefs.has(event.subjectRef) : activeHoldCount === 0)
      ))
      if (eligible.length > 0) await db.securityEvent.deleteMany({ where: { id: { in: eligible.map((event) => event.id) } } })
      await recordAudit({ actor: null, action: 'system.security.events.retention_deleted', resourceType: 'security_event_retention', resourceId: securityRetentionContract.policyId, metadata: { inspected: candidates.length, deleted: eligible.length, blocked: candidates.length - eligible.length } }, db)
      return { policyId: securityRetentionContract.policyId, inspected: candidates.length, deleted: eligible.length, blocked: candidates.length - eligible.length }
    }, { isolationLevel: 'ReadCommitted' })
  },
})
