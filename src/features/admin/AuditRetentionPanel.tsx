import { ArchiveRestore, PlayCircle, RefreshCw } from 'lucide-react'
import { useState } from 'react'

import { textFor } from '../../domain/utils'
import { adminService } from '../../services/adminService'
import { useAsyncResource } from '../../hooks/useAsyncResource'
import type { AdminAuditRetentionPreviewDto, AdminAuditRetentionStatusDto } from '../../services/contracts'

type Props = {
  canRead: boolean
  canExecute: boolean
  isZh: boolean
  t: Record<string, string>
  onChanged: () => void
  notify: (message: string) => void
}

export function AuditRetentionPanel({ canRead, canExecute, isZh, t, onChanged, notify }: Props) {
  const [status, setStatus] = useState<AdminAuditRetentionStatusDto | null>(null)
  const [preview, setPreview] = useState<AdminAuditRetentionPreviewDto | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [executing, setExecuting] = useState(false)
  const statusResource = useAsyncResource<AdminAuditRetentionStatusDto | null>({
    load: () => canRead ? adminService.auditRetentionStatus() : Promise.resolve(null),
    onSuccess: setStatus,
    getErrorMessage: () => isZh ? '无法读取审计留存状态。' : 'Could not load audit retention status.',
    deps: [canRead, isZh],
    logLabel: 'admin-service',
  })

  const runPreview = async () => {
    setPreviewing(true)
    try {
      const next = await adminService.previewAuditRetention()
      setPreview(next)
      setConfirmation('')
    } catch (error) {
      console.info('[admin-service]', error)
      notify(isZh ? '无法生成留存预览。' : 'Could not preview audit retention.')
    } finally {
      setPreviewing(false)
    }
  }

  const execute = async () => {
    if (!preview?.confirmation || confirmation !== preview.confirmation) return
    setExecuting(true)
    try {
      await adminService.executeAuditRetention(preview.previewId, confirmation)
      setPreview(null)
      setConfirmation('')
      await statusResource.refresh()
      onChanged()
      notify(isZh ? '审计留存批次已完成。' : 'Audit retention batch completed.')
    } catch (error) {
      console.info('[admin-service]', error)
      notify(error instanceof Error ? error.message : (isZh ? '留存执行失败。' : 'Audit retention failed.'))
    } finally {
      setExecuting(false)
    }
  }

  if (!canRead) return null
  const policy = status?.policy
  return (
    <div className="audit-retention-panel" data-testid="audit-retention-panel">
      <div className="audit-retention-heading">
        <div>
          <strong>{textFor(t, 'Retention policy', '留存策略')}</strong>
          {policy && (
            <span>
              {policy.retentionDays}d · {textFor(t, 'Batch', '批次')} {policy.batchSize} · {textFor(t, 'Minimum retained', '最少保留')} {policy.minimumRetainedEvents}
            </span>
          )}
        </div>
        <div className="button-row compact-buttons">
          <button className="icon-button" type="button" onClick={() => void statusResource.refresh()} disabled={statusResource.loading} aria-label={textFor(t, 'Refresh retention status', '刷新留存状态')} title={textFor(t, 'Refresh retention status', '刷新留存状态')}>
            <RefreshCw size={17} />
          </button>
          <button className="ghost-button small" type="button" onClick={() => void runPreview()} disabled={previewing}>
            <ArchiveRestore size={17} />
            {textFor(t, 'Preview', '预览')}
          </button>
        </div>
      </div>
      {policy && (
        <div className="audit-retention-flags">
          <span className={policy.legalHold ? 'status-badge rejected' : 'status-badge completed'}>{textFor(t, 'Legal hold', '法务保留')}: {policy.legalHold ? 'ON' : 'OFF'}</span>
          <span className={policy.pruneEnabled ? 'status-badge completed' : 'status-badge pending'}>{textFor(t, 'Prune', '清理')}: {policy.pruneEnabled ? 'ON' : 'OFF'}</span>
        </div>
      )}
      {preview && (
        <div className="audit-retention-preview">
          <strong>{textFor(t, 'Eligible events', '可处理事件')}: {preview.candidateCount}</strong>
          <span>{preview.fromSequence ?? '-'} - {preview.toSequence ?? '-'} · {preview.cutoffAt.slice(0, 10)}</span>
          {preview.confirmation && (
            <div className="audit-retention-confirmation">
              <input aria-label={textFor(t, 'Retention confirmation', '留存确认文本')} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={preview.confirmation} disabled={!canExecute || !preview.executable || executing} />
              <button className="primary-button" type="button" onClick={() => void execute()} disabled={!canExecute || !preview.executable || executing || confirmation !== preview.confirmation}>
                <PlayCircle size={17} />
                {executing ? textFor(t, 'Executing', '执行中') : textFor(t, 'Execute batch', '执行批次')}
              </button>
            </div>
          )}
        </div>
      )}
      {status?.dispositions.slice(0, 5).map((item) => (
        <div className="audit-retention-disposition" key={item.id}>
          <strong>{item.eventCount} · #{item.fromSequence}-#{item.toSequence}</strong>
          <span>{item.archiveProvider} · {item.archiveChecksumSha256.slice(0, 12)} · {item.createdAt.slice(0, 10)}</span>
        </div>
      ))}
    </div>
  )
}
