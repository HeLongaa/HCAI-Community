import { useEffect, useState } from 'react'
import type { CommunityPostDraft, CommunityView, InspirationItem, Locale, Page, Post, PublishDraft } from '../domain/types'
import { inspirationItems, posts } from '../data/mockData'
import { copy } from '../i18n/copy'
import { localeFirstPost } from '../domain/utils'
import { communityService } from '../services/communityService'
import { useAsyncResource } from './useAsyncResource'

type CommunityWorkflowOptions = {
  locale: Locale
  publishTask: (draft: PublishDraft) => Promise<void>
  pushLedger: (description: string, delta: string) => void
  pushToast: (message: string, tone?: 'info' | 'success' | 'warning' | 'error') => void
  setPage: (page: Page) => void
  accountHandle: string | null
}

function bumpLikeCount(value: string) {
  if (value.includes('K')) {
    const numeric = Number.parseFloat(value)
    return Number.isFinite(numeric) ? `${(numeric + 0.1).toFixed(1)}K` : value
  }
  const numeric = Number.parseInt(value, 10)
  return Number.isFinite(numeric) ? `${numeric + 1}` : value
}

export function useCommunityWorkflows({ locale, publishTask, pushLedger, pushToast, setPage, accountHandle }: CommunityWorkflowOptions) {
  const [postList, setPostList] = useState<Post[]>(posts)
  const [libraryItems, setLibraryItems] = useState<InspirationItem[]>(inspirationItems)
  const [selectedPost, setSelectedPost] = useState<Post>(() => localeFirstPost(posts, copy.en))
  const [communityFilter, setCommunityFilter] = useState('Hot')
  const [communityView, setCommunityView] = useState<CommunityView>('list')
  const [myPosts, setMyPosts] = useState<Post[]>([])
  const [postMutationBusy, setPostMutationBusy] = useState(false)

  const communityStatus = useAsyncResource<[Post[], InspirationItem[]]>({
    load: () => Promise.all([communityService.listPosts(), communityService.listLibrary()]),
    onSuccess: ([postsData, libraryData]) => {
      setPostList(postsData)
      setLibraryItems(libraryData)
      setSelectedPost((current) => postsData.find((post) => post.id === current.id) ?? postsData[0] ?? current)
    },
    getErrorMessage: () => (locale === 'zh' ? '社区 API 暂不可用；未显示本地替代数据。' : 'The community API is unavailable; no local substitute is shown.'),
    deps: [locale],
    logLabel: 'community-service',
  })

  const refreshMyPosts = async () => {
    if (!accountHandle) {
      setMyPosts([])
      return
    }
    setMyPosts(await communityService.listMyPosts())
  }

  useEffect(() => {
    if (!accountHandle) return undefined
    let cancelled = false
    void communityService.listMyPosts()
      .then((items) => {
        if (!cancelled) setMyPosts(items)
      })
      .catch((error) => console.info('[community-my-posts]', error))
    return () => {
      cancelled = true
    }
  }, [accountHandle])

  const replacePost = (items: Post[], post: Post) => items.map((item) => item.id === post.id ? post : item)

  const createPost = async (draft: CommunityPostDraft, status: 'draft' | 'published') => {
    setPostMutationBusy(true)
    try {
      const post = await communityService.createPost(draft, status)
      setMyPosts((current) => [post, ...current])
      if (status === 'published') {
        setPostList((current) => [post, ...current])
        setSelectedPost(post)
      }
      pushToast(locale === 'zh' ? (status === 'draft' ? '草稿已保存。' : '帖子已发布。') : (status === 'draft' ? 'Draft saved.' : 'Post published.'))
      return post
    } finally {
      setPostMutationBusy(false)
    }
  }

  const updatePost = async (post: Post, draft: CommunityPostDraft) => {
    setPostMutationBusy(true)
    try {
      const updated = await communityService.updatePost(post, draft)
      setMyPosts((current) => replacePost(current, updated))
      setPostList((current) => replacePost(current, updated))
      if (selectedPost.id === updated.id) setSelectedPost(updated)
      pushToast(locale === 'zh' ? '帖子已更新。' : 'Post updated.')
      return updated
    } finally {
      setPostMutationBusy(false)
    }
  }

  const publishPost = async (post: Post) => {
    setPostMutationBusy(true)
    try {
      const published = await communityService.publishPost(post)
      setMyPosts((current) => replacePost(current, published))
      setPostList((current) => [published, ...current.filter((item) => item.id !== published.id)])
      setSelectedPost(published)
      pushToast(locale === 'zh' ? '草稿已发布。' : 'Draft published.')
      return published
    } finally {
      setPostMutationBusy(false)
    }
  }

  const deletePost = async (post: Post) => {
    setPostMutationBusy(true)
    try {
      const deleted = await communityService.deletePost(post)
      setMyPosts((current) => replacePost(current, deleted))
      setPostList((current) => current.filter((item) => item.id !== deleted.id))
      setSelectedPost((current) => current.id === deleted.id ? postList.find((item) => item.id !== deleted.id) ?? current : current)
      pushToast(locale === 'zh' ? '帖子已删除。' : 'Post deleted.')
      return deleted
    } finally {
      setPostMutationBusy(false)
    }
  }

  const likePost = async (post: Post) => {
    const isZh = locale === 'zh'
    try {
      await communityService.likePost(post.id)
      const updated = {
        ...post,
        likes: bumpLikeCount(post.likes),
        votes: post.votes + 1,
      }
      setPostList((current) => current.map((item) => (item.id === post.id ? updated : item)))
      setSelectedPost(updated)
      pushLedger(isZh ? `点赞社区帖子：${post.title}` : `Liked community post: ${post.title}`, '+5')
      pushToast(isZh ? `已点赞帖子：${post.title}` : `Post liked: ${post.title}`)
    } catch (error) {
      console.info('[community-service]', error)
      pushToast(isZh ? '点赞失败，未更新帖子状态。' : 'Like failed. The post was not updated.', 'error')
    }
  }

  const replyToPost = async (post: Post, replyText?: string) => {
    const isZh = locale === 'zh'
    try {
      await communityService.replyToPost(post.id, replyText ?? '')
      const updated = {
        ...post,
        replies: post.replies + 1,
        views: post.views === '1' ? '2' : post.views,
      }
      setPostList((current) => current.map((item) => (item.id === post.id ? updated : item)))
      setSelectedPost(updated)
      pushLedger(isZh ? `回复社区帖子：${post.title}` : `Replied to community post: ${post.title}`, '+15')
      pushToast(isZh ? `已发表回复：${replyText?.slice(0, 28)}` : `Reply posted: ${replyText?.slice(0, 28)}`, 'success')
    } catch (error) {
      console.info('[community-service]', error)
      pushToast(isZh ? '回复失败，内容未发布。' : 'Reply failed. Nothing was posted.', 'error')
      throw error
    }
  }

  const convertPostToTask = async (post: Post) => {
    const isZh = locale === 'zh'
    await communityService.convertPostToTask(post.id, {
      rules: isZh ? '请提交方案、参考链接、可复用提示词和验收说明。' : 'Submit a plan, reference links, reusable prompts, and acceptance notes.',
    })
    await publishTask({
      title: isZh ? `来自社区：${post.title}` : `From community: ${post.title}`,
      category: 'Prompt',
      reward: isZh ? '¥800 / 800 积分' : '$120 / 800 pts',
      deadline: isZh ? '3 天' : '3 days',
      visibility: isZh ? '社区可见' : 'Community visible',
      details: post.excerpt,
      rules: isZh
        ? '请提交方案、参考链接、可复用提示词和验收说明。'
        : 'Submit a plan, reference links, reusable prompts, and acceptance notes.',
    })
  }

  const savePostToLibrary = async (post: Post) => {
    const isZh = locale === 'zh'
    try {
      const item = await communityService.savePostToLibrary(post)
      const nextItem: InspirationItem = {
        id: item.id,
        title: item.title,
        type: item.type,
        source: item.source,
        saves: item.saves,
        text: item.text,
      }
      setLibraryItems((current) => [nextItem, ...current])
      pushLedger(isZh ? `收入灵感库：${post.title}` : `Saved to inspiration library: ${post.title}`, '+10')
      pushToast(isZh ? `已收入灵感库：${post.title}` : `Saved to inspiration library: ${post.title}`)
      setPage('inspiration')
    } catch (error) {
      console.info('[community-service]', error)
      pushToast(isZh ? '保存灵感失败，已保留本地状态。' : 'Save failed. Local state kept.')
    }
  }

  return {
    postList,
    selectedPost,
    setSelectedPost,
    communityFilter,
    setCommunityFilter,
    communityView,
    setCommunityView,
    libraryItems,
    communityStatus,
    likePost,
    replyToPost,
    convertPostToTask,
    savePostToLibrary,
    myPosts,
    postMutationBusy,
    refreshMyPosts,
    createPost,
    updatePost,
    publishPost,
    deletePost,
  }
}
