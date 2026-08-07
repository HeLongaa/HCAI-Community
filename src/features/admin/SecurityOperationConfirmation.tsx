import { textFor } from '../../domain/utils'
import type { AdminSecurityAlertDto, AdminSecurityEventDto, AdminSecurityIncidentDto, ApiMediaScanAlert } from '../../services/contracts'
import { AdminOperationConfirmation } from './AdminOperationConfirmation'

export type PendingSecurityOperation =
  | { kind: 'open-incident'; event: AdminSecurityEventDto }
  | { kind: 'resolve-incident'; incident: AdminSecurityIncidentDto }
  | { kind: 'silence-security-alert'; alert: AdminSecurityAlertDto }
  | { kind: 'silence-scan-alert'; alert: ApiMediaScanAlert }
  | { kind: 'rollback-media-policy'; eventId: string }

const operationTarget = (operation: PendingSecurityOperation) => {
  switch (operation.kind) {
    case 'open-incident': return operation.event.type
    case 'resolve-incident': return operation.incident.id
    case 'silence-security-alert': return operation.alert.title
    case 'silence-scan-alert': return operation.alert.title
    case 'rollback-media-policy': return operation.eventId
  }
}

export function SecurityOperationConfirmation({
  t,
  operation,
  reason,
  criticalConfirmed,
  busy,
  onReasonChange,
  onCriticalChange,
  onConfirm,
  onCancel,
}: {
  t: Record<string, string>
  operation: PendingSecurityOperation
  reason: string
  criticalConfirmed: boolean
  busy: boolean
  onReasonChange: (reason: string) => void
  onCriticalChange: (critical: boolean) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  const copy = {
    'open-incident': {
      title: textFor(t, 'Open a security incident?', '创建安全事故？'),
      description: textFor(t, 'The event will enter the incident ledger and become part of the audit evidence chain.', '该事件将进入事故台账并成为审计证据链的一部分。'),
      confirm: textFor(t, 'Open incident', '确认创建事故'),
    },
    'resolve-incident': {
      title: textFor(t, 'Resolve this incident?', '关闭此安全事故？'),
      description: textFor(t, 'The incident will become read-only at its current version. Related events remain available.', '事故将在当前版本转为只读，关联事件仍会保留。'),
      confirm: textFor(t, 'Resolve incident', '确认关闭事故'),
    },
    'silence-security-alert': {
      title: textFor(t, 'Silence this security alert for 24 hours?', '静默此安全告警 24 小时？'),
      description: textFor(t, 'Matching events will continue to be recorded, but operator notifications will be suppressed.', '匹配事件仍会记录，但运营提醒将在静默期内被抑制。'),
      confirm: textFor(t, 'Silence 24h', '确认静默 24 小时'),
    },
    'silence-scan-alert': {
      title: textFor(t, 'Silence this scan alert for 24 hours?', '静默此扫描告警 24 小时？'),
      description: textFor(t, 'Scanner evidence continues to accumulate while repeated operator notifications are suppressed.', '扫描证据会继续累积，但重复运营提醒将在静默期内被抑制。'),
      confirm: textFor(t, 'Silence 24h', '确认静默 24 小时'),
    },
    'rollback-media-policy': {
      title: textFor(t, 'Rollback to this policy version?', '回滚到此策略版本？'),
      description: textFor(t, 'Runtime scanning, retention, and alert thresholds may change immediately after rollback.', '回滚后扫描、保留和告警阈值可能立即变化。'),
      confirm: textFor(t, 'Confirm rollback', '确认回滚'),
    },
  }[operation.kind]
  const requiresReason = operation.kind !== 'rollback-media-policy'

  return (
    <AdminOperationConfirmation
      ariaLabel={textFor(t, 'Confirm security operation', '确认安全操作')}
      title={copy.title}
      description={`${operationTarget(operation)} · ${copy.description}`}
      confirmLabel={busy ? textFor(t, 'Saving', '保存中') : copy.confirm}
      cancelLabel={textFor(t, 'Cancel', '取消')}
      onConfirm={onConfirm}
      onCancel={onCancel}
      busy={busy}
      confirmDisabled={requiresReason && !reason.trim()}
    >
      {requiresReason && (
        <label className="admin-confirmation-field">
          <span>{operation.kind === 'resolve-incident' ? textFor(t, 'Resolution reason code', '关闭原因代码') : textFor(t, 'Reason code', '原因代码')}</span>
          <input value={reason} onChange={(event) => onReasonChange(event.target.value)} disabled={busy} autoFocus />
        </label>
      )}
      {operation.kind === 'open-incident' && (
        <label className="admin-confirmation-checkbox">
          <input type="checkbox" checked={criticalConfirmed} onChange={(event) => onCriticalChange(event.target.checked)} disabled={busy} />
          <span>{textFor(t, 'Confirmed critical incident', '已确认属于重大安全事故')}</span>
        </label>
      )}
    </AdminOperationConfirmation>
  )
}
