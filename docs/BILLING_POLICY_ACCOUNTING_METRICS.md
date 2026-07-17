# Billing Policy And Accounting Metrics

BILL-02 adds an administrative policy inventory, deterministic point-policy impact preview, and business metrics over the existing personal-account accounting sources. It does not add payment, withdrawal, invoice, bank, KYC, real-money refund, Provider billing mutation, or shared-account concepts.

## Policy Inventory And Preview

`SystemSetting` remains the source of truth for the mutable point-adjustment policy. Each update or rollback increments its published version, and the existing immutable audit history remains available. `CreativeAccountingPolicyV1` remains immutable and is returned with its active version history.

The point-policy preview normalizes a candidate, compares it with the current point policy, and reports role-limit, reason-code, and approval-template impact. Preview is read-only: it does not publish the point policy or mutate creative pricing. The response states that all units are internal, non-withdrawable, and not convertible to Provider currency.

## Business Metrics

Metrics are derived from `InternalAccountingOperation`, `InternalAccountingMovement`, and `AccountingReconciliationIssue`:

- Point consumption is positive escrow movement from `task_escrow_reserve`.
- Creative credit consumption is positive movement into `consumed`.
- Quota consumption is positive movement into `used`.
- Refunds and releases use `task_escrow_release`, `credit_refund`, and `quota_release`.
- Adjustments use `compensation`, `manual_adjustment`, and `point_adjustment`.
- Anomalies are grouped from durable reconciliation issues.

Optional `dateFrom`, `dateTo`, `unit`, and `sourceType` filters apply to operations and issues. An explicit date range may not exceed 366 days. Aggregate responses never expose actor handles, account references, payload hashes, Provider job identifiers, or raw Provider payloads.

## API And Evidence

All four routes require `admin:accounting:read` and emit bounded audit records:

- `GET /api/admin/accounting/policies`
- `POST /api/admin/accounting/policies/point-adjustment/preview`
- `GET /api/admin/accounting/business-metrics`
- `GET /api/admin/accounting/business-metrics/export`

The export returns `kind=accounting.business-metrics.snapshot`. The Admin Accounting panel displays policy versions, the internal economic boundary, preview impact, bounded filters, consumption/refund summaries, failed operations, anomalies, and a JSON evidence export.

## Verification

Run `npm run test:billing-policy-accounting-metrics`, the PostgreSQL integration gate with `FOUNDATION_DATABASE_URL`, focused Playwright, and the full `CI=1 npm run check:pr` gate. BILL-02 does not make or claim a real Provider call; Provider staging remains a separate fail-closed authorization and environment checkpoint.
