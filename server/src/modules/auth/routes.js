import { created, html, ok } from '../../common/http/responses.js'
import { readFormBody, readJsonBody } from '../../common/http/request.js'
import { HttpError } from '../../common/errors/httpError.js'
import { requireUser } from '../../common/http/auth.js'
import {
  appendSetCookie,
  createCsrfToken,
  getCsrfTokenCookie,
  getRefreshTokenCookie,
  serializeClearCsrfTokenCookie,
  serializeClearRefreshTokenCookie,
  serializeCsrfTokenCookie,
  serializeRefreshTokenCookie,
} from '../../common/http/cookies.js'
import { isTrustedOrigin } from '../../common/http/origin.js'
import {
  parseEmailLoginRequest,
  parseOAuthStartRequest,
  parseRegisterRequest,
} from '../../contracts/requestParsers.js'
import {
  createOAuthState,
  exchangeOAuthCodeForProfile,
  getOAuthAuthorizationUrl,
  hashOAuthState,
  isSupportedOAuthProvider,
  listOAuthProviderMetadata,
  normalizeOAuthRedirect,
  normalizeOAuthProvider,
  verifyOAuthState,
} from '../../auth/oauth.js'
import { recordAuthFailure } from '../../auth/loginMonitor.js'
import { repositories } from '../../repositories/index.js'
import { serializeAccount } from '../../repositories/serializers.js'
import { recordSecurityEvent } from '../../security/securityEvents.js'
import { validatePolicyConsent } from '../../compliance/policyManifest.js'

const oauthAccountProviders = ['google', 'github', 'apple', 'discord']

const providerUserIdHint = (providerUserId) => {
  const value = String(providerUserId ?? '')
  if (value.length <= 8) {
    return value
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`
}

const serializeOAuthAccount = (account) => ({
  provider: account.provider,
  linked: true,
  providerUserIdHint: providerUserIdHint(account.providerUserId),
})

const scriptSafeJson = (value) => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => ({
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
})[character])

const shouldRenderOAuthBridge = (request, query, fallback = false) => {
  if (query.response === 'html') return true
  if (query.response === 'json') return false
  const accept = String(request.headers.accept ?? '')
  if (accept.includes('application/json')) return false
  return fallback || accept.includes('text/html')
}

const renderOAuthBridge = (response, payload) => {
  const bridgePayload = {
    redirectTo: payload.redirectTo ?? '/',
  }
  const body = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Signing in...</title>
</head>
<body>
  <script>
    (function () {
      var payload = ${scriptSafeJson(bridgePayload)};
      try {
        window.localStorage.removeItem('hcaiAccessToken');
        window.localStorage.removeItem('hcaiUser');
        window.localStorage.setItem('hcaiOAuthRedirectTo', payload.redirectTo || '/');
      } catch (error) {}
      window.location.replace('/');
    }());
  </script>
</body>
</html>`
  html(response, 200, body)
}

const setRefreshTokenCookie = (response, refreshToken) => {
  if (refreshToken) {
    appendSetCookie(response, serializeRefreshTokenCookie(refreshToken))
    appendSetCookie(response, serializeCsrfTokenCookie(createCsrfToken()))
  }
}

const clearRefreshTokenCookie = (response) => {
  appendSetCookie(response, serializeClearRefreshTokenCookie())
  appendSetCookie(response, serializeClearCsrfTokenCookie())
}

const sendSession = (response, payload) => {
  setRefreshTokenCookie(response, payload.refreshToken)
  created(response, payload)
}

const sessionPayload = (session) => ({
  accessToken: session.accessToken,
  refreshToken: session.refreshToken,
  user: serializeAccount(session.user),
})

const requireCookieCsrf = (request) => {
  if (!isTrustedOrigin(request)) {
    throw new HttpError(403, 'CSRF_ORIGIN_DENIED', 'Request origin is not allowed')
  }
  const headerToken = String(request.headers['x-csrf-token'] ?? '')
  const cookieToken = getCsrfTokenCookie(request)
  if (!headerToken || !cookieToken || headerToken !== cookieToken) {
    throw new HttpError(403, 'CSRF_TOKEN_INVALID', 'CSRF token is missing or invalid')
  }
}

const recordAuthFailureAnomaly = async (event, context) => {
  recordSecurityEvent({
    ...event,
    source: 'auth_failure',
    details: event,
  })
  await context.onAuthFailureAnomaly?.(event)
}

export const registerAuthRoutes = (router) => {
  const getOAuthProviderControl = async (provider) => {
    if (repositories.oauthAdmin?.getProviderControl) return repositories.oauthAdmin.getProviderControl(provider)
    const controls = await repositories.oauthAdmin?.listProviderControls?.() ?? []
    return controls.find((control) => control.provider === provider) ?? null
  }

  const completeOAuthCallback = async ({ provider, query }) => {
    if (!oauthAccountProviders.includes(provider)) {
      throw new HttpError(404, 'NOT_FOUND', 'OAuth provider not found')
    }
    const statePayload = verifyOAuthState(query.state)
    if (!statePayload || statePayload.provider !== provider) {
      throw new HttpError(400, 'OAUTH_STATE_INVALID', 'OAuth state is invalid or expired')
    }
    const authorizationRequest = await repositories.auth.consumeOAuthAuthorizationRequest?.({
      stateHash: hashOAuthState(query.state),
      provider,
    })
    if (!authorizationRequest) {
      recordSecurityEvent({
        type: 'auth.oauth.state_rejected',
        severity: 'warning',
        source: 'oauth_callback',
        identity: provider,
        details: { provider, reason: 'missing_expired_or_replayed' },
      })
      throw new HttpError(400, 'OAUTH_STATE_INVALID', 'OAuth state is invalid or expired')
    }
    const providerControl = await getOAuthProviderControl(provider)
    if (providerControl?.enabled === false) {
      throw new HttpError(503, 'OAUTH_PROVIDER_DISABLED', 'OAuth provider is disabled by an administrator')
    }
    if (authorizationRequest.providerControlVersion !== (providerControl?.version ?? 0)) {
      throw new HttpError(409, 'OAUTH_CONFIGURATION_CHANGED', 'OAuth provider configuration changed during authorization')
    }
    if (query.error) {
      const cancelled = query.error === 'access_denied'
      recordSecurityEvent({
        type: cancelled ? 'auth.oauth.cancelled' : 'auth.oauth.provider_rejected',
        severity: cancelled ? 'info' : 'warning',
        source: 'oauth_callback',
        identity: provider,
        details: { provider, reason: cancelled ? 'access_denied' : 'provider_error' },
      })
      throw new HttpError(cancelled ? 400 : 401, cancelled ? 'OAUTH_CANCELLED' : 'OAUTH_FAILED', cancelled
        ? 'OAuth authorization was cancelled'
        : 'OAuth provider response could not be verified')
    }
    if (typeof query.code !== 'string' || query.code.length < 1 || query.code.length > 4_096) {
      throw new HttpError(401, 'OAUTH_FAILED', 'OAuth provider response could not be verified')
    }
    const profile = await exchangeOAuthCodeForProfile(provider, query.code, {
      statePayload,
      user: query.user,
      configuration: providerControl,
    })
    if (!profile) {
      recordSecurityEvent({
        type: 'auth.oauth.verification_failed',
        severity: 'warning',
        source: 'oauth_callback',
        identity: provider,
        details: { provider, reason: 'profile_verification_failed' },
      })
      throw new HttpError(401, 'OAUTH_FAILED', 'OAuth provider response could not be verified')
    }
    const session = await repositories.auth.completeOAuthLogin?.({
      profile,
      linkUserId: authorizationRequest.linkUserId,
    })
    if (!session) {
      throw new HttpError(409, 'OAUTH_ACCOUNT_CONFLICT', 'OAuth account is already linked to another user')
    }
    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      user: serializeAccount(session.user),
      redirectTo: authorizationRequest.redirectTo,
    }
  }

  router.add('GET', '/api/me', async (_request, response, context) => {
    const actor = requireUser(context)
    ok(response, {
      ...serializeAccount(actor),
      policyConsent: await repositories.compliance.getConsentStatus(actor),
    })
  })

  router.add('POST', '/api/auth/login', async (request, response, context) => {
    const body = (await readJsonBody(request)) ?? {}
    if (body.email || body.password) {
      const payload = parseEmailLoginRequest(body)
      const session = await repositories.auth.loginWithPassword?.(payload)
      if (!session) {
        await recordAuthFailure(request, {
          identity: payload.email,
          reason: 'invalid_email_or_password',
        }, {
          monitor: context.authFailureMonitor,
          onAnomaly: (event) => recordAuthFailureAnomaly(event, context),
        })
        throw new HttpError(401, 'AUTH_FAILED', 'Invalid email or password')
      }
      sendSession(response, sessionPayload(session))
      return
    }

    const handle = body.handle ?? 'taskops'
    const account = await repositories.auth.findDemoAccountByHandle(handle)
    if (!account) {
      await recordAuthFailure(request, {
        identity: handle,
        reason: 'unknown_demo_handle',
      }, {
        monitor: context.authFailureMonitor,
        onAnomaly: (event) => recordAuthFailureAnomaly(event, context),
      })
      throw new HttpError(401, 'AUTH_FAILED', 'Unknown demo account')
    }
    const session = repositories.auth.issueSession ? await repositories.auth.issueSession(account) : account
    sendSession(response, {
      accessToken: session?.accessToken ?? account.tokens.accessToken,
      refreshToken: session?.refreshToken ?? account.tokens.refreshToken,
      user: serializeAccount(session?.user ?? account),
    })
  })

  router.add('POST', '/api/auth/register', async (request, response) => {
    const body = (await readJsonBody(request)) ?? {}
    const consent = validatePolicyConsent(body.policyConsent, 'email_registration')
    const payload = parseRegisterRequest(body)
    const session = await repositories.auth.registerEmailAccount?.(payload, consent)
    if (!session) {
      throw new HttpError(409, 'ACCOUNT_EXISTS', 'Email or handle is already registered')
    }
    sendSession(response, sessionPayload(session))
  })

  router.add('GET', '/api/auth/oauth/providers', async (_request, response) => {
    const controls = await repositories.oauthAdmin?.listProviderControls?.() ?? []
    const controlByProvider = new Map(controls.map((control) => [control.provider, control]))
    const metadata = listOAuthProviderMetadata(process.env, controlByProvider)
    ok(response, metadata.map((provider) => {
      if (controlByProvider.get(provider.provider)?.enabled !== false) return provider
      return { ...provider, available: false, mode: 'unavailable', authorizationUrl: null }
    }))
  })

  router.add('GET', '/api/auth/oauth/accounts', async (_request, response, context) => {
    const actor = requireUser(context)
    const accounts = await repositories.auth.listOAuthAccounts?.(actor) ?? []
    ok(response, accounts.map(serializeOAuthAccount))
  })

  router.add('DELETE', '/api/auth/oauth/accounts/:provider', async (_request, response, context) => {
    const actor = requireUser(context)
    const provider = normalizeOAuthProvider(context.params.provider)
    if (!oauthAccountProviders.includes(provider)) {
      throw new HttpError(404, 'NOT_FOUND', 'OAuth account not found')
    }
    const result = await repositories.auth.unlinkOAuthAccount?.(provider, actor)
    if (!result) {
      throw new HttpError(404, 'NOT_FOUND', 'OAuth account not found')
    }
    if (result.blocked) {
      throw new HttpError(409, 'AUTH_ACCOUNT_REQUIRED', 'Cannot unlink the last sign-in method')
    }
    ok(response, { unlinked: true })
  })

  router.add('POST', '/api/auth/oauth/:provider/start', async (request, response, context) => {
    const provider = normalizeOAuthProvider(context.params.provider)
    if (!isSupportedOAuthProvider(provider) || !oauthAccountProviders.includes(provider)) {
      throw new HttpError(404, 'NOT_FOUND', 'OAuth provider not found')
    }
    const providerControl = await getOAuthProviderControl(provider)
    if (providerControl?.enabled === false) {
      throw new HttpError(503, 'OAUTH_PROVIDER_DISABLED', 'OAuth provider is disabled by an administrator')
    }
    const payload = parseOAuthStartRequest((await readJsonBody(request)) ?? {})
    const linkUser = payload.linkAccount ? requireUser(context) : null
    const state = createOAuthState({ provider })
    const origin = `${context.url.protocol}//${context.url.host}`
    const authorization = getOAuthAuthorizationUrl({ provider, state, origin, configuration: providerControl })
    if (authorization.mode === 'unavailable' || !authorization.authorizationUrl) {
      throw new HttpError(503, 'OAUTH_PROVIDER_UNAVAILABLE', 'OAuth provider is not configured for this environment')
    }
    const statePayload = verifyOAuthState(state)
    const stateCreated = await repositories.auth.createOAuthAuthorizationRequest?.({
      stateHash: hashOAuthState(state),
      provider,
      redirectTo: normalizeOAuthRedirect(payload.redirectTo),
      linkUserId: linkUser?.id ?? null,
      providerControlVersion: providerControl?.version ?? 0,
      expiresAt: new Date(statePayload.exp),
    })
    if (!stateCreated) {
      throw new HttpError(409, 'OAUTH_STATE_CONFLICT', 'OAuth authorization request could not be created')
    }
    created(response, {
      provider,
      state,
      ...authorization,
    })
  })

  router.add('GET', '/api/auth/oauth/:provider/callback', async (request, response, context) => {
    const provider = normalizeOAuthProvider(context.params.provider)
    const payload = await completeOAuthCallback({ provider, query: context.query })
    if (shouldRenderOAuthBridge(request, context.query)) {
      setRefreshTokenCookie(response, payload.refreshToken)
      renderOAuthBridge(response, payload)
      return
    }
    sendSession(response, payload)
  })

  router.add('POST', '/api/auth/oauth/:provider/callback', async (request, response, context) => {
    const provider = normalizeOAuthProvider(context.params.provider)
    const form = await readFormBody(request)
    const payload = await completeOAuthCallback({ provider, query: form })
    if (shouldRenderOAuthBridge(request, form, true)) {
      setRefreshTokenCookie(response, payload.refreshToken)
      renderOAuthBridge(response, payload)
      return
    }
    sendSession(response, payload)
  })

  router.add('POST', '/api/auth/refresh', async (request, response, context) => {
    const body = await readJsonBody(request)
    const cookieRefreshToken = getRefreshTokenCookie(request)
    const usesCookieCredential = !context.authToken && !body?.refreshToken && Boolean(cookieRefreshToken)
    if (usesCookieCredential) {
      requireCookieCsrf(request)
    }
    const token = context.authToken ?? body?.refreshToken ?? cookieRefreshToken
    const session = token && repositories.auth.rotateSession ? await repositories.auth.rotateSession(token) : null
    const account = session ? null : token ? await repositories.auth.findDemoAccountByRefreshToken(token) : null
    if (!session && !account) {
      throw new HttpError(401, 'AUTH_FAILED', 'Invalid refresh token')
    }
    sendSession(response, {
      accessToken: session?.accessToken ?? account.tokens.accessToken,
      refreshToken: session?.refreshToken ?? account.tokens.refreshToken,
      user: serializeAccount(session?.user ?? account),
    })
  })

  router.add('GET', '/api/auth/sessions', async (_request, response, context) => {
    const actor = requireUser(context)
    ok(response, await repositories.auth.listSessions(actor))
  })

  router.add('DELETE', '/api/auth/sessions', async (_request, response, context) => {
    const actor = requireUser(context)
    ok(response, await repositories.auth.revokeAllSessions(actor))
  })

  router.add('DELETE', '/api/auth/sessions/:id', async (_request, response, context) => {
    const actor = requireUser(context)
    const revoked = await repositories.auth.revokeSessionById(context.params.id, actor)
    if (!revoked) {
      throw new HttpError(404, 'NOT_FOUND', 'Session not found')
    }
    ok(response, { revoked: true })
  })

  router.add('POST', '/api/auth/logout', async (request, response, context) => {
    const body = await readJsonBody(request)
    const cookieRefreshToken = getRefreshTokenCookie(request)
    const usesCookieCredential = !context.authToken && !body?.refreshToken && Boolean(cookieRefreshToken)
    if (usesCookieCredential) {
      requireCookieCsrf(request)
    }
    const token = context.authToken ?? body?.refreshToken ?? cookieRefreshToken
    if (token && repositories.auth.revokeSession) {
      await repositories.auth.revokeSession(token)
    }
    clearRefreshTokenCookie(response)
    ok(response, { revoked: true })
  })
}
