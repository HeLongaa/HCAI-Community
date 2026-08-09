import { useState } from 'react'
import {
  BriefcaseBusiness,
  ChevronLeft,
  Heart,
  Flag,
  LoaderCircle,
  MessageCircle,
  Pencil,
  Plus,
  Send,
  Save,
  Search,
  Tags,
  Trash2,
  X,
} from 'lucide-react'
import type { AsyncResourceState, CommunityPostDraft, CommunityView, Post, SimulateAction } from '../../domain/types'
import { categoryLabel, isZhCopy, localizedPosts, textFor } from '../../domain/utils'
import { communityService } from '../../services/communityService'
import { trustService } from '../../services/trustService'
import type { ModerationReportCategory } from '../../services/contracts'
import { OperationConfirmation } from '../../components/ui/OperationConfirmation'

export function CommunityPage({
  t,
  posts,
  convertPostToTask,
  savePostToLibrary,
  likePost,
  replyToPost,
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
  selectedPost: Post | null
  setSelectedPost: (post: Post | null) => void
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
  const [replyDraft, setReplyDraft] = useState('')
  const [localReplies, setLocalReplies] = useState<Record<string, Array<{ author: string; text: string }>>>({})
  const [topicPage, setTopicPage] = useState(1)
  const [communitySearch, setCommunitySearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const emptyPostDraft: CommunityPostDraft = { title: '', body: '', category: 'Questions', tag: '', excerpt: '' }
  const [editorOpen, setEditorOpen] = useState(false)
  const [myPostsOpen, setMyPostsOpen] = useState(false)
  const [editingPost, setEditingPost] = useState<Post | null>(null)
  const [postDraft, setPostDraft] = useState<CommunityPostDraft>(emptyPostDraft)
  const [postEditorError, setPostEditorError] = useState<string | null>(null)
  const [postMutationFeedback, setPostMutationFeedback] = useState<string | null>(null)
  const [pendingDeletePost, setPendingDeletePost] = useState<Post | null>(null)
  const [deletePostError, setDeletePostError] = useState<string | null>(null)
  const [reportTarget, setReportTarget] = useState<{ targetType: 'post' | 'comment'; targetId: string; label: string } | null>(null)
  const [reportCategory, setReportCategory] = useState<ModerationReportCategory>('spam')
  const [reportStatement, setReportStatement] = useState('')
  const [reportBusy, setReportBusy] = useState(false)
  const [reportResult, setReportResult] = useState<string | null>(null)
  const [reportError, setReportError] = useState<string | null>(null)
  const selectedLocalized = selectedPost ? localizedPosts([selectedPost], t)[0] ?? selectedPost : null
  const activeSelectedPost = selectedPost && selectedLocalized
    ? selectedPost.id === selectedLocalized.id
      ? selectedLocalized
      : scopedPosts.find((post) => post.id === selectedPost.id) ?? scopedPosts[0] ?? selectedPost
    : scopedPosts[0] ?? null
  const normalizedCommunitySearch = communitySearch.trim().toLocaleLowerCase()
  const filteredPosts = scopedPosts.filter((post) => {
    if (categoryFilter !== 'All' && post.category !== categoryFilter) return false
    if (normalizedCommunitySearch && ![post.title, post.excerpt, post.author, post.category, post.tag]
      .some((value) => value.toLocaleLowerCase().includes(normalizedCommunitySearch))) return false
    if (communityFilter === 'Unanswered') return post.replies === 0 || !post.solved
    if (communityFilter === 'Featured') return post.tag === 'Featured' || post.solved
    return true
  }).sort((a, b) => {
    if (communityFilter === 'Hot') return b.votes - a.votes
    if (communityFilter === 'Active') return b.replies - a.replies
    return Date.parse(b.publishedAt ?? b.updatedAt ?? b.createdAt ?? '') - Date.parse(a.publishedAt ?? a.updatedAt ?? a.createdAt ?? '')
  })
  const topicsPerPage = 10
  const totalTopicPages = Math.max(1, Math.ceil(filteredPosts.length / topicsPerPage))
  const safeTopicPage = Math.min(topicPage, totalTopicPages)
  const visibleTopics = filteredPosts.slice((safeTopicPage - 1) * topicsPerPage, safeTopicPage * topicsPerPage)
  const topicPages = Array.from({ length: totalTopicPages }, (_, index) => index + 1)
  const filterOptions = [
    ['Latest', isZh ? '最新' : 'Latest'],
    ['Hot', isZh ? '热门' : 'Hot'],
    ['Active', isZh ? '活跃' : 'Active'],
    ['Unanswered', isZh ? '未回复' : 'Unanswered'],
    ['Featured', isZh ? '精选' : 'Featured'],
  ]
  const categoryOptions = ['All', ...Array.from(new Set(scopedPosts.map((post) => post.category)))]
  const filterLabel = (filter: string) => filterOptions.find(([key]) => key === filter)?.[1] ?? filter

  const chooseFilter = (filter: string) => {
    setCommunityFilter(filter)
    setTopicPage(1)
    setSelectedPost(null)
    setCommunityView('list')
  }

  const goToTopicPage = (page: number) => {
    const target = Math.min(totalTopicPages, Math.max(1, page))
    setTopicPage(target)
    const firstTopic = filteredPosts.slice((target - 1) * topicsPerPage, target * topicsPerPage)[0]
    if (firstTopic) {
      setSelectedPost(firstTopic)
    }
    setCommunityView('list')
  }

  const showTopicDetail = (post: Post) => {
    setSelectedPost(post)
    setCommunityView('detail')
    void communityService.getPost(post.id).then(setSelectedPost).catch((error) => console.info('[community-post-detail]', error))
    requestAnimationFrame(() => document.querySelector('.forum-main')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const openAuthorProfile = (author: string) => {
    simulateAction(isZh ? `暂无 @${author} 的公开主页资料` : `No public profile is available for @${author}`)
  }

  const backToTopicList = () => {
    setCommunityView('list')
    requestAnimationFrame(() => document.querySelector('.forum-main')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const submitReply = () => {
    if (!activeSelectedPost) return
    const text = replyDraft.trim()
    if (!text) {
      simulateAction(isZh ? '请先输入回复内容' : 'Please enter a reply first')
      return
    }
    void replyToPost(activeSelectedPost, text)
      .then(() => {
        const postKey = String(activeSelectedPost.id)
        setLocalReplies((current) => ({
          ...current,
          [postKey]: [...(current[postKey] ?? []), { author: 'you', text }],
        }))
        setReplyDraft('')
        return communityService.getPost(activeSelectedPost.id)
      })
      .then(setSelectedPost)
      .catch((error) => console.info('[community-comment-refresh]', error))
  }

  const openReport = (targetType: 'post' | 'comment', targetId: string, label: string) => {
    if (!accountHandle) {
      simulateAction(isZh ? '请先登录后再提交举报。' : 'Sign in before submitting a report.')
      return
    }
    setReportTarget({ targetType, targetId, label })
    setReportStatement('')
    setReportResult(null)
    setReportError(null)
  }

  const submitReport = async () => {
    if (!reportTarget || reportStatement.trim().length < 10) {
      setReportError(isZh ? '请提供至少 10 个字符的举报说明。' : 'Provide at least 10 characters of report context.')
      return
    }
    setReportBusy(true)
    setReportError(null)
    try {
      const result = await trustService.createReport({
        targetType: reportTarget.targetType,
        targetId: reportTarget.targetId,
        category: reportCategory,
        subject: `${reportTarget.targetType === 'post' ? 'Community post' : 'Community comment'} report`,
        statement: reportStatement.trim(),
        locale: isZh ? 'zh' : 'en',
      })
      setReportResult(result.item.id)
      simulateAction(isZh ? `举报已提交：${result.item.id}` : `Report submitted: ${result.item.id}`)
    } catch (error) {
      setReportError(error instanceof Error ? error.message : (isZh ? '举报提交失败。' : 'Report submission failed.'))
    } finally {
      setReportBusy(false)
    }
  }

  const resetPostEditor = () => {
    setEditingPost(null)
    setPostDraft(emptyPostDraft)
    setPostEditorError(null)
    setEditorOpen(false)
  }

  const openPostEditor = (post?: Post) => {
    setMyPostsOpen(false)
    setEditingPost(post ?? null)
    setPostDraft(post ? {
      title: post.title,
      body: post.body ?? '',
      category: post.category,
      tag: post.tag,
      excerpt: post.excerpt,
    } : emptyPostDraft)
    setPostEditorError(null)
    setPostMutationFeedback(null)
    setEditorOpen(true)
  }

  const submitPost = async (target: 'draft' | 'published') => {
    if (!postDraft.title.trim() || !postDraft.body.trim() || !postDraft.category.trim()) {
      setPostEditorError(isZh ? '标题、正文和分类不能为空。' : 'Title, body, and category are required.')
      return
    }
    setPostEditorError(null)
    setPostMutationFeedback(null)
    try {
      const successMessage = editingPost
        ? (isZh ? '帖子修改已保存。' : 'Post changes saved.')
        : target === 'draft'
          ? (isZh ? '草稿已保存。' : 'Draft saved.')
          : (isZh ? '帖子已发布。' : 'Post published.')
      if (!editingPost) {
        await createPost(postDraft, target)
      } else {
        const updated = await updatePost(editingPost, postDraft)
        if (target === 'published' && updated.status === 'draft') await publishPost(updated)
      }
      resetPostEditor()
      await refreshMyPosts()
      setMyPostsOpen(true)
      setPostMutationFeedback(successMessage)
    } catch (error) {
      console.info('[community-post-editor]', error)
      setPostEditorError(isZh ? '保存失败，请刷新后重试。' : 'Save failed. Refresh and try again.')
    }
  }

  const confirmPostDeletion = async () => {
    if (!pendingDeletePost) return
    setDeletePostError(null)
    setPostMutationFeedback(null)
    try {
      await deletePost(pendingDeletePost)
      if (editingPost?.id === pendingDeletePost.id) resetPostEditor()
      setPendingDeletePost(null)
      setPostMutationFeedback(isZh ? '帖子已删除。' : 'Post deleted.')
    } catch (error) {
      console.info('[community-post-delete]', error)
      setDeletePostError(isZh ? '删除失败，帖子未发生变化。请重试。' : 'Delete failed and the post was not changed. Try again.')
    }
  }

  const publishDraftPost = async (post: Post) => {
    setPostEditorError(null)
    setPostMutationFeedback(null)
    try {
      await publishPost(post)
      setPostMutationFeedback(isZh ? '草稿已发布。' : 'Draft published.')
    } catch (error) {
      console.info('[community-post-publish]', error)
      setPostEditorError(isZh ? '发布失败，请刷新后重试。' : 'Publish failed. Refresh and try again.')
    }
  }

  return (
    <div className="community-workbench">
      <header className="community-workbench-header">
        <div className="community-header-copy">
          <span>{textFor(t, 'Community', '创作者社区')}</span>
          <h1>{textFor(t, 'Share useful work. Build better ideas together.', '分享有用的经验，一起把想法做得更好。')}</h1>
          <p>{textFor(t, 'Ask focused questions, show what you made, and turn promising discussions into real work.', '提出具体问题、展示创作成果，并把值得继续的讨论转成真实协作。')}</p>
        </div>
        <div className="community-header-actions">
          <button
            aria-pressed={myPostsOpen}
            className={myPostsOpen ? 'active' : ''}
            type="button"
            disabled={!accountHandle || postMutationBusy}
            onClick={() => {
              if (editorOpen) resetPostEditor()
              setMyPostsOpen((open) => !open)
            }}
          >
            <MessageCircle size={17} />
            {isZh ? '我的帖子' : 'My posts'}
          </button>
          <button
            className={editorOpen ? 'active' : 'primary'}
            type="button"
            disabled={!accountHandle || postMutationBusy}
            onClick={() => editorOpen ? resetPostEditor() : openPostEditor()}
          >
            {editorOpen ? <X size={17} /> : <Plus size={17} />}
            {editorOpen ? (isZh ? '关闭编辑' : 'Close editor') : (isZh ? '新建帖子' : 'New post')}
          </button>
        </div>
      </header>
      <section className="community-author-workspace" data-testid="community-author-workspace">
        {postEditorError && <div className="inline-error" role="alert">{postEditorError}</div>}
        {postMutationFeedback && <div className="inline-success" role="status">{postMutationFeedback}</div>}
        {editorOpen && (
          <div className="community-post-editor">
            <div className="community-editor-grid">
              <label>
                <span>{isZh ? '标题' : 'Title'}</span>
                <input
                  maxLength={160}
                  placeholder={isZh ? '用一句话说明讨论主题' : 'Give the discussion a clear title'}
                  value={postDraft.title}
                  onChange={(event) => setPostDraft((current) => ({ ...current, title: event.target.value }))}
                />
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
                <span>{isZh ? '标签（选填）' : 'Tag (optional)'}</span>
                <input
                  maxLength={80}
                  placeholder={isZh ? '例如：工作流' : 'For example: workflow'}
                  value={postDraft.tag}
                  onChange={(event) => setPostDraft((current) => ({ ...current, tag: event.target.value }))}
                />
              </label>
              <label className="community-editor-wide">
                <span>{isZh ? '摘要' : 'Excerpt'}</span>
                <input
                  maxLength={500}
                  placeholder={isZh ? '概括问题、作品或协作目标' : 'Summarize the question, work, or collaboration goal'}
                  value={postDraft.excerpt}
                  onChange={(event) => setPostDraft((current) => ({ ...current, excerpt: event.target.value }))}
                />
              </label>
              <label className="community-editor-wide">
                <span>{isZh ? '正文' : 'Body'}</span>
                <textarea
                  maxLength={20000}
                  placeholder={isZh ? '补充背景、示例，以及你希望获得的回复' : 'Add context, examples, and the kind of response you need'}
                  value={postDraft.body}
                  onChange={(event) => setPostDraft((current) => ({ ...current, body: event.target.value }))}
                />
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
        {myPostsOpen && accountHandle && (
          <div className="community-owned-panel">
            <div className="community-owned-heading">
              <strong>{isZh ? '我的帖子' : 'My posts'}</strong>
              <span>{`${myPosts.filter((post) => post.status !== 'deleted').length} ${isZh ? '条内容' : 'items'}  /  @${accountHandle}`}</span>
            </div>
            {myPosts.length > 0 ? (
              <div className="community-owned-list">
                {myPosts.map((post) => (
                  <article className={`community-owned-row${pendingDeletePost?.id === post.id ? ' confirming' : ''}`} key={post.id}>
                    <div>
                      <strong>{post.title}</strong>
                      <span>{post.status === 'draft' ? (isZh ? '草稿' : 'Draft') : post.status === 'deleted' ? (isZh ? '已删除' : 'Deleted') : (isZh ? '已发布' : 'Published')}</span>
                    </div>
                    <div className="community-owned-actions">
                      {post.status !== 'deleted' && <button className="community-row-action" type="button" disabled={postMutationBusy} onClick={() => openPostEditor(post)} title={isZh ? '编辑' : 'Edit'}><Pencil size={15} />{isZh ? '编辑' : 'Edit'}</button>}
                      {post.status === 'draft' && <button className="community-row-action" type="button" disabled={postMutationBusy} onClick={() => void publishDraftPost(post)} title={isZh ? '发布' : 'Publish'}><Send size={15} />{isZh ? '发布' : 'Publish'}</button>}
                      {post.status !== 'deleted' && <button className="community-row-action danger" type="button" disabled={postMutationBusy} onClick={() => { setPendingDeletePost(post); setDeletePostError(null); setPostMutationFeedback(null) }} title={isZh ? '删除' : 'Delete'}><Trash2 size={15} />{isZh ? '删除' : 'Delete'}</button>}
                    </div>
                    {pendingDeletePost?.id === post.id && <div className="community-delete-confirmation">
                      <OperationConfirmation
                        ariaLabel={isZh ? '确认删除社区帖子' : 'Confirm community post deletion'}
                        title={isZh ? `删除“${post.title}”？` : `Delete “${post.title}”?`}
                        description={isZh ? '帖子将从社区和你的公开内容中移除，已有审核记录仍会保留。' : 'The post will be removed from the community and your public content. Existing moderation records remain available.'}
                        confirmLabel={isZh ? '删除帖子' : 'Delete post'}
                        cancelLabel={isZh ? '返回' : 'Back'}
                        onConfirm={() => void confirmPostDeletion()}
                        onCancel={() => { setPendingDeletePost(null); setDeletePostError(null) }}
                        busy={postMutationBusy}
                        compact
                      >
                        {deletePostError && <span className="community-delete-error" role="alert">{deletePostError}</span>}
                      </OperationConfirmation>
                    </div>}
                  </article>
                ))}
              </div>
            ) : <div className="community-owned-empty">{isZh ? '你还没有发布或保存帖子。' : 'You have not published or saved a post yet.'}</div>}
          </div>
        )}
      </section>
      <div className="community-summary" aria-label={isZh ? '社区概览' : 'Community summary'}>
        <span><strong>{scopedPosts.length}</strong>{isZh ? '全部帖子' : 'Posts'}</span>
        <span><strong>{scopedPosts.filter((post) => post.replies === 0 || !post.solved).length}</strong>{isZh ? '待回复' : 'Unanswered'}</span>
        <span><strong>{Math.max(categoryOptions.length - 1, 0)}</strong>{isZh ? '分类' : 'Categories'}</span>
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
          {communityView === 'list' || !activeSelectedPost ? (
            <>
              <section className="community-filters" aria-label={isZh ? '社区筛选' : 'Community filters'}>
                <label className="community-search">
                  <Search size={17} />
                  <input
                    type="search"
                    value={communitySearch}
                    placeholder={isZh ? '搜索标题、摘要或作者' : 'Search title, summary, or author'}
                    onChange={(event) => { setCommunitySearch(event.target.value); setTopicPage(1) }}
                  />
                </label>
                <label className="community-sort-select">
                  <span>{isZh ? '排序' : 'Sort'}</span>
                  <select value={communityFilter} onChange={(event) => chooseFilter(event.target.value)}>
                    {filterOptions.map(([filter, label]) => <option value={filter} key={filter}>{label}</option>)}
                  </select>
                </label>
                <div className="community-filter-chips" aria-label={isZh ? '社区排序快捷筛选' : 'Community sort shortcuts'}>
                  {filterOptions.map(([filter, label]) => (
                    <button
                      className={communityFilter === filter ? 'active' : ''}
                      type="button"
                      key={filter}
                      onClick={() => chooseFilter(filter)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <label>
                  <span>{isZh ? '分类' : 'Category'}</span>
                  <select value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value); setTopicPage(1); setSelectedPost(null) }}>
                    {categoryOptions.map((category) => <option value={category} key={category}>{category === 'All' ? (isZh ? '全部分类' : 'All categories') : categoryLabel(category, t)}</option>)}
                  </select>
                </label>
              </section>
              <div className="topic-table">
                <div className="topic-head">
                  <span>{isZh ? '话题' : 'Topic'}</span>
                  <span>{isZh ? '回复' : 'Replies'}</span>
                  <span>{isZh ? '浏览' : 'Views'}</span>
                </div>
                <div className="topic-table-body">
                  {visibleTopics.map((post) => (
                    <article className={activeSelectedPost?.id === post.id ? 'topic-row active' : 'topic-row'} key={post.id} data-testid={`community-topic-${post.id}`}>
                      <div className="topic-main">
                        <div className="topic-row-kicker">
                          <span>{categoryLabel(post.category, t)}</span>
                          <span>{post.solved ? (isZh ? '已解决' : 'Solved') : (isZh ? '讨论中' : 'Open')}</span>
                        </div>
                        <button
                          className="topic-title-button"
                          type="button"
                          onClick={() => showTopicDetail(post)}
                        >
                          <span className="topic-title-text">{post.title}</span>
                        </button>
                        <p>{post.excerpt}</p>
                        <span className="topic-meta-line">
                          <button className="profile-link topic-author-link" type="button" onClick={() => openAuthorProfile(post.author)}>
                            @{post.author}
                          </button>
                          {post.tag && <span>{post.tag}</span>}
                        </span>
                      </div>
                      <span className="topic-stat">
                        <strong>{post.replies}</strong>
                        {isZh ? '回复' : 'replies'}
                      </span>
                      <span className="topic-stat">
                        <strong>{post.views}</strong>
                        {isZh ? '浏览' : 'views'}
                      </span>
                    </article>
                  ))}
                  {filteredPosts.length === 0 && (
                    <div className="topic-empty">
                      <MessageCircle size={22} />
                      <strong>{scopedPosts.length === 0 ? (isZh ? '社区还没有帖子' : 'No community posts yet') : (isZh ? '没有符合条件的帖子' : 'No posts match these filters')}</strong>
                      <span>{scopedPosts.length === 0 ? (isZh ? '发布第一个具体问题、作品或经验。' : 'Publish the first focused question, work, or lesson.') : (isZh ? '调整搜索、排序或分类后再试。' : 'Adjust the search, sort, or category and try again.')}</span>
                      {(communitySearch || categoryFilter !== 'All' || communityFilter !== 'Latest') && (
                        <button type="button" onClick={() => { setCommunitySearch(''); setCategoryFilter('All'); chooseFilter('Latest') }}>{isZh ? '清除筛选' : 'Clear filters'}</button>
                      )}
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
                <button className="back-to-list" type="button" onClick={backToTopicList}>
                  <ChevronLeft size={16} />
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
              <div className="post-action-bar">
                <button className="compact-action" type="button" onClick={() => void likePost(activeSelectedPost)} title={isZh ? '点赞' : 'Like'}>
                  <Heart size={17} />
                  <span>{isZh ? '点赞' : 'Like'}</span>
                </button>
                <button className="compact-action" type="button" onClick={() => void convertPostToTask(activeSelectedPost)} title={isZh ? '转成任务' : 'Turn into task'}>
                  <BriefcaseBusiness size={17} />
                  <span>{isZh ? '任务' : 'Task'}</span>
                </button>
                <button className="compact-action" type="button" onClick={() => void savePostToLibrary(activeSelectedPost)} title={isZh ? '投稿到灵感库' : 'Submit to inspiration'}>
                  <Tags size={17} />
                  <span>{isZh ? '投稿灵感' : 'Submit'}</span>
                </button>
                <button className="compact-action" data-testid={`community-report-post-${activeSelectedPost.id}`} type="button" onClick={() => openReport('post', String(activeSelectedPost.id), activeSelectedPost.title)} title={isZh ? '举报帖子' : 'Report post'}>
                  <Flag size={17} />
                  <span>{isZh ? '举报' : 'Report'}</span>
                </button>
                <button className="compact-action primary" type="button" onClick={submitReply} title={t.reply}>
                  <MessageCircle size={17} />
                  <span>{t.reply}</span>
                </button>
              </div>
              {reportTarget && (
                <section className="community-report-panel" data-testid="community-report-panel">
                  <div className="community-report-head">
                    <div><strong>{isZh ? '提交内容举报' : 'Report community content'}</strong><span>{reportTarget.label}</span></div>
                    <button className="icon-button" type="button" onClick={() => setReportTarget(null)} title={isZh ? '关闭' : 'Close'}><X size={15} /></button>
                  </div>
                  <div className="community-report-fields">
                    <label><span>{isZh ? '类别' : 'Category'}</span><select aria-label="Community report category" value={reportCategory} onChange={(event) => setReportCategory(event.target.value as ModerationReportCategory)}>{(['harassment', 'hate', 'sexual', 'violence', 'self_harm', 'child_safety', 'impersonation', 'spam', 'fraud', 'privacy', 'copyright', 'other'] as ModerationReportCategory[]).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                    <label className="wide"><span>{isZh ? '说明' : 'Context'}</span><textarea aria-label="Community report statement" value={reportStatement} onChange={(event) => setReportStatement(event.target.value)} maxLength={4000} /></label>
                  </div>
                  {reportError && <div className="inline-error" role="alert">{reportError}</div>}
                  {reportResult && <div className="inline-success" data-testid="community-report-case-id">{isZh ? '案件' : 'Case'}: {reportResult}</div>}
                  <button className="primary-button" type="button" onClick={() => void submitReport()} disabled={reportBusy || Boolean(reportResult)}><Flag size={16} />{reportBusy ? (isZh ? '提交中' : 'Submitting') : (isZh ? '提交举报' : 'Submit report')}</button>
                </section>
              )}
              <div className="comment-list">
                <div className="comment-heading">
                  <strong>{isZh ? '回复' : 'Replies'}</strong>
                  <span>
                    {activeSelectedPost.replies + (localReplies[String(activeSelectedPost.id)]?.length ?? 0)} {isZh ? '条' : 'total'}
                  </span>
                </div>
                {(activeSelectedPost.comments ?? []).map((comment) => (
                  <div className="comment-with-actions" key={comment.id} data-testid={`community-comment-${comment.id}`}>
                    <Comment author={comment.author} text={comment.body} />
                    <button className="icon-button" data-testid={`community-report-comment-${comment.id}`} type="button" onClick={() => openReport('comment', comment.id, `${isZh ? '回复' : 'Reply'} @${comment.author}`)} title={isZh ? '举报回复' : 'Report reply'}><Flag size={15} /></button>
                  </div>
                ))}
                {(localReplies[String(activeSelectedPost.id)] ?? []).map((reply: { author: string; text: string }, index: number) => (
                  <Comment author={reply.author} text={reply.text} key={`${activeSelectedPost.id}-${index}-${reply.text}`} />
                ))}
                {(activeSelectedPost.comments?.length ?? 0) === 0 && (localReplies[String(activeSelectedPost.id)]?.length ?? 0) === 0 && <div className="topic-empty"><span>{isZh ? '暂无回复。' : 'No replies yet.'}</span></div>}
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
