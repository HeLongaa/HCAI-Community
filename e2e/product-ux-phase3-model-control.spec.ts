import { expect, test } from '@playwright/test'

import { signInPage } from './helpers'

test('AI config separates catalog runtime and governance work', async ({ page, request }) => {
  await signInPage(page, request, 'opsplus')
  await page.goto('/#admin')
  await page.getByRole('button', { name: 'AI config', exact: true }).click()

  const panel = page.getByTestId('model-control-panel')
  const workspaceTabs = panel.getByRole('tablist', { name: 'AI configuration workspace' })
  await expect(workspaceTabs.getByRole('tab')).toHaveCount(3)
  await expect(workspaceTabs.getByRole('tab', { name: 'Catalog workspace', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(panel.getByRole('button', { name: 'Providers', exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Routing', exact: true })).toHaveCount(0)
  await expect(panel.getByTestId('model-governance-workbench')).toHaveCount(0)

  await workspaceTabs.getByRole('tab', { name: 'Runtime & routing', exact: true }).click()
  await expect(panel).toHaveAttribute('data-workspace', 'runtime')
  await expect(panel.getByRole('button', { name: 'Deployments', exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Routing', exact: true })).toBeVisible()
  await expect(panel.getByTestId('chat-production-readiness')).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Providers', exact: true })).toHaveCount(0)

  await workspaceTabs.getByRole('tab', { name: 'Evaluation & governance', exact: true }).click()
  await expect(panel).toHaveAttribute('data-workspace', 'governance')
  await expect(panel.getByTestId('model-governance-workbench')).toBeVisible()
  await expect(panel.locator('.model-control-layout')).toHaveCount(0)
  await expect(page.getByTestId('app-toast')).toHaveCount(0)

  await page.reload()
  await expect(panel).toHaveAttribute('data-workspace', 'governance')
  await expect(panel.getByTestId('model-governance-workbench')).toBeVisible()
})

test('AI config uses one workspace selector on mobile without overflow', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInPage(page, request, 'opsplus')
  await page.goto('/#admin')
  await page.locator('.admin-tab-select select').selectOption({ label: 'AI config' })

  const panel = page.getByTestId('model-control-panel')
  await expect(panel.locator('.model-workspace-tabs')).toBeHidden()
  const workspaceSelect = panel.locator('.model-workspace-select select')
  await expect(workspaceSelect).toBeVisible()
  await expect(workspaceSelect.locator('option')).toHaveCount(3)
  await workspaceSelect.selectOption('runtime')
  await expect(panel).toHaveAttribute('data-workspace', 'runtime')

  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth)
})
