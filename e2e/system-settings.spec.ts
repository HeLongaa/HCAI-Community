import { expect, test } from '@playwright/test'

import { apiBaseUrl, apiData, authHeaders, login, signInPage } from './helpers'

test('admin previews, requests, independently approves, and publishes a system setting', async ({ page, request }) => {
  const approver = await login(request, 'finops')
  await signInPage(page, request, 'opsplus')
  await page.goto('/')
  await page.getByTestId('nav-admin').click()

  const settingsResponse = page.waitForResponse((response) =>
    response.url().includes('/api/admin/settings?') && response.request().method() === 'GET',
  )
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await settingsResponse

  const panel = page.getByTestId('admin-system-settings')
  await expect(panel).toBeVisible()
  const layout = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth
    const rect = (selector: string) => {
      const element = document.querySelector(selector)
      const bounds = element?.getBoundingClientRect()
      return bounds ? { left: Math.round(bounds.left), right: Math.round(bounds.right), width: Math.round(bounds.width) } : null
    }
    const overflow = [...document.querySelectorAll('[data-testid="admin-system-settings"] *')]
      .map((element) => {
        const rect = element.getBoundingClientRect()
        return { tag: element.tagName, className: element.className, right: Math.round(rect.right), width: Math.round(rect.width) }
      })
      .filter((item) => item.right > viewportWidth + 1)
      .slice(0, 12)
    return { viewportWidth, panel: rect('[data-testid="admin-system-settings"]'), workspace: rect('.settings-workspace'), list: rect('.settings-list'), editor: rect('.settings-editor'), overflow }
  })
  expect(layout.overflow, JSON.stringify(layout)).toEqual([])
  await panel.getByRole('button', { name: /jobs.worker/ }).click()
  await panel.getByLabel('Setting JSON').fill(JSON.stringify({
    leaseTtlSeconds: 480,
    renewIntervalSeconds: 80,
  }, null, 2))

  const previewResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/admin/settings/jobs.worker/preview') && response.request().method() === 'POST',
  )
  await panel.getByRole('button', { name: 'Preview' }).click()
  await previewResponse
  await expect(panel.getByTestId('settings-preview')).toContainText('leaseTtlSeconds')

  const requestResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/admin/settings/jobs.worker/changes') && response.request().method() === 'POST',
  )
  await panel.getByRole('button', { name: 'Request change' }).click()
  const requested = await requestResponse.then((response) => response.json()) as { data: { id: string; version: number } }

  const approved = await apiData<{ version: number }>(request.post(`${apiBaseUrl}/api/admin/settings/changes/${requested.data.id}/approve`, {
    headers: authHeaders(approver.accessToken),
    data: { expectedVersion: requested.data.version, reasonCode: 'e2e_reviewed', note: 'Validated in E2E.' },
  }))
  expect(approved.version).toBe(2)

  await panel.getByTitle('Refresh changes').click()
  const approvedRow = panel.locator('.settings-change-list button.admin-row').filter({ hasText: 'approved' }).first()
  await expect(approvedRow).toBeVisible()
  await approvedRow.click()
  const publishResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/api/admin/settings/changes/${requested.data.id}/publish`) && response.request().method() === 'POST',
  )
  await panel.getByRole('button', { name: 'Publish', exact: true }).click()
  await publishResponse

  await expect(panel.locator('.settings-editor-heading code')).toHaveText('v1')
  await expect(panel.locator('.settings-history-list')).toContainText('v1 · published')

  await page.setViewportSize({ width: 390, height: 844 })
  const mobileOverflow = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth
    const panel = document.querySelector('[data-testid="admin-system-settings"]')
    const panelRect = panel?.getBoundingClientRect()
    const descendants = panel ? [...panel.querySelectorAll('*')] : []
    return {
      panelLeft: Math.round(panelRect?.left ?? -1),
      panelRight: Math.round(panelRect?.right ?? -1),
      overflowing: descendants.filter((element) => element.getBoundingClientRect().right > viewportWidth + 1).length,
    }
  })
  expect(mobileOverflow).toEqual({ panelLeft: 12, panelRight: 378, overflowing: 0 })
})

test('moderator can inspect system settings but cannot preview or mutate them', async ({ page, request }) => {
  await signInPage(page, request, 'legalpixel')
  await page.goto('/')
  await page.getByTestId('nav-admin').click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()

  const panel = page.getByTestId('admin-system-settings')
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('button', { name: /jobs.worker/ })).toBeVisible()
  await expect(panel.getByLabel('Setting JSON')).toHaveAttribute('readonly', '')
  await expect(panel.getByRole('button', { name: 'Preview' })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Request change' })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Approve' })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0)
})
