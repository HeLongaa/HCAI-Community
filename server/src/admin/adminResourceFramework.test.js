import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildAdminResourceDescriptor,
  buildAdminResourceRegistry,
  capabilitiesForOperationPolicy,
} from './adminResourceFramework.js'

test('operation policies derive safe admin capabilities', () => {
  assert.deepEqual(capabilitiesForOperationPolicy('append_only'), {
    allowed: ['list', 'detail', 'export', 'registeredRecovery'],
    forbidden: ['create', 'update', 'delete', 'bulkMutate'],
  })
  assert.deepEqual(capabilitiesForOperationPolicy('immutable_evidence'), {
    allowed: ['list', 'detail', 'export'],
    forbidden: ['create', 'update', 'delete', 'bulkMutate'],
  })
  assert.deepEqual(capabilitiesForOperationPolicy('state_transition'), {
    allowed: ['list', 'detail', 'transition', 'retry', 'cancel', 'export'],
    forbidden: ['arbitraryUpdate', 'hardDelete'],
  })
  assert.ok(capabilitiesForOperationPolicy('mutable_crud', { hardDelete: true }).allowed.includes('hardDelete'))
})

test('admin resource descriptors include policy, routes, and bounded capabilities', () => {
  const descriptor = buildAdminResourceDescriptor(
    {
      id: 'auditEvents',
      model: 'AuditEvent',
      listRoute: 'GET /api/admin/audit',
      detailRoute: 'GET /api/admin/audit/:id',
      exportRoute: 'GET /api/admin/audit/export',
    },
    { model: 'AuditEvent', domain: 'audit-evidence', policy: 'append_only', hardDelete: false },
  )

  assert.equal(descriptor.operationPolicy, 'append_only')
  assert.equal(descriptor.routes.list, 'GET /api/admin/audit')
  assert.equal(descriptor.routes.detail, 'GET /api/admin/audit/:id')
  assert.equal(descriptor.routes.export, 'GET /api/admin/audit/export')
  assert.ok(descriptor.capabilities.forbidden.includes('update'))
})

test('admin resource registry fails closed when a resource lacks a data policy', () => {
  assert.throws(
    () => buildAdminResourceRegistry({
      resources: [{ id: 'missing', model: 'MissingModel', listRoute: 'GET /api/admin/missing' }],
      policies: [],
    }),
    /ADMIN_RESOURCE_POLICY_MISSING:MissingModel/,
  )
})

