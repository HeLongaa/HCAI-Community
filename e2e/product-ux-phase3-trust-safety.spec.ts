import { expect, test } from '@playwright/test'

import { selectAdminSection, selectTrustSafetyWorkspace, signInPage } from './helpers'

const openTrustSafety = async (page: import('@playwright/test').Page) => {
  await page.goto('/#admin')
  await selectAdminSection(page, 'Trust & Safety')
  const workspace = page.getByTestId('trust-safety-workspace')
  await expect(workspace).toBeVisible()
  return workspace
}

test('Trust and Safety separates four durable operational workspaces', async ({ page, request }) => {
  await signInPage(page, request, 'opsplus')
  const workspace = await openTrustSafety(page)
  const tabs = workspace.getByRole('tablist', { name: 'Trust and Safety workspace' })

  await expect(tabs.getByRole('tab')).toHaveCount(4)
  await expect(tabs.getByRole('tab', { name: 'Cases workspace' })).toHaveAttribute('aria-selected', 'true')
  await expect(workspace.getByTestId('trust-admin-panel')).toHaveAttribute('data-view', 'cases')
  await expect(workspace.getByTestId('risk-admin-panel')).toHaveAttribute('data-view', 'cases')
  await expect(workspace.getByTestId('trust-safety-operations')).toHaveCount(0)

  await selectTrustSafetyWorkspace(page, 'policies')
  await expect(workspace).toHaveAttribute('data-workspace', 'policies')
  await expect(workspace.getByTestId('trust-safety-operations')).toHaveAttribute('data-view', 'rules')
  await expect(workspace.getByTestId('risk-admin-policy')).toBeVisible()
  await expect(workspace.getByTestId('trust-admin-panel')).toHaveCount(0)

  await selectTrustSafetyWorkspace(page, 'operations')
  await expect(workspace.getByTestId('trust-safety-operations')).toHaveAttribute('data-view', 'queue')
  await expect(workspace.getByTestId('risk-admin-panel')).toHaveCount(0)
  await expect(workspace.getByTestId('trust-admin-panel')).toHaveCount(0)

  await selectTrustSafetyWorkspace(page, 'evidence')
  await expect(workspace.getByTestId('trust-admin-panel')).toHaveAttribute('data-view', 'evidence')
  await expect(workspace.getByTestId('risk-admin-panel')).toHaveAttribute('data-view', 'evidence')
  await expect(workspace.getByTestId('trust-safety-operations')).toHaveAttribute('data-view', 'signals')
  const caseDownload = page.waitForEvent('download')
  await workspace.getByTestId('trust-admin-panel').getByRole('button', { name: 'Export', exact: true }).click()
  expect((await caseDownload).suggestedFilename()).toMatch(/^moderation-cases-\d{4}-\d{2}-\d{2}\.json$/)
  await expect(page.locator('a[download^="moderation-cases-"]')).toHaveCount(0)
  const riskDownload = page.waitForEvent('download')
  await workspace.getByTestId('risk-admin-panel').getByTitle('Export risk evidence').click()
  expect((await riskDownload).suggestedFilename()).toMatch(/^risk-cases-\d{4}-\d{2}-\d{2}\.json$/)
  await expect(page.locator('a[download^="risk-cases-"]')).toHaveCount(0)
  await expect(page.getByTestId('app-toast')).toHaveCount(0)

  await page.reload()
  await expect(workspace).toHaveAttribute('data-workspace', 'evidence')
  await expect(workspace.getByTestId('trust-safety-operations')).toHaveAttribute('data-view', 'signals')
})

test('Trust and Safety preserves moderator permission boundaries', async ({ page, request }) => {
  await signInPage(page, request, 'legalpixel')
  const workspace = await openTrustSafety(page)

  await selectTrustSafetyWorkspace(page, 'policies')
  await expect(workspace.getByRole('button', { name: 'Create version' })).toHaveCount(0)
  await expect(workspace.getByRole('button', { name: 'Save policy' })).toBeDisabled()

  await selectTrustSafetyWorkspace(page, 'operations')
  await expect(workspace.getByTestId('trust-safety-operations')).toHaveAttribute('data-view', 'queue')
  await expect(workspace.getByLabel('Assignee ID')).toBeVisible()

  await selectTrustSafetyWorkspace(page, 'evidence')
  await expect(workspace.getByRole('button', { name: 'Export', exact: true })).toBeDisabled()
  await expect(page.getByTestId('app-toast')).toHaveCount(0)
})

test('Trust and Safety keeps the same structure in light and dark themes', async ({ page, request }) => {
  await signInPage(page, request, 'opsplus')
  const workspace = await openTrustSafety(page)

  for (const theme of ['white', 'black']) {
    await page.evaluate((mode) => window.localStorage.setItem('hcaiThemeMode', mode), theme)
    await page.reload()
    await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', theme)
    await expect(workspace.getByRole('tab')).toHaveCount(4)
    await expect(workspace.locator('.trust-workspace-select option')).toHaveCount(4)
  }
})

test('Trust and Safety uses one mobile selector without horizontal overflow', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInPage(page, request, 'opsplus')
  const workspace = await openTrustSafety(page)

  await expect(workspace.locator('.trust-workspace-tabs')).toBeHidden()
  const selector = workspace.locator('.trust-workspace-select select')
  await expect(selector).toBeVisible()
  await expect(selector.locator('option')).toHaveCount(4)
  await selectTrustSafetyWorkspace(page, 'operations')
  await expect(workspace).toHaveAttribute('data-workspace', 'operations')

  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth)
  expect(await workspace.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
})
