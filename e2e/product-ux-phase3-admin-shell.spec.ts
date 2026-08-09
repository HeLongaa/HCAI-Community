import { expect, test } from '@playwright/test'

import { selectAdminSection, signInPage } from './helpers'

test('phase 3 admin shell uses grouped desktop navigation with durable selection', async ({ page, request }) => {
  await signInPage(page, request, 'opsplus')
  await page.goto('/#admin')

  const rail = page.getByTestId('admin-section-rail')
  await expect(rail).toBeVisible()
  await expect(rail.locator('.admin-section-group')).toHaveCount(5)
  await expect(rail.getByRole('button')).toHaveCount(20)
  await expect(rail.getByRole('button', { name: 'Overview', exact: true })).toHaveAttribute('aria-current', 'page')

  await selectAdminSection(page, 'AI config')
  await expect(rail.getByRole('button', { name: 'AI config', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('admin-current-section')).toContainText('Configure providers, models, routing, and evaluation gates.')
  await expect(page.getByTestId('app-toast')).toHaveCount(0)

  await page.reload()
  await expect(rail.getByRole('button', { name: 'AI config', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('model-control-panel')).toBeVisible()
})

test('phase 3 admin shell preserves structure in both themes', async ({ page, request }) => {
  await signInPage(page, request, 'opsplus')
  await page.goto('/#admin')

  for (const theme of ['white', 'black']) {
    await page.evaluate((mode) => window.localStorage.setItem('hcaiThemeMode', mode), theme)
    await page.reload()
    await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', theme)
    await expect(page.getByTestId('admin-section-rail')).toBeVisible()
    await expect(page.getByTestId('admin-current-section')).toBeVisible()
  }
})

test('phase 3 admin shell uses one grouped mobile selector without overflow', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInPage(page, request, 'opsplus')
  await page.goto('/#admin')

  await expect(page.getByTestId('admin-section-rail')).toBeHidden()
  const sectionSelect = page.locator('.admin-tab-select select')
  await expect(sectionSelect).toBeVisible()
  await expect(sectionSelect.locator('optgroup')).toHaveCount(5)

  await selectAdminSection(page, 'Generations')
  await expect(sectionSelect).toHaveValue('Generations')
  await expect(page.getByTestId('admin-current-section')).toContainText('Operate generation history, recovery, and provider controls.')
  await expect(page.getByTestId('app-toast')).toHaveCount(0)

  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth)
})
