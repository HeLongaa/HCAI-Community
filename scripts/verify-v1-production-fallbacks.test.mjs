import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { verifyFallbackDisposition } from './verify-v1-production-fallbacks.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'))
const fixture = () => ({
  inventory: structuredClone(readJson('config/v1-runtime-surfaces.json')),
  matrix: structuredClone(readJson('config/v1-production-fallback-dispositions.json')),
  evidenceExists: () => true,
})

test('fallback completion remains explicitly scoped and does not claim global production approval', () => {
  const input = fixture()
  const result = verifyFallbackDisposition(input)
  assert.equal(result.fallbackDispositionComplete, true)
  assert.deepEqual(result.failures, [])
  assert.equal(input.inventory.productionPolicy.globalProductionApproval, 'governed_by_release_scope_and_domain_gates')
  assert.equal(Object.hasOwn(input.inventory.productionPolicy, 'productionReady'), false)
})

test('ambiguous global readiness fields fail the fallback-only contract', () => {
  const input = fixture()
  input.inventory.productionPolicy.productionReady = true
  input.matrix.policy.productionReadyRequiresZeroReleaseBlockers = true
  const result = verifyFallbackDisposition(input)
  assert.equal(result.failures.some((failure) => failure.includes('ambiguous productionReady field')), true)
  assert.equal(result.failures.some((failure) => failure.includes('ambiguous productionReady policy')), true)
})

test('fallback completion cannot coexist with an unresolved fallback blocker', () => {
  const input = fixture()
  input.inventory.surfaces[0].classification = 'release_blocker'
  const result = verifyFallbackDisposition(input)
  assert.equal(result.failures.some((failure) => failure.includes('fallbackDispositionComplete cannot be true')), true)
})

test('legacy global-looking CLI requirement is rejected', () => {
  const result = verifyFallbackDisposition({ ...fixture(), legacyRequireReady: true })
  assert.equal(result.failures.includes('--require-ready is ambiguous and unsupported; use --require-dispositions-complete'), true)
})
