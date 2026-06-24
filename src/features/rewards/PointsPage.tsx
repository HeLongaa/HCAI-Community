import { Trophy } from 'lucide-react'
import type { LedgerEntry, SimulateAction } from '../../domain/types'
import { SectionHeader } from '../../components/ui/SectionHeader'
import { isZhCopy, matchesLanguage, textFor } from '../../domain/utils'

export function PointsPage({
  t,
  ledger,
  simulateAction,
}: {
  t: Record<string, string>
  ledger: LedgerEntry[]
  simulateAction: SimulateAction
}) {
  const isZh = isZhCopy(t)
  const metrics = isZh
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
