import { randomUUID } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'
import { runtimeConfigEntries, runtimeConfigByKey } from '../config/runtimeConfigRegistry.js'
import { hashSystemSettingValue } from './systemSettingsRuntime.js'

const changeDto = (row) => row ? ({
  ...row,
  requestedAt: row.requestedAt.toISOString(), approvedAt: row.approvedAt?.toISOString() ?? null,
  rejectedAt: row.rejectedAt?.toISOString() ?? null, publishedAt: row.publishedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
}) : null
const revisionDto = (row) => row ? ({ ...row, createdAt: row.createdAt.toISOString() }) : null

export const createPrismaSystemSettingsRepository = (client, { recordAudit } = {}) => {
  const getSettingWith = async (db, key) => {
    const entry = runtimeConfigByKey[key]
    if (!entry) return null
    const row = await db.systemSetting.findUnique({ where: { key } })
    return {
      key,
      domain: entry.domain,
      scope: entry.scope,
      schema: entry.schema,
      value: row?.value ?? entry.defaultValue,
      valueSchemaVersion: row?.valueSchemaVersion ?? entry.schemaVersion,
      publishedVersion: row?.publishedVersion ?? 0,
      currentRevisionId: row?.currentRevisionId ?? null,
      source: row ? 'published' : 'default',
      applyMode: entry.applyMode ?? 'restart_required',
      updatedAt: row?.updatedAt.toISOString() ?? null,
    }
  }

  return {
    getSetting: (key) => getSettingWith(client, key),
    listSettings: async (options) => {
      const entries = runtimeConfigEntries
        .filter((entry) => !options.category || entry.domain === options.category)
        .filter((entry) => !options.search || `${entry.key} ${entry.domain}`.toLowerCase().includes(options.search.toLowerCase()))
        .sort((left, right) => left.key.localeCompare(right.key))
      const start = options.cursor ? Math.max(0, entries.findIndex((entry) => entry.key === options.cursor) + 1) : 0
      const selected = entries.slice(start, start + options.limit)
      const [settings, pending] = await Promise.all([
        client.systemSetting.findMany({ where: { key: { in: selected.map((entry) => entry.key) } } }),
        client.systemSettingChange.groupBy({
          by: ['settingKey'],
          where: { settingKey: { in: selected.map((entry) => entry.key) }, status: { in: ['pending_approval', 'approved'] } },
          _count: { _all: true },
        }),
      ])
      const settingsByKey = new Map(settings.map((row) => [row.key, row]))
      const pendingByKey = new Map(pending.map((row) => [row.settingKey, row._count._all]))
      const items = selected.map((entry) => {
        const row = settingsByKey.get(entry.key)
        return {
          key: entry.key, domain: entry.domain, scope: entry.scope, schema: entry.schema,
          value: row?.value ?? entry.defaultValue, valueSchemaVersion: row?.valueSchemaVersion ?? entry.schemaVersion,
          publishedVersion: row?.publishedVersion ?? 0, currentRevisionId: row?.currentRevisionId ?? null,
          source: row ? 'published' : 'default', updatedAt: row?.updatedAt.toISOString() ?? null,
          applyMode: entry.applyMode ?? 'restart_required',
          pendingChanges: pendingByKey.get(entry.key) ?? 0,
        }
      })
      return { items, limit: options.limit, nextCursor: start + options.limit < entries.length ? items.at(-1)?.key ?? null : null }
    },
    listChanges: async (options) => {
      const cursor = options.cursor ? await client.systemSettingChange.findUnique({ where: { id: options.cursor }, select: { id: true } }) : null
      const rows = await client.systemSettingChange.findMany({
        where: { ...(options.status ? { status: options.status } : {}), ...(options.settingKey ? { settingKey: options.settingKey } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: options.limit + 1,
        ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
      })
      const pageRows = rows.slice(0, options.limit)
      return { items: pageRows.map(changeDto), limit: options.limit, nextCursor: rows.length > options.limit ? pageRows.at(-1)?.id ?? null : null }
    },
    findChange: async (id) => changeDto(await client.systemSettingChange.findUnique({ where: { id: String(id) } })),
    createChange: async (input) => changeDto(await client.systemSettingChange.create({ data: input })),
    transitionChange: async (id, expectedVersion, data) => {
      const updated = await client.systemSettingChange.updateMany({ where: { id: String(id), version: expectedVersion }, data: { ...data, version: { increment: 1 } } })
      return updated.count ? changeDto(await client.systemSettingChange.findUnique({ where: { id: String(id) } })) : null
    },
    publishChange: async (id, expectedVersion, payload) => {
      try {
        return await client.$transaction(async (transaction) => {
          const change = await transaction.systemSettingChange.findUnique({ where: { id: String(id) } })
          if (!change || change.version !== expectedVersion || change.status !== 'approved') return null
          const current = await getSettingWith(transaction, change.settingKey)
          if (current.publishedVersion !== change.baseVersion) throw new HttpError(409, 'STATE_CONFLICT', 'setting changed after approval')
          const settingVersion = current.publishedVersion + 1
          const revision = await transaction.systemSettingRevision.create({ data: {
            id: `setting-revision-${randomUUID()}`, settingKey: change.settingKey, settingVersion,
            value: change.candidateValue, valueSchemaVersion: change.candidateValueSchemaVersion,
            previousRevisionId: current.currentRevisionId, sourceChangeId: change.id,
            eventType: change.kind === 'rollback' ? 'rolled_back' : 'published',
            contentHash: hashSystemSettingValue(change.candidateValue), actorRef: payload.actorRef,
          } })
          await transaction.systemSetting.upsert({
            where: { key: change.settingKey },
            create: { key: change.settingKey, value: change.candidateValue, valueSchemaVersion: change.candidateValueSchemaVersion, publishedVersion: settingVersion, currentRevisionId: revision.id },
            update: { value: change.candidateValue, valueSchemaVersion: change.candidateValueSchemaVersion, publishedVersion: settingVersion, currentRevisionId: revision.id },
          })
          const updated = await transaction.systemSettingChange.updateMany({
            where: { id: change.id, version: expectedVersion, status: 'approved' },
            data: { status: 'published', publishedByRef: payload.actorRef, publishedAt: new Date(), version: { increment: 1 } },
          })
          if (!updated.count) throw new HttpError(409, 'STATE_CONFLICT', 'setting change was modified concurrently')
          await recordAudit?.({
            actor: payload.actor,
            action: change.kind === 'rollback' ? 'admin.settings.rolled_back' : 'admin.settings.published',
            resourceType: 'system_setting', resourceId: change.settingKey,
            metadata: { changeId: change.id, settingVersion, contentHash: revision.contentHash, reasonCode: payload.reasonCode },
          }, transaction)
          return {
            change: changeDto(await transaction.systemSettingChange.findUnique({ where: { id: change.id } })),
            setting: await getSettingWith(transaction, change.settingKey),
            revision: revisionDto(revision),
          }
        })
      } catch (error) {
        if (['P2002', 'P2034'].includes(error?.code)) {
          throw new HttpError(409, 'STATE_CONFLICT', 'setting changed during publication')
        }
        throw error
      }
    },
    listRevisions: async (key, options) => {
      const cursor = options.cursor ? await client.systemSettingRevision.findUnique({ where: { id: options.cursor }, select: { id: true } }) : null
      const rows = await client.systemSettingRevision.findMany({
        where: { settingKey: key }, orderBy: [{ settingVersion: 'desc' }, { id: 'desc' }], take: options.limit + 1,
        ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
      })
      const pageRows = rows.slice(0, options.limit)
      return { items: pageRows.map(revisionDto), limit: options.limit, nextCursor: rows.length > options.limit ? pageRows.at(-1)?.id ?? null : null }
    },
    findRevision: async (id) => revisionDto(await client.systemSettingRevision.findUnique({ where: { id: String(id) } })),
  }
}
