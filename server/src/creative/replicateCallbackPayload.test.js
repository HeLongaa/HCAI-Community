import assert from 'node:assert/strict'
import test from 'node:test'

import { parseReplicateCallbackPayload } from './replicateCallbackPayload.js'

test('parseReplicateCallbackPayload projects the strict callback allowlist', () => {
  const payload = parseReplicateCallbackPayload({
    id: 'pred_callback_1',
    event_id: 'event_callback_1',
    status: 'succeeded',
    output: ['https://provider.example/output-1.png'],
    metrics: { predict_time: 1.25, total_time: 2 },
    cost_usd: 0.2,
    created_at: '2026-07-11T01:00:00.000Z',
    started_at: '2026-07-11T01:00:01.000Z',
    completed_at: '2026-07-11T01:00:03.000Z',
  })

  assert.equal(payload.id, 'pred_callback_1')
  assert.equal(payload.eventId, 'event_callback_1')
  assert.equal(payload.status, 'succeeded')
  assert.deepEqual(payload.output, ['https://provider.example/output-1.png'])
  assert.equal(payload.metrics.predict_time, 1.25)
  assert.equal(payload.costUsd, 0.2)
})

test('parseReplicateCallbackPayload rejects unsupported fields statuses and outputs', () => {
  assert.throws(
    () => parseReplicateCallbackPayload({
      id: 'pred_callback_1',
      status: 'succeeded',
      output: ['https://provider.example/output-1.png'],
      input: { prompt: 'must not cross the callback boundary' },
    }),
    (error) => error.code === 'CREATIVE_PROVIDER_CALLBACK_PAYLOAD_INVALID' &&
      error.details.reasonCode === 'field_unsupported' &&
      error.details.unknownFieldCount === 1,
  )

  assert.throws(
    () => parseReplicateCallbackPayload({ id: 'pred_callback_1', status: 'paused' }),
    (error) => error.details.reasonCode === 'status_unsupported',
  )

  assert.throws(
    () => parseReplicateCallbackPayload({
      id: 'pred_callback_1',
      status: 'succeeded',
      output: ['http://provider.example/output-1.png'],
    }),
    (error) => error.details.reasonCode === 'output_invalid',
  )
})
test('parseReplicateCallbackPayload bounds error and metric fields without preserving unknown data', () => {
  assert.throws(
    () => parseReplicateCallbackPayload({
      id: 'pred_callback_1',
      status: 'failed',
      error: 'x'.repeat(4097),
    }),
    (error) => error.details.reasonCode === 'field_invalid' && error.details.field === 'error',
  )

  assert.throws(
    () => parseReplicateCallbackPayload({
      id: 'pred_callback_1',
      status: 'processing',
      metrics: { private_provider_counter: 1 },
    }),
    (error) => error.details.reasonCode === 'metrics_field_unsupported' &&
      error.details.unknownMetricCount === 1,
  )
})
