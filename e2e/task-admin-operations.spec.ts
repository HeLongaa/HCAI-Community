import { expect, test } from '@playwright/test'
import { apiBaseUrl, apiData, authHeaders, login, signInPage } from './helpers'

const createTask = async (request: Parameters<typeof login>[0], title: string) => {
  const publisher = await login(request, 'launchteam')
  return apiData<{ id: string; title: string }>(request.post(`${apiBaseUrl}/api/tasks`, {
    headers: authHeaders(publisher.accessToken),
    data: {
      title,
      category: 'Operations',
      description: 'Browser regression task for administrative operations.',
      acceptanceRules: 'Provide complete browser evidence.',
      pointsReward: 180,
      rewardAmount: null,
      rewardCurrency: null,
      deadlineAt: null,
      visibility: 'public',
      attachmentIds: [],
    },
  }))
}

test('Task Admin edits, archives, restores, and bulk disposes with evidence', async ({ page, request }) => {
  const task = await createTask(request, `Task Admin E2E ${Date.now()}`)
  await signInPage(page, request, 'opsplus')
  await page.goto('/')
  await page.getByTestId('nav-admin').click()
  await page.getByRole('button', { name: 'Task review', exact: true }).click()

  const panel = page.getByTestId('task-admin-panel')
  await expect(panel).toBeVisible()
  await panel.getByLabel('Search').fill(task.id)
  const taskRow = panel.locator('.task-admin-row').filter({ hasText: task.id })
  await expect(taskRow).toBeVisible()
  await taskRow.locator('button').click()

  const editedTitle = `${task.title} edited`
  await panel.getByRole('textbox', { name: 'Title', exact: true }).fill(editedTitle)
  await panel.getByRole('textbox', { name: 'Reason code', exact: true }).fill('e2e_task_edit')
  await panel.getByRole('textbox', { name: 'Note', exact: true }).fill('Verified by the task operations browser test.')
  const editResponse = page.waitForResponse((response) => response.url().endsWith(`/api/admin/tasks/${task.id}`) && response.request().method() === 'PATCH')
  await panel.getByRole('button', { name: 'Save', exact: true }).click()
  expect((await editResponse).ok()).toBeTruthy()
  await expect(panel.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(editedTitle)

  const archiveResponse = page.waitForResponse((response) => response.url().endsWith(`/api/admin/tasks/${task.id}/archive`))
  await panel.getByRole('button', { name: 'Archive', exact: true }).click()
  expect((await archiveResponse).ok()).toBeTruthy()
  await expect(panel.getByRole('button', { name: 'Restore', exact: true })).toBeVisible()
  const publicHidden = await request.get(`${apiBaseUrl}/api/tasks/${task.id}`)
  expect(publicHidden.status()).toBe(404)

  const restoreResponse = page.waitForResponse((response) => response.url().endsWith(`/api/admin/tasks/${task.id}/restore`))
  await panel.getByRole('button', { name: 'Restore', exact: true }).click()
  expect((await restoreResponse).ok()).toBeTruthy()
  await expect(panel.getByRole('button', { name: 'Archive', exact: true })).toBeVisible()

  await panel.getByLabel(`Select ${editedTitle}`).check()
  await panel.getByRole('button', { name: 'Preview', exact: true }).click()
  const confirmation = panel.getByPlaceholder('ARCHIVE TASKS')
  await expect(confirmation).toBeVisible()
  await confirmation.fill('ARCHIVE TASKS')
  const bulkResponse = page.waitForResponse((response) => response.url().endsWith('/api/admin/tasks/bulk') && response.request().method() === 'POST')
  await panel.getByRole('button', { name: 'Execute', exact: true }).click()
  const bulk = await bulkResponse
  expect(bulk.ok()).toBeTruthy()
  const bulkPayload = await bulk.json() as { data: { succeededCount: number; skippedCount: number } }
  expect(bulkPayload.data).toMatchObject({ succeededCount: 1, skippedCount: 0 })
  await expect(taskRow).toHaveCount(0)
})

test('Task Admin panel stays bounded on a mobile viewport', async ({ page, request }) => {
  await createTask(request, `Task Admin mobile ${Date.now()}`)
  await page.setViewportSize({ width: 390, height: 844 })
  await signInPage(page, request, 'opsplus')
  await page.goto('/')
  await page.getByRole('button', { name: 'Toggle navigation' }).click()
  await page.getByTestId('nav-admin').click()
  await page.getByRole('button', { name: 'Task review', exact: true }).click()
  const panel = page.getByTestId('task-admin-panel')
  await expect(panel).toBeVisible()
  await panel.scrollIntoViewIfNeeded()
  const layout = await panel.evaluate((element) => ({
    panelWidth: element.getBoundingClientRect().width,
    viewportWidth: window.innerWidth,
    overflow: [...element.querySelectorAll<HTMLElement>('*')]
      .filter((node) => getComputedStyle(node).overflowX !== 'auto' && node.scrollWidth > node.clientWidth + 2)
      .map((node) => node.className)
      .filter(Boolean)
      .slice(0, 10),
  }))
  expect(layout.panelWidth).toBeLessThanOrEqual(layout.viewportWidth)
  expect(layout.overflow).toEqual([])
  await page.screenshot({ path: 'test-results/task-admin-mobile.png', fullPage: true })
})
