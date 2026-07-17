# Authentication Session Lifecycle

## Model

`AuthSession` is the user-visible logical session. A refresh-token rotation chain contains one or more `RefreshToken` rows whose `familyId` references the logical session id. Listing sessions returns one `AuthSession` row, never one row per refresh token.

New access tokens contain a signed `sid` claim. Every authenticated request resolves both the token subject and an active, unexpired, non-compromised `AuthSession`. Access tokens issued before `sid` support are intentionally rejected and require reauthentication after deployment.

## Rotation And Reuse

Refresh rotation runs in a Serializable PostgreSQL transaction. The presented token hash is revoked and linked to the replacement hash before the replacement row is created. Raw access and refresh tokens are returned only to the caller and are never persisted.

Presenting a previously rotated token is reuse evidence. The whole logical session becomes `compromised`, all remaining refresh rows in the family are revoked, and existing access tokens fail immediately because session resolution checks `sid`. `compromised` is terminal: an operator cannot erase or downgrade that evidence. The user may authenticate again to obtain a new logical session.

## Risk And Revocation

Risk states are `normal`, `suspicious`, and `compromised`. Lifecycle states are derived as `active`, `revoked`, or `expired`. Admin dispositions and revocations use the session `version` for optimistic concurrency.

- `suspicious` records a bounded stable reason and detection time without revoking access.
- Returning a suspicious session to `normal` records reviewer evidence.
- `compromised` records terminal risk evidence and revokes the token family atomically.
- Single-session and user-wide revocation invalidate both refresh and access credentials immediately.

Admin access reuses `admin:auth:read` and `admin:auth:manage`. Queries and all mutations are audited with sanitized metadata.

## Privacy Boundary

Only a coarse client label such as `Chrome on macOS` and an HMAC-SHA-256 network hash are stored. Admin and user APIs expose at most the first eight hexadecimal characters as a correlation hint. Raw IP addresses, complete user-agent strings, raw tokens, token hashes, cookies, and authorization headers are excluded from database session rows, API projections, UI state, and audit metadata.

The HMAC key follows the access-token key ring. Rotating that key intentionally prevents stable long-term correlation across key generations.

## Operator Runbook

1. Query active or suspicious sessions by user and inspect coarse client/network hints and timestamps.
2. Mark uncertain evidence `suspicious`; use a stable reason code without personal data.
3. Mark confirmed credential theft or refresh reuse `compromised`. This revokes the logical session immediately and cannot be undone.
4. Use single revoke for one device or user-wide revoke for account containment.
5. Ask the user to reauthenticate after revocation. Never attempt to restore a revoked or compromised session.
6. Investigate through sanitized audit actions: `admin.auth.session.risk_dispositioned`, `admin.auth.session.revoked`, `admin.auth.user_sessions.revoked`, and `auth.session.reuse_detected`.

## Verification

- `npm run test:auth-session-lifecycle`
- `npm run test:auth-session-lifecycle:integration` with `FOUNDATION_DATABASE_URL`
- `CI=1 npm run check:pr`

Fresh-database acceptance applies migrations `0001` through `0071`, verifies logical grouping across rotation, access-token `sid` invalidation, reuse containment, Admin CAS behavior, safe projections, and absence of raw token/IP/user-agent persistence.
