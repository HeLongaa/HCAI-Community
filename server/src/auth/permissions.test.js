import assert from 'node:assert/strict'
import test from 'node:test'

import { getPermissionsForRole, getProtectedRolePermissions, hasPermission, mergePermissions, permissionById, permissionRegistry, permissions } from './permissions.js'

test('getPermissionsForRole returns the product role defaults', () => {
  assert.deepEqual(getPermissionsForRole('member'), ['task:create', 'task:cancel', 'post:create', 'comment:create', 'points:read', 'entitlements:read'])
  assert.ok(getPermissionsForRole('creator').includes('task:claim'))
  assert.ok(getPermissionsForRole('publisher').includes('task:review'))
  assert.ok(getPermissionsForRole('moderator').includes('admin:queue:review'))
  assert.equal(getPermissionsForRole('moderator').includes('admin:permissions:manage'), false)
  assert.equal(getPermissionsForRole('moderator').includes('security:alerts:manage'), false)
  assert.ok(getPermissionsForRole('admin').includes('admin:permissions:manage'))
  assert.ok(getPermissionsForRole('admin').includes('security:alerts:manage'))
  assert.deepEqual(getPermissionsForRole('admin'), permissions)
})

test('permission helpers isolate unknown roles and unsupported permission ids', () => {
  assert.deepEqual(getPermissionsForRole('unknown'), [])
  assert.deepEqual(mergePermissions(['task:create'], ['unsupported:permission']), ['task:create'])
  assert.equal(hasPermission({ permissions: ['admin:access'] }, 'admin:access'), true)
  assert.equal(hasPermission({ permissions: [] }, 'admin:access'), false)
  assert.equal(hasPermission(null, 'admin:access'), false)
  assert.equal(hasPermission({ permissions: ['unsupported:permission'] }, 'unsupported:permission'), false)
})

test('structured registry separates RBAC from resource authorization', () => {
  assert.equal(permissionRegistry.length, permissions.length)
  assert.equal(permissionById['task:submit'].resourceAuthorization, true)
  assert.equal(permissionById['admin:audit:read'].resourceAuthorization, false)
  assert.equal(permissionById['admin:permissions:manage'].riskLevel, 'critical')
  assert.deepEqual(getProtectedRolePermissions('admin'), [
    'admin:permissions:manage',
    'admin:accounting:repair',
    'admin:auth:manage',
    'admin:high-risk:approve',
    'admin:temporary-access:manage',
    'admin:break-glass',
    'admin:releases:manage',
    'admin:releases:approve',
    'admin:releases:deploy',
    'admin:audit:archive',
    'admin:settings:manage',
    'admin:settings:approve',
    'admin:settings:publish',
    'admin:feature-flags:manage',
    'admin:feature-flags:publish',
    'admin:feature-flags:emergency',
    'admin:reference-data:manage',
    'admin:reference-data:publish',
    'admin:announcements:manage',
    'admin:announcements:publish',
    'admin:model-control:manage',
    'admin:model-control:transition',
    'admin:model-evaluations:manage',
    'admin:model-evaluations:execute',
    'admin:provider-legal:manage',
    'admin:audit:retention',
    'admin:task-rules:manage',
    'admin:task-rules:publish',
    'admin:entitlements:manage',
    'admin:entitlements:transition',
    'admin:users:manage',
  ])
})
