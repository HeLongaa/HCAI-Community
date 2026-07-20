import { expect, test } from '@playwright/test'

import { apiBaseUrl, apiData, authHeaders, signInPage } from './helpers'

type OwnProfile = {
  handle: string
  stats: Record<string, unknown>
  portfolio: unknown[]
  privacy: { visibility: string; version: number }
  account: { status: string; version: number; deletionScheduledAt: string | null }
}

type DataRightsRequest = { id: string; version: number; status: string; requestType: string }

test('personal profile privacy and account deletion request remain owner-controlled', async ({ page, request }) => {
  const session = await signInPage(page, request, 'legalpixel')
  await page.goto('/')
  await page.locator('.sidebar-profile > button').click()

  const panel = page.getByTestId('profile-settings-panel')
  await expect(panel).toBeVisible()
  await panel.getByLabel('Profile bio').fill('Owner controlled profile')
  await panel.getByLabel('Profile visibility').selectOption('private')
  await panel.getByLabel('Discoverable').uncheck()
  await panel.getByLabel('Activity visible').uncheck()
  await panel.getByLabel('Portfolio visible').uncheck()
  const privateSave = page.waitForResponse((response) => response.url().endsWith('/api/profiles/me') && response.request().method() === 'PATCH')
  await panel.getByRole('button', { name: 'Save' }).click()
  expect((await privateSave).status()).toBe(200)

  const hidden = await request.get(`${apiBaseUrl}/api/profiles/legalpixel`)
  expect(hidden.status()).toBe(404)
  const owner = await apiData<OwnProfile>(request.get(`${apiBaseUrl}/api/profiles/legalpixel`, { headers: authHeaders(session.accessToken) }))
  expect(owner.privacy.visibility).toBe('private')

  await panel.getByLabel('Profile visibility').selectOption('public')
  await panel.getByLabel('Discoverable').check()
  const publicSave = page.waitForResponse((response) => response.url().endsWith('/api/profiles/me') && response.request().method() === 'PATCH')
  await panel.getByRole('button', { name: 'Save' }).click()
  expect((await publicSave).status()).toBe(200)
  const redacted = await apiData<OwnProfile>(request.get(`${apiBaseUrl}/api/profiles/legalpixel`))
  expect(redacted.stats).toEqual({})
  expect(redacted.portfolio).toEqual([])

  await panel.getByLabel('Data rights identity confirmation').fill('legalpixel')
  const deletionResponse = page.waitForResponse((response) => response.url().endsWith('/api/users/me/data-rights/requests') && response.request().method() === 'POST')
  await panel.getByRole('button', { name: 'Request deletion' }).click()
  const createdDeletion = (await (await deletionResponse).json() as { data: DataRightsRequest }).data
  expect(createdDeletion.requestType).toBe('account_deletion')
  await expect(panel).toContainText('deletion_requested')
  const requested = await apiData<OwnProfile['account']>(request.get(`${apiBaseUrl}/api/users/me/account-status`, { headers: authHeaders(session.accessToken) }))
  expect(requested.deletionScheduledAt).toBeTruthy()

  const cancelResponse = page.waitForResponse((response) => response.url().endsWith(`/api/users/me/data-rights/requests/${createdDeletion.id}`) && response.request().method() === 'DELETE')
  await panel.getByRole('button', { name: 'Cancel request' }).click()
  expect((await cancelResponse).status()).toBe(200)
  await expect(panel).toContainText('active')

  await panel.getByLabel('Activity visible').check()
  await panel.getByLabel('Portfolio visible').check()
  const restoreResponse = page.waitForResponse((response) => response.url().endsWith('/api/profiles/me') && response.request().method() === 'PATCH')
  await panel.getByRole('button', { name: 'Save' }).click()
  expect((await restoreResponse).status()).toBe(200)
})

test('profile settings remain bounded at 390px', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInPage(page, request, 'legalpixel')
  await page.goto('/')
  await page.getByRole('button', { name: 'Toggle navigation' }).click()
  await page.locator('.sidebar-profile > button').click()

  const panel = page.getByTestId('profile-settings-panel')
  await expect(panel).toBeVisible()
  const layout = await panel.evaluate((element) => ({
    panelWidth: element.getBoundingClientRect().width,
    viewportWidth: window.innerWidth,
    documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
    overflow: [...element.querySelectorAll<HTMLElement>('*')]
      .filter((node) => !['INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName) && node.scrollWidth > node.clientWidth + 2)
      .map((node) => `${node.tagName.toLowerCase()}:${node.clientWidth}/${node.scrollWidth}`),
  }))
  expect(layout.panelWidth).toBeLessThanOrEqual(layout.viewportWidth)
  expect(layout.documentOverflow).toBeLessThanOrEqual(1)
  expect(layout.overflow).toEqual([])
})
