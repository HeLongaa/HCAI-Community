import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import type { ApiAssetLibraryItem } from '../src/services/contracts'
import { signInPage } from './helpers'

const asset = (overrides: Partial<ApiAssetLibraryItem> = {}): ApiAssetLibraryItem => ({
  id: 'asset-library-image', fileName: 'campaign-variant.png', contentType: 'image/png', mediaType: 'image', sizeBytes: 4096,
  purpose: 'library_asset', status: 'uploaded', scanStatus: 'clean', archivedAt: null, deletedAt: null, deletionReason: null, sourceGeneration: { id: 'generation-image', workspace: 'image', mode: 'image_variation', status: 'completed', createdAt: '2026-07-13T10:00:00.000Z' },
  storage: { provider: 's3', state: 'available', verifiedSizeBytes: 4096, verifiedContentType: 'image/png', verifiedAt: '2026-07-13T10:01:00.000Z', cleanupAfter: null, deletedAt: null, lastErrorCode: null, version: 2 },
  relations: [{ id: 'relation-1', sourceAssetId: 'asset-library-image', targetAssetId: 'asset-library-variant', relationType: 'variant', sourceGenerationId: 'generation-image', targetWorkspace: 'image', role: 'source', createdAt: '2026-07-13T10:01:00.000Z' }],
  referenced: true,
  actions: { download: { available: true, reason: null }, archive: { available: true, reason: null }, restore: { available: false, reason: 'not_archived' }, delete: { available: true, reason: null }, recover: { available: false, reason: 'not_deleted' }, reuse: { image: { available: true, reason: null }, video: { available: true, reason: null }, music: { available: false, reason: 'incompatible_asset' }, chat: { available: false, reason: 'incompatible_asset' } } },
  createdAt: '2026-07-13T10:00:00.000Z', updatedAt: '2026-07-13T10:01:00.000Z', ...overrides,
})

test('asset library filters, inspects lineage, archives, and prepares cross-studio reuse', async ({ page, request }) => {
  await signInPage(page, request, 'promptlin')
  let current = asset()
  const queryLog: URLSearchParams[] = []
  let privateLibrarySaves = 0
  let portfolioDrafts = 0
  await page.route('**/api/media/assets?*', async (route) => {
    const query = new URL(route.request().url()).searchParams
    queryLog.push(query)
    const lifecycle = query.get('lifecycle') ?? 'active'
    const visible = lifecycle === 'all' || lifecycle === 'deleted' ? lifecycle === 'all' || Boolean(current.deletedAt) : lifecycle === 'archived' ? Boolean(current.archivedAt) && !current.deletedAt : !current.archivedAt && !current.deletedAt
    await route.fulfill({ json: { data: visible ? [current] : [], meta: { pagination: { limit: 24, nextCursor: null } } } })
  })
  await page.route('**/api/media/assets/asset-library-image/archive', async (route) => {
    current = asset({ archivedAt: '2026-07-13T11:00:00.000Z', actions: { ...current.actions, download: { available: false, reason: 'asset_archived' }, archive: { available: false, reason: 'already_archived' }, restore: { available: true, reason: null } } })
    await route.fulfill({ json: { data: current } })
  })
  await page.route('**/api/media/assets/asset-library-image', async (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback()
    current = asset({ deletedAt: '2026-07-13T11:00:00.000Z', deletionReason: 'user_requested', actions: { ...current.actions, download: { available: false, reason: 'asset_deleted' }, archive: { available: false, reason: 'asset_deleted' }, restore: { available: false, reason: 'asset_deleted' }, delete: { available: false, reason: 'already_deleted' }, recover: { available: true, reason: null } } })
    await route.fulfill({ json: { data: current } })
  })
  await page.route('**/api/media/assets/asset-library-image/recover', async (route) => {
    current = asset()
    await route.fulfill({ json: { data: current } })
  })
  await page.route('**/api/tasks/delivery-targets', async (route) => {
    await route.fulfill({ json: { data: [] } })
  })
  await page.route('**/api/media/assets/asset-library-image/library', async (route) => {
    privateLibrarySaves += 1
    await route.fulfill({ status: 201, json: { data: { id: 'library-output-1', title: current.fileName, type: 'asset', source: 'Creative output', sourceId: current.id, metadata: {} } } })
  })
  await page.route('**/api/media/assets/asset-library-image/portfolio', async (route) => {
    portfolioDrafts += 1
    await route.fulfill({ status: 201, json: { data: { id: 'portfolio-output-1', assetId: current.id, title: current.fileName, caption: '', status: 'draft' } } })
  })
  await page.route('**/api/creative/generation-center/generation-image', async (route) => {
    await route.fulfill({ json: { data: {
      id: 'generation-image', workspace: 'image', mode: 'image_variation', status: 'completed', summary: 'Source image variation',
      attempt: { number: 1, retryOfId: null }, usage: { estimatedCredits: 1, metered: true }, review: { required: false }, error: null, outputs: [],
      actions: { view: { available: true, reasonCode: null }, cancel: { available: false, reasonCode: 'completed' }, retry: { available: false, reasonCode: 'no_request', requiresOriginalRequest: true }, download: { available: false, reasonCode: 'no_output' }, reuse: { available: false, reasonCode: 'no_output' } },
      deepLink: { page: 'playground', workspace: 'image' }, startedAt: null, completedAt: '2026-07-13T10:01:00.000Z', failedAt: null, createdAt: '2026-07-13T10:00:00.000Z', updatedAt: '2026-07-13T10:01:00.000Z',
    } } })
  })

  await page.goto('/')
  await page.getByTestId('nav-assets').click()
  await expect(page.getByTestId('asset-library')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Assets' })).toBeVisible()
  await expect(page.getByRole('button', { name: /campaign-variant.png/ })).toBeVisible()
  await page.getByRole('button', { name: /campaign-variant.png/ }).click()
  await expect(page.getByText('variant · → asset-library-variant')).toBeVisible()
  await expect(page.getByText('image / image_variation')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open source task' })).toBeVisible()
  await page.getByRole('button', { name: 'Open source task' }).click()
  await expect(page.getByTestId('generation-center')).toBeVisible()
  await expect(page).toHaveURL(/#generations\/generation-image/)
  await page.getByTestId('nav-assets').click()
  await page.getByRole('button', { name: /campaign-variant.png/ }).click()
  await expect(page.getByText('private-storage-key')).toHaveCount(0)
  await page.getByRole('button', { name: 'Use output' }).click()
  await page.getByRole('button', { name: 'Private library' }).click()
  await expect(page.getByText('Saved to your private library.')).toBeVisible()
  await page.getByRole('button', { name: 'Portfolio draft' }).click()
  await expect(page.getByText('Portfolio draft created.')).toBeVisible()
  expect(privateLibrarySaves).toBe(1)
  expect(portfolioDrafts).toBe(1)

  await page.getByLabel('Media type').selectOption('image')
  await page.getByLabel('Purpose').selectOption('library_asset')
  await page.getByLabel('Group assets by').selectOption('purpose')
  await expect(page.locator('.asset-group > header')).toContainText('library asset')
  await page.getByLabel('Search assets').fill('campaign')
  await page.getByLabel('Created after').fill('2026-07-01')
  await page.getByLabel('Created before').fill('2026-07-31')
  await expect.poll(() => queryLog.some((query) => query.get('mediaType') === 'image' && query.get('purpose') === 'library_asset' && query.get('search') === 'campaign' && query.get('dateFrom') === '2026-07-01T00:00:00.000Z' && query.get('dateTo') === '2026-07-31T23:59:59.999Z')).toBe(true)

  await page.context().setOffline(true)
  await expect(page.getByText('Offline. Showing the last loaded asset state.')).toBeVisible()
  await expect(page.getByRole('button', { name: /image/i }).last()).toBeDisabled()
  await page.context().setOffline(false)
  await page.getByRole('button', { name: /image/i }).last().click()
  await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('hcaiAssetReuse'))).toContain('asset-library-image')
  await page.reload()
  await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('hcaiAssetReuse'))).toContain('asset-library-image')

  await page.getByTestId('nav-assets').click()
  await page.getByRole('button', { name: /campaign-variant.png/ }).click()
  await page.getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('button', { name: 'Confirm delete' }).click()
  await expect(page.getByRole('button', { name: /campaign-variant.png/ })).toHaveCount(0)
  await page.getByLabel('Lifecycle state').selectOption('deleted')
  await page.getByRole('button', { name: /campaign-variant.png/ }).click()
  await expect(page.getByRole('definition').filter({ hasText: 'Trash' })).toBeVisible()
  await page.getByRole('button', { name: 'Recover' }).click()
  await page.getByLabel('Lifecycle state').selectOption('active')

  await page.getByRole('button', { name: /campaign-variant.png/ }).click()
  await page.getByRole('button', { name: 'Archive' }).click()
  await expect(page.getByRole('button', { name: /campaign-variant.png/ })).toHaveCount(0)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByTestId('asset-library')).toBeVisible()
  expect(await page.locator('body').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
})

test('asset library prepares a fixture upload and exposes its pending governance state', async ({ page, request }) => {
  await signInPage(page, request, 'promptlin')
  const fileBody = Buffer.from('fixture upload')
  const checksumSha256 = createHash('sha256').update(fileBody).digest('hex')
  const uploaded = asset({
    id: 'asset-uploaded-file', fileName: 'upload-note.txt', contentType: 'text/plain', mediaType: 'document', status: 'pending', scanStatus: 'pending', sourceGeneration: null, relations: [], referenced: false,
    storage: { provider: 's3', state: 'quarantined', verifiedSizeBytes: fileBody.length, verifiedContentType: 'text/plain', verifiedAt: '2026-07-16T12:00:01.000Z', quarantinedAt: '2026-07-16T12:00:01.000Z', cleanupAfter: null, deletedAt: null, lastErrorCode: null, version: 2 },
    actions: { ...asset().actions, download: { available: false, reason: 'asset_not_clean' }, reuse: { image: { available: false, reason: 'asset_not_clean' }, video: { available: false, reason: 'asset_not_clean' }, music: { available: false, reason: 'asset_not_clean' }, chat: { available: false, reason: 'asset_not_clean' } } },
  })
  let completed = false
  let storagePut = false
  await page.route('**/api/media/assets?*', async (route) => route.fulfill({ json: { data: completed ? [uploaded] : [], meta: { pagination: { limit: 24, nextCursor: null } } } }))
  await page.route('**/api/media/uploads', async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ checksumSha256, contentType: 'text/plain', sizeBytes: fileBody.length })
    await route.fulfill({ status: 201, json: { data: { asset: { id: uploaded.id, fileName: uploaded.fileName, contentType: uploaded.contentType, sizeBytes: fileBody.length, purpose: uploaded.purpose, status: 'pending' }, upload: { provider: 's3', method: 'PUT', url: 'https://storage.example.test/upload-note.txt', headers: { 'content-type': 'text/plain', 'x-amz-checksum-sha256': Buffer.from(checksumSha256, 'hex').toString('base64') }, expiresAt: '2026-07-16T12:00:00.000Z' } } } })
  })
  await page.route('https://storage.example.test/upload-note.txt', async (route) => {
    expect(route.request().method()).toBe('PUT')
    expect(route.request().headers()['content-type']).toBe('text/plain')
    expect(route.request().headers()['x-amz-checksum-sha256']).toBe(Buffer.from(checksumSha256, 'hex').toString('base64'))
    expect(route.request().postDataBuffer()).toEqual(fileBody)
    storagePut = true
    await route.fulfill({ status: 200 })
  })
  await page.route('**/api/media/uploads/asset-uploaded-file/complete', async (route) => {
    expect(storagePut).toBe(true)
    expect(route.request().postDataJSON()).toEqual({ detectedContentType: 'text/plain' })
    completed = true
    await route.fulfill({ json: { data: { id: uploaded.id, status: 'uploaded' } } })
  })

  await page.goto('/')
  await page.getByTestId('nav-assets').click()
  await page.getByLabel('Upload asset').setInputFiles({ name: 'upload-note.txt', mimeType: 'text/plain', buffer: fileBody })
  await expect(page.getByRole('button', { name: /upload-note.txt/ })).toBeVisible()
  await page.getByRole('button', { name: /upload-note.txt/ }).click()
  await expect(page.getByText('pending / pending')).toBeVisible()
})
