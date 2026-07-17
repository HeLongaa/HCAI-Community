# User Administration Operations

USER-02 provides bounded administration for personal accounts. It does not introduce tenants, organizations, teams, memberships, service accounts, or hard deletion.

## Access and projection

`admin:users:read` permits paginated user list and detail reads. Filters are limited to lifecycle status, role, and bounded search; sorting is limited to creation time, update time, and display name. The projection includes identity, profile visibility, authentication method names, active-session count, and lifecycle evidence. It never exposes password hashes, OAuth Provider identifiers, tokens, or secrets.

`admin:users:manage` permits only suspend and restore. Role changes remain owned by the reviewed permission model and are not exposed by USER-02.

## Suspension safeguards

Suspension uses `accountVersion` compare-and-swap in a serializable transaction. It records a machine-readable reason, changes the account to `suspended`, revokes every active logical session and refresh-token family, and writes `admin.user.suspended` audit evidence in the same transaction.

Administrators cannot suspend their own account or the final active administrator. Deleted users cannot be restored through this API. Restore clears suspension evidence and returns the account to `active`, but never reactivates old sessions or issues credentials.

## Operations

- Apply migration `0073_user_admin_lifecycle` before deploying the routes.
- Treat `USER_VERSION_CONFLICT` as a refresh-and-retry response.
- Investigate suspension and restore through immutable audit events.
- Run `npm run test:user-admin-operations` and `npm run test:user-admin-operations:integration` before release.
