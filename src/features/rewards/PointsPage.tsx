import { Trophy } from 'lucide-react'
import type { AsyncResourceState, LedgerEntry, SimulateAction } from '../../domain/types'
import { SectionHeader } from '../../components/ui/SectionHeader'
import { isZhCopy, matchesLanguage, pointText, textFor } from '../../domain/utils'
import type { ApiPointsSummary } from '../../services/contracts'

export function PointsPage({
  t,
  ledger,
  summary,
  status,
  simulateAction,
}: {
  t: Record<string, string>
  ledger: LedgerEntry[]
  summary: ApiPointsSummary | null
  status: AsyncResourceState
  simulateAction: SimulateAction
}) {
  const isZh = isZhCopy(t)
  const metrics = summary
    ? isZh
      ? [
          ['可用余额', pointText(String(summary.available)), '可立即用于任务加权、兑换和发布托管'],
          ['冻结托管', pointText(String(summary.frozen)), '已发布任务的待验收奖励托管'],
          ['待结算', pointText(String(summary.pendingSettlement)), '等待验收或系统确认的正向积分'],
          ['累计收入', pointText(String(summary.lifetimeEarned)), '历史已结算任务、社区和内容收益'],
        ]
      : [
          ['Available', pointText(String(summary.available)), 'Ready for boosts, redemptions, and task escrow'],
          ['Frozen', pointText(String(summary.frozen)), 'Rewards held for posted tasks awaiting review'],
          ['Pending', pointText(String(summary.pendingSettlement)), 'Positive points waiting for acceptance or system settlement'],
          ['Lifetime earned', pointText(String(summary.lifetimeEarned)), 'Settled task, community, and library earnings'],
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
  const scopedLedger = ledger.filter(([, description]) => matchesLanguage(description, isZh))
  const visibleLedger = scopedLedger.length ? scopedLedger : ledger

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
      <section className="panel">
        <SectionHeader eyebrow={textFor(t, 'Ledger', '积分流水')} title={textFor(t, 'Points history', '积分记录')} />
        {(status.loading || status.error) && (
          <div className="empty-state">
            <strong>
              {status.loading
                ? textFor(t, 'Syncing points', '正在同步积分')
                : textFor(t, 'Points API unavailable', '积分 API 暂不可用')}
            </strong>
            <span>
              {status.loading
                ? textFor(t, 'Loading the latest points ledger from the API.', '正在从 API 加载最新积分流水。')
                : status.error}
            </span>
            {status.error && (
              <button className="ghost-button" type="button" onClick={() => void status.refresh()}>
                {textFor(t, 'Retry sync', '重试同步')}
              </button>
            )}
          </div>
        )}
        <div className="ledger-table">
          {visibleLedger.map(([time, desc, delta, balance]) => (
            <div className="ledger-row" key={`${time}-${desc}`}>
              <span>{time}</span>
              <strong>{desc}</strong>
              <b className={delta.startsWith('+') ? 'positive' : 'negative'}>{delta}</b>
              <span>{balance}</span>
            </div>
          ))}
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
