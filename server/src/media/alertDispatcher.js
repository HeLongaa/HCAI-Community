import { createHmac } from 'node:crypto'

const trimValue = (value) => String(value ?? '').trim()
const positiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const alertWebhookUrl = () => trimValue(process.env.MEDIA_SCAN_ALERT_WEBHOOK_URL)
const alertWebhookSecret = () => trimValue(process.env.MEDIA_SCAN_ALERT_WEBHOOK_SECRET)
const alertWebhookTimeoutMs = () => positiveInteger(process.env.MEDIA_SCAN_ALERT_WEBHOOK_TIMEOUT_SECONDS, 5) * 1000
const slackWebhookUrl = () => trimValue(process.env.MEDIA_SCAN_ALERT_SLACK_WEBHOOK_URL)
const slackWebhookTimeoutMs = () => positiveInteger(process.env.MEDIA_SCAN_ALERT_SLACK_TIMEOUT_SECONDS, 5) * 1000
const emailWebhookUrl = () => trimValue(process.env.MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_URL)
const emailWebhookSecret = () => trimValue(process.env.MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_SECRET)
const emailRecipients = () => trimValue(process.env.MEDIA_SCAN_ALERT_EMAIL_TO)
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)
const emailFrom = () => trimValue(process.env.MEDIA_SCAN_ALERT_EMAIL_FROM)
const emailWebhookTimeoutMs = () => positiveInteger(process.env.MEDIA_SCAN_ALERT_EMAIL_TIMEOUT_SECONDS, 5) * 1000

const signAlertPayload = (secret, body) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

const requestJson = async ({ channel, url, body, headers = {}, timeoutMs }) => {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...headers,
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) {
      return {
        channel,
        status: 'failed',
        statusCode: response.status,
        error: `HTTP ${response.status}`,
      }
    }
    return {
      channel,
      status: 'sent',
      statusCode: response.status,
    }
  } catch (error) {
    return {
      channel,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Request failed',
    }
  }
}

const alertPayload = (alert) => ({
  type: 'media.scan.alert',
  alert,
  sentAt: new Date().toISOString(),
})

const slackPayload = (alert) => ({
  text: `[${alert.severity}] ${alert.title}: ${alert.summary}`,
  blocks: [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${alert.title}*\n${alert.summary}`,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Type: ${alert.type} | Severity: ${alert.severity} | Count: ${alert.count}/${alert.threshold} | Window: ${alert.windowMinutes}m`,
        },
      ],
    },
  ],
})

const emailPayload = (alert) => ({
  type: 'media.scan.alert.email',
  to: emailRecipients(),
  ...(emailFrom() ? { from: emailFrom() } : {}),
  subject: `[${alert.severity}] ${alert.title}`,
  text: `${alert.summary}\n\nType: ${alert.type}\nSeverity: ${alert.severity}\nCount: ${alert.count}/${alert.threshold}\nWindow: ${alert.windowMinutes} minutes`,
  html: [
    `<p>${alert.summary}</p>`,
    '<ul>',
    `<li>Type: ${alert.type}</li>`,
    `<li>Severity: ${alert.severity}</li>`,
    `<li>Count: ${alert.count}/${alert.threshold}</li>`,
    `<li>Window: ${alert.windowMinutes} minutes</li>`,
    '</ul>',
  ].join(''),
  alert,
  sentAt: new Date().toISOString(),
})

const webhookChannel = {
  name: 'webhook',
  isConfigured: () => Boolean(alertWebhookUrl()),
  dispatch: async (alert) => {
    const url = alertWebhookUrl()
    if (!url) {
      return {
        channel: 'webhook',
        status: 'not_configured',
      }
    }
    const body = JSON.stringify(alertPayload(alert))
    const headers = {
      'x-media-scan-alert-id': alert.id,
      'x-media-scan-alert-type': alert.type,
    }
    const secret = alertWebhookSecret()
    if (secret) {
      headers['x-media-scan-alert-signature'] = signAlertPayload(secret, body)
    }
    return requestJson({
      channel: 'webhook',
      url,
      body,
      headers,
      timeoutMs: alertWebhookTimeoutMs(),
    })
  },
}

const slackChannel = {
  name: 'slack',
  isConfigured: () => Boolean(slackWebhookUrl()),
  dispatch: async (alert) => {
    const url = slackWebhookUrl()
    if (!url) {
      return {
        channel: 'slack',
        status: 'not_configured',
      }
    }
    return requestJson({
      channel: 'slack',
      url,
      body: JSON.stringify(slackPayload(alert)),
      timeoutMs: slackWebhookTimeoutMs(),
    })
  },
}

const emailChannel = {
  name: 'email',
  isConfigured: () => Boolean(emailWebhookUrl()),
  dispatch: async (alert) => {
    const url = emailWebhookUrl()
    if (!url) {
      return {
        channel: 'email',
        status: 'not_configured',
      }
    }
    const recipients = emailRecipients()
    if (recipients.length === 0) {
      return {
        channel: 'email',
        status: 'failed',
        error: 'MEDIA_SCAN_ALERT_EMAIL_TO is required',
      }
    }
    const body = JSON.stringify(emailPayload(alert))
    const headers = {
      'x-media-scan-alert-id': alert.id,
      'x-media-scan-alert-type': alert.type,
    }
    const secret = emailWebhookSecret()
    if (secret) {
      headers['x-media-scan-alert-signature'] = signAlertPayload(secret, body)
    }
    return requestJson({
      channel: 'email',
      url,
      body,
      headers,
      timeoutMs: emailWebhookTimeoutMs(),
    })
  },
}

const alertChannels = [webhookChannel, slackChannel, emailChannel]

export const dispatchMediaScanAlert = async (alert) => {
  const configuredChannels = alertChannels.filter((channel) => channel.isConfigured())
  if (configuredChannels.length === 0) {
    return [await webhookChannel.dispatch(alert)]
  }
  return Promise.all(configuredChannels.map((channel) => channel.dispatch(alert)))
}
