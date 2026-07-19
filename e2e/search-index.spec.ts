import { expect, test } from '@playwright/test'

import { apiBaseUrl, apiData, authHeaders, login } from './helpers'
import type { ApiSearchResult, ApiPost } from '../src/services/contracts'

const search = async (request: Parameters<typeof login>[0], query: string, token?: string) => apiData<ApiSearchResult[]>(
  request.get(`${apiBaseUrl}/api/search?q=${encodeURIComponent(query)}&types=community&limit=10`, {
    headers: token ? authHeaders(token) : undefined,
  }),
)

test('permission-aware search hides draft content then exposes it after publication', async ({ request }) => {
  const owner = await login(request, 'promptlin')
  const stranger = await login(request, 'taskops')
  const needle = `e2esearchneedle${Date.now()}`
  const draft = await apiData<ApiPost>(request.post(`${apiBaseUrl}/api/posts`, {
    headers: authHeaders(owner.accessToken),
    data: { title: needle, body: `${needle} private draft body`, category: 'Testing', tag: 'search', status: 'draft' },
  }))

  expect(await search(request, needle)).toEqual([])
  expect(await search(request, needle, stranger.accessToken)).toEqual([])
  expect((await search(request, needle, owner.accessToken)).map((item) => item.id)).toContain(draft.id)

  await apiData<ApiPost>(request.post(`${apiBaseUrl}/api/posts/${draft.id}/publish`, {
    headers: authHeaders(owner.accessToken),
    data: { expectedVersion: draft.version },
  }))
  await expect.poll(async () => (await search(request, needle)).map((item) => item.id)).toContain(draft.id)
})

test('discovery overlay searches across resource types and tracks a returned click', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('discovery-search-trigger').click()
  const response = page.waitForResponse((item) => item.url().includes('/api/search?') && item.status() === 200)
  await page.getByTestId('discovery-search-input').fill('task')
  const searchResponse = await response
  const payload = await searchResponse.json()
  expect(payload.meta.searchEventId).toBeTruthy()
  const result = page.locator('.search-result')
  await expect(result.first()).toBeVisible()
  const clickResponse = page.waitForResponse((item) => item.url().includes('/api/search/events/') && item.url().endsWith('/clicks') && item.status() === 200)
  await result.first().click()
  await clickResponse
})
