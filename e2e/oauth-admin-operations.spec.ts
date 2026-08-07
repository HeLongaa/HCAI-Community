import { expect, test } from '@playwright/test'

import { apiBaseUrl, apiData, authHeaders, login, selectAdminSection, signInPage } from './helpers'

test('OAuth Admin controls Provider availability, linked accounts, and pending authorizations', async ({ page, request }) => {
  const admin = await login(request, 'opsplus')
  const linkedStart = await apiData<{ authorizationUrl: string }>(request.post(`${apiBaseUrl}/api/auth/oauth/google/start`, {
    headers: authHeaders(admin.accessToken),
    data: { linkAccount: true, redirectTo: '/profile' },
  }))
  await apiData(request.get(linkedStart.authorizationUrl, { headers: { accept: 'application/json' } }))
  await apiData(request.post(`${apiBaseUrl}/api/auth/oauth/apple/start`, {
    headers: authHeaders(admin.accessToken),
    data: { linkAccount: true, redirectTo: '/profile' },
  }))
  const linkedAccounts = await apiData<Array<{ id: string }>>(request.get(`${apiBaseUrl}/api/admin/auth/oauth/accounts?provider=google&search=opsplus`, {
    headers: authHeaders(admin.accessToken),
  }))
  const pendingRequests = await apiData<Array<{ id: string }>>(request.get(`${apiBaseUrl}/api/admin/auth/oauth/authorization-requests?provider=apple&status=pending&sort=createdAt&order=desc`, {
    headers: authHeaders(admin.accessToken),
  }))
  const linkedAccountId = linkedAccounts[0].id
  const pendingRequestId = pendingRequests[0].id

  await signInPage(page, request, 'opsplus')
  await page.goto('/')
  await page.getByTestId('nav-admin').click()
  await selectAdminSection(page, 'Access')

  const panel = page.getByTestId('oauth-admin-panel')
  await expect(panel).toBeVisible()
  await expect(panel.getByTestId('oauth-provider-google')).toContainText('Enabled')
  const github = panel.getByTestId('oauth-provider-github')
  await expect(github).toBeVisible()
  await github.getByLabel('GitHub Client ID').fill('e2e-github-client')
  await github.getByLabel('GitHub Redirect URI').fill(`${apiBaseUrl}/api/auth/oauth/github/callback`)
  await github.getByLabel('GitHub scopes').fill('read:user user:email')
  await github.getByLabel('GitHub SecretRef').fill('secret://oauth/github/client-secret')
  await github.getByLabel('GitHub reason code').fill('e2e_github_configuration')
  const configuredResponse = page.waitForResponse((response) => response.url().endsWith('/api/admin/auth/oauth/providers/github/configuration') && response.request().method() === 'PUT')
  await github.getByRole('button', { name: 'Save' }).click()
  expect((await configuredResponse).status()).toBe(200)
  await expect(github).toContainText('Disabled')
  await expect(github).toContainText('Secret missing')
  await expect(panel.locator('.admin-action-feedback')).toContainText('GitHub OAuth configuration saved.')
  await expect(page.getByTestId('app-toast')).toHaveCount(0)
  await expect(panel.getByTestId(`oauth-account-${linkedAccountId}`)).toBeVisible()
  await expect(panel.getByTestId(`oauth-request-${pendingRequestId}`)).toBeVisible()

  const google = panel.getByTestId('oauth-provider-google')
  await google.getByLabel('Google reason code').fill('e2e_disable')
  await google.getByRole('button', { name: 'Disable' }).click()
  let confirmation = panel.getByRole('alertdialog', { name: 'Confirm OAuth operation' })
  await expect(confirmation).toContainText('New sign-ins through this Provider stop immediately')
  await confirmation.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(confirmation).toHaveCount(0)
  await expect(google).toContainText('Enabled')
  await google.getByRole('button', { name: 'Disable' }).click()
  confirmation = panel.getByRole('alertdialog', { name: 'Confirm OAuth operation' })
  const disabledResponse = page.waitForResponse((response) => response.url().endsWith('/api/admin/auth/oauth/providers/google/status') && response.request().method() === 'POST')
  await confirmation.getByRole('button', { name: 'Disable Provider', exact: true }).click()
  await disabledResponse
  await expect(google).toContainText('Disabled')
  await expect(panel.locator('.admin-action-feedback')).toContainText('Google OAuth updated.')

  const publicProviders = await apiData<Array<{ provider: string; available: boolean }>>(request.get(`${apiBaseUrl}/api/auth/oauth/providers`))
  expect(publicProviders.find((provider) => provider.provider === 'google')?.available).toBe(false)

  const accountRow = panel.getByTestId(`oauth-account-${linkedAccountId}`)
  await accountRow.getByRole('button', { name: 'Unlink OAuth account' }).click()
  confirmation = panel.getByRole('alertdialog', { name: 'Confirm OAuth operation' })
  await expect(confirmation).toContainText('The user account remains active.')
  const unlinkResponse = page.waitForResponse((response) => /\/api\/admin\/auth\/oauth\/accounts\/[^/]+$/.test(response.url()) && response.request().method() === 'DELETE')
  await confirmation.getByRole('button', { name: 'Unlink account', exact: true }).click()
  await unlinkResponse
  await expect(accountRow).toHaveCount(0)
  await expect(panel.locator('.admin-action-feedback')).toContainText('OAuth account unlinked.')

  const requestRow = panel.getByTestId(`oauth-request-${pendingRequestId}`)
  await requestRow.getByRole('button', { name: 'Revoke authorization' }).click()
  confirmation = panel.getByRole('alertdialog', { name: 'Confirm OAuth operation' })
  await expect(confirmation).toContainText('can no longer be completed')
  const revokeResponse = page.waitForResponse((response) => response.url().endsWith('/revoke') && response.request().method() === 'POST')
  await confirmation.getByRole('button', { name: 'Revoke authorization', exact: true }).click()
  await revokeResponse
  await expect(requestRow).toContainText('revoked')
  await expect(panel.locator('.admin-action-feedback')).toContainText('OAuth authorization revoked.')

  await google.getByLabel('Google reason code').fill('e2e_restore')
  await google.getByRole('button', { name: 'Enable' }).click()
  confirmation = panel.getByRole('alertdialog', { name: 'Confirm OAuth operation' })
  const enabledResponse = page.waitForResponse((response) => response.url().endsWith('/api/admin/auth/oauth/providers/google/status') && response.request().method() === 'POST')
  await confirmation.getByRole('button', { name: 'Enable Provider', exact: true }).click()
  await enabledResponse
  await expect(google).toContainText('Enabled')
  await expect(page.getByTestId('app-toast')).toHaveCount(0)

  const secretText = await panel.textContent()
  expect(secretText).not.toContain('clientSecret')
  expect(secretText).not.toContain('stateHash')
})

test('OAuth Admin panel remains bounded on mobile', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInPage(page, request, 'opsplus')
  await page.goto('/')
  await page.getByRole('button', { name: 'Toggle navigation' }).click()
  await page.getByTestId('nav-admin').click()
  await selectAdminSection(page, 'Access')
  const panel = page.getByTestId('oauth-admin-panel')
  await expect(panel).toBeVisible()
  const layout = await panel.evaluate((element) => {
    const descendants = [...element.querySelectorAll<HTMLElement>('*')]
    return {
      panelWidth: element.getBoundingClientRect().width,
      viewportWidth: window.innerWidth,
      overflow: descendants
        .filter((node) => !['INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName) && node.scrollWidth > node.clientWidth + 2)
        .map((node) => `${node.tagName.toLowerCase()}[aria-label="${node.getAttribute('aria-label') ?? ''}"]:${node.clientWidth}/${node.scrollWidth}`)
        .slice(0, 10),
    }
  })
  expect(layout.panelWidth).toBeLessThanOrEqual(layout.viewportWidth)
  expect(layout.overflow).toEqual([])
  await panel.scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/oauth-admin-mobile.png' })
})
