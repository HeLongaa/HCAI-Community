import { expect, test } from '@playwright/test'

import { apiBaseUrl, apiData, authHeaders, signInPage } from './helpers'

type PostDto = {
  id: string
  title: string
  status: 'draft' | 'published' | 'deleted'
  version: number
}

test('community owner can draft, edit, publish, and soft-delete a post', async ({ page, request }) => {
  const session = await signInPage(page, request, 'promptlin')
  await page.goto('/')
  await page.getByTestId('nav-community').click()

  const workspace = page.getByTestId('community-author-workspace')
  await expect(workspace).toBeVisible()
  await workspace.getByRole('button', { name: 'New post' }).click()
  await workspace.getByLabel('Title').fill('COMM-01 browser lifecycle')
  await workspace.getByLabel('Category').selectOption('Questions')
  await workspace.getByLabel('Tag').fill('Lifecycle')
  await workspace.getByLabel('Excerpt').fill('A private draft moving through the owner lifecycle.')
  await workspace.getByLabel('Body').fill('This post starts private, is edited, then published and soft-deleted.')
  await page.screenshot({ path: 'test-results/community-content-desktop.png', fullPage: true })

  const draftResponse = page.waitForResponse((response) => response.url().endsWith('/api/posts') && response.request().method() === 'POST')
  await workspace.getByRole('button', { name: 'Save draft' }).click()
  expect((await draftResponse).status()).toBe(201)
  const drafts = await apiData<PostDto[]>(request.get(`${apiBaseUrl}/api/posts/mine?status=draft`, { headers: authHeaders(session.accessToken) }))
  const draft = drafts.find((post) => post.title === 'COMM-01 browser lifecycle')
  expect(draft).toBeTruthy()
  expect((await request.get(`${apiBaseUrl}/api/posts/${draft!.id}`)).status()).toBe(404)

  const row = workspace.locator('.community-owned-row').filter({ hasText: 'COMM-01 browser lifecycle' })
  await expect(row).toContainText('Draft')
  await row.getByTitle('Edit').click()
  await workspace.getByLabel('Title').fill('COMM-01 published lifecycle')
  const updateResponse = page.waitForResponse((response) => response.url().endsWith(`/api/posts/${draft!.id}`) && response.request().method() === 'PATCH')
  const publishResponse = page.waitForResponse((response) => response.url().endsWith(`/api/posts/${draft!.id}/publish`) && response.request().method() === 'POST')
  await workspace.locator('.community-editor-actions').getByRole('button', { name: 'Publish', exact: true }).click()
  expect((await updateResponse).status()).toBe(200)
  expect((await publishResponse).status()).toBe(200)

  const published = await apiData<PostDto>(request.get(`${apiBaseUrl}/api/posts/${draft!.id}`))
  expect(published.status).toBe('published')
  expect(published.title).toBe('COMM-01 published lifecycle')

  const publishedRow = workspace.locator('.community-owned-row').filter({ hasText: 'COMM-01 published lifecycle' })
  await expect(publishedRow).toContainText('Published')
  page.on('dialog', (dialog) => dialog.accept())
  const deleteResponse = page.waitForResponse((response) => response.url().endsWith(`/api/posts/${draft!.id}`) && response.request().method() === 'DELETE')
  await publishedRow.getByTitle('Delete').click()
  expect((await deleteResponse).status()).toBe(200)
  await expect(publishedRow).toContainText('Deleted')
  expect((await request.get(`${apiBaseUrl}/api/posts/${draft!.id}`)).status()).toBe(404)
})

test('community owner workspace remains bounded at 390px', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInPage(page, request, 'promptlin')
  await page.goto('/')
  await page.getByRole('button', { name: 'Toggle navigation' }).click()
  await page.getByTestId('nav-community').click()
  const workspace = page.getByTestId('community-author-workspace')
  await workspace.getByRole('button', { name: 'New post' }).click()
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
})
