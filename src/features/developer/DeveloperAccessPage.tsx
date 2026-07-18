import { useCallback, useEffect, useState } from 'react'
import { Ban, Copy, KeyRound, Plus, RefreshCw, RotateCw, ShieldCheck } from 'lucide-react'
import { SectionHeader } from '../../components/ui/SectionHeader'
import { textFor } from '../../domain/utils'
import { developerService } from '../../services/developerService'
import type { DeveloperAccessControl, DeveloperApiKeyCredential, DeveloperServiceAccount } from '../../services/contracts'

type Props = {
  t: Record<string, string>
  signedIn: boolean
  requireAuth: () => void
  notify: (message: string) => void
}

const formatDate = (value: string | null) => value ? new Date(value).toLocaleString() : '-'

export function DeveloperAccessPage({ t, signedIn, requireAuth, notify }: Props) {
  const [control, setControl] = useState<DeveloperAccessControl | null>(null)
  const [accounts, setAccounts] = useState<DeveloperServiceAccount[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [accountName, setAccountName] = useState('')
  const [accountDescription, setAccountDescription] = useState('')
  const [keyAccountId, setKeyAccountId] = useState<string | null>(null)
  const [keyName, setKeyName] = useState('')
  const [keyTtl, setKeyTtl] = useState('30')
  const [ipAllowlist, setIpAllowlist] = useState('')
  const [oneTimeKey, setOneTimeKey] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!signedIn) return
    setLoading(true)
    setError(null)
    try {
      const [nextControl, page] = await Promise.all([developerService.control(), developerService.list({ limit: 50, sort: 'createdAt', order: 'desc' })])
      setControl(nextControl)
      setAccounts(page.items)
      setKeyTtl(String(nextControl.defaultKeyTtlDays))
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : textFor(t, 'Could not load developer access.', '无法读取开发者访问配置。'))
    } finally {
      setLoading(false)
    }
  }, [signedIn, t])

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  const createAccount = async () => {
    if (!accountName.trim()) return
    setBusy('create-account')
    setError(null)
    try {
      const account = await developerService.createAccount({ name: accountName.trim(), description: accountDescription.trim() })
      setAccounts((current) => [account, ...current])
      setAccountName('')
      setAccountDescription('')
      notify(textFor(t, 'Service account created.', 'Service Account 已创建。'))
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : textFor(t, 'Could not create service account.', '无法创建 Service Account。'))
    } finally {
      setBusy(null)
    }
  }

  const createKey = async () => {
    if (!keyAccountId || !keyName.trim()) return
    setBusy(`create-key:${keyAccountId}`)
    setError(null)
    try {
      const result = await developerService.createKey(keyAccountId, {
        name: keyName.trim(),
        scopes: ['developer:identity:read'],
        ipAllowlist: ipAllowlist.split(/[\n,]/).map((value) => value.trim()).filter(Boolean),
        ttlDays: Number(keyTtl),
      })
      setOneTimeKey(result.plaintextKey)
      setKeyName('')
      setIpAllowlist('')
      setKeyAccountId(null)
      await refresh()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : textFor(t, 'Could not create API key.', '无法创建 API Key。'))
    } finally {
      setBusy(null)
    }
  }

  const revokeAccount = async (account: DeveloperServiceAccount) => {
    if (!window.confirm(textFor(t, `Revoke ${account.name} and all its keys?`, `撤销 ${account.name} 及其全部密钥？`))) return
    setBusy(account.id)
    try {
      const updated = await developerService.revokeAccount(account.id, { expectedVersion: account.version, reasonCode: 'owner_revoked' })
      setAccounts((current) => current.map((item) => item.id === updated.id ? updated : item))
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : textFor(t, 'Could not revoke service account.', '无法撤销 Service Account。'))
    } finally { setBusy(null) }
  }

  const revokeKey = async (account: DeveloperServiceAccount, key: DeveloperApiKeyCredential) => {
    if (!window.confirm(textFor(t, `Revoke ${key.name}?`, `撤销 ${key.name}？`))) return
    setBusy(key.id)
    try {
      await developerService.revokeKey(account.id, key.id, { expectedVersion: key.version, reasonCode: 'owner_revoked' })
      await refresh()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : textFor(t, 'Could not revoke API key.', '无法撤销 API Key。'))
    } finally { setBusy(null) }
  }

  const rotateKey = async (account: DeveloperServiceAccount, key: DeveloperApiKeyCredential) => {
    if (!window.confirm(textFor(t, `Rotate ${key.name} now? The old key stops immediately.`, `立即轮换 ${key.name}？旧密钥会立即失效。`))) return
    setBusy(key.id)
    try {
      const result = await developerService.rotateKey(account.id, key.id, {
        name: `${key.name} rotated`, scopes: key.scopes, ipAllowlist: key.ipAllowlist,
        ttlDays: control?.defaultKeyTtlDays ?? 30, expectedVersion: key.version, reasonCode: 'owner_rotation',
      })
      setOneTimeKey(result.plaintextKey)
      await refresh()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : textFor(t, 'Could not rotate API key.', '无法轮换 API Key。'))
    } finally { setBusy(null) }
  }

  if (!signedIn) {
    return <div className="stack"><section className="panel empty-state"><KeyRound size={24} /><strong>{textFor(t, 'Sign in to manage API access', '登录后管理 API 访问')}</strong><button className="primary-button" type="button" onClick={requireAuth}>{textFor(t, 'Sign in', '登录')}</button></section></div>
  }

  return (
    <div className="stack developer-access-page">
      <section className="page-section developer-access-heading">
        <div><span className="eyebrow">{textFor(t, 'Developer platform', '开发者平台')}</span><h1>{textFor(t, 'Service accounts and API keys', 'Service Account 与 API Key')}</h1></div>
        <button className="icon-button" type="button" onClick={() => void refresh()} title={textFor(t, 'Refresh', '刷新')}><RefreshCw size={18} /></button>
      </section>

      {error && <div className="inline-alert error">{error}</div>}
      {oneTimeKey && (
        <section className="panel one-time-key" data-testid="one-time-api-key">
          <SectionHeader eyebrow={textFor(t, 'Shown once', '仅显示一次')} title={textFor(t, 'Store this key now', '立即保存此密钥')} />
          <div className="secret-display"><code>{oneTimeKey}</code><button className="icon-button" type="button" title={textFor(t, 'Copy key', '复制密钥')} onClick={() => void navigator.clipboard.writeText(oneTimeKey).then(() => notify(textFor(t, 'API key copied.', 'API Key 已复制。')))}><Copy size={17} /></button></div>
          <button className="ghost-button" type="button" onClick={() => setOneTimeKey(null)}>{textFor(t, 'I stored it', '我已保存')}</button>
        </section>
      )}

      {control && !control.enabled && <div className="inline-alert warning"><ShieldCheck size={18} />{textFor(t, 'API key access is disabled by an administrator.', '管理员尚未启用 API Key 访问。')}</div>}

      <section className="panel developer-create-account">
        <SectionHeader title={textFor(t, 'Create service account', '创建 Service Account')} />
        <div className="developer-form-row">
          <label><span>{textFor(t, 'Name', '名称')}</span><input value={accountName} onChange={(event) => setAccountName(event.target.value)} maxLength={80} disabled={!control?.enabled} /></label>
          <label className="grow"><span>{textFor(t, 'Description', '描述')}</span><input value={accountDescription} onChange={(event) => setAccountDescription(event.target.value)} maxLength={240} disabled={!control?.enabled} /></label>
          <button className="primary-button" type="button" onClick={() => void createAccount()} disabled={!control?.enabled || busy === 'create-account' || !accountName.trim()}><Plus size={17} />{textFor(t, 'Create', '创建')}</button>
        </div>
      </section>

      <section className="page-section">
        <SectionHeader title={textFor(t, `Service accounts ${accounts.length}`, `Service Account ${accounts.length}`)} />
        <div className="developer-account-list">
          {accounts.map((account) => (
            <article className="developer-account" key={account.id} data-testid={`service-account-${account.id}`}>
              <div className="developer-account-header"><div><strong>{account.name}</strong><span>{account.description || textFor(t, 'No description', '无描述')}</span></div><span className={`status-badge ${account.status === 'active' ? 'success' : 'danger'}`}>{account.status}</span><div className="button-row"><button className="ghost-button small" type="button" onClick={() => setKeyAccountId(account.id)} disabled={account.status !== 'active' || !control?.enabled}><KeyRound size={15} />{textFor(t, 'New key', '新建密钥')}</button><button className="icon-button" type="button" onClick={() => void revokeAccount(account)} disabled={account.status !== 'active' || busy === account.id} title={textFor(t, 'Revoke service account', '撤销 Service Account')}><Ban size={16} /></button></div></div>
              {keyAccountId === account.id && <div className="developer-key-form"><label><span>{textFor(t, 'Key name', '密钥名称')}</span><input value={keyName} onChange={(event) => setKeyName(event.target.value)} /></label><label><span>{textFor(t, 'TTL days', '有效天数')}</span><input type="number" min="1" max="365" value={keyTtl} onChange={(event) => setKeyTtl(event.target.value)} /></label><label className="grow"><span>{textFor(t, 'IP/CIDR allowlist', 'IP/CIDR 白名单')}</span><input value={ipAllowlist} onChange={(event) => setIpAllowlist(event.target.value)} placeholder="203.0.113.0/24" /></label><button className="primary-button" type="button" onClick={() => void createKey()} disabled={!keyName.trim() || busy === `create-key:${account.id}`}><Plus size={16} />{textFor(t, 'Issue once', '签发')}</button></div>}
              <div className="developer-key-list">
                {account.keys.map((key) => <div className="developer-key-row" key={key.id}><div><strong>{key.name}</strong><code>{key.displayPrefix}</code></div><span className={`status-badge ${key.status === 'active' ? 'success' : 'danger'}`}>{key.status}</span><span>{key.usageCount} {textFor(t, 'uses', '次调用')}</span><span>{textFor(t, 'Expires', '到期')} {formatDate(key.expiresAt)}</span><span>{key.ipAllowlist.length ? key.ipAllowlist.join(', ') : textFor(t, 'Any IP', '任意 IP')}</span><div className="button-row"><button className="icon-button" type="button" title={textFor(t, 'Rotate key', '轮换密钥')} onClick={() => void rotateKey(account, key)} disabled={key.status !== 'active' || busy === key.id}><RotateCw size={15} /></button><button className="icon-button" type="button" title={textFor(t, 'Revoke key', '撤销密钥')} onClick={() => void revokeKey(account, key)} disabled={key.status !== 'active' || busy === key.id}><Ban size={15} /></button></div></div>)}
                {!account.keys.length && <div className="empty-state"><strong>{textFor(t, 'No API keys', '暂无 API Key')}</strong></div>}
              </div>
            </article>
          ))}
          {!loading && !accounts.length && <div className="empty-state"><strong>{textFor(t, 'No service accounts', '暂无 Service Account')}</strong></div>}
        </div>
      </section>
    </div>
  )
}
