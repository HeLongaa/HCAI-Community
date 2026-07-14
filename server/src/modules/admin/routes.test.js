import assert from 'node:assert/strict'
import test from 'node:test'

import { createRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { recordSecurityEvent, resetSecurityEvents } from '../../security/securityEvents.js'
import { quotaWindowFor, resetCreativePolicyState } from '../../creative/policy.js'
import { createReplicateStagingPrediction } from '../../creative/replicateStagingProvider.js'
import { sha256 } from '../../creative/generationRecords.js'
import { buildProviderCostReservation } from '../../creative/providerCostContract.js'
import {
  buildProviderControlScopes,
  providerCircuitScope,
} from '../../creative/providerControlContract.js'
import { repositories } from '../../repositories/index.js'
import { safeProviderLifecycleEvidenceIdentifier } from '../../repositories/providerLifecycleWiring.js'
import { createSeedRepository } from '../../repositories/seedRepository.js'
import { registerMediaRoutes } from '../media/routes.js'
import { registerCreativeRoutes } from '../creative/routes.js'
import { registerAdminRoutes } from './routes.js'

const createTestServer = () => createRouteTestServer(registerAdminRoutes)
const createCreativeAdminServer = () => createRouteTestServer(registerCreativeRoutes, registerAdminRoutes)

const createInjectedAdminServer = (repository, options = {}) => createRouteTestServer(
  (router) => registerAdminRoutes(router, { repositories: repository, ...options }),
)

test('Admin accounting reconciliation routes enforce read, scan, export, and repair permissions', async () => {
  const issue = {
    id: 'accounting-issue-route-1',
    issueKey: 'quota_state_mismatch:window-route-1',
    type: 'quota_state_mismatch',
    unit: 'quota_unit',
    status: 'open',
    sourceType: 'creative_quota_window',
    sourceId: 'window-route-1',
    expectedAmount: 1,
    actualAmount: 2,
    differenceAmount: 1,
    operationKey: null,
    repairOperationKey: null,
    evidence: { withinLimit: false },
    detectedAt: '2026-07-14T00:00:00.000Z',
    reviewedAt: null,
    resolvedAt: null,
  }
  const repository = {
    ...createSeedRepository(),
    accountingReconciliation: {
      list: async () => ({
        items: [issue],
        limit: 20,
        nextCursor: null,
        summary: { total: 1, open: 1, repairPending: 0, resolved: 0, ignored: 0 },
        generatedAt: '2026-07-14T00:00:00.000Z',
      }),
      scan: async () => ({
        issues: { items: [issue], limit: 20, nextCursor: null },
        summary: { total: 1, open: 1, repairPending: 0, resolved: 0, ignored: 0 },
        generatedAt: '2026-07-14T00:00:01.000Z',
      }),
      find: async (id) => id === issue.id ? issue : null,
      requestRepair: async (id, payload, actor) => id === issue.id ? {
        issue: { ...issue, status: 'repair_pending' },
        review: {
          id: `review-accounting-${issue.id}`,
          queue: 'accounting_reconciliation',
          status: 'Pending review',
          owner: actor.handle,
          metadata: { kind: 'accounting_compensation', ...payload },
        },
      } : null,
    },
  }
  const server = await createInjectedAdminServer(repository)
  try {
    const denied = await requestJson(server.url, '/api/admin/accounting/reconciliation', {
      method: 'GET',
      token: 'demo-access.promptlin',
    })
    assert.equal(denied.status, 403)

    const listed = await requestJson(server.url, '/api/admin/accounting/reconciliation?status=open&unit=quota_unit', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })
    assert.equal(listed.status, 200)
    assert.equal(listed.payload.data[0].id, issue.id)
    assert.equal(listed.payload.meta.summary.open, 1)

    const moderatorScan = await requestJson(server.url, '/api/admin/accounting/reconciliation/scan', {
      token: 'demo-access.legalpixel',
      body: {},
    })
    assert.equal(moderatorScan.status, 403)
    const scanned = await requestJson(server.url, '/api/admin/accounting/reconciliation/scan', {
      token: 'demo-access.opsplus',
      body: {},
    })
    assert.equal(scanned.status, 200)
    assert.equal(scanned.payload.meta.generatedAt, '2026-07-14T00:00:01.000Z')

    const detail = await requestJson(server.url, `/api/admin/accounting/reconciliation/${issue.id}`, {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })
    assert.equal(detail.status, 200)
    assert.equal(detail.payload.data.issueKey, issue.issueKey)

    const exported = await requestJson(server.url, '/api/admin/accounting/reconciliation/export', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })
    assert.equal(exported.status, 200)
    assert.equal(exported.payload.issues[0].id, issue.id)

    const repair = await requestJson(server.url, `/api/admin/accounting/reconciliation/${issue.id}/repair-requests`, {
      token: 'demo-access.opsplus',
      body: {
        repairKind: 'compensation',
        reasonCode: 'repair_balance_drift',
        reason: 'Restore the frozen internal invariant.',
      },
    })
    assert.equal(repair.status, 200)
    assert.equal(repair.payload.data.issue.status, 'repair_pending')
    assert.equal(repair.payload.data.review.queue, 'accounting_reconciliation')
  } finally {
    await server.close()
  }
})

test('GET Admin creative accounting policy history is immutable and permission protected', async () => {
  const server = await createTestServer()
  try {
    const denied = await requestJson(server.url, '/api/admin/creative/accounting-policy/history', {
      method: 'GET',
      token: 'demo-access.promptlin',
    })
    assert.equal(denied.status, 403)
    const result = await requestJson(server.url, '/api/admin/creative/accounting-policy/history', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(result.status, 200)
    assert.equal(result.payload.data.length, 1)
    assert.equal(result.payload.data[0].version, 'creative-policy-v1')
    assert.equal(result.payload.data[0].immutable, true)
    assert.equal(result.payload.data[0].policy.history.repriceHistoricalLedger, false)
  } finally {
    await server.close()
  }
})

const providerOutputPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)
const fixtureProviderOutputFetcher = async () => ({
  body: providerOutputPng,
  contentType: 'image/png',
  extension: 'png',
  sizeBytes: providerOutputPng.length,
  sha256: sha256(providerOutputPng),
})

const replicateStagingEnvKeys = [
  'NODE_ENV',
  'ACCESS_TOKEN_SECRET',
  'CREATIVE_PROVIDER_RUNTIME_ENV',
  'CREATIVE_PROVIDER_MODE',
  'CREATIVE_STAGING_IMAGE_PROVIDER',
  'CREATIVE_STAGING_PROVIDER_API_TOKEN',
  'CREATIVE_STAGING_PROVIDER_CONFIRMATION',
  'CREATIVE_STAGING_PROVIDER_ESTIMATE_USD',
  'CREATIVE_STAGING_PROVIDER_DAILY_BUDGET_USD',
  'CREATIVE_STAGING_PROVIDER_DAILY_SPEND_USD',
  'MEDIA_SCAN_PROVIDER',
]

const applyReplicateStagingAdminFixtureEnv = (overrides = {}) => {
  const previous = Object.fromEntries(replicateStagingEnvKeys.map((key) => [key, process.env[key]]))
  Object.assign(process.env, {
    NODE_ENV: 'production',
    ACCESS_TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
    CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
    CREATIVE_PROVIDER_MODE: 'replicate_staging',
    CREATIVE_STAGING_IMAGE_PROVIDER: 'replicate',
    CREATIVE_STAGING_PROVIDER_API_TOKEN: 'replicate-admin-fixture-token',
    CREATIVE_STAGING_PROVIDER_CONFIRMATION: 'staging-only',
    CREATIVE_STAGING_PROVIDER_ESTIMATE_USD: '0.25',
    CREATIVE_STAGING_PROVIDER_DAILY_BUDGET_USD: '5',
    CREATIVE_STAGING_PROVIDER_DAILY_SPEND_USD: '1',
    MEDIA_SCAN_PROVIDER: 'manual',
    ...overrides,
  })
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

test('Provider control Admin APIs enforce dedicated permissions immediate disable and independent recovery', async () => {
  const repository = createSeedRepository()
  const suffix = Date.now()
  const scopes = buildProviderControlScopes({
    providerId: `fixture-admin-control-${suffix}`,
    providerAccountRef: 'staging',
    workspace: 'image',
    modelFamily: 'flux',
  })
  const global = await repository.creativeProviderControls.findControl('global')
  await repository.creativeProviderControls.setControl({
    ...scopes[0],
    enabled: true,
    reasonCode: 'fixture_global_enabled',
    expectedVersion: global?.version ?? 0,
  }, { id: 'demo-user-admin', handle: 'opsplus' })
  const provider = await repository.creativeProviderControls.setControl({
    ...scopes[1],
    enabled: true,
    reasonCode: 'fixture_provider_enabled',
    expectedVersion: 0,
  }, { id: 'demo-user-admin', handle: 'opsplus' })
  await repository.creativeProviderControls.ensureCircuit(providerCircuitScope(scopes), { id: 'demo-user-admin', handle: 'opsplus' })
  await repository.creativeProviderRetries.record({
    sourceKey: `retry-source-private-${suffix}`,
    generationId: `gen-provider-retry-admin-${suffix}`,
    providerId: scopes[1].providerId,
    workspace: 'image',
    operationType: 'status_read',
    status: 'scheduled',
    attempt: 2,
    maxAttempts: 5,
    firstAttemptAt: '2026-07-12T09:00:00.000Z',
    lastAttemptAt: '2026-07-12T09:01:00.000Z',
    nextAttemptAt: '2026-07-12T09:01:30.000Z',
    lastFailureKeyHash: 'a'.repeat(64),
    lastErrorCode: 'PROVIDER_RATE_LIMITED',
    lastErrorCategory: 'rate_limit',
    delaySource: 'retry_after',
    policyHash: 'b'.repeat(64),
    expectedVersion: 0,
  }, { id: 'demo-user-admin', handle: 'opsplus' })
  const server = await createInjectedAdminServer(repository)
  try {
    const denied = await requestJson(server.url, '/api/admin/creative/provider-controls', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })
    assert.equal(denied.status, 403, JSON.stringify(denied.payload))

    const listed = await requestJson(server.url, `/api/admin/creative/provider-controls?providerId=${scopes[1].providerId}`, {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(listed.status, 200)
    const listedControl = listed.payload.data.controls.find((item) => item.providerId === scopes[1].providerId)
    assert.ok(listedControl)
    assert.equal(listedControl.id, provider.control.id)
    assert.equal((await repository.creativeProviderControls.findControlById(listedControl.id)).scopeKey, scopes[1].scopeKey)
    assert.equal(listedControl.scopeKey, null)
    assert.equal(JSON.stringify(listed.payload).includes('providerAccountRef'), false)
    assert.equal(JSON.stringify(listed.payload).includes(scopes[1].scopeKey), false)
    assert.equal(listed.payload.data.retries.length, 1)
    assert.equal(listed.payload.data.retries[0].status, 'scheduled')
    assert.equal(listed.payload.data.retries[0].attempt, 2)
    assert.equal(listed.payload.data.retries[0].errorCategory, 'rate_limit')
    assert.equal(JSON.stringify(listed.payload).includes(`retry-source-private-${suffix}`), false)
    assert.equal(JSON.stringify(listed.payload).includes('a'.repeat(64)), false)
    assert.equal(JSON.stringify(listed.payload).includes('b'.repeat(64)), false)

    const cap = await requestJson(server.url, '/api/admin/creative/provider-controls/cap-evidence', {
      token: 'demo-access.opsplus',
      body: {
        sourceKey: `cap-admin-control-${suffix}`,
        scopeKey: scopes[1].scopeKey,
        providerId: scopes[1].providerId,
        providerAccountRef: 'staging',
        currency: 'USD',
        capAmount: '5',
        remainingAmount: '1',
        sourceType: 'manual_attestation',
        sourceRef: `internal:provider-console:${suffix}`,
        verifiedAt: '2026-07-12T09:00:00.000Z',
        expiresAt: '2026-07-12T11:00:00.000Z',
      },
    })
    assert.equal(cap.status, 200)
    assert.equal(cap.payload.data.evidence.evidenceHashPresent, true)
    assert.equal(JSON.stringify(cap.payload).includes(`internal:provider-console:${suffix}`), false)
    assert.equal(JSON.stringify(cap.payload).includes('providerAccountRef'), false)

    const disabled = await requestJson(server.url, '/api/admin/creative/provider-controls/disable', {
      token: 'demo-access.opsplus',
      body: {
        resourceId: listedControl.id,
        expectedVersion: provider.control.version,
        reasonCode: 'operator_emergency_stop',
      },
    })
    assert.equal(disabled.status, 200)
    assert.equal(disabled.payload.data.control.enabled, false)
    assert.equal(JSON.stringify(disabled.payload).includes('providerAccountRef'), false)
    assert.equal(JSON.stringify(disabled.payload).includes(scopes[1].scopeKey), false)

    const requested = await requestJson(server.url, '/api/admin/creative/provider-controls/recovery-requests', {
      token: 'demo-access.opsplus',
      body: {
        resourceId: listedControl.id,
        target: 'enable',
        expectedVersion: disabled.payload.data.control.version,
        reasonCode: 'incident_resolved',
      },
    })
    assert.equal(requested.status, 200)
    assert.equal(requested.payload.data.review.metadata.kind, 'provider_control_recovery')
    assert.equal(JSON.stringify(requested.payload).includes(scopes[1].scopeKey), false)

    const selfApproval = await requestJson(server.url, `/api/admin/reviews/${requested.payload.data.review.id}/actions`, {
      token: 'demo-access.opsplus',
      body: { decision: 'approve' },
    })
    assert.equal(selfApproval.status, 400)
    assert.match(selfApproval.payload.error.message, /different approver/)

    const approved = await requestJson(server.url, `/api/admin/reviews/${requested.payload.data.review.id}/actions`, {
      token: 'demo-access.finops',
      body: { decision: 'approve', note: 'Independent fixture review complete' },
    })
    assert.equal(approved.status, 200)
    assert.equal(approved.payload.data.review.status, 'Approved')
    assert.equal(approved.payload.data.result.enabled, true)
    assert.equal((await repository.creativeProviderControls.findControl(scopes[1].scopeKey)).enabled, true)
  } finally {
    await server.close()
  }
})

test('GET /api/admin/permissions returns AUTH_REQUIRED when missing auth', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/permissions', { method: 'GET' })

    assert.equal(status, 401)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'AUTH_REQUIRED')
  } finally {
    await server.close()
  }
})

test('GET /api/admin/permissions requires audit read permission', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/permissions', {
      method: 'GET',
      token: 'demo-access.taskops',
    })

    assert.equal(status, 403)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'PERMISSION_DENIED')
    assert.equal(payload.error.message, 'Missing permission: admin:audit:read')
  } finally {
    await server.close()
  }
})

test('GET /api/admin/permissions returns permission catalog for auditors', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/permissions', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })

    assert.equal(status, 200)
    assert.ok(Array.isArray(payload.data))
    assert.ok(payload.data.some((permission) => permission.id === 'admin:queue:review'))
    assert.ok(payload.data.some((permission) => permission.id === 'security:alerts:manage'))
    assert.equal(payload.meta.pagination.limit, payload.data.length)
  } finally {
    await server.close()
  }
})

test('GET /api/admin/roles returns role permission matrix for auditors', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/roles', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })

    assert.equal(status, 200)
    assert.ok(Array.isArray(payload.data))
    const adminRole = payload.data.find((role) => role.role === 'admin')
    const moderatorRole = payload.data.find((role) => role.role === 'moderator')
    assert.ok(adminRole)
    assert.ok(adminRole.permissions.includes('admin:queue:review'))
    assert.ok(adminRole.permissions.includes('security:alerts:manage'))
    assert.ok(moderatorRole)
    assert.equal(moderatorRole.permissions.includes('security:alerts:manage'), false)
    assert.equal(payload.meta.pagination.limit, payload.data.length)
  } finally {
    await server.close()
  }
})

test('GET /api/admin/operations/metrics requires audit read permission', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/operations/metrics', {
      method: 'GET',
      token: 'demo-access.taskops',
    })

    assert.equal(status, 403)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'PERMISSION_DENIED')
    assert.equal(payload.error.message, 'Missing permission: admin:audit:read')
  } finally {
    await server.close()
  }
})

test('GET /api/admin/operations/metrics returns operations aggregates for auditors', async () => {
  resetSecurityEvents()
  const server = await createTestServer()
  try {
    recordSecurityEvent({
      type: 'rate_limit.exceeded',
      severity: 'warning',
      source: 'rate_limit',
      clientKey: '198.51.100.10',
      method: 'POST',
      pathname: '/api/auth/login',
    })

    const { status, payload } = await requestJson(server.url, '/api/admin/operations/metrics?windowMinutes=30', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })

    assert.equal(status, 200)
    assert.equal(payload.error, undefined)
    assert.equal(payload.data.window.minutes, 30)
    assert.ok(payload.data.security.eventsTotal >= 1)
    assert.ok(payload.data.security.eventsBySource.some((item) => item.key === 'rate_limit' && item.count >= 1))
    assert.ok(Array.isArray(payload.data.security.alerts.byState))
    assert.ok(Number.isInteger(payload.data.mediaScan.archiveCandidates.total))
    assert.ok(Array.isArray(payload.data.mediaScan.archiveWrites.byProvider))
  } finally {
    resetSecurityEvents()
    await server.close()
  }
})

test('GET /api/admin/creative/generations requires audit read permission', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/creative/generations', {
      method: 'GET',
      token: 'demo-access.taskops',
    })

    assert.equal(status, 403)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'PERMISSION_DENIED')
    assert.equal(payload.error.message, 'Missing permission: admin:audit:read')
  } finally {
    await server.close()
  }
})

test('GET /api/admin/creative/generations lists and filters provider generation history', async () => {
  resetCreativePolicyState()
  const previousProvider = process.env.MEDIA_SCAN_PROVIDER
  process.env.MEDIA_SCAN_PROVIDER = 'mock'
  const server = await createCreativeAdminServer()
  try {
    const generated = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        prompt: 'A celebrity campaign poster for Admin history review filter',
      },
      token: 'demo-access.promptlin',
    })
    assert.equal(generated.status, 200)
    assert.equal(generated.payload.data.status, 'review_required')
    const generationId = generated.payload.data.id
    const mediaAssetId = generated.payload.data.outputs[0].storage.mediaAssetId
    await repositories.creativeProviderReplays.record({
      generationId,
      providerId: 'mock',
      providerMode: null,
      providerJobId: generated.payload.data.providerJobId,
      providerEventId: 'event-admin-history-replay-1',
      sourceType: 'polling',
      idempotencyKey: `admin-history:${generationId}:review_required:digest`,
      payloadHash: 'payload-hash-admin-history-replay-1',
      previousStatus: 'running',
      normalizedStatus: 'review_required',
      action: 'applied',
      reasonCode: null,
      sideEffectResult: {
        completed: true,
        completedOperationKeys: ['provider-output.persist', 'credit.settle'],
        operations: [{
          type: 'persist_outputs',
          status: 'completed',
          metadata: { rawOutputUrl: 'mock://admin-history-output-should-not-leak.png' },
        }],
      },
      receivedAt: '2026-07-06T13:00:00.000Z',
      appliedAt: '2026-07-06T13:00:01.000Z',
    }, { id: 'demo-user-admin', handle: 'legalpixel' })
    await repositories.creativeProviderReplays.record({
      generationId,
      providerId: 'mock',
      providerMode: null,
      providerJobId: generated.payload.data.providerJobId,
      providerEventId: 'event-admin-history-replay-2',
      sourceType: 'manual_replay',
      idempotencyKey: `admin-history:${generationId}:review_required:rejected-digest`,
      payloadHash: 'payload-hash-admin-history-replay-2',
      previousStatus: 'running',
      normalizedStatus: 'review_required',
      action: 'rejected',
      reasonCode: 'side_effect_failed',
      errorPreview: 'settlement failed with token=admin-history-secret-should-not-leak',
      sideEffectResult: {
        completed: false,
        failedOperationType: 'settle_credits',
        completedOperationKeys: ['provider-output.persist'],
        operations: [{
          type: 'settle_credits',
          status: 'failed',
          errorPreview: 'settlement failed with token=admin-history-secret-should-not-leak',
        }],
      },
      receivedAt: '2026-07-06T13:01:00.000Z',
      appliedAt: null,
    }, { id: 'demo-user-admin', handle: 'legalpixel' })

    const list = await requestJson(
      server.url,
      `/api/admin/creative/generations?userHandle=promptlin&workspace=image&providerId=mock&status=review_required&reviewRequired=true&mediaAssetId=${mediaAssetId}&limit=5`,
      {
        method: 'GET',
        token: 'demo-access.legalpixel',
      },
    )

    assert.equal(list.status, 200)
    assert.equal(list.payload.error, undefined)
    assert.equal(list.payload.meta.pagination.limit, 5)
    const item = list.payload.data.find((entry) => entry.id === generationId)
    assert.ok(item)
    assert.equal(item.actorHandle, 'promptlin')
    assert.equal(item.workspace, 'image')
    assert.equal(item.providerId, 'mock')
    assert.equal(item.status, 'review_required')
    assert.equal(item.safety.reviewRequired, true)
    assert.equal(item.credit.status, 'settled')
    assert.equal(item.quota.reservationId, item.credit.quotaReservationId)
    assert.deepEqual(item.outputAssetIds, [mediaAssetId])
    assert.equal('prompt' in item, false)
    assert.equal(item.providerReplayEvidence.available, true)
    assert.equal(item.providerReplayEvidence.count, 2)
    assert.equal(item.providerReplayEvidence.appliedCount, 1)
    assert.equal(item.providerReplayEvidence.rejectedCount, 1)
    assert.equal(item.providerReplayEvidence.noopCount, 0)
    assert.match(item.providerReplayEvidence.latest.id, /^provider-replay-/)
    assert.equal(item.providerReplayEvidence.latest.sourceType, 'manual_replay')
    assert.equal(item.providerReplayEvidence.latest.action, 'rejected')
    assert.equal(item.providerReplayEvidence.latest.previousStatus, 'running')
    assert.equal(item.providerReplayEvidence.latest.normalizedStatus, 'review_required')
    assert.equal(item.providerReplayEvidence.latest.reasonCode, 'side_effect_failed')
    assert.equal(item.providerReplayEvidence.latest.providerEventIdPresent, true)
    assert.equal(item.providerReplayEvidence.latest.payloadHashPresent, true)
    assert.equal(item.providerReplayEvidence.latest.payloadHashPreview, 'payload-hash')
    assert.equal(item.providerReplayEvidence.latest.sideEffectOutcome, 'failed')
    assert.equal(item.providerReplayEvidence.latest.sideEffectCompleted, false)
    assert.equal(item.providerReplayEvidence.latest.completedOperationCount, 1)
    assert.equal(item.providerReplayEvidence.latest.failedOperationType, 'settle_credits')
    assert.equal(item.providerReplayEvidence.latest.errorPreviewPresent, true)
    assert.equal(item.providerReplayEvidence.latest.receivedAt, '2026-07-06T13:01:00.000Z')
    assert.equal(item.providerReplayEvidence.latest.appliedAt, null)
    assert.equal(JSON.stringify(item.providerReplayEvidence).includes('admin-history-output-should-not-leak'), false)
    assert.equal(JSON.stringify(item.providerReplayEvidence).includes('admin-history-secret-should-not-leak'), false)

    const detail = await requestJson(server.url, `/api/admin/creative/generations/${generationId}`, {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })
    assert.equal(detail.status, 200)
    assert.equal(detail.payload.data.id, generationId)
    assert.equal(detail.payload.data.promptPreview, 'A celebrity campaign poster for Admin history review filter')
    assert.equal(detail.payload.data.credit.status, 'settled')
    assert.equal(detail.payload.data.providerReplayEvidence.count, 2)
    assert.equal(detail.payload.data.providerReplayEvidence.latest.payloadHashPreview, 'payload-hash')
    assert.equal(detail.payload.data.providerReplayEvidence.latest.errorPreviewPresent, true)
    assert.equal(JSON.stringify(detail.payload.data.providerReplayEvidence).includes('mock://'), false)
    assert.equal(JSON.stringify(detail.payload.data.providerReplayEvidence).includes('admin-history-secret-should-not-leak'), false)
  } finally {
    await server.close()
    resetCreativePolicyState()
    if (previousProvider == null) {
      delete process.env.MEDIA_SCAN_PROVIDER
    } else {
      process.env.MEDIA_SCAN_PROVIDER = previousProvider
    }
  }
})

test('GET /api/admin/creative/generations folds unsafe provider replay summary evidence', async () => {
  const generationId = `generation-admin-replay-summary-${Date.now()}`
  const unsafeValues = {
    replayId: 'https://provider.example/replays/admin?token=replay-secret',
    sourceType: 'webhook?token=source-type-secret',
    action: 'rejected?token=action-secret',
    previousStatus: 'running?token=previous-secret',
    normalizedStatus: 'failed?token=normalized-secret',
    reasonCode: 'side_effect_failed?token=reason-secret',
    payloadHash: 'https://provider.example/payload?token=payload-secret',
    outcome: 'failed?token=outcome-secret',
    failedOperationType: 'settle_credits?token=operation-secret',
  }
  const actor = { id: 'demo-user-creator', handle: 'promptlin' }
  await repositories.creativeGenerations.create({
    id: generationId,
    actorId: actor.id,
    actorHandle: actor.handle,
    workspace: 'image',
    mode: 'text_to_image',
    providerId: 'mock',
    providerMode: 'mock',
    status: 'failed',
    promptHash: 'd'.repeat(64),
    promptPreview: 'Unsafe replay summary fixture',
    inputAssetIds: [],
    parameterKeys: [],
    outputAssetIds: [],
    usage: { estimatedCredits: 0, costModel: 'fixture' },
    credit: null,
    quota: null,
    safety: { reviewRequired: false },
    policy: { action: 'allow' },
    providerJobId: 'mock-provider-job-safe',
  }, actor)
  await repositories.creativeProviderReplays.record({
    id: unsafeValues.replayId,
    generationId,
    providerId: 'mock',
    providerMode: 'mock',
    providerJobId: 'mock-provider-job-safe',
    providerEventId: 'event-admin-replay-summary',
    sourceType: unsafeValues.sourceType,
    idempotencyKey: `admin-replay-summary:${generationId}`,
    payloadHash: unsafeValues.payloadHash,
    previousStatus: unsafeValues.previousStatus,
    normalizedStatus: unsafeValues.normalizedStatus,
    action: unsafeValues.action,
    reasonCode: unsafeValues.reasonCode,
    sideEffectPlan: {
      operations: [{ key: 'https://provider.example/operation?token=plan-secret' }],
    },
    sideEffectResult: {
      completed: false,
      outcome: unsafeValues.outcome,
      completedOperationKeys: [],
      failedOperationType: unsafeValues.failedOperationType,
      operations: [{
        type: unsafeValues.failedOperationType,
        status: 'failed',
        errorPreview: 'failed at https://provider.example/error?token=result-secret',
      }],
    },
    errorPreview: 'failed at https://provider.example/error?token=replay-error-secret',
    receivedAt: '2026-07-10T14:40:00.000Z',
  }, actor)

  const server = await createTestServer()
  try {
    const list = await requestJson(server.url, '/api/admin/creative/generations?providerId=mock&limit=100', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    const detail = await requestJson(server.url, `/api/admin/creative/generations/${generationId}`, {
      method: 'GET',
      token: 'demo-access.opsplus',
    })

    assert.equal(list.status, 200)
    assert.equal(detail.status, 200)
    const listed = list.payload.data.find((item) => item.id === generationId)
    assert.ok(listed)

    for (const item of [listed, detail.payload.data]) {
      const latest = item.providerReplayEvidence.latest
      for (const key of [
        'id',
        'sourceType',
        'action',
        'previousStatus',
        'normalizedStatus',
        'reasonCode',
        'payloadHashPreview',
        'sideEffectOutcome',
        'failedOperationType',
      ]) {
        assert.match(latest[key], /^redacted_[a-f0-9]{16}$/)
      }
      assert.equal(latest.providerEventIdPresent, true)
      assert.equal(latest.payloadHashPresent, true)
      assert.equal(latest.sideEffectCompleted, false)
      assert.equal(latest.completedOperationCount, 0)
      assert.equal(latest.errorPreviewPresent, true)
      assert.equal('sideEffectPlan' in latest, false)
      assert.equal('sideEffectResult' in latest, false)

      const serialized = JSON.stringify(item.providerReplayEvidence)
      for (const unsafe of [...Object.values(unsafeValues), 'plan-secret', 'result-secret', 'replay-error-secret']) {
        assert.equal(serialized.includes(unsafe), false)
      }
      assert.equal(serialized.includes('provider.example'), false)
    }
  } finally {
    await server.close()
  }
})

test('GET Admin generation history exposes only safe output ingestion summaries', async () => {
  const repository = createSeedRepository()
  const generationId = `gen-admin-output-ingestion-${Date.now()}`
  const actor = { id: 'demo-user-creator', handle: 'promptlin' }
  await repository.creativeGenerations.create({
    id: generationId,
    actorId: actor.id,
    actorHandle: actor.handle,
    workspace: 'image',
    mode: 'text_to_image',
    providerId: 'replicate',
    providerMode: 'replicate_staging',
    providerJobId: `prediction-${generationId}`,
    status: 'completed',
    promptHash: 'e'.repeat(64),
    promptPreview: 'Admin ingestion summary fixture',
    inputAssetIds: [],
    parameterKeys: [],
    outputAssetIds: ['media-admin-ingestion-1'],
  }, actor)
  const recorded = await repository.creativeOutputIngestions.record({
    sourceKey: `creative-output:${'a'.repeat(64)}`,
    generationId,
    providerId: 'replicate',
    providerJobId: `prediction-${generationId}`,
    outputDigest: 'b'.repeat(64),
    outputIndex: 0,
    rawUrl: 'https://provider.example/output.png?token=admin-ingestion-secret',
  }, actor)
  await repository.creativeOutputIngestions.update(recorded.ingestion.id, {
    status: 'completed',
    mediaAssetId: 'media-admin-ingestion-1',
    storageKey: 'promptlin/generated/image/media-admin-ingestion-1.png',
    detectedContentType: 'image/png',
    sizeBytes: 68,
    sha256: 'c'.repeat(64),
    completedAt: '2026-07-11T13:30:00.000Z',
  }, actor)

  const server = await createInjectedAdminServer(repository)
  try {
    const list = await requestJson(server.url, '/api/admin/creative/generations?providerId=replicate&limit=20', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })
    assert.equal(list.status, 200)
    const item = list.payload.data.find((entry) => entry.id === generationId)
    assert.ok(item)
    assert.equal(item.outputIngestionEvidence.available, true)
    assert.equal(item.outputIngestionEvidence.count, 1)
    assert.equal(item.outputIngestionEvidence.completedCount, 1)
    assert.equal(item.outputIngestionEvidence.failedCount, 0)
    assert.equal(item.outputIngestionEvidence.latest.status, 'completed')
    assert.equal(item.outputIngestionEvidence.latest.detectedContentType, 'image/png')
    assert.equal(item.outputIngestionEvidence.latest.sizeBytes, 68)
    assert.equal(item.outputIngestionEvidence.latest.sha256Present, true)
    assert.equal(item.outputIngestionEvidence.latest.sha256Preview, 'cccccccccccc')
    assert.equal(JSON.stringify(item.outputIngestionEvidence).includes('admin-ingestion-secret'), false)
    assert.equal(JSON.stringify(item.outputIngestionEvidence).includes('provider.example'), false)

    const detail = await requestJson(server.url, `/api/admin/creative/generations/${generationId}`, {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })
    assert.equal(detail.status, 200)
    assert.deepEqual(detail.payload.data.outputIngestionEvidence, item.outputIngestionEvidence)
  } finally {
    await server.close()
  }
})

test('GET Admin generation history exposes safe durable Provider cost ledger evidence', async () => {
  const repository = createSeedRepository()
  const generationId = `gen-admin-provider-cost-ledger-${Date.now()}`
  const actor = { id: 'demo-user-creator', handle: 'promptlin' }
  await repository.creativeGenerations.create({
    id: generationId,
    actorId: actor.id,
    actorHandle: actor.handle,
    workspace: 'image',
    mode: 'text_to_image',
    providerId: 'replicate-staging',
    providerMode: 'replicate_staging',
    providerJobId: 'pred-admin-cost-ledger',
    status: 'completed',
    promptHash: 'a'.repeat(64),
    promptPreview: 'Admin Provider cost ledger fixture',
    inputAssetIds: [],
    parameterKeys: [],
    outputAssetIds: [],
  }, actor)
  const reservation = buildProviderCostReservation({
    generationId,
    workspace: 'image',
    mode: 'text_to_image',
    now: new Date('2026-07-12T08:00:00.000Z'),
    providerCost: {
      providerId: 'replicate',
      providerAccountRef: 'staging',
      model: {
        providerModelId: 'black-forest-labs/flux-1.1-pro',
        pricingSource: 'fixture_config',
        pricingSnapshotAt: '2026-07-12T00:00:00.000Z',
      },
      estimate: { currency: 'USD', amount: 0.25 },
      budget: {
        budgetScope: `staging:replicate:image:admin-${Date.now()}`,
        dailyCapCurrency: 'USD',
        dailyCapAmount: 5,
        spentAmount: 1,
      },
    },
  })
  await repository.creativeProviderCosts.reserve(reservation, actor)
  await repository.creativeProviderCosts.settle(reservation.sourceKey, {
    actualMicros: '200000',
    actualCurrency: 'USD',
    providerJobId: 'pred-admin-cost-ledger',
  }, actor)

  const server = await createInjectedAdminServer(repository)
  try {
    const list = await requestJson(server.url, '/api/admin/creative/generations?providerId=replicate-staging&limit=20', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })
    assert.equal(list.status, 200)
    const item = list.payload.data.find((entry) => entry.id === generationId)
    assert.ok(item)
    assert.equal(item.providerCostLedgerEvidence.available, true)
    assert.equal(item.providerCostLedgerEvidence.status, 'settled')
    assert.equal(item.providerCostLedgerEvidence.currency, 'USD')
    assert.equal(item.providerCostLedgerEvidence.estimateAmount, 0.25)
    assert.equal(item.providerCostLedgerEvidence.actualAmount, 0.2)
    assert.equal(item.providerCostLedgerEvidence.budget.capAmount, 5)
    assert.equal(item.providerCostLedgerEvidence.budget.spentAmount, 1.2)
    assert.equal(item.providerCostLedgerEvidence.pricingSnapshotHashPreview.length, 12)
    const serialized = JSON.stringify(item.providerCostLedgerEvidence)
    assert.equal(serialized.includes('sourceKey'), false)
    assert.equal(serialized.includes('providerJobId'), false)
    assert.equal(serialized.includes('prompt'), false)
  } finally {
    await server.close()
  }
})

test('GET /api/admin/creative/generations reads Replicate fixture evidence without raw provider data', async () => {
  resetCreativePolicyState()
  const restoreEnv = applyReplicateStagingAdminFixtureEnv()
  const calls = []
  const mockedClient = {
    createPrediction: async (payload) => {
      calls.push(payload)
      return {
        id: 'pred admin route token=replicate-admin-fixture-token https://replicate.example/admin-route-job',
        status: 'succeeded',
        output: ['https://replicate.example/admin-route-output-should-not-leak.png'],
        metrics: { predict_time: 2.75 },
        costUsd: 0.2,
        completed_at: '2026-07-06T14:20:00.000Z',
      }
    },
  }
  const fixtureAdapters = {
    'replicate-staging': ({ request, provider, actor, source, now, generationId }) =>
      createReplicateStagingPrediction({
        request,
        provider,
        actor,
        source,
        now,
        generationId,
        client: mockedClient,
      }),
  }
  const server = await createRouteTestServer(
    (router) => registerCreativeRoutes(router, {
      fixtureAdapters,
      providerOutputFetcher: fixtureProviderOutputFetcher,
    }),
    registerMediaRoutes,
    registerAdminRoutes,
  )
  try {
    const generated = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        providerId: 'replicate-staging',
        prompt: 'A Replicate fixture for Admin read-only evidence',
        parameters: {
          aspectRatio: '1:1',
          seed: 11,
        },
      },
      token: 'demo-access.promptlin',
    })

    assert.equal(generated.status, 200)
    assert.equal(calls.length, 1)
    assert.equal(JSON.stringify(calls[0]).includes('replicate-admin-fixture-token'), false)
    assert.equal(JSON.stringify(calls[0]).includes('raw-admin-provider-payload'), false)
    const generationId = generated.payload.data.id
    const mediaAssetId = generated.payload.data.outputs[0].storage.mediaAssetId
    const safeProviderJobId = generated.payload.data.providerRequestId
    assert.match(safeProviderJobId, /^redacted_[a-f0-9]{16}$/)
    assert.equal(generated.payload.data.providerJobId, safeProviderJobId)
    assert.equal(generated.payload.data.outputs[0].url, `/api/media/assets/${mediaAssetId}/download`)
    assert.equal(generated.payload.data.outputs[0].source.predictionId, safeProviderJobId)
    const generatedSerialized = JSON.stringify(generated.payload.data)
    assert.equal(generatedSerialized.includes('admin-route-job'), false)
    assert.equal(generatedSerialized.includes('admin-route-output-should-not-leak'), false)
    assert.equal(generatedSerialized.includes('https://replicate.example'), false)
    assert.equal(generatedSerialized.includes('replicate-admin-fixture-token'), false)
    assert.equal(generatedSerialized.includes('raw-admin-provider-payload'), false)

    const mediaQueue = await requestJson(server.url, `/api/media/review-queue?status=all&search=${mediaAssetId}&limit=5`, {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })
    assert.equal(mediaQueue.status, 200)
    const mediaItem = mediaQueue.payload.data.find((asset) => asset.id === mediaAssetId)
    assert.ok(mediaItem)
    assert.equal(mediaItem.metadata.creative.sourceUrl, null)
    assert.equal(JSON.stringify(mediaItem.metadata.creative).includes('admin-route-output-should-not-leak'), false)

    const list = await requestJson(
      server.url,
      `/api/admin/creative/generations?providerId=replicate-staging&mediaAssetId=${mediaAssetId}&limit=5`,
      {
        method: 'GET',
        token: 'demo-access.legalpixel',
      },
    )
    assert.equal(list.status, 200)
    const item = list.payload.data.find((entry) => entry.id === generationId)
    assert.ok(item)
    assert.equal(item.providerId, 'replicate-staging')
    assert.equal(item.providerRequestId, safeProviderJobId)
    assert.equal(item.providerJobId, safeProviderJobId)
    assert.deepEqual(item.parameterKeys, ['aspectRatio', 'seed'])
    assert.deepEqual(item.outputAssetIds, [mediaAssetId])
    assert.equal(item.usage.providerCost.schemaVersion, 'provider-cost-v1')
    assert.equal(item.usage.providerCost.job.providerJobId, safeProviderJobId)
    assert.equal(item.usage.providerCost.usage.quantity, 2.75)
    assert.equal(item.usage.providerCost.usage.rawProviderUsageHash.length, 64)
    assert.equal(item.usage.providerCost.actual.amount, 0.2)
    assert.equal(item.usage.providerCost.budget.budgetScope, 'staging:replicate:image')
    assert.equal(item.usage.providerCost.budget.status, 'within_budget')
    assert.equal(item.providerReplayEvidence.available, true)
    assert.equal(item.providerReplayEvidence.count, 0)
    assert.equal('prompt' in item, false)

    const detail = await requestJson(server.url, `/api/admin/creative/generations/${generationId}`, {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })
    assert.equal(detail.status, 200)
    assert.equal(detail.payload.data.promptPreview, 'A Replicate fixture for Admin read-only evidence')
    assert.equal(detail.payload.data.providerRequestId, safeProviderJobId)
    assert.equal(detail.payload.data.providerJobId, safeProviderJobId)
    assert.equal(detail.payload.data.usage.providerCost.job.providerRequestId, safeProviderJobId)

    const serialized = JSON.stringify(detail.payload.data)
    assert.equal(serialized.includes('admin-route-job'), false)
    assert.equal(serialized.includes('admin-route-output-should-not-leak'), false)
    assert.equal(serialized.includes('https://replicate.example'), false)
    assert.equal(serialized.includes('replicate-admin-fixture-token'), false)
    assert.equal(serialized.includes('raw-admin-provider-payload'), false)
  } finally {
    await server.close()
    restoreEnv()
    resetCreativePolicyState()
  }
})

test('GET /api/admin/creative/generations surfaces sanitized provider cost and budget metadata', async () => {
  const generationId = 'admin-provider-cost-history-fixture'
  await repositories.creativeGenerations.create({
    id: generationId,
    actorId: 'demo-user-promptlin',
    actorHandle: 'promptlin',
    workspace: 'image',
    mode: 'text_to_image',
    providerId: 'replicate-staging',
    providerMode: 'staging',
    status: 'completed',
    promptHash: 'a'.repeat(64),
    promptPreview: 'Admin provider cost fixture preview',
    inputAssetIds: [],
    parameterKeys: ['aspectRatio', 'seed'],
    outputAssetIds: ['media-admin-provider-cost-fixture'],
    usage: {
      estimatedCredits: 1,
      providerCostCents: 20,
      metered: true,
      providerUsageUnit: 'prediction',
      providerCost: {
        schemaVersion: 'provider-cost-v1',
        providerId: 'replicate',
        providerAccountRef: 'staging',
        rawProviderPayload: 'raw-provider-payload-should-not-leak',
        model: {
          providerModelId: 'replicate:image:staging',
          providerModelVersion: 'v1',
          displayName: 'Replicate image staging',
          family: 'image',
          pricingSource: 'fixture_public_pricing',
          pricingSnapshotAt: '2026-07-06T00:00:00.000Z',
          rawPricingPayload: 'raw-pricing-payload-should-not-leak',
        },
        job: {
          providerRequestId: 'pred_admin_provider_cost_fixture',
          providerJobId: 'pred_admin_provider_cost_fixture',
          region: 'fixture-region',
          startedAt: '2026-07-06T12:00:00.000Z',
          completedAt: '2026-07-06T12:00:01.000Z',
          outputUrl: 'mock://provider-output-url-should-not-leak.png',
        },
        usage: {
          unit: 'hardware_seconds',
          quantity: 2.5,
          hardwareClass: 'fixture-gpu',
          outputCount: 1,
          inputTokenCount: null,
          outputTokenCount: null,
          rawProviderUsageHash: 'b'.repeat(64),
          rawProviderUsage: { billingAccount: 'billing-account-should-not-leak' },
        },
        estimate: {
          currency: 'USD',
          amount: 0.25,
          source: 'pre_dispatch_estimate',
          confidence: 'estimated',
          calculatedAt: '2026-07-06T12:00:00.000Z',
        },
        actual: {
          currency: 'USD',
          amount: 0.2,
          source: 'provider_result_metadata',
          confidence: 'provider_reported',
          settledAt: '2026-07-06T12:00:01.000Z',
        },
        budget: {
          budgetScope: 'staging:replicate:image',
          dailyCapCurrency: 'USD',
          dailyCapAmount: 5,
          spentAmount: 1,
          projectedSpendAmount: 1.25,
          remainingAfterEstimateAmount: 3.75,
          thresholdPercent: 80,
          status: 'within_budget',
          rawBudgetSource: 'budget-source-should-not-leak',
        },
        risk: {
          costKnown: true,
          costExceededEstimate: false,
          providerUsageMissing: false,
          billingReconciliationRequired: false,
          rawRiskTrace: 'risk-trace-should-not-leak',
        },
      },
      rawUsagePayload: 'raw-usage-payload-should-not-leak',
    },
    credit: { status: 'settled', reserved: 1, settled: 1, refunded: 0, quotaReservationId: 'quota-admin-provider-cost-fixture' },
    quota: { reservationId: 'quota-admin-provider-cost-fixture', scope: 'user:promptlin', workspace: 'image', limit: 20, reserved: 0, used: 1, released: 0, remaining: 19 },
    safety: { moderationRequired: false, reviewRequired: false },
    policy: { version: 'creative-policy-v1', gates: { quota: true, credit: true, moderation: true, review: true } },
    providerRequestId: 'pred_admin_provider_cost_fixture',
    providerJobId: 'pred_admin_provider_cost_fixture',
    createdAt: '2026-07-06T12:00:00.000Z',
    completedAt: '2026-07-06T12:00:01.000Z',
  }, { id: 'demo-user-admin', handle: 'legalpixel' })

  const server = await createTestServer()
  try {
    const list = await requestJson(
      server.url,
      '/api/admin/creative/generations?providerId=replicate-staging&mediaAssetId=media-admin-provider-cost-fixture&limit=5',
      {
        method: 'GET',
        token: 'demo-access.legalpixel',
      },
    )

    assert.equal(list.status, 200)
    const item = list.payload.data.find((entry) => entry.id === generationId)
    assert.ok(item)
    assert.equal(item.usage.estimatedCredits, 1)
    assert.equal('providerCostCents' in item.usage, false)
    assert.equal(item.usage.providerCost.schemaVersion, 'provider-cost-v1')
    assert.equal(item.usage.providerCost.providerId, 'replicate')
    assert.equal(item.usage.providerCost.providerAccountRef, 'staging')
    assert.equal(item.usage.providerCost.model.providerModelId, 'replicate:image:staging')
    assert.equal(item.usage.providerCost.usage.unit, 'hardware_seconds')
    assert.equal(item.usage.providerCost.usage.quantity, 2.5)
    assert.equal(item.usage.providerCost.usage.rawProviderUsageHash, 'b'.repeat(64))
    assert.equal(item.usage.providerCost.estimate.amount, 0.25)
    assert.equal(item.usage.providerCost.actual.amount, 0.2)
    assert.equal(item.usage.providerCost.budget.budgetScope, 'staging:replicate:image')
    assert.equal(item.usage.providerCost.budget.status, 'within_budget')
    assert.equal(item.usage.providerCost.budget.projectedSpendAmount, 1.25)
    assert.equal(item.usage.providerCost.risk.costKnown, true)
    assert.equal(item.usage.providerCost.risk.costExceededEstimate, false)
    assert.equal(item.providerReplayEvidence.available, true)
    assert.equal(item.providerReplayEvidence.count, 0)
    assert.equal('prompt' in item, false)

    const detail = await requestJson(server.url, `/api/admin/creative/generations/${generationId}`, {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })
    assert.equal(detail.status, 200)
    assert.equal(detail.payload.data.usage.providerCost.actual.confidence, 'provider_reported')
    assert.equal(detail.payload.data.usage.providerCost.job.providerJobId, 'pred_admin_provider_cost_fixture')

    const serialized = JSON.stringify(detail.payload.data)
    assert.equal(serialized.includes('raw-provider-payload-should-not-leak'), false)
    assert.equal(serialized.includes('raw-pricing-payload-should-not-leak'), false)
    assert.equal(serialized.includes('provider-output-url-should-not-leak'), false)
    assert.equal(serialized.includes('billing-account-should-not-leak'), false)
    assert.equal(serialized.includes('budget-source-should-not-leak'), false)
    assert.equal(serialized.includes('risk-trace-should-not-leak'), false)
    assert.equal(serialized.includes('raw-usage-payload-should-not-leak'), false)
  } finally {
    await server.close()
  }
})

test('GET /api/admin/creative/generations folds unsafe provider cost read-side identifiers', async () => {
  const generationId = 'admin-provider-cost-unsafe-identifier-fixture'
  await repositories.creativeGenerations.create({
    id: generationId,
    actorId: 'demo-user-promptlin',
    actorHandle: 'promptlin',
    workspace: 'image',
    mode: 'text_to_image',
    providerId: 'replicate-staging',
    providerMode: 'staging',
    status: 'completed',
    promptHash: 'e'.repeat(64),
    promptPreview: 'Admin provider cost unsafe identifier fixture',
    inputAssetIds: [],
    parameterKeys: ['aspectRatio'],
    outputAssetIds: ['media-admin-provider-cost-unsafe-identifiers'],
    usage: {
      estimatedCredits: 1,
      providerCostCents: 20,
      metered: true,
      providerCost: {
        schemaVersion: 'provider-cost-v1',
        providerId: 'replicate?token=provider-secret',
        providerAccountRef: 'https://replicate.example/accounts/admin?token=account-secret',
        model: {
          providerModelId: 'replicate:image:admin?token=model-secret',
          providerModelVersion: 'v1',
          displayName: 'Replicate image staging',
          family: 'image',
          pricingSource: 'fixture_public_pricing',
          pricingSnapshotAt: '2026-07-06T00:00:00.000Z',
        },
        job: {
          providerRequestId: 'https://replicate.example/request/pred_admin?token=request-secret',
          providerJobId: 'https://replicate.example/predictions/pred_admin?token=job-secret',
          region: 'fixture-region',
          startedAt: '2026-07-06T12:00:00.000Z',
          completedAt: '2026-07-06T12:00:01.000Z',
        },
        usage: {
          unit: 'hardware_seconds',
          quantity: 2.5,
          rawProviderUsageHash: 'c'.repeat(64),
        },
        estimate: {
          currency: 'USD',
          amount: 0.25,
          source: 'pre_dispatch_estimate',
          confidence: 'estimated',
          calculatedAt: '2026-07-06T12:00:00.000Z',
        },
        actual: {
          currency: 'USD',
          amount: 0.2,
          source: 'provider_result_metadata',
          confidence: 'provider_reported',
          settledAt: '2026-07-06T12:00:01.000Z',
        },
        budget: {
          budgetScope: 'https://ops.example.com/budget/admin?token=budget-secret',
          dailyCapCurrency: 'USD',
          dailyCapAmount: 5,
          spentAmount: 1,
          projectedSpendAmount: 1.25,
          remainingAfterEstimateAmount: 3.75,
          thresholdPercent: 80,
          status: 'within_budget',
        },
        risk: {
          costKnown: true,
          costExceededEstimate: false,
          providerUsageMissing: false,
          billingReconciliationRequired: false,
        },
      },
    },
    credit: { status: 'settled', reserved: 1, settled: 1, refunded: 0, quotaReservationId: 'quota-admin-provider-cost-unsafe-identifiers' },
    quota: { reservationId: 'quota-admin-provider-cost-unsafe-identifiers', scope: 'user:promptlin', workspace: 'image', limit: 20, reserved: 0, used: 1, released: 0, remaining: 19 },
    safety: { moderationRequired: false, reviewRequired: false },
    policy: { version: 'creative-policy-v1', gates: { quota: true, credit: true, moderation: true, review: true } },
    providerRequestId: 'pred_admin_provider_cost_unsafe_identifiers',
    providerJobId: 'pred_admin_provider_cost_unsafe_identifiers',
    createdAt: '2026-07-06T12:05:00.000Z',
    completedAt: '2026-07-06T12:05:01.000Z',
  }, { id: 'demo-user-admin', handle: 'legalpixel' })

  const server = await createTestServer()
  try {
    const list = await requestJson(
      server.url,
      '/api/admin/creative/generations?providerId=replicate-staging&mediaAssetId=media-admin-provider-cost-unsafe-identifiers&limit=5',
      {
        method: 'GET',
        token: 'demo-access.legalpixel',
      },
    )

    assert.equal(list.status, 200)
    const item = list.payload.data.find((entry) => entry.id === generationId)
    assert.ok(item)
    assert.match(item.usage.providerCost.providerId, /^redacted_[a-f0-9]{16}$/)
    assert.match(item.usage.providerCost.providerAccountRef, /^redacted_[a-f0-9]{16}$/)
    assert.match(item.usage.providerCost.model.providerModelId, /^redacted_[a-f0-9]{16}$/)
    assert.match(item.usage.providerCost.job.providerRequestId, /^redacted_[a-f0-9]{16}$/)
    assert.match(item.usage.providerCost.job.providerJobId, /^redacted_[a-f0-9]{16}$/)
    assert.match(item.usage.providerCost.budget.budgetScope, /^redacted_[a-f0-9]{16}$/)

    const detail = await requestJson(server.url, `/api/admin/creative/generations/${generationId}`, {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })
    assert.equal(detail.status, 200)
    assert.equal(detail.payload.data.usage.providerCost.actual.confidence, 'provider_reported')
    assert.match(detail.payload.data.usage.providerCost.budget.budgetScope, /^redacted_[a-f0-9]{16}$/)

    const serialized = JSON.stringify({ list: item, detail: detail.payload.data })
    assert.equal(serialized.includes('provider-secret'), false)
    assert.equal(serialized.includes('account-secret'), false)
    assert.equal(serialized.includes('model-secret'), false)
    assert.equal(serialized.includes('request-secret'), false)
    assert.equal(serialized.includes('job-secret'), false)
    assert.equal(serialized.includes('budget-secret'), false)
    assert.equal(serialized.includes('replicate.example'), false)
    assert.equal(serialized.includes('ops.example.com'), false)
  } finally {
    await server.close()
  }
})

test('GET /api/admin/creative/generations redacts durable failed generation evidence', async () => {
  const generationId = 'admin-failed-generation-redaction-fixture'
  await repositories.creativeGenerations.create({
    id: generationId,
    actorId: 'demo-user-promptlin',
    actorHandle: 'promptlin',
    workspace: 'image',
    mode: 'text_to_image',
    providerId: 'replicate-staging',
    providerMode: 'replicate_staging',
    status: 'queued',
    promptHash: 'c'.repeat(64),
    promptPreview: 'Admin failed generation redaction fixture',
    inputAssetIds: [],
    parameterKeys: ['aspectRatio'],
    outputAssetIds: [],
    usage: { estimatedCredits: 1, metered: true },
    credit: {
      status: 'refunded',
      reserved: 1,
      settled: 0,
      refunded: 1,
      reasonCode: 'PROVIDER_EXECUTION_FAILED',
      quotaReservationId: 'quota-admin-failed-redaction-fixture',
    },
    quota: {
      reservationId: 'quota-admin-failed-redaction-fixture',
      scope: 'user:promptlin',
      workspace: 'image',
      limit: 20,
      reserved: 0,
      used: 0,
      released: 1,
      remaining: 20,
    },
    safety: { moderationRequired: false, reviewRequired: false },
    policy: { version: 'creative-policy-v1' },
    providerRequestId: 'pred_admin_failed_redaction_fixture',
    providerJobId: 'pred_admin_failed_redaction_fixture',
    createdAt: '2026-07-06T12:10:00.000Z',
  }, { id: 'demo-user-admin', handle: 'legalpixel' })
  await repositories.creativeGenerations.fail(generationId, {
    errorCode: 'PROVIDER_EXECUTION_FAILED',
    errorMessagePreview: 'provider failed with Bearer secret.value token=provider-token api_key=raw-key https://replicate.example/private-output.png',
  }, { id: 'demo-user-admin', handle: 'legalpixel' })

  const server = await createTestServer()
  try {
    const list = await requestJson(
      server.url,
      '/api/admin/creative/generations?providerId=replicate-staging&status=failed&limit=5',
      {
        method: 'GET',
        token: 'demo-access.legalpixel',
      },
    )
    assert.equal(list.status, 200)
    const item = list.payload.data.find((entry) => entry.id === generationId)
    assert.ok(item)
    assert.equal(item.status, 'failed')
    assert.equal(item.errorCode, 'PROVIDER_EXECUTION_FAILED')
    assert.equal(item.errorMessagePreview.includes('<redacted>'), true)
    assert.equal(item.errorMessagePreview.includes('<redacted-url>'), true)
    assert.equal('prompt' in item, false)

    const detail = await requestJson(server.url, `/api/admin/creative/generations/${generationId}`, {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })
    assert.equal(detail.status, 200)
    assert.equal(detail.payload.data.errorMessagePreview.includes('<redacted>'), true)
    const serialized = JSON.stringify(detail.payload.data)
    assert.equal(serialized.includes('secret.value'), false)
    assert.equal(serialized.includes('provider-token'), false)
    assert.equal(serialized.includes('raw-key'), false)
    assert.equal(serialized.includes('https://replicate.example'), false)
  } finally {
    await server.close()
  }
})

test('GET /api/admin/creative/generations exposes sanitized Replicate failed closeout observability', async () => {
  resetCreativePolicyState()
  const restoreEnv = applyReplicateStagingAdminFixtureEnv()
  const quotaWindow = quotaWindowFor(new Date())
  const releasedQuotaBaseline = repositories.creativeQuota.getQuotaWindow({
    actorHandle: 'promptlin',
    workspace: 'image',
    windowType: quotaWindow.type,
    windowStart: quotaWindow.start,
  })?.released ?? 0
  const fixtureCalls = []
  const mockedClient = {
    createPrediction: async (payload) => {
      fixtureCalls.push(payload)
      if (payload.input.prompt.includes('cancelled')) {
        return {
          id: 'pred_admin_cancelled_observability',
          status: 'canceled',
          logs: 'provider cancelled request with token=replicate-admin-fixture-token https://replicate.example/admin-cancelled-output.png',
        }
      }
      const error = new Error('timeout while creating prediction with token=replicate-admin-fixture-token https://replicate.example/admin-timeout-output.png')
      error.code = 'ETIMEDOUT'
      error.predictionId = 'pred_admin_timeout_observability'
      throw error
    },
  }
  const fixtureAdapters = {
    'replicate-staging': ({ request, provider, actor, source, now, generationId }) =>
      createReplicateStagingPrediction({
        request,
        provider,
        actor,
        source,
        now,
        generationId,
        client: mockedClient,
      }),
  }
  const server = await createRouteTestServer(
    (router) => registerCreativeRoutes(router, { fixtureAdapters }),
    registerAdminRoutes,
  )
  try {
    const timeout = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        providerId: 'replicate-staging',
        prompt: 'Admin observability Replicate timeout fixture',
      },
      token: 'demo-access.promptlin',
    })
    assert.equal(timeout.status, 504)
    assert.equal(timeout.payload.error.code, 'PROVIDER_TIMEOUT')

    const cancelled = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        providerId: 'replicate-staging',
        prompt: 'Admin observability Replicate cancelled fixture',
      },
      token: 'demo-access.promptlin',
    })
    assert.equal(cancelled.status, 409)
    assert.equal(cancelled.payload.error.code, 'PROVIDER_CANCELLED')

    assert.equal(fixtureCalls.length, 2)
    const serializedCalls = JSON.stringify(fixtureCalls)
    assert.equal(serializedCalls.includes('replicate-admin-fixture-token'), false)
    assert.equal(serializedCalls.includes('https://replicate.example'), false)

    const list = await requestJson(
      server.url,
      '/api/admin/creative/generations?providerId=replicate-staging&status=failed&limit=20',
      {
        method: 'GET',
        token: 'demo-access.legalpixel',
      },
    )
    assert.equal(list.status, 200)

    const timeoutItem = list.payload.data.find((entry) => entry.promptPreview === 'Admin observability Replicate timeout fixture')
    const cancelledItem = list.payload.data.find((entry) => entry.promptPreview === 'Admin observability Replicate cancelled fixture')
    assert.ok(timeoutItem)
    assert.ok(cancelledItem)

    assert.equal(timeoutItem.errorCode, 'PROVIDER_TIMEOUT')
    assert.equal(timeoutItem.providerRequestId, 'pred_admin_timeout_observability')
    assert.equal(timeoutItem.usage.providerCost.schemaVersion, 'provider-cost-v1')
    assert.equal(timeoutItem.usage.providerCost.budget.budgetScope, 'staging:replicate:image')
    assert.equal(timeoutItem.usage.providerCost.budget.status, 'within_budget')
    assert.equal(timeoutItem.usage.providerCost.risk.providerUsageMissing, true)
    assert.equal(timeoutItem.credit.status, 'refunded')
    assert.equal(timeoutItem.credit.reasonCode, 'PROVIDER_TIMEOUT')
    assert.equal(timeoutItem.quota.reserved, 0)
    assert.equal(timeoutItem.quota.released, releasedQuotaBaseline + 1)
    assert.ok(timeoutItem.quota.remaining > 0)
    assert.deepEqual(timeoutItem.outputAssetIds, [])

    assert.equal(cancelledItem.errorCode, 'PROVIDER_CANCELLED')
    assert.equal(cancelledItem.providerRequestId, 'pred_admin_cancelled_observability')
    assert.equal(cancelledItem.usage.providerCost.schemaVersion, 'provider-cost-v1')
    assert.equal(cancelledItem.usage.providerCost.actual.amount, null)
    assert.equal(cancelledItem.usage.providerCost.budget.status, 'within_budget')
    assert.equal(cancelledItem.usage.providerCost.risk.providerUsageMissing, true)
    assert.equal(cancelledItem.credit.status, 'refunded')
    assert.equal(cancelledItem.credit.reasonCode, 'PROVIDER_CANCELLED')
    assert.equal(cancelledItem.quota.reserved, 0)
    assert.equal(cancelledItem.quota.released, releasedQuotaBaseline + 2)
    assert.ok(cancelledItem.quota.remaining > 0)
    assert.deepEqual(cancelledItem.outputAssetIds, [])

    const timeoutDetail = await requestJson(server.url, `/api/admin/creative/generations/${timeoutItem.id}`, {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })
    assert.equal(timeoutDetail.status, 200)
    assert.equal(timeoutDetail.payload.data.usage.providerCost.job.providerJobId, 'pred_admin_timeout_observability')

    const cancelledDetail = await requestJson(server.url, `/api/admin/creative/generations/${cancelledItem.id}`, {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })
    assert.equal(cancelledDetail.status, 200)
    assert.equal(cancelledDetail.payload.data.usage.providerCost.job.providerJobId, 'pred_admin_cancelled_observability')

    const serialized = JSON.stringify({
      list: list.payload.data,
      timeout: timeoutDetail.payload.data,
      cancelled: cancelledDetail.payload.data,
    })
    assert.equal(serialized.includes('replicate-admin-fixture-token'), false)
    assert.equal(serialized.includes('admin-timeout-output.png'), false)
    assert.equal(serialized.includes('admin-cancelled-output.png'), false)
    assert.equal(serialized.includes('https://replicate.example'), false)
    assert.equal(serialized.includes('rawProviderPayload'), false)
    assert.equal(serialized.includes('"rawProviderUsage"'), false)
    assert.equal(serialized.includes('prompt"'), false)
  } finally {
    await server.close()
    restoreEnv()
    resetCreativePolicyState()
  }
})

test('GET /api/admin/creative/generations sanitizes accounting and policy read models', async () => {
  const generationId = 'admin-generation-accounting-readside-safety-fixture'
  await repositories.creativeGenerations.create({
    id: generationId,
    actorId: 'demo-user-promptlin',
    actorHandle: 'promptlin',
    workspace: 'image',
    mode: 'text_to_image',
    providerId: 'mock',
    providerMode: 'mock',
    status: 'completed',
    promptHash: 'd'.repeat(64),
    promptPreview: 'Admin accounting readside safety fixture',
    inputAssetIds: [],
    parameterKeys: ['aspectRatio'],
    outputAssetIds: ['media-admin-accounting-readside-safe'],
    usage: { estimatedCredits: 1, rawUsagePayload: 'raw-usage-should-not-leak' },
    credit: {
      ledgerId: 'credit-admin-readside-safe',
      generationId,
      quotaReservationId: 'quota-admin-readside-safe',
      status: 'settled',
      currency: 'credits',
      reserved: 1,
      settled: 1,
      refunded: 0,
      amount: 1,
      reasonCode: 'generation_completed token=credit-readside-secret https://replicate.example/credit',
      metadata: {
        providerId: 'mock token=credit-provider-secret',
        providerMode: 'mock https://replicate.example/mode',
        costModel: 'fixture',
        metered: true,
        outputAssetIds: ['media-admin-accounting-readside-safe', 'https://replicate.example/raw-output.png'],
        prompt: 'raw prompt should not leak through credit metadata',
        rawProviderPayload: { token: 'credit-raw-payload-secret' },
      },
    },
    quota: {
      policyVersion: 'creative-policy-v1',
      scope: 'user_workspace_daily',
      workspace: 'image',
      limit: 20,
      reserved: 0,
      used: 1,
      released: 0,
      remaining: 19,
      reservationId: 'quota-admin-readside-safe',
      reason: 'quota reason token=quota-secret https://replicate.example/quota',
      rawProviderPayload: 'quota-raw-payload-should-not-leak',
      window: {
        id: '2026-07-06',
        type: 'daily',
        start: '2026-07-06T00:00:00.000Z',
        end: '2026-07-06T23:59:59.999Z',
        resetsAt: '2026-07-06T23:59:59.999Z',
      },
    },
    safety: {
      moderationRequired: false,
      reviewRequired: false,
      reviewReason: 'safe review note token=safety-secret https://replicate.example/safety',
      rawPrompt: 'unsafe prompt should not leak through safety',
    },
    policy: {
      version: 'creative-policy-v1',
      action: 'allow',
      reasonCode: 'policy_allow token=policy-secret https://replicate.example/policy',
      gates: { quota: true, credit: true, moderation: true, review: true },
      rawPolicyTrace: 'policy-trace-should-not-leak',
    },
    providerRequestId: 'mock-request-token=provider-request-secret',
    providerJobId: 'https://replicate.example/provider-job-should-not-leak',
    createdAt: '2026-07-06T12:20:00.000Z',
    completedAt: '2026-07-06T12:20:01.000Z',
  }, { id: 'demo-user-admin', handle: 'legalpixel' })

  const server = await createTestServer()
  try {
    const list = await requestJson(
      server.url,
      '/api/admin/creative/generations?providerId=mock&mediaAssetId=media-admin-accounting-readside-safe&limit=5',
      {
        method: 'GET',
        token: 'demo-access.legalpixel',
      },
    )

    assert.equal(list.status, 200)
    const item = list.payload.data.find((entry) => entry.id === generationId)
    assert.ok(item)
    assert.equal(item.credit.status, 'settled')
    assert.equal(item.credit.reasonCode.includes('credit-readside-secret'), false)
    assert.equal(item.credit.metadata.costModel, 'fixture')
    assert.deepEqual(item.credit.metadata.outputAssetIds, ['media-admin-accounting-readside-safe', '<redacted-url>'])
    assert.equal(item.quota.reservationId, 'quota-admin-readside-safe')
    assert.equal(item.policy.gates.credit, true)
    assert.equal(item.safety.reviewRequired, false)
    assert.match(item.providerJobId, /^redacted_[a-f0-9]{16}$/)

    const detail = await requestJson(server.url, `/api/admin/creative/generations/${generationId}`, {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })
    assert.equal(detail.status, 200)
    const serialized = JSON.stringify(detail.payload.data)
    assert.equal(serialized.includes('raw prompt should not leak'), false)
    assert.equal(serialized.includes('credit-provider-secret'), false)
    assert.equal(serialized.includes('credit-raw-payload-secret'), false)
    assert.equal(serialized.includes('quota-secret'), false)
    assert.equal(serialized.includes('quota-raw-payload-should-not-leak'), false)
    assert.equal(serialized.includes('safety-secret'), false)
    assert.equal(serialized.includes('unsafe prompt should not leak'), false)
    assert.equal(serialized.includes('policy-secret'), false)
    assert.equal(serialized.includes('policy-trace-should-not-leak'), false)
    assert.equal(serialized.includes('provider-request-secret'), false)
    assert.equal(serialized.includes('provider-job-should-not-leak'), false)
    assert.equal(serialized.includes('https://replicate.example'), false)
    assert.equal(serialized.includes('raw-usage-should-not-leak'), false)
    assert.equal('prompt' in detail.payload.data, false)
  } finally {
    await server.close()
  }
})

test('GET /api/admin/creative/generations/:id returns not found for missing records', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/creative/generations/missing-generation', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })

    assert.equal(status, 404)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'NOT_FOUND')
  } finally {
    await server.close()
  }
})

test('GET /api/admin/operations/metrics validates window minutes', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/operations/metrics?windowMinutes=2', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })

    assert.equal(status, 400)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'VALIDATION_FAILED')
    assert.equal(payload.error.message, 'windowMinutes must be an integer between 5 and 1440')
  } finally {
    await server.close()
  }
})

test('GET /api/admin/operations/metrics/export requires audit read permission', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/operations/metrics/export', {
      method: 'GET',
      token: 'demo-access.taskops',
    })

    assert.equal(status, 403)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'PERMISSION_DENIED')
    assert.equal(payload.error.message, 'Missing permission: admin:audit:read')
  } finally {
    await server.close()
  }
})

test('GET /api/admin/operations/metrics/export returns auditable handoff artifact', async () => {
  resetSecurityEvents()
  const server = await createTestServer()
  try {
    recordSecurityEvent({
      type: 'rate_limit.exceeded',
      severity: 'warning',
      source: 'rate_limit',
      clientKey: '198.51.100.11',
      method: 'POST',
      pathname: '/api/auth/login',
    })

    const { status, payload } = await requestJson(server.url, '/api/admin/operations/metrics/export?windowMinutes=15', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })

    assert.equal(status, 200)
    assert.equal(payload.kind, 'admin.operations.metrics.snapshot')
    assert.equal(payload.window.minutes, 15)
    assert.equal(payload.metrics.window.minutes, 15)
    assert.equal(payload.actor.handle, 'legalpixel')
    assert.ok(payload.id.startsWith('operations-metrics-'))
    assert.ok(Array.isArray(payload.handoff.remediationHints))
    assert.ok(payload.samples.securityDispatchFailures)
    assert.ok(payload.samples.mediaDispatchFailures)
    assert.ok(payload.samples.archiveWrites)
    assert.ok(payload.samples.historyPruned)

    const audit = await requestJson(server.url, '/api/admin/audit?action=admin.operations.metrics_exported&resourceType=operations_metrics&limit=1', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })
    assert.equal(audit.status, 200)
    assert.equal(audit.payload.data[0].action, 'admin.operations.metrics_exported')
    assert.equal(audit.payload.data[0].resourceId, payload.id)
    assert.equal(audit.payload.data[0].metadata.windowMinutes, 15)
    assert.equal(audit.payload.data[0].metadata.hintCount, payload.handoff.remediationHints.length)
  } finally {
    resetSecurityEvents()
    await server.close()
  }
})

test('GET /api/admin/operations/metrics/export validates window minutes', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/operations/metrics/export?windowMinutes=1441', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })

    assert.equal(status, 400)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'VALIDATION_FAILED')
    assert.equal(payload.error.message, 'windowMinutes must be an integer between 5 and 1440')
  } finally {
    await server.close()
  }
})

test('PUT /api/admin/roles/:role/permissions requires permission management access', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/roles/member/permissions', {
      method: 'PUT',
      body: { permissions: ['task:create'] },
      token: 'demo-access.legalpixel',
    })

    assert.equal(status, 403)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'PERMISSION_DENIED')
    assert.equal(payload.error.message, 'Missing permission: admin:permissions:manage')
  } finally {
    await server.close()
  }
})

test('PUT /api/admin/roles/:role/permissions validates permission ids', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/roles/member/permissions', {
      method: 'PUT',
      body: { permissions: ['task:create', 'unknown:permission'] },
      token: 'demo-access.opsplus',
    })

    assert.equal(status, 400)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'VALIDATION_FAILED')
    assert.equal(payload.error.message, 'permissions contains unsupported values: unknown:permission')
  } finally {
    await server.close()
  }
})

test('PUT /api/admin/roles/:role/permissions returns NOT_FOUND for unknown roles', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/roles/unknown/permissions', {
      method: 'PUT',
      body: { permissions: ['task:create'] },
      token: 'demo-access.opsplus',
    })

    assert.equal(status, 404)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'NOT_FOUND')
  } finally {
    await server.close()
  }
})

test('PUT /api/admin/roles/:role/permissions keeps protected admin grants', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/roles/admin/permissions', {
      method: 'PUT',
      body: { permissions: ['admin:access'] },
      token: 'demo-access.opsplus',
    })

    assert.equal(status, 400)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'VALIDATION_FAILED')
    assert.equal(payload.error.message, 'cannot remove protected permissions: admin:permissions:manage, admin:accounting:repair')
  } finally {
    await server.close()
  }
})

test('PUT /api/admin/roles/:role/permissions updates a role permission matrix', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/roles/member/permissions', {
      method: 'PUT',
      body: { permissions: ['task:create', 'post:create'] },
      token: 'demo-access.opsplus',
    })

    assert.equal(status, 200)
    assert.equal(payload.error, undefined)
    assert.deepEqual(payload.data, {
      role: 'member',
      permissions: ['task:create', 'post:create'],
    })

    const { payload: rolesPayload } = await requestJson(server.url, '/api/admin/roles', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    const memberRole = rolesPayload.data.find((role) => role.role === 'member')
    assert.deepEqual(memberRole.permissions, ['task:create', 'post:create'])
  } finally {
    await server.close()
  }
})

test('GET /api/admin/reviews returns AUTH_REQUIRED when missing auth', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/reviews', { method: 'GET' })

    assert.equal(status, 401)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'AUTH_REQUIRED')
  } finally {
    await server.close()
  }
})

test('GET /api/admin/reviews returns PERMISSION_DENIED without queue read permission', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/reviews', {
      method: 'GET',
      token: 'demo-access.taskops',
    })

    assert.equal(status, 403)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'PERMISSION_DENIED')
    assert.equal(payload.error.message, 'Missing permission: admin:queue:read')
  } finally {
    await server.close()
  }
})

test('GET /api/admin/reviews returns review queue data for moderators', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/reviews', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })

    assert.equal(status, 200)
    assert.ok(Array.isArray(payload.data))
    assert.equal(payload.error, undefined)
    assert.ok(payload.data.some((item) => item.id === 'review-1'))
    assert.equal(payload.meta.pagination.nextCursor, null)
    assert.equal(payload.meta.pagination.limit, 20)
  } finally {
    await server.close()
  }
})

test('GET /api/admin/reviews paginates with cursor and limit', async () => {
  const server = await createTestServer()
  try {
    const firstPage = await requestJson(server.url, '/api/admin/reviews?limit=2', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })

    assert.equal(firstPage.status, 200)
    assert.equal(firstPage.payload.data.length, 2)
    assert.equal(firstPage.payload.meta.pagination.limit, 2)
    assert.equal(firstPage.payload.meta.pagination.nextCursor, firstPage.payload.data[1].id)

    const secondPage = await requestJson(server.url, `/api/admin/reviews?limit=2&cursor=${encodeURIComponent(firstPage.payload.meta.pagination.nextCursor)}`, {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })

    assert.equal(secondPage.status, 200)
    assert.equal(secondPage.payload.data.length, 2)
    assert.equal(secondPage.payload.data.some((item) => firstPage.payload.data.some((first) => first.id === item.id)), false)
    assert.ok([null, secondPage.payload.data[1].id].includes(secondPage.payload.meta.pagination.nextCursor))
  } finally {
    await server.close()
  }
})

test('GET /api/admin/reviews filters by queue and status', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/reviews?queue=tasks&status=Publish%20audit', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })

    assert.equal(status, 200)
    assert.deepEqual(payload.data.map((item) => item.id), ['review-4'])
    assert.equal(payload.meta.pagination.nextCursor, null)
    assert.equal(payload.meta.pagination.limit, 20)
  } finally {
    await server.close()
  }
})

test('GET /api/admin/reviews validates pagination limit', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/reviews?limit=0', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })

    assert.equal(status, 400)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'VALIDATION_FAILED')
    assert.equal(payload.error.message, 'limit must be an integer between 1 and 100')
  } finally {
    await server.close()
  }
})

test('POST /api/admin/reviews/:id/actions requires queue review permission', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/reviews/review-1/actions', {
      body: { decision: 'approve' },
      token: 'demo-access.taskops',
    })

    assert.equal(status, 403)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'PERMISSION_DENIED')
    assert.equal(payload.error.message, 'Missing permission: admin:queue:review')
  } finally {
    await server.close()
  }
})

test('POST /api/admin/reviews/:id/actions validates decisions', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/reviews/review-1/actions', {
      body: { decision: 'hold' },
      token: 'demo-access.legalpixel',
    })

    assert.equal(status, 400)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'VALIDATION_FAILED')
    assert.equal(payload.error.message, 'decision must be one of: approve, reject')
  } finally {
    await server.close()
  }
})

test('POST /api/admin/reviews/:id/actions returns NOT_FOUND for missing queue items', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/reviews/missing-review/actions', {
      body: { decision: 'approve' },
      token: 'demo-access.legalpixel',
    })

    assert.equal(status, 404)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'NOT_FOUND')
  } finally {
    await server.close()
  }
})

test('POST /api/admin/reviews/:id/actions reviews a queue item', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/reviews/review-1/actions', {
      body: { decision: 'approve', note: 'Approved in route test.' },
      token: 'demo-access.legalpixel',
    })

    assert.equal(status, 200)
    assert.equal(payload.error, undefined)
    assert.equal(payload.data.id, 'review-1')
    assert.equal(payload.data.status, 'Approved')
    assert.equal(payload.data.decision, 'approve')
    assert.equal(payload.data.reviewedBy, 'legalpixel')
    assert.equal(payload.data.note, 'Approved in route test.')
    assert.ok(payload.data.reviewedAt)
  } finally {
    await server.close()
  }
})

test('GET /api/admin/audit returns AUTH_REQUIRED when missing auth', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/audit', { method: 'GET' })

    assert.equal(status, 401)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'AUTH_REQUIRED')
  } finally {
    await server.close()
  }
})

test('GET /api/admin/audit returns PERMISSION_DENIED for non-admin users', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/audit', {
      method: 'GET',
      token: 'demo-access.taskops',
    })

    assert.equal(status, 403)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'PERMISSION_DENIED')
    assert.equal(payload.error.message, 'Missing permission: admin:audit:read')
  } finally {
    await server.close()
  }
})

test('GET /api/admin/audit returns audit data and pagination for admins', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/audit', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })

    assert.equal(status, 200)
    assert.ok(Array.isArray(payload.data))
    assert.equal(payload.error, undefined)
    assert.equal('nextCursor' in payload.meta.pagination, true)
    assert.equal(payload.meta.pagination.limit, 20)
  } finally {
    await server.close()
  }
})

test('GET /api/admin/audit paginates with cursor and filters by action', async () => {
  const server = await createTestServer()
  try {
    await requestJson(server.url, '/api/admin/reviews/review-3/actions', {
      body: { decision: 'approve', note: 'Audit pagination setup A.' },
      token: 'demo-access.legalpixel',
    })
    await requestJson(server.url, '/api/admin/reviews/review-4/actions', {
      body: { decision: 'approve', note: 'Audit pagination setup B.' },
      token: 'demo-access.legalpixel',
    })

    const firstPage = await requestJson(server.url, '/api/admin/audit?limit=1&action=admin.review.approve', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })

    assert.equal(firstPage.status, 200)
    assert.equal(firstPage.payload.data.length, 1)
    assert.equal(firstPage.payload.data[0].action, 'admin.review.approve')
    assert.equal(firstPage.payload.meta.pagination.limit, 1)
    assert.ok(firstPage.payload.meta.pagination.nextCursor)

    const secondPage = await requestJson(server.url, `/api/admin/audit?limit=1&action=admin.review.approve&cursor=${firstPage.payload.meta.pagination.nextCursor}`, {
      method: 'GET',
      token: 'demo-access.opsplus',
    })

    assert.equal(secondPage.status, 200)
    assert.equal(secondPage.payload.data.length, 1)
    assert.equal(secondPage.payload.data[0].action, 'admin.review.approve')
    assert.notEqual(secondPage.payload.data[0].id, firstPage.payload.data[0].id)
  } finally {
    await server.close()
  }
})

test('GET /api/admin/audit allows moderators with audit read permission', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/audit', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })

    assert.equal(status, 200)
    assert.ok(Array.isArray(payload.data))
    assert.equal(payload.error, undefined)
    assert.equal('nextCursor' in payload.meta.pagination, true)
  } finally {
    await server.close()
  }
})

test('GET /api/admin/audit/export returns filtered audit JSON', async () => {
  const server = await createTestServer()
  try {
    const updatedRole = await requestJson(server.url, '/api/admin/roles/member/permissions', {
      method: 'PUT',
      body: { permissions: ['task:create', 'post:create', 'points:read'] },
      token: 'demo-access.opsplus',
    })
    assert.equal(updatedRole.status, 200)

    const exported = await requestJson(server.url, '/api/admin/audit/export?action=admin.role_permissions.updated&resourceType=role&limit=1', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(exported.status, 200)
    assert.equal(exported.payload.query.action, 'admin.role_permissions.updated')
    assert.equal(exported.payload.query.resourceType, 'role')
    assert.equal(exported.payload.query.limit, 1)
    assert.equal(exported.payload.count, 1)
    assert.equal(exported.payload.events[0].action, 'admin.role_permissions.updated')
    assert.equal(exported.payload.events[0].resourceType, 'role')
    assert.ok(exported.payload.exportedAt)
  } finally {
    await server.close()
  }
})

test('GET /api/admin/audit list, export, and detail sanitize provider budget evidence', async () => {
  const server = await createTestServer()
  try {
    const unsafeValues = {
      resource: 'https://ops.example.com/budget/audit?token=resource-secret',
      source: 'creative-provider-budget:https://ops.example.com/source?token=source-secret:audit',
      provider: 'replicate?token=provider-secret',
      account: 'https://replicate.example/accounts/audit?token=account-secret',
      workspace: 'image?token=workspace-secret',
      mode: 'text_to_image?token=mode-secret',
      model: 'replicate:image?token=model-secret',
      budget: 'https://ops.example.com/budget/scope?token=budget-secret',
      reason: 'over_budget?token=reason-secret',
      alert: 'creative.provider_budget.threshold_80?token=alert-secret',
      idempotency: 'https://ops.example.com/idempotency?token=idempotency-secret',
    }
    const [recorded] = await repositories.providerBudgetAudit.recordMany([{
      action: 'creative.provider_budget.threshold_crossed',
      resourceType: 'creative_provider_budget',
      resourceId: unsafeValues.resource,
      metadata: {
        sourceKey: unsafeValues.source,
        providerId: unsafeValues.provider,
        providerAccountRef: unsafeValues.account,
        workspace: unsafeValues.workspace,
        mode: unsafeValues.mode,
        providerModelId: unsafeValues.model,
        budgetScope: unsafeValues.budget,
        severity: 'warning',
        reasonCode: unsafeValues.reason,
        alertType: unsafeValues.alert,
        idempotencyKey: unsafeValues.idempotency,
        errorPreview: 'Provider failed at https://replicate.example/jobs/audit?token=preview-secret',
        note: 'Inspect https://ops.example.com/runbook?token=note-secret',
        safeLabel: 'fixture_safe',
        usageRatioPercent: 85,
      },
    }])
    const eventId = recorded.event.id

    const list = await requestJson(
      server.url,
      '/api/admin/audit?action=creative.provider_budget.threshold_crossed&resourceType=creative_provider_budget&limit=100',
      { method: 'GET', token: 'demo-access.opsplus' },
    )
    const listedEvent = list.payload.data.find((event) => event.id === eventId)

    const exported = await requestJson(
      server.url,
      '/api/admin/audit/export?action=creative.provider_budget.threshold_crossed&resourceType=creative_provider_budget&limit=100',
      { method: 'GET', token: 'demo-access.opsplus' },
    )
    const exportedEvent = exported.payload.events.find((event) => event.id === eventId)

    const detail = await requestJson(server.url, `/api/admin/audit/${eventId}`, {
      method: 'GET',
      token: 'demo-access.opsplus',
    })

    assert.equal(list.status, 200)
    assert.equal(exported.status, 200)
    assert.equal(detail.status, 200)
    assert.ok(listedEvent)
    assert.ok(exportedEvent)

    for (const event of [listedEvent, exportedEvent, detail.payload.data]) {
      assert.match(event.resourceId, /^redacted_[a-f0-9]{16}$/)
      for (const key of [
        'sourceKey',
        'providerId',
        'providerAccountRef',
        'workspace',
        'mode',
        'providerModelId',
        'budgetScope',
        'reasonCode',
        'alertType',
        'idempotencyKey',
      ]) {
        assert.match(event.metadata[key], /^redacted_[a-f0-9]{16}$/)
      }
      assert.equal(event.metadata.severity, 'warning')
      assert.equal(event.metadata.safeLabel, 'fixture_safe')
      assert.equal(event.metadata.usageRatioPercent, 85)
      assert.equal(event.metadata.errorPreview.includes('<redacted-url>'), true)
      assert.equal(event.metadata.note.includes('<redacted-url>'), true)
    }

    const serialized = JSON.stringify([listedEvent, exportedEvent, detail.payload.data])
    for (const unsafe of [...Object.values(unsafeValues), 'preview-secret', 'note-secret']) {
      assert.equal(serialized.includes(unsafe), false)
    }
    assert.equal(serialized.includes('replicate.example'), false)
    assert.equal(serialized.includes('ops.example.com'), false)
  } finally {
    await server.close()
  }
})

test('GET /api/admin/audit list, export, and detail sanitize provider alert dispatch evidence', async () => {
  const server = await createTestServer()
  try {
    const unsafeValues = {
      resource: 'https://alerts.example.com/dispatch/audit?token=resource-secret',
      source: 'https://alerts.example.com/source/audit?token=source-secret',
      auditSource: 'https://ops.example.com/audit/source?token=audit-source-secret',
      alertAction: 'creative.provider_budget.threshold_80?token=alert-action-secret',
      auditEventId: 'audit-provider-budget?token=audit-id-secret',
      budget: 'https://ops.example.com/budget/dispatch?token=budget-secret',
      provider: 'replicate?token=provider-secret',
      workspace: 'image?token=workspace-secret',
      reason: 'missing_provider_alert_client?token=reason-secret',
    }
    const attemptedAt = '2026-07-10T14:05:00.000Z'
    const [recorded] = await repositories.providerBudgetAudit.recordMany([{
      action: 'creative.provider_alert.dispatch',
      resourceType: 'creative_provider_budget_alert',
      resourceId: unsafeValues.resource,
      metadata: {
        sourceKey: unsafeValues.source,
        auditEventSourceKey: unsafeValues.auditSource,
        channel: 'webhook',
        status: 'failed',
        statusCode: 503,
        errorPreview: 'Dispatch failed at https://alerts.example.com/send?token=preview-secret',
        alertAction: unsafeValues.alertAction,
        auditEventId: unsafeValues.auditEventId,
        budgetScope: unsafeValues.budget,
        providerId: unsafeValues.provider,
        workspace: unsafeValues.workspace,
        severity: 'warning',
        reasonCode: unsafeValues.reason,
        dispatchMode: 'fixture_dry_run',
        fixtureDryRun: true,
        attemptedAt,
        diagnostics: {
          callbackUrl: 'https://alerts.example.com/callback?token=callback-secret',
          retryable: false,
        },
      },
    }])
    const eventId = recorded.event.id

    const list = await requestJson(
      server.url,
      '/api/admin/audit?action=creative.provider_alert.dispatch&resourceType=creative_provider_budget_alert&limit=100',
      { method: 'GET', token: 'demo-access.opsplus' },
    )
    const listedEvent = list.payload.data.find((event) => event.id === eventId)

    const exported = await requestJson(
      server.url,
      '/api/admin/audit/export?action=creative.provider_alert.dispatch&resourceType=creative_provider_budget_alert&limit=100',
      { method: 'GET', token: 'demo-access.opsplus' },
    )
    const exportedEvent = exported.payload.events.find((event) => event.id === eventId)

    const detail = await requestJson(server.url, `/api/admin/audit/${eventId}`, {
      method: 'GET',
      token: 'demo-access.opsplus',
    })

    assert.equal(list.status, 200)
    assert.equal(exported.status, 200)
    assert.equal(detail.status, 200)
    assert.ok(listedEvent)
    assert.ok(exportedEvent)

    for (const event of [listedEvent, exportedEvent, detail.payload.data]) {
      assert.match(event.resourceId, /^redacted_[a-f0-9]{16}$/)
      for (const key of [
        'sourceKey',
        'auditEventSourceKey',
        'alertAction',
        'auditEventId',
        'budgetScope',
        'providerId',
        'workspace',
        'reasonCode',
      ]) {
        assert.match(event.metadata[key], /^redacted_[a-f0-9]{16}$/)
      }
      assert.equal(event.metadata.channel, 'webhook')
      assert.equal(event.metadata.status, 'failed')
      assert.equal(event.metadata.statusCode, 503)
      assert.equal(event.metadata.severity, 'warning')
      assert.equal(event.metadata.dispatchMode, 'fixture_dry_run')
      assert.equal(event.metadata.fixtureDryRun, true)
      assert.equal(event.metadata.attemptedAt, attemptedAt)
      assert.equal(event.metadata.errorPreview.includes('<redacted-url>'), true)
      assert.equal(event.metadata.diagnostics.callbackUrl, '<redacted-url>')
      assert.equal(event.metadata.diagnostics.retryable, false)
    }

    const serialized = JSON.stringify([listedEvent, exportedEvent, detail.payload.data])
    for (const unsafe of [...Object.values(unsafeValues), 'preview-secret', 'callback-secret']) {
      assert.equal(serialized.includes(unsafe), false)
    }
    assert.equal(serialized.includes('alerts.example.com'), false)
    assert.equal(serialized.includes('ops.example.com'), false)
  } finally {
    await server.close()
  }
})

test('GET /api/admin/audit list, export, and detail sanitize provider lifecycle evidence', async () => {
  const server = await createTestServer()
  try {
    const unsafeValues = {
      source: 'https://provider.example/lifecycle/source?token=source-secret',
      generation: 'https://provider.example/generations/admin?token=generation-secret',
      provider: 'replicate?token=provider-secret',
      mode: 'replicate_staging?token=mode-secret',
      job: 'https://provider.example/jobs/admin?token=job-secret',
      sourceType: 'webhook?token=source-type-secret',
    }
    const recorded = await repositories.providerLifecycleAudit.record({
      sourceKey: unsafeValues.source,
      generationId: unsafeValues.generation,
      action: 'creative.provider_lifecycle.side_effect_applied',
      metadata: {
        providerId: unsafeValues.provider,
        providerMode: unsafeValues.mode,
        providerJobId: unsafeValues.job,
        sourceType: unsafeValues.sourceType,
        nextStatus: 'completed',
        auditAction: 'creative.provider_lifecycle.side_effect_applied',
      },
    })
    const eventId = recorded.id

    const list = await requestJson(
      server.url,
      '/api/admin/audit?action=creative.provider_lifecycle.side_effect_applied&resourceType=creative_generation&limit=100',
      { method: 'GET', token: 'demo-access.opsplus' },
    )
    const listedEvent = list.payload.data.find((event) => event.id === eventId)

    const exported = await requestJson(
      server.url,
      '/api/admin/audit/export?action=creative.provider_lifecycle.side_effect_applied&resourceType=creative_generation&limit=100',
      { method: 'GET', token: 'demo-access.opsplus' },
    )
    const exportedEvent = exported.payload.events.find((event) => event.id === eventId)

    const detail = await requestJson(server.url, `/api/admin/audit/${eventId}`, {
      method: 'GET',
      token: 'demo-access.opsplus',
    })

    assert.equal(list.status, 200)
    assert.equal(exported.status, 200)
    assert.equal(detail.status, 200)
    assert.ok(listedEvent)
    assert.ok(exportedEvent)

    for (const event of [listedEvent, exportedEvent, detail.payload.data]) {
      assert.match(event.resourceId, /^redacted_[a-f0-9]{16}$/)
      for (const key of ['sourceKey', 'generationId', 'providerId', 'providerMode', 'providerJobId', 'sourceType']) {
        assert.match(event.metadata[key], /^redacted_[a-f0-9]{16}$/)
      }
      assert.equal(event.metadata.nextStatus, 'completed')
      assert.equal(event.metadata.auditAction, 'creative.provider_lifecycle.side_effect_applied')
      assert.equal(event.metadata.target.admin.generationId, event.resourceId)
      assert.equal(event.metadata.target.admin.auditSourceKey, event.metadata.sourceKey)
    }

    const serialized = JSON.stringify([listedEvent, exportedEvent, detail.payload.data])
    for (const unsafe of Object.values(unsafeValues)) {
      assert.equal(serialized.includes(unsafe), false)
    }
    assert.equal(serialized.includes('provider.example'), false)
  } finally {
    await server.close()
  }
})

test('GET /api/admin/audit list, export, and detail allowlist Provider retry evidence', async () => {
  const server = await createTestServer()
  try {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    const unsafeValues = {
      state: `https://provider.example/retries/${suffix}?token=state-secret`,
      source: `https://provider.example/retry-source/${suffix}?token=source-secret`,
      generation: `https://provider.example/generations/${suffix}?token=generation-secret`,
      provider: 'replicate?token=provider-secret',
      failureHash: 'a'.repeat(64),
      policyHash: 'b'.repeat(64),
    }
    const recorded = await repositories.creativeProviderRetries.record({
      id: unsafeValues.state,
      sourceKey: unsafeValues.source,
      generationId: unsafeValues.generation,
      providerId: unsafeValues.provider,
      workspace: 'image',
      operationType: 'status_read',
      status: 'exhausted',
      attempt: 5,
      maxAttempts: 5,
      firstAttemptAt: '2026-07-12T09:00:00.000Z',
      lastAttemptAt: '2026-07-12T09:05:00.000Z',
      nextAttemptAt: null,
      lastFailureKeyHash: unsafeValues.failureHash,
      lastErrorCode: 'PROVIDER_RATE_LIMITED',
      lastErrorCategory: 'rate_limit',
      delaySource: 'retry_after',
      policyHash: unsafeValues.policyHash,
      expectedVersion: 0,
    })
    const auditPage = await repositories.audit.list({
      action: 'creative.provider_retry.exhausted',
      resourceType: 'creative_provider_retry_state',
      limit: 100,
    })
    const recordedEvent = auditPage.items.find((event) =>
      event.resourceId === safeProviderLifecycleEvidenceIdentifier(recorded.state.id))
    assert.ok(recordedEvent)

    const list = await requestJson(
      server.url,
      '/api/admin/audit?action=creative.provider_retry.exhausted&resourceType=creative_provider_retry_state&limit=100',
      { method: 'GET', token: 'demo-access.opsplus' },
    )
    const listedEvent = list.payload.data.find((event) => event.id === recordedEvent.id)
    const exported = await requestJson(
      server.url,
      '/api/admin/audit/export?action=creative.provider_retry.exhausted&resourceType=creative_provider_retry_state&limit=100',
      { method: 'GET', token: 'demo-access.opsplus' },
    )
    const exportedEvent = exported.payload.events.find((event) => event.id === recordedEvent.id)
    const detail = await requestJson(server.url, `/api/admin/audit/${recordedEvent.id}`, {
      method: 'GET',
      token: 'demo-access.opsplus',
    })

    assert.equal(list.status, 200)
    assert.equal(exported.status, 200)
    assert.equal(detail.status, 200)
    assert.ok(listedEvent)
    assert.ok(exportedEvent)
    for (const event of [listedEvent, exportedEvent, detail.payload.data]) {
      assert.match(event.resourceId, /^redacted_[a-f0-9]{16}$/)
      assert.match(event.metadata.generationId, /^redacted_[a-f0-9]{16}$/)
      assert.match(event.metadata.providerId, /^redacted_[a-f0-9]{16}$/)
      assert.equal(event.metadata.workspace, 'image')
      assert.equal(event.metadata.operationType, 'status_read')
      assert.equal(event.metadata.status, 'exhausted')
      assert.equal(event.metadata.attempt, 5)
      for (const key of ['sourceKey', 'lastFailureKeyHash', 'policyHash', 'outputUrl', 'rawError']) {
        assert.equal(event.metadata[key], undefined)
      }
    }

    const serialized = JSON.stringify([listedEvent, exportedEvent, detail.payload.data])
    for (const unsafe of Object.values(unsafeValues)) {
      assert.equal(serialized.includes(unsafe), false)
    }
    assert.equal(serialized.includes('provider.example'), false)
  } finally {
    await server.close()
  }
})

test('GET /api/admin/audit list, export, and detail sanitize provider replay ledger evidence', async () => {
  const server = await createTestServer()
  try {
    const unsafeValues = {
      resource: 'https://provider.example/replays/admin?token=resource-secret',
      generation: 'https://provider.example/generations/replay?token=generation-secret',
      provider: 'replicate?token=provider-secret',
      job: 'https://provider.example/jobs/replay?token=job-secret',
      sourceType: 'webhook?token=source-type-secret',
      action: 'applied?token=action-secret',
      reason: 'provider_failed?token=reason-secret',
    }
    const actions = [
      'creative.provider_replay.recorded',
      'creative.provider_replay.applied',
      'creative.provider_replay.side_effect_result_recorded',
    ]
    const recorded = await repositories.providerBudgetAudit.recordMany(actions.map((action, index) => ({
      action,
      resourceType: 'creative_provider_replay_ledger',
      resourceId: `${unsafeValues.resource}&event=${index}`,
      metadata: {
        generationId: unsafeValues.generation,
        providerId: unsafeValues.provider,
        providerJobId: unsafeValues.job,
        sourceType: unsafeValues.sourceType,
        action: unsafeValues.action,
        reasonCode: unsafeValues.reason,
        note: 'Inspect https://provider.example/runbook?token=note-secret',
        diagnostics: {
          callbackUrl: 'https://provider.example/callback?token=callback-secret',
          retryable: false,
        },
      },
    })))
    const eventIds = recorded.map((item) => item.event.id)

    const list = await requestJson(
      server.url,
      '/api/admin/audit?resourceType=creative_provider_replay_ledger&limit=100',
      { method: 'GET', token: 'demo-access.opsplus' },
    )
    const listedEvents = list.payload.data.filter((event) => eventIds.includes(event.id))

    const exported = await requestJson(
      server.url,
      '/api/admin/audit/export?resourceType=creative_provider_replay_ledger&limit=100',
      { method: 'GET', token: 'demo-access.opsplus' },
    )
    const exportedEvents = exported.payload.events.filter((event) => eventIds.includes(event.id))

    const details = await Promise.all(eventIds.map((eventId) => requestJson(
      server.url,
      `/api/admin/audit/${eventId}`,
      { method: 'GET', token: 'demo-access.opsplus' },
    )))

    assert.equal(list.status, 200)
    assert.equal(exported.status, 200)
    assert.equal(listedEvents.length, actions.length)
    assert.equal(exportedEvents.length, actions.length)
    assert.deepEqual(new Set(listedEvents.map((event) => event.action)), new Set(actions))
    assert.deepEqual(new Set(exportedEvents.map((event) => event.action)), new Set(actions))
    for (const detail of details) assert.equal(detail.status, 200)

    const events = [...listedEvents, ...exportedEvents, ...details.map((detail) => detail.payload.data)]
    for (const event of events) {
      assert.match(event.resourceId, /^redacted_[a-f0-9]{16}$/)
      for (const key of ['generationId', 'providerId', 'providerJobId', 'sourceType', 'action', 'reasonCode']) {
        assert.match(event.metadata[key], /^redacted_[a-f0-9]{16}$/)
      }
      assert.equal(event.metadata.note.includes('<redacted-url>'), true)
      assert.equal(event.metadata.diagnostics.callbackUrl, '<redacted-url>')
      assert.equal(event.metadata.diagnostics.retryable, false)
    }

    const serialized = JSON.stringify(events)
    for (const unsafe of [...Object.values(unsafeValues), 'note-secret', 'callback-secret']) {
      assert.equal(serialized.includes(unsafe), false)
    }
    assert.equal(serialized.includes('provider.example'), false)

    const unrelated = await repositories.providerBudgetAudit.recordMany([{
      action: 'admin.fixture.audit_recorded',
      resourceType: 'fixture',
      resourceId: unsafeValues.resource,
      metadata: { note: unsafeValues.reason },
    }])
    const unrelatedDetail = await requestJson(server.url, `/api/admin/audit/${unrelated[0].event.id}`, {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(unrelatedDetail.payload.data.resourceId, unsafeValues.resource)
    assert.equal(unrelatedDetail.payload.data.metadata.note, unsafeValues.reason)
  } finally {
    await server.close()
  }
})

test('GET /api/admin/audit list, export, and detail sanitize creative generation lifecycle evidence', async () => {
  const server = await createTestServer()
  try {
    const unsafeValues = {
      resource: 'https://provider.example/generations/audit?token=resource-secret',
      generation: 'https://provider.example/generations/legacy?token=generation-secret',
      provider: 'replicate?token=provider-secret',
      workspace: 'image?token=workspace-secret',
      mode: 'text_to_image?token=mode-secret',
      status: 'completed?token=status-secret',
      output: 'https://provider.example/outputs/legacy?token=output-secret',
      error: 'provider_failed?token=error-secret',
      reason: 'policy_review?token=reason-secret',
    }
    const generationActions = [
      'creative.generation.created',
      'creative.generation.running',
      'creative.generation.outputs_linked',
      'creative.generation.completed',
      'creative.generation.failed',
      'creative.generation.cancelled',
    ]
    const payloads = generationActions.map((action, index) => ({
      action,
      resourceType: 'creative_generation',
      resourceId: `${unsafeValues.resource}&event=${index}`,
      metadata: {
        generationId: unsafeValues.generation,
        providerId: unsafeValues.provider,
        workspace: unsafeValues.workspace,
        mode: unsafeValues.mode,
        status: unsafeValues.status,
        outputAssetIds: [unsafeValues.output],
        errorCode: unsafeValues.error,
        reasonCode: unsafeValues.reason,
        note: 'Inspect https://provider.example/runbook?token=note-secret',
        attempt: 2,
      },
    }))
    payloads.push({
      action: 'creative.generation.review_required',
      resourceType: 'media_asset',
      resourceId: `${unsafeValues.resource}&event=review`,
      metadata: {
        generationId: unsafeValues.generation,
        outputId: unsafeValues.output,
        providerId: unsafeValues.provider,
        workspace: unsafeValues.workspace,
        reasons: [unsafeValues.reason],
        note: 'Inspect https://provider.example/policy?token=policy-note-secret',
        creativeReviewRequired: true,
      },
    })
    const recorded = await repositories.providerBudgetAudit.recordMany(payloads)
    const eventIds = recorded.map((item) => item.event.id)

    const listResponses = await Promise.all(['creative_generation', 'media_asset'].map((resourceType) => requestJson(
      server.url,
      `/api/admin/audit?resourceType=${resourceType}&limit=100`,
      { method: 'GET', token: 'demo-access.opsplus' },
    )))
    const listedEvents = listResponses.flatMap((response) => response.payload.data)
      .filter((event) => eventIds.includes(event.id))

    const exportResponses = await Promise.all(['creative_generation', 'media_asset'].map((resourceType) => requestJson(
      server.url,
      `/api/admin/audit/export?resourceType=${resourceType}&limit=100`,
      { method: 'GET', token: 'demo-access.opsplus' },
    )))
    const exportedEvents = exportResponses.flatMap((response) => response.payload.events)
      .filter((event) => eventIds.includes(event.id))

    const details = await Promise.all(eventIds.map((eventId) => requestJson(
      server.url,
      `/api/admin/audit/${eventId}`,
      { method: 'GET', token: 'demo-access.opsplus' },
    )))

    for (const response of [...listResponses, ...exportResponses, ...details]) assert.equal(response.status, 200)
    assert.equal(listedEvents.length, payloads.length)
    assert.equal(exportedEvents.length, payloads.length)
    assert.deepEqual(new Set(listedEvents.map((event) => event.action)), new Set(payloads.map((item) => item.action)))
    assert.deepEqual(new Set(exportedEvents.map((event) => event.action)), new Set(payloads.map((item) => item.action)))

    const events = [...listedEvents, ...exportedEvents, ...details.map((detail) => detail.payload.data)]
    for (const event of events) {
      assert.match(event.resourceId, /^redacted_[a-f0-9]{16}$/)
      for (const key of ['generationId', 'providerId', 'workspace']) {
        assert.match(event.metadata[key], /^redacted_[a-f0-9]{16}$/)
      }
      for (const key of ['mode', 'status', 'errorCode', 'reasonCode']) {
        if (event.metadata[key]) assert.match(event.metadata[key], /^redacted_[a-f0-9]{16}$/)
      }
      for (const value of event.metadata.outputAssetIds ?? []) assert.match(value, /^redacted_[a-f0-9]{16}$/)
      for (const value of event.metadata.reasons ?? []) assert.match(value, /^redacted_[a-f0-9]{16}$/)
      if (event.metadata.outputId) assert.match(event.metadata.outputId, /^redacted_[a-f0-9]{16}$/)
      assert.equal(event.metadata.note.includes('<redacted-url>'), true)
      if ('attempt' in event.metadata) assert.equal(event.metadata.attempt, 2)
      if ('creativeReviewRequired' in event.metadata) assert.equal(event.metadata.creativeReviewRequired, true)
    }

    const serialized = JSON.stringify(events)
    for (const unsafe of [...Object.values(unsafeValues), 'note-secret', 'policy-note-secret']) {
      assert.equal(serialized.includes(unsafe), false)
    }
    assert.equal(serialized.includes('provider.example'), false)
  } finally {
    await server.close()
  }
})

test('GET /api/admin/audit list, export, and detail sanitize creative credit and quota evidence', async () => {
  const server = await createTestServer()
  try {
    const unsafeValues = {
      resource: 'https://billing.example/ledger/audit?token=resource-secret',
      generation: 'https://provider.example/generations/accounting?token=generation-secret',
      ledger: 'https://billing.example/credits/ledger?token=ledger-secret',
      reservation: 'https://billing.example/quota/reservation?token=reservation-secret',
      quotaWindow: 'https://billing.example/quota/window?token=window-secret',
      workspace: 'image?token=workspace-secret',
      mode: 'text_to_image?token=mode-secret',
      status: 'reserved?token=status-secret',
      reason: 'provider_failed?token=reason-secret',
    }
    const creditActions = [
      'creative.credit.reserved',
      'creative.credit.settled',
      'creative.credit.refunded',
      'creative.credit.cancelled',
    ]
    const quotaActions = [
      'creative.quota.reserved',
      'creative.quota.committed',
      'creative.quota.released',
    ]
    const payloads = creditActions.map((action, index) => ({
      action,
      resourceType: 'creative_credit_ledger',
      resourceId: `${unsafeValues.resource}&credit=${index}`,
      metadata: {
        generationId: unsafeValues.generation,
        creditLedgerId: unsafeValues.ledger,
        quotaReservationId: unsafeValues.reservation,
        workspace: unsafeValues.workspace,
        mode: unsafeValues.mode,
        status: unsafeValues.status,
        reasonCode: unsafeValues.reason,
        amount: 3,
        settledAmount: 2,
        refundedAmount: 1,
        note: 'Inspect https://billing.example/runbook?token=note-secret',
      },
    }))
    payloads.push(...quotaActions.map((action, index) => ({
      action,
      resourceType: 'creative_quota_reservation',
      resourceId: `${unsafeValues.resource}&quota=${index}`,
      metadata: {
        generationId: unsafeValues.generation,
        reservationId: unsafeValues.reservation,
        quotaWindowId: unsafeValues.quotaWindow,
        workspace: unsafeValues.workspace,
        status: unsafeValues.status,
        reason: unsafeValues.reason,
        units: 2,
        note: 'Inspect https://billing.example/quota-policy?token=quota-note-secret',
      },
    })))
    const recorded = await repositories.providerBudgetAudit.recordMany(payloads)
    const eventIds = recorded.map((item) => item.event.id)
    const resourceTypes = ['creative_credit_ledger', 'creative_quota_reservation']

    const listResponses = await Promise.all(resourceTypes.map((resourceType) => requestJson(
      server.url,
      `/api/admin/audit?resourceType=${resourceType}&limit=100`,
      { method: 'GET', token: 'demo-access.opsplus' },
    )))
    const listedEvents = listResponses.flatMap((response) => response.payload.data)
      .filter((event) => eventIds.includes(event.id))

    const exportResponses = await Promise.all(resourceTypes.map((resourceType) => requestJson(
      server.url,
      `/api/admin/audit/export?resourceType=${resourceType}&limit=100`,
      { method: 'GET', token: 'demo-access.opsplus' },
    )))
    const exportedEvents = exportResponses.flatMap((response) => response.payload.events)
      .filter((event) => eventIds.includes(event.id))

    const details = await Promise.all(eventIds.map((eventId) => requestJson(
      server.url,
      `/api/admin/audit/${eventId}`,
      { method: 'GET', token: 'demo-access.opsplus' },
    )))

    for (const response of [...listResponses, ...exportResponses, ...details]) assert.equal(response.status, 200)
    assert.equal(listedEvents.length, payloads.length)
    assert.equal(exportedEvents.length, payloads.length)
    assert.deepEqual(new Set(listedEvents.map((event) => event.action)), new Set(payloads.map((item) => item.action)))
    assert.deepEqual(new Set(exportedEvents.map((event) => event.action)), new Set(payloads.map((item) => item.action)))

    const events = [...listedEvents, ...exportedEvents, ...details.map((detail) => detail.payload.data)]
    for (const event of events) {
      assert.match(event.resourceId, /^redacted_[a-f0-9]{16}$/)
      for (const key of [
        'generationId',
        'creditLedgerId',
        'quotaReservationId',
        'reservationId',
        'quotaWindowId',
        'workspace',
        'mode',
        'status',
      ]) {
        if (event.metadata[key]) assert.match(event.metadata[key], /^redacted_[a-f0-9]{16}$/)
      }
      for (const key of ['reason', 'reasonCode']) {
        if (event.metadata[key]) {
          assert.equal(event.metadata[key].includes('provider_failed'), true)
          assert.equal(event.metadata[key].includes('reason-secret'), false)
          assert.equal(event.metadata[key].includes('<redacted>'), true)
        }
      }
      assert.equal(event.metadata.note.includes('<redacted-url>'), true)
      for (const key of ['amount', 'settledAmount', 'refundedAmount', 'units']) {
        if (key in event.metadata) assert.equal(typeof event.metadata[key], 'number')
      }
    }

    const serialized = JSON.stringify(events)
    for (const unsafe of [...Object.values(unsafeValues), 'note-secret', 'quota-note-secret']) {
      assert.equal(serialized.includes(unsafe), false)
    }
    assert.equal(serialized.includes('billing.example'), false)
    assert.equal(serialized.includes('provider.example'), false)
  } finally {
    await server.close()
  }
})

test('GET /api/admin/audit list, export, and detail sanitize media asset lifecycle evidence', async () => {
  const server = await createTestServer()
  try {
    const unsafeValues = {
      resource: 'https://media.example/assets/audit?token=resource-secret',
      generation: 'https://provider.example/generations/media?token=generation-secret',
      output: 'https://provider.example/outputs/media?token=output-secret',
      provider: 'replicate?token=provider-secret',
      workspace: 'image?token=workspace-secret',
      purpose: 'generated_output?token=purpose-secret',
      scanStatus: 'clean?token=scan-secret',
    }
    const actions = [
      'media.upload.created',
      'media.upload.completed',
      'media.generated_asset.created',
      'media.download.signed',
    ]
    const payloads = actions.map((action, index) => ({
      action,
      resourceType: 'media_asset',
      resourceId: `${unsafeValues.resource}&event=${index}`,
      metadata: {
        generationId: unsafeValues.generation,
        outputId: unsafeValues.output,
        providerId: unsafeValues.provider,
        workspace: unsafeValues.workspace,
        purpose: unsafeValues.purpose,
        scanStatus: unsafeValues.scanStatus,
        sizeBytes: 4096,
        creativeReviewRequired: true,
        note: 'Inspect https://media.example/runbook?token=note-secret',
      },
    }))
    payloads.push({
      action: 'media.generated_asset.created',
      resourceType: 'media_asset',
      resourceId: 'media-safe-lifecycle-evidence',
      metadata: {
        generationId: 'gen-safe-lifecycle-evidence',
        outputId: 'output-safe-lifecycle-evidence',
        providerId: 'mock',
        workspace: 'image',
        purpose: 'generated_output',
        scanStatus: 'clean',
        sizeBytes: 2048,
        creativeReviewRequired: false,
      },
    })
    const recorded = await repositories.providerBudgetAudit.recordMany(payloads)
    const eventIds = recorded.map((item) => item.event.id)

    const list = await requestJson(
      server.url,
      '/api/admin/audit?resourceType=media_asset&limit=100',
      { method: 'GET', token: 'demo-access.opsplus' },
    )
    const listedEvents = list.payload.data.filter((event) => eventIds.includes(event.id))

    const exported = await requestJson(
      server.url,
      '/api/admin/audit/export?resourceType=media_asset&limit=100',
      { method: 'GET', token: 'demo-access.opsplus' },
    )
    const exportedEvents = exported.payload.events.filter((event) => eventIds.includes(event.id))

    const details = await Promise.all(eventIds.map((eventId) => requestJson(
      server.url,
      `/api/admin/audit/${eventId}`,
      { method: 'GET', token: 'demo-access.opsplus' },
    )))

    assert.equal(list.status, 200)
    assert.equal(exported.status, 200)
    assert.equal(listedEvents.length, payloads.length)
    assert.equal(exportedEvents.length, payloads.length)
    for (const detail of details) assert.equal(detail.status, 200)

    const events = [...listedEvents, ...exportedEvents, ...details.map((detail) => detail.payload.data)]
    const unsafeEventIds = new Set(eventIds.slice(0, actions.length))
    for (const event of events.filter((item) => unsafeEventIds.has(item.id))) {
      assert.match(event.resourceId, /^redacted_[a-f0-9]{16}$/)
      for (const key of ['generationId', 'outputId', 'providerId', 'workspace', 'purpose', 'scanStatus']) {
        assert.match(event.metadata[key], /^redacted_[a-f0-9]{16}$/)
      }
      assert.equal(event.metadata.sizeBytes, 4096)
      assert.equal(event.metadata.creativeReviewRequired, true)
      assert.equal(event.metadata.note.includes('<redacted-url>'), true)
    }

    for (const event of events.filter((item) => !unsafeEventIds.has(item.id))) {
      assert.equal(event.resourceId, 'media-safe-lifecycle-evidence')
      assert.equal(event.metadata.generationId, 'gen-safe-lifecycle-evidence')
      assert.equal(event.metadata.outputId, 'output-safe-lifecycle-evidence')
      assert.equal(event.metadata.providerId, 'mock')
      assert.equal(event.metadata.workspace, 'image')
      assert.equal(event.metadata.purpose, 'generated_output')
      assert.equal(event.metadata.scanStatus, 'clean')
      assert.equal(event.metadata.sizeBytes, 2048)
      assert.equal(event.metadata.creativeReviewRequired, false)
    }

    const serialized = JSON.stringify(events)
    for (const unsafe of [...Object.values(unsafeValues), 'note-secret']) {
      assert.equal(serialized.includes(unsafe), false)
    }
    assert.equal(serialized.includes('media.example'), false)
    assert.equal(serialized.includes('provider.example'), false)
  } finally {
    await server.close()
  }
})

test('GET /api/admin/audit/export requires audit read permission', async () => {
  const server = await createTestServer()
  try {
    const denied = await requestJson(server.url, '/api/admin/audit/export', {
      method: 'GET',
      token: 'demo-access.taskops',
    })
    assert.equal(denied.status, 403)
    assert.equal(denied.payload.error.message, 'Missing permission: admin:audit:read')
  } finally {
    await server.close()
  }
})

test('GET /api/admin/audit/:id returns a single audit event', async () => {
  const server = await createTestServer()
  try {
    const updatedRole = await requestJson(server.url, '/api/admin/roles/member/permissions', {
      method: 'PUT',
      body: { permissions: ['task:create', 'points:read'] },
      token: 'demo-access.opsplus',
    })
    assert.equal(updatedRole.status, 200)

    const auditList = await requestJson(server.url, '/api/admin/audit?limit=1&action=admin.role_permissions.updated', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(auditList.status, 200)
    assert.equal(auditList.payload.data.length, 1)
    const eventId = auditList.payload.data[0].id

    const event = await requestJson(server.url, `/api/admin/audit/${eventId}`, {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(event.status, 200)
    assert.equal(event.payload.data.id, eventId)
    assert.equal(event.payload.data.action, 'admin.role_permissions.updated')
    assert.equal(event.payload.data.resourceType, 'role')
  } finally {
    await server.close()
  }
})

test('GET /api/admin/audit/:id enforces permissions and missing events', async () => {
  const server = await createTestServer()
  try {
    const unauthenticated = await requestJson(server.url, '/api/admin/audit/audit-missing', { method: 'GET' })
    assert.equal(unauthenticated.status, 401)
    assert.equal(unauthenticated.payload.error.code, 'AUTH_REQUIRED')

    const denied = await requestJson(server.url, '/api/admin/audit/audit-missing', {
      method: 'GET',
      token: 'demo-access.taskops',
    })
    assert.equal(denied.status, 403)
    assert.equal(denied.payload.error.message, 'Missing permission: admin:audit:read')

    const missing = await requestJson(server.url, '/api/admin/audit/audit-missing', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(missing.status, 404)
    assert.equal(missing.payload.error.code, 'NOT_FOUND')
  } finally {
    await server.close()
  }
})

test('GET /api/admin/security/events requires audit read permission', async () => {
  const server = await createTestServer()
  try {
    const unauthenticated = await requestJson(server.url, '/api/admin/security/events', { method: 'GET' })
    assert.equal(unauthenticated.status, 401)
    assert.equal(unauthenticated.payload.error.code, 'AUTH_REQUIRED')

    const denied = await requestJson(server.url, '/api/admin/security/events', {
      method: 'GET',
      token: 'demo-access.taskops',
    })
    assert.equal(denied.status, 403)
    assert.equal(denied.payload.error.message, 'Missing permission: admin:audit:read')
  } finally {
    await server.close()
  }
})

test('GET /api/admin/security/events lists and filters recent security events', async () => {
  resetSecurityEvents()
  const server = await createTestServer()
  try {
    recordSecurityEvent({
      type: 'rate_limit.exceeded',
      severity: 'warning',
      source: 'rate_limit',
      clientKey: '198.51.100.1',
      method: 'POST',
      pathname: '/api/auth/login',
      bucket: 'auth',
    })
    recordSecurityEvent({
      type: 'auth.failed_login.ip_accounts',
      severity: 'warning',
      source: 'auth_failure',
      clientKey: '198.51.100.2',
      identity: 'target@example.com',
      method: 'POST',
      pathname: '/api/auth/login',
    })

    const { status, payload } = await requestJson(server.url, '/api/admin/security/events?source=auth_failure', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })

    assert.equal(status, 200)
    assert.equal(payload.data.length, 1)
    assert.equal(payload.data[0].type, 'auth.failed_login.ip_accounts')
    assert.equal(payload.data[0].source, 'auth_failure')
    assert.equal(payload.data[0].identity, 'target@example.com')
    assert.equal(payload.meta.pagination.limit, 20)
    assert.equal(payload.meta.pagination.nextCursor, null)
  } finally {
    resetSecurityEvents()
    await server.close()
  }
})

test('GET /api/admin/security/events paginates with cursor', async () => {
  resetSecurityEvents()
  const server = await createTestServer()
  try {
    recordSecurityEvent({ type: 'security.first', severity: 'warning', source: 'test' })
    recordSecurityEvent({ type: 'security.second', severity: 'warning', source: 'test' })
    recordSecurityEvent({ type: 'security.third', severity: 'warning', source: 'test' })

    const firstPage = await requestJson(server.url, '/api/admin/security/events?source=test&limit=1', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(firstPage.status, 200)
    assert.equal(firstPage.payload.data.length, 1)
    assert.equal(firstPage.payload.data[0].type, 'security.third')
    assert.ok(firstPage.payload.meta.pagination.nextCursor)

    const secondPage = await requestJson(server.url, `/api/admin/security/events?source=test&limit=1&cursor=${firstPage.payload.meta.pagination.nextCursor}`, {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(secondPage.status, 200)
    assert.equal(secondPage.payload.data.length, 1)
    assert.equal(secondPage.payload.data[0].type, 'security.second')
  } finally {
    resetSecurityEvents()
    await server.close()
  }
})

test('GET /api/admin/security/alerts requires audit read permission', async () => {
  const server = await createTestServer()
  try {
    const unauthenticated = await requestJson(server.url, '/api/admin/security/alerts', { method: 'GET' })
    assert.equal(unauthenticated.status, 401)
    assert.equal(unauthenticated.payload.error.code, 'AUTH_REQUIRED')

    const denied = await requestJson(server.url, '/api/admin/security/alerts', {
      method: 'GET',
      token: 'demo-access.taskops',
    })
    assert.equal(denied.status, 403)
    assert.equal(denied.payload.error.message, 'Missing permission: admin:audit:read')
  } finally {
    await server.close()
  }
})

test('GET /api/admin/security/alerts returns aggregated threshold alerts', async () => {
  resetSecurityEvents()
  const previous = {
    window: process.env.SECURITY_ALERT_WINDOW_MINUTES,
    rateLimit: process.env.SECURITY_ALERT_RATE_LIMIT_THRESHOLD,
    bodyRejected: process.env.SECURITY_ALERT_BODY_REJECTED_THRESHOLD,
    authFailure: process.env.SECURITY_ALERT_AUTH_FAILURE_THRESHOLD,
  }
  process.env.SECURITY_ALERT_WINDOW_MINUTES = '15'
  process.env.SECURITY_ALERT_RATE_LIMIT_THRESHOLD = '2'
  process.env.SECURITY_ALERT_BODY_REJECTED_THRESHOLD = '2'
  process.env.SECURITY_ALERT_AUTH_FAILURE_THRESHOLD = '1'
  const server = await createTestServer()
  try {
    recordSecurityEvent({ type: 'rate_limit.exceeded', severity: 'warning', source: 'rate_limit', clientKey: '198.51.100.1', pathname: '/api/auth/login' })
    recordSecurityEvent({ type: 'rate_limit.exceeded', severity: 'warning', source: 'rate_limit', clientKey: '198.51.100.2', pathname: '/api/auth/login' })
    recordSecurityEvent({ type: 'auth.failed_login.ip_accounts', severity: 'critical', source: 'auth_failure', clientKey: '198.51.100.3', identity: 'target@example.com' })

    const { status, payload } = await requestJson(server.url, '/api/admin/security/alerts', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })

    assert.equal(status, 200)
    assert.ok(payload.data.some((alert) => alert.type === 'security.event.rate_limit.spike'))
    const authAlert = payload.data.find((alert) => alert.type === 'security.event.auth_failure_anomaly.spike')
    assert.equal(authAlert.severity, 'critical')
    assert.equal(authAlert.threshold, 1)
    assert.deepEqual(payload.meta.pagination, { limit: payload.data.length, nextCursor: null })
  } finally {
    if (previous.window == null) delete process.env.SECURITY_ALERT_WINDOW_MINUTES
    else process.env.SECURITY_ALERT_WINDOW_MINUTES = previous.window
    if (previous.rateLimit == null) delete process.env.SECURITY_ALERT_RATE_LIMIT_THRESHOLD
    else process.env.SECURITY_ALERT_RATE_LIMIT_THRESHOLD = previous.rateLimit
    if (previous.bodyRejected == null) delete process.env.SECURITY_ALERT_BODY_REJECTED_THRESHOLD
    else process.env.SECURITY_ALERT_BODY_REJECTED_THRESHOLD = previous.bodyRejected
    if (previous.authFailure == null) delete process.env.SECURITY_ALERT_AUTH_FAILURE_THRESHOLD
    else process.env.SECURITY_ALERT_AUTH_FAILURE_THRESHOLD = previous.authFailure
    resetSecurityEvents()
    await server.close()
  }
})

test('admin security alert disposition and event drill-down APIs work', async () => {
  resetSecurityEvents()
  const previous = {
    window: process.env.SECURITY_ALERT_WINDOW_MINUTES,
    rateLimit: process.env.SECURITY_ALERT_RATE_LIMIT_THRESHOLD,
    bodyRejected: process.env.SECURITY_ALERT_BODY_REJECTED_THRESHOLD,
    authFailure: process.env.SECURITY_ALERT_AUTH_FAILURE_THRESHOLD,
  }
  process.env.SECURITY_ALERT_WINDOW_MINUTES = '15'
  process.env.SECURITY_ALERT_RATE_LIMIT_THRESHOLD = '2'
  process.env.SECURITY_ALERT_BODY_REJECTED_THRESHOLD = '2'
  process.env.SECURITY_ALERT_AUTH_FAILURE_THRESHOLD = '1'
  const server = await createTestServer()
  try {
    recordSecurityEvent({ type: 'rate_limit.exceeded', severity: 'warning', source: 'rate_limit', clientKey: '198.51.100.1', pathname: '/api/auth/login' })
    recordSecurityEvent({ type: 'rate_limit.exceeded', severity: 'warning', source: 'rate_limit', clientKey: '198.51.100.2', pathname: '/api/auth/login' })

    const alerts = await requestJson(server.url, '/api/admin/security/alerts', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    const alert = alerts.payload.data.find((item) => item.type === 'security.event.rate_limit.spike')
    assert.ok(alert)
    assert.equal(alert.state, 'active')

    const events = await requestJson(server.url, `/api/admin/security/alerts/${alert.id}/events`, {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(events.status, 200)
    assert.equal(events.payload.data.length, 2)
    assert.ok(events.payload.data.every((event) => event.source === 'rate_limit'))

    const acknowledged = await requestJson(server.url, `/api/admin/security/alerts/${alert.id}/acknowledge`, {
      method: 'POST',
      token: 'demo-access.opsplus',
      body: { note: 'Investigating login pressure.' },
    })
    assert.equal(acknowledged.status, 200)
    assert.equal(acknowledged.payload.data.state, 'acknowledged')
    assert.equal(acknowledged.payload.data.acknowledgedBy, 'opsplus')
    assert.equal(acknowledged.payload.data.acknowledgementNote, 'Investigating login pressure.')

    const invalidSilence = await requestJson(server.url, `/api/admin/security/alerts/${alert.id}/silence`, {
      method: 'POST',
      token: 'demo-access.opsplus',
      body: { until: '2020-01-01T00:00:00.000Z' },
    })
    assert.equal(invalidSilence.status, 400)
    assert.equal(invalidSilence.payload.error.code, 'VALIDATION_FAILED')

    const silencedUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const silenced = await requestJson(server.url, `/api/admin/security/alerts/${alert.id}/silence`, {
      method: 'POST',
      token: 'demo-access.opsplus',
      body: { until: silencedUntil, note: 'Suppress during controlled load test.' },
    })
    assert.equal(silenced.status, 200)
    assert.equal(silenced.payload.data.state, 'silenced')
    assert.equal(silenced.payload.data.silencedBy, 'opsplus')
    assert.equal(silenced.payload.data.silencedUntil, silencedUntil)

    const unsilenced = await requestJson(server.url, `/api/admin/security/alerts/${alert.id}/unsilence`, {
      method: 'POST',
      token: 'demo-access.opsplus',
      body: { note: 'Load test finished.' },
    })
    assert.equal(unsilenced.status, 200)
    assert.equal(unsilenced.payload.data.state, 'acknowledged')
    assert.equal(unsilenced.payload.data.silencedUntil, null)

    const exported = await requestJson(server.url, `/api/admin/security/alerts/${alert.id}/export`, {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(exported.status, 200)
    assert.equal(exported.payload.alert.id, alert.id)
    assert.equal(exported.payload.events.length, 2)
    assert.ok(exported.payload.auditEvents.some((event) => event.action === 'security.alert.acknowledged'))
    assert.ok(exported.payload.auditEvents.some((event) => event.action === 'security.alert.silenced'))

    const missingExport = await requestJson(server.url, '/api/admin/security/alerts/security-alert-missing/export', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(missingExport.status, 404)
  } finally {
    if (previous.window == null) delete process.env.SECURITY_ALERT_WINDOW_MINUTES
    else process.env.SECURITY_ALERT_WINDOW_MINUTES = previous.window
    if (previous.rateLimit == null) delete process.env.SECURITY_ALERT_RATE_LIMIT_THRESHOLD
    else process.env.SECURITY_ALERT_RATE_LIMIT_THRESHOLD = previous.rateLimit
    if (previous.bodyRejected == null) delete process.env.SECURITY_ALERT_BODY_REJECTED_THRESHOLD
    else process.env.SECURITY_ALERT_BODY_REJECTED_THRESHOLD = previous.bodyRejected
    if (previous.authFailure == null) delete process.env.SECURITY_ALERT_AUTH_FAILURE_THRESHOLD
    else process.env.SECURITY_ALERT_AUTH_FAILURE_THRESHOLD = previous.authFailure
    resetSecurityEvents()
    await server.close()
  }
})

test('security alert read APIs allow auditors but disposition requires alert management permission', async () => {
  resetSecurityEvents()
  const previous = {
    window: process.env.SECURITY_ALERT_WINDOW_MINUTES,
    rateLimit: process.env.SECURITY_ALERT_RATE_LIMIT_THRESHOLD,
  }
  process.env.SECURITY_ALERT_WINDOW_MINUTES = '15'
  process.env.SECURITY_ALERT_RATE_LIMIT_THRESHOLD = '2'
  const server = await createTestServer()
  try {
    recordSecurityEvent({ type: 'rate_limit.exceeded', severity: 'warning', source: 'rate_limit', clientKey: '198.51.100.1', pathname: '/api/auth/login' })
    recordSecurityEvent({ type: 'rate_limit.exceeded', severity: 'warning', source: 'rate_limit', clientKey: '198.51.100.2', pathname: '/api/auth/login' })

    const alerts = await requestJson(server.url, '/api/admin/security/alerts', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })
    assert.equal(alerts.status, 200)
    const alert = alerts.payload.data.find((item) => item.type === 'security.event.rate_limit.spike')
    assert.ok(alert)

    const events = await requestJson(server.url, `/api/admin/security/alerts/${alert.id}/events`, {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })
    assert.equal(events.status, 200)
    assert.equal(events.payload.data.length, 2)

    const exported = await requestJson(server.url, `/api/admin/security/alerts/${alert.id}/export`, {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })
    assert.equal(exported.status, 200)
    assert.equal(exported.payload.alert.id, alert.id)

    const acknowledge = await requestJson(server.url, `/api/admin/security/alerts/${alert.id}/acknowledge`, {
      method: 'POST',
      token: 'demo-access.legalpixel',
      body: { note: 'Read-only operator cannot acknowledge.' },
    })
    assert.equal(acknowledge.status, 403)
    assert.equal(acknowledge.payload.error.message, 'Missing permission: security:alerts:manage')

    const until = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const silence = await requestJson(server.url, `/api/admin/security/alerts/${alert.id}/silence`, {
      method: 'POST',
      token: 'demo-access.legalpixel',
      body: { until, note: 'Read-only operator cannot silence.' },
    })
    assert.equal(silence.status, 403)
    assert.equal(silence.payload.error.message, 'Missing permission: security:alerts:manage')

    const unsilence = await requestJson(server.url, `/api/admin/security/alerts/${alert.id}/unsilence`, {
      method: 'POST',
      token: 'demo-access.legalpixel',
      body: { note: 'Read-only operator cannot unsilence.' },
    })
    assert.equal(unsilence.status, 403)
    assert.equal(unsilence.payload.error.message, 'Missing permission: security:alerts:manage')
  } finally {
    if (previous.window == null) delete process.env.SECURITY_ALERT_WINDOW_MINUTES
    else process.env.SECURITY_ALERT_WINDOW_MINUTES = previous.window
    if (previous.rateLimit == null) delete process.env.SECURITY_ALERT_RATE_LIMIT_THRESHOLD
    else process.env.SECURITY_ALERT_RATE_LIMIT_THRESHOLD = previous.rateLimit
    resetSecurityEvents()
    await server.close()
  }
})

test('GET /api/admin/points/ledger requires points adjustment permission', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/points/ledger', {
      method: 'GET',
      token: 'demo-access.legalpixel',
    })

    assert.equal(status, 403)
    assert.equal(payload.error.code, 'PERMISSION_DENIED')
    assert.equal(payload.error.message, 'Missing permission: points:adjust')
  } finally {
    await server.close()
  }
})

test('GET /api/admin/points/ledger searches user ledgers with balance summary', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/points/ledger?userHandle=promptlin&limit=5', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })

    assert.equal(status, 200)
    assert.ok(Array.isArray(payload.data))
    assert.ok(payload.data.every((entry) => entry.userHandle === 'promptlin'))
    assert.equal(payload.meta.pagination.limit, 5)
    assert.equal(payload.meta.summary.userHandle, 'promptlin')
    assert.equal(typeof payload.meta.summary.available, 'number')
    assert.equal(typeof payload.meta.summary.lifetimeEarned, 'number')
  } finally {
    await server.close()
  }
})

test('GET /api/admin/points/policy returns current adjustment policy', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/points/policy', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })

    assert.equal(status, 200)
    assert.equal(payload.data.roleLimits.admin, 5000)
    assert.equal(payload.data.roleLimits.moderator, 1000)
    assert.ok(payload.data.reasonCodes.includes('support_credit'))
    assert.ok(Array.isArray(payload.data.approvalTemplates))
  } finally {
    await server.close()
  }
})

test('PUT /api/admin/points/policy requires permission management access', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/admin/points/policy', {
      method: 'PUT',
      body: {
        roleLimits: { member: 0, creator: 0, publisher: 0, moderator: 500, admin: 2500 },
        reasonCodes: ['support_credit'],
        approvalTemplates: ['Verified.'],
      },
      token: 'demo-access.legalpixel',
    })

    assert.equal(status, 403)
    assert.equal(payload.error.code, 'PERMISSION_DENIED')
    assert.equal(payload.error.message, 'Missing permission: admin:permissions:manage')
  } finally {
    await server.close()
  }
})

test('PUT /api/admin/points/policy updates direct limits used by adjustment routing', async () => {
  const server = await createTestServer()
  try {
    const updated = await requestJson(server.url, '/api/admin/points/policy', {
      method: 'PUT',
      body: {
        roleLimits: { member: 0, creator: 0, publisher: 0, moderator: 250, admin: 200 },
        reasonCodes: ['support_credit', 'settlement_fix'],
        approvalTemplates: ['Verified with support evidence.'],
      },
      token: 'demo-access.opsplus',
    })

    assert.equal(updated.status, 200)
    assert.equal(updated.payload.data.roleLimits.admin, 200)
    assert.deepEqual(updated.payload.data.reasonCodes, ['support_credit', 'settlement_fix'])

    const adjustment = await requestJson(server.url, '/api/admin/points/adjustments', {
      body: { userHandle: 'promptlin', delta: 250, reason: 'Policy configured review', reasonCode: 'settlement_fix' },
      token: 'demo-access.opsplus',
    })

    assert.equal(adjustment.status, 200)
    assert.equal(adjustment.payload.data.status, 'pending_review')
    assert.equal(adjustment.payload.data.threshold, 200)
    assert.equal(adjustment.payload.data.review.metadata.threshold, 200)
    assert.equal(adjustment.payload.data.review.metadata.reasonCode, 'settlement_fix')

    const audit = await requestJson(server.url, '/api/admin/audit?action=points.policy.updated', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(audit.status, 200)
    assert.equal(audit.payload.data[0].metadata.next.roleLimits.admin, 200)
    assert.equal(audit.payload.data[0].metadata.diff.roleLimits.admin.to, 200)
  } finally {
    await server.close()
  }
})

test('GET and POST /api/admin/points/policy history support diff inspection and rollback', async () => {
  const server = await createTestServer()
  try {
    const updated = await requestJson(server.url, '/api/admin/points/policy', {
      method: 'PUT',
      body: {
        roleLimits: { member: 0, creator: 0, publisher: 0, moderator: 250, admin: 300 },
        reasonCodes: ['support_credit', 'fraud_correction'],
        approvalTemplates: ['Reviewed with finance evidence.'],
      },
      token: 'demo-access.opsplus',
    })
    assert.equal(updated.status, 200)
    assert.equal(updated.payload.data.roleLimits.admin, 300)

    const history = await requestJson(server.url, '/api/admin/points/policy/history?limit=5', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(history.status, 200)
    assert.ok(history.payload.data.length >= 1)
    assert.equal(history.payload.data[0].next.roleLimits.admin, 300)
    assert.match(history.payload.data[0].summary, /admin/)

    const rollback = await requestJson(server.url, '/api/admin/points/policy/rollback', {
      body: { eventId: history.payload.data[0].id },
      token: 'demo-access.opsplus',
    })
    assert.equal(rollback.status, 200)
    assert.equal(rollback.payload.data.roleLimits.admin, history.payload.data[0].previous.roleLimits.admin)

    const afterRollback = await requestJson(server.url, '/api/admin/points/policy', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(afterRollback.payload.data.roleLimits.admin, rollback.payload.data.roleLimits.admin)
  } finally {
    await server.close()
  }
})

test('POST /api/admin/points/adjustments creates a ledger entry and audit event', async () => {
  const server = await createTestServer()
  try {
    const adjusted = await requestJson(server.url, '/api/admin/points/adjustments', {
      body: { userHandle: 'promptlin', delta: 125, reason: 'Support credit' },
      token: 'demo-access.opsplus',
    })

    assert.equal(adjusted.status, 200)
    assert.equal(adjusted.payload.data.status, 'applied')
    assert.equal(adjusted.payload.data.entry.userHandle, 'promptlin')
    assert.equal(adjusted.payload.data.entry.delta, 125)
    assert.equal(adjusted.payload.data.entry.sourceType, 'manual_adjustment')
    assert.match(adjusted.payload.data.entry.description, /Support credit/)
    assert.equal(adjusted.payload.data.review, null)

    const ledger = await requestJson(server.url, '/api/admin/points/ledger?userHandle=promptlin&search=Support%20credit', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(ledger.status, 200)
    assert.equal(ledger.payload.data[0].id, adjusted.payload.data.entry.id)

    const audit = await requestJson(server.url, '/api/admin/audit?action=points.adjusted', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(audit.status, 200)
    assert.equal(audit.payload.data[0].resourceId, adjusted.payload.data.entry.id)
    assert.equal(audit.payload.data[0].metadata.reason, 'Support credit')
  } finally {
    await server.close()
  }
})

test('POST /api/admin/points/adjustments sends high-value adjustments to review before settlement', async () => {
  const server = await createTestServer()
  try {
    const requested = await requestJson(server.url, '/api/admin/points/adjustments', {
      body: { userHandle: 'promptlin', delta: 9000, reason: 'High value support correction' },
      token: 'demo-access.opsplus',
    })

    assert.equal(requested.status, 200)
    assert.equal(requested.payload.data.status, 'pending_review')
    assert.equal(requested.payload.data.entry, null)
    assert.equal(requested.payload.data.review.queue, 'points')
    assert.equal(requested.payload.data.review.owner, 'promptlin')
    assert.equal(requested.payload.data.review.metadata.kind, 'point_adjustment')
    assert.equal(requested.payload.data.review.metadata.delta, 9000)
    assert.equal(requested.payload.data.review.metadata.requestedBy, 'opsplus')
    assert.equal(typeof requested.payload.data.review.metadata.balanceBefore, 'number')
    assert.equal(
      requested.payload.data.review.metadata.projectedBalance,
      requested.payload.data.review.metadata.balanceBefore + 9000,
    )

    const beforeApproval = await requestJson(server.url, '/api/admin/points/ledger?userHandle=promptlin&search=High%20value%20support', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(beforeApproval.status, 200)
    assert.equal(beforeApproval.payload.data.length, 0)

    const approved = await requestJson(server.url, `/api/admin/reviews/${requested.payload.data.review.id}/actions`, {
      body: { decision: 'approve', note: 'Approved high-value correction.' },
      token: 'demo-access.finops',
    })

    assert.equal(approved.status, 200)
    assert.equal(approved.payload.data.status, 'Approved')
    assert.equal(approved.payload.data.metadata.ledgerEntryId.startsWith('ledger-'), true)

    const afterApproval = await requestJson(server.url, '/api/admin/points/ledger?userHandle=promptlin&search=High%20value%20support', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(afterApproval.status, 200)
    assert.equal(afterApproval.payload.data.length, 1)
    assert.equal(afterApproval.payload.data[0].sourceId, requested.payload.data.review.id)
    assert.equal(afterApproval.payload.data[0].delta, 9000)

    const secondApproval = await requestJson(server.url, `/api/admin/reviews/${requested.payload.data.review.id}/actions`, {
      body: { decision: 'approve', note: 'Duplicate approval should be idempotent.' },
      token: 'demo-access.finops',
    })
    assert.equal(secondApproval.status, 200)

    const afterReplay = await requestJson(server.url, '/api/admin/points/ledger?userHandle=promptlin&search=High%20value%20support', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(afterReplay.payload.data.length, 1)
  } finally {
    await server.close()
  }
})

test('POST /api/admin/reviews/:id/actions blocks self-approval for point adjustments', async () => {
  const server = await createTestServer()
  try {
    const requested = await requestJson(server.url, '/api/admin/points/adjustments', {
      body: { userHandle: 'promptlin', delta: 8500, reason: 'Self approval guard setup' },
      token: 'demo-access.opsplus',
    })

    assert.equal(requested.status, 200)
    assert.equal(requested.payload.data.status, 'pending_review')

    const approved = await requestJson(server.url, `/api/admin/reviews/${requested.payload.data.review.id}/actions`, {
      body: { decision: 'approve', note: 'Trying to self approve.' },
      token: 'demo-access.opsplus',
    })

    assert.equal(approved.status, 400)
    assert.equal(approved.payload.error.code, 'VALIDATION_FAILED')
    assert.equal(approved.payload.error.message, 'point adjustment reviews require a different approver')

    const ledger = await requestJson(server.url, '/api/admin/points/ledger?userHandle=promptlin&search=Self%20approval%20guard', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(ledger.status, 200)
    assert.equal(ledger.payload.data.length, 0)
  } finally {
    await server.close()
  }
})

test('POST /api/admin/reviews/:id/actions requires points adjustment permission for points queue reviews', async () => {
  const server = await createTestServer()
  try {
    const requested = await requestJson(server.url, '/api/admin/points/adjustments', {
      body: { userHandle: 'promptlin', delta: 8200, reason: 'Points queue permission guard' },
      token: 'demo-access.opsplus',
    })

    assert.equal(requested.status, 200)
    assert.equal(requested.payload.data.status, 'pending_review')

    const approved = await requestJson(server.url, `/api/admin/reviews/${requested.payload.data.review.id}/actions`, {
      body: { decision: 'approve', note: 'Moderator has queue review but no points adjust.' },
      token: 'demo-access.legalpixel',
    })

    assert.equal(approved.status, 403)
    assert.equal(approved.payload.error.code, 'PERMISSION_DENIED')
    assert.equal(approved.payload.error.message, 'Missing permission: points:adjust')
  } finally {
    await server.close()
  }
})

test('GET /api/admin/points/ledger.csv exports ledger rows as CSV', async () => {
  const server = await createTestServer()
  try {
    const response = await fetch(`${server.url}/api/admin/points/ledger.csv?userHandle=promptlin&limit=2`, {
      method: 'GET',
      headers: {
        accept: 'text/csv',
        authorization: 'Bearer demo-access.opsplus',
      },
    })
    const body = await response.text()

    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), /^text\/csv/)
    assert.match(body, /^id,userHandle,occurredAt,description,delta,balanceAfter,status,sourceType,sourceId/)
    assert.match(body, /promptlin/)
  } finally {
    await server.close()
  }
})

test('admin generation cancellation and retry authorization use dedicated mutation routes', async () => {
  const repository = createSeedRepository()
  const actor = { id: 'demo-user-creator', handle: 'promptlin' }
  const cancelId = `gen-admin-cancel-${Date.now()}`
  const retryId = `gen-admin-retry-${Date.now()}`
  const base = {
    actorId: actor.id,
    actorHandle: actor.handle,
    workspace: 'image',
    mode: 'text_to_image',
    providerId: 'mock',
    providerMode: 'mock',
    promptHash: 'a'.repeat(64),
    promptPreview: 'Admin mutation fixture',
    inputAssetIds: [],
    parameterKeys: [],
  }
  await repository.creativeGenerations.create({ ...base, id: cancelId, status: 'queued' }, actor)
  await repository.creativeGenerations.create({ ...base, id: retryId, status: 'failed' }, actor)
  const server = await createInjectedAdminServer(repository)
  try {
    const denied = await requestJson(server.url, `/api/admin/creative/generations/${cancelId}/cancel`, {
      body: { idempotencyKey: `admin-cancel:${cancelId}:moderator` },
      token: 'demo-access.legalpixel',
    })
    assert.equal(denied.status, 403)
    assert.equal(denied.payload.error.message, 'Missing permission: admin:creative:cancel')

    const cancelled = await requestJson(server.url, `/api/admin/creative/generations/${cancelId}/cancel`, {
      body: { idempotencyKey: `admin-cancel:${cancelId}:request-1` },
      token: 'demo-access.opsplus',
    })
    assert.equal(cancelled.status, 200)
    assert.equal(cancelled.payload.data.generation.status, 'cancelled')

    const authorization = await requestJson(server.url, `/api/admin/creative/generations/${retryId}/retry-requests`, {
      body: { idempotencyKey: `admin-retry:${retryId}:request-1`, note: 'Ask owner to retry' },
      token: 'demo-access.opsplus',
    })
    assert.equal(authorization.status, 200)
    assert.equal(authorization.payload.data.mutation.status, 'approved')
    assert.equal(authorization.payload.data.mutation.safeMetadata.requiresUserConfirmation, true)
    assert.equal(authorization.payload.data.mutation.targetGenerationId, null)

    const ownerNotifications = await repository.notifications.list(
      { handle: 'promptlin' },
      { readState: 'all', resourceType: 'creative_generation', limit: 100 },
    )
    assert.ok(ownerNotifications.items.some((item) =>
      item.type === 'creative.generation.cancelled' && item.resourceId === cancelId,
    ))
    assert.ok(ownerNotifications.items.some((item) =>
      item.type === 'creative.generation.retry_authorized' &&
      item.resourceId === retryId &&
      item.metadata.mutationId === authorization.payload.data.mutation.id,
    ))
  } finally {
    await server.close()
  }
})

test('manual Provider replay requires a different approver and executes only after approval', async () => {
  const repository = createSeedRepository()
  const generationId = `gen-admin-manual-replay-${Date.now()}`
  await repository.creativeGenerations.create({
    id: generationId,
    actorId: 'demo-user-creator',
    actorHandle: 'promptlin',
    workspace: 'image',
    mode: 'text_to_image',
    providerId: 'replicate-staging',
    providerMode: 'replicate_staging',
    providerJobId: 'pred-admin-manual-replay-1',
    status: 'running',
    promptHash: 'b'.repeat(64),
    promptPreview: 'Manual replay fixture',
    inputAssetIds: [],
    parameterKeys: [],
  }, { id: 'demo-user-creator', handle: 'promptlin' })
  const server = await createInjectedAdminServer(repository)
  const requestBody = {
    providerId: 'replicate-staging',
    providerMode: 'replicate_staging',
    providerJobId: 'pred-admin-manual-replay-1',
    normalizedStatus: 'failed',
    reasonCode: 'provider_failure_confirmed',
    idempotencyKey: `manual-replay:${generationId}:failed`,
    note: 'Safe operator evidence only',
  }
  try {
    const requested = await requestJson(
      server.url,
      `/api/admin/creative/generations/${generationId}/manual-replay-requests`,
      { body: requestBody, token: 'demo-access.opsplus' },
    )
    assert.equal(requested.status, 200)
    assert.equal(requested.payload.data.mutation.status, 'pending_review')
    assert.equal(requested.payload.data.review.metadata.kind, 'manual_provider_replay')
    assert.equal(JSON.stringify(requested.payload.data).includes('rawPayload'), false)

    const requestNotifications = await repository.notifications.list(
      { handle: 'promptlin' },
      {
        readState: 'all',
        type: 'creative.generation.manual_replay_requested',
        resourceType: 'creative_generation',
      },
    )
    assert.equal(requestNotifications.items.length, 1)
    assert.equal(requestNotifications.items[0].metadata.reviewId, requested.payload.data.review.id)
    assert.equal(requestNotifications.items[0].metadata.target.surface, 'image')
    assert.equal(requestNotifications.items[0].metadata.target.workspace, 'image')
    assert.equal(JSON.stringify(requestNotifications.items[0]).includes('rawPayload'), false)

    const selfApproval = await requestJson(
      server.url,
      `/api/admin/reviews/${requested.payload.data.review.id}/actions`,
      { body: { decision: 'approve' }, token: 'demo-access.opsplus' },
    )
    assert.equal(selfApproval.status, 400)
    assert.match(selfApproval.payload.error.message, /different approver/)
    assert.equal((await repository.creativeGenerations.find(generationId)).status, 'running')

    const approved = await requestJson(
      server.url,
      `/api/admin/reviews/${requested.payload.data.review.id}/actions`,
      { body: { decision: 'approve', note: 'Evidence independently checked' }, token: 'demo-access.finops' },
    )
    assert.equal(approved.status, 200)
    assert.equal(approved.payload.data.status, 'Approved')
    assert.equal(approved.payload.data.mutation.status, 'succeeded')
    assert.equal((await repository.creativeGenerations.find(generationId)).status, 'failed')

    const ownerDecisionNotifications = await repository.notifications.list(
      { handle: 'promptlin' },
      {
        readState: 'all',
        type: 'creative.generation.manual_replay_completed',
        resourceType: 'creative_generation',
      },
    )
    const requesterDecisionNotifications = await repository.notifications.list(
      { handle: 'opsplus' },
      {
        readState: 'all',
        type: 'creative.generation.manual_replay_completed',
        resourceType: 'creative_generation',
      },
    )
    assert.equal(ownerDecisionNotifications.items.length, 1)
    assert.equal(requesterDecisionNotifications.items.length, 1)
    assert.equal(ownerDecisionNotifications.items[0].metadata.reviewId, requested.payload.data.review.id)
    assert.equal(requesterDecisionNotifications.items[0].metadata.reviewId, requested.payload.data.review.id)

    const replays = await repository.creativeProviderReplays.listForGeneration(generationId)
    assert.equal(replays.items.length, 1)
    assert.equal(replays.items[0].sourceType, 'manual_replay')
  } finally {
    await server.close()
  }
})

test('manual Provider replay rejection notifies the generation owner and requester', async () => {
  const repository = createSeedRepository()
  const generationId = `gen-admin-manual-replay-reject-${Date.now()}`
  await repository.creativeGenerations.create({
    id: generationId,
    actorId: 'demo-user-creator',
    actorHandle: 'promptlin',
    workspace: 'image',
    mode: 'text_to_image',
    providerId: 'replicate-staging',
    providerMode: 'replicate_staging',
    providerJobId: 'pred-admin-manual-replay-reject-1',
    status: 'running',
    promptHash: 'c'.repeat(64),
    promptPreview: 'Manual replay rejection fixture',
    inputAssetIds: [],
    parameterKeys: [],
  }, { id: 'demo-user-creator', handle: 'promptlin' })
  const server = await createInjectedAdminServer(repository)
  try {
    const requested = await requestJson(
      server.url,
      `/api/admin/creative/generations/${generationId}/manual-replay-requests`,
      {
        token: 'demo-access.opsplus',
        body: {
          providerId: 'replicate-staging',
          providerMode: 'replicate_staging',
          providerJobId: 'pred-admin-manual-replay-reject-1',
          normalizedStatus: 'failed',
          reasonCode: 'provider_failure_unconfirmed',
          idempotencyKey: `manual-replay:${generationId}:reject`,
        },
      },
    )
    assert.equal(requested.status, 200)

    const rejected = await requestJson(
      server.url,
      `/api/admin/reviews/${requested.payload.data.review.id}/actions`,
      { body: { decision: 'reject', note: 'Evidence was insufficient' }, token: 'demo-access.finops' },
    )
    assert.equal(rejected.status, 200)
    assert.equal(rejected.payload.data.mutation.status, 'rejected')
    assert.equal((await repository.creativeGenerations.find(generationId)).status, 'running')

    for (const handle of ['promptlin', 'opsplus']) {
      const notifications = await repository.notifications.list(
        { handle },
        {
          readState: 'all',
          type: 'creative.generation.manual_replay_rejected',
          resourceType: 'creative_generation',
        },
      )
      assert.equal(notifications.items.length, 1)
      assert.equal(notifications.items[0].metadata.reviewId, requested.payload.data.review.id)
    }
  } finally {
    await server.close()
  }
})
