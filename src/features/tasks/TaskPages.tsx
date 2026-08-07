import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  BadgeDollarSign,
  BriefcaseBusiness,
  Check,
  ChevronRight,
  Clock3,
  MessageCircle,
  Plus,
  Search,
  Send,
  Sparkles,
  Upload,
  UsersRound,
  X,
} from 'lucide-react'
import type { AsyncResourceState, MarketplaceProfile, Page, PublishDraft, SimulateAction, Task, TaskProposalDraft } from '../../domain/types'
import { SectionHeader } from '../../components/ui/SectionHeader'
import { StatusBadge } from '../../components/ui/StatusBadge'
import type { TaskChildCollection } from '../../hooks/useTaskWorkflows'
import { uploadMediaFile } from '../../services/mediaUpload'
import type { ApiAcceptanceChecklistItem, ApiMediaAsset, ApiProfileSummary, ApiTaskProposal, ApiTaskSubmission, ApiTaskTimelineItem, ApiTaskWorkflow, MediaAssetPurpose, TaskRule } from '../../services/contracts'
import { taskService } from '../../services/taskService'
import {
  categoryLabel,
  isZhCopy,
  localizedTasks,
  publishFieldLabel,
  statusLabel,
  textFor,
} from '../../domain/utils'

const taskMarketStateKey = 'hcaiTaskMarketplaceState'

type TaskMarketSavedState = {
  search: string
  category: string
  minimumPoints: string
  scrollY: number
}

const defaultTaskMarketState: TaskMarketSavedState = { search: '', category: 'All', minimumPoints: 'all', scrollY: 0 }

const readTaskMarketState = (): TaskMarketSavedState => {
  try {
    const stored = window.sessionStorage.getItem(taskMarketStateKey)
    return stored ? { ...defaultTaskMarketState, ...JSON.parse(stored) } : defaultTaskMarketState
  } catch {
    return defaultTaskMarketState
  }
}

const taskIdFromHash = () => {
  const match = window.location.hash.match(/^#tasks\/([^?]+)/)
  return match ? decodeURIComponent(match[1]) : null
}

const formatTaskDeadline = (value: string, isZh: boolean) => {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  return new Intl.DateTimeFormat(isZh ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(timestamp)
}

export function TasksPage({
  t,
  tasks,
  setPage,
  submitProposal,
  setSelectedTask,
  status,
}: {
  t: Record<string, string>
  tasks: Task[]
  setPage: (page: Page) => void
  openProfile: (profile: MarketplaceProfile) => void
  submitProposal: (task: Task, draft: TaskProposalDraft) => Promise<boolean>
  selectedTask: Task | null
  setSelectedTask: (task: Task | null) => void
  status: AsyncResourceState
}) {
  const isZh = isZhCopy(t)
  const scopedTasks = localizedTasks(tasks, t)
  const openTasks = scopedTasks.filter((task) => task.status === 'Open')
  const categories = ['All', ...Array.from(new Set(openTasks.map((task) => task.category)))]
  const initialState = useMemo(() => readTaskMarketState(), [])
  const [activeCategory, setActiveCategory] = useState(initialState.category)
  const [search, setSearch] = useState(initialState.search)
  const [minimumPoints, setMinimumPoints] = useState(initialState.minimumPoints)
  const [detailTaskId, setDetailTaskId] = useState(taskIdFromHash)
  const [proposalOpen, setProposalOpen] = useState(false)
  const openTaskCount = openTasks.length
  const normalizedSearch = search.trim().toLocaleLowerCase()
  const visibleTasks = openTasks.filter((task) => {
    const categoryMatches = activeCategory === 'All' || task.category === activeCategory
    const searchMatches = !normalizedSearch || [task.title, task.description, task.publisher]
      .some((value) => value.toLocaleLowerCase().includes(normalizedSearch))
    const pointValue = Number.parseInt(task.points.replace(/[^\d]/g, ''), 10) || 0
    const rewardMatches = minimumPoints === 'all' || pointValue >= Number(minimumPoints)
    return categoryMatches && searchMatches && rewardMatches
  })
  const detailTask = detailTaskId ? scopedTasks.find((task) => String(task.id) === detailTaskId) ?? null : null

  useEffect(() => {
    const current = readTaskMarketState()
    window.sessionStorage.setItem(taskMarketStateKey, JSON.stringify({ ...current, search, category: activeCategory, minimumPoints }))
  }, [activeCategory, minimumPoints, search])

  useEffect(() => {
    const syncRoute = () => {
      const nextTaskId = taskIdFromHash()
      setDetailTaskId(nextTaskId)
      if (!nextTaskId) {
        const saved = readTaskMarketState()
        window.requestAnimationFrame(() => window.scrollTo({ top: saved.scrollY, behavior: 'instant' }))
      }
    }
    window.addEventListener('hashchange', syncRoute)
    window.addEventListener('popstate', syncRoute)
    window.addEventListener('hcai:navigation', syncRoute)
    return () => {
      window.removeEventListener('hashchange', syncRoute)
      window.removeEventListener('popstate', syncRoute)
      window.removeEventListener('hcai:navigation', syncRoute)
    }
  }, [])

  const openTask = (task: Task) => {
    window.sessionStorage.setItem(taskMarketStateKey, JSON.stringify({ search, category: activeCategory, minimumPoints, scrollY: window.scrollY }))
    window.history.pushState({ hcaiTaskDetailFromList: true }, '', `#tasks/${encodeURIComponent(String(task.id))}`)
    setSelectedTask(task)
    setDetailTaskId(String(task.id))
    window.scrollTo({ top: 0, behavior: 'instant' })
    window.dispatchEvent(new Event('hcai:navigation'))
  }

  const returnToList = () => {
    setProposalOpen(false)
    if (window.history.state?.hcaiTaskDetailFromList) {
      window.history.back()
      return
    }
    window.history.pushState(null, '', '#tasks')
    setDetailTaskId(null)
    window.dispatchEvent(new Event('hcai:navigation'))
  }

  if (detailTaskId) {
    return (
      <TaskDetailView
        t={t}
        task={detailTask}
        loading={status.loading}
        proposalOpen={proposalOpen}
        setProposalOpen={setProposalOpen}
        returnToList={returnToList}
        submitProposal={submitProposal}
      />
    )
  }

  const selectCategory = (category: string) => {
    const matches = category === 'All' ? openTasks : openTasks.filter((task) => task.category === category)
    setActiveCategory(category)
    const firstMatch = matches[0]
    if (firstMatch) {
      setSelectedTask(firstMatch)
    }
  }

  return (
    <div className="task-market-workbench">
      <header className="task-market-header">
        <div>
          <span>{textFor(t, 'TASK MARKETPLACE', '任务广场')}</span>
          <h1>{textFor(t, 'Find the right work. Make a clear proposal.', '找到合适的任务，提交清晰的方案。')}</h1>
          <p>{textFor(t, 'Browse open creative requests, understand the brief, and work directly with publishers.', '浏览开放的创作需求，读懂任务说明，与发布方直接协作。')}</p>
        </div>
        <div className="task-market-actions">
          <button type="button" onClick={() => setPage('mine')}>
            <BriefcaseBusiness size={17} />
            {textFor(t, 'My tasks', '我的任务')}
          </button>
          <button className="primary" type="button" onClick={() => setPage('publish')}>
            <Plus size={17} />
            {t.postTask}
          </button>
        </div>
      </header>

      <div className="task-market-summary" aria-label={textFor(t, 'Marketplace summary', '任务广场概览')}>
        <span><strong>{openTaskCount}</strong>{textFor(t, 'Open tasks', '开放任务')}</span>
        <span><strong>{visibleTasks.length}</strong>{textFor(t, 'Results', '筛选结果')}</span>
        <span><strong>{Math.max(categories.length - 1, 0)}</strong>{textFor(t, 'Categories', '任务分类')}</span>
      </div>

      <section className="task-market-filters" aria-label={textFor(t, 'Task filters', '任务筛选')}>
        <label className="task-market-search">
          <Search size={17} />
          <input
            type="search"
            value={search}
            placeholder={textFor(t, 'Search title, brief, or publisher', '搜索任务、说明或发布方')}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          <span>{textFor(t, 'Category', '分类')}</span>
          <select value={activeCategory} onChange={(event) => selectCategory(event.target.value)}>
            {categories.map((category) => <option value={category} key={category}>{categoryLabel(category, t)}</option>)}
          </select>
        </label>
        <label>
          <span>{textFor(t, 'Minimum reward', '最低报酬')}</span>
          <select value={minimumPoints} onChange={(event) => setMinimumPoints(event.target.value)}>
            <option value="all">{textFor(t, 'Any reward', '不限')}</option>
            <option value="500">500+ pts</option>
            <option value="1000">1,000+ pts</option>
            <option value="3000">3,000+ pts</option>
          </select>
        </label>
      </section>

      <div className="task-market-layout">
        <section className="task-market-list" aria-label={textFor(t, 'Open tasks', '开放任务')}>
          {(status.loading || status.error) && (
            <div className="task-market-message">
              <strong>
                {status.loading
                  ? textFor(t, 'Syncing tasks', '正在同步任务')
                  : textFor(t, 'Task API unavailable', '任务 API 暂不可用')}
              </strong>
              <span>
                {status.loading
                  ? textFor(t, 'Loading the latest task market data from the API.', '正在从 API 加载最新任务市场数据。')
                  : status.error}
              </span>
              {status.error && (
                <button className="ghost-button" type="button" onClick={() => void status.refresh()}>
                  {textFor(t, 'Retry sync', '重试同步')}
                </button>
              )}
            </div>
          )}
          {!status.loading && visibleTasks.map((task) => (
                <button
                  className="task-market-row"
                  data-testid={`task-card-${task.id}`}
                  type="button"
                  key={task.id}
                  onClick={() => openTask(task)}
                >
                  <span className="task-market-row-category">{categoryLabel(task.category, t)}</span>
                  <span className="task-market-row-copy">
                    <strong>{task.title}</strong>
                    <small>{task.description}</small>
                    <span>@{task.publisher}</span>
                  </span>
                  <span className="task-market-row-stat"><small>{textFor(t, 'Reward', '报酬')}</small><b>{task.points}</b></span>
                  <span className="task-market-row-stat"><small>{textFor(t, 'Deadline', '截止')}</small><b>{formatTaskDeadline(task.deadline, isZh)}</b></span>
                  <span className="task-market-row-stat"><small>{textFor(t, 'Proposals', '方案')}</small><b>{task.proposals}</b></span>
                  <ChevronRight size={18} />
                </button>
              ))}
          {!status.loading && visibleTasks.length === 0 && (
            <div className={`task-market-message ${openTasks.length === 0 && !search.trim() && activeCategory === 'All' && minimumPoints === 'all' ? 'task-market-cold-start' : ''}`}>
              <strong>{openTasks.length === 0 && !search.trim() && activeCategory === 'All' && minimumPoints === 'all'
                ? textFor(t, 'The marketplace is ready for its first brief', '任务广场正在等待第一条需求')
                : textFor(t, 'No matching tasks', '没有符合条件的任务')}</strong>
              <span>{openTasks.length === 0 && !search.trim() && activeCategory === 'All' && minimumPoints === 'all'
                ? textFor(t, 'Publish a clear request to start working with creators, or review your existing task activity.', '发布一条清晰的创作需求，与创作者开始协作；也可以查看自己的任务记录。')
                : textFor(t, 'Try a different search or publish a new request.', '可以调整筛选条件，或者发布一条新需求。')}</span>
              {openTasks.length === 0 && !search.trim() && activeCategory === 'All' && minimumPoints === 'all' ? (
                <div className="task-market-message-actions">
                  <button className="primary-button" type="button" onClick={() => setPage('publish')}><Plus size={16} />{t.postTask}</button>
                  <button type="button" onClick={() => setPage('mine')}><BriefcaseBusiness size={16} />{textFor(t, 'My tasks', '我的任务')}</button>
                </div>
              ) : (
                <button type="button" onClick={() => { setSearch(''); setActiveCategory('All'); setMinimumPoints('all') }}>
                  {textFor(t, 'Clear filters', '清除筛选')}
                </button>
              )}
            </div>
          )}
        </section>

      </div>
    </div>
  )
}

function TaskDetailView({
  t,
  task,
  loading,
  proposalOpen,
  setProposalOpen,
  returnToList,
  submitProposal,
}: {
  t: Record<string, string>
  task: Task | null
  loading: boolean
  proposalOpen: boolean
  setProposalOpen: (open: boolean) => void
  returnToList: () => void
  submitProposal: (task: Task, draft: TaskProposalDraft) => Promise<boolean>
}) {
  const isZh = isZhCopy(t)
  if (loading) {
    return <div className="task-detail-state"><strong>{textFor(t, 'Loading task', '正在加载任务')}</strong><span>{textFor(t, 'Retrieving the latest task details.', '正在获取最新任务详情。')}</span></div>
  }
  if (!task) {
    return (
      <div className="task-detail-state">
        <BriefcaseBusiness size={25} />
        <strong>{textFor(t, 'Task not found', '未找到该任务')}</strong>
        <span>{textFor(t, 'It may have been removed or is no longer available.', '该任务可能已被删除或暂时不可用。')}</span>
        <button type="button" onClick={returnToList}><ArrowLeft size={16} />{textFor(t, 'Back to tasks', '返回任务广场')}</button>
      </div>
    )
  }
  const canPropose = task.status === 'Open'
  return (
    <div className="task-detail-page">
      <button className="task-detail-back" type="button" onClick={returnToList}><ArrowLeft size={17} />{textFor(t, 'All tasks', '全部任务')}</button>
      <div className="task-detail-layout">
        <article className="task-detail-content">
          <div className="task-detail-kicker"><span>{categoryLabel(task.category, t)}</span><small>{task.proposals} {textFor(t, 'proposals', '个提案')}</small></div>
          <h1>{task.title}</h1>
          <p className="task-detail-description">{task.description}</p>
          <div className="task-detail-meta">
            <span><BadgeDollarSign size={18} /><b>{task.points}</b><small>{textFor(t, 'Reward', '任务报酬')}</small></span>
            <span><Clock3 size={18} /><b>{formatTaskDeadline(task.deadline, isZh)}</b><small>{textFor(t, 'Deadline', '截止时间')}</small></span>
            <span><UsersRound size={18} /><b>{task.proposals}</b><small>{textFor(t, 'Proposals', '已收方案')}</small></span>
          </div>
          <div className="task-detail-sections">
            <InfoBox title={textFor(t, 'Submission requirements', '提交要求')} items={task.requirements} />
            <InfoBox title={textFor(t, 'Attachments', '附件')} items={task.attachments} emptyText={textFor(t, 'No attachments provided.', '未提供附件。')} />
            <InfoBox title={textFor(t, 'Private brief', '私密说明')} text={task.privateBrief} emptyText={textFor(t, 'No private brief for this task.', '该任务没有私密说明。')} />
            <InfoBox title={textFor(t, 'Rights', '版权范围')} text={task.rights} emptyText={textFor(t, 'No additional rights terms provided.', '未提供额外版权条款。')} />
          </div>
        </article>
        <aside className="task-detail-action-rail">
          <div>
            <span>{textFor(t, 'Publisher', '发布方')}</span>
            <strong>@{task.publisher}</strong>
          </div>
          <div><span>{textFor(t, 'Status', '任务状态')}</span><strong>{canPropose ? textFor(t, 'Accepting proposals', '正在征集方案') : statusLabel(task.status, t)}</strong></div>
          <button className="task-detail-propose" data-testid="submit-proposal-button" disabled={!canPropose} type="button" onClick={() => setProposalOpen(true)}>
            <BriefcaseBusiness size={18} />{canPropose ? t.takeTask : textFor(t, 'Proposals closed', '方案已关闭')}
          </button>
          <p>{textFor(t, 'Describe your approach, delivery plan, and timing before submitting.', '提交前请完整说明方案思路、交付内容和时间安排。')}</p>
        </aside>
      </div>
      {proposalOpen && <TaskProposalDialog t={t} task={task} close={() => setProposalOpen(false)} submitProposal={submitProposal} />}
    </div>
  )
}

function TaskProposalDialog({
  t,
  task,
  close,
  submitProposal,
}: {
  t: Record<string, string>
  task: Task
  close: () => void
  submitProposal: (task: Task, draft: TaskProposalDraft) => Promise<boolean>
}) {
  const [approach, setApproach] = useState('')
  const [deliverables, setDeliverables] = useState('')
  const [estimate, setEstimate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (approach.trim().length < 20 || deliverables.trim().length < 10 || estimate.trim().length < 3) {
      setError(textFor(t, 'Complete all three fields with enough detail before submitting.', '请完整填写方案思路、交付内容和时间安排。'))
      return
    }
    setSubmitting(true)
    setError('')
    const succeeded = await submitProposal(task, { approach, deliverables, estimate })
    setSubmitting(false)
    if (succeeded) close()
  }

  return (
    <div className="task-proposal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) close() }}>
      <section className="task-proposal-dialog" role="dialog" aria-modal="true" aria-labelledby="task-proposal-title">
        <header>
          <div><span>{textFor(t, 'Proposal for', '提交方案')}</span><h2 id="task-proposal-title">{task.title}</h2></div>
          <button type="button" aria-label={textFor(t, 'Close', '关闭')} disabled={submitting} onClick={close}><X size={19} /></button>
        </header>
        <form onSubmit={(event) => void submit(event)}>
          <label><span>{textFor(t, 'Approach', '方案思路')}</span><textarea autoFocus rows={5} value={approach} onChange={(event) => setApproach(event.target.value)} placeholder={textFor(t, 'Explain how you will approach the brief and manage quality.', '说明你会如何拆解任务、执行工作并保证质量。')} /></label>
          <label><span>{textFor(t, 'Deliverables', '交付内容')}</span><textarea rows={4} value={deliverables} onChange={(event) => setDeliverables(event.target.value)} placeholder={textFor(t, 'List the files, formats, and revisions you will deliver.', '列出你会提供的文件、格式和修改范围。')} /></label>
          <label><span>{textFor(t, 'Timeline', '时间安排')}</span><input value={estimate} onChange={(event) => setEstimate(event.target.value)} placeholder={textFor(t, 'Example: First draft in 2 days, final in 4 days', '例如：2 天提交首版，4 天完成最终交付')} /></label>
          {error && <p className="task-proposal-error">{error}</p>}
          <footer>
            <button type="button" disabled={submitting} onClick={close}>{textFor(t, 'Cancel', '取消')}</button>
            <button className="primary" data-testid="confirm-proposal-button" disabled={submitting} type="submit"><Send size={17} />{submitting ? textFor(t, 'Submitting', '提交中') : textFor(t, 'Submit proposal', '确认提交')}</button>
          </footer>
        </form>
      </section>
    </div>
  )
}

export function InfoBox({ title, text, items, emptyText }: { title: string; text?: string; items?: string[]; emptyText?: string }) {
  const hasContent = Boolean(text || items?.length)
  return (
    <div className="deliverable-box">
      <strong>{title}</strong>
      {text && <p>{text}</p>}
      {items && items.length > 0 && (
        <ul className="clean-list">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      {!hasContent && emptyText && <p>{emptyText}</p>}
    </div>
  )
}

function MediaUploadPanel({
  t,
  purpose,
  assets,
  setAssets,
  title,
  simulateAction,
}: {
  t: Record<string, string>
  purpose: MediaAssetPurpose
  assets: ApiMediaAsset[]
  setAssets: (assets: ApiMediaAsset[]) => void
  title: string
  simulateAction: SimulateAction
}) {
  const isZh = isZhCopy(t)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const uploadFile = async (file: File) => {
    setUploading(true)
    setError(null)
    try {
      const completed = await uploadMediaFile(file, {
        purpose,
        metadata: { source: 'task-workflow-ui' },
      })
      setAssets([completed, ...assets.filter((asset) => asset.id !== completed.id)])
      simulateAction(isZh ? `已上传文件：${file.name}` : `Uploaded file: ${file.name}`)
    } catch (uploadError) {
      console.info('[media-service]', uploadError)
      setError(isZh ? '上传失败，请确认账号权限后重试。' : 'Upload failed. Check account access and try again.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="media-upload-panel">
      <div>
        <strong>{title}</strong>
        <span>{textFor(t, 'Files are registered through the media upload API.', '文件会通过媒体上传 API 登记。')}</span>
      </div>
      <label className="media-file-picker">
        <Upload size={16} />
        <span>{uploading ? textFor(t, 'Uploading', '上传中') : textFor(t, 'Add file', '添加文件')}</span>
        <input
          data-testid={`media-upload-${purpose}`}
          disabled={uploading}
          type="file"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.currentTarget.value = ''
            if (file) void uploadFile(file)
          }}
        />
      </label>
      {error && <small className="form-error">{error}</small>}
      {assets.length > 0 && (
        <div className="media-asset-list">
          {assets.map((asset) => (
            <span className="task-field-chip" data-testid={`media-asset-${asset.id}`} key={asset.id}>
              {asset.fileName}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function PublishPage({
  t,
  setPage,
  publishTask,
  simulateAction,
}: {
  t: Record<string, string>
  setPage: (page: Page) => void
  requireAuth: () => void
  publishTask: (draft: PublishDraft) => Promise<void>
  openProfile: (profile: MarketplaceProfile) => void
  simulateAction: SimulateAction
}) {
  const isZh = isZhCopy(t)
  const [draft, setDraft] = useState<PublishDraft>(() => {
    let inspiration: { title?: string; category?: string; details?: string; rules?: string; source?: string } | null = null
    try {
      const raw = window.sessionStorage.getItem('hcaiInspirationTaskDraft')
      if (raw) inspiration = JSON.parse(raw)
      window.sessionStorage.removeItem('hcaiInspirationTaskDraft')
    } catch {
      window.sessionStorage.removeItem('hcaiInspirationTaskDraft')
    }
    return {
      title: inspiration?.title ?? textFor(t, 'Create a 30-second AI product launch video', '制作一套中文 AI 课程宣传短视频'),
      category: inspiration?.category ?? 'Video',
      reward: inspiration ? '' : textFor(t, '$450 / 4,500 pts', '¥2,800 / 2,800 积分'),
      deadline: inspiration ? '' : new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16),
      visibility: 'Public brief + private files',
      details: inspiration?.details ?? textFor(
        t,
        'Need a polished vertical video with product shots, captions, music, and fast edits.',
        '需要 3 条中文竖版短视频，包含课程卖点、字幕、AI 配音和封面建议。',
      ),
      rules: (inspiration?.rules || textFor(
        t,
        'Submit script, preview link, final MP4, captions, cover prompt, and rights summary.',
        '提交脚本、预览链接、最终 MP4、字幕文件、封面提示词和版权摘要。',
      )) + (inspiration?.source ? textFor(t, `\n\nSource: ${inspiration.source}`, `\n\n来源：${inspiration.source}`) : ''),
    }
  })
  const [taskAssets, setTaskAssets] = useState<ApiMediaAsset[]>([])
  const [publishedRules, setPublishedRules] = useState<TaskRule[]>([])

  useEffect(() => {
    let active = true
    void taskService.rules().then((rules) => {
      if (!active) return
      setPublishedRules(rules)
      setDraft((current) => {
        const selected = rules.find((rule) => rule.category === current.category) ?? rules[0]
        return selected && !rules.some((rule) => rule.category === current.category)
          ? { ...current, category: selected.category, acceptanceTemplateId: null }
          : current
      })
    }).catch(() => {})
    return () => { active = false }
  }, [])

  const categoryOptions = publishedRules.length
    ? publishedRules.map((rule) => rule.category)
    : ['Music', 'Image', 'Video', 'Voice', 'Prompt', 'Automation']
  const selectedRule = publishedRules.find((rule) => rule.category === draft.category) ?? null

  type EditablePublishField = Exclude<keyof PublishDraft, 'attachmentIds' | 'acceptanceTemplateId'>
  const updateDraft = (key: EditablePublishField, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }
  const improveDraftField = (key: EditablePublishField) => {
    const suggestions: Record<EditablePublishField, string> = {
      title: textFor(t, 'Polished 30-second AI product launch video package', '中文课程宣传短视频全套交付'),
      category: draft.category,
      reward: textFor(t, '$520 / 5,200 pts', '¥3,200 / 3,200 积分'),
      deadline: textFor(t, '4 days, first preview within 24 hours', '4 天，24 小时内提交首版预览'),
      visibility: draft.visibility,
      details: textFor(
        t,
        'Create three polished vertical video cuts for a product launch. Include a hook in the first 3 seconds, caption-safe framing, generated music direction, reusable prompt notes, and export-ready social versions.',
        '制作 3 条中文竖版课程宣传短视频。前三秒需要明确钩子，画面留出字幕安全区，包含课程卖点、AI 配音建议、封面提示词、可复用交付说明和适合投放的平台版本。',
      ),
      rules: textFor(
        t,
        'Submit script, storyboard outline, preview link, final MP4 files, SRT captions, cover prompt, editable prompt notes, source/rights summary, and one revision round before acceptance.',
        '提交脚本、分镜提纲、预览链接、最终 MP4、SRT 字幕、封面提示词、可编辑提示词说明、素材与版权摘要；验收前包含一轮修改。',
      ),
    }
    updateDraft(key, suggestions[key])
  }
  const templateButtonLabel = (key: EditablePublishField) =>
    isZh
      ? `应用${publishFieldLabel(key, t)}模板`
      : `Apply template for ${publishFieldLabel(key, t)}`
  const renderAiButton = (key: EditablePublishField) => (
    <button
      aria-label={templateButtonLabel(key)}
      className="icon-button ai-field-button"
      onClick={() => improveDraftField(key)}
      title={templateButtonLabel(key)}
      type="button"
    >
      <Sparkles size={16} />
    </button>
  )
  const publishChecks = [
    { label: textFor(t, 'Clear title', '标题清晰'), passed: Boolean(draft.title.trim()) },
    { label: textFor(t, 'Budget and points set', '预算和积分已填写'), passed: Boolean(draft.reward.trim()) },
    { label: textFor(t, 'Deadline set', '截止时间已填写'), passed: Boolean(draft.deadline.trim()) },
    { label: textFor(t, 'Requirement details included', '需求详情已填写'), passed: Boolean(draft.details.trim()) },
    { label: textFor(t, 'Acceptance criteria included', '包含验收标准'), passed: Boolean(draft.rules.trim()) },
  ]
  const readyToPublish = publishChecks.every((check) => check.passed)

  return (
    <div className="stack">
      <SectionHeader
        eyebrow={textFor(t, 'Request form', '需求表单')}
        title={t.publishTitle}
      />
      <section className="form-layout">
        <div className="panel form-panel">
          <label>
            {textFor(t, 'Task title', '任务标题')}
            <span className="ai-field">
              <input value={draft.title} onChange={(event) => updateDraft('title', event.target.value)} />
              {renderAiButton('title')}
            </span>
          </label>
          <div className="form-grid">
            <label>
              {textFor(t, 'Category', '分类')}
              <select value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value, acceptanceTemplateId: null }))}>
                {categoryOptions.map((item) => (
                  <option key={item} value={item}>{categoryLabel(item, t)}</option>
                ))}
              </select>
            </label>
            <label>
              {textFor(t, 'Reward', '奖励')}
              <input value={draft.reward} onChange={(event) => updateDraft('reward', event.target.value)} />
            </label>
            <label>
              {textFor(t, 'Deadline', '截止时间')}
              <input type="datetime-local" value={draft.deadline} onChange={(event) => updateDraft('deadline', event.target.value)} />
            </label>
            <label>
              {textFor(t, 'Visibility', '可见范围')}
              <select value={draft.visibility} onChange={(event) => updateDraft('visibility', event.target.value)}>
                <option value="Public brief + private files">{textFor(t, 'Public brief + private files', '公开需求 + 私密附件')}</option>
                <option value="Private invite only">{textFor(t, 'Private invite only', '仅私密邀请')}</option>
                <option value="Community visible">{textFor(t, 'Community visible', '社区可见')}</option>
              </select>
            </label>
          </div>
          <label>
            {textFor(t, 'Requirement details', '需求详情')}
            <span className="ai-field textarea-field">
              <textarea
                aria-label={textFor(t, 'Requirement details', '需求详情')}
                className="publish-brief-editor"
                value={draft.details}
                onChange={(event) => updateDraft('details', event.target.value)}
              />
              {renderAiButton('details')}
            </span>
          </label>
          <label>
            {textFor(t, 'Submission and acceptance rules', '提交与验收规则')}
            {selectedRule && selectedRule.acceptanceTemplates.length > 0 && (
              <select
                aria-label={textFor(t, 'Acceptance template', '验收模板')}
                value={draft.acceptanceTemplateId ?? ''}
                onChange={(event) => {
                  const acceptanceTemplateId = event.target.value || null
                  const template = selectedRule.acceptanceTemplates.find((item) => item.id === acceptanceTemplateId)
                  setDraft((current) => ({ ...current, acceptanceTemplateId, ...(template ? { rules: template.body } : {}) }))
                }}
              >
                <option value="">{textFor(t, 'Custom acceptance rules', '自定义验收规则')}</option>
                {selectedRule.acceptanceTemplates.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}
              </select>
            )}
            <span className="ai-field textarea-field">
              <textarea
                aria-label={textFor(t, 'Submission and acceptance rules', '提交与验收规则')}
                className="publish-brief-editor"
                value={draft.rules}
                onChange={(event) => updateDraft('rules', event.target.value)}
              />
              {renderAiButton('rules')}
            </span>
          </label>
          <MediaUploadPanel
            t={t}
            purpose="task_attachment"
            assets={taskAssets}
            setAssets={setTaskAssets}
            title={textFor(t, 'Task attachments', '任务附件')}
            simulateAction={simulateAction}
          />
          <div className="button-row">
            <button className="primary-button" type="button" disabled={!readyToPublish} onClick={() => void publishTask({ ...draft, attachmentIds: taskAssets.map((asset) => asset.id) })}>
              <Upload size={17} />
              {textFor(t, 'Publish task', '发布任务')}
            </button>
          </div>
        </div>
        <aside className="side-stack">
          <section className="panel side-panel compact-panel">
            <SectionHeader eyebrow={textFor(t, 'Auto checks', '自动检查')} title={readyToPublish ? textFor(t, 'Ready to publish', '可以发布') : textFor(t, 'Complete required fields', '请补全必填信息')} />
          {publishChecks.map((check) => (
            <div className={`check-line ${check.passed ? 'is-passed' : 'is-missing'}`} key={check.label}>
              {check.passed ? <Check size={16} /> : <X size={16} />}
              <span>{check.label}</span>
            </div>
          ))}
          <button className="ghost-button" type="button" onClick={() => setPage('community')}>
            <MessageCircle size={17} />
            {textFor(t, 'Discuss in community', '到社区讨论')}
          </button>
          </section>
        </aside>
      </section>
    </div>
  )
}

export function MyTasksPage({
  t,
  tasks,
  setPage,
  accountHandle = 'taskops',
  proposalStateByTask = {},
  submissionStateByTask = {},
  timelineStateByTask = {},
  workflowStateByTask = {},
  refreshProposals = async () => undefined,
  acceptProposal = async () => undefined,
  rejectProposal = async () => undefined,
  refreshSubmissions = async () => undefined,
  refreshTimeline = async () => undefined,
  refreshWorkflow = async () => undefined,
  submitTask,
  approveTask = async () => undefined,
  rejectTask = async () => undefined,
  requestRevisionTask = async () => undefined,
  openDisputeTask = async () => undefined,
  cancelTask = async () => undefined,
  simulateAction,
}: {
  t: Record<string, string>
  tasks: Task[]
  setPage: (page: Page) => void
  accountHandle?: string
  proposalStateByTask?: Record<string, TaskChildCollection<ApiTaskProposal>>
  submissionStateByTask?: Record<string, TaskChildCollection<ApiTaskSubmission>>
  timelineStateByTask?: Record<string, TaskChildCollection<ApiTaskTimelineItem>>
  workflowStateByTask?: Record<string, ApiTaskWorkflow>
  refreshProposals?: (task: Task) => Promise<void>
  acceptProposal?: (task: Task, proposalId: string) => Promise<void>
  rejectProposal?: (task: Task, proposalId: string) => Promise<void>
  refreshSubmissions?: (task: Task) => Promise<void>
  refreshTimeline?: (task: Task) => Promise<void>
  refreshWorkflow?: (task: Task) => Promise<void>
  submitTask: (task: Task, options?: { assetIds?: string[]; rightsNote?: string }) => Promise<void>
  approveTask?: (task: Task, options?: { acceptanceChecklist?: ApiAcceptanceChecklistItem[] }) => Promise<void>
  rejectTask?: (task: Task, options?: { acceptanceChecklist?: ApiAcceptanceChecklistItem[] }) => Promise<void>
  requestRevisionTask?: (task: Task, options?: { acceptanceChecklist?: ApiAcceptanceChecklistItem[] }) => Promise<void>
  openDisputeTask?: (task: Task) => Promise<void>
  cancelTask?: (task: Task) => Promise<void>
  simulateAction: SimulateAction
}) {
  const isZh = isZhCopy(t)
  const scopedTasks = useMemo(() => localizedTasks(tasks, t), [tasks, t])
  const ownsHandle = useCallback(
    (handle: string | null | undefined) => String(handle ?? '').replace(/^@/, '') === accountHandle,
    [accountHandle],
  )
  const publisherTasks = useMemo(
    () => scopedTasks.filter((task) => ownsHandle(task.publisher)),
    [ownsHandle, scopedTasks],
  )
  const assignedTasks = useMemo(
    () => scopedTasks.filter((task) => ownsHandle(task.assignee)),
    [ownsHandle, scopedTasks],
  )
  const proposedTasks = useMemo(
    () => scopedTasks.filter((task) =>
      (proposalStateByTask[String(task.id)]?.items ?? []).some((proposal) => ownsHandle(proposal.proposer?.handle))),
    [ownsHandle, proposalStateByTask, scopedTasks],
  )
  const deliveryTasks = useMemo(
    () => [...assignedTasks, ...proposedTasks.filter((task) => !assignedTasks.some((assigned) => assigned.id === task.id))],
    [assignedTasks, proposedTasks],
  )
  const activeDiscussionCount = deliveryTasks.filter((task) => ['In Progress', 'Pending Review', 'Disputed', 'Rejected'].includes(task.status)).length
  const stages = isZh
    ? [
        { label: '待选方案', value: `${publisherTasks.length}`, text: '我发布的任务收到多个方案，等待选择。' },
        { label: '接取任务', value: `${deliveryTasks.length}`, text: '我接取、提交方案或正在交付的任务。' },
        { label: '沟通中', value: `${activeDiscussionCount}`, text: '双方围绕方案、修改和验收确认。' },
      ]
    : [
        { label: 'Proposal queues', value: `${publisherTasks.length}`, text: 'My posted tasks with multiple proposals to choose from.' },
        { label: 'Accepted tasks', value: `${deliveryTasks.length}`, text: 'Tasks I accepted, proposed for, or am delivering.' },
        { label: 'In discussion', value: `${activeDiscussionCount}`, text: 'Both sides are aligning scope, revisions, and acceptance.' },
      ]
  const typeFieldsFor = (task: Task, mode: 'publisher' | 'maker') => {
    const category = task.category.toLowerCase()
    const linkValue = task.resultLinks[0] ?? task.attachments[0] ?? textFor(t, 'Add delivery link', '补充交付链接')
    const fieldCopy = {
      Video: {
        publisher: [
          ['Script', '脚本', 'Review hook, scenes, and rights notes.', '审看开头钩子、场景和版权说明。'],
          ['Storyboard', '分镜', 'Check shot order and reference frames.', '确认镜头顺序和参考画面。'],
          ['Final video link', '成片链接', linkValue, linkValue],
        ],
        maker: [
          ['Script draft', '脚本草稿', 'Submit hook, narration, and scene text.', '提交开头钩子、旁白和场景文本。'],
          ['Storyboard board', '分镜板', 'Attach key frames or preview board.', '附上关键帧或预览板。'],
          ['Final cut link', '成片链接', linkValue, linkValue],
        ],
      },
      Image: {
        publisher: [
          ['Prompt', '提示词', 'Review style, composition, and negatives.', '审看风格、构图和负面提示词。'],
          ['Reference image', '参考图', task.attachments[0] ?? 'reference board', task.attachments[0] ?? '参考图板'],
          ['Sample image', '样图', 'Compare first samples before approval.', '先对比首批样图再确认。'],
        ],
        maker: [
          ['Prompt draft', '提示词草稿', 'Fill style, subject, ratio, and negatives.', '填写风格、主体、比例和负面提示词。'],
          ['Reference image', '参考图', task.attachments[0] ?? 'reference upload', task.attachments[0] ?? '上传参考图'],
          ['Sample image', '样图', 'Attach preview samples for selection.', '提交可供选择的预览样图。'],
        ],
      },
      Music: {
        publisher: [
          ['Lyrics', '歌词', 'Review structure, language, and usage scope.', '审看结构、语言和使用范围。'],
          ['BPM', 'BPM', 'Confirm tempo and mood fit.', '确认速度和情绪是否匹配。'],
          ['Audio link', '音频链接', linkValue, linkValue],
        ],
        maker: [
          ['Lyrics', '歌词', 'Submit lyrics or instrumental notes.', '提交歌词或纯音乐说明。'],
          ['BPM', 'BPM', 'Fill tempo, key, and reference mood.', '填写速度、调式和参考情绪。'],
          ['Audio link', '音频链接', linkValue, linkValue],
        ],
      },
      Voice: {
        publisher: [
          ['Voiceover text', '配音文本', 'Review pronunciation and pacing notes.', '审看发音和节奏说明。'],
          ['Voice style', '音色', 'Confirm tone, gender, and emotion.', '确认音色、性别和情绪。'],
          ['Preview link', '试听链接', linkValue, linkValue],
        ],
        maker: [
          ['Voiceover text', '配音文本', 'Paste final script for recording.', '填写最终配音文案。'],
          ['Voice style', '音色', 'Select tone, gender, and emotion.', '选择音色、性别和情绪。'],
          ['Preview link', '试听链接', linkValue, linkValue],
        ],
      },
      Automation: {
        publisher: [
          ['Flow', '流程', 'Review trigger, steps, and handoff points.', '审看触发器、步骤和交接节点。'],
          ['API', 'API', 'Confirm API fields and permission scope.', '确认 API 字段和权限范围。'],
          ['Test log', '测试记录', 'Check run results before acceptance.', '验收前查看运行结果。'],
        ],
        maker: [
          ['Flow chart', '流程图', 'Submit trigger, steps, and fallback path.', '提交触发器、步骤和兜底路径。'],
          ['API fields', 'API 字段', 'List endpoints, inputs, and permissions.', '列出接口、输入和权限。'],
          ['Test log', '测试记录', 'Attach test runs and edge cases.', '附上测试运行和异常场景。'],
        ],
      },
      Prompt: {
        publisher: [
          ['Prompt version', '提示词版本', 'Compare versions and reuse scope.', '对比版本和复用范围。'],
          ['Test cases', '测试样例', 'Review inputs, outputs, and failure cases.', '审看输入、输出和失败样例。'],
        ],
        maker: [
          ['Prompt version', '提示词版本', 'Fill version notes and variables.', '填写版本说明和变量。'],
          ['Test cases', '测试样例', 'Submit sample inputs and outputs.', '提交测试输入和输出。'],
        ],
      },
      Design: {
        publisher: [
          ['Design draft', '设计稿', 'Review layout, components, and states.', '审看版式、组件和状态。'],
          ['Source file', '源文件', 'Confirm editable files and export specs.', '确认可编辑源文件和导出规格。'],
          ['Preview link', '预览链接', linkValue, linkValue],
        ],
        maker: [
          ['Design draft', '设计稿', 'Submit layout, components, and states.', '提交版式、组件和状态。'],
          ['Source file', '源文件', 'Attach editable files and export specs.', '附上可编辑源文件和导出规格。'],
          ['Preview link', '预览链接', linkValue, linkValue],
        ],
      },
      General: {
        publisher: [
          ['Delivery link', '交付链接', linkValue, linkValue],
          ['Review note', '验收说明', task.reviewNote || 'Review acceptance details.', task.reviewNote || '查看验收说明。'],
        ],
        maker: [
          ['Delivery link', '交付链接', linkValue, linkValue],
          ['Delivery note', '交付说明', 'Describe files, changes, and usage scope.', '说明文件、修改内容和使用范围。'],
        ],
      },
    }
    const kind =
      category.includes('video') ? 'Video'
        : category.includes('image') ? 'Image'
          : category.includes('music') ? 'Music'
            : category.includes('voice') ? 'Voice'
              : category.includes('automation') ? 'Automation'
                : category.includes('prompt') ? 'Prompt'
                  : category.includes('design') ? 'Design'
                    : 'General'
    return fieldCopy[kind][mode].map(([enLabel, zhLabel, enValue, zhValue]) => ({
      label: textFor(t, enLabel, zhLabel),
      value: textFor(t, enValue, zhValue),
    }))
  }
  type MineTaskRole = 'publisher' | 'maker'
  type MineTaskFilter = 'all' | 'posted' | 'accepted'
  const [mineTaskFilter, setMineTaskFilter] = useState<MineTaskFilter>('all')
  const [submissionAssetsByTask, setSubmissionAssetsByTask] = useState<Record<string, ApiMediaAsset[]>>({})
  const [acceptanceChecklistByTask, setAcceptanceChecklistByTask] = useState<Record<string, ApiAcceptanceChecklistItem[]>>({})
  const [selectedMineTask, setSelectedMineTask] = useState<{ id: Task['id']; role: MineTaskRole }>(() => ({
    id: publisherTasks[0]?.id ?? deliveryTasks[0]?.id ?? scopedTasks[0]?.id ?? tasks[0]?.id ?? 0,
    role: publisherTasks[0] ? 'publisher' : 'maker',
  }))
  const showPostedTasks = mineTaskFilter === 'all' || mineTaskFilter === 'posted'
  const showAcceptedTasks = mineTaskFilter === 'all' || mineTaskFilter === 'accepted'
  const publisherTaskKey = publisherTasks.map((task) => task.id).join('|')
  const deliveryTaskKey = deliveryTasks.map((task) => task.id).join('|')
  useEffect(() => {
    const query = window.location.hash.startsWith('#mine?') ? window.location.hash.split('?')[1] : ''
    const taskId = query ? new URLSearchParams(query).get('taskId') : null
    if (!taskId) return
    const publisherTask = publisherTasks.find((task) => String(task.id) === taskId)
    const deliveryTask = deliveryTasks.find((task) => String(task.id) === taskId)
    const target = publisherTask ?? deliveryTask
    if (!target) return
    const timer = window.setTimeout(() => {
      setSelectedMineTask({ id: target.id, role: publisherTask ? 'publisher' : 'maker' })
      setMineTaskFilter(publisherTask ? 'posted' : 'accepted')
    }, 0)
    return () => window.clearTimeout(timer)
  }, [publisherTaskKey, deliveryTaskKey, publisherTasks, deliveryTasks])
  const changeMineTaskFilter = (nextFilter: MineTaskFilter) => {
    setMineTaskFilter(nextFilter)
    const nextTask =
      nextFilter === 'accepted'
        ? deliveryTasks[0]
        : nextFilter === 'posted'
          ? publisherTasks[0]
          : publisherTasks[0] ?? deliveryTasks[0]
    if (nextTask) {
      setSelectedMineTask({
        id: nextTask.id,
        role: nextFilter === 'accepted' ? 'maker' : publisherTasks[0]?.id === nextTask.id ? 'publisher' : 'maker',
      })
    }
  }
  const selectedTask =
    (selectedMineTask.role === 'publisher' ? publisherTasks : deliveryTasks).find((task) => task.id === selectedMineTask.id) ??
    publisherTasks[0] ??
    deliveryTasks[0]
  const selectedRole: MineTaskRole =
    selectedMineTask.role === 'publisher' && publisherTasks.some((task) => task.id === selectedTask?.id)
      ? 'publisher'
      : selectedMineTask.role === 'maker' && deliveryTasks.some((task) => task.id === selectedTask?.id)
        ? 'maker'
        : publisherTasks[0]?.id === selectedTask?.id
          ? 'publisher'
          : 'maker'

  useEffect(() => {
    const currentTasks = selectedMineTask.role === 'publisher' ? publisherTasks : deliveryTasks
    if (currentTasks.some((task) => task.id === selectedMineTask.id)) return
    const nextTask =
      mineTaskFilter === 'accepted'
        ? deliveryTasks[0]
        : mineTaskFilter === 'posted'
          ? publisherTasks[0]
          : publisherTasks[0] ?? deliveryTasks[0]
    if (!nextTask) return
    const timer = window.setTimeout(() => {
      setSelectedMineTask({
        id: nextTask.id,
        role: publisherTasks.some((task) => task.id === nextTask.id) ? 'publisher' : 'maker',
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [accountHandle, mineTaskFilter, publisherTaskKey, deliveryTaskKey, publisherTasks, deliveryTasks, selectedMineTask.id, selectedMineTask.role])

  const selectedFields = selectedTask ? typeFieldsFor(selectedTask, selectedRole) : []
  const selectedTaskKey = selectedTask ? String(selectedTask.id) : ''
  const submissionAssets = selectedTaskKey ? submissionAssetsByTask[selectedTaskKey] ?? [] : []
  const setSubmissionAssets = (assets: ApiMediaAsset[]) => {
    if (!selectedTaskKey) return
    setSubmissionAssetsByTask((current) => ({ ...current, [selectedTaskKey]: assets }))
  }
  const proposalCollection = selectedTaskKey ? proposalStateByTask[selectedTaskKey] : undefined
  const submissionCollection = selectedTaskKey ? submissionStateByTask[selectedTaskKey] : undefined
  const timelineCollection = selectedTaskKey ? timelineStateByTask[selectedTaskKey] : undefined
  const defaultAcceptanceChecklist = selectedTask?.requirements.length
    ? selectedTask.requirements.map((label) => ({ label, checked: false }))
    : [{ label: textFor(t, 'Delivery matches the task acceptance rules.', '交付符合任务验收标准。'), checked: false }]
  const acceptanceChecklist = selectedTaskKey
    ? acceptanceChecklistByTask[selectedTaskKey] ?? defaultAcceptanceChecklist
    : defaultAcceptanceChecklist
  const allAcceptanceChecked = acceptanceChecklist.length > 0 && acceptanceChecklist.every((item) => item.checked)
  const setAcceptanceChecklistItem = (index: number, checked: boolean) => {
    if (!selectedTaskKey) return
    setAcceptanceChecklistByTask((current) => {
      const next = [...(current[selectedTaskKey] ?? defaultAcceptanceChecklist)]
      next[index] = { ...next[index], checked }
      return { ...current, [selectedTaskKey]: next }
    })
  }
  const visibleProposals = proposalCollection?.items ?? []
  const visibleSubmissions = submissionCollection?.items ?? []
  const workflow = selectedTaskKey ? workflowStateByTask[selectedTaskKey] : undefined
  const canReviewProposals = workflow?.actions.includes('review_proposals') ?? false
  const canReviewSubmission = workflow?.actions.includes('review_submission') ?? false
  const canSubmitWork = workflow?.actions.includes('submit') ?? false
  const canOpenDispute = selectedRole === 'maker' && (workflow?.actions.includes('open_dispute') ?? false)
  const canCancel = selectedRole === 'publisher' && (workflow?.actions.includes('cancel') ?? false)
  const handleFor = (summary: ApiProfileSummary | { handle: string } | null) =>
    summary?.handle ? `@${summary.handle}` : textFor(t, 'Unknown user', '未知用户')
  const timelineDate = (value: string) => {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return textFor(t, 'Just now', '刚刚')
    return new Intl.DateTimeFormat(isZh ? 'zh-CN' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)
  }

  useEffect(() => {
    if (!selectedTask) return
    void refreshWorkflow(selectedTask)
    if (selectedRole === 'publisher') {
      void refreshProposals(selectedTask)
      void refreshSubmissions(selectedTask)
      void refreshTimeline(selectedTask)
      return
    }
    void refreshSubmissions(selectedTask)
    void refreshTimeline(selectedTask)
    // The workflow refresh callbacks are owned by the parent hook and may be recreated after they update task state.
    // This effect should only follow the selected task boundary to avoid a refresh/render loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTaskKey, selectedRole])

  const renderMineTaskCard = (task: Task, role: MineTaskRole) => {
    const isActive = selectedTask?.id === task.id && selectedRole === role
    return (
      <button
        className={isActive ? 'task-card mine-task-card active' : 'task-card mine-task-card'}
        data-testid={`mine-task-card-${role}-${task.id}`}
        key={`${role}-${task.id}`}
        type="button"
        onClick={() => setSelectedMineTask({ id: task.id, role })}
      >
        <div>
          <strong>{task.title}</strong>
          <span>
            {categoryLabel(task.category, t)} · {task.points}
          </span>
          <span>{task.description}</span>
          <small>
            {role === 'publisher'
              ? textFor(t, `${task.proposals} proposals waiting`, `${task.proposals} 个方案待查看`)
              : textFor(t, `${timelineStateByTask[String(task.id)]?.items.length ?? 0} timeline events`, `${timelineStateByTask[String(task.id)]?.items.length ?? 0} 条时间线记录`)}
          </small>
        </div>
      </button>
    )
  }

  return (
    <div className="stack my-tasks-page">
      <SectionHeader
        eyebrow={textFor(t, 'Delivery desk', '交付工作台')}
        title={t.mineTitle}
        action={
          <button className="primary-button" type="button" onClick={() => setPage('tasks')}>
            <BriefcaseBusiness size={17} />
            {textFor(t, 'Find tasks', '寻找任务')}
          </button>
        }
      />
      <section className="mine-summary-strip" aria-label={textFor(t, 'My task summary', '我的任务概览')}>
        {stages.map((stage) => (
          <article key={stage.label}>
            <span>{stage.label}</span>
            <strong>{stage.value}</strong>
            <small>{stage.text}</small>
          </article>
        ))}
      </section>
      <div className="my-task-workspace">
        <div className="my-task-picker">
          <div className="my-task-filter" aria-label={textFor(t, 'Filter my tasks', '筛选我的任务')}>
            {[
              { key: 'all' as const, label: textFor(t, 'All', '全部') },
              { key: 'posted' as const, label: textFor(t, 'Posted', '已发布') },
              { key: 'accepted' as const, label: textFor(t, 'Accepted', '已接取') },
            ].map((filter) => (
              <button
                className={mineTaskFilter === filter.key ? 'active' : ''}
                key={filter.key}
                type="button"
                onClick={() => changeMineTaskFilter(filter.key)}
              >
                {filter.label}
              </button>
            ))}
          </div>
          {showPostedTasks && (
            <section className="my-task-group">
              <div>
                <span className="eyebrow">{textFor(t, 'Posted', '已发布')}</span>
                <h3>{textFor(t, 'My posted tasks', '我发布的任务')}</h3>
              </div>
              <div className="task-list compact-list">{publisherTasks.map((task) => renderMineTaskCard(task, 'publisher'))}</div>
            </section>
          )}
          {showAcceptedTasks && (
            <section className="my-task-group">
              <div>
                <span className="eyebrow">{textFor(t, 'Accepted', '已接取')}</span>
                <h3>{textFor(t, 'My accepted tasks', '我接取的任务')}</h3>
              </div>
              <div className="task-list compact-list">{deliveryTasks.map((task) => renderMineTaskCard(task, 'maker'))}</div>
            </section>
          )}
        </div>
        {selectedTask && (
          <article className="panel task-detail my-task-panel">
            <span className="eyebrow">
              {selectedRole === 'publisher' ? textFor(t, 'Publisher role', '发布方视角') : textFor(t, 'Maker role', '接单方视角')}
            </span>
            <h2>{selectedRole === 'publisher' ? textFor(t, 'Adopt proposal / acceptance', '采纳方案 / 验收') : textFor(t, 'Discussion and delivery', '沟通与交付')}</h2>
            <p>
              {selectedRole === 'publisher'
                ? textFor(
                    t,
                    'Review proposals for the selected task, choose one maker, then check the typed review fields before acceptance.',
                    '查看当前任务收到的方案，选择一个创作者，再按任务类型审看字段并进入验收。',
                  )
                : textFor(
                    t,
                    'Use this space to keep communication, fill task-specific delivery fields, and submit the final acceptance package.',
                    '在这里保留沟通记录，填写当前任务类型需要的交付字段，并提交最终验收成果。',
                  )}
            </p>
            <div className="selected-task-summary">
              <strong>{selectedTask.title}</strong>
              <span>
                {categoryLabel(selectedTask.category, t)} · {selectedTask.points} · {selectedTask.deadline}
              </span>
              <small>{selectedTask.reviewNote || selectedTask.description}</small>
            </div>
            <div className="deliverable-box task-timeline-box" data-testid="task-timeline">
              <strong>{textFor(t, 'Task timeline', '任务时间线')}</strong>
              {timelineCollection?.loading && <p>{textFor(t, 'Loading timeline', '正在加载时间线')}</p>}
              {timelineCollection?.error && (
                <p>
                  {timelineCollection.error}{' '}
                  <button className="inline-link" type="button" onClick={() => void refreshTimeline(selectedTask)}>
                    {textFor(t, 'Retry', '重试')}
                  </button>
                </p>
              )}
              {timelineCollection?.items.length ? (
                <ol className="task-timeline-list">
                  {timelineCollection.items.map((item) => (
                    <li data-testid={`task-timeline-item-${item.type}`} key={item.id}>
                      <div>
                        <strong>{item.title}</strong>
                        <span>{item.body}</span>
                        <small>
                          {handleFor(item.actor)} · {timelineDate(item.occurredAt)}
                        </small>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : !timelineCollection?.loading && !timelineCollection?.error ? (
                <p>{textFor(t, 'Timeline will appear as proposals, delivery, review, and settlement happen.', '方案、交付、验收和结算发生后会形成时间线。')}</p>
              ) : null}
            </div>
            {selectedRole === 'publisher' ? (
              <>
                <div className="proposal-list">
                  {proposalCollection?.loading && (
                    <div className="empty-state">
                      <strong>{textFor(t, 'Loading proposals', '正在加载方案')}</strong>
                      <span>{textFor(t, 'Syncing proposal records from the API.', '正在从 API 同步方案记录。')}</span>
                    </div>
                  )}
                  {proposalCollection?.error && (
                    <div className="empty-state">
                      <strong>{textFor(t, 'Proposal API unavailable', '方案 API 暂不可用')}</strong>
                      <span>{proposalCollection.error}</span>
                      <button className="ghost-button" type="button" onClick={() => void refreshProposals(selectedTask)}>
                        {textFor(t, 'Retry proposals', '重试方案')}
                      </button>
                    </div>
                  )}
                  {visibleProposals.map((proposal, index) => {
                    return (
                    <div className="proposal-card" key={proposal.id}>
                      <div>
                        <strong>{handleFor(proposal.proposer)}</strong>
                        <span>{proposal.coverLetter}</span>
                        <small>{proposal.estimate || textFor(t, 'No estimate provided', '未填写预估时间')}</small>
                        <StatusBadge status={proposal.status} t={t} />
                      </div>
                      <div className="button-row compact-buttons">
                        <button
                          className={proposal.status === 'accepted' || index === 0 ? 'primary-button small' : 'ghost-button small'}
                          data-testid={`proposal-accept-${proposal.id}`}
                          type="button"
                          disabled={proposal.status !== 'pending' || !canReviewProposals}
                          onClick={() => void acceptProposal(selectedTask, proposal.id)}
                        >
                          <Check size={15} />
                          {proposal.status === 'accepted' ? textFor(t, 'Selected', '已选择') : textFor(t, 'Choose', '选择方案')}
                        </button>
                        {proposal.status === 'pending' && (
                          <button
                            className="ghost-button small"
                            data-testid={`proposal-reject-${proposal.id}`}
                            type="button"
                            disabled={!canReviewProposals}
                            onClick={() => void rejectProposal(selectedTask, proposal.id)}
                          >
                            <X size={15} />
                            {textFor(t, 'Reject', '拒绝')}
                          </button>
                        )}
                      </div>
                    </div>
                    )
                  })}
                </div>
                <InfoBox title={textFor(t, 'Publisher review fields', '发布方审看字段')} items={selectedFields.map((field) => `${field.label}: ${field.value}`)} />
                <div className="deliverable-box acceptance-checklist" data-testid="acceptance-checklist">
                  <strong>{textFor(t, 'Acceptance checklist', '验收清单')}</strong>
                  {acceptanceChecklist.map((item, index) => (
                    <label className="check-row" data-testid={`acceptance-checklist-item-${index}`} key={`${item.label}-${index}`}>
                      <input
                        checked={item.checked}
                        type="checkbox"
                        onChange={(event) => setAcceptanceChecklistItem(index, event.currentTarget.checked)}
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
                {visibleSubmissions.length > 0 && (
                  <InfoBox
                    title={textFor(t, 'Latest submission records', '最近交付记录')}
                    items={visibleSubmissions.map((submission) => `${handleFor(submission.submitter)} · ${statusLabel(submission.status, t)}: ${submission.content}`)}
                  />
                )}
                <div className="button-row">
                  {canCancel && (
                    <button className="ghost-button" data-testid="cancel-task-button" type="button" onClick={() => void cancelTask(selectedTask)}>
                      <X size={17} />
                      {textFor(t, 'Cancel task', '取消任务')}
                    </button>
                  )}
                  <button
                    className="primary-button"
                    data-testid="approve-submission-button"
                    type="button"
                    disabled={!allAcceptanceChecked || !canReviewSubmission}
                    onClick={() => void approveTask(selectedTask, { acceptanceChecklist })}
                  >
                    <Check size={17} />
                    {textFor(t, 'Review acceptance', '进入验收')}
                  </button>
                  <button className="ghost-button" data-testid="request-changes-button" type="button" disabled={!canReviewSubmission} onClick={() => void requestRevisionTask(selectedTask, { acceptanceChecklist })}>
                    <MessageCircle size={17} />
                    {textFor(t, 'Request changes', '要求修改')}
                  </button>
                  <button className="ghost-button" data-testid="reject-submission-button" type="button" disabled={!canReviewSubmission} onClick={() => void rejectTask(selectedTask, { acceptanceChecklist })}>
                    <X size={17} />
                    {textFor(t, 'Reject final', '最终驳回')}
                  </button>
                  <button className="ghost-button" type="button" onClick={() => setPage('community')}>
                    <MessageCircle size={17} />
                    {textFor(t, 'Message maker', '联系创作者')}
                  </button>
                </div>
              </>
            ) : (
              <>
                {submissionCollection?.loading && (
                  <div className="empty-state">
                    <strong>{textFor(t, 'Loading submissions', '正在加载交付')}</strong>
                    <span>{textFor(t, 'Syncing normalized submission records.', '正在同步标准化交付记录。')}</span>
                  </div>
                )}
                {submissionCollection?.error && (
                  <div className="empty-state">
                    <strong>{textFor(t, 'Submission API unavailable', '交付 API 暂不可用')}</strong>
                    <span>{submissionCollection.error}</span>
                    <button className="ghost-button" type="button" onClick={() => void refreshSubmissions(selectedTask)}>
                      {textFor(t, 'Retry submissions', '重试交付')}
                    </button>
                  </div>
                )}
                {visibleSubmissions.length > 0 && (
                  <div className="proposal-list">
                    {visibleSubmissions.map((submission) => (
                      <div className="proposal-card" key={submission.id}>
                        <div>
                          <strong>{statusLabel(submission.status, t)}</strong>
                          <span>{submission.content}</span>
                          <small>{submission.rightsNote || textFor(t, 'No rights note provided', '未填写版权说明')}</small>
                          {submission.reviewNote && <small>{submission.reviewNote}</small>}
                          {submission.acceptanceChecklist?.length > 0 && (
                            <small>
                              {submission.acceptanceChecklist.map((item) => `${item.checked ? 'OK' : 'Needs work'}: ${item.label}`).join(' · ')}
                            </small>
                          )}
                        </div>
                        <StatusBadge status={submission.status} t={t} />
                      </div>
                    ))}
                  </div>
                )}
                <div className="form-panel inline-form">
                  <InfoBox title={textFor(t, 'Fields to submit for this task type', '此任务类型需提交')} items={selectedFields.map((field) => `${field.label}: ${field.value}`)} />
                  <MediaUploadPanel
                    t={t}
                    purpose="submission_asset"
                    assets={submissionAssets}
                    setAssets={setSubmissionAssets}
                    title={textFor(t, 'Submission assets', '交付资产')}
                    simulateAction={simulateAction}
                  />
                  <label>
                    {textFor(t, 'Result links', '成果链接')}
                    <input defaultValue={textFor(t, 'drive/final-pack, figma/preview-board, loom/walkthrough', '网盘/最终交付包，飞书/预览板，录屏/讲解')} />
                  </label>
                  <label>
                    {textFor(t, 'Delivery note', '交付说明')}
                    <textarea defaultValue={textFor(t, 'Included final export, editable prompts, revision summary, and commercial usage note.', '已包含最终导出、可编辑提示词、修改摘要和商用范围说明。')} />
                  </label>
                </div>
                <div className="button-row">
                  <button
                    className="primary-button"
                    data-testid="submit-work-button"
                    type="button"
                    disabled={!canSubmitWork}
                    onClick={() =>
                      void submitTask(selectedTask, {
                        assetIds: submissionAssets.map((asset) => asset.id),
                        rightsNote: submissionAssets.length
                          ? textFor(t, 'Uploaded assets are cleared for the agreed task scope.', '已上传资产可按任务约定范围使用。')
                          : undefined,
                      })
                    }
                  >
                    <Upload size={17} />
                    {textFor(t, 'Submit acceptance work', '提交验收成果')}
                  </button>
                  <button className="ghost-button" type="button" onClick={() => setPage('community')}>
                    <MessageCircle size={17} />
                    {textFor(t, 'Continue discussion', '继续沟通')}
                  </button>
                  {canOpenDispute && (
                    <button className="ghost-button" data-testid="open-dispute-button" type="button" onClick={() => void openDisputeTask(selectedTask)}>
                      <MessageCircle size={17} />
                      {textFor(t, 'Open dispute', '发起争议')}
                    </button>
                  )}
                </div>
              </>
            )}
          </article>
        )}
      </div>
    </div>
  )
}
