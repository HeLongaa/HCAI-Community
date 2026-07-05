import { bodyTooLargeError, requestBodySizeConfig } from './bodySize.js'

const defaultMaxBytes = () => {
  const config = requestBodySizeConfig()
  return config.enabled ? config.maxBytes : Number.POSITIVE_INFINITY
}

const readRawBody = async (request, maxBytes = defaultMaxBytes()) => {
  const chunks = []
  let totalBytes = 0

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += buffer.byteLength
    if (totalBytes > maxBytes) {
      throw bodyTooLargeError({
        limitBytes: maxBytes,
        receivedBytes: totalBytes,
        source: 'stream',
      })
    }
    chunks.push(buffer)
  }

  return Buffer.concat(chunks).toString('utf8').trim()
}

export const readJsonBodyWithRaw = async (request, maxBytes = defaultMaxBytes()) => {
  const raw = await readRawBody(request, maxBytes)

  if (!raw) {
    return { body: null, raw: '' }
  }

  return { body: JSON.parse(raw), raw }
}

export const readJsonBody = async (request, maxBytes = defaultMaxBytes()) => {
  const { body } = await readJsonBodyWithRaw(request, maxBytes)
  return body
}

export const readFormBody = async (request, maxBytes = defaultMaxBytes()) => {
  const raw = await readRawBody(request, maxBytes)
  if (!raw) {
    return {}
  }
  return Object.fromEntries(new URLSearchParams(raw))
}
