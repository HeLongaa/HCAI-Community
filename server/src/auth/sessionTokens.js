import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const accessTokenTtlMs = 15 * 60 * 1000
const configuredRefreshTokenTtlDays = Number.parseInt(process.env.AUTH_REFRESH_TOKEN_TTL_DAYS ?? '30', 10)
export const refreshTokenTtlMs = (Number.isInteger(configuredRefreshTokenTtlDays) && configuredRefreshTokenTtlDays >= 1 && configuredRefreshTokenTtlDays <= 365
  ? configuredRefreshTokenTtlDays
  : 30) * 24 * 60 * 60 * 1000

const devAccessTokenSecret = 'hcai-dev-access-token-secret'

const encodeBase64Url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const decodeBase64UrlJson = (value) => JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))

const splitSecrets = (value) =>
  String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

export const getAccessTokenKeyRing = (source = process.env) => {
  const currentSecret = source.ACCESS_TOKEN_SECRET ?? source.SESSION_SECRET ?? devAccessTokenSecret
  const currentKid = source.ACCESS_TOKEN_KEY_ID ?? 'current'
  const previousSecrets = splitSecrets(source.ACCESS_TOKEN_PREVIOUS_SECRETS)
  const previousKids = splitSecrets(source.ACCESS_TOKEN_PREVIOUS_KEY_IDS)
  return [
    { kid: currentKid, secret: currentSecret, current: true },
    ...previousSecrets.map((secret, index) => ({ kid: previousKids[index] ?? `previous-${index + 1}`, secret, current: false })),
  ]
}

const sign = (header, payload, secret) =>
  createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url')

export const createOpaqueToken = (prefix) => `${prefix}.${randomBytes(32).toString('base64url')}`

export const hashToken = (token) => createHash('sha256').update(token).digest('hex')

export const futureDate = (ttlMs) => new Date(Date.now() + ttlMs)

export const createAccessToken = (subject, claims = {}) => {
  const currentKey = getAccessTokenKeyRing().find((key) => key.current)
  const now = Math.floor(Date.now() / 1000)
  const header = encodeBase64Url({ alg: 'HS256', typ: 'JWT', kid: currentKey.kid })
  const payload = encodeBase64Url({
    ...claims,
    sub: String(subject),
    typ: 'access',
    iat: now,
    exp: now + Math.floor(accessTokenTtlMs / 1000),
    jti: randomBytes(16).toString('base64url'),
  })
  return `${header}.${payload}.${sign(header, payload, currentKey.secret)}`
}

export const verifyAccessToken = (token) => {
  if (typeof token !== 'string') {
    return null
  }
  const [header, payload, signature, extra] = token.split('.')
  if (!header || !payload || !signature || extra) {
    return null
  }

  try {
    const decodedHeader = decodeBase64UrlJson(header)
    const candidateKeys = decodedHeader.kid
      ? getAccessTokenKeyRing().filter((key) => key.kid === decodedHeader.kid)
      : getAccessTokenKeyRing()
    const signatureBuffer = Buffer.from(signature)
    const verified = candidateKeys.some((key) => {
      const expectedBuffer = Buffer.from(sign(header, payload, key.secret))
      return expectedBuffer.length === signatureBuffer.length && timingSafeEqual(expectedBuffer, signatureBuffer)
    })
    if (!verified) {
      return null
    }

    const decodedPayload = decodeBase64UrlJson(payload)
    if (decodedHeader.alg !== 'HS256' || decodedHeader.typ !== 'JWT' || decodedPayload.typ !== 'access') {
      return null
    }
    if (!decodedPayload.sub || decodedPayload.exp <= Math.floor(Date.now() / 1000)) {
      return null
    }
    return decodedPayload
  } catch {
    return null
  }
}
