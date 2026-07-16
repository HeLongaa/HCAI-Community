import { randomUUID } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'
import { hashConfigResource } from './configResourceRuntime.js'

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value))
const nowIso = () => new Date().toISOString()
const page = (items, options) => {
  const start = options.cursor ? Math.max(0, items.findIndex((item) => item.id === options.cursor) + 1) : 0
  const selected = items.slice(start, start + options.limit)
  return { items: selected.map(clone), limit: options.limit, nextCursor: start + options.limit < items.length ? selected.at(-1)?.id ?? null : null }
}
const compare = (field, order) => (left, right) => {
  const result = String(left[field] ?? '').localeCompare(String(right[field] ?? ''), undefined, { numeric: true }) || left.id.localeCompare(right.id)
  return order === 'asc' ? result : -result
}

export const createSeedConfigResourcesRepository = ({ recordAudit } = {}) => {
  const resources = new Map()
  const revisions = []
  const featureFlagOverrides = new Map()

  const get = (id) => resources.get(String(id)) ?? null
  const getDto = (id) => clone(get(id))

  return {
    list: async (kind, options) => page([...resources.values()]
      .filter((item) => item.kind === kind)
      .filter((item) => options.deleted === 'all' || (options.deleted === 'deleted' ? item.deletedAt : !item.deletedAt))
      .filter((item) => !options.search || `${item.key} ${item.title} ${item.description ?? ''}`.toLowerCase().includes(options.search.toLowerCase()))
      .sort(compare(options.sort, options.order)), options),
    findById: async (id) => getDto(id),
    findPublishedFeatureFlag: async (key) => {
      const resource = [...resources.values()].find((item) => item.kind === 'feature_flag' && item.key === String(key))
      if (!resource?.publishedValue) return null
      const override = featureFlagOverrides.get(resource.id) ?? {}
      return clone({
        resourceId: resource.id, key: resource.key, ...resource.publishedValue,
        publishedVersion: resource.publishedVersion, deletedAt: resource.deletedAt,
        emergencyOff: false, emergencyOffByRef: null, emergencyOffReasonCode: null, emergencyOffAt: null,
        ...override,
      })
    },
    setFeatureFlagEmergency: async (id, version, emergencyOff, payload) => {
      const resource = get(id)
      if (!resource || resource.kind !== 'feature_flag' || resource.deletedAt || !resource.publishedValue || resource.version !== version) return null
      const timestamp = nowIso()
      const override = emergencyOff
        ? { emergencyOff: true, emergencyOffByRef: payload.actorRef, emergencyOffReasonCode: payload.reasonCode, emergencyOffAt: timestamp }
        : { emergencyOff: false, emergencyOffByRef: null, emergencyOffReasonCode: null, emergencyOffAt: null }
      featureFlagOverrides.set(resource.id, override)
      Object.assign(resource, { updatedByRef: payload.actorRef, version: resource.version + 1, updatedAt: timestamp })
      return { resource: clone(resource), featureFlag: clone({ resourceId: resource.id, key: resource.key, ...resource.publishedValue, publishedVersion: resource.publishedVersion, deletedAt: null, ...override }) }
    },
    create: async (input) => {
      if ([...resources.values()].some((item) => item.kind === input.kind && item.key === input.key)) throw new HttpError(409, 'RESOURCE_CONFLICT', 'resource key already exists')
      const timestamp = nowIso()
      const resource = {
        ...clone(input), draftValueSchemaVersion: 1, publishedValue: null, publishedValueSchemaVersion: 1, publishedVersion: 0, currentRevisionId: null, version: 1,
        deletedByRef: null, deletedAt: null, createdAt: timestamp, updatedAt: timestamp,
      }
      resources.set(resource.id, resource)
      return clone(resource)
    },
    exportDrafts: async (kind) => [...resources.values()]
      .filter((item) => item.kind === kind && !item.deletedAt)
      .sort((left, right) => left.key.localeCompare(right.key))
      .map((item) => ({ key: item.key, title: item.title, description: item.description, value: clone(item.draftValue), expectedVersion: item.version })),
    importDrafts: async (kind, items, updatedByRef) => {
      const existing = new Map([...resources.values()].filter((item) => item.kind === kind).map((item) => [item.key, item]))
      if (items.some((item) => {
        const current = existing.get(item.key)
        return item.expectedVersion == null ? Boolean(current) : !current || current.deletedAt || current.version !== item.expectedVersion
      })) return null
      const timestamp = nowIso()
      return items.map((item) => {
        const current = existing.get(item.key)
        if (current) {
          Object.assign(current, {
            title: item.title, description: item.description, draftValue: clone(item.draftValue),
            updatedByRef, version: current.version + 1, updatedAt: timestamp,
          })
          return clone(current)
        }
        const created = {
          ...clone(item), kind, createdByRef: updatedByRef, updatedByRef,
          draftValueSchemaVersion: 1, publishedValue: null, publishedValueSchemaVersion: 1, publishedVersion: 0, currentRevisionId: null, version: 1,
          deletedByRef: null, deletedAt: null, createdAt: timestamp, updatedAt: timestamp,
        }
        delete created.expectedVersion
        resources.set(created.id, created)
        return clone(created)
      })
    },
    updateDraft: async (id, version, data) => {
      const resource = get(id)
      if (!resource || resource.deletedAt || resource.version !== version) return null
      Object.assign(resource, clone(data), { version: resource.version + 1, updatedAt: nowIso() })
      return clone(resource)
    },
    softDelete: async (id, version, deletedByRef) => {
      const resource = get(id)
      if (!resource || resource.deletedAt || resource.version !== version) return null
      Object.assign(resource, { deletedByRef, deletedAt: nowIso(), version: resource.version + 1, updatedAt: nowIso() })
      return clone(resource)
    },
    restore: async (id, version, updatedByRef) => {
      const resource = get(id)
      if (!resource || !resource.deletedAt || resource.version !== version) return null
      Object.assign(resource, { deletedByRef: null, deletedAt: null, updatedByRef, version: resource.version + 1, updatedAt: nowIso() })
      return clone(resource)
    },
    bulkSoftDelete: async (items, deletedByRef) => {
      const selected = items.map((item) => ({ item, resource: get(item.id) }))
      if (selected.some(({ item, resource }) => !resource || resource.deletedAt || resource.version !== item.expectedVersion)) return null
      const timestamp = nowIso()
      return selected.map(({ resource }) => {
        Object.assign(resource, { deletedByRef, deletedAt: timestamp, version: resource.version + 1, updatedAt: timestamp })
        return clone(resource)
      })
    },
    publish: async (id, version, payload) => {
      const resource = get(id)
      if (!resource || resource.deletedAt || resource.version !== version) return null
      const snapshot = payload.snapshot ?? { title: resource.title, description: resource.description, value: resource.draftValue }
      const timestamp = nowIso()
      const resourceVersion = resource.publishedVersion + 1
      const revision = {
        id: `config-revision-${randomUUID()}`, resourceId: resource.id, resourceVersion,
        title: snapshot.title, description: snapshot.description ?? null, value: clone(snapshot.value), valueSchemaVersion: 1,
        previousRevisionId: resource.currentRevisionId, eventType: payload.eventType,
        contentHash: hashConfigResource(snapshot), actorRef: payload.actorRef, reasonCode: payload.reasonCode, createdAt: timestamp,
      }
      revisions.unshift(revision)
      Object.assign(resource, {
        title: snapshot.title, description: snapshot.description ?? null, draftValue: clone(snapshot.value),
        publishedValue: clone(snapshot.value), publishedVersion: resourceVersion, currentRevisionId: revision.id,
        updatedByRef: payload.actorRef, version: resource.version + 1, updatedAt: timestamp,
      })
      await recordAudit?.({
        actor: payload.actor, action: `admin.config_resources.${payload.eventType}`,
        resourceType: resource.kind, resourceId: resource.id,
        metadata: { key: resource.key, resourceVersion, contentHash: revision.contentHash, reasonCode: payload.reasonCode },
      })
      return { resource: clone(resource), revision: clone(revision) }
    },
    listRevisions: async (resourceId, options) => page(revisions.filter((item) => item.resourceId === String(resourceId)), options),
    findRevision: async (id) => clone(revisions.find((item) => item.id === String(id)) ?? null),
  }
}
