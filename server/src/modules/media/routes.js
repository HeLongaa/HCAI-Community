import { createHmac, timingSafeEqual } from 'node:crypto'
import { created, ok } from '../../common/http/responses.js'
import { HttpError, notFound } from '../../common/errors/httpError.js'
import { requirePermission, requireUser } from '../../common/http/auth.js'
import { readJsonBody, readJsonBodyWithRaw } from '../../common/http/request.js'
import { parseAssetLibraryQuery, parseCompleteMediaUploadRequest, parseCreateAssetRelationRequest, parseCreateMediaUploadRequest, parseMediaGovernancePolicyRequest, parseMediaGovernancePolicyRollbackRequest, parseMediaReviewQueueQuery, parseMediaScanAlertActionRequest, parseMediaScanAlertSilenceRequest, parseMediaScanCallbackRequest, parseMediaScanJobArchiveQuery, parseMediaScanJobHistoryQuery, parseMediaScanJobQuery, parseMediaScanRequest, parsePaginationQuery } from '../../contracts/requestParsers.js'
import { buildMediaGovernanceConfig } from '../../config/env.js'
import { repositories } from '../../repositories/index.js'

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left ?? ''))
  const rightBuffer = Buffer.from(String(right ?? ''))
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

const headerValue = (headers, key) => {
  const value = headers[key]
  return Array.isArray(value) ? value[0] : value
}

const mediaScanCallbackSignatureToleranceMs = () => {
  const parsed = Number.parseInt(process.env.MEDIA_SCAN_CALLBACK_SIGNATURE_TOLERANCE_SECONDS ?? '300', 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed * 1000 : 300_000
}

const signedCallbackPayload = (timestamp, rawBody) => `${timestamp}.${rawBody}`

const expectedCallbackSignature = (secret, timestamp, rawBody) =>
  `sha256=${createHmac('sha256', secret).update(signedCallbackPayload(timestamp, rawBody)).digest('hex')}`

const recordMediaScanCallbackFailure = async (request, assetId, body, error) => {
  if (!(error instanceof HttpError)) {
    return
  }
  await repositories.media.recordScanCallbackFailure?.(assetId, {
    reason: error.message,
    code: error.code,
    statusCode: error.statusCode,
    scanStatus: body?.status ?? null,
    externalScanId: body?.externalScanId ?? null,
    remoteAddress: request.socket?.remoteAddress ?? null,
    headers: {
      hasSecret: Boolean(headerValue(request.headers, 'x-media-scan-secret')),
      hasTimestamp: Boolean(headerValue(request.headers, 'x-media-scan-timestamp')),
      hasSignature: Boolean(headerValue(request.headers, 'x-media-scan-signature')),
    },
  })
}

const requireMediaScanWebhookSecret = (request, rawBody = '') => {
  const configuredSecret = String(process.env.MEDIA_SCAN_WEBHOOK_SECRET ?? '').trim()
  if (!configuredSecret) {
    throw new HttpError(403, 'PERMISSION_DENIED', 'MEDIA_SCAN_WEBHOOK_SECRET is not configured')
  }
  const providedSecret = headerValue(request.headers, 'x-media-scan-secret')
  if (!safeEqual(providedSecret, configuredSecret)) {
    throw new HttpError(403, 'PERMISSION_DENIED', 'Invalid media scan callback secret')
  }
  const signatureSecret = String(process.env.MEDIA_SCAN_CALLBACK_SIGNATURE_SECRET ?? process.env.MEDIA_SCAN_REQUEST_SECRET ?? '').trim()
  if (!signatureSecret) {
    return
  }
  const timestamp = String(headerValue(request.headers, 'x-media-scan-timestamp') ?? '').trim()
  const signature = String(headerValue(request.headers, 'x-media-scan-signature') ?? '').trim()
  const timestampMs = Number.parseInt(timestamp, 10)
  if (!timestamp || !Number.isInteger(timestampMs)) {
    throw new HttpError(403, 'PERMISSION_DENIED', 'Missing media scan callback timestamp')
  }
  if (Math.abs(Date.now() - timestampMs) > mediaScanCallbackSignatureToleranceMs()) {
    throw new HttpError(403, 'PERMISSION_DENIED', 'Expired media scan callback timestamp')
  }
  const expected = expectedCallbackSignature(signatureSecret, timestamp, rawBody)
  if (!signature || !safeEqual(signature, expected)) {
    throw new HttpError(403, 'PERMISSION_DENIED', 'Invalid media scan callback signature')
  }
}

export const registerMediaRoutes = (router) => {
  router.add('GET', '/api/media/assets', async (_request, response, context) => {
    const actor = requireUser(context)
    const page = await repositories.media.listAssetLibrary(actor, parseAssetLibraryQuery(context.query))
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('GET', '/api/media/assets/:id', async (_request, response, context) => {
    const actor = requireUser(context)
    const asset = await repositories.media.getAssetLibraryItem(context.params.id, actor)
    if (!asset) throw notFound(`/api/media/assets/${context.params.id}`)
    ok(response, asset)
  })

  router.add('POST', '/api/media/assets/:id/archive', async (_request, response, context) => {
    const actor = requireUser(context)
    const asset = await repositories.media.setAssetArchived(context.params.id, true, actor)
    if (!asset) throw notFound(`/api/media/assets/${context.params.id}`)
    ok(response, asset)
  })

  router.add('POST', '/api/media/assets/:id/restore', async (_request, response, context) => {
    const actor = requireUser(context)
    const asset = await repositories.media.setAssetArchived(context.params.id, false, actor)
    if (!asset) throw notFound(`/api/media/assets/${context.params.id}`)
    ok(response, asset)
  })

  router.add('POST', '/api/media/assets/:id/relations', async (request, response, context) => {
    const actor = requireUser(context)
    const asset = await repositories.media.createAssetRelation(context.params.id, parseCreateAssetRelationRequest((await readJsonBody(request)) ?? {}), actor)
    if (!asset) throw notFound(`/api/media/assets/${context.params.id}`)
    ok(response, asset)
  })

  router.add('GET', '/api/media/review-queue', async (_request, response, context) => {
    requirePermission(context, 'admin:queue:read')
    const page = await repositories.media.listReviewQueue(parseMediaReviewQueueQuery(context.query))
    ok(response, page.items, {
      pagination: {
        limit: page.limit,
        nextCursor: page.nextCursor,
      },
    })
  })

  router.add('GET', '/api/media/scan-jobs', async (_request, response, context) => {
    requirePermission(context, 'admin:queue:read')
    const page = await repositories.media.listScanJobs?.(parseMediaScanJobQuery(context.query))
    ok(response, page.items, {
      pagination: {
        limit: page.limit,
        nextCursor: page.nextCursor,
      },
    })
  })

  router.add('GET', '/api/media/scan-jobs/archive', async (_request, response, context) => {
    requirePermission(context, 'admin:queue:read')
    ok(response, await repositories.media.exportScanJobArchive?.(parseMediaScanJobArchiveQuery(context.query)))
  })

  router.add('POST', '/api/media/scan-jobs/archive', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:queue:review')
    ok(response, await repositories.media.archiveScanJobHistory?.(parseMediaScanJobArchiveQuery(context.query), actor))
  })

  router.add('GET', '/api/media/governance-config', async (_request, response, context) => {
    requirePermission(context, 'admin:queue:read')
    const policy = await repositories.media.getGovernancePolicy?.()
    ok(response, buildMediaGovernanceConfig(process.env, policy))
  })

  router.add('PUT', '/api/media/governance-policy', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:permissions:manage')
    const patch = parseMediaGovernancePolicyRequest((await readJsonBody(request)) ?? {})
    const policy = await repositories.media.updateGovernancePolicy?.(patch, actor)
    ok(response, buildMediaGovernanceConfig(process.env, policy))
  })

  router.add('GET', '/api/media/governance-policy/history', async (_request, response, context) => {
    requirePermission(context, 'admin:queue:read')
    const page = await repositories.media.listGovernancePolicyHistory?.(parsePaginationQuery(context.query, { defaultLimit: 10, maxLimit: 50 }))
    ok(response, page?.items ?? [], {
      pagination: {
        limit: page?.limit ?? 10,
        nextCursor: page?.nextCursor ?? null,
      },
    })
  })

  router.add('POST', '/api/media/governance-policy/rollback', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:permissions:manage')
    const payload = parseMediaGovernancePolicyRollbackRequest((await readJsonBody(request)) ?? {})
    const policy = await repositories.media.rollbackGovernancePolicy?.(payload.eventId, actor)
    if (!policy) {
      throw notFound(`/api/media/governance-policy/history/${payload.eventId}`)
    }
    ok(response, buildMediaGovernanceConfig(process.env, policy))
  })

  router.add('GET', '/api/media/scan-alerts', async (_request, response, context) => {
    requirePermission(context, 'admin:queue:read')
    ok(response, await repositories.media.listScanAlerts?.() ?? [])
  })

  router.add('GET', '/api/media/scan-alerts/:id/events', async (_request, response, context) => {
    requirePermission(context, 'admin:queue:read')
    const events = await repositories.media.listScanAlertEvents?.(context.params.id, { limit: 5 })
    if (!events) {
      throw notFound(`/api/media/scan-alerts/${context.params.id}/events`)
    }
    ok(response, events)
  })

  router.add('POST', '/api/media/scan-alerts/:id/acknowledge', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:queue:review')
    const alert = await repositories.media.acknowledgeScanAlert?.(
      context.params.id,
      parseMediaScanAlertActionRequest((await readJsonBody(request)) ?? {}),
      actor,
    )
    if (!alert) {
      throw notFound(`/api/media/scan-alerts/${context.params.id}`)
    }
    ok(response, alert)
  })

  router.add('POST', '/api/media/scan-alerts/:id/silence', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:queue:review')
    const alert = await repositories.media.silenceScanAlert?.(
      context.params.id,
      parseMediaScanAlertSilenceRequest((await readJsonBody(request)) ?? {}),
      actor,
    )
    if (!alert) {
      throw notFound(`/api/media/scan-alerts/${context.params.id}`)
    }
    ok(response, alert)
  })

  router.add('POST', '/api/media/scan-alerts/:id/unsilence', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:queue:review')
    const alert = await repositories.media.unsilenceScanAlert?.(
      context.params.id,
      parseMediaScanAlertActionRequest((await readJsonBody(request)) ?? {}),
      actor,
    )
    if (!alert) {
      throw notFound(`/api/media/scan-alerts/${context.params.id}`)
    }
    ok(response, alert)
  })

  router.add('GET', '/api/media/uploads/:id/scan-jobs', async (_request, response, context) => {
    requirePermission(context, 'admin:queue:read')
    const page = await repositories.media.listScanJobHistory?.(
      context.params.id,
      parseMediaScanJobHistoryQuery(context.query),
    )
    if (!page) {
      throw notFound(`/api/media/uploads/${context.params.id}/scan-jobs`)
    }
    ok(response, page.items, {
      pagination: {
        limit: page.limit,
        nextCursor: page.nextCursor,
      },
    })
  })

  router.add('POST', '/api/media/scan-jobs/sweep', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:queue:review')
    const result = await repositories.media.sweepScanJobs?.({ actor })
    ok(response, result ?? { inspected: 0, retried: 0, failed: 0, items: [] })
  })

  router.add('POST', '/api/media/uploads', async (request, response, context) => {
    const actor = requireUser(context)
    const body = (await readJsonBody(request)) ?? {}
    const upload = await repositories.media.createUpload(parseCreateMediaUploadRequest(body), actor)
    if (!upload) {
      throw notFound('/api/media/uploads')
    }
    created(response, upload)
  })

  router.add('POST', '/api/media/uploads/:id/complete', async (request, response, context) => {
    const actor = requireUser(context)
    const body = (await readJsonBody(request)) ?? {}
    const asset = await repositories.media.completeUpload(context.params.id, parseCompleteMediaUploadRequest(body), actor)
    if (!asset) {
      throw notFound(`/api/media/uploads/${context.params.id}`)
    }
    ok(response, asset)
  })

  router.add('POST', '/api/media/uploads/:id/scan', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:queue:review')
    const body = (await readJsonBody(request)) ?? {}
    const asset = await repositories.media.reviewUpload?.(context.params.id, parseMediaScanRequest(body), actor)
    if (!asset) {
      throw notFound(`/api/media/uploads/${context.params.id}`)
    }
    ok(response, asset)
  })

  router.add('POST', '/api/media/uploads/:id/scan-callback', async (request, response, context) => {
    const { body, raw } = await readJsonBodyWithRaw(request)
    try {
      requireMediaScanWebhookSecret(request, raw)
    } catch (error) {
      await recordMediaScanCallbackFailure(request, context.params.id, body, error)
      throw error
    }
    const asset = await repositories.media.recordScanCallback?.(context.params.id, parseMediaScanCallbackRequest(body))
    if (!asset) {
      throw notFound(`/api/media/uploads/${context.params.id}`)
    }
    ok(response, asset)
  })

  router.add('POST', '/api/media/uploads/:id/scan-retry', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:queue:review')
    const asset = await repositories.media.retryScan?.(context.params.id, actor)
    if (!asset) {
      throw notFound(`/api/media/uploads/${context.params.id}`)
    }
    ok(response, asset)
  })

  router.add('GET', '/api/media/assets/:id/download', async (_request, response, context) => {
    const actor = requireUser(context)
    const contract = await repositories.media.createDownload?.(context.params.id, actor)
    if (!contract) {
      throw notFound(`/api/media/assets/${context.params.id}`)
    }
    ok(response, contract)
  })
}
