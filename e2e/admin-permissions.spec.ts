import { expect, test } from '@playwright/test'
import { apiBaseUrl, apiData, authHeaders, login, signInPage } from './helpers'

const creatorDefaults = ['task:propose', 'task:claim', 'task:submit', 'post:create', 'comment:create', 'points:read']

test('admin can edit and save role permissions from the permission matrix', async ({ page, request }) => {
  const adminSession = await login(request, 'opsplus')
  await apiData(
    request.put(`${apiBaseUrl}/api/admin/roles/creator/permissions`, {
      headers: authHeaders(adminSession.accessToken),
      data: { permissions: creatorDefaults },
    }),
  )

  await signInPage(page, request, 'opsplus')
  await page.goto('/')
  await page.getByTestId('nav-admin').click()

  const creatorRow = page.getByTestId('permission-row-creator')
  await expect(creatorRow).toBeVisible()
  await creatorRow.getByTestId('permission-edit-creator').click()

  const taskModerateChip = creatorRow.getByTestId('permission-chip-creator-task:moderate')
  await expect(taskModerateChip).not.toHaveClass(/granted/)
  await taskModerateChip.click()

  const saveResponse = page.waitForResponse((response) =>
    response.url().includes('/api/admin/roles/creator/permissions') && response.request().method() === 'PUT',
  )
  await creatorRow.getByTestId('permission-save-creator').click()
  await saveResponse

  await expect(creatorRow.getByTestId('permission-chip-creator-task:moderate')).toHaveClass(/granted/)

  const roles = await apiData<Array<{ role: string; permissions: string[] }>>(
    request.get(`${apiBaseUrl}/api/admin/roles`, {
      headers: authHeaders(adminSession.accessToken),
    }),
  )
  expect(roles.find((role) => role.role === 'creator')?.permissions).toContain('task:moderate')
})
