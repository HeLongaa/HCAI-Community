import { expect, test } from '@playwright/test'
import { apiBaseUrl, apiData, authHeaders, login, signInPage } from './helpers'
import type { ApiSupportRequest } from '../src/services/contracts'

const createTicket = async (request: Parameters<typeof login>[0], suffix: number) => {
  const owner = await login(request, 'promptlin')
  return apiData<ApiSupportRequest>(request.post(`${apiBaseUrl}/api/support/requests`, { headers: authHeaders(owner.accessToken), data: {
    category: 'general_support', subject: `E2E support operations ${suffix}`,
    details: 'A support request used to verify assignment, reply, lifecycle, SLA, and responsive Admin behavior.',
    relatedResourceType: 'none', locale: 'en',
  } }))
}

test('support requester and Admin complete search, priority, reply, and lifecycle flow', async ({ page, request }) => {
  const ticket = await createTicket(request, Date.now())
  await signInPage(page, request, 'opsplus')
  await page.goto('/')
  await page.getByTestId('nav-admin').click()
  await page.getByRole('main').getByRole('button', { name: 'Support', exact: true }).click()
  const panel = page.getByTestId('support-admin-panel')
  await expect(panel).toBeVisible()
  await expect(page.getByLabel('AI dynamic island guide')).toHaveCount(0)

  await panel.getByLabel('Search tickets').fill(ticket.id)
  const row = panel.locator('.support-ticket-list .admin-list-row').filter({ hasText: ticket.subject })
  await expect(row).toBeVisible()
  await row.click()
  const detail = panel.locator('.support-ticket-detail')
  await expect(detail).toContainText(ticket.details)

  const priorityResponse = page.waitForResponse((response) => /\/api\/admin\/support\/tickets\/[^/]+$/.test(response.url()) && response.request().method() === 'PATCH')
  await detail.locator('.support-detail-controls select').nth(1).selectOption('urgent')
  expect((await priorityResponse).ok()).toBeTruthy()
  await expect(detail).toContainText('urgent')

  await detail.getByPlaceholder('Reply to requester').fill('We are reviewing your support request now.')
  const replyResponse = page.waitForResponse((response) => response.url().endsWith(`/api/admin/support/tickets/${ticket.id}/messages`) && response.request().method() === 'POST')
  await detail.getByRole('button', { name: 'Send', exact: true }).click()
  expect((await replyResponse).status()).toBe(201)
  await expect(detail).toContainText('We are reviewing your support request now.')
  await expect(detail).toContainText('in progress')
  await panel.screenshot({ path: 'test-results/support-admin-desktop.png' })

  await signInPage(page, request, 'promptlin')
  await page.goto('/')
  await page.getByTestId('support-center-link').click()
  const requesterRow = page.locator('.support-history > article').filter({ hasText: ticket.subject })
  await expect(requesterRow).toBeVisible()
  await requesterRow.getByRole('button', { name: 'Reply to support' }).click()
  await expect(requesterRow).toContainText('We are reviewing your support request now.')
  await requesterRow.getByPlaceholder('Add information for the support team').fill('Here is the additional information requested by support.')
  const requesterReplyResponse = page.waitForResponse((response) => response.url().endsWith(`/api/support/requests/${ticket.id}/messages`) && response.request().method() === 'POST')
  await requesterRow.getByRole('button', { name: 'Send reply' }).click()
  const requesterReply = await requesterReplyResponse
  expect(requesterReply.status()).toBe(201)
  const requesterReplyPayload = await requesterReply.json() as { data: ApiSupportRequest }
  expect(requesterReplyPayload.data.version).toBeGreaterThan(ticket.version)
  await expect(requesterRow.getByRole('button', { name: 'Reply to support' })).toBeVisible()

  await requesterRow.getByRole('button', { name: 'Reply to support' }).click()
  await expect(requesterRow).toContainText('Here is the additional information requested by support.')
  await requesterRow.screenshot({ path: 'test-results/support-requester-reply.png' })
})

test('support Admin workspace remains bounded on mobile', async ({ page, request }) => {
  await createTicket(request, Date.now())
  await page.setViewportSize({ width: 390, height: 844 })
  await signInPage(page, request, 'opsplus')
  await page.goto('/')
  await page.getByRole('button', { name: 'Toggle navigation' }).click()
  await page.getByTestId('nav-admin').click()
  await page.getByRole('main').getByRole('button', { name: 'Support', exact: true }).click()
  const panel = page.getByTestId('support-admin-panel')
  await expect(panel).toBeVisible()
  const overflow = await panel.evaluate((element) => element.scrollWidth - element.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  await panel.screenshot({ path: 'test-results/support-admin-mobile.png' })
})
