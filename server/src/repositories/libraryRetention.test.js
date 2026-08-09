import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeedRepository } from './seedRepository.js'

test('seed private Library retention deletes only bounded items after the 30-day recovery window', async () => {
  const repository = createSeedRepository()
  const actor = { id: 'demo-user-creator', handle: 'promptlin' }
  const first = await repository.library.save({ title: 'First', text: 'First', type: 'Prompt', source: 'User', sourceType: 'post' }, actor)
  const second = await repository.library.save({ title: 'Second', text: 'Second', type: 'Prompt', source: 'User', sourceType: 'post' }, actor)
  const firstDeleted = await repository.library.softDelete(first.id, { expectedVersion: first.version, reasonCode: 'owner_requested' }, actor)
  const secondDeleted = await repository.library.softDelete(second.id, { expectedVersion: second.version, reasonCode: 'owner_requested' }, actor)
  const deletionTime = new Date(firstDeleted.deletedAt)

  const premature = await repository.library.sweepRetention({ now: new Date(deletionTime.getTime() + 29 * 86_400_000), limit: 10 })
  assert.equal(premature.deleted, 0)

  const bounded = await repository.library.sweepRetention({ now: new Date(deletionTime.getTime() + 31 * 86_400_000), limit: 1 })
  assert.deepEqual(bounded, { policyId: 'private_library_delete_plus_30d', inspected: 1, deleted: 1 })
  assert.equal(await repository.library.restore(first.id, { expectedVersion: firstDeleted.version, reasonCode: 'owner_restore' }, actor), null)
  assert.ok(await repository.library.restore(second.id, { expectedVersion: secondDeleted.version, reasonCode: 'owner_restore' }, actor))
})
