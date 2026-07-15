import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, KeyRound, RefreshCw, Rocket, RotateCcw, X } from 'lucide-react'

import type { Permission } from '../../domain/types'
import { adminService } from '../../services/adminService'
import type { ReleaseChangeDto, ReleaseChangeRequest, ReleaseChangeStatus, ReleaseChangeType, ReleaseEnvironment } from '../../services/contracts'

const environments: ReleaseEnvironment[] = ['development', 'staging', 'production']
const changeTypes: ReleaseChangeType[] = ['promotion', 'configuration', 'secret_rotation']
const statuses: ReleaseChangeStatus[] = ['pending_approval', 'approved', 'deployed', 'failed', 'rolled_back', 'rejected']
const label = (value: string) => value.replaceAll('_', ' ')

export function ReleaseControlPanel({ hasPermission, isZh, notify }: {
  hasPermission: (permission: Permission) => boolean
  isZh: boolean
  notify: (message: string) => void
}) {
  const [items, setItems] = useState<ReleaseChangeDto[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [status, setStatus] = useState<ReleaseChangeStatus | ''>('')
  const [targetEnvironment, setTargetEnvironment] = useState<ReleaseEnvironment | ''>('')
  const [changeType, setChangeType] = useState<ReleaseChangeType | ''>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reasonCode, setReasonCode] = useState('release_reviewed')
  const [deploymentId, setDeploymentId] = useState('')
  const [evidenceUrl, setEvidenceUrl] = useState('')
  const [form, setForm] = useState<ReleaseChangeRequest>({
    changeType: 'promotion', sourceEnvironment: 'staging', targetEnvironment: 'production', artifactVersion: '', rollbackVersion: '', summary: '', reasonCode: 'scheduled_release', secretRef: null, secretVersion: null,
  })
  const selected = useMemo(() => items.find((item) => item.id === selectedId) ?? items[0] ?? null, [items, selectedId])

  const refresh = useCallback(async () => {
    if (!hasPermission('admin:releases:read')) return
    setLoading(true)
    setError(null)
    try {
      const page = await adminService.releaseChanges({ status: status || null, targetEnvironment: targetEnvironment || null, changeType: changeType || null, limit: 50 })
      setItems(page.items)
      setSelectedId((current) => page.items.some((item) => item.id === current) ? current : page.items[0]?.id ?? null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [changeType, hasPermission, status, targetEnvironment])

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  const mutate = async (action: () => Promise<ReleaseChangeDto>, success: string) => {
    setLoading(true)
    setError(null)
    try {
      const changed = await action()
      setItems((current) => [changed, ...current.filter((item) => item.id !== changed.id)])
      setSelectedId(changed.id)
      notify(success)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  const submitRequest = () => void mutate(
    () => adminService.requestReleaseChange(form),
    isZh ? '发布变更已提交审批。' : 'Release change submitted for approval.',
  )

  if (!hasPermission('admin:releases:read')) return null

  return (
    <section className="panel release-control" data-testid="admin-release-control">
      <header className="release-control-header">
        <div><small>{isZh ? '平台工程' : 'Platform engineering'}</small><h2>{isZh ? '发布变更控制' : 'Release change control'}</h2></div>
        <button className="icon-button" type="button" title={isZh ? '刷新' : 'Refresh'} onClick={() => void refresh()} disabled={loading}><RefreshCw size={17} /></button>
      </header>
      <div className="release-filter-row">
        <select aria-label="Release status" value={status} onChange={(event) => setStatus(event.target.value as ReleaseChangeStatus | '')}><option value="">{isZh ? '全部状态' : 'All statuses'}</option>{statuses.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select>
        <select aria-label="Target environment" value={targetEnvironment} onChange={(event) => setTargetEnvironment(event.target.value as ReleaseEnvironment | '')}><option value="">{isZh ? '全部环境' : 'All environments'}</option>{environments.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        <select aria-label="Change type" value={changeType} onChange={(event) => setChangeType(event.target.value as ReleaseChangeType | '')}><option value="">{isZh ? '全部类型' : 'All types'}</option>{changeTypes.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select>
      </div>
      {hasPermission('admin:releases:manage') && (
        <form className="release-request-form" onSubmit={(event) => {
          event.preventDefault()
          submitRequest()
        }}>
          <select aria-label="New change type" value={form.changeType} onChange={(event) => {
            const nextType = event.target.value as ReleaseChangeType
            setForm({
              ...form,
              changeType: nextType,
              sourceEnvironment: nextType === 'promotion' ? 'staging' : null,
              secretRef: nextType === 'secret_rotation' ? form.secretRef : null,
              secretVersion: nextType === 'secret_rotation' ? form.secretVersion : null,
            })
          }}>{changeTypes.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select>
          {form.changeType === 'promotion' && <select aria-label="Source environment" value={form.sourceEnvironment ?? ''} onChange={(event) => setForm({ ...form, sourceEnvironment: event.target.value as ReleaseEnvironment })}>{environments.map((item) => <option key={item} value={item}>{item}</option>)}</select>}
          <select aria-label="New target environment" value={form.targetEnvironment} onChange={(event) => setForm({ ...form, targetEnvironment: event.target.value as ReleaseEnvironment })}>{environments.map((item) => <option key={item} value={item}>{item}</option>)}</select>
          <input required aria-label="Artifact version" placeholder={isZh ? '制品版本' : 'Artifact version'} value={form.artifactVersion} onChange={(event) => setForm({ ...form, artifactVersion: event.target.value })} />
          <input required aria-label="Rollback version" placeholder={isZh ? '回滚版本' : 'Rollback version'} value={form.rollbackVersion} onChange={(event) => setForm({ ...form, rollbackVersion: event.target.value })} />
          {form.changeType === 'secret_rotation' && <><input required aria-label="Secret reference" placeholder="secret://service/key" value={form.secretRef ?? ''} onChange={(event) => setForm({ ...form, secretRef: event.target.value })} /><input required aria-label="Secret version" placeholder={isZh ? '密钥版本' : 'Secret version'} value={form.secretVersion ?? ''} onChange={(event) => setForm({ ...form, secretVersion: event.target.value })} /></>}
          <input required aria-label="Release summary" placeholder={isZh ? '变更摘要' : 'Change summary'} value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} />
          <input required aria-label="Request reason code" placeholder={isZh ? '原因代码' : 'Reason code'} value={form.reasonCode} onChange={(event) => setForm({ ...form, reasonCode: event.target.value })} />
          <button className="primary-button" type="button" disabled={loading} onClick={submitRequest}><Rocket size={16} />{isZh ? '提交' : 'Request'}</button>
        </form>
      )}
      {error && <div className="inline-error" role="alert">{error}</div>}
      <div className="release-control-grid">
        <div className="admin-table release-list">
          {items.map((item) => <button type="button" className={`admin-row compact ${selected?.id === item.id ? 'selected' : ''}`} key={item.id} onClick={() => setSelectedId(item.id)}><span><strong>{item.summary}</strong><small>{label(item.changeType)} · {item.sourceEnvironment ? `${item.sourceEnvironment} → ` : ''}{item.targetEnvironment}</small></span><span className={`status ${item.status}`}>{label(item.status)}</span></button>)}
          {!loading && !items.length && <div className="empty-state">{isZh ? '暂无发布变更' : 'No release changes'}</div>}
        </div>
        {selected && <div className="admin-detail-panel release-detail">
          <div><strong>{selected.artifactVersion}</strong><small>{isZh ? '回滚' : 'Rollback'} {selected.rollbackVersion} · v{selected.version}</small></div>
          {selected.secretRef && <p><KeyRound size={15} /> {selected.secretRef} · {selected.secretVersion}</p>}
          <div className="release-action-fields"><input aria-label="Action reason code" value={reasonCode} onChange={(event) => setReasonCode(event.target.value)} /><input aria-label="Deployment id" placeholder={isZh ? '部署 ID' : 'Deployment ID'} value={deploymentId} onChange={(event) => setDeploymentId(event.target.value)} /><input aria-label="Evidence URL" placeholder={isZh ? '证据 URL' : 'Evidence URL'} value={evidenceUrl} onChange={(event) => setEvidenceUrl(event.target.value)} /></div>
          <div className="button-row">
            {selected.status === 'pending_approval' && hasPermission('admin:releases:approve') && <><button className="primary-button" type="button" onClick={() => void mutate(() => adminService.approveReleaseChange(selected.id, reasonCode), isZh ? '变更已批准。' : 'Release approved.')}><Check size={16} />{isZh ? '批准' : 'Approve'}</button><button className="ghost-button danger" type="button" onClick={() => void mutate(() => adminService.rejectReleaseChange(selected.id, reasonCode), isZh ? '变更已拒绝。' : 'Release rejected.')}><X size={16} />{isZh ? '拒绝' : 'Reject'}</button></>}
            {selected.status === 'approved' && hasPermission('admin:releases:deploy') && <button className="primary-button" type="button" disabled={!deploymentId || !evidenceUrl} onClick={() => void mutate(() => adminService.applyReleaseChange(selected.id, { outcome: 'deployed', deploymentId, evidenceUrl, reasonCode }), isZh ? '部署证据已记录。' : 'Deployment evidence recorded.')}><Rocket size={16} />{isZh ? '记录部署' : 'Record deployment'}</button>}
            {['deployed', 'failed'].includes(selected.status) && hasPermission('admin:releases:deploy') && <button className="ghost-button danger" type="button" disabled={!deploymentId || !evidenceUrl} onClick={() => void mutate(() => adminService.rollbackReleaseChange(selected.id, { deploymentId, evidenceUrl, reasonCode }), isZh ? '回滚证据已记录。' : 'Rollback evidence recorded.')}><RotateCcw size={16} />{isZh ? '记录回滚' : 'Record rollback'}</button>}
          </div>
          <div className="release-evidence-list">{selected.evidence.map((item) => <div key={item.id}><span>{label(item.eventType)}</span><small>{item.actorRef} · {item.reasonCode}</small><code>{item.evidenceHash.slice(0, 16)}</code></div>)}</div>
        </div>}
      </div>
    </section>
  )
}
