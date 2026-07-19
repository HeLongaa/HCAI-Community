import { createHash } from 'node:crypto'
import { validationFailed } from '../common/http/validation.js'

export const searchResourceTypes = Object.freeze(['task', 'community', 'user', 'asset'])

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

const cursorHash = (query, types) => createHash('sha256').update(JSON.stringify([query, types])).digest('base64url').slice(0, 24)

export const encodeSearchCursor = ({ query, types, offset }) => Buffer.from(JSON.stringify({
  v: 1,
  h: cursorHash(query, types),
  o: offset,
})).toString('base64url')

export const decodeSearchCursor = (cursor, { query, types }) => {
  if (!cursor) return 0
  try {
    const payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (payload?.v !== 1 || payload.h !== cursorHash(query, types) || !Number.isSafeInteger(payload.o) || payload.o < 0 || payload.o > 100_000) {
      throw new Error('invalid')
    }
    return payload.o
  } catch {
    throw validationFailed('cursor is invalid for this search query')
  }
}

export const searchDocumentId = (resourceType, sourceId) => `search:${resourceType}:${sourceId}`

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
