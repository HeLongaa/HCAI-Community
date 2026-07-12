const responseFor = ({ mode, prompt }) => {
  if (mode === 'prompt_assist') {
    return `Mock prompt draft: Create a production-ready result for this request: ${prompt}`
  }
  if (mode === 'storyboard') {
    return `Mock storyboard:\n1. Establish the subject and setting.\n2. Develop the central action from: ${prompt}\n3. End on a clear final beat.`
  }
  return `Mock assistant response: ${prompt}`
}

const chunkText = (text, maximumCharacters = 24) => {
  const chunks = []
  for (let index = 0; index < text.length; index += maximumCharacters) {
    chunks.push(text.slice(index, index + maximumCharacters))
  }
  return chunks
}

const configuredDelayMs = () => {
  if (!['development', 'test'].includes(process.env.NODE_ENV ?? 'development')) return 0
  const parsed = Number.parseInt(process.env.CHAT_MOCK_STREAM_DELAY_MS ?? '', 10)
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 1000) : 0
}

export async function* streamMockChatResponse({ request, signal, delayMs = configuredDelayMs() }) {
  const text = responseFor({ mode: request.mode, prompt: request.prompt })
  for (const chunk of chunkText(text)) {
    if (signal?.aborted) return
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
    yield {
      type: 'content.delta',
      text: chunk,
      safety: { classified: true, allowed: true, source: 'mock_fixture' },
    }
  }
}
