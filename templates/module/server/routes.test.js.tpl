import assert from 'node:assert/strict'
import test from 'node:test'

import { register{{pascalName}}Routes } from './routes.js'

test('{{displayName}} registers its read and mutation API skeleton', () => {
  const routes = []
  register{{pascalName}}Routes({ add: (method, path, handler) => routes.push({ method, path, handler }) })
  assert.deepEqual(routes.map(({ method, path }) => `${method} ${path}`), [
    'GET /api/{{routeSegment}}',
    'POST /api/{{routeSegment}}',
  ])
})
