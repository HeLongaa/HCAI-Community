import assert from 'node:assert/strict'
import { createSign, generateKeyPairSync } from 'node:crypto'
import test from 'node:test'

import {
  createAppleClientSecret,
  createDevOAuthCode,
  createOAuthPkce,
  createOAuthState,
  exchangeOAuthCodeForProfile,
  getOAuthAuthorizationUrl,
  getOAuthProviderMetadata,
  isAllowedOAuthProviderSecretReference,
  listOAuthProviderMetadata,
  normalizeOAuthRedirect,
  readDevOAuthCode,
  resolveOAuthProviderSecret,
  verifyOAuthState,
} from './oauth.js'

const encodeJson = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')

const createRs256Jwt = ({ claims, kid, privateKey }) => {
  const header = encodeJson({ alg: 'RS256', kid, typ: 'JWT' })
  const payload = encodeJson(claims)
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${payload}`)
  signer.end()
  return `${header}.${payload}.${signer.sign(privateKey).toString('base64url')}`
}

test('createOAuthState signs only provider protocol metadata and nonce', () => {
  const state = createOAuthState({ provider: 'google' })
  const payload = verifyOAuthState(state)

  assert.equal(payload.provider, 'google')
  assert.equal(payload.redirectTo, undefined)
  assert.equal(payload.linkUserId, undefined)
  assert.ok(payload.nonce)
})

test('verifyOAuthState rejects tampered state values', () => {
  const state = createOAuthState({ provider: 'google' })
  const [payload] = state.split('.')

  assert.equal(verifyOAuthState(`${payload}.invalid`), null)
  assert.equal(verifyOAuthState('not-state'), null)
})

test('OAuth state folds unsafe app redirects to the application root', () => {
  for (const redirectTo of ['https://evil.example/path', '//evil.example/path', '/\\evil.example/path', '/path\nnext']) {
    assert.equal(normalizeOAuthRedirect(redirectTo), '/')
  }
  assert.equal(normalizeOAuthRedirect('/tasks?status=open#next'), '/tasks?status=open#next')
})

test('dev OAuth codes round-trip provider profile claims', () => {
  const statePayload = verifyOAuthState(createOAuthState({ provider: 'discord' }))
  const code = createDevOAuthCode('discord', statePayload)
  const profile = readDevOAuthCode('discord', code)

  assert.equal(profile.provider, 'discord')
  assert.equal(profile.providerUserId.startsWith('discord-'), true)
  assert.equal(profile.email.endsWith('@oauth.local'), true)
  assert.equal(readDevOAuthCode('google', code), null)
})

test('listOAuthProviderMetadata returns public provider mode without secrets', () => {
  const providers = listOAuthProviderMetadata({
    OAUTH_GOOGLE_CLIENT_ID: 'google-client',
    OAUTH_GOOGLE_CLIENT_SECRET: 'google-secret',
    OAUTH_GOOGLE_REDIRECT_URI: 'https://app.example.com/api/auth/oauth/google/callback',
  })
  const google = providers.find((provider) => provider.provider === 'google')
  const apple = providers.find((provider) => provider.provider === 'apple')

  assert.equal(providers.length, 4)
  assert.equal(google.mode, 'external')
  assert.equal(google.available, true)
  assert.equal(google.configured, true)
  assert.equal(google.clientSecret, undefined)
  assert.equal(google.callbackUrl, 'https://app.example.com/api/auth/oauth/google/callback')
  assert.deepEqual(google.scopes, ['openid', 'email', 'profile'])
  assert.equal(apple.mode, 'dev')
  assert.equal(apple.available, true)
  assert.equal(apple.callbackMethod, 'POST')
})

test('Admin SecretRefs resolve only the provider allowlisted deployment variable', () => {
  const source = {
    NODE_ENV: 'production',
    OAUTH_GOOGLE_CLIENT_SECRET: 'google-secret',
    OAUTH_GITHUB_CLIENT_SECRET: 'github-secret',
    DATABASE_URL: 'must-never-resolve',
  }
  assert.equal(resolveOAuthProviderSecret('google', 'secret://env/OAUTH_GOOGLE_CLIENT_SECRET', source), 'google-secret')
  assert.equal(resolveOAuthProviderSecret('google', 'secret://oauth/google/client-secret', source), 'google-secret')
  assert.equal(resolveOAuthProviderSecret('google', 'secret://env/OAUTH_GITHUB_CLIENT_SECRET', source), null)
  assert.equal(resolveOAuthProviderSecret('google', 'secret://env/DATABASE_URL', source), null)
  assert.equal(isAllowedOAuthProviderSecretReference('github', 'secret://env/OAUTH_GITHUB_CLIENT_SECRET'), true)

  const metadata = getOAuthProviderMetadata('google', source, {
    clientId: 'google-client',
    redirectUri: 'https://api.example.com/api/auth/oauth/google/callback',
    scopes: ['openid', 'email', 'profile'],
    clientSecretRef: 'secret://env/OAUTH_GOOGLE_CLIENT_SECRET',
  })
  assert.equal(metadata.mode, 'external')
  assert.equal(metadata.clientSecret, 'google-secret')
})

test('deployment smoke exposes configured OAuth providers without secret material', () => {
  const providers = listOAuthProviderMetadata({
    OAUTH_GOOGLE_CLIENT_ID: 'google-client',
    OAUTH_GOOGLE_CLIENT_SECRET: 'google-secret',
    OAUTH_GOOGLE_REDIRECT_URI: 'https://api.example.com/api/auth/oauth/google/callback',
    OAUTH_DISCORD_CLIENT_ID: 'discord-client',
    OAUTH_DISCORD_CLIENT_SECRET: 'discord-secret',
    OAUTH_DISCORD_REDIRECT_URI: 'https://api.example.com/api/auth/oauth/discord/callback',
    OAUTH_GITHUB_CLIENT_ID: 'github-client',
    OAUTH_GITHUB_CLIENT_SECRET: 'github-secret',
    OAUTH_GITHUB_REDIRECT_URI: 'https://api.example.com/api/auth/oauth/github/callback',
    OAUTH_APPLE_CLIENT_ID: 'com.example.app',
    OAUTH_APPLE_TEAM_ID: 'TEAMID123',
    OAUTH_APPLE_KEY_ID: 'APPLEKEY123',
    OAUTH_APPLE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nfake\\n-----END PRIVATE KEY-----',
    OAUTH_APPLE_REDIRECT_URI: 'https://api.example.com/api/auth/oauth/apple/callback',
  })

  assert.deepEqual(providers.map((provider) => [provider.provider, provider.mode]), [
    ['google', 'external'],
    ['github', 'external'],
    ['apple', 'external'],
    ['discord', 'external'],
  ])
  assert.equal(JSON.stringify(providers).includes('secret'), false)
  assert.equal(JSON.stringify(providers).includes('PRIVATE KEY'), false)
  assert.equal(providers.find((provider) => provider.provider === 'apple').callbackMethod, 'POST')
})

test('getOAuthAuthorizationUrl builds a real Google authorization URL when configured', () => {
  const state = createOAuthState({ provider: 'google', redirectTo: '/tasks' })
  const original = {
    OAUTH_GOOGLE_CLIENT_ID: process.env.OAUTH_GOOGLE_CLIENT_ID,
    OAUTH_GOOGLE_CLIENT_SECRET: process.env.OAUTH_GOOGLE_CLIENT_SECRET,
    OAUTH_GOOGLE_REDIRECT_URI: process.env.OAUTH_GOOGLE_REDIRECT_URI,
  }
  try {
    process.env.OAUTH_GOOGLE_CLIENT_ID = 'google-client'
    process.env.OAUTH_GOOGLE_CLIENT_SECRET = 'google-secret'
    process.env.OAUTH_GOOGLE_REDIRECT_URI = 'https://app.example.com/api/auth/oauth/google/callback'
    const contract = getOAuthAuthorizationUrl({ provider: 'google', state, origin: 'https://app.example.com' })
    const url = new URL(contract.authorizationUrl)

    assert.equal(contract.mode, 'external')
    assert.equal(url.origin, 'https://accounts.google.com')
    assert.equal(url.searchParams.get('client_id'), 'google-client')
    assert.equal(url.searchParams.get('redirect_uri'), 'https://app.example.com/api/auth/oauth/google/callback')
    assert.equal(url.searchParams.get('scope'), 'openid email profile')
    assert.equal(url.searchParams.get('state'), state)
    assert.equal(url.searchParams.get('access_type'), null)
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
    assert.equal(url.searchParams.get('code_challenge'), createOAuthPkce(verifyOAuthState(state)).challenge)
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value == null) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test('exchangeOAuthCodeForProfile verifies Google token and userinfo responses', async () => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    if (url === 'https://oauth2.googleapis.com/token') {
      return { ok: true, json: async () => ({ access_token: 'google-access' }) }
    }
    return {
      ok: true,
      json: async () => ({
        sub: 'google-user-1',
        email: 'Maker@Example.com',
        email_verified: true,
        name: 'Google Maker',
      }),
    }
  }

  const profile = await exchangeOAuthCodeForProfile('google', 'auth-code', {
    fetchImpl,
    source: {
      OAUTH_GOOGLE_CLIENT_ID: 'google-client',
      OAUTH_GOOGLE_CLIENT_SECRET: 'google-secret',
      OAUTH_GOOGLE_REDIRECT_URI: 'https://app.example.com/api/auth/oauth/google/callback',
    },
    statePayload: verifyOAuthState(createOAuthState({ provider: 'google' })),
  })

  assert.equal(profile.provider, 'google')
  assert.equal(profile.providerUserId, 'google-user-1')
  assert.equal(profile.email, 'maker@example.com')
  assert.equal(profile.displayName, 'Google Maker')
  assert.equal(calls[0].options.body.get('code'), 'auth-code')
  assert.ok(calls[0].options.body.get('code_verifier'))
  assert.equal(calls[1].options.headers.authorization, 'Bearer google-access')
})

test('exchangeOAuthCodeForProfile verifies Discord token and user responses', async () => {
  const fetchImpl = async (url) => {
    if (url === 'https://discord.com/api/oauth2/token') {
      return { ok: true, json: async () => ({ access_token: 'discord-access' }) }
    }
    return {
      ok: true,
      json: async () => ({
        id: 'discord-user-1',
        email: 'discord@example.com',
        verified: true,
        username: 'discordname',
        global_name: 'Discord Maker',
      }),
    }
  }

  const profile = await exchangeOAuthCodeForProfile('discord', 'auth-code', {
    fetchImpl,
    source: {
      OAUTH_DISCORD_CLIENT_ID: 'discord-client',
      OAUTH_DISCORD_CLIENT_SECRET: 'discord-secret',
      OAUTH_DISCORD_REDIRECT_URI: 'https://app.example.com/api/auth/oauth/discord/callback',
    },
    statePayload: verifyOAuthState(createOAuthState({ provider: 'discord' })),
  })

  assert.equal(profile.provider, 'discord')
  assert.equal(profile.providerUserId, 'discord-user-1')
  assert.equal(profile.email, 'discord@example.com')
  assert.equal(profile.displayName, 'Discord Maker')
})

test('GitHub OAuth uses PKCE and resolves a verified primary email', async () => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    if (url === 'https://github.com/login/oauth/access_token') return { ok: true, json: async () => ({ access_token: 'github-access' }) }
    if (url === 'https://api.github.com/user') return { ok: true, json: async () => ({ id: 42, login: 'octomaker', name: 'Octo Maker', email: 'unverified@example.com' }) }
    return { ok: true, json: async () => ([
      { email: 'unverified@example.com', verified: false, primary: false },
      { email: 'Maker@Example.com', verified: true, primary: true },
    ]) }
  }
  const statePayload = verifyOAuthState(createOAuthState({ provider: 'github' }))
  const profile = await exchangeOAuthCodeForProfile('github', 'github-code', {
    fetchImpl,
    source: {
      OAUTH_GITHUB_CLIENT_ID: 'github-client', OAUTH_GITHUB_CLIENT_SECRET: 'github-secret',
      OAUTH_GITHUB_REDIRECT_URI: 'https://app.example.com/api/auth/oauth/github/callback',
    },
    statePayload,
  })

  assert.deepEqual(profile, { provider: 'github', providerUserId: '42', email: 'maker@example.com', displayName: 'Octo Maker' })
  assert.equal(calls[0].options.body.get('code_verifier'), createOAuthPkce(statePayload).verifier)
  assert.equal(calls[1].options.headers.authorization, 'Bearer github-access')
  assert.equal(calls[2].options.headers['x-github-api-version'], '2026-03-10')
})

test('createAppleClientSecret signs an ES256 client secret', () => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const clientSecret = createAppleClientSecret({
    teamId: 'TEAM123',
    keyId: 'KEY123',
    clientId: 'com.example.web',
    privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }),
  }, 1_700_000_000)
  const [headerPart, payloadPart, signaturePart] = clientSecret.split('.')
  const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8'))
  const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'))

  assert.ok(signaturePart)
  assert.equal(header.alg, 'ES256')
  assert.equal(header.kid, 'KEY123')
  assert.equal(payload.iss, 'TEAM123')
  assert.equal(payload.aud, 'https://appleid.apple.com')
  assert.equal(payload.sub, 'com.example.web')
})

test('exchangeOAuthCodeForProfile verifies Apple id_token and nonce', async () => {
  const statePayload = verifyOAuthState(createOAuthState({ provider: 'apple' }))
  const { privateKey: appleClientPrivateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const { privateKey: appleTokenPrivateKey, publicKey: appleTokenPublicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = appleTokenPublicKey.export({ format: 'jwk' })
  jwk.kid = 'apple-key-1'
  jwk.alg = 'RS256'
  jwk.use = 'sig'
  const idToken = createRs256Jwt({
    kid: 'apple-key-1',
    privateKey: appleTokenPrivateKey,
    claims: {
      iss: 'https://appleid.apple.com',
      aud: 'com.example.web',
      exp: Math.floor(Date.now() / 1000) + 600,
      sub: 'apple-user-1',
      email: 'Apple@Example.com',
      email_verified: 'true',
      nonce: statePayload.nonce,
    },
  })
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    if (url === 'https://appleid.apple.com/auth/token') {
      return { ok: true, json: async () => ({ id_token: idToken }) }
    }
    return { ok: true, json: async () => ({ keys: [jwk] }) }
  }

  const profile = await exchangeOAuthCodeForProfile('apple', 'apple-code', {
    fetchImpl,
    statePayload,
    user: JSON.stringify({ name: { firstName: 'Apple', lastName: 'Maker' } }),
    source: {
      OAUTH_APPLE_CLIENT_ID: 'com.example.web',
      OAUTH_APPLE_TEAM_ID: 'TEAM123',
      OAUTH_APPLE_KEY_ID: 'KEY123',
      OAUTH_APPLE_PRIVATE_KEY: appleClientPrivateKey.export({ format: 'pem', type: 'pkcs8' }),
      OAUTH_APPLE_REDIRECT_URI: 'https://app.example.com/api/auth/oauth/apple/callback',
    },
  })

  assert.equal(profile.provider, 'apple')
  assert.equal(profile.providerUserId, 'apple-user-1')
  assert.equal(profile.email, 'apple@example.com')
  assert.equal(profile.displayName, 'Apple Maker')
  assert.equal(calls[0].options.body.get('client_secret').split('.').length, 3)
  assert.equal(calls[0].options.body.has('code_verifier'), false)
})

test('production OAuth metadata fails closed when credentials are absent or redirect URIs are unsafe', () => {
  const absent = listOAuthProviderMetadata({ NODE_ENV: 'production' })
  assert.deepEqual(absent.map((provider) => [provider.provider, provider.mode, provider.available]), [
    ['google', 'unavailable', false],
    ['github', 'unavailable', false],
    ['apple', 'unavailable', false],
    ['discord', 'unavailable', false],
  ])
  assert.equal(absent.every((provider) => provider.authorizationUrl === null), true)

  const unsafe = listOAuthProviderMetadata({
    NODE_ENV: 'production',
    OAUTH_GOOGLE_CLIENT_ID: 'google-client',
    OAUTH_GOOGLE_CLIENT_SECRET: 'google-secret',
    OAUTH_GOOGLE_REDIRECT_URI: 'http://app.example.com/api/auth/oauth/google/callback',
  }).find((provider) => provider.provider === 'google')
  assert.equal(unsafe.mode, 'unavailable')
  assert.equal(unsafe.configured, false)
})

test('OAuth provider failures and timeouts return a closed verification result', async () => {
  const source = {
    OAUTH_GOOGLE_CLIENT_ID: 'google-client',
    OAUTH_GOOGLE_CLIENT_SECRET: 'google-secret',
    OAUTH_GOOGLE_REDIRECT_URI: 'https://app.example.com/api/auth/oauth/google/callback',
    OAUTH_PROVIDER_TIMEOUT_MS: '1000',
  }
  const statePayload = verifyOAuthState(createOAuthState({ provider: 'google' }))
  const networkFailure = await exchangeOAuthCodeForProfile('google', 'auth-code', {
    source,
    statePayload,
    fetchImpl: async () => { throw new Error('raw provider failure') },
  })
  const aborted = await exchangeOAuthCodeForProfile('google', 'auth-code', {
    source,
    statePayload,
    fetchImpl: async (_url, options) => new Promise((resolve) => {
      options.signal.addEventListener('abort', () => resolve({ ok: false }))
    }),
  })
  assert.equal(networkFailure, null)
  assert.equal(aborted, null)
})

test('OAuth provider diagnostics expose only bounded failure metadata', async () => {
  const diagnostics = []
  const secretValues = ['auth-code-secret', 'client-secret-value', 'provider-body-secret']
  const profile = await exchangeOAuthCodeForProfile('google', secretValues[0], {
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    statePayload: verifyOAuthState(createOAuthState({ provider: 'google' })),
    source: {
      OAUTH_GOOGLE_CLIENT_ID: 'google-client',
      OAUTH_GOOGLE_CLIENT_SECRET: secretValues[1],
      OAUTH_GOOGLE_REDIRECT_URI: 'https://app.example.com/api/auth/oauth/google/callback',
    },
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'invalid_client', error_description: secretValues[2] }),
    }),
  })

  assert.equal(profile, null)
  assert.deepEqual(diagnostics, [{
    provider: 'google',
    stage: 'token_exchange',
    category: 'http_error',
    status: 401,
    providerError: 'invalid_client',
  }])
  assert.equal(secretValues.some((value) => JSON.stringify(diagnostics).includes(value)), false)
})

test('OAuth profile mapping rejects unverified email evidence', async () => {
  const statePayload = verifyOAuthState(createOAuthState({ provider: 'google' }))
  const profile = await exchangeOAuthCodeForProfile('google', 'auth-code', {
    statePayload,
    source: {
      OAUTH_GOOGLE_CLIENT_ID: 'google-client',
      OAUTH_GOOGLE_CLIENT_SECRET: 'google-secret',
      OAUTH_GOOGLE_REDIRECT_URI: 'https://app.example.com/api/auth/oauth/google/callback',
    },
    fetchImpl: async (url) => url === 'https://oauth2.googleapis.com/token'
      ? { ok: true, json: async () => ({ access_token: 'google-access' }) }
      : { ok: true, json: async () => ({ sub: 'unverified-user', email: 'user@example.com', email_verified: false }) },
  })
  assert.equal(profile, null)
})
