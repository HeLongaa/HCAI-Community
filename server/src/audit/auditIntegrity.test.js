import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appendSeedAuditIntegrity,
  buildPortableAuditExport,
  verifyPortableAuditExport,
  verifySeedAuditChain,
} from './auditIntegrity.js'

const event = (id, metadata = null) => ({
  id,
  actorType: 'user',
  actorId: 'admin-1',
  action: 'admin.test',
  resourceType: 'test_resource',
  resourceId: id,
  metadata,
  createdAt: `2026-07-15T00:00:0${id}.000Z`,
})

test('seed audit chain detects changed content and broken links', () => {
  const first = appendSeedAuditIntegrity(event('1', { safe: true }))
  const second = appendSeedAuditIntegrity(event('2'), first)
  assert.equal(verifySeedAuditChain([second, first]).status, 'complete')
  assert.equal(verifySeedAuditChain([{ ...first, action: 'tampered' }, second]).status, 'broken')
  assert.equal(verifySeedAuditChain([first, { ...second, previousHash: 'broken' }]).status, 'broken')
})

test('portable export detects content changes, omissions, and reordering', () => {
  const artifact = buildPortableAuditExport({ events: [event('3'), event('2'), event('1')], query: { limit: 3 } })
  assert.equal(verifyPortableAuditExport(artifact).status, 'complete')

  const changed = structuredClone(artifact)
  changed.events[1].action = 'tampered'
  assert.equal(verifyPortableAuditExport(changed).status, 'broken')

  const omitted = structuredClone(artifact)
  omitted.events.splice(1, 1)
  assert.equal(verifyPortableAuditExport(omitted).status, 'broken')

  const reordered = structuredClone(artifact)
  ;[reordered.events[0], reordered.events[1]] = [reordered.events[1], reordered.events[0]]
  assert.equal(verifyPortableAuditExport(reordered).status, 'broken')

  const changedManifest = structuredClone(artifact)
  changedManifest.manifest.query.action = 'tampered'
  assert.equal(verifyPortableAuditExport(changedManifest).status, 'broken')
})
