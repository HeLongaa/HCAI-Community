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

test('release control UI requests, independently approves, and records a deployment', async ({ page, request }) => {
  const requester = await login(request, 'opsplus')
  const approver = await login(request, 'finops')
  await signInPage(page, request, 'opsplus')
  await page.goto('/')
  await page.getByTestId('nav-admin').click()

  const panel = page.getByTestId('admin-release-control')
  await expect(panel).toBeVisible()
  await panel.getByLabel('Artifact version').fill('e2e-release-current')
  await panel.getByLabel('Rollback version').fill('e2e-release-previous')
  await panel.getByLabel('Release summary').fill('E2E production promotion')
  const requestResponse = page.waitForResponse((response) => response.url().endsWith('/api/admin/releases') && response.request().method() === 'POST')
  await panel.getByRole('button', { name: 'Request' }).click()
  const requested = await requestResponse.then((response) => response.json()) as { data: { id: string } }
  await expect(panel.getByText('E2E production promotion')).toBeVisible()

  await apiData(request.post(`${apiBaseUrl}/api/admin/releases/${requested.data.id}/approve`, {
    headers: authHeaders(approver.accessToken),
    data: { reasonCode: 'e2e_quality_gate' },
  }))
  await panel.getByTitle('Refresh').click()
  const releaseRow = panel.locator('button.admin-row').filter({ hasText: 'E2E production promotion' })
  await expect(releaseRow.locator('.status')).toHaveText('approved')
  await panel.getByLabel('Deployment id').fill('e2e-deployment-1')
  await panel.getByLabel('Evidence URL').fill('https://example.test/evidence/e2e-deployment-1')
  const deployResponse = page.waitForResponse((response) => response.url().endsWith(`/api/admin/releases/${requested.data.id}/apply`))
  await panel.getByRole('button', { name: 'Record deployment' }).click()
  await deployResponse
  await expect(releaseRow.locator('.status')).toHaveText('deployed')

  const release = await apiData<{ status: string; evidence: unknown[] }>(request.get(`${apiBaseUrl}/api/admin/releases/${requested.data.id}`, {
    headers: authHeaders(requester.accessToken),
  }))
  expect(release.status).toBe('deployed')
  expect(release.evidence).toHaveLength(3)
})

test('audit UI verifies the chain and creates an immutable archive manifest', async ({ page, request }) => {
  await signInPage(page, request, 'opsplus')
  await page.goto('/')
  await page.getByTestId('nav-admin').click()

  const verifyResponse = page.waitForResponse((response) => response.url().endsWith('/api/admin/audit/verify'))
  await page.getByRole('button', { name: 'Verify integrity' }).click()
  await verifyResponse
  await expect(page.getByText('Integrity complete')).toBeVisible()

  const archiveResponse = page.waitForResponse((response) => response.url().endsWith('/api/admin/audit/archives') && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Archive evidence' }).click()
  await archiveResponse
  await expect(page.getByText(/Archives: 1/)).toBeVisible()
})
