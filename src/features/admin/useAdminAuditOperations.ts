import type { Dispatch, SetStateAction } from 'react'

import { adminService } from '../../services/adminService'
import type { AdminAuditArchiveManifestDto, AdminAuditIntegrityDto } from '../../services/contracts'
import type { AdminActionFeedbackMessage } from './AdminActionFeedback'

type Options = {
  isZh: boolean
  canVerify: boolean
  canArchive: boolean
  verifying: boolean
  archiving: boolean
  setIntegrity: Dispatch<SetStateAction<AdminAuditIntegrityDto | null>>
  setArchives: Dispatch<SetStateAction<AdminAuditArchiveManifestDto[]>>
  setVerifying: Dispatch<SetStateAction<boolean>>
  setArchiving: Dispatch<SetStateAction<boolean>>
  refreshAudit: () => Promise<void>
  setFeedback: Dispatch<SetStateAction<AdminActionFeedbackMessage | null>>
}

export function useAdminAuditOperations({
  isZh,
  canVerify,
  canArchive,
  verifying,
  archiving,
  setIntegrity,
  setArchives,
  setVerifying,
  setArchiving,
  refreshAudit,
  setFeedback,
}: Options) {
  const verifyIntegrity = async () => {
    if (!canVerify || verifying) return
    setVerifying(true)
    setFeedback(null)
    try {
      const result = await adminService.verifyAuditIntegrity()
      setIntegrity(result)
      setArchives(await adminService.auditArchives())
      setFeedback({
        kind: result.verified ? 'success' : 'error',
        text: result.verified
          ? (isZh ? '审计链完整。' : 'Audit chain is complete.')
          : (isZh ? '审计链验证失败。' : 'Audit chain verification failed.'),
      })
    } catch (error) {
      console.info('[admin-service]', error)
      setIntegrity({ status: 'unverifiable', verified: false, count: 0, rootHash: null, failures: [{ reason: 'request_failed' }] })
      setFeedback({ kind: 'error', text: error instanceof Error ? error.message : (isZh ? '无法验证审计链。' : 'Could not verify the audit chain.') })
    } finally {
      setVerifying(false)
    }
  }

  const archiveEvidence = async () => {
    if (!canArchive || archiving) return
    setArchiving(true)
    setFeedback(null)
    try {
      const result = await adminService.archiveAudit()
      setIntegrity(result.integrity)
      const manifest = result.manifest
      if (manifest) {
        setArchives((current) => [manifest, ...current.filter((item) => item.id !== manifest.id)])
      }
      void refreshAudit()
      setFeedback({ kind: 'success', text: isZh ? '已创建不可变归档清单。' : 'Created immutable archive manifest.' })
    } catch (error) {
      console.info('[admin-service]', error)
      setFeedback({ kind: 'error', text: error instanceof Error ? error.message : (isZh ? '创建审计归档失败。' : 'Could not create audit archive.') })
    } finally {
      setArchiving(false)
    }
  }

  return { actions: { verifyIntegrity, archiveEvidence } }
}
