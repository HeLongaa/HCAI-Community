import { setTimeout as sleep } from 'node:timers/promises'

import { createServer } from '../common/http/server.js'
import { createRouter } from '../common/http/router.js'
import { registerCreativeRoutes } from '../modules/creative/routes.js'
import { createSeedRepository } from '../repositories/seedRepository.js'
import {
  buildProviderControlScopes,
  createProviderCapEvidence,
  providerCircuitScope,
} from './providerControlContract.js'
import { resetCreativePolicyState } from './policy.js'
import { createGoogleVeoHttpClient } from './googleVeoProvider.js'
import { pollVideoProviderOperationOnce } from './videoProviderLifecycle.js'

const actor = Object.freeze({
  id: 'video-staging-acceptance-owner',
  handle: 'video-staging-acceptance',
  role: 'creator',
  permissions: [],
})

const authToken = 'video-staging-acceptance-token'

const listen = (server) => new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    server.off('error', reject)
    resolve()
  })
})

const close = (server) => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve())
})

const providerIdentityFor = (source) => ({
  providerId: 'google-veo-3-1-fast',
  providerAccountRef: String(source.CREATIVE_GOOGLE_VEO_PROVIDER_ACCOUNT_REF ?? 'staging').trim() || 'staging',
  workspace: 'video',
  modelFamily: 'video',
})

const provisionProviderControls = async ({ repositories, source, now }) => {
  const identity = providerIdentityFor(source)
  const scopes = buildProviderControlScopes(identity)
  const global = await repositories.creativeProviderControls.findControl('global')
  await repositories.creativeProviderControls.setControl({
    ...scopes[0],
    enabled: true,
    reasonCode: 'video_staging_acceptance_enabled',
    expectedVersion: global?.version ?? 0,
  }, actor)
  await repositories.creativeProviderControls.setControl({
    ...scopes[1],
    enabled: true,
    reasonCode: 'video_staging_provider_enabled',
    expectedVersion: 0,
  }, actor)
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000)
  await repositories.creativeProviderControls.putCapEvidence(createProviderCapEvidence({
    sourceKey: `video-staging-cap-${now.getTime()}`,
    scopeKey: scopes[1].scopeKey,
    providerId: identity.providerId,
    providerAccountRef: identity.providerAccountRef,
    currency: 'USD',
    capAmount: source.CREATIVE_GOOGLE_VEO_PROVIDER_CAP_USD,
    remainingAmount: source.CREATIVE_GOOGLE_VEO_APP_BUDGET_USD,
    sourceType: 'manual_attestation',
    sourceRef: 'video-staging-acceptance',
    verifiedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  }), actor)
  await repositories.creativeProviderControls.ensureCircuit(providerCircuitScope(scopes), actor)
}

const postGeneration = async (origin, now) => {
  const response = await fetch(`${origin}/api/creative/generations`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${authToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      idempotencyKey: `video-staging-${now.getTime()}`,
      workspace: 'video',
      mode: 'text_to_video',
      prompt: 'A restrained abstract light study with slow controlled camera motion and no people.',
      inputAssetIds: [],
      parameters: {
        aspectRatio: '16:9',
        durationSeconds: 4,
        motionPreset: 'subtle',
        outputFormat: 'mp4',
      },
      providerId: 'google-veo-3-1-fast',
    }),
  })
  return { status: response.status, payload: await response.json() }
}

export const runGoogleVeoStagingAcceptance = async ({
  source = process.env,
  fetchImpl = globalThis.fetch,
  now = new Date(),
  repositories: providedRepositories = null,
  sleepImpl = sleep,
} = {}) => {
  resetCreativePolicyState()
  const repositories = providedRepositories ?? createSeedRepository()
  await provisionProviderControls({ repositories, source, now })
  let providerCalls = 0
  const countedFetch = async (...args) => {
    if (String(args[0]).includes(':predictLongRunning')) providerCalls += 1
    return fetchImpl(...args)
  }
  const client = createGoogleVeoHttpClient({ source, fetchImpl: countedFetch })
  const router = createRouter()
  registerCreativeRoutes(router, {
    repositories,
    source,
    executionSource: source,
    now: () => new Date(now),
    googleVeoClient: client,
  })
  const server = createServer(router, { resolveUser: async (token) => token === authToken ? actor : null })
  await listen(server)
  const address = server.address()
  const origin = `http://127.0.0.1:${address.port}`

  try {
    const dispatched = await postGeneration(origin, now)
    const queued = dispatched.payload?.data
    if (dispatched.status !== 200 || !['queued', 'running'].includes(queued?.status)) {
      throw new Error(`Google Veo application dispatch failed: http=${dispatched.status} code=${dispatched.payload?.error?.code ?? 'none'}`)
    }
    let operation = await repositories.creativeProviderOperations.findForGeneration(queued.id)
    const pollIntervalMs = Math.max(1000, Number(source.CREATIVE_GOOGLE_VEO_POLL_INTERVAL_SECONDS ?? 15) * 1000)
    const deadline = Date.now() + Math.min(900, Number(source.CREATIVE_GOOGLE_VEO_TIMEOUT_SECONDS ?? 900)) * 1000
    while (operation && !['completed', 'failed', 'cancelled', 'timed_out'].includes(operation.status)) {
      const result = await pollVideoProviderOperationOnce({
        operation,
        repositories,
        statusClient: client,
        source,
        now: new Date(),
        actor,
        fetchOutput: client.fetchOutput,
      })
      operation = result.operation
      if (!['completed', 'failed', 'cancelled', 'timed_out'].includes(operation.status)) {
        if (Date.now() >= deadline) throw new Error('Google Veo staging acceptance exceeded its polling deadline')
        await sleepImpl(pollIntervalMs)
      }
    }
    if (operation?.status !== 'completed' || operation.sideEffectsComplete !== true) {
      throw new Error(`Google Veo application lifecycle failed: status=${operation?.status ?? 'missing'}`)
    }
    await repositories.media.sweepScanJobs?.({ source: 'video_staging_acceptance' })
    const generation = await repositories.creativeGenerations.find(queued.id)
    const cost = await repositories.creativeProviderCosts.findForGeneration(queued.id)
    let assets = await Promise.all((generation.outputAssetIds ?? []).map((id) => repositories.media.find(id)))
    if (String(source.MEDIA_SCAN_PROVIDER ?? '').toLowerCase() === 'mock') {
      await Promise.all(assets
        .filter((asset) => asset?.metadata?.security?.scanStatus !== 'clean')
        .map((asset) => repositories.media.reviewUpload(asset.id, {
          decision: 'clean',
          detectedContentType: 'video/mp4',
          note: 'Deterministic staging acceptance scan.',
        }, actor)))
      assets = await Promise.all((generation.outputAssetIds ?? []).map((id) => repositories.media.find(id)))
    }
    if (generation.status !== 'completed' || generation.credit?.status !== 'settled' || Number(generation.quota?.used) !== 8) {
      throw new Error(`Google Veo application accounting did not close: generation=${generation.status} credit=${generation.credit?.status ?? 'missing'} quota=${generation.quota?.used ?? 'missing'}`)
    }
    if (assets.length !== 1 || assets[0]?.contentType !== 'video/mp4' || assets[0]?.metadata?.security?.scanStatus !== 'clean') {
      throw new Error('Google Veo output governance did not complete')
    }
    return Object.freeze({
      providerCalls,
      dispatchCompleted: true,
      lifecycleCompleted: true,
      outputPersisted: true,
      outputScanPassed: true,
      outputPrivate: true,
      creditSettled: true,
      quotaCommitted: true,
      costStatus: cost?.status ?? 'missing',
      generatedSeconds: 4,
      productionNoGo: true,
    })
  } finally {
    await close(server)
  }
}
