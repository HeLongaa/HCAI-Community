import { useState } from 'react'
import { Trophy } from 'lucide-react'
import type { Page, SimulateAction, Task } from '../../domain/types'
import { SectionHeader } from '../../components/ui/SectionHeader'
import { StatusBadge } from '../tasks'
import { adminQueues } from '../../data/mockData'
import { isZhCopy, textFor } from '../../domain/utils'

export function AdminPage({
  t,
  selectedTask,
  setPage,
  approveTask,
  rejectTask,
  simulateAction,
}: {
  t: Record<string, string>
  selectedTask: Task
  setPage: (page: Page) => void
  approveTask: (task: Task) => void
  rejectTask: (task: Task) => void
  simulateAction: SimulateAction
}) {
  const isZh = isZhCopy(t)
  const adminTabs = ['Task review', 'Submissions', 'Community', 'Users', 'Tags', 'AI config']
  const adminTabLabels: Record<string, string> = {
    'Task review': textFor(t, 'Task review', '任务审核'),
    Submissions: textFor(t, 'Submissions', '交付物'),
    Community: textFor(t, 'Community', '社区'),
    Users: textFor(t, 'Users', '用户'),
    Tags: textFor(t, 'Tags', '标签'),
    'AI config': textFor(t, 'AI config', 'AI 配置'),
  }
  const queueItems = isZh
    ? [
        ['Pending review', '音乐提示词包', 'soundforge', '验收后发放 1,200 积分'],
        ['Resubmission', '电商图片广告工作流', 'shopstudio', '已驳回一次，需要补充品类样例'],
        ['Community report', 'AI 任务定价讨论帖', 'n8than', '可考虑精选到灵感库'],
        ['Publish audit', '产品发布视频需求', 'launchteam', '检查私密附件权限'],
      ]
    : adminQueues
  const [activeTab, setActiveTab] = useState('Task review')

  return (
    <div className="stack">
      <SectionHeader
        eyebrow={textFor(t, 'Operations', '运营')}
        title={t.adminTitle}
        action={
          <button className="ghost-button" type="button" onClick={() => setPage('points')}>
            <Trophy size={17} />
            {textFor(t, 'Points ledger', '积分流水')}
          </button>
        }
      />
      <div className="chip-row">
        {adminTabs.map((item) => (
          <button
            className={activeTab === item ? 'chip active' : 'chip'}
            type="button"
            key={item}
            onClick={() => {
              setActiveTab(item)
              simulateAction(isZh ? `管理中心已切换：${adminTabLabels[item]}` : `Admin tab changed: ${item}`)
            }}
          >
            {adminTabLabels[item]}
          </button>
        ))}
      </div>
      <section className="panel">
        <SectionHeader eyebrow={textFor(t, 'Queue', '队列')} title={textFor(t, 'Review and moderation', '审核与治理')} />
        <div className="admin-table">
          {queueItems.map(([status, title, owner, note]) => (
            <div className="admin-row" key={`${status}-${title}`}>
              <StatusBadge status={status} t={t} />
              <strong>{title}</strong>
              <span>@{owner}</span>
              <small>{note}</small>
              <div className="button-row">
                <button className="ghost-button" type="button" onClick={() => rejectTask(selectedTask)}>
                  {textFor(t, 'Reject', '驳回')}
                </button>
                <button className="primary-button" type="button" onClick={() => approveTask(selectedTask)}>
                  {textFor(t, 'Approve', '通过')}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
