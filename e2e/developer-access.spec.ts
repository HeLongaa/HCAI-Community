import { expect, test, type APIRequestContext } from '@playwright/test'

import { apiBaseUrl, apiData, authHeaders, login, selectAdminSection, signInPage } from './helpers'

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
  test.setTimeout(45_000)
  const suffix = Date.now()
  const accountName = `E2E build agent ${suffix}`
  const keyName = `E2E key ${suffix}`
  const cleanupAccountName = `E2E owner cleanup ${suffix}`
  const cleanupKeyName = `E2E cleanup key ${suffix}`
  const nativeAdminDialogs: string[] = []
  let adminRevokeRequests = 0
  page.on('dialog', (dialog) => {
    nativeAdminDialogs.push(dialog.type())
    void dialog.dismiss()
  })
  page.on('request', (pendingRequest) => {
    if (pendingRequest.method() === 'POST' && pendingRequest.url().endsWith('/revoke')) adminRevokeRequests += 1
  })
  const admin = await login(request, 'opsplus')
  await setDeveloperAccess(request, admin.accessToken, false)

  await signInPage(page, request, 'opsplus')
  await page.goto('/')
  await page.getByTestId('nav-admin').click()
  await selectAdminSection(page, 'Access')
  const adminPanel = page.getByTestId('developer-access-admin')
  await expect(adminPanel).toBeVisible()
  await expect(adminPanel).toContainText('Default off')
  await expect(adminPanel.getByTestId('developer-api-v1-contract')).toContainText('API v1')
  const enableResponse = page.waitForResponse((response) => response.url().endsWith('/api/admin/developer/access-control') && response.request().method() === 'PUT')
  await adminPanel.getByRole('button', { name: 'Enable', exact: true }).click()
  expect((await enableResponse).status()).toBe(200)
  await expect(adminPanel).toContainText('Enabled')
  await expect(adminPanel.locator('.admin-action-feedback')).toContainText('Developer access control updated')
  await expect(page.getByTestId('app-toast')).toHaveCount(0)

  const ownerPage = await browser.newPage()
  const nativeOwnerDialogs: string[] = []
  let ownerRotateRequests = 0
  let ownerKeyRevokeRequests = 0
  let ownerAccountRevokeRequests = 0
  ownerPage.on('dialog', (dialog) => {
    nativeOwnerDialogs.push(dialog.type())
    void dialog.dismiss()
  })
  ownerPage.on('request', (pendingRequest) => {
    const url = pendingRequest.url()
    if (pendingRequest.method() !== 'POST') return
    if (url.endsWith('/rotate')) ownerRotateRequests += 1
    if (url.endsWith('/revoke')) ownerKeyRevokeRequests += 1
    if (url.includes('/api/developer/service-accounts/') && url.endsWith('/transitions')) ownerAccountRevokeRequests += 1
  })
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
  await expect(ownerPage.locator('.developer-access-page > .action-feedback')).toContainText('Service account created.')
  await expect(ownerPage.getByTestId('app-toast')).toHaveCount(0)

  const account = ownerPage.locator('.developer-account').filter({ hasText: accountName })
  await expect(account).toBeVisible()
  await account.getByRole('button', { name: 'New key', exact: true }).click()
  await account.getByLabel('Key name').fill(keyName)
  await account.getByLabel('TTL days').fill('7')
  const issueResponse = ownerPage.waitForResponse((response) => /\/api\/developer\/service-accounts\/[^/]+\/keys$/.test(response.url()) && response.request().method() === 'POST')
  await account.getByRole('button', { name: 'Issue once', exact: true }).click()
  expect((await issueResponse).status()).toBe(200)
  await expect(ownerPage.locator('.developer-access-page > .action-feedback')).toContainText('API key issued.')

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

  const keyRow = account.locator('.developer-key-row').filter({ has: ownerPage.getByText(keyName, { exact: true }) })
  await keyRow.getByTitle('Rotate key').click()
  let ownerConfirmation = account.getByRole('alertdialog', { name: 'Confirm developer credential operation' })
  await expect(ownerConfirmation).toContainText('The current key stops immediately')
  await ownerConfirmation.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(ownerConfirmation).toHaveCount(0)
  expect(ownerRotateRequests).toBe(0)

  await keyRow.getByTitle('Rotate key').click()
  ownerConfirmation = account.getByRole('alertdialog', { name: 'Confirm developer credential operation' })
  const rotateResponse = ownerPage.waitForResponse((response) => response.url().endsWith('/rotate') && response.request().method() === 'POST')
  await ownerConfirmation.getByRole('button', { name: 'Rotate key', exact: true }).click()
  expect((await rotateResponse).status()).toBe(200)
  await expect(oneTimeKey).toBeVisible()
  const replacementKey = (await oneTimeKey.locator('code').innerText()).trim()
  expect(replacementKey).not.toBe(plaintextKey)
  await expect(keyRow).toContainText('rotated')
  await expect(ownerPage.locator('.developer-access-page > .action-feedback')).toContainText('was rotated')
  await oneTimeKey.getByRole('button', { name: 'I stored it', exact: true }).click()

  const replacementRow = account.locator('.developer-key-row').filter({ has: ownerPage.getByText(`${keyName} rotated`, { exact: true }) })
  await adminPanel.getByTitle('Refresh').click()
  let adminAccount = adminPanel.locator('.developer-admin-account').filter({ hasText: accountName })
  await expect(adminAccount).toBeVisible()
  const activeAdminKey = adminAccount.locator('.developer-admin-key').filter({ hasText: 'active' }).first()
  await expect(activeAdminKey).toBeVisible()
  await activeAdminKey.getByTitle('Revoke key').click()
  let confirmation = adminAccount.getByRole('alertdialog', { name: 'Confirm developer credential revoke' })
  await expect(confirmation).toContainText('This key will stop authenticating future API requests')
  await confirmation.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(confirmation).toHaveCount(0)
  expect(adminRevokeRequests).toBe(0)

  await activeAdminKey.getByTitle('Revoke key').click()
  confirmation = adminAccount.getByRole('alertdialog', { name: 'Confirm developer credential revoke' })
  const revokeResponse = page.waitForResponse((response) => response.url().endsWith('/revoke') && response.request().method() === 'POST')
  await confirmation.getByRole('button', { name: 'Revoke key', exact: true }).click()
  expect((await revokeResponse).status()).toBe(200)
  await ownerPage.locator('.developer-access-heading').getByTitle('Refresh').click()
  await expect(replacementRow).toContainText('revoked')

  await expect(adminPanel).toContainText('authenticated calls')
  adminAccount = adminPanel.locator('.developer-admin-account').filter({ hasText: accountName })
  await expect(adminAccount).toBeVisible()
  await adminAccount.getByTitle('Revoke account').click()
  confirmation = adminAccount.getByRole('alertdialog', { name: 'Confirm developer credential revoke' })
  await expect(confirmation).toContainText('All active keys under this service account will stop authenticating')
  await confirmation.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(confirmation).toHaveCount(0)
  expect(adminRevokeRequests).toBe(1)

  await adminAccount.getByTitle('Revoke account').click()
  confirmation = adminAccount.getByRole('alertdialog', { name: 'Confirm developer credential revoke' })
  const adminRevokeResponse = page.waitForResponse((response) => response.url().endsWith('/revoke') && response.request().method() === 'POST')
  await confirmation.getByRole('button', { name: 'Revoke account', exact: true }).click()
  expect((await adminRevokeResponse).status()).toBe(200)
  await expect(adminAccount).toContainText('revoked')
  expect(adminRevokeRequests).toBe(2)
  expect(nativeAdminDialogs).toEqual([])
  await adminPanel.screenshot({ path: 'test-results/developer-access-admin-desktop.png' })

  await createPanel.getByLabel('Name').fill(cleanupAccountName)
  await createPanel.getByLabel('Description').fill('Owner revoke coverage')
  const cleanupAccountResponse = ownerPage.waitForResponse((response) => response.url().endsWith('/api/developer/service-accounts') && response.request().method() === 'POST')
  await createPanel.getByRole('button', { name: 'Create', exact: true }).click()
  expect((await cleanupAccountResponse).status()).toBe(200)
  const cleanupAccount = ownerPage.locator('.developer-account').filter({ hasText: cleanupAccountName })
  await cleanupAccount.getByRole('button', { name: 'New key', exact: true }).click()
  await cleanupAccount.getByLabel('Key name').fill(cleanupKeyName)
  const cleanupIssueResponse = ownerPage.waitForResponse((response) => /\/api\/developer\/service-accounts\/[^/]+\/keys$/.test(response.url()) && response.request().method() === 'POST')
  await cleanupAccount.getByRole('button', { name: 'Issue once', exact: true }).click()
  expect((await cleanupIssueResponse).status()).toBe(200)
  await oneTimeKey.getByRole('button', { name: 'I stored it', exact: true }).click()

  const cleanupKey = cleanupAccount.locator('.developer-key-row').filter({ has: ownerPage.getByText(cleanupKeyName, { exact: true }) })
  await cleanupKey.getByTitle('Revoke key').click()
  ownerConfirmation = cleanupAccount.getByRole('alertdialog', { name: 'Confirm developer credential operation' })
  await ownerConfirmation.getByRole('button', { name: 'Back', exact: true }).click()
  expect(ownerKeyRevokeRequests).toBe(0)
  await cleanupKey.getByTitle('Revoke key').click()
  ownerConfirmation = cleanupAccount.getByRole('alertdialog', { name: 'Confirm developer credential operation' })
  const ownerKeyRevokeResponse = ownerPage.waitForResponse((response) => response.url().endsWith('/revoke') && response.request().method() === 'POST')
  await ownerConfirmation.getByRole('button', { name: 'Revoke key', exact: true }).click()
  expect((await ownerKeyRevokeResponse).status()).toBe(200)
  await expect(cleanupKey).toContainText('revoked')
  await expect(ownerPage.locator('.developer-access-page > .action-feedback')).toContainText('was revoked')

  await cleanupAccount.getByTitle('Revoke service account').click()
  ownerConfirmation = cleanupAccount.getByRole('alertdialog', { name: 'Confirm developer credential operation' })
  await ownerConfirmation.getByRole('button', { name: 'Back', exact: true }).click()
  expect(ownerAccountRevokeRequests).toBe(0)
  await cleanupAccount.getByTitle('Revoke service account').click()
  ownerConfirmation = cleanupAccount.getByRole('alertdialog', { name: 'Confirm developer credential operation' })
  const ownerAccountRevokeResponse = ownerPage.waitForResponse((response) => response.url().endsWith('/transitions') && response.request().method() === 'POST')
  await ownerConfirmation.getByRole('button', { name: 'Revoke account', exact: true }).click()
  expect((await ownerAccountRevokeResponse).status()).toBe(200)
  await expect(cleanupAccount).toContainText('revoked')
  expect(ownerRotateRequests).toBe(1)
  expect(ownerKeyRevokeRequests).toBe(1)
  expect(ownerAccountRevokeRequests).toBe(1)
  expect(nativeOwnerDialogs).toEqual([])
  await expect(ownerPage.getByTestId('app-toast')).toHaveCount(0)
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
  await selectAdminSection(page, 'Access')
  const adminPanel = page.getByTestId('developer-access-admin')
  await expect(adminPanel).toBeVisible()
  const download = page.waitForEvent('download')
  await adminPanel.getByRole('button', { name: 'JSON', exact: true }).click()
  expect((await download).suggestedFilename()).toMatch(/^developer-access-\d{4}-\d{2}-\d{2}\.json$/)
  await expect(page.locator('a[download^="developer-access-"]')).toHaveCount(0)
  await expect(adminPanel.locator('.admin-action-feedback')).toContainText('Developer access snapshot downloaded')
  await expect(page.getByTestId('app-toast')).toHaveCount(0)
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
