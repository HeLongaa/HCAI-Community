import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiBaseUrl, apiData, authHeaders, login, selectAdminSection, signInPage } from './helpers'
import type { ProviderAlertDelivery } from '../src/services/contracts'

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
  test.setTimeout(40_000)
  const suffix = Date.now()
  const name = `E2E task webhook ${suffix}`
  const endpoint = `http://127.0.0.1:9999/webhooks/${suffix}`
  const admin = await login(request, 'opsplus')
  await setWebhookControl(request, admin.accessToken, true)

  const ownerPage = await browser.newPage()
  const nativeOwnerDialogs: string[] = []
  let ownerRotateRequests = 0
  let ownerDeleteRequests = 0
  ownerPage.on('dialog', (dialog) => {
    nativeOwnerDialogs.push(dialog.type())
    void dialog.dismiss()
  })
  ownerPage.on('request', (pendingRequest) => {
    if (pendingRequest.method() === 'POST' && pendingRequest.url().endsWith('/rotate-secret')) ownerRotateRequests += 1
    if (pendingRequest.method() === 'DELETE' && /\/api\/developer\/webhooks\/[^/]+$/.test(pendingRequest.url())) ownerDeleteRequests += 1
  })
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
  await expect(panel.locator(':scope > .action-feedback')).toContainText('Webhook subscription created.')
  await expect(ownerPage.getByTestId('app-toast')).toHaveCount(0)

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

  await ownerRow.getByTitle('Rotate secret').click()
  let ownerConfirmation = ownerRow.getByRole('alertdialog', { name: 'Confirm Webhook operation' })
  await expect(ownerConfirmation).toContainText('The current signing secret stops immediately')
  await ownerConfirmation.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(ownerConfirmation).toHaveCount(0)
  expect(ownerRotateRequests).toBe(0)

  await ownerRow.getByTitle('Rotate secret').click()
  ownerConfirmation = ownerRow.getByRole('alertdialog', { name: 'Confirm Webhook operation' })
  const rotateResponse = ownerPage.waitForResponse((response) => response.url().endsWith('/rotate-secret') && response.request().method() === 'POST')
  await ownerConfirmation.getByRole('button', { name: 'Rotate secret', exact: true }).click()
  expect((await rotateResponse).status()).toBe(200)
  await expect(oneTime).toBeVisible()
  const replacementSecret = (await oneTime.locator('code').innerText()).trim()
  expect(replacementSecret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/)
  expect(replacementSecret).not.toBe(secret)
  await expect(panel.locator(':scope > .action-feedback')).toContainText('signing secret rotated')
  await oneTime.getByRole('button', { name: 'I stored it', exact: true }).click()
  await panel.screenshot({ path: 'test-results/webhooks-owner-desktop.png' })

  await signInPage(page, request, 'opsplus')
  await page.goto('/')
  await page.getByTestId('nav-admin').click()
  await selectAdminSection(page, 'Access')
  const adminPanel = page.getByTestId('webhook-admin-panel')
  await expect(adminPanel).toBeVisible()
  await expect(page.getByLabel('AI dynamic island guide')).toHaveCount(0)
  await adminPanel.getByTitle('Refresh').click()
  const adminRow = adminPanel.locator('.webhook-admin-row').filter({ hasText: name })
  await expect(adminRow).toBeVisible()
  await adminRow.getByTitle('Disable subscription').click()
  let confirmation = adminPanel.getByRole('alertdialog', { name: 'Confirm Webhook subscription disable' })
  await expect(confirmation).toContainText('New events will no longer be delivered')
  await confirmation.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(confirmation).toHaveCount(0)
  await expect(adminRow).toContainText('active')
  await adminRow.getByTitle('Disable subscription').click()
  confirmation = adminPanel.getByRole('alertdialog', { name: 'Confirm Webhook subscription disable' })
  const disableResponse = page.waitForResponse((response) => /\/api\/admin\/developer\/webhooks\/[^/]+\/disable$/.test(response.url()) && response.request().method() === 'POST')
  await confirmation.getByRole('button', { name: 'Disable subscription', exact: true }).click()
  expect((await disableResponse).status()).toBe(200)
  await expect(adminRow).toContainText('disabled')
  await expect(adminPanel.locator('.admin-action-feedback')).toContainText('Webhook subscription disabled.')
  await expect(page.getByTestId('app-toast')).toHaveCount(0)
  await adminPanel.screenshot({ path: 'test-results/webhooks-admin-desktop.png' })

  await panel.getByTitle('Refresh').click()
  await expect(ownerRow).toContainText('disabled')
  await ownerRow.getByTitle('Delete').click()
  ownerConfirmation = ownerRow.getByRole('alertdialog', { name: 'Confirm Webhook operation' })
  await expect(ownerConfirmation).toContainText('cannot be restored')
  await ownerConfirmation.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(ownerConfirmation).toHaveCount(0)
  expect(ownerDeleteRequests).toBe(0)

  await ownerRow.getByTitle('Delete').click()
  ownerConfirmation = ownerRow.getByRole('alertdialog', { name: 'Confirm Webhook operation' })
  const deleteResponse = ownerPage.waitForResponse((response) => response.request().method() === 'DELETE' && /\/api\/developer\/webhooks\/[^/]+$/.test(response.url()))
  await ownerConfirmation.getByRole('button', { name: 'Delete subscription', exact: true }).click()
  expect((await deleteResponse).status()).toBe(200)
  await expect(ownerRow).toHaveCount(0)
  await expect(panel.locator(':scope > .action-feedback')).toContainText('was deleted')
  expect(ownerRotateRequests).toBe(1)
  expect(ownerDeleteRequests).toBe(1)
  expect(nativeOwnerDialogs).toEqual([])
  await expect(ownerPage.getByTestId('app-toast')).toHaveCount(0)
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
  await selectAdminSection(page, 'Access')
  const adminPanel = page.getByTestId('webhook-admin-panel')
  await expect(adminPanel).toBeVisible()
  await expect(adminPanel.getByTestId('provider-alert-section')).toBeVisible()
  await expect(adminPanel).not.toContainText('No route for /api/admin/provider-alert-deliveries')
  const dismissNotifications = page.getByLabel('Dismiss notification')
  while (await dismissNotifications.count()) await dismissNotifications.first().click()
  const layout = await adminPanel.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return { clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, overflow: element.scrollWidth - element.clientWidth, offenders: [...element.querySelectorAll<HTMLElement>('*')].map((node) => ({ node, rect: node.getBoundingClientRect() })).filter(({ node, rect }) => node.scrollWidth > node.clientWidth + 1 || rect.right > bounds.right + 1).map(({ node, rect }) => ({ tag: node.tagName, className: node.className, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, left: rect.left, right: rect.right, width: rect.width, display: getComputedStyle(node).display, grid: getComputedStyle(node).gridTemplateColumns })).sort((left, right) => right.right - left.right).slice(0, 10) }
  })
  expect(layout.overflow, JSON.stringify(layout.offenders)).toBeLessThanOrEqual(1)
  await adminPanel.screenshot({ path: 'test-results/webhooks-admin-mobile.png' })
})

test('Admin filters and replays a dead-lettered provider alert without exposing destination data', async ({ page, request }) => {
  const sourceKey = 'provider-budget:router:video:80'
  let delivery: ProviderAlertDelivery = {
    id: 'provider-alert-e2e-1',
    sourceKey,
    auditEventId: 'audit-provider-alert-e2e-1',
    channel: 'webhook',
    action: 'creative.provider_budget.threshold_crossed',
    status: 'dead_lettered',
    attemptCount: 5,
    maxAttempts: 5,
    replayCount: 0,
    availableAt: '2026-07-29T08:00:00.000Z',
    lastErrorCode: 'PROVIDER_ALERT_REMOTE_REJECTED',
    lastStatusCode: 403,
    receiptHash: null,
    deliveredAt: null,
    deadLetteredAt: '2026-07-29T08:00:00.000Z',
    version: 6,
    createdAt: '2026-07-29T07:55:00.000Z',
    updatedAt: '2026-07-29T08:00:00.000Z',
  }

  await page.route(/\/api\/admin\/provider-alert-deliveries(?:\?.*)?$/, async (route) => {
    const requestUrl = new URL(route.request().url())
    const status = requestUrl.searchParams.get('status')
    const channel = requestUrl.searchParams.get('channel')
    const matches = (!status || status === delivery.status) && (!channel || channel === delivery.channel)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: matches ? [delivery] : [], meta: { pagination: { limit: 50, nextCursor: null } } }) })
  })
  await page.route(/\/api\/admin\/provider-alert-deliveries\/provider-alert-e2e-1\/replay$/, async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>
    expect(payload).toMatchObject({ expectedVersion: 6, reasonCode: 'provider_channel_recovered', maxAttempts: 5 })
    expect(String(payload.idempotencyKey)).toMatch(/^admin-provider-alert-replay-/)
    delivery = { ...delivery, status: 'queued', maxAttempts: 10, replayCount: 1, version: 7, lastErrorCode: null, lastStatusCode: null, deadLetteredAt: null, updatedAt: '2026-07-29T08:05:00.000Z' }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: delivery }) })
  })

  await signInPage(page, request, 'opsplus')
  await page.goto('/')
  await page.getByTestId('nav-admin').click()
  await selectAdminSection(page, 'Access')

  const section = page.getByTestId('provider-alert-section')
  await expect(section).toBeVisible()
  await expect(section).toContainText(sourceKey)
  await expect(section).toContainText('PROVIDER_ALERT_REMOTE_REJECTED')
  await expect(section).not.toContainText('https://')
  await expect(section).not.toContainText('secret')
  await section.getByRole('button', { name: 'Replay' }).click()
  await expect(section).toContainText('No provider alerts match these filters.')

  await section.getByLabel('Provider alert status').selectOption('')
  await section.getByRole('button', { name: 'Apply' }).click()
  await expect(section).toContainText(sourceKey)
  await expect(section).toContainText('queued')
  await expect(section.getByRole('button', { name: 'Replay' })).toHaveCount(0)
  await section.screenshot({ path: 'test-results/provider-alert-admin-desktop.png' })
})
