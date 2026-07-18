import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ListChecks, Plus, RefreshCw, ShieldCheck, SlidersHorizontal } from 'lucide-react'

import type {
  ModerationBulkAction,
  ModerationBulkPreview,
  ModerationBulkResult,
  ModerationCasePriority,
  ModerationQueueItem,
  SafetyRuleDto,
  SafetySignalDto,
  TrustOperationsMetrics,
} from '../../services/contracts'
import { trustService } from '../../services/trustService'

type Props = { canOperate: boolean; canManageRules: boolean; isZh: boolean; notify: (message: string) => void }
type View = 'queue' | 'rules' | 'signals'
const priorities: ModerationCasePriority[] = ['normal', 'high', 'critical']

export function TrustSafetyOperationsPanel({ canOperate, canManageRules, isZh, notify }: Props) {
  const [view, setView] = useState<View>('queue')
  const [queue, setQueue] = useState<ModerationQueueItem[]>([])
  const [rules, setRules] = useState<SafetyRuleDto[]>([])
  const [signals, setSignals] = useState<SafetySignalDto[]>([])
  const [metrics, setMetrics] = useState<TrustOperationsMetrics | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [assignment, setAssignment] = useState<'' | 'assigned' | 'unassigned'>('')
  const [sla, setSla] = useState<'' | 'within' | 'breached'>('')
  const [priority, setPriority] = useState<ModerationCasePriority | ''>('')
  const [assigneeId, setAssigneeId] = useState('demo-user-moderator')
  const [reasonCode, setReasonCode] = useState('operator_triage')
  const [bulkAction, setBulkAction] = useState<ModerationBulkAction>('set_priority')
  const [bulkPriority, setBulkPriority] = useState<ModerationCasePriority>('high')
  const [bulkPreview, setBulkPreview] = useState<ModerationBulkPreview | null>(null)
  const [bulkConfirmation, setBulkConfirmation] = useState('')
  const [bulkResult, setBulkResult] = useState<ModerationBulkResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ruleDraft, setRuleDraft] = useState({ ruleKey: 'community.spam', name: 'Community spam score', signalType: 'spam_score', minimumScore: 75, priority: 'high' as ModerationCasePriority, configHash: '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a' })

  const load = useCallback(async () => {
    await Promise.resolve()
    setBusy(true)
    setError(null)
    try {
      const [queuePage, nextRules, signalPage, nextMetrics] = await Promise.all([
        trustService.listQueue({ assignment: assignment || null, sla: sla || null, priority: priority || null, limit: 50 }),
        trustService.listRules(),
        trustService.listSignals({ limit: 25 }),
        trustService.operationsMetrics(),
      ])
      setQueue(queuePage.items)
      setRules(nextRules)
      setSignals(signalPage.items)
      setMetrics(nextMetrics)
      setSelectedIds((current) => current.filter((id) => queuePage.items.some((item) => item.case.id === id)))
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Trust operations could not be loaded.') } finally { setBusy(false) }
  }, [assignment, priority, sla])

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      trustService.listQueue({ assignment: assignment || null, sla: sla || null, priority: priority || null, limit: 50 }),
      trustService.listRules(),
      trustService.listSignals({ limit: 25 }),
      trustService.operationsMetrics(),
    ]).then(([queuePage, nextRules, signalPage, nextMetrics]) => {
      if (cancelled) return
      setQueue(queuePage.items)
      setRules(nextRules)
      setSignals(signalPage.items)
      setMetrics(nextMetrics)
    }).catch((loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Trust operations could not be loaded.') })
    return () => { cancelled = true }
  }, [assignment, priority, sla])

  const run = async (operation: () => Promise<unknown>, message: string) => {
    setBusy(true); setError(null)
    try { await operation(); notify(message); await load() } catch (operationError) { setError(operationError instanceof Error ? operationError.message : 'Trust operation failed.') } finally { setBusy(false) }
  }

  const transition = (rule: SafetyRuleDto, toState: 'canary' | 'active' | 'retired') => run(
    () => trustService.transitionRule(rule.id, { toState, ...(toState === 'canary' ? { rolloutPercent: 10 } : {}), reasonCode: toState === 'active' && rule.state === 'retired' ? 'operator_rollback' : `operator_${toState}` }),
    isZh ? '规则状态已更新。' : 'Rule state updated.',
  )

  const createRule = () => run(
    () => trustService.createRule(ruleDraft),
    isZh ? '规则版本已创建。' : 'Rule version created.',
  )

  const queueAction = (caseId: string, action: 'assign' | 'release' | 'set_priority') => run(
    () => trustService.queueEvent(caseId, { action, ...(action === 'assign' ? { assigneeId } : {}), ...(action === 'set_priority' ? { priority: bulkPriority } : {}), reasonCode }),
    isZh ? '队列状态已更新。' : 'Queue state updated.',
  )

  const bulkPayload = () => ({ action: bulkAction, targetIds: selectedIds, ...(bulkAction === 'assign' ? { assigneeId } : {}), ...(bulkAction === 'set_priority' ? { priority: bulkPriority } : {}), reasonCode })
  const previewBulk = async () => {
    setBusy(true); setError(null); setBulkResult(null)
    try { setBulkPreview(await trustService.previewBulk(bulkPayload())); setBulkConfirmation('') } catch (previewError) { setError(previewError instanceof Error ? previewError.message : 'Bulk preview failed.') } finally { setBusy(false) }
  }
  const executeBulk = async () => {
    if (!bulkPreview) return
    setBusy(true); setError(null)
    try {
      const result = await trustService.executeBulk({ ...bulkPayload(), targetHash: bulkPreview.targetHash, confirmationText: bulkConfirmation, idempotencyKey: `trust-queue-${Date.now()}-${bulkPreview.targetHash.slice(0, 12)}` })
      setBulkResult(result); setBulkPreview(null); setBulkConfirmation(''); setSelectedIds([]); notify(isZh ? '批量队列操作已完成。' : 'Bulk queue operation completed.'); await load()
    } catch (executeError) { setError(executeError instanceof Error ? executeError.message : 'Bulk operation failed.') } finally { setBusy(false) }
  }

  return <div className="trust-ops" data-testid="trust-safety-operations">
    <div className="trust-ops-heading">
      <div><ShieldCheck size={18} /><strong>{isZh ? '安全规则与案件队列' : 'Safety rules and case queue'}</strong></div>
      <button className="icon-button" type="button" onClick={() => void load()} disabled={busy} title={isZh ? '刷新安全运营' : 'Refresh safety operations'}><RefreshCw size={16} /></button>
    </div>
    {metrics && <div className="admin-metric-strip trust-ops-metrics">
      <div><span>{isZh ? '活跃规则' : 'Active rules'}</span><strong>{metrics.rules.active}</strong></div>
      <div><span>{isZh ? '灰度规则' : 'Canary rules'}</span><strong>{metrics.rules.canary}</strong></div>
      <div><span>{isZh ? '24h 信号' : '24h signals'}</span><strong>{metrics.signals.last24Hours}</strong></div>
      <div><span>{isZh ? '未分派' : 'Unassigned'}</span><strong>{metrics.queue.unassigned}</strong></div>
      <div><span>{isZh ? 'SLA 超时' : 'SLA breached'}</span><strong>{metrics.queue.breached}</strong></div>
    </div>}
    <div className="segmented-control trust-ops-tabs" role="tablist">
      <button type="button" className={view === 'queue' ? 'active' : ''} onClick={() => setView('queue')}><ListChecks size={15} />{isZh ? '案件队列' : 'Queue'}</button>
      <button type="button" className={view === 'rules' ? 'active' : ''} onClick={() => setView('rules')}><SlidersHorizontal size={15} />{isZh ? '规则版本' : 'Rules'}</button>
      <button type="button" className={view === 'signals' ? 'active' : ''} onClick={() => setView('signals')}><AlertTriangle size={15} />{isZh ? '安全信号' : 'Signals'}</button>
    </div>
    {error && <div className="inline-alert error" role="alert">{error}</div>}

    {view === 'queue' && <>
      <div className="trust-ops-filters">
        <label><span>{isZh ? '分派' : 'Assignment'}</span><select value={assignment} onChange={(event) => setAssignment(event.target.value as typeof assignment)}><option value="">All</option><option value="assigned">assigned</option><option value="unassigned">unassigned</option></select></label>
        <label><span>SLA</span><select value={sla} onChange={(event) => setSla(event.target.value as typeof sla)}><option value="">All</option><option value="within">within</option><option value="breached">breached</option></select></label>
        <label><span>{isZh ? '优先级' : 'Priority'}</span><select value={priority} onChange={(event) => setPriority(event.target.value as ModerationCasePriority | '')}><option value="">All</option>{priorities.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>{isZh ? '负责人 ID' : 'Assignee ID'}</span><input value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)} /></label>
        <label><span>{isZh ? '原因代码' : 'Reason code'}</span><input value={reasonCode} onChange={(event) => setReasonCode(event.target.value)} /></label>
      </div>
      <div className="admin-table trust-queue-list">
        {queue.map((item) => <div className="admin-row compact" key={item.case.id} data-testid={`trust-queue-${item.case.id}`}>
          <input type="checkbox" aria-label={`Select ${item.case.id}`} checked={selectedIds.includes(item.case.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, item.case.id] : current.filter((id) => id !== item.case.id))} />
          <div><strong>{item.case.report?.subject ?? item.case.id}</strong><small>{item.case.id} · {item.queue.assignee?.handle ?? 'unassigned'} · {new Date(item.queue.dueAt).toLocaleString()}</small></div>
          <span className={`status-badge ${item.queue.breached ? 'danger' : item.queue.priority === 'critical' ? 'warning' : ''}`}>{item.queue.breached ? 'breached' : item.queue.priority}</span>
          {canOperate && <div className="button-row"><button className="icon-button" type="button" onClick={() => void queueAction(item.case.id, item.queue.assignee ? 'release' : 'assign')} title={item.queue.assignee ? 'Release' : 'Assign'}><ListChecks size={15} /></button><button className="icon-button" type="button" onClick={() => void queueAction(item.case.id, 'set_priority')} title="Set priority"><AlertTriangle size={15} /></button></div>}
        </div>)}
      </div>
      {canOperate && selectedIds.length > 0 && <div className="trust-bulk-bar">
        <strong>{isZh ? `已选 ${selectedIds.length} 项` : `${selectedIds.length} selected`}</strong>
        <select aria-label="Moderation bulk action" value={bulkAction} onChange={(event) => { setBulkAction(event.target.value as ModerationBulkAction); setBulkPreview(null) }}><option value="assign">assign</option><option value="release">release</option><option value="set_priority">set_priority</option></select>
        {bulkAction === 'set_priority' && <select aria-label="Moderation bulk priority" value={bulkPriority} onChange={(event) => setBulkPriority(event.target.value as ModerationCasePriority)}>{priorities.map((item) => <option key={item}>{item}</option>)}</select>}
        <button className="ghost-button" type="button" onClick={() => void previewBulk()} disabled={busy}>{isZh ? '预览' : 'Preview'}</button>
        {bulkPreview && <><span>{bulkPreview.eligibleCount} eligible / {bulkPreview.skippedCount} skipped</span><input aria-label="Moderation bulk confirmation" value={bulkConfirmation} onChange={(event) => setBulkConfirmation(event.target.value)} placeholder={bulkPreview.requiredConfirmationText} /><button className="primary-button" type="button" onClick={() => void executeBulk()} disabled={bulkConfirmation !== bulkPreview.requiredConfirmationText}>{isZh ? '执行' : 'Execute'}</button></>}
        {bulkResult && <span>{bulkResult.succeededCount} succeeded / {bulkResult.skippedCount} skipped</span>}
      </div>}
    </>}

    {view === 'rules' && <>
      {canManageRules && <div className="trust-rule-form">
        <input aria-label="Rule key" value={ruleDraft.ruleKey} onChange={(event) => setRuleDraft((current) => ({ ...current, ruleKey: event.target.value }))} />
        <input aria-label="Rule name" value={ruleDraft.name} onChange={(event) => setRuleDraft((current) => ({ ...current, name: event.target.value }))} />
        <input aria-label="Signal type" value={ruleDraft.signalType} onChange={(event) => setRuleDraft((current) => ({ ...current, signalType: event.target.value }))} />
        <input aria-label="Minimum score" type="number" min="0" max="100" value={ruleDraft.minimumScore} onChange={(event) => setRuleDraft((current) => ({ ...current, minimumScore: Number(event.target.value) }))} />
        <select aria-label="Rule priority" value={ruleDraft.priority} onChange={(event) => setRuleDraft((current) => ({ ...current, priority: event.target.value as ModerationCasePriority }))}>{priorities.map((item) => <option key={item}>{item}</option>)}</select>
        <input aria-label="Rule config hash" value={ruleDraft.configHash} onChange={(event) => setRuleDraft((current) => ({ ...current, configHash: event.target.value }))} placeholder="SHA-256 configuration hash" />
        <button className="primary-button" type="button" onClick={() => void createRule()} disabled={busy}><Plus size={15} />{isZh ? '创建版本' : 'Create version'}</button>
      </div>}
      <div className="admin-table trust-rule-list">{rules.map((rule) => <div className="admin-row compact" key={rule.id} data-testid={`trust-rule-${rule.id}`}><div><strong>{rule.name} · v{rule.version}</strong><small>{rule.ruleKey} · {rule.signalType} ≥ {rule.minimumScore} · {rule.rolloutPercent}%</small></div><span className="status-badge">{rule.state}</span>{canManageRules && <div className="button-row">{rule.state === 'draft' && <button className="ghost-button" type="button" onClick={() => void transition(rule, 'canary')}>Canary</button>}{['draft', 'canary', 'retired'].includes(rule.state) && <button className="ghost-button" type="button" onClick={() => void transition(rule, 'active')}>{rule.state === 'retired' ? 'Rollback' : 'Activate'}</button>}{rule.state !== 'retired' && <button className="ghost-button danger" type="button" onClick={() => void transition(rule, 'retired')}>Retire</button>}</div>}</div>)}</div>
    </>}

    {view === 'signals' && <div className="admin-table trust-signal-list">{signals.map((signal) => <div className="admin-row compact" key={signal.id}><div><strong>{signal.signalType} · {signal.score}</strong><small>{signal.caseId} · {new Date(signal.observedAt).toLocaleString()}</small></div><span className={`status-badge ${signal.severity === 'critical' ? 'danger' : ''}`}>{signal.severity}</span><code>{signal.contentHash.slice(0, 12)}</code></div>)}</div>}
  </div>
}
