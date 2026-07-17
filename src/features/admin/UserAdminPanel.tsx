import { useCallback, useEffect, useState } from 'react'
import { Ban, ChevronRight, RefreshCw, RotateCcw, Search } from 'lucide-react'

import { SectionHeader } from '../../components/ui/SectionHeader'
import type { Role } from '../../domain/types'
import { textFor } from '../../domain/utils'
import { adminService } from '../../services/adminService'
import type { AdminUserDto, AdminUserStatus } from '../../services/contracts'

type Props = {
  t: Record<string, string>
  canRead: boolean
  canManage: boolean
  notify: (message: string) => void
}

const roles: Role[] = ['member', 'creator', 'publisher', 'moderator', 'admin']
const statuses: AdminUserStatus[] = ['active', 'suspended', 'deleted']
const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback
const formatDate = (value: string | null) => value ? new Date(value).toLocaleString() : '-'

export function UserAdminPanel({ t, canRead, canManage, notify }: Props) {
  const [users, setUsers] = useState<AdminUserDto[]>([])
  const [selected, setSelected] = useState<AdminUserDto | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<AdminUserStatus | ''>('')
  const [role, setRole] = useState<Role | ''>('')
  const [sort, setSort] = useState<'createdAt' | 'updatedAt' | 'displayName'>('updatedAt')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')
  const [reasonCode, setReasonCode] = useState('operator_requested')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (append = false) => {
    if (!canRead) return
    setLoading(true)
    setError('')
    try {
      const page = await adminService.users({
        search: search.trim() || undefined,
        status: status || undefined,
        role: role || undefined,
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
  }, [canRead, nextCursor, order, role, search, selected, sort, status, t])

  useEffect(() => {
    if (!canRead) return
    let active = true
    adminService.users({ limit: 20, sort: 'updatedAt', order: 'desc' })
      .then((page) => {
        if (!active) return
        setUsers(page.items)
        setNextCursor(page.nextCursor)
      })
      .catch((loadError) => { if (active) setError(errorMessage(loadError, textFor(t, 'Could not load users.', '无法读取用户。'))) })
    return () => { active = false }
  }, [canRead, t])

  const selectUser = async (user: AdminUserDto) => {
    setSelected(user)
    setError('')
    try {
      setSelected(await adminService.user(user.id))
    } catch (detailError) {
      setError(errorMessage(detailError, textFor(t, 'Could not load user detail.', '无法读取用户详情。')))
    }
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
      const result = action === 'suspend'
        ? await adminService.suspendUser(selected.id, payload)
        : await adminService.restoreUser(selected.id, payload)
      replaceUser(result.user)
      notify(action === 'suspend'
        ? textFor(t, `User suspended; ${result.revokedSessions ?? 0} sessions revoked.`, `用户已暂停，撤销 ${result.revokedSessions ?? 0} 个会话。`)
        : textFor(t, 'User restored. Old sessions remain revoked.', '用户已恢复，旧会话仍保持撤销。'))
    } catch (actionError) {
      setError(errorMessage(actionError, textFor(t, 'Could not update user status.', '无法更新用户状态。')))
      try { replaceUser(await adminService.user(selected.id)) } catch { /* preserve the actionable error */ }
    } finally {
      setBusy(false)
    }
  }

  if (!canRead) return null

  return (
    <section className="panel user-admin-panel" data-testid="user-admin-panel">
      <SectionHeader
        eyebrow={textFor(t, 'Personal accounts', '个人账户')}
        title={textFor(t, 'User lifecycle operations', '用户生命周期运营')}
        action={<button className="icon-button" type="button" title={textFor(t, 'Refresh users', '刷新用户')} aria-label={textFor(t, 'Refresh users', '刷新用户')} onClick={() => void load(false)} disabled={loading}><RefreshCw size={17} /></button>}
      />
      <div className="user-admin-filters">
        <label className="user-admin-search"><span>{textFor(t, 'Search', '搜索')}</span><div><Search size={16} /><input aria-label={textFor(t, 'User search', '用户搜索')} value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void load(false) }} /></div></label>
        <label><span>{textFor(t, 'Status', '状态')}</span><select aria-label={textFor(t, 'User status', '用户状态')} value={status} onChange={(event) => setStatus(event.target.value as AdminUserStatus | '')}><option value="">{textFor(t, 'All', '全部')}</option>{statuses.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>{textFor(t, 'Role', '角色')}</span><select aria-label={textFor(t, 'User role', '用户角色')} value={role} onChange={(event) => setRole(event.target.value as Role | '')}><option value="">{textFor(t, 'All', '全部')}</option>{roles.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>{textFor(t, 'Sort', '排序')}</span><select aria-label={textFor(t, 'User sort', '用户排序')} value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="updatedAt">updatedAt</option><option value="createdAt">createdAt</option><option value="displayName">displayName</option></select></label>
        <label><span>{textFor(t, 'Order', '顺序')}</span><select aria-label={textFor(t, 'User order', '用户顺序')} value={order} onChange={(event) => setOrder(event.target.value as 'asc' | 'desc')}><option value="desc">desc</option><option value="asc">asc</option></select></label>
        <button className="icon-button" type="button" title={textFor(t, 'Apply user filters', '应用用户筛选')} aria-label={textFor(t, 'Apply user filters', '应用用户筛选')} onClick={() => void load(false)} disabled={loading}><Search size={16} /></button>
      </div>
      {error && <div className="user-admin-error">{error}</div>}
      <div className="user-admin-workspace">
        <div className="user-admin-list">
          {users.map((user) => (
            <button className={selected?.id === user.id ? 'user-admin-row selected' : 'user-admin-row'} type="button" key={user.id} onClick={() => void selectUser(user)}>
              <span><strong>{user.handle ? `@${user.handle}` : user.displayName}</strong><small>{user.email ?? user.id}</small></span>
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
              <div><dt>{textFor(t, 'Email', '邮箱')}</dt><dd>{selected.email ?? '-'}</dd></div>
              <div><dt>{textFor(t, 'Role', '角色')}</dt><dd>{selected.role}</dd></div>
              <div><dt>{textFor(t, 'Auth methods', '认证方式')}</dt><dd>{selected.authMethods.join(', ') || '-'}</dd></div>
              <div><dt>{textFor(t, 'Active sessions', '活跃会话')}</dt><dd>{selected.activeSessionCount}</dd></div>
              <div><dt>{textFor(t, 'Profile', '资料')}</dt><dd>{selected.profile ? `${selected.profile.visibility} / ${selected.profile.discoverable ? 'discoverable' : 'hidden'}` : '-'}</dd></div>
              <div><dt>{textFor(t, 'Version', '版本')}</dt><dd>v{selected.version}</dd></div>
              <div><dt>{textFor(t, 'Suspended', '暂停时间')}</dt><dd>{formatDate(selected.suspendedAt)}</dd></div>
              <div><dt>{textFor(t, 'Deletion scheduled', '删除计划')}</dt><dd>{formatDate(selected.deletionScheduledAt)}</dd></div>
            </dl>
            {selected.suspensionReasonCode && <div className="user-admin-evidence"><span>{textFor(t, 'Suspension reason', '暂停原因')}</span><strong>{selected.suspensionReasonCode}</strong></div>}
            <label className="user-admin-reason"><span>{textFor(t, 'Reason code', '原因代码')}</span><input aria-label={textFor(t, 'User lifecycle reason code', '用户生命周期原因代码')} value={reasonCode} onChange={(event) => setReasonCode(event.target.value)} disabled={!canManage || busy} /></label>
            <div className="button-row">
              {selected.status === 'active' && <button className="danger-button" type="button" onClick={() => void transition('suspend')} disabled={!canManage || busy}><Ban size={16} />{textFor(t, 'Suspend', '暂停')}</button>}
              {selected.status === 'suspended' && <button className="primary-button" type="button" onClick={() => void transition('restore')} disabled={!canManage || busy}><RotateCcw size={16} />{textFor(t, 'Restore', '恢复')}</button>}
            </div>
          </>}
        </div>
      </div>
    </section>
  )
}
