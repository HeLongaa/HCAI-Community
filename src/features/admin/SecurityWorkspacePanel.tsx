import type { ReactNode } from 'react'

import { SectionHeader } from '../../components/ui/SectionHeader'
import { textFor } from '../../domain/utils'
import type { SecurityWorkspace } from './securityWorkspace'

export function SecurityWorkspacePanel({
  t,
  workspace,
  action,
  children,
}: {
  t: Record<string, string>
  workspace: SecurityWorkspace
  action?: ReactNode
  children: ReactNode
}) {
  const isMediaWorkspace = workspace === 'media' || workspace === 'governance'
  const title = workspace === 'overview'
    ? textFor(t, 'Operations health', '运营健康')
    : workspace === 'incidents'
      ? textFor(t, 'Incident response', '事件处置')
      : workspace === 'media'
        ? textFor(t, 'Media review workspace', '媒体审核工作区')
        : textFor(t, 'Governance configuration', '治理配置')

  return (
    <section
      className={`panel security-workspace-panel ${isMediaWorkspace ? 'admin-media-governance-panel' : 'security-operations-panel'}`}
      data-security-workspace={workspace}
    >
      <SectionHeader eyebrow={isMediaWorkspace ? textFor(t, 'Media governance', '媒体治理') : textFor(t, 'Security', '安全')} title={title} action={action} />
      {children}
    </section>
  )
}
