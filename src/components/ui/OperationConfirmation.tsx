import type { ReactNode } from 'react'

export function OperationConfirmation({
  ariaLabel,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  busy = false,
  tone = 'danger',
  compact = false,
  confirmDisabled = false,
  children,
}: {
  ariaLabel: string
  title: string
  description: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
  tone?: 'danger' | 'primary'
  compact?: boolean
  confirmDisabled?: boolean
  children?: ReactNode
}) {
  return (
    <div className={`operation-confirmation admin-operation-confirmation tone-${tone}`} role="alertdialog" aria-label={ariaLabel}>
      <div><strong>{title}</strong><span>{description}</span>{children}</div>
      <div className="button-row">
        <button className={`ghost-button${compact ? ' small' : ''}`} type="button" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
        <button className={`${tone === 'danger' ? 'danger-button' : 'primary-button'}${compact ? ' small' : ''}`} type="button" onClick={onConfirm} disabled={busy || confirmDisabled}>{confirmLabel}</button>
      </div>
    </div>
  )
}
