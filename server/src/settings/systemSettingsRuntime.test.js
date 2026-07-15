import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeedSystemSettingsRepository } from './seedSystemSettingsRepository.js'
import {
  approveSystemSettingChange,
  buildSystemSettingPreview,
  parseSystemSettingChangeRequest,
  parseSystemSettingListQuery,
  parseSystemSettingTransition,
  publishSystemSettingChange,
  requestSystemSettingChange,
} from './systemSettingsRuntime.js'

const requester = { id: 'admin-a', handle: 'admin-a' }
const approver = { id: 'admin-b', handle: 'admin-b' }

const changePayload = (value, baseVersion = 0) => parseSystemSettingChangeRequest({
  key: 'jobs.worker',
  value,
  baseVersion,
  reasonCode: 'capacity_tuning',
  note: 'Keep worker leases stable.',
})

test('settings preview is deterministic and validates cross-field constraints', () => {
  const currentValue = { leaseTtlSeconds: 300, renewIntervalSeconds: 60 }
  const candidateValue = { renewIntervalSeconds: 90, leaseTtlSeconds: 450 }
  const preview = buildSystemSettingPreview({
    key: 'jobs.worker',
    currentValue,
    currentVersion: 3,
    candidateValue,
  })
  assert.equal(preview.baseVersion, 3)
  assert.deepEqual(preview.diff.changes.map((change) => change.path), ['leaseTtlSeconds', 'renewIntervalSeconds'])
  assert.equal(preview.contentHash.length, 64)
  assert.throws(
    () => buildSystemSettingPreview({
      key: 'jobs.worker',
      currentValue,
      currentVersion: 3,
      candidateValue: { leaseTtlSeconds: 60, renewIntervalSeconds: 60 },
    }),
    /must be less than leaseTtlSeconds/,
  )
})

test('settings list and transition parsers enforce bounded pagination and versions', () => {
  assert.equal(parseSystemSettingListQuery({ limit: '100' }).limit, 100)
  assert.throws(() => parseSystemSettingListQuery({ limit: '101' }), /between 1 and 100/)
  assert.equal(parseSystemSettingTransition({ expectedVersion: 2, reasonCode: 'reviewed' }).expectedVersion, 2)
  assert.throws(() => parseSystemSettingTransition({ expectedVersion: 0, reasonCode: 'reviewed' }), /positive integer/)
})

test('settings publication requires an independent approver and records the publisher', async () => {
  const audits = []
  const repository = createSeedSystemSettingsRepository({ recordAudit: (event) => audits.push(event) })
  const requested = await requestSystemSettingChange({
    payload: changePayload({ leaseTtlSeconds: 450, renewIntervalSeconds: 90 }),
    actor: requester,
    repository,
  })

  await assert.rejects(
    approveSystemSettingChange({
      change: requested,
      payload: parseSystemSettingTransition({ expectedVersion: 1, reasonCode: 'self_review' }),
      actor: requester,
      repository,
    }),
    /different approver/,
  )

  const approved = await approveSystemSettingChange({
    change: requested,
    payload: parseSystemSettingTransition({ expectedVersion: 1, reasonCode: 'review_passed' }),
    actor: approver,
    repository,
  })
  const published = await publishSystemSettingChange({
    change: approved,
    payload: parseSystemSettingTransition({ expectedVersion: 2, reasonCode: 'publish' }),
    actor: requester,
    repository,
  })
  assert.equal(published.change.status, 'published')
  assert.equal(published.setting.publishedVersion, 1)
  assert.equal(published.revision.previousRevisionId, null)
  assert.equal(audits.at(-1).action, 'admin.settings.published')
})

test('settings publication rejects stale base versions after a concurrent publish', async () => {
  const repository = createSeedSystemSettingsRepository()
  const first = await requestSystemSettingChange({
    payload: changePayload({ leaseTtlSeconds: 450, renewIntervalSeconds: 90 }),
    actor: requester,
    repository,
  })
  const second = await requestSystemSettingChange({
    payload: changePayload({ leaseTtlSeconds: 600, renewIntervalSeconds: 120 }),
    actor: { id: 'admin-d', handle: 'admin-d' },
    repository,
  })
  const firstApproved = await approveSystemSettingChange({
    change: first,
    payload: parseSystemSettingTransition({ expectedVersion: 1, reasonCode: 'review_passed' }),
    actor: approver,
    repository,
  })
  const secondApproved = await approveSystemSettingChange({
    change: second,
    payload: parseSystemSettingTransition({ expectedVersion: 1, reasonCode: 'review_passed' }),
    actor: approver,
    repository,
  })
  await publishSystemSettingChange({
    change: firstApproved,
    payload: parseSystemSettingTransition({ expectedVersion: 2, reasonCode: 'publish' }),
    actor: requester,
    repository,
  })
  await assert.rejects(
    publishSystemSettingChange({
      change: secondApproved,
      payload: parseSystemSettingTransition({ expectedVersion: 2, reasonCode: 'publish' }),
      actor: { id: 'admin-d', handle: 'admin-d' },
      repository,
    }),
    /setting changed after approval/,
  )
})
