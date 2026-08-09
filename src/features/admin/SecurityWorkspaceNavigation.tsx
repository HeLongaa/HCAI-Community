import { textFor } from '../../domain/utils'
import { securityWorkspaces, type SecurityWorkspace } from './securityWorkspace'

export function SecurityWorkspaceNavigation({ t, workspace, onChange }: { t: Record<string, string>; workspace: SecurityWorkspace; onChange: (workspace: SecurityWorkspace) => void }) {
  const labels: Record<SecurityWorkspace, string> = {
    overview: textFor(t, 'Operations', '运营概览'),
    incidents: textFor(t, 'Incidents', '事件处置'),
    media: textFor(t, 'Media review', '媒体审核'),
    governance: textFor(t, 'Governance', '治理配置'),
  }

  return (
    <section className="security-workspace-navigation" data-testid="security-workspace-navigation">
      <div className="security-workspace-tabs" role="tablist" aria-label={textFor(t, 'Security workspace', '安全工作区')}>
        {securityWorkspaces.map((item) => <button className={workspace === item ? 'active' : ''} role="tab" aria-selected={workspace === item} type="button" key={item} onClick={() => onChange(item)}>{labels[item]}</button>)}
      </div>
      <label className="security-workspace-select">
        <span>{textFor(t, 'Security workspace', '安全工作区')}</span>
        <select aria-label={textFor(t, 'Security workspace', '安全工作区')} value={workspace} onChange={(event) => onChange(event.target.value as SecurityWorkspace)}>
          {securityWorkspaces.map((item) => <option value={item} key={item}>{labels[item]}</option>)}
        </select>
      </label>
    </section>
  )
}
