# OAuth Security And Staging

## Current Decision

AUTH-01 permits real Google and GitHub OAuth for personal accounts. Google, GitHub, and Discord use authorization-code exchange with S256 PKCE; Apple keeps its nonce-bound, JWKS-verified `id_token` flow. Provider endpoints are hardcoded and cannot be changed through Admin configuration.

## Runtime Boundary

- Admins may set only the client id, exact redirect URI, scopes, `secret://` reference, and enabled state.
- Raw client secrets, Apple private keys, access tokens, authorization codes, and Provider responses are never stored in PostgreSQL or returned by Admin APIs.
- `OAUTH_GOOGLE_CLIENT_SECRET` and `OAUTH_GITHUB_CLIENT_SECRET` are resolved only from the deployment environment. A SecretRef records which mounted secret is expected; it does not contain or dynamically resolve secret material.
- Missing configuration, missing mounted secrets, unsafe redirects, network errors, timeouts, non-2xx responses, malformed JSON, and unverified email evidence fail closed.
- Local and test environments may use signed dev callbacks unless `OAUTH_DEV_MODE=disabled`. Production never falls back to dev mode.
- Redirect URIs must use HTTPS in production, contain no query or fragment, and exactly target `/api/auth/oauth/{provider}/callback`.

## Google Registration

1. In Google Cloud Console, create or select a project and configure the OAuth consent screen.
2. Create an OAuth client with application type **Web application**.
3. Add the exact backend callback, for example `https://api.example.com/api/auth/oauth/google/callback`, to **Authorized redirect URIs**. Scheme, host, path, case, and trailing slash must match exactly.
4. Mount the generated secret as `OAUTH_GOOGLE_CLIENT_SECRET` in the API deployment.
5. In Admin OAuth operations, save the client id, the same redirect URI, scopes `openid email profile`, and `secret://oauth/google/client-secret`.
6. Confirm **Secret mounted** and **Available**, then enable Google.

The implementation uses Google's authorization endpoint, `https://oauth2.googleapis.com/token`, and `https://openidconnect.googleapis.com/v1/userinfo`. It accepts only a profile with `email_verified: true`. Official references: [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server) and [Google OpenID Connect reference](https://developers.google.com/identity/openid-connect/reference).

## GitHub Registration

1. In GitHub, open **Settings > Developer settings > OAuth Apps** and create a new OAuth App.
2. Set the application homepage to the public frontend origin.
3. Set **Authorization callback URL** to the exact backend callback, for example `https://api.example.com/api/auth/oauth/github/callback`.
4. Generate a client secret and mount it as `OAUTH_GITHUB_CLIENT_SECRET` in the API deployment.
5. In Admin OAuth operations, save the client id, the same callback URI, scopes `read:user user:email`, and `secret://oauth/github/client-secret`.
6. Confirm **Secret mounted** and **Available**, then enable GitHub.

The implementation sends `state` and S256 PKCE, exchanges the code at `https://github.com/login/oauth/access_token`, revalidates identity with `GET https://api.github.com/user`, and falls back to `GET https://api.github.com/user/emails` for a verified primary email. The `user:email` scope is required for private email lookup. Official references: [Authorizing GitHub OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps) and [GitHub email endpoints](https://docs.github.com/en/rest/users/emails).

## Authorization Request Security

- OAuth state is signed, expires after ten minutes, and contains only Provider protocol metadata plus a random nonce. App redirect and optional linking user id remain server-side; only a SHA-256 state hash is persisted.
- Each state hash is consumed atomically once before code exchange. Cancellation, verification failure, configuration changes, and success all prevent replay.
- Every authorization request pins the current Admin control version. Disabling a Provider or changing its configuration/status invalidates in-flight callbacks.
- PKCE verifiers are derived from server key material and the signed nonce; they are never persisted or returned.
- Google requests one-time identity scopes only and does not request offline access.

## Staging Acceptance

Use dedicated Provider test accounts and record successful login, link, unlink, cancellation, invalid-state, changed-configuration, and disabled-Provider behavior. Evidence may include timestamps, status codes, stable error codes, and masked account identifiers, but never secrets, authorization codes, tokens, raw state, or Provider payloads. Rotate or revoke credentials after accidental disclosure and disable the Provider from Admin during containment.
