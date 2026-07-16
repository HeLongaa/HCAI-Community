import { expect, test } from '@playwright/test'

import { signInPage } from './helpers'

test('admin generation operations expose summary sorting and CSV export', async ({ page, request }) => {
  await signInPage(page, request, 'opsplus')
  await page.goto('/')
  await page.getByTestId('nav-admin').click()
  await page.getByRole('main').getByRole('button', { name: 'Generations', exact: true }).click()

  const panel = page.getByTestId('admin-generation-history')
  await expect(panel).toBeVisible()
  await expect(panel.getByText('Total records', { exact: true })).toBeVisible()
  await panel.getByLabel('Generation sort', { exact: true }).selectOption('status')
  await panel.getByLabel('Generation sort direction').selectOption('asc')

  const download = page.waitForEvent('download')
  await panel.getByTitle('Export generation records').click()
  const artifact = await download
  expect(artifact.suggestedFilename()).toMatch(/^creative-generations-\d{4}-\d{2}-\d{2}\.csv$/)
})
