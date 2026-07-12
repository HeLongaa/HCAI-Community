import { expect, test } from '@playwright/test'

import type { ApiChatMessage } from '../src/services/contracts'
import { apiBaseUrl, apiData, authHeaders, login, signInPage } from './helpers'

const openChatWorkspace = async (page: import('@playwright/test').Page) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'AI Workspace' }).click()
  await page.getByRole('button', { name: 'Chat', exact: true }).click()
  await expect(page.getByTestId('chat-workspace')).toBeVisible()
}

test('owner can stream, recover, and delete an encrypted Chat conversation', async ({ request }) => {
  const owner = await login(request, 'promptlin')
  const tasks = await apiData<Array<{ id: string }>>(
    request.get(`${apiBaseUrl}/api/tasks?limit=1`, { headers: authHeaders(owner.accessToken) }),
  )
  const conversation = await apiData<{ id: string }>(
    request.post(`${apiBaseUrl}/api/chat/conversations`, {
      headers: authHeaders(owner.accessToken),
      data: { mode: 'assistant' },
    }),
  )

  const stream = await request.post(`${apiBaseUrl}/api/chat/conversations/${conversation.id}/turns/stream`, {
    headers: {
      ...authHeaders(owner.accessToken),
      accept: 'text/event-stream',
    },
    data: {
      clientTurnId: 'e2e-chat-turn-0001',
      message: 'Create a concise launch checklist.',
      mode: 'assistant',
      parameters: { maxOutputTokens: 512, responseFormat: 'text' },
      productContext: [{ type: 'task', id: tasks[0].id }],
    },
  })
  expect(stream.ok()).toBeTruthy()
  expect(stream.headers()['content-type']).toContain('text/event-stream')
  const eventBody = await stream.text()
  expect(eventBody).toContain('event: turn.accepted')
  expect(eventBody).toContain('event: content.delta')
  expect(eventBody).toContain('event: turn.completed')
  expect(eventBody).toContain('"productContext":[{"type":"task"')
  expect(eventBody).toContain('"disposition":"allow"')

  const messages = await apiData<ApiChatMessage[]>(
    request.get(`${apiBaseUrl}/api/chat/conversations/${conversation.id}/messages`, {
      headers: authHeaders(owner.accessToken),
    }),
  )
  expect(messages.map((message) => message.role)).toEqual(['user', 'assistant'])
  expect(messages[0].content).toBe('Create a concise launch checklist.')
  expect(messages[1].content).toContain('Mock assistant response')

  const other = await login(request, 'taskops')
  const denied = await request.get(`${apiBaseUrl}/api/chat/conversations/${conversation.id}/messages`, {
    headers: authHeaders(other.accessToken),
  })
  expect(denied.status()).toBe(404)

  const deleted = await request.delete(`${apiBaseUrl}/api/chat/conversations/${conversation.id}`, {
    headers: authHeaders(owner.accessToken),
  })
  expect(deleted.ok()).toBeTruthy()
  expect(((await deleted.json()).data as { replayUntil: string }).replayUntil).toBeTruthy()
})

test('Chat UI creates, streams, recovers, grounds, and deletes a conversation', async ({ page, request }) => {
  await signInPage(page, request, 'launchteam')
  await page.route('**/api/chat/input-assets?*', async (route) => {
    await route.fulfill({
      json: {
        data: [{
          id: 'asset-chat-ui-fixture',
          fileName: 'launch-brief.pdf',
          contentType: 'application/pdf',
          sizeBytes: 4096,
          purpose: 'task_attachment',
        }],
        meta: { pagination: { limit: 24, nextCursor: null } },
      },
    })
  })
  await openChatWorkspace(page)
  await page.getByTitle('New conversation').click()

  const attachmentCheckbox = page.getByRole('checkbox', { name: /launch-brief\.pdf/ })
  await attachmentCheckbox.check()
  await expect(page.locator('.chat-selection-summary')).toContainText('launch-brief.pdf')
  await attachmentCheckbox.uncheck()

  const firstContext = page.locator('.chat-input-list.context input').first()
  await firstContext.check()
  await page.getByPlaceholder('Ask for a prompt, script, brief, or revision...').fill('Create a concise launch checklist for this task.')
  const streamRequest = page.waitForRequest((candidate) =>
    candidate.url().includes('/api/chat/conversations/') && candidate.url().endsWith('/turns/stream'),
  )
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  const sent = await streamRequest
  expect(sent.postDataJSON()).toMatchObject({
    message: 'Create a concise launch checklist for this task.',
    mode: 'assistant',
  })
  expect(sent.postDataJSON().productContext).toHaveLength(1)
  await expect(page.locator('.chat-message.assistant').last()).toContainText('Mock assistant response: Create a concise launch checklist')
  await expect(page.locator('.chat-conversation-row').first()).toContainText('Create a concise launch checklist')

  await page.reload()
  await page.getByRole('button', { name: 'AI Workspace' }).click()
  await page.getByRole('button', { name: 'Chat', exact: true }).click()
  await expect(page.locator('.chat-message.user').last()).toContainText('Create a concise launch checklist for this task.')
  await expect(page.locator('.chat-message.assistant').last()).toContainText('Mock assistant response')

  page.once('dialog', (dialog) => dialog.accept())
  await page.locator('.chat-conversation-row').first().getByTitle('Delete conversation').click()
  await expect(page.locator('.chat-conversation-row').filter({ hasText: 'Create a concise launch checklist' })).toHaveCount(0)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByTestId('chat-workspace')).toBeVisible()
  await expect(page.locator('.chat-main-panel')).toBeVisible()
  await expect(page.locator('.chat-context-panel')).toBeVisible()
})

test('Chat UI stops an active stream and opens a prefilled safety appeal', async ({ page, request }) => {
  await signInPage(page, request, 'legalpixel')
  await openChatWorkspace(page)
  await page.getByTitle('New conversation').click()

  const longPrompt = `Build a detailed creative checklist from these notes: ${'clear step, '.repeat(45)}`
  await page.getByPlaceholder('Ask for a prompt, script, brief, or revision...').fill(longPrompt)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  const stopButton = page.getByRole('button', { name: 'Stop', exact: true })
  await expect(stopButton).toBeEnabled()
  await stopButton.evaluate((button: HTMLButtonElement) => button.click())
  await expect(page.getByText('Stopped', { exact: true }).last()).toBeVisible()

  await page.getByTitle('New conversation').click()
  await page.getByPlaceholder('Ask for a prompt, script, brief, or revision...').fill('Give me investment advice for my retirement account.')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Review or appeal' })).toBeVisible()
  await page.getByRole('button', { name: 'Review or appeal' }).click()

  await expect(page.getByRole('heading', { name: 'Support center' })).toBeVisible()
  await expect(page.getByLabel('Subject')).toHaveValue('Appeal a Chat safety decision')
  await expect(page.getByLabel('Related resource')).toHaveValue('moderation_decision')
  await expect(page.getByLabel('Resource ID')).toHaveValue(/chat-review-/)
})
