# User Lifecycle Operations

USER-03 extends the personal-account User Admin workbench with aggregate lifecycle metrics and bounded operator tags. It reuses the USER-02 permissions and account concurrency boundary; it does not add role mutation, tenant concepts, hard deletion, or raw user identity dimensions to metrics.

## Metrics

`GET /api/admin/users/metrics` accepts an ISO-8601 `dateFrom` and `dateTo` window of at most 366 days. The default is the trailing 30 days. Current account, role, status, and tag counts come from normalized `User`, `UserTag`, and active `UserTagAssignment` rows. Active users are distinct current accounts with a non-revoked, non-compromised `AuthSession.lastSeenAt` inside the requested window.

D1, D7, and D30 retention use accounts created inside the requested window. An account is eligible after the requested number of full days has elapsed before `dateTo`; it is retained when a persisted logical session has `lastSeenAt` at or after that account-relative day and before `dateTo`. The response exposes only cohort counts and percentages. Email, handle, display name, user id, network hash, session id, and Provider identity are forbidden metric dimensions.

`GET /api/admin/users/metrics/export` returns the same snapshot in a versioned JSON artifact. Reads and exports are audited as aggregate access.

## Tags

`UserTag.key` is an immutable machine identifier. Label, description, and color are mutable with optimistic version checks. Archive and restore are explicit lifecycle transitions; archived definitions remain stored and existing assignment evidence is not deleted.

Assignments use the user's `accountVersion` for compare-and-swap protection. Assign and remove require a stable reason code and write a domain audit event in the same logical operation. Removing a tag records actor, reason, timestamp, and assignment version instead of deleting the row. Reassignment reactivates the same bounded relation and increments its version. Deleted users cannot receive new tag assignments.

## Operations

1. Create a stable tag definition before assigning it.
2. Use the user detail version returned by the API for assign/remove operations.
3. Refresh the user after a `USER_TAG_VERSION_CONFLICT`.
4. Archive unused definitions; restore them before assigning again.
5. Never encode secrets, free-form case notes, protected traits, or raw incident evidence in tag keys or labels.

## Verification

- `npm run test:user-lifecycle-operations`
- `npm run test:user-lifecycle-operations:integration` with `FOUNDATION_DATABASE_URL`
- `npx playwright test e2e/user-lifecycle-operations.spec.ts`
- `CI=1 npm run check:pr`
