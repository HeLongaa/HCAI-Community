import type { AsyncResourceState } from '../../domain/types'
import { textFor } from '../../domain/utils'
import type { useAdminGenerationState } from './useAdminGenerationState'

type GenerationState = ReturnType<typeof useAdminGenerationState>

type Props = {
  t: Record<string, string>
  state: GenerationState['state']
  setters: GenerationState['setters']
  status: AsyncResourceState
  canRead: boolean
  onClearFilters: () => void
  formatNumber: (value: number | null | undefined) => string
}

const workspaces = ['image', 'video', 'music', 'chat']

export function AdminGenerationMetricsPanel({ t, state, setters, status, canRead, onClearFilters, formatNumber }: Props) {
  const { metricsWorkspace, metricsProviderId, metricsDateFrom, metricsDateTo, metricsSummary, businessMetrics } = state
  const { setMetricsWorkspace, setMetricsProviderId, setMetricsDateFrom, setMetricsDateTo } = setters

  return (
    <>
      <div className="permission-summary generation-metrics-filters" data-testid="admin-generation-metrics-filters">
        <label>
          <span>{textFor(t, 'Workspace', '工作区')}</span>
          <select aria-label={textFor(t, 'Metrics workspace', '指标工作区')} value={metricsWorkspace} onChange={(event) => setMetricsWorkspace(event.target.value)} disabled={!canRead}>
            <option value="">{textFor(t, 'All workspaces', '全部工作区')}</option>
            {workspaces.map((workspace) => <option value={workspace} key={workspace}>{workspace}</option>)}
          </select>
        </label>
        <label>
          <span>{textFor(t, 'Provider', '提供方')}</span>
          <input aria-label={textFor(t, 'Metrics provider', '指标提供方')} value={metricsProviderId} onChange={(event) => setMetricsProviderId(event.target.value)} placeholder="provider-id" disabled={!canRead} />
        </label>
        <label>
          <span>{textFor(t, 'From', '开始日期')}</span>
          <input aria-label={textFor(t, 'Metrics date from', '指标开始日期')} type="date" value={metricsDateFrom} onChange={(event) => setMetricsDateFrom(event.target.value)} disabled={!canRead} />
        </label>
        <label>
          <span>{textFor(t, 'To', '结束日期')}</span>
          <input aria-label={textFor(t, 'Metrics date to', '指标结束日期')} type="date" value={metricsDateTo} onChange={(event) => setMetricsDateTo(event.target.value)} disabled={!canRead} />
        </label>
        <button className="ghost-button" type="button" onClick={onClearFilters} disabled={!metricsWorkspace && !metricsProviderId && !metricsDateFrom && !metricsDateTo}>
          {textFor(t, 'Clear filters', '清除筛选')}
        </button>
      </div>
      {status.loading && <div className="empty-state"><strong>{textFor(t, 'Loading business metrics', '正在加载业务指标')}</strong></div>}
      {status.error && <div className="inline-alert error" role="alert">{status.error}</div>}
      {!status.loading && !status.error && (
        <div className="market-dashboard generation-volume-metrics">
          {[
            [textFor(t, 'Total records', '记录总数'), metricsSummary.total, textFor(t, 'Complete filtered dataset', '完整筛选数据集')],
            [textFor(t, 'Active', '进行中'), metricsSummary.active, textFor(t, 'Queued or running', '排队中或运行中')],
            [textFor(t, 'Needs review', '需要复核'), metricsSummary.reviewRequired, textFor(t, 'Active governance gates', '当前治理门禁')],
            [textFor(t, 'Output assets', '输出资产'), metricsSummary.outputAssets, textFor(t, 'Linked governed assets', '已关联治理资产')],
          ].map(([label, value, detail]) => (
            <article className="metric-card highlight" key={label}>
              <span>{label}</span>
              <strong>{formatNumber(Number(value))}</strong>
              <small>{detail}</small>
            </article>
          ))}
        </div>
      )}
      {businessMetrics && !status.loading && !status.error && (
        <div className="market-dashboard generation-business-metrics" data-testid="generation-business-metrics">
          {[
            [textFor(t, 'Success rate', '成功率'), `${businessMetrics.quality.successRatePercent}%`, `${businessMetrics.quality.completed}/${businessMetrics.totals.terminal} ${textFor(t, 'terminal', '终态')}`],
            [textFor(t, 'P95 latency', 'P95 时延'), businessMetrics.latency.p95Ms == null ? textFor(t, 'Unavailable', '不可用') : `${Math.round(businessMetrics.latency.p95Ms / 1000)}s`, `${businessMetrics.latency.samples} ${textFor(t, 'samples', '样本')}`],
            [textFor(t, 'Settled credits', '已结算 Credit'), formatNumber(businessMetrics.internalUnits.settledCredits), `${formatNumber(businessMetrics.internalUnits.compensatedCredits)} ${textFor(t, 'internally compensated', '内部补偿')}`],
            [textFor(t, 'Reuse conversion', '复用转化'), `${businessMetrics.conversion.conversionRatePercent}%`, `${businessMetrics.conversion.convertedOutputAssets}/${businessMetrics.conversion.eligibleOutputAssets} ${textFor(t, 'outputs', '输出')}`],
            [textFor(t, 'Review rate', '复核率'), `${businessMetrics.quality.reviewRatePercent}%`, `${businessMetrics.quality.reviewRequired} ${textFor(t, 'gated', '已进入门禁')}`],
            [textFor(t, 'Provider cost', 'Provider 成本'), businessMetrics.providerCost.availability === 'available' ? businessMetrics.providerCost.currencies.map((item) => item.currency).join(', ') : textFor(t, 'Unavailable', '不可用'), businessMetrics.providerCost.availability === 'available' ? `${businessMetrics.providerCost.currencies.reduce((sum, item) => sum + item.ledgers, 0)} ${textFor(t, 'ledgers', '台账')}` : textFor(t, 'No cost ledger in this window', '当前窗口无成本台账')],
          ].map(([label, value, detail]) => (
            <article className="metric-card" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
              <small>{detail}</small>
            </article>
          ))}
        </div>
      )}
    </>
  )
}
