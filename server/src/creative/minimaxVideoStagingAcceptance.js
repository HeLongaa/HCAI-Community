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
import { createMiniMaxVideoHttpClient } from './minimaxVideoProvider.js'
import { resetCreativePolicyState } from './policy.js'
import { pollVideoProviderOperationOnce } from './videoProviderLifecycle.js'

const providerId = 'hcai-router-minimax-hailuo-2-3'
const providerMode = 'router_minimax_video'
const authToken = 'minimax-video-staging-acceptance-token'
const defaultActor = Object.freeze({
  id: 'minimax-video-staging-acceptance-owner',
  handle: 'minimax-video-staging-acceptance',
  role: 'creator',
  permissions: [],
})
const defaultUnrelatedActor = Object.freeze({
  id: 'minimax-video-staging-acceptance-unrelated',
  handle: 'minimax-video-staging-acceptance-unrelated',
  role: 'creator',
  permissions: [],
})

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
  providerId,
  providerAccountRef: String(source.CREATIVE_ROUTER_MINIMAX_VIDEO_PROVIDER_ACCOUNT_REF ?? 'staging').trim() || 'staging',
  workspace: 'video',
  modelFamily: 'video',
})

const provisionProviderControls = async ({ repositories, source, now, actor }) => {
  const identity = providerIdentityFor(source)
  const scopes = buildProviderControlScopes(identity)
  const global = await repositories.creativeProviderControls.findControl('global')
  await repositories.creativeProviderControls.setControl({
    ...scopes[0],
    enabled: true,
    reasonCode: 'minimax_video_staging_acceptance_enabled',
    expectedVersion: global?.version ?? 0,
  }, actor)
  const providerControl = await repositories.creativeProviderControls.findControl(scopes[1].scopeKey)
  await repositories.creativeProviderControls.setControl({
    ...scopes[1],
    enabled: true,
    reasonCode: 'minimax_video_staging_provider_enabled',
    expectedVersion: providerControl?.version ?? 0,
  }, actor)
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000)
  await repositories.creativeProviderControls.putCapEvidence(createProviderCapEvidence({
    sourceKey: `minimax-video-staging-cap-${now.getTime()}`,
    scopeKey: scopes[1].scopeKey,
    providerId,
    providerAccountRef: identity.providerAccountRef,
    currency: 'USD',
    capAmount: source.CREATIVE_ROUTER_MINIMAX_VIDEO_PROVIDER_CAP_USD,
    remainingAmount: source.CREATIVE_ROUTER_MINIMAX_VIDEO_APP_BUDGET_USD,
    sourceType: 'manual_attestation',
    sourceRef: 'minimax-video-staging-acceptance',
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
      idempotencyKey: `minimax-video-staging-${now.getTime()}`,
      workspace: 'video',
      mode: 'text_to_video',
      prompt: 'A restrained abstract light study with slow controlled camera motion and no people.',
      inputAssetIds: [],
      parameters: {
        aspectRatio: '16:9',
        durationSeconds: 6,
        motionPreset: 'subtle',
        outputFormat: 'mp4',
      },
      providerId,
    }),
  })
  return { status: response.status, payload: await response.json() }
}

export const runMiniMaxVideoStagingAcceptance = async ({
  source = process.env,
  fetchImpl = globalThis.fetch,
  now = new Date(),
  repositories: providedRepositories = null,
  sleepImpl = sleep,
  outputSafetyClassifier = null,
  actor = defaultActor,
  unrelatedActor = defaultUnrelatedActor,
} = {}) => {
  resetCreativePolicyState()
  const repositories = providedRepositories ?? createSeedRepository()
  await provisionProviderControls({ repositories, source, now, actor })
  let providerCalls = 0
  let outputFetches = 0
  let fetchedOutputIdentity = null
  const countedFetch = async (...args) => {
    const url = String(args[0])
    const method = String(args[1]?.method ?? 'GET').toUpperCase()
    if (url.endsWith('/v1/video/generations') && method === 'POST') providerCalls += 1
    if (/\/v1\/videos\/[^/]+\/content$/.test(new URL(url).pathname)) outputFetches += 1
    return fetchImpl(...args)
  }
  const client = createMiniMaxVideoHttpClient({ source, fetchImpl: countedFetch })
  const fetchOutput = async (request) => {
    const fetched = await client.fetchOutput(request)
    fetchedOutputIdentity = { sha256: fetched.sha256, sizeBytes: fetched.sizeBytes }
    return fetched
  }
  const router = createRouter()
  registerCreativeRoutes(router, {
    repositories,
    source,
    executionSource: source,
    now: () => new Date(now),
    minimaxVideoClient: client,
    minimaxVideoFetchImpl: countedFetch,
  })
  const server = createServer(router, { resolveUser: async (token) => token === authToken ? actor : null })
  await listen(server)
  const address = server.address()
  const origin = `http://127.0.0.1:${address.port}`

  try {
    const dispatched = await postGeneration(origin, now)
    const queued = dispatched.payload?.data
    if (dispatched.status !== 200 || !['queued', 'running'].includes(queued?.status)) {
      const error = new Error(`MiniMax Video application dispatch failed: http=${dispatched.status}`)
      error.code = queued?.errorCode ?? dispatched.payload?.error?.code ?? 'MINIMAX_VIDEO_DISPATCH_FAILED'
      throw error
    }
    let operation = await repositories.creativeProviderOperations.findForGeneration(queued.id)
    const pollIntervalMs = Math.max(1000, Number(source.CREATIVE_ROUTER_VIDEO_POLL_INTERVAL_SECONDS ?? 15) * 1000)
    const deadline = Date.now() + Math.min(900, Number(source.CREATIVE_ROUTER_VIDEO_TIMEOUT_SECONDS ?? 900)) * 1000
    while (operation && !['completed', 'failed', 'cancelled', 'timed_out'].includes(operation.status)) {
      const result = await pollVideoProviderOperationOnce({
        operation,
        repositories,
        statusClient: client,
        source,
        now: new Date(),
        actor,
        fetchOutput,
        outputSafetyClassifier,
      })
      operation = result.operation
      if (!['completed', 'failed', 'cancelled', 'timed_out'].includes(operation.status)) {
        if (Date.now() >= deadline) throw new Error('MiniMax Video staging acceptance exceeded its polling deadline')
        await sleepImpl(pollIntervalMs)
      }
    }
    if (operation?.status !== 'completed' || operation.sideEffectsComplete !== true) {
      throw new Error(`MiniMax Video application lifecycle failed: status=${operation?.status ?? 'missing'}`)
    }
    await repositories.media.sweepScanJobs?.({ source: 'minimax_video_staging_acceptance' })
    const generation = await repositories.creativeGenerations.find(queued.id)
    const cost = await repositories.creativeProviderCosts.findForGeneration(queued.id)
    let assets = await Promise.all((generation.outputAssetIds ?? []).map((id) => repositories.media.find(id)))
    if (String(source.MEDIA_SCAN_PROVIDER ?? '').toLowerCase() === 'mock') {
      await Promise.all(assets
        .filter((asset) => asset?.metadata?.security?.scanStatus !== 'clean')
        .map((asset) => repositories.media.reviewUpload(asset.id, {
          decision: 'clean',
          detectedContentType: 'video/mp4',
          note: 'Deterministic MiniMax staging acceptance scan.',
        }, actor)))
      assets = await Promise.all((generation.outputAssetIds ?? []).map((id) => repositories.media.find(id)))
    }
    if (generation.status !== 'completed' || generation.credit?.status !== 'settled' || Number(generation.quota?.used) !== 8) {
      throw new Error(`MiniMax Video application accounting did not close: generation=${generation.status} credit=${generation.credit?.status ?? 'missing'} quota=${generation.quota?.used ?? 'missing'}`)
    }
    const asset = assets[0]
    if (
      assets.length !== 1 ||
      asset?.contentType !== 'video/mp4' ||
      asset?.metadata?.security?.scanStatus !== 'clean' ||
      asset?.metadata?.security?.outputSafetyDecision !== 'allow' ||
      asset?.storage?.state !== 'available'
    ) {
      throw new Error('MiniMax Video output governance did not complete')
    }
    const ownerDownload = await repositories.media.createDownload?.(asset.id, actor)
    const unrelatedDownload = await repositories.media.createDownload?.(asset.id, unrelatedActor)
    if (!ownerDownload || unrelatedDownload) throw new Error('MiniMax Video output privacy boundary did not hold')
    const expectedSha256 = fetchedOutputIdentity?.sha256
    if (
      !expectedSha256 ||
      asset.metadata?.ingestion?.sha256 !== expectedSha256 ||
      Number(asset.sizeBytes) !== Number(fetchedOutputIdentity?.sizeBytes)
    ) {
      throw new Error('MiniMax Video persisted output identity did not match ingested bytes')
    }
    return Object.freeze({
      providerId,
      providerMode,
      providerCalls,
      outputFetches,
      dispatchCompleted: true,
      lifecycleCompleted: true,
      outputPersisted: true,
      outputScanPassed: true,
      outputSafetyAllowed: true,
      outputPrivate: true,
      outputSha256: expectedSha256,
      outputBytes: Number(asset.sizeBytes),
      creditSettled: true,
      quotaCommitted: true,
      quotaUsed: Number(generation.quota.used),
      costStatus: cost?.status ?? 'missing',
      generatedSeconds: 6,
      productionNoGo: true,
    })
  } finally {
    await close(server)
  }
}
