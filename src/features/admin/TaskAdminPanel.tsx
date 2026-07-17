import { useCallback, useEffect, useMemo, useState } from 'react'
import { Archive, ChevronRight, PlayCircle, RefreshCw, RotateCcw, Save, Search, TimerReset, Wrench, XCircle } from 'lucide-react'
import type { Permission } from '../../domain/types'
import { SectionHeader } from '../../components/ui/SectionHeader'
import { adminService } from '../../services/adminService'
import { isApiClientError } from '../../services/apiClient'
import type {
  AdminTaskBulkAction,
  AdminTaskBulkPreview,
  AdminTaskBulkResult,
  AdminTaskDto,
  AdminTaskQuery,
  AdminTaskSummary,
  AdminTaskStatus,
  ApiTaskLifecycleMutation,
} from '../../services/contracts'

const statuses: AdminTaskStatus[] = ['draft', 'open', 'assigned', 'in_progress', 'submitted', 'pending_review', 'disputed', 'completed', 'rejected', 'cancelled', 'expired']
const editableStatuses: AdminTaskStatus[] = ['draft', 'open']

const errorMessage = (error: unknown) => isApiClientError(error) ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : 'Unknown error'
const formatStatus = (status: string) => status.replaceAll('_', ' ')
const formatDate = (value: string | null) => value ? new Date(value).toLocaleString() : '-'

type Draft = Pick<AdminTaskDto, 'title' | 'category' | 'description' | 'acceptanceRules' | 'visibility' | 'deadlineAt'>
const draftFor = (task: AdminTaskDto): Draft => ({
  title: task.title,
  category: task.category,
  description: task.description,
  acceptanceRules: task.acceptanceRules,
  visibility: task.visibility,
  deadlineAt: task.deadlineAt,
})

export function TaskAdminPanel({
  hasPermission,
  isZh,
  notify,
}: {
  hasPermission: (permission: Permission) => boolean
  isZh: boolean
  notify: (message: string) => void
}) {
  const canRead = hasPermission('admin:tasks:read')
  const canManage = hasPermission('admin:tasks:manage')
  const [rows, setRows] = useState<AdminTaskDto[]>([])
  const [summary, setSummary] = useState<AdminTaskSummary>({ total: 0, active: 0, archived: 0, byStatus: {} })
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<AdminTaskDto | null>(null)
  const [lifecycle, setLifecycle] = useState<ApiTaskLifecycleMutation[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<AdminTaskStatus | ''>('')
  const [archiveState, setArchiveState] = useState<NonNullable<AdminTaskQuery['archiveState']>>('active')
  const [sort, setSort] = useState<NonNullable<AdminTaskQuery['sort']>>('updatedAt')
  const [direction, setDirection] = useState<NonNullable<AdminTaskQuery['direction']>>('desc')
  const [reasonCode, setReasonCode] = useState('operator_requested')
  const [note, setNote] = useState('')
  const [bulkAction, setBulkAction] = useState<AdminTaskBulkAction>('archive')
  const [bulkPreview, setBulkPreview] = useState<AdminTaskBulkPreview | null>(null)
  const [bulkConfirmation, setBulkConfirmation] = useState('')
  const [bulkResult, setBulkResult] = useState<AdminTaskBulkResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const query = useMemo<AdminTaskQuery>(() => ({
    search: search.trim() || null,
    status: status || null,
    archiveState,
    sort,
    direction,
    limit: 20,
  }), [archiveState, direction, search, sort, status])

  const load = useCallback(async (cursor: string | null = null, append = false) => {
    if (!canRead) return
    if (append) setLoadingMore(true)
    else setLoading(true)
    setError(null)
    try {
      const [page, counts] = await Promise.all([
        adminService.tasks({ ...query, cursor }),
        adminService.taskSummary(query),
      ])
      setRows((current) => append ? [...current, ...page.items] : page.items)
      setSummary(counts)
      setNextCursor(page.nextCursor)
    } catch (loadError) {
      setError(errorMessage(loadError))
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [canRead, query])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const selectTask = async (task: AdminTaskDto) => {
    setSelectedId(task.id)
    setSelected(task)
    setDraft(draftFor(task))
    setLifecycle([])
    setError(null)
    try {
      const [detail, evidence] = await Promise.all([adminService.task(task.id), adminService.taskLifecycle(task.id)])
      setSelected(detail)
      setDraft(draftFor(detail))
      setLifecycle(evidence)
    } catch (loadError) {
      setError(errorMessage(loadError))
    }
  }

  const applyMutation = async (operation: () => Promise<AdminTaskDto>, success: string) => {
    setSaving(true)
    setError(null)
    try {
      const updated = await operation()
      setSelected(updated)
      setDraft(draftFor(updated))
      setRows((current) => current.map((item) => item.id === updated.id ? updated : item))
      notify(success)
      await load()
    } catch (mutationError) {
      setError(errorMessage(mutationError))
    } finally {
      setSaving(false)
    }
  }

  const saveTask = async () => {
    if (!selected || !draft) return
    await applyMutation(() => adminService.updateTask(selected.id, {
      expectedVersion: selected.version,
      reasonCode,
      note,
      ...draft,
    }), isZh ? '任务资料已更新。' : 'Task details updated.')
  }

  const archiveOrRestore = async () => {
    if (!selected) return
    const evidence = { expectedVersion: selected.version, reasonCode, note }
    await applyMutation(
      () => selected.archivedAt ? adminService.restoreTask(selected.id, evidence) : adminService.archiveTask(selected.id, evidence),
      selected.archivedAt ? (isZh ? '任务已恢复。' : 'Task restored.') : (isZh ? '任务已归档。' : 'Task archived.'),
    )
  }

  const transition = async (action: 'publish' | 'cancel') => {
    if (!selected) return
    await applyMutation(
      () => adminService.transitionTask(selected.id, action, { expectedVersion: selected.version, reasonCode, note }),
      action === 'publish' ? (isZh ? '任务已发布。' : 'Task published.') : (isZh ? '任务已取消。' : 'Task cancelled.'),
    )
  }

  const recoverEscrow = async () => {
    if (!selected) return
    setSaving(true)
    setError(null)
    try {
      const mutation = await adminService.recoverTaskEscrow(selected.id, {
        expectedVersion: selected.version,
        idempotencyKey: crypto.randomUUID(),
        reasonCode,
        note,
      })
      setLifecycle((current) => [mutation, ...current.filter((item) => item.id !== mutation.id)])
      notify(isZh ? '托管状态已完成受控对账。' : 'Escrow state reconciled through the registered recovery action.')
    } catch (recoveryError) {
      setError(errorMessage(recoveryError))
    } finally {
      setSaving(false)
    }
  }

  const sweepExpiry = async () => {
    setSaving(true)
    setError(null)
    try {
      const result = await adminService.sweepExpiredTasks()
      notify(isZh ? `到期扫描完成：扫描 ${result.scanned}，过期 ${result.expired}` : `Expiry sweep complete: ${result.scanned} scanned, ${result.expired} expired.`)
      await load()
    } catch (sweepError) {
      setError(errorMessage(sweepError))
    } finally {
      setSaving(false)
    }
  }

  const toggleSelection = (id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
    setBulkPreview(null)
    setBulkResult(null)
    setBulkConfirmation('')
  }

  const previewBulk = async () => {
    if (!selectedIds.length) return
    setSaving(true)
    setError(null)
    try {
      const preview = await adminService.previewTaskBulk(bulkAction, selectedIds)
      setBulkPreview(preview)
      setBulkResult(null)
      setBulkConfirmation('')
    } catch (previewError) {
      setError(errorMessage(previewError))
    } finally {
      setSaving(false)
    }
  }

  const executeBulk = async () => {
    if (!bulkPreview) return
    setSaving(true)
    setError(null)
    try {
      const result = await adminService.executeTaskBulk({
        action: bulkPreview.action,
        targetIds: selectedIds,
        targetHash: bulkPreview.targetHash,
        confirmationText: bulkConfirmation,
        idempotencyKey: `task-admin-${bulkPreview.action}-${Date.now()}-${bulkPreview.targetHash.slice(0, 8)}`,
        reasonCode,
        note,
      })
      setBulkResult(result)
      setBulkPreview(null)
      setBulkConfirmation('')
      setSelectedIds([])
      notify(isZh ? `批量处置完成：成功 ${result.succeededCount}，跳过 ${result.skippedCount}` : `Bulk disposition completed: ${result.succeededCount} succeeded, ${result.skippedCount} skipped.`)
      await load()
    } catch (executeError) {
      setError(errorMessage(executeError))
    } finally {
      setSaving(false)
    }
  }

  if (!canRead) {
    return (
      <section className="panel task-admin-panel">
        <SectionHeader eyebrow={isZh ? '任务运营' : 'Task operations'} title={isZh ? '任务管理' : 'Task management'} />
        <div className="empty-state"><strong>{isZh ? '无读取权限' : 'Read access required'}</strong><span>admin:tasks:read</span></div>
      </section>
    )
  }

  return (
    <section className="panel task-admin-panel" data-testid="task-admin-panel">
      <SectionHeader
        eyebrow={isZh ? '任务运营' : 'Task operations'}
        title={isZh ? '任务管理' : 'Task management'}
        action={<div className="button-row compact-buttons"><button className="icon-button" type="button" title={isZh ? '扫描过期任务' : 'Sweep expired tasks'} onClick={() => void sweepExpiry()} disabled={saving}><TimerReset size={16} /></button><button className="icon-button" type="button" title={isZh ? '刷新任务' : 'Refresh tasks'} onClick={() => void load()} disabled={loading}><RefreshCw size={16} /></button></div>}
      />

      <div className="task-admin-metrics">
        <div><strong>{summary.total}</strong><span>{isZh ? '任务' : 'Tasks'}</span></div>
        <div><strong>{summary.active}</strong><span>{isZh ? '有效' : 'Active'}</span></div>
        <div><strong>{summary.archived}</strong><span>{isZh ? '归档' : 'Archived'}</span></div>
        <div><strong>{summary.byStatus.pending_review ?? 0}</strong><span>{isZh ? '待审核' : 'Pending review'}</span></div>
        <div><strong>{summary.byStatus.expired ?? 0}</strong><span>{isZh ? '已过期' : 'Expired'}</span></div>
      </div>

      <div className="task-admin-filters">
        <label className="task-admin-search"><span>{isZh ? '搜索' : 'Search'}</span><div><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={isZh ? 'ID、标题、分类' : 'ID, title, category'} /></div></label>
        <label><span>{isZh ? '状态' : 'Status'}</span><select value={status} onChange={(event) => setStatus(event.target.value as AdminTaskStatus | '')}><option value="">{isZh ? '全部' : 'All'}</option>{statuses.map((item) => <option value={item} key={item}>{formatStatus(item)}</option>)}</select></label>
        <label><span>{isZh ? '归档' : 'Archive'}</span><select value={archiveState} onChange={(event) => setArchiveState(event.target.value as NonNullable<AdminTaskQuery['archiveState']>)}><option value="active">{isZh ? '有效' : 'Active'}</option><option value="archived">{isZh ? '已归档' : 'Archived'}</option><option value="all">{isZh ? '全部' : 'All'}</option></select></label>
        <label><span>{isZh ? '排序' : 'Sort'}</span><select value={sort} onChange={(event) => setSort(event.target.value as NonNullable<AdminTaskQuery['sort']>)}><option value="updatedAt">updatedAt</option><option value="createdAt">createdAt</option><option value="deadlineAt">deadlineAt</option><option value="status">status</option><option value="title">title</option></select></label>
        <button className="icon-button" type="button" title={direction === 'desc' ? (isZh ? '降序' : 'Descending') : (isZh ? '升序' : 'Ascending')} onClick={() => setDirection((current) => current === 'desc' ? 'asc' : 'desc')}><RotateCcw size={15} /></button>
      </div>

      {error && <div className="task-admin-error" role="alert">{error}</div>}
      <div className="task-admin-workspace">
        <div className="task-admin-list" aria-busy={loading}>
          {loading && !rows.length && <div className="empty-state"><strong>{isZh ? '正在加载任务' : 'Loading tasks'}</strong></div>}
          {!loading && !rows.length && !error && <div className="empty-state"><strong>{isZh ? '暂无匹配任务' : 'No matching tasks'}</strong></div>}
          {rows.map((task) => (
            <div className={`task-admin-row ${selectedId === task.id ? 'selected' : ''}`} key={task.id}>
              {canManage && <input type="checkbox" aria-label={`${isZh ? '选择' : 'Select'} ${task.title}`} checked={selectedIds.includes(task.id)} onChange={() => toggleSelection(task.id)} />}
              <button type="button" onClick={() => void selectTask(task)}>
                <span><strong>{task.title}</strong><small>{task.id} · {task.category}</small></span>
                <span><span className={`status ${task.status}`}>{formatStatus(task.status)}</span><small>v{task.version}</small></span>
                <ChevronRight size={16} />
              </button>
            </div>
          ))}
          {nextCursor && <button className="ghost-button" type="button" onClick={() => void load(nextCursor, true)} disabled={loadingMore}>{loadingMore ? (isZh ? '加载中' : 'Loading') : (isZh ? '加载更多' : 'Load more')}</button>}
        </div>

        <div className="task-admin-detail">
          {!selected || !draft ? <div className="empty-state"><strong>{isZh ? '选择任务' : 'Select a task'}</strong></div> : <>
            <div className="task-admin-detail-head"><div><strong>{selected.title}</strong><small>{selected.publisherHandle ?? '-'} · {selected.assigneeHandle ?? '-'}</small></div><span className={`status ${selected.status}`}>{formatStatus(selected.status)}</span></div>
            <div className="task-admin-evidence"><span>v{selected.version}</span><span>{selected.proposalCount} {isZh ? '提案' : 'proposals'}</span><span>{selected.submissionCount} {isZh ? '交付' : 'submissions'}</span><span>{formatDate(selected.updatedAt)}</span></div>
            <div className="task-admin-form">
              <label><span>{isZh ? '标题' : 'Title'}</span><input value={draft.title} disabled={!canManage || !editableStatuses.includes(selected.status) || Boolean(selected.archivedAt)} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
              <label><span>{isZh ? '分类' : 'Category'}</span><input value={draft.category} disabled={!canManage || !editableStatuses.includes(selected.status) || Boolean(selected.archivedAt)} onChange={(event) => setDraft({ ...draft, category: event.target.value })} /></label>
              <label><span>{isZh ? '可见性' : 'Visibility'}</span><select value={draft.visibility} disabled={!canManage || !editableStatuses.includes(selected.status) || Boolean(selected.archivedAt)} onChange={(event) => setDraft({ ...draft, visibility: event.target.value as Draft['visibility'] })}><option value="public">public</option><option value="community">community</option><option value="invite_only">invite_only</option></select></label>
              <label><span>{isZh ? '截止时间' : 'Deadline'}</span><input type="datetime-local" value={draft.deadlineAt ? draft.deadlineAt.slice(0, 16) : ''} disabled={!canManage || !editableStatuses.includes(selected.status) || Boolean(selected.archivedAt)} onChange={(event) => setDraft({ ...draft, deadlineAt: event.target.value ? new Date(event.target.value).toISOString() : null })} /></label>
              <label className="wide"><span>{isZh ? '说明' : 'Description'}</span><textarea value={draft.description} disabled={!canManage || !editableStatuses.includes(selected.status) || Boolean(selected.archivedAt)} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
              <label className="wide"><span>{isZh ? '验收规则' : 'Acceptance rules'}</span><textarea value={draft.acceptanceRules} disabled={!canManage || !editableStatuses.includes(selected.status) || Boolean(selected.archivedAt)} onChange={(event) => setDraft({ ...draft, acceptanceRules: event.target.value })} /></label>
            </div>
            {canManage && <>
              <div className="task-admin-reason"><label><span>{isZh ? '原因代码' : 'Reason code'}</span><input value={reasonCode} onChange={(event) => setReasonCode(event.target.value)} /></label><label><span>{isZh ? '备注' : 'Note'}</span><input value={note} onChange={(event) => setNote(event.target.value)} /></label></div>
              <div className="button-row task-admin-actions">
                {editableStatuses.includes(selected.status) && !selected.archivedAt && <button className="primary-button" type="button" onClick={() => void saveTask()} disabled={saving}><Save size={16} />{isZh ? '保存' : 'Save'}</button>}
                {selected.status === 'draft' && !selected.archivedAt && <button className="ghost-button" type="button" onClick={() => void transition('publish')} disabled={saving}><PlayCircle size={16} />{isZh ? '发布' : 'Publish'}</button>}
                {['draft', 'open'].includes(selected.status) && !selected.archivedAt && <button className="ghost-button danger" type="button" onClick={() => void transition('cancel')} disabled={saving}><XCircle size={16} />{isZh ? '取消任务' : 'Cancel task'}</button>}
                {['cancelled', 'expired'].includes(selected.status) && <button className="ghost-button" type="button" onClick={() => void recoverEscrow()} disabled={saving}><Wrench size={16} />{isZh ? '托管对账' : 'Reconcile escrow'}</button>}
                {['draft', 'open', 'completed', 'rejected', 'cancelled', 'expired'].includes(selected.status) && <button className="ghost-button" type="button" onClick={() => void archiveOrRestore()} disabled={saving}>{selected.archivedAt ? <RotateCcw size={16} /> : <Archive size={16} />}{selected.archivedAt ? (isZh ? '恢复' : 'Restore') : (isZh ? '归档' : 'Archive')}</button>}
              </div>
            </>}
            {selected.archivedAt && <div className="task-admin-archive-evidence"><strong>{selected.archiveReasonCode}</strong><span>{selected.archivedByHandle ?? '-'} · {formatDate(selected.archivedAt)}</span><small>{selected.archiveNote}</small></div>}
            {(selected.cancelledAt || selected.expiredAt) && <div className="task-admin-archive-evidence"><strong>{selected.terminalReasonCode ?? '-'}</strong><span>{selected.cancelledAt ? (isZh ? '已取消' : 'Cancelled') : (isZh ? '已过期' : 'Expired')} · {formatDate(selected.cancelledAt ?? selected.expiredAt)}</span></div>}
            {lifecycle.length > 0 && <div className="task-admin-lifecycle"><strong>{isZh ? '生命周期证据' : 'Lifecycle evidence'}</strong>{lifecycle.slice(0, 5).map((item) => <span key={item.id}>{formatDate(item.completedAt)} · {item.action} · {item.result.outcome}</span>)}</div>}
          </>}
        </div>
      </div>

      {canManage && selectedIds.length > 0 && <div className="task-admin-bulk">
        <div><strong>{isZh ? `已选择 ${selectedIds.length} 项` : `${selectedIds.length} selected`}</strong><select value={bulkAction} onChange={(event) => { setBulkAction(event.target.value as AdminTaskBulkAction); setBulkPreview(null); setBulkResult(null) }}><option value="archive">{isZh ? '归档' : 'Archive'}</option><option value="cancel">{isZh ? '取消任务' : 'Cancel tasks'}</option></select><button className="ghost-button" type="button" onClick={() => void previewBulk()} disabled={saving}>{isZh ? '预览' : 'Preview'}</button></div>
        {bulkPreview && <div className="task-admin-bulk-confirm"><span>{isZh ? `可执行 ${bulkPreview.eligibleCount}，跳过 ${bulkPreview.skippedCount}` : `${bulkPreview.eligibleCount} eligible, ${bulkPreview.skippedCount} skipped`}</span><input value={bulkConfirmation} onChange={(event) => setBulkConfirmation(event.target.value)} placeholder={bulkPreview.requiredConfirmationText} /><button className="primary-button" type="button" onClick={() => void executeBulk()} disabled={saving || bulkConfirmation !== bulkPreview.requiredConfirmationText}>{isZh ? '执行' : 'Execute'}</button></div>}
        {bulkResult && <span>{isZh ? `成功 ${bulkResult.succeededCount}，跳过 ${bulkResult.skippedCount}` : `${bulkResult.succeededCount} succeeded, ${bulkResult.skippedCount} skipped`}</span>}
      </div>}
    </section>
  )
}
