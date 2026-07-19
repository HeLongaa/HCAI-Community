import { createHash, createHmac } from 'node:crypto'
import { validationFailed } from '../common/http/validation.js'
import { getAccessTokenKeyRing } from '../auth/sessionTokens.js'

export const searchResourceTypes = Object.freeze(['task', 'community', 'user', 'asset'])
export const searchSorts = Object.freeze(['relevance', 'recent', 'popular'])

const boundedInteger = (value, fallback, maximum, field) => {
  if (value == null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw validationFailed(`${field} must be an integer between 1 and ${maximum}`)
  }
  return parsed
}

const parseTypes = (value) => {
  if (value == null || value === '') return [...searchResourceTypes]
  const types = [...new Set(String(value).split(',').map((item) => item.trim()).filter(Boolean))]
  if (!types.length || types.some((type) => !searchResourceTypes.includes(type))) {
    throw validationFailed(`types must only include: ${searchResourceTypes.join(', ')}`)
  }
  return types
}

export const parseSearchQuery = (query = {}) => {
  const value = String(query.q ?? '').trim()
  if (value.length < 2 || value.length > 120) throw validationFailed('q must be between 2 and 120 characters')
  const cursor = query.cursor == null || query.cursor === '' ? null : String(query.cursor)
  if (cursor && cursor.length > 300) throw validationFailed('cursor must not exceed 300 characters')
  return {
    query: value,
    types: parseTypes(query.types),
    sort: searchSorts.includes(String(query.sort ?? 'relevance')) ? String(query.sort ?? 'relevance') : (() => { throw validationFailed(`sort must be one of: ${searchSorts.join(', ')}`) })(),
    limit: boundedInteger(query.limit, 20, 50, 'limit'),
    cursor,
  }
}

export const parseSearchSyncRequest = (body = {}) => ({
  types: parseTypes(body.types),
  limit: boundedInteger(body.limit, 100, 500, 'limit'),
  reasonCode: (() => {
    const value = String(body.reasonCode ?? 'admin_search_sync').trim()
    if (!/^[a-z0-9][a-z0-9._:-]{0,79}$/.test(value)) throw validationFailed('reasonCode must be a stable lowercase identifier')
    return value
  })(),
})

const cursorHash = (query, types, sort) => createHash('sha256').update(JSON.stringify([query, types, sort])).digest('base64url').slice(0, 24)

export const encodeSearchCursor = ({ query, types, sort, offset }) => Buffer.from(JSON.stringify({
  v: 1,
  h: cursorHash(query, types, sort),
  o: offset,
})).toString('base64url')

export const decodeSearchCursor = (cursor, { query, types, sort }) => {
  if (!cursor) return 0
  try {
    const payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (payload?.v !== 1 || payload.h !== cursorHash(query, types, sort) || !Number.isSafeInteger(payload.o) || payload.o < 0 || payload.o > 100_000) {
      throw new Error('invalid')
    }
    return payload.o
  } catch {
    throw validationFailed('cursor is invalid for this search query')
  }
}

export const searchDocumentId = (resourceType, sourceId) => `search:${resourceType}:${sourceId}`

export const searchQueryFingerprint = (query) => {
  const key = getAccessTokenKeyRing().find((candidate) => candidate.current)
  return createHmac('sha256', key.secret).update(String(query).trim().toLowerCase()).digest('hex')
}

export const parseSearchClickRequest = (body = {}) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw validationFailed('payload must be an object')
  const unsupported = Object.keys(body).filter((key) => !['resourceType', 'sourceId', 'position'].includes(key))
  if (unsupported.length) throw validationFailed(`payload contains unsupported fields: ${unsupported.join(', ')}`)
  const resourceType = String(body.resourceType ?? '')
  if (!searchResourceTypes.includes(resourceType)) throw validationFailed(`resourceType must be one of: ${searchResourceTypes.join(', ')}`)
  const sourceId = String(body.sourceId ?? '').trim()
  if (!sourceId || sourceId.length > 255 || /[\u0000-\u001f\u007f]/.test(sourceId)) throw validationFailed('sourceId is invalid')
  if (body.position == null || body.position === '') throw validationFailed('position is required')
  return { resourceType, sourceId, position: boundedInteger(body.position, null, 50, 'position') }
}

export const parseSearchDiagnosticsQuery = (query = {}) => ({
  windowHours: boundedInteger(query.windowHours, 24, 168, 'windowHours'),
})

export const parseSearchRankingControlRequest = (body = {}) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw validationFailed('payload must be an object')
  const allowed = ['relevanceWeight', 'recencyWeight', 'popularityWeight', 'zeroResultAlertRateBps', 'expectedVersion', 'reasonCode']
  const unsupported = Object.keys(body).filter((key) => !allowed.includes(key))
  if (unsupported.length) throw validationFailed(`payload contains unsupported fields: ${unsupported.join(', ')}`)
  const weight = (key) => {
    const value = Number(body[key])
    if (!Number.isInteger(value) || value < 0 || value > 100) throw validationFailed(`${key} must be an integer between 0 and 100`)
    return value
  }
  const threshold = Number(body.zeroResultAlertRateBps)
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 10_000) throw validationFailed('zeroResultAlertRateBps must be an integer between 0 and 10000')
  const expectedVersion = Number(body.expectedVersion)
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw validationFailed('expectedVersion must be a non-negative integer')
  const reasonCode = String(body.reasonCode ?? '').trim()
  if (!/^[a-z0-9][a-z0-9._:-]{0,79}$/.test(reasonCode)) throw validationFailed('reasonCode must be a stable lowercase identifier')
  return {
    relevanceWeight: weight('relevanceWeight'),
    recencyWeight: weight('recencyWeight'),
    popularityWeight: weight('popularityWeight'),
    zeroResultAlertRateBps: threshold,
    expectedVersion,
    reasonCode,
  }
}

export const searchResultDto = (row) => ({
  type: row.resourceType,
  id: row.sourceId,
  title: row.title,
  summary: row.summary,
  lifecycle: row.lifecycle ?? null,
  target: row.target,
  updatedAt: row.sourceUpdatedAt?.toISOString?.() ?? row.sourceUpdatedAt,
  indexedAt: row.indexedAt?.toISOString?.() ?? row.indexedAt,
  score: Number(row.score ?? 0),
})

export const searchRankingControlDto = (row) => ({
  relevanceWeight: row.relevanceWeight,
  recencyWeight: row.recencyWeight,
  popularityWeight: row.popularityWeight,
  zeroResultAlertRateBps: row.zeroResultAlertRateBps,
  version: row.version,
  reasonCode: row.reasonCode,
  updatedByRef: row.updatedByRef ?? null,
  updatedAt: new Date(row.updatedAt).toISOString(),
})
