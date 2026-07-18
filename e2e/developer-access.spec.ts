import { expect, test, type APIRequestContext } from '@playwright/test'

import { apiBaseUrl, apiData, authHeaders, login, signInPage } from './helpers'

type DeveloperControl = {
  enabled: boolean
  allowedScopes: string[]
  maxServiceAccountsPerUser: number
  maxActiveKeysPerAccount: number
  defaultKeyTtlDays: number
  version: number
}

const setDeveloperAccess = async (request: APIRequestContext, accessToken: string, enabled: boolean) => {
  const current = await apiData<DeveloperControl>(request.get(`${apiBaseUrl}/api/admin/developer/access-control`, {
    headers: authHeaders(accessToken),
  }))
  if (current.enabled === enabled) return current
  return apiData<DeveloperControl>(request.put(`${apiBaseUrl}/api/admin/developer/access-control`, {
    headers: authHeaders(accessToken),
    data: {
      enabled,
      allowedScopes: current.allowedScopes,
      maxServiceAccountsPerUser: current.maxServiceAccountsPerUser,
      maxActiveKeysPerAccount: current.maxActiveKeysPerAccount,
      defaultKeyTtlDays: current.defaultKeyTtlDays,
      expectedVersion: current.version,
      reasonCode: enabled ? 'e2e_enabled' : 'e2e_reset_disabled',
    },
  }))
}

test('Admin and owner complete the Service Account and one-time API key lifecycle', async ({ browser, page, request }) => {
  const suffix = Date.now()
  const accountName = `E2E build agent ${suffix}`
  const keyName = `E2E key ${suffix}`
  const admin = await login(request, 'opsplus')
  await setDeveloperAccess(request, admin.accessToken, false)

  await signInPage(page, request, 'opsplus')
  await page.goto('/')
  await page.getByTestId('nav-admin').click()
  await page.getByRole('button', { name: 'Access', exact: true }).click()
  const adminPanel = page.getByTestId('developer-access-admin')
  await expect(adminPanel).toBeVisible()
  await expect(adminPanel).toContainText('Default off')
  await expect(adminPanel.getByTestId('developer-api-v1-contract')).toContainText('API v1')
  const enableResponse = page.waitForResponse((response) => response.url().endsWith('/api/admin/developer/access-control') && response.request().method() === 'PUT')
  await adminPanel.getByRole('button', { name: 'Enable', exact: true }).click()
  expect((await enableResponse).status()).toBe(200)
  await expect(adminPanel).toContainText('Enabled')

  const ownerPage = await browser.newPage()
  await signInPage(ownerPage, request, 'promptlin')
  await ownerPage.goto('/')
  await ownerPage.getByTestId('nav-api').click()
  await expect(ownerPage.getByRole('heading', { name: 'Service accounts and API keys' })).toBeVisible()

  const createPanel = ownerPage.locator('.developer-create-account')
  await createPanel.getByLabel('Name').fill(accountName)
  await createPanel.getByLabel('Description').fill('Browser lifecycle coverage')
  const accountResponse = ownerPage.waitForResponse((response) => response.url().endsWith('/api/developer/service-accounts') && response.request().method() === 'POST')
  await createPanel.getByRole('button', { name: 'Create', exact: true }).click()
  expect((await accountResponse).status()).toBe(200)

  const account = ownerPage.locator('.developer-account').filter({ hasText: accountName })
  await expect(account).toBeVisible()
  await account.getByRole('button', { name: 'New key', exact: true }).click()
  await account.getByLabel('Key name').fill(keyName)
  await account.getByLabel('TTL days').fill('7')
  const issueResponse = ownerPage.waitForResponse((response) => /\/api\/developer\/service-accounts\/[^/]+\/keys$/.test(response.url()) && response.request().method() === 'POST')
  await account.getByRole('button', { name: 'Issue once', exact: true }).click()
  expect((await issueResponse).status()).toBe(200)

  const oneTimeKey = ownerPage.getByTestId('one-time-api-key')
  await expect(oneTimeKey).toBeVisible()
  const plaintextKey = (await oneTimeKey.locator('code').innerText()).trim()
  expect(plaintextKey).toMatch(/^mfk_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/)
  await oneTimeKey.getByRole('button', { name: 'I stored it', exact: true }).click()
  await ownerPage.locator('.developer-access-heading').getByTitle('Refresh').click()
  await expect(oneTimeKey).toHaveCount(0)
  await expect(ownerPage.locator('body')).not.toContainText(plaintextKey)
  await ownerPage.locator('.developer-access-page').screenshot({ path: 'test-results/developer-access-desktop.png' })

  const principal = await apiData<{ serviceAccountId: string }>(request.get(`${apiBaseUrl}/api/developer/principal`, {
    headers: authHeaders(plaintextKey),
  }))
  expect(principal.serviceAccountId).toBeTruthy()

  const v1Response = await request.get(`${apiBaseUrl}/api/v1/principal`, {
    headers: { ...authHeaders(plaintextKey), 'x-request-id': `e2e-v1-${suffix}` },
  })
  expect(v1Response.status()).toBe(200)
  expect(v1Response.headers()['x-api-version']).toBe('v1')
  expect(v1Response.headers()['x-request-id']).toBe(`e2e-v1-${suffix}`)
  const v1Payload = await v1Response.json()
  expect(v1Payload.meta).toEqual({ apiVersion: 'v1', requestId: `e2e-v1-${suffix}` })
  expect(v1Payload.data.serviceAccountId).toBe(principal.serviceAccountId)

  ownerPage.on('dialog', (dialog) => dialog.accept())
  const keyRow = account.locator('.developer-key-row').filter({ has: ownerPage.getByText(keyName, { exact: true }) })
  const rotateResponse = ownerPage.waitForResponse((response) => response.url().endsWith('/rotate') && response.request().method() === 'POST')
  await keyRow.getByTitle('Rotate key').click()
  expect((await rotateResponse).status()).toBe(200)
  await expect(oneTimeKey).toBeVisible()
  const replacementKey = (await oneTimeKey.locator('code').innerText()).trim()
  expect(replacementKey).not.toBe(plaintextKey)
  await expect(keyRow).toContainText('rotated')
  await oneTimeKey.getByRole('button', { name: 'I stored it', exact: true }).click()

  const replacementRow = account.locator('.developer-key-row').filter({ has: ownerPage.getByText(`${keyName} rotated`, { exact: true }) })
  const revokeResponse = ownerPage.waitForResponse((response) => response.url().endsWith('/revoke') && response.request().method() === 'POST')
  await replacementRow.getByTitle('Revoke key').click()
  expect((await revokeResponse).status()).toBe(200)
  await expect(replacementRow).toContainText('revoked')

  await adminPanel.getByTitle('Refresh').click()
  await expect(adminPanel).toContainText('authenticated calls')
  const adminAccount = adminPanel.locator('.developer-admin-account').filter({ hasText: accountName })
  await expect(adminAccount).toBeVisible()
  page.on('dialog', (dialog) => dialog.accept())
  const adminRevokeResponse = page.waitForResponse((response) => response.url().endsWith('/revoke') && response.request().method() === 'POST')
  await adminAccount.getByTitle('Revoke account').click()
  expect((await adminRevokeResponse).status()).toBe(200)
  await expect(adminAccount).toContainText('revoked')
  await adminPanel.screenshot({ path: 'test-results/developer-access-admin-desktop.png' })
  await ownerPage.close()
})

test('developer access surfaces remain bounded on mobile', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const admin = await login(request, 'opsplus')
  await setDeveloperAccess(request, admin.accessToken, true)
  await signInPage(page, request, 'opsplus')
  await page.goto('/')
  await page.getByRole('button', { name: 'Toggle navigation' }).click()
  await page.getByTestId('nav-api').click()
  const developerPage = page.locator('.developer-access-page')
  await expect(developerPage).toBeVisible()
  expect(await developerPage.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  await developerPage.screenshot({ path: 'test-results/developer-access-mobile.png' })

  await page.getByRole('button', { name: 'Toggle navigation' }).click()
  await page.getByTestId('nav-admin').click()
  await page.getByRole('button', { name: 'Access', exact: true }).click()
  const adminPanel = page.getByTestId('developer-access-admin')
  await expect(adminPanel).toBeVisible()
  const adminLayout = await adminPanel.evaluate((element) => ({
    overflow: element.scrollWidth - element.clientWidth,
    offenders: [...element.querySelectorAll<HTMLElement>('*')]
      .filter((node) => node.scrollWidth > node.clientWidth + 1)
      .map((node) => ({ tag: node.tagName, className: node.className, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth }))
      .sort((left, right) => (right.scrollWidth - right.clientWidth) - (left.scrollWidth - left.clientWidth))
      .slice(0, 10),
  }))
  expect(adminLayout.overflow, JSON.stringify(adminLayout.offenders)).toBeLessThanOrEqual(1)
  await adminPanel.screenshot({ path: 'test-results/developer-access-admin-mobile.png' })
})
