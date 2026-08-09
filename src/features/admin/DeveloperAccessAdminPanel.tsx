import { useCallback, useEffect, useState } from 'react'
import { Ban, Download, Power, RefreshCw, Save, Search } from 'lucide-react'
import { SectionHeader } from '../../components/ui/SectionHeader'
import { textFor } from '../../domain/utils'
import { adminService } from '../../services/adminService'
import type { DeveloperAccessControl, DeveloperAccessMetrics, DeveloperApiKeyCredential, DeveloperApiV1Contract, DeveloperServiceAccount } from '../../services/contracts'
import { AdminActionFeedback, type AdminActionFeedbackMessage } from './AdminActionFeedback'
import { AdminOperationConfirmation } from './AdminOperationConfirmation'
import { downloadJsonArtifact } from './downloadAdminArtifact'

type Props = { t: Record<string, string>; canRead: boolean; canManage: boolean }
type PendingDeveloperRevoke =
  | { kind: 'account'; account: DeveloperServiceAccount }
  | { kind: 'key'; account: DeveloperServiceAccount; key: DeveloperApiKeyCredential }

export function DeveloperAccessAdminPanel({ t, canRead, canManage }: Props) {
  const [control, setControl] = useState<DeveloperAccessControl | null>(null)
  const [accounts, setAccounts] = useState<DeveloperServiceAccount[]>([])
  const [metrics, setMetrics] = useState<DeveloperAccessMetrics | null>(null)
  const [apiContract, setApiContract] = useState<DeveloperApiV1Contract | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [ownerHandle, setOwnerHandle] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<AdminActionFeedbackMessage | null>(null)
  const [pendingRevoke, setPendingRevoke] = useState<PendingDeveloperRevoke | null>(null)

  const load = useCallback(async () => {
    if (!canRead) return
    setError(null)
    try {
      const [nextControl, page, nextMetrics, nextApiContract] = await Promise.all([
        adminService.developerAccessControl(),
        adminService.developerServiceAccounts({ search: search || null, status: status || null, ownerHandle: ownerHandle || null, limit: 50, sort: 'createdAt', order: 'desc' }),
        adminService.developerAccessMetrics(),
        adminService.developerApiV1Contract(),
      ])
      setControl(nextControl)
      setAccounts(page.items)
      setMetrics(nextMetrics)
      setApiContract(nextApiContract)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : textFor(t, 'Could not load developer access.', '无法读取开发者访问数据。'))
    }
  }, [canRead, ownerHandle, search, status, t])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const saveControl = async (enabled = control?.enabled) => {
    if (!control || !canManage) return
    setBusy('control')
    setError(null)
    setFeedback(null)
    try {
      const updated = await adminService.updateDeveloperAccessControl({
        enabled: Boolean(enabled), allowedScopes: control.allowedScopes,
        maxServiceAccountsPerUser: control.maxServiceAccountsPerUser,
        maxActiveKeysPerAccount: control.maxActiveKeysPerAccount,
        defaultKeyTtlDays: control.defaultKeyTtlDays,
        expectedVersion: control.version,
        reasonCode: enabled ? 'admin_enabled' : 'admin_disabled',
      })
      setControl(updated)
      setFeedback({ kind: 'success', text: textFor(t, 'Developer access control updated.', '开发者访问控制已更新。') })
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : textFor(t, 'Could not update control.', '无法更新控制配置。')
      await load()
      setFeedback({ kind: 'error', text: message })
    } finally { setBusy(null) }
  }

  const confirmRevoke = async () => {
    if (!canManage || !pendingRevoke) return
    const targetId = pendingRevoke.kind === 'account' ? pendingRevoke.account.id : pendingRevoke.key.id
    setBusy(targetId)
    setError(null)
    setFeedback(null)
    try {
      if (pendingRevoke.kind === 'account') {
        const { account } = pendingRevoke
        const updated = await adminService.revokeDeveloperServiceAccount(account.id, { expectedVersion: account.version, reasonCode: 'admin_incident_response' })
        setAccounts((current) => current.map((item) => item.id === updated.id ? updated : item))
      } else {
        const { account, key } = pendingRevoke
        await adminService.revokeDeveloperApiKey(account.id, key.id, { expectedVersion: key.version, reasonCode: 'admin_incident_response' })
      }
      await load()
      setFeedback({ kind: 'success', text: pendingRevoke.kind === 'account'
        ? textFor(t, 'Service account revoked.', 'Service Account 已撤销。')
        : textFor(t, 'API key revoked.', 'API Key 已撤销。') })
      setPendingRevoke(null)
    } catch (nextError) {
      setFeedback({ kind: 'error', text: nextError instanceof Error ? nextError.message : textFor(t, 'Revoke failed.', '撤销失败。') })
    } finally {
      setBusy(null)
    }
  }

  const exportSnapshot = async () => {
    setFeedback(null)
    try {
      const snapshot = await adminService.exportDeveloperServiceAccounts({ search: search || null, status: status || null, ownerHandle: ownerHandle || null })
      downloadJsonArtifact({
        value: snapshot,
        fileName: `developer-access-${new Date().toISOString().slice(0, 10)}.json`,
        mimeType: 'application/json',
      })
      setFeedback({ kind: 'success', text: textFor(t, 'Developer access snapshot downloaded.', '开发者访问快照已下载。') })
    } catch (nextError) {
      setFeedback({ kind: 'error', text: nextError instanceof Error ? nextError.message : textFor(t, 'Could not export developer access.', '无法导出开发者访问数据。') })
    }
  }

  if (!canRead) return null
  return (
    <section className="panel developer-admin-panel" data-testid="developer-access-admin">
      <SectionHeader eyebrow={textFor(t, 'Developer platform', '开发者平台')} title={textFor(t, 'Service account operations', 'Service Account 运营')} action={<button className="icon-button" type="button" onClick={() => void load()} title={textFor(t, 'Refresh', '刷新')}><RefreshCw size={17} /></button>} />
      {error && <div className="inline-alert error">{error}</div>}
      <AdminActionFeedback message={feedback} />
      {control && <div className="developer-control-grid">
        <div><strong>{control.enabled ? textFor(t, 'Enabled', '已启用') : textFor(t, 'Default off', '默认关闭')}</strong><span>v{control.version}</span><button className={control.enabled ? 'ghost-button danger-button' : 'primary-button'} type="button" onClick={() => void saveControl(!control.enabled)} disabled={!canManage || busy === 'control'}><Power size={16} />{control.enabled ? textFor(t, 'Disable', '停用') : textFor(t, 'Enable', '启用')}</button></div>
        <label><span>{textFor(t, 'Accounts per user', '每用户账号数')}</span><input type="number" min="1" max="20" value={control.maxServiceAccountsPerUser} onChange={(event) => setControl({ ...control, maxServiceAccountsPerUser: Number(event.target.value) })} disabled={!canManage} /></label>
        <label><span>{textFor(t, 'Active keys per account', '每账号活跃密钥')}</span><input type="number" min="1" max="10" value={control.maxActiveKeysPerAccount} onChange={(event) => setControl({ ...control, maxActiveKeysPerAccount: Number(event.target.value) })} disabled={!canManage} /></label>
        <label><span>{textFor(t, 'Default TTL days', '默认有效天数')}</span><input type="number" min="1" max="365" value={control.defaultKeyTtlDays} onChange={(event) => setControl({ ...control, defaultKeyTtlDays: Number(event.target.value) })} disabled={!canManage} /></label>
        <button className="ghost-button" type="button" onClick={() => void saveControl()} disabled={!canManage || busy === 'control'}><Save size={16} />{textFor(t, 'Save limits', '保存限额')}</button>
      </div>}
      {metrics && <div className="developer-metric-strip"><div><strong>{metrics.serviceAccounts.total}</strong><span>{textFor(t, 'service accounts', 'Service Account')}</span></div><div><strong>{metrics.apiKeys.total}</strong><span>{textFor(t, 'API keys', 'API Key')}</span></div><div><strong>{metrics.usageCount}</strong><span>{textFor(t, 'authenticated calls', '认证调用')}</span></div><div><strong>{metrics.apiKeys.expired}</strong><span>{textFor(t, 'expired', '已过期')}</span></div></div>}
      {apiContract && <div className="developer-api-contract" data-testid="developer-api-v1-contract">
        <div><strong>API {apiContract.apiVersion}</strong><span>{apiContract.routes.length} {textFor(t, 'stable routes', '条稳定路由')}</span></div>
        <div><strong>{apiContract.idempotency.retentionHours}h</strong><span>{textFor(t, 'idempotency retention', '幂等保留窗口')}</span></div>
        <div><strong>{apiContract.errors.length}</strong><span>{textFor(t, 'registered errors', '个已登记错误')}</span></div>
        <div><strong>{apiContract.deprecations[0] ? new Date(apiContract.deprecations[0].sunsetAt).toLocaleDateString() : textFor(t, 'None', '无')}</strong><span>{textFor(t, 'next legacy sunset', '下一个旧版 Sunset')}</span></div>
      </div>}
      <div className="developer-admin-filters"><label><span>{textFor(t, 'Owner', 'Owner')}</span><input value={ownerHandle} onChange={(event) => setOwnerHandle(event.target.value)} /></label><label><span>{textFor(t, 'Status', '状态')}</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">{textFor(t, 'All', '全部')}</option><option value="active">active</option><option value="revoked">revoked</option></select></label><label className="grow"><span>{textFor(t, 'Search', '搜索')}</span><input value={search} onChange={(event) => setSearch(event.target.value)} /></label><button className="ghost-button" type="button" onClick={() => void load()}><Search size={16} />{textFor(t, 'Apply', '查询')}</button><button className="ghost-button" type="button" onClick={() => void exportSnapshot()}><Download size={16} />JSON</button></div>
      <div className="developer-admin-list">{accounts.map((account) => <div className="developer-admin-account" key={account.id}><div><strong>{account.name}</strong><span>@{account.owner?.handle ?? account.owner?.displayName} · {account.status} · v{account.version}</span></div><span>{account.keys.length} {textFor(t, 'keys', '个密钥')}</span><button className="icon-button" type="button" title={textFor(t, 'Revoke account', '撤销账号')} onClick={() => setPendingRevoke({ kind: 'account', account })} disabled={!canManage || account.status !== 'active' || busy === account.id}><Ban size={16} /></button>{account.keys.map((key) => <div className="developer-admin-key" key={key.id}><code>{key.displayPrefix}</code><span>{key.status}</span><span>{key.usageCount} uses</span><span>{key.scopes.join(', ')}</span><button className="icon-button" type="button" title={textFor(t, 'Revoke key', '撤销密钥')} onClick={() => setPendingRevoke({ kind: 'key', account, key })} disabled={!canManage || key.status !== 'active' || busy === key.id}><Ban size={14} /></button></div>)}{pendingRevoke?.account.id === account.id && <AdminOperationConfirmation ariaLabel={textFor(t, 'Confirm developer credential revoke', '确认撤销开发者凭证')} title={pendingRevoke.kind === 'account' ? textFor(t, `Revoke ${pendingRevoke.account.name}?`, `撤销 ${pendingRevoke.account.name}？`) : textFor(t, `Revoke ${pendingRevoke.key.name}?`, `撤销 ${pendingRevoke.key.name}？`)} description={pendingRevoke.kind === 'account' ? textFor(t, 'All active keys under this service account will stop authenticating future API requests.', '此 Service Account 下的所有活跃密钥都将无法继续认证后续 API 请求。') : textFor(t, 'This key will stop authenticating future API requests. Other active keys remain available.', '此密钥将无法继续认证后续 API 请求，其他活跃密钥不受影响。')} confirmLabel={pendingRevoke.kind === 'account' ? textFor(t, 'Revoke account', '撤销账号') : textFor(t, 'Revoke key', '撤销密钥')} cancelLabel={textFor(t, 'Back', '返回')} onConfirm={() => void confirmRevoke()} onCancel={() => setPendingRevoke(null)} busy={busy === (pendingRevoke.kind === 'account' ? pendingRevoke.account.id : pendingRevoke.key.id)} />}</div>)}</div>
    </section>
  )
}
