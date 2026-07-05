import type { InspirationItem, LocalizedText, MarketplaceProfile, Post, PublishDraft, Role, Task } from './types'
import { marketplaceProfiles } from '../data/mockData'

export const hasCjk = (value: string) => /[\u3400-\u9fff]/.test(value)

export const isZhCopy = (t: Record<string, string>) => t.home === '首页'

export const textFor = (t: Record<string, string>, en: string, zh: string) => (isZhCopy(t) ? zh : en)

export const matchesLanguage = (value: string, isZh: boolean) => (isZh ? hasCjk(value) : !hasCjk(value))

export const localizeText = (value: LocalizedText, t: Record<string, string>) => (isZhCopy(t) ? value.zh : value.en)

export const profileTags = (profile: MarketplaceProfile, t: Record<string, string>) => (isZhCopy(t) ? profile.zhTags : profile.tags)

export const findProfile = (handle: string) => marketplaceProfiles.find((profile) => profile.handle === handle)

const taskLanguageText = (task: Task) =>
  [task.title, task.description, task.privateBrief, task.submission, task.reviewNote, ...task.requirements].join(' ')

const postLanguageText = (post: Post) => [post.title, post.category, post.tag, post.excerpt, post.body ?? ''].join(' ')

const inspirationLanguageText = (item: InspirationItem) => [item.title, item.type, item.source, item.text].join(' ')

export function localizedTasks(tasksToFilter: Task[], t: Record<string, string>) {
  const isZh = isZhCopy(t)
  const filtered = tasksToFilter.filter((task) => matchesLanguage(taskLanguageText(task), isZh))
  return filtered.length ? filtered : tasksToFilter
}

export function localizedPosts(postsToFilter: Post[], t: Record<string, string>) {
  const isZh = isZhCopy(t)
  const filtered = postsToFilter.filter((post) => matchesLanguage(postLanguageText(post), isZh))
  return filtered.length ? filtered : postsToFilter
}

export function localizedInspiration(items: InspirationItem[], t: Record<string, string>) {
  const isZh = isZhCopy(t)
  const filtered = items.filter((item) => matchesLanguage(inspirationLanguageText(item), isZh))
  return filtered.length ? filtered : items
}

export function rankProfiles(lane: 'maker' | 'publisher') {
  return marketplaceProfiles
    .filter((profile) => profile.lane === lane || profile.lane === 'both')
    .sort((a, b) => {
      const aValue = lane === 'maker' ? a.stats.score + a.stats.completed * 12 : a.stats.score + a.stats.posted * 11
      const bValue = lane === 'maker' ? b.stats.score + b.stats.completed * 12 : b.stats.score + b.stats.posted * 11
      return bValue - aValue
    })
}

export function profileMatchScore(profile: MarketplaceProfile, draft: PublishDraft) {
  const source = `${draft.title} ${draft.category} ${draft.details} ${draft.rules}`.toLowerCase()
  const tagHits = [...profile.tags, ...profile.zhTags].filter((tag) => source.includes(tag.toLowerCase()))
  const categoryHit = profile.categories.includes(draft.category)
  const broadHits = profile.categories.filter((category) => source.includes(category.toLowerCase()))
  const languageHit = hasCjk(source) && profile.languages.includes('中文')
  const score = Math.min(99, 54 + tagHits.length * 7 + (categoryHit ? 22 : 0) + broadHits.length * 5 + (languageHit ? 6 : 0) + Math.round(profile.stats.score / 80))
  return {
    profile,
    score,
    tags: tagHits.slice(0, 3),
    categoryHit,
    languageHit,
  }
}

export function matchProfilesForDraft(draft: PublishDraft) {
  return marketplaceProfiles
    .filter((profile) => profile.lane === 'maker' || profile.lane === 'both')
    .map((profile) => profileMatchScore(profile, draft))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
}

export function publishFieldLabel(field: keyof PublishDraft, t: Record<string, string>) {
  const labels: Partial<Record<keyof PublishDraft, [string, string]>> = {
    title: ['task title', '任务标题'],
    category: ['category', '分类'],
    reward: ['reward', '奖励'],
    deadline: ['deadline', '截止时间'],
    visibility: ['visibility', '可见范围'],
    details: ['requirement details', '需求详情'],
    rules: ['acceptance rules', '验收规则'],
  }
  const [en, zh] = labels[field] ?? ['field', '字段']
  return textFor(t, en, zh)
}

export function categoryLabel(category: string, t: Record<string, string>) {
  if (!isZhCopy(t)) return category
  const labels: Record<string, string> = {
    All: '全部',
    Music: '音乐',
    Image: '图片',
    Video: '视频',
    Voice: '配音',
    Prompt: '提示词',
    Design: '设计',
    Automation: '自动化',
    Questions: '问答',
    Tutorials: '教程',
    Showcase: '作品',
    Prompts: '提示词',
    Collaboration: '协作',
    'Task Recap': '任务复盘',
  }
  return labels[category] ?? category
}

export function statusLabel(status: string, t?: Record<string, string>) {
  if (!t || !isZhCopy(t)) return status
  const labels: Record<string, string> = {
    Open: '开放中',
    'In Progress': '进行中',
    'Pending Review': '待验收',
    Completed: '已完成',
    Rejected: '已驳回',
    'Pending review': '待审核',
    Resubmission: '重新提交',
    'Community report': '社区举报',
    'Publish audit': '发布审核',
  }
  return labels[status] ?? status
}

export function mediaTypeLabel(type: string, t: Record<string, string>) {
  if (!isZhCopy(t)) return type
  const labels: Record<string, string> = {
    Image: '图片',
    Video: '视频',
    Music: '音乐',
    Playlist: '播放列表',
  }
  return labels[type] ?? type
}

export function pointText(value: string) {
  const normalized = value
    .replace(/[¥$]/g, '')
    .replace(/\bcredits?\b/gi, '积分')
    .replace(/\bpoints?\b/gi, '积分')
    .replace(/\bpts\b/gi, '积分')
    .trim()
  if (!normalized) return '积分'
  return /积分/.test(normalized) ? normalized : `${normalized} 积分`
}

export function roleTier(role: Role) {
  return role === 'admin' ? 'Ultra' : role === 'moderator' || role === 'publisher' ? 'Pro' : role === 'contributor' || role === 'creator' ? 'Plus' : 'Free'
}

export function localeFirstTask(tasksToFilter: Task[], t: Record<string, string>) {
  return localizedTasks(tasksToFilter, t)[0] ?? tasksToFilter[0]
}

export function localeFirstPost(postsToFilter: Post[], t: Record<string, string>) {
  return localizedPosts(postsToFilter, t)[0] ?? postsToFilter[0]
}
