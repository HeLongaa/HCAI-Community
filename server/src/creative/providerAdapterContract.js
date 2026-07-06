import { HttpError } from '../common/errors/httpError.js'
import { creativeGenerationStatuses, safeErrorPreview } from './generationRecords.js'

const secretKeyPattern = /(api[_-]?key|authorization|bearer|credential|password|private[_-]?key|secret|token)/i
const redactSensitiveText = (value) => String(value ?? '')
  .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, '<redacted>')
  .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gi, '<redacted>')
  .replace(/\b(api[_-]?key|token|secret|password)=([^&\s]+)/gi, '$1=<redacted>')

const isRecord = (value) => value && typeof value === 'object' && !Array.isArray(value)

const assertSafeObject = (value, path) => {
  if (value == null) return
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeObject(item, `${path}[${index}]`))
    return
  }
  if (!isRecord(value)) return
  for (const [key, nested] of Object.entries(value)) {
    if (secretKeyPattern.test(key)) {
      throw new HttpError(500, 'CREATIVE_PROVIDER_CONTRACT_FAILED', `Provider adapter exposed unsafe metadata key: ${path}.${key}`)
    }
    assertSafeObject(nested, `${path}.${key}`)
  }
}

const assertString = (value, field) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(500, 'CREATIVE_PROVIDER_CONTRACT_FAILED', `Provider adapter must return ${field}`)
  }
}

const assertOutputContract = (output, index) => {
  if (!isRecord(output)) {
    throw new HttpError(500, 'CREATIVE_PROVIDER_CONTRACT_FAILED', `Provider adapter output ${index} must be an object`)
  }
  assertString(output.id, `outputs[${index}].id`)
  assertString(output.type, `outputs[${index}].type`)
  assertString(output.contentType, `outputs[${index}].contentType`)
  if (!isRecord(output.storage)) {
    throw new HttpError(500, 'CREATIVE_PROVIDER_CONTRACT_FAILED', `Provider adapter output ${index} must include storage metadata`)
  }
  if (!isRecord(output.source)) {
    throw new HttpError(500, 'CREATIVE_PROVIDER_CONTRACT_FAILED', `Provider adapter output ${index} must include source metadata`)
  }
  assertSafeObject(output.storage, `outputs[${index}].storage`)
  assertSafeObject(output.source, `outputs[${index}].source`)
}

export const assertCreativeProviderAdapterContract = (generation, { request, provider }) => {
  if (!isRecord(generation)) {
    throw new HttpError(500, 'CREATIVE_PROVIDER_CONTRACT_FAILED', 'Provider adapter must return a generation object')
  }
  assertString(generation.id, 'id')
  if (generation.workspace !== request.workspace) {
    throw new HttpError(500, 'CREATIVE_PROVIDER_CONTRACT_FAILED', 'Provider adapter returned the wrong workspace')
  }
  if (generation.mode !== request.mode) {
    throw new HttpError(500, 'CREATIVE_PROVIDER_CONTRACT_FAILED', 'Provider adapter returned the wrong mode')
  }
  if (!creativeGenerationStatuses.includes(generation.status)) {
    throw new HttpError(500, 'CREATIVE_PROVIDER_CONTRACT_FAILED', `Provider adapter returned unsupported status: ${generation.status}`)
  }
  if (generation.provider?.id !== provider.id) {
    throw new HttpError(500, 'CREATIVE_PROVIDER_CONTRACT_FAILED', 'Provider adapter returned the wrong provider id')
  }

  assertSafeObject(generation.provider, 'provider')
  assertSafeObject(generation.usage, 'usage')
  assertSafeObject(generation.safety, 'safety')
  assertSafeObject(generation.policy, 'policy')

  const outputs = Array.isArray(generation.outputs) ? generation.outputs : []
  if (['completed', 'review_required'].includes(generation.status) && outputs.length === 0) {
    throw new HttpError(500, 'CREATIVE_PROVIDER_CONTRACT_FAILED', `Provider adapter status ${generation.status} requires at least one output`)
  }
  outputs.forEach(assertOutputContract)

  if (generation.status === 'failed') {
    assertString(generation.errorCode, 'errorCode for failed generations')
    assertString(generation.errorMessagePreview, 'errorMessagePreview for failed generations')
  }
}

export const safeProviderFailure = (error) => {
  const statusCode = Number(error?.statusCode ?? error?.status ?? 500)
  const code = String(error?.code ?? '').toUpperCase()
  const message = redactSensitiveText(safeErrorPreview(error))
  if (statusCode === 429 || code.includes('RATE_LIMIT')) {
    return {
      code: 'PROVIDER_RATE_LIMITED',
      messagePreview: message,
      retryable: true,
      statusCode: 429,
    }
  }
  if (code.includes('TIMEOUT') || /timeout|timed out/i.test(String(error?.message ?? ''))) {
    return {
      code: 'PROVIDER_TIMEOUT',
      messagePreview: message,
      retryable: true,
      statusCode: 504,
    }
  }
  return {
    code: 'PROVIDER_EXECUTION_FAILED',
    messagePreview: message,
    retryable: false,
    statusCode: Number.isInteger(statusCode) && statusCode >= 400 ? statusCode : 500,
  }
}
