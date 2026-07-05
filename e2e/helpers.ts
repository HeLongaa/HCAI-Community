import { expect, type APIRequestContext, type Page } from '@playwright/test'

export const apiBaseUrl = 'http://127.0.0.1:8787'

type ApiEnvelope<T> = {
  data: T
  error?: { code: string; message: string }
}

type SessionUser = {
  handle: string
  displayName: string
  role: string
  permissions: string[]
}

type SessionResponse = {
  accessToken: string
  refreshToken: string
  user: SessionUser
}

export async function apiData<T>(requestPromise: Promise<{ ok: () => boolean; status: () => number; json: () => Promise<unknown> }>) {
  const response = await requestPromise
  expect(response.ok(), `API request failed with ${response.status()}`).toBeTruthy()
  const payload = (await response.json()) as ApiEnvelope<T>
  return payload.data
}

export async function login(request: APIRequestContext, handle: string) {
  return apiData<SessionResponse>(
    request.post(`${apiBaseUrl}/api/auth/login`, {
      data: { handle },
    }),
  )
}

export async function signInPage(page: Page, request: APIRequestContext, handle: string) {
  const session = await login(request, handle)
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('hcaiAccessToken', token)
    localStorage.setItem(
      'hcaiUser',
      JSON.stringify({
        displayName: user.displayName,
        role: user.role,
        handle: user.handle,
        profile: null,
        permissions: user.permissions,
      }),
    )
  }, { token: session.accessToken, user: session.user })
  return session
}

export function authHeaders(accessToken: string) {
  return {
    authorization: `Bearer ${accessToken}`,
  }
}
