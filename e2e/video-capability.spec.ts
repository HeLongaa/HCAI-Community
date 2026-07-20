import { expect, test } from '@playwright/test'

import type { ApiUserCreativeGeneration } from '../src/services/contracts'
import { signInPage } from './helpers'

const actionsFor = (status: string, outputReady = false): ApiUserCreativeGeneration['actions'] => ({
  poll: { available: status === 'queued' || status === 'running', reasonCode: null },
  cancel: { available: status === 'queued' || status === 'running', reasonCode: null },
  retry: { available: status === 'failed' || status === 'cancelled', reasonCode: null, userConfirmationRequired: true, requiresOriginalRequest: true },
  download: { available: outputReady, reasonCode: outputReady ? null : 'no_clean_output' },
  reuse: { available: false, reasonCode: 'video_output_not_reusable' },
})

const videoGeneration = ({
  id,
  status,
  prompt,
  output = null,
}: {
  id: string
  status: string
  prompt: string
  output?: ApiUserCreativeGeneration['outputs'][number] | null
}): ApiUserCreativeGeneration => ({
  id,
  workspace: 'video',
  mode: 'text_to_video',
  status,
  promptPreview: prompt,
  inputAssetIds: [],
  parameterKeys: ['aspectRatio', 'durationSeconds', 'motionPreset', 'outputFormat'],
  provider: { id: 'mock', mode: 'mock' },
  attempt: { number: 1, retryOfId: null },
  usage: { estimatedCredits: 0, metered: false },
  safety: { reviewRequired: false },
  error: null,
  outputs: output ? [output] : [],
  actions: actionsFor(status, output?.scanStatus === 'clean'),
  startedAt: '2026-07-13T09:00:00.000Z',
  completedAt: status === 'completed' ? '2026-07-13T09:01:00.000Z' : null,
  failedAt: null,
  createdAt: '2026-07-13T08:59:00.000Z',
  updatedAt: '2026-07-13T09:00:00.000Z',
})

test('Video Studio uses capability parameters and labels disabled Provider shells', async ({ page, request }) => {
  await signInPage(page, request, 'promptlin')
  await page.goto('/')
  await page.getByRole('button', { name: 'AI Workspace' }).click()
  await page.getByRole('button', { name: 'Video', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Video Studio' })).toBeVisible()
  await expect(page.getByTestId('creative-cost-video')).toContainText('8 credits estimated')
  await expect(page.getByLabel('Video runtime')).toHaveValue('mock')
  await expect(page.locator('.runtime-badge', { hasText: 'Mock' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Text to Video' })).toBeEnabled()
  await expect(page.getByRole('tab', { name: 'Image to Video' })).toBeEnabled()
  await expect(page.getByRole('tab', { name: 'Music Video' })).toBeEnabled()

  await page.getByLabel(/rights and consent required/).check()
  const generationResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/creative/generations') && response.request().method() === 'POST',
  )
  const generateButton = page.getByRole('button', { name: 'Generate video' })
  await generateButton.focus()
  await page.keyboard.press('Enter')
  const response = await generationResponse
  expect(response.ok()).toBeTruthy()
  expect(response.request().postDataJSON()).toMatchObject({
    workspace: 'video',
    mode: 'text_to_video',
    providerId: 'mock',
    inputAssetIds: [],
    parameters: {
      aspectRatio: '16:9',
      durationSeconds: 8,
      motionPreset: 'cinematic',
      outputFormat: 'mp4',
    },
  })
  await expect(page.locator('.video-history-row').filter({ hasText: 'quiet train' }).first()).toContainText('Completed')
  await page.getByRole('button', { name: 'Private preview' }).click()
  await expect(page.getByText(/Mock results contain a governed placeholder artifact/)).toBeVisible()

  await page.getByLabel('Video runtime').selectOption('google-veo-3-1-fast')
  await expect(page.getByText('Fixture only', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Generate video' })).toBeDisabled()
  await expect(page.getByRole('tab', { name: 'Music Video' })).toBeDisabled()

  await page.getByLabel('Video runtime').selectOption('runway-gen-4-5')
  await expect(page.getByText('Unavailable', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Generate video' })).toBeDisabled()
})

test('Video Studio preserves input roles and handles lifecycle, private preview, and mobile layout', async ({ page, request }) => {
  await signInPage(page, request, 'promptlin')
  let running = videoGeneration({ id: 'video-running', status: 'running', prompt: 'Running city video' })
  const completed = videoGeneration({
    id: 'video-completed',
    status: 'completed',
    prompt: 'Completed private video',
    output: {
      assetId: 'video-clean-asset',
      fileName: 'private-video.mp4',
      contentType: 'video/mp4',
      status: 'uploaded',
      scanStatus: 'clean',
      createdAt: '2026-07-13T09:01:00.000Z',
    },
  })
  const generated = videoGeneration({ id: 'video-music-created', status: 'completed', prompt: 'Music video request' })

  await page.route('**/api/creative/generations?*', async (route) => {
    await route.fulfill({ json: { data: [running, completed], meta: { pagination: { limit: 20, nextCursor: null } } } })
  })
  await page.route('**/api/creative/input-assets?*', async (route) => {
    await route.fulfill({
      json: {
        data: [
          {
            id: 'audio-clean',
            fileName: 'soundtrack.mp3',
            storageKey: 'private/audio-clean',
            contentType: 'audio/mpeg',
            sizeBytes: 256,
            purpose: 'submission_asset',
            status: 'uploaded',
            metadata: { security: { scanStatus: 'clean' } },
            createdAt: '2026-07-13T08:00:00.000Z',
            updatedAt: '2026-07-13T08:00:00.000Z',
          },
          {
            id: 'image-clean',
            fileName: 'reference.png',
            storageKey: 'private/image-clean',
            contentType: 'image/png',
            sizeBytes: 128,
            purpose: 'submission_asset',
            status: 'uploaded',
            metadata: { security: { scanStatus: 'clean' } },
            createdAt: '2026-07-13T08:00:00.000Z',
            updatedAt: '2026-07-13T08:00:00.000Z',
          },
        ],
        meta: { pagination: { limit: 24, nextCursor: null } },
      },
    })
  })
  await page.route('**/api/creative/generations/video-running/cancel', async (route) => {
    running = {
      ...running,
      status: 'cancelled',
      actions: actionsFor('cancelled'),
      updatedAt: '2026-07-13T09:02:00.000Z',
    }
    await route.fulfill({ json: { data: { duplicate: false } } })
  })
  await page.route('**/api/creative/generations/video-running', async (route) => {
    await route.fulfill({ json: { data: running } })
  })
  await page.route('**/api/creative/generations/video-music-created', async (route) => {
    await route.fulfill({ json: { data: generated } })
  })
  await page.route('**/api/creative/generations', async (route) => {
    await route.fulfill({
      json: {
        data: {
          id: generated.id,
          workspace: 'video',
          mode: 'music_video',
          status: 'completed',
          provider: { id: 'mock', mode: 'mock', label: 'Mock Creative Provider' },
          outputs: [],
          usage: { estimatedCredits: 0, metered: false },
        },
      },
    })
  })
  await page.route('**/api/media/assets/video-clean-asset/download', async (route) => {
    await route.fulfill({
      json: {
        data: {
          asset: { id: 'video-clean-asset', fileName: 'private-video.mp4', contentType: 'video/mp4' },
          download: {
            method: 'GET',
            url: 'data:video/mp4;base64,AAAAHGZ0eXBtcDQyAAAAAG1wNDJpc29tAAAAA2ZyZWU=',
            headers: {},
            expiresAt: '2030-07-13T09:00:00.000Z',
          },
        },
      },
    })
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'AI Workspace' }).click()
  await page.getByRole('button', { name: 'Video', exact: true }).click()
  await expect(page.getByText('Running', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByText('Cancelled', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/Exact retry is unavailable after refresh/)).toBeVisible()

  await page.locator('.video-history-row').filter({ hasText: 'Completed private video' }).click()
  await page.getByRole('button', { name: 'Private preview' }).click()
  await expect(page.getByTestId('private-video-preview')).toBeVisible()
  await expect(page.getByTestId('private-video-preview')).toHaveAttribute('src', /^data:video\/mp4/)
  await expect(page.getByTestId('private-video-preview')).toHaveAccessibleName('Private video preview')
  await expect(page.getByRole('button', { name: 'Download output' })).toBeEnabled()

  await page.getByRole('tab', { name: 'Music Video' }).click()
  await page.getByLabel('Reference image (optional)').selectOption('image-clean')
  await page.getByLabel(/rights and consent required/).check()
  await expect(page.getByRole('button', { name: 'Generate video' })).toBeDisabled()
  await page.getByLabel('Audio track').selectOption('audio-clean')
  await expect(page.getByRole('button', { name: 'Generate video' })).toBeEnabled()
  const creation = page.waitForRequest((candidate) => candidate.url().endsWith('/api/creative/generations') && candidate.method() === 'POST')
  await page.getByRole('button', { name: 'Generate video' }).click()
  const requestBody = (await creation).postDataJSON()
  expect(requestBody).toMatchObject({
    workspace: 'video',
    mode: 'music_video',
    providerId: 'mock',
    inputAssetIds: ['audio-clean', 'image-clean'],
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.video-workbench')).toBeVisible()
  await expect(page.getByRole('status', { name: 'Video generation status' })).toHaveAttribute('aria-live', 'polite')
  await expect(page.locator('.video-history-table')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  for (const selector of ['.video-controls', '.video-preview-panel', '.video-history']) {
    const box = await page.locator(selector).boundingBox()
    expect(box, `${selector} must have layout bounds`).not.toBeNull()
    expect(box!.x, `${selector} starts inside viewport`).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width, `${selector} ends inside viewport`).toBeLessThanOrEqual(390.5)
  }
  expect(await page.locator('.video-history-table').evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
})
