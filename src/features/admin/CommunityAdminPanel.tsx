import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, RefreshCw, RotateCcw, Save, Search, Trash2 } from 'lucide-react'
import type { Permission } from '../../domain/types'
import { SectionHeader } from '../../components/ui/SectionHeader'
import { adminService } from '../../services/adminService'
import { isApiClientError } from '../../services/apiClient'
import type { AdminCommunityBulkAction, AdminCommunityBulkPreview, AdminCommunityContent, AdminCommunityMetrics, AdminCommunityQuery, AdminCommunityTargetType } from '../../services/contracts'

const emptyMetrics: AdminCommunityMetrics = { window: { dateFrom: null, dateTo: null, category: null }, posts: { total: 0, active: 0, deleted: 0, hidden: 0 }, comments: { total: 0, active: 0, deleted: 0, hidden: 0 }, engagement: { likes: 0, views: 0, commentsPerActivePost: 0 }, health: { solved: 0, unanswered: 0 }, categories: {} }
const errorText = (error: unknown) => isApiClientError(error) ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : 'Unknown error'
const idempotencyKey = () => `community-${Date.now()}-${crypto.randomUUID()}`

export function CommunityAdminPanel({ hasPermission, isZh, notify }: { hasPermission: (permission: Permission) => boolean; isZh: boolean; notify: (message: string) => void }) {
  const canRead = hasPermission('admin:community:read')
  const canManage = hasPermission('admin:community:manage')
  const canExport = hasPermission('admin:community:export')
  const [targetType, setTargetType] = useState<AdminCommunityTargetType>('post')
  const [rows, setRows] = useState<AdminCommunityContent[]>([])
  const [selected, setSelected] = useState<AdminCommunityContent | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [metrics, setMetrics] = useState(emptyMetrics)
  const [search, setSearch] = useState('')
  const [deletionState, setDeletionState] = useState<'active' | 'deleted' | 'all'>('active')
  const [moderationState, setModerationState] = useState<'' | 'visible' | 'hidden'>('')
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc')
  const [reasonCode, setReasonCode] = useState('operator_requested')
  const [note, setNote] = useState('')
  const [draftTitle, setDraftTitle] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [draftCategory, setDraftCategory] = useState('')
  const [bulkAction, setBulkAction] = useState<AdminCommunityBulkAction>('delete')
  const [preview, setPreview] = useState<AdminCommunityBulkPreview | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadRequest = useRef(0)

  const query = useMemo<AdminCommunityQuery>(() => ({ search: search.trim() || null, deletionState, moderationState: moderationState || null, direction, sort: 'updatedAt', limit: 20 }), [deletionState, direction, moderationState, search])
  const load = useCallback(async (cursor: string | null = null, append = false) => {
    if (!canRead) return
    const requestId = ++loadRequest.current
    setBusy(true); setError(null)
    try {
      const [page, nextMetrics] = await Promise.all([adminService.communityContent(targetType, { ...query, cursor }), adminService.communityMetrics()])
      if (requestId !== loadRequest.current) return
      setRows((current) => append ? [...current, ...page.items] : page.items)
      setNextCursor(page.nextCursor); setMetrics(nextMetrics)
      if (!append) { setSelected(null); setSelectedIds([]); setPreview(null); setConfirmation('') }
    } catch (cause) { if (requestId === loadRequest.current) setError(errorText(cause)) } finally { if (requestId === loadRequest.current) setBusy(false) }
  }, [canRead, query, targetType])
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer) }, [load])

  const choose = async (row: AdminCommunityContent) => {
    setError(null)
    try {
      const detail = await adminService.communityDetail(targetType, row.id)
      setSelected(detail); setDraftTitle(detail.title ?? ''); setDraftBody(detail.body); setDraftCategory(detail.category ?? '')
    } catch (cause) { setError(errorText(cause)) }
  }
  const apply = async (operation: () => Promise<AdminCommunityContent>, message: string) => {
    setBusy(true); setError(null)
    try { const row = await operation(); setSelected(row); notify(message); await load() } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) }
  }
  const save = () => selected && apply(() => adminService.updateCommunityContent(targetType, selected.id, { expectedVersion: selected.version, reasonCode, note, body: draftBody, ...(targetType === 'post' ? { title: draftTitle, category: draftCategory } : {}) }), isZh ? '社区内容已更新。' : 'Community content updated.')
  const transition = (action: AdminCommunityBulkAction) => selected && apply(() => adminService.transitionCommunityContent(targetType, selected.id, action, { expectedVersion: selected.version, reasonCode, note }), action === 'delete' ? (isZh ? '内容已删除。' : 'Content deleted.') : (isZh ? '内容已恢复。' : 'Content restored.'))
  const previewBulk = async () => {
    setError(null)
    try { const result = await adminService.previewCommunityBulk(targetType, bulkAction, selectedIds); setPreview(result); setConfirmation('') } catch (cause) { setError(errorText(cause)) }
  }
  const executeBulk = async () => {
    if (!preview) return
    setBusy(true); setError(null)
    try {
      const result = await adminService.executeCommunityBulk({ targetType, action: bulkAction, targetIds: selectedIds, targetHash: preview.targetHash, confirmationText: confirmation, idempotencyKey: idempotencyKey(), reasonCode, note })
      notify(isZh ? `批量操作完成：成功 ${result.succeededCount}，跳过 ${result.skippedCount}。` : `Bulk completed: ${result.succeededCount} succeeded, ${result.skippedCount} skipped.`)
      await load()
    } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) }
  }
  const exportMetrics = async () => {
    try { const document = await adminService.exportCommunityMetrics(); const url = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' })); const link = window.document.createElement('a'); link.href = url; link.download = `community-metrics-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url) } catch (cause) { setError(errorText(cause)) }
  }
  const switchTarget = (next: AdminCommunityTargetType) => {
    setTargetType(next); setSearch(''); setDeletionState('active'); setModerationState(''); setSelected(null); setSelectedIds([]); setPreview(null); setConfirmation('')
  }

  if (!canRead) return <section className="panel task-admin-panel" data-testid="community-admin-panel"><div className="empty-state"><strong>{isZh ? '无社区管理权限' : 'Community access denied'}</strong></div></section>
  return <section className="panel task-admin-panel" data-testid="community-admin-panel">
    <SectionHeader eyebrow={isZh ? '社区运营' : 'Community operations'} title={isZh ? '内容与互动健康' : 'Content and engagement health'} action={<div className="action-row"><button className="icon-button" type="button" title={isZh ? '刷新' : 'Refresh'} aria-label={isZh ? '刷新' : 'Refresh'} onClick={() => void load()}><RefreshCw size={17}/></button>{canExport && <button className="icon-button" type="button" title={isZh ? '导出指标' : 'Export metrics'} aria-label={isZh ? '导出指标' : 'Export metrics'} onClick={() => void exportMetrics()}><Download size={17}/></button>}</div>}/>
    <div className="task-admin-metrics"><div><strong>{metrics.posts.active}</strong><span>{isZh ? '活跃帖子' : 'Active posts'}</span></div><div><strong>{metrics.comments.active}</strong><span>{isZh ? '活跃评论' : 'Active comments'}</span></div><div><strong>{metrics.engagement.likes}</strong><span>{isZh ? '点赞' : 'Likes'}</span></div><div><strong>{metrics.engagement.views}</strong><span>{isZh ? '浏览' : 'Views'}</span></div><div><strong>{metrics.posts.hidden + metrics.comments.hidden}</strong><span>{isZh ? 'Trust 隐藏' : 'Trust hidden'}</span></div></div>
    <div className="chip-row"><button type="button" className={targetType === 'post' ? 'chip active' : 'chip'} onClick={() => switchTarget('post')}>{isZh ? '帖子' : 'Posts'}</button><button type="button" className={targetType === 'comment' ? 'chip active' : 'chip'} onClick={() => switchTarget('comment')}>{isZh ? '评论' : 'Comments'}</button></div>
    <div className="task-admin-filters"><label className="task-admin-search"><span>{isZh ? '搜索' : 'Search'}</span><div><Search size={15}/><input aria-label={isZh ? '搜索' : 'Search'} value={search} onChange={(event) => setSearch(event.target.value)}/></div></label><label><span>{isZh ? '删除状态' : 'Deletion'}</span><select value={deletionState} onChange={(event) => setDeletionState(event.target.value as typeof deletionState)}><option value="active">active</option><option value="deleted">deleted</option><option value="all">all</option></select></label><label><span>Trust</span><select value={moderationState} onChange={(event) => setModerationState(event.target.value as typeof moderationState)}><option value="">all</option><option value="visible">visible</option><option value="hidden">hidden</option></select></label><label><span>{isZh ? '排序' : 'Order'}</span><select value={direction} onChange={(event) => setDirection(event.target.value as typeof direction)}><option value="desc">desc</option><option value="asc">asc</option></select></label><button className="icon-button" type="button" title={isZh ? '应用筛选' : 'Apply filters'} aria-label={isZh ? '应用筛选' : 'Apply filters'} onClick={() => void load()}><Search size={17}/></button></div>
    {error && <div className="task-admin-error">{error}</div>}
    <div className="task-admin-workspace"><div className="task-admin-list">{rows.map((row) => <div className={`task-admin-row ${selected?.id === row.id ? 'selected' : ''}`} key={row.id}><input type="checkbox" aria-label={`${isZh ? '选择' : 'Select'} ${row.title ?? row.id}`} checked={selectedIds.includes(row.id)} disabled={!canManage} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id))}/><button type="button" onClick={() => void choose(row)}><span><strong>{row.title ?? row.body.slice(0, 60)}</strong><small>{row.authorHandle ?? '-'} · {row.id}</small></span><span><small>{row.deletedAt ? 'deleted' : row.status ?? 'active'}</small><small>{row.moderationState}</small></span></button></div>)}{!busy && !rows.length && <div className="empty-state"><strong>{isZh ? '没有匹配内容' : 'No matching content'}</strong></div>}{nextCursor && <button className="ghost-button" type="button" onClick={() => void load(nextCursor, true)}>{isZh ? '加载更多' : 'Load more'}</button>}</div>
      <div className="task-admin-detail">{selected ? <><div className="task-admin-detail-head"><div><strong>{selected.title ?? selected.id}</strong><small>{selected.id} · v{selected.version} · {selected.moderationState}</small></div></div><div className="task-admin-form">{targetType === 'post' && <><label><span>{isZh ? '标题' : 'Title'}</span><input aria-label={isZh ? '标题' : 'Title'} value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)}/></label><label><span>{isZh ? '分类' : 'Category'}</span><input aria-label={isZh ? '分类' : 'Category'} value={draftCategory} onChange={(event) => setDraftCategory(event.target.value)}/></label></>}<label className="wide"><span>{isZh ? '正文' : 'Body'}</span><textarea aria-label={isZh ? '正文' : 'Body'} value={draftBody} onChange={(event) => setDraftBody(event.target.value)}/></label></div><div className="task-admin-reason"><label><span>{isZh ? '原因码' : 'Reason code'}</span><input aria-label={isZh ? '原因码' : 'Reason code'} value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}/></label><label><span>{isZh ? '备注' : 'Note'}</span><input aria-label={isZh ? '备注' : 'Note'} value={note} onChange={(event) => setNote(event.target.value)}/></label></div>{canManage && <div className="action-row task-admin-actions"><button className="primary-button" type="button" disabled={busy} onClick={() => void save()}><Save size={16}/>{isZh ? '保存' : 'Save'}</button>{selected.deletedAt || selected.status === 'deleted' ? <button className="ghost-button" type="button" disabled={busy} onClick={() => void transition('restore')}><RotateCcw size={16}/>{isZh ? '恢复' : 'Restore'}</button> : <button className="ghost-button danger-button" type="button" disabled={busy} onClick={() => void transition('delete')}><Trash2 size={16}/>{isZh ? '删除' : 'Delete'}</button>}</div>}</> : <div className="empty-state"><strong>{isZh ? '选择一条内容' : 'Select content'}</strong></div>}</div></div>
    {canManage && <div className="task-admin-bulk"><div><select aria-label={isZh ? '批量操作' : 'Bulk action'} value={bulkAction} onChange={(event) => { setBulkAction(event.target.value as AdminCommunityBulkAction); setPreview(null) }}><option value="delete">delete</option><option value="restore">restore</option></select><button className="ghost-button" type="button" disabled={!selectedIds.length || busy} onClick={() => void previewBulk()}>{isZh ? '预览' : 'Preview'}</button><span>{isZh ? `已选 ${selectedIds.length}` : `${selectedIds.length} selected`}</span></div>{preview && <div className="task-admin-bulk-confirm"><span>{preview.eligibleCount} eligible · {preview.skippedCount} skipped</span><input placeholder={preview.requiredConfirmationText} value={confirmation} onChange={(event) => setConfirmation(event.target.value)}/><button className="primary-button" type="button" disabled={confirmation !== preview.requiredConfirmationText || busy} onClick={() => void executeBulk()}>{isZh ? '执行' : 'Execute'}</button></div>}</div>}
  </section>
}
