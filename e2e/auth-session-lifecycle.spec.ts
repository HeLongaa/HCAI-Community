import { expect, test } from '@playwright/test'

import { apiBaseUrl, apiData, authHeaders, login, selectAdminSection, signInPage } from './helpers'

type UserSession = {
  id: string
  current: boolean
  status: 'active' | 'revoked' | 'expired'
  riskStatus: 'normal' | 'suspicious' | 'compromised'
}

type BrowserSession = {
  accessToken: string
  refreshToken: string
  user: {
    displayName: string
    handle: string
    permissions: string[]
    role: string
  }
}

async function createBrowserSession(page: import('@playwright/test').Page, handle = 'taskops') {
  await page.goto('/')
  return page.evaluate(async (loginHandle) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: loginHandle }),
    })
    const payload = await response.json() as { data: BrowserSession }
    localStorage.setItem('hcaiAccessToken', payload.data.accessToken)
    localStorage.setItem('hcaiUser', JSON.stringify({
      displayName: payload.data.user.displayName,
      role: payload.data.user.role,
      handle: payload.data.user.handle,
      profile: null,
      permissions: payload.data.user.permissions,
      source: 'api',
    }))
    return payload.data
  }, handle)
}

test('expired access token refreshes once and preserves the signed-in account', async ({ page }) => {
  const session = await createBrowserSession(page)
  const refreshResponses: number[] = []
  page.on('response', (response) => {
    if (response.url().endsWith('/api/auth/refresh')) refreshResponses.push(response.status())
  })

  await page.evaluate(() => localStorage.setItem('hcaiAccessToken', 'expired.e2e.access-token'))
  await page.reload()

  await expect(page.getByRole('button', { name: `Open account menu for ${session.user.displayName}` })).toBeVisible()
  await expect.poll(() => refreshResponses).toEqual([201])
  const refreshedToken = await page.evaluate(() => localStorage.getItem('hcaiAccessToken'))
  expect(refreshedToken).toBeTruthy()
  expect(refreshedToken).not.toBe('expired.e2e.access-token')
})

test('concurrent 401 responses share one refresh rotation', async ({ page }) => {
  await createBrowserSession(page)
  await page.reload()
  await expect(page.locator('.topbar-account')).toBeVisible()

  const refreshResponses: number[] = []
  page.on('response', (response) => {
    if (response.url().endsWith('/api/auth/refresh')) refreshResponses.push(response.status())
  })
  await page.evaluate(async () => {
    localStorage.setItem('hcaiAccessToken', 'expired.concurrent.access-token')
    const { api } = await import('/src/services/apiClient.ts')
    await Promise.all([api.get('/me'), api.get('/points/ledger')])
  })

  expect(refreshResponses).toEqual([201])
})

test('failed refresh clears stale account state and returns to the public entry', async ({ page, request }) => {
  const session = await createBrowserSession(page)
  await apiData(request.post(`${apiBaseUrl}/api/auth/logout`, {
    data: { refreshToken: session.refreshToken },
  }))
  await page.evaluate(() => localStorage.setItem('hcaiAccessToken', 'expired.revoked.access-token'))

  await page.reload()

  await expect(page.locator('.hcai-landing')).toBeVisible()
  await expect.poll(() => page.evaluate(() => ({
    accessToken: localStorage.getItem('hcaiAccessToken'),
    user: localStorage.getItem('hcaiUser'),
  }))).toEqual({ accessToken: null, user: null })
})

test('Auth Session Admin dispositions immediately invalidate access and can contain a user account', async ({ page, request }) => {
  const firstUserSession = await login(request, 'promptlin')
  const secondUserSession = await login(request, 'promptlin')
  const firstSessions = await apiData<UserSession[]>(request.get(`${apiBaseUrl}/api/auth/sessions`, {
    headers: authHeaders(firstUserSession.accessToken),
  }))
  const secondSessions = await apiData<UserSession[]>(request.get(`${apiBaseUrl}/api/auth/sessions`, {
    headers: authHeaders(secondUserSession.accessToken),
  }))
  const firstLogicalSession = firstSessions.find((session) => session.current)
  const secondLogicalSession = secondSessions.find((session) => session.current)
  expect(firstLogicalSession).toBeTruthy()
  expect(secondLogicalSession).toBeTruthy()
  expect(firstLogicalSession?.id).not.toBe(secondLogicalSession?.id)

  await signInPage(page, request, 'opsplus')
  await page.goto('/')
  await page.getByTestId('nav-admin').click()
  await selectAdminSection(page, 'Access')

  const panel = page.getByTestId('auth-session-admin-panel')
  await expect(panel).toBeVisible()
  await panel.getByLabel('Session user search').fill('promptlin')
  const queryResponse = page.waitForResponse((response) => response.url().includes('/api/admin/auth/sessions?') && response.request().method() === 'GET')
  await panel.getByRole('button', { name: 'Apply' }).click()
  expect((await queryResponse).status()).toBe(200)

  const firstRow = panel.getByTestId(`admin-auth-session-${firstLogicalSession?.id}`)
  const secondRow = panel.getByTestId(`admin-auth-session-${secondLogicalSession?.id}`)
  await expect(firstRow).toBeVisible()
  await expect(secondRow).toBeVisible()

  await firstRow.getByLabel(`${firstLogicalSession?.id} reason code`).fill('e2e_unusual_client')
  await firstRow.getByLabel(`${firstLogicalSession?.id} risk status`).selectOption('suspicious')
  const suspiciousResponse = page.waitForResponse((response) => response.url().endsWith(`/api/admin/auth/sessions/${firstLogicalSession?.id}/disposition`) && response.request().method() === 'POST')
  await firstRow.getByRole('button', { name: 'Save risk disposition' }).click()
  expect((await suspiciousResponse).status()).toBe(200)
  await expect(firstRow).toContainText('suspicious')
  await expect(panel.locator('.admin-action-feedback')).toContainText('Session risk disposition saved.')
  await expect(page.getByTestId('app-toast')).toHaveCount(0)

  await firstRow.getByLabel(`${firstLogicalSession?.id} reason code`).fill('e2e_confirmed_compromise')
  await firstRow.getByLabel(`${firstLogicalSession?.id} risk status`).selectOption('compromised')
  await firstRow.getByRole('button', { name: 'Save risk disposition' }).click()
  let confirmation = panel.getByRole('alertdialog', { name: 'Confirm session security operation' })
  await expect(confirmation).toContainText('Other sessions for the same user remain active.')
  await confirmation.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(confirmation).toHaveCount(0)
  await expect(firstRow).toContainText('suspicious')
  await firstRow.getByRole('button', { name: 'Save risk disposition' }).click()
  confirmation = panel.getByRole('alertdialog', { name: 'Confirm session security operation' })
  const compromisedResponse = page.waitForResponse((response) => response.url().endsWith(`/api/admin/auth/sessions/${firstLogicalSession?.id}/disposition`) && response.request().method() === 'POST')
  await confirmation.getByRole('button', { name: 'Mark compromised', exact: true }).click()
  expect((await compromisedResponse).status()).toBe(200)
  await expect(firstRow).toContainText('compromised')
  await expect(firstRow).toContainText('revoked')

  const rejectedFirstAccess = await request.get(`${apiBaseUrl}/api/me`, { headers: authHeaders(firstUserSession.accessToken) })
  expect(rejectedFirstAccess.status()).toBe(401)
  const acceptedSecondAccess = await request.get(`${apiBaseUrl}/api/me`, { headers: authHeaders(secondUserSession.accessToken) })
  expect(acceptedSecondAccess.status()).toBe(200)

  await secondRow.getByLabel(`${secondLogicalSession?.id} reason code`).fill('e2e_account_containment')
  await secondRow.getByRole('button', { name: 'Revoke user' }).click()
  confirmation = panel.getByRole('alertdialog', { name: 'Confirm session security operation' })
  await expect(confirmation).toContainText('Every active session for this user')
  const revokeUserResponse = page.waitForResponse((response) => /\/api\/admin\/auth\/users\/[^/]+\/sessions\/revoke$/.test(response.url()) && response.request().method() === 'POST')
  await confirmation.getByRole('button', { name: 'Revoke all sessions', exact: true }).click()
  expect((await revokeUserResponse).status()).toBe(200)
  await expect(panel.locator('.admin-action-feedback')).toContainText('Revoked 1 sessions.')
  await expect(page.getByTestId('app-toast')).toHaveCount(0)

  const rejectedSecondAccess = await request.get(`${apiBaseUrl}/api/me`, { headers: authHeaders(secondUserSession.accessToken) })
  expect(rejectedSecondAccess.status()).toBe(401)
  await expect(panel).not.toContainText(firstUserSession.accessToken)
  await expect(panel).not.toContainText(firstUserSession.refreshToken)
})

test('Auth Session Admin panel remains bounded at 390px', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInPage(page, request, 'opsplus')
  await page.goto('/')
  await page.getByRole('button', { name: 'Toggle navigation' }).click()
  await page.getByTestId('nav-admin').click()
  await selectAdminSection(page, 'Access')

  const panel = page.getByTestId('auth-session-admin-panel')
  await expect(panel).toBeVisible()
  const layout = await panel.evaluate((element) => ({
    panelWidth: element.getBoundingClientRect().width,
    viewportWidth: window.innerWidth,
    documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
    overflow: [...element.querySelectorAll<HTMLElement>('*')]
      .filter((node) => !['INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName) && node.scrollWidth > node.clientWidth + 2)
      .map((node) => `${node.tagName.toLowerCase()}:${node.clientWidth}/${node.scrollWidth}`)
      .slice(0, 10),
  }))
  expect(layout.panelWidth).toBeLessThanOrEqual(layout.viewportWidth)
  expect(layout.documentOverflow).toBeLessThanOrEqual(1)
  expect(layout.overflow).toEqual([])
  await panel.scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/auth-session-admin-mobile.png' })
})
