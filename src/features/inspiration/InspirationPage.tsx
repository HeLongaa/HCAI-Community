import { useState } from 'react'
import { ArrowLeft, LayoutDashboard, Plus, Bookmark, MessageCircle } from 'lucide-react'
import type { InspirationItem, Page, SimulateAction } from '../../domain/types'
import { SectionHeader } from '../../components/ui/SectionHeader'
import { InfoBox } from '../tasks'
import { categoryLabel, isZhCopy, localizedInspiration, textFor } from '../../domain/utils'

export function InspirationPage({
  t,
  items,
  setPage,
  simulateAction,
}: {
  t: Record<string, string>
  items: InspirationItem[]
  setPage: (page: Page) => void
  simulateAction: SimulateAction
}) {
  const isZh = isZhCopy(t)
  const categories = ['Featured', 'Task templates', 'Prompt packs', 'Tutorials', 'Case studies', 'Good idea radar']
  const categoryLabels: Record<string, string> = {
    Featured: textFor(t, 'Featured', '精选'),
    'Task templates': textFor(t, 'Task templates', '任务模板'),
    'Prompt packs': textFor(t, 'Prompt packs', '提示词包'),
    Tutorials: textFor(t, 'Tutorials', '教程'),
    'Case studies': textFor(t, 'Case studies', '案例复盘'),
    'Good idea radar': textFor(t, 'Good idea radar', '好点子雷达'),
  }
  const [activeCategory, setActiveCategory] = useState('Featured')
  const [selectedItem, setSelectedItem] = useState<InspirationItem | undefined>()
  const scopedItems = localizedInspiration(items, t)
  const visibleItems =
    activeCategory === 'Featured'
      ? scopedItems
      : scopedItems.filter((item) => {
          const content = `${item.title} ${item.type} ${item.source} ${item.text}`.toLowerCase()
          if (activeCategory === 'Task templates') return content.includes('template') || content.includes('模板')
          if (activeCategory === 'Prompt packs') return content.includes('prompt') || content.includes('提示词')
          if (activeCategory === 'Tutorials') return content.includes('guide') || content.includes('教程')
          if (activeCategory === 'Case studies') return content.includes('recap') || content.includes('复盘') || content.includes('案例')
          return true
        })
  const activeItem = selectedItem
  const openDetail = (item: InspirationItem) => {
    setSelectedItem(item)
    simulateAction(isZh ? `已打开灵感详情：${item.title}` : `Opened inspiration detail: ${item.title}`)
  }
  const transferToTask = (item: InspirationItem) => {
    simulateAction(isZh ? `已将灵感转成任务草稿：${item.title}` : `Converted inspiration to task draft: ${item.title}`)
    setPage('publish')
  }
  const transferToWorkbench = (item: InspirationItem) => {
    simulateAction(isZh ? `已将灵感发送到创作工作台：${item.title}` : `Sent inspiration to workspace: ${item.title}`)
    setPage('playground')
  }

  if (activeItem) {
    const detailItems = isZh
      ? [
          `保留来源：${activeItem.source}`,
          `可复用类型：${categoryLabel(activeItem.type, t)}`,
          '进入发布页后补充预算、截止时间、验收规则和附件。',
        ]
      : [
          `Keep source context: ${activeItem.source}`,
          `Reusable type: ${activeItem.type}`,
          'Add budget, deadline, acceptance rules, and attachments after opening the publish flow.',
        ]
    const workbenchItems = isZh
      ? ['作为提示词起点生成图片、视频、音乐或脚本。', '在对话中继续拆解交付物、风格限制和修改轮次。', '把产出的草稿再带回任务广场发布。']
      : ['Use it as a prompt seed for image, video, music, or script work.', 'Continue scoping deliverables, style constraints, and revision rounds in chat.', 'Bring the drafted output back to Task Plaza when it is ready.']

    return (
      <div className="stack">
        <div className="detail-top button-row">
          <button className="ghost-button" type="button" onClick={() => setSelectedItem(undefined)}>
            <ArrowLeft size={17} />
            {t.backToParent}
          </button>
          <div className="button-row">
            <button className="ghost-button" type="button" onClick={() => transferToWorkbench(activeItem)}>
              <LayoutDashboard size={17} />
              {textFor(t, 'To workspace', '转工作台')}
            </button>
            <button className="primary-button" type="button" onClick={() => transferToTask(activeItem)}>
              <Plus size={17} />
              {textFor(t, 'Turn into task', '转成任务')}
            </button>
          </div>
        </div>
        <article className="library-detail">
          <span className="pill small">{categoryLabel(activeItem.type, t)}</span>
          <span className="library-save-count">{activeItem.saves} {textFor(t, 'saves', '收藏')}</span>
          <h2>{activeItem.title}</h2>
          <p>{activeItem.text}</p>
          <div className="detail-stats">
            <span>{textFor(t, 'Source', '来源')}：{activeItem.source}</span>
            <span>{textFor(t, 'Format', '类型')}：{categoryLabel(activeItem.type, t)}</span>
            <span>{textFor(t, 'Saved', '收藏')}：{activeItem.saves}</span>
            <span>{textFor(t, 'Ready to reuse', '可复用')}</span>
          </div>
          <div className="detail-section-grid">
            <InfoBox title={textFor(t, 'Task conversion notes', '转任务要点')} items={detailItems} />
            <InfoBox title={textFor(t, 'Workspace usage', '工作台用法')} items={workbenchItems} />
          </div>
        </article>
      </div>
    )
  }

  return (
    <div className="stack">
      <SectionHeader
        eyebrow={textFor(t, 'Knowledge base', '知识库')}
        title={t.inspirationTitle}
        action={
          <button className="primary-button" type="button" onClick={() => visibleItems[0] && transferToTask(visibleItems[0])}>
            <Plus size={17} />
            {textFor(t, 'Turn into task', '转成任务')}
          </button>
        }
      />
      <div className="chip-row">
        {categories.map((item) => (
          <button
            className={activeCategory === item ? 'chip active' : 'chip'}
            type="button"
            key={item}
            onClick={() => {
              setActiveCategory(item)
              simulateAction(isZh ? `已切换灵感分类：${categoryLabels[item]}` : `Inspiration category changed: ${item}`)
            }}
          >
            {categoryLabels[item]}
          </button>
        ))}
      </div>
      <div className="content-grid three">
        {visibleItems.map((item) => (
          <article
            className="library-card"
            key={item.title}
            role="button"
            tabIndex={0}
            onClick={() => openDetail(item)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                openDetail(item)
              }
            }}
          >
            <h3>{item.title}</h3>
            <p>{item.text}</p>
            <div className="split-row">
              <span>{item.source}</span>
              <span className="library-save-count">{item.saves} {textFor(t, 'saves', '收藏')}</span>
            </div>
            <div className="library-card-actions">
              <button
                className="ghost-button"
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  simulateAction(isZh ? `已收藏灵感：${item.title}` : `Saved inspiration: ${item.title}`, {
                    description: `Saved inspiration item: ${item.title}`,
                    delta: '+10',
                  })
                }}
              >
                <Bookmark size={17} />
                {textFor(t, 'Save', '收藏')}
              </button>
              <button
                className="ghost-button"
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  openDetail(item)
                }}
              >
                <MessageCircle size={17} />
                {textFor(t, 'View details', '查看详情')}
              </button>
            </div>
          </article>
        ))}
        {visibleItems.length === 0 && (
          <div className="empty-state">
            <strong>{textFor(t, 'No matching inspiration', '暂无匹配灵感')}</strong>
            <span>{textFor(t, 'Switch category or save community posts to the library.', '切换分类或从社区帖子收入灵感库后再查看。')}</span>
          </div>
        )}
      </div>
    </div>
  )
}
