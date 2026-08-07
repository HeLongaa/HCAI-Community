import { HttpError } from '../common/errors/httpError.js'
import { deleteStorageObject } from '../storage/objectStore.js'
import { dataRightsEvidenceHash } from './dataRightsLifecycle.js'

const exportStorageKeyPattern = /^exports\/data-rights\/subject_[a-f0-9]{24}\/[A-Za-z0-9_-]{1,160}\.json$/

export const deleteDataRightsExportObject = async (artifact, options = {}) => {
  const storageKey = String(artifact?.storageKey ?? '')
  if (!exportStorageKeyPattern.test(storageKey)) {
    throw new HttpError(409, 'DATA_EXPORT_STORAGE_KEY_INVALID', 'Data export artifact storage key is outside the retention namespace')
  }

  const deleted = await (options.deleteObject ?? deleteStorageObject)({ storageKey }, {
    now: options.now,
    source: options.source,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  })
  const evidence = {
    artifactId: artifact.id,
    requestId: artifact.requestId,
    checksumSha256: artifact.checksumSha256,
    expiresAt: artifact.expiresAt?.toISOString?.() ?? artifact.expiresAt,
    provider: deleted.provider,
    statusCode: deleted.statusCode,
    deletedAt: deleted.deletedAt,
  }
  return {
    provider: deleted.provider,
    statusCode: deleted.statusCode,
    deletedAt: deleted.deletedAt,
    receiptHash: dataRightsEvidenceHash(evidence),
  }
}
