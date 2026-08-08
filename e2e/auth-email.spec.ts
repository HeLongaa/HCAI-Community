import { expect, test } from '@playwright/test'

test('password recovery keeps generic request copy and honors hash action routes', async ({ page }) => {
  await page.route('**/api/auth/password-reset/request', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { accepted: true } }) })
  })
  await page.route('**/api/auth/password-reset/confirm', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { reset: true } }) })
  })

  await page.goto('/#auth')
  await page.getByRole('button', { name: 'Forgot password?' }).click()
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible()
  await page.getByPlaceholder('Email').fill('unknown@example.com')
  await page.getByRole('button', { name: 'Send reset link' }).click()
  await expect(page.getByText('If an account matches that email, a reset link is on its way.')).toBeVisible()

  await page.goto(`/#auth?action=password-reset&token=${'a'.repeat(43)}`)
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible()
  await expect(page.getByPlaceholder('Email')).toHaveCount(0)
  await page.getByPlaceholder('Password').fill('new-password-123')
  await page.getByRole('button', { name: 'Update password' }).click()
  await expect(page.getByRole('heading', { name: 'Password updated' })).toBeVisible()
  await expect(page.getByText('Sign in again on every device.')).toBeVisible()
})

test('password recovery reflows at 320 CSS pixels in Chinese', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await page.goto('/#home')
  await page.getByRole('button', { name: '中文' }).click()
  await page.getByRole('button', { name: '登录' }).click()
  await page.getByRole('button', { name: '忘记密码？' }).click()
  await expect(page.getByRole('heading', { name: '找回密码' })).toBeVisible()
  const shell = page.locator('.auth-page-shell')
  const layout = await shell.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }))
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1)
  expect(layout.scrollHeight).toBeLessThanOrEqual(layout.clientHeight + 1)
  await expect(page.getByRole('button', { name: '发送重置链接' })).toBeVisible()
})

test('email registration and password login work from the login modal', async ({ page, context }) => {
  const suffix = Date.now()
  const email = `browser-${suffix}@example.com`
  const password = 'correct-horse-42'
  const displayName = 'Browser Auth User'
  const handle = `browser${suffix}`

  await page.goto('/')
  await expect(page.locator('.hcai-landing')).toBeVisible()
  await page.getByRole('button', { name: 'Login' }).click()
  await expect(page).toHaveURL(/#auth$/)
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  await page.getByRole('button', { name: 'Sign up' }).click()
  await page.getByPlaceholder('Display name').fill(displayName)
  await page.getByPlaceholder('Handle').fill(handle)
  await page.getByPlaceholder('Email').fill(email)
  await page.getByPlaceholder('Password').fill(password)
  await page.getByLabel('I have reviewed and accept the current required policy versions.').check()

  const registerResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/auth/register') && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Create account' }).click()
  expect((await registerResponse).ok()).toBeTruthy()
  await expect(page.locator('.sidebar-profile-name', { hasText: displayName })).toBeVisible()

  await page.evaluate(() => localStorage.clear())
  await context.clearCookies()
  await page.reload()
  await expect(page.locator('.hcai-landing')).toBeVisible()
  await page.getByRole('button', { name: 'Login' }).click()
  await expect(page).toHaveURL(/#auth$/)
  await page.getByPlaceholder('Email').fill(email)
  await page.getByPlaceholder('Password').fill(password)

  const loginResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/auth/login') && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Continue with email' }).click()
  expect((await loginResponse).ok()).toBeTruthy()
  await expect(page.locator('.sidebar-profile-name', { hasText: displayName })).toBeVisible()

  const sessionsResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/auth/sessions') && response.request().method() === 'GET',
  )
  await page.getByTestId('security-open-button').click()
  expect((await sessionsResponse).ok()).toBeTruthy()
  await expect(page.getByTestId('security-session-card')).toHaveCount(2)
  await expect(page.getByTestId('oauth-link-google')).toBeVisible()

  const linkStartResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/auth/oauth/google/start') && response.request().method() === 'POST',
  )
  const linkCallbackResponse = page.waitForResponse((response) =>
    response.url().includes('/api/auth/oauth/google/callback') && response.request().method() === 'GET',
  )
  const linkedAccountsResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/auth/oauth/accounts') && response.request().method() === 'GET',
  )
  await page.getByTestId('oauth-link-google').getByRole('button', { name: 'Link' }).click()
  expect((await linkStartResponse).ok()).toBeTruthy()
  expect((await linkCallbackResponse).ok()).toBeTruthy()
  expect((await linkedAccountsResponse).ok()).toBeTruthy()
  await expect(page.getByTestId('oauth-link-google').getByRole('button', { name: 'Unlink' })).toBeVisible()

  const unlinkResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/auth/oauth/accounts/google') && response.request().method() === 'DELETE',
  )
  await page.getByTestId('oauth-link-google').getByRole('button', { name: 'Unlink' }).click()
  expect((await unlinkResponse).ok()).toBeTruthy()
  await expect(page.getByTestId('oauth-link-google').getByRole('button', { name: 'Link' })).toBeVisible()

  const revokeResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/auth/sessions') && response.request().method() === 'DELETE',
  )
  await page.getByTestId('revoke-all-sessions').click()
  const revoked = await revokeResponse
  expect(revoked.ok()).toBeTruthy()
  expect((await revoked.json()).data.revoked).toBe(3)
  const rejectedAccess = await page.evaluate(async () => {
    const token = localStorage.getItem('hcaiAccessToken')
    return fetch('/api/me', { headers: token ? { authorization: `Bearer ${token}` } : {} }).then((response) => response.status)
  })
  expect(rejectedAccess).toBe(401)
})

test('dev OAuth provider login works from the login modal', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.hcai-landing')).toBeVisible()
  const providersResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/auth/oauth/providers') && response.request().method() === 'GET',
  )
  await page.getByRole('button', { name: 'Login' }).click()
  expect((await providersResponse).ok()).toBeTruthy()
  await expect(page.getByRole('button', { name: 'Google' })).toBeVisible()

  const startResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/auth/oauth/google/start') && response.request().method() === 'POST',
  )
  const callbackResponse = page.waitForResponse((response) =>
    response.url().includes('/api/auth/oauth/google/callback') && response.request().method() === 'GET',
  )
  await page.getByRole('button', { name: 'Google' }).click()
  expect((await startResponse).ok()).toBeTruthy()
  expect((await callbackResponse).ok()).toBeTruthy()
  await expect(page.locator('.sidebar-profile-name', { hasText: 'Google User' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Review the policies required for this account' })).toBeVisible()
  await page.getByLabel('I reviewed and accept all required policy versions listed above.').check()
  const consentResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/compliance/consent') && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Accept current versions' }).click()
  expect((await consentResponse).ok()).toBeTruthy()
  await expect(page.getByRole('heading', { name: 'Review the policies required for this account' })).toBeHidden()
})

test('top-level OAuth callback restores the browser session through refresh cookies', async ({ page }) => {
  await page.goto('/')
  const authorizationUrl = await page.evaluate(async () => {
    localStorage.setItem('hcaiAccessToken', 'stale-access-token')
    localStorage.setItem('hcaiUser', JSON.stringify({ displayName: 'Stale User' }))
    const response = await fetch('/api/auth/oauth/google/start', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ redirectTo: '/profile' }),
    })
    const payload = await response.json()
    const callback = new URL(payload.data.authorizationUrl as string)
    return `${window.location.origin}${callback.pathname}${callback.search}`
  })

  const refreshResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/auth/refresh') && response.request().method() === 'POST' && response.ok(),
  )
  await page.goto(authorizationUrl)
  expect((await refreshResponse).ok()).toBeTruthy()
  await expect(page.locator('.sidebar-profile-name', { hasText: 'Google User' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('hcaiAccessToken'))).not.toBe('stale-access-token')
  await expect.poll(() => page.evaluate(() => localStorage.getItem('hcaiOAuthRedirectTo'))).toBeNull()
})
