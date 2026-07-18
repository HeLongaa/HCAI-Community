import assert from 'node:assert/strict'
import test from 'node:test'

import { HttpError } from '../common/errors/httpError.js'
import { parseCreateNotificationTemplate, renderNotificationTemplate } from './notificationTemplates.js'

test('notification templates enforce a closed variable schema and render typed variables', () => {
  const parsed = parseCreateNotificationTemplate({
    key: 'task.assignment_ready',
    name: 'Assignment ready',
    category: 'task',
    titleTemplate: 'Ready: {{taskTitle}}',
    bodyTemplate: '{{actor}} assigned {{taskTitle}} with {{points}} points.',
    variableSchema: {
      required: ['taskTitle', 'actor', 'points'],
      properties: {
        taskTitle: { type: 'string', maxLength: 120 },
        actor: { type: 'string', maxLength: 80 },
        points: { type: 'number' },
      },
    },
  })
  assert.deepEqual(renderNotificationTemplate(parsed, { taskTitle: 'Cover art', actor: 'Ops', points: 80 }), {
    title: 'Ready: Cover art',
    body: 'Ops assigned Cover art with 80 points.',
  })
  assert.throws(() => renderNotificationTemplate(parsed, { taskTitle: 'Cover art', actor: 'Ops', points: 80, secret: 'nope' }), (error) => {
    assert.ok(error instanceof HttpError)
    assert.equal(error.code, 'INVALID_NOTIFICATION_VARIABLES')
    return true
  })
})

test('notification templates reject undeclared and unused required variables', () => {
  assert.throws(() => parseCreateNotificationTemplate({
    key: 'task.invalid_template',
    name: 'Invalid',
    category: 'task',
    titleTemplate: 'Hello {{unknown}}',
    bodyTemplate: 'Body',
    variableSchema: { required: ['declared'], properties: { declared: { type: 'string' } } },
  }), /Undeclared template variables/)
})
