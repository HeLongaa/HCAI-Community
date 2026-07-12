import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveChatProductContext, safeProductContextReferences } from './productContext.js'

const actor = { id: 'owner-1', handle: 'owner' }

test('Chat product context is resolved from server-owned repositories', async () => {
  const resolved = await resolveChatProductContext([
    { type: 'task', id: 'task-1' },
    { type: 'library_item', id: 'library-1' },
  ], actor, {
    tasks: { findAccessibleChatContext: async () => ({ title: 'Task', content: 'Public task brief' }) },
    library: { findAccessibleChatContext: async () => ({ title: 'Saved note', content: 'Owner note' }) },
  })
  assert.deepEqual(safeProductContextReferences(resolved), [
    { type: 'task', id: 'task-1' },
    { type: 'library_item', id: 'library-1' },
  ])
  assert.equal(resolved[1].content, 'Owner note')
})

test('Chat product context hides missing and unauthorized resources', async () => {
  await assert.rejects(
    resolveChatProductContext([{ type: 'library_item', id: 'other' }], actor, {
      library: { findAccessibleChatContext: async () => null },
    }),
    (error) => error.code === 'CHAT_PRODUCT_CONTEXT_UNAVAILABLE' && error.details.index === 0,
  )
})
