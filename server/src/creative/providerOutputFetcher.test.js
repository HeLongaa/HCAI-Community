import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createProviderOutputFetcher,
  validateProviderOutputUrl,
} from './providerOutputFetcher.js'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)
const mp4 = Buffer.from('00000018667479706d703432000000006d70343269736f6d0000000866726565', 'hex')
const publicDns = async () => [{ address: '8.8.8.8', family: 4 }]
const allowedHosts = ['cdn.example.test']

const outputFetcher = (fetchImpl, overrides = {}) => createProviderOutputFetcher({
  fetchImpl,
  allowedHosts,
  dnsLookup: publicDns,
  maxBytesByWorkspace: { image: 1024 },
  ...overrides,
})

test('provider output fetcher is disabled without an injected fetch implementation', async () => {
  const fetchOutput = createProviderOutputFetcher({ allowedHosts, dnsLookup: publicDns })
  await assert.rejects(
    fetchOutput({
      url: 'https://cdn.example.test/output.png?signature=must-not-escape',
      workspace: 'image',
      declaredContentType: 'image/png',
    }),
    { statusCode: 503, code: 'CREATIVE_PROVIDER_OUTPUT_FETCH_DISABLED' },
  )
})

test('provider output fetcher validates PNG bytes and computes a platform checksum', async () => {
  let requestOptions
  const fetchOutput = outputFetcher(async (_url, options) => {
    requestOptions = options
    return new Response(png, { headers: { 'content-type': 'image/png', 'content-length': String(png.length) } })
  })
  const result = await fetchOutput({
    url: 'https://cdn.example.test/output.png?signature=ephemeral',
    workspace: 'image',
    declaredContentType: 'image/png',
  })
  assert.equal(result.contentType, 'image/png')
  assert.equal(result.extension, 'png')
  assert.equal(result.sizeBytes, png.length)
  assert.match(result.sha256, /^[a-f0-9]{64}$/)
  assert.equal(requestOptions.redirect, 'manual')
  assert.equal(JSON.stringify(result).includes('signature'), false)
})

test('provider output fetcher validates bounded Video MP4 fixture bytes', async () => {
  const fetchOutput = createProviderOutputFetcher({
    fetchImpl: async () => new Response(mp4, {
      headers: { 'content-type': 'video/mp4', 'content-length': String(mp4.length) },
    }),
    allowedHosts,
    dnsLookup: publicDns,
    maxBytesByWorkspace: { video: 1024 },
  })
  const result = await fetchOutput({
    url: 'https://cdn.example.test/output.mp4?signature=ephemeral-video',
    workspace: 'video',
    declaredContentType: 'video/mp4',
  })
  assert.equal(result.contentType, 'video/mp4')
  assert.equal(result.extension, 'mp4')
  assert.equal(result.sizeBytes, mp4.length)
  assert.equal(JSON.stringify(result).includes('ephemeral-video'), false)
})

test('provider output URL policy rejects unsafe schemes, hosts, ports, credentials, and addresses', async () => {
  const cases = [
    ['http://cdn.example.test/output.png', 'https_required'],
    ['https://user:pass@cdn.example.test/output.png', 'credentials_forbidden'],
    ['https://cdn.example.test:8443/output.png', 'port_forbidden'],
    ['https://other.example.test/output.png', 'host_not_allowed'],
  ]
  for (const [url, reasonCode] of cases) {
    await assert.rejects(
      validateProviderOutputUrl(url, { allowedHosts, dnsLookup: publicDns }),
      (error) => error.details?.reasonCode === reasonCode,
    )
  }
  await assert.rejects(
    validateProviderOutputUrl('https://cdn.example.test/output.png', {
      allowedHosts,
      dnsLookup: async () => [{ address: '169.254.169.254', family: 4 }],
    }),
    (error) => error.details?.reasonCode === 'non_public_address',
  )
})

test('provider output fetcher rejects redirects, oversized bodies, and MIME mismatches safely', async () => {
  const signedUrl = 'https://cdn.example.test/output.png?token=private-value'
  const scenarios = [
    {
      fetchImpl: async () => new Response(null, { status: 302, headers: { location: '/other.png' } }),
      options: {},
      code: 'CREATIVE_PROVIDER_OUTPUT_REDIRECT_DENIED',
    },
    {
      fetchImpl: async () => new Response(png, { headers: { 'content-type': 'image/png', 'content-length': '4096' } }),
      options: {},
      code: 'CREATIVE_PROVIDER_OUTPUT_TOO_LARGE',
    },
    {
      fetchImpl: async () => new Response(png, { headers: { 'content-type': 'text/html' } }),
      options: {},
      code: 'CREATIVE_PROVIDER_OUTPUT_TYPE_MISMATCH',
    },
  ]
  for (const scenario of scenarios) {
    await assert.rejects(
      outputFetcher(scenario.fetchImpl, scenario.options)({
        url: signedUrl,
        workspace: 'image',
        declaredContentType: 'image/png',
      }),
      (error) => {
        assert.equal(error.code, scenario.code)
        assert.equal(JSON.stringify(error).includes('private-value'), false)
        return true
      },
    )
  }

  const oversizedChunked = outputFetcher(async () => new Response(Buffer.alloc(2048), {
    headers: { 'content-type': 'image/png' },
  }))
  await assert.rejects(
    oversizedChunked({ url: signedUrl, workspace: 'image', declaredContentType: 'image/png' }),
    { statusCode: 413, code: 'CREATIVE_PROVIDER_OUTPUT_TOO_LARGE' },
  )
})

test('provider output fetcher reports timeouts safely and revalidates redirects before another request', async () => {
  const signedUrl = 'https://cdn.example.test/output.png?token=timeout-secret'
  const timedOut = outputFetcher(async () => {
    const error = new Error('request timed out at signed URL')
    error.name = 'TimeoutError'
    throw error
  })
  await assert.rejects(
    timedOut({ url: signedUrl, workspace: 'image', declaredContentType: 'image/png' }),
    (error) => {
      assert.equal(error.statusCode, 504)
      assert.equal(error.code, 'CREATIVE_PROVIDER_OUTPUT_FETCH_TIMEOUT')
      assert.equal(error.details.reasonCode, 'request_timeout')
      assert.equal(JSON.stringify(error).includes('timeout-secret'), false)
      return true
    },
  )

  let calls = 0
  const redirected = outputFetcher(async () => {
    calls += 1
    return new Response(null, {
      status: 302,
      headers: { location: 'https://unapproved.example.test/output.png' },
    })
  }, { maxRedirects: 1 })
  await assert.rejects(
    redirected({ url: signedUrl, workspace: 'image', declaredContentType: 'image/png' }),
    (error) => error.code === 'CREATIVE_PROVIDER_OUTPUT_HOST_INVALID' &&
      error.details?.reasonCode === 'host_not_allowed',
  )
  assert.equal(calls, 1)
})
