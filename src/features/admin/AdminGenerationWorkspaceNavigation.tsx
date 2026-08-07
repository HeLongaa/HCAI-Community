import { BarChart3, Clipboard, RotateCcw, ShieldAlert } from 'lucide-react'

import { textFor } from '../../domain/utils'
import { AdminActionFeedback, type AdminActionFeedbackMessage } from './AdminActionFeedback'
import type { GenerationOperationsWorkspace } from './useAdminGenerationState'

type Props = {
  t: Record<string, string>
  workspace: GenerationOperationsWorkspace
  hidden: boolean
  actionMessage: AdminActionFeedbackMessage | null
  onChange: (workspace: GenerationOperationsWorkspace) => void
}

const workspaceItems = (t: Record<string, string>) => [
  { id: 'records' as const, icon: Clipboard, label: textFor(t, 'Generation records', '生成记录'), ariaLabel: textFor(t, 'Generation records workspace', '生成记录工作面'), description: textFor(t, 'Filters, details, and dispositions', '筛选、详情与批量处置') },
  { id: 'recovery' as const, icon: RotateCcw, label: textFor(t, 'Recovery queue', '恢复队列'), ariaLabel: textFor(t, 'Recovery queue workspace', '恢复队列工作面'), description: textFor(t, 'Expired leases and abandoned runs', '过期租约与异常执行') },
  { id: 'providers' as const, icon: ShieldAlert, label: textFor(t, 'Provider controls', 'Provider 控制'), ariaLabel: textFor(t, 'Provider controls workspace', 'Provider 控制工作面'), description: textFor(t, 'Circuit, budget, and availability', '熔断、预算与可用性') },
  { id: 'metrics' as const, icon: BarChart3, label: textFor(t, 'Business metrics', '业务指标'), ariaLabel: textFor(t, 'Business metrics workspace', '业务指标工作面'), description: textFor(t, 'Quality, latency, cost, and reuse', '质量、时延、成本与复用') },
]

export function AdminGenerationWorkspaceNavigation({ t, workspace, hidden, actionMessage, onChange }: Props) {
  const items = workspaceItems(t)
  return (
    <div className="generation-operations-workspace" data-workspace={workspace} data-testid="generation-operations-workspace" hidden={hidden}>
      <header className="settings-panel-header generation-workspace-header">
        <div>
          <small>{textFor(t, 'Generation operations', '生成运营')}</small>
          <h2>{textFor(t, 'Runs, recovery, and Provider health', '任务、恢复与 Provider 健康')}</h2>
          <p>{textFor(t, 'Operate durable generation records and controls without mixing unrelated workflows.', '按工作任务组织真实生成记录与控制面，避免无关流程混杂。')}</p>
        </div>
      </header>
      <div className="generation-workspace-tabs" role="tablist" aria-label={textFor(t, 'Generation operations workspace', '生成运营工作面')}>
        {items.map((item) => {
          const WorkspaceIcon = item.icon
          return (
            <button type="button" role="tab" aria-label={item.ariaLabel} aria-selected={workspace === item.id} className={workspace === item.id ? 'active' : ''} key={item.id} onClick={() => onChange(item.id)}>
              <WorkspaceIcon size={17} />
              <span><strong>{item.label}</strong><small>{item.description}</small></span>
            </button>
          )
        })}
      </div>
      <label className="generation-workspace-select">
        <span>{textFor(t, 'Generation operations workspace', '生成运营工作面')}</span>
        <select aria-label={textFor(t, 'Generation operations workspace', '生成运营工作面')} value={workspace} onChange={(event) => onChange(event.target.value as GenerationOperationsWorkspace)}>
          {items.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
        </select>
      </label>
      <AdminActionFeedback message={actionMessage} className="generation-action-feedback" />
    </div>
  )
}
