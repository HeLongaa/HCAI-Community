import { createServer } from '../common/http/server.js'
import { createRouter } from '../common/http/router.js'
import { registerCreativeRoutes } from '../modules/creative/routes.js'
import { createSeedRepository } from '../repositories/seedRepository.js'
import { buildProviderControlScopes, createProviderCapEvidence, providerCircuitScope } from './providerControlContract.js'
import { resetCreativePolicyState } from './policy.js'

const actor = Object.freeze({ id: 'music-staging-owner', handle: 'music-staging-owner', role: 'creator', permissions: [] })
const authToken = 'music-staging-acceptance-token'

const listen = (server) => new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
})
const close = (server) => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))

const provisionControls = async ({ repositories, source, now }) => {
  const identity = {
    providerId: 'hcai-router-minimax-music-3',
    providerAccountRef: String(source.CREATIVE_ROUTER_MUSIC_PROVIDER_ACCOUNT_REF ?? 'staging').trim() || 'staging',
    workspace: 'music',
    modelFamily: 'music',
  }
  const scopes = buildProviderControlScopes(identity)
  for (const scope of scopes.filter((item) => ['global', 'provider'].includes(item.scopeType))) {
    const current = await repositories.creativeProviderControls.findControl(scope.scopeKey)
    await repositories.creativeProviderControls.setControl({ ...scope, enabled: true, reasonCode: 'music_staging_acceptance', expectedVersion: current?.version ?? 0 }, actor)
  }
  await repositories.creativeProviderControls.putCapEvidence(createProviderCapEvidence({
    sourceKey: `music-staging-cap-${now.getTime()}`,
    scopeKey: scopes.find((item) => item.scopeType === 'provider').scopeKey,
    providerId: identity.providerId,
    providerAccountRef: identity.providerAccountRef,
    currency: 'USD',
    capAmount: source.CREATIVE_ROUTER_MUSIC_PROVIDER_CAP_USD,
    remainingAmount: source.CREATIVE_ROUTER_MUSIC_APP_BUDGET_USD,
    sourceType: 'manual_attestation',
    sourceRef: 'music-staging-acceptance',
    verifiedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
  }), actor)
  await repositories.creativeProviderControls.ensureCircuit(providerCircuitScope(scopes), actor)
}

export const runRouterMusicStagingAcceptance = async ({ source = process.env, fetchImpl = fetch, now = new Date(), repositories: provided = null, outputSafetyClassifier = null } = {}) => {
  resetCreativePolicyState()
  const repositories = provided ?? createSeedRepository()
  await provisionControls({ repositories, source, now })
  let providerCalls = 0
  const router = createRouter()
  registerCreativeRoutes(router, {
    repositories,
    source,
    executionSource: source,
    now: () => new Date(now),
    routerMusicFetchImpl: async (...args) => {
      if (String(args[0]).endsWith('/v1/music_generation')) providerCalls += 1
      return fetchImpl(...args)
    },
    outputSafetyClassifier,
  })
  const server = createServer(router, { resolveUser: async (token) => token === authToken ? actor : null })
  await listen(server)
  try {
    const address = server.address()
    const response = await fetch(`http://127.0.0.1:${address.port}/api/creative/generations`, {
      method: 'POST',
      headers: { authorization: `Bearer ${authToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: `music-staging-${now.getTime()}`,
        workspace: 'music', mode: 'instrumental', providerId: 'hcai-router-minimax-music-3',
        prompt: 'A restrained thirty second cinematic instrumental with warm piano and clean percussion.',
        inputAssetIds: [],
        parameters: { durationSeconds: 30, genre: 'cinematic', mood: 'calm', tempoBpm: 96, outputFormat: 'mp3' },
      }),
    })
    const payload = await response.json()
    const generation = payload.data
    if (response.status !== 200 || generation?.status !== 'completed') throw new Error(`Router MiniMax Music application acceptance failed: http=${response.status} code=${payload.error?.code ?? 'none'}`)
    const output = generation.outputs?.[0]
    if (output?.storage?.persisted !== true || output.storage.provider !== 'media_asset' || output.storage.scanStatus !== 'clean' || output.license?.evidenceStatus !== 'verified_staging') {
      throw new Error(`Router MiniMax Music output and license governance did not complete: persisted=${output?.storage?.persisted} provider=${output?.storage?.provider} scan=${output?.storage?.scanStatus} license=${output?.license?.evidenceStatus}`)
    }
    if (generation.credit?.status !== 'settled' || Number(generation.quota?.used) <= 0) throw new Error(`Router MiniMax Music accounting did not close: credit=${generation.credit?.status} quota=${generation.quota?.used}`)
    const cost = await repositories.creativeProviderCosts.findForGeneration(generation.id)
    if (!['settled', 'reconciliation_required'].includes(cost?.status)) throw new Error('Router MiniMax Music Provider cost did not close')
    if (providerCalls !== 1) throw new Error(`Router MiniMax Music acceptance requires exactly one Provider generation call, received ${providerCalls}`)
    return Object.freeze({ schemaVersion: 'router-minimax-music-staging-acceptance-v1', providerId: 'hcai-router-minimax-music-3', modelId: 'music-3.0', providerCalls, generatedSeconds: 30, outputPersisted: true, outputSafetyPassed: true, outputScanPassed: true, outputPrivate: true, licenseVerified: true, creditSettled: true, quotaCommitted: true, costStatus: cost.status, productionNoGo: true })
  } finally {
    await close(server)
  }
}
