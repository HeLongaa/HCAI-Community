import { useState } from 'react'
import { Download, RefreshCw, ShieldCheck, Trophy } from 'lucide-react'
import type { AsyncResourceState, LedgerEntry, SimulateAction } from '../../domain/types'
import { SectionHeader } from '../../components/ui/SectionHeader'
import { isZhCopy, pointText, textFor } from '../../domain/utils'
import type { ApiPointsSummary, EffectiveEntitlementDto, PersonalBillingEntry, PersonalBillingStatus, PersonalBillingSummary, PersonalBillingUnit } from '../../services/contracts'
import { entitlementService } from '../../services/entitlementService'
import { billingService } from '../../services/billingService'
import { useAsyncResource } from '../../hooks/useAsyncResource'

export function PointsPage({
  t,
  summary,
  simulateAction,
}: {
  t: Record<string, string>
  ledger: LedgerEntry[]
  summary: ApiPointsSummary | null
  status: AsyncResourceState
  simulateAction: SimulateAction
}) {
  const isZh = isZhCopy(t)
  const [entitlement, setEntitlement] = useState<EffectiveEntitlementDto | null>(null)
  const [billingSummary, setBillingSummary] = useState<PersonalBillingSummary | null>(null)
  const [billingEntries, setBillingEntries] = useState<PersonalBillingEntry[]>([])
  const [billingUnit, setBillingUnit] = useState<PersonalBillingUnit | ''>('')
  const [billingStatusFilter, setBillingStatusFilter] = useState<PersonalBillingStatus | ''>('')
  const [billingSearch, setBillingSearch] = useState('')
  const [billingDateFrom, setBillingDateFrom] = useState('')
  const [billingDateTo, setBillingDateTo] = useState('')
  const entitlementStatus = useAsyncResource({
    load: entitlementService.me,
    onSuccess: setEntitlement,
    getErrorMessage: () => textFor(t, 'Could not load your product access.', '无法读取当前产品权益。'),
    deps: [isZh],
    logLabel: 'entitlement-service',
  })
  const billingStatus = useAsyncResource({
    load: async () => {
      const query = { unit: billingUnit || null, status: billingStatusFilter || null, search: billingSearch || null, dateFrom: billingDateFrom || null, dateTo: billingDateTo || null, sort: 'desc' as const, limit: 100 }
      const [nextSummary, ledgerPage] = await Promise.all([billingService.summary(), billingService.ledger(query)])
      return { summary: nextSummary, entries: ledgerPage.items }
    },
    onSuccess: ({ summary: nextSummary, entries }) => { setBillingSummary(nextSummary); setBillingEntries(entries) },
    getErrorMessage: () => textFor(t, 'Could not load billing details.', '无法读取账务明细。'),
    deps: [isZh, billingUnit, billingStatusFilter, billingSearch, billingDateFrom, billingDateTo],
    logLabel: 'billing-service',
  })
  const effectivePoints = billingSummary?.points ?? summary
  const metrics = billingSummary
    ? isZh
      ? [
          ['可用积分', pointText(String(billingSummary.points.available)), '可立即使用的已结算积分'],
          ['冻结与待结算', pointText(String(billingSummary.points.frozen + billingSummary.points.pendingSettlement)), '任务托管与待确认积分'],
          ['创作 Credit', String(billingSummary.creativeCredits.settled), `${billingSummary.creativeCredits.refunded} 已退款`],
          ['剩余配额', String(billingSummary.quotas.remaining), `${billingSummary.quotas.used}/${billingSummary.quotas.limit} 已使用`],
        ]
      : [
          ['Available points', pointText(String(billingSummary.points.available)), 'Settled points ready to use'],
          ['Frozen and pending', pointText(String(billingSummary.points.frozen + billingSummary.points.pendingSettlement)), 'Task escrow and pending settlement'],
          ['Creative credits', String(billingSummary.creativeCredits.settled), `${billingSummary.creativeCredits.refunded} refunded`],
          ['Quota remaining', String(billingSummary.quotas.remaining), `${billingSummary.quotas.used}/${billingSummary.quotas.limit} used`],
        ]
    : effectivePoints
    ? isZh
      ? [
          ['可用余额', pointText(String(effectivePoints.available)), '可立即用于任务加权、兑换和发布托管'],
          ['冻结托管', pointText(String(effectivePoints.frozen)), '已发布任务的待验收奖励托管'],
          ['待结算', pointText(String(effectivePoints.pendingSettlement)), '等待验收或系统确认的正向积分'],
          ['累计收入', pointText(String(effectivePoints.lifetimeEarned)), '历史已结算任务、社区和内容收益'],
        ]
      : [
          ['Available', pointText(String(effectivePoints.available)), 'Ready for boosts, redemptions, and task escrow'],
          ['Frozen', pointText(String(effectivePoints.frozen)), 'Rewards held for posted tasks awaiting review'],
          ['Pending', pointText(String(effectivePoints.pendingSettlement)), 'Positive points waiting for acceptance or system settlement'],
          ['Lifetime earned', pointText(String(effectivePoints.lifetimeEarned)), 'Settled task, community, and library earnings'],
        ]
    : isZh
    ? [
        ['余额', '18,420', '可用于任务加权和奖励兑换'],
        ['待结算', '4,100', '等待验收和发布方确认'],
        ['排名', '前 4%', '基于已验收任务和已解决回答'],
        ['本月新增', '+6,840', '任务交付、社区回答、模板入库'],
      ]
    : [
        ['Balance', '18,420', 'Available points for boosts and rewards'],
        ['Pending', '4,100', 'Awaiting review and publisher acceptance'],
        ['Rank', 'Top 4%', 'Based on accepted tasks and solved answers'],
        ['This month', '+6,840', 'Task delivery, community answers, templates'],
      ]
  const rewards = isZh
    ? [
        ['加权任务曝光', '-200'],
        ['解锁专业模板', '-120'],
        ['兑换创作者徽章', '-300'],
      ]
    : [
        ['Boost a task listing', '-200'],
        ['Unlock pro templates', '-120'],
        ['Redeem creator badge', '-300'],
      ]
  const exportBilling = async () => {
    const csv = await billingService.exportCsv({ unit: billingUnit || null, status: billingStatusFilter || null, search: billingSearch || null, dateFrom: billingDateFrom || null, dateTo: billingDateTo || null, sort: 'desc' })
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'billing-ledger.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="stack">
      <SectionHeader eyebrow={textFor(t, 'Rewards', '奖励')} title={t.pointsTitle} />
      <div className="market-dashboard">
        {metrics.map(([label, value, text]) => (
          <article className="metric-card highlight" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{text}</small>
          </article>
        ))}
      </div>
      <section className="panel entitlement-summary" data-testid="personal-entitlement-summary">
        <SectionHeader
          eyebrow={textFor(t, 'Product access', '产品权益')}
          title={entitlement?.plan.title ?? textFor(t, 'Personal access', '个人权益')}
          action={
            <button className="icon-button" type="button" title={textFor(t, 'Refresh access', '刷新权益')} aria-label={textFor(t, 'Refresh access', '刷新权益')} onClick={() => void entitlementStatus.refresh()} disabled={entitlementStatus.loading}>
              <RefreshCw size={16} />
            </button>
          }
        />
        {entitlementStatus.error && <div className="empty-state compact"><strong>{textFor(t, 'Access unavailable', '权益暂不可用')}</strong><span>{entitlementStatus.error}</span></div>}
        {!entitlementStatus.error && (
          <div className="entitlement-summary-grid">
            <div className="entitlement-plan-identity">
              <ShieldCheck size={22} />
              <div>
                <strong>{entitlementStatus.loading ? textFor(t, 'Loading access', '正在加载权益') : entitlement?.plan.key ?? '-'}</strong>
                <span>{entitlement?.source === 'personal_grant' ? textFor(t, 'Assigned personal plan', '已分配个人方案') : textFor(t, 'Role-compatible default', '角色默认权益')}</span>
                <small>{entitlement?.planVersion.label ?? '-'}</small>
              </div>
            </div>
            <div className="entitlement-capability-count">
              <span>{textFor(t, 'Enabled capabilities', '已启用能力')}</span>
              <strong>{Object.values(entitlement?.capabilities ?? {}).filter(Boolean).length}</strong>
              <small>{Object.keys(entitlement?.capabilities ?? {}).length} {textFor(t, 'evaluated', '项已评估')}</small>
            </div>
            <div className="entitlement-quota-list">
              {Object.entries(entitlement?.quotas ?? {}).map(([key, limit]) => (
                <div key={key}><span>{key.replace('creative.daily.', '')}</span><strong>{limit}</strong></div>
              ))}
              {!entitlementStatus.loading && Object.keys(entitlement?.quotas ?? {}).length === 0 && <span>{textFor(t, 'No quota entries', '暂无配额项')}</span>}
            </div>
          </div>
        )}
      </section>
      <section className="panel billing-ledger-panel" data-testid="personal-billing-ledger">
        <SectionHeader eyebrow={textFor(t, 'Billing ledger', '账务流水')} title={textFor(t, 'Points, credits, quota, and refunds', '积分、Credit、配额与退款')} action={<div className="button-row"><button className="icon-button" type="button" title={textFor(t, 'Export CSV', '导出 CSV')} aria-label={textFor(t, 'Export billing CSV', '导出账务 CSV')} onClick={() => void exportBilling()}><Download size={16}/></button><button className="icon-button" type="button" title={textFor(t, 'Refresh billing', '刷新账务')} aria-label={textFor(t, 'Refresh billing', '刷新账务')} onClick={() => void billingStatus.refresh()}><RefreshCw size={16}/></button></div>} />
        <div className="billing-ledger-filters">
          <select aria-label={textFor(t, 'Billing unit', '账务单位')} value={billingUnit} onChange={(event) => setBillingUnit(event.target.value as PersonalBillingUnit | '')}><option value="">{textFor(t, 'All units', '全部单位')}</option><option value="points">points</option><option value="creative_credit">creative_credit</option><option value="quota_unit">quota_unit</option></select>
          <select aria-label={textFor(t, 'Billing status', '账务状态')} value={billingStatusFilter} onChange={(event) => setBillingStatusFilter(event.target.value as PersonalBillingStatus | '')}><option value="">{textFor(t, 'All statuses', '全部状态')}</option>{['pending', 'settled', 'cancelled', 'reserved', 'refunded', 'committed', 'released'].map((value) => <option key={value} value={value}>{value}</option>)}</select>
          <input aria-label={textFor(t, 'Search billing sources', '搜索账务来源')} placeholder={textFor(t, 'Search source or reason', '搜索来源或原因')} value={billingSearch} onChange={(event) => setBillingSearch(event.target.value)} />
          <input aria-label={textFor(t, 'Billing from date', '账务开始日期')} type="date" value={billingDateFrom} onChange={(event) => setBillingDateFrom(event.target.value)} />
          <input aria-label={textFor(t, 'Billing to date', '账务结束日期')} type="date" value={billingDateTo} onChange={(event) => setBillingDateTo(event.target.value)} />
        </div>
        {(billingStatus.loading || billingStatus.error) && (
          <div className="empty-state">
            <strong>
              {billingStatus.loading
                ? textFor(t, 'Syncing billing', '正在同步账务')
                : textFor(t, 'Billing API unavailable', '账务 API 暂不可用')}
            </strong>
            <span>{billingStatus.loading ? textFor(t, 'Loading durable accounting facts.', '正在读取持久化账务事实。') : billingStatus.error}</span>
            {billingStatus.error && (
              <button className="ghost-button" type="button" onClick={() => void billingStatus.refresh()}>
                {textFor(t, 'Retry sync', '重试同步')}
              </button>
            )}
          </div>
        )}
        <div className="ledger-table">
          {!billingStatus.loading && !billingStatus.error && billingEntries.map((entry) => <div className="ledger-row billing-ledger-row" key={entry.id}><span>{new Date(entry.occurredAt).toLocaleString()}</span><strong>{entry.description}<small>{entry.sourceType} · {entry.sourceId ?? '-'}</small></strong><b className={entry.amount >= 0 ? 'positive' : 'negative'}>{entry.amount > 0 ? '+' : ''}{entry.amount}</b><span>{entry.unit}<small>{entry.status}</small></span></div>)}
          {!billingStatus.loading && !billingStatus.error && billingEntries.length === 0 && <div className="empty-state compact"><strong>{textFor(t, 'No matching billing entries', '没有匹配的账务明细')}</strong></div>}
        </div>
      </section>
      <div className="content-grid three">
        {rewards.map(([item, cost]) => (
          <article className="library-card" key={item}>
            <Trophy size={22} />
            <h3>{item}</h3>
            <p>{textFor(t, 'Use points earned from accepted work, helpful posts, and featured library contributions.', '使用任务验收、优质帖子和精选灵感贡献获得的积分。')}</p>
            <button
              className="ghost-button"
              type="button"
              onClick={() =>
                simulateAction(isZh ? `已兑换：${item}` : `Redeemed: ${item}`, {
                  description: `Redeemed reward: ${item}`,
                  delta: cost,
                })
              }
            >
              {textFor(t, 'Redeem', '兑换')}
            </button>
          </article>
        ))}
      </div>
    </div>
  )
}
