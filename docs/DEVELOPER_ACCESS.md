# Developer Access

DEV-01 adds controlled Service Accounts and API keys for personal accounts. It does not add tenants, organizations, teams, memberships, invitations, or a public API v1. DEV-02 owns the versioned public API surface.

## Default-Off Control

`DeveloperAccessControl` is created disabled. Only `admin:developer:manage` can enable it or change the closed scope list, per-user Service Account limit, per-account active-key limit, and default TTL. Updates use optimistic concurrency and bounded reason codes. Disabling the control immediately makes every API key unavailable without deleting lifecycle evidence.

## Credential Lifecycle

An owner creates a Service Account, then issues an API key. The API returns `mfk_<prefix>_<secret>` only in that issue or rotation response. PostgreSQL stores the public prefix and SHA-256 hash of the 256-bit random secret; list, detail, export, audit, Admin, and UI projections never contain the hash or plaintext.

Keys have a closed scope list, optional normalized IPv4/IPv6 CIDR allowlist, expiry, version, usage count, last-used timestamp, and hashed last-IP hint. Rotation creates the replacement and marks the old key `rotated` in one serializable transaction. Owner or Admin revocation is immediate. Revoking a Service Account revokes all active keys in the same transaction. Expired keys fail authentication without a cleanup job.

CIDR enforcement uses the direct socket address by default. Set `API_KEY_TRUST_PROXY=true` only when the API is behind a trusted reverse proxy that removes any client-supplied `X-Forwarded-For` value and writes the authoritative chain itself. Leaving this flag disabled prevents a caller from bypassing an API key allowlist with a spoofed forwarding header.

The initial scope is `developer:identity:read`, used only by `GET /api/developer/principal`. API key principals are rejected by normal user routes even when the owning user could access those routes. DEV-02 must add each future API v1 scope and route explicitly.

## Operations

The personal API page creates and revokes Service Accounts, issues, rotates, and revokes keys, and displays usage and expiry. Plaintext key state is transient and can be dismissed after storage.

The Admin Access panel controls enablement and limits, filters safe Service Account projections, reads aggregate usage, exports bounded JSON, and performs single-target emergency revocation. Bulk revoke is intentionally unavailable because credentials are high-risk and each target requires explicit versioned disposition.

## Verification

```bash
npm run test:developer-access
FOUNDATION_DATABASE_URL=postgresql://... npm run test:developer-access:integration
```

The integration gate proves hash-only persistence, IP enforcement, concurrent rotation serialization, immediate invalidation, and cascade revocation on PostgreSQL.
