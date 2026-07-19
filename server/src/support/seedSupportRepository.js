import { randomUUID } from 'node:crypto'
import { HttpError } from '../common/errors/httpError.js'
import { assertSupportTransition, decodeSupportCursor, encodeSupportCursor, serializeSupportTicket, supportSlaDates, supportSlaState } from './supportOperations.js'

const activeStatuses = ['open', 'in_progress', 'waiting_on_user']

export const createSeedSupportRepository = ({ getUserById, recordAudit, notifyRequester, caseExists } = {}) => {
  const tickets = []
  const findRow = (id) => tickets.find((ticket) => ticket.id === String(id)) ?? null
  const touch = (ticket) => { ticket.version += 1; ticket.updatedAt = new Date() }
  const project = (ticket, includeDetails = true) => serializeSupportTicket(ticket, { includeDetails })

  return {
    create(payload, actor) {
      const now = new Date()
      const ticket = {
        id: `support-${randomUUID()}`, requesterId: actor.id, requester: actor,
        category: payload.category, status: 'open', priority: payload.priority,
        subject: payload.subject, details: payload.details, relatedResourceType: payload.relatedResourceType,
        relatedResourceId: payload.relatedResourceId, locale: payload.locale, assignedToId: null, assignedTo: null,
        ...supportSlaDates(payload.category, payload.priority, now), firstRespondedAt: null, resolvedAt: null, closedAt: null,
        version: 1, createdAt: now, updatedAt: now, messages: [], caseLinks: [],
      }
      tickets.unshift(ticket)
      recordAudit({ actor, action: 'support.ticket.created', resourceType: 'support_ticket', resourceId: ticket.id, metadata: { category: ticket.category, priority: ticket.priority, relatedResourceType: ticket.relatedResourceType } })
      return project(ticket)
    },
    find(id, actor) {
      const ticket = findRow(id)
      return ticket?.requesterId === actor.id ? project(ticket) : null
    },
    list(actor, options = {}) {
      const rows = tickets.filter((ticket) => ticket.requesterId === actor.id)
      const start = options.cursor ? Math.max(0, rows.findIndex((ticket) => ticket.id === options.cursor) + 1) : 0
      const page = rows.slice(start, start + options.limit)
      return { items: page.map((ticket) => project(ticket)), limit: options.limit, nextCursor: rows.length > start + options.limit ? page.at(-1)?.id ?? null : null }
    },
    addRequesterMessage(id, payload, actor) {
      const ticket = findRow(id)
      if (!ticket || ticket.requesterId !== actor.id) return null
      if (ticket.status === 'closed') throw new HttpError(409, 'SUPPORT_TICKET_CLOSED', 'Closed support tickets cannot receive messages')
      if (ticket.version !== payload.expectedVersion) throw new HttpError(409, 'VERSION_CONFLICT', 'Support ticket was modified concurrently')
      if (ticket.status === 'waiting_on_user') ticket.status = 'in_progress'
      ticket.messages.push({ id: `support-message-${randomUUID()}`, authorId: actor.id, author: actor, authorType: 'requester', body: payload.message, createdAt: new Date() })
      touch(ticket)
      recordAudit({ actor, action: 'support.ticket.requester_message_added', resourceType: 'support_ticket', resourceId: ticket.id, metadata: { reasonCode: payload.reasonCode, status: ticket.status } })
      return project(ticket)
    },
    listAdmin(query) {
      const search = query.search?.toLowerCase()
      const rows = tickets.filter((ticket) => {
        if (query.status && ticket.status !== query.status) return false
        if (query.priority && ticket.priority !== query.priority) return false
        if (query.category && ticket.category !== query.category) return false
        if (query.assigneeUserId && ticket.assignedToId !== query.assigneeUserId) return false
        if (query.requesterHandle && !String(ticket.requester?.handle ?? '').toLowerCase().includes(query.requesterHandle.toLowerCase())) return false
        if (query.slaState && supportSlaState(ticket) !== query.slaState) return false
        if (search && !`${ticket.id} ${ticket.subject} ${ticket.requester?.handle ?? ''}`.toLowerCase().includes(search)) return false
        return true
      }).sort((left, right) => {
        const a = left[query.sort] instanceof Date ? left[query.sort].getTime() : String(left[query.sort])
        const b = right[query.sort] instanceof Date ? right[query.sort].getTime() : String(right[query.sort])
        const compared = a < b ? -1 : a > b ? 1 : left.id.localeCompare(right.id)
        return query.order === 'asc' ? compared : -compared
      })
      const cursorId = decodeSupportCursor(query.cursor, query)?.id ?? null
      const start = cursorId ? Math.max(0, rows.findIndex((ticket) => ticket.id === cursorId) + 1) : 0
      const page = rows.slice(start, start + query.limit)
      const nextCursor = rows.length > start + query.limit && page.at(-1)
        ? encodeSupportCursor(query, page.at(-1))
        : null
      return { items: page.map((ticket) => project(ticket, false)), limit: query.limit, nextCursor }
    },
    findAdmin(id) {
      const ticket = findRow(id)
      return ticket ? project(ticket) : null
    },
    updateAdmin(id, payload, actor) {
      const ticket = findRow(id)
      if (!ticket) return null
      if (ticket.version !== payload.expectedVersion) throw new HttpError(409, 'VERSION_CONFLICT', 'Support ticket was modified concurrently')
      if (payload.status) assertSupportTransition(ticket.status, payload.status)
      if (payload.assigneeUserId) {
        const user = getUserById(payload.assigneeUserId)
        if (!user || !['moderator', 'admin'].includes(user.role)) throw new HttpError(422, 'SUPPORT_ASSIGNEE_INVALID', 'Support assignee must be an active moderator or administrator')
        ticket.assignedToId = user.id; ticket.assignedTo = user
      } else if (payload.assigneeUserId === null) {
        ticket.assignedToId = null; ticket.assignedTo = null
      }
      if (payload.priority && payload.priority !== ticket.priority) Object.assign(ticket, supportSlaDates(ticket.category, payload.priority, ticket.createdAt))
      if (payload.priority) ticket.priority = payload.priority
      if (payload.status) ticket.status = payload.status
      const now = new Date()
      ticket.resolvedAt = ['resolved', 'closed'].includes(ticket.status) ? ticket.resolvedAt ?? now : null
      ticket.closedAt = ticket.status === 'closed' ? ticket.closedAt ?? now : null
      touch(ticket)
      recordAudit({ actor, action: 'admin.support.ticket_updated', resourceType: 'support_ticket', resourceId: ticket.id, metadata: { status: ticket.status, priority: ticket.priority, assigneeUserId: ticket.assignedToId, reasonCode: payload.reasonCode, version: ticket.version } })
      notifyRequester?.(ticket.requester, ticket, 'support.ticket_updated')
      return project(ticket)
    },
    addOperatorMessage(id, payload, actor) {
      const ticket = findRow(id)
      if (!ticket) return null
      if (ticket.status === 'closed') throw new HttpError(409, 'SUPPORT_TICKET_CLOSED', 'Closed support tickets cannot receive messages')
      if (ticket.version !== payload.expectedVersion) throw new HttpError(409, 'VERSION_CONFLICT', 'Support ticket was modified concurrently')
      if (ticket.status === 'open') ticket.status = 'in_progress'
      ticket.firstRespondedAt ??= new Date()
      ticket.messages.push({ id: `support-message-${randomUUID()}`, authorId: actor.id, author: actor, authorType: 'operator', body: payload.message, createdAt: new Date() })
      touch(ticket)
      recordAudit({ actor, action: 'admin.support.message_added', resourceType: 'support_ticket', resourceId: ticket.id, metadata: { reasonCode: payload.reasonCode, status: ticket.status, version: ticket.version } })
      notifyRequester?.(ticket.requester, ticket, 'support.message_added')
      return project(ticket)
    },
    async linkCase(id, payload, actor) {
      const ticket = findRow(id)
      if (!ticket) return null
      if (ticket.version !== payload.expectedVersion) throw new HttpError(409, 'VERSION_CONFLICT', 'Support ticket was modified concurrently')
      if (ticket.caseLinks.some((link) => link.caseType === payload.caseType && link.caseId === payload.caseId)) throw new HttpError(409, 'SUPPORT_CASE_ALREADY_LINKED', 'Case is already linked to this support ticket')
      if (!await caseExists?.(payload.caseType, payload.caseId)) throw new HttpError(422, 'SUPPORT_CASE_NOT_FOUND', 'Linked case does not exist')
      ticket.caseLinks.push({ id: `support-link-${randomUUID()}`, caseType: payload.caseType, caseId: payload.caseId, createdAt: new Date() })
      touch(ticket)
      recordAudit({ actor, action: 'admin.support.case_linked', resourceType: 'support_ticket', resourceId: ticket.id, metadata: { caseType: payload.caseType, caseId: payload.caseId, reasonCode: payload.reasonCode } })
      return project(ticket)
    },
    metrics() {
      const now = new Date()
      const durations = tickets.filter((ticket) => ticket.firstRespondedAt).map((ticket) => ticket.firstRespondedAt.getTime() - ticket.createdAt.getTime())
      return { generatedAt: now.toISOString(), total: tickets.length, open: tickets.filter((ticket) => activeStatuses.includes(ticket.status)).length, unassigned: tickets.filter((ticket) => activeStatuses.includes(ticket.status) && !ticket.assignedToId).length, breached: tickets.filter((ticket) => supportSlaState(ticket, now) === 'breached').length, dueSoon: tickets.filter((ticket) => supportSlaState(ticket, now) === 'due_soon').length, resolved: tickets.filter((ticket) => ['resolved', 'closed'].includes(ticket.status)).length, averageFirstResponseMinutes: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length / 60000) : null, byStatus: Object.fromEntries(['open', 'in_progress', 'waiting_on_user', 'resolved', 'closed'].map((status) => [status, tickets.filter((ticket) => ticket.status === status).length])) }
    },
  }
}
