import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertProductionPersistence,
  shouldAutoSeedPrisma,
  shouldLoadDemoRepository,
} from './runtimePolicy.js'

test('production requires PostgreSQL and disables demo repository fallback', () => {
  assert.throws(() => assertProductionPersistence({ NODE_ENV: 'production', DATABASE_URL: '' }), /PRODUCTION_DATABASE_REQUIRED/)
  assert.equal(shouldLoadDemoRepository({ NODE_ENV: 'production' }), false)
  assert.equal(shouldAutoSeedPrisma({ NODE_ENV: 'production', DEMO_DATABASE_AUTOSEED: 'true' }), false)
})

test('development keeps explicit fixture repository and seed controls', () => {
  assert.doesNotThrow(() => assertProductionPersistence({ NODE_ENV: 'development' }))
  assert.equal(shouldLoadDemoRepository({ NODE_ENV: 'test' }), true)
  assert.equal(shouldAutoSeedPrisma({ NODE_ENV: 'test' }), true)
  assert.equal(shouldAutoSeedPrisma({ NODE_ENV: 'test', DEMO_DATABASE_AUTOSEED: 'false' }), false)
})
