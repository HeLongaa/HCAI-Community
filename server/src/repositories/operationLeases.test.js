import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeedRepository } from './seedRepository.js'

test('seed operation leases acquire, block contenders, renew, and release', async () => {
  const repository = createSeedRepository()
  const key = `lease-${Date.now()}-basic`

  const acquired = await repository.operationLeases.acquire({
    key,
    ownerId: 'worker-a',
    ttlSeconds: 60,
    metadata: { jobId: 'sample' },
  })
  assert.equal(acquired.acquired, true)
  assert.equal(acquired.ownerId, 'worker-a')
  assert.equal(acquired.metadata.jobId, 'sample')
  assert.ok(acquired.token)

  const contender = await repository.operationLeases.acquire({
    key,
    ownerId: 'worker-b',
    ttlSeconds: 60,
  })
  assert.equal(contender.acquired, false)
  assert.equal(contender.reason, 'active_lease')
  assert.equal(contender.ownerId, 'worker-a')

  const renewed = await repository.operationLeases.renew({
    key,
    token: acquired.token,
    ttlSeconds: 60,
  })
  assert.equal(renewed.renewed, true)
  assert.ok(renewed.expiresAt)

  const released = await repository.operationLeases.release({
    key,
    token: acquired.token,
  })
  assert.equal(released.released, true)

  const reacquired = await repository.operationLeases.acquire({
    key,
    ownerId: 'worker-b',
    ttlSeconds: 60,
  })
  assert.equal(reacquired.acquired, true)
  assert.equal(reacquired.ownerId, 'worker-b')
})

test('seed operation leases recover expired leases', async () => {
  const repository = createSeedRepository()
  const key = `lease-${Date.now()}-expired`

  const first = await repository.operationLeases.acquire({
    key,
    ownerId: 'worker-a',
    ttlSeconds: 1,
  })
  assert.equal(first.acquired, true)

  await new Promise((resolve) => setTimeout(resolve, 1100))

  const recovered = await repository.operationLeases.acquire({
    key,
    ownerId: 'worker-b',
    ttlSeconds: 60,
  })
  assert.equal(recovered.acquired, true)
  assert.equal(recovered.recoveredExpired, true)
  assert.equal(recovered.ownerId, 'worker-b')
})

test('seed operation lease retention prunes only a bounded expired or released prefix after seven days', async () => {
  const repository = createSeedRepository()
  const released = await repository.operationLeases.acquire({ key: 'retention-released', ownerId: 'worker-a', ttlSeconds: 60 })
  await repository.operationLeases.release({ key: released.key, token: released.token })
  await repository.operationLeases.acquire({ key: 'retention-expired', ownerId: 'worker-b', ttlSeconds: 1 })
  await repository.operationLeases.acquire({ key: 'retention-fresh', ownerId: 'worker-c', ttlSeconds: 60 })
  const base = new Date(released.releasedAt ?? Date.now())

  const premature = await repository.operationLeases.sweepRetention({ now: new Date(base.getTime() + 6 * 86_400_000), limit: 10 })
  assert.equal(premature.deleted, 0)

  const first = await repository.operationLeases.sweepRetention({ now: new Date(base.getTime() + 8 * 86_400_000), limit: 1 })
  assert.equal(first.policyId, 'lease_expiry_plus_7d')
  assert.equal(first.deleted, 1)
  const second = await repository.operationLeases.sweepRetention({ now: new Date(base.getTime() + 8 * 86_400_000), limit: 1 })
  assert.equal(second.deleted, 1)
  const third = await repository.operationLeases.sweepRetention({ now: new Date(base.getTime() + 8 * 86_400_000), limit: 1 })
  assert.equal(third.deleted, 1)

  const reacquired = await repository.operationLeases.acquire({ key: 'retention-released', ownerId: 'worker-d', ttlSeconds: 60 })
  assert.equal(reacquired.acquired, true)
  assert.equal(reacquired.recoveredExpired, false)
})
