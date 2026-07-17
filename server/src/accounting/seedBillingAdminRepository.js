const timestamp = (value) => {
  const parsed = Date.parse(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : null
}

const groupCount = (rows, keyOf) => Object.entries(rows.reduce((groups, row) => {
  const key = keyOf(row)
  groups[key] = (groups[key] ?? 0) + 1
  return groups
}, {})).map(([key, count]) => ({ key, count })).sort((left, right) => right.count - left.count || left.key.localeCompare(right.key))

export const createSeedBillingAdminRepository = ({ operationsByKey, movementsByOperationKey, issuesByKey, getPointPolicyState }) => ({
  metrics: (options = {}) => {
    const from = timestamp(options.dateFrom)
    const to = timestamp(options.dateTo)
    const operations = [...operationsByKey.entries()].filter(([, operation]) => {
      const createdAt = timestamp(operation.createdAt)
      return (!options.unit || operation.unit === options.unit)
        && (!options.sourceType || operation.sourceType === options.sourceType)
        && (from == null || (createdAt != null && createdAt >= from))
        && (to == null || (createdAt != null && createdAt <= to))
    })
    const movementRows = operations.flatMap(([key, operation]) => (movementsByOperationKey.get(key) ?? []).map((movement) => ({ operation, movement })))
    const sum = (predicate) => movementRows.filter(predicate).reduce((total, { movement }) => total + Number(movement.amount ?? 0), 0)
    const operationRows = operations.map(([, operation]) => operation)
    const issues = [...issuesByKey.values()].filter((issue) => {
      const createdAt = timestamp(issue.createdAt)
      return (!options.unit || issue.unit === options.unit)
        && (!options.sourceType || issue.sourceType === options.sourceType)
        && (from == null || (createdAt != null && createdAt >= from))
        && (to == null || (createdAt != null && createdAt <= to))
    })
    const adjustmentKinds = new Set(['compensation', 'manual_adjustment', 'point_adjustment'])
    const refundKinds = new Set(['task_escrow_release', 'credit_refund', 'quota_release'])
    const positiveAdjustments = sum(({ operation, movement }) => adjustmentKinds.has(operation.kind) && movement.accountType === 'available' && movement.amount > 0)
    const negativeAdjustments = -sum(({ operation, movement }) => adjustmentKinds.has(operation.kind) && movement.accountType === 'available' && movement.amount < 0)
    const byUnit = Object.values(issues.reduce((groups, issue) => {
      const current = groups[issue.unit] ?? { key: issue.unit, count: 0, absoluteDifference: 0 }
      current.count += 1
      current.absoluteDifference += Math.abs(Number(issue.differenceAmount ?? 0))
      groups[issue.unit] = current
      return groups
    }, {})).sort((left, right) => right.count - left.count || left.key.localeCompare(right.key))
    return {
      schemaVersion: 1,
      window: { dateFrom: options.dateFrom ?? null, dateTo: options.dateTo ?? null, unit: options.unit ?? null, sourceType: options.sourceType ?? null, generatedAt: new Date().toISOString() },
      operations: { total: operationRows.length, applied: operationRows.filter((row) => row.status === 'applied').length, pending: operationRows.filter((row) => row.status === 'pending').length, compensated: operationRows.filter((row) => row.status === 'compensated').length, failed: operationRows.filter((row) => row.status === 'failed').length, byKind: groupCount(operationRows, (row) => row.kind) },
      consumption: {
        points: sum(({ operation, movement }) => operation.kind === 'task_escrow_reserve' && movement.accountType === 'escrow' && movement.amount > 0),
        creativeCredits: sum(({ movement }) => movement.accountType === 'consumed' && movement.amount > 0),
        quotaUnits: sum(({ movement }) => movement.accountType === 'used' && movement.amount > 0),
      },
      refunds: {
        points: sum(({ operation, movement }) => operation.kind === 'task_escrow_release' && movement.accountType === 'available' && movement.amount > 0),
        creativeCredits: sum(({ operation, movement }) => operation.kind === 'credit_refund' && movement.accountType === 'available' && movement.amount > 0),
        quotaUnits: sum(({ operation, movement }) => operation.kind === 'quota_release' && movement.accountType === 'remaining' && movement.amount > 0),
        operations: operationRows.filter((row) => refundKinds.has(row.kind)).length,
      },
      adjustments: { positivePoints: positiveAdjustments, negativePoints: negativeAdjustments, netPoints: positiveAdjustments - negativeAdjustments, operations: operationRows.filter((row) => adjustmentKinds.has(row.kind)).length },
      anomalies: { total: issues.length, open: issues.filter((row) => row.status === 'open').length, repairPending: issues.filter((row) => row.status === 'repair_pending').length, resolved: issues.filter((row) => row.status === 'resolved').length, ignored: issues.filter((row) => row.status === 'ignored').length, byUnit },
    }
  },
  pointPolicyState: getPointPolicyState,
})
