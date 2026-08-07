import http from 'node:http'
import https from 'node:https'
import { createHmac } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import ipaddr from 'ipaddr.js'

const retryableStatuses = new Set([408, 425, 429])
const responseClass = (statusCode) => `${Math.floor(statusCode / 100)}xx`
const splitCsv = (value) => String(value ?? '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)
const retryAfterSeconds = (value) => Number.isFinite(Number(value)) ? Math.min(Math.max(0, Math.ceil(Number(value))), 3600) : null

const endpointFor = (channel, source) => channel === 'webhook'
  ? source.CREATIVE_PROVIDER_ALERT_WEBHOOK_URL
  : channel === 'slack' ? source.CREATIVE_PROVIDER_ALERT_SLACK_WEBHOOK_URL : source.CREATIVE_PROVIDER_ALERT_EMAIL_WEBHOOK_URL
const secretFor = (channel, source) => channel === 'webhook'
  ? source.CREATIVE_PROVIDER_ALERT_WEBHOOK_SECRET
  : channel === 'email' ? source.CREATIVE_PROVIDER_ALERT_EMAIL_WEBHOOK_SECRET : source.CREATIVE_PROVIDER_ALERT_SLACK_WEBHOOK_SECRET
const timeoutFor = (channel, source) => Number(channel === 'webhook'
  ? source.CREATIVE_PROVIDER_ALERT_WEBHOOK_TIMEOUT_SECONDS
  : channel === 'slack' ? source.CREATIVE_PROVIDER_ALERT_SLACK_TIMEOUT_SECONDS : source.CREATIVE_PROVIDER_ALERT_EMAIL_TIMEOUT_SECONDS) || 5

const addressAllowed = (address) => ipaddr.isValid(address) && ipaddr.process(address).range() === 'unicast'

const nativeRequest = async ({ url, headers, body, timeoutSeconds, resolver = lookup }) => {
  const target = new URL(url)
  const addresses = await resolver(target.hostname, { all: true, verbatim: true })
  if (!addresses.length || addresses.some((item) => !addressAllowed(item.address))) {
    throw Object.assign(new Error('Target resolves to a prohibited address'), { code: 'PROVIDER_ALERT_TARGET_PROHIBITED' })
  }
  const selected = addresses[0]
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const request = (target.protocol === 'https:' ? https : http).request(target, { method: 'POST', headers: { ...headers, 'content-length': Buffer.byteLength(body) }, lookup: (_host, _opts, callback) => callback(null, selected.address, selected.family) }, (response) => {
      response.resume(); response.once('end', () => resolve({ statusCode: response.statusCode ?? 0, headers: response.headers, durationMs: Date.now() - startedAt }))
    })
    request.setTimeout(timeoutSeconds * 1000, () => request.destroy(Object.assign(new Error('Provider alert timed out'), { code: 'PROVIDER_ALERT_TIMEOUT' })))
    request.once('error', reject); request.end(body)
  })
}

export const signProviderAlertBody = (secret, timestamp, body) => `v1=${createHmac('sha256', String(secret)).update(`${timestamp}.${body}`).digest('hex')}`

export const createProviderAlertHttpClient = ({ source = process.env, requestImpl = nativeRequest, resolver = lookup } = {}) => ({
  async send(claim) {
    try {
      const endpoint = new URL(String(endpointFor(claim.channel, source) ?? ''))
      const allowedHosts = new Set(splitCsv(source.CREATIVE_PROVIDER_ALERT_ALLOWED_HOSTS))
      if (endpoint.protocol !== 'https:' || !allowedHosts.has(endpoint.hostname.toLowerCase())) return { outcome: 'permanent_failure', errorCode: 'PROVIDER_ALERT_TARGET_NOT_ALLOWED' }
      const body = JSON.stringify(claim.payload); const timestamp = Math.floor(Date.now() / 1000).toString(); const secret = secretFor(claim.channel, source)
      if (!secret) return { outcome: 'permanent_failure', errorCode: 'PROVIDER_ALERT_SIGNING_SECRET_MISSING' }
      const result = await requestImpl({ url: endpoint.toString(), body, timeoutSeconds: timeoutFor(claim.channel, source), resolver, headers: {
        'content-type': 'application/json', 'user-agent': 'MuseFlow-ProviderAlerts/1.0',
        'x-museflow-delivery': claim.id, 'x-museflow-timestamp': timestamp,
        'x-museflow-signature': signProviderAlertBody(secret, timestamp, body),
        'idempotency-key': claim.payload.idempotencyKey,
      } })
      const statusCode = Number(result.statusCode)
      if (statusCode >= 200 && statusCode < 300) return { outcome: 'success', statusCode, responseClass: responseClass(statusCode), durationMs: result.durationMs, receipt: `${claim.id}:${statusCode}:${timestamp}` }
      const retryable = statusCode >= 500 || retryableStatuses.has(statusCode)
      return { outcome: retryable ? 'retryable_failure' : 'permanent_failure', statusCode, responseClass: responseClass(statusCode), errorCode: retryable ? 'PROVIDER_ALERT_REMOTE_RETRYABLE' : 'PROVIDER_ALERT_REMOTE_REJECTED', retryAfterSeconds: retryAfterSeconds(result.headers?.['retry-after']), durationMs: result.durationMs }
    } catch (error) {
      const permanent = ['ERR_INVALID_URL', 'PROVIDER_ALERT_TARGET_PROHIBITED'].includes(error?.code)
      return { outcome: permanent ? 'permanent_failure' : 'retryable_failure', responseClass: 'network', errorCode: String(error?.code ?? 'PROVIDER_ALERT_NETWORK_ERROR').slice(0, 120) }
    }
  },
})

export const runProviderAlertDeliveryWorkerOnce = async ({ repositories, source = process.env, client = createProviderAlertHttpClient({ source }), workerId = `provider-alert-${process.pid}`, limit = 25, leaseSeconds = 60, baseRetrySeconds = 30 } = {}) => {
  const claims = await repositories.providerAlertDeliveries.claim({ workerId, limit, leaseSeconds }); const completed = []
  for (const claim of claims) completed.push(await repositories.providerAlertDeliveries.complete(claim.id, claim.leaseToken, await client.send(claim), { baseRetrySeconds }))
  return { claimed: claims.length, succeeded: completed.filter((row) => row?.status === 'succeeded').length, retryScheduled: completed.filter((row) => row?.status === 'retry_scheduled').length, deadLettered: completed.filter((row) => row?.status === 'dead_lettered').length }
}
