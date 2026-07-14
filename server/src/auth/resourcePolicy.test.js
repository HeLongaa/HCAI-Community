import assert from 'node:assert/strict'
import test from 'node:test'
import { authorizeResource, redactResource, requireResourceAccess, resourcePolicyRegistry } from './resourcePolicy.js'

const owner = { id: 'user-owner', handle: 'owner', permissions: [] }
const stranger = { id: 'user-stranger', handle: 'stranger', permissions: [] }

test('every registered personal resource denies unauthorized read and write', () => {
  for (const entry of resourcePolicyRegistry) {
    const resource = Object.fromEntries([...entry.ownerFields, ...entry.participantFields].map((field) => [field, 'user-owner']))
    const read = authorizeResource({ resourceType: entry.resourceType, action: 'read', actor: stranger, resource, allowPublic: false })
    const write = authorizeResource({ resourceType: entry.resourceType, action: 'write', actor: stranger, resource })
    assert.equal(read.allowed, false, `${entry.resourceType} read`)
    assert.equal(write.allowed, false, `${entry.resourceType} write`)
  }
})

test('owner and explicit elevated permissions are action scoped', () => {
  assert.equal(authorizeResource({ resourceType: 'media_asset', action: 'write', actor: owner, resource: { ownerId: owner.id } }).reason, 'owner')
  const auditor = { ...stranger, permissions: ['admin:queue:read'] }
  assert.equal(authorizeResource({ resourceType: 'media_asset', action: 'read', actor: auditor, resource: { ownerId: owner.id }, allowPublic: false }).reason, 'elevated')
  assert.equal(authorizeResource({ resourceType: 'media_asset', action: 'write', actor: auditor, resource: { ownerId: owner.id } }).allowed, false)
  assert.equal(authorizeResource({ resourceType: 'missing', action: 'read', actor: owner }).allowed, false)
  assert.equal(authorizeResource({ resourceType: 'media_asset', action: 'delete', actor: owner }).allowed, false)
})

test('user resources hide denial while known admin resources return forbidden', () => {
  assert.throws(() => requireResourceAccess({ resourceType: 'chat_conversation', action: 'read', actor: stranger, resource: { ownerId: owner.id } }), (error) => error.statusCode === 404)
  assert.throws(() => requireResourceAccess({ resourceType: 'admin_resource', action: 'write', actor: stranger }), (error) => error.statusCode === 403)
})

test('redaction removes registered fields recursively without mutating input', () => {
  const input = { id: 'asset-1', storageKey: 'private/key', nested: { signedUrl: 'https://secret' } }
  assert.deepEqual(redactResource('media_asset', input), { id: 'asset-1', storageKey: '[REDACTED]', nested: { signedUrl: '[REDACTED]' } })
  assert.equal(input.storageKey, 'private/key')
})
