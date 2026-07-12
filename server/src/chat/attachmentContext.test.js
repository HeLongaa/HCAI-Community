import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveChatAttachments } from './attachmentContext.js'

const actor = { id: 'owner-1', handle: 'owner' }
const asset = (overrides = {}) => ({
  id: 'asset-1',
  fileName: 'brief.md',
  contentType: 'text/markdown',
  sizeBytes: 1024,
  purpose: 'library_asset',
  status: 'uploaded',
  metadata: { security: { scanStatus: 'clean' } },
  ...overrides,
})

test('Chat attachments require owner access and frozen media controls', async () => {
  const resolved = await resolveChatAttachments(['asset-1'], actor, {
    findOwnedChatInput: async () => asset(),
  })
  assert.deepEqual(resolved[0], {
    id: 'asset-1',
    fileName: 'brief.md',
    contentType: 'text/markdown',
    sizeBytes: 1024,
    purpose: 'library_asset',
    scanStatus: 'clean',
  })
  await assert.rejects(
    resolveChatAttachments(['asset-1'], actor, { findOwnedChatInput: async () => null }),
    (error) => error.code === 'CHAT_ATTACHMENT_UNAVAILABLE' && error.details.reasonCode === 'not_found_or_forbidden',
  )
  await assert.rejects(
    resolveChatAttachments(['asset-1'], actor, { findOwnedChatInput: async () => asset({ metadata: { security: { scanStatus: 'review' } } }) }),
    (error) => error.details.reasonCode === 'asset_not_clean',
  )
  await assert.rejects(
    resolveChatAttachments(['asset-1'], actor, { findOwnedChatInput: async () => asset({ sizeBytes: 20 * 1024 * 1024 + 1 }) }),
    (error) => error.details.reasonCode === 'asset_too_large',
  )
})

test('Chat attachments enforce the frozen total byte limit', async () => {
  await assert.rejects(
    resolveChatAttachments(['a', 'b', 'c'], actor, {
      findOwnedChatInput: async (id) => asset({ id, sizeBytes: 15 * 1024 * 1024 }),
    }),
    (error) => error.details.reasonCode === 'total_size_exceeded' && error.details.index === 2,
  )
})
