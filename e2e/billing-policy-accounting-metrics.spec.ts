import { expect, test } from '@playwright/test'
import { signInPage } from './helpers'

test('admin previews billing policy impact and filters safe accounting metrics on mobile', async ({ page, request }) => {
  await signInPage(page, request, 'opsplus')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Toggle navigation' }).click()
  await page.getByTestId('nav-admin').click()
  await page.getByRole('button', { name: 'Accounting', exact: true }).click()

  const panel = page.getByTestId('admin-accounting-reconciliation')
  await expect(panel).toBeVisible()
  await expect(panel.getByText('Point policy version')).toBeVisible()
  await expect(panel.getByText('Creative policy', { exact: true })).toBeVisible()
  await expect(panel.getByText('Internal units', { exact: true })).toBeVisible()
  await expect(panel.getByText('Points consumed', { exact: true })).toBeVisible()
  await expect(panel.getByText('Creative credits', { exact: true })).toBeVisible()
  await expect(panel.getByText('Quota used', { exact: true })).toBeVisible()
  await expect(panel.getByText('Open anomalies', { exact: true })).toBeVisible()

  await expect(page.getByLabel('admin point adjustment limit')).not.toHaveValue('')
  await panel.getByRole('button', { name: 'Preview policy impact' }).click()
  await expect(panel.locator('.billing-policy-impact')).toContainText('creative runtime unchanged')

  await panel.getByLabel('Billing metric unit').selectOption('points')
  await panel.getByLabel('Billing metric source').fill('generation')
  await expect(panel.getByText('Points consumed', { exact: true })).toBeVisible()

  const download = page.waitForEvent('download')
  await panel.getByRole('button', { name: 'Export accounting metrics JSON' }).click()
  await expect((await download).suggestedFilename()).toBe('accounting-business-metrics.json')

  expect(await panel.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return rect.left >= 0 && rect.right <= document.documentElement.clientWidth && element.scrollWidth <= element.clientWidth
  })).toBe(true)
})
