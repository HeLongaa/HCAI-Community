import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { chromium } from '@playwright/test'

import { buildEvidence, verifyEvidence } from './lib/oauth-staging-evidence.mjs'

const root = process.cwd()
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/oauth-staging-contract.json'), 'utf8'))
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const mode = argument('mode') ?? 'preflight'
if (!['preflight', 'execute'].includes(mode)) throw new Error('Mode must be preflight or execute')

const source = process.env
const provider = String(argument('provider') ?? source.OAUTH_STAGING_PROVIDER ?? '').trim().toLowerCase()
const environment = String(source.OAUTH_STAGING_ENVIRONMENT ?? '').trim().toLowerCase()
const confirmation = String(source.OAUTH_STAGING_CONFIRMATION ?? '').trim().toLowerCase()
const artifactSha256 = String(source.RELEASE_ARTIFACT_SHA256 ?? '').trim().toLowerCase()
const gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const sourceDirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0
const providerSecretKey = provider === 'google' ? 'OAUTH_GOOGLE_CLIENT_SECRET' : provider === 'github' ? 'OAUTH_GITHUB_CLIENT_SECRET' : null

const exactHttpsOrigin = (value) => {
  try {
    const url = new URL(String(value ?? '').trim())
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null
    return url
  } catch {
    return null
  }
}

const apiOrigin = exactHttpsOrigin(argument('api-origin') ?? source.OAUTH_STAGING_API_ORIGIN)
const browserOrigin = exactHttpsOrigin(argument('browser-origin') ?? source.OAUTH_STAGING_BROWSER_ORIGIN)
const expectedAuthorization = {
  google: { origin: 'https://accounts.google.com', pathname: '/o/oauth2/v2/auth' },
  github: { origin: 'https://github.com', pathname: '/login/oauth/authorize' },
}[provider]

let publicStatus = null
let publicStatusReachable = false
let trustedBrowserCors = false
try {
  if (apiOrigin && browserOrigin) {
    const response = await fetch(new URL('/api/auth/oauth/providers', apiOrigin), {
      headers: { accept: 'application/json', origin: browserOrigin.origin },
      signal: AbortSignal.timeout(8_000),
    })
    if (response.ok) {
      const payload = await response.json()
      publicStatus = Array.isArray(payload?.data)
        ? payload.data.find((candidate) => candidate?.provider === provider) ?? null
        : null
      publicStatusReachable = true
      trustedBrowserCors = response.headers.get('access-control-allow-origin') === browserOrigin.origin &&
        response.headers.get('access-control-allow-credentials') === 'true'
    }
  }
} catch {
  publicStatusReachable = false
}

const expectedCallback = apiOrigin && provider
  ? new URL(`/api/auth/oauth/${provider}/callback`, apiOrigin).toString()
  : null
const checks = [
  { id: 'provider_supported', pass: contract.providers.includes(provider) },
  { id: 'staging_environment', pass: environment === 'staging' },
  { id: 'staging_confirmation', pass: confirmation === contract.confirmation },
  { id: 'api_origin_https_exact', pass: Boolean(apiOrigin) },
  { id: 'browser_origin_https_exact', pass: Boolean(browserOrigin) },
  { id: 'provider_secret_present', pass: Boolean(providerSecretKey && String(source[providerSecretKey] ?? '').trim()) },
  { id: 'artifact_bound', pass: /^[a-f0-9]{64}$/.test(artifactSha256) && /^[a-f0-9]{40}$/.test(gitCommit) },
  { id: 'source_clean', pass: sourceDirty === false },
  { id: 'public_status_reachable', pass: publicStatusReachable },
  { id: 'trusted_browser_cors', pass: trustedBrowserCors },
  {
    id: 'external_provider_ready',
    pass: publicStatus?.mode === 'external' && publicStatus?.available === true,
  },
  { id: 'callback_origin_exact', pass: Boolean(expectedCallback) && publicStatus?.callbackUrl === expectedCallback },
  { id: 'browser_return_origin_exact', pass: Boolean(browserOrigin) && publicStatus?.browserReturnOrigin === browserOrigin?.origin },
]

const safePreflight = {
  mode,
  provider: contract.providers.includes(provider) ? provider : 'invalid',
  environment,
  gitCommit,
  sourceClean: !sourceDirty,
  artifactBound: checks.find((check) => check.id === 'artifact_bound').pass,
  confirmationValid: checks.find((check) => check.id === 'staging_confirmation').pass,
  apiOriginValid: Boolean(apiOrigin),
  browserOriginValid: Boolean(browserOrigin),
  providerSecretPresent: checks.find((check) => check.id === 'provider_secret_present').pass,
  publicStatusReachable,
  trustedBrowserCors,
  externalProviderReady: checks.find((check) => check.id === 'external_provider_ready').pass,
  callbackExact: checks.find((check) => check.id === 'callback_origin_exact').pass,
  browserReturnExact: checks.find((check) => check.id === 'browser_return_origin_exact').pass,
}

if (mode === 'preflight') {
  const pass = checks.every((check) => check.pass)
  console.log(JSON.stringify({ ...safePreflight, pass }))
  if (!pass) process.exitCode = 1
} else {
  const failedPreflight = checks.filter((check) => !check.pass)
  if (failedPreflight.length) {
    throw new Error(`OAuth staging preflight failed: ${failedPreflight.map((check) => check.id).join(', ')}`)
  }

  const loginTimeoutSeconds = Number(source.OAUTH_STAGING_LOGIN_TIMEOUT_SECONDS ?? 300)
  if (!Number.isInteger(loginTimeoutSeconds) || loginTimeoutSeconds < 30 || loginTimeoutSeconds > 900) {
    throw new Error('OAUTH_STAGING_LOGIN_TIMEOUT_SECONDS must be an integer between 30 and 900')
  }
  const headless = String(source.OAUTH_STAGING_HEADLESS ?? 'false').trim().toLowerCase() === 'true'
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hcai-oauth-staging-'))
  const startedAt = new Date()
  const runId = `oauth-${startedAt.toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${randomBytes(4).toString('hex')}`
  let context
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless,
      viewport: { width: 1280, height: 800 },
    })
    const page = context.pages()[0] ?? await context.newPage()
    try {
      await page.goto(browserOrigin.origin, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    } catch {
      throw new Error('OAuth staging browser origin could not be opened')
    }

    const authorizationUrl = await page.evaluate(async ({ api, selectedProvider }) => {
      const response = await fetch(`${api}/api/auth/oauth/${selectedProvider}/start`, {
        method: 'POST',
        credentials: 'include',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ redirectTo: '/profile' }),
      })
      if (!response.ok) throw new Error(`OAuth start returned HTTP ${response.status}`)
      const payload = await response.json()
      if (payload?.data?.mode !== 'external' || typeof payload?.data?.authorizationUrl !== 'string') {
        throw new Error('OAuth start did not return an external authorization URL')
      }
      return payload.data.authorizationUrl
    }, { api: apiOrigin.origin, selectedProvider: provider })

    const parsedAuthorization = new URL(authorizationUrl)
    if (
      parsedAuthorization.origin !== expectedAuthorization.origin ||
      parsedAuthorization.pathname !== expectedAuthorization.pathname ||
      !parsedAuthorization.searchParams.has('state') ||
      !parsedAuthorization.searchParams.has('code_challenge')
    ) {
      throw new Error('OAuth authorization endpoint or protocol controls are invalid')
    }

    let providerAuthorizationOpened = false
    const observeProviderRequest = (request) => {
      try {
        const url = new URL(request.url())
        if (url.origin === expectedAuthorization.origin && url.pathname === expectedAuthorization.pathname) {
          providerAuthorizationOpened = true
        }
      } catch {
        return
      }
    }
    page.on('request', observeProviderRequest)
    try {
      await page.goto(authorizationUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    } catch {
      throw new Error('OAuth Provider authorization page could not be opened')
    }
    try {
      await page.waitForURL((url) => url.origin === browserOrigin.origin, {
        timeout: loginTimeoutSeconds * 1_000,
        waitUntil: 'domcontentloaded',
      })
    } catch {
      throw new Error('OAuth browser did not return to the configured product origin before the acceptance timeout')
    }
    page.off('request', observeProviderRequest)

    const cookieMetadata = (await context.cookies([apiOrigin.origin, browserOrigin.origin])).map((cookie) => ({
      name: cookie.name,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
    }))
    const refreshCookie = cookieMetadata.find((cookie) => cookie.name === 'hcaiRefreshToken')
    const csrfCookie = cookieMetadata.find((cookie) => cookie.name === 'hcaiCsrfToken')
    const browserChecks = await page.evaluate(async ({ api, selectedProvider }) => {
      const cookieValue = (name) => {
        const prefix = `${name}=`
        const match = document.cookie.split(';').map((item) => item.trim()).find((item) => item.startsWith(prefix))
        return match ? decodeURIComponent(match.slice(prefix.length)) : null
      }
      const initialCsrf = cookieValue('hcaiCsrfToken')
      const refreshResponse = await fetch(`${api}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...(initialCsrf ? { 'x-csrf-token': initialCsrf } : {}),
        },
        body: '{}',
      })
      let accessToken = null
      if (refreshResponse.ok) {
        const payload = await refreshResponse.json()
        accessToken = typeof payload?.data?.accessToken === 'string' ? payload.data.accessToken : null
      }
      const authenticatedHeaders = accessToken
        ? { accept: 'application/json', authorization: `Bearer ${accessToken}` }
        : { accept: 'application/json' }
      const profileResponse = await fetch(`${api}/api/me`, {
        credentials: 'include',
        headers: authenticatedHeaders,
      })
      const accountsResponse = await fetch(`${api}/api/auth/oauth/accounts`, {
        credentials: 'include',
        headers: authenticatedHeaders,
      })
      let providerLinkObserved = false
      if (accountsResponse.ok) {
        const payload = await accountsResponse.json()
        providerLinkObserved = Array.isArray(payload?.data) && payload.data.some((account) => account?.provider === selectedProvider && account?.linked === true)
      }
      const rotatedCsrf = cookieValue('hcaiCsrfToken')
      const logoutResponse = await fetch(`${api}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...(rotatedCsrf ? { 'x-csrf-token': rotatedCsrf } : {}),
        },
        body: '{}',
      })
      accessToken = null
      return {
        csrfReadable: Boolean(initialCsrf),
        refreshSucceeded: refreshResponse.ok && Boolean(rotatedCsrf) && rotatedCsrf !== initialCsrf,
        profileLoaded: profileResponse.ok,
        providerLinkObserved,
        logoutSucceeded: logoutResponse.ok,
      }
    }, { api: apiOrigin.origin, selectedProvider: provider })
    const remainingCookies = await context.cookies([apiOrigin.origin, browserOrigin.origin])
    const logoutClearedCookies = !remainingCookies.some((cookie) => ['hcaiRefreshToken', 'hcaiCsrfToken'].includes(cookie.name))

    const executionChecks = [
      ...checks,
      { id: 'provider_authorization_opened', pass: providerAuthorizationOpened },
      { id: 'browser_returned_to_product', pass: new URL(page.url()).origin === browserOrigin.origin },
      { id: 'refresh_cookie_secure_httponly', pass: refreshCookie?.secure === true && refreshCookie?.httpOnly === true },
      { id: 'csrf_cookie_secure_readable', pass: csrfCookie?.secure === true && csrfCookie?.httpOnly === false && browserChecks.csrfReadable },
      { id: 'cookie_refresh_succeeded', pass: browserChecks.refreshSucceeded },
      { id: 'authenticated_profile_loaded', pass: browserChecks.profileLoaded },
      { id: 'provider_link_observed', pass: browserChecks.providerLinkObserved },
      { id: 'logout_succeeded', pass: browserChecks.logoutSucceeded && logoutClearedCookies },
    ]
    const failedExecution = executionChecks.filter((check) => !check.pass)
    if (failedExecution.length) {
      throw new Error(`OAuth staging execution failed: ${failedExecution.map((check) => check.id).join(', ')}`)
    }

    const completedAt = new Date()
    const hash = (value) => createHash('sha256').update(value).digest('hex')
    const evidence = buildEvidence({
      provider,
      run: {
        id: runId,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
      },
      source: { gitCommit, artifactSha256 },
      deployment: {
        apiOriginSha256: hash(apiOrigin.origin),
        browserOriginSha256: hash(browserOrigin.origin),
        providerHostSha256: hash(parsedAuthorization.hostname.toLowerCase()),
      },
      flow: {
        authorizationMode: 'external',
        providerAuthorizationOpened,
        returnedToProduct: true,
        refreshSucceeded: browserChecks.refreshSucceeded,
        profileLoaded: browserChecks.profileLoaded,
        providerLinkObserved: browserChecks.providerLinkObserved,
        logoutSucceeded: browserChecks.logoutSucceeded && logoutClearedCookies,
      },
      cookies: {
        refreshHttpOnly: refreshCookie.httpOnly,
        refreshSecure: refreshCookie.secure,
        csrfHttpOnly: csrfCookie.httpOnly,
        csrfSecure: csrfCookie.secure,
        csrfReadable: browserChecks.csrfReadable,
        sameSite: refreshCookie.sameSite,
      },
      limitations: {
        accountLinkingVerified: false,
        accountConflictVerified: false,
        accountUnlinkVerified: false,
        providerCancellationVerified: false,
        configurationChangeVerified: false,
        targetProductionEnvironmentVerified: false,
      },
      checks: executionChecks,
    })
    const verification = verifyEvidence(evidence)
    if (!verification.valid) throw new Error(`OAuth staging evidence is invalid: ${verification.failures.join(', ')}`)

    const evidenceDir = path.resolve(root, source.OAUTH_STAGING_EVIDENCE_DIR ?? '.artifacts/oauth-staging')
    fs.mkdirSync(evidenceDir, { recursive: true, mode: 0o700 })
    const evidencePath = path.join(evidenceDir, `${runId}.json`)
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
    console.log(`status=passed\nrun_id=${runId}\nevidence_receipt_sha256=${evidence.receiptHash}\nevidence=${evidencePath}`)
  } finally {
    await context?.close().catch(() => undefined)
    fs.rmSync(profileDir, { recursive: true, force: true })
  }
}
