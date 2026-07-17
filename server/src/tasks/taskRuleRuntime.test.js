import assert from 'node:assert/strict'
import test from 'node:test'

import { applyPublishedTaskRule } from './taskRuleRuntime.js'

const now = new Date('2026-07-17T00:00:00.000Z')
const rule = {
  key: 'task.video', category: 'Video', active: true, publishedVersion: 3,
  acceptanceTemplates: [{ id: 'delivery', label: 'Delivery', body: 'Submit MP4 and rights summary.' }],
  minimumDeadlineHours: 24, defaultDeadlineHours: 72, maximumDeadlineHours: 720, deadlineRequired: true,
}
const repository = {
  listPublishedTaskRules: async () => [rule],
  findPublishedTaskRule: async (category) => category.toLowerCase() === 'video' ? rule : null,
}
const payload = { category: 'Video', acceptanceRules: 'Custom rules', deadlineAt: null, acceptanceTemplateId: null }

test('published task rules apply defaults and immutable template versions', async () => {
  const governed = await applyPublishedTaskRule({ payload: { ...payload, acceptanceTemplateId: 'delivery' }, repository, now })
  assert.equal(governed.deadlineAt, '2026-07-20T00:00:00.000Z')
  assert.equal(governed.acceptanceRules, 'Submit MP4 and rights summary.')
  assert.deepEqual(governed.taskRule, { key: 'task.video', publishedVersion: 3, acceptanceTemplateId: 'delivery' })
})

test('published task rules reject disabled categories templates and deadline ranges', async () => {
  await assert.rejects(() => applyPublishedTaskRule({ payload, repository: { findPublishedTaskRule: async () => ({ ...rule, active: false }) }, now }), (error) => error.code === 'TASK_CATEGORY_UNAVAILABLE')
  await assert.rejects(() => applyPublishedTaskRule({ payload: { ...payload, acceptanceTemplateId: 'missing' }, repository, now }), (error) => error.code === 'TASK_ACCEPTANCE_TEMPLATE_INVALID')
  await assert.rejects(() => applyPublishedTaskRule({ payload: { ...payload, deadlineAt: '2026-07-17T01:00:00.000Z' }, repository, now }), (error) => error.code === 'TASK_DEADLINE_OUT_OF_RANGE')
})

test('task creation remains compatible for categories without a published rule', async () => {
  const governed = await applyPublishedTaskRule({ payload, repository: { findPublishedTaskRule: async () => null }, now })
  assert.deepEqual(governed, { ...payload, taskRule: null })
})
