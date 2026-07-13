import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BadgeDollarSign,
  BriefcaseBusiness,
  Check,
  Clock3,
  FileText,
  MessageCircle,
  Plus,
  Send,
  Sparkles,
  Upload,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react'
import type { AsyncResourceState, MarketplaceProfile, Page, PublishDraft, SimulateAction, Task } from '../../domain/types'
import { SectionHeader } from '../../components/ui/SectionHeader'
import type { TaskChildCollection } from '../../hooks/useTaskWorkflows'
import { mediaService } from '../../services/mediaService'
import type { ApiAcceptanceChecklistItem, ApiMediaAsset, ApiProfileSummary, ApiTaskProposal, ApiTaskSubmission, ApiTaskTimelineItem, MediaAssetPurpose } from '../../services/contracts'
import {
  categoryLabel,
  findProfile,
  isZhCopy,
  localizeText,
  localizedTasks,
  matchProfilesForDraft,
  profileTags,
  publishFieldLabel,
  rankProfiles,
  statusLabel,
  textFor,
} from '../../domain/utils'

export function TasksPage({
  t,
  tasks,
  setPage,
  openProfile,
  submitProposal,
  selectedTask,
  setSelectedTask,
  status,
  simulateAction,
}: {
  t: Record<string, string>
  tasks: Task[]
  setPage: (page: Page) => void
  openProfile: (profile: MarketplaceProfile) => void
  submitProposal: (task: Task) => Promise<void>
  selectedTask: Task
  setSelectedTask: (task: Task) => void
  status: AsyncResourceState
  simulateAction: SimulateAction
}) {
  const isZh = isZhCopy(t)
  const scopedTasks = localizedTasks(tasks, t)
  const openTasks = scopedTasks.filter((task) => task.status === 'Open')
  const categories = ['All', 'Music', 'Image', 'Video', 'Voice', 'Prompt', 'Design', 'Automation']
  const [activeCategory, setActiveCategory] = useState('All')
  const openTaskCount = openTasks.length
  const activeMakerCount = rankProfiles('maker').length
  const visibleTasks =
    activeCategory === 'All'
      ? openTasks
      : openTasks.filter((task) => task.category === activeCategory || (activeCategory === 'Design' && task.category === 'Image'))
  const activeSelectedTask =
    visibleTasks.find((task) => task.id === selectedTask.id) ?? openTasks.find((task) => task.id === selectedTask.id) ?? openTasks[0] ?? selectedTask
  const publisherProfile = findProfile(activeSelectedTask.publisher)
  const hasSubmittedProposal = activeSelectedTask.assignee !== 'Unassigned'

  const selectCategory = (category: string) => {
    const matches =
      category === 'All'
        ? openTasks
        : openTasks.filter((task) => task.category === category || (category === 'Design' && task.category === 'Image'))
    setActiveCategory(category)
    const firstMatch = matches[0]
    if (firstMatch) {
      setSelectedTask(firstMatch)
    }
    simulateAction(
      isZh
        ? `已切换任务分类：${categoryLabel(category, t)}，当前显示 ${matches.length} 条结果`
        : `Task category changed to ${category}. Showing ${matches.length} results.`,
    )
  }

  return (
    <div className="stack">
      <SectionHeader
        eyebrow={textFor(t, 'Marketplace', '任务市场')}
        title={t.tasksTitle}
        action={
          <button className="primary-button" type="button" onClick={() => setPage('publish')}>
            <Plus size={17} />
            {t.postTask}
          </button>
        }
      />
      <div className="market-dashboard">
        {[
          [textFor(t, 'Open tasks', '开放任务'), `${openTaskCount}`, textFor(t, 'Music, image, video, voice, automation', '音乐、图片、视频、配音、自动化')],
          [textFor(t, 'Active makers', '活跃创作者'), `${activeMakerCount}`, textFor(t, 'Available for scoped AI work', '可接取明确范围的 AI 工作')],
          [textFor(t, 'Avg. response', '平均响应'), '18m', textFor(t, 'Fast proposals and discussion', '快速提案与讨论')],
          [textFor(t, 'Available categories', '可接取分类'), `${categories.length - 1}`, textFor(t, 'Browse open AI requests by category', '按分类浏览开放 AI 需求')],
        ].map(([label, value, text]) => (
          <article className="metric-card highlight" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{text}</small>
          </article>
        ))}
      </div>
      <div className="tasks-workspace">
        <div className="tasks-main">
          {(status.loading || status.error) && (
            <div className="empty-state">
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
          <div className="chip-row">
            {categories.map((category) => (
              <button
                className={activeCategory === category ? 'chip active' : 'chip'}
                type="button"
                key={category}
                onClick={() => selectCategory(category)}
              >
                {categoryLabel(category, t)}
              </button>
            ))}
          </div>
          <div className="content-grid task-layout">
            <div className="task-list">
              {visibleTasks.map((task) => (
                <button
                  className={activeSelectedTask.id === task.id ? 'task-card active' : 'task-card'}
                  data-testid={`task-card-${task.id}`}
                  type="button"
                  key={task.id}
                  onClick={() => {
                    setSelectedTask(task)
                    simulateAction(isZh ? `已打开任务详情：${task.title}` : `Opened task detail: ${task.title}`)
                  }}
                >
                  <div>
                    <strong>{task.title}</strong>
                    <span>
                      {categoryLabel(task.category, t)} · {task.deadline}
                    </span>
                    <span>{task.points} · @{task.publisher}</span>
                  </div>
                  <div>
                    <b>{task.points}</b>
                  </div>
                </button>
              ))}
              {visibleTasks.length === 0 && (
                <div className="empty-state">
                  <strong>{textFor(t, 'No tasks in this category', '当前分类暂无任务')}</strong>
                  <span>{textFor(t, 'Publish a simulated task or switch to another category.', '可以发布一个中文模拟任务，或切换到其他分类继续测试。')}</span>
                </div>
              )}
            </div>
            <article className="panel task-detail">
              <div className="detail-top">
                <span>{activeSelectedTask.proposals} {textFor(t, 'proposals', '个提案')}</span>
              </div>
              <h2>{activeSelectedTask.title}</h2>
              <p>{activeSelectedTask.description}</p>
              <div className="proposal-note">
                {textFor(
                  t,
                  'Multiple makers can submit proposal drafts for this open task. The publisher reviews all proposals from My Tasks, chooses one plan, then starts discussion and delivery.',
                  '开放任务支持多位创作者提交方案草稿。发布方会在个人中心查看全部方案，选择一个方案后再进入沟通与交付。',
                )}
              </div>
              <div className="detail-stats">
                <span>
                  <BadgeDollarSign size={17} />
                  {activeSelectedTask.points}
                </span>
                <span>
                  <Clock3 size={17} />
                  {activeSelectedTask.deadline}
                </span>
                <span>
                  <UsersRound size={17} />
                  {activeSelectedTask.proposals} {textFor(t, 'makers', '位创作者')}
                </span>
              </div>
              <div className="split-row">
                <span>
                  {textFor(t, 'Publisher', '发布方')}:{' '}
                  {publisherProfile ? (
                    <button className="profile-link" type="button" onClick={() => openProfile(publisherProfile)}>
                      @{activeSelectedTask.publisher}
                    </button>
                  ) : (
                    <>@{activeSelectedTask.publisher}</>
                  )}
                </span>
                <span>
                  {textFor(t, 'Proposal mode', '方案模式')}:{' '}
                  {hasSubmittedProposal ? (
                    <>{textFor(t, 'Your draft submitted', '你的方案已提交')}</>
                  ) : (
                    <>{textFor(t, 'Open to multiple proposals', '多人可提交方案')}</>
                  )}
                </span>
              </div>
              <div className="button-row">
                <button className="primary-button" data-testid="submit-proposal-button" type="button" onClick={() => void submitProposal(activeSelectedTask)}>
                  <BriefcaseBusiness size={17} />
                  {t.takeTask}
                </button>
              </div>
              <div className="proposal-flow">
                {(isZh
                  ? ['提交方案', '发布方选择方案', '双方沟通', '提交验收成果']
                  : ['Submit proposal', 'Publisher chooses', 'Discuss together', 'Submit deliverable']
                ).map((step, index) => (
                  <span className="flow-step" key={step}>
                    <b>{index + 1}</b>
                    {step}
                  </span>
                ))}
              </div>
              <div className="detail-section-grid">
                <InfoBox title={textFor(t, 'Submission requirements', '提交要求')} items={activeSelectedTask.requirements} />
                <InfoBox title={textFor(t, 'Attachments', '附件')} items={activeSelectedTask.attachments} />
                <InfoBox title={textFor(t, 'Private brief', '私密说明')} text={activeSelectedTask.privateBrief} />
                <InfoBox title={textFor(t, 'Rights', '版权范围')} text={activeSelectedTask.rights} />
              </div>
            </article>
          </div>
        </div>
        <aside className="tasks-sidebar">
          <div className="leaderboard-grid">
            <LeaderboardPanel
              t={t}
              lane="maker"
              title={textFor(t, 'Taker ranking', '接单排行榜')}
              subtitle={textFor(t, 'Best matched makers by delivery score', '按交付分、通过率和响应速度排序')}
              profiles={rankProfiles('maker').slice(0, 5)}
              openProfile={openProfile}
            />
            <LeaderboardPanel
              t={t}
              lane="publisher"
              title={textFor(t, 'Publisher ranking', '发需求排行榜')}
              subtitle={textFor(t, 'Publishers with clear briefs and fast acceptance', '按需求清晰度、发布量和验收速度排序')}
              profiles={rankProfiles('publisher').slice(0, 5)}
              openProfile={openProfile}
            />
          </div>
        </aside>
      </div>
    </div>
  )
}

export function StatusBadge({ status, t }: { status: string; t?: Record<string, string> }) {
  return <span className={`status-badge ${status.toLowerCase().replace(/\s/g, '-')}`}>{statusLabel(status, t)}</span>
}

export function InfoBox({ title, text, items }: { title: string; text?: string; items?: string[] }) {
  return (
    <div className="deliverable-box">
      <strong>{title}</strong>
      {text && <p>{text}</p>}
      {items && (
        <ul className="clean-list">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
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
      const contract = await mediaService.createUpload({
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        purpose,
        metadata: { source: 'task-workflow-ui' },
      })
      if (!contract.upload.url.startsWith('mock://')) {
        await fetch(contract.upload.url, {
          method: contract.upload.method,
          headers: contract.upload.headers,
          body: file,
        })
      }
      const completed = await mediaService.completeUpload(contract.asset.id)
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

export function LeaderboardPanel({
  t,
  lane,
  title,
  subtitle,
  profiles,
  openProfile,
}: {
  t: Record<string, string>
  lane: 'maker' | 'publisher'
  title: string
  subtitle: string
  profiles: MarketplaceProfile[]
  openProfile: (profile: MarketplaceProfile) => void
}) {
  const isZh = isZhCopy(t)
  return (
    <section className="leaderboard-panel">
      <div className="leaderboard-head">
        <div>
          <span className="eyebrow">{lane === 'maker' ? textFor(t, 'Makers', '接单者') : textFor(t, 'Publishers', '发布者')}</span>
          <strong>{title}</strong>
        </div>
        <span>{subtitle}</span>
      </div>
      <div className="rank-list">
        {profiles.map((profile, index) => (
          <button className="rank-row" type="button" key={profile.id} onClick={() => openProfile(profile)}>
            <b>#{index + 1}</b>
            <span className="avatar compact">{profile.initials}</span>
            <span className="rank-copy">
              <strong>{localizeText(profile.name, t)}</strong>
              <small>@{profile.handle} · {profileTags(profile, t).slice(0, 2).join(' / ')}</small>
            </span>
            <span className="rank-metric">
              <strong>{lane === 'maker' ? profile.stats.completed : profile.stats.posted}</strong>
              <small>{lane === 'maker' ? (isZh ? '完成' : 'done') : isZh ? '发布' : 'posted'}</small>
            </span>
            <span className="rank-metric">
              <strong>{lane === 'maker' ? profile.stats.acceptance : profile.stats.response}</strong>
              <small>{lane === 'maker' ? (isZh ? '通过率' : 'accept') : isZh ? '响应' : 'response'}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

export function PublishPage({
  t,
  setPage,
  requireAuth,
  publishTask,
  openProfile,
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
  const [draft, setDraft] = useState<PublishDraft>({
    title: textFor(t, 'Create a 30-second AI product launch video', '制作一套中文 AI 课程宣传短视频'),
    category: 'Video',
    reward: textFor(t, '$450 / 4,500 pts', '¥2,800 / 2,800 积分'),
    deadline: textFor(t, '3 days', '4 天'),
    visibility: 'Public brief + private files',
    details: textFor(
      t,
      'Need a polished vertical video with product shots, captions, music, and fast edits.',
      '需要 3 条中文竖版短视频，包含课程卖点、字幕、AI 配音和封面建议。',
    ),
    rules: textFor(
      t,
      'Submit script, preview link, final MP4, captions, cover prompt, and rights summary.',
      '提交脚本、预览链接、最终 MP4、字幕文件、封面提示词和版权摘要。',
    ),
  })
  const [taskAssets, setTaskAssets] = useState<ApiMediaAsset[]>([])

  type EditablePublishField = Exclude<keyof PublishDraft, 'attachmentIds'>
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
    simulateAction(
      isZh
        ? `AI 已补全${publishFieldLabel(key, t)}`
        : `AI filled: ${publishFieldLabel(key, t)}`,
    )
  }
  const aiButtonLabel = (key: EditablePublishField) =>
    isZh
      ? `用 AI 补全${publishFieldLabel(key, t)}`
      : `Use AI for ${publishFieldLabel(key, t)}`
  const renderAiButton = (key: EditablePublishField) => (
    <button
      aria-label={aiButtonLabel(key)}
      className="icon-button ai-field-button"
      onClick={() => improveDraftField(key)}
      title={aiButtonLabel(key)}
      type="button"
    >
      <Sparkles size={16} />
    </button>
  )
  const recommendedProfiles = useMemo(() => matchProfilesForDraft(draft), [draft])

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
              <select value={draft.category} onChange={(event) => updateDraft('category', event.target.value)}>
                {['Music', 'Image', 'Video', 'Voice', 'Prompt', 'Automation'].map((item) => (
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
              <input value={draft.deadline} onChange={(event) => updateDraft('deadline', event.target.value)} />
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
                className="publish-brief-editor"
                value={draft.details}
                onChange={(event) => updateDraft('details', event.target.value)}
              />
              {renderAiButton('details')}
            </span>
          </label>
          <label>
            {textFor(t, 'Submission and acceptance rules', '提交与验收规则')}
            <span className="ai-field textarea-field">
              <textarea
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
            <button className="primary-button" type="button" onClick={() => void publishTask({ ...draft, attachmentIds: taskAssets.map((asset) => asset.id) })}>
              <Upload size={17} />
              {textFor(t, 'Publish task', '发布任务')}
            </button>
            <button className="ghost-button" type="button" onClick={requireAuth}>
              <FileText size={17} />
              {textFor(t, 'Save draft', '保存草稿')}
            </button>
          </div>
        </div>
        <aside className="side-stack">
          <section className="panel side-panel compact-panel">
            <SectionHeader eyebrow={textFor(t, 'Auto checks', '自动检查')} title={textFor(t, 'Ready to publish', '可以发布')} />
          {(isZh
            ? ['标题清晰', '预算和积分已填写', '包含验收标准', '附件已标记私密', '已开启社区讨论']
            : ['Clear title', 'Budget and points set', 'Acceptance criteria included', 'Attachments marked private', 'Community discussion enabled']
          ).map((item) => (
            <div className="check-line" key={item}>
              <Check size={16} />
              <span>{item}</span>
            </div>
          ))}
          <button className="ghost-button" type="button" onClick={() => setPage('community')}>
            <MessageCircle size={17} />
            {textFor(t, 'Discuss in community', '到社区讨论')}
          </button>
          </section>
          <section className="panel match-panel">
            <SectionHeader
              eyebrow={textFor(t, 'Smart matching', '智能匹配')}
              title={textFor(t, 'Recommended makers', '推荐接单用户')}
            />
            <div className="match-list">
              {recommendedProfiles.map(({ profile, score, tags, categoryHit, languageHit }) => {
                const visibleTags = tags.length ? tags : profileTags(profile, t).slice(0, 2)
                return (
                  <article className="match-card" key={profile.id}>
                    <div className="match-card-top">
                      <span className="avatar compact">{profile.initials}</span>
                      <div>
                        <strong>{localizeText(profile.name, t)}</strong>
                        <span>@{profile.handle} · {localizeText(profile.role, t)}</span>
                      </div>
                      <b>{score}%</b>
                    </div>
                    <p>
                      {categoryHit
                        ? textFor(t, 'Category match', '分类匹配')
                        : textFor(t, 'Related skill match', '相关能力匹配')}
                      {languageHit ? ` · ${textFor(t, 'Chinese ready', '支持中文')}` : ''}
                      {' · '}
                      {textFor(t, 'Response', '响应')} {profile.stats.response}
                    </p>
                    <div className="skill-cloud compact">
                      {visibleTags.map((tag) => (
                        <span className="tag" key={tag}>{tag}</span>
                      ))}
                    </div>
                    <div className="button-row compact-buttons">
                      <button className="ghost-button" type="button" onClick={() => openProfile(profile)}>
                        <UserRound size={16} />
                        {textFor(t, 'Profile', '主页')}
                      </button>
                      <button
                        className="primary-button"
                        type="button"
                        onClick={() =>
                          simulateAction(
                            isZh
                              ? `已邀请 @${profile.handle} 查看需求：${draft.title}`
                              : `Invited @${profile.handle} to review: ${draft.title}`,
                            { description: `Invited maker: @${profile.handle}`, delta: '+2' },
                          )
                        }
                      >
                        <Send size={16} />
                        {textFor(t, 'Invite', '邀请')}
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
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
  refreshProposals = async () => undefined,
  acceptProposal = async () => undefined,
  rejectProposal = async () => undefined,
  refreshSubmissions = async () => undefined,
  refreshTimeline = async () => undefined,
  submitTask,
  approveTask = async () => undefined,
  rejectTask = async () => undefined,
  requestRevisionTask = async () => undefined,
  openDisputeTask = async () => undefined,
  simulateAction,
}: {
  t: Record<string, string>
  tasks: Task[]
  setPage: (page: Page) => void
  accountHandle?: string
  proposalStateByTask?: Record<string, TaskChildCollection<ApiTaskProposal>>
  submissionStateByTask?: Record<string, TaskChildCollection<ApiTaskSubmission>>
  timelineStateByTask?: Record<string, TaskChildCollection<ApiTaskTimelineItem>>
  refreshProposals?: (task: Task) => Promise<void>
  acceptProposal?: (task: Task, proposalId: string) => Promise<void>
  rejectProposal?: (task: Task, proposalId: string) => Promise<void>
  refreshSubmissions?: (task: Task) => Promise<void>
  refreshTimeline?: (task: Task) => Promise<void>
  submitTask: (task: Task, options?: { assetIds?: string[]; rightsNote?: string }) => Promise<void>
  approveTask?: (task: Task, options?: { acceptanceChecklist?: ApiAcceptanceChecklistItem[] }) => Promise<void>
  rejectTask?: (task: Task, options?: { acceptanceChecklist?: ApiAcceptanceChecklistItem[] }) => Promise<void>
  requestRevisionTask?: (task: Task, options?: { acceptanceChecklist?: ApiAcceptanceChecklistItem[] }) => Promise<void>
  openDisputeTask?: (task: Task) => Promise<void>
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
  const proposalRows = isZh
    ? [
        { maker: 'promptlin', title: '结构最清晰，含首版样例和验收拆分', meta: '预计 1 天提交首版' },
        { maker: 'legalpixel', title: '版权边界完整，适合公开模板沉淀', meta: '预计 2 天提交首版' },
        { maker: 'iriswood', title: '视觉参考充分，适合图片/视频类任务', meta: '预计当天确认方向' },
      ]
    : [
        { maker: 'scriptbear', title: 'Clear scope with sample scenes and acceptance checks', meta: 'First draft in 1 day' },
        { maker: 'legalpixel', title: 'Strong rights language and review checklist', meta: 'First draft in 2 days' },
        { maker: 'iriswood', title: 'Visual references fit image and video tasks', meta: 'Direction confirmed today' },
      ]
  const discussionLog = isZh
    ? ['发布方：请先确认前三秒钩子和版权范围。', '创作者：已补充两版方案，保留可编辑提示词。', '发布方：采用第二版，进入交付验收。']
    : ['Publisher: Please confirm the hook and rights scope first.', 'Maker: Added two proposal variants with editable prompts.', 'Publisher: Choosing the second plan and moving to delivery review.']
  const stages = isZh
    ? [
        { label: '待选方案', value: `${publisherTasks.length}`, text: '我发布的任务收到多个方案，等待选择。' },
        { label: '接取任务', value: `${deliveryTasks.length}`, text: '我接取、提交方案或正在交付的任务。' },
        { label: '沟通中', value: '3', text: '双方围绕方案、修改和验收确认。' },
      ]
    : [
        { label: 'Proposal queues', value: `${publisherTasks.length}`, text: 'My posted tasks with multiple proposals to choose from.' },
        { label: 'Accepted tasks', value: `${deliveryTasks.length}`, text: 'Tasks I accepted, proposed for, or am delivering.' },
        { label: 'In discussion', value: '3', text: 'Both sides are aligning scope, revisions, and acceptance.' },
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
  const demoProposals: ApiTaskProposal[] = proposalRows.map((proposal, index) => ({
    id: `demo-proposal-${index}`,
    taskId: selectedTaskKey,
    proposer: {
      handle: proposal.maker,
      name: { en: proposal.maker, zh: proposal.maker },
      role: { en: 'creator', zh: 'creator' },
      lane: 'maker',
      initials: proposal.maker.slice(0, 2).toUpperCase(),
    },
    coverLetter: proposal.title,
    estimate: proposal.meta,
    status: 'pending',
    decisionNote: '',
    createdAt: '',
  }))
  const visibleProposals = proposalCollection?.items.length ? proposalCollection.items : demoProposals
  const visibleSubmissions =
    submissionCollection?.items.length
      ? submissionCollection.items
      : selectedTask?.submission && selectedTask.submission !== 'No submission yet.'
        ? [
            {
              id: `demo-submission-${selectedTaskKey}`,
              taskId: selectedTaskKey,
              submitter: { handle: selectedTask.assignee },
              content: selectedTask.submission,
              assetIds: [],
              rightsNote: selectedTask.rights,
              status: selectedTask.status === 'Completed' ? 'approved' as const : 'pending_review' as const,
              reviewNote: selectedTask.reviewNote,
              acceptanceChecklist: [],
              reviewedBy: null,
              reviewedAt: null,
              createdAt: '',
            },
          ]
        : []
  const canOpenDispute = selectedRole === 'maker' && visibleSubmissions.some((submission) => ['rejected', 'stale'].includes(submission.status))
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
              : textFor(t, `${discussionLog.length} discussion updates`, `${discussionLog.length} 条沟通记录`)}
          </small>
        </div>
      </button>
    )
  }

  return (
    <div className="stack">
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
      <div className="market-dashboard">
        {stages.map((stage) => (
          <article className="metric-card highlight" key={stage.label}>
            <span>{stage.label}</span>
            <strong>{stage.value}</strong>
            <small>{stage.text}</small>
          </article>
        ))}
        <article className="metric-card highlight">
          <span>{textFor(t, 'Points pending', '待结算积分')}</span>
          <strong>4,100</strong>
          <small>{textFor(t, 'Released after selected work passes acceptance.', '被选方案完成验收后发放。')}</small>
        </article>
      </div>
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
                    const isDemo = proposal.id.startsWith('demo-proposal-')
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
                          disabled={proposal.status !== 'pending' && !isDemo}
                          onClick={() =>
                            isDemo
                              ? simulateAction(
                                  isZh ? `已选择方案：${handleFor(proposal.proposer)}` : `Selected proposal from ${handleFor(proposal.proposer)}`,
                                  {
                                    description: isZh ? `选择方案：${handleFor(proposal.proposer)}` : `Selected proposal: ${handleFor(proposal.proposer)}`,
                                    delta: '+0',
                                  },
                                )
                              : void acceptProposal(selectedTask, proposal.id)
                          }
                        >
                          <Check size={15} />
                          {proposal.status === 'accepted' || (isDemo && index === 0) ? textFor(t, 'Selected', '已选择') : textFor(t, 'Choose', '选择方案')}
                        </button>
                        {proposal.status === 'pending' && (
                          <button
                            className="ghost-button small"
                            data-testid={`proposal-reject-${proposal.id}`}
                            type="button"
                            onClick={() =>
                              isDemo
                                ? simulateAction(isZh ? `已暂不采纳：${handleFor(proposal.proposer)}` : `Skipped proposal from ${handleFor(proposal.proposer)}`)
                                : void rejectProposal(selectedTask, proposal.id)
                            }
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
                  <button
                    className="primary-button"
                    data-testid="approve-submission-button"
                    type="button"
                    disabled={!allAcceptanceChecked}
                    onClick={() => void approveTask(selectedTask, { acceptanceChecklist })}
                  >
                    <Check size={17} />
                    {textFor(t, 'Review acceptance', '进入验收')}
                  </button>
                  <button className="ghost-button" data-testid="request-changes-button" type="button" onClick={() => void requestRevisionTask(selectedTask, { acceptanceChecklist })}>
                    <MessageCircle size={17} />
                    {textFor(t, 'Request changes', '要求修改')}
                  </button>
                  <button className="ghost-button" data-testid="reject-submission-button" type="button" onClick={() => void rejectTask(selectedTask, { acceptanceChecklist })}>
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
                <InfoBox title={textFor(t, 'Discussion record', '沟通记录')} items={discussionLog} />
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
