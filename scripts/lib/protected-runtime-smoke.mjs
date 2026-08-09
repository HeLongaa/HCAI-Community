import { buildChatMessageEncryptionConfig } from '../../server/src/chat/messageCrypto.js'
import { buildOpenAIChatRuntimeConfig } from '../../server/src/chat/openaiChatProvider.js'
import { buildProviderDeletionGatewayConfig } from '../../server/src/dataRights/providerDeletionGateway.js'

const unavailableChatEncryption = () => ({ configured: false, activeKeyId: null, keys: new Map() })
const unavailableChatRuntime = () => ({
  mode: 'invalid',
  clientEnabled: false,
  networkCallsEnabled: false,
  safetyClassifierEnabled: false,
  attachmentBytesEnabled: false,
  token: '',
})

const safeErrorCode = (error) => {
  const code = String(error?.code ?? '').trim()
  return /^[A-Z][A-Z0-9_]{2,95}$/.test(code) ? `; code=${code}` : ''
}

const inspect = ({ name, detail, fallback, build }) => {
  try {
    return { value: build(), check: { name, pass: true, detail: '' } }
  } catch (error) {
    return {
      value: fallback(),
      check: { name, pass: false, detail: `${detail}${safeErrorCode(error)}` },
    }
  }
}

export const inspectProtectedRuntimeConfiguration = (
  source,
  {
    buildChatEncryption = buildChatMessageEncryptionConfig,
    buildChatRuntime = buildOpenAIChatRuntimeConfig,
    buildProviderDeletionGateway = buildProviderDeletionGatewayConfig,
  } = {},
) => {
  const chatEncryptionResult = inspect({
    name: 'Chat message encryption configured',
    detail: 'CHAT_MESSAGE_ENCRYPTION_KEY(S) and CHAT_MESSAGE_ENCRYPTION_ACTIVE_KEY_ID must define a valid active 32-byte key',
    fallback: unavailableChatEncryption,
    build: () => {
      const config = buildChatEncryption(source)
      if (!config?.configured) throw new Error('not configured')
      return config
    },
  })
  const chatRuntimeResult = inspect({
    name: 'Chat runtime configuration valid',
    detail: 'CHAT_PROVIDER_* and CHAT_OPENAI_* must satisfy the selected deployment boundary',
    fallback: unavailableChatRuntime,
    build: () => buildChatRuntime(source),
  })
  const providerDeletionResult = inspect({
    name: 'external Provider deletion gateway configured',
    detail: 'DATA_RIGHTS_PROVIDER_DELETION_GATEWAY_* must define an explicitly confirmed fixed HTTPS gateway',
    fallback: () => null,
    build: () => buildProviderDeletionGateway(source),
  })

  return Object.freeze({
    chatEncryption: chatEncryptionResult.value,
    chatRuntime: chatRuntimeResult.value,
    providerDeletionGatewayConfigured: providerDeletionResult.check.pass,
    checks: Object.freeze([
      chatEncryptionResult.check,
      chatRuntimeResult.check,
      providerDeletionResult.check,
    ]),
  })
}
