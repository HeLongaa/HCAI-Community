import { HttpError } from '../common/errors/httpError.js'

export const inspirationStatuses = ['draft', 'pending_review', 'changes_requested', 'published', 'rejected', 'archived']
export const inspirationSourceKinds = ['official', 'user_submission']
export const inspirationCategoryKinds = ['content_type', 'domain', 'difficulty']

const fail = (message) => { throw new HttpError(400, 'VALIDATION_FAILED', message) }
const text = (value, field, { required = true, max = 4000 } = {}) => {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (required && !normalized) fail(`${field} is required`)
  if (normalized.length > max) fail(`${field} must not exceed ${max} characters`)
  return normalized
}
const list = (value, field, max = 12) => {
  if (value == null) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) fail(`${field} must be an array of non-empty strings`)
  if (value.length > max) fail(`${field} must include ${max} or fewer values`)
  return [...new Set(value.map((item) => item.trim()))]
}

export const parseInspirationListQuery = (query = {}) => {
  const limit = Number(query.limit ?? 30)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail('limit must be an integer between 1 and 100')
  const result = {
    search: text(query.search, 'search', { required: false, max: 120 }) || null,
    category: text(query.category, 'category', { required: false, max: 64 }) || null,
    domain: text(query.domain, 'domain', { required: false, max: 64 }) || null,
    difficulty: text(query.difficulty, 'difficulty', { required: false, max: 32 }) || null,
    sourceKind: text(query.sourceKind, 'sourceKind', { required: false, max: 32 }) || null,
    status: text(query.status, 'status', { required: false, max: 32 }) || null,
    featured: ['1', 'true'].includes(String(query.featured ?? '').toLowerCase()),
    cursor: text(query.cursor, 'cursor', { required: false, max: 128 }) || null,
    limit,
  }
  if (result.sourceKind && !inspirationSourceKinds.includes(result.sourceKind)) fail(`sourceKind must be one of: ${inspirationSourceKinds.join(', ')}`)
  if (result.status && !inspirationStatuses.includes(result.status)) fail(`status must be one of: ${inspirationStatuses.join(', ')}`)
  return result
}

export const parseInspirationEntry = (body = {}, { partial = false } = {}) => {
  const required = !partial
  const result = {}
  const take = (field, fn) => {
    if (body[field] !== undefined || required) result[field] = fn(body[field], field)
  }
  take('title', (value, field) => text(value, field, { required, max: 140 }))
  take('summary', (value, field) => text(value, field, { required, max: 320 }))
  take('problem', (value, field) => text(value, field, { required, max: 1200 }))
  take('audience', (value, field) => text(value, field, { required, max: 800 }))
  take('categoryId', (value, field) => text(value, field, { required, max: 128 }))
  take('contentType', (value, field) => text(value, field, { required, max: 64 }))
  take('sourceAttribution', (value, field) => text(value, field, { required: false, max: 500 }) || null)
  take('license', (value, field) => text(value, field, { required: false, max: 120 }) || null)
  if (body.domains !== undefined || required) result.domains = list(body.domains, 'domains')
  if (body.toolModels !== undefined || required) result.toolModels = list(body.toolModels, 'toolModels')
  if (body.difficulty !== undefined || required) {
    result.difficulty = text(body.difficulty ?? 'beginner', 'difficulty', { max: 64 })
  }
  if (body.content !== undefined || required) {
    if (!body.content || typeof body.content !== 'object' || Array.isArray(body.content)) fail('content must be an object')
    result.content = body.content
  }
  if (body.featured !== undefined) result.featured = Boolean(body.featured)
  if (body.supportsTaskDraft !== undefined) result.supportsTaskDraft = Boolean(body.supportsTaskDraft)
  if (body.sortOrder !== undefined) {
    const value = Number(body.sortOrder)
    if (!Number.isInteger(value) || value < 0 || value > 100000) fail('sortOrder must be an integer between 0 and 100000')
    result.sortOrder = value
  }
  if (partial && Object.keys(result).length === 0) fail('At least one inspiration field is required')
  return result
}

export const parseInspirationReview = (body = {}) => {
  const decision = text(body.decision, 'decision', { max: 32 })
  if (!['approve', 'request_changes', 'reject'].includes(decision)) fail('decision must be one of: approve, request_changes, reject')
  const note = text(body.note, 'note', { required: decision === 'request_changes' || decision === 'reject', max: 1000 })
  return { decision, note }
}

export const parseCategory = (body = {}) => ({
  kind: (() => { const value = text(body.kind, 'kind', { max: 32 }); if (!inspirationCategoryKinds.includes(value)) fail(`kind must be one of: ${inspirationCategoryKinds.join(', ')}`); return value })(),
  slug: text(body.slug, 'slug', { max: 64 }).toLowerCase().replace(/\s+/g, '-'),
  nameEn: text(body.nameEn, 'nameEn', { max: 80 }),
  nameZh: text(body.nameZh, 'nameZh', { max: 80 }),
  description: text(body.description, 'description', { required: false, max: 300 }) || null,
  sortOrder: Number.isInteger(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
})

export const parseCategoryUpdate = (body = {}) => {
  const result = {}
  if (body.kind !== undefined) {
    const value = text(body.kind, 'kind', { max: 32 })
    if (!inspirationCategoryKinds.includes(value)) fail(`kind must be one of: ${inspirationCategoryKinds.join(', ')}`)
    result.kind = value
  }
  if (body.slug !== undefined) result.slug = text(body.slug, 'slug', { max: 64 }).toLowerCase().replace(/\s+/g, '-')
  if (body.nameEn !== undefined) result.nameEn = text(body.nameEn, 'nameEn', { max: 80 })
  if (body.nameZh !== undefined) result.nameZh = text(body.nameZh, 'nameZh', { max: 80 })
  if (body.description !== undefined) result.description = text(body.description, 'description', { required: false, max: 300 }) || null
  if (body.sortOrder !== undefined) {
    const value = Number(body.sortOrder)
    if (!Number.isInteger(value) || value < 0 || value > 100000) fail('sortOrder must be an integer between 0 and 100000')
    result.sortOrder = value
  }
  if (body.active !== undefined) result.active = Boolean(body.active)
  if (body.replacementCategoryId !== undefined) result.replacementCategoryId = text(body.replacementCategoryId, 'replacementCategoryId', { required: false, max: 128 }) || null
  if (Object.keys(result).length === 0) fail('At least one category field is required')
  return result
}

export const parseFavoriteBatch = (body = {}) => {
  if (!Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > 100) fail('ids must contain between 1 and 100 entry IDs')
  const ids = [...new Set(body.ids.map((value) => text(value, 'ids', { max: 128 })))]
  return { ids }
}

export const parseRollback = (body = {}) => {
  const version = Number(body.version)
  if (!Number.isInteger(version) || version < 1) fail('version must be a positive integer')
  const note = text(body.note, 'note', { required: false, max: 1000 }) || null
  return { version, note }
}
