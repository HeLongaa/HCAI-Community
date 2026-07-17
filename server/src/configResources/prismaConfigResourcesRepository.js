import { randomUUID } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'
import { hashConfigResource } from './configResourceRuntime.js'

const resourceDto = (row) => row ? ({
  ...row,
  deletedAt: row.deletedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
}) : null
const revisionDto = (row) => row ? ({ ...row, createdAt: row.createdAt.toISOString() }) : null
const featureFlagDto = (row) => row ? ({
  ...row,
  emergencyOffAt: row.emergencyOffAt?.toISOString() ?? null,
  deletedAt: row.deletedAt?.toISOString() ?? null,
  updatedAt: row.updatedAt.toISOString(),
}) : null
const taskRuleDto = (row) => row ? ({
  ...row,
  deletedAt: row.deletedAt?.toISOString() ?? null,
  updatedAt: row.updatedAt.toISOString(),
}) : null

export const createPrismaConfigResourcesRepository = (client, { recordAudit } = {}) => ({
  list: async (kind, options) => {
    const deletedAt = options.deleted === 'all' ? undefined : options.deleted === 'deleted' ? { not: null } : null
    const cursor = options.cursor ? await client.configResource.findUnique({ where: { id: options.cursor }, select: { id: true } }) : null
    const rows = await client.configResource.findMany({
      where: {
        kind,
        ...(deletedAt !== undefined ? { deletedAt } : {}),
        ...(options.search ? { OR: [
          { key: { contains: options.search, mode: 'insensitive' } },
          { title: { contains: options.search, mode: 'insensitive' } },
          { description: { contains: options.search, mode: 'insensitive' } },
        ] } : {}),
      },
      orderBy: [{ [options.sort]: options.order }, { id: options.order }],
      take: options.limit + 1,
      ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
    })
    const selected = rows.slice(0, options.limit)
    return { items: selected.map(resourceDto), limit: options.limit, nextCursor: rows.length > options.limit ? selected.at(-1)?.id ?? null : null }
  },
  findById: async (id) => resourceDto(await client.configResource.findUnique({ where: { id: String(id) } })),
  findPublishedFeatureFlag: async (key) => featureFlagDto(await client.featureFlag.findUnique({ where: { key: String(key) } })),
  listPublishedTaskRules: async () => (await client.taskRule.findMany({
    where: { deletedAt: null, active: true }, orderBy: [{ category: 'asc' }, { key: 'asc' }], take: 100,
  })).map(taskRuleDto),
  findPublishedTaskRule: async (category) => taskRuleDto(await client.taskRule.findFirst({
    where: { category: { equals: String(category), mode: 'insensitive' }, deletedAt: null },
  })),
  setFeatureFlagEmergency: async (id, version, emergencyOff, payload) => client.$transaction(async (transaction) => {
    const resource = await transaction.configResource.findUnique({ where: { id: String(id) } })
    if (!resource || resource.kind !== 'feature_flag' || resource.deletedAt || resource.version !== version) return null
    const flag = await transaction.featureFlag.findUnique({ where: { resourceId: resource.id } })
    if (!flag || flag.deletedAt) return null
    const timestamp = new Date()
    const updated = await transaction.configResource.updateMany({
      where: { id: resource.id, version, deletedAt: null },
      data: { updatedByRef: payload.actorRef, version: { increment: 1 } },
    })
    if (!updated.count) throw new HttpError(409, 'STATE_CONFLICT', 'feature flag changed during emergency override')
    const featureFlag = await transaction.featureFlag.update({
      where: { resourceId: resource.id },
      data: emergencyOff
        ? { emergencyOff: true, emergencyOffByRef: payload.actorRef, emergencyOffReasonCode: payload.reasonCode, emergencyOffAt: timestamp }
        : { emergencyOff: false, emergencyOffByRef: null, emergencyOffReasonCode: null, emergencyOffAt: null },
    })
    return {
      resource: resourceDto(await transaction.configResource.findUnique({ where: { id: resource.id } })),
      featureFlag: featureFlagDto(featureFlag),
    }
  }),
  create: async (input) => {
    try {
      return resourceDto(await client.configResource.create({ data: input }))
    } catch (error) {
      if (error?.code === 'P2002') throw new HttpError(409, 'RESOURCE_CONFLICT', 'resource key already exists')
      throw error
    }
  },
  exportDrafts: async (kind) => (await client.configResource.findMany({
    where: { kind, deletedAt: null }, orderBy: [{ key: 'asc' }], take: 1000,
  })).map((row) => ({ key: row.key, title: row.title, description: row.description, value: row.draftValue, expectedVersion: row.version })),
  importDrafts: async (kind, items, updatedByRef) => {
    try {
      return await client.$transaction(async (transaction) => {
        const rows = await transaction.configResource.findMany({ where: { kind, key: { in: items.map((item) => item.key) } } })
        const existing = new Map(rows.map((row) => [row.key, row]))
        if (items.some((item) => {
          const current = existing.get(item.key)
          return item.expectedVersion == null ? Boolean(current) : !current || current.deletedAt || current.version !== item.expectedVersion
        })) return null
        const results = []
        for (const item of items) {
          const current = existing.get(item.key)
          if (current) {
            const updated = await transaction.configResource.updateMany({
              where: { id: current.id, version: item.expectedVersion, deletedAt: null },
              data: { title: item.title, description: item.description, draftValue: item.draftValue, draftValueSchemaVersion: 1, updatedByRef, version: { increment: 1 } },
            })
            if (!updated.count) throw new HttpError(409, 'STATE_CONFLICT', 'resource changed during import')
            results.push(resourceDto(await transaction.configResource.findUnique({ where: { id: current.id } })))
          } else {
            results.push(resourceDto(await transaction.configResource.create({ data: {
              id: item.id, kind, key: item.key, title: item.title, description: item.description,
              draftValue: item.draftValue, createdByRef: updatedByRef, updatedByRef,
            } })))
          }
        }
        return results
      })
    } catch (error) {
      if (['P2002', 'P2034'].includes(error?.code)) throw new HttpError(409, 'STATE_CONFLICT', 'resources changed during import')
      throw error
    }
  },
  updateDraft: async (id, version, data) => {
    const updated = await client.configResource.updateMany({
      where: { id: String(id), version, deletedAt: null }, data: { ...data, draftValueSchemaVersion: 1, version: { increment: 1 } },
    })
    return updated.count ? resourceDto(await client.configResource.findUnique({ where: { id: String(id) } })) : null
  },
  softDelete: async (id, version, deletedByRef) => client.$transaction(async (transaction) => {
    const deletedAt = new Date()
    const updated = await transaction.configResource.updateMany({
      where: { id: String(id), version, deletedAt: null },
      data: { deletedAt, deletedByRef, version: { increment: 1 } },
    })
    if (!updated.count) return null
    await Promise.all([
      transaction.featureFlag.updateMany({ where: { resourceId: String(id) }, data: { deletedAt } }),
      transaction.referenceDataEntry.updateMany({ where: { resourceId: String(id) }, data: { deletedAt } }),
      transaction.announcement.updateMany({ where: { resourceId: String(id) }, data: { deletedAt } }),
      transaction.taskRule.updateMany({ where: { resourceId: String(id) }, data: { deletedAt } }),
    ])
    return resourceDto(await transaction.configResource.findUnique({ where: { id: String(id) } }))
  }),
  restore: async (id, version, updatedByRef) => client.$transaction(async (transaction) => {
    const updated = await transaction.configResource.updateMany({
      where: { id: String(id), version, deletedAt: { not: null } },
      data: { deletedAt: null, deletedByRef: null, updatedByRef, version: { increment: 1 } },
    })
    if (!updated.count) return null
    await Promise.all([
      transaction.featureFlag.updateMany({ where: { resourceId: String(id) }, data: { deletedAt: null } }),
      transaction.referenceDataEntry.updateMany({ where: { resourceId: String(id) }, data: { deletedAt: null } }),
      transaction.announcement.updateMany({ where: { resourceId: String(id) }, data: { deletedAt: null } }),
      transaction.taskRule.updateMany({ where: { resourceId: String(id) }, data: { deletedAt: null } }),
    ])
    return resourceDto(await transaction.configResource.findUnique({ where: { id: String(id) } }))
  }),
  bulkSoftDelete: async (items, deletedByRef) => client.$transaction(async (transaction) => {
    const rows = await transaction.configResource.findMany({ where: { id: { in: items.map((item) => item.id) } } })
    const byId = new Map(rows.map((row) => [row.id, row]))
    if (items.some((item) => {
      const row = byId.get(item.id)
      return !row || row.deletedAt || row.version !== item.expectedVersion
    })) return null
    const deletedAt = new Date()
    for (const item of items) {
      const updated = await transaction.configResource.updateMany({
        where: { id: item.id, version: item.expectedVersion, deletedAt: null },
        data: { deletedAt, deletedByRef, version: { increment: 1 } },
      })
      if (!updated.count) throw new HttpError(409, 'STATE_CONFLICT', 'resource changed during bulk deletion')
    }
    const ids = items.map((item) => item.id)
    await Promise.all([
      transaction.featureFlag.updateMany({ where: { resourceId: { in: ids } }, data: { deletedAt } }),
      transaction.referenceDataEntry.updateMany({ where: { resourceId: { in: ids } }, data: { deletedAt } }),
      transaction.announcement.updateMany({ where: { resourceId: { in: ids } }, data: { deletedAt } }),
      transaction.taskRule.updateMany({ where: { resourceId: { in: ids } }, data: { deletedAt } }),
    ])
    const updatedRows = await transaction.configResource.findMany({ where: { id: { in: items.map((item) => item.id) } } })
    return updatedRows.map(resourceDto)
  }),
  publish: async (id, version, payload) => {
    try {
      return await client.$transaction(async (transaction) => {
        const resource = await transaction.configResource.findUnique({ where: { id: String(id) } })
        if (!resource || resource.deletedAt || resource.version !== version) return null
        const snapshot = payload.snapshot ?? { title: resource.title, description: resource.description, value: resource.draftValue }
        const resourceVersion = resource.publishedVersion + 1
        const revision = await transaction.configResourceRevision.create({ data: {
          id: `config-revision-${randomUUID()}`, resourceId: resource.id, resourceVersion,
          title: snapshot.title, description: snapshot.description ?? null, value: snapshot.value, valueSchemaVersion: 1,
          previousRevisionId: resource.currentRevisionId, eventType: payload.eventType,
          contentHash: hashConfigResource(snapshot), actorRef: payload.actorRef, reasonCode: payload.reasonCode,
        } })
        const updated = await transaction.configResource.updateMany({
          where: { id: resource.id, version, deletedAt: null },
          data: {
            title: snapshot.title, description: snapshot.description ?? null,
            draftValue: snapshot.value, draftValueSchemaVersion: 1, publishedValue: snapshot.value, publishedValueSchemaVersion: 1,
            publishedVersion: resourceVersion, currentRevisionId: revision.id,
            updatedByRef: payload.actorRef, version: { increment: 1 },
          },
        })
        if (!updated.count) throw new HttpError(409, 'STATE_CONFLICT', 'resource changed during publication')
        if (resource.kind === 'feature_flag') {
          await transaction.featureFlag.upsert({
            where: { resourceId: resource.id },
            create: {
              resourceId: resource.id, key: resource.key, enabled: snapshot.value.enabled, payload: snapshot.value.payload,
              rules: snapshot.value.rules, rulesSchemaVersion: 1, rolloutPercentage: snapshot.value.rolloutPercentage, rolloutSeed: snapshot.value.rolloutSeed,
              payloadSchemaVersion: 1, publishedVersion: resourceVersion,
            },
            update: {
              enabled: snapshot.value.enabled, payload: snapshot.value.payload, rules: snapshot.value.rules, rulesSchemaVersion: 1,
              rolloutPercentage: snapshot.value.rolloutPercentage, rolloutSeed: snapshot.value.rolloutSeed,
              payloadSchemaVersion: 1, publishedVersion: resourceVersion, deletedAt: null,
            },
          })
        } else if (resource.kind === 'reference_data') {
          await transaction.referenceDataEntry.upsert({
            where: { resourceId: resource.id },
            create: {
              resourceId: resource.id, key: resource.key, label: snapshot.value.label, value: snapshot.value.value, valueSchemaVersion: 1,
              sortOrder: snapshot.value.sortOrder, active: snapshot.value.active, publishedVersion: resourceVersion,
            },
            update: {
              label: snapshot.value.label, value: snapshot.value.value, valueSchemaVersion: 1, sortOrder: snapshot.value.sortOrder,
              active: snapshot.value.active, publishedVersion: resourceVersion, deletedAt: null,
            },
          })
        } else if (resource.kind === 'announcement') {
          await transaction.announcement.upsert({
            where: { resourceId: resource.id },
            create: {
              resourceId: resource.id, key: resource.key, title: snapshot.title, body: snapshot.value.body,
              level: snapshot.value.level, startsAt: snapshot.value.startsAt ? new Date(snapshot.value.startsAt) : null,
              endsAt: snapshot.value.endsAt ? new Date(snapshot.value.endsAt) : null,
              active: snapshot.value.active, publishedVersion: resourceVersion, deletedAt: null,
            },
            update: {
              title: snapshot.title, body: snapshot.value.body, level: snapshot.value.level,
              startsAt: snapshot.value.startsAt ? new Date(snapshot.value.startsAt) : null,
              endsAt: snapshot.value.endsAt ? new Date(snapshot.value.endsAt) : null,
              active: snapshot.value.active, publishedVersion: resourceVersion, deletedAt: null,
            },
          })
        } else {
          await transaction.taskRule.upsert({
            where: { resourceId: resource.id },
            create: {
              resourceId: resource.id, key: resource.key, category: snapshot.value.category,
              acceptanceTemplates: snapshot.value.acceptanceTemplates,
              acceptanceTemplatesSchemaVersion: 1,
              defaultDeadlineHours: snapshot.value.defaultDeadlineHours,
              minimumDeadlineHours: snapshot.value.minimumDeadlineHours,
              maximumDeadlineHours: snapshot.value.maximumDeadlineHours,
              deadlineRequired: snapshot.value.deadlineRequired, active: snapshot.value.active,
              publishedVersion: resourceVersion,
            },
            update: {
              category: snapshot.value.category, acceptanceTemplates: snapshot.value.acceptanceTemplates, acceptanceTemplatesSchemaVersion: 1,
              defaultDeadlineHours: snapshot.value.defaultDeadlineHours,
              minimumDeadlineHours: snapshot.value.minimumDeadlineHours,
              maximumDeadlineHours: snapshot.value.maximumDeadlineHours,
              deadlineRequired: snapshot.value.deadlineRequired, active: snapshot.value.active,
              publishedVersion: resourceVersion, deletedAt: null,
            },
          })
        }
        await recordAudit?.({
          actor: payload.actor, action: `admin.config_resources.${payload.eventType}`,
          resourceType: resource.kind, resourceId: resource.id,
          metadata: { key: resource.key, resourceVersion, contentHash: revision.contentHash, reasonCode: payload.reasonCode },
        }, transaction)
        return {
          resource: resourceDto(await transaction.configResource.findUnique({ where: { id: resource.id } })),
          revision: revisionDto(revision),
        }
      })
    } catch (error) {
      if (['P2002', 'P2034'].includes(error?.code)) throw new HttpError(409, 'STATE_CONFLICT', 'resource changed during publication')
      throw error
    }
  },
  listRevisions: async (resourceId, options) => {
    const cursor = options.cursor ? await client.configResourceRevision.findUnique({ where: { id: options.cursor }, select: { id: true } }) : null
    const rows = await client.configResourceRevision.findMany({
      where: { resourceId: String(resourceId) }, orderBy: [{ resourceVersion: 'desc' }, { id: 'desc' }], take: options.limit + 1,
      ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
    })
    const selected = rows.slice(0, options.limit)
    return { items: selected.map(revisionDto), limit: options.limit, nextCursor: rows.length > options.limit ? selected.at(-1)?.id ?? null : null }
  },
  findRevision: async (id) => revisionDto(await client.configResourceRevision.findUnique({ where: { id: String(id) } })),
})
