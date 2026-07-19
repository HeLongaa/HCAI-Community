import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, RefreshCw, Save, ShieldAlert, ShieldCheck } from 'lucide-react'

import { SectionHeader } from '../../components/ui/SectionHeader'
import { textFor } from '../../domain/utils'
import { adminService } from '../../services/adminService'
import type { RiskCase, RiskCaseStatus, RiskDisposition, RiskLevel, RiskMetrics, RiskPolicy } from '../../services/contracts'

type Props = {
  t: Record<string, string>
  canRead: boolean
  canManage: boolean
  canExport: boolean
  notify: (message: string) => void
}

const statuses: RiskCaseStatus[] = ['open', 'restricted', 'appealed', 'recovered', 'closed']
const dispositions: RiskDisposition[] = ['monitor', 'generation_throttled', 'generation_blocked', 'account_restricted', 'cleared']
const levels: RiskLevel[] = ['low', 'medium', 'high', 'critical']
const transitionTargets: Record<RiskCaseStatus, RiskCaseStatus[]> = { open: ['restricted', 'closed'], restricted: ['recovered'], appealed: ['restricted', 'recovered'], recovered: ['restricted', 'closed'], closed: [] }
const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback

const downloadJson = (value: unknown) => {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  link.download = `risk-cases-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  URL.revokeObjectURL(link.href)
}

export function RiskAdminPanel({ t, canRead, canManage, canExport, notify }: Props) {
  const [policy, setPolicy] = useState<RiskPolicy | null>(null)
  const [draft, setDraft] = useState<RiskPolicy | null>(null)
  const [metrics, setMetrics] = useState<RiskMetrics | null>(null)
  const [cases, setCases] = useState<RiskCase[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [status, setStatus] = useState<RiskCaseStatus | ''>('')
  const [disposition, setDisposition] = useState<RiskDisposition | ''>('')
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [toStatus, setToStatus] = useState<RiskCaseStatus>('recovered')
  const [nextDisposition, setNextDisposition] = useState<RiskDisposition>('cleared')
  const [riskLevel, setRiskLevel] = useState<RiskLevel>('low')
  const [reasonCode, setReasonCode] = useState('operator_review_completed')
  const [appealDecision, setAppealDecision] = useState<'approved' | 'rejected'>('approved')

  const selected = useMemo(() => cases.find((item) => item.id === selectedId) ?? null, [cases, selectedId])

  const selectCase = useCallback((item: RiskCase) => {
    const target = transitionTargets[item.status][0] ?? item.status
    setSelectedId(item.id)
    setToStatus(target)
    setNextDisposition(['recovered', 'closed'].includes(target) ? 'cleared' : item.disposition)
    setRiskLevel(['recovered', 'closed'].includes(target) ? 'low' : item.riskLevel)
    setAppealDecision('approved')
  }, [])

  const load = useCallback(async (append = false) => {
    if (!canRead) return
    setBusy(true)
    setError('')
    try {
      const [page, nextPolicy, nextMetrics] = await Promise.all([
        adminService.riskCases({ status: status || undefined, disposition: disposition || undefined, cursor: append ? nextCursor ?? undefined : undefined, limit: 20 }),
        adminService.riskPolicy(),
        adminService.riskMetrics(),
      ])
      setCases((current) => append ? [...current, ...page.items] : page.items)
      setNextCursor(page.nextCursor)
      setPolicy(nextPolicy)
      if (!append) setDraft(nextPolicy)
      setMetrics(nextMetrics)
      if (!append && page.items.length && !page.items.some((item) => item.id === selectedId)) selectCase(page.items[0])
    } catch (cause) {
      setError(errorMessage(cause, textFor(t, 'Could not load risk operations.', '无法读取风控运营数据。')))
    } finally {
      setBusy(false)
    }
  }, [canRead, disposition, nextCursor, selectCase, selectedId, status, t])

  useEffect(() => {
    if (!canRead) return
    let active = true
    void Promise.all([
      adminService.riskCases({ status: status || undefined, disposition: disposition || undefined, limit: 20 }),
      adminService.riskPolicy(),
      adminService.riskMetrics(),
    ]).then(([page, nextPolicy, nextMetrics]) => {
      if (!active) return
      setCases(page.items)
      setNextCursor(page.nextCursor)
      setPolicy(nextPolicy)
      setDraft(nextPolicy)
      setMetrics(nextMetrics)
      if (page.items.length) selectCase(page.items[0])
    }).catch((cause) => {
      if (active) setError(errorMessage(cause, textFor(t, 'Could not load risk operations.', '无法读取风控运营数据。')))
    }).finally(() => {
      if (active) setBusy(false)
    })
    return () => { active = false }
  }, [canRead, disposition, selectCase, status, t])

  const savePolicy = async () => {
    if (!canManage || !policy || !draft) return
    setBusy(true)
    setError('')
    try {
      const updated = await adminService.updateRiskPolicy({ enabled: draft.enabled, generationWindowSeconds: Number(draft.generationWindowSeconds), generationCountThreshold: Number(draft.generationCountThreshold), safetyRejectionThreshold: Number(draft.safetyRejectionThreshold), generationCostMicrosThreshold: Number(draft.generationCostMicrosThreshold), restrictionSeconds: Number(draft.restrictionSeconds), reasonCode: draft.reasonCode.trim() || 'operator_policy_update', expectedVersion: policy.version })
      setPolicy(updated)
      setDraft(updated)
      notify(textFor(t, 'Risk policy saved.', '风控策略已保存。'))
    } catch (cause) {
      setError(errorMessage(cause, textFor(t, 'Could not save risk policy.', '无法保存风控策略。')))
      await load(false)
    } finally {
      setBusy(false)
    }
  }

  const transition = async () => {
    if (!canManage || !selected || transitionTargets[selected.status].length === 0) return
    setBusy(true)
    setError('')
    try {
      const updated = await adminService.transitionRiskCase(selected.id, { toStatus, disposition: nextDisposition, riskLevel, reasonCode: reasonCode.trim() || 'operator_review_completed', expectedVersion: selected.version, ...(toStatus === 'restricted' ? { restrictionSeconds: policy?.restrictionSeconds ?? 3600 } : {}), ...(selected.appeals.some((item) => item.status === 'pending') ? { appealDecision } : {}) })
      setCases((current) => current.map((item) => item.id === updated.id ? updated : item))
      notify(textFor(t, 'Risk case transitioned.', '风控案件已完成状态转换。'))
      await load(false)
    } catch (cause) {
      setError(errorMessage(cause, textFor(t, 'Could not transition risk case.', '无法转换风控案件状态。')))
      await load(false)
    } finally {
      setBusy(false)
    }
  }

  const exportCases = async () => {
    if (!canExport) return
    try {
      downloadJson(await adminService.exportRiskCases({ status: status || undefined, disposition: disposition || undefined }))
      notify(textFor(t, 'Risk evidence exported.', '风控证据已导出。'))
    } catch (cause) {
      setError(errorMessage(cause, textFor(t, 'Could not export risk evidence.', '无法导出风控证据。')))
    }
  }

  if (!canRead) return <section className="panel"><div className="empty-state"><ShieldAlert size={20}/><strong>{textFor(t, 'Risk access denied', '无风控读取权限')}</strong></div></section>

  return <section className="panel risk-admin-panel" data-testid="risk-admin-panel">
    <SectionHeader eyebrow={textFor(t, 'Risk controls', '风控')} title={textFor(t, 'Account and generation abuse', '账号与生成滥用')} action={<div className="button-row"><button className="icon-button" type="button" title={textFor(t, 'Refresh risk operations', '刷新风控运营')} onClick={() => void load(false)} disabled={busy}><RefreshCw size={16}/></button><button className="icon-button" type="button" title={textFor(t, 'Export risk evidence', '导出风控证据')} onClick={() => void exportCases()} disabled={!canExport || busy}><Download size={16}/></button></div>}/>
    {error && <div className="inline-alert error">{error}</div>}
    {metrics && <div className="risk-admin-metrics" data-testid="risk-admin-metrics"><div><span>{textFor(t, 'Restricted', '受限')}</span><strong>{metrics.byStatus.restricted ?? 0}</strong></div><div><span>{textFor(t, 'Appealed', '申诉中')}</span><strong>{metrics.byStatus.appealed ?? 0}</strong></div><div><span>{textFor(t, 'Pending appeals', '待审申诉')}</span><strong>{metrics.pendingAppeals}</strong></div><div><span>{textFor(t, 'Critical', '严重')}</span><strong>{metrics.byRiskLevel.critical ?? 0}</strong></div></div>}
    {draft && <div className="risk-admin-policy" data-testid="risk-admin-policy">
      <div className="admin-section-heading"><div><strong><ShieldCheck size={16}/>{textFor(t, 'Detection policy', '检测策略')}</strong><small>v{policy?.version ?? 0}</small></div><button className="primary-button" type="button" onClick={() => void savePolicy()} disabled={!canManage || busy}><Save size={16}/>{textFor(t, 'Save policy', '保存策略')}</button></div>
      <div className="trust-action-grid"><label><span>{textFor(t, 'Enabled', '启用')}</span><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}/></label><label><span>{textFor(t, 'Window seconds', '窗口秒数')}</span><input type="number" value={draft.generationWindowSeconds} onChange={(event) => setDraft({ ...draft, generationWindowSeconds: Number(event.target.value) })}/></label><label><span>{textFor(t, 'Generation threshold', '生成阈值')}</span><input type="number" value={draft.generationCountThreshold} onChange={(event) => setDraft({ ...draft, generationCountThreshold: Number(event.target.value) })}/></label><label><span>{textFor(t, 'Safety threshold', '安全拒绝阈值')}</span><input type="number" value={draft.safetyRejectionThreshold} onChange={(event) => setDraft({ ...draft, safetyRejectionThreshold: Number(event.target.value) })}/></label><label><span>{textFor(t, 'Cost threshold (micros)', '成本阈值（微单位）')}</span><input type="number" value={draft.generationCostMicrosThreshold} onChange={(event) => setDraft({ ...draft, generationCostMicrosThreshold: Number(event.target.value) })}/></label><label><span>{textFor(t, 'Restriction seconds', '限制秒数')}</span><input type="number" value={draft.restrictionSeconds} onChange={(event) => setDraft({ ...draft, restrictionSeconds: Number(event.target.value) })}/></label><label className="wide"><span>{textFor(t, 'Reason code', '原因码')}</span><input value={draft.reasonCode} onChange={(event) => setDraft({ ...draft, reasonCode: event.target.value })}/></label></div>
    </div>}
    <div className="admin-filter-row"><label><span>{textFor(t, 'Status', '状态')}</span><select aria-label={textFor(t, 'Risk case status', '风控案件状态')} value={status} onChange={(event) => setStatus(event.target.value as RiskCaseStatus | '')}><option value="">{textFor(t, 'All', '全部')}</option>{statuses.map((item) => <option key={item}>{item}</option>)}</select></label><label><span>{textFor(t, 'Disposition', '处置')}</span><select aria-label={textFor(t, 'Risk disposition', '风控处置')} value={disposition} onChange={(event) => setDisposition(event.target.value as RiskDisposition | '')}><option value="">{textFor(t, 'All', '全部')}</option>{dispositions.map((item) => <option key={item}>{item}</option>)}</select></label></div>
    <div className="admin-table" data-testid="risk-case-list">{cases.map((item) => <button type="button" className={selectedId === item.id ? 'admin-row selected' : 'admin-row'} key={item.id} onClick={() => selectCase(item)}><span className={`status-badge ${item.status === 'recovered' || item.status === 'closed' ? 'success' : 'warning'}`}>{item.status}</span><strong>@{item.user?.handle ?? item.user?.id ?? '-'}</strong><span>{item.disposition} · {item.riskLevel}</span><small>{item.reasonCode}</small></button>)}{!busy && !cases.length && <div className="empty-state"><strong>{textFor(t, 'No risk cases', '暂无风控案件')}</strong></div>}</div>
    {nextCursor && <button className="ghost-button" type="button" onClick={() => void load(true)} disabled={busy}>{textFor(t, 'Load more', '加载更多')}</button>}
    {selected && <div className="admin-detail-panel" data-testid="risk-case-detail"><div className="admin-section-heading"><div><strong>{selected.id}</strong><small>{selected.signals.length} signals · {selected.appeals.length} appeals · v{selected.version}</small></div></div><div className="trust-fact-list">{selected.signals.map((signal) => <div key={signal.id}><ShieldAlert size={15}/><span>{signal.signalType} · {signal.reasonCode}</span><code>{signal.score}</code></div>)}{selected.events.map((event) => <div key={event.id}><ShieldCheck size={15}/><span>{event.fromStatus ?? 'new'} → {event.toStatus} · {event.disposition}</span><small>{event.reasonCode}</small></div>)}{selected.appeals.map((appeal) => <div key={appeal.id}><ShieldCheck size={15}/><span>appeal · {appeal.status}</span><small>{appeal.reasonCode}</small></div>)}</div>{transitionTargets[selected.status].length > 0 && <div className="trust-action-grid"><label><span>{textFor(t, 'Next status', '下一状态')}</span><select value={toStatus} onChange={(event) => { const next = event.target.value as RiskCaseStatus; setToStatus(next); if (['recovered', 'closed'].includes(next)) setNextDisposition('cleared') }}>{transitionTargets[selected.status].map((item) => <option key={item}>{item}</option>)}</select></label><label><span>{textFor(t, 'Disposition', '处置')}</span><select value={nextDisposition} onChange={(event) => setNextDisposition(event.target.value as RiskDisposition)}>{dispositions.map((item) => <option key={item}>{item}</option>)}</select></label><label><span>{textFor(t, 'Risk level', '风险等级')}</span><select value={riskLevel} onChange={(event) => setRiskLevel(event.target.value as RiskLevel)}>{levels.map((item) => <option key={item}>{item}</option>)}</select></label>{selected.appeals.some((item) => item.status === 'pending') && <label><span>{textFor(t, 'Appeal decision', '申诉裁决')}</span><select value={appealDecision} onChange={(event) => setAppealDecision(event.target.value as 'approved' | 'rejected')}><option value="approved">approved</option><option value="rejected">rejected</option></select></label>}<label className="wide"><span>{textFor(t, 'Reason code', '原因码')}</span><input value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}/></label><button className="primary-button" type="button" onClick={() => void transition()} disabled={!canManage || busy}>{textFor(t, 'Apply transition', '执行状态转换')}</button></div>}</div>}
  </section>
}
