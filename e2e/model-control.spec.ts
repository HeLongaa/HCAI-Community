import { expect, test } from '@playwright/test'

import { signInPage } from './helpers'

test('admin builds an offline model registry and explainable route without enabling traffic', async ({ page, request }) => {
  await signInPage(page, request, 'opsplus')
  await page.goto('/')
  await page.getByTestId('nav-admin').click()
  await page.getByRole('button', { name: 'AI config', exact: true }).click()

  const panel = page.getByTestId('model-control-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('Real Provider traffic disabled')

  const suffix = Date.now().toString(36)
  await panel.getByLabel('Provider key').fill(`e2e-provider-${suffix}`)
  await panel.getByLabel('Provider name').fill(`E2E Provider ${suffix}`)
  await panel.getByLabel('Provider website').fill('https://provider.example.com')
  await panel.getByRole('button', { name: 'New draft' }).click()
  await expect(panel.locator('.model-control-row').filter({ hasText: `E2E Provider ${suffix}` })).toBeVisible()

  await panel.getByRole('button', { name: 'Models', exact: true }).click()
  await panel.getByLabel('Provider').selectOption({ label: `E2E Provider ${suffix}` })
  await panel.getByLabel('Model key').fill(`e2e-model-${suffix}`)
  await panel.getByLabel('Model name').fill(`E2E Model ${suffix}`)
  await panel.getByRole('button', { name: 'New draft' }).click()
  await expect(panel.locator('.model-control-row').filter({ hasText: `E2E Model ${suffix}` })).toBeVisible()

  await panel.getByRole('button', { name: 'Versions', exact: true }).click()
  await panel.getByLabel('Model').selectOption({ label: `E2E Model ${suffix}` })
  await panel.getByLabel('Version key').fill(`v-${suffix}`)
  await panel.getByLabel('Context window').fill('8192')
  await panel.getByRole('button', { name: 'New draft' }).click()
  await expect(panel.locator('.model-control-row').filter({ hasText: `v-${suffix}` })).toBeVisible()
  await expect(panel.locator('.model-version-counts')).toContainText('0 deployments')
  await panel.getByPlaceholder('deployment-key').fill(`route-deployment-${suffix}`)
  await panel.getByPlaceholder('region').fill('us')
  await panel.getByPlaceholder('deployment-ref').fill(`offline-ref-${suffix}`)
  await panel.getByTitle('Create deployment').click()
  await expect(panel.locator('.model-version-counts')).toContainText('1 deployments')

  await panel.getByRole('button', { name: 'Routing', exact: true }).click()
  await panel.getByLabel('Route key').fill(`route-${suffix}`)
  await panel.getByLabel('Route name').fill(`E2E Route ${suffix}`)
  await panel.getByRole('button', { name: 'New draft' }).click()
  await expect(panel.locator('.model-control-row').filter({ hasText: `E2E Route ${suffix}` })).toBeVisible()
  await panel.getByLabel('Primary deployment').selectOption({ label: `route-deployment-${suffix}` })
  await panel.getByTitle('Save route targets').click()
  await panel.getByRole('button', { name: 'active', exact: true }).click()
  await panel.getByTitle('Run route preview').click()
  await expect(panel.getByTestId('model-route-preview')).toContainText('unavailable')
  await expect(panel.getByTestId('model-route-preview')).toContainText('all_candidates_blocked')

  await page.setViewportSize({ width: 390, height: 844 })
  const layout = await panel.evaluate((element) => {
    const width = document.documentElement.clientWidth
    const panelRect = element.getBoundingClientRect()
    const overflow = [...element.querySelectorAll('*')].map((child) => {
      const rect = child.getBoundingClientRect()
      return { tag: child.tagName, className: child.className, left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) }
    }).filter((item) => item.right > width + 1).slice(0, 8)
    return { width, panel: { left: Math.round(panelRect.left), right: Math.round(panelRect.right), width: Math.round(panelRect.width), grid: getComputedStyle(element).gridTemplateColumns }, overflow }
  })
  expect(layout.overflow, JSON.stringify(layout)).toEqual([])
})

test('moderator can inspect the model registry but cannot mutate it', async ({ page, request }) => {
  await signInPage(page, request, 'legalpixel')
  await page.goto('/')
  await page.getByTestId('nav-admin').click()
  await page.getByRole('button', { name: 'AI config', exact: true }).click()

  const panel = page.getByTestId('model-control-panel')
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('button', { name: 'New draft' })).toHaveCount(0)
  await expect(panel.getByTitle('Export configuration')).toBeVisible()
  await panel.getByRole('button', { name: 'Routing', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'New draft' })).toHaveCount(0)
})
