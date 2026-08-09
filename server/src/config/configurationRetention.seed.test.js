import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeedConfigResourcesRepository } from '../configResources/seedConfigResourcesRepository.js'
import { createConfigResource, publishConfigResource, rollbackConfigResource, updateConfigResource } from '../configResources/configResourceRuntime.js'
import { createSeedSystemSettingsRepository } from '../settings/seedSystemSettingsRepository.js'
import {
  approveSystemSettingChange,
  parseSystemSettingChangeRequest,
  parseSystemSettingTransition,
  publishSystemSettingChange,
  requestSystemSettingChange,
  requestSystemSettingRollback,
} from '../settings/systemSettingsRuntime.js'

const requester = { id: 'configuration-retention-a', handle: 'configuration-retention-a' }
const approver = { id: 'configuration-retention-b', handle: 'configuration-retention-b' }
const future = () => new Date(Date.now() + 367 * 86_400_000)

const publishSetting = async (repository, value, baseVersion) => {
  const requested = await requestSystemSettingChange({
    payload: parseSystemSettingChangeRequest({ key: 'jobs.worker', value, baseVersion, reasonCode: 'retention_test', note: 'sensitive operational note' }),
    actor: requester,
    repository,
  })
  const approved = await approveSystemSettingChange({ change: requested, payload: parseSystemSettingTransition({ expectedVersion: 1, reasonCode: 'approved' }), actor: approver, repository })
  return publishSystemSettingChange({ change: approved, payload: parseSystemSettingTransition({ expectedVersion: 2, reasonCode: 'published' }), actor: requester, repository })
}

test('seed system-setting retention minimizes superseded revisions and terminal changes but preserves current value', async () => {
  const repository = createSeedSystemSettingsRepository()
  const first = await publishSetting(repository, { leaseTtlSeconds: 450, renewIntervalSeconds: 90 }, 0)
  const second = await publishSetting(repository, { leaseTtlSeconds: 600, renewIntervalSeconds: 120 }, 1)
  const result = await repository.sweepRetention({ now: future(), limit: 10 })
  assert.equal(result.revisionsMinimized, 1)
  assert.equal(result.changesMinimized, 2)
  const oldRevision = await repository.findRevision(first.revision.id)
  const currentRevision = await repository.findRevision(second.revision.id)
  assert.equal(oldRevision.value, null)
  assert.equal(oldRevision.actorRef, null)
  assert.equal(JSON.stringify(oldRevision.retentionSummary).includes('leaseTtlSeconds'), false)
  assert.deepEqual(currentRevision.value, { leaseTtlSeconds: 600, renewIntervalSeconds: 120 })
  assert.deepEqual((await repository.getSetting('jobs.worker')).value, currentRevision.value)
  await assert.rejects(requestSystemSettingRollback({
    key: 'jobs.worker', revisionId: oldRevision.id, payload: { baseVersion: 2, reasonCode: 'too_old', note: '' }, actor: requester, repository,
  }), (error) => error.code === 'REVISION_REDACTED')
})

test('seed config-resource retention minimizes only superseded revisions and blocks expired rollback', async () => {
  const repository = createSeedConfigResourcesRepository()
  const created = await createConfigResource({ kind: 'feature_flag', actor: requester, repository, payload: { key: 'retention.flag', title: 'Sensitive title', description: 'Sensitive description', value: { enabled: false, payload: { tokenHint: 'secret-value' } } } })
  const first = await publishConfigResource({ resource: created, payload: { expectedVersion: 1, reasonCode: 'initial' }, actor: requester, repository })
  const updated = await updateConfigResource({ kind: 'feature_flag', resource: first.resource, payload: { expectedVersion: 2, title: 'Current title', description: 'Current description', value: { enabled: true, payload: {} } }, actor: requester, repository })
  const second = await publishConfigResource({ resource: updated, payload: { expectedVersion: 3, reasonCode: 'second' }, actor: requester, repository })
  const result = await repository.sweepRetention({ now: future(), limit: 10 })
  assert.equal(result.revisionsMinimized, 1)
  const oldRevision = await repository.findRevision(first.revision.id)
  const currentRevision = await repository.findRevision(second.revision.id)
  assert.equal(oldRevision.title, null)
  assert.equal(oldRevision.description, null)
  assert.equal(oldRevision.value, null)
  assert.equal(JSON.stringify(oldRevision.retentionSummary).includes('secret-value'), false)
  assert.equal(currentRevision.title, 'Current title')
  await assert.rejects(rollbackConfigResource({ resource: second.resource, payload: { expectedVersion: 4, revisionId: oldRevision.id, reasonCode: 'too_old' }, actor: requester, repository }), (error) => error.code === 'REVISION_REDACTED')
})
