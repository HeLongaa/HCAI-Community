import assert from 'node:assert/strict'
import test from 'node:test'
import { createAdminMutationAuditHook, getAdminMutationClassification, sanitizeAdminAuditMetadata } from './adminMutationAudit.js'

test('all classified mutations expose stable evidence metadata', async () => {
  const recorded = []
  const hook = createAdminMutationAuditHook({ recordAttempt: async (event) => recorded.push(event) })
  const route = getAdminMutationClassification('PUT', '/api/admin/roles/:role/permissions')
  await hook({ route, request: { method: 'PUT' }, context: { requestId: 'request-1', user: { id: 'admin-1' }, params: { role: 'member' }, query: {} } })
  assert.equal(recorded[0].resourceId, 'member')
  assert.equal(recorded[0].metadata.reasonCode, 'role_permissions_update')
  assert.equal(recorded[0].metadata.outcome, 'attempted')
  assert.match(recorded[0].metadata.beforeHash, /^[a-f0-9]{64}$/)
})

test('audit sanitizer removes secrets prompts Provider payloads and URLs', () => {
  const safe = sanitizeAdminAuditMetadata({ reasonCode: 'manual', token: 'secret', prompt: 'private', providerPayload: { raw: true }, nested: { signedUrl: 'https://secret', count: 2 } })
  assert.deepEqual(safe, { reasonCode: 'manual', nested: { count: 2 } })
})

test('mandatory audit failure rejects mutation before handler execution', async () => {
  const hook = createAdminMutationAuditHook({ recordAttempt: async () => { throw new Error('audit down') } })
  await assert.rejects(() => hook({ route: getAdminMutationClassification('POST', '/api/admin/points/adjustments'), request: { method: 'POST' }, context: { user: { id: 'admin-1' }, params: {}, query: {} } }), /audit down/)
})
