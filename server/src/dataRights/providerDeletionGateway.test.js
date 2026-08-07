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
  ]), [{ providerId: 'hcai-router', generationCount: 2, operationRefs: ['job-2', 'request-1'] }])
})

test('Provider deletion gateway sends transient references and returns only hashed receipt evidence', async () => {
  let requestBody
  const dispatch = createProviderDeletionGateway({ source, fetchImpl: async (_url, options) => {
    requestBody = JSON.parse(options.body)
    return new Response(JSON.stringify({ status: 'completed', receiptId: 'provider-receipt-1', deletedOperationCount: 2 }), { status: 200 })
  } })
  const result = await dispatch({ requestId: 'request-1', subjectRef: 'subject_hash', target: { providerId: 'hcai-router', generationCount: 2, operationRefs: ['job-1', 'job-2'] }, now: new Date('2026-07-27T00:00:00.000Z') })
  assert.deepEqual(requestBody.operationRefs, ['job-1', 'job-2'])
  assert.equal(result.receiptHash.length, 64)
  assert.equal(JSON.stringify(result).includes('provider-receipt-1'), false)
  const receipt = providerDeletionReceipt({ requestId: 'request-1', result })
  assert.equal(receipt.domain, 'provider:hcai-router')
  assert.equal(receipt.disposition, 'externally_erased')
  assert.equal(JSON.stringify(receipt).includes('job-1'), false)
})

test('Provider deletion fails closed when the gateway is not explicitly enabled', async () => {
  const dispatch = createProviderDeletionGateway({ source: {}, fetchImpl: async () => { throw new Error('must not call') } })
  await assert.rejects(dispatch({ requestId: 'request-1', subjectRef: 'subject_hash', target: { providerId: 'hcai-router', generationCount: 1, operationRefs: [] } }), { code: 'DATA_RIGHTS_PROVIDER_DELETION_UNAVAILABLE' })
})

test('Provider deletion configuration rejects incomplete or unsafe production gateways', () => {
  assert.equal(buildProviderDeletionGatewayConfig(source).endpoint, 'https://privacy.example.test/provider-deletions')
  assert.throws(() => buildProviderDeletionGatewayConfig({}), { code: 'DATA_RIGHTS_PROVIDER_DELETION_UNAVAILABLE' })
  assert.throws(() => buildProviderDeletionGatewayConfig({ ...source, DATA_RIGHTS_PROVIDER_DELETION_GATEWAY_URL: 'http://privacy.example.test/provider-deletions' }), { code: 'DATA_RIGHTS_PROVIDER_DELETION_CONFIGURATION_INVALID' })
  assert.throws(() => buildProviderDeletionGatewayConfig({ ...source, DATA_RIGHTS_PROVIDER_DELETION_GATEWAY_URL: 'https://privacy.example.test/provider-deletions?token=unsafe' }), { code: 'DATA_RIGHTS_PROVIDER_DELETION_CONFIGURATION_INVALID' })
  assert.throws(() => buildProviderDeletionGatewayConfig({ ...source, DATA_RIGHTS_PROVIDER_DELETION_GATEWAY_TOKEN: 'short' }), { code: 'DATA_RIGHTS_PROVIDER_DELETION_CONFIGURATION_INVALID' })
})
