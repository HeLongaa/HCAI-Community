import { expect, test } from '@playwright/test'
import type { ApiAssetLibraryItem } from '../src/services/contracts'
import { signInPage } from './helpers'

const asset = (overrides: Partial<ApiAssetLibraryItem> = {}): ApiAssetLibraryItem => ({
  id: 'asset-library-image', fileName: 'campaign-variant.png', contentType: 'image/png', mediaType: 'image', sizeBytes: 4096,
  purpose: 'library_asset', status: 'uploaded', scanStatus: 'clean', archivedAt: null, sourceGeneration: { id: 'generation-image', workspace: 'image', mode: 'image_variation', status: 'completed', createdAt: '2026-07-13T10:00:00.000Z' },
  relations: [{ id: 'relation-1', sourceAssetId: 'asset-library-image', targetAssetId: 'asset-library-variant', relationType: 'variant', sourceGenerationId: 'generation-image', targetWorkspace: 'image', role: 'source', createdAt: '2026-07-13T10:01:00.000Z' }],
  referenced: true,
  actions: { download: { available: true, reason: null }, archive: { available: true, reason: null }, restore: { available: false, reason: 'not_archived' }, reuse: { image: { available: true, reason: null }, video: { available: true, reason: null }, music: { available: false, reason: 'incompatible_asset' }, chat: { available: false, reason: 'incompatible_asset' } } },
  createdAt: '2026-07-13T10:00:00.000Z', updatedAt: '2026-07-13T10:01:00.000Z', ...overrides,
})

test('asset library filters, inspects lineage, archives, and prepares cross-studio reuse', async ({ page, request }) => {
  await signInPage(page, request, 'promptlin')
  let current = asset()
  const queryLog: URLSearchParams[] = []
  await page.route('**/api/media/assets?*', async (route) => {
    queryLog.push(new URL(route.request().url()).searchParams)
    await route.fulfill({ json: { data: current.archivedAt ? [] : [current], meta: { pagination: { limit: 24, nextCursor: null } } } })
  })
  await page.route('**/api/media/assets/asset-library-image/archive', async (route) => {
    current = asset({ archivedAt: '2026-07-13T11:00:00.000Z', actions: { ...current.actions, download: { available: false, reason: 'asset_archived' }, archive: { available: false, reason: 'already_archived' }, restore: { available: true, reason: null } } })
    await route.fulfill({ json: { data: current } })
  })

  await page.goto('/')
  await page.getByTestId('nav-assets').click()
  await expect(page.getByTestId('asset-library')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Assets' })).toBeVisible()
  await expect(page.getByRole('button', { name: /campaign-variant.png/ })).toBeVisible()
  await page.getByRole('button', { name: /campaign-variant.png/ }).click()
  await expect(page.getByText('variant · → asset-library-variant')).toBeVisible()
  await expect(page.getByText('image / image_variation')).toBeVisible()
  await expect(page.getByText('private-storage-key')).toHaveCount(0)

  await page.getByLabel('Media type').selectOption('image')
  await page.getByLabel('Purpose').selectOption('library_asset')
  await page.getByLabel('Search assets').fill('campaign')
  await page.getByLabel('Created after').fill('2026-07-01')
  await page.getByLabel('Created before').fill('2026-07-31')
  await expect.poll(() => queryLog.some((query) => query.get('mediaType') === 'image' && query.get('purpose') === 'library_asset' && query.get('search') === 'campaign' && query.get('dateFrom') === '2026-07-01T00:00:00.000Z' && query.get('dateTo') === '2026-07-31T23:59:59.999Z')).toBe(true)

  await page.getByRole('button', { name: /image/i }).last().click()
  await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('hcaiAssetReuse'))).toContain('asset-library-image')

  await page.getByTestId('nav-assets').click()
  await page.getByRole('button', { name: /campaign-variant.png/ }).click()
  await page.getByRole('button', { name: 'Archive' }).click()
  await expect(page.getByRole('button', { name: /campaign-variant.png/ })).toHaveCount(0)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByTestId('asset-library')).toBeVisible()
  expect(await page.locator('body').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
})
