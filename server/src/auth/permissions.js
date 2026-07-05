export const permissions = Object.freeze([
  'task:create',
  'task:propose',
  'task:claim',
  'task:submit',
  'task:review',
  'task:moderate',
  'post:create',
  'post:moderate',
  'comment:create',
  'points:read',
  'points:adjust',
  'admin:access',
  'admin:audit:read',
  'admin:queue:read',
  'admin:queue:review',
  'admin:permissions:manage',
  'security:alerts:manage',
])

const rolePermissionMap = {
  member: ['task:create', 'post:create', 'comment:create', 'points:read'],
  creator: ['task:propose', 'task:claim', 'task:submit', 'post:create', 'comment:create', 'points:read'],
  publisher: ['task:create', 'task:review', 'post:create', 'comment:create', 'points:read'],
  moderator: [
    'task:moderate',
    'post:moderate',
    'admin:access',
    'admin:audit:read',
    'admin:queue:read',
    'admin:queue:review',
    'post:create',
    'comment:create',
    'points:read',
  ],
  admin: permissions,
}

export const rolePermissions = Object.freeze(
  Object.fromEntries(
    Object.entries(rolePermissionMap).map(([role, values]) => [role, Object.freeze([...values])]),
  ),
)

export const getPermissionsForRole = (role) => [...(rolePermissions[role] ?? [])]

export const mergePermissions = (...sets) => {
  const merged = new Set()
  for (const set of sets) {
    for (const permission of set ?? []) {
      if (permissions.includes(permission)) {
        merged.add(permission)
      }
    }
  }
  return [...merged]
}

export const hasPermission = (actor, permission) =>
  Boolean(actor && Array.isArray(actor.permissions) && actor.permissions.includes(permission))

export const protectedRolePermissions = Object.freeze({
  admin: Object.freeze(['admin:permissions:manage']),
})

export const getProtectedRolePermissions = (role) => [...(protectedRolePermissions[role] ?? [])]
