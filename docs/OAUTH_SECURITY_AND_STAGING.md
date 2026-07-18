# OAuth Security And Staging

## Current Decision

AUTH-01 permits real Google and GitHub OAuth for personal accounts. Google, GitHub, and Discord use authorization-code exchange with S256 PKCE; Apple keeps its nonce-bound, JWKS-verified `id_token` flow. Provider endpoints are hardcoded and cannot be changed through Admin configuration.

## Runtime Boundary

- Admins may set only the client id, exact redirect URI, scopes, `secret://` reference, and enabled state.
- Raw client secrets, Apple private keys, access tokens, authorization codes, and Provider responses are never stored in PostgreSQL or returned by Admin APIs.
- `OAUTH_GOOGLE_CLIENT_SECRET` and `OAUTH_GITHUB_CLIENT_SECRET` are resolved only from the deployment environment. Admin stores an allowlisted `secret://env/...` reference; runtime resolves that reference without copying secret material into PostgreSQL or an API response.
- Missing configuration, missing mounted secrets, unsafe redirects, network errors, timeouts, non-2xx responses, malformed JSON, and unverified email evidence fail closed.
- Local and test environments may use signed dev callbacks unless `OAUTH_DEV_MODE=disabled`. Production never falls back to dev mode.
- Redirect URIs must use HTTPS in production, contain no query or fragment, and exactly target `/api/auth/oauth/{provider}/callback`.

## Google Registration

1. In Google Auth Platform, create or select a project. Configure **Branding**, **Audience**, and **Data Access**. Use **External** audience for personal Google accounts; while the app is in testing, add the staging accounts as test users.
2. Create an OAuth client with application type **Web application**.
3. Add the exact backend callback, for example `https://api.example.com/api/auth/oauth/google/callback`, to **Authorized redirect URIs**. Scheme, host, path, case, and trailing slash must match exactly.
4. Add the frontend origin to **Authorized JavaScript origins** only if browser-side Google APIs are used. This server-side authorization-code flow does not require it.
5. Mount the generated secret as `OAUTH_GOOGLE_CLIENT_SECRET` in the API deployment. Do not commit the downloaded credential JSON.
6. In Admin OAuth operations, save the client id, the same redirect URI, scopes `openid email profile`, and `secret://env/OAUTH_GOOGLE_CLIENT_SECRET`.
7. Confirm **Secret mounted** and **Available**, then enable Google.

The implementation uses Google's authorization endpoint, `https://oauth2.googleapis.com/token`, and `https://openidconnect.googleapis.com/v1/userinfo`. It accepts only a profile with `email_verified: true`; Admin cannot remove the required `openid` or `email` scopes. Official references: [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server) and [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).

## GitHub Registration

1. In GitHub, open **Settings > Developer settings > OAuth Apps** and create a new OAuth App.
2. Set the application homepage to the public frontend origin.
3. Set **Authorization callback URL** to the exact backend callback, for example `https://api.example.com/api/auth/oauth/github/callback`.
4. Generate a client secret and mount it as `OAUTH_GITHUB_CLIENT_SECRET` in the API deployment.
5. In Admin OAuth operations, save the client id, the same callback URI, scopes `read:user user:email`, and `secret://env/OAUTH_GITHUB_CLIENT_SECRET`.
6. Confirm **Secret mounted** and **Available**, then enable GitHub.

The implementation sends `state` and S256 PKCE, exchanges the code at `https://github.com/login/oauth/access_token`, revalidates identity with `GET https://api.github.com/user`, and reads `GET https://api.github.com/user/emails` for a verified email. Admin cannot remove `read:user` or `user:email`; GitHub requires `user:email` for private email lookup. Official references: [Create a GitHub OAuth App](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app), [Authorizing GitHub OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps), and [GitHub email endpoints](https://docs.github.com/en/rest/users/emails).

GitHub OAuth Apps support one callback URL. Use separate OAuth Apps and credentials for local, staging, and production rather than changing a production callback during testing. Google Web application clients may register multiple exact redirect URIs, but dedicated environment credentials are still recommended for isolation.

## Deployment Preflight

Run the preflight in the API deployment environment after mounting credentials and saving the matching Admin configuration:

```bash
npm run oauth:preflight -- --api-origin=https://api.example.com
```

The command checks only whether each client id and secret is present; it never prints secret values. It rejects non-HTTPS production callbacks, callback paths that differ from `/api/auth/oauth/{provider}/callback`, query strings, and fragments. With `--api-origin`, it also verifies that the public Provider status reports both Google and GitHub as `external` and available, which covers the Admin enable/disable setting and effective runtime configuration.

For local registration, use dedicated development clients and run:

```bash
npm run oauth:preflight -- --allow-local --api-origin=http://127.0.0.1:8787
```

Register these exact local callbacks:

- Google: `http://127.0.0.1:8787/api/auth/oauth/google/callback`
- GitHub: `http://127.0.0.1:8787/api/auth/oauth/github/callback`

Passing preflight does not prove that the third-party console contains the callback. The final acceptance must complete one real login for each Provider because Google and GitHub disclose callback-registration mistakes only during the live authorization flow.

## Authorization Request Security

- OAuth state is signed, expires after ten minutes, and contains only Provider protocol metadata plus a random nonce. App redirect and optional linking user id remain server-side; only a SHA-256 state hash is persisted.
- Each state hash is consumed atomically once before code exchange. Cancellation, verification failure, configuration changes, and success all prevent replay.
- Every authorization request pins the current Admin control version. Disabling a Provider or changing its configuration/status invalidates in-flight callbacks.
- PKCE verifiers are derived from server key material and the signed nonce; they are never persisted or returned.
- Google requests one-time identity scopes only and does not request offline access.

## Staging Acceptance

Use dedicated Provider test accounts and record successful login, link, unlink, cancellation, invalid-state, changed-configuration, and disabled-Provider behavior. Evidence may include timestamps, status codes, stable error codes, and masked account identifiers, but never secrets, authorization codes, tokens, raw state, or Provider payloads. Rotate or revoke credentials after accidental disclosure and disable the Provider from Admin during containment.

External console registration cannot be completed from source control alone. Before declaring production ready, an owner with access to Google Cloud Console and GitHub Developer settings must create the clients, register the exact callbacks, mount both secrets, and execute this staging acceptance sequence.
