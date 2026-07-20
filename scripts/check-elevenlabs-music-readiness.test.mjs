import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

test('fixture Music readiness passes without exposing its credential', () => {
  const result = spawnSync(process.execPath, ['scripts/check-elevenlabs-music-readiness.mjs', '--profile=fixture', '--mode=preflight'], { cwd: process.cwd(), encoding: 'utf8', env: {} })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /PASS credential is present/)
  assert.equal(result.stdout.includes('music-readiness-fixture-key'), false)
})

test('environment Music readiness fails closed without staging evidence', () => {
  const result = spawnSync(process.execPath, ['scripts/check-elevenlabs-music-readiness.mjs', '--profile=env', '--mode=preflight'], { cwd: process.cwd(), encoding: 'utf8', env: {} })
  assert.equal(result.status, 1)
  assert.match(result.stdout, /FAIL credential is present/)
})
