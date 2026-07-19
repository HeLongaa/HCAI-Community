import http from 'node:http'
import https from 'node:https'
import { createHmac } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import ipaddr from 'ipaddr.js'
import { webhookPayload } from './webhooks.js'

const retryableStatuses = new Set([408, 409, 425, 429])
const responseClass = (statusCode) => `${Math.floor(statusCode / 100)}xx`
const retryAfterSeconds = (value, now = Date.now()) => {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.ceil(seconds), 3600)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.min(Math.max(1, Math.ceil((date - now) / 1000)), 3600) : null
}

const addressAllowed = (address, source) => {
  if (!ipaddr.isValid(address)) return false
  const parsed = ipaddr.process(address)
  const localDevelopment = source.NODE_ENV !== 'production' && ['loopback', 'private'].includes(parsed.range())
  return parsed.range() === 'unicast' || localDevelopment
}

const nativeRequest = async ({ url, headers, body, timeoutSeconds, source, resolver = lookup }) => {
  const target = new URL(url)
  const addresses = await resolver(target.hostname, { all: true, verbatim: true })
  const selected = addresses.find((item) => addressAllowed(item.address, source))
  if (!selected || addresses.some((item) => !addressAllowed(item.address, source))) {
    const error = new Error('Webhook endpoint resolves to a prohibited network address')
    error.code = 'WEBHOOK_TARGET_PROHIBITED'
    throw error
  }
  const transport = target.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const request = transport.request(target, {
      method: 'POST',
      headers: { ...headers, 'content-length': Buffer.byteLength(body) },
      lookup: (_hostname, _options, callback) => callback(null, selected.address, selected.family),
    }, (response) => {
      response.resume()
      response.once('end', () => resolve({ statusCode: response.statusCode ?? 0, headers: response.headers, durationMs: Date.now() - startedAt }))
    })
    request.setTimeout(Math.max(1, Number(timeoutSeconds)) * 1000, () => {
      const error = new Error('Webhook request timed out'); error.code = 'WEBHOOK_TIMEOUT'; request.destroy(error)
    })
    request.once('error', reject)
    request.end(body)
  })
}

export const signWebhookBody = (secret, timestamp, body) => `v1=${createHmac('sha256', String(secret)).update(`${timestamp}.${body}`).digest('hex')}`

export const createWebhookHttpClient = ({ source = process.env, requestImpl = nativeRequest, resolver = lookup } = {}) => ({
  async send(claim) {
    const payload = webhookPayload(claim)
    const body = JSON.stringify(payload)
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const headers = {
      'content-type': 'application/json',
      'user-agent': 'MuseFlow-Webhooks/1.0',
      'x-museflow-delivery': claim.id,
      'x-museflow-event': payload.type,
      'x-museflow-event-version': String(payload.version),
      'x-museflow-attempt': String(claim.attemptCount),
      'x-museflow-timestamp': timestamp,
      'x-museflow-signature': signWebhookBody(claim.signingSecret, timestamp, body),
      'idempotency-key': claim.id,
    }
    try {
      const result = await requestImpl({ url: claim.endpointUrl, headers, body, timeoutSeconds: claim.timeoutSeconds, source, resolver })
      const statusCode = Number(result.statusCode)
      if (statusCode >= 200 && statusCode < 300) return { outcome: 'success', statusCode, responseClass: responseClass(statusCode), durationMs: result.durationMs }
      const retryable = statusCode >= 500 || retryableStatuses.has(statusCode)
      return {
        outcome: retryable ? 'retryable_failure' : 'permanent_failure',
        statusCode,
        responseClass: responseClass(statusCode),
        errorCode: retryable ? 'WEBHOOK_REMOTE_RETRYABLE' : 'WEBHOOK_REMOTE_REJECTED',
        retryAfterSeconds: retryable ? retryAfterSeconds(result.headers?.['retry-after']) : null,
        durationMs: result.durationMs,
      }
    } catch (error) {
      const permanent = error?.code === 'WEBHOOK_TARGET_PROHIBITED'
      return { outcome: permanent ? 'permanent_failure' : 'retryable_failure', errorCode: String(error?.code ?? 'WEBHOOK_NETWORK_ERROR').slice(0, 120), responseClass: 'network', durationMs: null }
    }
  },
})

export const runWebhookDeliveryWorkerOnce = async ({
  repositories,
  source = process.env,
  client = createWebhookHttpClient({ source }),
  workerId = `webhook-delivery-${process.pid}`,
  limit = 25,
  leaseSeconds = 60,
} = {}) => {
  const claims = await repositories.webhooks.claim({ workerId, limit, leaseSeconds })
  const completed = []
  for (const claim of claims) completed.push(await repositories.webhooks.complete(claim.id, claim.leaseToken, await client.send(claim)))
  return {
    claimed: claims.length,
    succeeded: completed.filter((item) => item?.status === 'succeeded').length,
    retryScheduled: completed.filter((item) => item?.status === 'retry_scheduled').length,
    deadLettered: completed.filter((item) => item?.status === 'dead_lettered').length,
  }
}
