import { useMemo, useState } from 'react'
import { Activity, Download, Plus, RefreshCw, ShieldCheck } from 'lucide-react'
import type { Permission } from '../../domain/types'
import type {
  EntitlementDecisionDto,
  EntitlementGrantDto,
  EntitlementGrantStatus,
  EntitlementPlanDto,
  EntitlementPlanStatus,
} from '../../services/contracts'
import { entitlementService } from '../../services/entitlementService'
import { useAsyncResource } from '../../hooks/useAsyncResource'
import { SectionHeader } from '../../components/ui/SectionHeader'

type View = 'plans' | 'grants' | 'evaluate'

const statusLabel = (value: string) => value.replaceAll('_', ' ')
const localDateTime = (offsetDays = 0) => {
  const date = new Date(Date.now() + offsetDays * 86_400_000)
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}
const toIso = (value: string) => new Date(value).toISOString()
const parseMap = <T extends boolean | number>(value: string, label: string) => {
  const parsed = JSON.parse(value) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${label} must be a JSON object`)
  return parsed as Record<string, T>
}

export function EntitlementAdminPanel({
  hasPermission,
  isZh,
  notify,
}: {
  hasPermission: (permission: Permission) => boolean
  isZh: boolean
  notify: (message: string) => void
}) {
  const text = (en: string, zh: string) => isZh ? zh : en
  const canRead = hasPermission('admin:entitlements:read')
  const canManage = hasPermission('admin:entitlements:manage')
  const canTransition = hasPermission('admin:entitlements:transition')
  const [view, setView] = useState<View>('plans')
  const [plans, setPlans] = useState<EntitlementPlanDto[]>([])
  const [grants, setGrants] = useState<EntitlementGrantDto[]>([])
  const [planSummary, setPlanSummary] = useState({ total: 0, draft: 0, active: 0, retired: 0 })
  const [grantSummary, setGrantSummary] = useState({ scheduled: 0, active: 0, revoked: 0, expired: 0 })
  const [planStatus, setPlanStatus] = useState<EntitlementPlanStatus | null>(null)
  const [grantStatus, setGrantStatus] = useState<EntitlementGrantStatus | null>(null)
  const [search, setSearch] = useState('')
  const [userHandle, setUserHandle] = useState('')
  const [selectedPlan, setSelectedPlan] = useState<EntitlementPlanDto | null>(null)
  const [selectedGrant, setSelectedGrant] = useState<EntitlementGrantDto | null>(null)
  const [busy, setBusy] = useState(false)
  const [creatingPlan, setCreatingPlan] = useState(false)
  const [creatingGrant, setCreatingGrant] = useState(false)
  const [planDraft, setPlanDraft] = useState({ key: '', title: '', description: '' })
  const [versionDraft, setVersionDraft] = useState({
    capabilities: '{\n  "creative.image.text_to_image": true\n}',
    quotas: '{\n  "creative.daily.image": 24\n}',
    effectiveAt: localDateTime(),
    expiresAt: '',
    reasonCode: 'policy_update',
  })
  const [grantDraft, setGrantDraft] = useState({ userHandle: '', planVersionId: '', startsAt: localDateTime(), endsAt: localDateTime(30), reasonCode: 'manual_assignment' })
  const [evaluationDraft, setEvaluationDraft] = useState({ userHandle: 'promptlin', capability: 'creative.image.text_to_image', quotaKey: 'creative.daily.image', units: '1' })
  const [evaluation, setEvaluation] = useState<EntitlementDecisionDto | null>(null)

  const plansStatus = useAsyncResource({
    load: () => canRead ? entitlementService.plans({ status: planStatus, search, limit: 50 }) : Promise.resolve({ items: [], nextCursor: null, summary: { total: 0, draft: 0, active: 0, retired: 0 } }),
    onSuccess: (page) => { setPlans(page.items); setPlanSummary(page.summary) },
    getErrorMessage: () => text('Could not load entitlement plans.', '无法读取权益方案。'),
    deps: [canRead, isZh, planStatus, search],
    logLabel: 'entitlement-admin',
  })
  const grantsStatus = useAsyncResource({
    load: () => canRead ? entitlementService.grants({ status: grantStatus, userHandle, search, limit: 50, sort: 'starts_desc' }) : Promise.resolve({ items: [], nextCursor: null, summary: { scheduled: 0, active: 0, revoked: 0, expired: 0 } }),
    onSuccess: (page) => { setGrants(page.items); setGrantSummary(page.summary) },
    getErrorMessage: () => text('Could not load personal grants.', '无法读取个人授权。'),
    deps: [canRead, isZh, grantStatus, userHandle, search],
    logLabel: 'entitlement-admin',
  })
  const activeVersions = useMemo(() => plans.filter((plan) => plan.status === 'active' && plan.activeVersion).map((plan) => ({ plan, version: plan.activeVersion! })), [plans])

  const refreshAll = async () => Promise.all([plansStatus.refresh(), grantsStatus.refresh()])
  const run = async (action: () => Promise<void>, success: string) => {
    if (busy) return
    setBusy(true)
    try {
      await action()
      notify(success)
      await refreshAll()
    } catch (error) {
      console.info('[entitlement-admin]', error)
      notify(error instanceof Error ? error.message : text('Entitlement operation failed.', '权益操作失败。'))
    } finally {
      setBusy(false)
    }
  }
  const selectPlan = async (plan: EntitlementPlanDto) => {
    setSelectedPlan(plan)
    try { setSelectedPlan(await entitlementService.plan(plan.id)) } catch (error) { console.info('[entitlement-admin]', error) }
  }
  const selectGrant = async (grant: EntitlementGrantDto) => {
    setSelectedGrant(grant)
    try { setSelectedGrant(await entitlementService.grant(grant.id)) } catch (error) { console.info('[entitlement-admin]', error) }
  }
  const createPlan = () => run(async () => {
    const created = await entitlementService.createPlan({ ...planDraft, description: planDraft.description || null })
    setPlanDraft({ key: '', title: '', description: '' })
    setCreatingPlan(false)
    await selectPlan(created)
  }, text('Entitlement plan created.', '权益方案已创建。'))
  const appendVersion = () => selectedPlan && run(async () => {
    const result = await entitlementService.appendPlanVersion(selectedPlan.id, {
      expectedPlanVersion: selectedPlan.version,
      capabilities: parseMap<boolean>(versionDraft.capabilities, 'capabilities'),
      quotas: parseMap<number>(versionDraft.quotas, 'quotas'),
      effectiveAt: toIso(versionDraft.effectiveAt),
      expiresAt: versionDraft.expiresAt ? toIso(versionDraft.expiresAt) : null,
      reasonCode: versionDraft.reasonCode,
    })
    setSelectedPlan(await entitlementService.plan(result.plan.id))
  }, text('Immutable plan version appended.', '不可变方案版本已追加。'))
  const transitionPlan = (status: 'active' | 'retired') => selectedPlan && run(async () => {
    const versionId = status === 'active' ? selectedPlan.versions?.[0]?.id ?? selectedPlan.activeVersionId : null
    const updated = await entitlementService.transitionPlan(selectedPlan.id, { status, planVersionId: versionId, expectedVersion: selectedPlan.version, reasonCode: status === 'active' ? 'approved_release' : 'plan_retired' })
    setSelectedPlan(await entitlementService.plan(updated.id))
  }, status === 'active' ? text('Plan activated.', '方案已启用。') : text('Plan retired.', '方案已停用。'))
  const createGrant = () => run(async () => {
    const created = await entitlementService.createGrant({
      ...grantDraft,
      startsAt: toIso(grantDraft.startsAt),
      endsAt: grantDraft.endsAt ? toIso(grantDraft.endsAt) : null,
      sourceType: 'admin',
    })
    setCreatingGrant(false)
    setSelectedGrant(created)
  }, text('Personal entitlement assigned.', '个人权益已分配。'))
  const transitionGrant = (status: 'active' | 'revoked' | 'expired') => selectedGrant && run(async () => {
    setSelectedGrant(await entitlementService.transitionGrant(selectedGrant.id, { status, expectedVersion: selectedGrant.version, reasonCode: `grant_${status}` }))
  }, text(`Grant moved to ${status}.`, `授权已变更为 ${statusLabel(status)}。`))
  const exportSnapshot = () => run(async () => {
    const snapshot = await entitlementService.exportSnapshot()
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }))
    link.download = `personal-entitlements-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(link.href)
  }, text('Entitlement snapshot exported.', '权益快照已导出。'))
  const evaluate = () => run(async () => {
    setEvaluation(await entitlementService.evaluateAdmin({ ...evaluationDraft, units: Number(evaluationDraft.units), quotaKey: evaluationDraft.quotaKey || null }))
  }, text('Entitlement evaluated.', '权益评估完成。'))

  if (!canRead) return null
  return (
    <section className="panel entitlement-admin-panel" data-testid="admin-entitlements-panel">
      <SectionHeader
        eyebrow={text('Product access', '产品权益')}
        title={text('Personal entitlement control', '个人权益控制')}
        action={<div className="button-row compact-buttons">
          <button className="icon-button" type="button" title={text('Refresh', '刷新')} aria-label={text('Refresh entitlements', '刷新权益')} onClick={() => void refreshAll()} disabled={busy}><RefreshCw size={16}/></button>
          <button className="ghost-button" type="button" onClick={() => void exportSnapshot()} disabled={busy}><Download size={16}/>{text('Export', '导出')}</button>
          {canTransition && <button className="ghost-button" type="button" onClick={() => void run(async () => { const result = await entitlementService.sweepExpired(); notify(text(`${result.expired} grants expired.`, `${result.expired} 个授权已过期。`)) }, text('Expiry sweep completed.', '到期扫描完成。'))} disabled={busy}><Activity size={16}/>{text('Sweep expiry', '扫描到期')}</button>}
        </div>}
      />
      <div className="entitlement-toolbar">
        <div className="chip-row" role="tablist">
          {(['plans', 'grants', 'evaluate'] as View[]).map((item) => <button className={view === item ? 'chip active' : 'chip'} type="button" role="tab" aria-selected={view === item} key={item} onClick={() => setView(item)}>{text({ plans: 'Plans', grants: 'Grants', evaluate: 'Evaluate' }[item], { plans: '方案', grants: '授权', evaluate: '评估' }[item])}</button>)}
        </div>
        <label><span>{text('Search', '搜索')}</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={text('Plan, user, key', '方案、用户、Key')}/></label>
      </div>
      {plansStatus.error || grantsStatus.error ? <div className="empty-state compact"><strong>{text('Entitlement data unavailable', '权益数据不可用')}</strong><span>{plansStatus.error ?? grantsStatus.error}</span></div> : null}

      {view === 'plans' && <>
        <div className="entitlement-metrics">{(['total', 'draft', 'active', 'retired'] as const).map((key) => <div key={key}><span>{text(statusLabel(key), { total: '总计', draft: '草稿', active: '启用', retired: '停用' }[key])}</span><strong>{planSummary[key]}</strong></div>)}</div>
        <div className="entitlement-filter-row"><label><span>{text('Status', '状态')}</span><select value={planStatus ?? ''} onChange={(event) => setPlanStatus(event.target.value ? event.target.value as EntitlementPlanStatus : null)}><option value="">{text('All', '全部')}</option><option value="draft">draft</option><option value="active">active</option><option value="retired">retired</option></select></label>{canManage && <button className="primary-button" type="button" onClick={() => setCreatingPlan((value) => !value)}><Plus size={16}/>{text('New plan', '新建方案')}</button>}</div>
        {creatingPlan && <div className="entitlement-form-grid"><label><span>Key</span><input value={planDraft.key} onChange={(event) => setPlanDraft((value) => ({ ...value, key: event.target.value }))} placeholder="personal.creator.pro"/></label><label><span>{text('Title', '名称')}</span><input value={planDraft.title} onChange={(event) => setPlanDraft((value) => ({ ...value, title: event.target.value }))}/></label><label className="wide"><span>{text('Description', '说明')}</span><input value={planDraft.description} onChange={(event) => setPlanDraft((value) => ({ ...value, description: event.target.value }))}/></label><button className="primary-button" type="button" onClick={() => void createPlan()} disabled={busy || !planDraft.key || !planDraft.title}>{text('Create draft', '创建草稿')}</button></div>}
        <div className="entitlement-master-detail"><div className="admin-table">{plans.map((plan) => <button className={`admin-row compact ${selectedPlan?.id === plan.id ? 'selected' : ''}`} type="button" key={plan.id} onClick={() => void selectPlan(plan)}><span className={`status ${plan.status}`}>{statusLabel(plan.status)}</span><strong>{plan.title}</strong><span>{plan.key}</span><small>v{plan.version} · {plan.versionCount} {text('policy versions', '个策略版本')}</small></button>)}</div>
          {selectedPlan && <div className="admin-detail-panel entitlement-detail"><div><span><strong>{selectedPlan.title}</strong><small>{selectedPlan.key} · CAS v{selectedPlan.version}</small></span><span className={`status ${selectedPlan.status}`}>{statusLabel(selectedPlan.status)}</span></div><div className="entitlement-detail-actions">{canTransition && selectedPlan.status !== 'active' && <button className="primary-button small" type="button" onClick={() => void transitionPlan('active')} disabled={busy || !(selectedPlan.versions?.length || selectedPlan.activeVersionId)}><ShieldCheck size={15}/>{text('Activate latest', '启用最新版')}</button>}{canTransition && selectedPlan.status === 'active' && <button className="ghost-button danger small" type="button" onClick={() => void transitionPlan('retired')} disabled={busy}>{text('Retire', '停用')}</button>}</div>
            <div className="entitlement-version-list">{selectedPlan.versions?.map((version) => <div key={version.id}><span><strong>v{version.version}</strong><small>{version.reasonCode}</small></span><code>{version.contentHash.slice(0, 12)}</code></div>)}</div>
            {canManage && <div className="entitlement-version-form"><strong>{text('Append immutable version', '追加不可变版本')}</strong><label><span>Capabilities JSON</span><textarea value={versionDraft.capabilities} onChange={(event) => setVersionDraft((value) => ({ ...value, capabilities: event.target.value }))}/></label><label><span>Quotas JSON</span><textarea value={versionDraft.quotas} onChange={(event) => setVersionDraft((value) => ({ ...value, quotas: event.target.value }))}/></label><div className="entitlement-form-grid"><label><span>{text('Effective', '生效时间')}</span><input type="datetime-local" value={versionDraft.effectiveAt} onChange={(event) => setVersionDraft((value) => ({ ...value, effectiveAt: event.target.value }))}/></label><label><span>{text('Expires', '失效时间')}</span><input type="datetime-local" value={versionDraft.expiresAt} onChange={(event) => setVersionDraft((value) => ({ ...value, expiresAt: event.target.value }))}/></label><label><span>{text('Reason code', '原因代码')}</span><input value={versionDraft.reasonCode} onChange={(event) => setVersionDraft((value) => ({ ...value, reasonCode: event.target.value }))}/></label><button className="ghost-button" type="button" onClick={() => void appendVersion()} disabled={busy}>{text('Append version', '追加版本')}</button></div></div>}
          </div>}
        </div>
      </>}

      {view === 'grants' && <>
        <div className="entitlement-metrics">{(['scheduled', 'active', 'revoked', 'expired'] as const).map((key) => <div key={key}><span>{statusLabel(key)}</span><strong>{grantSummary[key]}</strong></div>)}</div>
        <div className="entitlement-filter-row"><label><span>{text('Status', '状态')}</span><select value={grantStatus ?? ''} onChange={(event) => setGrantStatus(event.target.value ? event.target.value as EntitlementGrantStatus : null)}><option value="">{text('All', '全部')}</option><option value="scheduled">scheduled</option><option value="active">active</option><option value="revoked">revoked</option><option value="expired">expired</option></select></label><label><span>{text('User', '用户')}</span><input value={userHandle} onChange={(event) => setUserHandle(event.target.value)} placeholder="promptlin"/></label>{canManage && <button className="primary-button" type="button" onClick={() => setCreatingGrant((value) => !value)}><Plus size={16}/>{text('Assign', '分配')}</button>}</div>
        {creatingGrant && <div className="entitlement-form-grid grant-form"><label><span>{text('User handle', '用户 Handle')}</span><input value={grantDraft.userHandle} onChange={(event) => setGrantDraft((value) => ({ ...value, userHandle: event.target.value }))}/></label><label><span>{text('Active plan version', '生效方案版本')}</span><select value={grantDraft.planVersionId} onChange={(event) => setGrantDraft((value) => ({ ...value, planVersionId: event.target.value }))}><option value="">{text('Select', '请选择')}</option>{activeVersions.map(({ plan, version }) => <option value={version.id} key={version.id}>{plan.key} · v{version.version}</option>)}</select></label><label><span>{text('Starts', '开始')}</span><input type="datetime-local" value={grantDraft.startsAt} onChange={(event) => setGrantDraft((value) => ({ ...value, startsAt: event.target.value }))}/></label><label><span>{text('Ends', '结束')}</span><input type="datetime-local" value={grantDraft.endsAt} onChange={(event) => setGrantDraft((value) => ({ ...value, endsAt: event.target.value }))}/></label><label><span>{text('Reason code', '原因代码')}</span><input value={grantDraft.reasonCode} onChange={(event) => setGrantDraft((value) => ({ ...value, reasonCode: event.target.value }))}/></label><button className="primary-button" type="button" onClick={() => void createGrant()} disabled={busy || !grantDraft.userHandle || !grantDraft.planVersionId}>{text('Assign grant', '确认分配')}</button></div>}
        <div className="entitlement-master-detail"><div className="admin-table">{grants.map((grant) => <button className={`admin-row compact ${selectedGrant?.id === grant.id ? 'selected' : ''}`} type="button" key={grant.id} onClick={() => void selectGrant(grant)}><span className={`status ${grant.status}`}>{statusLabel(grant.status)}</span><strong>@{grant.user?.handle ?? grant.userId}</strong><span>{grant.planVersion?.plan?.key ?? grant.planVersionId}</span><small>CAS v{grant.version} · {new Date(grant.startsAt).toLocaleDateString()}</small></button>)}</div>{selectedGrant && <div className="admin-detail-panel entitlement-detail"><div><span><strong>@{selectedGrant.user?.handle ?? selectedGrant.userId}</strong><small>{selectedGrant.planVersion?.plan?.key} · v{selectedGrant.planVersion?.version}</small></span><span className={`status ${selectedGrant.status}`}>{statusLabel(selectedGrant.status)}</span></div>{canTransition && ['scheduled', 'active'].includes(selectedGrant.status) && <div className="entitlement-detail-actions">{selectedGrant.status === 'scheduled' && <button className="primary-button small" type="button" onClick={() => void transitionGrant('active')} disabled={busy}>{text('Activate', '启用')}</button>}<button className="ghost-button danger small" type="button" onClick={() => void transitionGrant('revoked')} disabled={busy}>{text('Revoke', '撤销')}</button><button className="ghost-button small" type="button" onClick={() => void transitionGrant('expired')} disabled={busy}>{text('Expire', '标记过期')}</button></div>}<div className="entitlement-event-list">{selectedGrant.events.map((event) => <div key={event.id}><span><strong>{statusLabel(event.eventType)}</strong><small>{event.reasonCode}</small></span><time>{new Date(event.createdAt).toLocaleString()}</time></div>)}</div></div>}</div>
      </>}

      {view === 'evaluate' && <div className="entitlement-evaluate"><div className="entitlement-form-grid"><label><span>{text('User handle', '用户 Handle')}</span><input value={evaluationDraft.userHandle} onChange={(event) => setEvaluationDraft((value) => ({ ...value, userHandle: event.target.value }))}/></label><label><span>{text('Capability', '能力')}</span><input value={evaluationDraft.capability} onChange={(event) => setEvaluationDraft((value) => ({ ...value, capability: event.target.value }))}/></label><label><span>{text('Quota key', '配额 Key')}</span><input value={evaluationDraft.quotaKey} onChange={(event) => setEvaluationDraft((value) => ({ ...value, quotaKey: event.target.value }))}/></label><label><span>{text('Units', '用量')}</span><input type="number" min="1" value={evaluationDraft.units} onChange={(event) => setEvaluationDraft((value) => ({ ...value, units: event.target.value }))}/></label><button className="primary-button" type="button" onClick={() => void evaluate()} disabled={busy}>{text('Evaluate', '执行评估')}</button></div>{evaluation && <div className={`entitlement-decision ${evaluation.allowed ? 'allowed' : 'denied'}`}><ShieldCheck size={22}/><div><strong>{evaluation.allowed ? text('Allowed', '允许') : text('Denied', '拒绝')}</strong><span>{evaluation.entitlement.planKey} · {evaluation.entitlement.policyVersion}</span><small>{evaluation.reasonCode ?? text('All entitlement gates passed', '全部权益门禁通过')}</small></div>{evaluation.quota && <div><span>{evaluation.quota.key}</span><strong>{evaluation.quota.requestedUnits} / {evaluation.quota.limit}</strong></div>}</div>}</div>}
    </section>
  )
}
