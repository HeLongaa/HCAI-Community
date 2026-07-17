import { expect, test } from '@playwright/test'

import { apiBaseUrl, apiData, authHeaders, login, signInPage } from './helpers'

type UserSession = {
  id: string
  current: boolean
  status: 'active' | 'revoked' | 'expired'
  riskStatus: 'normal' | 'suspicious' | 'compromised'
}

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
  await page.getByRole('button', { name: 'Access', exact: true }).click()

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

  page.on('dialog', (dialog) => dialog.accept())
  await firstRow.getByLabel(`${firstLogicalSession?.id} reason code`).fill('e2e_confirmed_compromise')
  await firstRow.getByLabel(`${firstLogicalSession?.id} risk status`).selectOption('compromised')
  const compromisedResponse = page.waitForResponse((response) => response.url().endsWith(`/api/admin/auth/sessions/${firstLogicalSession?.id}/disposition`) && response.request().method() === 'POST')
  await firstRow.getByRole('button', { name: 'Save risk disposition' }).click()
  expect((await compromisedResponse).status()).toBe(200)
  await expect(firstRow).toContainText('compromised')
  await expect(firstRow).toContainText('revoked')

  const rejectedFirstAccess = await request.get(`${apiBaseUrl}/api/me`, { headers: authHeaders(firstUserSession.accessToken) })
  expect(rejectedFirstAccess.status()).toBe(401)
  const acceptedSecondAccess = await request.get(`${apiBaseUrl}/api/me`, { headers: authHeaders(secondUserSession.accessToken) })
  expect(acceptedSecondAccess.status()).toBe(200)

  await secondRow.getByLabel(`${secondLogicalSession?.id} reason code`).fill('e2e_account_containment')
  const revokeUserResponse = page.waitForResponse((response) => /\/api\/admin\/auth\/users\/[^/]+\/sessions\/revoke$/.test(response.url()) && response.request().method() === 'POST')
  await secondRow.getByRole('button', { name: 'Revoke user' }).click()
  expect((await revokeUserResponse).status()).toBe(200)

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
  await page.getByRole('button', { name: 'Access', exact: true }).click()

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
