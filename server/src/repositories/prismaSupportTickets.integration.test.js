import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma support tickets isolate owners, enforce CAS, persist messages, links, SLA, notifications, and audits', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const requesterSession = await repository.auth.registerEmailAccount({ email: `support-requester-${suffix}@example.test`, password: 'support-integration-password', displayName: 'Support Requester', handle: `sr${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-18)}` })
  const operatorSession = await repository.auth.registerEmailAccount({ email: `support-operator-${suffix}@example.test`, password: 'support-integration-password', displayName: 'Support Operator', handle: `so${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-18)}` })
  const requester = requesterSession.user
  const operator = operatorSession.user
  await repository.client.user.update({ where: { id: operator.id }, data: { role: 'admin' } })
  let ticketId = null
  let reviewId = null
  try {
    const ticket = await repository.support.create({ category: 'general_support', priority: 'normal', subject: `PostgreSQL support ${suffix}`, details: 'Restricted support details must not appear in audit metadata.', relatedResourceType: 'account', relatedResourceId: requester.id, locale: 'en' }, requester)
    ticketId = ticket.id
    assert.equal(ticket.status, 'open')
    assert.equal((await repository.support.find(ticket.id, operator)), null)
    assert.equal((await repository.support.list(requester, { cursor: null, limit: 20 })).items.length, 1)

    const initial = await repository.support.findAdmin(ticket.id)
    const attempts = await Promise.allSettled([
      repository.support.updateAdmin(ticket.id, { priority: 'urgent', status: null, assigneeUserId: operator.id, expectedVersion: initial.version, reasonCode: 'integration_assign_a' }, operator),
      repository.support.updateAdmin(ticket.id, { priority: 'urgent', status: null, assigneeUserId: operator.id, expectedVersion: initial.version, reasonCode: 'integration_assign_b' }, operator),
    ])
    assert.equal(attempts.filter((item) => item.status === 'fulfilled').length, 1)
    assert.equal(attempts.filter((item) => item.status === 'rejected' && item.reason?.code === 'VERSION_CONFLICT').length, 1)

    const assigned = await repository.support.findAdmin(ticket.id)
    const replied = await repository.support.addOperatorMessage(ticket.id, { message: 'Operator response stored in the dedicated message table.', expectedVersion: assigned.version, reasonCode: 'integration_response' }, operator)
    assert.equal(replied.status, 'in_progress')
    assert.equal(replied.messages.length, 1)
    assert.ok(replied.firstRespondedAt)

    reviewId = `support-review-${suffix}`
    await repository.client.adminReview.create({ data: { id: reviewId, queue: 'integration', status: 'Pending review', title: 'Linked review', owner: operator.handle, note: 'Lifecycle remains independent.' } })
    const linked = await repository.support.linkCase(ticket.id, { caseType: 'admin_review', caseId: reviewId, expectedVersion: replied.version, reasonCode: 'integration_link' }, operator)
    assert.equal(linked.caseLinks[0].caseId, reviewId)

    const listed = await repository.support.listAdmin({ cursor: null, limit: 20, status: 'in_progress', priority: 'urgent', category: null, assigneeUserId: operator.id, requesterHandle: requester.handle, search: ticket.id, slaState: null, sort: 'firstResponseDueAt', order: 'asc' })
    assert.equal(listed.items.length, 1)

    const lateResolution = new Date(new Date(linked.resolutionDueAt).getTime() + 60_000)
    await repository.client.supportTicket.update({ where: { id: ticket.id }, data: { status: 'resolved', resolvedAt: lateResolution, updatedAt: lateResolution } })
    const slaQuery = { cursor: null, limit: 20, status: null, priority: null, category: null, assigneeUserId: null, requesterHandle: null, search: ticket.id, sort: 'createdAt', order: 'desc' }
    assert.equal((await repository.support.listAdmin({ ...slaQuery, slaState: 'met' })).items.length, 0)
    assert.equal((await repository.support.listAdmin({ ...slaQuery, slaState: 'breached' })).items.length, 1)

    const metrics = await repository.support.metrics()
    assert.equal(metrics.total >= 1, true)
    assert.equal(metrics.averageFirstResponseMinutes >= 0, true)

    const persistedMessages = await repository.client.supportTicketMessage.count({ where: { ticketId: ticket.id } })
    const persistedLinks = await repository.client.supportTicketCaseLink.count({ where: { ticketId: ticket.id } })
    assert.equal(persistedMessages, 1)
    assert.equal(persistedLinks, 1)
    assert.equal(await repository.client.notification.count({ where: { recipientId: requester.id, resourceType: 'support_ticket', resourceId: ticket.id } }), 2)
    const audits = await repository.client.auditEvent.findMany({ where: { resourceType: 'support_ticket', resourceId: ticket.id } })
    assert.equal(audits.length >= 4, true)
    const auditMetadata = JSON.stringify(audits.map((event) => event.metadata))
    assert.equal(auditMetadata.includes('Restricted support details'), false)
    assert.equal(auditMetadata.includes('Operator response stored'), false)
  } finally {
    await repository.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      if (ticketId) {
        await transaction.notificationDelivery.deleteMany({ where: { notification: { resourceType: 'support_ticket', resourceId: ticketId } } })
        await transaction.notification.deleteMany({ where: { resourceType: 'support_ticket', resourceId: ticketId } })
        await transaction.supportTicketCaseLink.deleteMany({ where: { ticketId } })
        await transaction.supportTicketMessage.deleteMany({ where: { ticketId } })
        await transaction.supportTicket.deleteMany({ where: { id: ticketId } })
      }
      if (reviewId) await transaction.adminReview.deleteMany({ where: { id: reviewId } })
      await transaction.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: [requester.id, operator.id] } }, { resourceId: ticketId ?? '__none__' }] } })
      await transaction.refreshToken.deleteMany({ where: { userId: { in: [requester.id, operator.id] } } })
      await transaction.authSession.deleteMany({ where: { userId: { in: [requester.id, operator.id] } } })
      await transaction.user.deleteMany({ where: { id: { in: [requester.id, operator.id] } } })
    })
    await repository.client.$disconnect()
  }
})
