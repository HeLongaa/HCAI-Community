import { HttpError } from '../common/errors/httpError.js'
import {
  notificationPreferenceDto,
  notificationTemplateDto,
  renderNotificationTemplate,
} from './notificationTemplates.js'

const conflict = () => { throw new HttpError(409, 'STATE_CONFLICT', 'Notification resource was modified concurrently') }

export const createPrismaNotificationManagementRepository = (client, { runSerializableTransaction, recordAudit }) => {
  const findTemplateRow = (db, id) => db.notificationTemplate.findUnique({
    where: { id: String(id) },
    include: { versions: { orderBy: { versionNumber: 'desc' } } },
  })

  const audit = (db, actor, action, row, reasonCode, metadata = {}) => recordAudit({
    actor,
    action,
    resourceType: 'notification_template',
    resourceId: row.id,
    metadata: { templateKey: row.key, reasonCode, version: row.version, ...metadata },
  }, db)

  return {
    listTemplates: async (query = {}) => {
      const cursor = query.cursor ? await client.notificationTemplate.findUnique({ where: { id: String(query.cursor) }, select: { id: true } }) : null
      const orderBy = [{ [query.sort]: query.order }, { id: query.order }]
      const rows = await client.notificationTemplate.findMany({
        where: {
          ...(query.includeDeleted ? {} : { deletedAt: null }),
          ...(query.status ? { status: query.status } : {}),
          ...(query.category ? { category: query.category } : {}),
          ...(query.search ? { OR: [
            { key: { contains: query.search, mode: 'insensitive' } },
            { name: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
          ] } : {}),
        },
        orderBy,
        take: query.limit + 1,
        ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
      })
      const selected = rows.slice(0, query.limit)
      return { items: selected.map(notificationTemplateDto), limit: query.limit, nextCursor: rows.length > query.limit ? selected.at(-1)?.id ?? null : null }
    },
    findTemplate: async (id, includeVersions = false) => {
      const row = includeVersions
        ? await findTemplateRow(client, id)
        : await client.notificationTemplate.findUnique({ where: { id: String(id) } })
      return row ? notificationTemplateDto(row) : null
    },
    createTemplate: (payload, actor) => runSerializableTransaction(async (transaction) => {
      const existing = await transaction.notificationTemplate.findUnique({ where: { key: payload.key }, select: { id: true } })
      if (existing) throw new HttpError(409, 'RESOURCE_CONFLICT', 'Notification template key already exists')
      const row = await transaction.notificationTemplate.create({
        data: {
          key: payload.key,
          name: payload.name,
          description: payload.description,
          category: payload.category,
          createdById: actor.id,
          versions: { create: {
            versionNumber: 1,
            locale: payload.locale,
            titleTemplate: payload.titleTemplate,
            bodyTemplate: payload.bodyTemplate,
            variableSchema: payload.variableSchema,
            createdById: actor.id,
          } },
        },
        include: { versions: true },
      })
      await audit(transaction, actor, 'notification.template.created', row, 'initial_draft', { templateVersion: 1 })
      return notificationTemplateDto(row)
    }),
    updateTemplate: (id, payload, actor) => runSerializableTransaction(async (transaction) => {
      const current = await findTemplateRow(transaction, id)
      if (!current || current.deletedAt) return null
      if (current.version !== payload.expectedVersion) conflict()
      const nextVersion = (current.versions[0]?.versionNumber ?? 0) + 1
      const updated = await transaction.notificationTemplate.update({
        where: { id: current.id, version: current.version },
        data: {
          name: payload.name,
          description: payload.description,
          category: payload.category,
          status: current.activeVersionNumber ? 'published' : 'draft',
          version: { increment: 1 },
          versions: { create: {
            versionNumber: nextVersion,
            locale: payload.locale,
            titleTemplate: payload.titleTemplate,
            bodyTemplate: payload.bodyTemplate,
            variableSchema: payload.variableSchema,
            createdById: actor.id,
          } },
        },
        include: { versions: { orderBy: { versionNumber: 'desc' } } },
      })
      await audit(transaction, actor, 'notification.template.updated', updated, 'draft_updated', { templateVersion: nextVersion })
      return notificationTemplateDto(updated)
    }),
    publishTemplate: (id, payload, actor) => runSerializableTransaction(async (transaction) => {
      const current = await findTemplateRow(transaction, id)
      if (!current || current.deletedAt) return null
      if (current.version !== payload.expectedVersion) conflict()
      const target = payload.versionNumber
        ? current.versions.find((item) => item.versionNumber === payload.versionNumber && item.status === 'draft')
        : current.versions.find((item) => item.status === 'draft')
      if (!target) throw new HttpError(409, 'NOTIFICATION_TEMPLATE_NOT_PUBLISHABLE', 'A draft version is required')
      const now = new Date()
      await transaction.notificationTemplateVersion.updateMany({ where: { templateId: current.id, status: 'published' }, data: { status: 'superseded' } })
      await transaction.notificationTemplateVersion.update({ where: { id: target.id }, data: { status: 'published', reasonCode: payload.reasonCode, publishedAt: now } })
      const updated = await transaction.notificationTemplate.update({
        where: { id: current.id, version: current.version },
        data: { status: 'published', activeVersionNumber: target.versionNumber, version: { increment: 1 } },
        include: { versions: { orderBy: { versionNumber: 'desc' } } },
      })
      await audit(transaction, actor, 'notification.template.published', updated, payload.reasonCode, { templateVersion: target.versionNumber })
      return notificationTemplateDto(updated)
    }),
    rollbackTemplate: (id, payload, actor) => runSerializableTransaction(async (transaction) => {
      const current = await findTemplateRow(transaction, id)
      if (!current || current.deletedAt) return null
      if (current.version !== payload.expectedVersion) conflict()
      const target = current.versions.find((item) => item.versionNumber === payload.versionNumber && item.publishedAt)
      if (!target) throw new HttpError(409, 'NOTIFICATION_TEMPLATE_NOT_ROLLBACKABLE', 'Only a previously published version can be restored')
      await transaction.notificationTemplateVersion.updateMany({ where: { templateId: current.id, status: 'published' }, data: { status: 'superseded' } })
      await transaction.notificationTemplateVersion.update({ where: { id: target.id }, data: { status: 'published' } })
      const updated = await transaction.notificationTemplate.update({
        where: { id: current.id, version: current.version },
        data: { status: 'published', activeVersionNumber: target.versionNumber, version: { increment: 1 } },
        include: { versions: { orderBy: { versionNumber: 'desc' } } },
      })
      await audit(transaction, actor, 'notification.template.rolled_back', updated, payload.reasonCode, { templateVersion: target.versionNumber })
      return notificationTemplateDto(updated)
    }),
    setDeleted: (id, payload, actor, deleted) => runSerializableTransaction(async (transaction) => {
      const current = await findTemplateRow(transaction, id)
      if (!current) return null
      if (current.version !== payload.expectedVersion) conflict()
      if (deleted === Boolean(current.deletedAt)) return notificationTemplateDto(current)
      const updated = await transaction.notificationTemplate.update({
        where: { id: current.id, version: current.version },
        data: {
          deletedAt: deleted ? new Date() : null,
          status: deleted ? 'archived' : current.activeVersionNumber ? 'published' : 'draft',
          version: { increment: 1 },
        },
        include: { versions: { orderBy: { versionNumber: 'desc' } } },
      })
      await audit(transaction, actor, deleted ? 'notification.template.deleted' : 'notification.template.restored', updated, payload.reasonCode)
      return notificationTemplateDto(updated)
    }),
    previewTemplate: async (id, versionNumber, variables) => {
      const row = await client.notificationTemplate.findFirst({ where: { id: String(id), deletedAt: null }, include: { versions: true } })
      if (!row) return null
      const version = row.versions.find((item) => item.versionNumber === versionNumber)
      return version ? { templateKey: row.key, templateVersion: version.versionNumber, ...renderNotificationTemplate(version, variables) } : null
    },
    metrics: async () => {
      const [total, published, drafts, archived, preferenceOverrides, disabledPreferences] = await Promise.all([
        client.notificationTemplate.count(),
        client.notificationTemplate.count({ where: { status: 'published', deletedAt: null } }),
        client.notificationTemplate.count({ where: { status: 'draft', deletedAt: null } }),
        client.notificationTemplate.count({ where: { deletedAt: { not: null } } }),
        client.notificationPreference.count(),
        client.notificationPreference.count({ where: { inAppEnabled: false } }),
      ])
      return { total, published, drafts, archived, preferenceOverrides, disabledPreferences }
    },
    listPreferences: async (actor) => (await client.notificationPreference.findMany({ where: { userId: actor.id }, orderBy: { notificationType: 'asc' } })).map(notificationPreferenceDto),
    setPreference: (payload, actor) => runSerializableTransaction(async (transaction) => {
      const current = await transaction.notificationPreference.findUnique({ where: { userId_notificationType: { userId: actor.id, notificationType: payload.notificationType } } })
      if ((current?.version ?? null) !== payload.expectedVersion) conflict()
      const row = current
        ? await transaction.notificationPreference.update({ where: { id: current.id, version: current.version }, data: { inAppEnabled: payload.inAppEnabled, version: { increment: 1 } } })
        : await transaction.notificationPreference.create({ data: { userId: actor.id, notificationType: payload.notificationType, inAppEnabled: payload.inAppEnabled } })
      await recordAudit({ actor, action: 'notification.preference.updated', resourceType: 'notification_preference', resourceId: row.id, metadata: { notificationType: row.notificationType, inAppEnabled: row.inAppEnabled, version: row.version } }, transaction)
      return notificationPreferenceDto(row)
    }),
    renderPublished: async (key, variables) => {
      const row = await client.notificationTemplate.findFirst({ where: { key, status: 'published', deletedAt: null }, include: { versions: true } })
      if (!row) return null
      const version = row.versions.find((item) => item.versionNumber === row.activeVersionNumber)
      return version ? { templateKey: row.key, templateVersion: version.versionNumber, ...renderNotificationTemplate(version, variables) } : null
    },
  }
}
