# Product Entitlements

ENT-01 introduces a versioned product-access model for personal accounts. It does not add shared accounts, payment plans, subscriptions, withdrawal, invoices, bank data, KYC, real-money refunds, or conversion between internal units and Provider currency.

## Model

`EntitlementPlan` owns the mutable lifecycle identity and CAS version. `EntitlementPlanVersion` is an immutable capability and quota snapshot with an effective window, reason code, actor reference, and canonical content hash. A plan may be `draft`, `active`, or `retired`; activation selects a version owned by that plan.

`PersonalEntitlementGrant` assigns the active version of an active plan to one user. A grant may be `scheduled`, `active`, `revoked`, or `expired`, carries a validity window and CAS version, and appends an immutable `EntitlementGrantEvent` for every state change. PostgreSQL partial unique indexes permit at most one active and one scheduled grant per user. Database triggers reject updates and deletes of plan versions and grant events; controlled retention maintenance requires an explicit transaction-local `app.entitlement_maintenance=on` setting.

## Runtime Decision

The effective projection validates grant, plan, version, and time-window state. An effective grant supplies its capability and quota maps. When no effective grant exists, the runtime returns a role-compatible personal fallback so existing users retain current creative access.

Creative generation and accounting preview both evaluate `creative.<workspace>.<mode>` and `creative.daily.<workspace>`. A disabled capability fails before quota reservation or Provider dispatch. An entitled quota limit and plan policy version are passed into the quota reservation. The decision always states that the boundary is personal-account only, does not require payment, and is not withdrawable.

## API And UI

Users can read and evaluate only their own effective entitlement. Admin read, manage, and transition permissions are isolated. Admin APIs provide bounded plan and grant filters, immutable version append, CAS transitions, expiry sweep, safe snapshot export, and actor-selected evaluation. Every Admin mutation is centrally classified and domain audited.

The Points page displays the current plan, decision source, enabled capability count, and quota limits. The Finance Admin panel provides plan/version management, grant lifecycle operations, status filters, export, expiry sweep, and evaluation without exposing email, access tokens, raw Provider payloads, or credentials.

## Verification

Run `npm run test:product-entitlements`, then the PostgreSQL integration gate `npm run test:product-entitlements:integration` with `FOUNDATION_DATABASE_URL`, focused Playwright, and the full `CI=1 npm run check:pr` gate. ENT-01 does not make or claim a real Provider call; Provider staging remains separately fail-closed until bounded authorization, credentials, environment, callback registration, and legal evidence exist.
