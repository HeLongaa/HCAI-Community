import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createSecretManagerLifecycleGateway,
  isProviderSecretPurposeDeletable,
  providerSecretRetentionCutoff,
  providerSecretRetentionSweepLimit,
} from './providerSecretRetention.js'
import { createSeedModelGovernanceRepository } from './seedModelGovernanceRepository.js'

const source = {
  SECRET_MANAGER_LIFECYCLE_GATEWAY_ENABLED: 'true',
  SECRET_MANAGER_LIFECYCLE_GATEWAY_CONFIRMATION: 'managed-secret-lifecycle-enabled',
  SECRET_MANAGER_LIFECYCLE_GATEWAY_URL: 'https://secrets.example.test/v1/lifecycle',
  SECRET_MANAGER_LIFECYCLE_GATEWAY_TOKEN: 'managed-secret-test-token',
}

test('provider secret retention fixes the 30-day cutoff, bounded batches, and decryption exclusion', () => {
  assert.equal(providerSecretRetentionCutoff(new Date('2026-07-31T00:00:00.000Z')).toISOString(), '2026-07-01T00:00:00.000Z')
  assert.equal(providerSecretRetentionSweepLimit('5000'), 500)
  assert.equal(isProviderSecretPurposeDeletable('chat-inference'), true)
  assert.equal(isProviderSecretPurposeDeletable('data-encryption'), false)
  assert.equal(isProviderSecretPurposeDeletable('signing'), false)
})

test('managed secret gateway sends transient metadata and returns hash-only evidence', async () => {
  let request
  const gateway = createSecretManagerLifecycleGateway({ source, fetchImpl: async (_url, options) => {
    request = { headers: options.headers, body: JSON.parse(options.body) }
    return new Response(JSON.stringify({ status: 'completed', action: 'disable', receiptId: 'receipt-private-1' }), { status: 200 })
  } })
  const result = await gateway({ action: 'disable', secretRef: 'secret://env/CHAT_TOKEN_V1', externalVersion: 'v1', purpose: 'chat-inference', now: new Date('2026-07-28T00:00:00.000Z') })
  assert.equal(request.body.secretRef, 'secret://env/CHAT_TOKEN_V1')
  assert.match(request.headers['idempotency-key'], /^secret-lifecycle:disable:[a-f0-9]{64}$/)
  assert.equal(result.targetHash.length, 64)
  assert.equal(result.receiptHash.length, 64)
  assert.equal(JSON.stringify(result).includes('CHAT_TOKEN_V1'), false)
  assert.equal(JSON.stringify(result).includes('receipt-private-1'), false)
})

test('managed secret gateway reads its bearer credential from an absolute file', async () => {
  let authorization
  const gateway = createSecretManagerLifecycleGateway({
    source: {
      ...source,
      SECRET_MANAGER_LIFECYCLE_GATEWAY_TOKEN: '',
      SECRET_MANAGER_LIFECYCLE_GATEWAY_TOKEN_FILE: '/run/secrets/lifecycle-token',
    },
    readCredentialFile: (file) => {
      assert.equal(file, '/run/secrets/lifecycle-token')
      return 'file-backed-lifecycle-token'
    },
    fetchImpl: async (_url, options) => {
      authorization = options.headers.authorization
      return new Response(JSON.stringify({ status: 'completed', action: 'disable', receiptId: 'receipt-file-1' }), { status: 200 })
    },
  })
  await gateway({ action: 'disable', secretRef: 'secret://env/CHAT_TOKEN_V1', externalVersion: 'v1', purpose: 'chat-inference' })
  assert.equal(authorization, 'Bearer file-backed-lifecycle-token')
})

test('managed secret gateway fails closed for disabled, unsafe, and malformed integrations', async () => {
  await assert.rejects(
    createSecretManagerLifecycleGateway({ source: {}, fetchImpl: async () => { throw new Error('must not call') } })({ action: 'disable', secretRef: 'secret://env/KEY', externalVersion: 'v1', purpose: 'inference' }),
    { code: 'SECRET_MANAGER_LIFECYCLE_UNAVAILABLE' },
  )
  await assert.rejects(
    createSecretManagerLifecycleGateway({ source, fetchImpl: async () => new Response(JSON.stringify({ status: 'completed', action: 'delete', receiptId: 'receipt-1' })) })({ action: 'delete', secretRef: 'secret://env/KEY', externalVersion: 'v1', purpose: 'data-encryption' }),
    { code: 'SECRET_MANAGER_LIFECYCLE_TARGET_INVALID' },
  )
  await assert.rejects(
    createSecretManagerLifecycleGateway({ source, fetchImpl: async () => new Response('{invalid', { status: 200 }) })({ action: 'delete', secretRef: 'secret://env/KEY', externalVersion: 'v1', purpose: 'inference' }),
    { code: 'SECRET_MANAGER_LIFECYCLE_RESPONSE_INVALID' },
  )
  await assert.rejects(
    createSecretManagerLifecycleGateway({
      source: { ...source, SECRET_MANAGER_LIFECYCLE_GATEWAY_TOKEN_FILE: '/run/secrets/token' },
      fetchImpl: async () => { throw new Error('must not call') },
    })({ action: 'delete', secretRef: 'secret://env/KEY', externalVersion: 'v1', purpose: 'inference' }),
    { code: 'SECRET_MANAGER_LIFECYCLE_CONFIGURATION_INVALID' },
  )
})

test('seed retention disables a rotated secret immediately and deletes it only after 30 days', async () => {
  const repository = createSeedModelGovernanceRepository({
    modelControl: { find: async () => ({ id: 'provider-1' }) },
    modelRouting: {}, modelEvaluation: {}, providerLegal: {}, releaseChanges: {},
  })
  const base = {
    providerId: 'provider-1', environment: 'staging', purpose: 'chat-inference',
    ownerRef: 'ops', checksumSha256: 'a'.repeat(64), expiresAt: null,
    reasonCode: 'rotation', createdByRef: 'ops',
  }
  const first = await repository.createSecretRef({ ...base, id: 'secret-1', secretRef: 'secret://env/CHAT_V1', externalVersion: 'v1', rotatedFromId: null })
  const second = await repository.createSecretRef({ ...base, id: 'secret-2', secretRef: 'secret://env/CHAT_V2', externalVersion: 'v2', rotatedFromId: first.id })
  const calls = []
  const gateway = async ({ action, secretRef }) => {
    calls.push({ action, secretRef })
    return { action, targetHash: 'b'.repeat(64), receiptHash: 'c'.repeat(64), completedAt: new Date().toISOString() }
  }
  const rotatedAt = new Date(second.createdAt)
  const immediate = await repository.sweepSecretRetention({ now: rotatedAt, gateway })
  assert.deepEqual(immediate, { policyId: 'retired_secret_30d', inspected: 1, disabled: 1, deleted: 0, skipped: 0 })
  assert.deepEqual(calls, [{ action: 'disable', secretRef: 'secret://env/CHAT_V1' }])

  const early = await repository.sweepSecretRetention({ now: new Date(rotatedAt.getTime() + 29 * 86_400_000), gateway })
  assert.equal(early.inspected, 0)
  const expired = await repository.sweepSecretRetention({ now: new Date(rotatedAt.getTime() + 31 * 86_400_000), gateway })
  assert.equal(expired.deleted, 1)
  assert.deepEqual(calls.at(-1), { action: 'delete', secretRef: 'secret://env/CHAT_V1' })

  const replay = await repository.sweepSecretRetention({ now: new Date(rotatedAt.getTime() + 32 * 86_400_000), gateway })
  assert.equal(replay.inspected, 0)
  assert.deepEqual((await repository.listSecretLifecycleReceipts()).map((receipt) => receipt.action).sort(), ['delete', 'disable'])
})
