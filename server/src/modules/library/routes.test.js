import assert from 'node:assert/strict'
import test from 'node:test'

import { createRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { registerLibraryRoutes } from './routes.js'

const createTestServer = () => createRouteTestServer(registerLibraryRoutes)

const validLibraryBody = () => ({
  title: 'Reusable acceptance checklist',
  text: 'Script, preview, revision log, final files, and rights note.',
  type: 'Template',
  source: 'Community',
  sourceId: 'post-1',
  metadata: { postId: 1 },
})

const validConvertBody = () => ({
  acceptanceRules: 'Turn this saved item into a scoped delivery brief.',
  pointsReward: 350,
  category: 'Prompt',
})

const saveLibraryItem = async (server, token = 'demo-access.promptlin', overrides = {}) => {
  const result = await requestJson(server.url, '/api/library/items', {
    body: { ...validLibraryBody(), ...overrides },
    token,
  })
  assert.equal(result.status, 201)
  return result.payload.data
}

test('GET /api/library paginates library items', async () => {
  const server = await createTestServer()
  try {
    const firstPage = await requestJson(server.url, '/api/library?limit=2', { method: 'GET' })

    assert.equal(firstPage.status, 200)
    assert.equal(firstPage.payload.data.length, 2)
    assert.equal(firstPage.payload.meta.pagination.limit, 2)

    if (firstPage.payload.meta.pagination.nextCursor) {
      const secondPage = await requestJson(server.url, `/api/library?limit=2&cursor=${firstPage.payload.meta.pagination.nextCursor}`, {
        method: 'GET',
      })
      assert.equal(secondPage.status, 200)
      assert.notDeepEqual(secondPage.payload.data.map((item) => item.id), firstPage.payload.data.map((item) => item.id))
    }
  } finally {
    await server.close()
  }
})

test('GET /api/library filters by type and validates limit', async () => {
  const server = await createTestServer()
  try {
    const filtered = await requestJson(server.url, '/api/library?type=Prompt&limit=3', { method: 'GET' })

    assert.equal(filtered.status, 200)
    assert.ok(filtered.payload.data.every((item) => item.type === 'Prompt'))

    const invalid = await requestJson(server.url, '/api/library?limit=101', { method: 'GET' })
    assert.equal(invalid.status, 400)
    assert.equal(invalid.payload.error.code, 'VALIDATION_FAILED')
    assert.equal(invalid.payload.error.message, 'limit must be an integer between 1 and 100')
  } finally {
    await server.close()
  }
})

test('POST /api/library/items returns AUTH_REQUIRED when missing auth', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/library/items', {
      body: validLibraryBody(),
    })

    assert.equal(status, 401)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'AUTH_REQUIRED')
  } finally {
    await server.close()
  }
})

test('POST /api/library/items returns VALIDATION_FAILED for missing text', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/library/items', {
      body: { ...validLibraryBody(), text: '' },
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 400)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'VALIDATION_FAILED')
    assert.equal(payload.error.message, 'text is required')
  } finally {
    await server.close()
  }
})

test('POST /api/library/items saves an item and returns data envelope', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/library/items', {
      body: validLibraryBody(),
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 201)
    assert.ok(payload.data)
    assert.equal(payload.error, undefined)
    assert.equal(payload.data.title, validLibraryBody().title)
    assert.equal(payload.data.text, validLibraryBody().text)
    assert.equal(payload.data.sourceId, validLibraryBody().sourceId)
  } finally {
    await server.close()
  }
})

test('POST /api/library/items/:id/convert-to-task requires task:create permission', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/library/items/library-1/convert-to-task', {
      body: validConvertBody(),
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

test('POST /api/library/items/:id/convert-to-task creates a task from a saved item', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/library/items/library-1/convert-to-task', {
      body: validConvertBody(),
      token: 'demo-access.taskops',
    })

    assert.equal(status, 201)
    assert.ok(payload.data)
    assert.equal(payload.error, undefined)
    assert.equal(payload.data.publisher, 'taskops')
    assert.equal(payload.data.category, validConvertBody().category)
    assert.deepEqual(payload.data.requirements, [validConvertBody().acceptanceRules])
  } finally {
    await server.close()
  }
})

test('POST /api/library/items/:id/convert-to-task hides items owned by another user', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/library/items/library-1/convert-to-task', {
      body: validConvertBody(),
      token: 'demo-access.launchteam',
    })

    assert.equal(status, 404)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'NOT_FOUND')
  } finally {
    await server.close()
  }
})

test('POST /api/library/items/:id/convert-to-task allows admin ownership bypass', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/library/items/library-1/convert-to-task', {
      body: validConvertBody(),
      token: 'demo-access.opsplus',
    })

    assert.equal(status, 201)
    assert.equal(payload.error, undefined)
    assert.equal(payload.data.publisher, 'opsplus')
  } finally {
    await server.close()
  }
})

test('POST /api/library/items/:id/send-to-workspace requires authentication', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/library/items/library-1/send-to-workspace')

    assert.equal(status, 401)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'AUTH_REQUIRED')
  } finally {
    await server.close()
  }
})

test('POST /api/library/items/:id/send-to-workspace returns NOT_FOUND for missing items', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/library/items/missing-item/send-to-workspace', {
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 404)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'NOT_FOUND')
  } finally {
    await server.close()
  }
})

test('POST /api/library/items/:id/send-to-workspace hides items owned by another user', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/library/items/library-1/send-to-workspace', {
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 404)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'NOT_FOUND')
  } finally {
    await server.close()
  }
})

test('POST /api/library/items/:id/send-to-workspace returns a workspace draft', async () => {
  const server = await createTestServer()
  try {
    const item = await saveLibraryItem(server, 'demo-access.promptlin')
    const { status, payload } = await requestJson(server.url, `/api/library/items/${item.id}/send-to-workspace`, {
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 200)
    assert.equal(payload.error, undefined)
    assert.equal(payload.data.item.id, item.id)
    assert.equal(payload.data.workspaceDraft.owner, 'promptlin')
    assert.equal(payload.data.workspaceDraft.title, payload.data.item.title)
  } finally {
    await server.close()
  }
})

test('POST /api/library/items/:id/send-to-workspace allows admin ownership bypass', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/library/items/library-1/send-to-workspace', {
      token: 'demo-access.opsplus',
    })

    assert.equal(status, 200)
    assert.equal(payload.error, undefined)
    assert.equal(payload.data.item.id, 'library-1')
    assert.equal(payload.data.workspaceDraft.owner, 'opsplus')
  } finally {
    await server.close()
  }
})
