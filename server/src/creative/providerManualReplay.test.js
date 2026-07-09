import assert from 'node:assert/strict'
import test from 'node:test'

import {
  authorizeManualProviderReplay,
  buildManualProviderReplayEnvelope,
  parseManualProviderReplayRequest,
} from './providerManualReplay.js'

const operator = {
  id: 'demo-user-ops',
  handle: 'opsplus',
  permissions: ['admin:audit:read', 'admin:queue:review'],
}

const auditOnly = {
  id: 'demo-user-audit',
  handle: 'auditops',
  permissions: ['admin:audit:read'],
}

const currentRecord = (overrides = {}) => ({
  id: 'gen-manual-replay-1',
  status: 'running',
  providerId: 'replicate',
  providerMode: 'replicate_staging',
  providerJobId: 'pred-manual-replay-1',
  ...overrides,
})

const replayBody = (overrides = {}) => ({
  generationId: 'gen-manual-replay-1',
  providerId: 'replicate',
  providerMode: 'replicate_staging',
  providerJobId: 'pred-manual-replay-1',
  normalizedStatus: 'failed',
  reasonCode: 'operator_replay_test',
  note: 'Operator confirmed safe replay after callback outage.',
  providerEventId: 'manual-event-1',
  occurredAt: '2026-07-06T01:02:03.000Z',
  ...overrides,
})

const assertHttpError = (fn, { statusCode, code, message }) => {
  assert.throws(fn, (error) => {
    assert.equal(error.name, 'HttpError')
    assert.equal(error.statusCode, statusCode)
    assert.equal(error.code, code)
    if (message) assert.equal(error.message, message)
    return true
  })
}

const assertHttpErrorDetails = (fn, assertion) => {
  assert.throws(fn, (error) => {
    assert.equal(error.name, 'HttpError')
    assertion(error)
    return true
  })
}

test('authorizeManualProviderReplay requires approved internal operator permissions', () => {
  assert.equal(authorizeManualProviderReplay(operator), operator)
  assertHttpError(
    () => authorizeManualProviderReplay(null),
    { statusCode: 401, code: 'AUTH_REQUIRED' },
  )
  assertHttpError(
    () => authorizeManualProviderReplay(auditOnly),
    { statusCode: 403, code: 'PERMISSION_DENIED', message: 'Missing permission: admin:queue:review' },
  )
})

test('parseManualProviderReplayRequest normalizes safe manual replay fields', () => {
  const parsed = parseManualProviderReplayRequest(replayBody({
    note: 'Timed out with Bearer secret.value and token=provider-token',
  }))

  assert.equal(parsed.sourceType, 'manual_replay')
  assert.equal(parsed.generationId, 'gen-manual-replay-1')
  assert.equal(parsed.normalizedStatus, 'failed')
  assert.equal(parsed.reasonCode, 'operator_replay_test')
  assert.equal(parsed.providerEventId, 'manual-event-1')
  assert.equal(parsed.occurredAt, '2026-07-06T01:02:03.000Z')
  assert.equal(parsed.payloadHash.length, 64)
  assert.equal(parsed.idempotencyKey, 'manual-replay:replicate:pred-manual-replay-1:failed:operator_replay_test')
  assert.equal(parsed.notePreview.includes('secret.value'), false)
  assert.equal(parsed.notePreview.includes('provider-token'), false)
})

test('parseManualProviderReplayRequest rejects unsafe payload and unsupported lifecycle shortcuts', () => {
  assertHttpError(
    () => parseManualProviderReplayRequest(replayBody({ reasonCode: '' })),
    { statusCode: 400, code: 'VALIDATION_FAILED', message: 'reasonCode is required' },
  )
  assertHttpError(
    () => parseManualProviderReplayRequest(replayBody({ normalizedStatus: 'review_required' })),
    { statusCode: 400, code: 'VALIDATION_FAILED', message: 'normalizedStatus must be one of: queued, running, completed, failed, cancelled' },
  )
  assertHttpError(
    () => parseManualProviderReplayRequest(replayBody({ output: ['https://provider.example/output.png'] })),
    { statusCode: 400, code: 'VALIDATION_FAILED', message: 'manual replay request cannot include unsafe provider fields: output' },
  )
  assertHttpError(
    () => parseManualProviderReplayRequest(replayBody({ occurredAt: 'not-a-date' })),
    { statusCode: 400, code: 'VALIDATION_FAILED', message: 'occurredAt must be an ISO timestamp' },
  )
})

test('buildManualProviderReplayEnvelope builds safe manual replay envelope without side effects', () => {
  const envelope = buildManualProviderReplayEnvelope({
    body: replayBody(),
    currentRecord: currentRecord(),
    actor: operator,
    now: new Date('2026-07-06T01:03:00.000Z'),
  })

  assert.equal(envelope.ok, true)
  assert.equal(envelope.shouldReplay, true)
  assert.equal(envelope.sourceType, 'manual_replay')
  assert.equal(envelope.generationId, 'gen-manual-replay-1')
  assert.equal(envelope.providerId, 'replicate')
  assert.equal(envelope.providerMode, 'replicate_staging')
  assert.equal(envelope.providerJobId, 'pred-manual-replay-1')
  assert.equal(envelope.normalizedStatus, 'failed')
  assert.equal(envelope.receivedAt, '2026-07-06T01:03:00.000Z')
  assert.deepEqual(envelope.actor, { id: 'demo-user-ops', handle: 'opsplus' })
  assert.equal(envelope.safeMetadata.reasonCode, 'operator_replay_test')
  assert.equal(envelope.safeMetadata.currentStatus, 'running')
  assert.equal(envelope.safeMetadata.terminalReplay, false)
  assert.equal(JSON.stringify(envelope).includes('https://provider.example'), false)
})

test('buildManualProviderReplayEnvelope rejects target mismatches before replay', () => {
  assertHttpError(
    () => buildManualProviderReplayEnvelope({
      body: replayBody({ generationId: 'gen-other' }),
      currentRecord: currentRecord(),
      actor: operator,
    }),
    { statusCode: 409, code: 'CREATIVE_PROVIDER_GENERATION_MISMATCH' },
  )
  assertHttpError(
    () => buildManualProviderReplayEnvelope({
      body: replayBody({ providerJobId: 'pred-other' }),
      currentRecord: currentRecord(),
      actor: operator,
    }),
    { statusCode: 409, code: 'CREATIVE_PROVIDER_JOB_MISMATCH' },
  )
  assertHttpError(
    () => buildManualProviderReplayEnvelope({
      body: replayBody({ providerId: 'other-provider' }),
      currentRecord: currentRecord(),
      actor: operator,
    }),
    { statusCode: 409, code: 'CREATIVE_PROVIDER_MISMATCH' },
  )
})

test('buildManualProviderReplayEnvelope redacts unsafe provider job mismatch details', () => {
  assertHttpErrorDetails(
    () => buildManualProviderReplayEnvelope({
      body: replayBody({ providerJobId: 'pred-manual-replay-safe' }),
      currentRecord: currentRecord({
        providerJobId: 'https://replicate.example/predictions/current?token=current-secret',
      }),
      actor: operator,
    }),
    (error) => {
      assert.equal(error.statusCode, 409)
      assert.equal(error.code, 'CREATIVE_PROVIDER_JOB_MISMATCH')
      assert.match(error.details.currentProviderJobId, /^redacted_[a-f0-9]{16}$/)
      assert.equal(error.details.incomingProviderJobId, 'pred-manual-replay-safe')
      const details = JSON.stringify(error.details)
      assert.equal(details.includes('replicate.example'), false)
      assert.equal(details.includes('current-secret'), false)
    },
  )
})

test('buildManualProviderReplayEnvelope refuses terminal reopen shortcuts', () => {
  const duplicateTerminal = buildManualProviderReplayEnvelope({
    body: replayBody({ normalizedStatus: 'completed' }),
    currentRecord: currentRecord({ status: 'completed' }),
    actor: operator,
  })
  assert.equal(duplicateTerminal.safeMetadata.terminalReplay, true)
  assert.equal(duplicateTerminal.normalizedStatus, 'completed')

  assertHttpError(
    () => buildManualProviderReplayEnvelope({
      body: replayBody({ normalizedStatus: 'failed' }),
      currentRecord: currentRecord({ status: 'completed' }),
      actor: operator,
    }),
    { statusCode: 409, code: 'CREATIVE_PROVIDER_TERMINAL_REPLAY_REJECTED' },
  )
})
