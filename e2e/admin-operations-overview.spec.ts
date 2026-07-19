import { expect, test } from '@playwright/test'

import { apiBaseUrl, apiData, authHeaders, login, signInPage } from './helpers'

test('Admin operations overview loads and global search opens a durable deep link', async ({ page, request }) => {
  const member = await login(request, 'promptlin')
  const denied = await request.get(`${apiBaseUrl}/api/admin/overview`, {
    headers: authHeaders(member.accessToken),
  })
  expect(denied.status()).toBe(403)

  const admin = await login(request, 'opsplus')
  const overview = await apiData<{ totals: { pendingReviews: number; activeAlerts: number; recoveryItems: number } }>(
    request.get(`${apiBaseUrl}/api/admin/overview?windowMinutes=60`, {
      headers: authHeaders(admin.accessToken),
    }),
  )
  expect(overview.totals.pendingReviews).toBeGreaterThanOrEqual(0)

  await signInPage(page, request, 'opsplus')
  await page.goto('/')
  await page.getByTestId('nav-admin').click()
  await expect(page.getByTestId('admin-operations-overview')).toBeVisible()
  await expect(page.getByTestId('admin-search-diagnostics')).toBeVisible()

  await page.getByTestId('admin-global-search-input').fill('promptlin')
  const searchResponse = page.waitForResponse((response) => response.url().includes('/api/admin/search?') && response.status() === 200)
  await page.getByTestId('admin-global-search-submit').click()
  await searchResponse

  const results = page.getByTestId('admin-global-search-results')
  await expect(results).toBeVisible()
  await expect(results.locator('button').first()).toBeVisible()
  await results.locator('button').first().click()
  await expect(page.getByTestId('admin-global-search-selection')).toBeVisible()
  await expect(page).toHaveURL(/#admin\?tab=Overview&overviewResourceType=/)

  if (process.env.ADMIN_OVERVIEW_SCREENSHOTS === '1') {
    await page.getByTestId('admin-operations-overview').screenshot({ path: 'test-results/admin-overview-desktop.png' })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByTestId('admin-operations-overview').screenshot({ path: 'test-results/admin-overview-mobile.png' })
  }
})
