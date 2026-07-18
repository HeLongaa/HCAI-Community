import { expect, test, type Page } from '@playwright/test'

import { apiBaseUrl, apiData, authHeaders, login, signInPage } from './helpers'

type ModerationCase = {
  id: string
  status: 'open' | 'resolved' | 'appealed' | 'closed'
  version: number
}

const openSupportCenter = async (page: Page, mobile = false) => {
  await page.goto('/')
  if (mobile) await page.getByRole('button', { name: 'Toggle navigation' }).click()
  await page.getByTestId('support-center-link').click()
  await expect(page.getByRole('heading', { name: 'Support center' })).toBeVisible()
}

const openTrustPanel = async (page: Page, mobile = false) => {
  await page.goto('/')
  if (mobile) await page.getByRole('button', { name: 'Toggle navigation' }).click()
  await page.getByTestId('nav-admin').click()
  await page.getByRole('button', { name: 'Trust & Safety', exact: true }).click()
  const panel = page.getByTestId('trust-admin-panel')
  await expect(panel).toBeVisible()
  return panel
}

const selectCase = async (page: Page, subject: string) => {
  const panel = page.getByTestId('trust-admin-panel')
  await panel.getByLabel('Case search').fill(subject)
  const response = page.waitForResponse((candidate) => candidate.url().includes('/api/admin/trust/cases?') && candidate.request().method() === 'GET')
  await panel.getByRole('button', { name: 'Apply', exact: true }).click()
  expect((await response).ok()).toBeTruthy()
  const row = panel.locator('.trust-case-list button').filter({ hasText: subject })
  await expect(row).toHaveCount(1)
  await row.click()
  await expect(panel.locator('.trust-case-detail')).toContainText(subject)
  return panel
}

const expectBounded = async (page: Page, selector: string) => {
  const layout = await page.locator(selector).evaluate((element) => {
    const root = element as HTMLElement
    const rect = root.getBoundingClientRect()
    return {
      insideViewport: rect.left >= -1 && rect.right <= document.documentElement.clientWidth + 1,
      overflow: [root, ...root.querySelectorAll<HTMLElement>('*')]
        .filter((node) => getComputedStyle(node).overflowX === 'visible' && node.scrollWidth > node.clientWidth + 2)
        .map((node) => `${node.tagName.toLowerCase()}.${node.className}:${node.clientWidth}/${node.scrollWidth}`)
        .slice(0, 12),
    }
  })
  expect(layout.insideViewport).toBe(true)
  expect(layout.overflow).toEqual([])
}

test('report, original decision, affected-user appeal, and independent appeal decision form one fact chain', async ({ browser, request }) => {
  test.setTimeout(60_000)
  const subject = `Trust workflow ${Date.now()}`
  const contexts = await Promise.all(Array.from({ length: 4 }, () => browser.newContext({ viewport: { width: 1280, height: 900 } })))
  const [reporterPage, reviewerPage, affectedPage, appealReviewerPage] = await Promise.all(contexts.map((context) => context.newPage()))

  try {
    await signInPage(reporterPage, request, 'promptlin')
    await openSupportCenter(reporterPage)
    await reporterPage.getByRole('button', { name: /Report content/ }).click()
    await reporterPage.getByLabel('Subject').fill(subject)
    await reporterPage.getByLabel('Safety category').selectOption('privacy')
    await reporterPage.getByLabel('Details').fill('The affected account requests review of exposed private information in this test case.')
    await reporterPage.getByLabel('Related resource').selectOption('account')
    await reporterPage.getByLabel('Resource ID').fill('demo-user-admin')
    const reportResponse = reporterPage.waitForResponse((response) => response.url().endsWith('/api/trust/reports') && response.request().method() === 'POST')
    await reporterPage.getByRole('button', { name: 'Submit request' }).click()
    const createdResponse = await reportResponse
    expect(createdResponse.status()).toBe(201)
    const createdPayload = await createdResponse.json() as { data: { item: ModerationCase } }
    const caseId = createdPayload.data.item.id
    await expect(reporterPage.getByRole('article').filter({ hasText: caseId })).toContainText('open')

    await signInPage(reviewerPage, request, 'legalpixel')
    await openTrustPanel(reviewerPage)
    const reviewerPanel = await selectCase(reviewerPage, subject)
    await reviewerPanel.getByLabel('Moderation outcome').selectOption('restrict_content')
    await reviewerPanel.getByLabel('Moderation reason code').fill('privacy_confirmed')
    await reviewerPanel.getByLabel('Moderation review note').fill('The bounded evidence supports a visibility restriction.')
    const decisionResponse = reviewerPage.waitForResponse((response) => response.url().endsWith(`/api/admin/trust/cases/${caseId}/decisions`) && response.request().method() === 'POST')
    await reviewerPanel.getByRole('button', { name: 'Append decision' }).click()
    expect((await decisionResponse).status()).toBe(201)
    await expect(reviewerPanel.locator('.trust-case-detail')).toContainText('resolved')
    await expect(reviewerPanel.locator('.trust-fact-list')).toContainText('original · restrict_content · privacy_confirmed')

    await signInPage(affectedPage, request, 'opsplus')
    await openSupportCenter(affectedPage)
    await affectedPage.getByRole('button', { name: /Appeal a decision/ }).click()
    await affectedPage.getByLabel('Subject').fill(`Appeal ${subject}`)
    await affectedPage.getByLabel('Details').fill('The affected account provides additional context and requests an independent review.')
    await affectedPage.getByLabel('Resource ID').fill(caseId)
    const appealResponse = affectedPage.waitForResponse((response) => response.url().endsWith(`/api/trust/cases/${caseId}/appeals`) && response.request().method() === 'POST')
    await affectedPage.getByRole('button', { name: 'Submit request' }).click()
    expect((await appealResponse).status()).toBe(201)
    await expect(affectedPage.getByRole('article').filter({ hasText: caseId })).toContainText('appealed')

    await signInPage(appealReviewerPage, request, 'finops')
    await openTrustPanel(appealReviewerPage)
    const appealPanel = await selectCase(appealReviewerPage, subject)
    await appealPanel.getByLabel('Moderation outcome').selectOption('partially_overturn')
    await appealPanel.getByLabel('Moderation reason code').fill('additional_context_confirmed')
    await appealPanel.getByLabel('Moderation review note').fill('Independent review supports a narrower visibility restriction.')
    const appealDecisionResponse = appealReviewerPage.waitForResponse((response) => response.url().endsWith(`/api/admin/trust/cases/${caseId}/decisions`) && response.request().method() === 'POST')
    await appealPanel.getByRole('button', { name: 'Append appeal decision' }).click()
    const closedResponse = await appealDecisionResponse
    expect(closedResponse.status()).toBe(201)
    const closedPayload = await closedResponse.json() as { data: { decisions: Array<{ stage: string; reviewer: { id: string } }> } }
    const originalReviewerId = closedPayload.data.decisions.find((decision) => decision.stage === 'original')?.reviewer.id
    const appealReviewerId = closedPayload.data.decisions.find((decision) => decision.stage === 'appeal')?.reviewer.id
    expect(originalReviewerId).toBe('demo-user-moderator')
    expect(appealReviewerId).toBe('demo-user-finops')
    expect(appealReviewerId).not.toBe(originalReviewerId)
    await expect(appealPanel.locator('.trust-case-detail')).toContainText('closed')
    await expect(appealPanel.locator('.trust-fact-list')).toContainText('appeal · partially_overturn · additional_context_confirmed')
    await expect(appealPanel.locator('.trust-fact-list')).toContainText('@legalpixel')
    await expect(appealPanel.locator('.trust-fact-list')).toContainText('@opsplus')
  } finally {
    await Promise.all(contexts.map((context) => context.close()))
  }
})

test('Support and Trust Admin surfaces remain bounded at 390px', async ({ browser, request }) => {
  const reporter = await login(request, 'promptlin')
  const subject = `Trust mobile ${Date.now()}`
  await apiData(request.post(`${apiBaseUrl}/api/trust/reports`, {
    headers: authHeaders(reporter.accessToken),
    data: { targetType: 'user', targetId: 'demo-user-admin', category: 'spam', subject, statement: 'This report provides enough bounded detail for the mobile Trust layout regression.', locale: 'en' },
  }))

  const supportContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const adminContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const supportPage = await supportContext.newPage()
  const adminPage = await adminContext.newPage()
  try {
    await signInPage(supportPage, request, 'promptlin')
    await openSupportCenter(supportPage, true)
    await expectBounded(supportPage, '.support-page')

    await signInPage(adminPage, request, 'opsplus')
    await openTrustPanel(adminPage, true)
    await selectCase(adminPage, subject)
    await expectBounded(adminPage, '[data-testid="trust-admin-panel"]')
  } finally {
    await Promise.all([supportContext.close(), adminContext.close()])
  }
})

test('Trust operations manages rule rollout, signal queue SLA, and confirmed bulk priority without bulk decisions', async ({ page, request }) => {
  const reporter = await login(request, 'promptlin')
  const admin = await login(request, 'opsplus')
  const suffix = Date.now()
  const subject = `Safety operations ${suffix}`
  const report = await apiData<{ item: ModerationCase }>(request.post(`${apiBaseUrl}/api/trust/reports`, {
    headers: authHeaders(reporter.accessToken),
    data: { targetType: 'user', targetId: 'demo-user-taskops', category: 'spam', subject, statement: 'A bounded safety signal requires queue triage and SLA evidence.', locale: 'en', sourceKey: `trust-ops-e2e-report-${suffix}` },
  }))
  const rule = await apiData<{ id: string }>(request.post(`${apiBaseUrl}/api/admin/trust/rules`, {
    headers: authHeaders(admin.accessToken),
    data: { ruleKey: `community.spam.${suffix}`, name: `Community spam ${suffix}`, signalType: 'spam_score', targetType: 'user', category: 'spam', minimumScore: 70, priority: 'high', configHash: 'd'.repeat(64) },
  }))
  await apiData(request.post(`${apiBaseUrl}/api/admin/trust/rules/${rule.id}/transitions`, { headers: authHeaders(admin.accessToken), data: { toState: 'active', reasonCode: 'e2e_activation' } }))
  await apiData(request.post(`${apiBaseUrl}/api/admin/trust/signals`, {
    headers: authHeaders(admin.accessToken),
    data: { sourceKey: `trust-ops-e2e-signal-${suffix}`, caseId: report.item.id, ruleVersionId: rule.id, signalType: 'spam_score', severity: 'high', score: 96, contentHash: 'e'.repeat(64), observedAt: new Date().toISOString() },
  }))

  await signInPage(page, request, 'opsplus')
  await openTrustPanel(page)
  const operations = page.getByTestId('trust-safety-operations')
  await expect(operations).toContainText(subject)
  const queueRow = operations.getByTestId(`trust-queue-${report.item.id}`)
  await expect(queueRow).toContainText('high')
  await queueRow.getByRole('checkbox').check()
  await operations.getByLabel('Moderation bulk action').selectOption('set_priority')
  await operations.getByLabel('Moderation bulk priority').selectOption('critical')
  await operations.getByRole('button', { name: 'Preview', exact: true }).click()
  const confirmation = operations.getByLabel('Moderation bulk confirmation')
  await expect(confirmation).toHaveAttribute('placeholder', 'APPLY 1 CASES')
  await confirmation.fill('APPLY 1 CASES')
  const bulkResponse = page.waitForResponse((response) => response.url().endsWith('/api/admin/trust/queue/bulk') && response.request().method() === 'POST')
  await operations.getByRole('button', { name: 'Execute', exact: true }).click()
  expect((await bulkResponse).status()).toBe(201)

  await operations.getByRole('button', { name: 'Rules', exact: true }).click()
  await expect(operations.getByTestId(`trust-rule-${rule.id}`)).toContainText('active')
  await operations.getByRole('button', { name: 'Signals', exact: true }).click()
  await expect(operations).toContainText('spam_score · 96')
  await expectBounded(page, '[data-testid="trust-safety-operations"]')
})
