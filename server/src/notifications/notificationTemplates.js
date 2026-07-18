import { HttpError } from '../common/errors/httpError.js'

export const notificationTemplateStatuses = ['draft', 'published', 'archived']
const variableNamePattern = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
const templateKeyPattern = /^[a-z][a-z0-9_.-]{2,79}$/
const reasonCodePattern = /^[a-z][a-z0-9_.-]{2,79}$/
const localePattern = /^[a-z]{2}(?:-[A-Z]{2})?$/
const placeholderPattern = /{{\s*([A-Za-z][A-Za-z0-9_]*)\s*}}/g
const allowedVariableTypes = new Set(['string', 'number', 'boolean'])

const boundedText = (value, field, max, { required = true } = {}) => {
  const text = String(value ?? '').trim()
  if ((required && !text) || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new HttpError(400, 'INVALID_REQUEST', `${field} must be ${required ? 'non-empty and ' : ''}at most ${max} characters`)
  }
  return text || null
}

const positiveVersion = (value, field = 'expectedVersion') => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) throw new HttpError(400, 'INVALID_REQUEST', `${field} must be a positive integer`)
  return parsed
}

export const parseNotificationVariableSchema = (raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HttpError(400, 'INVALID_NOTIFICATION_SCHEMA', 'variableSchema must be an object')
  }
  const properties = raw.properties
  const required = raw.required ?? []
  if (!properties || typeof properties !== 'object' || Array.isArray(properties) || !Array.isArray(required)) {
    throw new HttpError(400, 'INVALID_NOTIFICATION_SCHEMA', 'variableSchema requires properties and required')
  }
  const keys = Object.keys(properties)
  if (keys.length > 30 || required.length > 30 || keys.some((key) => !variableNamePattern.test(key))) {
    throw new HttpError(400, 'INVALID_NOTIFICATION_SCHEMA', 'variableSchema contains invalid variable names')
  }
  if (new Set(required).size !== required.length || required.some((key) => !keys.includes(key))) {
    throw new HttpError(400, 'INVALID_NOTIFICATION_SCHEMA', 'required variables must be unique declared properties')
  }
  const normalizedProperties = Object.fromEntries(keys.map((key) => {
    const definition = properties[key]
    if (!definition || typeof definition !== 'object' || Array.isArray(definition) || !allowedVariableTypes.has(definition.type)) {
      throw new HttpError(400, 'INVALID_NOTIFICATION_SCHEMA', `Unsupported variable type for ${key}`)
    }
    const unknown = Object.keys(definition).filter((field) => !['type', 'maxLength'].includes(field))
    if (unknown.length > 0) throw new HttpError(400, 'INVALID_NOTIFICATION_SCHEMA', `Unsupported schema field for ${key}`)
    const maxLength = definition.type === 'string' && definition.maxLength != null
      ? positiveVersion(definition.maxLength, `${key}.maxLength`)
      : undefined
    if (maxLength && maxLength > 1000) throw new HttpError(400, 'INVALID_NOTIFICATION_SCHEMA', `${key}.maxLength is too large`)
    return [key, { type: definition.type, ...(maxLength ? { maxLength } : {}) }]
  }))
  return { additionalProperties: false, required: [...required], properties: normalizedProperties }
}

const templateVariables = (value) => {
  const variables = []
  for (const match of String(value).matchAll(placeholderPattern)) variables.push(match[1])
  return variables
}

export const validateNotificationTemplateContent = ({ titleTemplate, bodyTemplate, variableSchema }) => {
  const title = boundedText(titleTemplate, 'titleTemplate', 200)
  const body = boundedText(bodyTemplate, 'bodyTemplate', 2000)
  const schema = parseNotificationVariableSchema(variableSchema)
  const declared = new Set(Object.keys(schema.properties))
  const referenced = [...new Set([...templateVariables(title), ...templateVariables(body)])]
  const undeclared = referenced.filter((key) => !declared.has(key))
  const unusedRequired = schema.required.filter((key) => !referenced.includes(key))
  if (undeclared.length || unusedRequired.length) {
    throw new HttpError(400, 'INVALID_NOTIFICATION_TEMPLATE', undeclared.length
      ? `Undeclared template variables: ${undeclared.join(', ')}`
      : `Required variables are not used: ${unusedRequired.join(', ')}`)
  }
  return { titleTemplate: title, bodyTemplate: body, variableSchema: schema }
}

export const renderNotificationTemplate = (version, variables) => {
  if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
    throw new HttpError(400, 'INVALID_NOTIFICATION_VARIABLES', 'variables must be an object')
  }
  const schema = parseNotificationVariableSchema(version.variableSchema)
  const keys = Object.keys(variables)
  const unknown = keys.filter((key) => !Object.hasOwn(schema.properties, key))
  const missing = schema.required.filter((key) => variables[key] == null)
  if (unknown.length || missing.length) {
    throw new HttpError(400, 'INVALID_NOTIFICATION_VARIABLES', unknown.length
      ? `Unknown variables: ${unknown.join(', ')}`
      : `Missing variables: ${missing.join(', ')}`)
  }
  const normalized = {}
  for (const [key, definition] of Object.entries(schema.properties)) {
    if (variables[key] == null) continue
    const value = variables[key]
    if (typeof value !== definition.type) throw new HttpError(400, 'INVALID_NOTIFICATION_VARIABLES', `${key} must be ${definition.type}`)
    if (definition.type === 'string' && (value.length > (definition.maxLength ?? 1000) || /[\u0000-\u001f\u007f]/.test(value))) {
      throw new HttpError(400, 'INVALID_NOTIFICATION_VARIABLES', `${key} is invalid`)
    }
    normalized[key] = String(value)
  }
  const replace = (_match, key) => normalized[key] ?? ''
  return {
    title: version.titleTemplate.replace(placeholderPattern, replace),
    body: version.bodyTemplate.replace(placeholderPattern, replace),
  }
}

const parseReason = (value) => {
  const reasonCode = String(value ?? '').trim().toLowerCase()
  if (!reasonCodePattern.test(reasonCode)) throw new HttpError(400, 'INVALID_REQUEST', 'reasonCode is invalid')
  return reasonCode
}

const parseLocale = (value) => {
  const locale = String(value ?? 'en').trim()
  if (!localePattern.test(locale)) throw new HttpError(400, 'INVALID_REQUEST', 'locale is invalid')
  return locale
}

export const parseCreateNotificationTemplate = (raw = {}) => {
  const key = String(raw.key ?? '').trim().toLowerCase()
  if (!templateKeyPattern.test(key)) throw new HttpError(400, 'INVALID_REQUEST', 'key is invalid')
  return {
    key,
    name: boundedText(raw.name, 'name', 120),
    description: boundedText(raw.description, 'description', 500, { required: false }),
    category: boundedText(raw.category, 'category', 80).toLowerCase(),
    locale: parseLocale(raw.locale),
    ...validateNotificationTemplateContent(raw),
  }
}

export const parseUpdateNotificationTemplate = (raw = {}) => ({
  expectedVersion: positiveVersion(raw.expectedVersion),
  name: boundedText(raw.name, 'name', 120),
  description: boundedText(raw.description, 'description', 500, { required: false }),
  category: boundedText(raw.category, 'category', 80).toLowerCase(),
  locale: parseLocale(raw.locale),
  ...validateNotificationTemplateContent(raw),
})

export const parseNotificationTemplateTransition = (raw = {}) => ({
  expectedVersion: positiveVersion(raw.expectedVersion),
  reasonCode: parseReason(raw.reasonCode),
  ...(raw.versionNumber == null ? {} : { versionNumber: positiveVersion(raw.versionNumber, 'versionNumber') }),
})

export const parseNotificationPreferenceUpdate = (raw = {}) => {
  const notificationType = String(raw.notificationType ?? '').trim().toLowerCase()
  if (!templateKeyPattern.test(notificationType) || typeof raw.inAppEnabled !== 'boolean') {
    throw new HttpError(400, 'INVALID_REQUEST', 'notificationType and inAppEnabled are required')
  }
  const expectedVersion = raw.expectedVersion == null ? null : positiveVersion(raw.expectedVersion)
  return { notificationType, inAppEnabled: raw.inAppEnabled, expectedVersion }
}

export const parseNotificationTemplateListQuery = (query = {}) => {
  const limit = Math.min(Math.max(Number.parseInt(query.limit ?? '20', 10) || 20, 1), 100)
  const status = query.status ? String(query.status).trim().toLowerCase() : null
  if (status && !notificationTemplateStatuses.includes(status)) throw new HttpError(400, 'INVALID_REQUEST', 'status is invalid')
  const sort = ['key', 'createdAt', 'updatedAt'].includes(query.sort) ? query.sort : 'updatedAt'
  const order = query.order === 'asc' ? 'asc' : 'desc'
  return {
    limit, status, sort, order,
    category: query.category ? boundedText(query.category, 'category', 80).toLowerCase() : null,
    search: query.search ? boundedText(query.search, 'search', 120).toLowerCase() : null,
    cursor: query.cursor ? boundedText(query.cursor, 'cursor', 500) : null,
    includeDeleted: query.includeDeleted === 'true',
  }
}

export const notificationTemplateDto = (row) => ({
  id: row.id,
  key: row.key,
  name: row.name,
  description: row.description ?? null,
  category: row.category,
  status: row.status,
  activeVersionNumber: row.activeVersionNumber ?? null,
  version: row.version,
  deletedAt: row.deletedAt?.toISOString?.() ?? row.deletedAt ?? null,
  createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
  updatedAt: row.updatedAt?.toISOString?.() ?? row.updatedAt,
  ...(row.versions ? { versions: row.versions.map(notificationTemplateVersionDto) } : {}),
})

export const notificationTemplateVersionDto = (row) => ({
  id: row.id,
  templateId: row.templateId,
  versionNumber: row.versionNumber,
  locale: row.locale,
  titleTemplate: row.titleTemplate,
  bodyTemplate: row.bodyTemplate,
  variableSchema: row.variableSchema,
  variableSchemaSchemaVersion: row.variableSchemaSchemaVersion ?? 1,
  status: row.status,
  reasonCode: row.reasonCode ?? null,
  publishedAt: row.publishedAt?.toISOString?.() ?? row.publishedAt ?? null,
  createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
})

export const notificationPreferenceDto = (row) => ({
  notificationType: row.notificationType,
  inAppEnabled: row.inAppEnabled,
  version: row.version,
  updatedAt: row.updatedAt?.toISOString?.() ?? row.updatedAt,
})
