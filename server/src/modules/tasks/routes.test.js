import assert from 'node:assert/strict'
import test from 'node:test'

import { createRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { registerAdminRoutes } from '../admin/routes.js'
import { registerNotificationRoutes } from '../notifications/routes.js'
import { registerPointsRoutes } from '../points/routes.js'
import { registerProfileRoutes } from '../profiles/routes.js'
import { registerTaskRoutes } from './routes.js'

const createTestServer = () => createRouteTestServer(registerTaskRoutes)
const createTaskAndPointsServer = () => createRouteTestServer(registerTaskRoutes, registerPointsRoutes)
const createTaskPointsAndProfileServer = () => createRouteTestServer(registerTaskRoutes, registerPointsRoutes, registerProfileRoutes)
const createTaskAndAdminServer = () => createRouteTestServer(registerTaskRoutes, registerAdminRoutes)
const createTaskAndNotificationServer = () => createRouteTestServer(registerTaskRoutes, registerNotificationRoutes)
const createTaskAdminAndNotificationServer = () => createRouteTestServer(registerTaskRoutes, registerAdminRoutes, registerNotificationRoutes)
const createTaskAdminNotificationAndPointsServer = () => createRouteTestServer(registerTaskRoutes, registerAdminRoutes, registerNotificationRoutes, registerPointsRoutes)

const validTaskBody = () => ({
  title: 'Integration test task',
  category: 'Prompt',
  description: 'Create a reusable prompt pack.',
  acceptanceRules: 'Submit prompt, examples, and usage notes.',
  pointsReward: 250,
  attachmentIds: ['brief-1'],
})

const validSubmissionBody = () => ({
  content: 'Delivery package with prompts, examples, and rights note.',
  assetIds: [],
  rightsNote: 'Original work, reusable by the publisher.',
})

const validProposalBody = () => ({
  coverLetter: 'I can deliver a reusable prompt pack with examples.',
  estimate: '2 days',
})

const validReviewBody = () => ({
  decision: 'approve',
  reviewNote: 'Accepted for integration test.',
})

const createTask = async (server, overrides = {}, token = 'demo-access.taskops') => {
  const result = await requestJson(server.url, '/api/tasks', {
    body: { ...validTaskBody(), ...overrides },
    token,
  })
  assert.equal(result.status, 201)
  return result.payload.data
}

const createProposal = async (server, taskId, overrides = {}, token = 'demo-access.promptlin') => {
  const result = await requestJson(server.url, `/api/tasks/${taskId}/proposals`, {
    body: { ...validProposalBody(), ...overrides },
    token,
  })
  assert.equal(result.status, 201)
  return result.payload.data
}

test('GET /api/tasks paginates and filters task cards', async () => {
  const server = await createTestServer()
  try {
    const firstPage = await requestJson(server.url, '/api/tasks?limit=2&category=Music', { method: 'GET' })

    assert.equal(firstPage.status, 200)
    assert.ok(Array.isArray(firstPage.payload.data))
    assert.equal(firstPage.payload.meta.pagination.limit, 2)
    assert.ok(firstPage.payload.data.every((task) => task.category === 'Music'))

    if (firstPage.payload.meta.pagination.nextCursor) {
      const secondPage = await requestJson(server.url, `/api/tasks?limit=2&category=Music&cursor=${firstPage.payload.meta.pagination.nextCursor}`, { method: 'GET' })
      assert.equal(secondPage.status, 200)
      assert.ok(secondPage.payload.data.every((task) => task.category === 'Music'))
    }
  } finally {
    await server.close()
  }
})

test('GET /api/tasks validates pagination limit', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/tasks?limit=0', { method: 'GET' })

    assert.equal(status, 400)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'VALIDATION_FAILED')
    assert.equal(payload.error.message, 'limit must be an integer between 1 and 100')
  } finally {
    await server.close()
  }
})

test('POST /api/tasks returns AUTH_REQUIRED when missing auth', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/tasks', { body: validTaskBody() })

    assert.equal(status, 401)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'AUTH_REQUIRED')
    assert.equal(payload.error.message, 'Authentication is required')
  } finally {
    await server.close()
  }
})

test('POST /api/tasks returns PERMISSION_DENIED when user lacks task:create', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/tasks', {
      body: validTaskBody(),
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 403)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'PERMISSION_DENIED')
    assert.equal(payload.error.message, 'Missing permission: task:create')
  } finally {
    await server.close()
  }
})

test('POST /api/tasks returns VALIDATION_FAILED for invalid payloads', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/tasks', {
      body: {
        ...validTaskBody(),
        title: '',
      },
      token: 'demo-access.taskops',
    })

    assert.equal(status, 400)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'VALIDATION_FAILED')
    assert.equal(payload.error.message, 'title is required')
  } finally {
    await server.close()
  }
})

test('POST /api/tasks creates a task and returns data envelope', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/tasks', {
      body: validTaskBody(),
      token: 'demo-access.taskops',
    })

    assert.equal(status, 201)
    assert.ok(payload.data)
    assert.equal(payload.error, undefined)
    assert.equal(payload.data.title, 'Integration test task')
    assert.equal(payload.data.category, 'Prompt')
    assert.equal(payload.data.publisher, 'taskops')
    assert.deepEqual(payload.data.attachments, ['brief-1'])
  } finally {
    await server.close()
  }
})

test('POST /api/tasks creates a pending publisher escrow ledger entry', async () => {
  const server = await createTaskAndPointsServer()
  try {
    const task = await createTask(server, {
      title: 'Escrow integration task',
      pointsReward: 640,
    }, 'demo-access.launchteam')

    const ledger = await requestJson(server.url, '/api/points/ledger?limit=5&status=pending', {
      method: 'GET',
      token: 'demo-access.launchteam',
    })

    assert.equal(ledger.status, 200)
    const escrow = ledger.payload.data.find((entry) => entry.sourceType === 'task_escrow' && entry.sourceId === String(task.id))
    assert.ok(escrow)
    assert.equal(escrow.description, 'Task reward held: Escrow integration task')
    assert.equal(escrow.delta, -640)
    assert.equal(escrow.status, 'pending')
  } finally {
    await server.close()
  }
})

test('POST /api/tasks/:id/claim requires task:claim permission', async () => {
  const server = await createTestServer()
  try {
    const task = await createTask(server)
    const { status, payload } = await requestJson(server.url, `/api/tasks/${task.id}/claim`, {
      token: 'demo-access.taskops',
    })

    assert.equal(status, 403)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'PERMISSION_DENIED')
    assert.equal(payload.error.message, 'Missing permission: task:claim')
  } finally {
    await server.close()
  }
})

test('POST /api/tasks/:id/claim assigns the task for creators', async () => {
  const server = await createTestServer()
  try {
    const task = await createTask(server)
    const { status, payload } = await requestJson(server.url, `/api/tasks/${task.id}/claim`, {
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 200)
    assert.equal(payload.error, undefined)
    assert.equal(payload.data.id, task.id)
    assert.equal(payload.data.status, 'In Progress')
    assert.equal(payload.data.assignee, 'promptlin')
  } finally {
    await server.close()
  }
})

test('POST /api/tasks/:id/cancel is owner-scoped and idempotently releases escrow', async () => {
  const server = await createTaskAndPointsServer()
  try {
    const task = await createTask(server, { title: 'User cancellation route task', pointsReward: 330 }, 'demo-access.taskops')
    const body = { expectedVersion: task.version, idempotencyKey: `cancel:${task.id}`, reasonCode: 'user_cancelled', note: 'No longer needed' }
    const first = await requestJson(server.url, `/api/tasks/${task.id}/cancel`, { body, token: 'demo-access.taskops' })
    const replay = await requestJson(server.url, `/api/tasks/${task.id}/cancel`, { body, token: 'demo-access.taskops' })
    assert.equal(first.status, 200)
    assert.deepEqual(replay.payload.data, first.payload.data)
    assert.equal(first.payload.data.result.status, 'cancelled')

    const taskAfter = await requestJson(server.url, `/api/tasks/${task.id}`, { method: 'GET' })
    assert.equal(taskAfter.payload.data.status, 'Cancelled')
    assert.ok(taskAfter.payload.data.cancelledAt)
    const ledger = await requestJson(server.url, '/api/points/ledger?limit=20', { method: 'GET', token: 'demo-access.taskops' })
    assert.equal(ledger.payload.data.filter((entry) => entry.sourceType === 'task_escrow_release' && entry.sourceId === String(task.id)).length, 1)

    const conflict = await requestJson(server.url, `/api/tasks/${task.id}/cancel`, { body: { ...body, reasonCode: 'changed' }, token: 'demo-access.taskops' })
    assert.equal(conflict.status, 409)
    assert.equal(conflict.payload.error.code, 'TASK_LIFECYCLE_IDEMPOTENCY_CONFLICT')
  } finally {
    await server.close()
  }
})

test('POST /api/tasks/:id/cancel rejects non-owners and active fulfillment', async () => {
  const server = await createTestServer()
  try {
    const foreignTask = await createTask(server, {}, 'demo-access.taskops')
    const foreign = await requestJson(server.url, `/api/tasks/${foreignTask.id}/cancel`, { body: { expectedVersion: foreignTask.version, idempotencyKey: `foreign:${foreignTask.id}`, reasonCode: 'user_cancelled' }, token: 'demo-access.launchteam' })
    assert.equal(foreign.status, 403)
    assert.equal(foreign.payload.error.code, 'TASK_CANCEL_NOT_OWNER')
    await requestJson(server.url, `/api/tasks/${foreignTask.id}/claim`, { token: 'demo-access.promptlin' })
    const active = await requestJson(server.url, `/api/tasks/${foreignTask.id}/cancel`, { body: { expectedVersion: Number(foreignTask.version) + 1, idempotencyKey: `active:${foreignTask.id}`, reasonCode: 'user_cancelled' }, token: 'demo-access.taskops' })
    assert.equal(active.status, 409)
    assert.equal(active.payload.error.code, 'TASK_USER_CANCEL_NOT_ALLOWED')
  } finally {
    await server.close()
  }
})

test('admin expiry sweep and registered escrow recovery expose lifecycle evidence', async () => {
  const server = await createTestServer()
  try {
    const task = await createTask(server, { deadlineAt: '2026-07-01T00:00:00.000Z' }, 'demo-access.taskops')
    const sweep = await requestJson(server.url, '/api/admin/tasks/expiry/sweep', { body: { limit: 10 }, token: 'demo-access.opsplus' })
    assert.equal(sweep.status, 200)
    assert.ok(sweep.payload.data.expired >= 1)
    const detail = await requestJson(server.url, `/api/admin/tasks/${task.id}`, { method: 'GET', token: 'demo-access.opsplus' })
    assert.equal(detail.payload.data.status, 'expired')
    assert.ok(detail.payload.data.expiredAt)

    const recoveryBody = { action: 'release_escrow', expectedVersion: detail.payload.data.version, idempotencyKey: `recover:${task.id}`, reasonCode: 'escrow_reconciliation', note: '' }
    const recovery = await requestJson(server.url, `/api/admin/tasks/${task.id}/recovery`, { body: recoveryBody, token: 'demo-access.opsplus' })
    const replay = await requestJson(server.url, `/api/admin/tasks/${task.id}/recovery`, { body: recoveryBody, token: 'demo-access.opsplus' })
    assert.equal(recovery.status, 200)
    assert.deepEqual(replay.payload.data, recovery.payload.data)
    const lifecycle = await requestJson(server.url, `/api/admin/tasks/${task.id}/lifecycle`, { method: 'GET', token: 'demo-access.opsplus' })
    assert.equal(lifecycle.status, 200)
    assert.ok(lifecycle.payload.data.some((item) => item.action === 'expire'))
    assert.ok(lifecycle.payload.data.some((item) => item.action === 'release_escrow'))
  } finally {
    await server.close()
  }
})

test('GET /api/tasks/:id/workflow returns actor-scoped action eligibility', async () => {
  const server = await createTestServer()
  try {
    const task = await createTask(server, {}, 'demo-access.launchteam')
    const creatorBefore = await requestJson(server.url, `/api/tasks/${task.id}/workflow`, {
      method: 'GET',
      token: 'demo-access.promptlin',
    })
    assert.equal(creatorBefore.status, 200)
    assert.equal(creatorBefore.payload.data.role, 'viewer')
    assert.deepEqual(creatorBefore.payload.data.actions.sort(), ['claim', 'propose', 'submit', 'view'].sort())

    await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      body: validSubmissionBody(),
      token: 'demo-access.promptlin',
    })
    const publisherAfter = await requestJson(server.url, `/api/tasks/${task.id}/workflow`, {
      method: 'GET',
      token: 'demo-access.launchteam',
    })
    assert.equal(publisherAfter.payload.data.role, 'publisher')
    assert.ok(publisherAfter.payload.data.actions.includes('review_submission'))
    assert.equal(publisherAfter.payload.data.actions.includes('submit'), false)
  } finally {
    await server.close()
  }
})

test('POST /api/tasks/:id/proposals requires task:propose permission', async () => {
  const server = await createTestServer()
  try {
    const task = await createTask(server)
    const { status, payload } = await requestJson(server.url, `/api/tasks/${task.id}/proposals`, {
      body: validProposalBody(),
      token: 'demo-access.taskops',
    })

    assert.equal(status, 403)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'PERMISSION_DENIED')
    assert.equal(payload.error.message, 'Missing permission: task:propose')
  } finally {
    await server.close()
  }
})

test('POST /api/tasks/:id/proposals validates proposal payloads', async () => {
  const server = await createTestServer()
  try {
    const task = await createTask(server)
    const { status, payload } = await requestJson(server.url, `/api/tasks/${task.id}/proposals`, {
      body: { ...validProposalBody(), coverLetter: '' },
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 400)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'VALIDATION_FAILED')
    assert.equal(payload.error.message, 'coverLetter is required')
  } finally {
    await server.close()
  }
})

test('POST /api/tasks/:id/proposals creates a normalized proposal and updates task count', async () => {
  const server = await createTestServer()
  try {
    const task = await createTask(server)
    const created = await requestJson(server.url, `/api/tasks/${task.id}/proposals`, {
      body: validProposalBody(),
      token: 'demo-access.promptlin',
    })

    assert.equal(created.status, 201)
    assert.equal(created.payload.error, undefined)
    assert.equal(created.payload.data.taskId, task.id)
    assert.equal(created.payload.data.proposer.handle, 'promptlin')
    assert.equal(created.payload.data.coverLetter, validProposalBody().coverLetter)
    assert.equal(created.payload.data.status, 'pending')

    const taskAfter = await requestJson(server.url, `/api/tasks/${task.id}`, { method: 'GET' })
    assert.equal(taskAfter.status, 200)
    assert.equal(taskAfter.payload.data.proposals, 1)
  } finally {
    await server.close()
  }
})

test('POST /api/tasks/:id/proposals is idempotent and rejects a second creator proposal', async () => {
  const server = await createTestServer()
  try {
    const task = await createTask(server)
    const first = await requestJson(server.url, `/api/tasks/${task.id}/proposals`, {
      body: validProposalBody(),
      token: 'demo-access.promptlin',
    })
    const duplicate = await requestJson(server.url, `/api/tasks/${task.id}/proposals`, {
      body: validProposalBody(),
      token: 'demo-access.promptlin',
    })
    const conflict = await requestJson(server.url, `/api/tasks/${task.id}/proposals`, {
      body: { ...validProposalBody(), coverLetter: 'A different proposal body.' },
      token: 'demo-access.promptlin',
    })

    assert.equal(first.status, 201)
    assert.equal(duplicate.status, 201)
    assert.equal(duplicate.payload.data.id, first.payload.data.id)
    assert.equal(conflict.status, 409)
    assert.equal(conflict.payload.error.code, 'TASK_PROPOSAL_ALREADY_EXISTS')
  } finally {
    await server.close()
  }
})

test('GET /api/tasks/:id/proposals paginates proposals for task publishers', async () => {
  const server = await createTestServer()
  try {
    const task = await createTask(server)
    await requestJson(server.url, `/api/tasks/${task.id}/proposals`, {
      body: { ...validProposalBody(), coverLetter: 'First proposal.' },
      token: 'demo-access.promptlin',
    })
    await requestJson(server.url, `/api/tasks/${task.id}/proposals`, {
      body: { ...validProposalBody(), coverLetter: 'Second proposal.' },
      token: 'demo-access.opsplus',
    })

    const firstPage = await requestJson(server.url, `/api/tasks/${task.id}/proposals?limit=1`, {
      method: 'GET',
      token: 'demo-access.taskops',
    })

    assert.equal(firstPage.status, 200)
    assert.equal(firstPage.payload.data.length, 1)
    assert.equal(firstPage.payload.meta.pagination.limit, 1)
    assert.ok(firstPage.payload.meta.pagination.nextCursor)

    const secondPage = await requestJson(server.url, `/api/tasks/${task.id}/proposals?limit=1&cursor=${firstPage.payload.meta.pagination.nextCursor}`, {
      method: 'GET',
      token: 'demo-access.taskops',
    })

    assert.equal(secondPage.status, 200)
    assert.equal(secondPage.payload.data.length, 1)
    assert.notEqual(secondPage.payload.data[0].id, firstPage.payload.data[0].id)
  } finally {
    await server.close()
  }
})

test('POST /api/tasks/:id/proposals/:proposalId/actions requires task:review permission', async () => {
  const server = await createTestServer()
  try {
    const task = await createTask(server, {}, 'demo-access.launchteam')
    const proposal = await createProposal(server, task.id)
    const { status, payload } = await requestJson(server.url, `/api/tasks/${task.id}/proposals/${proposal.id}/actions`, {
      body: { decision: 'accept', note: 'Good fit.' },
      token: 'demo-access.taskops',
    })

    assert.equal(status, 403)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'PERMISSION_DENIED')
    assert.equal(payload.error.message, 'Missing permission: task:review')
  } finally {
    await server.close()
  }
})

test('POST /api/tasks/:id/proposals/:proposalId/actions validates proposal decisions', async () => {
  const server = await createTestServer()
  try {
    const task = await createTask(server, {}, 'demo-access.launchteam')
    const proposal = await createProposal(server, task.id)
    const { status, payload } = await requestJson(server.url, `/api/tasks/${task.id}/proposals/${proposal.id}/actions`, {
      body: { decision: 'hold' },
      token: 'demo-access.launchteam',
    })

    assert.equal(status, 400)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'VALIDATION_FAILED')
    assert.equal(payload.error.message, 'decision must be one of: accept, reject')
  } finally {
    await server.close()
  }
})

test('POST /api/tasks/:id/proposals/:proposalId/actions accepts a proposal and assigns the task', async () => {
  const server = await createTestServer()
  try {
    const task = await createTask(server, {}, 'demo-access.launchteam')
    const proposal = await createProposal(server, task.id)
    const { status, payload } = await requestJson(server.url, `/api/tasks/${task.id}/proposals/${proposal.id}/actions`, {
      body: { decision: 'accept', note: 'Strong fit.' },
      token: 'demo-access.launchteam',
    })

    assert.equal(status, 200)
    assert.equal(payload.error, undefined)
    assert.equal(payload.data.id, proposal.id)
    assert.equal(payload.data.status, 'accepted')
    assert.equal(payload.data.decisionNote, 'Strong fit.')

    const taskAfter = await requestJson(server.url, `/api/tasks/${task.id}`, { method: 'GET' })
    assert.equal(taskAfter.status, 200)
    assert.equal(taskAfter.payload.data.status, 'In Progress')
    assert.equal(taskAfter.payload.data.assignee, 'promptlin')
  } finally {
    await server.close()
  }
})

test('POST /api/tasks/:id/proposals/:proposalId/actions rejects a proposal without assigning the task', async () => {
  const server = await createTestServer()
  try {
    const task = await createTask(server, {}, 'demo-access.launchteam')
    const proposal = await createProposal(server, task.id)
    const { status, payload } = await requestJson(server.url, `/api/tasks/${task.id}/proposals/${proposal.id}/actions`, {
      body: { decision: 'reject', note: 'Not enough examples yet.' },
      token: 'demo-access.launchteam',
    })

    assert.equal(status, 200)
    assert.equal(payload.error, undefined)
    assert.equal(payload.data.status, 'rejected')
    assert.equal(payload.data.decisionNote, 'Not enough examples yet.')

    const taskAfter = await requestJson(server.url, `/api/tasks/${task.id}`, { method: 'GET' })
    assert.equal(taskAfter.status, 200)
    assert.equal(taskAfter.payload.data.status, 'Open')
    assert.equal(taskAfter.payload.data.assignee, 'Unassigned')
  } finally {
    await server.close()
  }
})

test('POST /api/tasks/:id/proposals/:proposalId/actions hides proposals owned by another publisher', async () => {
  const server = await createTestServer()
  try {
    const task = await createTask(server)
    const proposal = await createProposal(server, task.id)
    const { status, payload } = await requestJson(server.url, `/api/tasks/${task.id}/proposals/${proposal.id}/actions`, {
      body: { decision: 'accept' },
      token: 'demo-access.launchteam',
    })

    assert.equal(status, 404)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'NOT_FOUND')
  } finally {
    await server.close()
  }
})

test('POST /api/tasks/:id/submissions requires task:submit permission', async () => {
  const server = await createTestServer()
  try {
    const task = await createTask(server)
    const { status, payload } = await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      body: validSubmissionBody(),
      token: 'demo-access.taskops',
    })

    assert.equal(status, 403)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'PERMISSION_DENIED')
    assert.equal(payload.error.message, 'Missing permission: task:submit')
  } finally {
    await server.close()
  }
})

test('POST /api/tasks/:id/submissions returns VALIDATION_FAILED for empty content', async () => {
  const server = await createTestServer()
  try {
    const task = await createTask(server)
    const { status, payload } = await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      body: { ...validSubmissionBody(), content: '' },
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 400)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'VALIDATION_FAILED')
    assert.equal(payload.error.message, 'content is required')
  } finally {
    await server.close()
  }
})

test('POST /api/tasks/:id/submissions creates a submission envelope', async () => {
  const server = await createTestServer()
  try {
    const task = await createTask(server)
    const { status, payload } = await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      body: validSubmissionBody(),
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 201)
    assert.equal(payload.error, undefined)
    assert.equal(payload.data.id, task.id)
    assert.equal(payload.data.status, 'Pending Review')
    assert.equal(payload.data.submission, validSubmissionBody().content)
    assert.deepEqual(payload.data.resultLinks, validSubmissionBody().assetIds)
  } finally {
    await server.close()
  }
})

test('POST /api/tasks/:id/submissions recovers identical retries and blocks competing payloads', async () => {
  const server = await createTestServer()
  try {
    const task = await createTask(server)
    const first = await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      body: validSubmissionBody(),
      token: 'demo-access.promptlin',
    })
    const duplicate = await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      body: validSubmissionBody(),
      token: 'demo-access.promptlin',
    })
    const conflict = await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      body: { ...validSubmissionBody(), content: 'Competing delivery payload.' },
      token: 'demo-access.promptlin',
    })
    const submissions = await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      method: 'GET',
      token: 'demo-access.taskops',
    })

    assert.equal(first.status, 201)
    assert.equal(duplicate.status, 201)
    assert.equal(conflict.status, 409)
    assert.equal(conflict.payload.error.code, 'TASK_SUBMISSION_ALREADY_PENDING')
    assert.equal(submissions.payload.data.length, 1)
  } finally {
    await server.close()
  }
})

test('POST /api/tasks/:id/submissions hides tasks assigned to another creator', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/tasks/14/submissions', {
      body: validSubmissionBody(),
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 404)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'NOT_FOUND')
  } finally {
    await server.close()
  }
})

test('GET /api/tasks/:id/submissions lists normalized submissions for publishers', async () => {
  const server = await createTestServer()
  try {
    const task = await createTask(server)
    await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      body: validSubmissionBody(),
      token: 'demo-access.promptlin',
    })

    const { status, payload } = await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      method: 'GET',
      token: 'demo-access.taskops',
    })

    assert.equal(status, 200)
    assert.equal(payload.error, undefined)
    assert.equal(payload.data.length, 1)
    assert.equal(payload.data[0].taskId, task.id)
    assert.equal(payload.data[0].submitter.handle, 'promptlin')
    assert.equal(payload.data[0].content, validSubmissionBody().content)
    assert.equal(payload.data[0].status, 'pending_review')
  } finally {
    await server.close()
  }
})

test('GET /api/tasks/:id/submissions hides submissions from unrelated users', async () => {
  const server = await createTestServer()
  try {
    const task = await createTask(server)
    await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      body: validSubmissionBody(),
      token: 'demo-access.promptlin',
    })

    const { status, payload } = await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      method: 'GET',
      token: 'demo-access.launchteam',
    })

    assert.equal(status, 404)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'NOT_FOUND')
  } finally {
    await server.close()
  }
})

test('GET /api/tasks/:id/timeline lists participant-visible task history', async () => {
  const server = await createTestServer()
  try {
    const task = await createTask(server, {}, 'demo-access.launchteam')
    const proposal = await createProposal(server, task.id)
    await requestJson(server.url, `/api/tasks/${task.id}/proposals/${proposal.id}/actions`, {
      body: { decision: 'accept', note: 'Selected for timeline coverage.' },
      token: 'demo-access.launchteam',
    })
    await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      body: validSubmissionBody(),
      token: 'demo-access.promptlin',
    })
    await requestJson(server.url, `/api/tasks/${task.id}/review`, {
      body: {
        decision: 'request_changes',
        reviewNote: 'Add a clearer revision note.',
        acceptanceChecklist: [
          { label: 'Delivery package included', checked: true },
          { label: 'Rights note confirmed', checked: false },
        ],
      },
      token: 'demo-access.launchteam',
    })

    const { status, payload } = await requestJson(server.url, `/api/tasks/${task.id}/timeline`, {
      method: 'GET',
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 200)
    assert.equal(payload.error, undefined)
    const eventTypes = payload.data.map((item) => item.type)
    assert.ok(eventTypes.includes('created'))
    assert.ok(eventTypes.includes('proposal_created'))
    assert.ok(eventTypes.includes('proposal_accepted'))
    assert.ok(eventTypes.includes('submitted'))
    assert.ok(eventTypes.includes('revision_requested'))
    assert.equal(payload.data[0].type, 'revision_requested')
    assert.equal(payload.data[0].body, 'Add a clearer revision note.')
    assert.equal(payload.data[0].actor.handle, 'launchteam')
    assert.deepEqual(payload.data[0].metadata.acceptanceChecklist, [
      { label: 'Delivery package included', checked: true },
      { label: 'Rights note confirmed', checked: false },
    ])
  } finally {
    await server.close()
  }
})

test('GET /api/tasks/:id/timeline hides history from unrelated users', async () => {
  const server = await createTestServer()
  try {
    const task = await createTask(server, {}, 'demo-access.launchteam')
    const { status, payload } = await requestJson(server.url, `/api/tasks/${task.id}/timeline`, {
      method: 'GET',
      token: 'demo-access.taskops',
    })

    assert.equal(status, 404)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'NOT_FOUND')
  } finally {
    await server.close()
  }
})

test('POST /api/tasks/:id/review requires task:review permission', async () => {
  const server = await createTestServer()
  try {
    const task = await createTask(server)
    const { status, payload } = await requestJson(server.url, `/api/tasks/${task.id}/review`, {
      body: validReviewBody(),
      token: 'demo-access.taskops',
    })

    assert.equal(status, 403)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'PERMISSION_DENIED')
    assert.equal(payload.error.message, 'Missing permission: task:review')
  } finally {
    await server.close()
  }
})

test('POST /api/tasks/:id/review returns VALIDATION_FAILED for unknown decisions', async () => {
  const server = await createTestServer()
  try {
    const task = await createTask(server)
    const { status, payload } = await requestJson(server.url, `/api/tasks/${task.id}/review`, {
      body: { ...validReviewBody(), decision: 'hold' },
      token: 'demo-access.launchteam',
    })

    assert.equal(status, 400)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'VALIDATION_FAILED')
    assert.equal(payload.error.message, 'decision must be one of: approve, reject, request_changes')
  } finally {
    await server.close()
  }
})

test('POST /api/tasks/:id/review requires checked acceptance checklist before approval', async () => {
  const server = await createTestServer()
  try {
    const task = await createTask(server, {}, 'demo-access.launchteam')
    await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      body: validSubmissionBody(),
      token: 'demo-access.promptlin',
    })
    const { status, payload } = await requestJson(server.url, `/api/tasks/${task.id}/review`, {
      body: {
        ...validReviewBody(),
        acceptanceChecklist: [
          { label: 'Delivery note included', checked: true },
          { label: 'Rights note confirmed', checked: false },
        ],
      },
      token: 'demo-access.launchteam',
    })

    assert.equal(status, 400)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'VALIDATION_FAILED')
    assert.equal(payload.error.message, 'acceptanceChecklist must be fully checked before approval')
  } finally {
    await server.close()
  }
})

test('POST /api/tasks/:id/review approves a task for publishers', async () => {
  const server = await createTestServer()
  try {
    const task = await createTask(server, {}, 'demo-access.launchteam')
    await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      body: validSubmissionBody(),
      token: 'demo-access.promptlin',
    })
    const { status, payload } = await requestJson(server.url, `/api/tasks/${task.id}/review`, {
      body: validReviewBody(),
      token: 'demo-access.launchteam',
    })

    assert.equal(status, 200)
    assert.equal(payload.error, undefined)
    assert.equal(payload.data.id, task.id)
    assert.equal(payload.data.status, 'Completed')
    assert.equal(payload.data.reviewNote, validReviewBody().reviewNote)
  } finally {
    await server.close()
  }
})

test('POST /api/tasks/:id/review hides tasks owned by another publisher', async () => {
  const server = await createTestServer()
  try {
    const task = await createTask(server)
    await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      body: validSubmissionBody(),
      token: 'demo-access.promptlin',
    })
    const { status, payload } = await requestJson(server.url, `/api/tasks/${task.id}/review`, {
      body: validReviewBody(),
      token: 'demo-access.launchteam',
    })

    assert.equal(status, 404)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'NOT_FOUND')
  } finally {
    await server.close()
  }
})

test('POST /api/tasks/:id/review allows admin ownership bypass', async () => {
  const server = await createTestServer()
  try {
    const task = await createTask(server)
    await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      body: validSubmissionBody(),
      token: 'demo-access.promptlin',
    })
    const { status, payload } = await requestJson(server.url, `/api/tasks/${task.id}/review`, {
      body: validReviewBody(),
      token: 'demo-access.opsplus',
    })

    assert.equal(status, 200)
    assert.equal(payload.error, undefined)
    assert.equal(payload.data.status, 'Completed')
  } finally {
    await server.close()
  }
})

test('POST /api/tasks/:id/review updates the latest normalized submission review state', async () => {
  const server = await createTestServer()
  try {
    const task = await createTask(server, {}, 'demo-access.launchteam')
    await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      body: validSubmissionBody(),
      token: 'demo-access.promptlin',
    })

    const review = await requestJson(server.url, `/api/tasks/${task.id}/review`, {
      body: {
        ...validReviewBody(),
        acceptanceChecklist: [
          { label: 'Delivery package included', checked: true },
          { label: 'Rights note confirmed', checked: true },
        ],
      },
      token: 'demo-access.launchteam',
    })

    assert.equal(review.status, 200)

    const submissions = await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      method: 'GET',
      token: 'demo-access.launchteam',
    })

    assert.equal(submissions.status, 200)
    assert.equal(submissions.payload.data[0].status, 'approved')
    assert.equal(submissions.payload.data[0].reviewNote, validReviewBody().reviewNote)
    assert.deepEqual(submissions.payload.data[0].acceptanceChecklist, [
      { label: 'Delivery package included', checked: true },
      { label: 'Rights note confirmed', checked: true },
    ])
    assert.equal(submissions.payload.data[0].reviewedBy.handle, 'launchteam')
  } finally {
    await server.close()
  }
})

test('POST /api/tasks/:id/review settles task reward points on approval', async () => {
  const server = await createTaskAndPointsServer()
  try {
    const task = await createTask(server, {
      title: 'Settlement integration task',
      pointsReward: 730,
    }, 'demo-access.launchteam')
    await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      body: validSubmissionBody(),
      token: 'demo-access.promptlin',
    })

    const review = await requestJson(server.url, `/api/tasks/${task.id}/review`, {
      body: validReviewBody(),
      token: 'demo-access.launchteam',
    })

    assert.equal(review.status, 200)

    const ledger = await requestJson(server.url, '/api/points/ledger?limit=1&status=settled', {
      method: 'GET',
      token: 'demo-access.promptlin',
    })

    assert.equal(ledger.status, 200)
    assert.equal(ledger.payload.data[0].description, 'Task accepted: Settlement integration task')
    assert.equal(ledger.payload.data[0].delta, 730)

    const publisherLedger = await requestJson(server.url, '/api/points/ledger?limit=20&status=settled', {
      method: 'GET',
      token: 'demo-access.launchteam',
    })
    const settledEscrow = publisherLedger.payload.data.find((entry) => entry.sourceType === 'task_escrow' && entry.sourceId === String(task.id))
    assert.ok(settledEscrow)
    assert.equal(settledEscrow.status, 'settled')

    const pendingLedger = await requestJson(server.url, '/api/points/ledger?limit=20&status=pending', {
      method: 'GET',
      token: 'demo-access.launchteam',
    })
    assert.equal(pendingLedger.payload.data.some((entry) => entry.sourceType === 'task_escrow' && entry.sourceId === String(task.id)), false)
  } finally {
    await server.close()
  }
})

test('task lifecycle sends proposal, resubmission, approval, and settlement notifications', async () => {
  const server = await createTaskAndNotificationServer()
  try {
    const task = await createTask(server, {
      title: 'Notification lifecycle task',
      pointsReward: 580,
    }, 'demo-access.launchteam')
    const proposal = await createProposal(server, task.id)

    const publisherInbox = await requestJson(server.url, '/api/notifications?readState=all&type=task.proposal_submitted&resourceType=task', {
      method: 'GET',
      token: 'demo-access.launchteam',
    })
    assert.equal(publisherInbox.status, 200)
    assert.ok(publisherInbox.payload.data.some((item) => item.metadata.proposalId === proposal.id && item.metadata.target.surface === 'tasks' && item.metadata.target.taskId === String(task.id)))

    await requestJson(server.url, `/api/tasks/${task.id}/proposals/${proposal.id}/actions`, {
      body: { decision: 'accept', note: 'Selected for notification coverage.' },
      token: 'demo-access.launchteam',
    })

    const creatorProposalInbox = await requestJson(server.url, '/api/notifications?readState=all&type=task.proposal_accepted&resourceType=task', {
      method: 'GET',
      token: 'demo-access.promptlin',
    })
    assert.ok(creatorProposalInbox.payload.data.some((item) => item.resourceId === String(task.id) && item.metadata.proposalId === proposal.id))

    await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      body: validSubmissionBody(),
      token: 'demo-access.promptlin',
    })
    await requestJson(server.url, `/api/tasks/${task.id}/review`, {
      body: { decision: 'request_changes', reviewNote: 'Add revision notes before final acceptance.' },
      token: 'demo-access.launchteam',
    })
    await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      body: {
        ...validSubmissionBody(),
        content: 'Revised delivery with revision notes included.',
      },
      token: 'demo-access.promptlin',
    })

    const resubmissionInbox = await requestJson(server.url, '/api/notifications?readState=all&type=task.submission_resubmitted&resourceType=task', {
      method: 'GET',
      token: 'demo-access.launchteam',
    })
    assert.ok(resubmissionInbox.payload.data.some((item) => item.resourceId === String(task.id) && item.metadata.previousSubmissionStatus === 'revision_requested'))

    await requestJson(server.url, `/api/tasks/${task.id}/review`, {
      body: validReviewBody(),
      token: 'demo-access.launchteam',
    })

    const creatorSettlementInbox = await requestJson(server.url, '/api/notifications?readState=all&resourceType=task', {
      method: 'GET',
      token: 'demo-access.promptlin',
    })
    assert.ok(creatorSettlementInbox.payload.data.some((item) => item.type === 'task.submission_approved' && item.resourceId === String(task.id)))
    assert.ok(creatorSettlementInbox.payload.data.some((item) => item.type === 'task.reward_settled' && item.metadata.target.surface === 'points'))
  } finally {
    await server.close()
  }
})

test('POST /api/tasks/:id/review is idempotent for task reward settlement', async () => {
  const server = await createTaskAndPointsServer()
  try {
    const task = await createTask(server, {
      title: 'Idempotent settlement task',
      pointsReward: 510,
    }, 'demo-access.launchteam')
    await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      body: validSubmissionBody(),
      token: 'demo-access.promptlin',
    })

    const firstReview = await requestJson(server.url, `/api/tasks/${task.id}/review`, {
      body: validReviewBody(),
      token: 'demo-access.launchteam',
    })
    const secondReview = await requestJson(server.url, `/api/tasks/${task.id}/review`, {
      body: validReviewBody(),
      token: 'demo-access.launchteam',
    })

    assert.equal(firstReview.status, 200)
    assert.equal(secondReview.status, 200)

    const ledger = await requestJson(server.url, '/api/points/ledger?limit=50&status=settled', {
      method: 'GET',
      token: 'demo-access.promptlin',
    })
    const completions = ledger.payload.data.filter((entry) => entry.sourceType === 'task_completion' && entry.sourceId === String(task.id))
    assert.equal(completions.length, 1)
    assert.equal(completions[0].delta, 510)
  } finally {
    await server.close()
  }
})

test('POST /api/tasks/:id/review updates creator and publisher reputation once on approval', async () => {
  const server = await createTaskPointsAndProfileServer()
  try {
    const creatorBefore = await requestJson(server.url, '/api/profiles/promptlin', { method: 'GET' })
    const publisherBefore = await requestJson(server.url, '/api/profiles/launchteam', { method: 'GET' })
    assert.equal(creatorBefore.status, 200)
    assert.equal(publisherBefore.status, 200)

    const task = await createTask(server, {
      title: 'Reputation integration task',
      pointsReward: 610,
    }, 'demo-access.launchteam')
    await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      body: validSubmissionBody(),
      token: 'demo-access.promptlin',
    })

    const firstReview = await requestJson(server.url, `/api/tasks/${task.id}/review`, {
      body: validReviewBody(),
      token: 'demo-access.launchteam',
    })
    const secondReview = await requestJson(server.url, `/api/tasks/${task.id}/review`, {
      body: validReviewBody(),
      token: 'demo-access.launchteam',
    })

    assert.equal(firstReview.status, 200)
    assert.equal(secondReview.status, 200)

    const creatorAfter = await requestJson(server.url, '/api/profiles/promptlin', { method: 'GET' })
    const publisherAfter = await requestJson(server.url, '/api/profiles/launchteam', { method: 'GET' })

    assert.equal(creatorAfter.payload.data.stats.completed, creatorBefore.payload.data.stats.completed + 1)
    assert.equal(creatorAfter.payload.data.stats.score, creatorBefore.payload.data.stats.score + 10)
    assert.equal(publisherAfter.payload.data.stats.completed, publisherBefore.payload.data.stats.completed + 1)
    assert.equal(publisherAfter.payload.data.stats.score, publisherBefore.payload.data.stats.score + 6)
  } finally {
    await server.close()
  }
})

test('POST /api/tasks/:id/review does not settle reward points on rejection', async () => {
  const server = await createTaskAndPointsServer()
  try {
    const task = await createTask(server, {
      title: 'Rejected settlement integration task',
      pointsReward: 810,
    }, 'demo-access.launchteam')
    await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      body: validSubmissionBody(),
      token: 'demo-access.promptlin',
    })

    const review = await requestJson(server.url, `/api/tasks/${task.id}/review`, {
      body: { decision: 'reject', reviewNote: 'Needs revision.' },
      token: 'demo-access.launchteam',
    })

    assert.equal(review.status, 200)

    const ledger = await requestJson(server.url, '/api/points/ledger?limit=20&status=settled', {
      method: 'GET',
      token: 'demo-access.promptlin',
    })

    assert.equal(ledger.status, 200)
    assert.equal(ledger.payload.data.some((entry) => entry.description === 'Task accepted: Rejected settlement integration task'), false)

    const releaseLedger = await requestJson(server.url, '/api/points/ledger?limit=50&status=settled', {
      method: 'GET',
      token: 'demo-access.launchteam',
    })
    const release = releaseLedger.payload.data.find((entry) => entry.sourceType === 'task_escrow_release' && entry.sourceId === String(task.id))
    assert.equal(release, undefined)

    const cancelledLedger = await requestJson(server.url, '/api/points/ledger?limit=50&status=cancelled', {
      method: 'GET',
      token: 'demo-access.launchteam',
    })
    const cancelledEscrow = cancelledLedger.payload.data.find((entry) => entry.sourceType === 'task_escrow' && entry.sourceId === String(task.id))
    assert.equal(cancelledEscrow, undefined)

    const pendingLedger = await requestJson(server.url, '/api/points/ledger?limit=50&status=pending', {
      method: 'GET',
      token: 'demo-access.launchteam',
    })
    const pendingEscrow = pendingLedger.payload.data.find((entry) => entry.sourceType === 'task_escrow' && entry.sourceId === String(task.id))
    assert.ok(pendingEscrow)
  } finally {
    await server.close()
  }
})

test('POST /api/tasks/:id/disputes opens an admin review for rejected submissions', async () => {
  const server = await createTaskAdminAndNotificationServer()
  try {
    const task = await createTask(server, {
      title: 'Rejected dispute integration task',
      pointsReward: 710,
    }, 'demo-access.launchteam')
    await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      body: validSubmissionBody(),
      token: 'demo-access.promptlin',
    })
    await requestJson(server.url, `/api/tasks/${task.id}/review`, {
      body: { decision: 'reject', reviewNote: 'Final package is missing the usage rights note.' },
      token: 'demo-access.launchteam',
    })

    const dispute = await requestJson(server.url, `/api/tasks/${task.id}/disputes`, {
      body: { reason: 'Rights note was included in the submitted delivery package.' },
      token: 'demo-access.promptlin',
    })

    assert.equal(dispute.status, 200)
    assert.equal(dispute.payload.data.status, 'Disputed')
    assert.equal(dispute.payload.data.disputeStatus, 'open')

    const submissions = await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      method: 'GET',
      token: 'demo-access.launchteam',
    })
    assert.equal(submissions.status, 200)
    assert.equal(submissions.payload.data[0].status, 'disputed')
    assert.equal(submissions.payload.data[0].dispute.reason, 'Rights note was included in the submitted delivery package.')

    const reviews = await requestJson(server.url, '/api/admin/reviews?queue=task_disputes&status=Task%20dispute', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })
    const review = reviews.payload.data.find((item) => item.metadata?.taskId === String(task.id))
    assert.ok(review)
    assert.equal(review.owner, 'promptlin')
    assert.equal(review.metadata.submissionId, submissions.payload.data[0].id)

    const timeline = await requestJson(server.url, `/api/tasks/${task.id}/timeline`, {
      method: 'GET',
      token: 'demo-access.promptlin',
    })
    assert.equal(timeline.status, 200)
    assert.equal(timeline.payload.data[0].type, 'dispute_opened')
    assert.equal(timeline.payload.data[0].body, 'Rights note was included in the submitted delivery package.')

    const creatorInbox = await requestJson(server.url, '/api/notifications?readState=all&type=task.dispute_received&resourceType=task', {
      method: 'GET',
      token: 'demo-access.promptlin',
    })
    assert.ok(creatorInbox.payload.data.some((item) => item.resourceId === String(task.id) && item.metadata.adminReviewId === review.id))
  } finally {
    await server.close()
  }
})

test('Admin approval resolves a task dispute by reopening revision without releasing escrow', async () => {
  const server = await createTaskAdminNotificationAndPointsServer()
  try {
    const task = await createTask(server, { title: 'Approved dispute lifecycle task', pointsReward: 640 }, 'demo-access.launchteam')
    await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      body: validSubmissionBody(),
      token: 'demo-access.promptlin',
    })
    await requestJson(server.url, `/api/tasks/${task.id}/review`, {
      body: { decision: 'reject', reviewNote: 'Missing acceptance evidence.' },
      token: 'demo-access.launchteam',
    })
    const dispute = await requestJson(server.url, `/api/tasks/${task.id}/disputes`, {
      body: { reason: 'The evidence was included in the governed assets.' },
      token: 'demo-access.promptlin',
    })
    const reviewId = dispute.payload.data.disputeReviewId
    const resolution = await requestJson(server.url, `/api/admin/reviews/${reviewId}/actions`, {
      body: { decision: 'approve', note: 'Creator may submit a clarified revision.' },
      token: 'demo-access.legalpixel',
    })
    assert.equal(resolution.status, 200)
    assert.equal(resolution.payload.data.metadata.outcome, 'creator_revision_allowed')

    const resolvedTask = await requestJson(server.url, `/api/tasks/${task.id}`, { method: 'GET' })
    assert.equal(resolvedTask.payload.data.status, 'In Progress')
    assert.equal(resolvedTask.payload.data.disputeStatus, 'approved')
    const submissions = await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      method: 'GET',
      token: 'demo-access.launchteam',
    })
    assert.equal(submissions.payload.data[0].status, 'revision_requested')
    assert.equal(submissions.payload.data[0].dispute.outcome, 'creator_revision_allowed')

    const pendingLedger = await requestJson(server.url, '/api/points/ledger?status=pending&limit=50', {
      method: 'GET',
      token: 'demo-access.launchteam',
    })
    assert.ok(pendingLedger.payload.data.some((entry) => entry.sourceType === 'task_escrow' && entry.sourceId === String(task.id)))
  } finally {
    await server.close()
  }
})

test('Admin rejection resolves a task dispute and releases escrow once', async () => {
  const server = await createTaskAdminNotificationAndPointsServer()
  try {
    const task = await createTask(server, { title: 'Rejected dispute lifecycle task', pointsReward: 660 }, 'demo-access.launchteam')
    await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      body: validSubmissionBody(),
      token: 'demo-access.promptlin',
    })
    await requestJson(server.url, `/api/tasks/${task.id}/review`, {
      body: { decision: 'reject', reviewNote: 'The required deliverable is absent.' },
      token: 'demo-access.launchteam',
    })
    const dispute = await requestJson(server.url, `/api/tasks/${task.id}/disputes`, {
      body: { reason: 'Please verify the submitted package.' },
      token: 'demo-access.promptlin',
    })
    const reviewId = dispute.payload.data.disputeReviewId
    const firstResolution = await requestJson(server.url, `/api/admin/reviews/${reviewId}/actions`, {
      body: { decision: 'reject', note: 'Publisher rejection is upheld.' },
      token: 'demo-access.legalpixel',
    })
    const duplicateResolution = await requestJson(server.url, `/api/admin/reviews/${reviewId}/actions`, {
      body: { decision: 'reject', note: 'Publisher rejection is upheld.' },
      token: 'demo-access.legalpixel',
    })
    assert.equal(firstResolution.status, 200)
    assert.equal(duplicateResolution.status, 200)
    assert.equal(firstResolution.payload.data.metadata.outcome, 'publisher_rejection_upheld')

    const settledLedger = await requestJson(server.url, '/api/points/ledger?status=settled&limit=50', {
      method: 'GET',
      token: 'demo-access.launchteam',
    })
    const releases = settledLedger.payload.data.filter((entry) => entry.sourceType === 'task_escrow_release' && entry.sourceId === String(task.id))
    assert.equal(releases.length, 1)
    assert.equal(releases[0].delta, 660)
  } finally {
    await server.close()
  }
})

test('POST /api/tasks/stale-submissions/sweep marks overdue submissions and allows dispute', async () => {
  const server = await createTaskAndAdminServer()
  try {
    const task = await createTask(server, {
      title: 'Stale submission integration task',
      pointsReward: 620,
    }, 'demo-access.launchteam')
    await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      body: validSubmissionBody(),
      token: 'demo-access.promptlin',
    })

    const sweep = await requestJson(server.url, '/api/tasks/stale-submissions/sweep', {
      body: { olderThanHours: 0, limit: 5, taskId: String(task.id) },
      token: 'demo-access.legalpixel',
    })

    assert.equal(sweep.status, 200)
    assert.equal(sweep.payload.data.marked, 1)
    assert.equal(sweep.payload.data.items[0].status, 'stale')

    const submissions = await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      method: 'GET',
      token: 'demo-access.launchteam',
    })
    assert.equal(submissions.payload.data[0].status, 'stale')
    assert.equal(submissions.payload.data[0].stale.olderThanHours, 0)

    const timeline = await requestJson(server.url, `/api/tasks/${task.id}/timeline`, {
      method: 'GET',
      token: 'demo-access.launchteam',
    })
    assert.equal(timeline.payload.data[0].type, 'submission_stale')

    const dispute = await requestJson(server.url, `/api/tasks/${task.id}/disputes`, {
      body: { reason: 'The submission is overdue for review and needs platform follow-up.' },
      token: 'demo-access.promptlin',
    })
    assert.equal(dispute.status, 200)
    assert.equal(dispute.payload.data.status, 'Disputed')
  } finally {
    await server.close()
  }
})

test('POST /api/tasks/:id/review requests changes without settling or releasing escrow', async () => {
  const server = await createTaskAndPointsServer()
  try {
    const task = await createTask(server, {
      title: 'Revision request integration task',
      pointsReward: 720,
    }, 'demo-access.launchteam')
    await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      body: validSubmissionBody(),
      token: 'demo-access.promptlin',
    })

    const review = await requestJson(server.url, `/api/tasks/${task.id}/review`, {
      body: { decision: 'request_changes', reviewNote: 'Add export links and tighten usage rights.' },
      token: 'demo-access.launchteam',
    })

    assert.equal(review.status, 200)
    assert.equal(review.payload.data.status, 'In Progress')
    assert.equal(review.payload.data.reviewNote, 'Add export links and tighten usage rights.')

    const submissions = await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      method: 'GET',
      token: 'demo-access.launchteam',
    })

    assert.equal(submissions.status, 200)
    assert.equal(submissions.payload.data[0].status, 'revision_requested')
    assert.equal(submissions.payload.data[0].reviewNote, 'Add export links and tighten usage rights.')
    assert.equal(submissions.payload.data[0].reviewedBy.handle, 'launchteam')

    const settledCreatorLedger = await requestJson(server.url, '/api/points/ledger?limit=50&status=settled', {
      method: 'GET',
      token: 'demo-access.promptlin',
    })
    assert.equal(settledCreatorLedger.payload.data.some((entry) => entry.sourceType === 'task_completion' && entry.sourceId === String(task.id)), false)

    const settledPublisherLedger = await requestJson(server.url, '/api/points/ledger?limit=50&status=settled', {
      method: 'GET',
      token: 'demo-access.launchteam',
    })
    assert.equal(settledPublisherLedger.payload.data.some((entry) => entry.sourceType === 'task_escrow_release' && entry.sourceId === String(task.id)), false)

    const cancelledPublisherLedger = await requestJson(server.url, '/api/points/ledger?limit=50&status=cancelled', {
      method: 'GET',
      token: 'demo-access.launchteam',
    })
    assert.equal(cancelledPublisherLedger.payload.data.some((entry) => entry.sourceType === 'task_escrow' && entry.sourceId === String(task.id)), false)
  } finally {
    await server.close()
  }
})

test('POST /api/tasks/:id/submissions accepts resubmission after requested changes', async () => {
  const server = await createTaskAndPointsServer()
  try {
    const task = await createTask(server, {
      title: 'Revision resubmission task',
      pointsReward: 640,
    }, 'demo-access.launchteam')
    await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      body: validSubmissionBody(),
      token: 'demo-access.promptlin',
    })
    await requestJson(server.url, `/api/tasks/${task.id}/review`, {
      body: { decision: 'request_changes', reviewNote: 'Add a clearer rights summary.' },
      token: 'demo-access.launchteam',
    })

    const revisedSubmission = await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      body: {
        ...validSubmissionBody(),
        content: 'Revised delivery with export links and clarified usage rights.',
        assetIds: [],
      },
      token: 'demo-access.promptlin',
    })

    assert.equal(revisedSubmission.status, 201)
    assert.equal(revisedSubmission.payload.data.status, 'Pending Review')
    assert.equal(revisedSubmission.payload.data.submission, 'Revised delivery with export links and clarified usage rights.')

    const submissions = await requestJson(server.url, `/api/tasks/${task.id}/submissions`, {
      method: 'GET',
      token: 'demo-access.launchteam',
    })

    assert.equal(submissions.payload.data.length, 2)
    assert.equal(submissions.payload.data[0].status, 'pending_review')
    assert.equal(submissions.payload.data[0].content, 'Revised delivery with export links and clarified usage rights.')
    assert.equal(submissions.payload.data[1].status, 'revision_requested')

    const approval = await requestJson(server.url, `/api/tasks/${task.id}/review`, {
      body: validReviewBody(),
      token: 'demo-access.launchteam',
    })

    assert.equal(approval.status, 200)
    assert.equal(approval.payload.data.status, 'Completed')
  } finally {
    await server.close()
  }
})

test('task admin list separates read and manage permissions', async () => {
  const server = await createTestServer()
  try {
    const denied = await requestJson(server.url, '/api/admin/tasks', { method: 'GET', token: 'demo-access.taskops' })
    assert.equal(denied.status, 403)
    assert.equal(denied.payload.error.code, 'PERMISSION_DENIED')

    const readable = await requestJson(server.url, '/api/admin/tasks?limit=2&sort=title&direction=asc', { method: 'GET', token: 'demo-access.legalpixel' })
    assert.equal(readable.status, 200)
    assert.equal(readable.payload.meta.pagination.limit, 2)
    assert.ok(readable.payload.data.every((task) => Number.isInteger(task.version)))

    const task = readable.payload.data[0]
    const manageDenied = await requestJson(server.url, `/api/admin/tasks/${task.id}/archive`, {
      token: 'demo-access.legalpixel',
      body: { expectedVersion: task.version, reasonCode: 'moderator_attempt' },
    })
    assert.equal(manageDenied.status, 403)
    assert.equal(manageDenied.payload.error.message, 'Missing permission: admin:tasks:manage')
  } finally {
    await server.close()
  }
})

test('task admin edit uses optimistic versioning and updates the public projection', async () => {
  const server = await createTestServer()
  try {
    const created = await createTask(server, { title: 'Admin editable task' }, 'demo-access.launchteam')
    const detail = await requestJson(server.url, `/api/admin/tasks/${created.id}`, { method: 'GET', token: 'demo-access.opsplus' })
    assert.equal(detail.status, 200)

    const edited = await requestJson(server.url, `/api/admin/tasks/${created.id}`, {
      method: 'PATCH',
      token: 'demo-access.opsplus',
      body: {
        expectedVersion: detail.payload.data.version,
        reasonCode: 'fix_task_brief',
        note: 'Corrected acceptance wording.',
        title: 'Admin edited task',
        acceptanceRules: 'Submit the corrected package and evidence.',
        visibility: 'community',
      },
    })
    assert.equal(edited.status, 200)
    assert.equal(edited.payload.data.version, detail.payload.data.version + 1)
    assert.equal(edited.payload.data.title, 'Admin edited task')

    const stale = await requestJson(server.url, `/api/admin/tasks/${created.id}`, {
      method: 'PATCH',
      token: 'demo-access.opsplus',
      body: { expectedVersion: detail.payload.data.version, reasonCode: 'stale_edit', title: 'Should not win' },
    })
    assert.equal(stale.status, 409)
    assert.equal(stale.payload.error.code, 'TASK_VERSION_CONFLICT')

    const publicDetail = await requestJson(server.url, `/api/tasks/${created.id}`, { method: 'GET' })
    assert.equal(publicDetail.status, 200)
    assert.equal(publicDetail.payload.data.title, 'Admin edited task')
    assert.deepEqual(publicDetail.payload.data.requirements, ['Submit the corrected package and evidence.'])
  } finally {
    await server.close()
  }
})

test('task admin archive hides public tasks and restore makes them visible again', async () => {
  const server = await createTestServer()
  try {
    const created = await createTask(server, { title: 'Archive visibility task' }, 'demo-access.launchteam')
    const detail = await requestJson(server.url, `/api/admin/tasks/${created.id}`, { method: 'GET', token: 'demo-access.opsplus' })
    const archived = await requestJson(server.url, `/api/admin/tasks/${created.id}/archive`, {
      token: 'demo-access.opsplus',
      body: { expectedVersion: detail.payload.data.version, reasonCode: 'duplicate_listing', note: 'Archive duplicate.' },
    })
    assert.equal(archived.status, 200)
    assert.ok(archived.payload.data.archivedAt)

    const hidden = await requestJson(server.url, `/api/tasks/${created.id}`, { method: 'GET' })
    assert.equal(hidden.status, 404)
    const claimHidden = await requestJson(server.url, `/api/tasks/${created.id}/claim`, { token: 'demo-access.promptlin' })
    assert.equal(claimHidden.status, 404)
    const proposalHidden = await requestJson(server.url, `/api/tasks/${created.id}/proposals`, { token: 'demo-access.promptlin', body: validProposalBody() })
    assert.equal(proposalHidden.status, 404)

    const restored = await requestJson(server.url, `/api/admin/tasks/${created.id}/restore`, {
      token: 'demo-access.opsplus',
      body: { expectedVersion: archived.payload.data.version, reasonCode: 'duplicate_resolved' },
    })
    assert.equal(restored.status, 200)
    assert.equal(restored.payload.data.archivedAt, null)
    assert.equal((await requestJson(server.url, `/api/tasks/${created.id}`, { method: 'GET' })).status, 200)

    await requestJson(server.url, `/api/tasks/${created.id}/claim`, { token: 'demo-access.promptlin' })
    const active = await requestJson(server.url, `/api/admin/tasks/${created.id}`, { method: 'GET', token: 'demo-access.opsplus' })
    const blocked = await requestJson(server.url, `/api/admin/tasks/${created.id}/archive`, {
      token: 'demo-access.opsplus',
      body: { expectedVersion: active.payload.data.version, reasonCode: 'hide_active_work' },
    })
    assert.equal(blocked.status, 409)
    assert.equal(blocked.payload.error.code, 'TASK_ARCHIVE_NOT_ALLOWED')
  } finally {
    await server.close()
  }
})

test('task admin cancellation releases publisher escrow once', async () => {
  const server = await createTaskAdminNotificationAndPointsServer()
  try {
    const created = await createTask(server, { title: 'Admin cancel escrow task', pointsReward: 345 }, 'demo-access.launchteam')
    const detail = await requestJson(server.url, `/api/admin/tasks/${created.id}`, { method: 'GET', token: 'demo-access.opsplus' })
    const cancelled = await requestJson(server.url, `/api/admin/tasks/${created.id}/transitions`, {
      token: 'demo-access.opsplus',
      body: { expectedVersion: detail.payload.data.version, action: 'cancel', reasonCode: 'publisher_request', note: 'Publisher verified cancellation.' },
    })
    assert.equal(cancelled.status, 200)
    assert.equal(cancelled.payload.data.status, 'cancelled')

    const ledger = await requestJson(server.url, '/api/points/ledger?limit=100', { method: 'GET', token: 'demo-access.launchteam' })
    const releases = ledger.payload.data.filter((entry) => entry.sourceType === 'task_escrow_release' && entry.sourceId === String(created.id))
    assert.equal(releases.length, 1)
    assert.equal(releases[0].delta, 345)

    const repeated = await requestJson(server.url, `/api/admin/tasks/${created.id}/transitions`, {
      token: 'demo-access.opsplus',
      body: { expectedVersion: detail.payload.data.version, action: 'cancel', reasonCode: 'publisher_request' },
    })
    assert.equal(repeated.status, 409)
    assert.equal(repeated.payload.error.code, 'TASK_VERSION_CONFLICT')
  } finally {
    await server.close()
  }
})

test('task admin bulk disposition previews, partially skips, and replays idempotently', async () => {
  const server = await createTestServer()
  try {
    const first = await createTask(server, { title: 'Bulk archive A' }, 'demo-access.launchteam')
    const second = await createTask(server, { title: 'Bulk archive B' }, 'demo-access.launchteam')
    await requestJson(server.url, `/api/tasks/${second.id}/claim`, { token: 'demo-access.promptlin' })
    const targetIds = [first.id, second.id, 'task-missing-admin-bulk']
    const preview = await requestJson(server.url, '/api/admin/tasks/bulk/preview', {
      token: 'demo-access.opsplus',
      body: { action: 'archive', targetIds },
    })
    assert.equal(preview.status, 200)
    assert.equal(preview.payload.data.eligibleCount, 1)
    assert.equal(preview.payload.data.skippedCount, 2)

    const body = {
      action: 'archive',
      targetIds,
      targetHash: preview.payload.data.targetHash,
      confirmationText: preview.payload.data.requiredConfirmationText,
      idempotencyKey: `task-bulk-${first.id}`,
      reasonCode: 'duplicate_cleanup',
      note: 'Archive duplicate task records.',
    }
    const executed = await requestJson(server.url, '/api/admin/tasks/bulk', { token: 'demo-access.opsplus', body })
    assert.equal(executed.status, 200)
    assert.equal(executed.payload.data.succeededCount, 1)
    assert.equal(executed.payload.data.skippedCount, 2)

    const replayed = await requestJson(server.url, '/api/admin/tasks/bulk', { token: 'demo-access.opsplus', body })
    assert.equal(replayed.status, 200)
    assert.deepEqual(replayed.payload.data, executed.payload.data)

    const conflictingReplay = await requestJson(server.url, '/api/admin/tasks/bulk', {
      token: 'demo-access.opsplus',
      body: { ...body, reasonCode: 'different_reason' },
    })
    assert.equal(conflictingReplay.status, 409)
    assert.equal(conflictingReplay.payload.error.code, 'TASK_BULK_IDEMPOTENCY_CONFLICT')
  } finally {
    await server.close()
  }
})
