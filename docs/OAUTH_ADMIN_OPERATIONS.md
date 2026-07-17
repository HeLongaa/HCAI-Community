# OAuth Admin Operations

## Scope

AUTH-01 provides a personal-account operations control plane for Google, GitHub, Apple, and Discord OAuth. It does not introduce tenants, organizations, teams, workspaces, memberships, or invitations.

Admins can manage client ids, exact redirect URIs, scopes, SecretRef metadata, and enabled state. The database and Admin API never store or return raw client secrets, private keys, access tokens, authorization codes, raw OAuth state, redirect targets, or account-link user identifiers. Actual secrets remain fixed deployment environment variables.

## Provider Configuration

`PUT /api/admin/auth/oauth/providers/{provider}/configuration` validates bounded fields, provider-specific callback paths, HTTPS outside local development, scopes, SecretRef format, and `expectedVersion`. A first configuration creates a disabled control at version `1`; it must be reviewed and explicitly enabled.

Configuration and status changes increment one shared optimistic version. A stale `expectedVersion` returns `STATE_CONFLICT`. Every authorization request pins this version, so any configuration or status change during authorization causes the callback to fail with `OAUTH_CONFIGURATION_CHANGED`. Disabling a Provider rejects new starts and in-flight callbacks.

An absent control remains compatibility-enabled at version `0`. Enabling is rejected with `OAUTH_PROVIDER_NOT_CONFIGURED` when the effective Admin/environment configuration or mounted secret is unavailable. `Secret mounted` means the fixed deployment variable is present; SecretRef alone is never sufficient.

Configuration audits record Provider, scopes, field-presence booleans, reason code, and version. They do not record client ids, redirect URIs, SecretRef values, or secret material.

## Account Operations

The account list supports Provider and handle/email search, created-time ordering, bounded cursor pagination, and masked Provider subject identifiers. Admin unlink runs in a serializable transaction with its audit outcome and refuses to remove a user's final persisted sign-in method.

## Authorization Operations

Authorization requests expose Provider, lifecycle status, timestamps, and stable reason code only. Pending requests may be revoked once. Consumed, expired, or already revoked requests return a conflict and cannot transition again. Callback consumption excludes revoked requests.

Expired authorization requests remain queryable for 30 days. Creating a new request prunes records whose expiry is older than that retention window.

## Operator Sequence

1. Register the exact callback in the Google or GitHub Provider console.
2. Mount the fixed environment secret in the API deployment and restart or roll out the API.
3. Save non-secret configuration in Admin using a stable reason code.
4. Verify **Secret mounted**, **Available**, callback URI, scopes, and audit evidence.
5. Enable the Provider and execute staging login/link/unlink and negative-flow checks.
6. Disable immediately on credential exposure, callback anomalies, or Provider incident; rotate the mounted secret before re-enabling.
