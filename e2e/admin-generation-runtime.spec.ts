import { expect, test } from '@playwright/test'

import { acceptCurrentPolicies, apiBaseUrl, authHeaders, login, signInPage } from './helpers'

test('admin generation operations expose summary sorting and CSV export', async ({ page, request }) => {
  const owner = await login(request, 'taskops')
  await acceptCurrentPolicies(request, owner.accessToken)
  const created = await request.post(`${apiBaseUrl}/api/creative/generations`, {
    headers: authHeaders(owner.accessToken),
    data: {
      workspace: 'image',
      mode: 'text_to_image',
      providerId: 'mock',
      prompt: `Admin batch E2E ${Date.now()}`,
      inputAssetIds: [],
      parameters: { aspectRatio: '1:1', stylePreset: 'none' },
      idempotencyKey: `admin-batch-e2e:${Date.now()}`,
    },
  })
  expect(created.ok()).toBeTruthy()
  const generationId = ((await created.json()) as { data: { id: string } }).data.id

  await signInPage(page, request, 'opsplus')
  await page.goto('/')
  await page.getByTestId('nav-admin').click()
  await page.getByRole('main').getByRole('button', { name: 'Generations', exact: true }).click()

  const panel = page.getByTestId('admin-generation-history')
  await expect(panel).toBeVisible()
  await expect(panel.getByText('Total records', { exact: true })).toBeVisible()
  const metrics = panel.getByTestId('generation-business-metrics')
  await expect(metrics).toBeVisible()
  await expect(metrics.getByText('Success rate', { exact: true })).toBeVisible()
  await expect(metrics.getByText('Reuse conversion', { exact: true })).toBeVisible()
  await expect(metrics.getByText('Provider cost', { exact: true })).toBeVisible()
  await panel.getByLabel(`Select generation ${generationId}`).check()
  await panel.getByLabel('Generation sort', { exact: true }).selectOption('status')
  await panel.getByLabel('Generation sort direction').selectOption('asc')

  await panel.getByRole('button', { name: 'Preview', exact: true }).click()
  await expect(panel.getByTestId('generation-bulk-preview-counts')).toContainText('Blocked 1')
  await panel.getByLabel('Generation bulk confirmation').fill('CANCEL GENERATIONS')
  await panel.getByRole('button', { name: 'Execute', exact: true }).click()
  await expect(panel.getByTestId('generation-bulk-result')).toContainText('Blocked 1')
  await expect(panel.getByTestId('admin-generation-recovery')).toBeVisible()

  const download = page.waitForEvent('download')
  await panel.getByTitle('Export generation records').click()
  const artifact = await download
  expect(artifact.suggestedFilename()).toMatch(/^creative-generations-\d{4}-\d{2}-\d{2}\.csv$/)

  const metricsDownload = page.waitForEvent('download')
  await panel.getByLabel('Export generation metrics CSV').click()
  const metricsArtifact = await metricsDownload
  expect(metricsArtifact.suggestedFilename()).toMatch(/^creative-generation-metrics-\d{4}-\d{2}-\d{2}\.csv$/)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(panel).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
  await metrics.scrollIntoViewIfNeeded()
  await page.screenshot({ path: '/tmp/ai-stats-01-admin-mobile.png' })
})

test('generation operations remain read-only without disposition permissions', async ({ page, request }) => {
  const session = await signInPage(page, request, 'legalpixel')
  const preview = await request.post(`${apiBaseUrl}/api/admin/creative/generations/bulk-preview`, {
    headers: authHeaders(session.accessToken),
    data: { action: 'cancel', targetIds: ['generation-read-only-check'] },
  })
  expect(preview.status()).toBe(403)
  const recovery = await request.post(`${apiBaseUrl}/api/admin/creative/executions/execution-read-only-check/recover`, {
    headers: authHeaders(session.accessToken),
    data: { reasonCode: 'operator_reviewed', errorCode: 'EXECUTION_ABANDONED' },
  })
  expect(recovery.status()).toBe(403)

  await page.goto('/')
  await page.getByTestId('nav-admin').click()
  await page.getByRole('main').getByRole('button', { name: 'Generations', exact: true }).click()
  const panel = page.getByTestId('admin-generation-history')
  await expect(panel.getByRole('button', { name: 'Preview', exact: true })).toBeDisabled()
  await expect(panel.getByLabel('Execution recovery reason')).toBeDisabled()
})
