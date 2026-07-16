import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createConfigResource,
  deleteConfigResource,
  evaluateFeatureFlag,
  parseConfigResourceListQuery,
  publishConfigResource,
  restoreConfigResource,
  rollbackConfigResource,
  updateConfigResource,
  validateConfigResourceValue,
} from './configResourceRuntime.js'
import { createSeedConfigResourcesRepository } from './seedConfigResourcesRepository.js'

const actor = { id: 'admin-1', handle: 'admin-one' }

test('resource schemas reject cross-domain and unsafe values', () => {
  assert.deepEqual(validateConfigResourceValue('feature_flag', { enabled: false, payload: { color: 'green' } }), {
    enabled: false, payload: { color: 'green' }, rules: [], rolloutPercentage: null, rolloutSeed: 'v1',
  })
  assert.throws(() => validateConfigResourceValue('feature_flag', { enabled: true, rollout: 50 }), /unsupported fields/)
  assert.throws(() => validateConfigResourceValue('feature_flag', { enabled: true, rolloutPercentage: 101 }), /between 0 and 100/)
  assert.throws(() => validateConfigResourceValue('feature_flag', {
    enabled: true,
    rules: [{ id: 'duplicate', type: 'role', values: ['admin'], enabled: true }, { id: 'duplicate', type: 'user', values: ['user-1'], enabled: false }],
  }), /duplicate ids/)
  assert.deepEqual(validateConfigResourceValue('reference_data', { label: 'China', value: 'CN', sortOrder: 1 }), { label: 'China', value: 'CN', sortOrder: 1, active: true })
  assert.throws(() => validateConfigResourceValue('announcement', { body: 'Maintenance', level: 'urgent' }), /value.level/)
  assert.throws(() => validateConfigResourceValue('announcement', {
    body: 'Maintenance', level: 'warning', startsAt: '2026-07-17T10:00:00Z', endsAt: '2026-07-17T09:00:00Z',
  }), /must be after/)
})

test('feature flag evaluation has fixed priority, stable rollout, and emergency override', () => {
  const value = validateConfigResourceValue('feature_flag', {
    enabled: false,
    payload: { variant: 'default' },
    rules: [
      { id: 'environment-on', type: 'environment', values: ['staging'], enabled: true },
      { id: 'role-on', type: 'role', values: ['admin'], enabled: true, payload: { variant: 'admin' } },
      { id: 'user-off', type: 'user', values: ['user-1'], enabled: false },
    ],
    rolloutPercentage: 50,
    rolloutSeed: 'launch-v1',
  })
  const context = { environment: 'staging', userId: 'user-1', roles: ['admin'] }
  assert.deepEqual(evaluateFeatureFlag({ key: 'editor.v2', value, context }), {
    enabled: false, payload: { variant: 'default' }, reason: 'user_rule', ruleId: 'user-off',
  })
  assert.equal(evaluateFeatureFlag({ key: 'editor.v2', value, emergencyOff: true, context }).reason, 'emergency_off')

  const percentageValue = { ...value, rules: [] }
  const first = evaluateFeatureFlag({ key: 'editor.v2', value: percentageValue, context })
  assert.deepEqual(evaluateFeatureFlag({ key: 'editor.v2', value: percentageValue, context }), first)
  assert.equal(evaluateFeatureFlag({ key: 'editor.v2', value: { ...percentageValue, rolloutPercentage: 0 }, context }).enabled, false)
  assert.equal(evaluateFeatureFlag({ key: 'editor.v2', value: { ...percentageValue, rolloutPercentage: 100 }, context }).enabled, true)
})

test('list query bounds filters and sorting', () => {
  assert.deepEqual(parseConfigResourceListQuery({ limit: '50', deleted: 'all', sort: 'key', order: 'asc' }), {
    search: null, deleted: 'all', sort: 'key', order: 'asc', cursor: null, limit: 50,
  })
  assert.throws(() => parseConfigResourceListQuery({ limit: 101 }), /between 1 and 100/)
  assert.throws(() => parseConfigResourceListQuery({ sort: 'createdByRef' }), /sort must be/)
})

test('draft, publish, rollback, soft-delete, and restore preserve versions', async () => {
  const audit = []
  const repository = createSeedConfigResourcesRepository({ recordAudit: (event) => audit.push(event) })
  const created = await createConfigResource({
    kind: 'feature_flag', actor, repository,
    payload: { key: 'workspace.new-editor', title: 'New editor', value: { enabled: false, payload: {} } },
  })
  assert.equal(created.version, 1)
  const firstPublish = await publishConfigResource({ resource: created, payload: { expectedVersion: 1, reasonCode: 'initial_release' }, actor, repository })
  assert.equal(firstPublish.resource.publishedVersion, 1)
  assert.equal(firstPublish.resource.version, 2)

  const updated = await updateConfigResource({
    kind: 'feature_flag', resource: firstPublish.resource, actor, repository,
    payload: { expectedVersion: 2, title: 'New editor', value: { enabled: true, payload: { variant: 'v2' } } },
  })
  const secondPublish = await publishConfigResource({ resource: updated, payload: { expectedVersion: 3, reasonCode: 'enable_v2' }, actor, repository })
  assert.equal(secondPublish.resource.publishedVersion, 2)
  assert.equal(secondPublish.resource.publishedValue.enabled, true)

  const rolledBack = await rollbackConfigResource({
    resource: secondPublish.resource, actor, repository,
    payload: { expectedVersion: 4, revisionId: firstPublish.revision.id, reasonCode: 'restore_v1' },
  })
  assert.equal(rolledBack.resource.publishedVersion, 3)
  assert.equal(rolledBack.resource.publishedValue.enabled, false)
  assert.equal(rolledBack.revision.eventType, 'rolled_back')

  const deleted = await deleteConfigResource({ resource: rolledBack.resource, payload: { expectedVersion: 5, reasonCode: 'retired' }, actor, repository })
  assert.ok(deleted.deletedAt)
  await assert.rejects(() => publishConfigResource({ resource: deleted, payload: { expectedVersion: 6, reasonCode: 'invalid' }, actor, repository }), /resource is deleted/)
  const restored = await restoreConfigResource({ resource: deleted, payload: { expectedVersion: 6, reasonCode: 'needed_again' }, actor, repository })
  assert.equal(restored.deletedAt, null)
  assert.equal(restored.version, 7)
  assert.deepEqual(audit.map((event) => event.action), [
    'admin.config_resources.published', 'admin.config_resources.published', 'admin.config_resources.rolled_back',
  ])
})
