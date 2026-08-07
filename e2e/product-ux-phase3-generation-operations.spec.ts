import { expect, test } from '@playwright/test'

import { selectAdminSection, selectGenerationOperationsWorkspace, signInPage } from './helpers'

const openGenerationOperations = async (page: import('@playwright/test').Page) => {
  await page.goto('/#admin')
  await selectAdminSection(page, 'Generations')
  const workspace = page.getByTestId('generation-operations-workspace')
  await expect(workspace).toBeVisible()
  return workspace
}

test('Generations separates records recovery providers and metrics', async ({ page, request }) => {
  await signInPage(page, request, 'opsplus')
  const workspace = await openGenerationOperations(page)
  const tabs = workspace.getByRole('tablist', { name: 'Generation operations workspace' })
  const recordsPanel = page.getByTestId('admin-generation-history')
  const providerPanel = page.getByTestId('admin-provider-controls')

  await expect(tabs.getByRole('tab')).toHaveCount(4)
  await expect(tabs.getByRole('tab', { name: 'Generation records workspace' })).toHaveAttribute('aria-selected', 'true')
  await expect(recordsPanel).toHaveAttribute('data-workspace', 'records')
  await expect(recordsPanel.getByTestId('admin-generation-bulk-actions')).toBeVisible()
  await expect(recordsPanel.getByTestId('admin-generation-recovery')).toHaveCount(0)
  await expect(recordsPanel.getByTestId('admin-generation-metrics-filters')).toHaveCount(0)
  await expect(providerPanel).toBeHidden()

  const requests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/admin/creative/')) requests.push(request.url())
  })

  await selectGenerationOperationsWorkspace(page, 'recovery')
  await expect(recordsPanel).toHaveAttribute('data-workspace', 'recovery')
  await expect(recordsPanel.getByTestId('admin-generation-recovery')).toBeVisible()
  await expect(recordsPanel.getByLabel('Execution recovery reason')).toBeVisible()
  await expect(recordsPanel.getByTestId('admin-generation-bulk-actions')).toHaveCount(0)
  await expect(recordsPanel.getByTestId('admin-generation-metrics-filters')).toHaveCount(0)
  await expect.poll(() => requests.some((url) => url.includes('/creative/executions'))).toBe(true)

  requests.length = 0
  await selectGenerationOperationsWorkspace(page, 'providers')
  await expect(providerPanel).toBeVisible()
  await expect(providerPanel.getByLabel('Provider control reason code')).toBeVisible()
  await expect(recordsPanel).toBeHidden()
  await expect.poll(() => requests.some((url) => url.includes('/creative/provider-controls'))).toBe(true)
  expect(requests.some((url) => url.includes('/creative/executions'))).toBe(false)

  requests.length = 0
  await selectGenerationOperationsWorkspace(page, 'metrics')
  await expect(recordsPanel).toHaveAttribute('data-workspace', 'metrics')
  await expect(recordsPanel.getByTestId('admin-generation-metrics-filters')).toBeVisible()
  await expect(recordsPanel.getByTestId('generation-business-metrics')).toBeVisible()
  await expect(recordsPanel.getByTestId('admin-generation-bulk-actions')).toHaveCount(0)
  await expect.poll(() => requests.some((url) => url.includes('/creative/generations/business-metrics'))).toBe(true)
  expect(requests.some((url) => url.includes('/creative/executions'))).toBe(false)
  expect(requests.some((url) => url.includes('/creative/provider-controls'))).toBe(false)
  await expect(page.getByTestId('app-toast')).toHaveCount(0)

  await page.reload()
  await expect(workspace).toHaveAttribute('data-workspace', 'metrics')
  await expect(recordsPanel.getByTestId('generation-business-metrics')).toBeVisible()
})

test('Generations preserves the same workspace structure in both themes', async ({ page, request }) => {
  await signInPage(page, request, 'opsplus')
  const workspace = await openGenerationOperations(page)

  for (const theme of ['white', 'black']) {
    await page.evaluate((mode) => window.localStorage.setItem('hcaiThemeMode', mode), theme)
    await page.reload()
    await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', theme)
    await expect(workspace.getByRole('tab')).toHaveCount(4)
    await expect(workspace.locator('.generation-workspace-select option')).toHaveCount(4)
  }
})

test('Generations uses one mobile workspace selector without horizontal overflow', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInPage(page, request, 'opsplus')
  const workspace = await openGenerationOperations(page)

  await expect(workspace.locator('.generation-workspace-tabs')).toBeHidden()
  const selector = workspace.locator('.generation-workspace-select select')
  await expect(selector).toBeVisible()
  await expect(selector.locator('option')).toHaveCount(4)
  await selectGenerationOperationsWorkspace(page, 'metrics')
  await expect(workspace).toHaveAttribute('data-workspace', 'metrics')
  await expect(page.getByTestId('admin-generation-history').getByTestId('generation-business-metrics')).toBeVisible()
  await page.getByTestId('generation-business-metrics').scrollIntoViewIfNeeded()

  const stickyBounds = await page.locator('.admin-tab-select').evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return { top: Math.round(bounds.top), bottom: Math.round(bounds.bottom) }
  })
  expect(stickyBounds.top).toBeGreaterThanOrEqual(60)
  expect(stickyBounds.bottom).toBeLessThanOrEqual(844)

  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth)
  expect(await workspace.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
})
