import type { ReactNode } from 'react'
import { Download } from 'lucide-react'

import { SectionHeader } from '../../components/ui/SectionHeader'
import { textFor } from '../../domain/utils'
import type { GenerationOperationsWorkspace } from './useAdminGenerationState'

type Props = {
  t: Record<string, string>
  workspace: GenerationOperationsWorkspace
  hidden: boolean
  loading: boolean
  exporting: boolean
  canRead: boolean
  canExport: boolean
  onRefresh: () => void
  onExport?: () => void
  children: ReactNode
}

const workspaceCopy = (workspace: GenerationOperationsWorkspace, t: Record<string, string>) => {
  if (workspace === 'records') {
    return {
      eyebrow: textFor(t, 'Generation records', '生成记录'),
      title: textFor(t, 'Durable generation history', '持久化生成记录'),
      exportLabel: textFor(t, 'Export generation records', '导出生成记录'),
    }
  }
  if (workspace === 'recovery') {
    return {
      eyebrow: textFor(t, 'Recovery queue', '恢复队列'),
      title: textFor(t, 'Expired and abandoned executions', '过期与异常执行'),
      exportLabel: '',
    }
  }
  return {
    eyebrow: textFor(t, 'Business metrics', '业务指标'),
    title: textFor(t, 'Generation quality and economics', '生成质量与业务效率'),
    exportLabel: textFor(t, 'Export generation metrics CSV', '导出生成统计 CSV'),
  }
}

export function AdminGenerationWorkspacePanel({
  t,
  workspace,
  hidden,
  loading,
  exporting,
  canRead,
  canExport,
  onRefresh,
  onExport,
  children,
}: Props) {
  const copy = workspaceCopy(workspace, t)
  return (
    <section className="panel admin-generation-operations-panel" data-workspace={workspace} data-testid="admin-generation-history" hidden={hidden}>
      <SectionHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        action={
          <div className="inline-actions">
            {onExport && (
              <button className="ghost-button" type="button" onClick={onExport} disabled={!canExport || exporting} aria-label={copy.exportLabel} title={copy.exportLabel}>
                <Download size={16} /> {exporting ? textFor(t, 'Exporting', '导出中') : 'CSV'}
              </button>
            )}
            <button className="ghost-button" type="button" onClick={onRefresh} disabled={!canRead || loading}>
              {loading ? textFor(t, 'Loading', '加载中') : textFor(t, 'Refresh', '刷新')}
            </button>
          </div>
        }
      />
      {children}
    </section>
  )
}
