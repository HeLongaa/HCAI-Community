import { statusLabel } from '../../domain/utils'

export function StatusBadge({ status, t }: { status: string; t?: Record<string, string> }) {
  return <span className={`status-badge ${status.toLowerCase().replace(/\s/g, '-')}`}>{statusLabel(status, t)}</span>
}
