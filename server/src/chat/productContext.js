import { HttpError } from '../common/errors/httpError.js'

const unavailable = (index) => new HttpError(
  422,
  'CHAT_PRODUCT_CONTEXT_UNAVAILABLE',
  'A selected product context item is unavailable',
  { reasonCode: 'not_found_or_forbidden', index },
)

export const resolveChatProductContext = async (references, actor, repositories) => {
  const resolved = []
  for (const [index, reference] of references.entries()) {
    const item = reference.type === 'task'
      ? await repositories.tasks?.findAccessibleChatContext?.(reference.id, actor)
      : await repositories.library?.findAccessibleChatContext?.(reference.id, actor)
    if (!item) throw unavailable(index)
    resolved.push(Object.freeze({
      type: reference.type,
      id: reference.id,
      title: String(item.title ?? '').slice(0, 200),
      content: String(item.content ?? '').slice(0, 12000),
    }))
  }
  return Object.freeze(resolved)
}

export const safeProductContextReferences = (items) => items.map(({ type, id }) => ({ type, id }))
