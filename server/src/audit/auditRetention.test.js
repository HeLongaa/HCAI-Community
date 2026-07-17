import assert from 'node:assert/strict'
import test from 'node:test'

import { appendSeedAuditIntegrity, verifySeedAuditChain } from './auditIntegrity.js'
import {
  buildAuditRetentionArtifact,
  buildAuditRetentionPolicy,
  buildAuditRetentionPreview,
  projectAuditDiff,
  safeAuditValue,
} from './auditRetention.js'

const chainedEvents = (count) => {
  const events = []
  for (let index = 0; index < count; index += 1) {
    events.push(appendSeedAuditIntegrity({
      id: `event-${index + 1}`,
      actorType: index % 2 ? 'system' : 'user',
      actorId: index % 2 ? null : 'admin-1',
      action: 'audit.test',
      resourceType: 'test_resource',
      resourceId: `resource-${index + 1}`,
      metadata: { index },
      createdAt: `2020-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    }, events.at(-1) ?? null))
  }
  return events
}

test('audit retention policy fails closed and validates bounded overrides', () => {
  assert.deepEqual(buildAuditRetentionPolicy({}), {
    schema: 'audit.retention-policy.v1',
    version: 'audit-retention-v1-730d',
    retentionDays: 730,
    batchSize: 100,
    minimumRetainedEvents: 1000,
    legalHold: true,
    pruneEnabled: false,
    executable: false,
  })
  const enabled = buildAuditRetentionPolicy({
    AUDIT_RETENTION_DAYS: '30',
    AUDIT_RETENTION_BATCH_SIZE: '2',
    AUDIT_RETENTION_MIN_RETAINED: '1',
    AUDIT_RETENTION_LEGAL_HOLD: 'false',
    AUDIT_RETENTION_PRUNE_ENABLED: 'true',
  })
  assert.equal(enabled.executable, true)
  assert.equal(enabled.batchSize, 2)
})

test('retention preview selects only a bounded contiguous expired prefix and creates a portable archive', () => {
  const events = chainedEvents(4)
  const policy = buildAuditRetentionPolicy({
    AUDIT_RETENTION_DAYS: '30',
    AUDIT_RETENTION_BATCH_SIZE: '2',
    AUDIT_RETENTION_MIN_RETAINED: '1',
    AUDIT_RETENTION_LEGAL_HOLD: 'false',
    AUDIT_RETENTION_PRUNE_ENABLED: 'true',
  })
  const result = buildAuditRetentionPreview({ events, policy, now: new Date('2026-07-17T12:00:00.000Z') })
  assert.equal(result.preview.candidateCount, 2)
  assert.equal(result.preview.fromSequence, '1')
  assert.equal(result.preview.toSequence, '2')
  assert.equal(result.preview.executable, true)
  assert.equal(result.preview.confirmation, 'PRUNE 2 EVENTS THROUGH 2')
  const artifact = buildAuditRetentionArtifact(result)
  assert.equal(artifact.schema, 'audit.retention-archive.v1')
  assert.deepEqual(artifact.events.map((item) => item.sequence), ['1', '2'])
  assert.equal(verifySeedAuditChain(events.slice(2), { anchor: { toSequence: '2', rootHash: events[1].contentHash } }).verified, true)
})

test('generic audit projection exposes bounded changes and redacts sensitive values', () => {
  const metadata = {
    before: { enabled: false, nested: { label: 'old' }, providerId: 'private-provider' },
    after: { enabled: true, nested: { label: 'new' }, providerId: 'private-provider-2' },
    callbackUrl: 'https://private.example/callback',
  }
  assert.deepEqual(projectAuditDiff(metadata), {
    source: 'before_after',
    changes: [
      { path: 'enabled', before: false, after: true },
      { path: 'nested.label', before: 'old', after: 'new' },
    ],
  })
  const safe = safeAuditValue(metadata)
  assert.equal(safe.callbackUrl, '<redacted>')
  assert.equal(safe.before.providerId, '<redacted>')
  assert.equal(JSON.stringify(safe).includes('private.example'), false)
})
