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
  isSupportedOAuthProvider,
  listOAuthProviderMetadata,
  normalizeOAuthProvider,
  verifyOAuthState,
} from '../../auth/oauth.js'
import { recordAuthFailure } from '../../auth/loginMonitor.js'
import { repositories } from '../../repositories/index.js'
import { serializeAccount } from '../../repositories/serializers.js'
import { recordSecurityEvent } from '../../security/securityEvents.js'
import { validatePolicyConsent } from '../../compliance/policyManifest.js'

const oauthAccountProviders = ['google', 'apple', 'discord']

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
    accessToken: payload.accessToken,
    user: payload.user,
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
        window.localStorage.setItem('hcaiAccessToken', payload.accessToken);
        window.localStorage.setItem('hcaiUser', JSON.stringify(payload.user));
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
  const completeOAuthCallback = async ({ provider, query }) => {
    const statePayload = verifyOAuthState(query.state)
    if (!statePayload || statePayload.provider !== provider) {
      throw new HttpError(400, 'OAUTH_STATE_INVALID', 'OAuth state is invalid or expired')
    }
    const profile = await exchangeOAuthCodeForProfile(provider, query.code, {
      statePayload,
      user: query.user,
    })
    if (!profile) {
      throw new HttpError(401, 'OAUTH_FAILED', 'OAuth provider response could not be verified')
    }
    const session = await repositories.auth.completeOAuthLogin?.({
      profile,
      linkUserId: statePayload.linkUserId,
    })
    if (!session) {
      throw new HttpError(409, 'OAUTH_ACCOUNT_CONFLICT', 'OAuth account is already linked to another user')
    }
    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      user: serializeAccount(session.user),
      redirectTo: statePayload.redirectTo,
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
    ok(response, listOAuthProviderMetadata())
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
    if (!isSupportedOAuthProvider(provider)) {
      throw new HttpError(404, 'NOT_FOUND', 'OAuth provider not found')
    }
    const payload = parseOAuthStartRequest((await readJsonBody(request)) ?? {})
    const linkUser = payload.linkAccount ? requireUser(context) : null
    const state = createOAuthState({
      provider,
      redirectTo: payload.redirectTo,
      linkUserId: linkUser?.id ?? null,
    })
    const origin = `${context.url.protocol}//${context.url.host}`
    created(response, {
      provider,
      state,
      ...getOAuthAuthorizationUrl({ provider, state, origin }),
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
