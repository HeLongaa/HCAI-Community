import { createHmac, createPublicKey, createSign, createVerify, randomBytes, timingSafeEqual } from 'node:crypto'
import { getAccessTokenKeyRing } from './sessionTokens.js'

const oauthStateTtlMs = 10 * 60 * 1000
const supportedProviders = ['google', 'apple', 'discord', 'dev']
const listedProviders = ['google', 'apple', 'discord']

const providerNames = {
  google: 'Google',
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

const encodeJson = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const decodeJson = (value) => JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))

const sign = (payload, secret) => createHmac('sha256', secret).update(payload).digest('base64url')

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

const sanitizeRedirect = (redirectTo) => {
  if (typeof redirectTo !== 'string' || !redirectTo.startsWith('/') || redirectTo.startsWith('//')) {
    return '/'
  }
  return redirectTo
}

export const normalizeOAuthProvider = (provider) => String(provider ?? '').trim().toLowerCase()

export const isSupportedOAuthProvider = (provider) => supportedProviders.includes(normalizeOAuthProvider(provider))

export const createOAuthState = ({ provider, redirectTo = '/', linkUserId = null }) => {
  const currentKey = getAccessTokenKeyRing().find((key) => key.current)
  const now = Date.now()
  const payload = encodeJson({
    typ: 'oauth_state',
    provider: normalizeOAuthProvider(provider),
    redirectTo: sanitizeRedirect(redirectTo),
    linkUserId,
    nonce: randomBytes(16).toString('base64url'),
    iat: now,
    exp: now + oauthStateTtlMs,
    kid: currentKey.kid,
  })
  return `${payload}.${sign(payload, currentKey.secret)}`
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
    if (decoded.typ !== 'oauth_state' || decoded.exp <= Date.now() || !isSupportedOAuthProvider(decoded.provider)) {
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

export const getOAuthProviderMetadata = (provider, source = process.env) => {
  const normalizedProvider = normalizeOAuthProvider(provider)
  const prefix = `OAUTH_${normalizedProvider.toUpperCase()}`
  const configured = normalizedProvider === 'apple'
    ? Boolean(
        source[`${prefix}_CLIENT_ID`] &&
        source[`${prefix}_TEAM_ID`] &&
        source[`${prefix}_KEY_ID`] &&
        source[`${prefix}_PRIVATE_KEY`] &&
        source[`${prefix}_REDIRECT_URI`],
      )
    : Boolean(source[`${prefix}_CLIENT_ID`] && source[`${prefix}_CLIENT_SECRET`] && source[`${prefix}_REDIRECT_URI`])
  return {
    provider: normalizedProvider,
    label: providerNames[normalizedProvider] ?? normalizedProvider,
    configured,
    clientId: source[`${prefix}_CLIENT_ID`] ?? null,
    clientSecret: source[`${prefix}_CLIENT_SECRET`] ?? null,
    teamId: source[`${prefix}_TEAM_ID`] ?? null,
    keyId: source[`${prefix}_KEY_ID`] ?? null,
    privateKey: source[`${prefix}_PRIVATE_KEY`] ?? null,
    redirectUri: source[`${prefix}_REDIRECT_URI`] ?? null,
    ...providerConfigs[normalizedProvider],
  }
}

export const listOAuthProviderMetadata = (source = process.env) => listedProviders.map((provider) => {
  const metadata = getOAuthProviderMetadata(provider, source)
  return {
    provider: metadata.provider,
    label: metadata.label,
    configured: metadata.configured,
    mode: metadata.configured ? 'external' : 'dev',
    authorizationUrl: metadata.authorizationUrl,
    callbackMethod: metadata.provider === 'apple' ? 'POST' : 'GET',
    scopes: metadata.scope.split(' '),
  }
})

export const getOAuthAuthorizationUrl = ({ provider, state, origin }) => {
  const metadata = getOAuthProviderMetadata(provider)
  const statePayload = verifyOAuthState(state)
  if (!metadata.configured || !providerConfigs[metadata.provider]) {
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
  if (metadata.provider === 'google') {
    authorizationUrl.searchParams.set('access_type', 'offline')
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

const postOAuthTokenRequest = async ({ metadata, code, fetchImpl }) => {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: metadata.clientId,
    client_secret: metadata.provider === 'apple' ? createAppleClientSecret(metadata) : metadata.clientSecret,
    redirect_uri: metadata.redirectUri,
  })
  const response = await fetchImpl(metadata.tokenUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  })
  if (!response.ok) {
    return null
  }
  return response.json()
}

const fetchOAuthUserInfo = async ({ metadata, accessToken, fetchImpl }) => {
  const response = await fetchImpl(metadata.userInfoUrl, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
  })
  if (!response.ok) {
    return null
  }
  return response.json()
}

const fetchAppleJwks = async ({ metadata, fetchImpl }) => {
  const response = await fetchImpl(metadata.jwksUrl, {
    method: 'GET',
    headers: { accept: 'application/json' },
  })
  if (!response.ok) {
    return null
  }
  return response.json()
}

const mapGoogleProfile = (profile) => {
  if (!profile?.sub || !profile?.email || profile.email_verified === false) {
    return null
  }
  return {
    provider: 'google',
    providerUserId: String(profile.sub),
    email: String(profile.email).trim().toLowerCase(),
    displayName: String(profile.name ?? profile.email.split('@')[0]),
  }
}

const mapDiscordProfile = (profile) => {
  if (!profile?.id || !profile?.email) {
    return null
  }
  return {
    provider: 'discord',
    providerUserId: String(profile.id),
    email: String(profile.email).trim().toLowerCase(),
    displayName: String(profile.global_name ?? profile.username ?? profile.email.split('@')[0]),
  }
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
    claims.exp <= now ||
    claims.nonce !== statePayload?.nonce
  ) {
    return null
  }
  return {
    provider: 'apple',
    providerUserId: String(claims.sub),
    email: String(claims.email).trim().toLowerCase(),
    displayName: normalizeAppleUserName(userPayload) ?? String(claims.email).split('@')[0],
  }
}

export const exchangeOAuthCodeForProfile = async (provider, code, options = {}) => {
  const normalizedProvider = normalizeOAuthProvider(provider)
  const metadata = getOAuthProviderMetadata(normalizedProvider, options.source ?? process.env)
  if (!metadata.configured || !providerConfigs[normalizedProvider]) {
    return readDevOAuthCode(normalizedProvider, code)
  }
  const fetchImpl = options.fetchImpl ?? fetch
  const token = await postOAuthTokenRequest({ metadata, code, fetchImpl })
  if (!token?.access_token && normalizedProvider !== 'apple') {
    return null
  }
  if (normalizedProvider === 'apple') {
    if (!token?.id_token) {
      return null
    }
    const jwks = await fetchAppleJwks({ metadata, fetchImpl })
    const claims = verifyRs256Jwt(token.id_token, jwks)
    return claims ? mapAppleProfile(claims, metadata, options.statePayload, options.user) : null
  }
  const profile = await fetchOAuthUserInfo({ metadata, accessToken: token.access_token, fetchImpl })
  if (normalizedProvider === 'google') {
    return mapGoogleProfile(profile)
  }
  if (normalizedProvider === 'discord') {
    return mapDiscordProfile(profile)
  }
  return null
}
