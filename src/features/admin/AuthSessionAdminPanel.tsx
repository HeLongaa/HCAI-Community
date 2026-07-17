import { useCallback, useEffect, useState } from 'react'
import { Ban, RefreshCw, Search, ShieldAlert, ShieldCheck } from 'lucide-react'

import { SectionHeader } from '../../components/ui/SectionHeader'
import { textFor } from '../../domain/utils'
import { adminService } from '../../services/adminService'
import type { AdminAuthSession } from '../../services/contracts'

type Props = {
  t: Record<string, string>
  canRead: boolean
  canManage: boolean
  notify: (message: string) => void
}

const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback

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
