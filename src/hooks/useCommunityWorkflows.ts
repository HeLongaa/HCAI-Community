import { useState } from 'react'
import type { CommunityView, InspirationItem, Locale, Page, Post, PublishDraft } from '../domain/types'
import { inspirationItems, posts } from '../data/mockData'
import { copy } from '../i18n/copy'
import { localeFirstPost } from '../domain/utils'
import { communityService } from '../services/communityService'
import { useAsyncResource } from './useAsyncResource'

type CommunityWorkflowOptions = {
  locale: Locale
  publishTask: (draft: PublishDraft) => Promise<void>
  pushLedger: (description: string, delta: string) => void
  pushToast: (message: string) => void
  setPage: (page: Page) => void
}

function bumpLikeCount(value: string) {
  if (value.includes('K')) {
    const numeric = Number.parseFloat(value)
    return Number.isFinite(numeric) ? `${(numeric + 0.1).toFixed(1)}K` : value
  }
  const numeric = Number.parseInt(value, 10)
  return Number.isFinite(numeric) ? `${numeric + 1}` : value
}

export function useCommunityWorkflows({ locale, publishTask, pushLedger, pushToast, setPage }: CommunityWorkflowOptions) {
  const [postList, setPostList] = useState<Post[]>(posts)
  const [libraryItems, setLibraryItems] = useState<InspirationItem[]>(inspirationItems)
  const [selectedPost, setSelectedPost] = useState<Post>(() => localeFirstPost(posts, copy.en))
  const [communityFilter, setCommunityFilter] = useState('Hot')
  const [communityView, setCommunityView] = useState<CommunityView>('list')

  const communityStatus = useAsyncResource<[Post[], InspirationItem[]]>({
    load: () => Promise.all([communityService.listPosts(), communityService.listLibrary()]),
    onSuccess: ([postsData, libraryData]) => {
      setPostList(postsData)
      setLibraryItems(libraryData)
      setSelectedPost((current) => postsData.find((post) => post.id === current.id) ?? postsData[0] ?? current)
    },
    getErrorMessage: () => (locale === 'zh' ? '无法同步社区内容，当前显示本地演示数据。' : 'Could not sync community content. Showing local demo data.'),
    deps: [locale],
    logLabel: 'community-service',
  })

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
      pushToast(isZh ? '点赞失败，已保留本地状态。' : 'Like failed. Local state kept.')
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
      pushToast(
        replyText
          ? isZh
            ? `已发表回复：${replyText.slice(0, 28)}`
            : `Reply posted: ${replyText.slice(0, 28)}`
          : isZh
            ? `已模拟回复：${post.title}`
            : `Reply simulated: ${post.title}`,
      )
    } catch (error) {
      console.info('[community-service]', error)
      pushToast(isZh ? '回复失败，已保留本地状态。' : 'Reply failed. Local state kept.')
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
  }
}
