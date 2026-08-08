import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'

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
  const cancelButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cancelButtonRef.current?.focus()
    return () => {
      if (returnFocusTo?.isConnected) returnFocusTo.focus()
    }
  }, [])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || busy) return
    event.preventDefault()
    event.stopPropagation()
    onCancel()
  }

  return (
    <div className={`operation-confirmation admin-operation-confirmation tone-${tone}`} role="alertdialog" aria-label={ariaLabel} onKeyDown={handleKeyDown}>
      <div><strong>{title}</strong><span>{description}</span>{children}</div>
      <div className="button-row">
        <button ref={cancelButtonRef} className={`ghost-button${compact ? ' small' : ''}`} type="button" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
        <button className={`${tone === 'danger' ? 'danger-button' : 'primary-button'}${compact ? ' small' : ''}`} type="button" onClick={onConfirm} disabled={busy || confirmDisabled}>{confirmLabel}</button>
      </div>
    </div>
  )
}
