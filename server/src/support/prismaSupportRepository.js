import { randomUUID } from 'node:crypto'
import { HttpError } from '../common/errors/httpError.js'
import {
  assertSupportTransition,
  decodeSupportCursor,
  encodeSupportCursor,
  serializeSupportTicket,
  supportSlaDates,
  supportSlaState,
} from './supportOperations.js'

const userSelect = { id: true, displayName: true, profile: { select: { handle: true } } }
const ticketInclude = {
  requester: { select: userSelect },
  assignedTo: { select: userSelect },
  messages: { include: { author: { select: userSelect } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  caseLinks: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
}
const conflict = (message = 'Support ticket was modified concurrently') => new HttpError(409, 'VERSION_CONFLICT', message)
const active = ['open', 'in_progress', 'waiting_on_user']

const whereFor = (query) => ({
  ...(query.status ? { status: query.status } : {}),
  ...(query.priority ? { priority: query.priority } : {}),
  ...(query.category ? { category: query.category } : {}),
  ...(query.assigneeUserId ? { assignedToId: query.assigneeUserId } : {}),
  ...(query.requesterHandle ? { requester: { profile: { handle: { contains: query.requesterHandle, mode: 'insensitive' } } } } : {}),
  ...(query.search ? { OR: [
    { id: { contains: query.search, mode: 'insensitive' } },
    { subject: { contains: query.search, mode: 'insensitive' } },
    { requester: { profile: { handle: { contains: query.search, mode: 'insensitive' } } } },
  ] } : {}),
})

const priorityOrder = (order) => order === 'asc' ? 'asc' : 'desc'
const orderByFor = (query) => query.sort === 'priority'
  ? [{ priority: priorityOrder(query.order) }, { id: query.order }]
  : [{ [query.sort]: query.order }, { id: query.order }]

export const createPrismaSupportRepository = (client, { runSerializableTransaction, recordAudit, notificationDeliveries } = {}) => {
  const find = (db, id, requesterId = null) => db.supportTicket.findFirst({
    where: { id: String(id), ...(requesterId ? { requesterId } : {}) },
    include: ticketInclude,
  })

  const notifyRequester = async (db, ticket, payload) => {
    const notification = await db.notification.create({ data: {
      id: `notification-support-${randomUUID()}`,
      recipientId: ticket.requesterId,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      resourceType: 'support_ticket',
      resourceId: ticket.id,
      metadata: { status: ticket.status, ticketId: ticket.id, target: { page: 'support', supportTicketId: ticket.id } },
    } })
    if (notificationDeliveries?.createForNotification) {
      await notificationDeliveries.createForNotification(notification, ticket.requester, db)
    }
  }

  return {
    create: async (payload, actor) => runSerializableTransaction(async (db) => {
      const now = new Date()
      const due = supportSlaDates(payload.category, payload.priority, now)
      const row = await db.supportTicket.create({ data: {
        requesterId: actor.id,
        category: payload.category,
        priority: payload.priority,
        subject: payload.subject,
        details: payload.details,
        relatedResourceType: payload.relatedResourceType,
        relatedResourceId: payload.relatedResourceId,
        locale: payload.locale,
        ...due,
      }, include: ticketInclude })
      await recordAudit({ actor, action: 'support.ticket.created', resourceType: 'support_ticket', resourceId: row.id, metadata: { category: row.category, priority: row.priority, relatedResourceType: row.relatedResourceType } }, db)
      return serializeSupportTicket(row)
    }),

    find: async (id, actor) => {
      const row = await find(client, id, actor.id)
      return row ? serializeSupportTicket(row) : null
    },

    list: async (actor, options = {}) => {
      const rows = await client.supportTicket.findMany({
        where: { requesterId: actor.id },
        include: ticketInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: options.limit + 1,
        ...(options.cursor ? { cursor: { id: String(options.cursor) }, skip: 1 } : {}),
      })
      const page = rows.slice(0, options.limit)
      return { items: page.map((row) => serializeSupportTicket(row)), limit: options.limit, nextCursor: rows.length > options.limit ? page.at(-1)?.id ?? null : null }
    },

    addRequesterMessage: async (id, payload, actor) => runSerializableTransaction(async (db) => {
      const current = await find(db, id, actor.id)
      if (!current) return null
      if (current.status === 'closed') throw new HttpError(409, 'SUPPORT_TICKET_CLOSED', 'Closed support tickets cannot receive messages')
      const nextStatus = current.status === 'waiting_on_user' ? 'in_progress' : current.status
      const changed = await db.supportTicket.updateMany({ where: { id: current.id, requesterId: actor.id, version: payload.expectedVersion, status: current.status }, data: { status: nextStatus, version: { increment: 1 } } })
      if (changed.count !== 1) throw conflict()
      await db.supportTicketMessage.create({ data: { ticketId: current.id, authorId: actor.id, authorType: 'requester', body: payload.message } })
      await recordAudit({ actor, action: 'support.ticket.requester_message_added', resourceType: 'support_ticket', resourceId: current.id, metadata: { reasonCode: payload.reasonCode, status: nextStatus } }, db)
      return serializeSupportTicket(await find(db, current.id, actor.id))
    }),

    listAdmin: async (query) => {
      const now = new Date()
      const decoded = decodeSupportCursor(query.cursor, query)
      const targetCount = query.limit + 1
      const batchSize = Math.max(50, query.limit * 2)
      const rows = []
      let cursorId = decoded?.id ?? null
      do {
        const batch = await client.supportTicket.findMany({
          where: whereFor(query), include: ticketInclude, orderBy: orderByFor(query), take: query.slaState ? batchSize : targetCount,
          ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
        })
        rows.push(...(query.slaState ? batch.filter((row) => supportSlaState(row, now) === query.slaState) : batch))
        cursorId = batch.at(-1)?.id ?? null
        if (batch.length < (query.slaState ? batchSize : targetCount) || !query.slaState) break
      } while (rows.length < targetCount)
      const page = rows.slice(0, query.limit)
      return { items: page.map((row) => serializeSupportTicket(row, { includeDetails: false, now })), limit: query.limit, nextCursor: rows.length > query.limit && page.at(-1) ? encodeSupportCursor(query, page.at(-1)) : null }
    },

    findAdmin: async (id) => {
      const row = await find(client, id)
      return row ? serializeSupportTicket(row) : null
    },

    updateAdmin: async (id, payload, actor) => runSerializableTransaction(async (db) => {
      const current = await find(db, id)
      if (!current) return null
      if (payload.status) assertSupportTransition(current.status, payload.status)
      let assignee = null
      if (payload.assigneeUserId) {
        assignee = await db.user.findFirst({ where: { id: payload.assigneeUserId, role: { in: ['moderator', 'admin'] }, status: 'active' }, select: userSelect })
        if (!assignee) throw new HttpError(422, 'SUPPORT_ASSIGNEE_INVALID', 'Support assignee must be an active moderator or administrator')
      }
      const now = new Date()
      const nextStatus = payload.status ?? current.status
      const nextPriority = payload.priority ?? current.priority
      const due = nextPriority !== current.priority ? supportSlaDates(current.category, nextPriority, current.createdAt) : {}
      const data = {
        ...(payload.status ? { status: payload.status } : {}),
        ...(payload.priority ? { priority: payload.priority, ...due } : {}),
        ...(payload.assigneeUserId !== undefined ? { assignedToId: payload.assigneeUserId } : {}),
        resolvedAt: ['resolved', 'closed'].includes(nextStatus) ? current.resolvedAt ?? now : null,
        closedAt: nextStatus === 'closed' ? current.closedAt ?? now : null,
        version: { increment: 1 },
      }
      const changed = await db.supportTicket.updateMany({ where: { id: current.id, version: payload.expectedVersion, status: current.status }, data })
      if (changed.count !== 1) throw conflict()
      const updated = await find(db, current.id)
      await recordAudit({ actor, action: 'admin.support.ticket_updated', resourceType: 'support_ticket', resourceId: current.id, metadata: { fromStatus: current.status, status: updated.status, priority: updated.priority, assigneeUserId: updated.assignedToId, reasonCode: payload.reasonCode, version: updated.version } }, db)
      await notifyRequester(db, updated, { type: 'support.ticket_updated', title: `Support ticket ${updated.status.replaceAll('_', ' ')}`, body: `Your support request "${updated.subject}" was updated.` })
      return serializeSupportTicket(updated)
    }),

    addOperatorMessage: async (id, payload, actor) => runSerializableTransaction(async (db) => {
      const current = await find(db, id)
      if (!current) return null
      if (current.status === 'closed') throw new HttpError(409, 'SUPPORT_TICKET_CLOSED', 'Closed support tickets cannot receive messages')
      const now = new Date()
      const nextStatus = current.status === 'open' ? 'in_progress' : current.status
      const changed = await db.supportTicket.updateMany({ where: { id: current.id, version: payload.expectedVersion, status: current.status }, data: { status: nextStatus, firstRespondedAt: current.firstRespondedAt ?? now, version: { increment: 1 } } })
      if (changed.count !== 1) throw conflict()
      await db.supportTicketMessage.create({ data: { ticketId: current.id, authorId: actor.id, authorType: 'operator', body: payload.message } })
      const updated = await find(db, current.id)
      await recordAudit({ actor, action: 'admin.support.message_added', resourceType: 'support_ticket', resourceId: current.id, metadata: { reasonCode: payload.reasonCode, status: updated.status, version: updated.version } }, db)
      await notifyRequester(db, updated, { type: 'support.message_added', title: 'Support replied', body: `A support operator replied to "${updated.subject}".` })
      return serializeSupportTicket(updated)
    }),

    linkCase: async (id, payload, actor) => runSerializableTransaction(async (db) => {
      const current = await find(db, id)
      if (!current) return null
      if (current.version !== payload.expectedVersion) throw conflict()
      const exists = payload.caseType === 'admin_review'
        ? await db.adminReview.findUnique({ where: { id: payload.caseId }, select: { id: true } })
        : await db.moderationCase.findUnique({ where: { id: payload.caseId }, select: { id: true } })
      if (!exists) throw new HttpError(422, 'SUPPORT_CASE_NOT_FOUND', 'Linked case does not exist')
      try {
        await db.supportTicketCaseLink.create({ data: { ticketId: current.id, caseType: payload.caseType, caseId: payload.caseId, createdById: actor.id } })
      } catch (error) {
        if (error?.code === 'P2002') throw new HttpError(409, 'SUPPORT_CASE_ALREADY_LINKED', 'Case is already linked to this support ticket')
        throw error
      }
      const changed = await db.supportTicket.updateMany({ where: { id: current.id, version: payload.expectedVersion }, data: { version: { increment: 1 } } })
      if (changed.count !== 1) throw conflict()
      await recordAudit({ actor, action: 'admin.support.case_linked', resourceType: 'support_ticket', resourceId: current.id, metadata: { caseType: payload.caseType, caseId: payload.caseId, reasonCode: payload.reasonCode } }, db)
      return serializeSupportTicket(await find(db, current.id))
    }),

    metrics: async () => {
      const now = new Date()
      const rows = await client.supportTicket.findMany({ select: { status: true, priority: true, assignedToId: true, firstResponseDueAt: true, resolutionDueAt: true, firstRespondedAt: true, resolvedAt: true, closedAt: true, createdAt: true, updatedAt: true } })
      const firstResponseDurations = rows.filter((row) => row.firstRespondedAt).map((row) => row.firstRespondedAt.getTime() - row.createdAt.getTime())
      return {
        generatedAt: now.toISOString(), total: rows.length,
        open: rows.filter((row) => active.includes(row.status)).length,
        unassigned: rows.filter((row) => active.includes(row.status) && !row.assignedToId).length,
        breached: rows.filter((row) => supportSlaState(row, now) === 'breached').length,
        dueSoon: rows.filter((row) => supportSlaState(row, now) === 'due_soon').length,
        resolved: rows.filter((row) => ['resolved', 'closed'].includes(row.status)).length,
        averageFirstResponseMinutes: firstResponseDurations.length ? Math.round(firstResponseDurations.reduce((sum, value) => sum + value, 0) / firstResponseDurations.length / 60000) : null,
        byStatus: Object.fromEntries(['open', 'in_progress', 'waiting_on_user', 'resolved', 'closed'].map((status) => [status, rows.filter((row) => row.status === status).length])),
      }
    },
  }
}
