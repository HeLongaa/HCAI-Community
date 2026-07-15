import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeedReleaseRepository } from './seedReleaseRepository.js'
import {
  applyReleaseChange,
  approveReleaseChange,
  requestReleaseChange,
  rollbackReleaseChange,
} from './releaseControl.js'

const requester = { id: 'admin-a', handle: 'admin-a' }
const approver = { id: 'admin-b', handle: 'admin-b' }
const payload = {
  changeType: 'promotion',
  sourceEnvironment: 'staging',
  targetEnvironment: 'production',
  artifactVersion: 'sha-abc123',
  rollbackVersion: 'sha-previous',
  secretRef: null,
  secretVersion: null,
  summary: 'Promote release candidate',
  reasonCode: 'scheduled_release',
}

test('production release requires two-person approval and preserves append-only evidence through rollback', async () => {
  const repository = createSeedReleaseRepository()
  const requested = await requestReleaseChange({ payload, actor: requester, repository })
  assert.equal(requested.status, 'pending_approval')
  assert.equal(requested.evidence.length, 1)

  await assert.rejects(
    approveReleaseChange({ change: requested, payload: { reasonCode: 'self', note: '' }, actor: requester, repository }),
    /different approver/,
  )
  const approved = await approveReleaseChange({
    change: requested,
    payload: { reasonCode: 'review_passed', note: 'Checks green' },
    actor: approver,
    repository,
  })
  assert.equal(approved.status, 'approved')
  assert.equal(approved.approvedByRef, 'admin-b')

  const deployed = await applyReleaseChange({
    change: approved,
    payload: { outcome: 'deployed', deploymentId: 'deploy-1', evidenceUrl: 'https://ci.example/deploy-1', reasonCode: 'release_applied', note: '' },
    actor: requester,
    repository,
  })
  assert.equal(deployed.status, 'deployed')

  const rolledBack = await rollbackReleaseChange({
    change: deployed,
    payload: { deploymentId: 'rollback-1', evidenceUrl: 'https://ci.example/rollback-1', reasonCode: 'health_regression', note: '' },
    actor: approver,
    repository,
  })
  assert.equal(rolledBack.status, 'rolled_back')
  assert.equal(rolledBack.evidence.length, 4)
  assert.deepEqual(rolledBack.evidence.map((item) => item.eventType), ['requested', 'approved', 'deployed', 'rolled_back'])
  assert.ok(rolledBack.evidence.every((item) => /^[a-f0-9]{64}$/.test(item.evidenceHash)))
})

test('release transitions use optimistic version checks', async () => {
  const repository = createSeedReleaseRepository()
  const requested = await requestReleaseChange({ payload, actor: requester, repository })
  const approved = await approveReleaseChange({
    change: requested,
    payload: { reasonCode: 'review_passed', note: '' },
    actor: approver,
    repository,
  })
  const stale = await repository.transition(requested.id, requested.version, {
    status: 'rejected',
    evidence: approved.evidence.at(-1),
  })
  assert.equal(stale, null)
})
