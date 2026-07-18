import { api, withQuery } from './apiClient'
import type { CommunityPostDraft, InspirationItem, Post, PublishDraft } from '../domain/types'
import type {
  ApiLibraryItem,
  ApiPost,
  ConvertToTaskRequest,
  CreateCommentRequest,
  CreatePostRequest,
  CreateLibraryItemRequest,
  LibraryListQuery,
  PostListQuery,
  UpdatePostRequest,
} from './contracts'

const toPost = (post: ApiPost): Post => ({
  id: post.id,
  title: post.title,
  category: post.category,
  author: post.author.handle,
  replies: post.replies,
  likes: String(post.likes),
  views: String(post.views),
  votes: post.votes,
  tag: post.tag,
  solved: post.solved,
  excerpt: post.excerpt,
  body: post.body ?? undefined,
  status: post.status,
  version: post.version,
  createdAt: post.createdAt,
  updatedAt: post.updatedAt,
  publishedAt: post.publishedAt,
  deletedAt: post.deletedAt,
})

const toLibraryItem = (item: ApiLibraryItem): InspirationItem => ({
  id: item.id,
  title: item.title,
  type: item.type,
  source: item.source,
  saves: item.saves,
  text: item.text,
})

export const communityService = {
  async listPosts(query?: PostListQuery) {
    const items = await api.get<ApiPost[]>(withQuery('/posts', query))
    return items.map(toPost)
  },
  async listMyPosts(status: 'all' | 'draft' | 'published' | 'deleted' = 'all') {
    const items = await api.get<ApiPost[]>(withQuery('/posts/mine', { status }))
    return items.map(toPost)
  },
  async createPost(draft: CommunityPostDraft, status: 'draft' | 'published') {
    const request: CreatePostRequest = { ...draft, status }
    return toPost(await api.post<ApiPost>('/posts', request))
  },
  async updatePost(post: Post, draft: CommunityPostDraft) {
    const request: UpdatePostRequest = { ...draft, expectedVersion: post.version ?? 1 }
    return toPost(await api.patch<ApiPost>(`/posts/${post.id}`, request))
  },
  async publishPost(post: Post) {
    return toPost(await api.post<ApiPost>(`/posts/${post.id}/publish`, { expectedVersion: post.version ?? 1 }))
  },
  async deletePost(post: Post) {
    return toPost(await api.del<ApiPost>(`/posts/${post.id}`, {
      body: JSON.stringify({ expectedVersion: post.version ?? 1, reasonCode: 'owner_requested' }),
    }))
  },
  async listLibrary(query?: LibraryListQuery) {
    const items = await api.get<ApiLibraryItem[]>(withQuery('/library', query))
    return items.map(toLibraryItem)
  },
  async likePost(id: string | number) {
    await api.post(`/posts/${id}/like`)
  },
  async unlikePost(id: string | number) {
    await api.del(`/posts/${id}/like`)
  },
  async replyToPost(id: string | number, body: string) {
    const request: CreateCommentRequest = { body }
    await api.post(`/posts/${id}/comments`, request)
  },
  async convertPostToTask(id: string | number, draft: Pick<PublishDraft, 'rules'>) {
    const request: ConvertToTaskRequest = {
      acceptanceRules: draft.rules,
      pointsReward: 800,
      rewardAmount: null,
      deadlineAt: null,
    }
    return api.post(`/posts/${id}/convert-to-task`, request)
  },
  async savePostToLibrary(post: Post) {
    const request: CreateLibraryItemRequest = {
      title: post.title,
      text: post.excerpt,
      type: post.category,
      source: 'Community',
      sourceId: String(post.id),
      metadata: { postId: post.id, category: post.category, tag: post.tag },
    }
    return api.post<ApiLibraryItem>('/library/items', request)
  },
  async convertLibraryItemToTask(id: string | number) {
    const request: ConvertToTaskRequest = {
      acceptanceRules: 'Review the idea and provide a draft delivery plan.',
      pointsReward: 800,
      rewardAmount: null,
      deadlineAt: null,
    }
    return api.post(`/library/items/${id}/convert-to-task`, request)
  },
  async sendLibraryItemToWorkspace(id: string | number) {
    return api.post(`/library/items/${id}/send-to-workspace`)
  },
}
