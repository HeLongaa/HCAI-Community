import { expect, test } from '@playwright/test'

import type { ApiChatMessage } from '../src/services/contracts'
import { apiBaseUrl, apiData, authHeaders, login } from './helpers'

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
