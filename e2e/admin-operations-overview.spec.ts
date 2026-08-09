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
  await expect(page.locator('.topbar-context')).toHaveText('Admin')
  await expect(page.locator('.admin-section-group')).toHaveCount(5)
  const desktopLayout = await page.evaluate(() => ({
    pageHeight: document.documentElement.scrollHeight,
    visibleHiddenSections: [...document.querySelectorAll('section[hidden]')]
      .filter((element) => getComputedStyle(element).display !== 'none').length,
  }))
  expect(desktopLayout.pageHeight).toBeLessThan(5_000)
  expect(desktopLayout.visibleHiddenSections).toBe(0)
  await expect(page.getByTestId('admin-search-diagnostics')).not.toContainText(/\d{6,}s/)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export diagnostics', exact: true }).click()
  expect((await download).suggestedFilename()).toMatch(/^search-diagnostics-\d{4}-\d{2}-\d{2}\.json$/)
  await expect(page.locator('a[download^="search-diagnostics-"]')).toHaveCount(0)

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

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.admin-tab-select')).toBeVisible()
  await expect(page.locator('.admin-section-rail')).toBeHidden()
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThan(5_000)

  if (process.env.ADMIN_OVERVIEW_SCREENSHOTS === '1') {
    await page.getByTestId('admin-operations-overview').screenshot({ path: 'test-results/admin-overview-desktop.png' })
    await page.getByTestId('admin-operations-overview').screenshot({ path: 'test-results/admin-overview-mobile.png' })
  }
})
