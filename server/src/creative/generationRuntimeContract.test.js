import test from 'node:test'

test('AI generation runtime contract remains wired to schema and routes', async () => {
  await import('../../../scripts/verify-ai-generation-runtime.mjs')
})
