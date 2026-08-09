import { expect, test } from '@playwright/test'
import { selectAdminSection, signInPage } from './helpers'

test('personal billing combines points credits quota refunds sources and export', async ({ page, request }) => {
  await signInPage(page, request, 'promptlin')
  await page.goto('/#points')

  const ledger = page.getByTestId('personal-billing-ledger')
  await expect(ledger).toBeVisible()
  await expect(page.getByText('Available points', { exact: true })).toBeVisible()
  await expect(page.getByText('Creative credits', { exact: true })).toBeVisible()
  await expect(page.getByText('Quota remaining', { exact: true })).toBeVisible()
  await ledger.getByLabel('Billing unit').selectOption('points')
  await expect(ledger.locator('.billing-ledger-row').first()).toContainText('points')

  const download = page.waitForEvent('download')
  await ledger.getByRole('button', { name: 'Export billing CSV' }).click()
  await expect((await download).suggestedFilename()).toBe('billing-ledger.csv')
})

test('admin previews billing policy impact and filters safe accounting metrics on mobile', async ({ page, request }) => {
  await signInPage(page, request, 'opsplus')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Toggle navigation' }).click()
  await page.getByTestId('nav-admin').click()
  await selectAdminSection(page, 'Accounting')

  const panel = page.getByTestId('admin-accounting-reconciliation')
  await expect(panel).toBeVisible()
  await expect(panel.getByText('Point policy version')).toBeVisible()
  await expect(panel.getByText('Creative policy', { exact: true })).toBeVisible()
  await expect(panel.getByText('Internal units', { exact: true })).toBeVisible()
  await expect(panel.getByText('Points consumed', { exact: true })).toBeVisible()
  await expect(panel.getByText('Creative credits', { exact: true })).toBeVisible()
  await expect(panel.getByText('Quota used', { exact: true })).toBeVisible()
  await expect(panel.getByText('Open anomalies', { exact: true })).toBeVisible()
  const personal = panel.getByTestId('admin-personal-billing')
  await expect(personal.getByText('Selected user billing')).toBeVisible()
  await expect(personal.getByText('Available points', { exact: true })).toBeVisible()
  await expect(personal.getByText('Settled credits', { exact: true })).toBeVisible()
  await expect(personal.getByText('Quota remaining', { exact: true })).toBeVisible()

  await expect(page.getByLabel('admin point adjustment limit')).not.toHaveValue('')
  await panel.getByRole('button', { name: 'Preview policy impact' }).click()
  await expect(panel.locator('.billing-policy-impact')).toContainText('creative runtime unchanged')
  await expect(panel.locator('.admin-action-feedback')).toContainText('Billing policy impact preview generated.')
  await expect(page.getByTestId('app-toast')).toHaveCount(0)

  const scanResponse = page.waitForResponse((response) => response.url().includes('/api/admin/accounting/reconciliation/scan') && response.request().method() === 'POST')
  await panel.getByRole('button', { name: 'Run scan', exact: true }).click()
  expect((await scanResponse).ok()).toBeTruthy()
  await expect(panel.locator('.admin-action-feedback')).toContainText(/Accounting scan complete/)
  await expect(page.getByTestId('app-toast')).toHaveCount(0)

  await panel.getByLabel('Billing metric unit').selectOption('points')
  await panel.getByLabel('Billing metric source').fill('generation')
  await expect(panel.getByText('Points consumed', { exact: true })).toBeVisible()

  const download = page.waitForEvent('download')
  await panel.getByRole('button', { name: 'Export accounting metrics JSON' }).click()
  await expect((await download).suggestedFilename()).toBe('accounting-business-metrics.json')
  await expect(page.locator('a[download="accounting-business-metrics.json"]')).toHaveCount(0)

  const layout = await panel.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return {
      insideViewport: rect.left >= 0 && rect.right <= document.documentElement.clientWidth,
      noInternalOverflow: element.scrollWidth <= element.clientWidth,
      geometry: { left: rect.left, right: rect.right, viewport: document.documentElement.clientWidth, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth },
    }
  })
  expect(layout, JSON.stringify(layout.geometry)).toMatchObject({ insideViewport: true, noInternalOverflow: true })
})

test('admin saves and rolls back a versioned point adjustment policy', async ({ page, request }) => {
  await signInPage(page, request, 'opsplus')
  await page.goto('/')
  await page.getByTestId('nav-admin').click()
  await selectAdminSection(page, 'Finance')
  const financePanel = page.getByTestId('admin-finance-ledger')

  const adminLimit = page.getByLabel('admin point adjustment limit')
  await expect(adminLimit).not.toHaveValue('')
  const originalLimit = Number(await adminLimit.inputValue())
  await adminLimit.fill(String(originalLimit + 1))

  const saveResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/admin/points/policy') && response.request().method() === 'PUT')
  await page.getByRole('button', { name: 'Save policy', exact: true }).click()
  expect((await saveResponse).status()).toBe(200)
  await expect(adminLimit).toHaveValue(String(originalLimit + 1))
  await expect(financePanel.locator('.admin-action-feedback')).toContainText('Updated point adjustment policy.')
  await expect(page.getByTestId('app-toast')).toHaveCount(0)

  const historyRow = page.locator('.policy-history-row').first()
  await expect(historyRow).toContainText('updated')
  const rollbackResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/admin/points/policy/rollback') && response.request().method() === 'POST')
  await historyRow.getByRole('button', { name: 'Rollback', exact: true }).click()
  expect((await rollbackResponse).status()).toBe(200)
  await expect(adminLimit).toHaveValue(String(originalLimit))
  await expect(financePanel.locator('.admin-action-feedback')).toContainText('Rolled back point adjustment policy.')
  await expect(page.getByTestId('app-toast')).toHaveCount(0)
})
