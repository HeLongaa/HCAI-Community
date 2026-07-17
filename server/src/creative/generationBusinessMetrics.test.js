import assert from 'node:assert/strict'
import test from 'node:test'

import { buildGenerationBusinessMetrics, generationBusinessMetricsExport } from './generationBusinessMetrics.js'

const generation = (overrides = {}) => ({
  id: 'generation-1', workspace: 'image', status: 'completed', outputAssetIds: ['asset-1'],
  usage: { estimatedCredits: 2 }, credit: { reserved: 2, settled: 2, refunded: 0 }, quota: { used: 1, released: 0 },
  createdAt: '2026-07-17T00:00:00.000Z', startedAt: '2026-07-17T00:00:01.000Z', completedAt: '2026-07-17T00:00:03.000Z', updatedAt: '2026-07-17T00:00:03.000Z',
  ...overrides,
})

test('generation business metrics aggregate quality latency internal units cost and unique conversions', () => {
  const metrics = buildGenerationBusinessMetrics({
    generations: [
      generation(),
      generation({ id: 'generation-2', workspace: 'video', status: 'failed', outputAssetIds: ['asset-2'], credit: { reserved: 3, settled: 0, refunded: 3 }, quota: { used: 0, released: 1 }, startedAt: null, createdAt: '2026-07-17T00:00:00.000Z', failedAt: '2026-07-17T00:00:05.000Z' }),
      generation({ id: 'generation-3', workspace: 'image', status: 'running', outputAssetIds: [] }),
    ],
    costLedgers: [{ currency: 'usd', estimateMicros: '120000', reservedMicros: '120000', actualMicros: '100000', status: 'settled' }],
    reusedAssetIds: ['asset-1', 'asset-1'],
    libraryAssetIds: ['asset-1', 'asset-2'],
    portfolioAssetIds: ['asset-2'],
    taskAssetIds: ['asset-2'],
    query: { dateFrom: '2026-07-01T00:00:00.000Z', dateTo: '2026-07-17T00:00:00.000Z' },
    generatedAt: '2026-07-17T01:00:00.000Z',
  })
  assert.deepEqual(metrics.totals, { generations: 3, terminal: 2, outputAssets: 2 })
  assert.equal(metrics.quality.successRatePercent, 50)
  assert.equal(metrics.latency.averageMs, 3500)
  assert.equal(metrics.internalUnits.compensatedCredits, 3)
  assert.equal(metrics.providerCost.currencies[0].actualMicros, '100000')
  assert.equal('actorHandle' in metrics.filters, false)
  assert.deepEqual(metrics.conversion, { eligibleOutputAssets: 2, convertedOutputAssets: 2, reusedAsInput: 1, savedToLibrary: 2, addedToPortfolio: 1, deliveredToTask: 1, conversionRatePercent: 100, reuseRatePercent: 50 })
  assert.equal(metrics.byWorkspace.find((item) => item.workspace === 'image').total, 2)
})

test('generation business metrics expose unavailable Provider cost and bounded exports without raw facts', () => {
  const metrics = buildGenerationBusinessMetrics({ generations: [generation()] })
  assert.deepEqual(metrics.providerCost, { availability: 'unavailable', reasonCode: 'no_provider_cost_ledgers', currencies: [] })
  assert.match(generationBusinessMetricsExport(metrics, 'csv'), /^"workspace","total","completed"/)
  const json = JSON.parse(generationBusinessMetricsExport(metrics, 'json'))
  assert.equal(json.kind, 'creative.generation-business-metrics.snapshot')
  assert.equal(JSON.stringify(json).includes('prompt'), false)
})
