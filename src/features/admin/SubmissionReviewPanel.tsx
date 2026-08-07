import { RotateCcw } from 'lucide-react'

import { SectionHeader } from '../../components/ui/SectionHeader'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { pointText, textFor } from '../../domain/utils'
import type { AdminReviewDecision, AdminReviewQueueItemDto, PointAdjustmentReviewMetadata } from '../../services/contracts'
import { AdminActionFeedback, type AdminActionFeedbackMessage } from './AdminActionFeedback'

const isPointAdjustmentMetadata = (metadata: unknown): metadata is PointAdjustmentReviewMetadata =>
  Boolean(metadata && typeof metadata === 'object' && (metadata as PointAdjustmentReviewMetadata).kind === 'point_adjustment')

export function SubmissionReviewPanel({
  t,
  items,
  loading,
  error,
  filter,
  pointReviewCount,
  selectedId,
  highlightedId,
  reviewing,
  notes,
  approvalTemplates,
  actionMessage,
  canReview,
  onFilterChange,
  onSelect,
  onNoteChange,
  onApplyTemplate,
  onReview,
  onRefresh,
  onClearHighlight,
  onClearActionMessage,
}: {
  t: Record<string, string>
  items: AdminReviewQueueItemDto[]
  loading: boolean
  error: string | null
  filter: string | null
  pointReviewCount: number
  selectedId: string | null
  highlightedId: string | null
  reviewing: Record<string, AdminReviewDecision>
  notes: Record<string, string>
  approvalTemplates: string[]
  actionMessage: AdminActionFeedbackMessage | null
  canReview: boolean
  onFilterChange: (filter: string | null) => void
  onSelect: (id: string) => void
  onNoteChange: (id: string, note: string) => void
  onApplyTemplate: (id: string, template: string) => void
  onReview: (item: AdminReviewQueueItemDto, decision: AdminReviewDecision) => void
  onRefresh: () => void
  onClearHighlight: () => void
  onClearActionMessage: () => void
}) {
  const effectiveSelectedId = items.some((item) => item.id === selectedId) ? selectedId : items[0]?.id ?? null
  const selected = items.find((item) => item.id === effectiveSelectedId) ?? null
  const pointMetadata = selected && isPointAdjustmentMetadata(selected.metadata) ? selected.metadata : null

  return (
    <section className="panel submission-review-panel" data-testid="submission-review-workspace">
      <SectionHeader eyebrow={textFor(t, 'Queue', '队列')} title={textFor(t, 'Review workspace', '审核工作台')} />
      <div className="submission-review-toolbar">
        <div className="segmented-control" aria-label={textFor(t, 'Review queue filter', '审核队列筛选')}>
          <button className={filter === null ? 'active' : ''} type="button" onClick={() => onFilterChange(null)}>{textFor(t, 'All queues', '全部队列')}</button>
          <button className={filter === 'points' ? 'active' : ''} type="button" onClick={() => onFilterChange('points')}>{textFor(t, `Point approvals ${pointReviewCount}`, `积分审批 ${pointReviewCount}`)}</button>
        </div>
        <button className="icon-button" type="button" aria-label={textFor(t, 'Refresh review queue', '刷新审核队列')} title={textFor(t, 'Refresh review queue', '刷新审核队列')} onClick={onRefresh} disabled={loading}><RotateCcw size={16} /></button>
      </div>
      <AdminActionFeedback message={actionMessage} className="submission-review-message" />
      <div className="submission-review-workspace">
        <div className="submission-review-list" aria-busy={loading}>
          {loading && <div className="empty-state compact"><strong>{textFor(t, 'Loading review queue', '正在加载审核队列')}</strong><span>{textFor(t, 'Reading operations review items from the API.', '正在从 API 读取运营审核事项。')}</span></div>}
          {!loading && error && <div className="empty-state compact"><strong>{textFor(t, 'Queue API unavailable', '队列 API 暂不可用')}</strong><span>{error}</span><button className="ghost-button" type="button" onClick={onRefresh}>{textFor(t, 'Retry sync', '重试同步')}</button></div>}
          {!loading && !error && items.length === 0 && <div className="empty-state compact"><strong>{textFor(t, 'No review items', '暂无审核事项')}</strong><span>{textFor(t, 'Try another queue filter.', '尝试切换其他队列筛选。')}</span></div>}
          {items.map((item) => <button className={`submission-review-row ${effectiveSelectedId === item.id ? 'selected' : ''} ${highlightedId === item.id ? 'deep-linked' : ''}`} type="button" key={item.id} onClick={() => { onSelect(item.id); onClearHighlight(); onClearActionMessage() }}><span className="submission-review-row-head"><StatusBadge status={item.status} t={t} /><small>{item.queue}</small></span><strong>{item.title}</strong><span>@{item.owner}</span><small>{item.decision ? textFor(t, `Reviewed by @${item.reviewedBy ?? 'system'}`, `已由 @${item.reviewedBy ?? 'system'} 处理`) : item.note}</small></button>)}
        </div>
        <aside className="submission-review-detail">
          {!selected && <div className="empty-state"><strong>{textFor(t, 'Select a review item', '选择审核事项')}</strong><span>{textFor(t, 'The selected item details and actions appear here.', '所选事项的详情和操作会显示在这里。')}</span></div>}
          {selected && <>
            <div className="submission-review-detail-head"><div><small>{selected.queue} · {selected.id}</small><h3>{selected.title}</h3><span>@{selected.owner}</span></div><StatusBadge status={selected.status} t={t} /></div>
            <p className="submission-review-context">{selected.note}</p>
            {pointMetadata && <dl className="submission-review-facts"><div><dt>{textFor(t, 'Requester', '申请人')}</dt><dd>@{pointMetadata.requestedBy ?? '-'}</dd></div><div><dt>{textFor(t, 'Reason', '原因')}</dt><dd>{pointMetadata.reasonCode ?? textFor(t, 'Uncategorized', '未分类')}</dd></div><div><dt>{textFor(t, 'Balance impact', '余额影响')}</dt><dd>{`${pointText(String(pointMetadata.balanceBefore ?? 0), t)} -> ${pointText(String(pointMetadata.projectedBalance ?? 0), t)}`}</dd></div><div><dt>{textFor(t, 'Approval limit', '审批额度')}</dt><dd>{pointText(String(pointMetadata.threshold ?? 0), t)}</dd></div></dl>}
            {selected.decision ? <div className="submission-review-decision"><strong>{textFor(t, 'Decision recorded', '已记录审核决定')}</strong><span>{selected.decision} · @{selected.reviewedBy ?? 'system'}</span></div> : <>
              <label className="review-note"><span>{textFor(t, 'Review note', '审核备注')}</span><textarea value={notes[selected.id] ?? ''} onChange={(event) => onNoteChange(selected.id, event.target.value)} disabled={Boolean(reviewing[selected.id])} /></label>
              {pointMetadata && approvalTemplates.length > 0 && <div className="submission-review-templates"><span>{textFor(t, 'Note templates', '备注模板')}</span><div className="button-row compact-buttons">{approvalTemplates.slice(0, 3).map((template) => <button className="ghost-button small" type="button" key={template} onClick={() => onApplyTemplate(selected.id, template)} disabled={Boolean(reviewing[selected.id])}>{template}</button>)}</div></div>}
              <div className="button-row submission-review-actions"><button className="ghost-button danger" type="button" onClick={() => onReview(selected, 'reject')} disabled={!canReview || Boolean(reviewing[selected.id])}>{reviewing[selected.id] === 'reject' ? textFor(t, 'Rejecting', '正在驳回') : textFor(t, 'Reject', '驳回')}</button><button className="primary-button" type="button" onClick={() => onReview(selected, 'approve')} disabled={!canReview || Boolean(reviewing[selected.id])}>{reviewing[selected.id] === 'approve' ? textFor(t, 'Approving', '正在通过') : textFor(t, 'Approve', '通过')}</button></div>
            </>}
          </>}
        </aside>
      </div>
    </section>
  )
}
