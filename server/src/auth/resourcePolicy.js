import { HttpError } from '../common/errors/httpError.js'
import { hasPermission } from './permissions.js'

const policy = (resourceType, ownerFields, options = {}) => Object.freeze({
  resourceType,
  ownerFields: Object.freeze(ownerFields),
  participantFields: Object.freeze(options.participantFields ?? []),
  publicRead: Boolean(options.publicRead),
  elevated: Object.freeze({ read: options.readPermission ?? null, write: options.writePermission ?? null }),
  disclosure: options.disclosure ?? 'not_found',
  redact: Object.freeze(options.redact ?? []),
})

export const resourcePolicyRegistry = Object.freeze([
  policy('user_profile', ['id', 'userId', 'handle'], { publicRead: true, writePermission: 'admin:access', redact: ['email', 'authAccounts', 'refreshTokens', 'passwordHash'] }),
  policy('task', ['publisherId', 'publisherHandle'], { publicRead: true, participantFields: ['assigneeId', 'assigneeHandle'], readPermission: 'task:moderate', writePermission: 'task:moderate' }),
  policy('task_proposal', ['proposerId', 'proposerHandle'], { participantFields: ['publisherId', 'publisherHandle'], readPermission: 'task:moderate', writePermission: 'task:moderate' }),
  policy('task_submission', ['submitterId', 'submitterHandle'], { participantFields: ['publisherId', 'publisherHandle'], readPermission: 'task:moderate', writePermission: 'task:moderate' }),
  policy('post', ['authorId', 'authorHandle'], { publicRead: true, readPermission: 'post:moderate', writePermission: 'post:moderate' }),
  policy('comment', ['authorId', 'authorHandle'], { publicRead: true, readPermission: 'post:moderate', writePermission: 'post:moderate' }),
  policy('library_item', ['userId', 'ownerId', 'ownerHandle'], { readPermission: 'admin:access', writePermission: 'admin:access' }),
  policy('media_asset', ['ownerId', 'ownerHandle'], { readPermission: 'admin:media:read', writePermission: 'admin:media:manage', redact: ['storageKey', 'signedUrl', 'uploadUrl', 'downloadUrl', 'providerPayload'] }),
  policy('creative_generation', ['actorId', 'actorHandle'], { readPermission: 'admin:audit:read', writePermission: 'admin:creative:cancel', redact: ['prompt', 'providerPayload', 'providerRequest', 'outputUrls'] }),
  policy('chat_conversation', ['ownerId', 'ownerHandle'], { redact: ['ciphertext', 'encryptionKeyId', 'encryptionIv', 'authenticationTag', 'prompt'] }),
  policy('chat_turn', ['ownerId', 'ownerHandle'], { redact: ['ciphertext', 'encryptionKeyId', 'encryptionIv', 'authenticationTag', 'prompt'] }),
  policy('notification', ['userId', 'ownerId', 'ownerHandle']),
  policy('support_request', ['userId', 'ownerId', 'ownerHandle'], { readPermission: 'admin:queue:read', writePermission: 'admin:queue:review' }),
  policy('accounting_read_model', ['userId', 'ownerId', 'ownerHandle'], { readPermission: 'admin:accounting:read', disclosure: 'forbidden', redact: ['accountRef', 'actorRef', 'payloadHash'] }),
  policy('admin_resource', [], { readPermission: 'admin:audit:read', writePermission: 'admin:permissions:manage', disclosure: 'forbidden' }),
])

export const resourcePolicyByType = Object.freeze(Object.fromEntries(resourcePolicyRegistry.map((entry) => [entry.resourceType, entry])))

const actorIdentities = (actor) => new Set([actor?.id, actor?.userId, actor?.handle].filter(Boolean).map(String))
const valuesFor = (resource, fields) => fields.flatMap((field) => {
  const value = resource?.[field]
  return Array.isArray(value) ? value : [value]
}).filter(Boolean).map(String)

export const authorizeResource = ({ resourceType, action, actor, resource = {}, allowPublic = true }) => {
  const entry = resourcePolicyByType[resourceType]
  if (!entry || !['read', 'write'].includes(action) || !actor) {
    return { allowed: false, reason: !entry ? 'unknown_resource' : !actor ? 'unauthenticated' : 'unknown_action', disclosure: entry?.disclosure ?? 'not_found' }
  }
  if (action === 'read' && allowPublic && entry.publicRead) return { allowed: true, reason: 'public', disclosure: entry.disclosure }
  const identities = actorIdentities(actor)
  const owner = valuesFor(resource, entry.ownerFields).some((value) => identities.has(value))
  if (owner) return { allowed: true, reason: 'owner', disclosure: entry.disclosure }
  const participant = action === 'read' && valuesFor(resource, entry.participantFields).some((value) => identities.has(value))
  if (participant) return { allowed: true, reason: 'participant', disclosure: entry.disclosure }
  const elevatedPermission = entry.elevated[action]
  if (elevatedPermission && hasPermission(actor, elevatedPermission)) {
    return { allowed: true, reason: 'elevated', permission: elevatedPermission, disclosure: entry.disclosure }
  }
  return { allowed: false, reason: 'not_owner', permission: elevatedPermission, disclosure: entry.disclosure }
}

export const requireResourceAccess = (options) => {
  const decision = authorizeResource(options)
  if (decision.allowed) return decision
  if (decision.disclosure === 'forbidden') throw new HttpError(403, 'PERMISSION_DENIED', 'Resource access denied')
  throw new HttpError(404, 'NOT_FOUND', 'Resource not found')
}

const redactedValue = '[REDACTED]'
export const redactResource = (resourceType, value) => {
  const entry = resourcePolicyByType[resourceType]
  if (!entry || value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map((item) => redactResource(resourceType, item))
  if (typeof value !== 'object') return value
  const redacted = {}
  for (const [key, child] of Object.entries(value)) {
    redacted[key] = entry.redact.includes(key)
      ? redactedValue
      : child && typeof child === 'object' ? redactResource(resourceType, child) : child
  }
  return redacted
}
