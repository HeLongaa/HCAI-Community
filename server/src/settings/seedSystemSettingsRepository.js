import { randomUUID } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'
import { runtimeConfigEntries, runtimeConfigByKey } from '../config/runtimeConfigRegistry.js'
import { hashSystemSettingValue } from './systemSettingsRuntime.js'

const nowIso = () => new Date().toISOString()
const clone = (value) => JSON.parse(JSON.stringify(value))
const page = (items, options) => {
  const start = options.cursor ? Math.max(0, items.findIndex((item) => item.id === options.cursor || item.key === options.cursor) + 1) : 0
  const rows = items.slice(start, start + options.limit)
  return { items: rows, limit: options.limit, nextCursor: start + options.limit < items.length ? rows.at(-1)?.id ?? rows.at(-1)?.key ?? null : null }
}

export const createSeedSystemSettingsRepository = ({ recordAudit } = {}) => {
  const settings = new Map()
  const changes = []
  const revisions = []

  const getSetting = async (key) => {
    const entry = runtimeConfigByKey[key]
    if (!entry) return null
    const current = settings.get(key)
    return {
      key,
      domain: entry.domain,
      scope: entry.scope,
      schema: entry.schema,
      value: clone(current?.value ?? entry.defaultValue),
      valueSchemaVersion: current?.valueSchemaVersion ?? entry.schemaVersion,
      publishedVersion: current?.publishedVersion ?? 0,
      currentRevisionId: current?.currentRevisionId ?? null,
      source: current ? 'published' : 'default',
      applyMode: entry.applyMode ?? 'restart_required',
      updatedAt: current?.updatedAt ?? null,
    }
  }

  return {
    getSetting,
    listSettings: async (options) => {
      const rows = await Promise.all(runtimeConfigEntries
        .filter((entry) => !options.category || entry.domain === options.category)
        .filter((entry) => !options.search || `${entry.key} ${entry.domain}`.toLowerCase().includes(options.search.toLowerCase()))
        .sort((left, right) => left.key.localeCompare(right.key))
        .map(async (entry) => ({
          ...await getSetting(entry.key),
          pendingChanges: changes.filter((item) => item.settingKey === entry.key && ['pending_approval', 'approved'].includes(item.status)).length,
        })))
      return page(rows, options)
    },
    listChanges: async (options) => page(changes
      .filter((item) => !options.status || item.status === options.status)
      .filter((item) => !options.settingKey || item.settingKey === options.settingKey)
      .map((item) => clone(item)), options),
    findChange: async (id) => clone(changes.find((item) => item.id === String(id)) ?? null),
    createChange: async (input) => {
      const timestamp = nowIso()
      const change = { ...clone(input), version: 1, requestedAt: timestamp, approvedAt: null, rejectedAt: null, publishedAt: null, approvedByRef: null, rejectedByRef: null, publishedByRef: null, createdAt: timestamp, updatedAt: timestamp }
      changes.unshift(change)
      return clone(change)
    },
    transitionChange: async (id, expectedVersion, data) => {
      const change = changes.find((item) => item.id === String(id))
      if (!change || change.version !== expectedVersion) return null
      Object.assign(change, clone(data), { version: change.version + 1, updatedAt: nowIso() })
      return clone(change)
    },
    publishChange: async (id, expectedVersion, payload) => {
      const change = changes.find((item) => item.id === String(id))
      if (!change || change.version !== expectedVersion || change.status !== 'approved') return null
      const current = await getSetting(change.settingKey)
      if (current.publishedVersion !== change.baseVersion) throw new HttpError(409, 'STATE_CONFLICT', 'setting changed after approval')
      const timestamp = nowIso()
      const settingVersion = current.publishedVersion + 1
      const revision = {
        id: `setting-revision-${randomUUID()}`,
        settingKey: change.settingKey,
        settingVersion,
        value: clone(change.candidateValue),
        valueSchemaVersion: change.candidateValueSchemaVersion,
        previousRevisionId: current.currentRevisionId,
        sourceChangeId: change.id,
        eventType: change.kind === 'rollback' ? 'rolled_back' : 'published',
        contentHash: hashSystemSettingValue(change.candidateValue),
        actorRef: payload.actorRef,
        createdAt: timestamp,
      }
      revisions.unshift(revision)
      settings.set(change.settingKey, {
        value: clone(change.candidateValue), valueSchemaVersion: change.candidateValueSchemaVersion,
        publishedVersion: settingVersion, currentRevisionId: revision.id, updatedAt: timestamp,
      })
      Object.assign(change, { status: 'published', publishedByRef: payload.actorRef, publishedAt: timestamp, version: change.version + 1, updatedAt: timestamp })
      recordAudit?.({ actor: payload.actor, action: change.kind === 'rollback' ? 'admin.settings.rolled_back' : 'admin.settings.published', resourceType: 'system_setting', resourceId: change.settingKey, metadata: { changeId: change.id, settingVersion, contentHash: revision.contentHash, reasonCode: payload.reasonCode } })
      return { change: clone(change), setting: await getSetting(change.settingKey), revision: clone(revision) }
    },
    listRevisions: async (key, options) => page(revisions.filter((item) => item.settingKey === key).map((item) => clone(item)), options),
    findRevision: async (id) => clone(revisions.find((item) => item.id === String(id)) ?? null),
  }
}
