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
  await page.goto('/')
  await page.getByTestId('nav-admin').click()
  const panel = page.getByTestId('admin-media-lifecycle')
  await expect(panel).toBeVisible()
  await panel.getByLabel('Search asset lifecycle').fill('e2e-admin-lifecycle')
  const row = panel.locator('article').filter({ hasText: 'e2e-admin-lifecycle.png' })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Delete' }).click()
  await expect(row).toContainText('Deleted')
  await row.getByRole('button', { name: 'Recover' }).click()
  await expect(row).toContainText('Active')

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(panel).toBeVisible()
  const layout = await page.evaluate(() => {
    const root = document.documentElement
    const overflow = Array.from(document.querySelectorAll<HTMLElement>('body *')).flatMap((element) => {
      const rect = element.getBoundingClientRect()
      if (rect.right <= root.clientWidth + 1 && rect.left >= -1) return []
      return [{
        tag: element.tagName,
        className: element.className,
        testId: element.dataset.testid,
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
      }]
    }).slice(0, 20)
    return { clientWidth: root.clientWidth, scrollWidth: root.scrollWidth, bodyWidth: document.body.clientWidth, overflow }
  })
  console.info('admin mobile layout', JSON.stringify(layout))
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth)
})
