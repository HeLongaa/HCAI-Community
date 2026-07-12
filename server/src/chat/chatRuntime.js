import { HttpError } from '../common/errors/httpError.js'
import { createChatStorageObjectReader } from './chatAttachmentReader.js'
import {
  assertOpenAIChatBudgetAllowsDispatch,
  buildOpenAIChatProviderCostMetadata,
  buildOpenAIChatRuntimeConfig,
  createOpenAIChatClient,
} from './openaiChatProvider.js'

const unavailable = async () => {
  throw new HttpError(503, 'CHAT_PROVIDER_DISABLED', 'Chat Provider runtime is disabled')
}

export const createChatRuntime = ({ source = process.env, fetchImpl = fetch } = {}) => {
  const config = buildOpenAIChatRuntimeConfig(source)
  if (config.mode === 'mock') return Object.freeze({ mode: 'mock' })
  if (config.mode === 'disabled') {
    return Object.freeze({ mode: 'disabled', streamAdapter: unavailable, inputSafetyClassifier: unavailable, outputSafetyClassifier: unavailable })
  }
  const client = createOpenAIChatClient({ source, fetchImpl })
  const attachmentObjectReader = config.attachmentBytesEnabled
    ? createChatStorageObjectReader({ source, fetchImpl })
    : async () => { throw new HttpError(503, 'CHAT_ATTACHMENT_BYTES_DISABLED', 'Chat attachment byte reading is disabled') }
  return Object.freeze({
    mode: 'openai_staging',
    generationProvider: Object.freeze({ id: 'openai-gpt-5-6-terra', mode: 'openai_chat', label: 'OpenAI GPT-5.6 Terra' }),
    providerCostPlanner: (payload) => assertOpenAIChatBudgetAllowsDispatch(buildOpenAIChatProviderCostMetadata(payload)),
    streamAdapter: (payload) => client.stream(payload),
    inputSafetyClassifier: (payload) => client.classify(payload),
    outputSafetyClassifier: (payload) => client.classify(payload),
    attachmentObjectReader,
  })
}
