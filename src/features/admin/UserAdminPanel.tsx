import { useCallback, useEffect, useMemo, useState } from 'react'
import { Archive, ArchiveRestore, Ban, ChevronRight, Download, Plus, RefreshCw, RotateCcw, Save, Search, Tag, X } from 'lucide-react'

import { SectionHeader } from '../../components/ui/SectionHeader'
import type { Role } from '../../domain/types'
import { textFor } from '../../domain/utils'
import { adminService } from '../../services/adminService'
import type { AdminUserDto, AdminUserMetrics, AdminUserStatus, AdminUserTag, AdminUserTagColor } from '../../services/contracts'

type Props = {
  t: Record<string, string>
  canRead: boolean
  canManage: boolean
  notify: (message: string) => void
}

const roles: Role[] = ['member', 'creator', 'publisher', 'moderator', 'admin']
const statuses: AdminUserStatus[] = ['active', 'suspended', 'deleted']
const colors: AdminUserTagColor[] = ['gray', 'blue', 'green', 'yellow', 'orange', 'red', 'purple', 'pink']
const dayMs = 24 * 60 * 60 * 1000
const dateInput = (value: Date) => value.toISOString().slice(0, 10)
const initialDateTo = dateInput(new Date())
const initialDateFrom = dateInput(new Date(Date.now() - 30 * dayMs))
const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback
const formatDate = (value: string | null) => value ? new Date(value).toLocaleString() : '-'
const metricQuery = (dateFrom: string, dateTo: string) => ({
  dateFrom: new Date(`${dateFrom}T00:00:00.000Z`).toISOString(),
  dateTo: new Date(new Date(`${dateTo}T00:00:00.000Z`).getTime() + dayMs).toISOString(),
})

const downloadJson = (document: unknown) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }))
  const link = window.document.createElement('a')
  link.href = url
  link.download = `user-lifecycle-metrics-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  URL.revokeObjectURL(url)
}

export function UserAdminPanel({ t, canRead, canManage, notify }: Props) {
  const [users, setUsers] = useState<AdminUserDto[]>([])
  const [selected, setSelected] = useState<AdminUserDto | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<AdminUserStatus | ''>('')
  const [role, setRole] = useState<Role | ''>('')
  const [tagFilter, setTagFilter] = useState('')
  const [sort, setSort] = useState<'createdAt' | 'updatedAt' | 'displayName'>('updatedAt')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')
  const [reasonCode, setReasonCode] = useState('operator_requested')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [metrics, setMetrics] = useState<AdminUserMetrics | null>(null)
  const [dateFrom, setDateFrom] = useState(initialDateFrom)
  const [dateTo, setDateTo] = useState(initialDateTo)
  const [metricsBusy, setMetricsBusy] = useState(false)

  const [tags, setTags] = useState<AdminUserTag[]>([])
  const [tagStatus, setTagStatus] = useState<'active' | 'archived' | 'all'>('active')
  const [selectedTagId, setSelectedTagId] = useState('')
  const [tagKey, setTagKey] = useState('')
  const [tagLabel, setTagLabel] = useState('')
  const [tagDescription, setTagDescription] = useState('')
  const [tagColor, setTagColor] = useState<AdminUserTagColor>('gray')
  const selectedTag = tags.find((item) => item.id === selectedTagId) ?? null
  const activeTags = useMemo(() => tags.filter((item) => !item.archivedAt), [tags])

  const load = useCallback(async (append = false) => {
    if (!canRead) return
    setLoading(true)
    setError('')
    try {
      const page = await adminService.users({
        search: search.trim() || undefined,
        status: status || undefined,
        role: role || undefined,
        tag: tagFilter || undefined,
        sort,
        order,
        cursor: append ? nextCursor ?? undefined : undefined,
        limit: 20,
      })
      setUsers((current) => append ? [...current, ...page.items] : page.items)
      setNextCursor(page.nextCursor)
      if (!append && selected && !page.items.some((user) => user.id === selected.id)) setSelected(null)
    } catch (loadError) {
      setError(errorMessage(loadError, textFor(t, 'Could not load users.', '无法读取用户。')))
    } finally {
      setLoading(false)
    }
  }, [canRead, nextCursor, order, role, search, selected, sort, status, tagFilter, t])

  const loadMetrics = useCallback(async () => {
    if (!canRead) return
    setMetricsBusy(true)
    setError('')
    try {
      setMetrics(await adminService.userMetrics(metricQuery(dateFrom, dateTo)))
    } catch (loadError) {
      setError(errorMessage(loadError, textFor(t, 'Could not load user metrics.', '无法读取用户统计。')))
    } finally {
      setMetricsBusy(false)
    }
  }, [canRead, dateFrom, dateTo, t])

  const loadTags = useCallback(async (statusOverride = tagStatus) => {
    if (!canRead) return
    setError('')
    try {
      const nextTags = await adminService.userTags({ status: statusOverride })
      setTags(nextTags)
      if (selectedTagId && !nextTags.some((item) => item.id === selectedTagId)) setSelectedTagId('')
    } catch (loadError) {
      setError(errorMessage(loadError, textFor(t, 'Could not load user tags.', '无法读取用户标签。')))
    }
  }, [canRead, selectedTagId, t, tagStatus])

  useEffect(() => {
    if (!canRead) return
    let active = true
    Promise.all([
      adminService.users({ limit: 20, sort: 'updatedAt', order: 'desc' }),
      adminService.userMetrics(metricQuery(initialDateFrom, initialDateTo)),
      adminService.userTags({ status: 'active' }),
    ]).then(([page, nextMetrics, nextTags]) => {
      if (!active) return
      setUsers(page.items)
      setNextCursor(page.nextCursor)
      setMetrics(nextMetrics)
      setTags(nextTags)
    }).catch((loadError) => {
      if (active) setError(errorMessage(loadError, textFor(t, 'Could not load user operations.', '无法读取用户运营数据。')))
    })
    return () => { active = false }
  }, [canRead, t])

  const selectUser = async (user: AdminUserDto) => {
    setSelected(user)
    setError('')
    try { setSelected(await adminService.user(user.id)) } catch (detailError) { setError(errorMessage(detailError, textFor(t, 'Could not load user detail.', '无法读取用户详情。'))) }
  }

  const replaceUser = (user: AdminUserDto) => {
    setUsers((current) => current.map((item) => item.id === user.id ? user : item))
    setSelected(user)
  }

  const transition = async (action: 'suspend' | 'restore') => {
    if (!canManage || !selected) return
    const prompt = action === 'suspend'
      ? textFor(t, 'Suspend this user and revoke every active session?', '暂停该用户并撤销全部活跃会话？')
      : textFor(t, 'Restore this user without restoring old sessions?', '恢复该用户，但不恢复旧会话？')
    if (!window.confirm(prompt)) return
    setBusy(true)
    setError('')
    try {
      const payload = { expectedVersion: selected.version, reasonCode: reasonCode.trim() || 'operator_requested' }
      const result = action === 'suspend' ? await adminService.suspendUser(selected.id, payload) : await adminService.restoreUser(selected.id, payload)
      replaceUser(result.user)
      notify(action === 'suspend'
        ? textFor(t, `User suspended; ${result.revokedSessions ?? 0} sessions revoked.`, `用户已暂停，撤销 ${result.revokedSessions ?? 0} 个会话。`)
        : textFor(t, 'User restored. Old sessions remain revoked.', '用户已恢复，旧会话仍保持撤销。'))
    } catch (actionError) {
      setError(errorMessage(actionError, textFor(t, 'Could not update user status.', '无法更新用户状态。')))
      try { replaceUser(await adminService.user(selected.id)) } catch { /* preserve the actionable error */ }
    } finally { setBusy(false) }
  }

  const clearTagDraft = () => {
    setSelectedTagId('')
    setTagKey('')
    setTagLabel('')
    setTagDescription('')
    setTagColor('gray')
  }

  const editTag = (tag: AdminUserTag) => {
    setSelectedTagId(tag.id)
    setTagKey(tag.key)
    setTagLabel(tag.label)
    setTagDescription(tag.description ?? '')
    setTagColor(tag.color)
  }

  const saveTag = async () => {
    if (!canManage) return
    setBusy(true)
    setError('')
    try {
      const reason = reasonCode.trim() || 'operator_requested'
      const tag = selectedTag
        ? await adminService.updateUserTag(selectedTag.id, { label: tagLabel.trim(), description: tagDescription.trim() || null, color: tagColor, expectedVersion: selectedTag.version, reasonCode: reason })
        : await adminService.createUserTag({ key: tagKey.trim(), label: tagLabel.trim(), description: tagDescription.trim() || null, color: tagColor, reasonCode: reason })
      setTags((current) => selectedTag ? current.map((item) => item.id === tag.id ? tag : item) : [...current, tag].sort((left, right) => left.label.localeCompare(right.label)))
      editTag(tag)
      notify(textFor(t, 'User tag saved.', '用户标签已保存。'))
    } catch (actionError) {
      setError(errorMessage(actionError, textFor(t, 'Could not save user tag.', '无法保存用户标签。')))
      await loadTags()
    } finally { setBusy(false) }
  }

  const transitionTag = async (action: 'archive' | 'restore') => {
    if (!canManage || !selectedTag || !window.confirm(textFor(t, `${action === 'archive' ? 'Archive' : 'Restore'} ${selectedTag.label}?`, `${action === 'archive' ? '归档' : '恢复'} ${selectedTag.label}？`))) return
    setBusy(true)
    setError('')
    try {
      const payload = { expectedVersion: selectedTag.version, reasonCode: reasonCode.trim() || 'operator_requested' }
      const tag = action === 'archive' ? await adminService.archiveUserTag(selectedTag.id, payload) : await adminService.restoreUserTag(selectedTag.id, payload)
      setTags((current) => current.map((item) => item.id === tag.id ? tag : item))
      editTag(tag)
      notify(textFor(t, `User tag ${action}d.`, `用户标签已${action === 'archive' ? '归档' : '恢复'}。`))
    } catch (actionError) {
      setError(errorMessage(actionError, textFor(t, 'Could not change user tag status.', '无法更新用户标签状态。')))
      await loadTags()
    } finally { setBusy(false) }
  }

  const changeAssignment = async (tag: AdminUserTag, action: 'assign' | 'remove') => {
    if (!canManage || !selected) return
    setBusy(true)
    setError('')
    try {
      const payload = { expectedUserVersion: selected.version, reasonCode: reasonCode.trim() || 'operator_requested' }
      const result = action === 'assign' ? await adminService.assignUserTag(selected.id, tag.id, payload) : await adminService.removeUserTag(selected.id, tag.id, payload)
      replaceUser(result.user)
      await Promise.all([loadTags(), loadMetrics()])
      notify(textFor(t, `User tag ${action === 'assign' ? 'assigned' : 'removed'}.`, `用户标签已${action === 'assign' ? '分配' : '移除'}。`))
    } catch (actionError) {
      setError(errorMessage(actionError, textFor(t, 'Could not change user tags.', '无法更新用户标签。')))
      try { replaceUser(await adminService.user(selected.id)) } catch { /* preserve the actionable error */ }
    } finally { setBusy(false) }
  }

  const exportMetrics = async () => {
    setMetricsBusy(true)
    try {
      downloadJson(await adminService.exportUserMetrics(metricQuery(dateFrom, dateTo)))
      notify(textFor(t, 'User lifecycle metrics exported.', '用户生命周期统计已导出。'))
    } catch (exportError) {
      setError(errorMessage(exportError, textFor(t, 'Could not export user metrics.', '无法导出用户统计。')))
    } finally { setMetricsBusy(false) }
  }

  if (!canRead) return null

  return (
    <section className="panel user-admin-panel" data-testid="user-admin-panel">
      <SectionHeader
        eyebrow={textFor(t, 'Personal accounts', '个人账户')}
        title={textFor(t, 'User lifecycle operations', '用户生命周期运营')}
        action={<button className="icon-button" type="button" title={textFor(t, 'Refresh users', '刷新用户')} aria-label={textFor(t, 'Refresh users', '刷新用户')} onClick={() => void Promise.all([load(false), loadMetrics(), loadTags()])} disabled={loading || metricsBusy}><RefreshCw size={17} /></button>}
      />

      <section className="user-lifecycle-section" data-testid="user-lifecycle-metrics">
        <header className="user-lifecycle-header"><div><strong>{textFor(t, 'User lifecycle metrics', '用户生命周期统计')}</strong><span>{metrics ? `${new Date(metrics.window.dateFrom).toLocaleDateString()} - ${new Date(metrics.window.dateTo).toLocaleDateString()}` : '-'}</span></div><div className="button-row"><label><span>{textFor(t, 'From', '开始')}</span><input aria-label={textFor(t, 'Metrics date from', '统计开始日期')} type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label><span>{textFor(t, 'To', '结束')}</span><input aria-label={textFor(t, 'Metrics date to', '统计结束日期')} type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label><button className="icon-button" type="button" title={textFor(t, 'Apply metrics window', '应用统计时间范围')} aria-label={textFor(t, 'Apply metrics window', '应用统计时间范围')} onClick={() => void loadMetrics()} disabled={metricsBusy}><RefreshCw size={16}/></button><button className="icon-button" type="button" title={textFor(t, 'Export user metrics', '导出用户统计')} aria-label={textFor(t, 'Export user metrics', '导出用户统计')} onClick={() => void exportMetrics()} disabled={metricsBusy}><Download size={16}/></button></div></header>
        <div className="user-metric-grid">
          {[
            [textFor(t, 'Accounts', '账户'), metrics?.totals.currentAccounts ?? 0],
            [textFor(t, 'New', '新增'), metrics?.totals.newUsers ?? 0],
            [textFor(t, 'Active', '活跃'), metrics?.totals.activeUsers ?? 0],
            [textFor(t, 'Tagged', '已标签'), metrics?.totals.taggedUsers ?? 0],
          ].map(([label, value]) => <div key={String(label)}><span>{label}</span><strong>{value}</strong></div>)}
          {(['d1', 'd7', 'd30'] as const).map((window) => <div key={window}><span>{window.toUpperCase()}</span><strong>{metrics?.retention[window].ratePercent ?? 0}%</strong><small>{metrics?.retention[window].retained ?? 0}/{metrics?.retention[window].eligible ?? 0}</small></div>)}
        </div>
        <div className="user-metric-breakdown"><span>{roles.map((item) => `${item} ${metrics?.roles[item] ?? 0}`).join(' · ')}</span><span>{statuses.map((item) => `${item} ${metrics?.statuses[item] ?? 0}`).join(' · ')}</span></div>
      </section>

      <section className="user-lifecycle-section" data-testid="user-tag-operations">
        <header className="user-lifecycle-header"><div><strong>{textFor(t, 'User tags', '用户标签')}</strong><span>{tags.length}</span></div><div className="button-row"><select aria-label={textFor(t, 'User tag status', '用户标签状态')} value={tagStatus} onChange={(event) => { const nextStatus = event.target.value as typeof tagStatus; setTagStatus(nextStatus); void loadTags(nextStatus) }}><option value="active">active</option><option value="archived">archived</option><option value="all">all</option></select><button className="icon-button" type="button" title={textFor(t, 'Create user tag', '新建用户标签')} aria-label={textFor(t, 'Create user tag', '新建用户标签')} onClick={clearTagDraft} disabled={!canManage}><Plus size={16}/></button></div></header>
        <div className="user-tag-workspace">
          <div className="user-tag-list">
            {tags.map((item) => <button className={item.id === selectedTagId ? 'user-tag-row selected' : 'user-tag-row'} type="button" key={item.id} onClick={() => editTag(item)}><span className={`user-tag-swatch ${item.color}`} /><span><strong>{item.label}</strong><small>{item.key}</small></span><span>{item.assignmentCount ?? 0}</span></button>)}
            {!tags.length && <div className="empty-state"><strong>{textFor(t, 'No user tags', '暂无用户标签')}</strong></div>}
          </div>
          <div className="user-tag-editor">
            <label><span>{textFor(t, 'Key', '标识')}</span><input aria-label={textFor(t, 'User tag key', '用户标签标识')} value={tagKey} onChange={(event) => setTagKey(event.target.value)} disabled={!canManage || Boolean(selectedTag)} /></label>
            <label><span>{textFor(t, 'Label', '名称')}</span><input aria-label={textFor(t, 'User tag label', '用户标签名称')} value={tagLabel} onChange={(event) => setTagLabel(event.target.value)} disabled={!canManage || Boolean(selectedTag?.archivedAt)} /></label>
            <label><span>{textFor(t, 'Description', '说明')}</span><input aria-label={textFor(t, 'User tag description', '用户标签说明')} value={tagDescription} onChange={(event) => setTagDescription(event.target.value)} disabled={!canManage || Boolean(selectedTag?.archivedAt)} /></label>
            <label><span>{textFor(t, 'Color', '颜色')}</span><select aria-label={textFor(t, 'User tag color', '用户标签颜色')} value={tagColor} onChange={(event) => setTagColor(event.target.value as AdminUserTagColor)} disabled={!canManage || Boolean(selectedTag?.archivedAt)}>{colors.map((color) => <option key={color}>{color}</option>)}</select></label>
            <div className="button-row"><button className="primary-button small" type="button" onClick={() => void saveTag()} disabled={!canManage || busy || !tagLabel.trim() || (!selectedTag && !tagKey.trim()) || Boolean(selectedTag?.archivedAt)}><Save size={15}/>{textFor(t, 'Save', '保存')}</button>{selectedTag && <button className="icon-button" type="button" title={selectedTag.archivedAt ? textFor(t, 'Restore user tag', '恢复用户标签') : textFor(t, 'Archive user tag', '归档用户标签')} aria-label={selectedTag.archivedAt ? textFor(t, 'Restore user tag', '恢复用户标签') : textFor(t, 'Archive user tag', '归档用户标签')} onClick={() => void transitionTag(selectedTag.archivedAt ? 'restore' : 'archive')} disabled={!canManage || busy}>{selectedTag.archivedAt ? <ArchiveRestore size={16}/> : <Archive size={16}/>}</button>}</div>
          </div>
        </div>
      </section>

      <div className="user-admin-filters">
        <label className="user-admin-search"><span>{textFor(t, 'Search', '搜索')}</span><div><Search size={16} /><input aria-label={textFor(t, 'User search', '用户搜索')} value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void load(false) }} /></div></label>
        <label><span>{textFor(t, 'Status', '状态')}</span><select aria-label={textFor(t, 'User status', '用户状态')} value={status} onChange={(event) => setStatus(event.target.value as AdminUserStatus | '')}><option value="">{textFor(t, 'All', '全部')}</option>{statuses.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>{textFor(t, 'Role', '角色')}</span><select aria-label={textFor(t, 'User role', '用户角色')} value={role} onChange={(event) => setRole(event.target.value as Role | '')}><option value="">{textFor(t, 'All', '全部')}</option>{roles.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>{textFor(t, 'Tag', '标签')}</span><select aria-label={textFor(t, 'User tag filter', '用户标签筛选')} value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}><option value="">{textFor(t, 'All', '全部')}</option>{activeTags.map((item) => <option value={item.key} key={item.id}>{item.label}</option>)}</select></label>
        <label><span>{textFor(t, 'Sort', '排序')}</span><select aria-label={textFor(t, 'User sort', '用户排序')} value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="updatedAt">updatedAt</option><option value="createdAt">createdAt</option><option value="displayName">displayName</option></select></label>
        <label><span>{textFor(t, 'Order', '顺序')}</span><select aria-label={textFor(t, 'User order', '用户顺序')} value={order} onChange={(event) => setOrder(event.target.value as 'asc' | 'desc')}><option value="desc">desc</option><option value="asc">asc</option></select></label>
        <button className="icon-button" type="button" title={textFor(t, 'Apply user filters', '应用用户筛选')} aria-label={textFor(t, 'Apply user filters', '应用用户筛选')} onClick={() => void load(false)} disabled={loading}><Search size={16} /></button>
      </div>
      {error && <div className="user-admin-error">{error}</div>}
      <div className="user-admin-workspace">
        <div className="user-admin-list">
          {users.map((user) => (
            <button className={selected?.id === user.id ? 'user-admin-row selected' : 'user-admin-row'} type="button" key={user.id} onClick={() => void selectUser(user)}>
              <span><strong>{user.handle ? `@${user.handle}` : user.displayName}</strong><small>{user.email ?? user.id}</small>{user.tags.length > 0 && <span className="user-row-tags">{user.tags.slice(0, 2).map((item) => <span key={item.id}><i className={`user-tag-swatch ${item.color}`}/>{item.label}</span>)}</span>}</span>
              <span><span className={`status-badge ${user.status === 'active' ? 'success' : user.status === 'suspended' ? 'warning' : 'danger'}`}>{user.status}</span><small>{user.role}</small></span>
              <ChevronRight size={16} />
            </button>
          ))}
          {!loading && !users.length && <div className="empty-state"><strong>{textFor(t, 'No users found', '未找到用户')}</strong></div>}
          {nextCursor && <button className="ghost-button" type="button" onClick={() => void load(true)} disabled={loading}>{textFor(t, 'Load more', '加载更多')}</button>}
        </div>
        <div className="user-admin-detail">
          {!selected ? <div className="empty-state"><strong>{textFor(t, 'Select a user', '选择用户')}</strong></div> : <>
            <div className="user-admin-detail-head"><div><strong>{selected.displayName}</strong><span>{selected.handle ? `@${selected.handle}` : selected.id}</span></div><span className={`status-badge ${selected.status === 'active' ? 'success' : selected.status === 'suspended' ? 'warning' : 'danger'}`}>{selected.status}</span></div>
            <dl className="user-admin-facts">
              <div><dt>{textFor(t, 'Email', '邮箱')}</dt><dd>{selected.email ?? '-'}</dd></div><div><dt>{textFor(t, 'Role', '角色')}</dt><dd>{selected.role}</dd></div><div><dt>{textFor(t, 'Auth methods', '认证方式')}</dt><dd>{selected.authMethods.join(', ') || '-'}</dd></div><div><dt>{textFor(t, 'Active sessions', '活跃会话')}</dt><dd>{selected.activeSessionCount}</dd></div><div><dt>{textFor(t, 'Profile', '资料')}</dt><dd>{selected.profile ? `${selected.profile.visibility} / ${selected.profile.discoverable ? 'discoverable' : 'hidden'}` : '-'}</dd></div><div><dt>{textFor(t, 'Version', '版本')}</dt><dd>v{selected.version}</dd></div><div><dt>{textFor(t, 'Suspended', '暂停时间')}</dt><dd>{formatDate(selected.suspendedAt)}</dd></div><div><dt>{textFor(t, 'Deletion scheduled', '删除计划')}</dt><dd>{formatDate(selected.deletionScheduledAt)}</dd></div>
            </dl>
            <div className="user-assignment-block"><strong><Tag size={15}/>{textFor(t, 'User tags', '用户标签')}</strong><div className="user-assigned-tags">{selected.tags.map((item) => <span key={item.id}><i className={`user-tag-swatch ${item.color}`}/>{item.label}<button type="button" title={textFor(t, `Remove ${item.label}`, `移除 ${item.label}`)} aria-label={textFor(t, `Remove ${item.label}`, `移除 ${item.label}`)} onClick={() => void changeAssignment(item, 'remove')} disabled={!canManage || busy}><X size={13}/></button></span>)}{!selected.tags.length && <small>{textFor(t, 'No tags assigned', '未分配标签')}</small>}</div><select aria-label={textFor(t, 'Assign user tag', '分配用户标签')} value="" onChange={(event) => { const tag = activeTags.find((item) => item.id === event.target.value); if (tag) void changeAssignment(tag, 'assign') }} disabled={!canManage || busy || selected.status === 'deleted'}><option value="">{textFor(t, 'Assign tag', '分配标签')}</option>{activeTags.filter((item) => !selected.tags.some((assigned) => assigned.id === item.id)).map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></div>
            {selected.suspensionReasonCode && <div className="user-admin-evidence"><span>{textFor(t, 'Suspension reason', '暂停原因')}</span><strong>{selected.suspensionReasonCode}</strong></div>}
            <label className="user-admin-reason"><span>{textFor(t, 'Reason code', '原因代码')}</span><input aria-label={textFor(t, 'User lifecycle reason code', '用户生命周期原因代码')} value={reasonCode} onChange={(event) => setReasonCode(event.target.value)} disabled={!canManage || busy} /></label>
            <div className="button-row">{selected.status === 'active' && <button className="danger-button" type="button" onClick={() => void transition('suspend')} disabled={!canManage || busy}><Ban size={16} />{textFor(t, 'Suspend', '暂停')}</button>}{selected.status === 'suspended' && <button className="primary-button" type="button" onClick={() => void transition('restore')} disabled={!canManage || busy}><RotateCcw size={16} />{textFor(t, 'Restore', '恢复')}</button>}</div>
          </>}
        </div>
      </div>
    </section>
  )
}
