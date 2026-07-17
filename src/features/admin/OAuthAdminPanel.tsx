import { useCallback, useEffect, useState } from 'react'
import { Ban, Power, RefreshCw, Save, Search, Unlink } from 'lucide-react'

import { SectionHeader } from '../../components/ui/SectionHeader'
import { isZhCopy, textFor } from '../../domain/utils'
import { adminService } from '../../services/adminService'
import type {
  AdminOAuthAccount,
  AdminOAuthAuthorizationRequest,
  AdminOAuthProviderControl,
} from '../../services/contracts'

type OAuthAdminPanelProps = {
  t: Record<string, string>
  canRead: boolean
  canManage: boolean
  notify: (message: string) => void
}

const providers = ['google', 'github', 'apple', 'discord']
const requestStatuses = ['pending', 'consumed', 'revoked', 'expired']
const defaultReason = 'operator_requested'

const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback
type OAuthConfigurationDraft = { clientId: string; redirectUri: string; scopes: string; clientSecretRef: string }
const draftFor = (control: AdminOAuthProviderControl): OAuthConfigurationDraft => ({
  clientId: control.clientId ?? '',
  redirectUri: control.redirectUri ?? '',
  scopes: control.scopes.join(' '),
  clientSecretRef: control.clientSecretRef ?? `secret://oauth/${control.provider}/client-secret`,
})

export function OAuthAdminPanel({ t, canRead, canManage, notify }: OAuthAdminPanelProps) {
  const isZh = isZhCopy(t)
  const [providerControls, setProviderControls] = useState<AdminOAuthProviderControl[]>([])
  const [providerReasons, setProviderReasons] = useState<Record<string, string>>({})
  const [providerDrafts, setProviderDrafts] = useState<Record<string, OAuthConfigurationDraft>>({})
  const [providerBusy, setProviderBusy] = useState<string | null>(null)
  const [providerError, setProviderError] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<AdminOAuthAccount[]>([])
  const [accountProvider, setAccountProvider] = useState('')
  const [accountSearch, setAccountSearch] = useState('')
  const [accountOrder, setAccountOrder] = useState<'asc' | 'desc'>('desc')
  const [accountCursor, setAccountCursor] = useState<string | null>(null)
  const [accountBusy, setAccountBusy] = useState(true)
  const [accountError, setAccountError] = useState<string | null>(null)
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null)
  const [requests, setRequests] = useState<AdminOAuthAuthorizationRequest[]>([])
  const [requestProvider, setRequestProvider] = useState('')
  const [requestStatus, setRequestStatus] = useState('pending')
  const [requestSort, setRequestSort] = useState<'createdAt' | 'expiresAt'>('createdAt')
  const [requestOrder, setRequestOrder] = useState<'asc' | 'desc'>('desc')
  const [requestCursor, setRequestCursor] = useState<string | null>(null)
  const [requestBusy, setRequestBusy] = useState(true)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [revokingId, setRevokingId] = useState<string | null>(null)

  const loadProviders = useCallback(async () => {
    if (!canRead) return
    setProviderError(null)
    try {
      const controls = await adminService.oauthProviders()
      setProviderControls(controls)
      setProviderDrafts(Object.fromEntries(controls.map((control) => [control.provider, draftFor(control)])))
    } catch (error) {
      setProviderError(errorMessage(error, isZh ? '无法读取 OAuth Provider 状态。' : 'Could not load OAuth Provider status.'))
    }
  }, [canRead, isZh])

  const loadAccounts = useCallback(async (append = false) => {
    if (!canRead) return
    setAccountBusy(true)
    setAccountError(null)
    try {
      const page = await adminService.oauthAccounts({
        provider: accountProvider || null,
        search: accountSearch.trim() || null,
        cursor: append ? accountCursor : null,
        limit: 20,
        sort: 'createdAt',
        order: accountOrder,
      })
      setAccounts((current) => append ? [...current, ...page.items] : page.items)
      setAccountCursor(page.nextCursor)
    } catch (error) {
      setAccountError(errorMessage(error, isZh ? '无法读取 OAuth 账号。' : 'Could not load OAuth accounts.'))
    } finally {
      setAccountBusy(false)
    }
  }, [accountCursor, accountOrder, accountProvider, accountSearch, canRead, isZh])

  const loadRequests = useCallback(async (append = false) => {
    if (!canRead) return
    setRequestBusy(true)
    setRequestError(null)
    try {
      const page = await adminService.oauthAuthorizationRequests({
        provider: requestProvider || null,
        status: requestStatus || null,
        cursor: append ? requestCursor : null,
        limit: 20,
        sort: requestSort,
        order: requestOrder,
      })
      setRequests((current) => append ? [...current, ...page.items] : page.items)
      setRequestCursor(page.nextCursor)
    } catch (error) {
      setRequestError(errorMessage(error, isZh ? '无法读取 OAuth 授权请求。' : 'Could not load OAuth authorization requests.'))
    } finally {
      setRequestBusy(false)
    }
  }, [canRead, isZh, requestCursor, requestOrder, requestProvider, requestSort, requestStatus])

  useEffect(() => {
    if (!canRead) return
    let cancelled = false
    void Promise.all([
      adminService.oauthProviders(),
      adminService.oauthAccounts({ limit: 20, sort: 'createdAt', order: 'desc' }),
      adminService.oauthAuthorizationRequests({ status: 'pending', limit: 20, sort: 'createdAt', order: 'desc' }),
    ]).then(([nextProviders, accountPage, requestPage]) => {
      if (cancelled) return
      setProviderControls(nextProviders)
      setProviderDrafts(Object.fromEntries(nextProviders.map((control) => [control.provider, draftFor(control)])))
      setAccounts(accountPage.items)
      setAccountCursor(accountPage.nextCursor)
      setRequests(requestPage.items)
      setRequestCursor(requestPage.nextCursor)
    }).catch((error) => {
      if (cancelled) return
      const message = errorMessage(error, isZh ? '无法读取 OAuth 运营数据。' : 'Could not load OAuth operations.')
      setProviderError(message)
      setAccountError(message)
      setRequestError(message)
    }).finally(() => {
      if (cancelled) return
      setAccountBusy(false)
      setRequestBusy(false)
    })
    return () => { cancelled = true }
  }, [canRead, isZh])

  const changeProvider = async (control: AdminOAuthProviderControl) => {
    if (!canManage) return
    const nextEnabled = !control.enabled
    const confirmed = window.confirm(nextEnabled
      ? textFor(t, `Enable ${control.label}?`, `启用 ${control.label}？`)
      : textFor(t, `Disable ${control.label}?`, `停用 ${control.label}？`))
    if (!confirmed) return
    setProviderBusy(control.provider)
    setProviderError(null)
    try {
      const updated = await adminService.setOAuthProviderStatus(control.provider, {
        enabled: nextEnabled,
        expectedVersion: control.version,
        reasonCode: providerReasons[control.provider]?.trim() || defaultReason,
      })
      setProviderControls((current) => current.map((item) => item.provider === updated.provider ? updated : item))
      notify(textFor(t, `${control.label} OAuth updated.`, `${control.label} OAuth 已更新。`))
    } catch (error) {
      setProviderError(errorMessage(error, isZh ? 'OAuth Provider 状态更新失败。' : 'OAuth Provider update failed.'))
      await loadProviders()
    } finally {
      setProviderBusy(null)
    }
  }

  const saveProviderConfiguration = async (control: AdminOAuthProviderControl) => {
    if (!canManage) return
    const draft = providerDrafts[control.provider] ?? draftFor(control)
    setProviderBusy(control.provider)
    setProviderError(null)
    try {
      const updated = await adminService.setOAuthProviderConfiguration(control.provider, {
        clientId: draft.clientId.trim(),
        redirectUri: draft.redirectUri.trim(),
        scopes: draft.scopes.split(/\s+/).filter(Boolean),
        clientSecretRef: draft.clientSecretRef.trim(),
        expectedVersion: control.version,
        reasonCode: providerReasons[control.provider]?.trim() || 'configuration_updated',
      })
      setProviderControls((current) => current.map((item) => item.provider === updated.provider ? updated : item))
      setProviderDrafts((current) => ({ ...current, [updated.provider]: draftFor(updated) }))
      notify(textFor(t, `${control.label} OAuth configuration saved.`, `${control.label} OAuth 配置已保存。`))
    } catch (error) {
      setProviderError(errorMessage(error, isZh ? 'OAuth Provider 配置保存失败。' : 'OAuth Provider configuration failed.'))
      await loadProviders()
    } finally {
      setProviderBusy(null)
    }
  }

  const unlinkAccount = async (account: AdminOAuthAccount) => {
    if (!canManage || !window.confirm(textFor(t, `Unlink ${account.provider} from ${account.user.handle ?? account.user.displayName}?`, `解除 ${account.user.handle ?? account.user.displayName} 的 ${account.provider} 绑定？`))) return
    setUnlinkingId(account.id)
    setAccountError(null)
    try {
      await adminService.unlinkOAuthAccount(account.id)
      setAccounts((current) => current.filter((item) => item.id !== account.id))
      notify(textFor(t, 'OAuth account unlinked.', 'OAuth 账号已解绑。'))
    } catch (error) {
      setAccountError(errorMessage(error, isZh ? 'OAuth 账号解绑失败。' : 'OAuth account unlink failed.'))
    } finally {
      setUnlinkingId(null)
    }
  }

  const revokeRequest = async (request: AdminOAuthAuthorizationRequest) => {
    if (!canManage || !window.confirm(textFor(t, `Revoke pending ${request.provider} authorization?`, `撤销待处理的 ${request.provider} 授权？`))) return
    setRevokingId(request.id)
    setRequestError(null)
    try {
      const result = await adminService.revokeOAuthAuthorizationRequest(request.id, 'operator_revoked')
      setRequests((current) => current.map((item) => item.id === request.id ? result.request : item))
      notify(textFor(t, 'OAuth authorization revoked.', 'OAuth 授权已撤销。'))
    } catch (error) {
      setRequestError(errorMessage(error, isZh ? 'OAuth 授权撤销失败。' : 'OAuth authorization revoke failed.'))
      await loadRequests(false)
    } finally {
      setRevokingId(null)
    }
  }

  if (!canRead) {
    return (
      <section className="panel oauth-admin-panel" data-testid="oauth-admin-panel">
        <SectionHeader eyebrow="OAuth" title={textFor(t, 'OAuth operations', 'OAuth 运营')} />
        <div className="empty-state"><strong>{textFor(t, 'Access denied', '无访问权限')}</strong></div>
      </section>
    )
  }

  return (
    <section className="panel oauth-admin-panel" data-testid="oauth-admin-panel">
      <SectionHeader
        eyebrow="OAuth"
        title={textFor(t, 'OAuth operations', 'OAuth 运营')}
        action={<button className="ghost-button" type="button" onClick={() => void Promise.all([loadProviders(), loadAccounts(false), loadRequests(false)])} title={textFor(t, 'Refresh OAuth operations', '刷新 OAuth 运营数据')}><RefreshCw size={17} />{textFor(t, 'Refresh', '刷新')}</button>}
      />

      <div className="oauth-provider-list">
        {providerControls.map((control) => (
          <div className="oauth-provider-row" key={control.provider} data-testid={`oauth-provider-${control.provider}`}>
            <div>
              <strong>{control.label}</strong>
              <span>{control.mode} · {control.callbackMethod} · v{control.version}</span>
            </div>
            <span className={control.enabled ? 'status-badge success' : 'status-badge danger'}>{control.enabled ? textFor(t, 'Enabled', '已启用') : textFor(t, 'Disabled', '已停用')}</span>
            <span className={control.environmentAvailable ? 'status-badge' : 'status-badge warning'}>{control.environmentAvailable ? textFor(t, 'Available', '环境可用') : textFor(t, 'Unavailable', '环境不可用')}</span>
            <input aria-label={textFor(t, `${control.label} reason code`, `${control.label} 原因码`)} value={providerReasons[control.provider] ?? ''} onChange={(event) => setProviderReasons((current) => ({ ...current, [control.provider]: event.target.value }))} placeholder={defaultReason} disabled={!canManage} />
            <button className={control.enabled ? 'ghost-button small danger-button' : 'primary-button small'} type="button" onClick={() => void changeProvider(control)} disabled={!canManage || providerBusy === control.provider || (!control.enabled && !control.environmentAvailable)} title={control.enabled ? textFor(t, `Disable ${control.label}`, `停用 ${control.label}`) : textFor(t, `Enable ${control.label}`, `启用 ${control.label}`)}>
              <Power size={16} />{providerBusy === control.provider ? textFor(t, 'Updating', '更新中') : control.enabled ? textFor(t, 'Disable', '停用') : textFor(t, 'Enable', '启用')}
            </button>
            <div className="oauth-provider-config">
              <label><span>Client ID</span><input aria-label={`${control.label} Client ID`} value={providerDrafts[control.provider]?.clientId ?? ''} onChange={(event) => setProviderDrafts((current) => ({ ...current, [control.provider]: { ...(current[control.provider] ?? draftFor(control)), clientId: event.target.value } }))} disabled={!canManage} /></label>
              <label><span>Redirect URI</span><input aria-label={`${control.label} Redirect URI`} value={providerDrafts[control.provider]?.redirectUri ?? ''} onChange={(event) => setProviderDrafts((current) => ({ ...current, [control.provider]: { ...(current[control.provider] ?? draftFor(control)), redirectUri: event.target.value } }))} disabled={!canManage} /></label>
              <label><span>Scopes</span><input aria-label={`${control.label} scopes`} value={providerDrafts[control.provider]?.scopes ?? ''} onChange={(event) => setProviderDrafts((current) => ({ ...current, [control.provider]: { ...(current[control.provider] ?? draftFor(control)), scopes: event.target.value } }))} disabled={!canManage} /></label>
              <label><span>SecretRef</span><input aria-label={`${control.label} SecretRef`} value={providerDrafts[control.provider]?.clientSecretRef ?? ''} onChange={(event) => setProviderDrafts((current) => ({ ...current, [control.provider]: { ...(current[control.provider] ?? draftFor(control)), clientSecretRef: event.target.value } }))} disabled={!canManage} /></label>
              <button className="ghost-button" type="button" onClick={() => void saveProviderConfiguration(control)} disabled={!canManage || providerBusy === control.provider} title={textFor(t, `Save ${control.label} settings`, `保存 ${control.label} 设置`)}><Save size={16} />{textFor(t, 'Save', '保存')}</button>
              <span className={control.secretAvailable ? 'status-badge success' : 'status-badge warning'}>{control.secretAvailable ? textFor(t, 'Secret mounted', '密钥已挂载') : textFor(t, 'Secret missing', '缺少密钥')}</span>
            </div>
          </div>
        ))}
      </div>
      {providerError && <div className="inline-alert error">{providerError}</div>}

      <div className="oauth-operation-block">
        <div className="oauth-block-header"><strong>{textFor(t, 'Linked accounts', '已绑定账号')}</strong><span>{accounts.length}</span></div>
        <div className="oauth-filter-bar">
          <label><span>{textFor(t, 'Provider', 'Provider')}</span><select value={accountProvider} onChange={(event) => setAccountProvider(event.target.value)}><option value="">{textFor(t, 'All', '全部')}</option>{providers.map((provider) => <option value={provider} key={provider}>{provider}</option>)}</select></label>
          <label className="oauth-search-field"><span>{textFor(t, 'User', '用户')}</span><div><Search size={16} /><input value={accountSearch} onChange={(event) => setAccountSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void loadAccounts(false) }} /></div></label>
          <label><span>{textFor(t, 'Order', '排序')}</span><select value={accountOrder} onChange={(event) => setAccountOrder(event.target.value as 'asc' | 'desc')}><option value="desc">{textFor(t, 'Newest', '最新')}</option><option value="asc">{textFor(t, 'Oldest', '最早')}</option></select></label>
          <button className="ghost-button" type="button" onClick={() => void loadAccounts(false)} disabled={accountBusy}><Search size={16} />{textFor(t, 'Apply', '查询')}</button>
        </div>
        {accountError && <div className="inline-alert error">{accountError}</div>}
        <div className="oauth-record-list">
          {accounts.map((account) => (
            <div className="oauth-record-row" key={account.id} data-testid={`oauth-account-${account.id}`}>
              <div><strong>{account.user.handle ? `@${account.user.handle}` : account.user.displayName}</strong><span>{account.user.email ?? account.user.id}</span></div>
              <span>{account.provider}</span><code>{account.providerUserIdHint}</code><span>{new Date(account.createdAt).toLocaleString()}</span>
              <button className="icon-button" type="button" title={textFor(t, 'Unlink OAuth account', '解绑 OAuth 账号')} aria-label={textFor(t, 'Unlink OAuth account', '解绑 OAuth 账号')} onClick={() => void unlinkAccount(account)} disabled={!canManage || unlinkingId === account.id}><Unlink size={16} /></button>
            </div>
          ))}
          {!accountBusy && accounts.length === 0 && <div className="empty-state"><strong>{textFor(t, 'No linked accounts', '暂无绑定账号')}</strong></div>}
        </div>
        {accountCursor && <button className="ghost-button" type="button" onClick={() => void loadAccounts(true)} disabled={accountBusy}>{textFor(t, 'Load more', '加载更多')}</button>}
      </div>

      <div className="oauth-operation-block">
        <div className="oauth-block-header"><strong>{textFor(t, 'Authorization requests', '授权请求')}</strong><span>{requests.length}</span></div>
        <div className="oauth-filter-bar">
          <label><span>{textFor(t, 'Provider', 'Provider')}</span><select value={requestProvider} onChange={(event) => setRequestProvider(event.target.value)}><option value="">{textFor(t, 'All', '全部')}</option>{providers.map((provider) => <option value={provider} key={provider}>{provider}</option>)}</select></label>
          <label><span>{textFor(t, 'Status', '状态')}</span><select value={requestStatus} onChange={(event) => setRequestStatus(event.target.value)}><option value="">{textFor(t, 'All', '全部')}</option>{requestStatuses.map((status) => <option value={status} key={status}>{status}</option>)}</select></label>
          <label><span>{textFor(t, 'Sort', '排序字段')}</span><select value={requestSort} onChange={(event) => setRequestSort(event.target.value as 'createdAt' | 'expiresAt')}><option value="createdAt">createdAt</option><option value="expiresAt">expiresAt</option></select></label>
          <label><span>{textFor(t, 'Order', '顺序')}</span><select value={requestOrder} onChange={(event) => setRequestOrder(event.target.value as 'asc' | 'desc')}><option value="desc">desc</option><option value="asc">asc</option></select></label>
          <button className="ghost-button" type="button" onClick={() => void loadRequests(false)} disabled={requestBusy}><Search size={16} />{textFor(t, 'Apply', '查询')}</button>
        </div>
        {requestError && <div className="inline-alert error">{requestError}</div>}
        <div className="oauth-record-list">
          {requests.map((request) => (
            <div className="oauth-record-row oauth-request-row" key={request.id} data-testid={`oauth-request-${request.id}`}>
              <div><strong>{request.provider}</strong><span>{request.id}</span></div>
              <span className={`status-badge ${request.status === 'pending' ? 'warning' : request.status === 'revoked' ? 'danger' : ''}`}>{request.status}</span>
              <span>{new Date(request.createdAt).toLocaleString()}</span><span>{new Date(request.expiresAt).toLocaleString()}</span>
              <button className="icon-button" type="button" title={textFor(t, 'Revoke authorization', '撤销授权')} aria-label={textFor(t, 'Revoke authorization', '撤销授权')} onClick={() => void revokeRequest(request)} disabled={!canManage || request.status !== 'pending' || revokingId === request.id}><Ban size={16} /></button>
            </div>
          ))}
          {!requestBusy && requests.length === 0 && <div className="empty-state"><strong>{textFor(t, 'No authorization requests', '暂无授权请求')}</strong></div>}
        </div>
        {requestCursor && <button className="ghost-button" type="button" onClick={() => void loadRequests(true)} disabled={requestBusy}>{textFor(t, 'Load more', '加载更多')}</button>}
      </div>
    </section>
  )
}
