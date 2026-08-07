import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { dataRightsSafeSubjectRef } from '../dataRights/dataRightsLifecycle.js'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma support retention minimizes closed tickets and preserves legal and data-rights blockers', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const now = new Date('2029-07-28T00:00:00.000Z')
  const old = new Date('2026-01-01T00:00:00.000Z')
  const messageOnly = new Date('2028-01-01T00:00:00.000Z')
  const userIds = {
    eligible: `support-retention-eligible-${suffix}`,
    messageOnly: `support-retention-message-${suffix}`,
    held: `support-retention-held-${suffix}`,
    rights: `support-retention-rights-${suffix}`,
    operator: `support-retention-operator-${suffix}`,
  }
  const ticketIds = Object.fromEntries(Object.entries(userIds).filter(([key]) => key !== 'operator').map(([key]) => [key, `support-ticket-${key}-${suffix}`]))
  const ids = {
    hold: `support-retention-hold-${suffix}`,
    rightsRequest: `support-retention-request-${suffix}`,
  }
  const subjectRef = (id) => dataRightsSafeSubjectRef(id)
  const createTicket = async (key, closedAt) => {
    const ticketId = ticketIds[key]
    await repository.client.supportTicket.create({ data: {
      id: ticketId,
      requesterId: userIds[key],
      requesterSubjectRef: subjectRef(userIds[key]),
      category: 'general_support',
      status: 'closed',
      priority: 'normal',
      subject: `Private support subject ${key}`,
      details: `Private support details ${key}`,
      relatedResourceType: 'account',
      relatedResourceId: userIds[key],
      locale: 'zh',
      assignedToId: userIds.operator,
      firstResponseDueAt: old,
      resolutionDueAt: old,
      firstRespondedAt: old,
      resolvedAt: closedAt,
      closedAt,
      createdAt: old,
      updatedAt: closedAt,
    } })
    await repository.client.supportTicketMessage.create({ data: {
      id: `${ticketId}-message`, ticketId, authorId: userIds[key], authorSubjectRef: subjectRef(userIds[key]),
      authorType: 'requester', body: `Private support message ${key}`, createdAt: old,
    } })
    await repository.client.supportTicketCaseLink.create({ data: {
      id: `${ticketId}-link`, ticketId, caseType: 'admin_review', caseId: `retained-case-${key}`,
      createdById: userIds.operator, createdBySubjectRef: subjectRef(userIds.operator), createdAt: old,
    } })
  }

  try {
    await repository.client.user.createMany({ data: Object.entries(userIds).map(([key, id]) => ({
      id,
      displayName: `Support retention ${key}`,
      role: key === 'operator' ? 'admin' : 'creator',
    })) })
    await createTicket('eligible', old)
    await createTicket('messageOnly', messageOnly)
    await createTicket('held', old)
    await createTicket('rights', old)
    await repository.client.dataRightsLegalHold.create({ data: {
      id: ids.hold,
      subjectId: userIds.held,
      subjectRef: subjectRef(userIds.held),
      scopeDomain: 'support',
      reasonCode: 'retention_fixture',
      authorityRole: 'legal_hold_admin',
      authorityReferenceHash: 'a'.repeat(64),
      ownerRef: `actor_${'b'.repeat(24)}`,
      reviewAt: new Date(now.getTime() + 86_400_000),
      expiresAt: new Date(now.getTime() + 7 * 86_400_000),
    } })
    await repository.client.dataRightsRequest.create({ data: {
      id: ids.rightsRequest,
      subjectId: userIds.rights,
      subjectRef: subjectRef(userIds.rights),
      requestType: 'data_export',
      status: 'processing',
      reasonCode: 'retention_fixture',
      identityMethod: 'session_reauthentication',
      identityVerifiedAt: old,
      dueAt: new Date(now.getTime() + 30 * 86_400_000),
      createdAt: old,
      updatedAt: old,
    } })

    const result = await repository.supportRetention.sweepRetention({ now, limit: 10 })
    assert.deepEqual(result, { policyId: 'support_close_plus_730d', inspected: 4, messageBodiesRedacted: 1, ticketsMinimized: 1, blocked: 2 })

    const eligible = await repository.client.supportTicket.findUnique({ where: { id: ticketIds.eligible }, include: { messages: true, caseLinks: true } })
    assert.equal(eligible.requesterId, null)
    assert.equal(eligible.requesterSubjectRef, null)
    assert.equal(eligible.assignedToId, null)
    assert.equal(eligible.subject, '[retained support record]')
    assert.equal(eligible.details, '[redacted after retention]')
    assert.equal(eligible.relatedResourceId, null)
    assert.equal(eligible.retentionRedactedAt.toISOString(), now.toISOString())
    assert.equal(eligible.messages[0].body, '[redacted after retention]')
    assert.equal(eligible.messages[0].authorId, null)
    assert.equal(eligible.messages[0].authorSubjectRef, null)
    assert.equal(eligible.caseLinks.length, 1)
    assert.equal(eligible.caseLinks[0].caseId, 'retained-case-eligible')
    assert.equal(eligible.caseLinks[0].createdById, null)
    assert.equal(eligible.caseLinks[0].createdBySubjectRef, null)

    const bodyOnly = await repository.client.supportTicket.findUnique({ where: { id: ticketIds.messageOnly }, include: { messages: true, caseLinks: true } })
    assert.equal(bodyOnly.requesterId, userIds.messageOnly)
    assert.equal(bodyOnly.messages[0].body, '[redacted after retention]')
    assert.equal(bodyOnly.messages[0].authorId, userIds.messageOnly)
    assert.equal(bodyOnly.caseLinks[0].createdById, userIds.operator)
    assert.equal(bodyOnly.retentionMessageRedactedAt.toISOString(), now.toISOString())
    assert.equal(bodyOnly.retentionRedactedAt, null)

    assert.equal((await repository.client.supportTicket.findUnique({ where: { id: ticketIds.held } })).retentionRedactedAt, null)
    assert.equal((await repository.client.supportTicket.findUnique({ where: { id: ticketIds.rights } })).retentionRedactedAt, null)
    const retainedDto = await repository.support.findAdmin(ticketIds.eligible)
    await assert.rejects(
      repository.support.updateAdmin(ticketIds.eligible, { status: null, priority: 'urgent', assigneeUserId: null, expectedVersion: retainedDto.version, reasonCode: 'illegal_retained_update' }, { id: userIds.operator }),
      (error) => error?.statusCode === 409 && error?.code === 'SUPPORT_TICKET_RETAINED',
    )
  } finally {
    await repository.client.$transaction(async (db) => {
      await db.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await db.$executeRawUnsafe("SET LOCAL app.data_rights_maintenance = 'on'")
      await db.dataRightsRequest.deleteMany({ where: { id: ids.rightsRequest } })
      await db.dataRightsLegalHoldEvent.deleteMany({ where: { legalHoldId: ids.hold } })
      await db.dataRightsLegalHold.deleteMany({ where: { id: ids.hold } })
      await db.supportTicketCaseLink.deleteMany({ where: { ticketId: { in: Object.values(ticketIds) } } })
      await db.supportTicketMessage.deleteMany({ where: { ticketId: { in: Object.values(ticketIds) } } })
      await db.supportTicket.deleteMany({ where: { id: { in: Object.values(ticketIds) } } })
      await db.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: Object.values(userIds) } }, { resourceType: 'support_retention' }] } })
      await db.user.deleteMany({ where: { id: { in: Object.values(userIds) } } })
    })
    await repository.client.$disconnect()
  }
})
