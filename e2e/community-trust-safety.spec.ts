import { expect, test } from '@playwright/test'
import { apiBaseUrl, apiData, authHeaders, login, signInPage } from './helpers'

test('community UI reports a post and independent appeal review restores public visibility', async ({ page, request }) => {
  const owner = await login(request, 'taskops')
  const reporter = await login(request, 'promptlin')
  const reviewer = await login(request, 'legalpixel')
  const appealReviewer = await login(request, 'opsplus')
  const title = `COMM-02 browser lifecycle ${Date.now()}`
  const post = await apiData<{ id: string }>(request.post(`${apiBaseUrl}/api/posts`, {
    headers: authHeaders(owner.accessToken),
    data: { title, body: 'A public community post for browser-level moderation lifecycle validation.', category: 'Questions', tag: 'Safety', excerpt: 'Browser moderation target.' },
  }))

  await signInPage(page, request, 'promptlin')
  await page.goto('/')
  await page.getByTestId('nav-community').click()
  await page.getByRole('button', { name: 'Latest', exact: true }).click()
  const topic = page.getByTestId(`community-topic-${post.id}`)
  await expect(topic).toBeVisible()
  await topic.locator('.topic-title-button').click()
  await page.getByTestId(`community-report-post-${post.id}`).click()
  await page.getByLabel('Community report category').selectOption('harassment')
  await page.getByLabel('Community report statement').fill('This community post requires a real Trust and Safety review from the browser workflow.')
  const reportResponse = page.waitForResponse((response) => response.url().endsWith('/api/trust/reports') && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Submit report' }).click()
  expect((await reportResponse).ok()).toBeTruthy()
  await expect(page.getByTestId('community-report-case-id')).toContainText('Case:')

  const cases = await apiData<Array<{ id: string; targetId: string; version: number }>>(request.get(`${apiBaseUrl}/api/trust/cases?targetType=post&limit=100`, { headers: authHeaders(reporter.accessToken) }))
  const moderationCase = cases.find((item) => item.targetId === post.id)
  expect(moderationCase).toBeTruthy()
  const removed = await apiData<{ version: number; communityActions: Array<{ action: string }> }>(request.post(`${apiBaseUrl}/api/admin/trust/cases/${moderationCase!.id}/decisions`, {
    headers: authHeaders(reviewer.accessToken),
    data: { stage: 'original', outcome: 'remove_content', reasonCode: 'community_browser_remove', note: 'Browser regression confirms this content should be hidden.', expectedVersion: moderationCase!.version },
  }))
  expect(removed.communityActions.at(-1)?.action).toBe('hide')
  expect((await request.get(`${apiBaseUrl}/api/posts/${post.id}`)).status()).toBe(404)

  const appealed = await apiData<{ version: number }>(request.post(`${apiBaseUrl}/api/trust/cases/${moderationCase!.id}/appeals`, {
    headers: authHeaders(owner.accessToken),
    data: { reasonCode: 'community_browser_context', statement: 'The full browser workflow context supports restoring this community post.', expectedVersion: removed.version },
  }))
  const restored = await apiData<{ communityActions: Array<{ action: string }> }>(request.post(`${apiBaseUrl}/api/admin/trust/cases/${moderationCase!.id}/decisions`, {
    headers: authHeaders(appealReviewer.accessToken),
    data: { stage: 'appeal', outcome: 'overturn', reasonCode: 'community_browser_restore', note: 'Independent browser regression review restores the content.', expectedVersion: appealed.version },
  }))
  expect(restored.communityActions.map((item) => item.action)).toEqual(['hide', 'restore'])
  expect((await request.get(`${apiBaseUrl}/api/posts/${post.id}`)).ok()).toBeTruthy()
})

test('community report form remains bounded on mobile', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInPage(page, request, 'promptlin')
  await page.goto('/')
  await page.getByRole('button', { name: 'Toggle navigation' }).click()
  await page.getByTestId('nav-community').click()
  const topics = page.locator('[data-testid^="community-topic-"]')
  const count = await topics.count()
  expect(count).toBeGreaterThan(0)
  await topics.first().locator('.topic-title-button').click()
  const reportButtons = page.locator('[data-testid^="community-report-post-"]')
  expect(await reportButtons.count()).toBe(1)
  await reportButtons.click()
  const panel = page.getByTestId('community-report-panel')
  await expect(panel).toBeVisible()
  const box = await panel.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(390)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})
