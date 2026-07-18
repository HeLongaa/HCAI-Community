import { useCallback, useEffect, useState } from 'react'
import { Download, FileCheck2, RefreshCw, Scale, Search } from 'lucide-react'

import { SectionHeader } from '../../components/ui/SectionHeader'
import type { Permission } from '../../domain/types'
import type { ModerationCaseDto, ModerationCaseMetrics, ModerationCasePriority, ModerationCaseStatus, ModerationDecisionOutcome, ModerationReportCategory, ModerationTargetType } from '../../services/contracts'
import { trustService } from '../../services/trustService'
import { TrustSafetyOperationsPanel } from './TrustSafetyOperationsPanel'

type Props = { hasPermission: (permission: Permission) => boolean; isZh: boolean; notify: (message: string) => void }
const statuses: ModerationCaseStatus[] = ['open', 'resolved', 'appealed', 'closed']
const priorities: ModerationCasePriority[] = ['normal', 'high', 'critical']
const targetTypes: ModerationTargetType[] = ['user', 'post', 'comment', 'media_asset', 'creative_generation']
const categories: ModerationReportCategory[] = ['harassment', 'hate', 'sexual', 'violence', 'self_harm', 'child_safety', 'impersonation', 'spam', 'fraud', 'privacy', 'copyright', 'other']
const originalOutcomes: ModerationDecisionOutcome[] = ['no_action', 'warn', 'restrict_content', 'remove_content', 'suspend_account']
const appealOutcomes: ModerationDecisionOutcome[] = ['uphold', 'overturn', 'partially_overturn']

export function TrustSafetyAdminPanel({ hasPermission, isZh, notify }: Props) {
  const canRead = hasPermission('admin:trust:read')
  const canReview = hasPermission('admin:trust:review')
  const canExport = hasPermission('admin:trust:export')
  const canOperate = hasPermission('admin:trust:operate')
  const canManageRules = hasPermission('admin:trust:rules')
  const [items, setItems] = useState<ModerationCaseDto[]>([])
  const [metrics, setMetrics] = useState<ModerationCaseMetrics | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<ModerationCaseDto | null>(null)
  const [status, setStatus] = useState<ModerationCaseStatus | ''>('')
  const [priority, setPriority] = useState<ModerationCasePriority | ''>('')
  const [targetType, setTargetType] = useState<ModerationTargetType | ''>('')
  const [category, setCategory] = useState<ModerationReportCategory | ''>('')
  const [search, setSearch] = useState('')
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reasonCode, setReasonCode] = useState('policy_violation_confirmed')
  const [note, setNote] = useState('')
  const [outcome, setOutcome] = useState<ModerationDecisionOutcome>('warn')
  const [acting, setActing] = useState(false)
  const [evidenceType, setEvidenceType] = useState('operator_reference')
  const [referenceType, setReferenceType] = useState('internal_record')
  const [referenceId, setReferenceId] = useState('')
  const [contentHash, setContentHash] = useState('')

  const query = useCallback(() => ({ status: status || null, priority: priority || null, targetType: targetType || null, category: category || null, search: search.trim() || null, limit: 20, sort: 'createdAt' as const, order: 'desc' as const }), [category, priority, search, status, targetType])

  const load = useCallback(async (append = false) => {
    if (!canRead) return
    setLoading(true)
    setError(null)
    try {
      const [page, nextMetrics] = await Promise.all([trustService.adminList({ ...query(), cursor: append ? nextCursor : null }), trustService.adminMetrics()])
      setItems((current) => append ? [...current, ...page.items] : page.items)
      setMetrics(nextMetrics)
      setNextCursor(page.nextCursor)
      const nextId = append ? selectedId : page.items[0]?.id ?? null
      setSelectedId(nextId)
      if (nextId) setSelected(await trustService.adminGet(nextId))
      else setSelected(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : isZh ? '无法读取审核案件。' : 'Could not load moderation cases.')
    } finally {
      setLoading(false)
    }
  }, [canRead, isZh, nextCursor, query, selectedId])

  useEffect(() => {
    if (!canRead) return
    let cancelled = false
    void Promise.all([trustService.adminList({ limit: 20, sort: 'createdAt', order: 'desc' }), trustService.adminMetrics()]).then(async ([page, nextMetrics]) => {
      if (cancelled) return
      setItems(page.items)
      setMetrics(nextMetrics)
      setNextCursor(page.nextCursor)
      const nextId = page.items[0]?.id ?? null
      setSelectedId(nextId)
      if (nextId) setSelected(await trustService.adminGet(nextId))
    }).catch((loadError) => {
      if (!cancelled) setError(loadError instanceof Error ? loadError.message : isZh ? '无法读取审核案件。' : 'Could not load moderation cases.')
    })
    return () => { cancelled = true }
  }, [canRead, isZh])

  const choose = async (id: string) => {
    setSelectedId(id)
    setError(null)
    try { setSelected(await trustService.adminGet(id)) } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Could not load moderation case.') }
  }

  const decide = async () => {
    if (!selected || !canReview) return
    const stage = selected.status === 'appealed' ? 'appeal' : 'original'
    setActing(true)
    setError(null)
    try {
      const validOutcomes = stage === 'appeal' ? appealOutcomes : originalOutcomes
      const selectedOutcome = validOutcomes.includes(outcome) ? outcome : validOutcomes[0]
      const updated = await trustService.decide(selected.id, { stage, outcome: selectedOutcome, reasonCode, note, expectedVersion: selected.version })
      setSelected(updated)
      setItems((current) => current.map((item) => item.id === updated.id ? updated : item))
      setMetrics(await trustService.adminMetrics())
      setNote('')
      notify(isZh ? '审核决定已追加。' : 'Moderation decision appended.')
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : 'Decision failed.') } finally { setActing(false) }
  }

  const addEvidence = async () => {
    if (!selected || !canReview) return
    setActing(true)
    setError(null)
    try {
      const result = await trustService.addEvidence(selected.id, { evidenceType, referenceType, referenceId, contentHash, reasonCode: 'operator_evidence_added' })
      setSelected(result.item)
      setReferenceId('')
      setContentHash('')
      notify(isZh ? (result.duplicate ? '证据已存在。' : '证据已追加。') : result.duplicate ? 'Evidence already exists.' : 'Evidence appended.')
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : 'Evidence failed.') } finally { setActing(false) }
  }

  const exportJson = async () => {
    try {
      const document = await trustService.adminExport(query())
      const url = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }))
      const link = window.document.createElement('a')
      link.href = url
      link.download = `moderation-cases-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      URL.revokeObjectURL(url)
    } catch (exportError) { setError(exportError instanceof Error ? exportError.message : 'Export failed.') }
  }

  if (!canRead) return <section className="panel trust-admin-panel" data-testid="trust-admin-panel"><SectionHeader eyebrow="Trust & Safety" title={isZh ? '举报与申诉案件' : 'Reports and appeals'} /><div className="empty-state"><strong>{isZh ? '无访问权限' : 'Access denied'}</strong></div></section>

  const stage = selected?.status === 'appealed' ? 'appeal' : 'original'
  const outcomes = stage === 'appeal' ? appealOutcomes : originalOutcomes
  const decisionAllowed = selected && ['open', 'appealed'].includes(selected.status)

  return (
    <section className="panel trust-admin-panel" data-testid="trust-admin-panel">
      <SectionHeader eyebrow="Trust & Safety" title={isZh ? '举报、决定与申诉' : 'Reports, decisions and appeals'} action={<div className="button-row"><button className="icon-button" type="button" onClick={() => void load(false)} title={isZh ? '刷新' : 'Refresh'}><RefreshCw size={17} /></button><button className="ghost-button" type="button" onClick={() => void exportJson()} disabled={!canExport}><Download size={16} />{isZh ? '导出' : 'Export'}</button></div>} />
      <TrustSafetyOperationsPanel canOperate={canOperate} canManageRules={canManageRules} isZh={isZh} notify={notify} />
      <div className="admin-metric-strip">
        {metrics && Object.entries(metrics).map(([key, value]) => <div key={key}><span>{key}</span><strong>{value}</strong></div>)}
      </div>
      <div className="trust-admin-filters">
        <label><span>{isZh ? '搜索' : 'Search'}</span><div><Search size={15} /><input aria-label={isZh ? '案件搜索' : 'Case search'} value={search} onChange={(event) => setSearch(event.target.value)} /></div></label>
        <label><span>{isZh ? '状态' : 'Status'}</span><select value={status} onChange={(event) => setStatus(event.target.value as ModerationCaseStatus | '')}><option value="">All</option>{statuses.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>{isZh ? '优先级' : 'Priority'}</span><select value={priority} onChange={(event) => setPriority(event.target.value as ModerationCasePriority | '')}><option value="">All</option>{priorities.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>{isZh ? '目标' : 'Target'}</span><select value={targetType} onChange={(event) => setTargetType(event.target.value as ModerationTargetType | '')}><option value="">All</option>{targetTypes.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>{isZh ? '分类' : 'Category'}</span><select value={category} onChange={(event) => setCategory(event.target.value as ModerationReportCategory | '')}><option value="">All</option>{categories.map((value) => <option key={value}>{value}</option>)}</select></label>
        <button className="ghost-button" type="button" onClick={() => void load(false)} disabled={loading}><Search size={16} />{isZh ? '查询' : 'Apply'}</button>
      </div>
      {error && <div className="inline-alert error" role="alert">{error}</div>}
      <div className="trust-admin-layout">
        <div className="admin-table trust-case-list">
          {items.map((item) => <button className={`admin-row compact ${selectedId === item.id ? 'active' : ''}`} type="button" key={item.id} onClick={() => void choose(item.id)}><div><strong>{item.report?.subject ?? item.id}</strong><small>{item.targetType}:{item.targetId}</small></div><span className={`status-badge ${item.priority === 'critical' ? 'danger' : item.priority === 'high' ? 'warning' : ''}`}>{item.status} · {item.priority}</span></button>)}
          {!loading && items.length === 0 && <div className="empty-state"><strong>{isZh ? '暂无案件' : 'No cases'}</strong></div>}
          {nextCursor && <button className="ghost-button" type="button" onClick={() => void load(true)}>{isZh ? '加载更多' : 'Load more'}</button>}
        </div>
        {selected && <div className="trust-case-detail">
          <div className="trust-case-heading"><div><strong>{selected.report?.subject}</strong><small>{selected.id} · v{selected.version}</small></div><span className="status-badge">{selected.status}</span></div>
          <dl className="delivery-facts"><div><dt>Target</dt><dd>{selected.targetType}:{selected.targetId}</dd></div><div><dt>Category</dt><dd>{selected.report?.category}</dd></div><div><dt>Affected</dt><dd>{selected.affectedUser?.handle ?? selected.affectedUser?.id ?? '-'}</dd></div><div><dt>Reporter</dt><dd>{selected.report?.reporter?.handle ?? '-'}</dd></div></dl>
          <div className="trust-statement"><strong>{isZh ? '举报陈述' : 'Report statement'}</strong><p>{selected.report?.statement}</p></div>
          <div className="trust-fact-list"><strong>{isZh ? '事实链' : 'Fact chain'}</strong>{selected.evidence.map((item) => <div key={item.id}><FileCheck2 size={15} /><span>{item.evidenceType} · {item.referenceType}:{item.referenceId}</span><code>{item.contentHash.slice(0, 12)}</code></div>)}{selected.decisions.map((item) => <div key={item.id}><Scale size={15} /><span>{item.stage} · {item.outcome} · {item.reasonCode}</span><small>@{item.reviewer?.handle ?? '-'}</small></div>)}{selected.appeals.map((item) => <div key={item.id}><Scale size={15} /><span>appeal · {item.reasonCode}</span><small>@{item.appellant?.handle ?? '-'}</small></div>)}{selected.communityActions.map((item) => <div key={item.id}><Scale size={15} /><span>{item.action} · {item.fromState} → {item.toState}</span><small>{item.targetType}:{item.targetId}</small></div>)}</div>
          {decisionAllowed && <div className="trust-action-grid"><label><span>Outcome</span><select aria-label="Moderation outcome" value={outcomes.includes(outcome) ? outcome : outcomes[0]} onChange={(event) => setOutcome(event.target.value as ModerationDecisionOutcome)}>{outcomes.map((value) => <option key={value}>{value}</option>)}</select></label><label><span>Reason code</span><input aria-label="Moderation reason code" value={reasonCode} onChange={(event) => setReasonCode(event.target.value)} /></label><label className="wide"><span>Review note</span><textarea aria-label="Moderation review note" value={note} onChange={(event) => setNote(event.target.value)} /></label><button className="primary-button" type="button" onClick={() => void decide()} disabled={!canReview || acting || !note.trim()}><Scale size={16} />{stage === 'appeal' ? (isZh ? '追加申诉裁决' : 'Append appeal decision') : (isZh ? '追加原审决定' : 'Append decision')}</button></div>}
          <div className="trust-action-grid"><label><span>Evidence type</span><input value={evidenceType} onChange={(event) => setEvidenceType(event.target.value)} /></label><label><span>Reference type</span><input value={referenceType} onChange={(event) => setReferenceType(event.target.value)} /></label><label><span>Reference ID</span><input aria-label="Evidence reference ID" value={referenceId} onChange={(event) => setReferenceId(event.target.value)} /></label><label className="wide"><span>SHA-256</span><input aria-label="Evidence content hash" value={contentHash} onChange={(event) => setContentHash(event.target.value)} /></label><button className="ghost-button" type="button" onClick={() => void addEvidence()} disabled={!canReview || acting || !referenceId || !/^[a-f0-9]{64}$/.test(contentHash)}><FileCheck2 size={16} />{isZh ? '追加证据' : 'Append evidence'}</button></div>
        </div>}
      </div>
    </section>
  )
}
