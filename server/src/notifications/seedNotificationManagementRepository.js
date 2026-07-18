import { randomUUID } from 'node:crypto'
import { HttpError } from '../common/errors/httpError.js'
import {
  notificationPreferenceDto,
  notificationTemplateDto,
  notificationTemplateVersionDto,
  renderNotificationTemplate,
} from './notificationTemplates.js'

const preferencesByUserType = new Map()

const preferenceKey = (userId, type) => `${userId}:${type}`

export const isSeedNotificationEnabled = (userId, type) => preferencesByUserType.get(preferenceKey(userId, type))?.inAppEnabled !== false

const nowIso = () => new Date().toISOString()

export const createSeedNotificationManagementRepository = ({ getUserByHandle, recordAudit }) => {
  const templates = []
  const versions = []

  const findTemplate = (id, includeVersions = false) => {
    const row = templates.find((item) => item.id === String(id)) ?? null
    if (!row) return null
    return notificationTemplateDto({
      ...row,
      ...(includeVersions ? { versions: versions.filter((item) => item.templateId === row.id).sort((a, b) => b.versionNumber - a.versionNumber) } : {}),
    })
  }

  const audit = (actor, action, template, reasonCode, metadata = {}) => recordAudit({
    actor,
    action,
    resourceType: 'notification_template',
    resourceId: template.id,
    metadata: { templateKey: template.key, reasonCode, version: template.version, ...metadata },
  })

  return {
    listTemplates: (query = {}) => {
      const ordered = templates
        .filter((row) => query.includeDeleted || !row.deletedAt)
        .filter((row) => !query.status || row.status === query.status)
        .filter((row) => !query.category || row.category === query.category)
        .filter((row) => !query.search || `${row.key} ${row.name} ${row.description ?? ''}`.toLowerCase().includes(query.search))
        .sort((left, right) => {
          const field = query.sort ?? 'updatedAt'
          const compared = String(left[field]).localeCompare(String(right[field])) || left.id.localeCompare(right.id)
          return query.order === 'asc' ? compared : -compared
        })
      const start = query.cursor ? Math.max(0, ordered.findIndex((row) => row.id === query.cursor) + 1) : 0
      const page = ordered.slice(start, start + query.limit)
      return { items: page.map(notificationTemplateDto), limit: query.limit, nextCursor: ordered[start + query.limit]?.id ?? null }
    },
    findTemplate,
    createTemplate: (payload, actor) => {
      if (templates.some((item) => item.key === payload.key)) throw new HttpError(409, 'RESOURCE_CONFLICT', 'Notification template key already exists')
      const timestamp = nowIso()
      const row = {
        id: `notification-template-${randomUUID()}`,
        key: payload.key,
        name: payload.name,
        description: payload.description,
        category: payload.category,
        status: 'draft',
        activeVersionNumber: null,
        version: 1,
        createdById: actor.id,
        deletedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      const version = {
        id: `notification-template-version-${randomUUID()}`,
        templateId: row.id,
        versionNumber: 1,
        locale: payload.locale,
        titleTemplate: payload.titleTemplate,
        bodyTemplate: payload.bodyTemplate,
        variableSchema: payload.variableSchema,
        variableSchemaSchemaVersion: 1,
        status: 'draft',
        createdById: actor.id,
        reasonCode: null,
        publishedAt: null,
        createdAt: timestamp,
      }
      templates.unshift(row)
      versions.unshift(version)
      audit(actor, 'notification.template.created', row, 'initial_draft', { templateVersion: 1 })
      return findTemplate(row.id, true)
    },
    updateTemplate: (id, payload, actor) => {
      const row = templates.find((item) => item.id === String(id) && !item.deletedAt)
      if (!row) return null
      if (row.version !== payload.expectedVersion) throw new HttpError(409, 'STATE_CONFLICT', 'Notification template was modified concurrently')
      const latest = Math.max(0, ...versions.filter((item) => item.templateId === row.id).map((item) => item.versionNumber))
      const timestamp = nowIso()
      Object.assign(row, {
        name: payload.name,
        description: payload.description,
        category: payload.category,
        status: row.activeVersionNumber ? 'published' : 'draft',
        version: row.version + 1,
        updatedAt: timestamp,
      })
      versions.unshift({
        id: `notification-template-version-${randomUUID()}`,
        templateId: row.id,
        versionNumber: latest + 1,
        locale: payload.locale,
        titleTemplate: payload.titleTemplate,
        bodyTemplate: payload.bodyTemplate,
        variableSchema: payload.variableSchema,
        variableSchemaSchemaVersion: 1,
        status: 'draft',
        createdById: actor.id,
        reasonCode: null,
        publishedAt: null,
        createdAt: timestamp,
      })
      audit(actor, 'notification.template.updated', row, 'draft_updated', { templateVersion: latest + 1 })
      return findTemplate(row.id, true)
    },
    publishTemplate: (id, payload, actor) => {
      const row = templates.find((item) => item.id === String(id) && !item.deletedAt)
      if (!row) return null
      if (row.version !== payload.expectedVersion) throw new HttpError(409, 'STATE_CONFLICT', 'Notification template was modified concurrently')
      const candidates = versions.filter((item) => item.templateId === row.id && item.status === 'draft')
      const target = payload.versionNumber
        ? candidates.find((item) => item.versionNumber === payload.versionNumber)
        : candidates.sort((a, b) => b.versionNumber - a.versionNumber)[0]
      if (!target) throw new HttpError(409, 'NOTIFICATION_TEMPLATE_NOT_PUBLISHABLE', 'A draft version is required')
      const timestamp = nowIso()
      for (const version of versions.filter((item) => item.templateId === row.id && item.status === 'published')) version.status = 'superseded'
      Object.assign(target, { status: 'published', reasonCode: payload.reasonCode, publishedAt: timestamp })
      Object.assign(row, { status: 'published', activeVersionNumber: target.versionNumber, version: row.version + 1, updatedAt: timestamp })
      audit(actor, 'notification.template.published', row, payload.reasonCode, { templateVersion: target.versionNumber })
      return findTemplate(row.id, true)
    },
    rollbackTemplate: (id, payload, actor) => {
      const row = templates.find((item) => item.id === String(id) && !item.deletedAt)
      if (!row) return null
      if (row.version !== payload.expectedVersion) throw new HttpError(409, 'STATE_CONFLICT', 'Notification template was modified concurrently')
      const target = versions.find((item) => item.templateId === row.id && item.versionNumber === payload.versionNumber && item.publishedAt)
      if (!target) throw new HttpError(409, 'NOTIFICATION_TEMPLATE_NOT_ROLLBACKABLE', 'Only a previously published version can be restored')
      const timestamp = nowIso()
      for (const version of versions.filter((item) => item.templateId === row.id && item.status === 'published')) version.status = 'superseded'
      target.status = 'published'
      Object.assign(row, { status: 'published', activeVersionNumber: target.versionNumber, version: row.version + 1, updatedAt: timestamp })
      audit(actor, 'notification.template.rolled_back', row, payload.reasonCode, { templateVersion: target.versionNumber })
      return findTemplate(row.id, true)
    },
    setDeleted: (id, payload, actor, deleted) => {
      const row = templates.find((item) => item.id === String(id))
      if (!row) return null
      if (row.version !== payload.expectedVersion) throw new HttpError(409, 'STATE_CONFLICT', 'Notification template was modified concurrently')
      if (deleted === Boolean(row.deletedAt)) return findTemplate(row.id, true)
      const timestamp = nowIso()
      Object.assign(row, { deletedAt: deleted ? timestamp : null, status: deleted ? 'archived' : row.activeVersionNumber ? 'published' : 'draft', version: row.version + 1, updatedAt: timestamp })
      audit(actor, deleted ? 'notification.template.deleted' : 'notification.template.restored', row, payload.reasonCode)
      return findTemplate(row.id, true)
    },
    previewTemplate: (id, versionNumber, variables) => {
      const row = templates.find((item) => item.id === String(id) && !item.deletedAt)
      if (!row) return null
      const version = versions.find((item) => item.templateId === row.id && item.versionNumber === versionNumber)
      if (!version) return null
      return { templateKey: row.key, templateVersion: version.versionNumber, ...renderNotificationTemplate(version, variables) }
    },
    metrics: () => ({
      total: templates.length,
      published: templates.filter((item) => item.status === 'published' && !item.deletedAt).length,
      drafts: templates.filter((item) => item.status === 'draft' && !item.deletedAt).length,
      archived: templates.filter((item) => Boolean(item.deletedAt)).length,
      preferenceOverrides: preferencesByUserType.size,
      disabledPreferences: [...preferencesByUserType.values()].filter((item) => !item.inAppEnabled).length,
    }),
    listPreferences: (actor) => [...preferencesByUserType.values()]
      .filter((row) => row.userId === actor.id)
      .sort((a, b) => a.notificationType.localeCompare(b.notificationType))
      .map(notificationPreferenceDto),
    setPreference: (payload, actor) => {
      const key = preferenceKey(actor.id, payload.notificationType)
      const current = preferencesByUserType.get(key)
      if (current && payload.expectedVersion !== current.version) throw new HttpError(409, 'STATE_CONFLICT', 'Notification preference was modified concurrently')
      if (!current && payload.expectedVersion != null) throw new HttpError(409, 'STATE_CONFLICT', 'Notification preference does not exist at the expected version')
      const timestamp = nowIso()
      const row = current
        ? { ...current, inAppEnabled: payload.inAppEnabled, version: current.version + 1, updatedAt: timestamp }
        : { id: `notification-preference-${randomUUID()}`, userId: actor.id, notificationType: payload.notificationType, inAppEnabled: payload.inAppEnabled, version: 1, createdAt: timestamp, updatedAt: timestamp }
      preferencesByUserType.set(key, row)
      recordAudit({ actor, action: 'notification.preference.updated', resourceType: 'notification_preference', resourceId: row.id, metadata: { notificationType: row.notificationType, inAppEnabled: row.inAppEnabled, version: row.version } })
      return notificationPreferenceDto(row)
    },
    renderPublished: (key, variables) => {
      const row = templates.find((item) => item.key === key && item.status === 'published' && !item.deletedAt)
      if (!row) return null
      const version = versions.find((item) => item.templateId === row.id && item.versionNumber === row.activeVersionNumber)
      return version ? { templateKey: row.key, templateVersion: version.versionNumber, ...renderNotificationTemplate(version, variables), version: notificationTemplateVersionDto(version) } : null
    },
    isEnabledForHandle: (handle, type) => {
      const user = getUserByHandle(handle)
      return user ? isSeedNotificationEnabled(user.id, type) : false
    },
  }
}
