import type { Dispatch, SetStateAction } from 'react'

import { SectionHeader } from '../../components/ui/SectionHeader'
import { StatusBadge } from '../../components/ui/StatusBadge'
import type { AsyncResourceState } from '../../domain/types'
import { textFor } from '../../domain/utils'
import type { AdminProviderControlBundle, AdminProviderControlRecoveryTarget } from '../../services/contracts'

type Props = {
  t: Record<string, string>
  hidden: boolean
  status: AsyncResourceState
  controls: AdminProviderControlBundle
  reason: string
  runningAction: string | null
  canRead: boolean
  canManage: boolean
  canRecover: boolean
  setReason: Dispatch<SetStateAction<string>>
  formatAmount: (amount: number | null | undefined, currency: string | null | undefined) => string
  formatTime: (value: string) => string
  onRunAction: (resourceId: string, version: number, action: 'disable' | AdminProviderControlRecoveryTarget) => Promise<void>
}

export function AdminProviderControlsPanel({
  t,
  hidden,
  status,
  controls,
  reason,
  runningAction,
  canRead,
  canManage,
  canRecover,
  setReason,
  formatAmount,
  formatTime,
  onRunAction,
}: Props) {
  return (
    <section className="panel generation-provider-control-panel" data-testid="admin-provider-controls" hidden={hidden}>
      <SectionHeader
        eyebrow={textFor(t, 'Creative operations', '创作运营')}
        title={textFor(t, 'Provider controls', 'Provider 控制')}
        action={
          <button className="ghost-button" type="button" onClick={() => void status.refresh()} disabled={!canRead || status.loading}>
            {status.loading ? textFor(t, 'Loading', '加载中') : textFor(t, 'Refresh', '刷新')}
          </button>
        }
      />
      <div className="permission-summary">
        <label>
          <span>{textFor(t, 'Reason code', '原因代码')}</span>
          <input
            aria-label={textFor(t, 'Provider control reason code', 'Provider 控制原因代码')}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="operator_requested"
          />
        </label>
      </div>
      {status.error && (
        <div className="empty-state">
          <strong>{textFor(t, 'Provider controls unavailable', 'Provider 控制不可用')}</strong>
          <span>{status.error}</span>
        </div>
      )}
      {!status.error && (
        <div className="admin-table">
          {controls.controls.map((control) => {
            const resourceId = control.id ?? ''
            const action = control.enabled ? 'disable' : 'enable'
            const actionKey = `${resourceId}:${action}`
            return (
              <div className="admin-row" key={resourceId}>
                <StatusBadge status={control.enabled ? 'Enabled' : 'Disabled'} t={t} />
                <strong>{control.providerId ?? control.scopeType}</strong>
                <span>{control.workspace ?? control.scopeType}{control.modelFamily ? ` / ${control.modelFamily}` : ''}</span>
                <small>{control.reasonCode} · v{control.version}</small>
                <button
                  className={control.enabled ? 'danger-button' : 'ghost-button'}
                  type="button"
                  onClick={() => void onRunAction(resourceId, control.version, action)}
                  disabled={!resourceId || (control.enabled ? !canManage : !canRecover) || Boolean(runningAction)}
                >
                  {runningAction === actionKey
                    ? textFor(t, 'Working', '处理中')
                    : control.enabled
                      ? textFor(t, 'Disable', '停用')
                      : textFor(t, 'Request enable', '申请启用')}
                </button>
              </div>
            )
          })}
          {controls.circuits.map((circuit) => {
            const resourceId = circuit.id ?? ''
            const target: AdminProviderControlRecoveryTarget | null = circuit.status === 'open'
              ? 'half_open'
              : circuit.status === 'half_open'
                ? 'closed'
                : null
            return (
              <div className="admin-row" key={`circuit-${resourceId}`}>
                <StatusBadge status={circuit.status} t={t} />
                <strong>{circuit.providerId ?? '-'}</strong>
                <span>{circuit.workspace}{circuit.modelFamily ? ` / ${circuit.modelFamily}` : ''}</span>
                <small>{circuit.failureCount} {textFor(t, 'failures', '次故障')} · {circuit.reasonCode ?? '-'}</small>
                {target && (
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => void onRunAction(resourceId, circuit.version, target)}
                    disabled={!resourceId || !canRecover || Boolean(runningAction)}
                  >
                    {target === 'half_open' ? textFor(t, 'Request probe', '申请探测') : textFor(t, 'Request close', '申请关闭熔断')}
                  </button>
                )}
              </div>
            )
          })}
          {controls.capEvidence.map((evidence) => (
            <div className="admin-row" key={`cap-${evidence.id}`}>
              <StatusBadge status={evidence.active ? 'Active' : 'Inactive'} t={t} />
              <strong>{evidence.providerId ?? '-'}</strong>
              <span>{formatAmount(evidence.capAmount, evidence.currency)}</span>
              <small>{textFor(t, 'remaining', '剩余')} {formatAmount(evidence.remainingAmount, evidence.currency)} · {evidence.sourceType} · {formatTime(evidence.expiresAt)}</small>
              <span>SHA-256 {evidence.evidenceHashPreview ?? '-'}</span>
            </div>
          ))}
          {!status.loading && controls.controls.length === 0 && controls.circuits.length === 0 && (
            <div className="empty-state">
              <strong>{textFor(t, 'No Provider controls', '暂无 Provider 控制')}</strong>
              <span>{textFor(t, 'No durable control state is available.', '暂无可用的持久化控制状态。')}</span>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
