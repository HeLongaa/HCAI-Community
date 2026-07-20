import { expect, test } from '@playwright/test'

import { apiBaseUrl, apiData, authHeaders, login, signInPage } from './helpers'

type DataRightsRequest = { id: string; version: number; status: string; requestType: string; artifact: { checksumSha256: string } | null }

test('owner export request is processed by Admin and downloaded through the private lifecycle', async ({ page, request }) => {
  await signInPage(page, request, 'promptlin')
  await page.goto('/')
  await page.locator('.sidebar-profile > button').click()

  const ownerPanel = page.getByTestId('profile-settings-panel')
  await ownerPanel.getByLabel('Data rights identity confirmation').fill('promptlin')
  const createResponse = page.waitForResponse((response) => response.url().endsWith('/api/users/me/data-rights/requests') && response.request().method() === 'POST')
  await ownerPanel.getByRole('button', { name: 'Request export' }).click()
  const created = (await (await createResponse).json() as { data: DataRightsRequest }).data
  expect(created.requestType).toBe('data_export')
  expect(created.status).toBe('identity_verified')

  const admin = await login(request, 'opsplus')
  const processed = await apiData<DataRightsRequest>(request.post(`${apiBaseUrl}/api/admin/data-rights/requests/${created.id}/process`, {
    headers: authHeaders(admin.accessToken),
    data: { expectedVersion: created.version, reasonCode: 'e2e_export_generated' },
  }))
  expect(processed.status).toBe('completed')
  expect(processed.artifact?.checksumSha256).toHaveLength(64)

  await page.reload()
  await page.locator('.sidebar-profile > button').click()
  const refreshedPanel = page.getByTestId('profile-settings-panel')
  await expect(refreshedPanel.getByText('completed', { exact: true })).toBeVisible()
  const exportResponse = page.waitForResponse((response) => response.url().endsWith(`/api/users/me/data-rights/requests/${created.id}/export`) && response.request().method() === 'GET')
  const download = page.waitForEvent('download')
  await refreshedPanel.getByRole('button', { name: 'Download export' }).click()
  expect((await exportResponse).status()).toBe(200)
  expect((await download).suggestedFilename()).toBe(`data-export-${created.id}.json`)

  const adminPage = await page.context().newPage()
  await signInPage(adminPage, request, 'opsplus')
  await adminPage.goto('/')
  await adminPage.getByTestId('nav-admin').click()
  await adminPage.getByRole('button', { name: 'Users', exact: true }).click()
  const adminPanel = adminPage.getByTestId('data-rights-admin-panel')
  await expect(adminPanel).toBeVisible()
  await expect(adminPanel.getByText(created.id, { exact: true })).toBeVisible()
  await adminPage.close()
})

test('data rights owner and Admin panels remain bounded at 390px', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInPage(page, request, 'opsplus')
  await page.goto('/')
  await page.getByRole('button', { name: 'Toggle navigation' }).click()
  await page.getByTestId('nav-admin').click()
  await page.getByRole('button', { name: 'Users', exact: true }).click()

  const panel = page.getByTestId('data-rights-admin-panel')
  await expect(panel).toBeVisible()
  await panel.scrollIntoViewIfNeeded()
  const layout = await panel.evaluate((element) => ({
    panelWidth: element.getBoundingClientRect().width,
    viewportWidth: window.innerWidth,
    documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
    overflow: [...element.querySelectorAll<HTMLElement>('*')]
      .filter((node) => !['INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName) && getComputedStyle(node).overflowX !== 'auto' && node.scrollWidth > node.clientWidth + 2)
      .map((node) => `${node.tagName.toLowerCase()}:${node.clientWidth}/${node.scrollWidth}`)
      .slice(0, 10),
  }))
  expect(layout.panelWidth).toBeLessThanOrEqual(layout.viewportWidth)
  expect(layout.documentOverflow).toBeLessThanOrEqual(1)
  expect(layout.overflow).toEqual([])
})
