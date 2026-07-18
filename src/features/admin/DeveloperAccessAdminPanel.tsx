import { useCallback, useEffect, useState } from 'react'
import { Ban, Download, Power, RefreshCw, Save, Search } from 'lucide-react'
import { SectionHeader } from '../../components/ui/SectionHeader'
import { textFor } from '../../domain/utils'
import { adminService } from '../../services/adminService'
import type { DeveloperAccessControl, DeveloperAccessMetrics, DeveloperApiKeyCredential, DeveloperServiceAccount } from '../../services/contracts'

type Props = { t: Record<string, string>; canRead: boolean; canManage: boolean; notify: (message: string) => void }

export function DeveloperAccessAdminPanel({ t, canRead, canManage, notify }: Props) {
  const [control, setControl] = useState<DeveloperAccessControl | null>(null)
  const [accounts, setAccounts] = useState<DeveloperServiceAccount[]>([])
  const [metrics, setMetrics] = useState<DeveloperAccessMetrics | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [ownerHandle, setOwnerHandle] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!canRead) return
    setError(null)
    try {
      const [nextControl, page, nextMetrics] = await Promise.all([
        adminService.developerAccessControl(),
        adminService.developerServiceAccounts({ search: search || null, status: status || null, ownerHandle: ownerHandle || null, limit: 50, sort: 'createdAt', order: 'desc' }),
        adminService.developerAccessMetrics(),
      ])
      setControl(nextControl)
      setAccounts(page.items)
      setMetrics(nextMetrics)
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
      notify(textFor(t, 'Developer access control updated.', '开发者访问控制已更新。'))
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : textFor(t, 'Could not update control.', '无法更新控制配置。'))
      await load()
    } finally { setBusy(null) }
  }

  const revokeAccount = async (account: DeveloperServiceAccount) => {
    if (!canManage || !window.confirm(textFor(t, `Revoke ${account.name}?`, `撤销 ${account.name}？`))) return
    setBusy(account.id)
    try {
      const updated = await adminService.revokeDeveloperServiceAccount(account.id, { expectedVersion: account.version, reasonCode: 'admin_incident_response' })
      setAccounts((current) => current.map((item) => item.id === updated.id ? updated : item))
      await load()
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : 'Revoke failed') } finally { setBusy(null) }
  }

  const revokeKey = async (account: DeveloperServiceAccount, key: DeveloperApiKeyCredential) => {
    if (!canManage || !window.confirm(textFor(t, `Revoke ${key.name}?`, `撤销 ${key.name}？`))) return
    setBusy(key.id)
    try {
      await adminService.revokeDeveloperApiKey(account.id, key.id, { expectedVersion: key.version, reasonCode: 'admin_incident_response' })
      await load()
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : 'Revoke failed') } finally { setBusy(null) }
  }

  const exportSnapshot = async () => {
    const snapshot = await adminService.exportDeveloperServiceAccounts({ search: search || null, status: status || null, ownerHandle: ownerHandle || null })
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `developer-access-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  if (!canRead) return null
  return (
    <section className="panel developer-admin-panel" data-testid="developer-access-admin">
      <SectionHeader eyebrow={textFor(t, 'Developer platform', '开发者平台')} title={textFor(t, 'Service account operations', 'Service Account 运营')} action={<button className="icon-button" type="button" onClick={() => void load()} title={textFor(t, 'Refresh', '刷新')}><RefreshCw size={17} /></button>} />
      {error && <div className="inline-alert error">{error}</div>}
      {control && <div className="developer-control-grid">
        <div><strong>{control.enabled ? textFor(t, 'Enabled', '已启用') : textFor(t, 'Default off', '默认关闭')}</strong><span>v{control.version}</span><button className={control.enabled ? 'ghost-button danger-button' : 'primary-button'} type="button" onClick={() => void saveControl(!control.enabled)} disabled={!canManage || busy === 'control'}><Power size={16} />{control.enabled ? textFor(t, 'Disable', '停用') : textFor(t, 'Enable', '启用')}</button></div>
        <label><span>{textFor(t, 'Accounts per user', '每用户账号数')}</span><input type="number" min="1" max="20" value={control.maxServiceAccountsPerUser} onChange={(event) => setControl({ ...control, maxServiceAccountsPerUser: Number(event.target.value) })} disabled={!canManage} /></label>
        <label><span>{textFor(t, 'Active keys per account', '每账号活跃密钥')}</span><input type="number" min="1" max="10" value={control.maxActiveKeysPerAccount} onChange={(event) => setControl({ ...control, maxActiveKeysPerAccount: Number(event.target.value) })} disabled={!canManage} /></label>
        <label><span>{textFor(t, 'Default TTL days', '默认有效天数')}</span><input type="number" min="1" max="365" value={control.defaultKeyTtlDays} onChange={(event) => setControl({ ...control, defaultKeyTtlDays: Number(event.target.value) })} disabled={!canManage} /></label>
        <button className="ghost-button" type="button" onClick={() => void saveControl()} disabled={!canManage || busy === 'control'}><Save size={16} />{textFor(t, 'Save limits', '保存限额')}</button>
      </div>}
      {metrics && <div className="developer-metric-strip"><div><strong>{metrics.serviceAccounts.total}</strong><span>{textFor(t, 'service accounts', 'Service Account')}</span></div><div><strong>{metrics.apiKeys.total}</strong><span>{textFor(t, 'API keys', 'API Key')}</span></div><div><strong>{metrics.usageCount}</strong><span>{textFor(t, 'authenticated calls', '认证调用')}</span></div><div><strong>{metrics.apiKeys.expired}</strong><span>{textFor(t, 'expired', '已过期')}</span></div></div>}
      <div className="developer-admin-filters"><label><span>{textFor(t, 'Owner', 'Owner')}</span><input value={ownerHandle} onChange={(event) => setOwnerHandle(event.target.value)} /></label><label><span>{textFor(t, 'Status', '状态')}</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">{textFor(t, 'All', '全部')}</option><option value="active">active</option><option value="revoked">revoked</option></select></label><label className="grow"><span>{textFor(t, 'Search', '搜索')}</span><input value={search} onChange={(event) => setSearch(event.target.value)} /></label><button className="ghost-button" type="button" onClick={() => void load()}><Search size={16} />{textFor(t, 'Apply', '查询')}</button><button className="ghost-button" type="button" onClick={() => void exportSnapshot()}><Download size={16} />JSON</button></div>
      <div className="developer-admin-list">{accounts.map((account) => <div className="developer-admin-account" key={account.id}><div><strong>{account.name}</strong><span>@{account.owner?.handle ?? account.owner?.displayName} · {account.status} · v{account.version}</span></div><span>{account.keys.length} {textFor(t, 'keys', '个密钥')}</span><button className="icon-button" type="button" title={textFor(t, 'Revoke account', '撤销账号')} onClick={() => void revokeAccount(account)} disabled={!canManage || account.status !== 'active' || busy === account.id}><Ban size={16} /></button>{account.keys.map((key) => <div className="developer-admin-key" key={key.id}><code>{key.displayPrefix}</code><span>{key.status}</span><span>{key.usageCount} uses</span><span>{key.scopes.join(', ')}</span><button className="icon-button" type="button" title={textFor(t, 'Revoke key', '撤销密钥')} onClick={() => void revokeKey(account, key)} disabled={!canManage || key.status !== 'active' || busy === key.id}><Ban size={14} /></button></div>)}</div>)}</div>
    </section>
  )
}
