import assert from 'node:assert/strict'
import test from 'node:test'

import { runAuditRetentionWorkerOnce } from './auditRetentionWorker.js'

const now = new Date('2028-07-28T00:00:00.000Z')
const enabledSource = {
  AUDIT_RETENTION_DAYS: '730',
  AUDIT_RETENTION_BATCH_SIZE: '100',
  AUDIT_RETENTION_MIN_RETAINED: '1000',
  AUDIT_RETENTION_LEGAL_HOLD: 'false',
  AUDIT_RETENTION_PRUNE_ENABLED: 'true',
}
const prepared = {
  preview: {
    previewId: 'a'.repeat(64),
    cutoffAt: '2026-07-29T00:00:00.000Z',
    candidateCount: 2,
  },
  artifact: { schema: 'audit.retention-archive.v1', events: [{ id: 'audit-1' }, { id: 'audit-2' }] },
}
const disposition = {
  id: 'audit-retention-1',
  policyVersion: 'audit-retention-v1-730d',
  fromSequence: '1',
  toSequence: '2',
  eventCount: 2,
  archiveChecksumSha256: 'b'.repeat(64),
}

test('audit retention worker remains disabled under fail-closed policy defaults', async () => {
  let called = false
  const result = await runAuditRetentionWorkerOnce({
    repository: {
      retentionPreview: async () => { called = true },
      pruneRetention: async () => {},
      recordAttempt: async () => {},
    },
    source: {},
    now,
  })
  assert.deepEqual(result, {
    policyId: 'audit_event_plus_730d', status: 'disabled', inspected: 0, archived: 0, deleted: 0,
  })
  assert.equal(called, false)
})

test('audit retention worker archives a bounded prefix before prune and records system evidence', async () => {
  const calls = []
  const repository = {
    retentionPreview: async (policy, at) => {
      calls.push(['preview', policy.batchSize, at])
      return prepared
    },
    pruneRetention: async (payload) => {
      calls.push(['prune', payload])
      return { status: 'complete', disposition }
    },
    recordAttempt: async (payload) => {
      calls.push(['audit', payload])
    },
  }
  const archiveWriter = async (artifact, options) => {
    calls.push(['archive', artifact, options])
    return {
      provider: 's3', persisted: true, storageKey: options.storageKey, checksumSha256: 'b'.repeat(64), bytes: 512,
    }
  }

  const result = await runAuditRetentionWorkerOnce({ repository, source: enabledSource, now, archiveWriter })

  assert.deepEqual(result, {
    policyId: 'audit_event_plus_730d',
    status: 'complete',
    inspected: 2,
    archived: 2,
    deleted: 2,
    dispositionId: 'audit-retention-1',
  })
  assert.deepEqual(calls.map(([name]) => name), ['preview', 'archive', 'prune', 'audit'])
  assert.equal(calls[1][2].storageKey, `archives/audit-retention/2026-07-29/${'a'.repeat(64)}.json`)
  assert.equal(calls[2][1].actor.id, 'system-audit-retention')
  assert.equal(calls[3][1].action, 'system.audit.retention_executed')
})

test('audit retention worker refuses mock archives without pruning', async () => {
  let pruned = false
  await assert.rejects(
    runAuditRetentionWorkerOnce({
      repository: {
        retentionPreview: async () => prepared,
        pruneRetention: async () => { pruned = true },
        recordAttempt: async () => {},
      },
      source: enabledSource,
      now,
      archiveWriter: async () => ({ provider: 'mock', persisted: false }),
    }),
    (error) => error.code === 'AUDIT_RETENTION_ARCHIVE_NOT_DURABLE',
  )
  assert.equal(pruned, false)
})

test('audit retention worker treats snapshot drift as a retryable failed run', async () => {
  await assert.rejects(
    runAuditRetentionWorkerOnce({
      repository: {
        retentionPreview: async () => prepared,
        pruneRetention: async () => ({ status: 'preview_mismatch', disposition: null }),
        recordAttempt: async () => {},
      },
      source: enabledSource,
      now,
      archiveWriter: async (_artifact, options) => ({
        provider: 's3', persisted: true, storageKey: options.storageKey, checksumSha256: 'b'.repeat(64), bytes: 512,
      }),
    }),
    (error) => error.code === 'AUDIT_RETENTION_PREVIEW_STALE',
  )
})
