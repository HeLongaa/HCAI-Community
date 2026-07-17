import { expect, test } from '@playwright/test'

import { apiBaseUrl, authHeaders, login, signInPage } from './helpers'

test('User Admin suspends and restores an account without reviving old sessions', async ({ page, request }) => {
  const targetSession = await login(request, 'promptlin')
  await signInPage(page, request, 'opsplus')
  await page.goto('/')
  await page.getByTestId('nav-admin').click()
  await page.getByRole('button', { name: 'Users', exact: true }).click()

  const panel = page.getByTestId('user-admin-panel')
  await expect(panel).toBeVisible()
  await panel.getByLabel('User search').fill('promptlin')
  const queryResponse = page.waitForResponse((response) => response.url().includes('/api/admin/users?') && response.request().method() === 'GET')
  await panel.getByRole('button', { name: 'Apply user filters' }).click()
  expect((await queryResponse).status()).toBe(200)

  const row = panel.locator('.user-admin-row').filter({ hasText: 'promptlin' })
  await expect(row).toBeVisible()
  await row.click()
  await expect(panel.locator('.user-admin-facts dd').filter({ hasText: /^creator$/ })).toBeVisible()
  await panel.getByLabel('User lifecycle reason code').fill('e2e_policy_violation')

  page.on('dialog', (dialog) => dialog.accept())
  const suspendResponse = page.waitForResponse((response) => /\/api\/admin\/users\/[^/]+\/suspend$/.test(response.url()) && response.request().method() === 'POST')
  await panel.getByRole('button', { name: 'Suspend', exact: true }).click()
  expect((await suspendResponse).status()).toBe(200)
  await expect(panel.getByRole('button', { name: 'Restore', exact: true })).toBeVisible()
  await expect(panel.getByText('e2e_policy_violation')).toBeVisible()
  expect((await request.get(`${apiBaseUrl}/api/me`, { headers: authHeaders(targetSession.accessToken) })).status()).toBe(401)

  await panel.getByLabel('User lifecycle reason code').fill('e2e_appeal_accepted')
  const restoreResponse = page.waitForResponse((response) => /\/api\/admin\/users\/[^/]+\/restore$/.test(response.url()) && response.request().method() === 'POST')
  await panel.getByRole('button', { name: 'Restore', exact: true }).click()
  expect((await restoreResponse).status()).toBe(200)
  await expect(panel.getByRole('button', { name: 'Suspend', exact: true })).toBeVisible()
  expect((await request.get(`${apiBaseUrl}/api/me`, { headers: authHeaders(targetSession.accessToken) })).status()).toBe(401)
  expect((await login(request, 'promptlin')).accessToken).toBeTruthy()
})

test('User Admin panel remains bounded at 390px', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInPage(page, request, 'opsplus')
  await page.goto('/')
  await page.getByRole('button', { name: 'Toggle navigation' }).click()
  await page.getByTestId('nav-admin').click()
  await page.getByRole('button', { name: 'Users', exact: true }).click()

  const panel = page.getByTestId('user-admin-panel')
  await expect(panel).toBeVisible()
  await panel.scrollIntoViewIfNeeded()
  const layout = await panel.evaluate((element) => ({
    panelWidth: element.getBoundingClientRect().width,
    viewportWidth: window.innerWidth,
    documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
    overflow: [...element.querySelectorAll<HTMLElement>('*')]
      .filter((node) => !['INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName) && getComputedStyle(node).overflowX !== 'auto' && node.scrollWidth > node.clientWidth + 2)
      .map((node) => `${node.tagName.toLowerCase()}:${node.clientWidth}/${node.scrollWidth}`)
      .slice(0, 10),
  }))
  expect(layout.panelWidth).toBeLessThanOrEqual(layout.viewportWidth)
  expect(layout.documentOverflow).toBeLessThanOrEqual(1)
  expect(layout.overflow).toEqual([])
  await page.screenshot({ path: 'test-results/user-admin-mobile.png', fullPage: true })
})
