import { HttpError } from '../errors/httpError.js'

export const validationFailed = (message, details) => new HttpError(400, 'VALIDATION_FAILED', message, details)

export const requireText = (body, field) => {
  const value = body[field]
  if (typeof value !== 'string' || !value.trim()) {
    throw validationFailed(`${field} is required`)
  }
  return value.trim()
}

export const optionalText = (body, field, fallback = undefined) => {
  const value = body[field]
  if (value == null) {
    return fallback
  }
  if (typeof value !== 'string') {
    throw validationFailed(`${field} must be a string`)
  }
  const trimmed = value.trim()
  return trimmed || fallback
}

export const nullableText = (body, field) => {
  const value = body[field]
  if (value == null) {
    return null
  }
  if (typeof value !== 'string') {
    throw validationFailed(`${field} must be a string`)
  }
  return value.trim() || null
}

export const requireNumber = (body, field) => {
  const value = Number(body[field])
  if (!Number.isFinite(value)) {
    throw validationFailed(`${field} must be a number`)
  }
  return value
}

export const optionalNumber = (body, field, fallback = null) => {
  if (body[field] == null) {
    return fallback
  }
  const value = Number(body[field])
  if (!Number.isFinite(value)) {
    throw validationFailed(`${field} must be a number`)
  }
  return value
}

export const optionalStringArray = (body, field, fallback = []) => {
  const value = body[field]
  if (value == null) {
    return fallback
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw validationFailed(`${field} must be an array of strings`)
  }
  return value
}

export const requireOneOf = (body, field, allowedValues) => {
  const value = requireText(body, field)
  if (!allowedValues.includes(value)) {
    throw validationFailed(`${field} must be one of: ${allowedValues.join(', ')}`)
  }
  return value
}

export const requireStringArray = (body, field) => {
  const value = body[field]
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw validationFailed(`${field} must be an array of strings`)
  }
  return value
}
