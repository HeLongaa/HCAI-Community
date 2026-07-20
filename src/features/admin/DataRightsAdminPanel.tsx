import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArchiveRestore, ChevronRight, Clock3, Database, RefreshCw, ShieldCheck } from 'lucide-react'

import { adminService } from '../../services/adminService'
import type { DataRightsBackupClass, DataRightsMetricsDto, DataRightsRequestDto, DataRightsRequestType, DataRightsStatus } from '../../services/contracts'

type Props = { isZh: boolean; canRead: boolean; canManage: boolean; notify: (message: string) => void }
const requestTypes: DataRightsRequestType[] = ['data_export', 'account_deletion']
const statuses: DataRightsStatus[] = ['identity_verified', 'processing', 'primary_completed', 'completed', 'cancelled', 'blocked']
const backupClasses: DataRightsBackupClass[] = ['primary_database', 'object_storage', 'audit_archive']
const formatDate = (value: string | null, isZh: boolean) => value ? new Date(value).toLocaleString(isZh ? 'zh-CN' : 'en-US') : '-'

export function DataRightsAdminPanel({ isZh, canRead, canManage, notify }: Props) {
  const [requests, setRequests] = useState<DataRightsRequestDto[]>([])
  const [metrics, setMetrics] = useState<DataRightsMetricsDto | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [requestType, setRequestType] = useState<DataRightsRequestType | ''>('')
  const [status, setStatus] = useState<DataRightsStatus | ''>('')
  const [reasonCode, setReasonCode] = useState('operator_verified')
  const [backupClass, setBackupClass] = useState<DataRightsBackupClass>('primary_database')
  const [objectRefHash, setObjectRefHash] = useState('')
  const [evidenceHash, setEvidenceHash] = useState('')
  const [expiredAt, setExpiredAt] = useState('')
  const [verifiedByRef, setVerifiedByRef] = useState('backup_operator')
  const [currentTime, setCurrentTime] = useState(0)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  const selected = useMemo(() => requests.find((item) => item.id === selectedId) ?? null, [requests, selectedId])
  const load = useCallback(async () => {
    if (!canRead) return
    setCurrentTime(Date.now())
    setLoading(true)
    try {
      const [items, nextMetrics] = await Promise.all([
        adminService.dataRightsRequests({ requestType: requestType || null, status: status || null, limit: 100 }),
        adminService.dataRightsMetrics(),
      ])
      setRequests(items)
      setMetrics(nextMetrics)
      setSelectedId((current) => items.some((item) => item.id === current) ? current : items[0]?.id ?? null)
    } catch (error) {
      console.info('[data-rights-admin]', error)
      notify(isZh ? '数据权利请求加载失败。' : 'Could not load data rights requests.')
    } finally { setLoading(false) }
  }, [canRead, isZh, notify, requestType, status])

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timeout)
  }, [load])

  const processRequest = async () => {
    if (!selected || !canManage) return
    setBusy(true)
    try {
      const updated = await adminService.processDataRightsRequest(selected.id, { expectedVersion: selected.version, reasonCode })
      setRequests((current) => current.map((item) => item.id === updated.id ? updated : item))
      setMetrics(await adminService.dataRightsMetrics())
      notify(isZh ? '数据权利请求已处理。' : 'Data rights request processed.')
    } catch (error) {
      console.info('[data-rights-admin]', error)
      notify(isZh ? '请求处理失败，请检查宽限期和版本。' : 'Processing failed; check the grace period and version.')
    } finally { setBusy(false) }
  }

  const recordBackup = async () => {
    if (!selected || !canManage || !expiredAt) return
    setBusy(true)
    try {
      const updated = await adminService.recordDataRightsBackupReceipt(selected.id, {
        backupClass,
        objectRefHash,
        evidenceHash,
        expiredAt: new Date(expiredAt).toISOString(),
        verifiedByRef,
      })
      setRequests((current) => current.map((item) => item.id === updated.id ? updated : item))
      setMetrics(await adminService.dataRightsMetrics())
      setObjectRefHash(''); setEvidenceHash(''); setExpiredAt('')
      notify(isZh ? '备份到期凭证已记录。' : 'Backup expiry evidence recorded.')
    } catch (error) {
      console.info('[data-rights-admin]', error)
      notify(isZh ? '备份凭证记录失败，请检查到期时间与哈希。' : 'Could not record backup evidence; check expiry and hashes.')
    } finally { setBusy(false) }
  }

  if (!canRead) return <section className="panel"><p>{isZh ? '缺少数据权利读取权限。' : 'Data rights read permission is required.'}</p></section>
  const graceActive = selected?.requestType === 'account_deletion' && new Date(selected.dueAt).getTime() > currentTime
  const processable = selected && ['identity_verified', 'blocked'].includes(selected.status) && !graceActive
  const hashesValid = /^[a-f0-9]{64}$/.test(objectRefHash) && /^[a-f0-9]{64}$/.test(evidenceHash)

  return <section className="panel data-rights-admin" data-testid="data-rights-admin-panel">
    <div className="panel-heading"><div><span className="eyebrow">{isZh ? '隐私运营' : 'Privacy operations'}</span><h2>{isZh ? '数据权利请求' : 'Data rights requests'}</h2></div><button className="icon-button" type="button" title={isZh ? '刷新' : 'Refresh'} aria-label={isZh ? '刷新数据权利请求' : 'Refresh data rights requests'} disabled={loading} onClick={() => void load()}><RefreshCw size={17}/></button></div>
    {metrics && <div className="data-rights-metrics">
      <div><Database size={16}/><strong>{metrics.total}</strong><span>{isZh ? '总请求' : 'Total'}</span></div>
      <div><Clock3 size={16}/><strong>{metrics.active}</strong><span>{isZh ? '处理中' : 'Active'}</span></div>
      <div><ShieldCheck size={16}/><strong>{metrics.completed}</strong><span>{isZh ? '已完成' : 'Completed'}</span></div>
      <div><ArchiveRestore size={16}/><strong>{metrics.overdue}</strong><span>{isZh ? '已逾期' : 'Overdue'}</span></div>
    </div>}
    <div className="data-rights-filters">
      <label><span>{isZh ? '类型' : 'Type'}</span><select aria-label={isZh ? '数据权利类型' : 'Data rights type'} value={requestType} onChange={(event) => setRequestType(event.target.value as DataRightsRequestType | '')}><option value="">{isZh ? '全部类型' : 'All types'}</option>{requestTypes.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>
      <label><span>{isZh ? '状态' : 'Status'}</span><select aria-label={isZh ? '数据权利状态' : 'Data rights status'} value={status} onChange={(event) => setStatus(event.target.value as DataRightsStatus | '')}><option value="">{isZh ? '全部状态' : 'All statuses'}</option>{statuses.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>
    </div>
    <div className="data-rights-workspace">
      <div className="data-rights-list">{requests.map((request) => <button className={selectedId === request.id ? 'active' : ''} type="button" key={request.id} onClick={() => setSelectedId(request.id)}>
        <span><strong>{request.requestType.replaceAll('_', ' ')}</strong><small>{request.subjectRef}</small></span><span><span className={`status-badge ${request.status === 'completed' ? 'success' : request.status === 'blocked' ? 'danger' : ''}`}>{request.status.replaceAll('_', ' ')}</span><small>{formatDate(request.dueAt, isZh)}</small></span><ChevronRight size={16}/>
      </button>)}</div>
      {selected && <div className="data-rights-detail">
        <header><div><strong>{selected.requestType.replaceAll('_', ' ')}</strong><small>{selected.id}</small></div><span className="status-badge">{selected.status.replaceAll('_', ' ')}</span></header>
        <dl><div><dt>{isZh ? '主体引用' : 'Subject ref'}</dt><dd>{selected.subjectRef}</dd></div><div><dt>{isZh ? '身份验证' : 'Identity verified'}</dt><dd>{formatDate(selected.identityVerifiedAt, isZh)}</dd></div><div><dt>{isZh ? '处理到期' : 'Due'}</dt><dd>{formatDate(selected.dueAt, isZh)}</dd></div><div><dt>{isZh ? '版本' : 'Version'}</dt><dd>v{selected.version}</dd></div></dl>
        {['identity_verified', 'blocked'].includes(selected.status) && <div className="data-rights-process"><label><span>{isZh ? '原因代码' : 'Reason code'}</span><input aria-label={isZh ? '处理原因代码' : 'Processing reason code'} value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}/></label><button className="primary-button" type="button" disabled={!canManage || busy || !processable || reasonCode.length < 3} onClick={() => void processRequest()}><ShieldCheck size={16}/>{graceActive ? (isZh ? '宽限期内' : 'Grace period active') : (isZh ? '执行处理' : 'Process')}</button></div>}
        {selected.status === 'primary_completed' && <div className="data-rights-backup">
          <h3>{isZh ? '备份到期凭证' : 'Backup expiry evidence'}</h3>
          <div><label><span>{isZh ? '备份类别' : 'Backup class'}</span><select aria-label={isZh ? '备份类别' : 'Backup class'} value={backupClass} onChange={(event) => setBackupClass(event.target.value as DataRightsBackupClass)}>{backupClasses.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label><label><span>{isZh ? '到期时间' : 'Expired at'}</span><input aria-label={isZh ? '备份到期时间' : 'Backup expired at'} type="datetime-local" value={expiredAt} onChange={(event) => setExpiredAt(event.target.value)}/></label><label><span>{isZh ? '对象哈希' : 'Object hash'}</span><input aria-label={isZh ? '备份对象哈希' : 'Backup object hash'} value={objectRefHash} onChange={(event) => setObjectRefHash(event.target.value.toLowerCase())}/></label><label><span>{isZh ? '证据哈希' : 'Evidence hash'}</span><input aria-label={isZh ? '备份证据哈希' : 'Backup evidence hash'} value={evidenceHash} onChange={(event) => setEvidenceHash(event.target.value.toLowerCase())}/></label><label><span>{isZh ? '验证人引用' : 'Verifier ref'}</span><input aria-label={isZh ? '备份验证人引用' : 'Backup verifier ref'} value={verifiedByRef} onChange={(event) => setVerifiedByRef(event.target.value)}/></label></div>
          <button className="primary-button" type="button" disabled={!canManage || busy || !hashesValid || !expiredAt || verifiedByRef.length < 3} onClick={() => void recordBackup()}><ArchiveRestore size={16}/>{isZh ? '记录凭证' : 'Record evidence'}</button>
        </div>}
        <div className="data-rights-evidence"><span>{isZh ? '事件' : 'Events'} {selected.events.length}</span><span>{isZh ? '删除凭证' : 'Deletion receipts'} {selected.deletionReceipts.length}/15</span><span>{isZh ? '备份凭证' : 'Backup receipts'} {selected.backupReceipts.length}/3</span>{selected.artifact && <span>{Math.ceil(selected.artifact.sizeBytes / 1024)} KB · {selected.artifact.checksumSha256.slice(0, 12)}</span>}</div>
      </div>}
    </div>
  </section>
}
