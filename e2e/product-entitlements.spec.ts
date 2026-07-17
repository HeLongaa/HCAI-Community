import { expect, test } from '@playwright/test'
import { apiBaseUrl, apiData, authHeaders, login, signInPage } from './helpers'

type Plan = { id: string; key: string; status: string; version: number }
type PlanVersion = { id: string; version: number }
type Grant = { id: string; status: string; version: number }

test('personal entitlement appears for the user and remains operable in Admin Finance on mobile', async ({ browser, request }) => {
  test.setTimeout(60_000)
  const adminSession = await login(request, 'opsplus')
  const headers = authHeaders(adminSession.accessToken)
  const existingResponse = await request.get(`${apiBaseUrl}/api/admin/entitlements/grants?userHandle=taskops&status=active&limit=10`, { headers })
  const existingPayload = await existingResponse.json() as { data?: Grant[] }
  for (const existing of existingPayload.data ?? []) {
    await request.post(`${apiBaseUrl}/api/admin/entitlements/grants/${existing.id}/transitions`, {
      headers,
      data: { status: 'revoked', expectedVersion: existing.version, reasonCode: 'e2e_preflight_cleanup' },
    })
  }
  const suffix = Date.now().toString(36)
  const key = `personal.member.e2e-${suffix}`
  const created = await apiData<Plan>(request.post(`${apiBaseUrl}/api/admin/entitlements/plans`, {
    headers,
    data: { key, title: 'E2E Personal Access', description: 'Browser entitlement contract.' },
  }))
  const versioned = await apiData<{ plan: Plan; planVersion: PlanVersion }>(request.post(`${apiBaseUrl}/api/admin/entitlements/plans/${created.id}/versions`, {
    headers,
    data: {
      expectedPlanVersion: 1,
      capabilities: { 'creative.image.text_to_image': true, 'creative.video.text_to_video': false },
      quotas: { 'creative.daily.image': 3, 'creative.daily.video': 1 },
      effectiveAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      reasonCode: 'e2e_policy',
    },
  }))
  const activated = await apiData<Plan>(request.post(`${apiBaseUrl}/api/admin/entitlements/plans/${created.id}/transitions`, {
    headers,
    data: { status: 'active', planVersionId: versioned.planVersion.id, expectedVersion: 2, reasonCode: 'e2e_activate' },
  }))
  const grant = await apiData<Grant>(request.post(`${apiBaseUrl}/api/admin/entitlements/grants`, {
    headers,
    data: {
      userHandle: 'taskops',
      planVersionId: versioned.planVersion.id,
      startsAt: new Date(Date.now() - 30_000).toISOString(),
      endsAt: new Date(Date.now() + 43_200_000).toISOString(),
      reasonCode: 'e2e_assignment',
      sourceType: 'admin',
      sourceId: suffix,
    },
  }))

  const userContext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const userPage = await userContext.newPage()
  const adminContext = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true })
  const adminPage = await adminContext.newPage()
  try {
    await signInPage(userPage, request, 'taskops')
    await userPage.goto('/#points')
    const personalSummary = userPage.getByTestId('personal-entitlement-summary')
    await expect(personalSummary).toBeVisible()
    await expect(personalSummary).toContainText('E2E Personal Access')
    await expect(personalSummary).toContainText(key)
    await expect(personalSummary).toContainText('Assigned personal plan')
    await expect(personalSummary).toContainText('3')

    await signInPage(adminPage, request, 'opsplus')
    await adminPage.goto('/')
    await adminPage.getByRole('button', { name: 'Toggle navigation' }).click()
    await adminPage.getByTestId('nav-admin').click()
    await adminPage.getByRole('button', { name: 'Finance', exact: true }).click()
    const panel = adminPage.getByTestId('admin-entitlements-panel')
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('Personal entitlement control')
    await expect(panel).toContainText('E2E Personal Access')

    await panel.getByRole('tab', { name: 'Grants' }).click()
    await expect(panel).toContainText('@taskops')
    await expect(panel).toContainText(key)

    await panel.getByRole('tab', { name: 'Evaluate' }).click()
    await panel.getByLabel('User handle').fill('taskops')
    await panel.getByLabel('Capability').fill('creative.image.text_to_image')
    await panel.getByLabel('Quota key').fill('creative.daily.image')
    await panel.getByLabel('Units').fill('4')
    await panel.getByRole('button', { name: 'Evaluate', exact: true }).click()
    await expect(panel.locator('.entitlement-decision')).toContainText('Denied')
    await expect(panel.locator('.entitlement-decision')).toContainText('entitlement_quota_too_low')

    const download = adminPage.waitForEvent('download')
    await panel.getByRole('button', { name: 'Export', exact: true }).click()
    await expect((await download).suggestedFilename()).toMatch(/^personal-entitlements-\d{4}-\d{2}-\d{2}\.json$/)

    const layout = await panel.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return {
        insideViewport: rect.left >= 0 && rect.right <= document.documentElement.clientWidth,
        noInternalOverflow: element.scrollWidth <= element.clientWidth,
        geometry: {
          left: rect.left,
          right: rect.right,
          viewport: document.documentElement.clientWidth,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          offenders: [...element.querySelectorAll<HTMLElement>('*')].map((child) => {
            const childRect = child.getBoundingClientRect()
            return { tag: child.tagName, className: child.className, text: child.textContent?.trim().slice(0, 60), left: childRect.left, right: childRect.right, scrollWidth: child.scrollWidth, clientWidth: child.clientWidth }
          }).filter((child) => child.right > rect.right + 1 || child.left < rect.left - 1 || child.scrollWidth > child.clientWidth + 1).slice(0, 12),
        },
      }
    })
    expect(layout, JSON.stringify(layout.geometry)).toMatchObject({ insideViewport: true, noInternalOverflow: true })
    await panel.screenshot({ path: '/tmp/ent-01-admin-mobile.png' })
  } finally {
    await request.post(`${apiBaseUrl}/api/admin/entitlements/grants/${grant.id}/transitions`, {
      headers,
      data: { status: 'revoked', expectedVersion: grant.version, reasonCode: 'e2e_cleanup' },
    }).catch(() => undefined)
    await request.post(`${apiBaseUrl}/api/admin/entitlements/plans/${created.id}/transitions`, {
      headers,
      data: { status: 'retired', expectedVersion: activated.version, reasonCode: 'e2e_cleanup' },
    }).catch(() => undefined)
    await userContext.close()
    await adminContext.close()
  }
})
