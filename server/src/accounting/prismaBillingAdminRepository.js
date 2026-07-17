import prismaClientPkg from '@prisma/client'

const { Prisma } = prismaClientPkg
const number = (value) => Number(value ?? 0)
const grouped = (rows) => rows.map((row) => ({ key: String(row.key), count: number(row.count) }))

export const createPrismaBillingAdminRepository = (client) => ({
  metrics: async (options = {}) => {
    const operationConditions = [Prisma.sql`TRUE`]
    if (options.dateFrom) operationConditions.push(Prisma.sql`o."created_at" >= ${new Date(options.dateFrom)}`)
    if (options.dateTo) operationConditions.push(Prisma.sql`o."created_at" <= ${new Date(options.dateTo)}`)
    if (options.unit) operationConditions.push(Prisma.sql`o."unit"::text = ${options.unit}`)
    if (options.sourceType) operationConditions.push(Prisma.sql`o."source_type" = ${options.sourceType}`)
    const operationWhere = Prisma.join(operationConditions, ' AND ')
    const issueConditions = [Prisma.sql`TRUE`]
    if (options.dateFrom) issueConditions.push(Prisma.sql`i."created_at" >= ${new Date(options.dateFrom)}`)
    if (options.dateTo) issueConditions.push(Prisma.sql`i."created_at" <= ${new Date(options.dateTo)}`)
    if (options.unit) issueConditions.push(Prisma.sql`i."unit"::text = ${options.unit}`)
    if (options.sourceType) issueConditions.push(Prisma.sql`i."source_type" = ${options.sourceType}`)
    const issueWhere = Prisma.join(issueConditions, ' AND ')
    const [operationRows, kindRows, movementRows, issueRows, issueUnitRows] = await Promise.all([
      client.$queryRaw(Prisma.sql`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE o."status" = 'applied')::int AS applied, COUNT(*) FILTER (WHERE o."status" = 'pending')::int AS pending, COUNT(*) FILTER (WHERE o."status" = 'compensated')::int AS compensated, COUNT(*) FILTER (WHERE o."status" = 'failed')::int AS failed FROM "internal_accounting_operations" o WHERE ${operationWhere}`),
      client.$queryRaw(Prisma.sql`SELECT o."kind" AS key, COUNT(*)::int AS count FROM "internal_accounting_operations" o WHERE ${operationWhere} GROUP BY o."kind" ORDER BY count DESC, key ASC`),
      client.$queryRaw(Prisma.sql`
        SELECT
          COALESCE(SUM(m."amount") FILTER (WHERE o."kind" = 'task_escrow_reserve' AND m."account_type" = 'escrow' AND m."amount" > 0), 0)::bigint AS points_consumed,
          COALESCE(SUM(m."amount") FILTER (WHERE m."account_type" = 'consumed' AND m."amount" > 0), 0)::bigint AS credits_consumed,
          COALESCE(SUM(m."amount") FILTER (WHERE m."account_type" = 'used' AND m."amount" > 0), 0)::bigint AS quota_consumed,
          COALESCE(SUM(m."amount") FILTER (WHERE o."kind" = 'task_escrow_release' AND m."account_type" = 'available' AND m."amount" > 0), 0)::bigint AS points_refunded,
          COALESCE(SUM(m."amount") FILTER (WHERE o."kind" = 'credit_refund' AND m."account_type" = 'available' AND m."amount" > 0), 0)::bigint AS credits_refunded,
          COALESCE(SUM(m."amount") FILTER (WHERE o."kind" = 'quota_release' AND m."account_type" = 'remaining' AND m."amount" > 0), 0)::bigint AS quota_released,
          COUNT(DISTINCT o."id") FILTER (WHERE o."kind" IN ('task_escrow_release', 'credit_refund', 'quota_release'))::int AS refund_operations,
          COUNT(DISTINCT o."id") FILTER (WHERE o."kind" IN ('compensation', 'manual_adjustment', 'point_adjustment'))::int AS adjustment_operations,
          COALESCE(SUM(m."amount") FILTER (WHERE o."kind" IN ('compensation', 'manual_adjustment', 'point_adjustment') AND m."account_type" = 'available' AND m."amount" > 0), 0)::bigint AS positive_adjustments,
          COALESCE(-SUM(m."amount") FILTER (WHERE o."kind" IN ('compensation', 'manual_adjustment', 'point_adjustment') AND m."account_type" = 'available' AND m."amount" < 0), 0)::bigint AS negative_adjustments
        FROM "internal_accounting_operations" o JOIN "internal_accounting_movements" m ON m."operation_id" = o."id" WHERE ${operationWhere}`),
      client.$queryRaw(Prisma.sql`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE i."status" = 'open')::int AS open, COUNT(*) FILTER (WHERE i."status" = 'repair_pending')::int AS repair_pending, COUNT(*) FILTER (WHERE i."status" = 'resolved')::int AS resolved, COUNT(*) FILTER (WHERE i."status" = 'ignored')::int AS ignored FROM "accounting_reconciliation_issues" i WHERE ${issueWhere}`),
      client.$queryRaw(Prisma.sql`SELECT i."unit"::text AS key, COUNT(*)::int AS count, COALESCE(SUM(ABS(i."difference_amount")), 0)::bigint AS absolute_difference FROM "accounting_reconciliation_issues" i WHERE ${issueWhere} GROUP BY i."unit" ORDER BY count DESC, key ASC`),
    ])
    const operations = operationRows[0] ?? {}
    const movements = movementRows[0] ?? {}
    const anomalies = issueRows[0] ?? {}
    return {
      schemaVersion: 1,
      window: { dateFrom: options.dateFrom ?? null, dateTo: options.dateTo ?? null, unit: options.unit ?? null, sourceType: options.sourceType ?? null, generatedAt: new Date().toISOString() },
      operations: { total: number(operations.total), applied: number(operations.applied), pending: number(operations.pending), compensated: number(operations.compensated), failed: number(operations.failed), byKind: grouped(kindRows) },
      consumption: { points: number(movements.points_consumed), creativeCredits: number(movements.credits_consumed), quotaUnits: number(movements.quota_consumed) },
      refunds: { points: number(movements.points_refunded), creativeCredits: number(movements.credits_refunded), quotaUnits: number(movements.quota_released), operations: number(movements.refund_operations) },
      adjustments: { positivePoints: number(movements.positive_adjustments), negativePoints: number(movements.negative_adjustments), netPoints: number(movements.positive_adjustments) - number(movements.negative_adjustments), operations: number(movements.adjustment_operations) },
      anomalies: { total: number(anomalies.total), open: number(anomalies.open), repairPending: number(anomalies.repair_pending), resolved: number(anomalies.resolved), ignored: number(anomalies.ignored), byUnit: issueUnitRows.map((row) => ({ key: String(row.key), count: number(row.count), absoluteDifference: number(row.absolute_difference) })) },
    }
  },
  pointPolicyState: async (fallbackPolicy) => {
    const row = await client.systemSetting.findUnique({ where: { key: 'point_adjustment_policy' } })
    return { version: row?.publishedVersion ?? 0, updatedAt: row?.updatedAt?.toISOString?.() ?? null, policy: row?.value ?? fallbackPolicy }
  },
})
