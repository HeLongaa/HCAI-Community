import { expect, test } from '@playwright/test'

import { apiBaseUrl, apiData, authHeaders, signInPage } from './helpers'

test('published task rules govern the publisher form and business metrics export', async ({ page, request }) => {
  const session = await signInPage(page, request, 'opsplus')
  const suffix = Date.now()
  const category = `E2E-${suffix}`
  const templateBody = 'Submit the final artifact, source notes, and a rights summary.'
  const rule = await apiData<{ id: string }>(request.post(`${apiBaseUrl}/api/admin/config-resources/task_rule`, {
    headers: authHeaders(session.accessToken),
    data: {
      key: `task.e2e-${suffix}`, title: 'E2E task category', description: 'Browser-governed task rule.',
      value: {
        category, acceptanceTemplates: [{ id: 'complete-delivery', label: 'Complete delivery', body: templateBody }],
        minimumDeadlineHours: 24, defaultDeadlineHours: 96, maximumDeadlineHours: 720, deadlineRequired: true, active: true,
      },
    },
  }))

  try {
    await apiData(request.post(`${apiBaseUrl}/api/admin/config-resources/task_rule/${rule.id}/publish`, {
      headers: authHeaders(session.accessToken), data: { expectedVersion: 1, reasonCode: 'e2e_publish' },
    }))

    await page.goto('/')
    await page.getByTestId('nav-tasks').click()
    await page.getByRole('button', { name: /Post task|Post a task/ }).click()
    await expect(page.getByLabel('Category')).toHaveValue(category)
    await page.getByLabel('Acceptance template').selectOption('complete-delivery')
    await expect(page.getByLabel('Submission and acceptance rules')).toHaveValue(templateBody)
    await page.getByRole('textbox', { name: /Task title/ }).fill(`Governed E2E task ${suffix}`)
    await page.getByLabel('Reward').fill('$450 / 4,500 pts')

    const createResponse = page.waitForResponse((response) => response.url().endsWith('/api/tasks') && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'Publish task', exact: true }).click()
    const created = await createResponse
    const payload = await created.json() as { data: { category: string; requirements: string[]; deadline: string }; error?: unknown }
    expect(created.ok(), JSON.stringify(payload.error)).toBeTruthy()
    expect(payload.data.category).toBe(category)
    expect(payload.data.requirements).toEqual([templateBody])
    expect(payload.data.deadline).not.toBe('TBD')

    await page.getByTestId('nav-admin').click()
    await page.getByRole('button', { name: 'Task review', exact: true }).click()
    const panel = page.getByTestId('task-admin-panel')
    const metricsResponse = page.waitForResponse((response) => response.url().includes('/api/admin/tasks/business-metrics?') && response.url().includes(encodeURIComponent(category)))
    await panel.getByLabel('Metrics category').fill(category)
    expect((await metricsResponse).ok()).toBeTruthy()
    await expect(panel.locator('.task-business-metrics')).toContainText('1')

    const download = page.waitForEvent('download')
    await panel.getByTitle('Export business metrics').click()
    expect((await download).suggestedFilename()).toMatch(/^task-business-metrics-.*\.json$/)
  } finally {
    await request.delete(`${apiBaseUrl}/api/admin/config-resources/task_rule/${rule.id}`, {
      headers: authHeaders(session.accessToken), data: { expectedVersion: 2, reasonCode: 'e2e_cleanup' },
    })
  }
})
