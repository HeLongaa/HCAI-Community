import assert from 'node:assert/strict'
import test from 'node:test'
import { isProviderLifecycleSetTerminal, providerLifecycleRetentionCutoff, providerLifecycleRetentionSweepLimit, retainedProviderKey, retainProviderJsonEvidence } from './providerLifecycleRetention.js'

test('Provider lifecycle retention uses a bounded 180-day terminal policy', () => {
  assert.equal(providerLifecycleRetentionCutoff(new Date('2028-07-28T00:00:00.000Z')).toISOString(), '2028-01-30T00:00:00.000Z')
  assert.equal(providerLifecycleRetentionSweepLimit(0), 100)
  assert.equal(providerLifecycleRetentionSweepLimit(9999), 500)
  assert.equal(isProviderLifecycleSetTerminal({ operations: [{ status: 'completed', sideEffectsComplete: true }], mutations: [{ status: 'failed' }], ingestions: [{ status: 'completed' }], retries: [{ status: 'cleared' }] }), true)
  assert.equal(isProviderLifecycleSetTerminal({ operations: [{ status: 'running', sideEffectsComplete: false }] }), false)
})

test('Provider lifecycle retention keeps deterministic hashes and counts without raw JSON', () => {
  assert.match(retainedProviderKey('replay', 'secret-key'), /^retained_replay_[a-f0-9]{32}$/)
  assert.deepEqual(retainProviderJsonEvidence({ operations: [{ id: 'private' }, { id: 'private-2' }] }), {
    retained: true,
    digest: '3ec1248909aaa768e6b45cdcb8afeae8548dd1394217eeac88ed68e77cf99b8a',
    operationCount: 2,
  })
})
