import { expect, test } from '@playwright/test'

import type { ApiUserCreativeGeneration } from '../src/services/contracts'
import { signInPage } from './helpers'

const actionsFor = (status: string, outputReady = false): ApiUserCreativeGeneration['actions'] => ({
  poll: { available: status === 'queued' || status === 'running', reasonCode: null },
  cancel: { available: status === 'queued' || status === 'running', reasonCode: null },
  retry: { available: status === 'failed' || status === 'cancelled', reasonCode: null, userConfirmationRequired: true, requiresOriginalRequest: true },
  download: { available: outputReady, reasonCode: outputReady ? null : 'no_clean_output' },
  reuse: { available: outputReady, reasonCode: outputReady ? null : 'no_clean_output' },
})

const musicGeneration = ({
  id,
  status,
  prompt,
  mode = 'instrumental',
  output = null,
}: {
  id: string
  status: string
  prompt: string
  mode?: string
  output?: ApiUserCreativeGeneration['outputs'][number] | null
}): ApiUserCreativeGeneration => ({
  id,
  workspace: 'music',
  mode,
  status,
  promptPreview: prompt,
  inputAssetIds: [],
  parameterKeys: ['durationSeconds', 'genre', 'mood', 'tempoBpm', 'outputFormat'],
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

test('Music Studio submits capability parameters and keeps real Provider shells disabled', async ({ page, request }) => {
  await signInPage(page, request, 'promptlin')
  const created = musicGeneration({ id: 'music-created', status: 'completed', prompt: 'Late-night focus track' })
  let submitted: Record<string, unknown> | null = null

  await page.route('**/api/creative/generations?*', async (route) => {
    await route.fulfill({ json: { data: [], meta: { pagination: { limit: 20, nextCursor: null } } } })
  })
  await page.route('**/api/creative/generations/music-created', async (route) => {
    await route.fulfill({ json: { data: created } })
  })
  await page.route('**/api/creative/generations', async (route) => {
    submitted = route.request().postDataJSON()
    await route.fulfill({
      json: {
        data: {
          id: created.id,
          workspace: 'music',
          mode: 'instrumental',
          status: 'completed',
          provider: { id: 'mock', mode: 'mock', label: 'Mock Creative Provider' },
          outputs: [],
          usage: { estimatedCredits: 0, metered: false },
        },
      },
    })
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'AI Workspace' }).click()
  await expect(page.getByRole('heading', { name: 'Music Studio' })).toBeVisible()
  await expect(page.getByLabel('Music runtime')).toHaveValue('mock')
  await expect(page.locator('.runtime-badge', { hasText: 'Mock' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Instrumental' })).toBeEnabled()
  await expect(page.getByRole('tab', { name: 'Lyrics to Song' })).toBeEnabled()

  await page.getByLabel(/rights to this prompt/).check()
  await page.getByRole('button', { name: 'Generate music' }).click()
  await expect(page.locator('.music-history-row').filter({ hasText: 'Late-night focus track' })).toBeVisible()
  expect(submitted).toMatchObject({
    workspace: 'music',
    mode: 'instrumental',
    providerId: 'mock',
    inputAssetIds: [],
    parameters: {
      durationSeconds: 60,
      genre: 'lo_fi',
      mood: 'calm',
      tempoBpm: 100,
      outputFormat: 'mp3',
    },
  })

  await page.getByLabel('Music runtime').selectOption('elevenlabs-music-v2-enterprise')
  await expect(page.getByText('Fixture only', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Generate music' })).toBeDisabled()
})

test('Music Studio restores lifecycle, gates private audio, and submits lyrics safely', async ({ page, request }) => {
  await signInPage(page, request, 'promptlin')
  let running = musicGeneration({ id: 'music-running', status: 'running', prompt: 'Running music job' })
  const completed = musicGeneration({
    id: 'music-completed',
    status: 'completed',
    prompt: 'Completed private song',
    output: {
      assetId: 'music-clean-asset',
      fileName: 'private-song.mp3',
      contentType: 'audio/mpeg',
      status: 'uploaded',
      scanStatus: 'clean',
      createdAt: '2026-07-13T09:01:00.000Z',
    },
  })
  const lyricsCreated = musicGeneration({ id: 'music-lyrics-created', status: 'completed', prompt: 'Lyrics request', mode: 'lyrics_to_song' })
  let submitted: Record<string, unknown> | null = null

  await page.route('**/api/creative/generations?*', async (route) => {
    await route.fulfill({ json: { data: [running, completed], meta: { pagination: { limit: 20, nextCursor: null } } } })
  })
  await page.route('**/api/creative/generations/music-running/cancel', async (route) => {
    running = { ...running, status: 'cancelled', actions: actionsFor('cancelled'), updatedAt: '2026-07-13T09:02:00.000Z' }
    await route.fulfill({ json: { data: { duplicate: false } } })
  })
  await page.route('**/api/creative/generations/music-running', async (route) => {
    await route.fulfill({ json: { data: running } })
  })
  await page.route('**/api/creative/generations/music-lyrics-created', async (route) => {
    await route.fulfill({ json: { data: lyricsCreated } })
  })
  await page.route('**/api/creative/generations', async (route) => {
    submitted = route.request().postDataJSON()
    await route.fulfill({
      json: {
        data: {
          id: lyricsCreated.id,
          workspace: 'music',
          mode: 'lyrics_to_song',
          status: 'completed',
          provider: { id: 'mock', mode: 'mock', label: 'Mock Creative Provider' },
          outputs: [],
          usage: { estimatedCredits: 0, metered: false },
        },
      },
    })
  })
  await page.route('**/api/media/assets/music-clean-asset/download', async (route) => {
    await route.fulfill({
      json: {
        data: {
          asset: { id: 'music-clean-asset', fileName: 'private-song.mp3', contentType: 'audio/mpeg' },
          download: {
            method: 'GET',
            url: 'data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYwLjE2LjEwMAAAAAAAAAAAAAAA',
            headers: {},
            expiresAt: '2030-07-13T09:00:00.000Z',
          },
        },
      },
    })
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'AI Workspace' }).click()
  await expect(page.getByText('Running', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByText('Cancelled', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/Exact retry is unavailable after refresh/)).toBeVisible()

  await page.locator('.music-history-row').filter({ hasText: 'Completed private song' }).click()
  await page.getByRole('button', { name: 'Private player' }).click()
  await expect(page.getByTestId('private-music-player')).toBeVisible()
  await expect(page.getByTestId('private-music-player')).toHaveAttribute('src', /^data:audio\/mpeg/)

  await page.getByRole('tab', { name: 'Lyrics to Song' }).click()
  await page.getByLabel('Song lyrics').fill('City lights fade while the morning starts')
  await page.getByLabel(/rights to this prompt/).check()
  await page.getByRole('button', { name: 'Generate music' }).click()
  expect(submitted).toMatchObject({
    workspace: 'music',
    mode: 'lyrics_to_song',
    inputAssetIds: [],
    parameters: {
      lyrics: 'City lights fade while the morning starts',
      language: 'en',
      outputFormat: 'mp3',
    },
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.video-workbench')).toBeVisible()
  await expect(page.locator('.video-history-table')).toBeVisible()
  expect(await page.locator('.video-history-table').evaluate((element) => element.scrollWidth >= element.clientWidth)).toBe(true)
})
