import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiBaseUrl, apiData, authHeaders, login, signInPage } from './helpers'

type WebhookControl = {
  enabled: boolean
  maxSubscriptionsPerUser: number
  maxEventTypesPerSubscription: number
  defaultMaxAttempts: number
  baseRetrySeconds: number
  timeoutSeconds: number
  secretEncryptionAvailable: boolean
  version: number
}

const setWebhookControl = async (request: APIRequestContext, token: string, enabled: boolean) => {
  const current = await apiData<WebhookControl>(request.get(`${apiBaseUrl}/api/admin/developer/webhooks/control`, { headers: authHeaders(token) }))
  if (current.enabled === enabled) return current
  return apiData<WebhookControl>(request.put(`${apiBaseUrl}/api/admin/developer/webhooks/control`, { headers: authHeaders(token), data: {
    enabled, maxSubscriptionsPerUser: current.maxSubscriptionsPerUser, maxEventTypesPerSubscription: current.maxEventTypesPerSubscription,
    defaultMaxAttempts: current.defaultMaxAttempts, baseRetrySeconds: current.baseRetrySeconds, timeoutSeconds: current.timeoutSeconds,
    expectedVersion: current.version, reasonCode: enabled ? 'e2e_enabled' : 'e2e_reset_disabled',
  } }))
}

test('owner and Admin complete the webhook subscription, secret, and kill-switch flow', async ({ browser, page, request }) => {
  const suffix = Date.now()
  const name = `E2E task webhook ${suffix}`
  const endpoint = `http://127.0.0.1:9999/webhooks/${suffix}`
  const admin = await login(request, 'opsplus')
  await setWebhookControl(request, admin.accessToken, true)

  const ownerPage = await browser.newPage()
  await signInPage(ownerPage, request, 'promptlin')
  await ownerPage.goto('/')
  await ownerPage.getByTestId('nav-api').click()
  const panel = ownerPage.getByTestId('webhook-developer-panel')
  await expect(panel).toBeVisible()
  await expect(ownerPage.getByLabel('AI dynamic island guide')).toHaveCount(0)
  await panel.getByLabel('Webhook name').fill(name)
  await panel.getByLabel('Webhook endpoint').fill(endpoint)
  await panel.getByLabel('Webhook max attempts').fill('3')
  const createResponse = ownerPage.waitForResponse((response) => response.url().endsWith('/api/developer/webhooks') && response.request().method() === 'POST')
  await panel.getByRole('button', { name: 'Create', exact: true }).click()
  expect((await createResponse).status()).toBe(201)

  const oneTime = ownerPage.getByTestId('one-time-webhook-secret')
  await expect(oneTime).toBeVisible()
  const secret = (await oneTime.locator('code').innerText()).trim()
  expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/)
  await oneTime.getByRole('button', { name: 'I stored it', exact: true }).click()
  await panel.getByTitle('Refresh').click()
  await expect(oneTime).toHaveCount(0)
  await expect(ownerPage.locator('body')).not.toContainText(secret)
  const ownerRow = panel.locator('.webhook-subscription-row').filter({ hasText: name })
  await expect(ownerRow).toContainText(endpoint)
  await expect(ownerRow).toContainText('task.created.v1')
  await panel.screenshot({ path: 'test-results/webhooks-owner-desktop.png' })

  await signInPage(page, request, 'opsplus')
  await page.goto('/')
  await page.getByTestId('nav-admin').click()
  await page.getByRole('button', { name: 'Access', exact: true }).click()
  const adminPanel = page.getByTestId('webhook-admin-panel')
  await expect(adminPanel).toBeVisible()
  await expect(page.getByLabel('AI dynamic island guide')).toHaveCount(0)
  await adminPanel.getByTitle('Refresh').click()
  const adminRow = adminPanel.locator('.webhook-admin-row').filter({ hasText: name })
  await expect(adminRow).toBeVisible()
  page.on('dialog', (dialog) => dialog.accept())
  const disableResponse = page.waitForResponse((response) => /\/api\/admin\/developer\/webhooks\/[^/]+\/disable$/.test(response.url()) && response.request().method() === 'POST')
  await adminRow.getByTitle('Disable subscription').click()
  expect((await disableResponse).status()).toBe(200)
  await expect(adminRow).toContainText('disabled')
  await adminPanel.screenshot({ path: 'test-results/webhooks-admin-desktop.png' })

  await panel.getByTitle('Refresh').click()
  await expect(ownerRow).toContainText('disabled')
  await ownerPage.close()
})

test('webhook owner and Admin surfaces remain bounded on mobile', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const admin = await login(request, 'opsplus')
  await setWebhookControl(request, admin.accessToken, true)
  await signInPage(page, request, 'opsplus')
  await page.goto('/')
  await page.getByRole('button', { name: 'Toggle navigation' }).click()
  await page.getByTestId('nav-api').click()
  const ownerPanel = page.getByTestId('webhook-developer-panel')
  await expect(ownerPanel).toBeVisible()
  await expect(page.getByLabel('AI dynamic island guide')).toHaveCount(0)
  expect(await ownerPanel.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  await ownerPanel.screenshot({ path: 'test-results/webhooks-owner-mobile.png' })

  await page.getByRole('button', { name: 'Toggle navigation' }).click()
  await page.getByTestId('nav-admin').click()
  await page.getByRole('button', { name: 'Access', exact: true }).click()
  const adminPanel = page.getByTestId('webhook-admin-panel')
  await expect(adminPanel).toBeVisible()
  const layout = await adminPanel.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return { clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, overflow: element.scrollWidth - element.clientWidth, offenders: [...element.querySelectorAll<HTMLElement>('*')].map((node) => ({ node, rect: node.getBoundingClientRect() })).filter(({ node, rect }) => node.scrollWidth > node.clientWidth + 1 || rect.right > bounds.right + 1).map(({ node, rect }) => ({ tag: node.tagName, className: node.className, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, left: rect.left, right: rect.right, width: rect.width, display: getComputedStyle(node).display, grid: getComputedStyle(node).gridTemplateColumns })).sort((left, right) => right.right - left.right).slice(0, 10) }
  })
  expect(layout.overflow, JSON.stringify(layout.offenders)).toBeLessThanOrEqual(1)
  await adminPanel.screenshot({ path: 'test-results/webhooks-admin-mobile.png' })
})
