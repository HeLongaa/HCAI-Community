import assert from 'node:assert/strict'
import test from 'node:test'

import { buildProviderDeletionGatewayConfig, buildProviderDeletionTargets, createProviderDeletionGateway, providerDeletionReceipt } from './providerDeletionGateway.js'

const source = {
  DATA_RIGHTS_PROVIDER_DELETION_GATEWAY_ENABLED: 'true',
  DATA_RIGHTS_PROVIDER_DELETION_GATEWAY_CONFIRMATION: 'provider-deletion-enabled',
  DATA_RIGHTS_PROVIDER_DELETION_GATEWAY_URL: 'https://privacy.example.test/provider-deletions',
  DATA_RIGHTS_PROVIDER_DELETION_GATEWAY_TOKEN: 'test-provider-deletion-token',
}

test('Provider deletion targets exclude local fixtures and bound operation references', () => {
  assert.deepEqual(buildProviderDeletionTargets([
    { providerId: 'mock', providerJobId: 'local' },
    { providerId: 'hcai-router', providerJobId: 'job-2' },
    { providerId: 'hcai-router', providerRequestId: 'request-1' },
    { providerId: 'hcai-router', providerRequestId: '' },
  ]), [{ providerId: 'hcai-router', generationCount: 3, unresolvedGenerationCount: 1, operationRefs: ['job-2', 'request-1'] }])
})

test('Provider deletion gateway sends transient references and returns only hashed receipt evidence', async () => {
  let requestBody
  const dispatch = createProviderDeletionGateway({ source, fetchImpl: async (_url, options) => {
    requestBody = JSON.parse(options.body)
    return new Response(JSON.stringify({
      schemaVersion: 2,
      status: 'completed',
      requestId: requestBody.requestId,
      providerId: requestBody.providerId,
      operationRefsHash: requestBody.operationRefsHash,
      batchIndex: requestBody.batchIndex,
      batchCount: requestBody.batchCount,
      receiptId: 'provider-receipt-1',
      processedOperationCount: 2,
      deletedOperationCount: 2,
    }), { status: 200 })
  } })
  const result = await dispatch({ requestId: 'request-1', subjectRef: 'subject_hash', target: { providerId: 'hcai-router', generationCount: 2, unresolvedGenerationCount: 0, operationRefs: ['job-2', 'job-1'] }, now: new Date('2026-07-27T00:00:00.000Z') })
  assert.equal(requestBody.schemaVersion, 2)
  assert.deepEqual(requestBody.operationRefs, ['job-1', 'job-2'])
  assert.equal(requestBody.operationRefsHash.length, 64)
  assert.equal(requestBody.batchIndex, 1)
  assert.equal(requestBody.batchCount, 1)
  assert.equal(result.receiptHash.length, 64)
  assert.equal(JSON.stringify(result).includes('provider-receipt-1'), false)
  const receipt = providerDeletionReceipt({ requestId: 'request-1', result })
  assert.equal(receipt.domain, 'provider:hcai-router')
  assert.equal(receipt.disposition, 'externally_erased')
  assert.equal(JSON.stringify(receipt).includes('job-1'), false)
})

test('Provider deletion fails closed when the gateway is not explicitly enabled', async () => {
  const dispatch = createProviderDeletionGateway({ source: {}, fetchImpl: async () => { throw new Error('must not call') } })
  await assert.rejects(dispatch({ requestId: 'request-1', subjectRef: 'subject_hash', target: { providerId: 'hcai-router', generationCount: 1, unresolvedGenerationCount: 0, operationRefs: ['job-1'] } }), { code: 'DATA_RIGHTS_PROVIDER_DELETION_UNAVAILABLE' })
})

test('Provider deletion fails closed when a generation has no upstream operation reference', async () => {
  const dispatch = createProviderDeletionGateway({ source, fetchImpl: async () => { throw new Error('must not call') } })
  await assert.rejects(dispatch({
    requestId: 'request-1',
    subjectRef: 'subject_hash',
    target: { providerId: 'hcai-router', generationCount: 1, unresolvedGenerationCount: 1, operationRefs: [] },
  }), { code: 'DATA_RIGHTS_PROVIDER_DELETION_TARGET_INVALID' })
})

test('Provider deletion rejects an unbound or incomplete processor receipt', async () => {
  for (const responsePayload of [
    { schemaVersion: 1, status: 'completed', receiptId: 'provider-receipt-1', processedOperationCount: 1, deletedOperationCount: 1 },
    { schemaVersion: 2, status: 'completed', requestId: 'another-request', providerId: 'hcai-router', operationRefsHash: '0'.repeat(64), receiptId: 'provider-receipt-1', processedOperationCount: 1, deletedOperationCount: 1 },
    { schemaVersion: 2, status: 'completed', requestId: 'request-1', providerId: 'hcai-router', operationRefsHash: '0'.repeat(64), receiptId: 'provider-receipt-1', processedOperationCount: 0, deletedOperationCount: 0 },
    { schemaVersion: 2, status: 'completed', requestId: 'request-1', providerId: 'hcai-router', operationRefsHash: '0'.repeat(64), receiptId: 'provider-receipt-1', processedOperationCount: '1', deletedOperationCount: '1' },
  ]) {
    const dispatch = createProviderDeletionGateway({ source, fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body)
      return new Response(JSON.stringify({
        batchIndex: request.batchIndex,
        batchCount: request.batchCount,
        ...responsePayload,
        operationRefsHash: responsePayload.operationRefsHash === '0'.repeat(64) ? request.operationRefsHash : responsePayload.operationRefsHash,
      }), { status: 200 })
    } })
    await assert.rejects(dispatch({
      requestId: 'request-1',
      subjectRef: 'subject_hash',
      target: { providerId: 'hcai-router', generationCount: 1, unresolvedGenerationCount: 0, operationRefs: ['job-1'] },
    }), { code: 'DATA_RIGHTS_PROVIDER_DELETION_RESPONSE_INVALID' })
  }
})

test('Provider deletion sends every operation reference in deterministic bounded batches', async () => {
  const requests = []
  const dispatch = createProviderDeletionGateway({ source, fetchImpl: async (_url, options) => {
    const request = JSON.parse(options.body)
    requests.push({ request, idempotencyKey: options.headers['idempotency-key'] })
    return new Response(JSON.stringify({
      schemaVersion: 2,
      status: 'completed',
      requestId: request.requestId,
      providerId: request.providerId,
      operationRefsHash: request.operationRefsHash,
      batchIndex: request.batchIndex,
      batchCount: request.batchCount,
      receiptId: `provider-receipt-${request.batchIndex}`,
      processedOperationCount: request.operationRefs.length,
      deletedOperationCount: request.operationRefs.length,
    }), { status: 200 })
  } })
  const operationRefs = Array.from({ length: 101 }, (_, index) => `job-${String(index).padStart(3, '0')}`)
  const result = await dispatch({
    requestId: 'request-1',
    subjectRef: 'subject_hash',
    target: { providerId: 'hcai-router', generationCount: 101, unresolvedGenerationCount: 0, operationRefs },
  })
  assert.deepEqual(requests.map(({ request }) => request.operationRefs.length), [100, 1])
  assert.deepEqual(requests.map(({ request }) => [request.batchIndex, request.batchCount]), [[1, 2], [2, 2]])
  assert.equal(new Set(requests.map(({ idempotencyKey }) => idempotencyKey)).size, 2)
  assert.equal(result.processedOperationCount, 101)
  assert.equal(result.deletedOperationCount, 101)
})

test('Provider deletion configuration rejects incomplete or unsafe production gateways', () => {
  assert.equal(buildProviderDeletionGatewayConfig(source).endpoint, 'https://privacy.example.test/provider-deletions')
  assert.throws(() => buildProviderDeletionGatewayConfig({}), { code: 'DATA_RIGHTS_PROVIDER_DELETION_UNAVAILABLE' })
  assert.throws(() => buildProviderDeletionGatewayConfig({ ...source, DATA_RIGHTS_PROVIDER_DELETION_GATEWAY_URL: 'http://privacy.example.test/provider-deletions' }), { code: 'DATA_RIGHTS_PROVIDER_DELETION_CONFIGURATION_INVALID' })
  assert.throws(() => buildProviderDeletionGatewayConfig({ ...source, DATA_RIGHTS_PROVIDER_DELETION_GATEWAY_URL: 'https://privacy.example.test/provider-deletions?token=unsafe' }), { code: 'DATA_RIGHTS_PROVIDER_DELETION_CONFIGURATION_INVALID' })
  assert.throws(() => buildProviderDeletionGatewayConfig({ ...source, DATA_RIGHTS_PROVIDER_DELETION_GATEWAY_TOKEN: 'short' }), { code: 'DATA_RIGHTS_PROVIDER_DELETION_CONFIGURATION_INVALID' })
})
