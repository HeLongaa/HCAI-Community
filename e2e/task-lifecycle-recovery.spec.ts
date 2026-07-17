import { expect, test } from '@playwright/test'
import { apiBaseUrl, apiData, authHeaders, login, signInPage } from './helpers'

const createTask = async (request: Parameters<typeof login>[0], title: string, deadlineAt: string | null = null) => {
  const publisher = await login(request, 'launchteam')
  return apiData<{ id: string; title: string; version: number }>(request.post(`${apiBaseUrl}/api/tasks`, {
    headers: authHeaders(publisher.accessToken),
    data: {
      title,
      category: 'Operations',
      description: 'Browser regression task for lifecycle recovery.',
      acceptanceRules: 'Provide complete lifecycle evidence.',
      pointsReward: 210,
      rewardAmount: null,
      rewardCurrency: null,
      deadlineAt,
      visibility: 'public',
      attachmentIds: [],
    },
  }))
}

test('publisher cancels an eligible task from My Tasks', async ({ page, request }) => {
  const task = await createTask(request, `Task cancellation E2E ${Date.now()}`)
  await signInPage(page, request, 'launchteam')
  await page.goto('/')
  await page.getByTestId('home-action-mine').click()
  await page.getByTestId(`mine-task-card-publisher-${task.id}`).click()
  await expect(page.getByTestId('cancel-task-button')).toBeVisible()

  const response = page.waitForResponse((item) => item.url().endsWith(`/api/tasks/${task.id}/cancel`) && item.request().method() === 'POST')
  await page.getByTestId('cancel-task-button').click()
  expect((await response).ok()).toBeTruthy()
  await expect(page.getByTestId('cancel-task-button')).toHaveCount(0)

  const publisher = await login(request, 'launchteam')
  const cancelled = await apiData<{ status: string; cancelledAt: string | null }>(request.get(`${apiBaseUrl}/api/tasks/${task.id}`, { headers: authHeaders(publisher.accessToken) }))
  expect(cancelled.status).toBe('Cancelled')
  expect(cancelled.cancelledAt).toBeTruthy()
})

test('Task Admin sweeps expiry and runs registered escrow recovery', async ({ page, request }) => {
  const task = await createTask(request, `Task expiry E2E ${Date.now()}`, '2026-07-01T00:00:00.000Z')
  await signInPage(page, request, 'opsplus')
  await page.goto('/')
  await page.getByTestId('nav-admin').click()
  await page.getByRole('button', { name: 'Task review', exact: true }).click()
  const panel = page.getByTestId('task-admin-panel')

  const sweep = page.waitForResponse((item) => item.url().endsWith('/api/admin/tasks/expiry/sweep') && item.request().method() === 'POST')
  await panel.getByTitle('Sweep expired tasks').click()
  expect((await sweep).ok()).toBeTruthy()
  await panel.getByLabel('Search').fill(task.title)
  const row = panel.locator('.task-admin-row').filter({ hasText: task.title })
  await expect(row).toContainText('expired')
  await row.locator('button').click()
  await expect(panel.getByText(/expire · expired/)).toBeVisible()

  await panel.getByRole('textbox', { name: 'Reason code', exact: true }).fill('e2e_escrow_reconciliation')
  const recovery = page.waitForResponse((item) => item.url().endsWith(`/api/admin/tasks/${task.id}/recovery`) && item.request().method() === 'POST')
  await panel.getByRole('button', { name: 'Reconcile escrow', exact: true }).click()
  expect((await recovery).ok()).toBeTruthy()
  await expect(panel.getByText(/release_escrow · escrow_reconciled/)).toBeVisible()
})
