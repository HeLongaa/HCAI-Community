import { useEffect, useState } from 'react'
import { FileCheck2, ListChecks, Scale, SlidersHorizontal } from 'lucide-react'

import type { Permission } from '../../domain/types'
import { RiskAdminPanel } from './RiskAdminPanel'
import { TrustSafetyAdminPanel } from './TrustSafetyAdminPanel'
import { TrustSafetyOperationsPanel } from './TrustSafetyOperationsPanel'

type WorkspaceMode = 'cases' | 'policies' | 'operations' | 'evidence'

type Props = {
  t: Record<string, string>
  hasPermission: (permission: Permission) => boolean
  isZh: boolean
}

const workspaceStorageKey = 'hcaiTrustSafetyWorkspace'
const workspaceModes: WorkspaceMode[] = ['cases', 'policies', 'operations', 'evidence']

export function TrustSafetyWorkspace({ t, hasPermission, isZh }: Props) {
  const [workspace, setWorkspace] = useState<WorkspaceMode>(() => {
    if (typeof window === 'undefined') return 'cases'
    const saved = window.sessionStorage.getItem(workspaceStorageKey) as WorkspaceMode | null
    return saved && workspaceModes.includes(saved) ? saved : 'cases'
  })

  const canReadTrust = hasPermission('admin:trust:read')
  const canReadRisk = hasPermission('admin:risk:read')
  const canOperate = hasPermission('admin:trust:operate')
  const canManageRules = hasPermission('admin:trust:rules')

  useEffect(() => {
    window.sessionStorage.setItem(workspaceStorageKey, workspace)
  }, [workspace])

  const workspaces = [
    {
      id: 'cases' as const,
      icon: Scale,
      label: isZh ? '案件' : 'Cases',
      ariaLabel: isZh ? '案件工作面' : 'Cases workspace',
      description: isZh ? '举报、申诉与风险处置' : 'Reports, appeals, and risk actions',
    },
    {
      id: 'policies' as const,
      icon: SlidersHorizontal,
      label: isZh ? '策略' : 'Policies',
      ariaLabel: isZh ? '策略工作面' : 'Policies workspace',
      description: isZh ? '审核规则、版本与阈值' : 'Rules, versions, and thresholds',
    },
    {
      id: 'operations' as const,
      icon: ListChecks,
      label: isZh ? '安全运营' : 'Safety operations',
      ariaLabel: isZh ? '安全运营工作面' : 'Safety operations workspace',
      description: isZh ? '分派、SLA 与批量操作' : 'Assignment, SLA, and bulk actions',
    },
    {
      id: 'evidence' as const,
      icon: FileCheck2,
      label: isZh ? '证据' : 'Evidence',
      ariaLabel: isZh ? '证据工作面' : 'Evidence workspace',
      description: isZh ? '事实链、安全信号与导出' : 'Fact chains, signals, and exports',
    },
  ]

  const changeWorkspace = (next: WorkspaceMode) => setWorkspace(next)
  const noReadableSurface = !canReadTrust && !canReadRisk

  return (
    <section className="panel trust-safety-workspace" data-workspace={workspace} data-testid="trust-safety-workspace">
      <header className="settings-panel-header trust-workspace-header">
        <div>
          <small>{isZh ? '信任与安全控制台' : 'Trust & Safety control plane'}</small>
          <h2>{isZh ? '案件、策略与安全运营' : 'Cases, policy, and safety operations'}</h2>
          <p>{isZh ? '围绕待办任务组织审核、风控与证据，统计与记录均由当前服务数据生成。' : 'Moderation, risk, and evidence organized around active service data.'}</p>
        </div>
      </header>

      <div className="trust-workspace-tabs" role="tablist" aria-label={isZh ? '信任与安全工作面' : 'Trust and Safety workspace'}>
        {workspaces.map((item) => {
          const WorkspaceIcon = item.icon
          return (
            <button
              type="button"
              role="tab"
              aria-label={item.ariaLabel}
              aria-selected={workspace === item.id}
              className={workspace === item.id ? 'active' : ''}
              key={item.id}
              onClick={() => changeWorkspace(item.id)}
            >
              <WorkspaceIcon size={17} />
              <span><strong>{item.label}</strong><small>{item.description}</small></span>
            </button>
          )
        })}
      </div>

      <label className="trust-workspace-select">
        <span>{isZh ? '信任与安全工作面' : 'Trust and Safety workspace'}</span>
        <select aria-label={isZh ? '信任与安全工作面' : 'Trust and Safety workspace'} value={workspace} onChange={(event) => changeWorkspace(event.target.value as WorkspaceMode)}>
          {workspaces.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
        </select>
      </label>

      {noReadableSurface && <div className="empty-state trust-workspace-empty"><strong>{isZh ? '无信任与安全读取权限' : 'Trust and Safety access denied'}</strong></div>}

      {!noReadableSurface && <div className="trust-workspace-content">
        {workspace === 'cases' && <>
          {canReadTrust && <TrustSafetyAdminPanel view="cases" hasPermission={hasPermission} isZh={isZh} />}
          {canReadRisk && <RiskAdminPanel view="cases" t={t} canRead canManage={hasPermission('admin:risk:manage')} canExport={hasPermission('admin:risk:export')} />}
        </>}

        {workspace === 'policies' && <>
          {canManageRules || canReadTrust ? <TrustSafetyOperationsPanel view="rules" canOperate={canOperate} canManageRules={canManageRules} isZh={isZh} /> : null}
          {canReadRisk && <RiskAdminPanel view="policies" t={t} canRead canManage={hasPermission('admin:risk:manage')} canExport={hasPermission('admin:risk:export')} />}
        </>}

        {workspace === 'operations' && canReadTrust && <TrustSafetyOperationsPanel view="queue" canOperate={canOperate} canManageRules={canManageRules} isZh={isZh} />}

        {workspace === 'evidence' && <>
          {canReadTrust && <TrustSafetyAdminPanel view="evidence" hasPermission={hasPermission} isZh={isZh} />}
          {canReadRisk && <RiskAdminPanel view="evidence" t={t} canRead canManage={hasPermission('admin:risk:manage')} canExport={hasPermission('admin:risk:export')} />}
          {canReadTrust && <TrustSafetyOperationsPanel view="signals" canOperate={canOperate} canManageRules={canManageRules} isZh={isZh} />}
        </>}
      </div>}
    </section>
  )
}
