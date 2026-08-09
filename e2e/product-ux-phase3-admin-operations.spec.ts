import { expect, test } from '@playwright/test'

import { apiBaseUrl, apiData, authHeaders, login, selectAdminSection, signInPage } from './helpers'

const openAdmin = async (page: import('@playwright/test').Page, request: Parameters<typeof signInPage>[1], handle = 'opsplus') => {
  await signInPage(page, request, handle)
  await page.goto('/#admin')
}

const matchingRequestCount = (requests: string[], pattern: RegExp) => requests.filter((url) => pattern.test(url)).length

const expectNoDirectChildOverlap = async (row: import('@playwright/test').Locator) => {
  const childRects = await row.locator(':scope > :not(.admin-detail-panel):not(.audit-detail-panel)').evaluateAll((elements) => elements
    .filter((element) => {
      const rect = element.getBoundingClientRect()
      return getComputedStyle(element).display !== 'none' && rect.width > 0 && rect.height > 0
    })
    .map((element) => {
      const rect = element.getBoundingClientRect()
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
    }))
  for (let leftIndex = 0; leftIndex < childRects.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < childRects.length; rightIndex += 1) {
      const left = childRects[leftIndex]
      const right = childRects[rightIndex]
      const overlapWidth = Math.min(left.right, right.right) - Math.max(left.left, right.left)
      const overlapHeight = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top)
      expect(overlapWidth > 1 && overlapHeight > 1).toBe(false)
    }
  }
}

test('Admin workspaces request only the active operations data', async ({ page, request }) => {
  const requests: string[] = []
  page.on('request', (current) => {
    const url = new URL(current.url())
    if (url.pathname.startsWith('/api/')) requests.push(`${url.pathname}${url.search}`)
  })

  await openAdmin(page, request)
  await expect(page.locator('.admin-center')).toBeVisible()
  await page.waitForTimeout(200)
  expect(matchingRequestCount(requests, /^\/api\/admin\/reviews(?:\?|$)/)).toBe(0)
  expect(matchingRequestCount(requests, /^\/api\/admin\/operations\/metrics(?:\?|$)/)).toBe(0)
  expect(matchingRequestCount(requests, /^\/api\/admin\/security\/(?:alerts|events|incidents)(?:\?|$)/)).toBe(0)
  expect(matchingRequestCount(requests, /^\/api\/media\/(?:review-queue|scan-alerts|governance-config|governance-policy\/history)(?:\?|$)/)).toBe(0)

  await selectAdminSection(page, 'Generations')
  const generationPanel = page.getByTestId('admin-generation-history')
  await expect(generationPanel).toBeVisible()
  const generationBounds = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(generationBounds.scrollWidth).toBeLessThanOrEqual(generationBounds.clientWidth)
  expect(await generationPanel.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  const generationRows = generationPanel.locator('.generation-row')
  if (await generationRows.count() > 0) {
    expect(await generationRows.first().evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  }

  await selectAdminSection(page, 'Audit log')
  const auditRow = page.locator('.admin-audit-panel .admin-row').first()
  await expect(auditRow).toBeVisible()
  await expectNoDirectChildOverlap(auditRow)

  await selectAdminSection(page, 'Submissions')
  await expect.poll(() => matchingRequestCount(requests, /^\/api\/admin\/reviews(?:\?|$)/)).toBeGreaterThan(0)
  expect(matchingRequestCount(requests, /^\/api\/admin\/operations\/metrics(?:\?|$)/)).toBe(0)

  await selectAdminSection(page, 'Security')
  const navigation = page.getByTestId('security-workspace-navigation')
  const tabs = navigation.getByRole('tablist', { name: 'Security workspace' })
  await expect.poll(() => matchingRequestCount(requests, /^\/api\/admin\/operations\/metrics(?:\?|$)/)).toBeGreaterThan(0)
  expect(matchingRequestCount(requests, /^\/api\/admin\/security\/(?:alerts|events|incidents)(?:\?|$)/)).toBe(0)
  expect(matchingRequestCount(requests, /^\/api\/media\/(?:review-queue|scan-alerts|governance-config|governance-policy\/history)(?:\?|$)/)).toBe(0)

  await tabs.getByRole('tab', { name: 'Incidents' }).click()
  await expect.poll(() => matchingRequestCount(requests, /^\/api\/admin\/security\/alerts(?:\?|$)/)).toBeGreaterThan(0)
  await expect.poll(() => matchingRequestCount(requests, /^\/api\/admin\/security\/events(?:\?|$)/)).toBeGreaterThan(0)
  await expect.poll(() => matchingRequestCount(requests, /^\/api\/admin\/security\/incidents(?:\?|$)/)).toBeGreaterThan(0)
  expect(matchingRequestCount(requests, /^\/api\/media\/(?:review-queue|scan-alerts|governance-config|governance-policy\/history)(?:\?|$)/)).toBe(0)

  await tabs.getByRole('tab', { name: 'Media review' }).click()
  await expect.poll(() => matchingRequestCount(requests, /^\/api\/media\/review-queue(?:\?|$)/)).toBeGreaterThan(0)
  await expect.poll(() => matchingRequestCount(requests, /^\/api\/media\/scan-alerts(?:\?|$)/)).toBeGreaterThan(0)
  expect(matchingRequestCount(requests, /^\/api\/media\/(?:governance-config|governance-policy\/history)(?:\?|$)/)).toBe(0)

  await tabs.getByRole('tab', { name: 'Governance' }).click()
  await expect.poll(() => matchingRequestCount(requests, /^\/api\/media\/governance-config(?:\?|$)/)).toBeGreaterThan(0)
  await expect.poll(() => matchingRequestCount(requests, /^\/api\/media\/governance-policy\/history(?:\?|$)/)).toBeGreaterThan(0)
  await expect(page.getByTestId('app-toast')).toHaveCount(0)
})

test('Admin dense workspaces stay legible across medium desktop widths', async ({ page, request }) => {
  await page.setViewportSize({ width: 1120, height: 820 })
  await openAdmin(page, request)

  for (const width of [1120, 1121, 1280, 1366]) {
    await page.setViewportSize({ width, height: 820 })
    const sections = [
      { label: 'Generations', panel: '[data-testid="admin-generation-history"]', row: '.generation-row' },
      { label: 'Accounting', panel: '[data-testid="admin-accounting-reconciliation"]', row: '.admin-row' },
      { label: 'Audit log', panel: '.admin-audit-panel', row: '.admin-row' },
    ]
    for (const section of sections) {
      await selectAdminSection(page, section.label)
      const panel = page.locator(section.panel)
      await expect(panel).toBeVisible()
      const bounds = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }))
      expect(bounds.scrollWidth, `${section.label} document overflow at ${width}px`).toBeLessThanOrEqual(bounds.clientWidth)
      expect(await panel.evaluate((element) => element.scrollWidth - element.clientWidth), `${section.label} panel overflow at ${width}px`).toBeLessThanOrEqual(1)
      const firstRow = panel.locator(section.row).first()
      if (await firstRow.count() > 0 && await firstRow.isVisible()) await expectNoDirectChildOverlap(firstRow)
    }
    if (width === 1121 || width === 1366) {
      await page.screenshot({ path: `test-results/phase4-admin-medium-${width}.png`, fullPage: false })
    }
  }
})

test('Submissions uses one queue and one isolated review detail', async ({ page, request }) => {
  const admin = await login(request, 'opsplus')
  const policy = await apiData<{ roleLimits: Record<'admin', number>; reasonCodes: string[] }>(request.get(`${apiBaseUrl}/api/admin/points/policy`, { headers: authHeaders(admin.accessToken) }))
  await apiData(request.post(`${apiBaseUrl}/api/admin/points/adjustments`, {
    headers: authHeaders(admin.accessToken),
    data: {
      userHandle: 'promptlin',
      delta: policy.roleLimits.admin + 1,
      reason: `Phase 3 review workspace ${Date.now()}`,
      reasonCode: policy.reasonCodes[0] ?? 'operator_requested',
    },
  }))

  await openAdmin(page, request)
  await selectAdminSection(page, 'Submissions')

  const workspace = page.getByTestId('submission-review-workspace')
  await expect(workspace).toBeVisible()
  await expect(page.getByTestId('generation-operations-workspace')).toBeHidden()
  await expect(workspace.locator('.submission-review-list')).toBeVisible()
  await expect(workspace.locator('.submission-review-detail')).toBeVisible()
  await expect(workspace.locator('.submission-review-row').first()).toBeVisible()
  await expect(workspace.locator('textarea')).toHaveCount(1)

  const rows = workspace.locator('.submission-review-row')
  if (await rows.count() > 1) await rows.nth(1).click()
  await expect(workspace.locator('.submission-review-row.selected')).toHaveCount(1)
  await expect(workspace.locator('textarea')).toHaveCount(1)
  await expect(page.getByTestId('app-toast')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/phase3-admin-submissions-desktop.png', fullPage: true })
})

test('Security separates operations incidents media and governance with durable selection', async ({ page, request }) => {
  await openAdmin(page, request)
  await selectAdminSection(page, 'Security')
  await expect(page.getByTestId('generation-operations-workspace')).toBeHidden()

  const navigation = page.getByTestId('security-workspace-navigation')
  const tabs = navigation.getByRole('tablist', { name: 'Security workspace' })
  await expect(tabs.getByRole('tab')).toHaveCount(4)
  await expect(tabs.getByRole('tab', { name: 'Operations' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('admin-operations-metrics')).toBeVisible()
  await expect(page.getByTestId('security-incidents-workspace')).toHaveCount(0)
  await expect(page.getByTestId('security-media-workspace')).toHaveCount(0)
  await expect(page.getByTestId('security-governance-workspace')).toHaveCount(0)
  await expect(page.getByTestId('admin-media-lifecycle')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/phase4-security-operations-desktop.png' })

  await tabs.getByRole('tab', { name: 'Incidents' }).click()
  await expect(page.getByTestId('security-incidents-workspace')).toBeVisible()
  await expect(page.getByTestId('admin-security-incidents')).toBeVisible()
  await expect(page.getByTestId('admin-security-events')).toBeVisible()
  await expect(page.getByTestId('admin-operations-metrics')).toHaveCount(0)
  await expect(page.getByTestId('security-media-workspace')).toHaveCount(0)
  await expect(page.getByTestId('security-governance-workspace')).toHaveCount(0)

  await tabs.getByRole('tab', { name: 'Media review' }).click()
  await expect(page.getByTestId('security-media-workspace')).toBeVisible()
  await expect(page.getByTestId('admin-media-lifecycle')).toBeVisible()
  await expect(page.getByTestId('security-incidents-workspace')).toHaveCount(0)
  await expect(page.getByTestId('security-governance-workspace')).toHaveCount(0)
  await expect(page.locator('.admin-media-governance-panel')).toHaveAttribute('data-security-workspace', 'media')
  const mediaBounds = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }))
  expect(mediaBounds.scrollWidth).toBeLessThanOrEqual(mediaBounds.clientWidth)
  await page.screenshot({ path: 'test-results/phase4-security-media-desktop.png' })

  await tabs.getByRole('tab', { name: 'Governance' }).click()
  await expect(page.getByTestId('security-governance-workspace')).toBeVisible()
  await expect(page.locator('.admin-media-governance-panel .governance-config-grid')).toBeVisible()
  await expect(page.getByTestId('security-media-workspace')).toHaveCount(0)
  await expect(page.getByTestId('admin-media-lifecycle')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Sweep jobs', exact: true })).toHaveCount(0)
  await expect(page.getByTestId('app-toast')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/phase4-security-governance-desktop.png' })

  await page.reload()
  await expect(navigation.getByRole('tab', { name: 'Governance' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.admin-media-governance-panel .governance-config-grid')).toBeVisible()
})

test('Security high-risk actions use inline confirmation and feedback', async ({ page, request }) => {
  const nativeDialogs: string[] = []
  const occurredAt = new Date().toISOString()
  const securityEvent = {
    id: 'phase4-security-event',
    type: 'rate_limit.exceeded',
    severity: 'warning',
    source: 'rate_limit',
    clientKey: 'phase4-test-client',
    method: 'POST',
    pathname: '/api/auth/login',
    incidentId: null,
    occurredAt,
    details: { bucket: 'auth' },
  }
  const securityAlert = {
    id: 'phase4-security-alert',
    type: 'security.event.rate_limit.spike',
    state: 'active',
    severity: 'warning',
    title: 'Phase 4 rate-limit alert',
    summary: 'Deterministic interaction contract fixture.',
    count: 3,
    threshold: 2,
    windowMinutes: 15,
    resourceType: 'security_event',
    resourceId: null,
    metadata: { source: 'rate_limit', recentEventIds: [securityEvent.id], recentClientKeys: [securityEvent.clientKey], recentPaths: [securityEvent.pathname] },
    createdAt: occurredAt,
  }
  await page.route(/\/api\/admin\/security\/events(?:\?.*)?$/, (route) => route.fulfill({ json: { data: [securityEvent], meta: { pagination: { limit: 50, nextCursor: null } } } }))
  await page.route(/\/api\/admin\/security\/alerts(?:\?.*)?$/, (route) => route.fulfill({ json: { data: [securityAlert] } }))
  await page.route('**/api/admin/security/alerts/phase4-security-alert/acknowledge', (route) => route.fulfill({ json: { data: { ...securityAlert, state: 'acknowledged', acknowledgedBy: 'opsplus', acknowledgedAt: new Date().toISOString() } } }))
  await page.route('**/api/admin/security/alerts/phase4-security-alert/silence', (route) => route.fulfill({ json: { data: { ...securityAlert, state: 'silenced', silencedUntil: new Date(Date.now() + 86_400_000).toISOString(), silencedBy: 'opsplus', silenceNote: 'phase4_operator_silence' } } }))
  await page.route('**/api/admin/security/alerts/phase4-security-alert/export', (route) => route.fulfill({ body: JSON.stringify({ alert: securityAlert, events: [securityEvent] }, null, 2), contentType: 'application/json' }))
  page.on('dialog', async (dialog) => {
    nativeDialogs.push(dialog.type())
    await dialog.dismiss()
  })

  await openAdmin(page, request)
  await selectAdminSection(page, 'Security')
  const navigation = page.getByTestId('security-workspace-navigation')
  await navigation.getByRole('tab', { name: 'Incidents' }).click()

  const incidentPanel = page.locator('.security-operations-panel')
  const download = page.waitForEvent('download')
  await incidentPanel.getByRole('button', { name: 'Export JSON', exact: true }).click()
  expect((await download).suggestedFilename()).toBe('security-alert-phase4-security-alert.json')
  await expect(page.locator('a[download="security-alert-phase4-security-alert.json"]')).toHaveCount(0)
  await incidentPanel.getByRole('button', { name: 'View source events', exact: true }).click()
  await expect(page.locator('.admin-action-feedback')).toContainText('Filtered security events by alert source')
  await incidentPanel.getByRole('button', { name: 'Acknowledge', exact: true }).click()
  await expect(page.locator('.admin-action-feedback')).toContainText('Security alert acknowledged')
  await expect(page.getByTestId('app-toast')).toHaveCount(0)

  const openIncident = incidentPanel.getByRole('button', { name: 'Open incident', exact: true }).first()
  await expect(openIncident).toBeVisible()
  await openIncident.click()

  let confirmation = page.getByRole('alertdialog', { name: 'Confirm security operation' })
  await expect(confirmation).toBeVisible()
  await expect(confirmation.getByRole('textbox', { name: 'Reason code' })).toHaveValue('security_review_started')
  await expect(confirmation.getByRole('checkbox', { name: 'Confirmed critical incident' })).toBeVisible()
  await confirmation.scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/phase4-security-confirmation-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  const mobileBounds = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }))
  expect(mobileBounds.scrollWidth).toBeLessThanOrEqual(mobileBounds.clientWidth)
  await confirmation.scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/phase4-security-confirmation-mobile.png' })
  await page.setViewportSize({ width: 1280, height: 720 })
  await confirmation.getByRole('button', { name: 'Cancel' }).click()
  await expect(confirmation).toHaveCount(0)

  const silenceAlert = incidentPanel.getByRole('button', { name: 'Silence 24h', exact: true }).first()
  await expect(silenceAlert).toBeVisible()
  await silenceAlert.click()
  confirmation = page.getByRole('alertdialog', { name: 'Confirm security operation' })
  await confirmation.getByRole('textbox', { name: 'Reason code' }).fill('phase4_operator_silence')
  await confirmation.getByRole('button', { name: 'Silence 24h', exact: true }).click()

  await expect(page.locator('.admin-action-feedback')).toContainText('Security alert silenced')
  expect(nativeDialogs).toEqual([])
  await expect(page.getByTestId('app-toast')).toHaveCount(0)
})

test('Security keeps moderator actions read-only and preserves both themes', async ({ page, request }) => {
  await openAdmin(page, request, 'legalpixel')
  await selectAdminSection(page, 'Security')
  const navigation = page.getByTestId('security-workspace-navigation')
  await navigation.getByRole('tab', { name: 'Incidents' }).click()

  const incidentPanel = page.locator('.security-operations-panel')
  const mutationButtons = incidentPanel.getByRole('button', { name: /Acknowledge|Silence 24h|Unsilence|Resolve incident|Open incident|Attach to selected/ })
  for (let index = 0; index < await mutationButtons.count(); index += 1) await expect(mutationButtons.nth(index)).toBeDisabled()

  for (const theme of ['white', 'black']) {
    await page.evaluate((mode) => window.localStorage.setItem('hcaiThemeMode', mode), theme)
    await page.reload()
    await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', theme)
    await expect(navigation).toBeVisible()
    await expect(page.getByTestId('admin-security-events')).toBeVisible()
  }
})

test('Admin operations use one mobile selector without horizontal overflow', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openAdmin(page, request)
  await selectAdminSection(page, 'Security')

  const navigation = page.getByTestId('security-workspace-navigation')
  await expect(navigation.locator('.security-workspace-tabs')).toBeHidden()
  const selector = navigation.locator('.security-workspace-select select')
  await expect(selector).toBeVisible()
  await expect(selector.locator('option')).toHaveCount(4)
  await selector.selectOption('media')
  const mediaLifecycle = page.getByTestId('admin-media-lifecycle')
  await expect(mediaLifecycle).toBeVisible()
  const mediaHeadingGap = await mediaLifecycle.locator('.admin-media-lifecycle-heading > div:first-child').evaluate((element) => {
    const children = [...element.children].map((child) => child.getBoundingClientRect())
    return children.length < 2 ? 0 : children[1].top - children[0].bottom
  })
  expect(mediaHeadingGap).toBeLessThanOrEqual(12)
  await page.screenshot({ path: 'test-results/phase4-security-media-mobile.png' })

  await selectAdminSection(page, 'Submissions')
  const workspace = page.getByTestId('submission-review-workspace')
  await expect(workspace).toBeVisible()
  await expect(workspace.locator('.submission-review-list')).toBeVisible()
  await expect(workspace.locator('.submission-review-detail')).toBeVisible()

  const bounds = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }))
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth)
  expect(await workspace.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  await expect(page.getByTestId('app-toast')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/phase3-admin-operations-mobile.png', fullPage: true })
})
