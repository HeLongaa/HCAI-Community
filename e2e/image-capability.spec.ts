import { expect, test } from '@playwright/test'

import type { ApiUserCreativeGeneration } from '../src/services/contracts'
import { apiBaseUrl, authHeaders, login, signInPage } from './helpers'

test('Image Studio prefers an operational real Provider over a Mock default', async ({ page, request }) => {
  await signInPage(page, request, 'promptlin')
  const modeContract = {
    id: 'text_to_image',
    label: 'Text to Image',
    runtimeAvailable: true,
    available: true,
    unavailableReason: null,
    inputAssets: { minimum: 0, maximum: 0, purposes: [], contentTypes: [] },
    parameters: ['aspectRatio'],
  }
  const capability = {
    workspace: 'image',
    label: 'Image',
    contractVersion: 'image-capability-v1',
    modes: ['text_to_image'],
    modeContracts: [modeContract],
    inputAssetPurposes: [],
    outputTypes: ['image'],
    maxPromptCharacters: 2000,
    supportedParameters: ['aspectRatio'],
  }
  await page.route('**/api/creative/providers', async (route) => {
    await route.fulfill({
      json: {
        data: {
          defaultProviderId: 'mock',
          providers: [
            { id: 'mock', label: 'Mock Creative Provider', mode: 'mock', enabled: true, configured: true, default: true, capabilities: [capability], safeMetadata: {} },
            { id: 'real-image', label: 'Real Image Provider', mode: 'openai_image', enabled: true, configured: true, default: false, capabilities: [capability], safeMetadata: {} },
          ],
        },
      },
    })
  })

  await page.goto('/#playground?workspace=image')
  const providerSummary = page.locator('.image-provider-summary')
  await expect(providerSummary).toContainText('Real Image Provider')
  await expect(providerSummary).not.toContainText('Mock Creative Provider')
  await expect(page.getByRole('button', { name: 'Generate images' })).toBeEnabled()
})

test('Image Studio consumes the capability contract and sends only allowed parameters', async ({ page, request }) => {
  const session = await signInPage(page, request, 'promptlin')
  let generationAttempts = 0
  await page.route('**/api/creative/generations', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    generationAttempts += 1
    if (generationAttempts === 1) {
      await route.fulfill({ status: 503, json: { error: { code: 'IMAGE_PROVIDER_UNAVAILABLE', message: 'Image generation is temporarily unavailable.' } } })
      return
    }
    await route.continue()
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'AI Workspace' }).click()
  await page.getByRole('button', { name: 'Image', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Image Studio' })).toBeVisible()
  await expect(page.getByTestId('creative-cost-image')).toContainText('1 credits estimated')
  await expect(page.getByTestId('creative-cost-image')).toContainText('Provider cost: unavailable')
  await expect(page.getByRole('button', { name: 'Text to Image', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Image to Image', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Image Edit', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Image Variation', exact: true })).toBeEnabled()
  await expect(page.getByText(/image-capability-v1/)).toBeVisible()

  await page.getByRole('button', { name: 'Image to Image', exact: true }).click()
  await expect(page.getByText('Source image')).toBeVisible()
  await expect(page.getByText(/Change strength 70%/)).toBeVisible()
  await page.locator('.media-file-picker input[type="file"]').setInputFiles({ name: 'studio-reference.png', mimeType: 'image/png', buffer: Buffer.from('image studio reference') })
  await expect(page.locator('.generation-operation-feedback')).toContainText('Image uploaded.')
  await expect(page.getByTestId('app-toast')).toHaveCount(0)
  await page.getByRole('button', { name: 'Text to Image', exact: true }).click()
  await page.getByLabel('Image quality').selectOption('high')

  const generateButton = page.getByRole('button', { name: 'Generate images' })
  await generateButton.click()
  await expect(page.getByRole('status', { name: 'Image generation status' })).toContainText('Image generation is temporarily unavailable.')
  await expect(page.getByRole('textbox', { name: 'Image prompt' })).toHaveValue('Minimal album cover, chrome flower, cinematic lighting, black background')
  await expect(page.getByTestId('app-toast')).toHaveCount(0)

  const generationResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/creative/generations') && response.request().method() === 'POST',
  )
  await generateButton.focus()
  await page.keyboard.press('Enter')
  const response = await generationResponse
  expect(response.ok()).toBeTruthy()
  expect(generationAttempts).toBe(2)
  const generationId = ((await response.json()) as { data: { id: string } }).data.id
  await expect(page.locator('.generation-operation-feedback')).toContainText(/Image generation complete|Image job created/)
  await expect(page.getByTestId('app-toast')).toHaveCount(0)
  expect(response.request().postDataJSON()).toMatchObject({
    workspace: 'image',
    mode: 'text_to_image',
    providerId: 'mock',
    parameters: {
      aspectRatio: '1:1',
      stylePreset: 'none',
      quality: 'high',
    },
  })
  expect(response.request().postDataJSON().parameters).not.toHaveProperty('controls')

  await page.getByRole('button', { name: 'History', exact: true }).click()
  const historyRow = page.locator('.image-history-row').filter({ hasText: 'Minimal album cover' }).first()
  await expect(historyRow).toContainText('Completed')
  await historyRow.click()
  await expect(page.locator('.visual-grid .generated-result-card')).toHaveCount(1)
  await expect(page.locator('.visual-grid .visual-card')).toHaveCount(1)

  const detailResponse = await request.get(`${apiBaseUrl}/api/creative/generations/${generationId}`, {
    headers: authHeaders(session.accessToken),
  })
  expect(detailResponse.ok()).toBeTruthy()
  const detail = (await detailResponse.json()).data
  const assetId = detail.outputs[0].assetId as string

  await expect(page.getByTestId('image-preview-checking')).toBeVisible()
  await expect(page.getByText('Output checks in progress', { exact: true })).toBeVisible()
  await expect(page.getByText('Preview and download become available after safety checks.')).toBeVisible()
  await expect(page.getByTestId('generated-image-preview')).toHaveCount(0)
  await expect(page.getByTitle('Download output')).toBeDisabled()
  const operator = await login(request, 'opsplus')
  const scanResponse = await request.post(`${apiBaseUrl}/api/media/uploads/${assetId}/scan`, {
    headers: authHeaders(operator.accessToken),
    data: { decision: 'clean', detectedContentType: 'image/png', note: 'Image lifecycle E2E fixture' },
  })
  expect(scanResponse.ok()).toBeTruthy()
  const governedPreviewUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  await page.route(`**/api/media/assets/${assetId}/download`, async (route) => {
    await route.fulfill({
      json: {
        data: {
          asset: { id: assetId, fileName: 'generated.png' },
          download: { method: 'GET', url: governedPreviewUrl, headers: {}, expiresAt: '2026-07-12T11:00:00.000Z' },
        },
      },
    })
  })
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await page.getByTitle('Refresh history').click()
  await page.locator('.image-history-row').filter({ hasText: 'Minimal album cover' }).first().click()
  await expect(page.getByTestId('generated-image-preview')).toBeVisible()
  await expect(page.getByTestId('generated-image-preview')).toHaveAttribute('src', governedPreviewUrl)
  await expect(page.getByTitle('Download output')).toBeEnabled()

  const downloadResponse = page.waitForResponse((candidate) =>
    candidate.url().includes(`/api/media/assets/${assetId}/download`) && candidate.request().method() === 'GET',
  )
  await page.getByTitle('Download output').click()
  expect((await downloadResponse).ok()).toBeTruthy()
  await expect(page.locator('.generation-operation-feedback')).toContainText(/Download contract ready|Download started/)
  await expect(page.getByTestId('app-toast')).toHaveCount(0)

  await expect(page.getByRole('button', { name: 'Use result as source' })).toHaveCount(0)

  await page.reload()
  await page.getByRole('button', { name: 'AI Workspace' }).click()
  await page.getByRole('button', { name: 'Image', exact: true }).click()
  await page.getByRole('button', { name: 'History', exact: true }).click()
  const restoredHistoryRow = page.locator('.image-history-row').filter({ hasText: 'Minimal album cover' }).first()
  await expect(restoredHistoryRow).toContainText('Completed')
  await restoredHistoryRow.click()
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
    accounting: {
      policyVersion: 'creative-accounting-v1',
      legacy: false,
      quotaUnits: 1,
      providerCost: {
        availability: 'available',
        ledgerStatus: 'settled',
        estimateAmount: 0.053,
        actualAmount: 0.041,
        currency: 'USD',
        reasonCode: null,
      },
    },
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
  await expect(page.locator('.generation-operation-feedback')).toContainText('Image job cancelled.')
  await expect(page.getByTestId('app-toast')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeDisabled()
  await expect(page.getByText(/Exact retry is unavailable after refresh/)).toBeVisible()
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await page.locator('.image-history-row').filter({ hasText: 'Reusable lifecycle image' }).click()
  await page.getByText('Technical details', { exact: true }).click()
  await expect(page.getByText('Provider cost USD 0.041000')).toBeVisible()
  await page.getByRole('button', { name: 'Use result as source' }).click()
  await expect(page.getByRole('button', { name: 'Image to Image', exact: true })).toHaveClass(/active/)
  await expect(page.getByLabel('Source image')).toHaveValue('asset-ui-reusable')
  await expect(page.getByLabel('Source image').locator('option[value="asset-ui-audio"]')).toHaveCount(0)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('textbox', { name: 'Image prompt' })).toBeVisible()
  await expect(page.getByLabel('Image quality')).toBeVisible()
  await expect(page.getByRole('status', { name: 'Image generation status' })).toHaveAttribute('aria-live', 'polite')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  for (const selector of ['.composer', '.provider-status-panel']) {
    const box = await page.locator(selector).boundingBox()
    expect(box, `${selector} must have layout bounds`).not.toBeNull()
    expect(box!.x, `${selector} starts inside viewport`).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width, `${selector} ends inside viewport`).toBeLessThanOrEqual(390.5)
  }
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await expect(page.locator('.image-generation-history')).toBeVisible()
  const historyBox = await page.locator('.image-generation-history').boundingBox()
  expect(historyBox, '.image-generation-history must have layout bounds').not.toBeNull()
  expect(historyBox!.x, '.image-generation-history starts inside viewport').toBeGreaterThanOrEqual(0)
  expect(historyBox!.x + historyBox!.width, '.image-generation-history ends inside viewport').toBeLessThanOrEqual(390.5)
  expect(await page.locator('.image-history-table').evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
})
