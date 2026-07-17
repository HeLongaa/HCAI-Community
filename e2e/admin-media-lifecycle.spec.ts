import { expect, test } from '@playwright/test'
import { apiBaseUrl, apiData, authHeaders, login, signInPage } from './helpers'

test('admin filters and transitions owner media lifecycle records', async ({ page, request }) => {
  const owner = await login(request, 'promptlin')
  const admin = await login(request, 'opsplus')
  const upload = await apiData<{ asset: { id: string } }>(request.post(`${apiBaseUrl}/api/media/uploads`, {
    headers: authHeaders(owner.accessToken),
    data: { fileName: 'e2e-admin-lifecycle.png', contentType: 'image/png', sizeBytes: 2048, purpose: 'library_asset' },
  }))
  await apiData(request.post(`${apiBaseUrl}/api/media/uploads/${upload.asset.id}/complete`, { headers: authHeaders(owner.accessToken), data: {} }))
  await apiData(request.post(`${apiBaseUrl}/api/media/uploads/${upload.asset.id}/scan`, { headers: authHeaders(admin.accessToken), data: { decision: 'clean', note: 'E2E clean fixture' } }))

  await signInPage(page, request, 'opsplus')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Toggle navigation' }).click()
  await page.getByTestId('nav-admin').click()
  const panel = page.getByTestId('admin-media-lifecycle')
  await expect(panel).toBeVisible()
  await expect(panel.getByText('Active capacity')).toBeVisible()
  await expect(panel.getByText('Scan failures')).toBeVisible()
  await panel.getByLabel('Admin media type').selectOption('image')
  await expect(panel.getByText('P95 scan latency')).toBeVisible()
  await panel.getByLabel('Search asset lifecycle').fill('e2e-admin-lifecycle')
  const row = panel.locator('article').filter({ hasText: 'e2e-admin-lifecycle.png' })
  await expect(row).toBeVisible()
  await expect(row).toContainText('available')
  await panel.getByLabel('Admin object state').selectOption('available')
  await expect(row).toBeVisible()
  await panel.getByRole('button', { name: 'Run due object cleanup' }).click()
  await expect(panel).toContainText('0 objects deleted, 0 failed.')
  await panel.getByLabel('Admin object state').selectOption('')

  await page.setViewportSize({ width: 1440, height: 900 })
  expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.setViewportSize({ width: 390, height: 844 })
  await row.getByRole('button').click()
  const detail = panel.locator('.admin-media-detail')
  await expect(detail).toContainText('e2e-admin-lifecycle.png')
  await detail.getByRole('button', { name: 'Reject' }).click()
  await expect(detail).toContainText('rejected')
  await detail.getByRole('button', { name: 'Mark clean' }).click()
  await expect(detail).toContainText('clean')
  page.once('dialog', (dialog) => dialog.accept())
  await detail.getByRole('button', { name: 'Delete' }).click()
  await expect(row).toContainText('Deleted')
  await detail.getByRole('button', { name: 'Recover' }).click()
  await expect(row).toContainText('Active')

  await row.getByRole('checkbox').check()
  await panel.locator('.admin-media-bulkbar').getByRole('button', { name: 'Archive' }).click()
  await expect(row).toContainText('Archived')
  const download = page.waitForEvent('download')
  await panel.getByRole('button', { name: 'Export media JSON' }).click()
  await expect(await download).toBeTruthy()
  const metricsDownload = page.waitForEvent('download')
  await panel.getByRole('button', { name: 'Export media metrics JSON' }).click()
  await expect((await metricsDownload).suggestedFilename()).toBe('media-business-metrics.json')

  await expect(panel).toBeVisible()
  expect(await panel.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return rect.left >= 0 && rect.right <= document.documentElement.clientWidth && element.scrollWidth <= element.clientWidth
  })).toBe(true)
})
