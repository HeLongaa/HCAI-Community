import assert from 'node:assert/strict'
import test from 'node:test'
import {
  apiKeySecretMatches,
  canonicalIpAllowlist,
  clientIpAllowed,
  decodeDeveloperCursor,
  developerScopes,
  encodeDeveloperCursor,
  issueDeveloperApiKey,
  parseApiKeyCreate,
  parseDeveloperAccessControlUpdate,
  parseDeveloperApiKey,
  parseDeveloperListQuery,
} from './developerAccess.js'

test('developer API keys use a strict one-time format and constant-time hash verification', () => {
  const issued = issueDeveloperApiKey()
  const parsed = parseDeveloperApiKey(issued.plaintext)
  assert.equal(parsed.keyPrefix, issued.keyPrefix)
  assert.equal(apiKeySecretMatches(parsed.secret, issued.secretHash), true)
  assert.equal(apiKeySecretMatches(`${parsed.secret.slice(0, -1)}x`, issued.secretHash), false)
  assert.equal(parseDeveloperApiKey('mfk_bad'), null)
  assert.equal(issued.plaintext.includes(issued.secretHash), false)
})

test('developer access parsers keep controls, scopes, TTLs, and IP allowlists closed and bounded', () => {
  const control = parseDeveloperAccessControlUpdate({
    enabled: true,
    allowedScopes: developerScopes,
    maxServiceAccountsPerUser: 5,
    maxActiveKeysPerAccount: 3,
    defaultKeyTtlDays: 30,
    expectedVersion: 1,
    reasonCode: 'developer_beta_enabled',
  })
  assert.equal(control.enabled, true)
  const key = parseApiKeyCreate({ name: 'Build key', scopes: developerScopes, ipAllowlist: ['127.0.0.1', '203.0.113.0/24'], ttlDays: 7 }, control)
  assert.deepEqual(key.ipAllowlist, ['127.0.0.1/32', '203.0.113.0/24'])
  assert.equal(clientIpAllowed('203.0.113.42', key.ipAllowlist), true)
  assert.equal(clientIpAllowed('198.51.100.1', key.ipAllowlist), false)
  assert.throws(() => canonicalIpAllowlist(['not-an-ip']), /ipAllowlist/)
  assert.throws(() => canonicalIpAllowlist(['::ffff:192.0.2.1/95']), /ipAllowlist/)
  assert.deepEqual(canonicalIpAllowlist(['::ffff:192.0.2.1/120']), ['192.0.2.1/24'])
  assert.throws(() => parseApiKeyCreate({ name: 'x', scopes: ['admin:access'], ttlDays: 400 }, control), /name|scope|ttl/)
  assert.throws(() => parseDeveloperListQuery({ sort: 'usageCount' }), /sort/)
})

test('developer cursors are query-bound and reject tampering', () => {
  const query = parseDeveloperListQuery({ status: 'active', search: 'build', limit: '10', sort: 'name', order: 'asc' })
  const cursor = encodeDeveloperCursor(query, { id: 'service-account-1', name: 'Build' })
  assert.equal(decodeDeveloperCursor(cursor, query).id, 'service-account-1')
  assert.throws(() => decodeDeveloperCursor(cursor, { ...query, order: 'desc' }), /cursor/)
  assert.throws(() => decodeDeveloperCursor(`${cursor}x`, query), /cursor/)
})
