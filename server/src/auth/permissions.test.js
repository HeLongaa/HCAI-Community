import assert from 'node:assert/strict'
import test from 'node:test'

import { getPermissionsForRole, getProtectedRolePermissions, hasPermission, mergePermissions, permissionById, permissionRegistry, permissions } from './permissions.js'

test('getPermissionsForRole returns the product role defaults', () => {
  assert.deepEqual(getPermissionsForRole('member'), ['task:create', 'post:create', 'comment:create', 'points:read'])
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
    'admin:high-risk:approve',
    'admin:temporary-access:manage',
    'admin:break-glass',
    'admin:releases:manage',
    'admin:releases:approve',
    'admin:releases:deploy',
    'admin:audit:archive',
  ])
})
