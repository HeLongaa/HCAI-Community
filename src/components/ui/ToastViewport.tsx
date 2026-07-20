import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'

import type { AppToast } from '../../hooks/useAppFeedback'

const icons = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: AlertTriangle,
} as const

export function ToastViewport({ toasts, dismiss }: { toasts: AppToast[]; dismiss: (id: number) => void }) {
  return (
    <section className="toast-viewport" aria-label="Notifications" aria-live="polite" aria-relevant="additions removals">
      {toasts.map((toast) => {
        const Icon = icons[toast.tone]
        return (
          <article className={`app-toast ${toast.tone}`} data-testid="app-toast" key={toast.id} role={toast.tone === 'error' ? 'alert' : 'status'}>
            <Icon aria-hidden="true" size={18} />
            <p>{toast.message}</p>
            <button type="button" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification">
              <X aria-hidden="true" size={16} />
            </button>
          </article>
        )
      })}
    </section>
  )
}
