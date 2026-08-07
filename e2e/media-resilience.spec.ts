import { expect, test } from '@playwright/test'

import type { ApiAssetLibraryItem, ApiGenerationTask } from '../src/services/contracts'
import { signInPage } from './helpers'

const available = { available: true, reasonCode: null }
const unavailable = { available: false, reasonCode: 'not_available' }

test('Home media keeps its geometry on a slow response and degrades inside the workbench on failure', async ({ page, request }) => {
  await signInPage(page, request, 'promptlin')
  await page.route('**/api/creative/generations?*', (route) => route.fulfill({
    json: { data: [], meta: { pagination: { limit: 20, nextCursor: null } } },
  }))
  await page.route('**/showcase/home-cinematic.jpg', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    await route.fulfill({ path: 'public/showcase/home-cinematic.jpg', contentType: 'image/jpeg' })
  })

  await page.goto('/#home', { waitUntil: 'domcontentloaded' })
  const stage = page.locator('.home-hero-media')
  await expect(stage).toBeVisible()
  await page.waitForTimeout(450)
  const before = await stage.boundingBox()
  await expect.poll(() => stage.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
  const after = await stage.boundingBox()
  expect(after).toEqual(before)

  await page.unroute('**/showcase/home-cinematic.jpg')
  await page.route('**/showcase/home-cinematic.jpg', (route) => route.abort('failed'))
  await page.reload()
  await expect(page.getByTestId('home-media-fallback')).toBeVisible()
  await expect(page.getByRole('button', { name: /Create image|创作图片|Continue|继续/ })).toBeEnabled()
  await page.waitForTimeout(400)
  await page.screenshot({ path: '/tmp/hcai-media-fallback-home.png', fullPage: false })

  await page.goto('/#playground?workspace=image')
  const workspaceFallback = page.getByTestId('workspace-sample-load-failed')
  await expect(workspaceFallback).toBeVisible()
  const fallbackTitle = workspaceFallback.getByText(/Sample unavailable|示例图暂不可用/)
  await expect(fallbackTitle).toBeVisible()
  const titleBox = await fallbackTitle.boundingBox()
  const viewport = page.viewportSize()
  expect(titleBox).not.toBeNull()
  expect(viewport).not.toBeNull()
  expect(titleBox!.y + titleBox!.height).toBeLessThanOrEqual(viewport!.height)
  await expect(page.getByRole('button', { name: /Generate images|生成图片/ })).toBeEnabled()
  await page.waitForTimeout(400)
  await page.screenshot({ path: '/tmp/hcai-media-fallback-workspace.png', fullPage: false })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: /Result|结果/ }).click()
  await expect(workspaceFallback).toBeVisible()
  await workspaceFallback.scrollIntoViewIfNeeded()
  const mobileFallbackBox = await workspaceFallback.boundingBox()
  expect(mobileFallbackBox).not.toBeNull()
  expect(mobileFallbackBox!.x).toBeGreaterThanOrEqual(0)
  expect(mobileFallbackBox!.x + mobileFallbackBox!.width).toBeLessThanOrEqual(390.5)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
  await page.screenshot({ path: '/tmp/hcai-media-fallback-workspace-mobile.png', fullPage: false })
})

test('Asset thumbnails and detail previews fall back to media type controls', async ({ page, request }) => {
  await signInPage(page, request, 'promptlin')
  const asset: ApiAssetLibraryItem = {
    id: 'resilient-asset', fileName: 'resilient-preview.png', contentType: 'image/png', mediaType: 'image', sizeBytes: 4096,
    purpose: 'library_asset', status: 'uploaded', scanStatus: 'clean', archivedAt: null, deletedAt: null, deletionReason: null, sourceGeneration: null,
    storage: { provider: 's3', state: 'available', verifiedSizeBytes: 4096, verifiedContentType: 'image/png', verifiedAt: '2026-08-08T00:00:00.000Z', cleanupAfter: null, deletedAt: null, lastErrorCode: null, version: 1 },
    relations: [], referenced: false,
    actions: { download: { available: true, reason: null }, archive: { available: true, reason: null }, restore: { available: false, reason: 'not_archived' }, delete: { available: true, reason: null }, recover: { available: false, reason: 'not_deleted' }, reuse: { image: { available: false, reason: 'no_generation_source' }, video: { available: false, reason: 'no_generation_source' }, music: { available: false, reason: 'incompatible_asset' }, chat: { available: false, reason: 'incompatible_asset' } } },
    createdAt: '2026-08-08T00:00:00.000Z', updatedAt: '2026-08-08T00:00:00.000Z',
  }
  await page.route('**/api/media/assets?*', (route) => route.fulfill({ json: { data: [asset], meta: { pagination: { limit: 24, nextCursor: null } } } }))
  await page.route('**/api/media/assets/resilient-asset/download', (route) => route.fulfill({ json: { data: { asset, download: { provider: 'private-cdn', method: 'GET', url: 'http://127.0.0.1:8787/broken-asset-preview.png', headers: {}, expiresAt: '2026-08-08T00:10:00.000Z' } } } }))
  await page.route('**/broken-asset-preview.png', (route) => route.abort('failed'))

  await page.goto('/#assets')
  await expect(page.getByRole('button', { name: /resilient-preview.png/ })).toBeVisible()
  await expect(page.getByTestId('asset-preview-fallback-resilient-asset')).toBeVisible()
  await expect(page.locator('.asset-card-preview img')).toHaveCount(0)
  await page.getByRole('button', { name: /resilient-preview.png/ }).click()
  await expect(page.getByTestId('asset-detail-preview-fallback-resilient-asset')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Close asset details' })).toBeEnabled()
})

test('Generation private media failure keeps output actions and context available', async ({ page, request }) => {
  await signInPage(page, request, 'promptlin')
  const task: ApiGenerationTask = {
    id: 'resilient-generation', workspace: 'image', mode: 'text_to_image', status: 'completed', summary: 'Resilient generation preview',
    attempt: { number: 1, retryOfId: null }, usage: { estimatedCredits: 2, metered: true }, review: { required: false }, error: null,
    outputs: [{ assetId: 'resilient-output', fileName: 'resilient-output.png', contentType: 'image/png', status: 'uploaded', scanStatus: 'clean', lineage: [], reuse: null, createdAt: '2026-08-08T00:01:00.000Z' }],
    actions: { view: available, cancel: unavailable, retry: unavailable, download: available, reuse: unavailable },
    deepLink: { page: 'playground', workspace: 'image' }, startedAt: '2026-08-08T00:00:00.000Z', completedAt: '2026-08-08T00:01:00.000Z', failedAt: null, createdAt: '2026-08-08T00:00:00.000Z', updatedAt: '2026-08-08T00:01:00.000Z',
  }
  await page.route('**/api/creative/generation-center/summary?*', (route) => route.fulfill({ json: { data: { total: 1, active: 0, failed: 0, reviewRequired: 0, outputAssets: 1, byStatus: { completed: 1 }, byWorkspace: { image: 1 } } } }))
  await page.route('**/api/creative/generation-center?*', (route) => route.fulfill({ json: { data: [task], meta: { pagination: { limit: 20, nextCursor: null } } } }))
  await page.route('**/api/media/assets/resilient-output/download', (route) => route.fulfill({ json: { data: { asset: { id: 'resilient-output', fileName: 'resilient-output.png' }, download: { provider: 'private-cdn', method: 'GET', url: 'http://127.0.0.1:8787/broken-generation-preview.png', headers: {}, expiresAt: '2026-08-08T00:10:00.000Z' } } } }))
  await page.route('**/broken-generation-preview.png', (route) => route.abort('failed'))

  await page.goto('/#generations')
  await expect(page.getByTestId('generation-preview-load-failed')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Resilient generation preview' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Download/ })).toBeEnabled()
  await expect(page.getByTestId('app-toast')).toHaveCount(0)
  await page.screenshot({ path: '/tmp/hcai-media-fallback-generations.png', fullPage: false })
})
