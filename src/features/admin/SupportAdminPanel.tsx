import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CircleCheck, Clock3, Link2, MessageSquareReply, RefreshCw, Search, UserRoundCheck } from 'lucide-react'
import { adminService } from '../../services/adminService'
import type { AdminSupportMetrics, ApiSupportRequest, SupportSlaState, SupportTicketPriority, SupportTicketStatus } from '../../services/contracts'

type Props = { isZh: boolean; canRead: boolean; canManage: boolean; notify: (message: string) => void }
const statuses: SupportTicketStatus[] = ['open', 'in_progress', 'waiting_on_user', 'resolved', 'closed']
const slaStates: SupportSlaState[] = ['on_track', 'due_soon', 'breached', 'met']

export function SupportAdminPanel({ isZh, canRead, canManage, notify }: Props) {
  const [tickets, setTickets] = useState<ApiSupportRequest[]>([])
  const [metrics, setMetrics] = useState<AdminSupportMetrics | null>(null)
  const [selected, setSelected] = useState<ApiSupportRequest | null>(null)
  const [status, setStatus] = useState<SupportTicketStatus | ''>('')
  const [slaState, setSlaState] = useState<SupportSlaState | ''>('')
  const [priority, setPriority] = useState<SupportTicketPriority | ''>('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [assigneeUserId, setAssigneeUserId] = useState('')
  const [caseType, setCaseType] = useState<'admin_review' | 'moderation_case'>('moderation_case')
  const [caseId, setCaseId] = useState('')

  const load = useCallback(async () => {
    if (!canRead) return
    setLoading(true)
    try {
      const [page, nextMetrics] = await Promise.all([
        adminService.supportTickets({ limit: 50, status: status || null, priority: priority || null, slaState: slaState || null, search: search || null, sort: 'createdAt', order: 'desc' }),
        adminService.supportMetrics(),
      ])
      setTickets(page.items)
      setMetrics(nextMetrics)
    } catch (error) {
      console.info('[support-admin]', error)
      notify(isZh ? '支持工单加载失败。' : 'Could not load support tickets.')
    } finally { setLoading(false) }
  }, [canRead, isZh, notify, priority, search, slaState, status])

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timeout)
  }, [load])

  const refresh = async () => {
    await load()
    if (!selected) return
    try {
      const ticket = await adminService.supportTicket(selected.id)
      setSelected(ticket)
      setAssigneeUserId(ticket.assignedTo?.id ?? '')
    } catch { notify(isZh ? '无法读取工单详情。' : 'Could not load ticket detail.') }
  }

  const openTicket = async (id: string) => {
    try {
      const ticket = await adminService.supportTicket(id)
      setSelected(ticket)
      setAssigneeUserId(ticket.assignedTo?.id ?? '')
    } catch { notify(isZh ? '无法读取工单详情。' : 'Could not load ticket detail.') }
  }

  const mutate = async (payload: { status?: SupportTicketStatus; priority?: SupportTicketPriority; assigneeUserId?: string | null }) => {
    if (!selected) return
    try {
      const updated = await adminService.updateSupportTicket(selected.id, { ...payload, expectedVersion: selected.version, reasonCode: 'operator_requested' })
      setSelected(updated); await load()
    } catch { notify(isZh ? '工单更新失败，可能已被其他管理员修改。' : 'Ticket update failed; it may have changed concurrently.') }
  }

  const sendMessage = async () => {
    if (!selected || !message.trim()) return
    try {
      const updated = await adminService.addSupportMessage(selected.id, { message: message.trim(), expectedVersion: selected.version, reasonCode: 'operator_response' })
      setSelected(updated); setMessage(''); await load()
    } catch { notify(isZh ? '回复发送失败。' : 'Could not send support reply.') }
  }

  const linkCase = async () => {
    if (!selected || !caseId.trim()) return
    try {
      const updated = await adminService.linkSupportCase(selected.id, { caseType, caseId: caseId.trim(), expectedVersion: selected.version, reasonCode: 'operator_case_link' })
      setSelected(updated); setCaseId(''); await load()
    } catch { notify(isZh ? '案件关联失败，请检查案件 ID。' : 'Could not link the case; check its ID.') }
  }

  if (!canRead) return <section className="panel"><p>{isZh ? '缺少支持工单读取权限。' : 'Support ticket read permission is required.'}</p></section>
  return <div className="admin-settings-stack support-admin-workspace" data-testid="support-admin-panel">
    <section className="panel">
      <div className="panel-heading"><div><span className="eyebrow">{isZh ? '支持运营' : 'Support operations'}</span><h2>{isZh ? '工单与 SLA' : 'Tickets and SLA'}</h2></div><button className="icon-button" type="button" title={isZh ? '刷新' : 'Refresh'} onClick={() => void refresh()} disabled={loading}><RefreshCw size={17} /></button></div>
      {metrics && <div className="metric-grid support-metrics">
        <div><MessageSquareReply size={17} /><strong>{metrics.open}</strong><span>{isZh ? '处理中' : 'Open'}</span></div>
        <div><UserRoundCheck size={17} /><strong>{metrics.unassigned}</strong><span>{isZh ? '未分派' : 'Unassigned'}</span></div>
        <div><Clock3 size={17} /><strong>{metrics.dueSoon}</strong><span>{isZh ? '即将超时' : 'Due soon'}</span></div>
        <div><AlertTriangle size={17} /><strong>{metrics.breached}</strong><span>{isZh ? '已违约' : 'Breached'}</span></div>
        <div><CircleCheck size={17} /><strong>{metrics.resolved}</strong><span>{isZh ? '已解决' : 'Resolved'}</span></div>
      </div>}
      <div className="admin-filter-row support-filter-row">
        <label><Search size={15} /><input aria-label={isZh ? '搜索工单' : 'Search tickets'} placeholder={isZh ? 'ID、主题或用户' : 'ID, subject, or user'} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <select aria-label={isZh ? '状态' : 'Status'} value={status} onChange={(event) => setStatus(event.target.value as SupportTicketStatus | '')}><option value="">{isZh ? '全部状态' : 'All statuses'}</option>{statuses.map((value) => <option value={value} key={value}>{value.replaceAll('_', ' ')}</option>)}</select>
        <select aria-label={isZh ? '优先级' : 'Priority'} value={priority} onChange={(event) => setPriority(event.target.value as SupportTicketPriority | '')}><option value="">{isZh ? '全部优先级' : 'All priorities'}</option><option value="normal">normal</option><option value="urgent">urgent</option></select>
        <select aria-label="SLA" value={slaState} onChange={(event) => setSlaState(event.target.value as SupportSlaState | '')}><option value="">SLA</option>{slaStates.map((value) => <option value={value} key={value}>{value.replaceAll('_', ' ')}</option>)}</select>
      </div>
      <div className="admin-list support-ticket-list">{tickets.map((ticket) => <button className={selected?.id === ticket.id ? 'admin-list-row active' : 'admin-list-row'} type="button" key={ticket.id} onClick={() => void openTicket(ticket.id)}>
        <span><strong>{ticket.subject}</strong><small>{ticket.requester?.handle ? `@${ticket.requester.handle}` : ticket.id}</small></span>
        <span className={`status-badge ${ticket.slaState === 'breached' ? 'danger' : ''}`}>{ticket.slaState.replaceAll('_', ' ')}</span>
        <span>{ticket.status.replaceAll('_', ' ')}</span><time>{new Date(ticket.firstResponseDueAt).toLocaleString(isZh ? 'zh-CN' : 'en-US')}</time>
      </button>)}</div>
    </section>

    {selected && <section className="panel support-ticket-detail">
      <div className="panel-heading"><div><span className="eyebrow">{selected.id}</span><h2>{selected.subject}</h2></div><span className="status-badge">{selected.status.replaceAll('_', ' ')}</span></div>
      <p>{selected.details}</p>
      <div className="support-detail-controls">
        <label><span>{isZh ? '状态' : 'Status'}</span><select value={selected.status} disabled={!canManage || selected.status === 'closed'} onChange={(event) => void mutate({ status: event.target.value as SupportTicketStatus })}>{statuses.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>
        <label><span>{isZh ? '优先级' : 'Priority'}</span><select value={selected.priority} disabled={!canManage} onChange={(event) => void mutate({ priority: event.target.value as SupportTicketPriority })}><option value="normal">normal</option><option value="urgent">urgent</option></select></label>
        <label><span>{isZh ? '分派用户 ID' : 'Assignee user ID'}</span><div className="inline-actions"><input value={assigneeUserId} onChange={(event) => setAssigneeUserId(event.target.value)} disabled={!canManage} /><button className="icon-button" title={isZh ? '分派' : 'Assign'} type="button" disabled={!canManage} onClick={() => void mutate({ assigneeUserId: assigneeUserId.trim() || null })}><UserRoundCheck size={16} /></button></div></label>
      </div>
      <div className="support-message-thread">{selected.messages?.map((item) => <article key={item.id}><header><strong>{item.authorType}</strong><time>{new Date(item.createdAt).toLocaleString(isZh ? 'zh-CN' : 'en-US')}</time></header><p>{item.body}</p></article>)}</div>
      <div className="support-compose"><textarea rows={3} maxLength={4000} placeholder={isZh ? '回复用户' : 'Reply to requester'} value={message} onChange={(event) => setMessage(event.target.value)} disabled={!canManage || selected.status === 'closed'} /><button className="primary-button" type="button" disabled={!canManage || !message.trim() || selected.status === 'closed'} onClick={() => void sendMessage()}><MessageSquareReply size={16} />{isZh ? '发送' : 'Send'}</button></div>
      <div className="support-case-link"><Link2 size={17} /><select value={caseType} onChange={(event) => setCaseType(event.target.value as typeof caseType)} disabled={!canManage}><option value="moderation_case">moderation case</option><option value="admin_review">admin review</option></select><input placeholder={isZh ? '案件 ID' : 'Case ID'} value={caseId} onChange={(event) => setCaseId(event.target.value)} disabled={!canManage} /><button className="ghost-button" type="button" disabled={!canManage || !caseId.trim()} onClick={() => void linkCase()}>{isZh ? '关联' : 'Link'}</button></div>
    </section>}
  </div>
}
