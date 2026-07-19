import { expect, test } from '@playwright/test'

import { acceptCurrentPolicies, apiBaseUrl, apiData, authHeaders, login, signInPage } from './helpers'
import type { RiskPolicy } from '../src/services/contracts'

test('generation abuse is throttled, appealed by the owner, and recovered by Admin', async ({ page, request }) => {
  const admin = await login(request, 'opsplus')
  const owner = await login(request, 'taskops')
  await acceptCurrentPolicies(request, owner.accessToken)
  const original = await apiData<RiskPolicy>(request.get(`${apiBaseUrl}/api/admin/risk/policy`, { headers: authHeaders(admin.accessToken) }))
  await apiData<RiskPolicy>(request.put(`${apiBaseUrl}/api/admin/risk/policy`, { headers: authHeaders(admin.accessToken), data: { enabled: true, generationWindowSeconds: 300, generationCountThreshold: 2, safetyRejectionThreshold: 10, generationCostMicrosThreshold: 1_000_000_000, restrictionSeconds: 3600, expectedVersion: original.version, reasonCode: 'e2e_generation_threshold' } }))
  try {
    for (const index of [1, 2]) {
      const generated = await request.post(`${apiBaseUrl}/api/creative/generations`, { headers: authHeaders(owner.accessToken), data: { workspace: 'image', mode: 'text_to_image', providerId: 'mock', prompt: `Risk E2E generation ${Date.now()} ${index}`, inputAssetIds: [], parameters: { aspectRatio: '1:1', stylePreset: 'none' }, idempotencyKey: `risk-e2e:${Date.now()}:${index}` } })
      expect(generated.ok()).toBeTruthy()
    }
    const blocked = await request.post(`${apiBaseUrl}/api/creative/generations`, { headers: authHeaders(owner.accessToken), data: { workspace: 'image', mode: 'text_to_image', providerId: 'mock', prompt: 'This request should be throttled before dispatch.', inputAssetIds: [], parameters: { aspectRatio: '1:1', stylePreset: 'none' }, idempotencyKey: `risk-e2e:blocked:${Date.now()}` } })
    expect(blocked.status()).toBe(429)
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe('GENERATION_RISK_THROTTLED')

    await signInPage(page, request, 'taskops')
    await page.goto('/')
    await page.locator('.sidebar-profile > button').click()
    const ownerPanel = page.getByTestId('profile-risk-cases')
    await expect(ownerPanel).toBeVisible()
    await expect(ownerPanel).toContainText('generation_throttled')
    await ownerPanel.getByLabel('Reason code').fill('e2e_owner_appeal')
    await ownerPanel.getByLabel('Appeal statement').fill('These generations are legitimate personal work and should be independently reviewed.')
    const appealResponse = page.waitForResponse((response) => response.url().includes('/api/risk/cases/') && response.url().endsWith('/appeals') && response.request().method() === 'POST')
    await ownerPanel.getByRole('button', { name: 'Submit appeal' }).click()
    expect((await appealResponse).status()).toBe(201)
    await expect(ownerPanel).toContainText('awaiting review')

    await signInPage(page, request, 'opsplus')
    await page.goto('/')
    await page.getByTestId('nav-admin').click()
    await page.getByRole('main').getByRole('button', { name: 'Trust & Safety', exact: true }).click()
    const adminPanel = page.getByTestId('risk-admin-panel')
    await expect(adminPanel).toBeVisible()
    await adminPanel.getByLabel('Risk case status').selectOption('appealed')
    const row = adminPanel.getByTestId('risk-case-list').locator('.admin-row').filter({ hasText: '@taskops' })
    await expect(row).toBeVisible()
    await row.click()
    const detail = adminPanel.getByTestId('risk-case-detail')
    await detail.getByLabel('Next status').selectOption('recovered')
    await detail.getByLabel('Reason code').fill('e2e_owner_evidence_confirmed')
    const recoveryResponse = page.waitForResponse((response) => response.url().includes('/api/admin/risk/cases/') && response.url().endsWith('/transitions') && response.request().method() === 'POST')
    await detail.getByRole('button', { name: 'Apply transition' }).click()
    const recovery = await recoveryResponse
    expect(recovery.status()).toBe(200)
    expect(((await recovery.json()) as { data: { status: string; disposition: string } }).data).toMatchObject({ status: 'recovered', disposition: 'cleared' })
    await expect(adminPanel.getByTestId('risk-admin-metrics')).toBeVisible()
  } finally {
    const current = await apiData<RiskPolicy>(request.get(`${apiBaseUrl}/api/admin/risk/policy`, { headers: authHeaders(admin.accessToken) }))
    await request.put(`${apiBaseUrl}/api/admin/risk/policy`, { headers: authHeaders(admin.accessToken), data: { enabled: original.enabled, generationWindowSeconds: original.generationWindowSeconds, generationCountThreshold: original.generationCountThreshold, safetyRejectionThreshold: original.safetyRejectionThreshold, generationCostMicrosThreshold: original.generationCostMicrosThreshold, restrictionSeconds: original.restrictionSeconds, expectedVersion: current.version, reasonCode: 'e2e_policy_restored' } })
  }
})

test('risk Admin and owner panels remain bounded on mobile', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInPage(page, request, 'opsplus')
  await page.goto('/')
  await page.getByRole('button', { name: 'Toggle navigation' }).click()
  await page.getByTestId('nav-admin').click()
  await page.getByRole('main').getByRole('button', { name: 'Trust & Safety', exact: true }).click()
  const panel = page.getByTestId('risk-admin-panel')
  await expect(panel).toBeVisible()
  expect(await panel.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
})
