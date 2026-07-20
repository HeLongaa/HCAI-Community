import { useEffect, useState } from 'react'
import { Download, Eye, EyeOff, FileArchive, LoaderCircle, Save, ShieldCheck, Trash2, Undo2 } from 'lucide-react'

import type { MarketplaceProfile } from '../../domain/types'
import { isZhCopy, localizeText, textFor } from '../../domain/utils'
import type { ApiOwnProfile, DataRightsRequestDto, DataRightsRequestType } from '../../services/contracts'
import { profileService } from '../../services/profileService'

type Draft = {
  displayName: string
  handle: string
  bio: string
  lane: 'maker' | 'publisher' | 'both'
  skills: string
  languages: string
  visibility: 'public' | 'unlisted' | 'private'
  discoverable: boolean
  showActivity: boolean
  showPortfolio: boolean
}

const draftFor = (profile: ApiOwnProfile, t: Record<string, string>): Draft => ({
  displayName: localizeText(profile.name, t),
  handle: profile.handle,
  bio: localizeText(profile.bio, t),
  lane: profile.lane,
  skills: profile.tags.join(', '),
  languages: profile.languages.join(', '),
  visibility: profile.privacy.visibility,
  discoverable: profile.privacy.discoverable,
  showActivity: profile.privacy.showActivity,
  showPortfolio: profile.privacy.showPortfolio,
})

const listValue = (value: string) => [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))]
const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback

export function ProfileSettingsPanel({ t, onUpdated }: {
  t: Record<string, string>
  onUpdated: (profile: MarketplaceProfile) => Promise<void> | void
}) {
  const isZh = isZhCopy(t)
  const [profile, setProfile] = useState<ApiOwnProfile | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [loading, setLoading] = useState(true)
  const [requests, setRequests] = useState<DataRightsRequestDto[]>([])
  const [identityConfirmation, setIdentityConfirmation] = useState('')
  const [busy, setBusy] = useState<'save' | 'export' | 'delete' | 'legacy-cancel' | `cancel:${string}` | `download:${string}` | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    Promise.all([profileService.own(), profileService.dataRightsRequests()])
      .then(([result, rightsRequests]) => {
        if (!active) return
        setProfile(result)
        setDraft(draftFor(result, t))
        setRequests(rightsRequests)
      })
      .catch((cause) => active && setError(errorMessage(cause, textFor(t, 'Could not load profile settings.', '无法加载资料设置。'))))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [t])

  const save = async () => {
    if (!profile || !draft) return
    setBusy('save')
    setError('')
    try {
      const updated = await profileService.updateOwn({
        displayName: draft.displayName,
        handle: draft.handle,
        bio: draft.bio,
        lane: draft.lane,
        skills: listValue(draft.skills),
        languages: listValue(draft.languages),
        visibility: draft.visibility,
        discoverable: draft.discoverable,
        showActivity: draft.showActivity,
        showPortfolio: draft.showPortfolio,
        expectedVersion: profile.privacy.version,
      })
      setProfile(updated)
      setDraft(draftFor(updated, t))
      await onUpdated(updated)
    } catch (cause) {
      setError(errorMessage(cause, textFor(t, 'Could not save profile settings.', '无法保存资料设置。')))
    } finally {
      setBusy(null)
    }
  }

  const createRightsRequest = async (requestType: DataRightsRequestType) => {
    if (!profile || identityConfirmation.trim().toLowerCase() !== profile.handle.toLowerCase()) return
    setBusy(requestType === 'data_export' ? 'export' : 'delete')
    setError('')
    try {
      const created = await profileService.createDataRightsRequest({
        requestType,
        identityConfirmation,
        reasonCode: 'owner_requested',
        expectedAccountVersion: profile.account.version,
      })
      setRequests((current) => [created, ...current])
      setIdentityConfirmation('')
      if (requestType === 'account_deletion') {
        const account = await profileService.accountStatus()
        setProfile((current) => current ? { ...current, account } : current)
      }
    } catch (cause) {
      setError(errorMessage(cause, textFor(t, 'Could not create the data rights request.', '无法创建数据权利请求。')))
    } finally {
      setBusy(null)
    }
  }

  const cancelRightsRequest = async (request: DataRightsRequestDto) => {
    if (!profile) return
    setBusy(`cancel:${request.id}`)
    setError('')
    try {
      const cancelled = await profileService.cancelDataRightsRequest(request.id, { expectedVersion: request.version, reasonCode: 'owner_cancelled' })
      setRequests((current) => current.map((item) => item.id === cancelled.id ? cancelled : item))
      if (request.requestType === 'account_deletion') {
        const account = await profileService.accountStatus()
        setProfile((current) => current ? { ...current, account } : current)
      }
    } catch (cause) {
      setError(errorMessage(cause, textFor(t, 'Could not cancel the data rights request.', '无法取消数据权利请求。')))
    } finally {
      setBusy(null)
    }
  }

  const cancelLegacyDeletion = async () => {
    if (!profile) return
    setBusy('legacy-cancel')
    setError('')
    try {
      const account = await profileService.cancelAccountDeletion({ expectedVersion: profile.account.version, reasonCode: 'owner_cancelled' })
      setProfile({ ...profile, account })
    } catch (cause) {
      setError(errorMessage(cause, textFor(t, 'Could not cancel the legacy deletion request.', '无法取消旧版删除申请。')))
    } finally { setBusy(null) }
  }

  const downloadExport = async (request: DataRightsRequestDto) => {
    setBusy(`download:${request.id}`)
    setError('')
    try {
      const result = await profileService.dataRightsExport(request.id)
      const anchor = document.createElement('a')
      if (result.package) {
        const url = URL.createObjectURL(new Blob([JSON.stringify(result.package, null, 2)], { type: 'application/json' }))
        anchor.href = url
        anchor.download = `data-export-${request.id}.json`
        anchor.click()
        URL.revokeObjectURL(url)
      } else {
        anchor.href = result.download.url
        anchor.rel = 'noopener noreferrer'
        anchor.click()
      }
    } catch (cause) {
      setError(errorMessage(cause, textFor(t, 'Could not download the data export.', '无法下载数据导出。')))
    } finally { setBusy(null) }
  }

  if (loading) return <section className="panel profile-settings-panel"><LoaderCircle className="spin" size={18}/></section>
  if (!profile || !draft) return <section className="panel profile-settings-panel"><div className="inline-alert error">{error}</div></section>

  const identityMatches = identityConfirmation.trim().toLowerCase() === profile.handle.toLowerCase()
  const activeDeletion = requests.find((request) => request.requestType === 'account_deletion' && ['identity_verified', 'processing', 'primary_completed', 'blocked'].includes(request.status))
  const legacyDeletion = profile.account.status === 'deletion_requested' && !activeDeletion
  const formatDate = (value: string | null) => value ? new Date(value).toLocaleString(isZh ? 'zh-CN' : 'en-US') : '-'

  return <section className="panel profile-settings-panel" data-testid="profile-settings-panel">
    <header>
      <div><span>{textFor(t, 'Account', '账号')}</span><h2>{textFor(t, 'Profile and privacy', '资料与隐私')}</h2></div>
      <span className={`status-badge ${profile.account.status === 'active' ? 'success' : 'warning'}`}>{profile.account.status}</span>
    </header>
    {error && <div className="inline-alert error">{error}</div>}
    <div className="profile-settings-grid">
      <label><span>{textFor(t, 'Display name', '显示名称')}</span><input aria-label={textFor(t, 'Profile display name', '资料显示名称')} value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}/></label>
      <label><span>{textFor(t, 'Handle', '用户名')}</span><input aria-label={textFor(t, 'Profile handle', '资料用户名')} value={draft.handle} onChange={(event) => setDraft({ ...draft, handle: event.target.value })}/></label>
      <label className="wide"><span>{textFor(t, 'Bio', '简介')}</span><textarea aria-label={textFor(t, 'Profile bio', '资料简介')} value={draft.bio} onChange={(event) => setDraft({ ...draft, bio: event.target.value })}/></label>
      <label><span>{textFor(t, 'Creator lane', '创作方向')}</span><select aria-label={textFor(t, 'Profile lane', '资料创作方向')} value={draft.lane} onChange={(event) => setDraft({ ...draft, lane: event.target.value as Draft['lane'] })}><option value="maker">maker</option><option value="publisher">publisher</option><option value="both">both</option></select></label>
      <label><span>{textFor(t, 'Visibility', '可见性')}</span><select aria-label={textFor(t, 'Profile visibility', '资料可见性')} value={draft.visibility} onChange={(event) => setDraft({ ...draft, visibility: event.target.value as Draft['visibility'] })}><option value="public">public</option><option value="unlisted">unlisted</option><option value="private">private</option></select></label>
      <label><span>{textFor(t, 'Skills', '技能')}</span><input aria-label={textFor(t, 'Profile skills', '资料技能')} value={draft.skills} onChange={(event) => setDraft({ ...draft, skills: event.target.value })}/></label>
      <label><span>{textFor(t, 'Languages', '语言')}</span><input aria-label={textFor(t, 'Profile languages', '资料语言')} value={draft.languages} onChange={(event) => setDraft({ ...draft, languages: event.target.value })}/></label>
    </div>
    <div className="profile-privacy-toggles">
      <label><input type="checkbox" checked={draft.discoverable} onChange={(event) => setDraft({ ...draft, discoverable: event.target.checked })}/><Eye size={16}/><span>{textFor(t, 'Discoverable', '允许发现')}</span></label>
      <label><input type="checkbox" checked={draft.showActivity} onChange={(event) => setDraft({ ...draft, showActivity: event.target.checked })}/><Eye size={16}/><span>{textFor(t, 'Activity visible', '显示活动')}</span></label>
      <label><input type="checkbox" checked={draft.showPortfolio} onChange={(event) => setDraft({ ...draft, showPortfolio: event.target.checked })}/><EyeOff size={16}/><span>{textFor(t, 'Portfolio visible', '显示作品集')}</span></label>
    </div>
    <div className="profile-settings-actions">
      <button className="primary-button" type="button" onClick={() => void save()} disabled={Boolean(busy)}><Save size={16}/>{busy === 'save' ? textFor(t, 'Saving', '保存中') : textFor(t, 'Save', '保存')}</button>
    </div>
    <section className="profile-data-rights" data-testid="profile-data-rights">
      <header><div><span>{textFor(t, 'Privacy rights', '隐私权利')}</span><h3>{textFor(t, 'Export and deletion', '导出与删除')}</h3></div><ShieldCheck size={19}/></header>
      <label><span>{textFor(t, `Confirm handle: ${profile.handle}`, `确认用户名：${profile.handle}`)}</span><input aria-label={textFor(t, 'Data rights identity confirmation', '数据权利身份确认')} value={identityConfirmation} onChange={(event) => setIdentityConfirmation(event.target.value)} autoComplete="off" /></label>
      <div className="profile-data-rights-actions">
        <button className="ghost-button" type="button" disabled={Boolean(busy) || !identityMatches} onClick={() => void createRightsRequest('data_export')}><FileArchive size={16}/>{busy === 'export' ? textFor(t, 'Requesting', '申请中') : textFor(t, 'Request export', '申请导出')}</button>
        <button className="ghost-button danger-button" type="button" disabled={Boolean(busy) || !identityMatches || Boolean(activeDeletion)} onClick={() => void createRightsRequest('account_deletion')}><Trash2 size={16}/>{busy === 'delete' ? textFor(t, 'Requesting', '申请中') : textFor(t, 'Request deletion', '申请删除')}</button>
      </div>
      {legacyDeletion && <div className="data-rights-legacy"><span>{textFor(t, 'Legacy deletion request', '旧版删除申请')} · {formatDate(profile.account.deletionScheduledAt)}</span><button className="ghost-button" type="button" disabled={Boolean(busy)} onClick={() => void cancelLegacyDeletion()}><Undo2 size={16}/>{textFor(t, 'Cancel legacy request', '取消旧版申请')}</button></div>}
      <div className="data-rights-history">
        {requests.length === 0 && <p>{textFor(t, 'No data rights requests.', '暂无数据权利请求。')}</p>}
        {requests.map((request) => <article key={request.id}>
          <div><strong>{request.requestType.replaceAll('_', ' ')}</strong><span className={`status-badge ${request.status === 'completed' ? 'success' : request.status === 'blocked' ? 'danger' : ''}`}>{request.status.replaceAll('_', ' ')}</span></div>
          <small>{textFor(t, 'Due', '到期')} {formatDate(request.dueAt)} · v{request.version}</small>
          <div>
            {request.requestType === 'data_export' && request.status === 'completed' && request.artifact && <button className="icon-button" type="button" title={textFor(t, 'Download export', '下载导出')} aria-label={textFor(t, 'Download export', '下载导出')} disabled={Boolean(busy)} onClick={() => void downloadExport(request)}><Download size={16}/></button>}
            {['identity_verified', 'blocked'].includes(request.status) && <button className="icon-button" type="button" title={textFor(t, 'Cancel request', '取消请求')} aria-label={textFor(t, 'Cancel request', '取消请求')} disabled={Boolean(busy)} onClick={() => void cancelRightsRequest(request)}><Undo2 size={16}/></button>}
          </div>
        </article>)}
      </div>
    </section>
  </section>
}
