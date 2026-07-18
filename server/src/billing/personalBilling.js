import { validationFailed } from '../common/http/validation.js'

export const personalBillingUnits = Object.freeze(['points', 'creative_credit', 'quota_unit'])
export const personalBillingStatuses = Object.freeze([
  'pending', 'settled', 'cancelled', 'reserved', 'refunded', 'committed', 'released',
])

const optionalText = (value, name, maxLength = 120) => {
  if (value == null || value === '') return null
  const normalized = String(value).trim()
  if (!normalized || normalized.length > maxLength) throw validationFailed(`${name} is invalid`)
  return normalized
}

const parseDate = (value, name) => {
  if (value == null || value === '') return null
  const date = new Date(String(value))
  if (!Number.isFinite(date.getTime())) throw validationFailed(`${name} must be an ISO date-time`)
  return date
}

export const parsePersonalBillingQuery = (query = {}) => {
  const unit = optionalText(query.unit, 'unit', 40)
  const status = optionalText(query.status, 'status', 40)
  if (unit && !personalBillingUnits.includes(unit)) throw validationFailed('unit is invalid')
  if (status && !personalBillingStatuses.includes(status)) throw validationFailed('status is invalid')
  const dateFrom = parseDate(query.dateFrom, 'dateFrom')
  const dateTo = parseDate(query.dateTo, 'dateTo')
  if (dateFrom && dateTo && dateFrom > dateTo) throw validationFailed('dateFrom must not be after dateTo')
  if (dateFrom && dateTo && dateTo.getTime() - dateFrom.getTime() > 366 * 24 * 60 * 60 * 1000) {
    throw validationFailed('billing window cannot exceed 366 days')
  }
  const limit = query.limit == null || query.limit === '' ? 20 : Number(query.limit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw validationFailed('limit must be between 1 and 100')
  const sort = query.sort == null || query.sort === '' ? 'desc' : String(query.sort)
  if (!['asc', 'desc'].includes(sort)) throw validationFailed('sort must be asc or desc')
  return {
    unit,
    status,
    sourceType: optionalText(query.sourceType, 'sourceType'),
    search: optionalText(query.search, 'search', 160),
    dateFrom,
    dateTo,
    cursor: optionalText(query.cursor, 'cursor', 400),
    limit,
    sort,
  }
}

export const encodePersonalBillingCursor = (item) => Buffer.from(JSON.stringify({
  occurredAt: item.occurredAt,
  id: item.id,
})).toString('base64url')

export const decodePersonalBillingCursor = (value) => {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'))
    const occurredAt = new Date(parsed.occurredAt)
    if (!Number.isFinite(occurredAt.getTime()) || !parsed.id) throw new Error('invalid')
    return { occurredAt: occurredAt.toISOString(), id: String(parsed.id) }
  } catch {
    throw validationFailed('cursor is invalid')
  }
}

const timestamp = (value) => new Date(value ?? 0).getTime()

export const paginatePersonalBillingEntries = (entries, options) => {
  const cursor = decodePersonalBillingCursor(options.cursor)
  const direction = options.sort === 'asc' ? 1 : -1
  const sorted = [...entries].sort((left, right) => {
    const byTime = (timestamp(left.occurredAt) - timestamp(right.occurredAt)) * direction
    return byTime || String(left.id).localeCompare(String(right.id)) * direction
  })
  const cursorIndex = cursor
    ? sorted.findIndex((item) => item.id === cursor.id && item.occurredAt === cursor.occurredAt)
    : -1
  if (cursor && cursorIndex < 0) throw validationFailed('cursor is stale')
  const scoped = cursorIndex >= 0 ? sorted.slice(cursorIndex + 1) : sorted
  const page = scoped.slice(0, options.limit)
  return {
    items: page,
    limit: options.limit,
    nextCursor: scoped.length > options.limit && page.length ? encodePersonalBillingCursor(page.at(-1)) : null,
  }
}

export const filterPersonalBillingEntries = (entries, options) => entries.filter((item) => {
  if (options.unit && item.unit !== options.unit) return false
  if (options.status && item.status !== options.status) return false
  if (options.sourceType && item.sourceType !== options.sourceType) return false
  const occurredAt = timestamp(item.occurredAt)
  if (options.dateFrom && occurredAt < options.dateFrom.getTime()) return false
  if (options.dateTo && occurredAt > options.dateTo.getTime()) return false
  if (options.search) {
    const needle = options.search.toLowerCase()
    const haystack = [item.description, item.sourceType, item.sourceId, item.reasonCode, item.workspace]
      .map((value) => String(value ?? '').toLowerCase()).join(' ')
    if (!haystack.includes(needle)) return false
  }
  return true
})

export const personalBillingCsv = (items) => {
  const cell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
  return [
    ['id', 'unit', 'status', 'amount', 'source_type', 'source_id', 'description', 'reason_code', 'workspace', 'occurred_at'].map(cell).join(','),
    ...items.map((item) => [item.id, item.unit, item.status, item.amount, item.sourceType, item.sourceId, item.description, item.reasonCode, item.workspace, item.occurredAt].map(cell).join(',')),
  ].join('\n')
}
