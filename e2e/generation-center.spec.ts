import { expect, test } from '@playwright/test'

import type { ApiGenerationTask } from '../src/services/contracts'
import { signInPage } from './helpers'

const actions = (overrides: Partial<ApiGenerationTask['actions']> = {}): ApiGenerationTask['actions'] => ({
  view: { available: true, reasonCode: null },
  cancel: { available: false, reasonCode: 'generation_status_completed_not_cancellable' },
  retry: { available: false, reasonCode: 'generation_status_completed_not_retryable', requiresOriginalRequest: true },
  download: { available: false, reasonCode: 'no_clean_output' },
  reuse: { available: false, reasonCode: 'no_clean_supported_image_output' },
  ...overrides,
})

const task = (overrides: Partial<ApiGenerationTask> & Pick<ApiGenerationTask, 'id' | 'workspace' | 'status'>): ApiGenerationTask => ({
  id: overrides.id,
  workspace: overrides.workspace,
  mode: overrides.workspace === 'chat' ? 'assistant' : 'text_to_generation',
  status: overrides.status,
  summary: overrides.workspace === 'chat' ? null : `${overrides.workspace} generation task`,
  attempt: { number: 1, retryOfId: null },
  usage: { estimatedCredits: 2, metered: true },
  review: { required: false },
  error: null,
  outputs: [],
  actions: actions(),
  deepLink: { page: 'playground', workspace: overrides.workspace },
  startedAt: '2026-07-13T10:00:00.000Z',
  completedAt: null,
  failedAt: null,
  createdAt: '2026-07-13T09:59:00.000Z',
  updatedAt: '2026-07-13T10:00:00.000Z',
  ...overrides,
})

test('generation center filters, paginates, inspects, and cancels owner tasks', async ({ page, request }) => {
  await signInPage(page, request, 'promptlin')
  let running = task({
    id: 'center-running-image',
    workspace: 'image',
    status: 'running',
    actions: actions({ cancel: { available: true, reasonCode: null } }),
  })
  const music = task({
    id: 'center-completed-music',
    workspace: 'music',
    status: 'completed',
    outputs: [{
      assetId: 'center-music-asset',
      fileName: 'focus-track.mp3',
      contentType: 'audio/mpeg',
      status: 'uploaded',
      scanStatus: 'clean',
      lineage: [],
      reuse: null,
      createdAt: '2026-07-13T10:00:00.000Z',
    }],
    actions: actions({ download: { available: true, reasonCode: null } }),
  })
  const chat = task({
    id: 'center-chat',
    workspace: 'chat',
    status: 'failed',
    error: { code: 'CHAT_PROVIDER_TIMEOUT', message: 'The response timed out.' },
    actions: actions({ retry: { available: true, reasonCode: null, requiresOriginalRequest: true } }),
  })
  const queryLog: URLSearchParams[] = []

  await page.route('**/api/creative/generation-center/center-running-image', async (route) => {
    await route.fulfill({ json: { data: running } })
  })
  await page.route('**/api/creative/generation-center/summary?*', async (route) => {
    await route.fulfill({ json: { data: { total: 3, active: 1, failed: 1, reviewRequired: 0, outputAssets: 1, byStatus: {}, byWorkspace: {} } } })
  })
  await page.route('**/api/creative/generation-center/export?*', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ kind: 'creative.generation-center.export', schemaVersion: 1, items: [running, music, chat] }) })
  })
  await page.route('**/api/creative/generations/center-running-image/cancel', async (route) => {
    running = {
      ...running,
      status: 'cancelled',
      actions: actions({ retry: { available: true, reasonCode: null, requiresOriginalRequest: true } }),
      updatedAt: '2026-07-13T10:03:00.000Z',
    }
    await route.fulfill({ json: { data: { duplicate: false } } })
  })
  await page.route('**/api/creative/generation-center?*', async (route) => {
    const params = new URL(route.request().url()).searchParams
    queryLog.push(params)
    if (params.get('workspace') === 'chat') {
      await route.fulfill({ json: { data: [chat], meta: { pagination: { limit: 20, nextCursor: null } } } })
      return
    }
    if (params.get('cursor') === 'page-2') {
      await route.fulfill({ json: { data: [chat], meta: { pagination: { limit: 20, nextCursor: null } } } })
      return
    }
    await route.fulfill({ json: { data: [running, music], meta: { pagination: { limit: 20, nextCursor: 'page-2' } } } })
  })

  await page.goto('/')
  await page.getByTestId('nav-generations').click()
  await expect(page.getByRole('heading', { name: 'Generations' })).toBeVisible()
  await expect(page.getByTestId('generation-task-center-running-image')).toBeVisible()
  await expect(page.getByLabel('Generation summary').getByText('3', { exact: true })).toBeVisible()
  await expect(page.getByText('private-provider-id')).toHaveCount(0)

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export generation history' }).click()
  expect((await download).suggestedFilename()).toContain('generation-center-')

  await page.getByRole('button', { name: 'Load more' }).click()
  await expect(page.getByTestId('generation-task-center-chat')).toBeVisible()

  await page.getByTestId('generation-task-center-running-image').click()
  await expect(page.getByRole('heading', { name: 'image generation task' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByText('cancelled', { exact: true }).first()).toBeVisible()
  await expect(page.getByTestId('generation-task-center-running-image').getByText('cancelled', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()

  await page.getByLabel('Workspace filter').selectOption('chat')
  await expect(page.getByTestId('generation-task-center-chat')).toBeVisible()
  await expect(page.getByText('Protected task content')).toBeVisible()
  await expect(page.getByText('The response timed out.')).toBeVisible()
  await expect(page.getByText('chat generation task')).toHaveCount(0)

  await page.getByLabel('Start date').fill('2026-07-01')
  await page.getByLabel('End date').fill('2026-07-13')
  await page.getByLabel('Generation sort').selectOption('status')
  await page.getByRole('button', { name: 'Sort descending' }).click()
  await expect.poll(() => queryLog.some((params) =>
    params.get('workspace') === 'chat' &&
    params.get('dateFrom') === '2026-07-01T00:00:00.000Z' &&
    params.get('dateTo') === '2026-07-13T23:59:59.999Z' &&
    params.get('sort') === 'status' &&
    params.get('direction') === 'asc')).toBe(true)

  await page.goto('/#generations/center-running-image')
  await page.reload()
  await expect(page.getByTestId('generation-center')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'image generation task' })).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  const collapsePlayer = page.getByRole('button', { name: 'Collapse player' })
  if (await collapsePlayer.isVisible()) await collapsePlayer.click()
  await expect(page.getByTestId('generation-center')).toBeVisible()
  const taskList = page.locator('.generation-task-list')
  expect(await taskList.evaluate((element) => element.scrollWidth >= element.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: '/tmp/ai-core-02-generation-center-mobile.png', fullPage: true })
})
