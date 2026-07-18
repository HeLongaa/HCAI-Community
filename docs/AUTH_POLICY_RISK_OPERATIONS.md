# Authentication Policy And Risk Operations

AUTH-03 adds durable, privacy-bounded authentication activity evidence and an operator-controlled risk-monitor policy to the logical-session controls delivered by AUTH-02.

## Evidence Boundary

Each interactive login attempt records method, outcome, stable reason code, coarse client label, keyed identity hash, masked identity hint, keyed network hash, and timestamp. It never records passwords, raw identities, raw IP addresses, full user agents, OAuth authorization codes, Provider payloads, access tokens, or refresh tokens. Admin projections shorten the network hash to eight hexadecimal characters.

`AuthLoginAttempt` is append-only. Operators can filter failures by method, reason, identity hash, and bounded date window with descending cursor pagination. Metrics aggregate attempts, successes, failures, success rate, authentication method, failure reason, active logical sessions, and session-risk status without raw identity dimensions.

## Runtime Policy

The singleton `AuthRiskPolicy` controls whether the failed-login anomaly monitor runs, its time window, accounts-per-network threshold, and networks-per-account threshold. Updates require `admin:auth:manage`, a stable reason code, and the current version. A stale version fails with `STATE_CONFLICT`; successful changes are audited in the same transaction.

Before the first Admin policy version exists, runtime behavior remains compatible with the deployment environment variables. After version 1 is created, the persisted policy is authoritative for all API instances sharing PostgreSQL.

## Operations

- `GET /api/admin/auth/metrics` returns a bounded activity and session-risk snapshot.
- `GET /api/admin/auth/failures` returns masked append-only failure evidence.
- `GET /api/admin/auth/risk-policy` returns the current or compatibility-default policy.
- `PUT /api/admin/auth/risk-policy` performs a CAS-safe policy update.
- Existing AUTH-02 session disposition, session revocation, and user containment routes remain unchanged.

Run `npm run test:auth-policy-risk-operations`, the PostgreSQL integration gate, focused Playwright, and finally `CI=1 npm run check:pr`.
