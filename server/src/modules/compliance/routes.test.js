import assert from 'node:assert/strict'
import test from 'node:test'

import { createRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { currentRequiredPolicyVersions } from '../../compliance/policyManifest.js'
import { registerComplianceRoutes } from './routes.js'

const createTestServer = () => createRouteTestServer(registerComplianceRoutes)

test('GET /api/compliance/policies publishes versioned policies without claiming legal approval', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/compliance/policies', { method: 'GET' })

    assert.equal(status, 200)
    assert.equal(payload.data.policyStatus, 'engineering_draft_pending_legal_review')
    assert.equal(payload.data.releaseReadiness.legalApproved, false)
    assert.equal(payload.data.releaseReadiness.productionLaunchAllowed, false)
    assert.deepEqual(payload.data.policies.map((policy) => policy.id), [
      'terms',
      'privacy',
      'acceptable-use',
      'provider-disclosure',
      'support',
    ])
    assert.equal(payload.data.providerDisclosures.length, 8)
    assert.equal(payload.data.supportContract.categories.length, 6)
  } finally {
    await server.close()
  }
})

test('policy consent requires auth and exact current required versions', async () => {
  const server = await createTestServer()
  try {
    const unauthorized = await requestJson(server.url, '/api/compliance/consent', { method: 'GET' })
    assert.equal(unauthorized.status, 401)
    assert.equal(unauthorized.payload.error.code, 'AUTH_REQUIRED')

    const before = await requestJson(server.url, '/api/compliance/consent', {
      method: 'GET',
      token: 'demo-access.taskops',
    })
    assert.equal(before.status, 200)
    assert.equal(before.payload.data.required, true)

    const stale = await requestJson(server.url, '/api/compliance/consent', {
      token: 'demo-access.taskops',
      body: {
        accepted: true,
        locale: 'en',
        policyVersions: { ...currentRequiredPolicyVersions(), terms: '0.9.0' },
      },
    })
    assert.equal(stale.status, 409)
    assert.equal(stale.payload.error.code, 'POLICY_VERSION_MISMATCH')
    assert.deepEqual(stale.payload.error.details.requiredPolicyVersions, currentRequiredPolicyVersions())

    const accepted = await requestJson(server.url, '/api/compliance/consent', {
      token: 'demo-access.taskops',
      body: {
        accepted: true,
        locale: 'zh',
        policyVersions: currentRequiredPolicyVersions(),
      },
    })
    assert.equal(accepted.status, 201)
    assert.equal(accepted.payload.data.current, true)
    assert.equal(accepted.payload.data.required, false)
    assert.equal(accepted.payload.data.acceptedSource, 'first_authenticated_use')
    assert.ok(accepted.payload.data.acceptedAt)
  } finally {
    await server.close()
  }
})

test('support requests are authenticated, owner-scoped, auditable queue records', async () => {
  const server = await createTestServer()
  try {
    const unauthorized = await requestJson(server.url, '/api/support/requests', {
      body: {
        category: 'general_support',
        subject: 'Cannot open a project',
        details: 'The project stays unavailable after refreshing the page.',
      },
    })
    assert.equal(unauthorized.status, 401)

    const created = await requestJson(server.url, '/api/support/requests', {
      token: 'demo-access.promptlin',
      body: {
        category: 'moderation_appeal',
        subject: 'Review this moderation decision',
        details: 'I have additional rights context for the referenced generation decision.',
        relatedResourceType: 'moderation_decision',
        relatedResourceId: 'decision-demo-42',
        locale: 'en',
      },
    })
    assert.equal(created.status, 201)
    assert.equal(created.payload.data.status, 'Submitted')
    assert.equal(created.payload.data.category, 'moderation_appeal')
    assert.equal(created.payload.data.relatedResourceId, 'decision-demo-42')
    assert.equal(created.payload.data.initialResponseTarget, '5_business_days')

    const ownerList = await requestJson(server.url, '/api/support/requests', {
      method: 'GET',
      token: 'demo-access.promptlin',
    })
    assert.equal(ownerList.status, 200)
    assert.ok(ownerList.payload.data.items.some((item) => item.id === created.payload.data.id))

    const otherUser = await requestJson(server.url, `/api/support/requests/${created.payload.data.id}`, {
      method: 'GET',
      token: 'demo-access.taskops',
    })
    assert.equal(otherUser.status, 404)
  } finally {
    await server.close()
  }
})

test('support request validation rejects secrets and incomplete related resources', async () => {
  const server = await createTestServer()
  try {
    const sensitive = await requestJson(server.url, '/api/support/requests', {
      token: 'demo-access.promptlin',
      body: {
        category: 'general_support',
        subject: 'Credential troubleshooting request',
        details: 'Authorization: Bearer example-secret-token',
      },
    })
    assert.equal(sensitive.status, 400)
    assert.equal(sensitive.payload.error.code, 'SENSITIVE_SUPPORT_CONTENT')

    const missingResource = await requestJson(server.url, '/api/support/requests', {
      token: 'demo-access.promptlin',
      body: {
        category: 'content_report',
        subject: 'Report a community post',
        details: 'This report needs a stable post identifier before it can be routed.',
        relatedResourceType: 'post',
      },
    })
    assert.equal(missingResource.status, 400)
    assert.equal(missingResource.payload.error.code, 'VALIDATION_FAILED')
  } finally {
    await server.close()
  }
})
