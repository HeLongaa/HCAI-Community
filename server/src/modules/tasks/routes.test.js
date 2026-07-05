import assert from 'node:assert/strict'
import test from 'node:test'

import { createRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { registerPointsRoutes } from '../points/routes.js'
import { registerTaskRoutes } from './routes.js'

const createTestServer = () => createRouteTestServer(registerTaskRoutes)
const createTaskAndPointsServer = () => createRouteTestServer(registerTaskRoutes, registerPointsRoutes)

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
  assetIds: ['asset-1'],
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
      token: 'demo-access.promptlin',
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
    assert.ok(release)
    assert.equal(release.description, 'Task reward released: Rejected settlement integration task')
    assert.equal(release.delta, 810)

    const cancelledLedger = await requestJson(server.url, '/api/points/ledger?limit=50&status=cancelled', {
      method: 'GET',
      token: 'demo-access.launchteam',
    })
    const cancelledEscrow = cancelledLedger.payload.data.find((entry) => entry.sourceType === 'task_escrow' && entry.sourceId === String(task.id))
    assert.ok(cancelledEscrow)
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
        assetIds: ['asset-2'],
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
