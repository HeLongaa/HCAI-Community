# OAuth Security And Staging

## Current Decision

AUTH-01 offline hardening is enabled. Real Google, Apple, or Discord credentials, network calls, and staging validation remain disabled until the project owner grants explicit Provider approval.

## Runtime Boundary

- Local and test environments may use signed dev callbacks unless `OAUTH_DEV_MODE=disabled`.
- Production never falls back to a dev callback. A provider with missing or invalid configuration is returned as `unavailable`, and its start route fails with `OAUTH_PROVIDER_UNAVAILABLE`.
- Redirect URIs must use HTTPS in production and must exactly target `/api/auth/oauth/{provider}/callback`.
- Provider JSON requests use a bounded timeout. Network errors, aborts, non-2xx responses, and malformed JSON fail closed without retaining raw Provider responses.

## Authorization Request Security

- OAuth state is signed, expires after ten minutes, and contains only protocol metadata plus a random nonce. The bounded app redirect and optional linking user id remain server-side, while the state itself is persisted only as a SHA-256 hash.
- Each state hash is consumed atomically once before code exchange. Cancellation, verification failure, and successful callbacks all make the state unusable for replay.
- Google and Discord use S256 PKCE. The verifier is derived from server key material and the signed nonce; it is never persisted or returned separately.
- Google requests only the authorization needed for one-time identity verification and does not request offline Provider access.
- Apple uses its signed client secret and nonce-bound, JWKS-verified `id_token` flow.

## Browser Session Recovery

- The top-level callback sets HttpOnly refresh and readable CSRF cookies.
- Callback HTML contains no access token, refresh token, user snapshot, Provider profile, or raw response.
- The bridge clears stale local access state, stores only the bounded app redirect, and reloads the application. The application rotates the refresh cookie and then resolves `/api/me`.

## Account Lifecycle

- Provider account creation, session issuance, and audit evidence are transactional in PostgreSQL.
- Concurrent unlink operations use Serializable transactions so at least one sign-in method remains.
- Audit resource ids contain a bounded Provider name plus a hash hint, not a raw Provider user id.
- Google, Discord, and Apple profiles require verified email evidence before automatic email-account linking.

## Deferred Real Provider Gate

Before any real call, record explicit approval naming:

1. Provider and exact application/client registration.
2. Staging environment and callback origins.
3. Test accounts and maximum login/link attempts.
4. Credential owner, rotation owner, and expiry.
5. Kill switch and rollback owners.
6. Approved validation window.

Ordinary instructions such as "start" or "continue" do not grant this approval.
