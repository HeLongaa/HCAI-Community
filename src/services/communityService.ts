import { api, withQuery } from './apiClient'
import type { CommunityPostDraft, InspirationItem, Post, PublishDraft } from '../domain/types'
import type {
  ApiInspirationCategory,
  ApiInspirationEntry,
  ApiLibraryItem,
  ApiPost,
  ConvertToTaskRequest,
  CreateCommentRequest,
  CreatePostRequest,
  LibraryListQuery,
  InspirationSubmissionRequest,
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
  moderationState: post.moderationState,
  moderationVersion: post.moderationVersion,
  moderationUpdatedAt: post.moderationUpdatedAt,
  comments: post.comments?.map((comment) => ({
    id: comment.id,
    body: comment.body,
    author: comment.author?.handle ?? 'unknown',
    parentId: comment.parentId,
    moderationState: comment.moderationState,
    moderationVersion: comment.moderationVersion,
    moderationUpdatedAt: comment.moderationUpdatedAt,
    createdAt: comment.createdAt,
  })),
})

const toInspirationItem = (item: ApiInspirationEntry): InspirationItem => ({
  ...item,
  type: item.category?.nameEn ?? item.contentType,
  source: item.sourceKind === 'official' ? 'Official' : item.author?.displayName ?? 'Community',
  saves: String(item.favoriteCount),
  text: item.summary,
})

export const communityService = {
  async getPost(id: string | number) {
    return toPost(await api.get<ApiPost>(`/posts/${id}`))
  },
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
    const items = await api.get<ApiInspirationEntry[]>(withQuery('/inspiration', query))
    return items.map(toInspirationItem)
  },
  async listInspirationCategories() {
    return api.get<ApiInspirationCategory[]>('/inspiration/categories')
  },
  async getInspiration(id: string | number) {
    return toInspirationItem(await api.get<ApiInspirationEntry>(`/inspiration/${id}`))
  },
  async listInspirationFavorites() {
    return (await api.get<ApiInspirationEntry[]>('/inspiration/favorites/mine')).map(toInspirationItem)
  },
  async favoriteInspiration(id: string | number, active: boolean) {
    const item = active
      ? await api.post<ApiInspirationEntry>(`/inspiration/${id}/favorite`)
      : await api.del<ApiInspirationEntry>(`/inspiration/${id}/favorite`)
    return toInspirationItem(item)
  },
  async listMyInspirationSubmissions() {
    return (await api.get<ApiInspirationEntry[]>('/inspiration/submissions/mine')).map(toInspirationItem)
  },
  async createInspirationSubmission(request: InspirationSubmissionRequest) {
    return toInspirationItem(await api.post<ApiInspirationEntry>('/inspiration/submissions', request))
  },
  async updateInspirationSubmission(id: string | number, request: Partial<InspirationSubmissionRequest>) {
    return toInspirationItem(await api.patch<ApiInspirationEntry>(`/inspiration/submissions/${id}`, request))
  },
  async submitInspiration(id: string | number) {
    return toInspirationItem(await api.post<ApiInspirationEntry>(`/inspiration/submissions/${id}/submit`))
  },
  async withdrawInspiration(id: string | number) {
    return toInspirationItem(await api.post<ApiInspirationEntry>(`/inspiration/submissions/${id}/withdraw`))
  },
  async removeInspirationFavorites(ids: Array<string | number>) {
    return api.del<{ removed: number; ids: string[] }>('/inspiration/favorites', {
      body: JSON.stringify({ ids: ids.map(String) }),
    })
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
  async convertLibraryItemToTask(id: string | number) {
    const request: ConvertToTaskRequest = {
      acceptanceRules: 'Review the idea and provide a draft delivery plan.',
      pointsReward: 800,
      rewardAmount: null,
      deadlineAt: null,
    }
    return api.post(`/library/items/${id}/convert-to-task`, request)
  },
  async deleteLibraryItem(item: ApiLibraryItem) {
    return api.del<ApiLibraryItem>(`/library/items/${item.id}`, {
      body: JSON.stringify({ expectedVersion: item.version, reasonCode: 'owner_requested' }),
    })
  },
  async restoreLibraryItem(item: ApiLibraryItem) {
    return api.post<ApiLibraryItem>(`/library/items/${item.id}/restore`, {
      expectedVersion: item.version,
      reasonCode: 'owner_restore',
    })
  },
  async sendLibraryItemToWorkspace(id: string | number) {
    const result = await api.post<{
      item: ApiInspirationEntry
      workspaceDraft: { title: string; seed: string; entryId: string; version: number }
    }>(`/inspiration/${id}/use`)
    return { ...result, item: toInspirationItem(result.item) }
  },
}
