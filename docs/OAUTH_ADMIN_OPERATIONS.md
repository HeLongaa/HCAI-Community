# OAuth Admin Operations

## Scope

AUTH-01 adds a secret-free operations control plane for Google, Apple, and Discord OAuth on personal accounts. It does not introduce tenants, organizations, teams, workspaces, memberships, or invitations.

Provider credentials remain process environment configuration. The database and Admin API never store or return client secrets, private keys, access tokens, raw OAuth state, redirect targets, or account-link user identifiers.

## Provider control

An absent `OAuthProviderControl` row is treated as enabled at compatibility version `0`. The first explicit change requires `expectedVersion: 0`; later changes use the returned version. A stale version returns `STATE_CONFLICT`.

Disabling a Provider immediately marks it unavailable in the public Provider list and rejects new authorization starts with `OAUTH_PROVIDER_DISABLED`. Existing callbacks may complete because their state was issued before the disablement and remains single-use. Enabling is rejected when the Provider is unavailable in the current environment.

## Account operations

The account list supports Provider and handle/email search, created-time ordering, bounded cursor pagination, and masked Provider subject identifiers. Admin unlink runs in a serializable transaction with its audit outcome and refuses to remove a user's final persisted sign-in method.

## Authorization operations

Authorization requests are projected as Provider, lifecycle status, timestamps, and stable reason code only. Pending requests may be revoked once. Consumed, expired, or already revoked requests return a conflict and cannot transition again. Callback consumption excludes revoked requests.

Expired authorization requests remain queryable for 30 days. Creating a new authorization request prunes records whose expiry is older than that retention window.

## Staging acceptance

Real Provider staging acceptance is separate from the offline control-plane gate. It requires actual credentials and callback registration for each Provider. Evidence must record the environment and successful start, callback, login, link, unlink, cancellation, invalid-state, and disabled-Provider behavior without recording secrets or Provider payloads.
