# User Profile Privacy and Account Deletion Requests

USER-01 applies only to personal accounts. Owners may edit a bounded profile field set and choose `public`, `unlisted`, or `private` visibility. Discovery additionally requires `discoverable=true`, an active account, and no pending deletion request.

## Trust boundary

`PATCH /api/profiles/me` and the legacy `PATCH /api/users/me/profile` accept only display name, handle, bio, lane, skills, languages, visibility, discoverability, activity visibility, portfolio visibility, and `expectedVersion`. Role, badges, reviews, stats, portfolio records, and arbitrary metadata are rejected. Profile updates use compare-and-swap versioning and handle uniqueness.

Public viewers receive no profile for a private account. Unlisted profiles remain directly readable by handle but do not appear in lists or rankings. Activity and portfolio controls redact those projections for non-owners; owners retain access to their own settings and records.

## Deletion request lifecycle

An authenticated owner may request deletion with an account version and a bounded reason code. The request schedules deletion 30 days later and immediately removes the profile from public reads and discovery while preserving owner access needed to cancel. Cancellation is also versioned and audited.

USER-01 does not physically delete account data. Final deletion, shared-identity tombstoning, Provider cleanup, and retention execution remain owned by LEGAL-02. Raw free-text deletion explanations are not persisted.

## Operations

- Apply migration `0072_user_profile_privacy_lifecycle` before deploying the routes.
- Treat `PROFILE_VERSION_CONFLICT` and `ACCOUNT_VERSION_CONFLICT` as refresh-and-retry responses.
- Investigate `profile.updated`, `account.deletion_requested`, and `account.deletion_cancelled` through immutable audit events.
- Run `npm run test:user-profile-privacy` and `npm run test:user-profile-privacy:integration` before release.
