import { buildAuditRetentionPolicy } from './auditRetention.js'
import { writeJsonArchive } from '../storage/archiveWriter.js'

const workerActor = Object.freeze({
  id: 'system-audit-retention',
  handle: 'audit-retention-worker',
  role: 'system',
})

const retentionError = (code, message) => Object.assign(new Error(message), { code })

export const runAuditRetentionWorkerOnce = async ({
  repository,
  source = process.env,
  now = new Date(),
  archiveWriter = writeJsonArchive,
} = {}) => {
  if (!repository?.retentionPreview || !repository?.pruneRetention || !repository?.recordAttempt) {
    throw retentionError('AUDIT_RETENTION_REPOSITORY_UNAVAILABLE', 'audit retention repository is unavailable')
  }
  const policy = buildAuditRetentionPolicy(source)
  if (!policy.executable) {
    return { policyId: 'audit_event_plus_730d', status: 'disabled', inspected: 0, archived: 0, deleted: 0 }
  }

  const prepared = await repository.retentionPreview(policy, now)
  if (!prepared.preview.candidateCount) {
    return { policyId: 'audit_event_plus_730d', status: 'empty', inspected: 0, archived: 0, deleted: 0 }
  }

  const storageKey = `archives/audit-retention/${prepared.preview.cutoffAt.slice(0, 10)}/${prepared.preview.previewId}.json`
  const archive = await archiveWriter(prepared.artifact, { storageKey, source, now })
  if (!archive?.persisted || archive.provider === 'mock') {
    throw retentionError('AUDIT_RETENTION_ARCHIVE_NOT_DURABLE', 'audit retention requires durable non-mock archive storage')
  }

  const result = await repository.pruneRetention({
    actor: workerActor,
    policy,
    previewId: prepared.preview.previewId,
    archive,
    now,
  })
  if (result.status !== 'complete' || !result.disposition) {
    throw retentionError(
      result.status === 'preview_mismatch' ? 'AUDIT_RETENTION_PREVIEW_STALE' : 'AUDIT_RETENTION_NOT_EXECUTED',
      `audit retention did not complete: ${result.status}`,
    )
  }

  await repository.recordAttempt({
    actor: workerActor,
    action: 'system.audit.retention_executed',
    resourceType: 'audit_retention_disposition',
    resourceId: result.disposition.id,
    metadata: {
      policyVersion: result.disposition.policyVersion,
      fromSequence: result.disposition.fromSequence,
      toSequence: result.disposition.toSequence,
      eventCount: result.disposition.eventCount,
      archiveChecksumSha256: result.disposition.archiveChecksumSha256,
    },
  })

  return {
    policyId: 'audit_event_plus_730d',
    status: 'complete',
    inspected: prepared.preview.candidateCount,
    archived: prepared.preview.candidateCount,
    deleted: result.disposition.eventCount,
    dispositionId: result.disposition.id,
  }
}
