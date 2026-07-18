import { expect, test } from '@playwright/test'

import { apiBaseUrl, signInPage } from './helpers'

test('Auth Admin reports masked failures and applies a versioned runtime risk policy', async ({ page, request }) => {
  const rawIdentity = `e2e-risk-${Date.now()}`
  const failed = await request.post(`${apiBaseUrl}/api/auth/login`, { data: { handle: rawIdentity } })
  expect(failed.status()).toBe(401)

  await signInPage(page, request, 'opsplus')
  await page.goto('/')
  await page.getByTestId('nav-admin').click()
  await page.getByRole('button', { name: 'Access', exact: true }).click()

  const panel = page.getByTestId('auth-session-admin-panel')
  await expect(panel.getByTestId('auth-risk-metrics')).toBeVisible()
  await expect(panel.getByTestId('auth-risk-metrics')).toContainText('Failures')
  await panel.getByLabel('Authentication failure reason').fill('unknown_demo_handle')
  const failuresResponse = page.waitForResponse((response) => response.url().includes('/api/admin/auth/failures?') && response.request().method() === 'GET')
  await panel.getByRole('button', { name: 'Filter failures' }).click()
  expect((await failuresResponse).status()).toBe(200)
  await expect(panel.locator('.auth-failure-list')).toContainText('unknown_demo_handle')
  await expect(panel).not.toContainText(rawIdentity)

  const policy = panel.getByTestId('auth-risk-policy')
  await policy.getByLabel('Authentication risk window seconds').fill('420')
  await policy.getByLabel('Authentication accounts per network threshold').fill('4')
  await policy.getByLabel('Authentication networks per account threshold').fill('4')
  await policy.getByLabel('Authentication policy reason code').fill('e2e_policy_review')
  const policyResponse = page.waitForResponse((response) => response.url().endsWith('/api/admin/auth/risk-policy') && response.request().method() === 'PUT')
  await policy.getByRole('button', { name: 'Save policy' }).click()
  expect((await policyResponse).status()).toBe(200)
  await expect(policy).toContainText('Enabled')
  await expect(policy).toContainText('v1')
  await panel.scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/auth-policy-risk-admin-desktop.png', fullPage: true })
})
