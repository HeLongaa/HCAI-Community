import { createHash } from 'node:crypto'

const allowedUnits = new Set(['points', 'creative_credit', 'quota_unit', 'provider_currency'])

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
}

export const accountingPayloadHash = (value) => createHash('sha256')
  .update(JSON.stringify(canonicalize(value ?? {})))
  .digest('hex')

export const accountingOperationKey = ({ kind, sourceType, sourceId, phase = 'apply' }) =>
  [kind, sourceType, sourceId, phase]
    .map((value) => String(value ?? '').trim().toLowerCase())
    .join(':')

export const validateMovementGroup = ({ unit, movements }) => {
  if (!allowedUnits.has(unit)) {
    return { valid: false, code: 'ACCOUNTING_UNIT_INVALID', total: 0 }
  }
  if (!Array.isArray(movements) || movements.length < 2) {
    return { valid: false, code: 'ACCOUNTING_MOVEMENTS_INCOMPLETE', total: 0 }
  }
  if (movements.some((movement) => movement.unit !== unit)) {
    return { valid: false, code: 'ACCOUNTING_UNIT_MIXED', total: 0 }
  }
  if (movements.some((movement) => !Number.isSafeInteger(movement.amount) || movement.amount === 0)) {
    return { valid: false, code: 'ACCOUNTING_AMOUNT_INVALID', total: 0 }
  }
  const total = movements.reduce((sum, movement) => sum + movement.amount, 0)
  return total === 0
    ? { valid: true, code: null, total }
    : { valid: false, code: 'ACCOUNTING_MOVEMENTS_UNBALANCED', total }
}

export const reconcilePointLedgerRows = (rows = []) => {
  const ordered = [...rows].sort((left, right) => {
    const leftTime = new Date(left.createdAt ?? 0).getTime()
    const rightTime = new Date(right.createdAt ?? 0).getTime()
    const time = (Number.isFinite(leftTime) ? leftTime : 0) - (Number.isFinite(rightTime) ? rightTime : 0)
    return time || String(left.id ?? '').localeCompare(String(right.id ?? ''))
  })
  const issues = []
  let expected = 0
  for (const row of ordered) {
    expected += Number(row.delta) || 0
    if (Number(row.balanceAfter) !== expected) {
      issues.push({
        type: 'point_balance_drift',
        ledgerId: String(row.id),
        expectedBalance: expected,
        actualBalance: Number(row.balanceAfter) || 0,
        difference: (Number(row.balanceAfter) || 0) - expected,
      })
    }
  }
  return {
    expectedBalance: expected,
    actualBalance: ordered.length > 0 ? Number(ordered.at(-1).balanceAfter) || 0 : 0,
    issues,
  }
}

export const accountingUnitIsInternal = (unit) => ['points', 'creative_credit', 'quota_unit'].includes(unit)
