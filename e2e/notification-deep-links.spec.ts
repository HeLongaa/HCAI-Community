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
  const popover = page.locator('.notification-popover')
  await expect(popover).not.toContainText('creative.provider_lifecycle.completed')
  await expect(popover.getByRole('button', { name: 'Refresh notifications' })).toBeVisible()
  await expect(popover.getByRole('button', { name: 'Mark all as read' })).toBeVisible()
  const popoverMetrics = await popover.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const actions = [...element.querySelectorAll<HTMLElement>('.notification-popover-actions button')]
      .map((button) => button.getBoundingClientRect())
    return {
      width: box.width,
      actionTops: actions.map((action) => Math.round(action.top)),
    }
  })
  expect(popoverMetrics.width).toBeLessThanOrEqual(380)
  expect(new Set(popoverMetrics.actionTops).size).toBe(1)
  await page.getByRole('button', { name: /^Video ready/ }).click()
  await expect(page).toHaveURL(/#generations\/notification-generation$/)
  await expect(page.getByRole('heading', { name: 'Notification video' })).toBeVisible()

  await page.reload()
  await expect(page).toHaveURL(/#generations\/notification-generation$/)
  await expect(page.getByRole('heading', { name: 'Notification video' })).toBeVisible()
})

test('notification popover remains compact and bounded on mobile', async ({ page, request }) => {
  await signInPage(page, request, 'promptlin')
  const notifications = Array.from({ length: 7 }, (_, index) => ({
    ...notification,
    id: `${notification.id}-${index}`,
    title: index === 0 ? 'Task dispute approved: E2E dispute recovery 1785835561859' : notification.title,
    body: index === 0 ? 'E2E dispute recovery 1785835561859 was reopened for a revised submission.' : notification.body,
  }))
  await page.route('**/api/notifications?*', async (route) => route.fulfill({ json: { data: notifications, meta: { pagination: { limit: 8, nextCursor: null } } } }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#assets')
  await page.locator('.notification-trigger').click()

  const popover = page.locator('.notification-popover')
  await expect(popover).toBeVisible()
  const metrics = await popover.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const actionTops = [...element.querySelectorAll<HTMLElement>('.notification-popover-actions button')]
      .map((button) => Math.round(button.getBoundingClientRect().top))
    return {
      left: box.left,
      right: box.right,
      width: box.width,
      viewportWidth: window.innerWidth,
      overflow: element.scrollWidth - element.clientWidth,
      actionRows: new Set(actionTops).size,
    }
  })
  expect(metrics.left).toBeGreaterThanOrEqual(12)
  expect(metrics.right).toBeLessThanOrEqual(metrics.viewportWidth - 12)
  expect(metrics.width).toBeLessThanOrEqual(366)
  expect(metrics.overflow).toBeLessThanOrEqual(0)
  expect(metrics.actionRows).toBe(1)
  const itemClipping = await popover.locator('.notification-item').evaluateAll((items) => items.map((item) => ({
    clientHeight: item.clientHeight,
    scrollHeight: item.scrollHeight,
  })))
  expect(itemClipping.every((item) => item.scrollHeight <= item.clientHeight)).toBe(true)
})
