import { PlayCircle, RotateCcw, XCircle } from 'lucide-react'

import { StatusBadge } from '../../components/ui/StatusBadge'
import type { AsyncResourceState } from '../../domain/types'
import { textFor } from '../../domain/utils'
import type { AdminCreativeGenerationBulkAction, ApiCreativeGenerationRecord } from '../../services/contracts'
import type { useAdminGenerationState } from './useAdminGenerationState'

type GenerationState = ReturnType<typeof useAdminGenerationState>

type Props = {
  t: Record<string, string>
  state: GenerationState['state']
  setters: GenerationState['setters']
  status: AsyncResourceState
  canRead: boolean
  canReadQueues: boolean
  canCancel: boolean
  canRequestRetries: boolean
  canRequestManualReplay: boolean
  canRepairAccounting: boolean
  onClearFilters: () => void
  onChangeBulkAction: (action: AdminCreativeGenerationBulkAction) => void
  onPreviewBulkAction: () => Promise<void>
  onExecuteBulkAction: () => Promise<void>
  onToggleSelection: (generationId: string) => void
  onToggleDetail: (generation: ApiCreativeGenerationRecord) => Promise<void>
  onFocusMedia: (assetId: string) => void
  onFocusAudit: (generationId: string) => void
  onLoadMore: () => Promise<void>
  onMutation: (action: 'cancel' | 'retry' | 'manual_replay') => Promise<void>
  onSettleProviderCost: () => Promise<void>
  formatTime: (value: string) => string
  formatNumber: (value: number | null | undefined) => string
  formatProviderCostAmount: (amount: number | null | undefined, currency: string | null | undefined) => string
  formatProviderCostSummary: (generation: ApiCreativeGenerationRecord) => string
  formatProviderBudgetSummary: (generation: ApiCreativeGenerationRecord) => string
}

const workspaces = ['image', 'video', 'music', 'chat']
const statuses = ['queued', 'running', 'completed', 'failed', 'cancelled', 'review_required']
const replayStatuses = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const

const formatStatus = (status: string) => status.replaceAll('_', ' ')
const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const recordNumber = (record: Record<string, unknown>, key: string) => {
  const value = Number(record[key] ?? 0)
  return Number.isFinite(value) ? value : 0
}
const credit = (generation: ApiCreativeGenerationRecord) => asRecord(generation.credit)
const quota = (generation: ApiCreativeGenerationRecord) => asRecord(generation.quota)
const safety = (generation: ApiCreativeGenerationRecord) => asRecord(generation.safety)
const formatJson = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
const providerReplayEvidenceSummary = (generation: ApiCreativeGenerationRecord, t: Record<string, string>) => {
  const evidence = generation.providerReplayEvidence
  if (!evidence?.available) return textFor(t, 'Replay ledger unavailable', 'Replay ledger 不可用')
  if (!evidence.count) return textFor(t, 'No replay records', '暂无 replay 记录')
  const latest = evidence.latest
  if (!latest) return `${evidence.count} ${textFor(t, 'records', '条记录')}`
  return [
    `${evidence.count} ${textFor(t, 'records', '条记录')}`,
    `${latest.sourceType}/${latest.action}/${latest.normalizedStatus ?? '-'}`,
    `${textFor(t, 'outcome', '结果')} ${latest.sideEffectOutcome}`,
    latest.payloadHashPresent
      ? `${textFor(t, 'payload hash', 'payload hash')} ${latest.payloadHashPreview ?? textFor(t, 'present', '存在')}`
      : textFor(t, 'payload hash missing', '缺少 payload hash'),
    latest.sideEffectCompleted
      ? textFor(t, 'side effects complete', 'side effect 已完成')
      : textFor(t, 'side effects pending', 'side effect 未完成'),
  ].join(' · ')
}
const providerFailureSummary = (generation: ApiCreativeGenerationRecord, t: Record<string, string>) => {
  const risk = generation.usage?.providerCost?.risk
  if (!risk?.providerCategory && risk?.providerStatus == null) return textFor(t, 'No Provider failure diagnostics', '暂无 Provider 失败诊断')
  return [
    risk.providerCategory ? `${textFor(t, 'category', '分类')} ${risk.providerCategory}` : null,
    risk.providerStatus == null ? null : `HTTP ${risk.providerStatus}`,
  ].filter(Boolean).join(' · ')
}

type FilterProps = Pick<Props, 't' | 'state' | 'setters' | 'canRead' | 'onClearFilters'>

function GenerationRecordFilters({ t, state, setters, canRead, onClearFilters }: FilterProps) {
  const { userHandle, historyWorkspace, providerId, statusFilter, reviewFilter, mediaAssetId, dateFrom, dateTo, sort, direction } = state
  const { setUserHandle, setHistoryWorkspace, setProviderId, setStatusFilter, setReviewFilter, setMediaAssetId, setDateFrom, setDateTo, setSort, setDirection } = setters
  const filtersEmpty = !userHandle && !historyWorkspace && !providerId && !statusFilter && reviewFilter === 'all' && !mediaAssetId && !dateFrom && !dateTo

  return (
    <div className="permission-summary generation-record-filters">
      <label>
        <span>{textFor(t, 'Sort', '排序')}</span>
        <select aria-label={textFor(t, 'Generation sort', '生成记录排序')} value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} disabled={!canRead}>
          <option value="createdAt">{textFor(t, 'Created', '创建时间')}</option>
          <option value="updatedAt">{textFor(t, 'Updated', '更新时间')}</option>
          <option value="status">{textFor(t, 'Status', '状态')}</option>
        </select>
      </label>
      <label>
        <span>{textFor(t, 'Direction', '方向')}</span>
        <select aria-label={textFor(t, 'Generation sort direction', '生成记录排序方向')} value={direction} onChange={(event) => setDirection(event.target.value as typeof direction)} disabled={!canRead}>
          <option value="desc">{textFor(t, 'Descending', '降序')}</option>
          <option value="asc">{textFor(t, 'Ascending', '升序')}</option>
        </select>
      </label>
      <label>
        <span>{textFor(t, 'User', '用户')}</span>
        <input aria-label={textFor(t, 'Generation user handle', '生成用户 Handle')} value={userHandle} onChange={(event) => setUserHandle(event.target.value)} placeholder="user-handle" disabled={!canRead} />
      </label>
      <label>
        <span>{textFor(t, 'Workspace', '工作区')}</span>
        <select aria-label={textFor(t, 'Generation workspace', '生成工作区')} value={historyWorkspace} onChange={(event) => setHistoryWorkspace(event.target.value)} disabled={!canRead}>
          <option value="">{textFor(t, 'All workspaces', '全部工作区')}</option>
          {workspaces.map((workspace) => <option value={workspace} key={workspace}>{workspace}</option>)}
        </select>
      </label>
      <label>
        <span>{textFor(t, 'Provider', '提供方')}</span>
        <input aria-label={textFor(t, 'Generation provider', '生成提供方')} value={providerId} onChange={(event) => setProviderId(event.target.value)} placeholder="provider-id" disabled={!canRead} />
      </label>
      <label>
        <span>{textFor(t, 'Status', '状态')}</span>
        <select aria-label={textFor(t, 'Generation status', '生成状态')} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} disabled={!canRead}>
          <option value="">{textFor(t, 'All statuses', '全部状态')}</option>
          {statuses.map((status) => <option value={status} key={status}>{formatStatus(status)}</option>)}
        </select>
      </label>
      <label>
        <span>{textFor(t, 'Review', '复核')}</span>
        <select aria-label={textFor(t, 'Generation review filter', '生成复核筛选')} value={reviewFilter} onChange={(event) => setReviewFilter(event.target.value as typeof reviewFilter)} disabled={!canRead}>
          <option value="all">{textFor(t, 'All', '全部')}</option>
          <option value="true">{textFor(t, 'Review required', '需要复核')}</option>
          <option value="false">{textFor(t, 'No review gate', '无需复核')}</option>
        </select>
      </label>
      <label>
        <span>{textFor(t, 'Media asset', '媒体资产')}</span>
        <input aria-label={textFor(t, 'Generation media asset id', '生成媒体资产 ID')} value={mediaAssetId} onChange={(event) => setMediaAssetId(event.target.value)} placeholder="media-..." disabled={!canRead} />
      </label>
      <label>
        <span>{textFor(t, 'From', '开始日期')}</span>
        <input aria-label={textFor(t, 'Generation date from', '生成开始日期')} type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} disabled={!canRead} />
      </label>
      <label>
        <span>{textFor(t, 'To', '结束日期')}</span>
        <input aria-label={textFor(t, 'Generation date to', '生成结束日期')} type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} disabled={!canRead} />
      </label>
      <button className="ghost-button" type="button" onClick={onClearFilters} disabled={!canRead || filtersEmpty}>
        {textFor(t, 'Clear filters', '清除筛选')}
      </button>
    </div>
  )
}

type BulkProps = Pick<Props, 't' | 'state' | 'setters' | 'canCancel' | 'canRequestRetries' | 'onChangeBulkAction' | 'onPreviewBulkAction' | 'onExecuteBulkAction'>

function GenerationBulkActions({ t, state, setters, canCancel, canRequestRetries, onChangeBulkAction, onPreviewBulkAction, onExecuteBulkAction }: BulkProps) {
  const { selectedIds, bulkAction, bulkPreview, bulkConfirmation, bulkResult, runningBulkAction, mutationReason, mutationNote } = state
  const { setMutationReason, setMutationNote, setBulkConfirmation } = setters
  return (
    <div className="admin-detail-panel generation-bulk-panel" data-testid="admin-generation-bulk-actions">
      <div>
        <strong>{textFor(t, 'Batch disposition', '批量处置')}</strong>
        <span>{selectedIds.length}/50 {textFor(t, 'selected', '已选择')}</span>
      </div>
      <div className="permission-summary generation-mutation-controls">
        <label>
          <span>{textFor(t, 'Action', '操作')}</span>
          <select aria-label={textFor(t, 'Generation bulk action', '生成批量操作')} value={bulkAction} onChange={(event) => onChangeBulkAction(event.target.value as AdminCreativeGenerationBulkAction)} disabled={runningBulkAction}>
            <option value="cancel">{textFor(t, 'Cancel eligible', '取消可处置任务')}</option>
            <option value="authorize_retry">{textFor(t, 'Authorize eligible retries', '授权可重试任务')}</option>
          </select>
        </label>
        <label>
          <span>{textFor(t, 'Reason code', '原因代码')}</span>
          <input aria-label={textFor(t, 'Generation bulk reason code', '生成批量原因代码')} value={mutationReason} onChange={(event) => setMutationReason(event.target.value)} disabled={runningBulkAction} />
        </label>
        <label>
          <span>{textFor(t, 'Operator note', '操作说明')}</span>
          <input aria-label={textFor(t, 'Generation bulk operator note', '生成批量操作说明')} value={mutationNote} onChange={(event) => setMutationNote(event.target.value)} disabled={runningBulkAction} />
        </label>
        <button className="ghost-button" type="button" onClick={() => void onPreviewBulkAction()} disabled={!selectedIds.length || runningBulkAction || (bulkAction === 'cancel' ? !canCancel : !canRequestRetries)}>
          {textFor(t, 'Preview', '预检')}
        </button>
        {bulkPreview && (
          <>
            <span data-testid="generation-bulk-preview-counts">
              {textFor(t, 'Eligible', '可执行')} {bulkPreview.eligibleCount}
              {' · '}{textFor(t, 'Blocked', '已阻止')} {bulkPreview.blockedCount}
              {' · '}{textFor(t, 'Missing', '不存在')} {bulkPreview.missingCount}
            </span>
            <label>
              <span>{bulkPreview.requiredConfirmationText}</span>
              <input aria-label={textFor(t, 'Generation bulk confirmation', '生成批量确认短语')} value={bulkConfirmation} onChange={(event) => setBulkConfirmation(event.target.value)} disabled={runningBulkAction} />
            </label>
            <button className="primary-button" type="button" onClick={() => void onExecuteBulkAction()} disabled={runningBulkAction || bulkConfirmation !== bulkPreview.requiredConfirmationText}>
              {runningBulkAction ? textFor(t, 'Executing', '执行中') : textFor(t, 'Execute', '执行')}
            </button>
          </>
        )}
      </div>
      {bulkResult && (
        <p data-testid="generation-bulk-result">
          {textFor(t, 'Succeeded', '成功')} {bulkResult.counts.succeeded}
          {' · '}{textFor(t, 'Duplicate', '重复')} {bulkResult.counts.duplicate}
          {' · '}{textFor(t, 'Blocked', '已阻止')} {bulkResult.counts.blocked}
          {' · '}{textFor(t, 'Missing', '不存在')} {bulkResult.counts.missing}
        </p>
      )}
    </div>
  )
}

type DetailProps = Pick<Props, 't' | 'state' | 'setters' | 'canReadQueues' | 'canCancel' | 'canRequestRetries' | 'canRequestManualReplay' | 'canRepairAccounting' | 'onFocusMedia' | 'onMutation' | 'onSettleProviderCost' | 'formatTime' | 'formatProviderCostAmount' | 'formatProviderCostSummary' | 'formatProviderBudgetSummary'>

function GenerationDetail({ t, state, setters, canReadQueues, canCancel, canRequestRetries, canRequestManualReplay, canRepairAccounting, onFocusMedia, onMutation, onSettleProviderCost, formatTime, formatProviderCostAmount, formatProviderCostSummary, formatProviderBudgetSummary }: DetailProps) {
  const { selectedId, selected, loadingDetail, detailError, mutationReason, mutationNote, replayStatus, runningAction, providerCostSettlementDraft, settlingProviderCost } = state
  const { setMutationReason, setMutationNote, setReplayStatus, setProviderCostSettlementDraft } = setters
  if (!selectedId) return null

  return (
    <div className="admin-detail-panel">
      <div>
        <strong>{textFor(t, 'Generation detail', '生成详情')}</strong>
        <span>{selectedId}</span>
      </div>
      {loadingDetail && <p>{textFor(t, 'Refreshing detail from the API.', '正在从 API 刷新详情。')}</p>}
      {detailError && <p>{detailError}</p>}
      {selected && (
        <>
          <div className="permission-summary generation-mutation-controls">
            <label>
              <span>{textFor(t, 'Reason code', '原因代码')}</span>
              <input aria-label={textFor(t, 'Generation action reason code', '生成操作原因代码')} value={mutationReason} onChange={(event) => setMutationReason(event.target.value)} disabled={Boolean(runningAction)} />
            </label>
            <label>
              <span>{textFor(t, 'Operator note', '操作说明')}</span>
              <input aria-label={textFor(t, 'Generation action note', '生成操作说明')} value={mutationNote} onChange={(event) => setMutationNote(event.target.value)} disabled={Boolean(runningAction)} />
            </label>
            <label>
              <span>{textFor(t, 'Replay status', '重放状态')}</span>
              <select aria-label={textFor(t, 'Manual replay status', '人工重放状态')} value={replayStatus} onChange={(event) => setReplayStatus(event.target.value as typeof replayStatus)} disabled={Boolean(runningAction)}>
                {replayStatuses.map((status) => <option value={status} key={status}>{formatStatus(status)}</option>)}
              </select>
            </label>
            <div className="button-row">
              <button className="ghost-button" type="button" onClick={() => void onMutation('cancel')} disabled={!canCancel || !['queued', 'running'].includes(selected.status) || Boolean(runningAction)} title={textFor(t, 'Cancel generation', '取消生成任务')}>
                <XCircle size={16} aria-hidden="true" />
                {textFor(t, 'Cancel', '取消')}
              </button>
              <button className="ghost-button" type="button" onClick={() => void onMutation('retry')} disabled={!canRequestRetries || !['failed', 'cancelled'].includes(selected.status) || Boolean(runningAction)} title={textFor(t, 'Authorize user retry', '授权用户重试')}>
                <RotateCcw size={16} aria-hidden="true" />
                {textFor(t, 'Authorize retry', '授权重试')}
              </button>
              <button className="ghost-button" type="button" onClick={() => void onMutation('manual_replay')} disabled={!canRequestManualReplay || !selected.providerJobId || Boolean(runningAction) || (replayStatus === 'completed' && selected.outputAssetIds.length === 0)} title={textFor(t, 'Request manual Provider replay', '申请人工 Provider 重放')}>
                <PlayCircle size={16} aria-hidden="true" />
                {textFor(t, 'Request replay', '申请重放')}
              </button>
            </div>
          </div>
          <div className="audit-metadata-grid">
            <div><strong>{textFor(t, 'Prompt', '提示词')}</strong><span>{selected.promptPreview ?? textFor(t, 'Preview unavailable', '无预览')} · {selected.promptHash}</span></div>
            <div><strong>{textFor(t, 'Provider job', '提供方任务')}</strong><span>{selected.providerRequestId ?? '-'} / {selected.providerJobId ?? '-'}</span></div>
            <div><strong>{textFor(t, 'Attempt', '尝试次数')}</strong><span>#{selected.attemptNumber}{selected.retryOfId ? ` · ${textFor(t, 'retry of', '重试来源')} ${selected.retryOfId}` : ''}</span></div>
            <div><strong>{textFor(t, 'Provider replay', 'Provider replay')}</strong><span>{providerReplayEvidenceSummary(selected, t)}</span></div>
            <div>
              <strong>{textFor(t, 'Latest operation', '最新操作')}</strong>
              <span>{selected.mutationEvidence?.latest ? `${selected.mutationEvidence.latest.type ?? '-'} · ${selected.mutationEvidence.latest.status ?? '-'} · ${selected.mutationEvidence.latest.reasonCode ?? '-'}` : textFor(t, 'No generation operations', '暂无生成操作')}</span>
            </div>
            <div>
              <strong>{textFor(t, 'Output ingestion', '输出摄取')}</strong>
              <span>{selected.outputIngestionEvidence?.available ? `${selected.outputIngestionEvidence.completedCount}/${selected.outputIngestionEvidence.count} ${textFor(t, 'completed', '已完成')}${selected.outputIngestionEvidence.failedCount ? ` · ${selected.outputIngestionEvidence.failedCount} ${textFor(t, 'failed', '失败')}` : ''}` : textFor(t, 'Ingestion ledger unavailable', '摄取账本不可用')}</span>
            </div>
            {selected.outputIngestionEvidence?.latest && (
              <div>
                <strong>{textFor(t, 'Latest ingestion', '最新摄取')}</strong>
                <span>
                  #{selected.outputIngestionEvidence.latest.outputIndex ?? '-'} · {selected.outputIngestionEvidence.latest.status ?? '-'} · {selected.outputIngestionEvidence.latest.detectedContentType ?? '-'} · {selected.outputIngestionEvidence.latest.sizeBytes ?? 0} B
                  {selected.outputIngestionEvidence.latest.sha256Present ? ` · SHA-256 ${selected.outputIngestionEvidence.latest.sha256Preview ?? textFor(t, 'present', '存在')}` : ''}
                  {selected.outputIngestionEvidence.latest.errorCode ? ` · ${selected.outputIngestionEvidence.latest.errorCode}` : ''}
                </span>
              </div>
            )}
            <div><strong>{textFor(t, 'Provider cost', 'Provider cost')}</strong><span>{formatProviderCostSummary(selected)}</span></div>
            <div><strong>{textFor(t, 'Provider budget', 'Provider budget')}</strong><span>{formatProviderBudgetSummary(selected)}</span></div>
            {selected.status === 'failed' && <div><strong>{textFor(t, 'Provider failure', 'Provider 失败')}</strong><span>{providerFailureSummary(selected, t)}</span></div>}
            <div>
              <strong>{textFor(t, 'Cost ledger', '成本账本')}</strong>
              <span>
                {selected.providerCostLedgerEvidence?.status
                  ? [
                      selected.providerCostLedgerEvidence.status,
                      `${textFor(t, 'estimate', '预估')} ${formatProviderCostAmount(selected.providerCostLedgerEvidence.estimateAmount, selected.providerCostLedgerEvidence.currency)}`,
                      `${textFor(t, 'actual', '实际')} ${formatProviderCostAmount(selected.providerCostLedgerEvidence.actualAmount, selected.providerCostLedgerEvidence.currency)}`,
                      `${textFor(t, 'reserved', '预留')} ${formatProviderCostAmount(selected.providerCostLedgerEvidence.budget?.reservedAmount, selected.providerCostLedgerEvidence.currency)}`,
                      `${textFor(t, 'spent', '已用')} ${formatProviderCostAmount(selected.providerCostLedgerEvidence.budget?.spentAmount, selected.providerCostLedgerEvidence.currency)}`,
                      selected.providerCostLedgerEvidence.reasonCode ?? null,
                    ].filter(Boolean).join(' · ')
                  : textFor(t, 'Cost ledger unavailable', '成本账本不可用')}
              </span>
            </div>
            {selected.providerCostLedgerEvidence?.status === 'reconciliation_required' && canRepairAccounting && (
              <div className="provider-cost-settlement-controls">
                <strong>{textFor(t, 'Confirm actual Provider cost', '确认 Provider 实际成本')}</strong>
                <div className="button-row">
                  <input aria-label={textFor(t, 'Actual Provider cost USD', 'Provider 实际成本 USD')} inputMode="decimal" value={providerCostSettlementDraft.actualAmount} onChange={(event) => setProviderCostSettlementDraft((current) => ({ ...current, actualAmount: event.target.value }))} placeholder="0.00" />
                  <input aria-label={textFor(t, 'Provider cost evidence reference', 'Provider 成本证据引用')} value={providerCostSettlementDraft.evidenceRef} onChange={(event) => setProviderCostSettlementDraft((current) => ({ ...current, evidenceRef: event.target.value }))} placeholder="evidence-reference" />
                  <input aria-label={textFor(t, 'Provider cost settlement reason', 'Provider 成本结算原因')} value={providerCostSettlementDraft.reasonCode} onChange={(event) => setProviderCostSettlementDraft((current) => ({ ...current, reasonCode: event.target.value }))} />
                  <button className="primary-button" type="button" onClick={() => void onSettleProviderCost()} disabled={settlingProviderCost || !providerCostSettlementDraft.actualAmount.trim() || !providerCostSettlementDraft.evidenceRef.trim() || !providerCostSettlementDraft.reasonCode.trim()}>{settlingProviderCost ? textFor(t, 'Settling', '结算中') : textFor(t, 'Confirm settlement', '确认结算')}</button>
                </div>
              </div>
            )}
            {selected.providerReplayEvidence?.latest && (
              <div>
                <strong>{textFor(t, 'Latest replay', '最新 replay')}</strong>
                <span>
                  {textFor(t, 'previous', '之前')} {selected.providerReplayEvidence.latest.previousStatus ?? '-'} {' -> '} {selected.providerReplayEvidence.latest.normalizedStatus ?? '-'}
                  {' · '}{textFor(t, 'reason', '原因')} {selected.providerReplayEvidence.latest.reasonCode ?? '-'}
                  {' · '}{textFor(t, 'ops', '操作')} {selected.providerReplayEvidence.latest.completedOperationCount}
                  {selected.providerReplayEvidence.latest.failedOperationType ? ` · ${textFor(t, 'failed', '失败')} ${selected.providerReplayEvidence.latest.failedOperationType}` : ''}
                  {selected.providerReplayEvidence.latest.errorPreviewPresent ? ` · ${textFor(t, 'error preview present', '存在错误预览')}` : ''}
                </span>
              </div>
            )}
            <div><strong>{textFor(t, 'Timeline', '时间线')}</strong><span>{textFor(t, 'started', '开始')} {selected.startedAt ? formatTime(selected.startedAt) : '-'} · {textFor(t, 'completed', '完成')} {selected.completedAt ? formatTime(selected.completedAt) : '-'} · {textFor(t, 'failed', '失败')} {selected.failedAt ? formatTime(selected.failedAt) : '-'}</span></div>
            <div><strong>{textFor(t, 'Error', '错误')}</strong><span>{selected.errorCode ?? '-'} {selected.errorMessagePreview ?? ''}</span></div>
            <div><strong>{textFor(t, 'Quota', '额度')}</strong><span>{formatJson(selected.quota ?? {})}</span></div>
            <div><strong>{textFor(t, 'Credit', 'Credit')}</strong><span>{formatJson(selected.credit ?? {})}</span></div>
            <div><strong>{textFor(t, 'Safety', '安全')}</strong><span>{formatJson(selected.safety ?? {})}</span></div>
            <div><strong>{textFor(t, 'Policy', '策略')}</strong><span>{formatJson(selected.policy ?? {})}</span></div>
          </div>
          <div className="permission-chip-grid">
            {selected.inputAssetIds.map((assetId) => <span className="permission-chip" key={`input-${assetId}`}>{textFor(t, 'input', '输入')}:{assetId}</span>)}
            {selected.outputAssetIds.map((assetId) => <button className="permission-chip editable" type="button" key={`output-${assetId}`} onClick={() => onFocusMedia(assetId)} disabled={!canReadQueues}>{textFor(t, 'output', '输出')}:{assetId}</button>)}
            {selected.parameterKeys.map((key) => <span className="permission-chip granted" key={`parameter-${key}`}>{textFor(t, 'parameter', '参数')}:{key}</span>)}
          </div>
        </>
      )}
    </div>
  )
}

export function AdminGenerationRecordsPanel({
  t,
  state,
  setters,
  status,
  canRead,
  canReadQueues,
  canCancel,
  canRequestRetries,
  canRequestManualReplay,
  canRepairAccounting,
  onClearFilters,
  onChangeBulkAction,
  onPreviewBulkAction,
  onExecuteBulkAction,
  onToggleSelection,
  onToggleDetail,
  onFocusMedia,
  onFocusAudit,
  onLoadMore,
  onMutation,
  onSettleProviderCost,
  formatTime,
  formatNumber,
  formatProviderCostAmount,
  formatProviderCostSummary,
  formatProviderBudgetSummary,
}: Props) {
  const { rows, summary, selectedId, selectedIds, runningBulkAction, nextCursor, loadingMore } = state
  return (
    <>
      <GenerationRecordFilters t={t} state={state} setters={setters} canRead={canRead} onClearFilters={onClearFilters} />
      <div className="generation-record-summary" aria-label={textFor(t, 'Generation record summary', '生成记录摘要')}>
        <span><strong>{formatNumber(summary.total)}</strong>{textFor(t, 'records', '条记录')}</span>
        <span><strong>{formatNumber(summary.active)}</strong>{textFor(t, 'active', '进行中')}</span>
        <span><strong>{formatNumber(summary.failed)}</strong>{textFor(t, 'failed', '失败')}</span>
        <span><strong>{formatNumber(summary.reviewRequired)}</strong>{textFor(t, 'review', '待复核')}</span>
        <span><strong>{formatNumber(summary.outputAssets)}</strong>{textFor(t, 'outputs', '产物')}</span>
      </div>
      <GenerationBulkActions t={t} state={state} setters={setters} canCancel={canCancel} canRequestRetries={canRequestRetries} onChangeBulkAction={onChangeBulkAction} onPreviewBulkAction={onPreviewBulkAction} onExecuteBulkAction={onExecuteBulkAction} />
      <div className="admin-table">
        {status.loading && <div className="empty-state"><strong>{textFor(t, 'Loading generation history', '正在加载生成历史')}</strong><span>{textFor(t, 'Reading durable generation, quota, credit, and safety metadata.', '正在读取持久化生成、额度、Credit 与安全元数据。')}</span></div>}
        {!status.loading && status.error && <div className="empty-state"><strong>{textFor(t, 'Generation history unavailable', '生成历史不可用')}</strong><span>{status.error}</span><button className="ghost-button" type="button" onClick={() => void status.refresh()}>{textFor(t, 'Retry sync', '重试同步')}</button></div>}
        {!status.loading && !status.error && rows.length === 0 && <div className="empty-state"><strong>{textFor(t, 'No generation records', '暂无生成记录')}</strong><span>{textFor(t, 'Try another user, provider, media asset, date, or status filter.', '尝试其他用户、提供方、媒体资产、日期或状态筛选。')}</span></div>}
        {!status.error && rows.map((generation) => {
          const firstOutputAssetId = generation.outputAssetIds[0]
          const title = generation.promptPreview || `${generation.promptHash.slice(0, 12)}...`
          const providerCost = generation.usage?.providerCost ?? null
          const isSelected = selectedId === generation.id
          return (
            <div className={isSelected ? 'admin-row generation-row deep-linked' : 'admin-row generation-row'} key={generation.id}>
              <label title={textFor(t, 'Select generation', '选择生成任务')}>
                <input type="checkbox" aria-label={`${textFor(t, 'Select generation', '选择生成任务')} ${generation.id}`} checked={selectedIds.includes(generation.id)} onChange={() => onToggleSelection(generation.id)} disabled={runningBulkAction} />
              </label>
              <StatusBadge status={formatStatus(generation.status)} t={t} />
              <strong>{title}</strong>
              <span>@{generation.actorHandle ?? generation.actorId ?? 'system'} · {generation.workspace}/{generation.mode} · {generation.providerId}</span>
              <small>
                {formatTime(generation.createdAt)} · {String(credit(generation).status ?? 'none')} {recordNumber(credit(generation), 'settled')}/{recordNumber(credit(generation), 'reserved')}
                {' · '}{textFor(t, 'quota', '额度')} {recordNumber(quota(generation), 'used')}/{recordNumber(quota(generation), 'limit') || '-'}
                {' · '}{textFor(t, 'outputs', '输出')} {generation.outputAssetIds.length}
                {' · '}{textFor(t, 'replays', 'Replay')} {generation.providerReplayEvidence?.available ? generation.providerReplayEvidence.count : 0}
                {providerCost ? ` · ${textFor(t, 'cost', '成本')} ${formatProviderCostSummary(generation)} · ${textFor(t, 'budget', '预算')} ${providerCost.budget.status ?? '-'}` : ''}
                {safety(generation).reviewRequired ? ` · ${textFor(t, 'review required', '需要复核')}` : ''}
              </small>
              <div className="button-row">
                <button className={isSelected ? 'ghost-button active' : 'ghost-button'} type="button" onClick={() => void onToggleDetail(generation)}>{isSelected ? textFor(t, 'Hide details', '收起详情') : textFor(t, 'Details', '详情')}</button>
                <button className="ghost-button" type="button" onClick={() => firstOutputAssetId && onFocusMedia(firstOutputAssetId)} disabled={!firstOutputAssetId || !canReadQueues}>{textFor(t, 'Media', '媒体')}</button>
                <button className="ghost-button" type="button" onClick={() => onFocusAudit(generation.id)} disabled={!canRead}>{textFor(t, 'Audit', '审计')}</button>
              </div>
            </div>
          )
        })}
      </div>
      {nextCursor && !status.error && <div className="button-row"><button className="ghost-button" type="button" onClick={() => void onLoadMore()} disabled={loadingMore || !canRead}>{loadingMore ? textFor(t, 'Loading', '加载中') : textFor(t, 'Load more', '加载更多')}</button></div>}
      <GenerationDetail t={t} state={state} setters={setters} canReadQueues={canReadQueues} canCancel={canCancel} canRequestRetries={canRequestRetries} canRequestManualReplay={canRequestManualReplay} canRepairAccounting={canRepairAccounting} onFocusMedia={onFocusMedia} onMutation={onMutation} onSettleProviderCost={onSettleProviderCost} formatTime={formatTime} formatProviderCostAmount={formatProviderCostAmount} formatProviderCostSummary={formatProviderCostSummary} formatProviderBudgetSummary={formatProviderBudgetSummary} />
    </>
  )
}
