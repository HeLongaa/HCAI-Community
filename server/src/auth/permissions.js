const definePermission = (id, module, resource, action, riskLevel, defaultRoles, options = {}) => Object.freeze({
  id,
  module,
  resource,
  action,
  riskLevel,
  defaultRoles: Object.freeze([...defaultRoles]),
  protected: Boolean(options.protected),
  protectionRank: Number(options.protectionRank ?? 0),
  resourceAuthorization: Boolean(options.resourceAuthorization),
  description: options.description ?? null,
})

const everyone = ['member', 'creator', 'publisher', 'moderator', 'admin']
const creators = ['creator', 'admin']
const publishers = ['publisher', 'admin']
const moderators = ['moderator', 'admin']
const admins = ['admin']

export const permissionRegistry = Object.freeze([
  definePermission('task:create', 'task-marketplace', 'task', 'create', 'medium', ['member', 'publisher', 'admin'], { resourceAuthorization: true, description: 'Create a task owned by the actor' }),
  definePermission('task:propose', 'task-marketplace', 'task_proposal', 'create', 'medium', creators, { resourceAuthorization: true, description: 'Propose work on an eligible task' }),
  definePermission('task:claim', 'task-marketplace', 'task', 'claim', 'medium', creators, { resourceAuthorization: true, description: 'Claim an eligible task' }),
  definePermission('task:submit', 'task-marketplace', 'task_submission', 'create', 'high', creators, { resourceAuthorization: true, description: 'Submit work for an owned assignment' }),
  definePermission('task:review', 'task-marketplace', 'task_submission', 'review', 'high', publishers, { resourceAuthorization: true, description: 'Review submissions for an owned task' }),
  definePermission('task:moderate', 'task-marketplace', 'task', 'moderate', 'high', moderators, { resourceAuthorization: true, description: 'Moderate task lifecycle state' }),
  definePermission('post:create', 'community', 'post', 'create', 'low', everyone, { resourceAuthorization: true, description: 'Create a community post' }),
  definePermission('post:moderate', 'community', 'post', 'moderate', 'high', moderators, { resourceAuthorization: true, description: 'Moderate community content' }),
  definePermission('comment:create', 'community', 'comment', 'create', 'low', everyone, { resourceAuthorization: true, description: 'Create a community comment' }),
  definePermission('points:read', 'entitlements-accounting', 'point_ledger', 'read', 'medium', everyone, { resourceAuthorization: true, description: 'Read the actor point ledger' }),
  definePermission('points:adjust', 'entitlements-accounting', 'point_ledger', 'adjust', 'critical', admins, { resourceAuthorization: true, description: 'Adjust user point balances' }),
  definePermission('admin:access', 'admin-console', 'admin_console', 'access', 'high', moderators, { description: 'Access the administrative console' }),
  definePermission('admin:audit:read', 'audit-evidence', 'audit_event', 'read', 'high', moderators, { description: 'Read sanitized audit evidence' }),
  definePermission('admin:queue:read', 'admin-console', 'admin_review', 'read', 'high', moderators, { description: 'Read administrative review queues' }),
  definePermission('admin:queue:review', 'admin-console', 'admin_review', 'review', 'critical', moderators, { resourceAuthorization: true, description: 'Resolve administrative reviews' }),
  definePermission('admin:accounting:read', 'entitlements-accounting', 'accounting_reconciliation', 'read', 'high', moderators, { description: 'Read internal accounting reconciliation evidence' }),
  definePermission('admin:accounting:scan', 'entitlements-accounting', 'accounting_reconciliation', 'scan', 'critical', admins, { description: 'Run internal accounting reconciliation scans' }),
  definePermission('admin:accounting:repair', 'entitlements-accounting', 'accounting_reconciliation', 'repair', 'critical', admins, { protected: true, protectionRank: 2, resourceAuthorization: true, description: 'Request and approve internal accounting compensation' }),
  definePermission('admin:permissions:manage', 'identity-access', 'role_permission', 'manage', 'critical', admins, { protected: true, protectionRank: 1, resourceAuthorization: true, description: 'Manage role permission assignments' }),
  definePermission('admin:creative:cancel', 'ai-runtime', 'creative_generation', 'cancel', 'high', admins, { resourceAuthorization: true, description: 'Cancel eligible creative generations' }),
  definePermission('admin:creative:retry', 'ai-runtime', 'creative_generation', 'retry', 'critical', admins, { resourceAuthorization: true, description: 'Authorize retries for eligible creative generations' }),
  definePermission('admin:creative:replay', 'ai-runtime', 'creative_generation', 'replay', 'critical', admins, { resourceAuthorization: true, description: 'Request and approve safe manual Provider replay' }),
  definePermission('admin:creative:provider-control:read', 'model-control-plane', 'provider_control', 'read', 'high', admins, { description: 'Read Provider control state and evidence' }),
  definePermission('admin:creative:provider-control:manage', 'model-control-plane', 'provider_control', 'manage', 'critical', admins, { resourceAuthorization: true, description: 'Disable Provider controls and record cap evidence' }),
  definePermission('admin:creative:provider-control:recover', 'model-control-plane', 'provider_control', 'recover', 'critical', admins, { resourceAuthorization: true, description: 'Request and approve Provider recovery' }),
  definePermission('security:alerts:manage', 'trust-safety-risk', 'security_alert', 'manage', 'critical', admins, { resourceAuthorization: true, description: 'Acknowledge and silence security alerts' }),
  definePermission('admin:events:read', 'platform-architecture', 'domain_event', 'read', 'high', admins, { description: 'Read versioned domain event publication evidence' }),
  definePermission('admin:events:replay', 'platform-architecture', 'domain_event', 'replay', 'critical', admins, { resourceAuthorization: true, description: 'Request replay of a published or failed domain event' }),
  definePermission('admin:jobs:read', 'jobs-automation', 'job_run', 'read', 'high', admins, { description: 'Read job definitions, runs, attempts, and safe results' }),
  definePermission('admin:jobs:manage', 'jobs-automation', 'job_run', 'manage', 'critical', admins, { resourceAuthorization: true, description: 'Cancel queued or running job runs' }),
])

export const permissions = Object.freeze(permissionRegistry.map(({ id }) => id))
export const permissionById = Object.freeze(Object.fromEntries(permissionRegistry.map((permission) => [permission.id, permission])))

export const rolePermissions = Object.freeze(Object.fromEntries(
  ['member', 'creator', 'publisher', 'moderator', 'admin'].map((role) => [
    role,
    Object.freeze(permissionRegistry.filter(({ defaultRoles }) => defaultRoles.includes(role)).map(({ id }) => id)),
  ]),
))

export const getPermissionsForRole = (role) => [...(rolePermissions[role] ?? [])]

export const mergePermissions = (...sets) => {
  const merged = new Set()
  for (const set of sets) {
    for (const permission of set ?? []) {
      if (permissionById[permission]) merged.add(permission)
    }
  }
  return [...merged]
}

export const hasPermission = (actor, permission) =>
  Boolean(actor && permissionById[permission] && Array.isArray(actor.permissions) && actor.permissions.includes(permission))

export const protectedRolePermissions = Object.freeze(Object.fromEntries(
  ['member', 'creator', 'publisher', 'moderator', 'admin'].map((role) => [
    role,
    Object.freeze(permissionRegistry.filter((permission) => permission.protected && permission.defaultRoles.includes(role)).sort((a, b) => a.protectionRank - b.protectionRank).map(({ id }) => id)),
  ]),
))

export const getProtectedRolePermissions = (role) => [...(protectedRolePermissions[role] ?? [])]
