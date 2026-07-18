const forwardedClientIp = (request) => {
  const value = request?.headers?.['x-forwarded-for']
  const header = Array.isArray(value) ? value[0] : value
  return String(header ?? '').split(',')[0].trim() || null
}

export const apiKeyTrustProxyEnabled = (source = process.env) =>
  String(source.API_KEY_TRUST_PROXY ?? '').trim().toLowerCase() === 'true'

export const resolveApiKeyClientIp = (request, source = process.env) => {
  if (apiKeyTrustProxyEnabled(source)) {
    const forwarded = forwardedClientIp(request)
    if (forwarded) return forwarded
  }
  return request?.socket?.remoteAddress ?? null
}
