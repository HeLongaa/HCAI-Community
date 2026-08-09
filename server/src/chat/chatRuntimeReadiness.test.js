import assert from 'node:assert/strict'
import test from 'node:test'

import { readChatRuntimeReadiness } from './chatRuntimeReadiness.js'

const actor = { id: 'user-readiness', handle: 'readiness', role: 'member' }
const now = new Date('2026-08-09T01:00:00.000Z')
const noRoute = async () => ({
  checkedAt: now.toISOString(),
  ready: false,
  reasonCode: 'no_active_route_policy',
  attempts: [],
  checks: null,
})

test('Chat runtime readiness exposes demo fallback only when dispatch has no active route policy', async () => {
  let readinessInput = null
  const result = await readChatRuntimeReadiness({
    repositories: {},
    source: { CREATIVE_PROVIDER_RUNTIME_ENV: 'staging' },
    runtime: { mode: 'mock' },
    actor,
    now,
    readinessResolver: async (input) => {
      readinessInput = input
      return noRoute()
    },
  })
  assert.deepEqual(result, {
    availability: 'demo',
    reasonCode: 'mock_runtime',
    checkedAt: now.toISOString(),
    runtime: { id: 'mock-chat', label: 'Mock Chat Runtime', kind: 'demo' },
  })
  assert.equal(readinessInput.subjectKey, actor.id)
  assert.equal(readinessInput.role, actor.role)
})

test('Chat runtime readiness reports disabled and governed route failures as unavailable', async () => {
  const disabled = await readChatRuntimeReadiness({
    repositories: {},
    source: { CREATIVE_PROVIDER_RUNTIME_ENV: 'staging' },
    runtime: { mode: 'disabled' },
    actor,
    now,
    readinessResolver: noRoute,
  })
  assert.equal(disabled.availability, 'unavailable')
  assert.equal(disabled.reasonCode, 'chat_provider_disabled')

  const blocked = await readChatRuntimeReadiness({
    repositories: {},
    source: { CREATIVE_PROVIDER_RUNTIME_ENV: 'staging' },
    runtime: { mode: 'mock' },
    actor,
    now,
    readinessResolver: async () => ({
      checkedAt: now.toISOString(),
      ready: false,
      reasonCode: 'all_candidates_blocked',
      attempts: [{ selected: false, reasonCode: 'provider_secret_ref_missing' }],
      checks: null,
    }),
  })
  assert.equal(blocked.availability, 'unavailable')
  assert.equal(blocked.reasonCode, 'no_approved_runtime')
  assert.equal(blocked.runtime, null)
})

test('Chat runtime readiness projects a safe routed model identity', async () => {
  const result = await readChatRuntimeReadiness({
    repositories: {},
    source: { CREATIVE_PROVIDER_RUNTIME_ENV: 'staging' },
    runtime: { mode: 'disabled' },
    actor,
    now,
    readinessResolver: async () => ({
      checkedAt: now.toISOString(),
      ready: true,
      reasonCode: null,
      attempts: [{ selected: true, modelKey: 'openai-chat' }],
      checks: {
        model: { key: 'openai-chat' },
        deployment: { providerModelId: 'gpt-5-chat' },
      },
    }),
  })
  assert.deepEqual(result, {
    availability: 'available',
    reasonCode: null,
    checkedAt: now.toISOString(),
    runtime: { id: 'openai-chat', label: 'gpt-5-chat', kind: 'provider' },
  })
})

test('Chat runtime readiness fails closed when status cannot be verified', async () => {
  const result = await readChatRuntimeReadiness({
    repositories: {},
    source: { CREATIVE_PROVIDER_RUNTIME_ENV: 'staging' },
    runtime: { mode: 'mock' },
    actor,
    now,
    readinessResolver: async () => { throw new Error('database unavailable') },
  })
  assert.equal(result.availability, 'unavailable')
  assert.equal(result.reasonCode, 'runtime_status_unavailable')
  assert.equal(result.runtime, null)
})
