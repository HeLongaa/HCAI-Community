import { expect, test } from '@playwright/test'
import type { ApiGenerationTask, ApiNotification } from '../src/services/contracts'
import { signInPage } from './helpers'

const generation: ApiGenerationTask = {
  id: 'notification-generation', workspace: 'video', mode: 'text_to_video', status: 'completed', summary: 'Notification video',
  attempt: { number: 1, retryOfId: null }, usage: { estimatedCredits: 3, metered: true }, review: { required: false }, error: null, outputs: [],
  actions: { view: { available: true, reasonCode: null }, cancel: { available: false, reasonCode: 'completed' }, retry: { available: false, reasonCode: 'no_request', requiresOriginalRequest: true }, download: { available: false, reasonCode: 'no_output' }, reuse: { available: false, reasonCode: 'no_output' } },
  deepLink: { page: 'playground', workspace: 'video' }, startedAt: null, completedAt: '2026-07-14T01:00:00.000Z', failedAt: null,
  createdAt: '2026-07-14T00:59:00.000Z', updatedAt: '2026-07-14T01:00:00.000Z',
}

const notification: ApiNotification = {
  id: 'notification-1', type: 'creative.provider_lifecycle.completed', title: 'Video ready', body: 'Open the completed video generation.',
  resourceType: 'creative_generation', resourceId: generation.id, readAt: null, createdAt: '2026-07-14T01:00:00.000Z',
  metadata: { target: { version: 1, surface: 'generations', intent: 'view', fallbackSurface: 'generations', workspace: 'video', generationId: generation.id } },
}

test('notification target survives refresh and reopens the owner-scoped generation', async ({ page, request }) => {
  await signInPage(page, request, 'promptlin')
  await page.route('**/api/notifications?*', async (route) => route.fulfill({ json: { data: [notification], meta: { pagination: { limit: 8, nextCursor: null } } } }))
  await page.route(`**/api/creative/generation-center/${generation.id}`, async (route) => route.fulfill({ json: { data: generation } }))
  await page.route('**/api/creative/generation-center?*', async (route) => route.fulfill({ json: { data: [generation], meta: { pagination: { limit: 20, nextCursor: null } } } }))

  await page.goto('/')
  await page.locator('.notification-trigger').click()
  await expect(page.getByText('Video ready')).toBeVisible()
  await page.getByRole('button', { name: /Video ready/ }).click()
  await expect(page).toHaveURL(/#generations\/notification-generation$/)
  await expect(page.getByRole('heading', { name: 'Notification video' })).toBeVisible()

  await page.reload()
  await expect(page).toHaveURL(/#generations\/notification-generation$/)
  await expect(page.getByRole('heading', { name: 'Notification video' })).toBeVisible()
})
