import type { Dispatch, SetStateAction } from 'react'
import { RotateCcw } from 'lucide-react'

import { StatusBadge } from '../../components/ui/StatusBadge'
import type { AsyncResourceState } from '../../domain/types'
import { textFor } from '../../domain/utils'
import type { AdminCreativeGenerationExecution } from '../../services/contracts'

type Props = {
  t: Record<string, string>
  status: AsyncResourceState
  executions: AdminCreativeGenerationExecution[]
  reason: string
  errorCode: string
  recoveringExecutionId: string | null
  canRecover: boolean
  setReason: Dispatch<SetStateAction<string>>
  setErrorCode: Dispatch<SetStateAction<string>>
  formatTime: (value: string) => string
  onRecover: (executionId: string) => Promise<void>
}

export function AdminGenerationRecoveryPanel({
  t,
  status,
  executions,
  reason,
  errorCode,
  recoveringExecutionId,
  canRecover,
  setReason,
  setErrorCode,
  formatTime,
  onRecover,
}: Props) {
  return (
    <div className="admin-detail-panel" data-testid="admin-generation-recovery">
      <div>
        <strong>{textFor(t, 'Execution recovery', '执行恢复')}</strong>
      </div>
      <div className="permission-summary generation-mutation-controls">
        <label>
          <span>{textFor(t, 'Reason code', '原因代码')}</span>
          <input aria-label={textFor(t, 'Execution recovery reason', '执行恢复原因')} value={reason} onChange={(event) => setReason(event.target.value)} disabled={!canRecover || Boolean(recoveringExecutionId)} />
        </label>
        <label>
          <span>{textFor(t, 'Error code', '错误代码')}</span>
          <input aria-label={textFor(t, 'Execution recovery error', '执行恢复错误')} value={errorCode} onChange={(event) => setErrorCode(event.target.value)} disabled={!canRecover || Boolean(recoveringExecutionId)} />
        </label>
      </div>
      {status.error && <p>{status.error}</p>}
      {!status.loading && !status.error && executions.length === 0 && (
        <p>{textFor(t, 'No executions require recovery.', '暂无需要恢复的执行记录。')}</p>
      )}
      <div className="admin-table">
        {executions.map((execution) => (
          <div className="admin-row" key={execution.id}>
            <StatusBadge status="Recovery required" t={t} />
            <strong>{execution.generationId}</strong>
            <span>{execution.workspace}/{execution.mode} · @{execution.actorHandle ?? execution.actorId}</span>
            <small>{textFor(t, 'Lease expired', '租约过期')} {formatTime(execution.leaseExpiresAt)} · #{execution.attempt}</small>
            <button
              className="ghost-button"
              type="button"
              onClick={() => void onRecover(execution.id)}
              disabled={!canRecover || Boolean(recoveringExecutionId)}
              title={textFor(t, 'Mark execution failed after evidence review', '证据复核后标记执行失败')}
            >
              <RotateCcw size={16} aria-hidden="true" />
              {recoveringExecutionId === execution.id ? textFor(t, 'Recovering', '恢复中') : textFor(t, 'Resolve', '处置')}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
