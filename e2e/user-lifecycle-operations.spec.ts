import { expect, test } from '@playwright/test'

import { signInPage } from './helpers'

test('User lifecycle workbench manages metrics and audited tag assignments', async ({ page, request }) => {
  await signInPage(page, request, 'opsplus')
  await page.goto('/')
  await page.getByTestId('nav-admin').click()
  await page.getByRole('button', { name: 'Users', exact: true }).click()

  const panel = page.getByTestId('user-admin-panel')
  await expect(panel.getByTestId('user-lifecycle-metrics')).toBeVisible()
  await expect(panel.getByText('D7', { exact: true })).toBeVisible()
  await expect(panel.getByTestId('user-tag-operations')).toBeVisible()

  await panel.getByRole('button', { name: 'Create user tag' }).click()
  await panel.getByLabel('User tag key').fill('e2e.lifecycle')
  await panel.getByLabel('User tag label').fill('Lifecycle cohort')
  await panel.getByLabel('User tag description').fill('Browser acceptance cohort')
  await panel.getByLabel('User tag color').selectOption('green')
  const createResponse = page.waitForResponse((response) => response.url().endsWith('/api/admin/user-tags') && response.request().method() === 'POST')
  await panel.getByRole('button', { name: 'Save', exact: true }).click()
  expect((await createResponse).status()).toBe(201)
  await expect(panel.getByRole('button', { name: 'Lifecycle cohort e2e.lifecycle' })).toBeVisible()

  await panel.getByLabel('User search').fill('taskops')
  await panel.getByRole('button', { name: 'Apply user filters' }).click()
  const row = panel.locator('.user-admin-row').filter({ hasText: 'taskops' })
  await expect(row).toBeVisible()
  await row.click()

  const assignResponse = page.waitForResponse((response) => /\/api\/admin\/users\/[^/]+\/tags\/[^/]+\/assign$/.test(response.url()))
  await panel.getByLabel('Assign user tag').selectOption({ label: 'Lifecycle cohort' })
  expect((await assignResponse).status()).toBe(200)
  await expect(panel.getByRole('button', { name: 'Remove Lifecycle cohort' })).toBeVisible()

  await panel.getByLabel('User tag filter').selectOption('e2e.lifecycle')
  await panel.getByRole('button', { name: 'Apply user filters' }).click()
  await expect(panel.locator('.user-admin-row').filter({ hasText: 'taskops' })).toBeVisible()

  const removeResponse = page.waitForResponse((response) => /\/api\/admin\/users\/[^/]+\/tags\/[^/]+\/remove$/.test(response.url()))
  await panel.getByRole('button', { name: 'Remove Lifecycle cohort' }).click()
  expect((await removeResponse).status()).toBe(200)
  await expect(panel.getByText('No tags assigned')).toBeVisible()

  page.on('dialog', (dialog) => dialog.accept())
  const archiveResponse = page.waitForResponse((response) => /\/api\/admin\/user-tags\/[^/]+\/archive$/.test(response.url()))
  await panel.getByRole('button', { name: 'Archive user tag' }).click()
  expect((await archiveResponse).status()).toBe(200)
  await page.screenshot({ path: 'test-results/user-lifecycle-desktop.png', fullPage: true })
})

test('User lifecycle workbench remains bounded at 390px', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInPage(page, request, 'opsplus')
  await page.goto('/')
  await page.getByRole('button', { name: 'Toggle navigation' }).click()
  await page.getByTestId('nav-admin').click()
  await page.getByRole('button', { name: 'Users', exact: true }).click()

  const panel = page.getByTestId('user-admin-panel')
  await expect(panel.getByTestId('user-lifecycle-metrics')).toBeVisible()
  const layout = await panel.evaluate((element) => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    overflow: [...element.querySelectorAll<HTMLElement>('*')]
      .filter((node) => !['INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName) && !['auto', 'scroll', 'hidden'].includes(getComputedStyle(node).overflowX) && node.scrollWidth > node.clientWidth + 2)
      .map((node) => `${node.tagName.toLowerCase()}:${node.clientWidth}/${node.scrollWidth}`)
      .slice(0, 10),
  }))
  expect(layout.documentWidth - layout.viewport).toBeLessThanOrEqual(1)
  expect(layout.overflow).toEqual([])
  await page.screenshot({ path: 'test-results/user-lifecycle-mobile.png', fullPage: true })
})
