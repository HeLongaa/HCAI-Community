import { HttpError } from '../common/errors/httpError.js'
import { chatCapabilityContract } from '../creative/chatCapabilityContract.js'

const modeInstructions = {
  assistant: 'Help the user complete the requested creative or community task directly and concisely.',
  prompt_assist: 'Rewrite the user request as a specific production-ready creative prompt.',
  storyboard: 'Turn the user request into a concise ordered storyboard with concrete shots.',
}

const conservativeTokenEstimate = (value) => Buffer.byteLength(String(value ?? ''), 'utf8')

export const buildChatContext = ({ messages, codec, mode, currentAssistantMessageId = null }) => {
  const selected = messages
    .filter((message) => message.id !== currentAssistantMessageId)
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: codec.decrypt(message),
      sequence: message.sequence,
    }))
  if (selected.length > chatCapabilityContract.context.maxMessages) {
    throw new HttpError(422, 'CHAT_CONTEXT_MESSAGE_LIMIT', 'Chat context exceeds the maximum message count')
  }
  const oversized = selected.find((message) => message.content.length > chatCapabilityContract.context.maxMessageCharacters)
  if (oversized) {
    throw new HttpError(422, 'CHAT_CONTEXT_MESSAGE_TOO_LARGE', 'A Chat message exceeds the context character limit')
  }
  const systemInstruction = modeInstructions[mode]
  const estimatedInputTokens = conservativeTokenEstimate(systemInstruction) +
    selected.reduce((total, message) => total + conservativeTokenEstimate(message.content), 0)
  if (estimatedInputTokens > chatCapabilityContract.context.maxInputTokens) {
    throw new HttpError(422, 'CHAT_CONTEXT_TOKEN_LIMIT', 'Chat context exceeds the maximum input size')
  }
  return { systemInstruction, messages: selected, estimatedInputTokens }
}

export const serializeChatMessage = (message, codec) => ({
  id: message.id,
  turnId: message.turnId,
  role: message.role,
  status: message.status,
  sequence: message.sequence,
  content: codec.decrypt(message),
  createdAt: message.createdAt,
  updatedAt: message.updatedAt,
})
