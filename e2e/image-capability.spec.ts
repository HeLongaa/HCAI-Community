import { expect, test } from '@playwright/test'

import type { ApiUserCreativeGeneration } from '../src/services/contracts'
import { apiBaseUrl, authHeaders, login, signInPage } from './helpers'

test('Image Studio consumes the capability contract and sends only allowed parameters', async ({ page, request }) => {
  const session = await signInPage(page, request, 'promptlin')
  await page.goto('/')
  await page.getByRole('button', { name: 'AI Workspace' }).click()
  await page.getByRole('button', { name: 'Image', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Image Studio' })).toBeVisible()
  await expect(page.getByTestId('creative-cost-image')).toContainText('1 credits estimated')
  await expect(page.getByTestId('creative-cost-image')).toContainText('Provider cost: unavailable')
  await expect(page.getByRole('button', { name: 'Text to Image' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Image to Image' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Image Edit' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Image Variation' })).toBeEnabled()
  await expect(page.getByText(/image-capability-v1/)).toBeVisible()

  await page.getByRole('button', { name: 'Image to Image' }).click()
  await expect(page.getByText('Source image')).toBeVisible()
  await expect(page.getByText(/Change strength 70%/)).toBeVisible()
  await page.getByRole('button', { name: 'Text to Image' }).click()

  const generationResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/creative/generations') && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Generate images' }).click()
  const response = await generationResponse
  expect(response.ok()).toBeTruthy()
  const generationId = ((await response.json()) as { data: { id: string } }).data.id
  expect(response.request().postDataJSON()).toMatchObject({
    workspace: 'image',
    mode: 'text_to_image',
    providerId: 'mock',
    parameters: {
      aspectRatio: '1:1',
      stylePreset: 'none',
    },
  })
  expect(response.request().postDataJSON().parameters).not.toHaveProperty('controls')

  const historyRow = page.locator('.image-history-row').filter({ hasText: 'Minimal album cover' }).first()
  await expect(historyRow).toContainText('Completed')
  await expect(page.locator('.visual-grid .generated-result-card')).toHaveCount(1)
  await expect(page.locator('.visual-grid .visual-card')).toHaveCount(1)

  const detailResponse = await request.get(`${apiBaseUrl}/api/creative/generations/${generationId}`, {
    headers: authHeaders(session.accessToken),
  })
  expect(detailResponse.ok()).toBeTruthy()
  const detail = (await detailResponse.json()).data
  const assetId = detail.outputs[0].assetId as string

  await expect(page.getByTitle('Download output')).toBeDisabled()
  const operator = await login(request, 'opsplus')
  const scanResponse = await request.post(`${apiBaseUrl}/api/media/uploads/${assetId}/scan`, {
    headers: authHeaders(operator.accessToken),
    data: { decision: 'clean', detectedContentType: 'image/png', note: 'Image lifecycle E2E fixture' },
  })
  expect(scanResponse.ok()).toBeTruthy()
  await page.getByTitle('Refresh history').click()
  await expect(page.getByTitle('Download output')).toBeEnabled()

  const downloadResponse = page.waitForResponse((candidate) =>
    candidate.url().includes(`/api/media/assets/${assetId}/download`) && candidate.request().method() === 'GET',
  )
  await page.getByTitle('Download output').click()
  expect((await downloadResponse).ok()).toBeTruthy()

  await expect(page.getByRole('button', { name: 'Use result as source' })).toHaveCount(0)

  await page.reload()
  await page.getByRole('button', { name: 'AI Workspace' }).click()
  await page.getByRole('button', { name: 'Image', exact: true }).click()
  await expect(page.locator('.image-history-row').filter({ hasText: 'Minimal album cover' }).first()).toContainText('Completed')
  await expect(page.locator('.visual-grid .generated-result-card')).toBeVisible()
})

test('Image Studio renders active lifecycle controls and refresh-safe retry degradation', async ({ page, request }) => {
  await signInPage(page, request, 'promptlin')
  const generation: ApiUserCreativeGeneration = {
    id: 'generation-ui-lifecycle',
    workspace: 'image',
    mode: 'text_to_image',
    status: 'running',
    promptPreview: 'Lifecycle fixture image',
    inputAssetIds: [],
    parameterKeys: ['aspectRatio'],
    provider: { id: 'mock', mode: 'mock' },
    attempt: { number: 1, retryOfId: null },
    usage: { estimatedCredits: 1, metered: false },
    safety: { reviewRequired: false },
    error: null,
    outputs: [],
    actions: {
      poll: { available: true, reasonCode: null },
      cancel: { available: true, reasonCode: null },
      retry: { available: false, reasonCode: 'generation_status_running_not_retryable', userConfirmationRequired: true, requiresOriginalRequest: true },
      download: { available: false, reasonCode: 'no_clean_output' },
      reuse: { available: false, reasonCode: 'no_clean_image_output' },
    },
    startedAt: '2026-07-12T10:00:00.000Z',
    completedAt: null,
    failedAt: null,
    createdAt: '2026-07-12T09:59:00.000Z',
    updatedAt: '2026-07-12T10:00:00.000Z',
  }
  let current: ApiUserCreativeGeneration = generation
  const reusable: ApiUserCreativeGeneration = {
    ...generation,
    id: 'generation-ui-reusable',
    status: 'completed',
    promptPreview: 'Reusable lifecycle image',
    outputs: [{
      assetId: 'asset-ui-reusable',
      fileName: 'reusable.png',
      contentType: 'image/png',
      status: 'uploaded',
      scanStatus: 'clean',
      createdAt: '2026-07-12T09:58:00.000Z',
    }],
    actions: {
      poll: { available: false, reasonCode: 'generation_completed_is_terminal' },
      cancel: { available: false, reasonCode: 'generation_status_completed_not_cancellable' },
      retry: { available: false, reasonCode: 'generation_status_not_retryable', userConfirmationRequired: true, requiresOriginalRequest: true },
      download: { available: true, reasonCode: null },
      reuse: { available: true, reasonCode: null },
    },
    completedAt: '2026-07-12T10:00:00.000Z',
    createdAt: '2026-07-12T09:58:00.000Z',
    updatedAt: '2026-07-12T10:00:00.000Z',
  }

  await page.route('**/api/creative/generations?*', async (route) => {
    await route.fulfill({ json: { data: [current, reusable], meta: { pagination: { limit: 20, nextCursor: null } } } })
  })
  await page.route('**/api/creative/input-assets?*', async (route) => {
    await route.fulfill({
      json: {
        data: [{
          id: 'asset-ui-reusable',
          fileName: 'reusable.png',
          storageKey: 'hidden-from-history/reusable.png',
          contentType: 'image/png',
          sizeBytes: 128,
          purpose: 'library_asset',
          status: 'uploaded',
          metadata: { security: { scanStatus: 'clean' } },
          createdAt: '2026-07-12T09:58:00.000Z',
          updatedAt: '2026-07-12T10:00:00.000Z',
        }, {
          id: 'asset-ui-audio',
          fileName: 'soundtrack.mp3',
          storageKey: 'hidden-from-history/soundtrack.mp3',
          contentType: 'audio/mpeg',
          sizeBytes: 256,
          purpose: 'submission_asset',
          status: 'uploaded',
          metadata: { security: { scanStatus: 'clean' } },
          createdAt: '2026-07-12T09:57:00.000Z',
          updatedAt: '2026-07-12T10:00:00.000Z',
        }],
        meta: { pagination: { limit: 24, nextCursor: null } },
      },
    })
  })
  await page.route(`**/api/creative/generations/${generation.id}`, async (route) => {
    await route.fulfill({ json: { data: current } })
  })
  await page.route(`**/api/creative/generations/${generation.id}/cancel`, async (route) => {
    current = {
      ...current,
      status: 'cancelled',
      actions: {
        ...current.actions,
        poll: { available: false, reasonCode: 'generation_cancelled_is_terminal' },
        cancel: { available: false, reasonCode: 'generation_status_cancelled_not_cancellable' },
        retry: { available: true, reasonCode: null, userConfirmationRequired: true, requiresOriginalRequest: true },
      },
      updatedAt: '2026-07-12T10:01:00.000Z',
    }
    await route.fulfill({ json: { data: { duplicate: false } } })
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'AI Workspace' }).click()
  await page.getByRole('button', { name: 'Image', exact: true }).click()
  await expect(page.getByText('Running', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByText('Cancelled', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeDisabled()
  await expect(page.getByText(/Exact retry is unavailable after refresh/)).toBeVisible()
  await page.locator('.image-history-row').filter({ hasText: 'Reusable lifecycle image' }).click()
  await page.getByRole('button', { name: 'Use result as source' }).click()
  await expect(page.getByRole('button', { name: 'Image to Image' })).toHaveClass(/active/)
  await expect(page.getByLabel('Source image')).toHaveValue('asset-ui-reusable')
  await expect(page.getByLabel('Source image').locator('option[value="asset-ui-audio"]')).toHaveCount(0)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.image-generation-history')).toBeVisible()
  expect(await page.locator('.image-history-table').evaluate((element) => element.scrollWidth >= element.clientWidth)).toBe(true)
})
