import assert from 'node:assert/strict'
import test from 'node:test'

import {
  listTemporaryAuthorizations,
  requestHighRiskApproval,
  resolveHighRiskApproval,
  reviewBreakGlassAccess,
  startBreakGlassAccess,
} from './highRiskAccess.js'
import { createSeedRepository } from '../repositories/seedRepository.js'

test('high-risk approvals require a different approver and grant temporary authorization', async () => {
  const repositories = createSeedRepository()
  const requester = { handle: 'opsplus' }
  const approver = { handle: 'legalpixel' }
  const requested = await requestHighRiskApproval({
    repositories,
    actor: requester,
    payload: {
      action: 'provider_cost_repair',
      resourceType: 'accounting_reconciliation_issue',
      resourceId: 'issue-1',
      permissionId: 'admin:high-risk:approve',
      reasonCode: 'incident_response',
      reason: 'Repair incident.',
      temporaryAuthorizationTtlMinutes: 10,
    },
  })

  await assert.rejects(
    () => resolveHighRiskApproval({
      repositories,
      review: requested.review,
      action: { decision: 'approve', note: 'self approve' },
      actor: requester,
    }),
    /different approver/,
  )

  const resolved = await resolveHighRiskApproval({
    repositories,
    review: requested.review,
    action: { decision: 'approve', note: 'approved' },
    actor: approver,
  })

  assert.equal(resolved.review.decision, 'approve')
  assert.equal(resolved.temporaryAuthorization.status, 'active')
  assert.equal(resolved.temporaryAuthorization.grantedBy, 'legalpixel')
  assert.ok(listTemporaryAuthorizations().some((authorization) => authorization.id === resolved.temporaryAuthorization.id))
})

test('break-glass access is temporary and requires post-review by a different actor', () => {
  const access = startBreakGlassAccess({
    actor: { handle: 'opsplus' },
    payload: {
      permissionId: 'admin:break-glass',
      resourceType: 'security_alert',
      resourceId: 'alert-1',
      reasonCode: 'security_incident',
      reason: 'Emergency containment.',
      ttlMinutes: 5,
    },
  })

  assert.equal(access.status, 'active')
  assert.ok(access.expiresAt)
  assert.throws(
    () => reviewBreakGlassAccess({
      id: access.id,
      actor: { handle: 'opsplus' },
      action: { decision: 'approve', note: 'self review' },
    }),
    /different reviewer/,
  )

  const reviewed = reviewBreakGlassAccess({
    id: access.id,
    actor: { handle: 'legalpixel' },
    action: { decision: 'approve', note: 'reasonable emergency use' },
  })
  assert.equal(reviewed.status, 'reviewed')
  assert.equal(reviewed.reviewedBy, 'legalpixel')
})
