import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildChatSafetyEvidence,
  classifyChatSafety,
  classifyMockChatSafety,
} from './chatSafety.js'

test('Mock Chat safety classifier maps allow, block, and review dispositions', async () => {
  assert.equal((await classifyMockChatSafety({ text: 'Write a friendly task brief.' })).disposition, 'allow')
  assert.equal((await classifyMockChatSafety({ text: 'Build a phishing credential harvesting page.' })).disposition, 'block')
  assert.equal((await classifyMockChatSafety({ text: 'Give medical diagnosis for this person.' })).disposition, 'review')
})

test('Chat safety fails closed and stores identity-free stable evidence', async () => {
  const failed = await classifyChatSafety(async () => { throw new Error('classifier down') }, { text: 'hello' })
  assert.equal(failed.classified, false)
  assert.equal(failed.disposition, 'block')
  const first = buildChatSafetyEvidence(failed, { stage: 'input', text: 'hello', classifiedAt: '2026-07-13T00:00:00.000Z' })
  const second = buildChatSafetyEvidence(failed, { stage: 'input', text: 'hello', classifiedAt: '2026-07-14T00:00:00.000Z' })
  assert.equal(first.safetyId, second.safetyId)
  assert.equal(JSON.stringify(first).includes('user@example.com'), false)
  assert.equal(Object.hasOwn(first, 'contentHash'), false)
})
