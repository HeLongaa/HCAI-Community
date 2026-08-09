import { expect, test } from '@playwright/test'

import { apiBaseUrl, apiData, authHeaders, signInPage } from './helpers'

type PostDto = {
  id: string
  title: string
  status: 'draft' | 'published' | 'deleted'
  version: number
}

test('community owner can draft, edit, publish, and soft-delete a post', async ({ page, request }) => {
  const runId = Date.now()
  const draftTitle = `COMM-01 browser lifecycle ${runId}`
  const publishedTitle = `COMM-01 published lifecycle ${runId}`
  const session = await signInPage(page, request, 'promptlin')
  await page.goto('/')
  await page.getByTestId('nav-community').click()

  const workspace = page.getByTestId('community-author-workspace')
  await page.getByRole('button', { name: 'New post' }).click()
  await expect(workspace).toBeVisible()
  await workspace.getByLabel('Title').fill(draftTitle)
  await workspace.getByLabel('Category').selectOption('Questions')
  await workspace.getByLabel('Tag').fill('Lifecycle')
  await workspace.getByLabel('Excerpt').fill('A private draft moving through the owner lifecycle.')
  await workspace.getByLabel('Body').fill('This post starts private, is edited, then published and soft-deleted.')
  await page.screenshot({ path: 'test-results/community-content-desktop.png', fullPage: true })

  const draftResponse = page.waitForResponse((response) => response.url().endsWith('/api/posts') && response.request().method() === 'POST')
  await workspace.getByRole('button', { name: 'Save draft' }).click()
  expect((await draftResponse).status()).toBe(201)
  const drafts = await apiData<PostDto[]>(request.get(`${apiBaseUrl}/api/posts/mine?status=draft`, { headers: authHeaders(session.accessToken) }))
  const draft = drafts.find((post) => post.title === draftTitle)
  expect(draft).toBeTruthy()
  expect((await request.get(`${apiBaseUrl}/api/posts/${draft!.id}`)).status()).toBe(404)

  const row = workspace.locator('.community-owned-row').filter({ hasText: draftTitle })
  await expect(row).toContainText('Draft')
  await row.getByTitle('Edit').click()
  await workspace.getByLabel('Title').fill(publishedTitle)
  const updateResponse = page.waitForResponse((response) => response.url().endsWith(`/api/posts/${draft!.id}`) && response.request().method() === 'PATCH')
  const publishResponse = page.waitForResponse((response) => response.url().endsWith(`/api/posts/${draft!.id}/publish`) && response.request().method() === 'POST')
  await workspace.locator('.community-editor-actions').getByRole('button', { name: 'Publish', exact: true }).click()
  expect((await updateResponse).status()).toBe(200)
  expect((await publishResponse).status()).toBe(200)

  const published = await apiData<PostDto>(request.get(`${apiBaseUrl}/api/posts/${draft!.id}`))
  expect(published.status).toBe('published')
  expect(published.title).toBe(publishedTitle)

  const publishedRow = workspace.locator('.community-owned-row').filter({ hasText: publishedTitle })
  await expect(publishedRow).toContainText('Published')
  let deleteAttempts = 0
  await page.route(`**/api/posts/${draft!.id}`, async (route) => {
    if (route.request().method() !== 'DELETE') {
      await route.continue()
      return
    }
    deleteAttempts += 1
    if (deleteAttempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'COMMUNITY_DELETE_UNAVAILABLE', message: 'Temporary test failure' } }),
      })
      return
    }
    await route.continue()
  })

  const deleteButton = publishedRow.getByTitle('Delete')
  await deleteButton.click()
  let confirmation = publishedRow.getByRole('alertdialog', { name: 'Confirm community post deletion' })
  await expect(confirmation).toContainText('Existing moderation records remain available.')
  await expect(confirmation.getByRole('button', { name: 'Back', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(confirmation).toHaveCount(0)
  await expect(deleteButton).toBeFocused()
  expect(deleteAttempts).toBe(0)

  await deleteButton.click()
  confirmation = publishedRow.getByRole('alertdialog', { name: 'Confirm community post deletion' })
  const failedDeleteResponse = page.waitForResponse((response) => response.url().endsWith(`/api/posts/${draft!.id}`) && response.request().method() === 'DELETE')
  await confirmation.getByRole('button', { name: 'Delete post', exact: true }).click()
  expect((await failedDeleteResponse).status()).toBe(503)
  await expect(confirmation).toContainText('Delete failed and the post was not changed. Try again.')
  await expect(publishedRow).toContainText('Published')
  await expect(page.getByTestId('app-toast')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/community-delete-confirmation-desktop.png', fullPage: true })

  const deleteResponse = page.waitForResponse((response) => response.url().endsWith(`/api/posts/${draft!.id}`) && response.request().method() === 'DELETE')
  await confirmation.getByRole('button', { name: 'Delete post', exact: true }).click()
  expect((await deleteResponse).status()).toBe(200)
  await expect(confirmation).toHaveCount(0)
  await expect(publishedRow).toContainText('Deleted')
  await expect(workspace.getByRole('status')).toContainText('Post deleted.')
  await expect(page.getByTestId('app-toast')).toHaveCount(0)
  expect((await request.get(`${apiBaseUrl}/api/posts/${draft!.id}`)).status()).toBe(404)
})

test('community owner workspace remains bounded at 390px', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const session = await signInPage(page, request, 'promptlin')
  const mobilePost = await apiData<PostDto>(request.post(`${apiBaseUrl}/api/posts`, {
    headers: authHeaders(session.accessToken),
    data: {
      title: `COMM-01 mobile confirmation ${Date.now()}`,
      body: 'A temporary private draft for the mobile confirmation layout.',
      category: 'Questions',
      tag: 'Lifecycle',
      excerpt: 'Mobile delete confirmation target.',
      status: 'draft',
    },
  }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Toggle navigation' }).click()
  await page.getByTestId('nav-community').click()
  const workspace = page.getByTestId('community-author-workspace')
  await page.getByRole('button', { name: 'New post' }).click()
  await expect(workspace).toBeVisible()
  const layout = await workspace.evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    viewportWidth: window.innerWidth,
    documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
    overflow: [...element.querySelectorAll<HTMLElement>('*')]
      .filter((node) => !['INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName) && node.scrollWidth > node.clientWidth + 2)
      .map((node) => `${node.tagName.toLowerCase()}:${node.clientWidth}/${node.scrollWidth}`),
  }))
  expect(layout.width).toBeLessThanOrEqual(layout.viewportWidth)
  expect(layout.documentOverflow).toBeLessThanOrEqual(1)
  expect(layout.overflow).toEqual([])
  await page.screenshot({ path: 'test-results/community-content-mobile.png', fullPage: true })

  await page.getByRole('button', { name: 'Close editor' }).click()
  await page.getByRole('button', { name: 'My posts' }).click()
  const mobileRow = workspace.locator('.community-owned-row').filter({ hasText: mobilePost.title })
  await mobileRow.getByTitle('Delete').click()
  const confirmation = mobileRow.getByRole('alertdialog', { name: 'Confirm community post deletion' })
  await expect(confirmation).toBeVisible()
  const confirmationLayout = await confirmation.evaluate((element) => ({
    left: element.getBoundingClientRect().left,
    right: element.getBoundingClientRect().right,
    viewportWidth: window.innerWidth,
    documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
    overflow: [...element.querySelectorAll<HTMLElement>('*')]
      .filter((node) => node.scrollWidth > node.clientWidth + 2)
      .map((node) => `${node.tagName.toLowerCase()}:${node.clientWidth}/${node.scrollWidth}`),
  }))
  expect(confirmationLayout.left).toBeGreaterThanOrEqual(0)
  expect(confirmationLayout.right).toBeLessThanOrEqual(confirmationLayout.viewportWidth)
  expect(confirmationLayout.documentOverflow).toBeLessThanOrEqual(1)
  expect(confirmationLayout.overflow).toEqual([])
  await page.screenshot({ path: 'test-results/community-delete-confirmation-mobile.png', fullPage: true })
  await page.keyboard.press('Escape')
  await expect(confirmation).toHaveCount(0)
  const cleanupResponse = await request.delete(`${apiBaseUrl}/api/posts/${mobilePost.id}`, {
    headers: authHeaders(session.accessToken),
    data: { expectedVersion: mobilePost.version, reasonCode: 'e2e_cleanup' },
  })
  expect(cleanupResponse.status()).toBe(200)
})
