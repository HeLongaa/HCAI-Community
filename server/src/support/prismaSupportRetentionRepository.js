import {
  supportRetentionContract,
  supportRetentionCutoffs,
  supportRetentionDisposition,
  supportRetentionSweepLimit,
} from './supportRetention.js'

const lock = (db, key) => db.$queryRawUnsafe(
  'SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))',
  key,
)

const discoverCandidates = (db, cutoffs, take) => db.$queryRawUnsafe(`
  SELECT ticket_row.id
  FROM support_tickets ticket_row
  WHERE ticket_row.status = 'closed'
    AND ticket_row.closed_at IS NOT NULL
    AND ticket_row.retention_redacted_at IS NULL
    AND (
      ticket_row.closed_at <= $1
      OR (
        ticket_row.closed_at <= $2
        AND ticket_row.retention_message_redacted_at IS NULL
      )
    )
  ORDER BY ticket_row.closed_at ASC, ticket_row.id ASC
  LIMIT $3
`, cutoffs.minimalEvidence, cutoffs.messages, take)

const loadTicket = async (db, id) => {
  const ticket = await db.supportTicket.findUnique({ where: { id } })
  if (!ticket) return null
  const messages = await db.supportTicketMessage.findMany({ where: { ticketId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
  const caseLinks = await db.supportTicketCaseLink.findMany({ where: { ticketId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
  return { ...ticket, messages, caseLinks }
}

const allSubjectRefs = (ticket) => [...new Set([
  ticket.requesterSubjectRef,
  ...ticket.messages.map((message) => message.authorSubjectRef),
  ...ticket.caseLinks.map((linkRow) => linkRow.createdBySubjectRef),
].filter(Boolean))]

const isBlocked = async (db, ticket, now) => {
  const refs = allSubjectRefs(ticket)
  if (refs.length === 0) {
    return Boolean(await db.dataRightsLegalHold.count({
      where: {
        scopeDomain: { in: supportRetentionContract.legalHoldScopeDomains },
        releasedAt: null,
        expiresAt: { gt: now },
      },
    }))
  }
  const legalHold = await db.dataRightsLegalHold.findFirst({
    where: {
      subjectRef: { in: refs },
      scopeDomain: { in: supportRetentionContract.legalHoldScopeDomains },
      releasedAt: null,
      expiresAt: { gt: now },
    },
    select: { id: true },
  })
  if (legalHold) return true
  if (!ticket.requesterSubjectRef) return false
  return Boolean(await db.dataRightsRequest.findFirst({
    where: {
      subjectRef: ticket.requesterSubjectRef,
      status: { in: supportRetentionContract.openDataRightsStatuses },
    },
    select: { id: true },
  }))
}

const redactMessages = async (db, ticket, now) => {
  await db.supportTicketMessage.updateMany({
    where: { ticketId: ticket.id },
    data: { body: supportRetentionContract.retainedBody },
  })
  await db.supportTicket.update({
    where: { id: ticket.id },
    data: { retentionMessageRedactedAt: ticket.retentionMessageRedactedAt ?? now },
  })
}

const retainMinimalEvidence = async (db, ticket, now) => {
  await redactMessages(db, ticket, now)
  await db.supportTicketMessage.updateMany({
    where: { ticketId: ticket.id },
    data: { authorId: null, authorSubjectRef: null },
  })
  await db.supportTicketCaseLink.updateMany({
    where: { ticketId: ticket.id },
    data: { createdById: null, createdBySubjectRef: null },
  })
  await db.notification.deleteMany({ where: { resourceType: 'support_ticket', resourceId: ticket.id } })
  await db.supportTicket.update({
    where: { id: ticket.id },
    data: {
      requesterId: null,
      requesterSubjectRef: null,
      assignedToId: null,
      subject: supportRetentionContract.retainedSubject,
      details: supportRetentionContract.retainedBody,
      relatedResourceType: 'none',
      relatedResourceId: null,
      locale: 'en',
      dataRightsRedactedAt: ticket.dataRightsRedactedAt ?? now,
      retentionRedactedAt: now,
      version: { increment: 1 },
    },
  })
}

export const createPrismaSupportRetentionRepository = (client, { recordAudit }) => ({
  sweepRetention: async ({ now = new Date(), limit } = {}) => {
    const cutoffs = supportRetentionCutoffs(now)
    const take = supportRetentionSweepLimit(limit)
    const discovered = await discoverCandidates(client, cutoffs, take)
    if (discovered.length === 0) {
      return { policyId: supportRetentionContract.policyId, inspected: 0, messageBodiesRedacted: 0, ticketsMinimized: 0, blocked: 0 }
    }

    return client.$transaction(async (db) => {
      await lock(db, 'security-retention-legal-holds')
      for (const row of discovered) await lock(db, `support-ticket:${row.id}`)
      const initial = []
      for (const row of discovered) {
        const ticket = await loadTicket(db, row.id)
        if (ticket) initial.push(ticket)
      }
      for (const subjectRef of [...new Set(initial.flatMap(allSubjectRefs))].sort()) {
        await lock(db, `data-rights-subject-ref:${subjectRef}`)
      }

      let messageBodiesRedacted = 0
      let ticketsMinimized = 0
      let blocked = 0
      for (const row of discovered) {
        const ticket = await loadTicket(db, row.id)
        const disposition = supportRetentionDisposition(ticket, cutoffs)
        if (!disposition) continue
        if (await isBlocked(db, ticket, now)) {
          blocked += 1
          continue
        }
        if (disposition === 'redact_messages') {
          await redactMessages(db, ticket, now)
          messageBodiesRedacted += 1
          continue
        }
        await retainMinimalEvidence(db, ticket, now)
        ticketsMinimized += 1
      }

      await recordAudit({
        actor: null,
        action: 'system.support.retention_minimized',
        resourceType: 'support_retention',
        resourceId: supportRetentionContract.policyId,
        metadata: { inspected: discovered.length, messageBodiesRedacted, ticketsMinimized, blocked },
      }, db)
      return { policyId: supportRetentionContract.policyId, inspected: discovered.length, messageBodiesRedacted, ticketsMinimized, blocked }
    }, { isolationLevel: 'ReadCommitted' })
  },
})
