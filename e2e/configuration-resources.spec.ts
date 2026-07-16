import { expect, test } from '@playwright/test'

import { signInPage } from './helpers'

test('admin manages a feature flag through publish, rollback, archive, and restore', async ({ page, request }) => {
  await signInPage(page, request, 'opsplus')
  await page.goto('/')
  await page.getByTestId('nav-admin').click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()

  const panel = page.getByTestId('admin-config-resources')
  await expect(panel).toBeVisible()
  await panel.getByTitle('New').click()
  const key = `e2e.flag.${Date.now()}`
  await panel.getByLabel('Key').fill(key)
  await panel.getByLabel('Title').fill('E2E editor flag')
  await panel.getByLabel('Description').fill('Managed through the configuration resource console.')
  await panel.getByLabel('Resource JSON').fill(JSON.stringify({ enabled: false, payload: { variant: 'control' } }, null, 2))

  const createResponse = page.waitForResponse((response) => response.url().endsWith('/api/admin/config-resources/feature_flag') && response.request().method() === 'POST')
  await panel.getByRole('button', { name: 'Save draft' }).click()
  await createResponse
  await expect(panel).toContainText(key)

  await panel.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(panel.locator('.settings-history-list')).toContainText('v1 · published')

  await panel.getByLabel('Resource JSON').fill(JSON.stringify({ enabled: true, payload: { variant: 'treatment' } }, null, 2))
  await panel.getByRole('button', { name: 'Save draft' }).click()
  await panel.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(panel.locator('.settings-history-list')).toContainText('v2 · published')

  await panel.getByTitle('Rollback to version 1').click()
  await expect(panel.locator('.settings-history-list')).toContainText('v3 · rolled back')
  await expect(panel.getByLabel('Resource JSON')).toHaveValue(/"enabled": false/)

  await panel.getByRole('button', { name: 'Archive', exact: true }).click()
  await panel.getByLabel('Archive status').selectOption('deleted')
  await expect(panel.getByRole('button', { name: new RegExp(key) })).toBeVisible()
  await panel.getByRole('button', { name: new RegExp(key) }).click()
  await panel.getByRole('button', { name: 'Restore', exact: true }).click()
  await expect(panel).toContainText('v3')

  const desktopOverflow = await panel.evaluate((root) => [...root.querySelectorAll('*')]
    .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1).length)
  expect(desktopOverflow).toBe(0)

  await page.setViewportSize({ width: 390, height: 844 })
  const mobileLayout = await panel.evaluate((root) => {
    const bounds = root.getBoundingClientRect()
    return {
      left: Math.round(bounds.left),
      right: Math.round(bounds.right),
      overflow: [...root.querySelectorAll('*')].filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1).length,
    }
  })
  expect(mobileLayout).toEqual({ left: 12, right: 378, overflow: 0 })
})

test('moderator sees all configuration domains without mutation controls', async ({ page, request }) => {
  await signInPage(page, request, 'legalpixel')
  await page.goto('/')
  await page.getByTestId('nav-admin').click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()

  const panel = page.getByTestId('admin-config-resources')
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('tab', { name: 'Feature flags' })).toBeVisible()
  await expect(panel.getByRole('tab', { name: 'Reference data' })).toBeVisible()
  await expect(panel.getByRole('tab', { name: 'Announcements' })).toBeVisible()
  await panel.getByRole('tab', { name: 'Reference data' }).click()
  await expect(panel.getByTitle('Export JSON')).toBeVisible()
  await expect(panel.getByTitle('Import JSON')).toHaveCount(0)
  await expect(panel.getByTitle('New')).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Save draft' })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0)
})
