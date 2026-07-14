import assert from 'node:assert/strict'
import test from 'node:test'

import { buildRuntimeConfigSnapshot, validateRuntimeConfigValue } from './runtimeConfigRegistry.js'

test('runtime config registry validates registered defaults', () => {
  const snapshot = buildRuntimeConfigSnapshot()
  assert.equal(snapshot['auth.session'].value.refreshTtlDays, 30)
  assert.equal(snapshot['media.scan'].valueSchemaVersion, 1)
})

test('runtime config registry rejects unknown keys and inline secrets', () => {
  assert.throws(
    () => validateRuntimeConfigValue('missing.key', {}),
    /configuration key is not registered/,
  )
  assert.throws(
    () => validateRuntimeConfigValue('storage.objects', { driver: 's3', apiKey: 'plain-secret' }),
    /apiKey must be a secretref/,
  )
  assert.equal(
    validateRuntimeConfigValue('storage.objects', { driver: 's3', apiKey: 'secretref://prod/storage/access-key' }).value.apiKey,
    'secretref://prod/storage/access-key',
  )
})
