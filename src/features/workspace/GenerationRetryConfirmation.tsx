import { OperationConfirmation } from '../../components/ui/OperationConfirmation'
import { textFor } from '../../domain/utils'

export function GenerationRetryConfirmation({
  t,
  busy,
  onConfirm,
  onCancel,
}: {
  t: Record<string, string>
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="generation-retry-confirmation">
      <OperationConfirmation
        ariaLabel={textFor(t, 'Confirm generation retry', '确认重试生成任务')}
        title={textFor(t, 'Create another attempt?', '创建新的重试任务？')}
        description={textFor(
          t,
          'A new attempt will use the exact same inputs. It may consume credits or quota again.',
          '系统将使用完全相同的输入创建一次新尝试，并可能再次消耗额度或配额。',
        )}
        confirmLabel={busy ? textFor(t, 'Creating retry', '正在创建') : textFor(t, 'Retry same inputs', '使用相同输入重试')}
        cancelLabel={textFor(t, 'Back', '返回')}
        onConfirm={onConfirm}
        onCancel={onCancel}
        busy={busy}
        tone="primary"
        compact
      />
    </div>
  )
}
