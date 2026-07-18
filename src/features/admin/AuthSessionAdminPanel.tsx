import { useCallback, useEffect, useState } from 'react'
import { Activity, Ban, RefreshCw, Save, Search, ShieldAlert, ShieldCheck } from 'lucide-react'

import { SectionHeader } from '../../components/ui/SectionHeader'
import { textFor } from '../../domain/utils'
import { adminService } from '../../services/adminService'
import type { AdminAuthFailure, AdminAuthMetrics, AdminAuthRiskPolicy, AdminAuthSession } from '../../services/contracts'

type Props = {
  t: Record<string, string>
  canRead: boolean
  canManage: boolean
  notify: (message: string) => void
}

const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback
const isoDate = (date: Date) => date.toISOString().slice(0, 10)
const initialDateTo = () => isoDate(new Date(Date.now() + 86_400_000))
const initialDateFrom = () => isoDate(new Date(Date.now() - 29 * 86_400_000))

export function AuthSessionAdminPanel({ t, canRead, canManage, notify }: Props) {
  const [sessions, setSessions] = useState<AdminAuthSession[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [status, setStatus] = useState('active')
  const [riskStatus, setRiskStatus] = useState('')
  const [search, setSearch] = useState('')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [draftRisks, setDraftRisks] = useState<Record<string, AdminAuthSession['riskStatus']>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [metrics, setMetrics] = useState<AdminAuthMetrics | null>(null)
  const [dateFrom, setDateFrom] = useState(initialDateFrom)
  const [dateTo, setDateTo] = useState(initialDateTo)
  const [failures, setFailures] = useState<AdminAuthFailure[]>([])
  const [failureCursor, setFailureCursor] = useState<string | null>(null)
  const [failureMethod, setFailureMethod] = useState('')
  const [failureReason, setFailureReason] = useState('')
  const [policy, setPolicy] = useState<AdminAuthRiskPolicy | null>(null)
  const [policyDraft, setPolicyDraft] = useState<AdminAuthRiskPolicy | null>(null)
  const [operationsBusy, setOperationsBusy] = useState(false)

  const load = useCallback(async (append = false) => {
    if (!canRead) return
    setLoading(true)
    setError('')
    try {
      const page = await adminService.authSessions({
        status: status || undefined,
        riskStatus: riskStatus || undefined,
        search: search.trim() || undefined,
        cursor: append ? nextCursor ?? undefined : undefined,
        limit: 20,
        sort: 'lastSeenAt',
        order,
      })
      setSessions((current) => append ? [...current, ...page.items] : page.items)
      setNextCursor(page.nextCursor)
      setDraftRisks((current) => ({
        ...current,
        ...Object.fromEntries(page.items.map((session) => [session.id, current[session.id] ?? session.riskStatus])),
      }))
    } catch (loadError) {
      setError(errorMessage(loadError, textFor(t, 'Could not load auth sessions.', '无法读取认证会话。')))
    } finally {
      setLoading(false)
    }
  }, [canRead, nextCursor, order, riskStatus, search, status, t])

  useEffect(() => {
    if (!canRead) return
    let active = true
    adminService.authSessions({ status: 'active', limit: 20, sort: 'lastSeenAt', order: 'desc' })
      .then((page) => {
        if (!active) return
        setSessions(page.items)
        setNextCursor(page.nextCursor)
        setDraftRisks(Object.fromEntries(page.items.map((session) => [session.id, session.riskStatus])))
      })
      .catch((loadError) => {
        if (active) setError(errorMessage(loadError, textFor(t, 'Could not load auth sessions.', '无法读取认证会话。')))
      })
    return () => { active = false }
  }, [canRead, t])

  const loadOperations = useCallback(async (appendFailures = false) => {
    if (!canRead) return
    setOperationsBusy(true)
    setError('')
    try {
      const [nextMetrics, failurePage, nextPolicy] = await Promise.all([
        adminService.authMetrics({ dateFrom, dateTo }),
        adminService.authFailures({ method: failureMethod || undefined, reasonCode: failureReason.trim() || undefined, dateFrom, dateTo, cursor: appendFailures ? failureCursor ?? undefined : undefined, limit: 20 }),
        adminService.authRiskPolicy(),
      ])
      setMetrics(nextMetrics)
      setFailures((current) => appendFailures ? [...current, ...failurePage.items] : failurePage.items)
      setFailureCursor(failurePage.nextCursor)
      setPolicy(nextPolicy)
      if (!appendFailures) setPolicyDraft(nextPolicy)
    } catch (loadError) {
      setError(errorMessage(loadError, textFor(t, 'Could not load authentication operations.', '无法读取认证运营数据。')))
    } finally {
      setOperationsBusy(false)
    }
  }, [canRead, dateFrom, dateTo, failureCursor, failureMethod, failureReason, t])

  useEffect(() => {
    if (!canRead) return
    let active = true
    void Promise.all([
      adminService.authMetrics({ dateFrom, dateTo }),
      adminService.authFailures({ dateFrom, dateTo, limit: 20 }),
      adminService.authRiskPolicy(),
    ]).then(([nextMetrics, failurePage, nextPolicy]) => {
      if (!active) return
      setMetrics(nextMetrics)
      setFailures(failurePage.items)
      setFailureCursor(failurePage.nextCursor)
      setPolicy(nextPolicy)
      setPolicyDraft(nextPolicy)
    }).catch((loadError) => {
      if (active) setError(errorMessage(loadError, textFor(t, 'Could not load authentication operations.', '无法读取认证运营数据。')))
    })
    return () => { active = false }
  }, [canRead, dateFrom, dateTo, t])

  const savePolicy = async () => {
    if (!canManage || !policyDraft || !policy) return
    setOperationsBusy(true)
    setError('')
    try {
      const updated = await adminService.updateAuthRiskPolicy({
        enabled: policyDraft.enabled,
        windowSeconds: Number(policyDraft.windowSeconds),
        ipAccountThreshold: Number(policyDraft.ipAccountThreshold),
        accountIpThreshold: Number(policyDraft.accountIpThreshold),
        expectedVersion: policy.version,
        reasonCode: policyDraft.reasonCode.trim() || 'operator_policy_update',
      })
      setPolicy(updated)
      setPolicyDraft(updated)
      notify(textFor(t, 'Authentication risk policy saved.', '认证风险策略已保存。'))
    } catch (actionError) {
      setError(errorMessage(actionError, textFor(t, 'Could not save authentication policy.', '无法保存认证策略。')))
      await loadOperations(false)
    } finally {
      setOperationsBusy(false)
    }
  }

  const updateSession = (updated: AdminAuthSession) => {
    setSessions((current) => current.map((session) => session.id === updated.id ? updated : session))
    setDraftRisks((current) => ({ ...current, [updated.id]: updated.riskStatus }))
  }

  const disposition = async (session: AdminAuthSession) => {
    if (!canManage) return
    const nextRisk = draftRisks[session.id] ?? session.riskStatus
    const reasonCode = reasons[session.id]?.trim() || (nextRisk === 'normal' ? 'operator_reviewed' : 'operator_risk_disposition')
    if (nextRisk === 'compromised' && !window.confirm(textFor(t, 'Mark this session compromised and revoke it?', '将此会话标记为已攻陷并撤销？'))) return
    setBusyId(session.id)
    setError('')
    try {
      const result = await adminService.dispositionAuthSession(session.id, { riskStatus: nextRisk, expectedVersion: session.version, reasonCode })
      updateSession(result.session)
      notify(textFor(t, 'Session risk disposition saved.', '会话风险处置已保存。'))
    } catch (actionError) {
      setError(errorMessage(actionError, textFor(t, 'Could not update session risk.', '无法更新会话风险。')))
      await load(false)
    } finally {
      setBusyId(null)
    }
  }

  const revoke = async (session: AdminAuthSession) => {
    if (!canManage || !window.confirm(textFor(t, 'Revoke this session now?', '立即撤销此会话？'))) return
    setBusyId(session.id)
    setError('')
    try {
      const result = await adminService.revokeAuthSession(session.id, {
        expectedVersion: session.version,
        reasonCode: reasons[session.id]?.trim() || 'operator_revoked',
      })
      updateSession(result.session)
      notify(textFor(t, 'Session revoked.', '会话已撤销。'))
    } catch (actionError) {
      setError(errorMessage(actionError, textFor(t, 'Could not revoke session.', '无法撤销会话。')))
      await load(false)
    } finally {
      setBusyId(null)
    }
  }

  const revokeUser = async (session: AdminAuthSession) => {
    if (!canManage || !window.confirm(textFor(t, 'Revoke every active session for this user?', '撤销该用户的全部活跃会话？'))) return
    setBusyId(`user:${session.user.id}`)
    setError('')
    try {
      const result = await adminService.revokeUserAuthSessions(session.user.id, reasons[session.id]?.trim() || 'operator_account_containment')
      notify(textFor(t, `Revoked ${result.revoked} sessions.`, `已撤销 ${result.revoked} 个会话。`))
      await load(false)
    } catch (actionError) {
      setError(errorMessage(actionError, textFor(t, 'Could not revoke user sessions.', '无法撤销用户会话。')))
    } finally {
      setBusyId(null)
    }
  }

  if (!canRead) return null

  return (
    <section className="panel auth-session-admin-panel" data-testid="auth-session-admin-panel">
      <SectionHeader
        eyebrow={textFor(t, 'Identity security', '身份安全')}
        title={textFor(t, 'Session lifecycle', '会话生命周期')}
        action={<button className="ghost-button" type="button" onClick={() => void load(false)} disabled={loading}><RefreshCw size={17} />{textFor(t, 'Refresh', '刷新')}</button>}
      />
      <div className="auth-risk-operations">
        <div className="auth-risk-toolbar">
          <div><Activity size={17} /><strong>{textFor(t, 'Authentication activity', '认证活动')}</strong></div>
          <label><span>{textFor(t, 'From', '开始')}</span><input aria-label={textFor(t, 'Authentication metrics from', '认证指标开始日期')} type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
          <label><span>{textFor(t, 'To', '结束')}</span><input aria-label={textFor(t, 'Authentication metrics to', '认证指标结束日期')} type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
          <button className="icon-button" type="button" title={textFor(t, 'Refresh authentication activity', '刷新认证活动')} aria-label={textFor(t, 'Refresh authentication activity', '刷新认证活动')} onClick={() => void loadOperations(false)} disabled={operationsBusy}><RefreshCw size={16} /></button>
        </div>
        {metrics && <div className="auth-metric-grid" data-testid="auth-risk-metrics">
          <div><span>{textFor(t, 'Attempts', '尝试')}</span><strong>{metrics.totals.attempts}</strong></div>
          <div><span>{textFor(t, 'Successes', '成功')}</span><strong>{metrics.totals.successes}</strong></div>
          <div><span>{textFor(t, 'Failures', '失败')}</span><strong>{metrics.totals.failures}</strong></div>
          <div><span>{textFor(t, 'Success rate', '成功率')}</span><strong>{metrics.totals.successRatePercent}%</strong></div>
          <div><span>{textFor(t, 'Active sessions', '活跃会话')}</span><strong>{metrics.totals.activeSessions}</strong></div>
          <div><span>{textFor(t, 'Risk sessions', '风险会话')}</span><strong>{metrics.sessionRisk.suspicious + metrics.sessionRisk.compromised}</strong></div>
        </div>}
        {metrics && <div className="auth-metric-breakdown"><span>{metrics.methods.map((item) => `${item.method} ${item.successes}/${item.failures}`).join(' · ') || textFor(t, 'No method activity', '暂无方式活动')}</span><span>{metrics.failureReasons.map((item) => `${item.reasonCode} ${item.count}`).join(' · ') || textFor(t, 'No failure reasons', '暂无失败原因')}</span></div>}
      </div>

      {policyDraft && <div className="auth-risk-policy" data-testid="auth-risk-policy">
        <label className="auth-policy-toggle"><input aria-label={textFor(t, 'Enable authentication risk monitor', '启用认证风险监控')} type="checkbox" checked={policyDraft.enabled} onChange={(event) => setPolicyDraft({ ...policyDraft, enabled: event.target.checked })} disabled={!canManage} /><span>{textFor(t, 'Risk monitor', '风险监控')}</span></label>
        <label><span>{textFor(t, 'Window seconds', '窗口秒数')}</span><input aria-label={textFor(t, 'Authentication risk window seconds', '认证风险窗口秒数')} type="number" min="60" max="86400" value={policyDraft.windowSeconds} onChange={(event) => setPolicyDraft({ ...policyDraft, windowSeconds: Number(event.target.value) })} disabled={!canManage} /></label>
        <label><span>{textFor(t, 'Accounts per network', '单网络账号数')}</span><input aria-label={textFor(t, 'Authentication accounts per network threshold', '认证单网络账号阈值')} type="number" min="2" max="100" value={policyDraft.ipAccountThreshold} onChange={(event) => setPolicyDraft({ ...policyDraft, ipAccountThreshold: Number(event.target.value) })} disabled={!canManage} /></label>
        <label><span>{textFor(t, 'Networks per account', '单账号网络数')}</span><input aria-label={textFor(t, 'Authentication networks per account threshold', '认证单账号网络阈值')} type="number" min="2" max="100" value={policyDraft.accountIpThreshold} onChange={(event) => setPolicyDraft({ ...policyDraft, accountIpThreshold: Number(event.target.value) })} disabled={!canManage} /></label>
        <label><span>{textFor(t, 'Reason code', '原因码')}</span><input aria-label={textFor(t, 'Authentication policy reason code', '认证策略原因码')} value={policyDraft.reasonCode} onChange={(event) => setPolicyDraft({ ...policyDraft, reasonCode: event.target.value })} disabled={!canManage} /></label>
        <button className="ghost-button" type="button" onClick={() => void savePolicy()} disabled={!canManage || operationsBusy}><Save size={16} />{textFor(t, 'Save policy', '保存策略')}</button>
        <span className={policyDraft.enabled ? 'status-badge success' : 'status-badge warning'}>{policyDraft.enabled ? textFor(t, 'Enabled', '已启用') : textFor(t, 'Disabled', '已停用')} · v{policyDraft.version}</span>
      </div>}

      <div className="auth-failure-block">
        <div className="auth-failure-filters">
          <label><span>{textFor(t, 'Failure method', '失败方式')}</span><select aria-label={textFor(t, 'Authentication failure method', '认证失败方式')} value={failureMethod} onChange={(event) => setFailureMethod(event.target.value)}><option value="">{textFor(t, 'All', '全部')}</option>{['email', 'demo', 'google', 'github', 'apple', 'discord'].map((method) => <option value={method} key={method}>{method}</option>)}</select></label>
          <label><span>{textFor(t, 'Reason code', '原因码')}</span><input aria-label={textFor(t, 'Authentication failure reason', '认证失败原因')} value={failureReason} onChange={(event) => setFailureReason(event.target.value)} /></label>
          <button className="ghost-button" type="button" onClick={() => void loadOperations(false)} disabled={operationsBusy}><Search size={16} />{textFor(t, 'Filter failures', '筛选失败')}</button>
        </div>
        <div className="auth-failure-list">
          {failures.map((failure) => <div className="auth-failure-row" key={failure.id} data-testid={`auth-failure-${failure.id}`}><strong>{failure.identityHint ?? textFor(t, 'Unknown identity', '未知身份')}</strong><span>{failure.method}</span><code>{failure.reasonCode}</code><span>{failure.clientLabel}</span><span>{failure.networkHint ?? '-'}</span><time>{new Date(failure.occurredAt).toLocaleString()}</time></div>)}
          {!operationsBusy && failures.length === 0 && <div className="empty-state"><strong>{textFor(t, 'No authentication failures', '暂无认证失败')}</strong></div>}
        </div>
        {failureCursor && <button className="ghost-button" type="button" onClick={() => void loadOperations(true)} disabled={operationsBusy}>{textFor(t, 'Load more failures', '加载更多失败')}</button>}
      </div>
      <div className="auth-session-filters">
        <label><span>{textFor(t, 'Status', '状态')}</span><select aria-label={textFor(t, 'Session status', '会话状态')} value={status} onChange={(event) => setStatus(event.target.value)}><option value="">{textFor(t, 'All', '全部')}</option><option value="active">active</option><option value="revoked">revoked</option><option value="expired">expired</option></select></label>
        <label><span>{textFor(t, 'Risk', '风险')}</span><select aria-label={textFor(t, 'Session risk', '会话风险')} value={riskStatus} onChange={(event) => setRiskStatus(event.target.value)}><option value="">{textFor(t, 'All', '全部')}</option><option value="normal">normal</option><option value="suspicious">suspicious</option><option value="compromised">compromised</option></select></label>
        <label className="oauth-search-field"><span>{textFor(t, 'User', '用户')}</span><div><Search size={16} /><input aria-label={textFor(t, 'Session user search', '会话用户搜索')} value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void load(false) }} /></div></label>
        <label><span>{textFor(t, 'Order', '顺序')}</span><select value={order} onChange={(event) => setOrder(event.target.value as 'asc' | 'desc')}><option value="desc">desc</option><option value="asc">asc</option></select></label>
        <button className="ghost-button" type="button" onClick={() => void load(false)} disabled={loading}><Search size={16} />{textFor(t, 'Apply', '查询')}</button>
      </div>
      {error && <div className="inline-alert error">{error}</div>}
      <div className="auth-session-admin-list">
        {sessions.map((session) => (
          <article className="auth-session-admin-row" data-testid={`admin-auth-session-${session.id}`} key={session.id}>
            <div className="auth-session-user"><strong>{session.user.handle ? `@${session.user.handle}` : session.user.displayName}</strong><span>{session.user.email ?? session.user.id}</span></div>
            <div><strong>{session.clientLabel}</strong><span>{session.networkHint ? `network ${session.networkHint}` : 'network unavailable'}</span></div>
            <div><span className={`status-badge ${session.status === 'active' ? 'success' : 'danger'}`}>{session.status}</span><span className={`status-badge ${session.riskStatus === 'normal' ? '' : 'warning'}`}>{session.riskStatus}</span></div>
            <div><span>{textFor(t, 'Last seen', '最近活动')}</span><strong>{new Date(session.lastSeenAt).toLocaleString()}</strong><span>v{session.version}</span></div>
            <input aria-label={`${session.id} reason code`} value={reasons[session.id] ?? ''} onChange={(event) => setReasons((current) => ({ ...current, [session.id]: event.target.value }))} placeholder="operator_requested" disabled={!canManage} />
            <select aria-label={`${session.id} risk status`} value={draftRisks[session.id] ?? session.riskStatus} onChange={(event) => setDraftRisks((current) => ({ ...current, [session.id]: event.target.value as AdminAuthSession['riskStatus'] }))} disabled={!canManage}><option value="normal">normal</option><option value="suspicious">suspicious</option><option value="compromised">compromised</option></select>
            <div className="auth-session-row-actions">
              <button className="icon-button" type="button" title={textFor(t, 'Save risk disposition', '保存风险处置')} aria-label={textFor(t, 'Save risk disposition', '保存风险处置')} onClick={() => void disposition(session)} disabled={!canManage || busyId === session.id}>{session.riskStatus === 'normal' ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}</button>
              <button className="icon-button" type="button" title={textFor(t, 'Revoke session', '撤销会话')} aria-label={textFor(t, 'Revoke session', '撤销会话')} onClick={() => void revoke(session)} disabled={!canManage || session.status !== 'active' || busyId === session.id}><Ban size={16} /></button>
              <button className="ghost-button small" type="button" onClick={() => void revokeUser(session)} disabled={!canManage || busyId === `user:${session.user.id}`}>{textFor(t, 'Revoke user', '用户下线')}</button>
            </div>
          </article>
        ))}
        {!loading && sessions.length === 0 && <div className="empty-state"><strong>{textFor(t, 'No sessions found', '未找到会话')}</strong></div>}
      </div>
      {nextCursor && <button className="ghost-button" type="button" onClick={() => void load(true)} disabled={loading}>{textFor(t, 'Load more', '加载更多')}</button>}
    </section>
  )
}
