import { fileTypeFromBuffer } from 'file-type'

import { HttpError } from '../common/errors/httpError.js'
import { signMediaDownload } from '../storage/uploadSigner.js'
import { chatCapabilityContract } from '../creative/chatCapabilityContract.js'

const textTypes = new Set(['text/plain', 'text/markdown'])
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])
const maximumTextCharacters = 12000

const attachmentError = (status, reasonCode) => new HttpError(
  status,
  'CHAT_ATTACHMENT_BYTES_UNAVAILABLE',
  'Selected Chat attachment bytes are unavailable',
  { reasonCode },
)

const readBoundedBody = async (response, maximumBytes) => {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maximumBytes) throw attachmentError(413, 'content_length_exceeded')
  if (!response.body) throw attachmentError(502, 'body_missing')
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maximumBytes) {
      await reader.cancel().catch(() => {})
      throw attachmentError(413, 'stream_limit_exceeded')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total)
}

export const createChatStorageObjectReader = ({ source = process.env, fetchImpl = fetch } = {}) => async (asset, signal) => {
  if (!asset.storageKey) throw attachmentError(503, 'storage_key_missing')
  const download = signMediaDownload(asset, { source })
  if (download.provider !== 's3' || !download.url.startsWith('https://')) throw attachmentError(503, 's3_reader_required')
  let response
  try {
    response = await fetchImpl(download.url, {
      method: 'GET',
      headers: download.headers,
      redirect: 'error',
      signal,
    })
  } catch {
    throw attachmentError(502, 'storage_fetch_failed')
  }
  if (!response.ok) {
    if (response.body) await response.body.cancel().catch(() => {})
    throw attachmentError(502, 'storage_fetch_rejected')
  }
  return readBoundedBody(response, chatCapabilityContract.context.attachments.maximumBytesPerAsset)
}

const validateBytes = async (asset, body) => {
  if (!Buffer.isBuffer(body) || body.length === 0 || body.length !== asset.sizeBytes || body.length > chatCapabilityContract.context.attachments.maximumBytesPerAsset) {
    throw attachmentError(422, 'size_mismatch')
  }
  if (textTypes.has(asset.contentType)) {
    if (body.includes(0)) throw attachmentError(422, 'text_binary_content')
    const text = new TextDecoder('utf-8', { fatal: true }).decode(body)
    if ([...text].length > maximumTextCharacters) throw attachmentError(422, 'text_character_limit')
    return Object.freeze({ kind: 'text', text })
  }
  const detected = await fileTypeFromBuffer(body)
  if (detected?.mime !== asset.contentType) throw attachmentError(422, 'magic_type_mismatch')
  const dataUrl = `data:${asset.contentType};base64,${body.toString('base64')}`
  if (imageTypes.has(asset.contentType)) return Object.freeze({ kind: 'image', dataUrl })
  if (asset.contentType === 'application/pdf') return Object.freeze({ kind: 'file', dataUrl })
  throw attachmentError(422, 'content_type_unsupported')
}

export const readChatAttachmentBytes = async (attachments, objectReader, signal) => {
  if (attachments.length === 0) return Object.freeze([])
  if (typeof objectReader !== 'function') throw attachmentError(503, 'object_reader_unavailable')
  let total = 0
  const resolved = []
  for (const attachment of attachments) {
    const body = await objectReader(attachment, signal)
    total += body?.length ?? 0
    if (total > chatCapabilityContract.context.attachments.maximumTotalBytes) throw attachmentError(413, 'total_size_exceeded')
    resolved.push(Object.freeze({ ...attachment, providerInput: await validateBytes(attachment, body) }))
  }
  return Object.freeze(resolved)
}
