import { expect, test } from '@playwright/test'

import { apiBaseUrl, apiData, authHeaders, login, signInPage } from './helpers'

const schema = JSON.stringify({ required: ['taskTitle'], properties: { taskTitle: { type: 'string', maxLength: 120 } } }, null, 2)

test('Admin publishes a notification template and the user preference suppresses its delivery', async ({ page, request }) => {
  const key = `task.e2e_${Date.now()}`
  await signInPage(page, request, 'opsplus')
  await page.goto('/')
  await page.getByTestId('nav-admin').click()
  await page.getByRole('button', { name: 'Notifications', exact: true }).click()

  const panel = page.getByTestId('notification-admin-panel')
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: 'New', exact: true }).click()
  await panel.getByLabel('Template key').fill(key)
  await panel.getByLabel('Template name').fill('E2E task notification')
  await panel.getByLabel('Category').fill('task')
  await panel.getByLabel('Title template').fill('Ready: {{taskTitle}}')
  await panel.getByLabel('Body template').fill('{{taskTitle}} is ready for review.')
  await panel.getByLabel('Variable schema').fill(schema)
  const createdResponse = page.waitForResponse((response) => response.url().endsWith('/api/admin/notifications/templates') && response.request().method() === 'POST')
  await panel.getByRole('button', { name: 'Save draft' }).click()
  expect((await createdResponse).status()).toBe(201)

  await panel.getByLabel('Preview variables').fill(JSON.stringify({ taskTitle: 'Launch visual' }))
  await panel.getByRole('button', { name: 'Preview' }).click()
  await expect(panel).toContainText('Ready: Launch visual')
  const publishResponse = page.waitForResponse((response) => response.url().endsWith('/publish') && response.request().method() === 'POST')
  await panel.getByRole('button', { name: 'Publish v1' }).click()
  expect((await publishResponse).status()).toBe(200)
  const testResponse = page.waitForResponse((response) => response.url().endsWith('/send-test') && response.request().method() === 'POST')
  await panel.getByRole('button', { name: 'Send test' }).click()
  expect((await testResponse).status()).toBe(201)

  await page.getByRole('tab', { name: 'Delivery queue' }).click()
  const deliveryPanel = page.getByTestId('notification-delivery-panel')
  await expect(deliveryPanel).toBeVisible()
  await expect(deliveryPanel).toContainText('Email unavailable')
  await expect(deliveryPanel).toContainText('Ready: Launch visual')
  await page.getByRole('tab', { name: 'Templates' }).click()

  await page.locator('.notification-trigger').click()
  await expect(page.locator('.notification-popover')).toContainText('Ready: Launch visual')
  await page.getByRole('button', { name: 'Notification preferences' }).click()
  const preference = page.getByLabel(`In-app ${key}`)
  await expect(preference).toBeChecked()
  const preferenceResponse = page.waitForResponse((response) => response.url().includes(`/api/notifications/preferences/${encodeURIComponent(key)}`) && response.request().method() === 'PUT')
  await preference.click()
  expect((await preferenceResponse).status()).toBe(200)
  await expect(preference).not.toBeChecked()

  const admin = await login(request, 'opsplus')
  const templatePage = await apiData<Array<{ id: string }>>(request.get(`${apiBaseUrl}/api/admin/notifications/templates?search=${encodeURIComponent(key)}`, { headers: authHeaders(admin.accessToken) }))
  const suppressed = await request.post(`${apiBaseUrl}/api/admin/notifications/templates/${templatePage[0].id}/send-test`, {
    headers: authHeaders(admin.accessToken), data: { variables: { taskTitle: 'Suppressed task' } },
  })
  expect(suppressed.status()).toBe(409)
  expect((await suppressed.json()).error.code).toBe('NOTIFICATION_PREFERENCE_DISABLED')
})

test('notification template operations and preferences remain bounded on mobile', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInPage(page, request, 'opsplus')
  await page.goto('/')
  await page.getByRole('button', { name: 'Toggle navigation' }).click()
  await page.getByTestId('nav-admin').click()
  await page.getByRole('button', { name: 'Notifications', exact: true }).click()
  const panel = page.getByTestId('notification-admin-panel')
  await expect(panel).toBeVisible()
  const overflow = await panel.evaluate((element) => {
    const panelRect = element.getBoundingClientRect()
    return [...element.querySelectorAll<HTMLElement>('*')]
      .filter((node) => {
        const rect = node.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0 && (rect.left < panelRect.left - 2 || rect.right > panelRect.right + 2)
      })
      .map((node) => `${node.tagName}:${Math.round(node.getBoundingClientRect().left)}/${Math.round(node.getBoundingClientRect().right)}`)
      .slice(0, 10)
  })
  expect(overflow).toEqual([])
  await panel.screenshot({ path: 'test-results/notification-admin-mobile.png' })

  await page.getByRole('tab', { name: 'Delivery queue' }).click()
  const deliveryPanel = page.getByTestId('notification-delivery-panel')
  await expect(deliveryPanel).toBeVisible()
  const deliveryOverflow = await deliveryPanel.evaluate((element) => {
    const panelRect = element.getBoundingClientRect()
    return [...element.querySelectorAll<HTMLElement>('*')]
      .filter((node) => {
        const rect = node.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0 && (rect.left < panelRect.left - 2 || rect.right > panelRect.right + 2)
      })
      .map((node) => `${node.tagName}:${Math.round(node.getBoundingClientRect().left)}/${Math.round(node.getBoundingClientRect().right)}`)
      .slice(0, 10)
  })
  expect(deliveryOverflow).toEqual([])
  await deliveryPanel.screenshot({ path: 'test-results/notification-delivery-mobile.png' })
})
