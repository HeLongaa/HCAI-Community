import { useEffect, useState } from 'react'
import { RefreshCw, Send, ShieldAlert, ShieldCheck } from 'lucide-react'

import { textFor } from '../../domain/utils'
import { riskService } from '../../services/riskService'
import type { RiskCase } from '../../services/contracts'

const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback

export function RiskCasePanel({ t }: { t: Record<string, string> }) {
  const [cases, setCases] = useState<RiskCase[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reasonCode, setReasonCode] = useState('account_owner_review')
  const [statement, setStatement] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const selected = cases.find((item) => item.id === selectedId) ?? cases[0] ?? null

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const page = await riskService.cases({ limit: 20 })
      setCases(page.items)
      if (page.items.length && !page.items.some((item) => item.id === selectedId)) setSelectedId(page.items[0].id)
    } catch (cause) {
      setError(errorMessage(cause, textFor(t, 'Could not load account risk cases.', '无法读取账号风控案件。')))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    riskService.cases({ limit: 20 }).then((page) => {
      if (!active) return
      setCases(page.items)
      if (page.items.length) setSelectedId(page.items[0].id)
    }).catch((cause) => {
      if (active) setError(errorMessage(cause, textFor(t, 'Could not load account risk cases.', '无法读取账号风控案件。')))
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [t])

  const appeal = async () => {
    if (!selected || statement.trim().length < 10) return
    setBusy(true)
    setError('')
    try {
      const result = await riskService.appeal(selected.id, { reasonCode: reasonCode.trim() || 'account_owner_review', statement: statement.trim() })
      setCases((current) => current.map((item) => item.id === result.case.id ? result.case : item))
      setStatement('')
    } catch (cause) {
      setError(errorMessage(cause, textFor(t, 'Could not submit the appeal.', '无法提交申诉。')))
    } finally {
      setBusy(false)
    }
  }

  return <section className="panel profile-settings-panel" data-testid="profile-risk-cases">
    <header><div><span>{textFor(t, 'Account safety', '账号安全')}</span><h2>{textFor(t, 'Risk restrictions and appeals', '风险限制与申诉')}</h2></div><button className="icon-button" type="button" title={textFor(t, 'Refresh risk cases', '刷新风控案件')} onClick={() => void load()} disabled={loading}><RefreshCw size={16}/></button></header>
    {error && <div className="inline-alert error">{error}</div>}
    {!loading && !cases.length && <div className="empty-state"><ShieldCheck size={20}/><strong>{textFor(t, 'No active or historical risk cases', '暂无风险案件')}</strong></div>}
    {cases.length > 0 && <div className="chip-row">{cases.map((item) => <button type="button" className={selected?.id === item.id ? 'chip active' : 'chip'} key={item.id} onClick={() => setSelectedId(item.id)}>{item.status} · {item.disposition}</button>)}</div>}
    {selected && <div className="admin-detail-panel"><div className="admin-section-heading"><div><strong><ShieldAlert size={16}/>{selected.riskLevel} · {selected.reasonCode}</strong><small>{selected.expiresAt ? `${textFor(t, 'Expires', '到期')} ${new Date(selected.expiresAt).toLocaleString()}` : textFor(t, 'No automatic expiry', '无自动到期时间')}</small></div><span className={`status-badge ${selected.status === 'recovered' || selected.status === 'closed' ? 'success' : 'warning'}`}>{selected.status}</span></div><div className="trust-fact-list">{selected.events.map((event) => <div key={event.id}><ShieldCheck size={15}/><span>{event.fromStatus ?? 'new'} → {event.toStatus}</span><small>{event.reasonCode}</small></div>)}</div>{selected.status === 'restricted' && !selected.appeals.some((item) => item.status === 'pending') && <div className="trust-action-grid"><label><span>{textFor(t, 'Reason code', '原因码')}</span><input value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}/></label><label className="wide"><span>{textFor(t, 'Appeal statement', '申诉说明')}</span><textarea value={statement} onChange={(event) => setStatement(event.target.value)} maxLength={2000}/></label><button className="primary-button" type="button" onClick={() => void appeal()} disabled={busy || statement.trim().length < 10}><Send size={16}/>{busy ? textFor(t, 'Submitting', '提交中') : textFor(t, 'Submit appeal', '提交申诉')}</button></div>}{selected.appeals.some((item) => item.status === 'pending') && <div className="inline-alert"><ShieldCheck size={16}/>{textFor(t, 'Your appeal is awaiting review.', '你的申诉正在等待审核。')}</div>}</div>}
  </section>
}
