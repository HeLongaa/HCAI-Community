import { expect, type APIRequestContext, type Page } from '@playwright/test'

export const apiBaseUrl = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? 8787}`

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
  await storePageSession(page, session)
  return session
}

async function storePageSession(page: Page, session: SessionResponse) {
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
}

export async function registerPageAccount(page: Page, request: APIRequestContext, handle: string) {
  const manifest = await apiData<ComplianceManifest>(
    request.get(`${apiBaseUrl}/api/compliance/policies`),
  )
  const policyVersions = Object.fromEntries(
    manifest.policies
      .filter((policy) => manifest.consentContract.requiredPolicyIds.includes(policy.id))
      .map((policy) => [policy.id, policy.version]),
  )
  const session = await apiData<SessionResponse>(request.post(`${apiBaseUrl}/api/auth/register`, {
    data: {
      displayName: 'Privacy Test User',
      handle,
      email: `${handle}@example.com`,
      password: 'privacy-test-password-42',
      policyConsent: { accepted: true, locale: 'en', policyVersions },
    },
  }))
  await storePageSession(page, session)
  return session
}

export async function selectAdminSection(page: Page, label: string) {
  const mobileSelect = page.locator('.admin-tab-select select')
  if ((page.viewportSize()?.width ?? 1280) <= 1240) {
    await mobileSelect.waitFor({ state: 'visible' })
    await mobileSelect.selectOption({ label })
    return
  }
  await page.getByRole('main').getByRole('button', { name: label, exact: true }).click()
}

export async function selectTrustSafetyWorkspace(page: Page, workspace: 'cases' | 'policies' | 'operations' | 'evidence') {
  const mobileSelect = page.locator('.trust-workspace-select select')
  if ((page.viewportSize()?.width ?? 1280) <= 900) {
    await mobileSelect.waitFor({ state: 'visible' })
    await mobileSelect.selectOption(workspace)
    return
  }
  await page.getByTestId('trust-safety-workspace').locator(`.trust-workspace-tabs [role="tab"]`).nth(['cases', 'policies', 'operations', 'evidence'].indexOf(workspace)).click()
}

export async function selectGenerationOperationsWorkspace(page: Page, workspace: 'records' | 'recovery' | 'providers' | 'metrics') {
  if ((page.viewportSize()?.width ?? 1280) <= 900) {
    await page.locator('.generation-workspace-select select').selectOption(workspace)
    return
  }
  const labels = {
    records: 'Generation records workspace',
    recovery: 'Recovery queue workspace',
    providers: 'Provider controls workspace',
    metrics: 'Business metrics workspace',
  }
  await page.getByTestId('generation-operations-workspace').getByRole('tab', { name: labels[workspace] }).click()
}

export function authHeaders(accessToken: string) {
  return {
    authorization: `Bearer ${accessToken}`,
  }
}
