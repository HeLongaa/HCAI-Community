import { createHash } from 'node:crypto'
import { lookup as defaultDnsLookup } from 'node:dns/promises'

import { fileTypeFromBuffer } from 'file-type'
import ipaddr from 'ipaddr.js'

import { HttpError } from '../common/errors/httpError.js'

const outputPolicies = {
  image: {
    maxBytes: 25 * 1024 * 1024,
    types: {
      'image/png': ['png'],
      'image/jpeg': ['jpg', 'jpeg'],
      'image/webp': ['webp'],
    },
  },
  video: {
    maxBytes: 250 * 1024 * 1024,
    types: {
      'video/mp4': ['mp4'],
      'video/webm': ['webm'],
    },
  },
  music: {
    maxBytes: 100 * 1024 * 1024,
    types: {
      'audio/mpeg': ['mp3'],
      'audio/wav': ['wav'],
      'audio/x-wav': ['wav'],
      'audio/mp4': ['m4a', 'mp4'],
    },
  },
}

const outputError = (statusCode, code, reasonCode) =>
  new HttpError(statusCode, code, 'Creative Provider output could not be ingested', { reasonCode })

const normalizeContentType = (value) => String(value ?? '').split(';', 1)[0].trim().toLowerCase()

const allowedHost = (hostname, allowedHosts) => allowedHosts.some((entry) => {
  const normalized = String(entry).trim().toLowerCase().replace(/\.$/, '')
  if (!normalized) return false
  if (normalized.startsWith('*.')) {
    const suffix = normalized.slice(1)
    return hostname.endsWith(suffix) && hostname.length > suffix.length
  }
  return hostname === normalized
})

const publicAddress = (address) => {
  if (!ipaddr.isValid(address)) return false
  const parsed = ipaddr.process(address)
  return parsed.range() === 'unicast'
}

const resolveAddresses = async (hostname, dnsLookup) => {
  if (ipaddr.isValid(hostname)) return [hostname]
  let records
  try {
    records = await dnsLookup(hostname, { all: true, verbatim: true })
  } catch {
    throw outputError(422, 'CREATIVE_PROVIDER_OUTPUT_HOST_INVALID', 'dns_resolution_failed')
  }
  const addresses = (Array.isArray(records) ? records : [records])
    .map((record) => typeof record === 'string' ? record : record?.address)
    .filter(Boolean)
  if (addresses.length === 0) {
    throw outputError(422, 'CREATIVE_PROVIDER_OUTPUT_HOST_INVALID', 'dns_resolution_empty')
  }
  return addresses
}

export const validateProviderOutputUrl = async (rawUrl, {
  allowedHosts,
  dnsLookup = defaultDnsLookup,
} = {}) => {
  let url
  try {
    url = new URL(String(rawUrl ?? ''))
  } catch {
    throw outputError(422, 'CREATIVE_PROVIDER_OUTPUT_URL_INVALID', 'url_invalid')
  }
  if (url.protocol !== 'https:') {
    throw outputError(422, 'CREATIVE_PROVIDER_OUTPUT_URL_INVALID', 'https_required')
  }
  if (url.username || url.password) {
    throw outputError(422, 'CREATIVE_PROVIDER_OUTPUT_URL_INVALID', 'credentials_forbidden')
  }
  if (url.port && url.port !== '443') {
    throw outputError(422, 'CREATIVE_PROVIDER_OUTPUT_URL_INVALID', 'port_forbidden')
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if (!Array.isArray(allowedHosts) || !allowedHost(hostname, allowedHosts)) {
    throw outputError(422, 'CREATIVE_PROVIDER_OUTPUT_HOST_INVALID', 'host_not_allowed')
  }
  const addresses = await resolveAddresses(hostname, dnsLookup)
  if (addresses.some((address) => !publicAddress(address))) {
    throw outputError(422, 'CREATIVE_PROVIDER_OUTPUT_HOST_INVALID', 'non_public_address')
  }
  return url
}

const responseLength = (response) => {
  const value = response.headers?.get?.('content-length')
  if (value == null || value === '') return null
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw outputError(502, 'CREATIVE_PROVIDER_OUTPUT_RESPONSE_INVALID', 'content_length_invalid')
  }
  return parsed
}

const readBoundedBody = async (response, maxBytes) => {
  if (!response.body) {
    throw outputError(502, 'CREATIVE_PROVIDER_OUTPUT_RESPONSE_INVALID', 'body_missing')
  }
  const chunks = []
  let bytes = 0
  try {
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk)
      bytes += buffer.byteLength
      if (bytes > maxBytes) {
        await response.body.cancel?.().catch?.(() => {})
        throw outputError(413, 'CREATIVE_PROVIDER_OUTPUT_TOO_LARGE', 'stream_limit_exceeded')
      }
      chunks.push(buffer)
    }
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw outputError(502, 'CREATIVE_PROVIDER_OUTPUT_FETCH_FAILED', 'body_read_failed')
  }
  if (bytes === 0) {
    throw outputError(422, 'CREATIVE_PROVIDER_OUTPUT_RESPONSE_INVALID', 'empty_body')
  }
  return Buffer.concat(chunks, bytes)
}

const extensionFor = (url) => {
  const match = url.pathname.toLowerCase().match(/\.([a-z0-9]{1,8})$/)
  return match?.[1] ?? null
}

const validateDetectedType = async ({ body, workspace, declaredContentType, responseContentType, url }) => {
  const policy = outputPolicies[workspace]
  if (!policy) {
    throw outputError(422, 'CREATIVE_PROVIDER_OUTPUT_TYPE_UNSUPPORTED', 'workspace_unsupported')
  }
  const detected = await fileTypeFromBuffer(body)
  if (!detected || !policy.types[detected.mime]) {
    throw outputError(422, 'CREATIVE_PROVIDER_OUTPUT_TYPE_UNSUPPORTED', 'magic_type_unsupported')
  }
  const declared = normalizeContentType(declaredContentType)
  const responseType = normalizeContentType(responseContentType)
  if (declared && declared !== detected.mime) {
    throw outputError(422, 'CREATIVE_PROVIDER_OUTPUT_TYPE_MISMATCH', 'declared_type_mismatch')
  }
  if (responseType && responseType !== 'application/octet-stream' && responseType !== detected.mime) {
    throw outputError(422, 'CREATIVE_PROVIDER_OUTPUT_TYPE_MISMATCH', 'response_type_mismatch')
  }
  const extension = extensionFor(url)
  if (extension && !policy.types[detected.mime].includes(extension)) {
    throw outputError(422, 'CREATIVE_PROVIDER_OUTPUT_TYPE_MISMATCH', 'extension_mismatch')
  }
  return detected
}

export const createProviderOutputFetcher = ({
  fetchImpl = null,
  allowedHosts = [],
  dnsLookup = defaultDnsLookup,
  timeoutMs = 15_000,
  maxRedirects = 0,
  maxBytesByWorkspace = {},
} = {}) => async ({ url: rawUrl, workspace, declaredContentType }) => {
  if (typeof fetchImpl !== 'function') {
    throw outputError(503, 'CREATIVE_PROVIDER_OUTPUT_FETCH_DISABLED', 'fetch_adapter_missing')
  }
  const policy = outputPolicies[workspace]
  if (!policy) {
    throw outputError(422, 'CREATIVE_PROVIDER_OUTPUT_TYPE_UNSUPPORTED', 'workspace_unsupported')
  }
  const maxBytes = Number(maxBytesByWorkspace[workspace] ?? policy.maxBytes)
  let url = await validateProviderOutputUrl(rawUrl, { allowedHosts, dnsLookup })
  let response
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: Object.keys(policy.types).join(', ') },
      })
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw outputError(504, 'CREATIVE_PROVIDER_OUTPUT_FETCH_TIMEOUT', 'request_timeout')
      }
      throw outputError(502, 'CREATIVE_PROVIDER_OUTPUT_FETCH_FAILED', 'request_failed')
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) break
    if (redirectCount >= maxRedirects) {
      throw outputError(422, 'CREATIVE_PROVIDER_OUTPUT_REDIRECT_DENIED', 'redirect_not_allowed')
    }
    const location = response.headers?.get?.('location')
    if (!location) {
      throw outputError(502, 'CREATIVE_PROVIDER_OUTPUT_RESPONSE_INVALID', 'redirect_location_missing')
    }
    url = await validateProviderOutputUrl(new URL(location, url).toString(), { allowedHosts, dnsLookup })
  }
  if (!response?.ok) {
    throw outputError(502, 'CREATIVE_PROVIDER_OUTPUT_FETCH_FAILED', 'response_not_ok')
  }
  const contentLength = responseLength(response)
  if (contentLength != null && contentLength > maxBytes) {
    throw outputError(413, 'CREATIVE_PROVIDER_OUTPUT_TOO_LARGE', 'content_length_exceeded')
  }
  const body = await readBoundedBody(response, maxBytes)
  const detected = await validateDetectedType({
    body,
    workspace,
    declaredContentType,
    responseContentType: response.headers?.get?.('content-type'),
    url,
  })
  return {
    body,
    contentType: detected.mime,
    extension: detected.ext,
    sizeBytes: body.byteLength,
    sha256: createHash('sha256').update(body).digest('hex'),
  }
}

export const providerOutputPolicies = Object.freeze(outputPolicies)
