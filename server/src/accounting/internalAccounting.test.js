import assert from 'node:assert/strict'
import test from 'node:test'

import {
  accountingOperationKey,
  accountingPayloadHash,
  accountingUnitIsInternal,
  reconcilePointLedgerRows,
  validateMovementGroup,
} from './internalAccounting.js'

test('accounting operation identity and payload hashes are stable', () => {
  assert.equal(accountingOperationKey({
    kind: 'Task_Escrow_Reserve',
    sourceType: 'Task',
    sourceId: 'TASK-1',
  }), 'task_escrow_reserve:task:task-1:apply')
  assert.equal(accountingPayloadHash({ b: 2, a: 1 }), accountingPayloadHash({ a: 1, b: 2 }))
  assert.notEqual(accountingPayloadHash({ a: 1 }), accountingPayloadHash({ a: 2 }))
})

test('movement groups balance inside one unit and reject mixed units', () => {
  assert.deepEqual(validateMovementGroup({
    unit: 'points',
    movements: [
      { unit: 'points', amount: -500 },
      { unit: 'points', amount: 500 },
    ],
  }), { valid: true, code: null, total: 0 })
  assert.equal(validateMovementGroup({
    unit: 'points',
    movements: [
      { unit: 'points', amount: -1 },
      { unit: 'creative_credit', amount: 1 },
    ],
  }).code, 'ACCOUNTING_UNIT_MIXED')
  assert.equal(validateMovementGroup({
    unit: 'quota_unit',
    movements: [
      { unit: 'quota_unit', amount: -2 },
      { unit: 'quota_unit', amount: 1 },
    ],
  }).code, 'ACCOUNTING_MOVEMENTS_UNBALANCED')
  assert.equal(accountingUnitIsInternal('provider_currency'), false)
})

test('point reconciliation reports every balance snapshot drift', () => {
  const report = reconcilePointLedgerRows([
    { id: 'ledger-2', delta: -30, balanceAfter: 80, createdAt: '2026-01-02T00:00:00.000Z' },
    { id: 'ledger-1', delta: 100, balanceAfter: 100, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'ledger-3', delta: 10, balanceAfter: 80, createdAt: '2026-01-03T00:00:00.000Z' },
  ])
  assert.equal(report.expectedBalance, 80)
  assert.equal(report.actualBalance, 80)
  assert.deepEqual(report.issues, [{
    type: 'point_balance_drift',
    ledgerId: 'ledger-2',
    expectedBalance: 70,
    actualBalance: 80,
    difference: 10,
  }])
})

test('point reconciliation orders Prisma Date values chronologically', () => {
  const report = reconcilePointLedgerRows([
    { id: 'later', delta: 2, balanceAfter: 3, createdAt: new Date('2026-02-01T00:00:00.000Z') },
    { id: 'earlier', delta: 1, balanceAfter: 1, createdAt: new Date('2026-01-15T00:00:00.000Z') },
  ])

  assert.deepEqual(report.issues, [])
  assert.equal(report.expectedBalance, 3)
  assert.equal(report.actualBalance, 3)
})
