import { createHmac } from 'node:crypto'

import { signMediaScannerDownload } from '../storage/uploadSigner.js'

const providerMode = () => String(process.env.MEDIA_SCAN_PROVIDER ?? 'manual').trim().toLowerCase()
const scanRequestAdapterName = () => String(process.env.MEDIA_SCAN_REQUEST_ADAPTER ?? 'generic-webhook').trim().toLowerCase()
const positiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const mediaScanRetryDelayMs = () => positiveInteger(process.env.MEDIA_SCAN_RETRY_DELAY_SECONDS, 300) * 1000
export const mediaScanMaxAttempts = () => positiveInteger(process.env.MEDIA_SCAN_MAX_ATTEMPTS, 3)
export const mediaScanHistoryRetentionDays = () => positiveInteger(process.env.MEDIA_SCAN_HISTORY_RETENTION_DAYS, 180)
export const mediaScanHistoryRetentionMaxPerAsset = () => positiveInteger(process.env.MEDIA_SCAN_HISTORY_RETENTION_MAX_PER_ASSET, 50)
export const mediaScanAlertWindowMinutes = () => positiveInteger(process.env.MEDIA_SCAN_ALERT_WINDOW_MINUTES, 60)
export const mediaScanCallbackDeniedAlertThreshold = () => positiveInteger(process.env.MEDIA_SCAN_CALLBACK_DENIED_ALERT_THRESHOLD, 3)
export const mediaScanDispatchFailedAlertThreshold = () => positiveInteger(process.env.MEDIA_SCAN_DISPATCH_FAILED_ALERT_THRESHOLD, 3)
export const mediaScanTimeoutAlertThreshold = () => positiveInteger(process.env.MEDIA_SCAN_TIMEOUT_ALERT_THRESHOLD, 2)
export const mediaScanAlertDeliveryFailedAlertThreshold = () => positiveInteger(process.env.MEDIA_SCAN_ALERT_DELIVERY_FAILED_ALERT_THRESHOLD, 2)
const mediaScanTimeoutMs = () => positiveInteger(process.env.MEDIA_SCAN_TIMEOUT_SECONDS, 900) * 1000
const mediaScanRequestTimeoutMs = () => positiveInteger(process.env.MEDIA_SCAN_REQUEST_TIMEOUT_SECONDS, 10) * 1000
const futureIso = (ms) => new Date(Date.now() + ms).toISOString()
const trimValue = (value) => String(value ?? '').trim()
const securityMetadata = (asset) => {
  const metadata = asset?.metadata
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata) && metadata.security && typeof metadata.security === 'object'
    ? metadata.security
    : {}
}

const buildExternalScanId = (asset, attempt) => `media-scan-${asset.id}-${attempt}`
const buildCallbackUrl = (asset) => {
  const baseUrl = trimValue(process.env.MEDIA_SCAN_CALLBACK_BASE_URL).replace(/\/+$/, '')
  return baseUrl ? `${baseUrl}/api/media/uploads/${encodeURIComponent(asset.id)}/scan-callback` : null
}

const signPayload = (body) => {
  const secret = trimValue(process.env.MEDIA_SCAN_REQUEST_SECRET || process.env.MEDIA_SCAN_WEBHOOK_SECRET)
  return secret ? `sha256=${createHmac('sha256', secret).update(body).digest('hex')}` : null
}

const buildGenericWebhookPayload = (asset, result, trigger, adapter, readContract) => ({
  scanId: result.externalScanId,
  adapter,
  trigger,
  callbackUrl: buildCallbackUrl(asset),
  asset: {
    id: asset.id,
    fileName: asset.fileName,
    contentType: asset.contentType,
    sizeBytes: asset.sizeBytes,
    purpose: asset.purpose,
    read: readContract,
  },
})

const buildClamAvHttpPayload = (asset, result, trigger, adapter, readContract) => ({
  jobId: result.externalScanId,
  adapter,
  callbackUrl: buildCallbackUrl(asset),
  trigger,
  source: {
    type: 'private-download',
    request: readContract,
    fileName: asset.fileName,
    contentType: asset.contentType,
    sizeBytes: asset.sizeBytes,
  },
  metadata: {
    assetId: asset.id,
    purpose: asset.purpose,
  },
})

const scanRequestAdapters = {
  'generic-webhook': {
    buildPayload: buildGenericWebhookPayload,
    buildHeaders: () => ({}),
  },
  'clamav-http': {
    buildPayload: buildClamAvHttpPayload,
    buildHeaders: (result) => ({
      'x-clamav-job-id': result.externalScanId,
    }),
  },
}

export const supportedMediaScanRequestAdapters = Object.keys(scanRequestAdapters)

export const getMediaScanRequestAdapter = () => {
  const adapter = scanRequestAdapterName()
  if (!supportedMediaScanRequestAdapters.includes(adapter)) {
    throw new Error(`Unsupported media scan request adapter: ${adapter}`)
  }
  return adapter
}

const dispatchWebhookScanRequest = async (asset, result, trigger) => {
  const requestUrl = trimValue(process.env.MEDIA_SCAN_REQUEST_URL)
  const adapter = getMediaScanRequestAdapter()
  const adapterConfig = scanRequestAdapters[adapter]
  if (!requestUrl) {
    return { adapter, status: 'not_configured' }
  }
  const readContract = signMediaScannerDownload(asset)
  const body = JSON.stringify(adapterConfig.buildPayload(asset, result, trigger, adapter, readContract))
  const signature = signPayload(body)
  const headers = {
    'content-type': 'application/json',
    'x-media-scan-id': result.externalScanId,
    'x-media-scan-adapter': adapter,
    ...adapterConfig.buildHeaders(result),
  }
  if (signature) {
    headers['x-media-scan-signature'] = signature
  }
  try {
    const response = await fetch(requestUrl, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(mediaScanRequestTimeoutMs()),
    })
    if (!response.ok) {
      return {
        status: 'failed',
        adapter,
        statusCode: response.status,
        error: `HTTP ${response.status}`,
      }
    }
    return {
      status: 'sent',
      adapter,
      statusCode: response.status,
    }
  } catch (error) {
    return {
      status: 'failed',
      adapter,
      error: error instanceof Error ? error.message : 'Request failed',
    }
  }
}

const buildWebhookScanResult = async (asset, scanAttempts, trigger) => {
  const result = {
    provider: 'webhook',
    status: 'scanning',
    reason: null,
    note: trigger === 'retry' ? 'External scan retry requested.' : 'External scan requested.',
    externalScanId: buildExternalScanId(asset, scanAttempts),
    requestedAt: new Date().toISOString(),
    scanJobStatus: trigger === 'retry' ? 'retrying' : 'queued',
    scanAttempts,
    scanTimeoutAt: futureIso(mediaScanTimeoutMs()),
    nextRetryAt: null,
  }
  const dispatch = await dispatchWebhookScanRequest(asset, result, trigger)
  return {
    ...result,
    requestAdapter: dispatch.adapter,
    dispatchStatus: dispatch.status,
    dispatchStatusCode: dispatch.statusCode,
    dispatchError: dispatch.error,
    dispatchRequestedAt: new Date().toISOString(),
    nextRetryAt: dispatch.status === 'failed' ? futureIso(mediaScanRetryDelayMs()) : null,
  }
}

export const scanMediaAsset = async (asset) => {
  const provider = providerMode()
  if (provider === 'webhook') {
    return buildWebhookScanResult(asset, 1, 'initial')
  }

  if (provider !== 'mock') {
    return {
      provider: 'manual',
      status: 'pending',
      reason: null,
      note: 'Awaiting manual review.',
    }
  }

  const text = `${asset.fileName ?? ''} ${asset.contentType ?? ''} ${asset.storageKey ?? ''}`.toLowerCase()
  if (/(virus|malware|reject|blocked)/.test(text)) {
    return {
      provider,
      status: 'rejected',
      reason: 'mock_signature_match',
      note: 'Mock scanner rejected the asset.',
    }
  }
  if (/(review|quarantine|manual)/.test(text)) {
    return {
      provider,
      status: 'review',
      reason: 'mock_manual_review',
      note: 'Mock scanner requested manual review.',
    }
  }
  return {
    provider,
    status: 'clean',
    reason: null,
    note: 'Mock scanner passed the asset.',
  }
}

export const retryMediaScanAsset = async (asset) => {
  const security = securityMetadata(asset)
  const scanAttempts = Number(security.scanAttempts ?? 0) + 1
  return buildWebhookScanResult(asset, scanAttempts, 'retry')
}
