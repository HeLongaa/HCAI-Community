import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildConfigurationRetentionSummary,
  configurationRetentionCutoff,
  configurationRetentionSweepLimit,
  isConfigurationRetentionSummary,
} from './configurationRetention.js'

test('configuration retention freezes 365 days and bounded batches', () => {
  assert.equal(configurationRetentionCutoff(new Date('2026-07-29T00:00:00.000Z')).toISOString(), '2025-07-29T00:00:00.000Z')
  assert.equal(configurationRetentionSweepLimit('0'), 100)
  assert.equal(configurationRetentionSweepLimit('9999'), 500)
})

test('configuration retention summary contains only path hashes, types, counts, and value hashes', () => {
  const secret = 'must-never-survive-retention'
  const previous = { enabled: false, nested: { credential: 'old-secret' } }
  const value = { enabled: true, nested: { credential: secret }, added: [1, 2] }
  const summary = buildConfigurationRetentionSummary({ value, previousValue: previous })
  assert.equal(isConfigurationRetentionSummary(summary), true)
  assert.equal(summary.operations.added > 0, true)
  assert.equal(summary.operations.changed > 0, true)
  assert.equal(JSON.stringify(summary).includes(secret), false)
  assert.equal(JSON.stringify(summary).includes('credential'), false)
  assert.equal(JSON.stringify(summary).includes('old-secret'), false)
})

test('configuration retention summary is deterministic and bounded', () => {
  const left = buildConfigurationRetentionSummary({ value: { b: 2, a: 1 } })
  const right = buildConfigurationRetentionSummary({ value: { a: 1, b: 2 } })
  assert.deepEqual(left, right)
  const wide = buildConfigurationRetentionSummary({ value: Object.fromEntries(Array.from({ length: 1000 }, (_, index) => [`field-${index}`, index])) })
  assert.equal(wide.pathHashes.length, 128)
  assert.equal(wide.truncated, true)
})
