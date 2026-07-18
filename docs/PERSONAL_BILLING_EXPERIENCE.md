# Personal Billing Experience

## Scope

BILL-01 provides one personal-account view over existing internal points, creative credits, quota windows, refunds, and source details. It does not add money, payments, withdrawals, invoices, Provider currency conversion, or a second balance authority.

## User Experience

`GET /api/billing/summary` returns available, frozen, pending, earned, and spent points; reserved, settled, and refunded creative credits; and active quota scope limits, reservations, usage, releases, and remaining units. `GET /api/billing/ledger` provides bounded actor-scoped source details with unit, status, source, search, date, sort, and cursor filters. `/export` emits the same safe facts as CSV or versioned JSON.

The Points page presents these facts together with product entitlement limits. Provider cost and secret evidence are never projected to the user.

## Admin Operations

Admins with `admin:accounting:read` can inspect and export the same projection for a selected handle. Existing governed operations remain authoritative: point adjustments and policy rollback, entitlement plan/grant lifecycle, reconciliation scans, and independently reviewed compensation. BILL-01 adds no direct ledger mutation or historical rewrite.

## Evidence

Run `npm run test:personal-billing-experience` for the machine contract and route behavior. Run `FOUNDATION_DATABASE_URL=... npm run test:personal-billing-experience:integration` for the PostgreSQL projection over point, credit, quota, refund, and source facts.
