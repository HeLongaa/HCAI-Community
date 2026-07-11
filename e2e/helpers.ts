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

type ComplianceManifest = {
  consentContract: { requiredPolicyIds: string[] }
  policies: Array<{ id: string; version: string }>
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

export async function acceptCurrentPolicies(request: APIRequestContext, accessToken: string) {
  const manifest = await apiData<ComplianceManifest>(
    request.get(`${apiBaseUrl}/api/compliance/policies`),
  )
  const policyVersions = Object.fromEntries(
    manifest.policies
      .filter((policy) => manifest.consentContract.requiredPolicyIds.includes(policy.id))
      .map((policy) => [policy.id, policy.version]),
  )
  return apiData(
    request.post(`${apiBaseUrl}/api/compliance/consent`, {
      headers: authHeaders(accessToken),
      data: { accepted: true, locale: 'en', policyVersions },
    }),
  )
}

export async function signInPage(page: Page, request: APIRequestContext, handle: string) {
  const session = await login(request, handle)
  await acceptCurrentPolicies(request, session.accessToken)
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
