import assert from 'node:assert/strict'
import test from 'node:test'

import { createRouter } from '../../common/http/router.js'
import { createServer } from '../../common/http/server.js'
import { createRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { createMemoryAuthFailureMonitor } from '../../auth/loginMonitor.js'
import { listSecurityEvents, resetSecurityEvents } from '../../security/securityEvents.js'
import { currentRequiredPolicyVersions } from '../../compliance/policyManifest.js'
import { registerAuthRoutes } from './routes.js'

const createTestServer = () => createRouteTestServer(registerAuthRoutes)
const registrationBody = (payload) => ({
  ...payload,
  policyConsent: {
    accepted: true,
    locale: 'en',
    policyVersions: currentRequiredPolicyVersions(),
  },
})

const createAuthTestServerWithContext = async (context = {}) => {
  const router = createRouter()
  registerAuthRoutes(router)
  const server = createServer(router, context)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  }
}

const setCookies = (response) => response.headers.getSetCookie?.() ?? String(response.headers.get('set-cookie') ?? '').split(/,(?=\s*hcai)/).filter(Boolean)
const setCookieNamed = (response, name) => setCookies(response).find((cookie) => cookie.trim().startsWith(`${name}=`)) ?? ''
const cookiePair = (setCookieHeader) => setCookieHeader.split(';')[0]
const cookieValue = (setCookieHeader) => decodeURIComponent(cookiePair(setCookieHeader).split('=').slice(1).join('='))
const cookieHeader = (...setCookieHeaders) => setCookieHeaders.map(cookiePair).join('; ')

const postJson = async (baseUrl, path, body, headers = {}) => fetch(`${baseUrl}${path}`, {
  method: 'POST',
  headers: {
    accept: 'application/json',
    'content-type': 'application/json',
    ...headers,
  },
  body: JSON.stringify(body),
})

const withProcessEnv = async (patch, run) => {
  const previous = Object.fromEntries(Object.keys(patch).map((key) => [key, process.env[key]]))
  try {
    for (const [key, value] of Object.entries(patch)) {
      if (value == null) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    return await run()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

test('POST /api/auth/login returns a session envelope for demo accounts', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/auth/login', {
      body: { handle: 'opsplus' },
    })

    assert.equal(status, 201)
    assert.ok(payload.data.accessToken)
    assert.ok(payload.data.refreshToken)
    assert.equal(payload.data.accessToken.startsWith('demo-access.'), false)
    assert.equal(payload.data.accessToken.split('.').length, 3)
    assert.equal(payload.data.refreshToken.startsWith('demo-refresh.'), false)
    assert.equal(payload.data.user.handle, 'opsplus')
    assert.equal(payload.data.user.role, 'admin')
    assert.equal(payload.error, undefined)
  } finally {
    await server.close()
  }
})

test('POST /api/auth/login sets an HttpOnly refresh cookie for browser sessions', async () => {
  const server = await createTestServer()
  try {
    const response = await postJson(server.url, '/api/auth/login', { handle: 'opsplus' })
    const payload = await response.json()
    const cookie = setCookieNamed(response, 'hcaiRefreshToken')
    const csrfCookie = setCookieNamed(response, 'hcaiCsrfToken')

    assert.equal(response.status, 201)
    assert.ok(payload.data.refreshToken)
    assert.match(cookie, /^hcaiRefreshToken=hcai_refresh\./)
    assert.match(cookie, /HttpOnly/)
    assert.match(cookie, /Path=\/api\/auth/)
    assert.match(cookie, /SameSite=Lax/)
    assert.match(cookie, /Max-Age=2592000/)
    assert.match(csrfCookie, /^hcaiCsrfToken=/)
    assert.match(csrfCookie, /Path=\//)
    assert.doesNotMatch(csrfCookie, /HttpOnly/)
  } finally {
    await server.close()
  }
})

test('OPTIONS preflight allows trusted browser origins with credentials', async () => {
  const server = await createTestServer()
  try {
    const response = await fetch(`${server.url}/api/auth/refresh`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://127.0.0.1:5174',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-csrf-token',
      },
    })

    assert.equal(response.status, 204)
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5174')
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true')
    assert.match(response.headers.get('access-control-allow-headers'), /x-csrf-token/)
  } finally {
    await server.close()
  }
})

test('deployment smoke rotates cross-site cookie refresh sessions for trusted origins', async () => {
  await withProcessEnv({
    NODE_ENV: 'production',
    ACCESS_TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
    AUTH_COOKIE_SAMESITE: 'None',
    AUTH_COOKIE_DOMAIN: '.example.com',
    AUTH_TRUSTED_ORIGINS: 'https://app.example.com',
  }, async () => {
    const server = await createTestServer()
    try {
      const loginResponse = await postJson(server.url, '/api/auth/login', { handle: 'taskops' }, {
        origin: 'https://app.example.com',
      })
      const loginPayload = await loginResponse.json()
      const refreshCookie = setCookieNamed(loginResponse, 'hcaiRefreshToken')
      const csrfCookie = setCookieNamed(loginResponse, 'hcaiCsrfToken')

      assert.equal(loginResponse.status, 201)
      assert.ok(loginPayload.data.refreshToken)
      assert.equal(loginResponse.headers.get('access-control-allow-origin'), 'https://app.example.com')
      assert.equal(loginResponse.headers.get('access-control-allow-credentials'), 'true')
      assert.match(refreshCookie, /Domain=.example.com/)
      assert.match(refreshCookie, /Secure/)
      assert.match(refreshCookie, /SameSite=None/)
      assert.match(csrfCookie, /Domain=.example.com/)
      assert.match(csrfCookie, /Secure/)
      assert.match(csrfCookie, /SameSite=None/)

      const refreshResponse = await postJson(server.url, '/api/auth/refresh', {}, {
        cookie: cookieHeader(refreshCookie, csrfCookie),
        origin: 'https://app.example.com',
        'x-csrf-token': cookieValue(csrfCookie),
      })
      const refreshPayload = await refreshResponse.json()
      const rotatedCookie = setCookieNamed(refreshResponse, 'hcaiRefreshToken')

      assert.equal(refreshResponse.status, 201)
      assert.ok(refreshPayload.data.accessToken)
      assert.notEqual(refreshPayload.data.refreshToken, loginPayload.data.refreshToken)
      assert.equal(refreshResponse.headers.get('access-control-allow-origin'), 'https://app.example.com')
      assert.match(rotatedCookie, /Secure/)
      assert.match(rotatedCookie, /SameSite=None/)
      assert.notEqual(cookiePair(rotatedCookie), cookiePair(refreshCookie))
    } finally {
      await server.close()
    }
  })
})

test('POST /api/auth/login returns AUTH_FAILED for unknown handles', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/auth/login', {
      body: { handle: 'unknown-user' },
    })

    assert.equal(status, 401)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'AUTH_FAILED')
    assert.equal(payload.error.message, 'Unknown demo account')
  } finally {
    await server.close()
  }
})

test('POST /api/auth/login emits auth failure anomalies from failed login patterns', async () => {
  resetSecurityEvents()
  await withProcessEnv({
    AUTH_FAILURE_IP_ACCOUNT_THRESHOLD: '2',
    AUTH_FAILURE_ACCOUNT_IP_THRESHOLD: '99',
  }, async () => {
    const anomalies = []
    const server = await createAuthTestServerWithContext({
      authFailureMonitor: createMemoryAuthFailureMonitor(),
      onAuthFailureAnomaly: (event) => anomalies.push(event),
    })
    try {
      await requestJson(server.url, '/api/auth/login', {
        body: { handle: 'missing-one' },
        headers: { 'x-forwarded-for': '203.0.113.80' },
      })
      const failed = await requestJson(server.url, '/api/auth/login', {
        body: { handle: 'missing-two' },
        headers: { 'x-forwarded-for': '203.0.113.80' },
      })

      assert.equal(failed.status, 401)
      assert.equal(anomalies.length, 1)
      assert.equal(anomalies[0].type, 'auth.failed_login.ip_accounts')
      assert.equal(anomalies[0].clientKey, '203.0.113.80')
      assert.equal(anomalies[0].distinctIdentityCount, 2)
      assert.equal(anomalies[0].reason, 'unknown_demo_handle')

      const securityEvents = listSecurityEvents({ source: 'auth_failure', limit: 10 })
      assert.ok(securityEvents.items.some((event) =>
        event.type === 'auth.failed_login.ip_accounts' &&
        event.clientKey === '203.0.113.80' &&
        event.details.reason === 'unknown_demo_handle'
      ))
    } finally {
      resetSecurityEvents()
      await server.close()
    }
  })
})

test('POST /api/auth/login keeps AUTH_FAILED stable when anomaly observer fails', async () => {
  await withProcessEnv({ AUTH_FAILURE_IP_ACCOUNT_THRESHOLD: '1' }, async () => {
    const server = await createAuthTestServerWithContext({
      authFailureMonitor: createMemoryAuthFailureMonitor(),
      onAuthFailureAnomaly: () => {
        throw new Error('metrics sink unavailable')
      },
    })
    try {
      const { status, payload } = await requestJson(server.url, '/api/auth/login', {
        body: { handle: 'observer-failure' },
      })

      assert.equal(status, 401)
      assert.equal(payload.error.code, 'AUTH_FAILED')
      assert.equal(payload.error.message, 'Unknown demo account')
    } finally {
      await server.close()
    }
  })
})

test('GET /api/me resolves the signed access token user', async () => {
  const server = await createTestServer()
  try {
    const login = await requestJson(server.url, '/api/auth/login', {
      body: { handle: 'opsplus' },
    })
    const { status, payload } = await requestJson(server.url, '/api/me', {
      method: 'GET',
      token: login.payload.data.accessToken,
    })

    assert.equal(status, 200)
    assert.equal(payload.data.handle, 'opsplus')
    assert.equal(payload.data.role, 'admin')
  } finally {
    await server.close()
  }
})

test('GET /api/me requires authentication', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/me', {
      method: 'GET',
    })

    assert.equal(status, 401)
    assert.equal(payload.error.code, 'AUTH_REQUIRED')
  } finally {
    await server.close()
  }
})

test('POST /api/auth/register creates an email account session', async () => {
  const server = await createTestServer()
  try {
    const email = `product-${Date.now()}@example.com`
    const { status, payload } = await requestJson(server.url, '/api/auth/register', {
      body: registrationBody({
        email,
        password: 'correct-horse-42',
        displayName: 'Product Maker',
        handle: `maker${Date.now()}`,
      }),
    })

    assert.equal(status, 201)
    assert.ok(payload.data.accessToken)
    assert.ok(payload.data.refreshToken)
    assert.equal(payload.data.user.email, email)
    assert.equal(payload.data.user.displayName, 'Product Maker')
    assert.equal(payload.data.user.role, 'member')
    assert.equal(payload.error, undefined)

    const me = await requestJson(server.url, '/api/me', {
      method: 'GET',
      token: payload.data.accessToken,
    })
    assert.equal(me.status, 200)
    assert.equal(me.payload.data.policyConsent.current, true)
    assert.deepEqual(me.payload.data.policyConsent.acceptedPolicyVersions, currentRequiredPolicyVersions())
  } finally {
    await server.close()
  }
})

test('POST /api/auth/register requires affirmative consent to exact current policy versions', async () => {
  const server = await createTestServer()
  try {
    const suffix = Date.now()
    const missing = await requestJson(server.url, '/api/auth/register', {
      body: {
        email: `missing-consent-${suffix}@example.com`,
        password: 'correct-horse-42',
        displayName: 'Missing Consent',
        handle: `missingconsent${suffix}`,
      },
    })
    assert.equal(missing.status, 400)
    assert.equal(missing.payload.error.code, 'POLICY_CONSENT_REQUIRED')

    const stale = await requestJson(server.url, '/api/auth/register', {
      body: {
        ...registrationBody({
          email: `stale-consent-${suffix}@example.com`,
          password: 'correct-horse-42',
          displayName: 'Stale Consent',
          handle: `staleconsent${suffix}`,
        }),
        policyConsent: {
          accepted: true,
          locale: 'en',
          policyVersions: { ...currentRequiredPolicyVersions(), privacy: '0.9.0' },
        },
      },
    })
    assert.equal(stale.status, 409)
    assert.equal(stale.payload.error.code, 'POLICY_VERSION_MISMATCH')
  } finally {
    await server.close()
  }
})

test('POST /api/auth/register rejects duplicate email or handle', async () => {
  const server = await createTestServer()
  try {
    const suffix = Date.now()
    const email = `duplicate-${suffix}@example.com`
    const handle = `dupe${suffix}`
    await requestJson(server.url, '/api/auth/register', {
      body: registrationBody({ email, password: 'correct-horse-42', displayName: 'First User', handle }),
    })

    const duplicateEmail = await requestJson(server.url, '/api/auth/register', {
      body: registrationBody({ email, password: 'correct-horse-42', displayName: 'Second User', handle: `dupeb${suffix}` }),
    })
    assert.equal(duplicateEmail.status, 409)
    assert.equal(duplicateEmail.payload.error.code, 'ACCOUNT_EXISTS')

    const duplicateHandle = await requestJson(server.url, '/api/auth/register', {
      body: registrationBody({ email: `other-${suffix}@example.com`, password: 'correct-horse-42', displayName: 'Third User', handle }),
    })
    assert.equal(duplicateHandle.status, 409)
    assert.equal(duplicateHandle.payload.error.code, 'ACCOUNT_EXISTS')
  } finally {
    await server.close()
  }
})

test('POST /api/auth/login supports email password credentials', async () => {
  const server = await createTestServer()
  try {
    const suffix = Date.now()
    const email = `login-${suffix}@example.com`
    const password = 'correct-horse-42'
    await requestJson(server.url, '/api/auth/register', {
      body: registrationBody({ email, password, displayName: 'Login User', handle: `login${suffix}` }),
    })

    const login = await requestJson(server.url, '/api/auth/login', {
      body: { email: email.toUpperCase(), password },
    })
    assert.equal(login.status, 201)
    assert.equal(login.payload.data.user.email, email)
    assert.ok(login.payload.data.accessToken)

    const failed = await requestJson(server.url, '/api/auth/login', {
      body: { email, password: 'wrong-password' },
    })
    assert.equal(failed.status, 401)
    assert.equal(failed.payload.error.code, 'AUTH_FAILED')
  } finally {
    await server.close()
  }
})

test('GET /api/auth/oauth/providers returns public provider status', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/auth/oauth/providers', {
      method: 'GET',
    })

    assert.equal(status, 200)
    assert.deepEqual(payload.data.map((provider) => provider.provider), ['google', 'apple', 'discord'])
    assert.equal(payload.data[0].mode, 'dev')
    assert.equal(payload.data[0].label, 'Google')
    assert.equal(payload.data[0].clientSecret, undefined)
    assert.equal(payload.error, undefined)
  } finally {
    await server.close()
  }
})

test('POST /api/auth/oauth/:provider/start returns a signed dev authorization URL', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/auth/oauth/google/start', {
      body: { redirectTo: '/tasks' },
    })

    assert.equal(status, 201)
    assert.equal(payload.data.provider, 'google')
    assert.equal(payload.data.mode, 'dev')
    assert.ok(payload.data.state)
    assert.ok(payload.data.authorizationUrl.includes('/api/auth/oauth/google/callback'))
  } finally {
    await server.close()
  }
})

test('OAuth account linking lists and unlinks provider accounts', async () => {
  const server = await createTestServer()
  try {
    const suffix = Date.now()
    const register = await requestJson(server.url, '/api/auth/register', {
      body: registrationBody({
        email: `link-${suffix}@example.com`,
        password: 'correct-horse-42',
        displayName: 'Link User',
        handle: `link${suffix}`,
      }),
    })
    const before = await requestJson(server.url, '/api/auth/oauth/accounts', {
      method: 'GET',
      token: register.payload.data.accessToken,
    })
    assert.equal(before.status, 200)
    assert.deepEqual(before.payload.data, [])

    const start = await requestJson(server.url, '/api/auth/oauth/google/start', {
      body: { redirectTo: '/profile', linkAccount: true },
      token: register.payload.data.accessToken,
    })
    const callbackUrl = new URL(start.payload.data.authorizationUrl)
    const callback = await requestJson(server.url, `${callbackUrl.pathname}${callbackUrl.search}`, {
      method: 'GET',
    })
    assert.equal(callback.status, 201)
    assert.equal(callback.payload.data.user.id, register.payload.data.user.id)

    const linked = await requestJson(server.url, '/api/auth/oauth/accounts', {
      method: 'GET',
      token: callback.payload.data.accessToken,
    })
    assert.equal(linked.status, 200)
    assert.equal(linked.payload.data.length, 1)
    assert.equal(linked.payload.data[0].provider, 'google')
    assert.equal(linked.payload.data[0].linked, true)

    const unlinked = await requestJson(server.url, '/api/auth/oauth/accounts/google', {
      method: 'DELETE',
      token: callback.payload.data.accessToken,
    })
    assert.equal(unlinked.status, 200)
    assert.deepEqual(unlinked.payload.data, { unlinked: true })

    const after = await requestJson(server.url, '/api/auth/oauth/accounts', {
      method: 'GET',
      token: callback.payload.data.accessToken,
    })
    assert.deepEqual(after.payload.data, [])
  } finally {
    await server.close()
  }
})

test('OAuth account linking requires auth and protects the last sign-in method', async () => {
  const server = await createTestServer()
  try {
    const unauthenticatedLink = await requestJson(server.url, '/api/auth/oauth/google/start', {
      body: { linkAccount: true },
    })
    assert.equal(unauthenticatedLink.status, 401)
    assert.equal(unauthenticatedLink.payload.error.code, 'AUTH_REQUIRED')

    const start = await requestJson(server.url, '/api/auth/oauth/discord/start', {
      body: { redirectTo: '/community' },
    })
    const callbackUrl = new URL(start.payload.data.authorizationUrl)
    const callback = await requestJson(server.url, `${callbackUrl.pathname}${callbackUrl.search}`, {
      method: 'GET',
    })
    const blocked = await requestJson(server.url, '/api/auth/oauth/accounts/discord', {
      method: 'DELETE',
      token: callback.payload.data.accessToken,
    })

    assert.equal(blocked.status, 409)
    assert.equal(blocked.payload.error.code, 'AUTH_ACCOUNT_REQUIRED')
  } finally {
    await server.close()
  }
})

test('GET /api/auth/oauth/:provider/callback creates an OAuth session', async () => {
  const server = await createTestServer()
  try {
    const start = await requestJson(server.url, '/api/auth/oauth/discord/start', {
      body: { redirectTo: '/community' },
    })
    const callbackUrl = new URL(start.payload.data.authorizationUrl)
    const callback = await requestJson(server.url, `${callbackUrl.pathname}${callbackUrl.search}`, {
      method: 'GET',
    })

    assert.equal(callback.status, 201)
    assert.ok(callback.payload.data.accessToken)
    assert.ok(callback.payload.data.refreshToken)
    assert.equal(callback.payload.data.redirectTo, '/community')
    assert.equal(callback.payload.data.user.email.endsWith('@oauth.local'), true)
  } finally {
    await server.close()
  }
})

test('GET /api/auth/oauth/:provider/callback renders a browser bridge for HTML clients', async () => {
  const server = await createTestServer()
  try {
    const start = await requestJson(server.url, '/api/auth/oauth/google/start', {
      body: { redirectTo: '/profile' },
    })
    const callbackUrl = new URL(start.payload.data.authorizationUrl)
    const response = await fetch(`${server.url}${callbackUrl.pathname}${callbackUrl.search}`, {
      method: 'GET',
      headers: { accept: 'text/html' },
    })
    const body = await response.text()
    const cookie = setCookieNamed(response, 'hcaiRefreshToken')
    const csrfCookie = setCookieNamed(response, 'hcaiCsrfToken')

    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), /^text\/html/)
    assert.match(cookie, /^hcaiRefreshToken=hcai_refresh\./)
    assert.match(cookie, /HttpOnly/)
    assert.match(csrfCookie, /^hcaiCsrfToken=/)
    assert.match(body, /localStorage\.setItem\('hcaiAccessToken'/)
    assert.match(body, /localStorage\.setItem\('hcaiUser'/)
    assert.match(body, /localStorage\.setItem\('hcaiOAuthRedirectTo'/)
    assert.match(body, /"redirectTo":"\/profile"/)
    assert.match(body, /window\.location\.replace\('\/'\)/)
    assert.equal(body.includes('refreshToken'), false)
  } finally {
    await server.close()
  }
})

test('POST /api/auth/oauth/:provider/callback accepts form-post callbacks', async () => {
  const server = await createTestServer()
  try {
    const start = await requestJson(server.url, '/api/auth/oauth/apple/start', {
      body: { redirectTo: '/profile' },
    })
    const callbackUrl = new URL(start.payload.data.authorizationUrl)
    const response = await fetch(`${server.url}${callbackUrl.pathname}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        state: callbackUrl.searchParams.get('state'),
        code: callbackUrl.searchParams.get('code'),
      }),
    })
    const payload = await response.json()

    assert.equal(response.status, 201)
    assert.ok(payload.data.accessToken)
    assert.equal(payload.data.redirectTo, '/profile')
    assert.equal(payload.data.user.email.endsWith('@oauth.local'), true)
  } finally {
    await server.close()
  }
})

test('GET /api/auth/oauth/:provider/callback rejects invalid state', async () => {
  const server = await createTestServer()
  try {
    const callback = await requestJson(server.url, '/api/auth/oauth/google/callback?state=bad&code=bad', {
      method: 'GET',
    })

    assert.equal(callback.status, 400)
    assert.equal(callback.payload.error.code, 'OAUTH_STATE_INVALID')
  } finally {
    await server.close()
  }
})

test('POST /api/auth/refresh rotates a demo refresh token', async () => {
  const server = await createTestServer()
  try {
    const login = await requestJson(server.url, '/api/auth/login', {
      body: { handle: 'taskops' },
    })
    const { status, payload } = await requestJson(server.url, '/api/auth/refresh', {
      body: { refreshToken: login.payload.data.refreshToken },
    })

    assert.equal(status, 201)
    assert.ok(payload.data.accessToken)
    assert.ok(payload.data.refreshToken)
    assert.notEqual(payload.data.refreshToken, login.payload.data.refreshToken)
    assert.equal(payload.data.user.handle, 'taskops')

    const reused = await requestJson(server.url, '/api/auth/refresh', {
      body: { refreshToken: login.payload.data.refreshToken },
    })

    assert.equal(reused.status, 401)
    assert.equal(reused.payload.error.code, 'AUTH_FAILED')
  } finally {
    await server.close()
  }
})

test('POST /api/auth/refresh can rotate a refresh token from an HttpOnly cookie', async () => {
  const server = await createTestServer()
  try {
    const loginResponse = await postJson(server.url, '/api/auth/login', { handle: 'taskops' })
    const loginPayload = await loginResponse.json()
    const loginCookie = setCookieNamed(loginResponse, 'hcaiRefreshToken')
    const csrfCookie = setCookieNamed(loginResponse, 'hcaiCsrfToken')

    const refreshResponse = await postJson(server.url, '/api/auth/refresh', {}, {
      cookie: cookieHeader(loginCookie, csrfCookie),
      'x-csrf-token': cookieValue(csrfCookie),
    })
    const refreshPayload = await refreshResponse.json()
    const rotatedCookie = setCookieNamed(refreshResponse, 'hcaiRefreshToken')

    assert.equal(refreshResponse.status, 201)
    assert.ok(refreshPayload.data.accessToken)
    assert.notEqual(refreshPayload.data.refreshToken, loginPayload.data.refreshToken)
    assert.match(rotatedCookie, /^hcaiRefreshToken=hcai_refresh\./)
    assert.notEqual(cookiePair(rotatedCookie), cookiePair(loginCookie))
  } finally {
    await server.close()
  }
})

test('POST /api/auth/refresh rejects cookie credentials without a matching CSRF token', async () => {
  const server = await createTestServer()
  try {
    const loginResponse = await postJson(server.url, '/api/auth/login', { handle: 'taskops' })
    const refreshCookie = setCookieNamed(loginResponse, 'hcaiRefreshToken')
    const csrfCookie = setCookieNamed(loginResponse, 'hcaiCsrfToken')

    const missing = await postJson(server.url, '/api/auth/refresh', {}, {
      cookie: cookieHeader(refreshCookie, csrfCookie),
    })
    const missingPayload = await missing.json()

    assert.equal(missing.status, 403)
    assert.equal(missingPayload.error.code, 'CSRF_TOKEN_INVALID')

    const mismatched = await postJson(server.url, '/api/auth/refresh', {}, {
      cookie: cookieHeader(refreshCookie, csrfCookie),
      'x-csrf-token': 'wrong-token',
    })
    const mismatchedPayload = await mismatched.json()

    assert.equal(mismatched.status, 403)
    assert.equal(mismatchedPayload.error.code, 'CSRF_TOKEN_INVALID')
  } finally {
    await server.close()
  }
})

test('POST /api/auth/refresh rejects cookie credentials from untrusted origins', async () => {
  const server = await createTestServer()
  try {
    const loginResponse = await postJson(server.url, '/api/auth/login', { handle: 'taskops' })
    const refreshCookie = setCookieNamed(loginResponse, 'hcaiRefreshToken')
    const csrfCookie = setCookieNamed(loginResponse, 'hcaiCsrfToken')

    const response = await postJson(server.url, '/api/auth/refresh', {}, {
      cookie: cookieHeader(refreshCookie, csrfCookie),
      origin: 'https://evil.example',
      'x-csrf-token': cookieValue(csrfCookie),
    })
    const payload = await response.json()

    assert.equal(response.status, 403)
    assert.equal(payload.error.code, 'CSRF_ORIGIN_DENIED')
  } finally {
    await server.close()
  }
})

test('POST /api/auth/refresh revokes a token family when an old refresh token is reused', async () => {
  const server = await createTestServer()
  try {
    const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`
    const login = await requestJson(server.url, '/api/auth/register', {
      body: registrationBody({ email: `family-${suffix}@example.com`, password: 'correct-horse-42', displayName: 'Family User', handle: `family${suffix}` }),
    })
    const rotated = await requestJson(server.url, '/api/auth/refresh', {
      body: { refreshToken: login.payload.data.refreshToken },
    })
    assert.equal(rotated.status, 201)

    const reused = await requestJson(server.url, '/api/auth/refresh', {
      body: { refreshToken: login.payload.data.refreshToken },
    })
    assert.equal(reused.status, 401)
    assert.equal(reused.payload.error.code, 'AUTH_FAILED')

    const familyRevoked = await requestJson(server.url, '/api/auth/refresh', {
      body: { refreshToken: rotated.payload.data.refreshToken },
    })
    assert.equal(familyRevoked.status, 401)
    assert.equal(familyRevoked.payload.error.code, 'AUTH_FAILED')
  } finally {
    await server.close()
  }
})

test('GET and DELETE /api/auth/sessions manage current user sessions', async () => {
  const server = await createTestServer()
  try {
    const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`
    const login = await requestJson(server.url, '/api/auth/register', {
      body: registrationBody({ email: `session-${suffix}@example.com`, password: 'correct-horse-42', displayName: 'Session User', handle: `session${suffix}` }),
    })
    const sessions = await requestJson(server.url, '/api/auth/sessions', {
      method: 'GET',
      token: login.payload.data.accessToken,
    })

    assert.equal(sessions.status, 200)
    assert.equal(sessions.payload.data.length, 1)
    assert.equal(sessions.payload.data[0].active, true)

    const revoked = await requestJson(server.url, `/api/auth/sessions/${sessions.payload.data[0].id}`, {
      method: 'DELETE',
      token: login.payload.data.accessToken,
    })
    assert.equal(revoked.status, 200)
    assert.deepEqual(revoked.payload.data, { revoked: true })

    const refresh = await requestJson(server.url, '/api/auth/refresh', {
      body: { refreshToken: login.payload.data.refreshToken },
    })
    assert.equal(refresh.status, 401)
  } finally {
    await server.close()
  }
})

test('DELETE /api/auth/sessions revokes all current user sessions', async () => {
  const server = await createTestServer()
  try {
    const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`
    const email = `sessions-${suffix}@example.com`
    const password = 'correct-horse-42'
    const first = await requestJson(server.url, '/api/auth/register', {
      body: registrationBody({ email, password, displayName: 'Sessions User', handle: `sessions${suffix}` }),
    })
    const second = await requestJson(server.url, '/api/auth/login', {
      body: { email, password },
    })

    const revoked = await requestJson(server.url, '/api/auth/sessions', {
      method: 'DELETE',
      token: first.payload.data.accessToken,
    })
    assert.equal(revoked.status, 200)
    assert.equal(revoked.payload.data.revoked, 2)

    const refresh = await requestJson(server.url, '/api/auth/refresh', {
      body: { refreshToken: second.payload.data.refreshToken },
    })
    assert.equal(refresh.status, 401)
  } finally {
    await server.close()
  }
})

test('POST /api/auth/logout returns a revoked envelope', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/auth/logout', {
      body: { refreshToken: 'demo-refresh.taskops' },
    })

    assert.equal(status, 200)
    assert.deepEqual(payload.data, { revoked: true })
    assert.equal(payload.error, undefined)
  } finally {
    await server.close()
  }
})

test('POST /api/auth/logout clears and revokes the refresh cookie session', async () => {
  const server = await createTestServer()
  try {
    const loginResponse = await postJson(server.url, '/api/auth/login', { handle: 'taskops' })
    const loginCookie = setCookieNamed(loginResponse, 'hcaiRefreshToken')
    const csrfCookie = setCookieNamed(loginResponse, 'hcaiCsrfToken')

    const logoutResponse = await postJson(server.url, '/api/auth/logout', {}, {
      cookie: cookieHeader(loginCookie, csrfCookie),
      'x-csrf-token': cookieValue(csrfCookie),
    })
    const logoutPayload = await logoutResponse.json()
    const clearedCookie = setCookieNamed(logoutResponse, 'hcaiRefreshToken')
    const clearedCsrfCookie = setCookieNamed(logoutResponse, 'hcaiCsrfToken')

    assert.equal(logoutResponse.status, 200)
    assert.deepEqual(logoutPayload.data, { revoked: true })
    assert.match(clearedCookie, /^hcaiRefreshToken=;/)
    assert.match(clearedCookie, /Max-Age=0/)
    assert.match(clearedCsrfCookie, /^hcaiCsrfToken=;/)
    assert.match(clearedCsrfCookie, /Max-Age=0/)

    const refreshResponse = await postJson(server.url, '/api/auth/refresh', {}, {
      cookie: cookieHeader(loginCookie, csrfCookie),
      'x-csrf-token': cookieValue(csrfCookie),
    })
    const refreshPayload = await refreshResponse.json()

    assert.equal(refreshResponse.status, 401)
    assert.equal(refreshPayload.error.code, 'AUTH_FAILED')
  } finally {
    await server.close()
  }
})
