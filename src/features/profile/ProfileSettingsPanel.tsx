import { useEffect, useState } from 'react'
import { Eye, EyeOff, LoaderCircle, Save, Trash2, Undo2 } from 'lucide-react'

import type { MarketplaceProfile } from '../../domain/types'
import { isZhCopy, localizeText, textFor } from '../../domain/utils'
import type { ApiOwnProfile } from '../../services/contracts'
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
  const [busy, setBusy] = useState<'save' | 'delete' | 'cancel' | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    profileService.own()
      .then((result) => {
        if (!active) return
        setProfile(result)
        setDraft(draftFor(result, t))
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

  const requestDeletion = async () => {
    if (!profile || !window.confirm(textFor(t, 'Schedule this account for deletion?', '确认提交账号删除申请？'))) return
    setBusy('delete')
    setError('')
    try {
      const account = await profileService.requestAccountDeletion({ expectedVersion: profile.account.version, reasonCode: 'owner_requested' })
      setProfile({ ...profile, account })
    } catch (cause) {
      setError(errorMessage(cause, textFor(t, 'Could not request account deletion.', '无法提交账号删除申请。')))
    } finally {
      setBusy(null)
    }
  }

  const cancelDeletion = async () => {
    if (!profile) return
    setBusy('cancel')
    setError('')
    try {
      const account = await profileService.cancelAccountDeletion({ expectedVersion: profile.account.version, reasonCode: 'owner_cancelled' })
      setProfile({ ...profile, account })
    } catch (cause) {
      setError(errorMessage(cause, textFor(t, 'Could not cancel account deletion.', '无法取消账号删除申请。')))
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <section className="panel profile-settings-panel"><LoaderCircle className="spin" size={18}/></section>
  if (!profile || !draft) return <section className="panel profile-settings-panel"><div className="inline-alert error">{error}</div></section>

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
      {profile.account.status === 'deletion_requested' ? <>
        <span>{new Date(profile.account.deletionScheduledAt ?? '').toLocaleDateString(isZh ? 'zh-CN' : 'en-US')}</span>
        <button className="ghost-button" type="button" onClick={() => void cancelDeletion()} disabled={Boolean(busy)}><Undo2 size={16}/>{textFor(t, 'Cancel deletion', '取消删除')}</button>
      </> : <button className="ghost-button danger-button" type="button" onClick={() => void requestDeletion()} disabled={Boolean(busy)}><Trash2 size={16}/>{textFor(t, 'Request deletion', '申请删除')}</button>}
    </div>
  </section>
}
