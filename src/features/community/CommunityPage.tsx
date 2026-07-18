import { useRef, useState } from 'react'
import {
  Bookmark,
  BriefcaseBusiness,
  ChevronDown,
  Heart,
  LoaderCircle,
  MessageCircle,
  Pencil,
  Plus,
  Send,
  Save,
  Tags,
  Trash2,
} from 'lucide-react'
import type { AsyncResourceState, CommunityPostDraft, CommunityView, MarketplaceProfile, Post, SimulateAction } from '../../domain/types'
import { SectionHeader } from '../../components/ui/SectionHeader'
import { visualWorks } from '../../data/mockData'
import { categoryLabel, findProfile, isZhCopy, localizedPosts, textFor } from '../../domain/utils'

export function CommunityPage({
  t,
  posts,
  convertPostToTask,
  savePostToLibrary,
  likePost,
  replyToPost,
  openProfile,
  selectedPost,
  setSelectedPost,
  communityFilter,
  setCommunityFilter,
  communityView,
  setCommunityView,
  status,
  simulateAction,
  accountHandle,
  myPosts,
  postMutationBusy,
  refreshMyPosts,
  createPost,
  updatePost,
  publishPost,
  deletePost,
}: {
  t: Record<string, string>
  posts: Post[]
  convertPostToTask: (post: Post) => Promise<void>
  savePostToLibrary: (post: Post) => Promise<void>
  likePost: (post: Post) => Promise<void>
  replyToPost: (post: Post, replyText?: string) => Promise<void>
  openProfile: (profile: MarketplaceProfile) => void
  selectedPost: Post
  setSelectedPost: (post: Post) => void
  communityFilter: string
  setCommunityFilter: (filter: string) => void
  communityView: CommunityView
  setCommunityView: (view: CommunityView) => void
  status: AsyncResourceState
  simulateAction: SimulateAction
  accountHandle: string | null
  myPosts: Post[]
  postMutationBusy: boolean
  refreshMyPosts: () => Promise<void>
  createPost: (draft: CommunityPostDraft, status: 'draft' | 'published') => Promise<Post>
  updatePost: (post: Post, draft: CommunityPostDraft) => Promise<Post>
  publishPost: (post: Post) => Promise<Post>
  deletePost: (post: Post) => Promise<Post>
}) {
  const isZh = isZhCopy(t)
  const scopedPosts = localizedPosts(posts, t)
  const [replyDraft, setReplyDraft] = useState(
    textFor(
      t,
      'I would split acceptance into script approval, first preview, revision log, and final files, each with pass criteria.',
      '建议把验收拆成脚本确认、首版预览、修改记录和最终文件四步，并明确每一步的通过标准。',
    ),
  )
  const [localReplies, setLocalReplies] = useState<Record<string, Array<{ author: string; text: string }>>>({})
  const [topicPage, setTopicPage] = useState(1)
  const emptyPostDraft: CommunityPostDraft = { title: '', body: '', category: 'Questions', tag: '', excerpt: '' }
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingPost, setEditingPost] = useState<Post | null>(null)
  const [postDraft, setPostDraft] = useState<CommunityPostDraft>(emptyPostDraft)
  const [postEditorError, setPostEditorError] = useState<string | null>(null)
  const topicTabsRef = useRef<HTMLDivElement | null>(null)
  const activeSelectedPost =
    scopedPosts.find((post) => post.id === selectedPost.id) ?? scopedPosts[0] ?? selectedPost
  const filteredPosts = scopedPosts.filter((post) => {
    if (communityFilter === 'Hot') return post.votes >= 80 || post.tag === 'Hot' || post.tag === 'Featured'
    if (communityFilter === 'Latest') return true
    if (communityFilter === 'Active') return post.replies >= 10
    if (communityFilter === 'Unanswered') return post.replies === 0 || !post.solved
    if (communityFilter === 'Featured') return post.tag === 'Featured' || post.solved
    if (communityFilter === 'Showcase') return post.category === 'Showcase'
    if (communityFilter === 'Prompts') return post.category === 'Prompts'
    if (communityFilter === 'Tutorials') return post.excerpt.includes('教程') || post.title.toLowerCase().includes('tutorial')
    if (communityFilter === 'Questions') return post.category === 'Questions' || post.category === '提问'
    if (communityFilter === 'Collaboration') return post.excerpt.toLowerCase().includes('collabor') || post.excerpt.includes('协作')
    return true
  })
  const topicsPerPage = 10
  const totalTopicPages = Math.max(1, Math.ceil(filteredPosts.length / topicsPerPage))
  const safeTopicPage = Math.min(topicPage, totalTopicPages)
  const visibleTopics = filteredPosts.slice((safeTopicPage - 1) * topicsPerPage, safeTopicPage * topicsPerPage)
  const topicPages = Array.from({ length: totalTopicPages }, (_, index) => index + 1)
  const filterOptions = [
    ['Hot', isZh ? '热门' : 'Hot'],
    ['Latest', isZh ? '最新' : 'Latest'],
    ['Active', isZh ? '活跃' : 'Active'],
    ['Unanswered', isZh ? '未回复' : 'Unanswered'],
    ['Featured', isZh ? '精选' : 'Featured'],
    ['Showcase', isZh ? '作品' : 'Showcase'],
    ['Prompts', isZh ? '提示词' : 'Prompts'],
    ['Tutorials', isZh ? '教程' : 'Tutorials'],
    ['Questions', isZh ? '问答' : 'Questions'],
    ['Collaboration', isZh ? '协作' : 'Collaboration'],
  ]
  const filterLabel = (filter: string) => filterOptions.find(([key]) => key === filter)?.[1] ?? filter
  const scrollTopicTabs = (direction: 'left' | 'right') => {
    const el = topicTabsRef.current
    if (!el) return
    const delta = Math.max(240, Math.round(el.clientWidth * 0.7))
    el.scrollBy({ left: direction === 'left' ? -delta : delta, behavior: 'smooth' })
  }
  const hotPosts = [...scopedPosts].sort((a, b) => b.votes - a.votes).slice(0, 5)
  const sidebarTags = [
    ['Latest', isZh ? '全部话题' : 'All topics', scopedPosts.length],
    ['Questions', isZh ? '问答求助' : 'Q&A', scopedPosts.filter((post) => post.category === 'Questions' || post.category === '提问').length],
    ['Tutorials', isZh ? '教程复盘' : 'Tutorials', scopedPosts.filter((post) => post.category === 'Tutorials').length],
    ['Showcase', isZh ? '作品展示' : 'Showcase', scopedPosts.filter((post) => post.category === 'Showcase').length],
    ['Collaboration', isZh ? '协作招募' : 'Collaboration', scopedPosts.filter((post) => post.category === 'Collaboration').length],
  ] as const

  const chooseFilter = (filter: string) => {
    setCommunityFilter(filter)
    setTopicPage(1)
    const matches = scopedPosts.filter((post) => {
      if (filter === 'Hot') return post.votes >= 80 || post.tag === 'Hot' || post.tag === 'Featured'
      if (filter === 'Latest') return true
      if (filter === 'Active') return post.replies >= 10
      if (filter === 'Unanswered') return post.replies === 0 || !post.solved
      if (filter === 'Featured') return post.tag === 'Featured' || post.solved
      if (filter === 'Showcase') return post.category === 'Showcase'
      if (filter === 'Prompts') return post.category === 'Prompts'
      if (filter === 'Tutorials') return post.excerpt.includes('教程') || post.title.toLowerCase().includes('tutorial')
      if (filter === 'Questions') return post.category === 'Questions' || post.category === '提问'
      if (filter === 'Collaboration') return post.excerpt.toLowerCase().includes('collabor') || post.excerpt.includes('协作')
      return true
    })
    if (matches[0]) {
      setSelectedPost(matches[0])
    }
    setCommunityView('list')
    simulateAction(isZh ? `已切换社区筛选：${filterLabel(filter)}，匹配 ${matches.length} 个帖子` : `Community filter changed: ${filter}. ${matches.length} topics matched.`)
  }

  const goToTopicPage = (page: number) => {
    const target = Math.min(totalTopicPages, Math.max(1, page))
    setTopicPage(target)
    const firstTopic = filteredPosts.slice((target - 1) * topicsPerPage, target * topicsPerPage)[0]
    if (firstTopic) {
      setSelectedPost(firstTopic)
    }
    setCommunityView('list')
    simulateAction(isZh ? `已切换到话题列表第 ${target} 页` : `Topic list changed to page ${target}`)
  }

  const showTopicDetail = (post: Post) => {
    setSelectedPost(post)
    setCommunityView('detail')
    requestAnimationFrame(() => document.querySelector('.forum-main')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const openAuthorProfile = (author: string) => {
    const profile = findProfile(author)
    if (profile) {
      openProfile(profile)
      return
    }
    simulateAction(isZh ? `暂无 @${author} 的公开主页资料` : `No public profile mock is available for @${author}`)
  }

  const backToTopicList = () => {
    setCommunityView('list')
    requestAnimationFrame(() => document.querySelector('.forum-main')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const submitReply = () => {
    const text = replyDraft.trim()
    if (!text) {
      simulateAction(isZh ? '请先输入回复内容' : 'Please enter a reply first')
      return
    }
    const postKey = String(activeSelectedPost.id)
    setLocalReplies((current) => ({
      ...current,
      [postKey]: [...(current[postKey] ?? []), { author: 'you', text }],
    }))
    void replyToPost(activeSelectedPost, text)
    setReplyDraft('')
  }

  const resetPostEditor = () => {
    setEditingPost(null)
    setPostDraft(emptyPostDraft)
    setPostEditorError(null)
    setEditorOpen(false)
  }

  const openPostEditor = (post?: Post) => {
    setEditingPost(post ?? null)
    setPostDraft(post ? {
      title: post.title,
      body: post.body ?? '',
      category: post.category,
      tag: post.tag,
      excerpt: post.excerpt,
    } : emptyPostDraft)
    setPostEditorError(null)
    setEditorOpen(true)
  }

  const submitPost = async (target: 'draft' | 'published') => {
    if (!postDraft.title.trim() || !postDraft.body.trim() || !postDraft.category.trim()) {
      setPostEditorError(isZh ? '标题、正文和分类不能为空。' : 'Title, body, and category are required.')
      return
    }
    setPostEditorError(null)
    try {
      if (!editingPost) {
        await createPost(postDraft, target)
      } else {
        const updated = await updatePost(editingPost, postDraft)
        if (target === 'published' && updated.status === 'draft') await publishPost(updated)
      }
      resetPostEditor()
      await refreshMyPosts()
    } catch (error) {
      console.info('[community-post-editor]', error)
      setPostEditorError(isZh ? '保存失败，请刷新后重试。' : 'Save failed. Refresh and try again.')
    }
  }

  const removePost = async (post: Post) => {
    if (!window.confirm(isZh ? `删除“${post.title}”？` : `Delete “${post.title}”?`)) return
    try {
      await deletePost(post)
      if (editingPost?.id === post.id) resetPostEditor()
    } catch (error) {
      console.info('[community-post-delete]', error)
      setPostEditorError(isZh ? '删除失败，请刷新后重试。' : 'Delete failed. Refresh and try again.')
    }
  }

  const publishDraftPost = async (post: Post) => {
    setPostEditorError(null)
    try {
      await publishPost(post)
    } catch (error) {
      console.info('[community-post-publish]', error)
      setPostEditorError(isZh ? '发布失败，请刷新后重试。' : 'Publish failed. Refresh and try again.')
    }
  }

  return (
    <div className="stack">
      <SectionHeader
        eyebrow={textFor(t, 'Forum', '论坛')}
        title={t.communityTitle}
      />
      <section className="community-author-workspace" data-testid="community-author-workspace">
        <div className="community-author-toolbar">
          <div>
            <strong>{isZh ? '我的内容' : 'My posts'}</strong>
            <span>{accountHandle ? `@${accountHandle}` : (isZh ? '登录后可创作' : 'Sign in to create')}</span>
          </div>
          <button className="primary-button" type="button" disabled={!accountHandle || postMutationBusy} onClick={() => editorOpen ? resetPostEditor() : openPostEditor()}>
            {editorOpen ? <ChevronDown size={16} /> : <Plus size={16} />}
            {editorOpen ? (isZh ? '收起' : 'Close') : (isZh ? '新建帖子' : 'New post')}
          </button>
        </div>
        {postEditorError && <div className="inline-error" role="alert">{postEditorError}</div>}
        {editorOpen && (
          <div className="community-post-editor">
            <div className="community-editor-grid">
              <label>
                <span>{isZh ? '标题' : 'Title'}</span>
                <input maxLength={160} value={postDraft.title} onChange={(event) => setPostDraft((current) => ({ ...current, title: event.target.value }))} />
              </label>
              <label>
                <span>{isZh ? '分类' : 'Category'}</span>
                <select value={postDraft.category} onChange={(event) => setPostDraft((current) => ({ ...current, category: event.target.value }))}>
                  <option value="Questions">{isZh ? '问答' : 'Questions'}</option>
                  <option value="Showcase">{isZh ? '作品展示' : 'Showcase'}</option>
                  <option value="Tutorials">{isZh ? '教程' : 'Tutorials'}</option>
                  <option value="Collaboration">{isZh ? '协作' : 'Collaboration'}</option>
                  <option value="Prompts">{isZh ? '提示词' : 'Prompts'}</option>
                </select>
              </label>
              <label>
                <span>{isZh ? '标签' : 'Tag'}</span>
                <input maxLength={80} value={postDraft.tag} onChange={(event) => setPostDraft((current) => ({ ...current, tag: event.target.value }))} />
              </label>
              <label className="community-editor-wide">
                <span>{isZh ? '摘要' : 'Excerpt'}</span>
                <input maxLength={500} value={postDraft.excerpt} onChange={(event) => setPostDraft((current) => ({ ...current, excerpt: event.target.value }))} />
              </label>
              <label className="community-editor-wide">
                <span>{isZh ? '正文' : 'Body'}</span>
                <textarea maxLength={20000} value={postDraft.body} onChange={(event) => setPostDraft((current) => ({ ...current, body: event.target.value }))} />
              </label>
            </div>
            <div className="community-editor-actions">
              {!editingPost && (
                <button className="ghost-button" type="button" disabled={postMutationBusy} onClick={() => void submitPost('draft')}>
                  {postMutationBusy ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
                  {isZh ? '保存草稿' : 'Save draft'}
                </button>
              )}
              <button className="primary-button" type="button" disabled={postMutationBusy} onClick={() => void submitPost(editingPost?.status === 'published' ? 'draft' : 'published')}>
                {postMutationBusy ? <LoaderCircle className="spin" size={16} /> : editingPost?.status === 'published' ? <Save size={16} /> : <Send size={16} />}
                {editingPost?.status === 'published' ? (isZh ? '保存修改' : 'Save changes') : (isZh ? '发布' : 'Publish')}
              </button>
            </div>
          </div>
        )}
        {accountHandle && myPosts.length > 0 && (
          <div className="community-owned-list">
            {myPosts.map((post) => (
              <article className="community-owned-row" key={post.id}>
                <div>
                  <strong>{post.title}</strong>
                  <span>{post.status === 'draft' ? (isZh ? '草稿' : 'Draft') : post.status === 'deleted' ? (isZh ? '已删除' : 'Deleted') : (isZh ? '已发布' : 'Published')} · v{post.version ?? 1}</span>
                </div>
                <div className="community-owned-actions">
                  {post.status !== 'deleted' && <button className="icon-button" type="button" disabled={postMutationBusy} onClick={() => openPostEditor(post)} title={isZh ? '编辑' : 'Edit'}><Pencil size={16} /></button>}
                  {post.status === 'draft' && <button className="icon-button" type="button" disabled={postMutationBusy} onClick={() => void publishDraftPost(post)} title={isZh ? '发布' : 'Publish'}><Send size={16} /></button>}
                  {post.status !== 'deleted' && <button className="icon-button danger" type="button" disabled={postMutationBusy} onClick={() => void removePost(post)} title={isZh ? '删除' : 'Delete'}><Trash2 size={16} /></button>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <div className="community-strip">
        {[
          [isZh ? '话题总数' : 'Topics', scopedPosts.length, isZh ? '帖子、问答、复盘' : 'Posts and recaps'],
          [isZh ? '待回复' : 'Unanswered', scopedPosts.filter((post) => post.replies === 0 || !post.solved).length, isZh ? '需要社区处理' : 'Need attention'],
          [isZh ? '可转任务' : 'Task-ready', scopedPosts.filter((post) => post.category === 'Questions' || post.category === 'Task Recap').length, isZh ? '适合发布需求' : 'Ready to scope'],
        ].map(([label, value, hint]) => (
          <article className="community-kpi" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{hint}</small>
          </article>
        ))}
      </div>
      <div className="community-layout">
        <section className={communityView === 'detail' ? 'forum-main detail-mode' : 'forum-main'}>
          {(status.loading || status.error) && (
            <div className="empty-state">
              <strong>
                {status.loading
                  ? textFor(t, 'Syncing community', '正在同步社区')
                  : textFor(t, 'Community API unavailable', '社区 API 暂不可用')}
              </strong>
              <span>
                {status.loading
                  ? textFor(t, 'Loading posts and inspiration library from the API.', '正在从 API 加载帖子和灵感库。')
                  : status.error}
              </span>
              {status.error && (
                <button className="ghost-button" type="button" onClick={() => void status.refresh()}>
                  {textFor(t, 'Retry sync', '重试同步')}
                </button>
              )}
            </div>
          )}
          {communityView === 'list' ? (
            <>
              <div className="topic-toolbar">
                <strong>{isZh ? '全部话题' : 'All topics'}</strong>
                <div className="topic-tabs-wrap">
                  <button className="icon-button topic-tabs-nav" type="button" onClick={() => scrollTopicTabs('left')} aria-label={isZh ? '向左翻动标签' : 'Scroll tags left'}>
                    <ChevronDown size={16} className="topic-tabs-nav-left" />
                  </button>
                  <div className="topic-tabs" ref={topicTabsRef} aria-label={isZh ? '社区筛选' : 'Community filters'}>
                    {filterOptions.map(([filter, label]) => (
                      <button
                        className={communityFilter === filter ? 'chip active' : 'chip'}
                        type="button"
                        key={filter}
                        onClick={() => chooseFilter(filter)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <button className="icon-button topic-tabs-nav" type="button" onClick={() => scrollTopicTabs('right')} aria-label={isZh ? '向右翻动标签' : 'Scroll tags right'}>
                    <ChevronDown size={16} className="topic-tabs-nav-right" />
                  </button>
                </div>
              </div>
              <div className="topic-table">
                <div className="topic-head">
                  <span>{isZh ? '话题' : 'Topic'}</span>
                  <span>{isZh ? '赞' : 'Votes'}</span>
                  <span>{isZh ? '回复' : 'Replies'}</span>
                  <span>{isZh ? '浏览' : 'Views'}</span>
                  <span>{isZh ? '状态' : 'Status'}</span>
                </div>
                <div className="topic-table-body">
                  {visibleTopics.map((post) => (
                    <article className={activeSelectedPost.id === post.id ? 'topic-row active' : 'topic-row'} key={post.id}>
                      <div className="topic-main">
                        <button
                          className="topic-title-button"
                          type="button"
                          onClick={() => {
                            showTopicDetail(post)
                            simulateAction(isZh ? '已打开社区帖子：' + post.title : 'Opened community topic: ' + post.title)
                          }}
                        >
                          <span className="topic-title-text">{post.title}</span>
                          <span className={post.solved ? 'topic-state solved' : 'topic-state'}>
                            {post.solved ? (isZh ? '已解决' : 'Solved') : isZh ? '讨论中' : 'Open'}
                          </span>
                        </button>
                        <div className="task-meta forum-tags">
                          <span className="tag">{post.tag}</span>
                          <span className="tag">{categoryLabel(post.category, t)}</span>
                        </div>
                        <span className="topic-meta-line">
                          <button className="profile-link topic-author-link" type="button" onClick={() => openAuthorProfile(post.author)}>
                            @{post.author}
                          </button>{' '}
                          / {post.excerpt}
                        </span>
                      </div>
                      <span className="topic-stat">
                        <strong>{post.votes}</strong>
                        {isZh ? '赞' : 'votes'}
                      </span>
                      <span className="topic-stat">
                        <strong>{post.replies}</strong>
                        {isZh ? '回复' : 'replies'}
                      </span>
                      <span className="topic-stat">
                        <strong>{post.views}</strong>
                        {isZh ? '浏览' : 'views'}
                      </span>
                      <span className="topic-stat">{post.solved ? (isZh ? '已解决' : 'Solved') : filterLabel(communityFilter)}</span>
                    </article>
                  ))}
                  {filteredPosts.length === 0 && (
                    <div className="topic-empty">
                      <strong>{isZh ? '当前筛选暂无话题' : 'No topics in this filter'}</strong>
                      <span>{isZh ? '切换筛选条件查看其他社区话题。' : 'Try another filter to browse more community topics.'}</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="topic-pagination">
                <span>
                  {filterLabel(communityFilter)} · {filteredPosts.length ? (safeTopicPage - 1) * topicsPerPage + 1 : 0}-
                  {Math.min(safeTopicPage * topicsPerPage, filteredPosts.length)} / {filteredPosts.length}
                </span>
                <div className="topic-page-numbers" aria-label={isZh ? '话题分页' : 'Topic pages'}>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => goToTopicPage(safeTopicPage - 1)}
                    disabled={safeTopicPage === 1}
                  >
                    {isZh ? '上一页' : 'Prev'}
                  </button>
                  {topicPages.map((pageNumber) => (
                    <button
                      className={safeTopicPage === pageNumber ? 'page-number active' : 'page-number'}
                      type="button"
                      key={pageNumber}
                      onClick={() => goToTopicPage(pageNumber)}
                    >
                      {pageNumber}
                    </button>
                  ))}
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => goToTopicPage(safeTopicPage + 1)}
                    disabled={safeTopicPage === totalTopicPages}
                  >
                    {isZh ? '下一页' : 'Next'}
                  </button>
                </div>
                <span>
                  {isZh ? `第 ${safeTopicPage} / ${totalTopicPages} 页` : `Page ${safeTopicPage} / ${totalTopicPages}`}
                </span>
              </div>
            </>
          ) : (
            <article className="topic-detail post-detail">
              <div className="topic-detail-head">
                <div>
                  <span className="topic-detail-label">
                    <button className="profile-link topic-author-link" type="button" onClick={() => openAuthorProfile(activeSelectedPost.author)}>
                      @{activeSelectedPost.author}
                    </button>{' '}
                    / {categoryLabel(activeSelectedPost.category, t)}
                  </span>
                  <h2>{activeSelectedPost.title}</h2>
                </div>
                <button className="chip back-to-list" type="button" onClick={backToTopicList}>
                  {isZh ? '返回列表' : 'Back to list'}
                </button>
              </div>
              <div className="post-body">
                <p>{activeSelectedPost.body ?? activeSelectedPost.excerpt}</p>
                <p>{activeSelectedPost.excerpt}</p>
              </div>
              <div className="topic-detail-metrics">
                <span>
                  <strong>{activeSelectedPost.likes}</strong>
                  {isZh ? '点赞' : 'likes'}
                </span>
                <span>
                  <strong>{activeSelectedPost.replies}</strong>
                  {isZh ? '回复' : 'replies'}
                </span>
                <span>
                  <strong>{activeSelectedPost.views}</strong>
                  {isZh ? '浏览' : 'views'}
                </span>
                <span>
                  <strong>{activeSelectedPost.votes}</strong>
                  {isZh ? '投票' : 'votes'}
                </span>
              </div>
              <div className="embedded-work">
                <img src={visualWorks[1].image} alt="" />
                <div>
                  <strong>{isZh ? '关联作品' : 'Embedded work'}</strong>
                  <span>{isZh ? '帖子可关联图片、视频、音频、提示词和任务编号。' : 'Attach image, video, audio, prompt, and task references.'}</span>
                </div>
              </div>
              <div className="post-action-bar">
                <button className="compact-action" type="button" onClick={() => void likePost(activeSelectedPost)} title={isZh ? '点赞' : 'Like'}>
                  <Heart size={17} />
                  <span>{isZh ? '点赞' : 'Like'}</span>
                </button>
                <button className="compact-action" type="button" onClick={() => void savePostToLibrary(activeSelectedPost)} title={isZh ? '收藏' : 'Save'}>
                  <Bookmark size={17} />
                  <span>{isZh ? '收藏' : 'Save'}</span>
                </button>
                <button className="compact-action" type="button" onClick={() => void convertPostToTask(activeSelectedPost)} title={isZh ? '转成任务' : 'Turn into task'}>
                  <BriefcaseBusiness size={17} />
                  <span>{isZh ? '任务' : 'Task'}</span>
                </button>
                <button className="compact-action" type="button" onClick={() => void savePostToLibrary(activeSelectedPost)} title={isZh ? '收入灵感库' : 'Add to library'}>
                  <Tags size={17} />
                  <span>{isZh ? '入库' : 'Library'}</span>
                </button>
                <button className="compact-action primary" type="button" onClick={submitReply} title={t.reply}>
                  <MessageCircle size={17} />
                  <span>{t.reply}</span>
                </button>
              </div>
              <div className="comment-list">
                <div className="comment-heading">
                  <strong>{isZh ? '回复' : 'Replies'}</strong>
                  <span>
                    {activeSelectedPost.replies + (localReplies[String(activeSelectedPost.id)]?.length ?? 0)} {isZh ? '条' : 'total'}
                  </span>
                </div>
                <Comment author="iriswood" text={isZh ? '建议补一个验收清单：脚本、成片、字幕、封面、版权授权分别确认。' : 'This workflow is clean. I would add a style-lock prompt for the visual loop.'} />
                <Comment author="veyn" text={isZh ? '如果要转任务，可以把修改轮次和最终文件格式写成硬性验收项。' : 'The second prompt version gives much better motion consistency.'} />
                {(localReplies[String(activeSelectedPost.id)] ?? []).map((reply: { author: string; text: string }, index: number) => (
                  <Comment author={reply.author} text={reply.text} key={`${activeSelectedPost.id}-${index}-${reply.text}`} />
                ))}
              </div>
              <div className="reply-box">
                <textarea
                  value={replyDraft}
                  onChange={(event) => setReplyDraft(event.target.value)}
                  placeholder={isZh ? '写回复，或粘贴交付链接、提示词、任务建议...' : 'Write a reply, delivery link, prompt, or task suggestion...'}
                />
                <button className="primary-button" type="button" onClick={submitReply}>
                  {t.reply}
                </button>
              </div>
            </article>
          )}
        </section>
        <aside className="community-sidebar">
          <section className="tag-panel">
            <div className="panel-title">
              <strong>{isZh ? '热门话题' : 'Hot right now'}</strong>
              <span>{isZh ? '社区正在讨论' : 'Most discussed'}</span>
            </div>
            <div className="hot-list">
              {hotPosts.map((post) => (
                <button
                  className="hot-item"
                  type="button"
                  key={post.id}
                  onClick={() => {
                    showTopicDetail(post)
                    simulateAction(isZh ? '已选择热门话题：' + post.title : 'Hot topic selected: ' + post.title)
                  }}
                >
                  <strong>{post.title}</strong>
                  <span>
                    {post.views} {isZh ? '浏览' : 'views'} / {post.replies} {isZh ? '回复' : 'replies'}
                  </span>
                </button>
              ))}
            </div>
          </section>
          <section className="tag-panel">
            <div className="panel-title">
              <strong>{isZh ? '标签' : 'Tags'}</strong>
              <span>{isZh ? '按方向浏览' : 'Browse by lane'}</span>
            </div>
            <div className="tag-list compact">
              {sidebarTags.map(([filter, label, count]) => (
                <button
                  className={communityFilter === filter ? 'tag-item active' : 'tag-item'}
                  type="button"
                  key={filter}
                  onClick={() => chooseFilter(filter)}
                >
                  <strong>{label}</strong>
                  <span>{count}</span>
                </button>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}

export function Comment({ author, text }: { author: string; text: string }) {
  return (
    <div className="comment">
      <div className="avatar">{author.slice(0, 1).toUpperCase()}</div>
      <div>
        <strong>{author}</strong>
        <p>{text}</p>
      </div>
    </div>
  )
}
