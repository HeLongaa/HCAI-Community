const providers = [
  {
    id: 'google',
    clientIdKey: 'OAUTH_GOOGLE_CLIENT_ID',
    secretKey: 'OAUTH_GOOGLE_CLIENT_SECRET',
    redirectKey: 'OAUTH_GOOGLE_REDIRECT_URI',
  },
  {
    id: 'github',
    clientIdKey: 'OAUTH_GITHUB_CLIENT_ID',
    secretKey: 'OAUTH_GITHUB_CLIENT_SECRET',
    redirectKey: 'OAUTH_GITHUB_REDIRECT_URI',
  },
]

const apiOriginArgument = process.argv.find((argument) => argument.startsWith('--api-origin='))
const apiOrigin = apiOriginArgument?.slice('--api-origin='.length) || process.env.OAUTH_PREFLIGHT_API_ORIGIN || null
const allowLocal = process.argv.includes('--allow-local')
const failures = []

const fail = (provider, check) => failures.push(`${provider}: ${check}`)

const parseApiOrigin = (value) => {
  if (!value) return null
  try {
    const origin = new URL(value)
    const loopbackHttp = allowLocal && origin.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(origin.hostname)
    if (origin.pathname !== '/' || origin.search || origin.hash || (origin.protocol !== 'https:' && !loopbackHttp)) {
      throw new Error('invalid origin')
    }
    return origin
  } catch {
    fail('api', 'API origin must be an HTTPS origin without path, query, or fragment (or loopback HTTP with --allow-local)')
    return null
  }
}

const parsedApiOrigin = parseApiOrigin(apiOrigin)

const validateRedirect = (provider, value) => {
  if (!value) return fail(provider, 'redirect URI is missing')
  try {
    const redirect = new URL(value)
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(redirect.hostname)
    if (redirect.protocol !== 'https:' && !(allowLocal && loopback && redirect.protocol === 'http:')) {
      return fail(provider, 'redirect URI must use HTTPS (or loopback HTTP with --allow-local)')
    }
    if (
      redirect.username || redirect.password || redirect.search || redirect.hash ||
      redirect.pathname !== `/api/auth/oauth/${provider}/callback`
    ) {
      return fail(provider, `redirect URI must exactly target /api/auth/oauth/${provider}/callback without query or fragment`)
    }
  } catch {
    fail(provider, 'redirect URI is invalid')
  }
}

const expectedCallback = (provider) => parsedApiOrigin
  ? new URL(`/api/auth/oauth/${provider}/callback`, parsedApiOrigin).toString()
  : null

for (const provider of providers) {
  const clientIdPresent = Boolean(String(process.env[provider.clientIdKey] ?? '').trim())
  const secretPresent = Boolean(String(process.env[provider.secretKey] ?? '').trim())
  const redirect = String(process.env[provider.redirectKey] ?? '').trim()
  // With --api-origin, non-secret configuration may come from the Admin control plane.
  // The public runtime status below proves that the effective configuration is usable.
  if (!apiOrigin && !clientIdPresent) fail(provider.id, `${provider.clientIdKey} is missing`)
  if (!secretPresent) fail(provider.id, `${provider.secretKey} is missing`)
  if (!apiOrigin || redirect) validateRedirect(provider.id, redirect)
  if (parsedApiOrigin && redirect && redirect !== expectedCallback(provider.id)) {
    fail(provider.id, `${provider.redirectKey} must equal ${expectedCallback(provider.id)}`)
  }
  console.log(`${provider.id}: client_id=${clientIdPresent ? 'environment' : apiOrigin ? 'admin/runtime' : 'missing'} secret=${secretPresent ? 'present' : 'missing'} redirect=${redirect || (apiOrigin ? 'admin/runtime' : 'missing')}`)
}

if (parsedApiOrigin) {
  try {
    const response = await fetch(new URL('/api/auth/oauth/providers', parsedApiOrigin), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) throw new Error(`public Provider status returned HTTP ${response.status}`)
    const payload = await response.json()
    const statuses = Array.isArray(payload?.data) ? payload.data : []
    for (const provider of providers) {
      const status = statuses.find((candidate) => candidate?.provider === provider.id)
      if (!status) {
        fail(provider.id, 'public Provider status is missing')
      } else if (status.mode !== 'external' || status.available !== true) {
        fail(provider.id, `public Provider status is mode=${status.mode ?? 'missing'} available=${String(status.available)}`)
      } else if (status.callbackUrl !== expectedCallback(provider.id)) {
        fail(provider.id, `effective callback must equal ${expectedCallback(provider.id)}`)
      } else {
        console.log(`${provider.id}: public_status=external/available callback=exact`)
      }
    }
  } catch (error) {
    fail('api', error instanceof Error ? error.message : 'public Provider status check failed')
  }
}

if (failures.length) {
  for (const failure of failures) console.error(`FAIL ${failure}`)
  console.error(`OAuth Provider preflight failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else {
  console.log('OAuth Provider preflight passed. Complete live login and account-link acceptance before release.')
}
