import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createCreativeProviderRegistry,
  getCreativeProviderForWorkspace,
} from './providerRegistry.js'

test('workspace default keeps explicit mock behavior in test runtimes', () => {
  const registry = createCreativeProviderRegistry({
    NODE_ENV: 'test',
    CREATIVE_PROVIDER_MODE: 'mock',
  })

  assert.equal(getCreativeProviderForWorkspace(null, 'image', registry).id, 'mock')
})

test('image provider uses the deployment display name without changing its adapter identity', () => {
  const registry = createCreativeProviderRegistry({
    NODE_ENV: 'test',
    CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
    CREATIVE_OPENAI_IMAGE_DISPLAY_NAME: 'HCAI Router MiniMax Image 01 Live',
  })
  const provider = registry.providers.find((item) => item.id === 'openai-gpt-image-2')
  assert.equal(provider.label, 'HCAI Router MiniMax Image 01 Live')
  assert.equal(provider.id, 'openai-gpt-image-2')
})

test('workspace default prefers an operational real provider when mock is unavailable', () => {
  const registry = {
    config: { defaultProviderId: 'mock' },
    providers: [
      { id: 'mock', enabled: false, configured: false, capabilities: [] },
      {
        id: 'hcai-router-minimax-hailuo-2-3',
        enabled: true,
        configured: true,
        capabilities: [{ workspace: 'video', modeContracts: [{ id: 'text_to_video', available: true }] }],
      },
    ],
  }

  assert.equal(
    getCreativeProviderForWorkspace(null, 'video', registry).id,
    'hcai-router-minimax-hailuo-2-3',
  )
})

test('workspace default prefers an operational real provider over an operational mock default', () => {
  const capability = { workspace: 'video', modeContracts: [{ id: 'text_to_video', available: true }] }
  const registry = {
    config: { defaultProviderId: 'mock' },
    providers: [
      { id: 'mock', mode: 'mock', enabled: true, configured: true, capabilities: [capability] },
      {
        id: 'hcai-router-minimax-hailuo-2-3',
        mode: 'router_minimax_video',
        enabled: true,
        configured: true,
        capabilities: [capability],
      },
    ],
  }

  assert.equal(
    getCreativeProviderForWorkspace(null, 'video', registry).id,
    'hcai-router-minimax-hailuo-2-3',
  )
})

test('workspace default fails closed when no provider can serve the workspace', () => {
  const registry = {
    config: { defaultProviderId: 'mock' },
    providers: [{ id: 'mock', enabled: false, configured: false, capabilities: [] }],
  }

  assert.throws(
    () => getCreativeProviderForWorkspace(null, 'music', registry),
    (error) => error?.code === 'CREATIVE_PROVIDER_UNAVAILABLE',
  )
})
