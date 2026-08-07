import { HttpError } from '../common/errors/httpError.js'
import { signMediaScannerDownload } from '../storage/uploadSigner.js'

const maximumInputBytes = 50 * 1024 * 1024

const unavailable = (reasonCode) => new HttpError(
  503,
  'CREATIVE_INPUT_ASSET_BYTES_UNAVAILABLE',
  'Creative input asset bytes are unavailable',
  { reasonCode },
)

const readExactBody = async (response, expectedBytes) => {
  const declaredBytes = Number(response.headers.get('content-length'))
  if (!Number.isInteger(declaredBytes) || declaredBytes !== expectedBytes) {
    throw unavailable('content_length_mismatch')
  }
  if (!response.body) throw unavailable('body_missing')

  const reader = response.body.getReader()
  const chunks = []
  let totalBytes = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > expectedBytes || totalBytes > maximumInputBytes) {
      await reader.cancel().catch(() => {})
      throw unavailable('stream_limit_exceeded')
    }
    chunks.push(Buffer.from(value))
  }
  if (totalBytes !== expectedBytes) throw unavailable('stream_length_mismatch')
  return Buffer.concat(chunks, totalBytes)
}

export const createCreativeStorageInputReader = ({
  source = process.env,
  fetchImpl = globalThis.fetch,
} = {}) => async (asset) => {
  if (!asset?.storageKey) throw unavailable('storage_key_missing')
  if (!Number.isInteger(asset.sizeBytes) || asset.sizeBytes < 1 || asset.sizeBytes > maximumInputBytes) {
    throw unavailable('declared_size_not_allowed')
  }

  let download
  try {
    download = signMediaScannerDownload(asset, { source })
  } catch {
    throw unavailable('storage_signing_failed')
  }
  if (download.provider !== 's3' || download.method !== 'GET' || !String(download.url).startsWith('https://')) {
    throw unavailable('s3_reader_required')
  }

  let response
  try {
    response = await fetchImpl(download.url, {
      method: 'GET',
      headers: download.headers,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    throw unavailable('storage_fetch_failed')
  }
  if (!response.ok) {
    if (response.body) await response.body.cancel().catch(() => {})
    throw unavailable('storage_fetch_rejected')
  }

  return Object.freeze({
    body: await readExactBody(response, asset.sizeBytes),
    contentType: asset.contentType,
  })
}

export const creativeInputReaderContract = Object.freeze({
  schemaVersion: 1,
  maximumInputBytes,
  timeoutMilliseconds: 30_000,
})
