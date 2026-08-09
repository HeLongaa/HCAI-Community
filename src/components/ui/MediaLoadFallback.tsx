import { FileWarning } from 'lucide-react'

export function MediaLoadFallback({ title, detail, testId, compact = false }: {
  title: string
  detail: string
  testId?: string
  compact?: boolean
}) {
  return (
    <div className={compact ? 'media-load-fallback compact' : 'media-load-fallback'} data-testid={testId} role="status">
      <FileWarning size={compact ? 22 : 30} />
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  )
}
