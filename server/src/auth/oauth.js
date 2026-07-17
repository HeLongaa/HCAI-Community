import { createHash, createHmac, createPublicKey, createSign, createVerify, randomBytes, timingSafeEqual } from 'node:crypto'
import { getAccessTokenKeyRing } from './sessionTokens.js'

const oauthStateTtlMs = 10 * 60 * 1000
const defaultProviderTimeoutMs = 8_000
const supportedProviders = ['google', 'github', 'apple', 'discord', 'dev']
const listedProviders = ['google', 'github', 'apple', 'discord']
const pkceProviders = new Set(['google', 'github', 'discord'])

const providerNames = {
  google: 'Google',
  github: 'GitHub',
  apple: 'Apple',
  discord: 'Discord',
  dev: 'Dev OAuth',
}

const providerConfigs = {
  google: {
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile',
  },
  github: {
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    userEmailsUrl: 'https://api.github.com/user/emails',
    scope: 'read:user user:email',
  },
  discord: {
    authorizationUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    userInfoUrl: 'https://discord.com/api/users/@me',
    scope: 'identify email',
  },
  apple: {
    authorizationUrl: 'https://appleid.apple.com/auth/authorize',
    tokenUrl: 'https://appleid.apple.com/auth/token',
    jwksUrl: 'https://appleid.apple.com/auth/keys',
    scope: 'name email',
    issuer: 'https://appleid.apple.com',
  },
}

const providerSecretEnvironmentKeys = {
  google: 'OAUTH_GOOGLE_CLIENT_SECRET',
  github: 'OAUTH_GITHUB_CLIENT_SECRET',
  discord: 'OAUTH_DISCORD_CLIENT_SECRET',
  apple: 'OAUTH_APPLE_PRIVATE_KEY',
}

const legacyProviderSecretReferences = {
  google: 'secret://oauth/google/client-secret',
  github: 'secret://oauth/github/client-secret',
  discord: 'secret://oauth/discord/client-secret',
  apple: 'secret://oauth/apple/private-key',
}

const encodeJson = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const decodeJson = (value) => JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))

const sign = (payload, secret) => createHmac('sha256', secret).update(payload).digest('base64url')

const oauthProviderTimeoutMs = (source = process.env) => {
  const parsed = Number.parseInt(source.OAUTH_PROVIDER_TIMEOUT_MS ?? '', 10)
  return Number.isInteger(parsed) && parsed >= 1_000 && parsed <= 15_000 ? parsed : defaultProviderTimeoutMs
}

const isOAuthDevModeEnabled = (source = process.env) => (
  source.NODE_ENV !== 'production' && String(source.OAUTH_DEV_MODE ?? 'enabled').trim().toLowerCase() !== 'disabled'
)

const hasValidRedirectUri = (provider, value, source = process.env) => {
  try {
    const redirect = new URL(String(value ?? ''))
    const localDevelopment = source.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '::1'].includes(redirect.hostname)
    return (redirect.protocol === 'https:' || (localDevelopment && redirect.protocol === 'http:'))
      && redirect.username === ''
      && redirect.password === ''
      && redirect.search === ''
      && redirect.hash === ''
      && redirect.pathname === `/api/auth/oauth/${provider}/callback`
  } catch {
    return false
  }
}

const normalizePrivateKey = (value) => String(value ?? '').replace(/\\n/g, '\n')

const signEs256 = (payload, privateKey) => {
  const signer = createSign('SHA256')
  signer.update(payload)
  signer.end()
  return signer.sign({ key: normalizePrivateKey(privateKey), dsaEncoding: 'ieee-p1363' }).toString('base64url')
}

export const createAppleClientSecret = (metadata, nowSeconds = Math.floor(Date.now() / 1000)) => {
  const header = encodeJson({ alg: 'ES256', kid: metadata.keyId, typ: 'JWT' })
  const payload = encodeJson({
    iss: metadata.teamId,
    iat: nowSeconds,
    exp: nowSeconds + 60 * 60,
    aud: 'https://appleid.apple.com',
    sub: metadata.clientId,
  })
  return `${header}.${payload}.${signEs256(`${header}.${payload}`, metadata.privateKey)}`
}

const decodeJwtPart = (token, index) => {
  const parts = String(token ?? '').split('.')
  if (parts.length !== 3 || !parts[index]) {
    return null
  }
  try {
    return decodeJson(parts[index])
  } catch {
    return null
  }
}

const verifyRs256Jwt = (token, jwks) => {
  const [headerPart, payloadPart, signaturePart, extra] = String(token ?? '').split('.')
  if (!headerPart || !payloadPart || !signaturePart || extra) {
    return null
  }
  const header = decodeJwtPart(token, 0)
  if (header?.alg !== 'RS256' || !header.kid) {
    return null
  }
  const jwk = jwks?.keys?.find((key) => key.kid === header.kid && key.kty === 'RSA')
  if (!jwk) {
    return null
  }
  const verifier = createVerify('RSA-SHA256')
  verifier.update(`${headerPart}.${payloadPart}`)
  verifier.end()
  const verified = verifier.verify(createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(signaturePart, 'base64url'))
  return verified ? decodeJwtPart(token, 1) : null
}

export const normalizeOAuthRedirect = (redirectTo) => {
  if (
    typeof redirectTo !== 'string' ||
    redirectTo.length > 512 ||
    !redirectTo.startsWith('/') ||
    redirectTo.startsWith('//') ||
    redirectTo.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(redirectTo)
  ) {
    return '/'
  }
  try {
    const redirect = new URL(redirectTo, 'https://oauth.local')
    return redirect.origin === 'https://oauth.local'
      ? `${redirect.pathname}${redirect.search}${redirect.hash}`
      : '/'
  } catch {
    return '/'
  }
}

export const normalizeOAuthProvider = (provider) => String(provider ?? '').trim().toLowerCase()

export const isSupportedOAuthProvider = (provider) => supportedProviders.includes(normalizeOAuthProvider(provider))

export const createOAuthState = ({ provider }) => {
  const currentKey = getAccessTokenKeyRing().find((key) => key.current)
  const now = Date.now()
  const payload = encodeJson({
    typ: 'oauth_state',
    provider: normalizeOAuthProvider(provider),
    nonce: randomBytes(16).toString('base64url'),
    iat: now,
    exp: now + oauthStateTtlMs,
    kid: currentKey.kid,
  })
  return `${payload}.${sign(payload, currentKey.secret)}`
}

export const hashOAuthState = (state) => createHash('sha256').update(String(state ?? '')).digest('hex')

export const createOAuthPkce = (statePayload) => {
  if (!statePayload?.nonce || !statePayload?.provider || !pkceProviders.has(statePayload.provider)) {
    return null
  }
  const key = getAccessTokenKeyRing().find((candidate) => candidate.kid === statePayload.kid)
  if (!key) {
    return null
  }
  const verifier = createHmac('sha256', key.secret)
    .update(`oauth_pkce:${statePayload.provider}:${statePayload.nonce}`)
    .digest('base64url')
  return {
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
    method: 'S256',
  }
}

export const verifyOAuthState = (state) => {
  if (typeof state !== 'string') {
    return null
  }
  const [payload, signature, extra] = state.split('.')
  if (!payload || !signature || extra) {
    return null
  }
  try {
    const decoded = decodeJson(payload)
    const now = Date.now()
    if (
      decoded.typ !== 'oauth_state' ||
      !Number.isFinite(decoded.iat) ||
      !Number.isFinite(decoded.exp) ||
      decoded.iat > now + 30_000 ||
      decoded.exp <= now ||
      decoded.exp - decoded.iat !== oauthStateTtlMs ||
      typeof decoded.kid !== 'string' ||
      !/^[A-Za-z0-9_-]{16,64}$/.test(decoded.nonce ?? '') ||
      !isSupportedOAuthProvider(decoded.provider)
    ) {
      return null
    }
    const candidates = decoded.kid
      ? getAccessTokenKeyRing().filter((key) => key.kid === decoded.kid)
      : getAccessTokenKeyRing()
    const signatureBuffer = Buffer.from(signature)
    const valid = candidates.some((key) => {
      const expected = Buffer.from(sign(payload, key.secret))
      return expected.length === signatureBuffer.length && timingSafeEqual(expected, signatureBuffer)
    })
    return valid ? decoded : null
  } catch {
    return null
  }
}

export const createDevOAuthCode = (provider, statePayload) => {
  const normalizedProvider = normalizeOAuthProvider(provider)
  return encodeJson({
    provider: normalizedProvider,
    providerUserId: `${normalizedProvider}-${statePayload.nonce}`,
    email: `${normalizedProvider}-${statePayload.nonce.slice(0, 10)}@oauth.local`,
    displayName: `${providerNames[normalizedProvider] ?? normalizedProvider} User`,
  })
}

export const readDevOAuthCode = (provider, code) => {
  try {
    const profile = decodeJson(code)
    if (profile.provider !== normalizeOAuthProvider(provider) || !profile.providerUserId || !profile.email) {
      return null
    }
    return {
      provider: normalizeOAuthProvider(provider),
      providerUserId: String(profile.providerUserId),
      email: String(profile.email).trim().toLowerCase(),
      displayName: String(profile.displayName ?? profile.email.split('@')[0]),
    }
  } catch {
    return null
  }
}

export const oauthProviderSecretReference = (provider) => {
  const normalizedProvider = normalizeOAuthProvider(provider)
  const environmentKey = providerSecretEnvironmentKeys[normalizedProvider]
  return environmentKey ? `secret://env/${environmentKey}` : null
}

export const isAllowedOAuthProviderSecretReference = (provider, reference) => {
  const normalizedProvider = normalizeOAuthProvider(provider)
  return reference === oauthProviderSecretReference(normalizedProvider)
    || reference === legacyProviderSecretReferences[normalizedProvider]
}

export const resolveOAuthProviderSecret = (provider, reference, source = process.env) => {
  const normalizedProvider = normalizeOAuthProvider(provider)
  const environmentKey = providerSecretEnvironmentKeys[normalizedProvider]
  if (!environmentKey || (reference && !isAllowedOAuthProviderSecretReference(normalizedProvider, reference))) {
    return null
  }
  const value = String(source[environmentKey] ?? '').trim()
  return value || null
}

export const getOAuthProviderMetadata = (provider, source = process.env, configuration = null) => {
  const normalizedProvider = normalizeOAuthProvider(provider)
  const prefix = `OAUTH_${normalizedProvider.toUpperCase()}`
  const clientId = configuration?.clientId ?? source[`${prefix}_CLIENT_ID`] ?? null
  const redirectUri = configuration?.redirectUri ?? source[`${prefix}_REDIRECT_URI`] ?? null
  const configuredScopes = Array.isArray(configuration?.scopes) && configuration.scopes.length > 0
    ? configuration.scopes.join(' ')
    : null
  const providerSecret = resolveOAuthProviderSecret(normalizedProvider, configuration?.clientSecretRef ?? null, source)
  const credentialsPresent = normalizedProvider === 'apple'
    ? Boolean(
        clientId &&
        source[`${prefix}_TEAM_ID`] &&
        source[`${prefix}_KEY_ID`] &&
        providerSecret &&
        redirectUri,
      )
    : Boolean(clientId && providerSecret && redirectUri)
  const configured = credentialsPresent && hasValidRedirectUri(normalizedProvider, redirectUri, source)
  const mode = configured ? 'external' : isOAuthDevModeEnabled(source) ? 'dev' : 'unavailable'
  return {
    provider: normalizedProvider,
    label: providerNames[normalizedProvider] ?? normalizedProvider,
    configured,
    mode,
    clientId,
    clientSecret: normalizedProvider === 'apple' ? null : providerSecret,
    teamId: source[`${prefix}_TEAM_ID`] ?? null,
    keyId: source[`${prefix}_KEY_ID`] ?? null,
    privateKey: normalizedProvider === 'apple' ? providerSecret : null,
    redirectUri,
    secretRef: configuration?.clientSecretRef ?? null,
    configurationSource: configuration?.clientId ? 'admin' : 'environment',
    ...providerConfigs[normalizedProvider],
    ...(configuredScopes ? { scope: configuredScopes } : {}),
  }
}

export const listOAuthProviderMetadata = (source = process.env, controlByProvider = new Map()) => listedProviders.map((provider) => {
  const metadata = getOAuthProviderMetadata(provider, source, controlByProvider.get(provider) ?? null)
  return {
    provider: metadata.provider,
    label: metadata.label,
    configured: metadata.configured,
    available: metadata.mode !== 'unavailable',
    mode: metadata.mode,
    authorizationUrl: metadata.mode === 'unavailable' ? null : metadata.authorizationUrl,
    callbackMethod: metadata.provider === 'apple' ? 'POST' : 'GET',
    scopes: metadata.scope.split(' '),
  }
})

export const getOAuthAuthorizationUrl = ({ provider, state, origin, source = process.env, configuration = null }) => {
  const metadata = getOAuthProviderMetadata(provider, source, configuration)
  const statePayload = verifyOAuthState(state)
  if (metadata.mode === 'unavailable' || !providerConfigs[metadata.provider]) {
    return { mode: 'unavailable', authorizationUrl: null }
  }
  if (metadata.mode === 'dev') {
    const code = createDevOAuthCode(provider, statePayload)
    return {
      mode: 'dev',
      authorizationUrl: `${origin}/api/auth/oauth/${encodeURIComponent(provider)}/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`,
    }
  }
  const authorizationUrl = new URL(metadata.authorizationUrl)
  authorizationUrl.searchParams.set('client_id', metadata.clientId)
  authorizationUrl.searchParams.set('redirect_uri', metadata.redirectUri)
  authorizationUrl.searchParams.set('response_type', 'code')
  authorizationUrl.searchParams.set('scope', metadata.scope)
  authorizationUrl.searchParams.set('state', state)
  const pkce = createOAuthPkce(statePayload)
  if (pkce) {
    authorizationUrl.searchParams.set('code_challenge', pkce.challenge)
    authorizationUrl.searchParams.set('code_challenge_method', pkce.method)
  }
  if (metadata.provider === 'google') {
    authorizationUrl.searchParams.set('prompt', 'select_account')
  }
  if (metadata.provider === 'apple') {
    authorizationUrl.searchParams.set('response_mode', 'form_post')
    authorizationUrl.searchParams.set('nonce', statePayload.nonce)
  }
  return {
    mode: 'external',
    authorizationUrl: authorizationUrl.toString(),
  }
}

const fetchOAuthJson = async ({ url, options, fetchImpl, source, allowArray = false }) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), oauthProviderTimeoutMs(source))
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal })
    if (!response?.ok) {
      return null
    }
    const payload = await response.json()
    return payload && typeof payload === 'object' && (allowArray || !Array.isArray(payload)) ? payload : null
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

const postOAuthTokenRequest = async ({ metadata, code, fetchImpl, statePayload, source }) => {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: metadata.clientId,
    client_secret: metadata.provider === 'apple' ? createAppleClientSecret(metadata) : metadata.clientSecret,
    redirect_uri: metadata.redirectUri,
  })
  const pkce = createOAuthPkce(statePayload)
  if (pkce) {
    body.set('code_verifier', pkce.verifier)
  }
  return fetchOAuthJson({
    url: metadata.tokenUrl,
    fetchImpl,
    source,
    options: {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
    },
  })
}

const fetchOAuthUserInfo = ({ metadata, accessToken, fetchImpl, source }) => fetchOAuthJson({
  url: metadata.userInfoUrl,
  fetchImpl,
  source,
  options: {
    method: 'GET',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
      'user-agent': 'MuseFlow-OAuth/1.0',
    },
  },
})

const fetchGitHubEmails = ({ metadata, accessToken, fetchImpl, source }) => fetchOAuthJson({
  url: metadata.userEmailsUrl,
  fetchImpl,
  source,
  allowArray: true,
  options: {
    method: 'GET',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${accessToken}`,
      'user-agent': 'MuseFlow-OAuth/1.0',
      'x-github-api-version': '2026-03-10',
    },
  },
})

const fetchAppleJwks = ({ metadata, fetchImpl, source }) => fetchOAuthJson({
  url: metadata.jwksUrl,
  fetchImpl,
  source,
  options: {
    method: 'GET',
    headers: { accept: 'application/json' },
  },
})

const safeProfile = ({ provider, providerUserId, email, displayName }) => {
  const normalizedProviderUserId = String(providerUserId ?? '').trim()
  const normalizedEmail = String(email ?? '').trim().toLowerCase()
  const normalizedDisplayName = String(displayName ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (
    !normalizedProviderUserId ||
    normalizedProviderUserId.length > 255 ||
    /[\u0000-\u001f\u007f]/.test(normalizedProviderUserId) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
    normalizedEmail.length > 254
  ) {
    return null
  }
  return {
    provider,
    providerUserId: normalizedProviderUserId,
    email: normalizedEmail,
    displayName: (normalizedDisplayName || normalizedEmail.split('@')[0]).slice(0, 120),
  }
}

const mapGoogleProfile = (profile) => {
  if (!profile?.sub || !profile?.email || profile.email_verified !== true) {
    return null
  }
  return safeProfile({
    provider: 'google',
    providerUserId: String(profile.sub),
    email: String(profile.email).trim().toLowerCase(),
    displayName: String(profile.name ?? profile.email.split('@')[0]),
  })
}

const mapGitHubProfile = (profile, emails = []) => {
  const verifiedEmails = Array.isArray(emails) ? emails.filter((entry) => entry?.verified === true && entry?.email) : []
  const profileEmail = String(profile?.email ?? '').trim().toLowerCase()
  const selectedEmail = verifiedEmails.find((entry) => String(entry.email).trim().toLowerCase() === profileEmail)?.email
    ?? verifiedEmails.find((entry) => entry.primary === true)?.email
    ?? verifiedEmails[0]?.email
  if (!profile?.id || !selectedEmail) return null
  return safeProfile({
    provider: 'github',
    providerUserId: String(profile.id),
    email: String(selectedEmail).trim().toLowerCase(),
    displayName: String(profile.name ?? profile.login ?? selectedEmail.split('@')[0]),
  })
}

const mapDiscordProfile = (profile) => {
  if (!profile?.id || !profile?.email || profile.verified !== true) {
    return null
  }
  return safeProfile({
    provider: 'discord',
    providerUserId: String(profile.id),
    email: String(profile.email).trim().toLowerCase(),
    displayName: String(profile.global_name ?? profile.username ?? profile.email.split('@')[0]),
  })
}

const normalizeAppleUserName = (userPayload) => {
  if (!userPayload) {
    return null
  }
  try {
    const parsed = typeof userPayload === 'string' ? JSON.parse(userPayload) : userPayload
    const firstName = parsed?.name?.firstName ?? ''
    const lastName = parsed?.name?.lastName ?? ''
    return `${firstName} ${lastName}`.trim() || null
  } catch {
    return null
  }
}

const mapAppleProfile = (claims, metadata, statePayload, userPayload = null) => {
  const now = Math.floor(Date.now() / 1000)
  const audience = Array.isArray(claims?.aud) ? claims.aud : [claims?.aud]
  const emailVerified = claims?.email_verified === true || claims?.email_verified === 'true'
  if (
    claims?.iss !== metadata.issuer ||
    !audience.includes(metadata.clientId) ||
    !claims?.sub ||
    !claims?.email ||
    !emailVerified ||
    !Number.isFinite(claims.exp) ||
    claims.exp <= now ||
    claims.nonce !== statePayload?.nonce
  ) {
    return null
  }
  return safeProfile({
    provider: 'apple',
    providerUserId: String(claims.sub),
    email: String(claims.email).trim().toLowerCase(),
    displayName: normalizeAppleUserName(userPayload) ?? String(claims.email).split('@')[0],
  })
}

export const exchangeOAuthCodeForProfile = async (provider, code, options = {}) => {
  const normalizedProvider = normalizeOAuthProvider(provider)
  const metadata = getOAuthProviderMetadata(normalizedProvider, options.source ?? process.env, options.configuration ?? null)
  if (metadata.mode === 'unavailable' || !providerConfigs[normalizedProvider]) {
    return null
  }
  if (metadata.mode === 'dev') {
    return readDevOAuthCode(normalizedProvider, code)
  }
  const fetchImpl = options.fetchImpl ?? fetch
  const source = options.source ?? process.env
  try {
    const token = await postOAuthTokenRequest({ metadata, code, fetchImpl, statePayload: options.statePayload, source })
    if (!token?.access_token && normalizedProvider !== 'apple') {
      return null
    }
    if (normalizedProvider === 'apple') {
      if (!token?.id_token) {
        return null
      }
      const jwks = await fetchAppleJwks({ metadata, fetchImpl, source })
      const claims = verifyRs256Jwt(token.id_token, jwks)
      return claims ? mapAppleProfile(claims, metadata, options.statePayload, options.user) : null
    }
    const profile = await fetchOAuthUserInfo({ metadata, accessToken: token.access_token, fetchImpl, source })
    if (normalizedProvider === 'google') {
      return mapGoogleProfile(profile)
    }
    if (normalizedProvider === 'github') {
      const emails = await fetchGitHubEmails({ metadata, accessToken: token.access_token, fetchImpl, source })
      return mapGitHubProfile(profile, emails)
    }
    if (normalizedProvider === 'discord') {
      return mapDiscordProfile(profile)
    }
    return null
  } catch {
    return null
  }
}
